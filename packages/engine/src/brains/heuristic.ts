import { normalizeUrl } from '@testpilot/shared';
import { checkGuardrail, type Interactable, type WebExecutor } from '@testpilot/executor';
import type { Brain, BrainContext, StepPlan } from './types.js';

type Clickable = Extract<Interactable, { kind: 'link' | 'button' }>;

/**
 * 启发式大脑:不调用任何模型,零成本冒烟爬行。
 * 策略:与探索目标相关的元素最优先(关键词匹配),其次未访问链接(BFS 味道),
 * 再次当前页未点过的按钮,都没有则回起点找剩余目标,仍无 → 结束。
 * 注意:启发式不会填写表单,完整业务流程(如注册提交)需 AI 模式。
 */
export class HeuristicBrain implements Brain {
  readonly name = 'heuristic';
  private readonly visited = new Set<string>();
  private readonly clickedButtons = new Set<string>();
  private readonly skipped: string[] = [];
  private readonly goalTerms: string[];
  private consecutiveReturns = 0;

  constructor(
    private readonly executor: WebExecutor,
    private readonly startUrl: string,
    goal?: string,
  ) {
    this.visited.add(normalizeUrl(startUrl));
    this.goalTerms = extractGoalTerms(goal ?? '');
  }

  /** 被护栏拦截的目标,报告里展示 */
  get guardrailSkipped(): readonly string[] {
    return this.skipped;
  }

  async nextStep(obs: Parameters<Brain['nextStep']>[0], _ctx: BrainContext): Promise<StepPlan | null> {
    // 启发式只处理链接与按钮;输入框由 AI/CLI 大脑负责
    const clickables = obs.interactables.filter(
      (i): i is Clickable => i.kind === 'link' || i.kind === 'button',
    );

    // 0. 目标相关元素最优先:文案命中目标关键词的链接/按钮
    if (this.goalTerms.length > 0) {
      const scored = clickables
        .map((item) => ({ item, score: scoreByTerms(item.text, this.goalTerms) }))
        .filter(({ item, score }) => score > 0 && this.isFresh(item, obs.pageUrl))
        .sort((a, b) => b.score - a.score);
      const best = scored.find(({ item }) => this.allowed(item.text || labelOf(item)));
      if (best) return this.planFor(best.item, obs.pageUrl, '(目标相关)');
    }

    // 1. 未访问的同站链接
    for (const item of clickables) {
      if (item.kind !== 'link') continue;
      if (!this.isFresh(item, obs.pageUrl)) continue;
      if (!this.allowed(item.text || item.url)) continue;
      return this.planFor(item, obs.pageUrl);
    }

    // 2. 当前页未点击过的按钮
    for (const item of clickables) {
      if (item.kind !== 'button') continue;
      if (!this.isFresh(item, obs.pageUrl)) continue;
      if (!this.allowed(item.text)) continue;
      return this.planFor(item, obs.pageUrl);
    }

    // 3. 不在起点则回起点再找一轮;连续多次返回仍无新目标说明起点已打不开或无可探索,终止
    if (normalizeUrl(obs.pageUrl) !== normalizeUrl(this.startUrl)) {
      if (this.consecutiveReturns >= 2) return null;
      this.consecutiveReturns += 1;
      return {
        description: `返回起始页(${this.startUrl})`,
        execute: () => this.executor.goto(this.startUrl),
      };
    }

    return null; // 覆盖收敛,结束
  }

  /** 该元素是否还没被消费过 */
  private isFresh(item: Clickable, pageUrl: string): boolean {
    return item.kind === 'link'
      ? !this.visited.has(normalizeUrl(item.url))
      : !this.clickedButtons.has(buttonKey(item, pageUrl));
  }

  /** 生成执行计划并登记去重 */
  private planFor(item: Clickable, pageUrl: string, tag = ''): StepPlan {
    this.consecutiveReturns = 0; // 找到新目标即视为有进展

    if (item.kind === 'link') {
      this.visited.add(normalizeUrl(item.url));
      return {
        description: `打开链接「${item.text || item.url}」${tag}(${item.url})`,
        execute: () => this.executor.goto(item.url),
      };
    }
    this.clickedButtons.add(buttonKey(item, pageUrl));
    return {
      description: `点击按钮「${labelOf(item)}」${tag}`,
      execute: () => this.executor.clickButton(item.nth, item.text || undefined),
    };
  }

  private allowed(text: string): boolean {
    const verdict = checkGuardrail(text);
    if (!verdict.allowed) {
      this.skipped.push(`「${text}」(命中敏感词:${verdict.matchedWord})`);
    }
    return verdict.allowed;
  }
}

function buttonKey(item: Extract<Interactable, { kind: 'button' }>, pageUrl: string): string {
  return `${normalizeUrl(pageUrl)}::${item.text}::${item.nth}`;
}

function labelOf(item: Clickable): string {
  return item.kind === 'button' ? item.text || `#${item.nth}` : item.text || item.url;
}

/**
 * 从目标描述提取匹配词:英文按词切,中文取相邻双字(注册/流程/下单…),
 * 并剔除「测试/流程/页面」等任务描述用词,只留业务词。
 */
const TASK_NOISE_WORDS = new Set([
  '测试', '重点', '流程', '页面', '功能', '检查', '验证', '一下', '整个',
  'test', 'check', 'flow', 'page', 'the', 'and',
]);

export function extractGoalTerms(goal: string): string[] {
  const terms = new Set<string>();
  const lower = goal.toLowerCase();
  for (const word of lower.match(/[a-z][a-z0-9-]{2,}/g) ?? []) {
    if (!TASK_NOISE_WORDS.has(word)) terms.add(word);
  }
  const cjk = lower.match(/[一-鿿]+/g) ?? [];
  for (const segment of cjk) {
    for (let i = 0; i + 2 <= segment.length; i++) {
      const bigram = segment.slice(i, i + 2);
      if (!TASK_NOISE_WORDS.has(bigram)) terms.add(bigram);
    }
  }
  return [...terms];
}

export function scoreByTerms(text: string, terms: string[]): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  return terms.reduce((score, term) => (lower.includes(term) ? score + 1 : score), 0);
}
