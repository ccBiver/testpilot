import type { ModelConfig } from '@testpilot/shared';

/**
 * 把 BYOK/平台模型配置注入 Midscene(overrideAIConfig)。
 * 无显式配置时依赖进程环境变量(本地 CLI 用法);两者都无 → 抛错提示。
 */
export function applyModelConfig(
  modelConfig: ModelConfig | undefined,
  override: (c: Record<string, string>) => void,
): void {
  if (modelConfig) {
    override({
      OPENAI_API_KEY: modelConfig.apiKey,
      OPENAI_BASE_URL: modelConfig.baseUrl,
      MIDSCENE_MODEL_NAME: modelConfig.modelName,
      ...(modelConfig.vlMode === 'qwen' ? { MIDSCENE_USE_QWEN_VL: '1' } : {}),
    });
    return;
  }
  if (!process.env.OPENAI_API_KEY && !process.env.MIDSCENE_MODEL_NAME) {
    throw new Error('AI 能力需要模型:设置 OPENAI_API_KEY/OPENAI_BASE_URL/MIDSCENE_MODEL_NAME 环境变量,或在配置里提供');
  }
}
