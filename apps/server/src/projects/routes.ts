import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { PrismaClient, Project } from '@prisma/client';
import type { preHandlerHookHandler } from 'fastify';

const createProjectSchema = z.object({
  name: z.string().trim().min(1, '请填写项目名称').max(60, '项目名称过长'),
  targetUrl: z
    .string()
    .trim()
    .url('请输入合法的 URL(需含 http:// 或 https://)')
    .refine((u) => u.startsWith('http://') || u.startsWith('https://'), '仅支持 http/https 目标'),
});

function toPublicProject(p: Project & { _count?: { runs: number } }) {
  return {
    id: p.id,
    name: p.name,
    targetUrl: p.targetUrl,
    createdAt: p.createdAt.toISOString(),
    runCount: p._count?.runs ?? 0,
  };
}

export function registerProjectRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  requireAuth: preHandlerHookHandler,
): void {
  app.post('/api/projects', { preHandler: requireAuth }, async (req, reply) => {
    const body = createProjectSchema.parse(req.body);
    const project = await prisma.project.create({
      data: { ...body, userId: req.authUser!.sub },
    });
    return reply.code(201).send({ ok: true, data: { project: toPublicProject(project) } });
  });

  app.get('/api/projects', { preHandler: requireAuth }, async (req, reply) => {
    const projects = await prisma.project.findMany({
      where: { userId: req.authUser!.sub },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { runs: true } } },
    });
    return reply.send({ ok: true, data: { projects: projects.map(toPublicProject) } });
  });

  app.get('/api/projects/:id', { preHandler: requireAuth }, async (req, reply) => {
    const project = await findOwnedProject(prisma, req.authUser!.sub, req.params, reply);
    if (!project) return;
    return reply.send({ ok: true, data: { project: toPublicProject(project) } });
  });

  app.delete('/api/projects/:id', { preHandler: requireAuth }, async (req, reply) => {
    const project = await findOwnedProject(prisma, req.authUser!.sub, req.params, reply);
    if (!project) return;
    await prisma.project.delete({ where: { id: project.id } });
    return reply.send({ ok: true, data: { deleted: true } });
  });
}

/** 归属校验:404 统一处理不区分「不存在」与「不是你的」,避免探测 */
export async function findOwnedProject(
  prisma: PrismaClient,
  userId: string,
  params: unknown,
  reply: FastifyReply,
): Promise<Project | null> {
  const { id } = z.object({ id: z.string().min(1) }).parse(params);
  const project = await prisma.project.findFirst({ where: { id, userId } });
  if (!project) {
    await reply.code(404).send({ ok: false, error: '项目不存在' });
    return null;
  }
  return project;
}
