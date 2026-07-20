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
      { doc: '需求...', target: 'https://x.com/', platform: 'web', maxCases: 2 },
      invoke,
    );
    expect(suite.target).toBe('https://x.com/');
    expect(suite.cases).toHaveLength(2);
    expect(suite.cases[0]!.id).toBe('case-1');
    expect(suite.cases[0]!.source).toBe('doc');
  });

  it('模型输出不可解析 → 抛错', async () => {
    const invoke = vi.fn(async () => '我无法生成');
    await expect(
      generateCasesFromDoc({ doc: 'x', target: 'x', platform: 'web' }, invoke),
    ).rejects.toThrow(/无法解析/);
  });

  it('prompt 含平台提示与侧重', async () => {
    const invoke = vi.fn(async (_prompt: string) => '[{"name":"x","steps":[{"action":"y"}]}]');
    await generateCasesFromDoc(
      { doc: 'DOC', target: 'com.app', platform: 'android', focus: '重点测支付' },
      invoke,
    );
    const prompt = invoke.mock.calls[0]?.[0] ?? '';
    expect(prompt).toContain('Android');
    expect(prompt).toContain('重点测支付');
    expect(prompt).toContain('DOC');
  });
});
