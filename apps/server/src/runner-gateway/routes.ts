import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { PrismaClient, RunnerToken } from '@prisma/client';
import type { RunReport } from '@testpilot/shared';
import type { ServerConfig } from '../config.js';
import { upsertIssuesFromRun } from '../issues/service.js';
import { loadUserModelConfig } from '../settings/routes.js';
import type { RunQueue } from '../runs/runner.js';

export function hashRunnerToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateRunnerToken(): string {
  return `tpr_${randomBytes(24).toString('hex')}`;
}

const completeSchema = z.object({
  report: z.object({
    runId: z.string(),
    mode: z.string(),
    targetUrl: z.string(),
    goal: z.string().optional(),
    startedAt: z.number(),
    finishedAt: z.number(),
    stepBudget: z.number(),
    stepsTaken: z.number(),
    visitedUrls: z.array(z.string()),
    steps: z.array(z.record(z.string(), z.unknown())),
    findings: z.array(z.record(z.string(), z.unknown())),
  }),
});

const failSchema = z.object({ error: z.string().min(1).max(500) });

/** Runner 协议:x-runner-token 头鉴权,领取本用户的 runner 任务并回传结果 */
export function registerRunnerGatewayRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  queue: RunQueue,
  config: ServerConfig,
): void {
  // PNG 截图上传用
  app.addContentTypeParser('image/png', { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  async function authToken(req: FastifyRequest, reply: FastifyReply): Promise<RunnerToken | null> {
    const raw = req.headers['x-runner-token'];
    const token = typeof raw === 'string' ? raw : '';
    if (!token.startsWith('tpr_')) {
      await reply.code(401).send({ ok: false, error: '缺少或非法的 Runner Token' });
      return null;
    }
    const row = await prisma.runnerToken.findUnique({ where: { tokenHash: hashRunnerToken(token) } });
    if (!row) {
      await reply.code(401).send({ ok: false, error: 'Runner Token 无效或已被删除' });
      return null;
    }
    await prisma.runnerToken.update({ where: { id: row.id }, data: { lastSeenAt: new Date() } });
    return row;
  }

  // 领取一个排队中的 runner 任务(按创建时间最早优先)
  app.post('/api/runner/claim', async (req, reply) => {
    const token = await authToken(req, reply);
    if (!token) return;

    const run = await prisma.run.findFirst({
      where: { userId: token.userId, executor: 'runner', status: 'queued' },
      orderBy: { createdAt: 'asc' },
      include: { project: true },
    });
    if (!run) return reply.send({ ok: true, data: { run: null } });

    // 原子抢占:status 仍为 queued 才能领走,防止两个 runner 重复执行
    const claimed = await prisma.run.updateMany({
      where: { id: run.id, status: 'queued' },
      data: { status: 'running', startedAt: new Date() },
    });
    if (claimed.count === 0) return reply.send({ ok: true, data: { run: null } });

    // ai 模式把用户 BYOK 解密下发给本人的 runner(HTTPS 部署;本机开发为回环)
    const modelConfig =
      run.mode === 'ai' ? await loadUserModelConfig(prisma, config.jwtSecret, token.userId) : null;

    return reply.send({
      ok: true,
      data: {
        run: {
          id: run.id,
          mode: run.mode,
          goal: run.goal,
          stepBudget: run.stepBudget,
          targetUrl: run.project.targetUrl,
          modelConfig,
        },
      },
    });
  });

  /** 校验该 run 属于此 token 用户且正在执行 */
  async function findRunningRun(token: RunnerToken, params: unknown) {
    const { id } = z.object({ id: z.string().min(1) }).parse(params);
    return prisma.run.findFirst({
      where: { id, userId: token.userId, executor: 'runner', status: 'running' },
    });
  }

  // 回传成功结果
  app.post('/api/runner/runs/:id/complete', async (req, reply) => {
    const token = await authToken(req, reply);
    if (!token) return;
    const run = await findRunningRun(token, req.params);
    if (!run) return reply.code(404).send({ ok: false, error: '任务不存在或状态不允许回传' });

    const { report } = completeSchema.parse(req.body);
    const typedReport = report as unknown as RunReport;
    await prisma.run.update({
      where: { id: run.id },
      data: {
        status: 'done',
        finishedAt: new Date(),
        reportJson: JSON.stringify(typedReport),
        findingsCount: typedReport.findings.length,
        criticalCount: typedReport.findings.filter((f) => f.severity === 'critical').length,
        stepsTaken: typedReport.stepsTaken,
      },
    });
    await upsertIssuesFromRun(prisma, run, typedReport);
    return reply.send({ ok: true, data: { saved: true } });
  });

  // 回传失败
  app.post('/api/runner/runs/:id/fail', async (req, reply) => {
    const token = await authToken(req, reply);
    if (!token) return;
    const run = await findRunningRun(token, req.params);
    if (!run) return reply.code(404).send({ ok: false, error: '任务不存在或状态不允许回传' });

    const body = failSchema.parse(req.body);
    await prisma.run.update({
      where: { id: run.id },
      data: { status: 'failed', finishedAt: new Date(), error: body.error },
    });
    return reply.send({ ok: true, data: { saved: true } });
  });

  // 上传截图产物(逐张 PNG);文件名取 basename 防目录穿越
  app.post('/api/runner/runs/:id/artifacts/:file', async (req, reply) => {
    const token = await authToken(req, reply);
    if (!token) return;
    const { id, file } = z.object({ id: z.string().min(1), file: z.string().min(1) }).parse(req.params);
    // 回传截图发生在 complete 前后皆可,只要归属正确且是 runner 任务
    const run = await prisma.run.findFirst({ where: { id, userId: token.userId, executor: 'runner' } });
    if (!run) return reply.code(404).send({ ok: false, error: '任务不存在' });

    const safeName = path.basename(file);
    if (!safeName.endsWith('.png') || !Buffer.isBuffer(req.body)) {
      return reply.code(400).send({ ok: false, error: '仅支持 PNG 截图上传' });
    }
    const dir = path.join(queue.artifactsDirOf(run.id), 'screenshots');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, safeName), req.body);
    return reply.send({ ok: true, data: { saved: true } });
  });
}
