import { describe, expect, it, vi } from 'vitest';
import { generateCasesFromDoc, parseCases } from './case-gen.js';

describe('parseCases', () => {
  it('解析纯 JSON 数组', () => {
    const cases = parseCases('[{"name":"登录","steps":[{"action":"点登录","expect":"进入首页"}]}]');
    expect(cases).toHaveLength(1);
    expect(cases[0]!.name).toBe('登录');
    expect(cases[0]!.steps[0]!.expect).toBe('进入首页');
  });

  it('容忍 markdown 代码块与前后缀文字', () => {
    const raw = '好的,以下是用例:\n```json\n[{"name":"注册","steps":[{"action":"填邮箱"}]}]\n```\n完成';
    const cases = parseCases(raw);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.steps[0]!.expect).toBeUndefined(); // 无 expect 字段
  });

  it('丢弃缺少 action 的步骤和无步骤的用例', () => {
    const raw = '[{"name":"空","steps":[{"expect":"x"}]},{"name":"好","steps":[{"action":"点"}]}]';
    const cases = parseCases(raw);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.name).toBe('好');
  });

  it('非数组/坏输出 → 空', () => {
    expect(parseCases('抱歉我不知道')).toHaveLength(0);
    expect(parseCases('{"name":"x"}')).toHaveLength(0);
  });
});

describe('generateCasesFromDoc', () => {
  it('生成用例并补 id/source,截断到 maxCases', async () => {
    const invoke = vi.fn(async () =>
      JSON.stringify([
        { name: 'A', steps: [{ action: 'a1', expect: 'e1' }] },
        { name: 'B', steps: [{ action: 'b1' }] },
        { name: 'C', steps: [{ action: 'c1' }] },
      ]),
    );
    const suite = await generateCasesFromDoc(
      { doc: '需求...', maxCases: 2 },
      invoke,
    );
    // 生成阶段不绑定目标/平台(执行时再定)
    expect(suite.target).toBeUndefined();
    expect(suite.cases).toHaveLength(2);
    expect(suite.cases[0]!.id).toBe('case-1');
    expect(suite.cases[0]!.source).toBe('doc');
  });

  it('模型输出不可解析 → 抛错', async () => {
    const invoke = vi.fn(async () => '我无法生成');
    await expect(generateCasesFromDoc({ doc: 'x' }, invoke)).rejects.toThrow(/无法解析/);
  });

  it('prompt 含来源侧重与正文', async () => {
    const invoke = vi.fn(async (_prompt: string) => '[{"name":"x","steps":[{"action":"y"}]}]');
    await generateCasesFromDoc({ doc: 'DOC', focus: '重点测支付' }, invoke);
    const prompt = invoke.mock.calls[0]?.[0] ?? '';
    expect(prompt).toContain('重点测支付');
    expect(prompt).toContain('DOC');
  });

  it('给了起始状态 → prompt 注入前置状态并要求跳过登录', async () => {
    const invoke = vi.fn(async (_prompt: string) => '[{"name":"x","steps":[{"action":"y"}]}]');
    await generateCasesFromDoc({ doc: 'DOC', precondition: '应用已登录,停在主界面' }, invoke);
    const prompt = invoke.mock.calls[0]?.[0] ?? '';
    expect(prompt).toContain('应用已登录,停在主界面');
    expect(prompt).toContain('起始状态');
    expect(prompt).toContain('跳过');
  });

  it('无起始状态 → prompt 不含前置状态小节', async () => {
    const invoke = vi.fn(async (_prompt: string) => '[{"name":"x","steps":[{"action":"y"}]}]');
    await generateCasesFromDoc({ doc: 'DOC' }, invoke);
    const prompt = invoke.mock.calls[0]?.[0] ?? '';
    expect(prompt).not.toContain('起始状态');
  });
});
