import type { TestCase, TestCaseSuite } from '@testpilot/shared';
import { claudeInvoker, type CliInvoker } from './brains/cli.js';

export interface CaseGenInput {
  /** 需求文档正文(markdown/纯文本) */
  doc: string;
  /** 被测目标:web=URL,android=包名 */
  target: string;
  platform: 'web' | 'android';
  /** 期望用例数量上限,默认 8 */
  maxCases?: number;
  /** 补充侧重,如「重点覆盖注册与支付流程」 */
  focus?: string;
}

/**
 * 需求文档 → 结构化测试用例。默认用本机 claude CLI(纯文本推理,零 API 成本)。
 * 产出的用例可直接写成 .yaml 交给 CaseRunner 执行。
 */
export async function generateCasesFromDoc(
  input: CaseGenInput,
  invoke: CliInvoker = claudeInvoker,
): Promise<TestCaseSuite> {
  const maxCases = input.maxCases ?? 8;
  const raw = await invoke(buildPrompt(input, maxCases));
  const cases = parseCases(raw);
  if (cases.length === 0) {
    throw new Error('未能从文档生成用例:模型输出无法解析,请检查文档内容或重试');
  }
  return {
    target: input.target,
    platform: input.platform,
    cases: cases.slice(0, maxCases).map((c, i) => ({ ...c, id: `case-${i + 1}`, source: 'doc' as const })),
  };
}

function buildPrompt(input: CaseGenInput, maxCases: number): string {
  const focusPart = input.focus ? `\n特别侧重:${input.focus}` : '';
  const platformHint =
    input.platform === 'android'
      ? '被测对象是 Android 应用,操作用「点击/输入/滑动/返回」等移动端动作。'
      : '被测对象是网页,操作用「点击/输入/打开链接」等 Web 动作。';

  return `你是资深测试工程师。请根据下面的需求文档,设计一批端到端功能测试用例。
${platformHint}${focusPart}

要求:
1. 每条用例聚焦一个可独立验证的功能点或用户流程;
2. 每步是一个具体的自然语言操作(action),关键步骤配一个可观察的预期(expect);
3. expect 要能从界面上直接判断真假(如「出现验证码输入框」「提示注册成功」),不要写模糊的「正常」;
4. 用测试数据:邮箱 tp-test@example.com、密码 TestPilot@2026、其他字段随意;
5. 不要设计任何不可逆操作(真实支付、删除账号、对外发送);
6. 最多 ${maxCases} 条,优先覆盖核心流程与边界。

只输出一个 JSON 数组(不要 markdown 代码块、不要解释),格式:
[{"name":"用例名","steps":[{"action":"操作","expect":"预期(可选)"}]}]

需求文档:
"""
${input.doc.slice(0, 12_000)}
"""`;
}

/** 从模型输出提取用例数组,容忍前后缀与 markdown 包裹 */
export function parseCases(raw: string): TestCase[] {
  const start = raw.indexOf('[');
  if (start === -1) return [];
  for (let end = raw.lastIndexOf(']'); end > start; end = raw.lastIndexOf(']', end - 1)) {
    try {
      const arr = JSON.parse(raw.slice(start, end + 1)) as unknown;
      if (!Array.isArray(arr)) return [];
      const cases: TestCase[] = [];
      for (const item of arr) {
        const c = item as { name?: unknown; steps?: unknown };
        if (typeof c.name !== 'string' || !Array.isArray(c.steps)) continue;
        const steps = c.steps
          .map((s) => s as { action?: unknown; expect?: unknown })
          .filter((s) => typeof s.action === 'string')
          .map((s) => ({
            action: s.action as string,
            ...(typeof s.expect === 'string' && s.expect ? { expect: s.expect } : {}),
          }));
        if (steps.length > 0) cases.push({ id: '', name: c.name, steps });
      }
      return cases;
    } catch {
      // 缩小右边界重试
    }
  }
  return [];
}
