import type { TestCase, TestCaseSuite } from '@testpilot/shared';
import { claudeInvoker, type CliInvoker } from './brains/cli.js';

export interface CaseGenInput {
  /** 输入正文:需求文档原文、Figma 设计摘要,或二者合并(带小节标题) */
  doc: string;
  /** 输入类型:doc 功能文档 / figma 设计稿 / both 文档+设计稿(影响提示词与用例 source) */
  kind?: 'doc' | 'figma' | 'both';
  /** 期望用例数量上限,默认 8 */
  maxCases?: number;
  /** 补充侧重,如「重点覆盖注册与支付流程」 */
  focus?: string;
  /** 前置/起始状态,如「已登录,从主页开始」;影响是否生成登录步骤 */
  precondition?: string;
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
  const kind = input.kind ?? 'doc';
  const raw = await invoke(buildPrompt(input, maxCases));
  const cases = parseCases(raw);
  if (cases.length === 0) {
    throw new Error('未能生成用例:模型输出无法解析,请检查输入内容或重试');
  }
  // 生成阶段只产出「测什么」;目标(URL/包名)与平台在执行时提供
  return {
    cases: cases.slice(0, maxCases).map((c, i) => ({ ...c, id: `case-${i + 1}`, source: kind })),
  };
}

function buildPrompt(input: CaseGenInput, maxCases: number): string {
  const focusPart = input.focus ? `\n特别侧重:${input.focus}` : '';
  const precondition = input.precondition?.trim();
  const preconditionPart = precondition
    ? `\n\n起始状态(所有用例都从这里开始):${precondition}
据此判断是否需要登录步骤:若起始状态已登录,所有用例都跳过打开应用/输账号/登录这些步骤,第一步直接从「已登录的主界面」开始进入功能;只有当用例本身就是测「登录/注册」时才写登录步骤。`
    : '';
  const platformHint =
    '操作用自然语言描述用户动作(点击、输入、滑动、返回等),尽量与具体平台无关,同一批用例既能跑网页也能跑 App。';
  const kind = input.kind ?? 'doc';
  const sourceLabel =
    kind === 'both'
      ? '需求文档(功能规格)与 Figma 设计稿(UI 规格)'
      : kind === 'figma'
        ? '设计稿(Figma 提取的界面结构与文案)'
        : '需求文档';
  const kindTip =
    kind === 'both'
      ? '\n需求文档描述功能与业务规则,设计稿描述界面元素与布局;请结合两者——既覆盖功能流程,也覆盖界面上应出现的元素/文案。'
      : kind === 'figma'
        ? '\n设计稿里主要是界面元素、文案、层级;请据此推断用户能做的操作和应看到的界面状态来设计用例。'
        : '';

  return `你是资深测试工程师。请根据下面的${sourceLabel},设计一批端到端功能测试用例。
${platformHint}${kindTip}${focusPart}${preconditionPart}

要求:
1. 每条用例聚焦一个可独立验证的功能点或用户流程;
2. 【最重要】每步只做一个原子动作——一次点击、一次输入、一次滑动或一次返回。
   绝不把多个动作塞进一步。例如"进入合约页,打开更多菜单,点击计算器"必须拆成三步:
   ①进入合约交易页 ②点击右上角「更多」菜单 ③在菜单中点击「计算器」;
3. 每步用统一的用户视角描述目标,不要在一步里写平台分支(不要写"App在…Web在…");
   界面上元素具体在哪由执行时看屏幕决定,你只描述用户要点什么;
4. 关键步骤配一个可观察的预期(expect),要能从界面直接判断真假
   (如「出现计算器输入面板」「显示预估强平价」),不要写模糊的「正常/成功」;
5. 用测试数据:邮箱 tp-test@example.com、密码 TestPilot@2026、其他字段随意;
6. 不要设计任何不可逆操作(真实支付、下单成交、删除账号、对外发送);
7. 最多 ${maxCases} 条,优先覆盖核心流程与边界;步骤可以多,但每步保持原子。

只输出一个 JSON 数组(不要 markdown 代码块、不要解释),格式:
[{"name":"用例名","steps":[{"action":"操作","expect":"预期(可选)"}]}]

${sourceLabel}:
"""
${input.doc.slice(0, 16_000)}
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
