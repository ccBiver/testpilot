import type { ModelConfig } from '@testpilot/shared';
import { checkGuardrail, type AiAgent, type ExplorerTarget } from '@testpilot/executor';
import type { Brain, BrainContext, StepPlan } from './types.js';

/**
 * AI 大脑:基于 Midscene 视觉驱动探索。agent 由执行器统一创建(Web/Android 通用),
 * 模型来源为显式 ModelConfig 或进程环境变量。
 */
export class AiBrain implements Brain {
  readonly name = 'ai';
  private agent: AiAgent | null = null;
  private readonly actionHistory: string[] = [];

  constructor(
    private readonly executor: ExplorerTarget,
    private readonly modelConfig?: ModelConfig,
  ) {}

  async nextStep(obs: Parameters<Brain['nextStep']>[0], ctx: BrainContext): Promise<StepPlan | null> {
    const agent = await this.ensureAgent();
    const instruction = this.buildInstruction(obs.pageTitle, ctx);

    const verdict = checkGuardrail(instruction);
    if (!verdict.allowed) return null;

    return {
      description: `AI 探索:${instruction}`,
      execute: async () => {
        await agent.aiAction(instruction);
        this.actionHistory.push(instruction);
      },
    };
  }

  private buildInstruction(pageTitle: string, ctx: BrainContext): string {
    const goalPart = ctx.goal ? `本次测试目标:${ctx.goal}。` : '';
    const historyPart =
      this.actionHistory.length > 0
        ? `你已经做过:${this.actionHistory.slice(-5).join(';')}。不要重复。`
        : '';
    return (
      `${goalPart}你是一名正在探索测试网站的真实用户,当前在「${pageTitle}」页面` +
      `(第 ${ctx.stepSeq}/${ctx.stepBudget} 步)。${historyPart}` +
      `请执行一个此前没做过、最有价值的单步操作(点击、输入或滚动),` +
      `优先走完核心业务流程。严禁支付、删除、发送等不可逆操作。`
    );
  }

  private async ensureAgent(): Promise<AiAgent> {
    if (!this.agent) this.agent = await this.executor.createAgent(this.modelConfig);
    return this.agent;
  }
}
