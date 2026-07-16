import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { PrismaClient, RunnerToken } from '@prisma/client';
import { generateRunnerToken, hashRunnerToken } from '../runner-gateway/routes.js';

const createSchema = z.object({
  name: z.string().trim().min(1, '请给 Runner 起个名字').max(50, '名称过长'),
});

function toPublic(row: RunnerToken) {
  return {
    id: row.id,
    name: row.name,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Runner Token 管理(控制台「设置」页):明文只在创建响应里出现一次 */
export function registerRunnerTokenRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  requireAuth: preHandlerHookHandler,
): void {
  app.get('/api/settings/runner-tokens', { preHandler: requireAuth }, async (req, reply) => {
    const rows = await prisma.runnerToken.findMany({
      where: { userId: req.authUser!.sub },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send({ ok: true, data: { tokens: rows.map(toPublic) } });
  });

  app.post('/api/settings/runner-tokens', { preHandler: requireAuth }, async (req, reply) => {
    const me = await prisma.user.findUnique({ where: { id: req.authUser!.sub } });
    if (!me?.runnerEnabled) {
      return reply.code(403).send({ ok: false, error: 'Runner 权限未开通,请联系管理员' });
    }
    const body = createSchema.parse(req.body);
    const plaintext = generateRunnerToken();
    const row = await prisma.runnerToken.create({
      data: {
        userId: req.authUser!.sub,
        name: body.name,
        tokenHash: hashRunnerToken(plaintext),
      },
    });
    return reply.code(201).send({ ok: true, data: { token: toPublic(row), plaintext } });
  });

  app.delete('/api/settings/runner-tokens/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const deleted = await prisma.runnerToken.deleteMany({
      where: { id, userId: req.authUser!.sub },
    });
    if (deleted.count === 0) {
      return reply.code(404).send({ ok: false, error: 'Token 不存在' });
    }
    return reply.send({ ok: true, data: { deleted: true } });
  });
}
