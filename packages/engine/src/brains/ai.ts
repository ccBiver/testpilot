import type { ModelConfig } from '@testpilot/shared';
import { checkGuardrail, type WebExecutor } from '@testpilot/executor';
import type { Brain, BrainContext, StepPlan } from './types.js';

/**
 * AI 大脑:基于 Midscene 视觉驱动探索。
 * 模型来源二选一:显式传入 ModelConfig(平台 BYOK,按用户注入),
 * 或进程环境变量(CLI 本地用法,见 .env.example)。
 */
export class AiBrain implements Brain {
  readonly name = 'ai';
  private agent: MidsceneAgent | null = null;
  private readonly actionHistory: string[] = [];

  constructor(
    private readonly executor: WebExecutor,
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

  private async ensureAgent(): Promise<MidsceneAgent> {
    if (this.agent) return this.agent;
    if (!this.modelConfig && !process.env.OPENAI_API_KEY && !process.env.MIDSCENE_MODEL_NAME) {
      throw new Error('AI 模式需要配置模型:平台端在「设置」里填写模型 Key,CLI 则配置环境变量');
    }
    const mod = (await import('@midscene/web/playwright')) as unknown as MidsceneModule;
    if (this.modelConfig) {
      mod.overrideAIConfig({
        OPENAI_API_KEY: this.modelConfig.apiKey,
        OPENAI_BASE_URL: this.modelConfig.baseUrl,
        MIDSCENE_MODEL_NAME: this.modelConfig.modelName,
        ...(this.modelConfig.vlMode === 'qwen' ? { MIDSCENE_USE_QWEN_VL: '1' } : {}),
      });
    }
    this.agent = new mod.PlaywrightAgent(this.executor.page);
    return this.agent;
  }
}

interface MidsceneModule {
  PlaywrightAgent: new (page: unknown) => MidsceneAgent;
  overrideAIConfig: (config: Record<string, string>) => void;
}

interface MidsceneAgent {
  aiAction(instruction: string): Promise<unknown>;
}
