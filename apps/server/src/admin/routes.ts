import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { ServerConfig } from '../config.js';
import {
  getDefaultFreeRuns,
  getPlatformModelPublic,
  isRegistrationEnabled,
  savePlatformModelConfig,
  setDefaultFreeRuns,
  setRegistrationEnabled,
} from '../platform/config.js';

const userPatchSchema = z
  .object({
    status: z.enum(['active', 'disabled'], { message: '状态只能是 active 或 disabled' }).optional(),
    runnerEnabled: z.boolean().optional(),
    quota: z.number().int().min(0, '额度不能为负').max(1_000_000).optional(),
  })
  .refine((v) => v.status !== undefined || v.runnerEnabled !== undefined || v.quota !== undefined, {
    message: '至少提供一个要修改的字段',
  });

const quotaSchema = z.object({
  defaultFreeRuns: z.number().int().min(0, '额度不能为负').max(1_000_000),
});

const modelConfigSchema = z.object({
  apiKey: z.string().trim().min(8, 'API Key 太短').max(256, 'API Key 过长').optional(),
  baseUrl: z.string().trim().url('接口地址必须是合法 URL'),
  modelName: z.string().trim().min(1, '请填写模型名称').max(100),
  vlMode: z.enum(['none', 'qwen']).default('none'),
});

const registrationSchema = z.object({ enabled: z.boolean() });

const idParamSchema = z.object({ id: z.string().min(1) });

/** 管理员守卫:角色以数据库实时状态为准,防止旧 token 越权 */
function makeRequireAdmin(prisma: PrismaClient) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await prisma.user.findUnique({ where: { id: req.authUser!.sub } });
    if (!user || user.role !== 'admin' || user.status !== 'active') {
      return reply.code(403).send({ ok: false, error: '需要管理员权限' });
    }
  };
}

export function registerAdminRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  config: ServerConfig,
  requireAuth: preHandlerHookHandler,
): void {
  const pre = { preHandler: [requireAuth, makeRequireAdmin(prisma)] };

  // 平台总览统计
  app.get('/api/admin/stats', pre, async (_req, reply) => {
    const [users, activeUsers, projects, runsTotal, runsActive, issuesOpen, issuesTotal] =
      await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { status: 'active' } }),
        prisma.project.count(),
        prisma.run.count(),
        prisma.run.count({ where: { status: { in: ['queued', 'running'] } } }),
        prisma.issue.count({ where: { status: { in: ['open', 'confirmed', 'fixing'] } } }),
        prisma.issue.count(),
      ]);
    return reply.send({
      ok: true,
      data: {
        stats: { users, activeUsers, projects, runsTotal, runsActive, issuesOpen, issuesTotal },
      },
    });
  });

  // 用户列表(含项目/运行计数)
  app.get('/api/admin/users', pre, async (_req, reply) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { projects: true, runs: true } } },
    });
    return reply.send({
      ok: true,
      data: {
        users: users.map((u) => ({
          id: u.id,
          email: u.email,
          role: u.role,
          status: u.status,
          runnerEnabled: u.runnerEnabled,
          quota: u.quota,
          createdAt: u.createdAt.toISOString(),
          projectCount: u._count.projects,
          runCount: u._count.runs,
        })),
      },
    });
  });

  // 修改用户:禁用/启用、开通/回收 Runner 权限(不能操作自己的状态)
  app.patch('/api/admin/users/:id', pre, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const patch = userPatchSchema.parse(req.body);
    if (patch.status !== undefined && id === req.authUser!.sub) {
      return reply.code(400).send({ ok: false, error: '不能修改自己的账号状态' });
    }
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ ok: false, error: '用户不存在' });
    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.runnerEnabled !== undefined ? { runnerEnabled: patch.runnerEnabled } : {}),
        ...(patch.quota !== undefined ? { quota: patch.quota } : {}),
      },
    });
    return reply.send({
      ok: true,
      data: {
        user: {
          id: updated.id,
          email: updated.email,
          status: updated.status,
          runnerEnabled: updated.runnerEnabled,
          quota: updated.quota,
        },
      },
    });
  });

  // 新用户默认免费额度
  app.get('/api/admin/quota', pre, async (_req, reply) => {
    return reply.send({ ok: true, data: { defaultFreeRuns: await getDefaultFreeRuns(prisma) } });
  });

  app.put('/api/admin/quota', pre, async (req, reply) => {
    const { defaultFreeRuns } = quotaSchema.parse(req.body);
    await setDefaultFreeRuns(prisma, defaultFreeRuns);
    return reply.send({ ok: true, data: { defaultFreeRuns } });
  });

  // 平台模型配置(所有用户的 AI 探索统一由平台供给)
  app.get('/api/admin/model-config', pre, async (_req, reply) => {
    const model = await getPlatformModelPublic(prisma);
    return reply.send({ ok: true, data: { model } });
  });

  app.put('/api/admin/model-config', pre, async (req, reply) => {
    const body = modelConfigSchema.parse(req.body);
    const existing = await getPlatformModelPublic(prisma);
    if (!existing?.hasApiKey && !body.apiKey) {
      return reply.code(400).send({ ok: false, error: '首次配置必须填写 API Key' });
    }
    await savePlatformModelConfig(prisma, config.jwtSecret, body);
    const model = await getPlatformModelPublic(prisma);
    return reply.send({ ok: true, data: { model } });
  });

  // 注册开关
  app.get('/api/admin/registration', pre, async (_req, reply) => {
    return reply.send({ ok: true, data: { enabled: await isRegistrationEnabled(prisma) } });
  });

  app.put('/api/admin/registration', pre, async (req, reply) => {
    const { enabled } = registrationSchema.parse(req.body);
    await setRegistrationEnabled(prisma, enabled);
    return reply.send({ ok: true, data: { enabled } });
  });

  // 全局最近运行(监控视角,跨用户)
  app.get('/api/admin/runs', pre, async (_req, reply) => {
    const runs = await prisma.run.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        user: { select: { email: true } },
        project: { select: { name: true } },
      },
    });
    return reply.send({
      ok: true,
      data: {
        runs: runs.map((r) => ({
          id: r.id,
          userEmail: r.user.email,
          projectName: r.project.name,
          mode: r.mode,
          executor: r.executor,
          status: r.status,
          findingsCount: r.findingsCount,
          stepsTaken: r.stepsTaken,
          createdAt: r.createdAt.toISOString(),
        })),
      },
    });
  });
}
