import type { PrismaClient } from '@prisma/client';
import type { ModelConfig } from '@testpilot/shared';
import { decryptSecret, encryptSecret } from '../settings/crypto.js';

/**
 * 平台级配置(SystemConfig 键值表):
 * - 模型配置由管理员统一维护,所有用户的 AI 探索共用平台模型(商业化:平台计量供给)
 * - 注册开关控制新用户注册
 */

const KEYS = {
  modelApiKey: 'model.apiKeyEnc',
  modelBaseUrl: 'model.baseUrl',
  modelName: 'model.modelName',
  modelVlMode: 'model.vlMode',
  registration: 'registration.enabled',
  defaultQuota: 'quota.defaultFreeRuns',
} as const;

const DEFAULT_FREE_RUNS = 10;

async function getValue(prisma: PrismaClient, key: string): Promise<string | null> {
  const row = await prisma.systemConfig.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function setValue(prisma: PrismaClient, key: string, value: string): Promise<void> {
  await prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/** 平台模型配置(解密后可直接供 AiBrain 使用);未配置返回 null */
export async function loadPlatformModelConfig(
  prisma: PrismaClient,
  serverSecret: string,
): Promise<ModelConfig | null> {
  const [apiKeyEnc, baseUrl, modelName, vlMode] = await Promise.all([
    getValue(prisma, KEYS.modelApiKey),
    getValue(prisma, KEYS.modelBaseUrl),
    getValue(prisma, KEYS.modelName),
    getValue(prisma, KEYS.modelVlMode),
  ]);
  if (!apiKeyEnc || !baseUrl || !modelName) return null;
  try {
    return {
      apiKey: decryptSecret(apiKeyEnc, serverSecret),
      baseUrl,
      modelName,
      vlMode: vlMode === 'qwen' ? 'qwen' : 'none',
    };
  } catch {
    return null; // 服务端密钥更换导致密文失效,等同未配置
  }
}

export interface PlatformModelInput {
  apiKey?: string;
  baseUrl: string;
  modelName: string;
  vlMode: 'none' | 'qwen';
}

/** 保存平台模型配置;更新时可不带 apiKey(沿用旧 Key) */
export async function savePlatformModelConfig(
  prisma: PrismaClient,
  serverSecret: string,
  input: PlatformModelInput,
): Promise<void> {
  if (input.apiKey) {
    await setValue(prisma, KEYS.modelApiKey, encryptSecret(input.apiKey, serverSecret));
  }
  await Promise.all([
    setValue(prisma, KEYS.modelBaseUrl, input.baseUrl),
    setValue(prisma, KEYS.modelName, input.modelName),
    setValue(prisma, KEYS.modelVlMode, input.vlMode),
  ]);
}

export async function hasPlatformModelKey(prisma: PrismaClient): Promise<boolean> {
  return (await getValue(prisma, KEYS.modelApiKey)) !== null;
}

/** 平台模型公开视图(Key 只回掩码尾 4 位标识,不可逆) */
export async function getPlatformModelPublic(prisma: PrismaClient): Promise<{
  baseUrl: string;
  modelName: string;
  vlMode: string;
  hasApiKey: boolean;
} | null> {
  const [apiKeyEnc, baseUrl, modelName, vlMode] = await Promise.all([
    getValue(prisma, KEYS.modelApiKey),
    getValue(prisma, KEYS.modelBaseUrl),
    getValue(prisma, KEYS.modelName),
    getValue(prisma, KEYS.modelVlMode),
  ]);
  if (!baseUrl && !modelName) return null;
  return {
    baseUrl: baseUrl ?? '',
    modelName: modelName ?? '',
    vlMode: vlMode ?? 'none',
    hasApiKey: apiKeyEnc !== null,
  };
}

/** 新用户注册赠送的 AI 探索额度 */
export async function getDefaultFreeRuns(prisma: PrismaClient): Promise<number> {
  const raw = await getValue(prisma, KEYS.defaultQuota);
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_FREE_RUNS;
}

export async function setDefaultFreeRuns(prisma: PrismaClient, value: number): Promise<void> {
  await setValue(prisma, KEYS.defaultQuota, String(value));
}

/** 注册开关,默认开放 */
export async function isRegistrationEnabled(prisma: PrismaClient): Promise<boolean> {
  return (await getValue(prisma, KEYS.registration)) !== 'false';
}

export async function setRegistrationEnabled(prisma: PrismaClient, enabled: boolean): Promise<void> {
  await setValue(prisma, KEYS.registration, String(enabled));
}
