import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';

const userStatusSchema = z.object({
  status: z.enum(['active', 'disabled'], { message: '状态只能是 active 或 disabled' }),
});

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
          createdAt: u.createdAt.toISOString(),
          projectCount: u._count.projects,
          runCount: u._count.runs,
        })),
      },
    });
  });

  // 禁用/启用用户(不能操作自己;被禁用户的 token 在各守卫处按库中状态实时失效)
  app.patch('/api/admin/users/:id', pre, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const { status } = userStatusSchema.parse(req.body);
    if (id === req.authUser!.sub) {
      return reply.code(400).send({ ok: false, error: '不能修改自己的账号状态' });
    }
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ ok: false, error: '用户不存在' });
    const updated = await prisma.user.update({ where: { id }, data: { status } });
    return reply.send({
      ok: true,
      data: { user: { id: updated.id, email: updated.email, status: updated.status } },
    });
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
