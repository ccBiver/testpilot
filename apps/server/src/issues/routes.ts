import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Issue, PrismaClient } from '@prisma/client';
import { findOwnedProject } from '../projects/routes.js';
import { ISSUE_STATUSES } from './service.js';

const listQuerySchema = z.object({
  status: z.enum(ISSUE_STATUSES).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
});

const patchSchema = z.object({
  status: z.enum(ISSUE_STATUSES, { message: '无效的状态' }),
});

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

function toPublicIssue(issue: Issue, withFinding = false) {
  return {
    id: issue.id,
    projectId: issue.projectId,
    fingerprint: issue.fingerprint,
    detector: issue.detector,
    severity: issue.severity,
    title: issue.title,
    status: issue.status,
    occurrences: issue.occurrences,
    firstRunId: issue.firstRunId,
    lastRunId: issue.lastRunId,
    firstSeenAt: issue.firstSeenAt.toISOString(),
    lastSeenAt: issue.lastSeenAt.toISOString(),
    finding: withFinding ? JSON.parse(issue.findingJson) : null,
  };
}

export function registerIssueRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  requireAuth: preHandlerHookHandler,
): void {
  // 项目的 Bug 看板:按级别降序、最近出现降序
  app.get('/api/projects/:id/issues', { preHandler: requireAuth }, async (req, reply) => {
    const project = await findOwnedProject(prisma, req.authUser!.sub, req.params, reply);
    if (!project) return;
    const query = listQuerySchema.parse(req.query ?? {});
    const issues = await prisma.issue.findMany({
      where: {
        projectId: project.id,
        ...(query.status ? { status: query.status } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
      },
      orderBy: { lastSeenAt: 'desc' },
    });
    const sorted = [...issues].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    );
    return reply.send({ ok: true, data: { issues: sorted.map((i) => toPublicIssue(i)) } });
  });

  // 缺陷详情(含最近一次 Finding 快照)
  app.get('/api/issues/:id', { preHandler: requireAuth }, async (req, reply) => {
    const issue = await findOwnedIssue(prisma, req.authUser!.sub, req.params);
    if (!issue) return reply.code(404).send({ ok: false, error: '缺陷不存在' });
    return reply.send({ ok: true, data: { issue: toPublicIssue(issue, true) } });
  });

  // 状态流转
  app.patch('/api/issues/:id', { preHandler: requireAuth }, async (req, reply) => {
    const issue = await findOwnedIssue(prisma, req.authUser!.sub, req.params);
    if (!issue) return reply.code(404).send({ ok: false, error: '缺陷不存在' });
    const body = patchSchema.parse(req.body ?? {});
    const updated = await prisma.issue.update({
      where: { id: issue.id },
      data: { status: body.status },
    });
    return reply.send({ ok: true, data: { issue: toPublicIssue(updated) } });
  });
}

async function findOwnedIssue(
  prisma: PrismaClient,
  userId: string,
  params: unknown,
): Promise<Issue | null> {
  const { id } = z.object({ id: z.string().min(1) }).parse(params);
  return prisma.issue.findFirst({ where: { id, userId } });
}
