import { describe, expect, it, vi } from 'vitest';
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

describe('AndroidCliAgent(坐标式,对 Flutter 有效)', () => {
  it('tap:claude 给坐标 → adb 按坐标点', async () => {
    const { executor, calls } = fakeExecutor();
    const agent = new AndroidCliAgent(executor, async () => '{"action":"tap","x":540,"y":990}');
    await agent.aiAction('点击注册按钮');
    expect(calls).toContain('tap:540,990');
  });

  it('input:先点坐标再输入', async () => {
    const { executor, calls } = fakeExecutor();
    const agent = new AndroidCliAgent(executor, async () => '{"action":"input","x":300,"y":600,"value":"tp@x.com"}');
    await agent.aiAction('在邮箱框输入');
    expect(calls).toContain('tap:300,600');
    expect(calls).toContain('type:tp@x.com');
  });

  it('back:返回上一屏', async () => {
    const { executor, calls } = fakeExecutor();
    const agent = new AndroidCliAgent(executor, async () => '{"action":"back"}');
    await agent.aiAction('返回');
    expect(calls).toContain('back');
  });

  it('swipe:按方向从屏幕中心滑动', async () => {
    const { executor, calls } = fakeExecutor();
    const agent = new AndroidCliAgent(executor, async () => '{"action":"swipe","direction":"up"}');
    await agent.aiAction('向下翻页');
    expect(calls.some((c) => c.startsWith('swipe:'))).toBe(true);
  });

  it('tap 缺坐标 → 抛错', async () => {
    const { executor } = fakeExecutor();
    const agent = new AndroidCliAgent(executor, async () => '{"action":"tap"}');
    await expect(agent.aiAction('点某处')).rejects.toThrow(/坐标/);
  });

  it('aiBoolean 解析 yes/no', async () => {
    const { executor } = fakeExecutor();
    expect(await new AndroidCliAgent(executor, async () => 'yes').aiBoolean('x')).toBe(true);
    expect(await new AndroidCliAgent(executor, async () => '答案:no').aiBoolean('x')).toBe(false);
  });
});
