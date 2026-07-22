import { describe, expect, it, vi } from 'vitest';
import type { Observation, WebExecutor } from '@testpilot/executor';
import { CliBrain, parseCliEnvelope, parseDecision, type CliInvoker } from './cli.js';

const CTX = { stepSeq: 2, stepBudget: 10, goal: '测试注册流程', lastScreenshot: '/tmp/s.png' };

const OBS: Observation = {
  pageUrl: 'https://shop.com/register',
  pageTitle: '注册',
  interactables: [
    { kind: 'link', text: '返回首页', url: 'https://shop.com/' },
    { kind: 'input', label: '邮箱', inputType: 'email', nth: 0 },
    { kind: 'input', label: '密码', inputType: 'password', nth: 1 },
    { kind: 'button', text: '注册', nth: 0 },
    { kind: 'button', text: '删除账号', nth: 1 },
  ],
};

function makeExecutor() {
  return {
    goto: vi.fn(async () => {}),
    clickButton: vi.fn(async () => {}),
    fillInput: vi.fn(async () => {}),
  } as unknown as WebExecutor;
}

const invokerOf = (...outputs: string[]): CliInvoker => {
  let i = 0;
  return async () => outputs[Math.min(i++, outputs.length - 1)] ?? '';
};

describe('parseDecision', () => {
  it('解析纯 JSON 与带前后缀的输出', () => {
    expect(parseDecision('{"action":"stop","description":"完成"}')?.action).toBe('stop');
    const wrapped = parseDecision('好的,我的决定是:\n{"action":"fill_input","index":1,"value":"a@b.com","description":"填邮箱"}\n以上');
    expect(wrapped?.action).toBe('fill_input');
    expect(wrapped?.value).toBe('a@b.com');
  });

  it('非法输出返回 null', () => {
    expect(parseDecision('我不知道该做什么')).toBeNull();
    expect(parseDecision('{"action":"dance","description":"x"}')).toBeNull();
    expect(parseDecision('{broken json')).toBeNull();
  });
});

describe('parseCliEnvelope', () => {
  it('解析 json 信封,取 result 与 session_id', () => {
    const out = parseCliEnvelope(
      '{"type":"result","is_error":false,"result":"{\\"action\\":\\"tap\\"}","session_id":"abc-123"}',
    );
    expect(out.text).toBe('{"action":"tap"}');
    expect(out.sessionId).toBe('abc-123');
  });

  it('is_error=true → 抛错并带模型信息', () => {
    expect(() => parseCliEnvelope('{"result":"配额已用尽","is_error":true}')).toThrow(/配额已用尽/);
  });

  it('非 JSON(旧版纯文本)→ 原样返回,无 session', () => {
    const out = parseCliEnvelope('{"action":"tap","x":1,"y":2}\n');
    // 能被 JSON.parse 但没有 result 字段 → 走兜底原样返回
    expect(out.text).toContain('"action":"tap"');
    expect(out.sessionId).toBeUndefined();
    expect(parseCliEnvelope('纯文本输出').text).toBe('纯文本输出');
  });
});

describe('CliBrain', () => {
  it('fill_input 决策 → 调用 executor.fillInput', async () => {
    const executor = makeExecutor();
    const brain = new CliBrain(
      executor,
      invokerOf('{"action":"fill_input","index":1,"value":"tp-test@example.com","description":"填写邮箱"}'),
    );
    const plan = await brain.nextStep(OBS, CTX);
    expect(plan?.description).toContain('填写邮箱');
    await plan!.execute();
    expect(executor.fillInput).toHaveBeenCalledWith(0, 'tp-test@example.com');
  });

  it('click_button 决策 → 点击对应按钮', async () => {
    const executor = makeExecutor();
    const brain = new CliBrain(
      executor,
      invokerOf('{"action":"click_button","index":3,"value":null,"description":"点击注册按钮"}'),
    );
    const plan = await brain.nextStep(OBS, CTX);
    await plan!.execute();
    expect(executor.clickButton).toHaveBeenCalledWith(0, '注册');
  });

  it('stop 决策 → 返回 null 结束探索', async () => {
    const brain = new CliBrain(makeExecutor(), invokerOf('{"action":"stop","description":"注册流程已走完"}'));
    expect(await brain.nextStep(OBS, CTX)).toBeNull();
  });

  it('输出不可解析 → 带反馈重试,第二次成功', async () => {
    const prompts: string[] = [];
    let call = 0;
    const invoker: CliInvoker = async (prompt) => {
      prompts.push(prompt);
      call += 1;
      return call === 1 ? '抱歉我不确定' : '{"action":"open_link","index":0,"description":"回首页"}';
    };
    const executor = makeExecutor();
    const plan = await new CliBrain(executor, invoker).nextStep(OBS, CTX);
    expect(plan).not.toBeNull();
    expect(prompts[1]).toContain('无法解析');
    await plan!.execute();
    expect(executor.goto).toHaveBeenCalledWith('https://shop.com/');
  });

  it('决策命中护栏(删除账号)→ 反馈后换安全操作', async () => {
    const prompts: string[] = [];
    let call = 0;
    const invoker: CliInvoker = async (prompt) => {
      prompts.push(prompt);
      call += 1;
      return call === 1
        ? '{"action":"click_button","index":4,"description":"点击删除账号"}'
        : '{"action":"click_button","index":3,"description":"点击注册"}';
    };
    const executor = makeExecutor();
    const plan = await new CliBrain(executor, invoker).nextStep(OBS, CTX);
    expect(prompts[1]).toContain('安全护栏');
    expect(plan?.description).toContain('注册');
  });

  it('连续 3 次拿不到可执行决策 → 结束', async () => {
    const brain = new CliBrain(makeExecutor(), invokerOf('胡言乱语'));
    expect(await brain.nextStep(OBS, CTX)).toBeNull();
  });

  it('index 越界 → 反馈重试', async () => {
    const prompts: string[] = [];
    let call = 0;
    const invoker: CliInvoker = async (prompt) => {
      prompts.push(prompt);
      call += 1;
      return call === 1
        ? '{"action":"click_button","index":99,"description":"点一个不存在的"}'
        : '{"action":"stop","description":"没有可做的"}';
    };
    expect(await new CliBrain(makeExecutor(), invoker).nextStep(OBS, CTX)).toBeNull();
    expect(prompts[1]).toContain('不存在');
  });

  it('提示词包含元素清单、截图路径与目标', async () => {
    let captured = '';
    const invoker: CliInvoker = async (prompt) => {
      captured = prompt;
      return '{"action":"stop","description":"x"}';
    };
    await new CliBrain(makeExecutor(), invoker).nextStep(OBS, CTX);
    expect(captured).toContain('测试注册流程');
    expect(captured).toContain('[1] 输入框「邮箱」');
    expect(captured).toContain('/tmp/s.png');
    expect(captured).toContain('严禁');
  });
});
