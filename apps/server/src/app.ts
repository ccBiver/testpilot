import path from 'node:path';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { ServerConfig } from './config.js';
import { AuthError, AuthService } from './auth/service.js';
import { makeRequireAuth, registerAuthRoutes } from './auth/routes.js';
import { registerProjectRoutes } from './projects/routes.js';
import { registerRunRoutes } from './runs/routes.js';
import { registerIssueRoutes } from './issues/routes.js';
import { registerRunnerTokenRoutes } from './settings/runner-tokens.js';
import { registerRunnerGatewayRoutes } from './runner-gateway/routes.js';
import { registerAdminRoutes } from './admin/routes.js';
import { RunQueue } from './runs/runner.js';

/** 组装 Fastify 应用(与监听分离,测试用 app.inject 直连) */
export async function buildApp(config: ServerConfig, prisma: PrismaClient): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(rateLimit, { global: false });

  // 统一错误格式:{ ok: false, error };zod 校验错误取第一条给用户
  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ ok: false, error: err.issues[0]?.message ?? '请求参数不合法' });
    }
    if (err instanceof AuthError) {
      return reply.code(err.statusCode).send({ ok: false, error: err.message });
    }
    const statusCode =
      typeof err === 'object' && err !== null && 'statusCode' in err
        ? (err as { statusCode?: number }).statusCode
        : undefined;
    if (statusCode === 429) {
      return reply.code(429).send({ ok: false, error: '操作太频繁,请稍后再试' });
    }
    app.log.error(err);
    return reply.code(500).send({ ok: false, error: '服务器内部错误' });
  });

  app.get('/api/health', async () => ({ ok: true, data: { status: 'up' } }));

  const auth = new AuthService(prisma, config);
  registerAuthRoutes(app, auth);

  const requireAuth = makeRequireAuth(auth);
  const queue = new RunQueue(prisma, config.artifactsRoot ?? path.resolve('data/artifacts'), config.jwtSecret);
  registerProjectRoutes(app, prisma, requireAuth);
  registerRunRoutes(app, prisma, queue, requireAuth);
  registerIssueRoutes(app, prisma, requireAuth);
  registerRunnerTokenRoutes(app, prisma, requireAuth);
  registerRunnerGatewayRoutes(app, prisma, queue, config);
  registerAdminRoutes(app, prisma, config, requireAuth);

  return app;
}
