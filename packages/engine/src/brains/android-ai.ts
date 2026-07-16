import type { ModelConfig } from '@testpilot/shared';
import { checkGuardrail, type AndroidExecutor } from '@testpilot/executor';
import type { Brain, BrainContext, StepPlan } from './types.js';

interface AndroidAgentLike {
  aiAction(instruction: string): Promise<unknown>;
}

/**
 * Android AI 大脑:视觉驱动,每步让多模态模型规划一个「像真实用户」的 App 操作。
 * 复用 AndroidExecutor 已连接的 Midscene AndroidAgent;模型配置经 overrideAIConfig 注入。
 */
export class AndroidAiBrain implements Brain {
  readonly name = 'android-ai';
  private readonly actionHistory: string[] = [];
  private configured = false;

  constructor(
    private readonly executor: AndroidExecutor,
    private readonly modelConfig?: ModelConfig,
  ) {}

  async nextStep(obs: Parameters<Brain['nextStep']>[0], ctx: BrainContext): Promise<StepPlan | null> {
    await this.ensureModelConfig();
    const instruction = this.buildInstruction(obs.pageTitle, ctx);
    if (!checkGuardrail(instruction).allowed) return null;

    const agent = this.executor.agent as AndroidAgentLike;
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

  private async ensureModelConfig(): Promise<void> {
    if (this.configured) return;
    this.configured = true;
    if (!this.modelConfig) {
      if (!process.env.OPENAI_API_KEY && !process.env.MIDSCENE_MODEL_NAME) {
        throw new Error('Android AI 探索需要配置多模态模型:平台后台配置,或 CLI 设环境变量');
      }
      return;
    }
    const mod = (await import('@midscene/android')) as unknown as {
      overrideAIConfig: (c: Record<string, string>) => void;
    };
    mod.overrideAIConfig({
      OPENAI_API_KEY: this.modelConfig.apiKey,
      OPENAI_BASE_URL: this.modelConfig.baseUrl,
      MIDSCENE_MODEL_NAME: this.modelConfig.modelName,
      ...(this.modelConfig.vlMode === 'qwen' ? { MIDSCENE_USE_QWEN_VL: '1' } : {}),
    });
  }
}
