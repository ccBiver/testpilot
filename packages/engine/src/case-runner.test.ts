import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AiAgent, ExplorerTarget } from '@testpilot/executor';
import type { TestCaseSuite } from '@testpilot/shared';
import { CaseRunner } from './case-runner.js';

/** 假执行器:aiBoolean 结果由 answers 队列/映射控制,不碰真设备 */
function fakeTarget(boolFor: (q: string) => boolean, opts: { actionThrows?: string } = {}): ExplorerTarget {
  const agent: AiAgent = {
    aiAction: async (instruction) => {
      if (opts.actionThrows && instruction.includes(opts.actionThrows)) throw new Error('元素找不到');
    },
    aiBoolean: async (q) => boolFor(q),
  };
  return {
    launch: async () => {},
    isUnreachable: () => false,
    observe: async () => ({ pageUrl: 'x', pageTitle: 'x', interactables: [] }),
    location: async () => ({ url: 'x', title: 'x' }),
    screenshot: async () => {},
    drainSignals: () => [],
    createAgent: async () => agent,
    dispose: async () => {},
  };
}

const suite = (cases: TestCaseSuite['cases']): TestCaseSuite => ({
  target: 'https://x.com/',
  platform: 'web',
  cases,
});

async function outDir() {
  return mkdtemp(path.join(os.tmpdir(), 'testpilot-cases-'));
}

