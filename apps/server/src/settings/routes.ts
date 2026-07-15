import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { ModelConfig as ModelConfigRow, PrismaClient } from '@prisma/client';
import type { ServerConfig } from '../config.js';
import { decryptSecret, encryptSecret, maskSecret } from './crypto.js';

const upsertSchema = z.object({
  apiKey: z.string().trim().min(8, 'API Key 太短').max(256, 'API Key 过长').optional(),
  baseUrl: z.string().trim().url('接口地址必须是合法 URL'),
  modelName: z.string().trim().min(1, '请填写模型名称').max(100),
  vlMode: z.enum(['none', 'qwen']).default('none'),
});

function toPublicConfig(row: ModelConfigRow, serverSecret: string) {
  let masked = '****';
  try {
    masked = maskSecret(decryptSecret(row.apiKeyEnc, serverSecret));
  } catch {
    // 服务端密钥已更换,旧密文解不开;提示用户重填
    masked = '(已失效,请重新填写)';
  }
  return {
    baseUrl: row.baseUrl,
    modelName: row.modelName,
    vlMode: row.vlMode,
    apiKeyMasked: masked,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function registerSettingsRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  config: ServerConfig,
  requireAuth: preHandlerHookHandler,
): void {
  // 读取当前模型配置(Key 只回掩码)
  app.get('/api/settings/model', { preHandler: requireAuth }, async (req, reply) => {
    const row = await prisma.modelConfig.findUnique({ where: { userId: req.authUser!.sub } });
    return reply.send({
      ok: true,
      data: { config: row ? toPublicConfig(row, config.jwtSecret) : null },
    });
  });

  // 保存/更新:新建必须带 apiKey;更新可不带(沿用旧 Key,只改地址/模型)
  app.put('/api/settings/model', { preHandler: requireAuth }, async (req, reply) => {
    const body = upsertSchema.parse(req.body);
    const userId = req.authUser!.sub;
    const existing = await prisma.modelConfig.findUnique({ where: { userId } });

    if (!existing && !body.apiKey) {
      return reply.code(400).send({ ok: false, error: '首次配置必须填写 API Key' });
    }

    const apiKeyEnc = body.apiKey
      ? encryptSecret(body.apiKey, config.jwtSecret)
      : existing!.apiKeyEnc;
    const data = {
      baseUrl: body.baseUrl,
      modelName: body.modelName,
      vlMode: body.vlMode,
      apiKeyEnc,
    };
    const row = existing
      ? await prisma.modelConfig.update({ where: { userId }, data })
      : await prisma.modelConfig.create({ data: { ...data, userId } });

    return reply.send({ ok: true, data: { config: toPublicConfig(row, config.jwtSecret) } });
  });

  // 清除配置
  app.delete('/api/settings/model', { preHandler: requireAuth }, async (req, reply) => {
    await prisma.modelConfig
      .delete({ where: { userId: req.authUser!.sub } })
      .catch(() => null); // 不存在也视为成功
    return reply.send({ ok: true, data: { deleted: true } });
  });
}

/** 供 runner 使用:取出某用户可用的模型配置(解密);无配置返回 null */
export async function loadUserModelConfig(
  prisma: PrismaClient,
  serverSecret: string,
  userId: string,
): Promise<{ apiKey: string; baseUrl: string; modelName: string; vlMode: 'none' | 'qwen' } | null> {
  const row = await prisma.modelConfig.findUnique({ where: { userId } });
  if (!row) return null;
  try {
    return {
      apiKey: decryptSecret(row.apiKeyEnc, serverSecret),
      baseUrl: row.baseUrl,
      modelName: row.modelName,
      vlMode: row.vlMode === 'qwen' ? 'qwen' : 'none',
    };
  } catch {
    return null; // 密文失效等同未配置
  }
}
