import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CaseResult,
  CaseRunReport,
  ModelConfig,
  StepResult,
  TestCase,
  TestCaseSuite,
} from '@testpilot/shared';
import { checkGuardrail, type AiAgent, type ExplorerTarget } from '@testpilot/executor';

export interface CaseRunnerOptions {
  outDir: string;
  modelConfig?: ModelConfig;
  /** 自定义 agent 工厂(如本机 Claude CLI 版);默认用 target.createAgent(Midscene 多模态) */
  agentFactory?: (target: ExplorerTarget) => Promise<AiAgent>;
  /** 上次运行录制的动作轨迹(按用例 id → 步序):命中则先回放,失败再 AI 自愈 */
  traces?: SuiteTraces;
  onProgress?: (message: string) => void;
}

/** 一步的录制轨迹:action 文本用于校验用例未被改动 */
export interface StepTrace {
  action: string;
  performed: unknown;
}

/** 整个用例集的轨迹:用例 id → 每步轨迹 */
export type SuiteTraces = Record<string, StepTrace[]>;

/**
 * 用例执行器:逐条用例、逐步执行(aiAction),带 expect 的步骤用 aiBoolean 判定通过/失败。
 * 一步失败即该用例判 failed 并跳过剩余步(避免在错误状态上继续);护栏拦截危险操作。
 * Web/Android 通过 ExplorerTarget 统一驱动。
 */
export class CaseRunner {
  /** 本次运行录到的轨迹(仅记录通过的步骤),供调用方存盘给下次回放 */
  readonly traces: SuiteTraces = {};

  constructor(
    private readonly target: ExplorerTarget,
    private readonly suite: TestCaseSuite,
    private readonly opts: CaseRunnerOptions,
  ) {}

  async run(): Promise<CaseRunReport> {
    const startedAt = Date.now();
    const targetUri = this.suite.target;
    if (!targetUri) throw new Error('用例缺少执行目标(target),请在执行时用 -t 指定');
    const platform = this.suite.platform ?? 'web';
    const shotsDir = path.join(this.opts.outDir, 'screenshots');
    await mkdir(shotsDir, { recursive: true });

    await this.target.launch(targetUri);
    const agent = this.opts.agentFactory
      ? await this.opts.agentFactory(this.target)
      : await this.target.createAgent(this.opts.modelConfig);

    const results: CaseResult[] = [];
    let shotSeq = 0;

    for (const testCase of this.suite.cases) {
      this.opts.onProgress?.(`▶ 用例「${testCase.name}」`);
      // 每条用例回到起点,避免相互污染
      await this.target.launch(targetUri).catch(() => {});
      const result = await this.runCase(testCase, agent, shotsDir, () => ++shotSeq);
      results.push(result);
      this.opts.onProgress?.(
        `  ${result.status === 'passed' ? '✅' : result.status === 'failed' ? '❌' : '⚠'} ${testCase.name}`,
      );
    }

    const report: CaseRunReport = {
      runId: path.basename(this.opts.outDir),
      target: targetUri,
      platform,
      startedAt,
      finishedAt: Date.now(),
      total: results.length,
      passed: results.filter((r) => r.status === 'passed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      blocked: results.filter((r) => r.status === 'blocked').length,
      results,
    };
    await writeFile(path.join(this.opts.outDir, 'cases.json'), JSON.stringify(report, null, 2), 'utf8');
    return report;
  }

  private async runCase(
    testCase: TestCase,
    agent: AiAgent,
    shotsDir: string,
    nextShot: () => number,
  ): Promise<CaseResult> {
    const steps: StepResult[] = [];
    let caseStatus: CaseResult['status'] = 'passed';

    for (let stepIndex = 0; stepIndex < testCase.steps.length; stepIndex++) {
      const step = testCase.steps[stepIndex]!;
      const screenshotFile = path.join('screenshots', `step-${String(nextShot()).padStart(3, '0')}.png`);
      const shotAbs = path.join(shotsDir, path.basename(screenshotFile));

      // 护栏:危险操作直接阻塞,不执行
      const verdict = checkGuardrail(step.action);
      if (!verdict.allowed) {
        await this.target.screenshot(shotAbs).catch(() => {});
        steps.push({
          action: step.action,
          expect: step.expect,
          status: 'blocked',
          detail: `命中安全护栏(敏感词:${verdict.matchedWord}),已跳过`,
          screenshotFile,
          at: Date.now(),
        });
        caseStatus = caseStatus === 'passed' ? 'blocked' : caseStatus;
        break;
      }

      try {
        let status: StepResult['status'] = 'pass';
        let detail: string | undefined;
        if (agent.aiStep) {
          let ok: boolean | undefined;
          let stepTrace: unknown;

          // 有上次录制的轨迹且步骤文本未变 → 先按轨迹秒级回放,断言通过即免去 AI 找路
          const cached = this.opts.traces?.[testCase.id]?.[stepIndex];
          if (cached && cached.action === step.action && agent.replay && Array.isArray(cached.performed)) {
            try {
              await agent.replay(cached.performed);
              const replayOk = step.expect ? await agent.aiBoolean(step.expect) : true;
              if (replayOk) {
                ok = true;
                stepTrace = cached.performed;
                detail = step.expect ? '断言通过(轨迹回放)' : '轨迹回放';
              } else {
                this.opts.onProgress?.('    ↻ 回放后断言未过,AI 重新执行');
              }
            } catch {
              this.opts.onProgress?.('    ↻ 回放出错,AI 重新执行');
            }
          }

          // 无轨迹/回放未达成 → AI 找路执行(合并式:执行 + 判定预期一次完成)
          if (ok === undefined) {
            const r = await agent.aiStep(step.action, step.expect);
            ok = r.ok;
            stepTrace = r.trace;
            if (step.expect) detail = ok ? '断言通过' : `断言未满足:${step.expect}`;
          }
          status = ok ? 'pass' : 'fail';
          if (ok && stepTrace !== undefined) {
            (this.traces[testCase.id] ??= [])[stepIndex] = { action: step.action, performed: stepTrace };
          }
        } else {
          await agent.aiAction(step.action);
          if (step.expect) {
            const ok = await agent.aiBoolean(step.expect);
            status = ok ? 'pass' : 'fail';
            detail = ok ? '断言通过' : `断言未满足:${step.expect}`;
          }
        }
        await this.target.screenshot(shotAbs).catch(() => {});
        steps.push({ action: step.action, expect: step.expect, status, detail, screenshotFile, at: Date.now() });
        if (status === 'fail') {
          caseStatus = 'failed';
          break; // 断言失败即停,剩余步骤不再执行
        }
      } catch (err) {
        await this.target.screenshot(shotAbs).catch(() => {});
        steps.push({
          action: step.action,
          expect: step.expect,
          status: 'fail',
          detail: `执行出错:${err instanceof Error ? err.message : String(err)}`,
          screenshotFile,
          at: Date.now(),
        });
        caseStatus = 'failed';
        break;
      }
    }

    return { id: testCase.id, name: testCase.name, status: caseStatus, steps };
  }
}
