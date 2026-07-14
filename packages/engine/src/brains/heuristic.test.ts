import { describe, expect, it } from 'vitest';
import type { Observation, WebExecutor } from '@testpilot/executor';
import { extractGoalTerms, HeuristicBrain, scoreByTerms } from './heuristic.js';

/** nextStep 不触碰 executor,只有 execute() 才会;测决策逻辑用桩即可 */
const stubExecutor = {
  goto: async () => {},
  clickButton: async () => {},
} as unknown as WebExecutor;

const CTX = { stepSeq: 2, stepBudget: 10 };

const obs = (interactables: Observation['interactables']): Observation => ({
  pageUrl: 'https://www.shop.com/',
  pageTitle: '首页',
  interactables,
});

describe('extractGoalTerms', () => {
  it('中文取双字并剔除任务用词,英文按词切', () => {
    const terms = extractGoalTerms('测试注册流程 signup');
    expect(terms).toContain('注册');
    expect(terms).toContain('signup');
    expect(terms).not.toContain('测试');
    expect(terms).not.toContain('流程');
  });
});

describe('scoreByTerms', () => {
  it('命中越多分越高,大小写不敏感', () => {
    const terms = extractGoalTerms('测试注册流程');
    expect(scoreByTerms('立即注册', terms)).toBeGreaterThan(0);
    expect(scoreByTerms('关于我们', terms)).toBe(0);
  });
});

describe('HeuristicBrain 目标偏好', () => {
  it('有目标时,文案相关的元素优先于普通未访问链接', async () => {
    const brain = new HeuristicBrain(stubExecutor, 'https://www.shop.com/', '测试注册流程');
    const plan = await brain.nextStep(
      obs([
        { kind: 'link', text: '关于我们', url: 'https://www.shop.com/about' },
        { kind: 'link', text: '免费注册', url: 'https://account.shop.com/register' },
        { kind: 'button', text: '搜索', nth: 0 },
      ]),
      CTX,
    );
    expect(plan?.description).toContain('免费注册');
    expect(plan?.description).toContain('目标相关');
  });

  it('目标相关按钮同样优先', async () => {
    const brain = new HeuristicBrain(stubExecutor, 'https://www.shop.com/', '注册');
    const plan = await brain.nextStep(
      obs([
        { kind: 'link', text: '行情', url: 'https://www.shop.com/market' },
        { kind: 'button', text: '注册领福利', nth: 3 },
      ]),
      CTX,
    );
    expect(plan?.description).toContain('注册领福利');
  });

  it('无目标时退回 BFS:第一个未访问链接', async () => {
    const brain = new HeuristicBrain(stubExecutor, 'https://www.shop.com/');
    const plan = await brain.nextStep(
      obs([
        { kind: 'link', text: '关于我们', url: 'https://www.shop.com/about' },
        { kind: 'button', text: '注册', nth: 0 },
      ]),
      CTX,
    );
    expect(plan?.description).toContain('关于我们');
  });

  it('目标相关但命中护栏敏感词的元素仍被拦截', async () => {
    const brain = new HeuristicBrain(stubExecutor, 'https://www.shop.com/', '测试提现');
    const plan = await brain.nextStep(
      obs([
        { kind: 'button', text: '立即提现', nth: 0 },
        { kind: 'link', text: '帮助中心', url: 'https://www.shop.com/help' },
      ]),
      CTX,
    );
    expect(plan?.description).toContain('帮助中心');
    expect(brain.guardrailSkipped.some((s) => s.includes('提现'))).toBe(true);
  });

  it('同一目标元素不会被重复选择', async () => {
    const brain = new HeuristicBrain(stubExecutor, 'https://www.shop.com/', '注册');
    const view = obs([{ kind: 'button', text: '注册', nth: 0 }]);
    const first = await brain.nextStep(view, CTX);
    expect(first?.description).toContain('注册');
    const second = await brain.nextStep(view, CTX);
    expect(second).toBeNull();
  });

  it('连续「返回起始页」不超过 2 次,防止在错误页上死循环烧预算', async () => {
    const brain = new HeuristicBrain(stubExecutor, 'https://www.shop.com/');
    const errorPage: Observation = {
      pageUrl: 'chrome-error://chromewebdata/',
      pageTitle: '',
      interactables: [],
    };
    expect((await brain.nextStep(errorPage, CTX))?.description).toContain('返回起始页');
    expect((await brain.nextStep(errorPage, CTX))?.description).toContain('返回起始页');
    expect(await brain.nextStep(errorPage, CTX)).toBeNull();
  });

  it('返回起始页后找到新目标,计数复位', async () => {
    const brain = new HeuristicBrain(stubExecutor, 'https://www.shop.com/');
    const errorPage: Observation = { pageUrl: 'chrome-error://x/', pageTitle: '', interactables: [] };
    await brain.nextStep(errorPage, CTX); // 返回 1 次
    const found = await brain.nextStep(
      obs([{ kind: 'link', text: '帮助', url: 'https://www.shop.com/help' }]),
      CTX,
    );
    expect(found?.description).toContain('帮助');
    // 复位后又可以再返回 2 次
    expect((await brain.nextStep(errorPage, CTX))?.description).toContain('返回起始页');
  });
});
