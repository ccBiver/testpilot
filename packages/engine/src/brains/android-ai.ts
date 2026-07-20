import type { ModelConfig } from '@testpilot/shared';
import { checkGuardrail, type AiAgent, type ExplorerTarget } from '@testpilot/executor';
import type { Brain, BrainContext, StepPlan } from './types.js';

/**
 * Android AI 大脑:视觉驱动,每步让多模态模型规划一个「像真实用户」的 App 操作。
 * agent 由执行器统一创建(含模型配置注入)。
 */
export class AndroidAiBrain implements Brain {
  readonly name = 'android-ai';
  private agent: AiAgent | null = null;
  private readonly actionHistory: string[] = [];

  constructor(
    private readonly executor: ExplorerTarget,
    private readonly modelConfig?: ModelConfig,
  ) {}

  async nextStep(obs: Parameters<Brain['nextStep']>[0], ctx: BrainContext): Promise<StepPlan | null> {
    if (!this.agent) this.agent = await this.executor.createAgent(this.modelConfig);
    const instruction = this.buildInstruction(obs.pageTitle, ctx);
    if (!checkGuardrail(instruction).allowed) return null;

    const agent = this.agent;
    return {
      description: `AI 探索:${instruction}`,
      execute: async () => {
        await agent.aiAction(instruction);
        this.actionHistory.push(instruction);
      },
    };
  }

  private buildInstruction(pkg: string, ctx: BrainContext): string {
    const goalPart = ctx.goal ? `本次测试目标:${ctx.goal}。` : '';
    const historyPart =
      this.actionHistory.length > 0
        ? `你已经做过:${this.actionHistory.slice(-5).join(';')}。不要重复。`
        : '';
    return (
      `${goalPart}你是一名正在探索测试 Android 应用「${pkg}」的真实用户` +
      `(第 ${ctx.stepSeq}/${ctx.stepBudget} 步)。${historyPart}` +
      `请执行一个此前没做过、最有价值的单步操作(点击、输入、滑动或返回),` +
      `优先走完核心业务流程。严禁支付、删除、发送等不可逆操作。`
    );
  }
}
