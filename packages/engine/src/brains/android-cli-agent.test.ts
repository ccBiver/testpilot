import { describe, expect, it } from 'vitest';
import type { AndroidExecutor } from '@testpilot/executor';
import { AndroidCliAgent } from './android-cli-agent.js';

/** 记录执行器被调用的动作,不碰真设备 */
function fakeExecutor() {
  const calls: string[] = [];
  const executor = {
    screenSize: async () => ({ width: 1080, height: 2400 }),
    screenshot: async () => {},
    tap: async (x: number, y: number) => void calls.push(`tap:${x},${y}`),
    typeText: async (t: string) => void calls.push(`type:${t}`),
    back: async () => void calls.push('back'),
    swipe: async (x1: number, y1: number, x2: number, y2: number) =>
      void calls.push(`swipe:${x1},${y1}->${x2},${y2}`),
  } as unknown as AndroidExecutor;
  return { executor, calls };
}

/** 按序返回输出的假 invoker(超出后停在最后一个) */
const invokerOf = (...outputs: string[]) => {
  let i = 0;
  return async () => outputs[Math.min(i++, outputs.length - 1)] ?? '';
};

const DONE = '{"action":"done","reason":"已达成"}';

describe('AndroidCliAgent(目标驱动循环,对 Flutter 有效)', () => {
  it('tap→done:按坐标点一次后结束', async () => {
    const { executor, calls } = fakeExecutor();
    const agent = new AndroidCliAgent(executor, invokerOf('{"action":"tap","x":540,"y":990}', DONE), 0);
    await agent.aiAction('点击注册按钮');
    expect(calls).toEqual(['tap:540,990']);
  });

  it('多轮:一步内连续多个动作直到 done(进页→开菜单→点目标)', async () => {
    const { executor, calls } = fakeExecutor();
    const agent = new AndroidCliAgent(
      executor,
      invokerOf(
        '{"action":"tap","x":256,"y":1811}',
        '{"action":"tap","x":1000,"y":180}',
        '{"action":"tap","x":540,"y":700}',
        DONE,
      ),
      0,
    );
    await agent.aiAction('打开合约计算器入口');
    expect(calls).toEqual(['tap:256,1811', 'tap:1000,180', 'tap:540,700']);
  });

  it('首轮即 done:目标已达成则不做任何动作', async () => {
    const { executor, calls } = fakeExecutor();
    const agent = new AndroidCliAgent(executor, invokerOf(DONE), 0);
    await agent.aiAction('确认在首页');
    expect(calls).toEqual([]);
  });

  it('预算用完不抛错(交给 expect 断言),动作数不超上限', async () => {
    const { executor, calls } = fakeExecutor();
    // 永远给 tap、从不 done → 应在上限处停下且不抛
    const agent = new AndroidCliAgent(executor, invokerOf('{"action":"tap","x":1,"y":2}'), 0);
    await agent.aiAction('永远达不成的目标');
    expect(calls.length).toBeLessThanOrEqual(6);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('input:先点坐标再输入', async () => {
    const { executor, calls } = fakeExecutor();
    const agent = new AndroidCliAgent(
      executor,
      invokerOf('{"action":"input","x":300,"y":600,"value":"tp@x.com"}', DONE),
      0,
    );
    await agent.aiAction('在邮箱框输入');
    expect(calls).toEqual(['tap:300,600', 'type:tp@x.com']);
  });

  it('back 与 swipe 也能作为循环中的动作', async () => {
    const { executor, calls } = fakeExecutor();
    const agent = new AndroidCliAgent(
      executor,
      invokerOf('{"action":"swipe","direction":"up"}', '{"action":"back"}', DONE),
      0,
    );
    await agent.aiAction('翻页后返回');
    expect(calls.some((c) => c.startsWith('swipe:'))).toBe(true);
    expect(calls).toContain('back');
  });

  it('同屏打包:一次输出多个动作按序执行(填表单场景)', async () => {
    const { executor, calls } = fakeExecutor();
    const agent = new AndroidCliAgent(
      executor,
      invokerOf(
        '{"actions":[{"action":"input","x":300,"y":600,"value":"100"},{"action":"input","x":300,"y":800,"value":"120"}]}',
        DONE,
      ),
      0,
    );
    await agent.aiAction('填写开仓价 100 和平仓价 120');
    expect(calls).toEqual(['tap:300,600', 'type:100', 'tap:300,800', 'type:120']);
  });

  it('aiStep:done 同时带 expect_ok,一次调用完成执行+断言', async () => {
    const { executor } = fakeExecutor();
    const pass = new AndroidCliAgent(
      executor,
      invokerOf('{"action":"tap","x":10,"y":20}', '{"action":"done","expect_ok":true,"reason":"已进入"}'),
      0,
    );
    expect(await pass.aiStep('打开页面', '页面已打开')).toEqual({ ok: true });

    const fail = new AndroidCliAgent(
      executor,
      invokerOf('{"action":"done","expect_ok":false,"reason":"没找到"}'),
      0,
    );
    expect(await fail.aiStep('打开页面', '页面已打开')).toEqual({ ok: false });
  });

  it('aiStep 无 expect:done 即 ok', async () => {
    const { executor } = fakeExecutor();
    const agent = new AndroidCliAgent(executor, invokerOf(DONE), 0);
    expect(await agent.aiStep('随便看看')).toEqual({ ok: true });
  });

  it('aiStep 预算用完且有 expect → 落到独立 aiBoolean 兜底', async () => {
    const { executor } = fakeExecutor();
    // 前 6 轮都给 tap(耗尽预算),兜底的 aiBoolean 收到最后一个输出 no
    const agent = new AndroidCliAgent(executor, invokerOf(
      ...Array.from({ length: 6 }, () => '{"action":"tap","x":1,"y":2}'),
      'no',
    ), 0);
    expect(await agent.aiStep('永远达不成', '不可能的预期')).toEqual({ ok: false });
  });

  it('打包里混入 done → 截断到 done,不执行其后的动作', async () => {
    const { executor, calls } = fakeExecutor();
    const agent = new AndroidCliAgent(
      executor,
      invokerOf(
        '{"actions":[{"action":"tap","x":1,"y":2},{"action":"done"},{"action":"tap","x":9,"y":9}]}',
      ),
      0,
    );
    await agent.aiAction('目标');
    expect(calls).toEqual(['tap:1,2']);
  });

  it('tap 缺坐标 → 抛错', async () => {
    const { executor } = fakeExecutor();
    const agent = new AndroidCliAgent(executor, invokerOf('{"action":"tap"}'), 0);
    await expect(agent.aiAction('点某处')).rejects.toThrow(/坐标/);
  });

  it('aiBoolean 解析 yes/no', async () => {
    const { executor } = fakeExecutor();
    expect(await new AndroidCliAgent(executor, async () => 'yes', 0).aiBoolean('x')).toBe(true);
    expect(await new AndroidCliAgent(executor, async () => '答案:no', 0).aiBoolean('x')).toBe(false);
  });
});