describe('CaseRunner', () => {
  it('全部断言满足 → 用例 passed', async () => {
    const dir = await outDir();
    const runner = new CaseRunner(fakeTarget(() => true), suite([
      { id: 'c1', name: '登录成功', steps: [{ action: '输入账号' }, { action: '点击登录', expect: '进入首页' }] },
    ]), { outDir: dir });
    const report = await runner.run();
    expect(report.passed).toBe(1);
    expect(report.results[0]!.status).toBe('passed');
    expect(report.results[0]!.steps.every((s) => s.status === 'pass')).toBe(true);
  });

  it('断言不满足 → 用例 failed 且后续步骤不再执行', async () => {
    const dir = await outDir();
    const runner = new CaseRunner(fakeTarget((q) => q !== '进入首页'), suite([
      {
        id: 'c1',
        name: '登录',
        steps: [
          { action: '点击登录', expect: '进入首页' },
          { action: '点击设置', expect: '打开设置页' },
        ],
      },
    ]), { outDir: dir });
    const report = await runner.run();
    expect(report.failed).toBe(1);
    expect(report.results[0]!.steps).toHaveLength(1); // 第一步失败即停
    expect(report.results[0]!.steps[0]!.status).toBe('fail');
  });

  it('操作抛错 → 该步 fail、用例 failed', async () => {
    const dir = await outDir();
    const runner = new CaseRunner(fakeTarget(() => true, { actionThrows: '不存在的按钮' }), suite([
      { id: 'c1', name: '异常步骤', steps: [{ action: '点击不存在的按钮', expect: '出现弹窗' }] },
    ]), { outDir: dir });
    const report = await runner.run();
    expect(report.results[0]!.status).toBe('failed');
    expect(report.results[0]!.steps[0]!.detail).toContain('执行出错');
  });

  it('危险操作被护栏拦截 → 该步 blocked', async () => {
    const dir = await outDir();
    const runner = new CaseRunner(fakeTarget(() => true), suite([
      { id: 'c1', name: '误删', steps: [{ action: '点击删除账号按钮', expect: '账号已删除' }] },
    ]), { outDir: dir });
    const report = await runner.run();
    expect(report.blocked).toBe(1);
    expect(report.results[0]!.steps[0]!.status).toBe('blocked');
    expect(report.results[0]!.steps[0]!.detail).toContain('护栏');
  });

  it('aiStep agent:记录通过步骤的轨迹到 runner.traces', async () => {
    const dir = await outDir();
    const agent: AiAgent = {
      aiAction: async () => {},
      aiBoolean: async () => true,
      aiStep: async () => ({ ok: true, trace: [{ kind: 'tap', x: 1, y: 2 }] }),
    };
    const target = { ...fakeTarget(() => true), createAgent: async () => agent };
    const runner = new CaseRunner(target, suite([
      { id: 'c1', name: '录制', steps: [{ action: '点A' }, { action: '点B', expect: '到位' }] },
    ]), { outDir: dir });
    const report = await runner.run();
    expect(report.passed).toBe(1);
    expect(runner.traces['c1']).toHaveLength(2);
    expect(runner.traces['c1']![0]).toEqual({ action: '点A', performed: [{ kind: 'tap', x: 1, y: 2 }] });
  });

  it('有轨迹且断言过 → 走 replay,不调 aiStep', async () => {
    const dir = await outDir();
    const called: string[] = [];
    const agent: AiAgent = {
      aiAction: async () => {},
      aiBoolean: async () => {
        called.push('aiBoolean');
        return true;
      },
      aiStep: async () => {
        called.push('aiStep');
        return { ok: true, trace: [] };
      },
      replay: async () => {
        called.push('replay');
      },
    };
    const target = { ...fakeTarget(() => true), createAgent: async () => agent };
    const runner = new CaseRunner(target, suite([
      { id: 'c1', name: '回放', steps: [{ action: '点A', expect: '到位' }] },
    ]), {
      outDir: dir,
      traces: { c1: [{ action: '点A', performed: [{ kind: 'tap', x: 1, y: 2 }] }] },
    });
    const report = await runner.run();
    expect(report.passed).toBe(1);
    expect(called).toEqual(['replay', 'aiBoolean']); // 没有 aiStep
  });

  it('回放后断言不过 → 自愈:降级 aiStep 重新执行并更新轨迹', async () => {
    const dir = await outDir();
    const called: string[] = [];
    const agent: AiAgent = {
      aiAction: async () => {},
      aiBoolean: async () => {
        called.push('aiBoolean');
        return false; // 回放后断言失败
      },
      aiStep: async () => {
        called.push('aiStep');
        return { ok: true, trace: [{ kind: 'tap', x: 9, y: 9 }] };
      },
      replay: async () => {
        called.push('replay');
      },
    };
    const target = { ...fakeTarget(() => true), createAgent: async () => agent };
    const runner = new CaseRunner(target, suite([
      { id: 'c1', name: '自愈', steps: [{ action: '点A', expect: '到位' }] },
    ]), {
      outDir: dir,
      traces: { c1: [{ action: '点A', performed: [{ kind: 'tap', x: 1, y: 2 }] }] },
    });
    const report = await runner.run();
    expect(report.passed).toBe(1);
    expect(called).toEqual(['replay', 'aiBoolean', 'aiStep']);
    // 轨迹更新为新路径
    expect(runner.traces['c1']![0]!.performed).toEqual([{ kind: 'tap', x: 9, y: 9 }]);
  });

  it('步骤文本改了 → 轨迹失效,直接 aiStep', async () => {
    const dir = await outDir();
    const called: string[] = [];
    const agent: AiAgent = {
      aiAction: async () => {},
      aiBoolean: async () => true,
      aiStep: async () => {
        called.push('aiStep');
        return { ok: true, trace: [] };
      },
      replay: async () => {
        called.push('replay');
      },
    };
    const target = { ...fakeTarget(() => true), createAgent: async () => agent };
    const runner = new CaseRunner(target, suite([
      { id: 'c1', name: '改文本', steps: [{ action: '点击新按钮' }] },
    ]), {
      outDir: dir,
      traces: { c1: [{ action: '点击旧按钮', performed: [{ kind: 'tap', x: 1, y: 2 }] }] },
    });
    await runner.run();
    expect(called).toEqual(['aiStep']); // 未回放
  });

  it('汇总多用例 + 落盘 cases.json', async () => {
    const dir = await outDir();
    const runner = new CaseRunner(fakeTarget((q) => q === '通过'), suite([
      { id: 'a', name: '过', steps: [{ action: 'x', expect: '通过' }] },
      { id: 'b', name: '挂', steps: [{ action: 'y', expect: '不通过' }] },
    ]), { outDir: dir });
    const report = await runner.run();
    expect(report.total).toBe(2);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(1);
    const persisted = JSON.parse(await readFile(path.join(dir, 'cases.json'), 'utf8'));
    expect(persisted.results).toHaveLength(2);
  });
});
