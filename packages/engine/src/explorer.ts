import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeUrl, type Finding, type RunReport, type StepRecord } from '@testpilot/shared';
import { defaultDetectors, type Detector } from '@testpilot/detectors';
import type { WebExecutor } from '@testpilot/executor';
import type { Brain } from './brains/types.js';

export interface ExplorerOptions {
  targetUrl: string;
  goal?: string;
  stepBudget: number;
  outDir: string;
  mode: 'heuristic' | 'ai' | 'cli';
  detectors?: readonly Detector[];
  onProgress?: (message: string) => void;
}

/**
 * 探索器:观察 → 决策 → 执行 → 采集信号 → 检测缺陷 的主循环。
 * 与平台无关(大脑与执行器注入),M1 里 worker 直接复用。
 */
export class Explorer {
  private readonly detectors: readonly Detector[];
  private readonly seenFingerprints = new Set<string>();
  private readonly steps: StepRecord[] = [];
  private readonly findings: Finding[] = [];
  private readonly visitedUrls = new Set<string>();
  private lastScreenshotAbs?: string;

  constructor(
    private readonly executor: WebExecutor,
    private readonly brain: Brain,
    private readonly opts: ExplorerOptions,
  ) {
    this.detectors = opts.detectors ?? defaultDetectors;
  }

  async run(): Promise<RunReport> {
    const startedAt = Date.now();
    const shotsDir = path.join(this.opts.outDir, 'screenshots');
    await mkdir(shotsDir, { recursive: true });

    await this.executor.launch(this.opts.targetUrl);
    await this.recordStep(1, `打开目标页面 ${this.opts.targetUrl}`, shotsDir);

    let seq = 1;
    // 目标打不开(launch 内已重试一次)→ 记 Critical 缺陷并终止,不烧步数预算
    if (this.executor.isUnreachable()) {
      this.addFinding(
        {
          detector: 'navigation',
          severity: 'critical',
          title: `目标站点无法访问:${this.opts.targetUrl}`,
          fingerprint: `navigation:unreachable:${normalizeUrl(this.opts.targetUrl)}`,
          pageUrl: this.opts.targetUrl,
          evidence: { hint: '连接被拒绝或超时,已重试 1 次。请确认地址可达,或站点是否有反爬风控。' },
        },
        seq,
        path.join('screenshots', 'step-001.png'),
      );
      this.opts.onProgress?.('目标站点无法访问,探索终止');
      return this.finalize(startedAt, seq);
    }

    while (seq < this.opts.stepBudget) {
      const obs = await this.executor.observe();
      this.visitedUrls.add(normalizeUrl(obs.pageUrl));

      const plan = await this.brain.nextStep(obs, {
        goal: this.opts.goal,
        stepSeq: seq + 1,
        stepBudget: this.opts.stepBudget,
        lastScreenshot: this.lastScreenshotAbs,
      });
      if (!plan) {
        this.opts.onProgress?.('探索收敛:没有更多可探索的目标');
        break;
      }

      seq += 1;
      await plan.execute();
      await this.recordStep(seq, plan.description, shotsDir);
    }

    return this.finalize(startedAt, seq);
  }

  private async finalize(startedAt: number, stepsTaken: number): Promise<RunReport> {
    const report: RunReport = {
      runId: path.basename(this.opts.outDir),
      mode: this.opts.mode,
      targetUrl: this.opts.targetUrl,
      goal: this.opts.goal,
      startedAt,
      finishedAt: Date.now(),
      stepBudget: this.opts.stepBudget,
      stepsTaken,
      visitedUrls: [...this.visitedUrls],
      steps: this.steps,
      findings: this.findings,
    };
    await writeFile(
      path.join(this.opts.outDir, 'report.json'),
      JSON.stringify(report, null, 2),
      'utf8',
    );
    return report;
  }

  private addFinding(
    draft: Omit<Finding, 'id' | 'stepSeq' | 'screenshotFile' | 'at'>,
    stepSeq: number,
    screenshotFile: string,
  ): void {
    if (this.seenFingerprints.has(draft.fingerprint)) return;
    this.seenFingerprints.add(draft.fingerprint);
    const finding: Finding = {
      ...draft,
      id: `f-${this.findings.length + 1}`,
      stepSeq,
      screenshotFile,
      at: Date.now(),
    };
    this.findings.push(finding);
    this.opts.onProgress?.(`  ⚠ 发现缺陷 [${finding.severity}] ${finding.title}`);
  }

  /** 截图 + 落轨迹 + 消化这一步产生的信号 */
  private async recordStep(seq: number, description: string, shotsDir: string): Promise<void> {
    const screenshotFile = path.join('screenshots', `step-${String(seq).padStart(3, '0')}.png`);
    const screenshotAbs = path.join(shotsDir, path.basename(screenshotFile));
    await this.executor.screenshot(screenshotAbs);
    this.lastScreenshotAbs = screenshotAbs;

    const pageUrl = this.executor.page.url();
    const pageTitle = await this.executor.page.title().catch(() => '');
    this.steps.push({ seq, description, pageUrl, pageTitle, screenshotFile, at: Date.now() });
    this.opts.onProgress?.(`步骤 ${seq}:${description}`);

    for (const signal of this.executor.drainSignals()) {
      for (const detector of this.detectors) {
        const draft = detector.onSignal(signal);
        if (draft) this.addFinding(draft, seq, screenshotFile);
      }
    }
  }
}
