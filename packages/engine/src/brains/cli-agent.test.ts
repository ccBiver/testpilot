import { describe, expect, it, vi } from 'vitest';
import type { WebExecutor } from '@testpilot/executor';
import { CliWebAgent } from './cli-agent.js';

/** 最小 WebExecutor 假实现,记录被调用的操作 */
function fakeExecutor() {
  const calls: string[] = [];
  const executor = {
    observe: async () => ({
      pageUrl: 'https://x.com/',
      pageTitle: '首页',
      interactables: [
        { kind: 'link', text: '关于我们', url: 'https://x.com/about' },
        { kind: 'button', text: '提交', nth: 0 },
        { kind: 'input', label: '邮箱', inputType: 'email', nth: 0 },
      ],
    }),
    goto: async (url: string) => void calls.push(`goto:${url}`),
    clickButton: async (nth: number, text?: string) => void calls.push(`click:${nth}:${text}`),
    fillInput: async (nth: number, v: string) => void calls.push(`fill:${nth}:${v}`),
    screenshot: async () => {},
  } as unknown as WebExecutor;
  return { executor, calls };
}

describe('CliWebAgent', () => {
  it('aiAction:点击按钮 → 调用 clickButton', async () => {
    const { executor, calls } = fakeExecutor();
    const invoke = vi.fn(async () => '{"action":"click_button","index":1}');
    const agent = new CliWebAgent(executor, invoke);
    await agent.aiAction('点击提交按钮');
    expect(calls).toContain('click:0:提交');
  });

  it('aiAction:填输入框 → 调用 fillInput 带内容', async () => {
    const { executor, calls } = fakeExecutor();
    const invoke = vi.fn(async () => '{"action":"fill_input","index":2,"value":"tp@example.com"}');
    const agent = new CliWebAgent(executor, invoke);
    await agent.aiAction('在邮箱框输入邮箱');
    expect(calls).toContain('fill:0:tp@example.com');
  });

  it('aiAction:打开链接 → 调用 goto', async () => {
    const { executor, calls } = fakeExecutor();
    const invoke = vi.fn(async () => '好的,{"action":"open_link","index":0}');
    const agent = new CliWebAgent(executor, invoke);
    await agent.aiAction('进入关于页');
    expect(calls).toContain('goto:https://x.com/about');
  });

  it('aiAction:模型选了不存在的元素 → 抛错', async () => {
    const { executor } = fakeExecutor();
    const invoke = vi.fn(async () => '{"action":"click_button","index":9}');
    const agent = new CliWebAgent(executor, invoke);
    await expect(agent.aiAction('点某处')).rejects.toThrow(/不存在的元素/);
  });

  it('aiBoolean:识别 yes / no(容忍啰嗦输出)', async () => {
    const { executor } = fakeExecutor();
    expect(await new CliWebAgent(executor, async () => 'yes').aiBoolean('x')).toBe(true);
    expect(await new CliWebAgent(executor, async () => 'no').aiBoolean('x')).toBe(false);
    expect(
      await new CliWebAgent(executor, async () => '根据截图,该描述成立。答案:yes').aiBoolean('x'),
    ).toBe(true);
  });
});
