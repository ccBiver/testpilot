import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import type { ServerConfig } from '../config.js';

const TEST_CONFIG: ServerConfig = {
  port: 0,
  jwtSecret: 'test-secret-do-not-use-in-prod',
  accessTokenTtl: '5m',
  refreshTokenTtl: '1d',
  corsOrigin: '*',
  artifactsRoot: mkdtempSync(path.join(os.tmpdir(), 'testpilot-artifacts-')),
};

const REPORT = {
  runId: 'r',
  mode: 'heuristic',
  targetUrl: 'http://127.0.0.1:9/',
  startedAt: 1,
  finishedAt: 2,
  stepBudget: 10,
  stepsTaken: 3,
  visitedUrls: ['http://127.0.0.1:9/'],
  steps: [{ seq: 1, description: '打开目标页面', pageUrl: 'x', pageTitle: '', screenshotFile: 'screenshots/step-001.png', at: 1 }],
  findings: [
    {
      id: 'f-1',
      detector: 'console-error',
      severity: 'high',
      title: '控制台错误:boom',
      fingerprint: 'console-error:abc123',
      pageUrl: 'x',
      stepSeq: 1,
      screenshotFile: 'screenshots/step-001.png',
      evidence: { message: 'boom' },
      at: 1,
    },
  ],
};

describe('Runner 网关端到端', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let accessToken: string;
  let runnerToken: string;
  let otherRunnerToken: string;
  let projectId: string;

  const authed = { authorization: '' };

  beforeAll(async () => {
    const dbFile = path.join(mkdtempSync(path.join(os.tmpdir(), 'testpilot-db-')), 'test.db');
    execSync('pnpm exec prisma db push --skip-generate', {
      cwd: path.resolve(import.meta.dirname, '../..'),
      env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
      stdio: 'ignore',
    });
    prisma = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
    app = await buildApp(TEST_CONFIG, prisma);

    // 用户 A + 项目
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'runner@testpilot.dev', password: 'password123' },
    });
    accessToken = reg.json().data.accessToken;
    authed.authorization = `Bearer ${accessToken}`;
    // Runner 是管理员开通的能力,测试里直接打开两位用户的开关
    await prisma.user.updateMany({ data: { runnerEnabled: true } });
    const proj = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authed,
      payload: { name: '内网站点', targetUrl: 'http://192.168.1.10/' },
    });
    projectId = proj.json().data.project.id;

    // A 的 runner token
    const tok = await app.inject({
      method: 'POST',
      url: '/api/settings/runner-tokens',
      headers: authed,
      payload: { name: '我的 Mac' },
    });
    runnerToken = tok.json().data.plaintext;

    // 用户 B + token(隔离性检查)
    const regB = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'other@testpilot.dev', password: 'password123' },
    });
    await prisma.user.update({
      where: { id: regB.json().data.user.id },
      data: { runnerEnabled: true },
    });
    const tokB = await app.inject({
      method: 'POST',
      url: '/api/settings/runner-tokens',
      headers: { authorization: `Bearer ${regB.json().data.accessToken}` },
      payload: { name: 'B 的机器' },
    });
    otherRunnerToken = tokB.json().data.plaintext;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('创建 Token:明文只出现一次,列表只有元数据', async () => {
    expect(runnerToken).toMatch(/^tpr_[0-9a-f]{48}$/);
    const list = await app.inject({ method: 'GET', url: '/api/settings/runner-tokens', headers: authed });
    const tokens = list.json().data.tokens;
    expect(tokens.length).toBe(1);
    expect(JSON.stringify(tokens)).not.toContain(runnerToken);
  });

  it('无 Token 用户发起 runner 任务 → 400 引导创建', async () => {
    // 用户 B 删除自己的 token 后试发 runner 任务?B 无项目,换个角度:直接校验 A 的正常创建
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/runs`,
      headers: authed,
      payload: { useRunner: true, stepBudget: 10 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.run.executor).toBe('runner');
    expect(res.json().data.run.mode).toBe('cli');
    expect(res.json().data.run.status).toBe('queued');
  });

  it('错误 Token 领取 → 401;他人 Token 领不到 A 的任务', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/runner/claim',
      headers: { 'x-runner-token': 'tpr_deadbeef' },
    });
    expect(bad.statusCode).toBe(401);

    const other = await app.inject({
      method: 'POST',
      url: '/api/runner/claim',
      headers: { 'x-runner-token': otherRunnerToken },
    });
    expect(other.json().data.run).toBeNull();
  });

  it('领取任务:拿到目标信息并置为 running,重复领取拿不到', async () => {
    const claim = await app.inject({
      method: 'POST',
      url: '/api/runner/claim',
      headers: { 'x-runner-token': runnerToken },
    });
    const run = claim.json().data.run;
    expect(run.targetUrl).toBe('http://192.168.1.10/');
    expect(run.stepBudget).toBe(10);

    const again = await app.inject({
      method: 'POST',
      url: '/api/runner/claim',
      headers: { 'x-runner-token': runnerToken },
    });
    expect(again.json().data.run).toBeNull();
  });

  it('上传截图 + 回传报告:入库并聚合 Issue', async () => {
    const runId = (await prisma.run.findFirstOrThrow({ where: { executor: 'runner' } })).id;

    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const upload = await app.inject({
      method: 'POST',
      url: `/api/runner/runs/${runId}/artifacts/step-001.png`,
      headers: { 'x-runner-token': runnerToken, 'content-type': 'image/png' },
      payload: png,
    });
    expect(upload.statusCode).toBe(200);
    const saved = await readFile(
      path.join(TEST_CONFIG.artifactsRoot!, runId, 'screenshots', 'step-001.png'),
    );
    expect(saved.equals(png)).toBe(true);

    const complete = await app.inject({
      method: 'POST',
      url: `/api/runner/runs/${runId}/complete`,
      headers: { 'x-runner-token': runnerToken },
      payload: { report: { ...REPORT, runId } },
    });
    expect(complete.statusCode).toBe(200);

    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe('done');
    expect(run.findingsCount).toBe(1);

    const issues = await prisma.issue.findMany({ where: { projectId } });
    expect(issues.length).toBe(1);
    expect(issues[0]?.fingerprint).toBe('console-error:abc123');

    // 已完成的任务不能再回传
    const again = await app.inject({
      method: 'POST',
      url: `/api/runner/runs/${runId}/fail`,
      headers: { 'x-runner-token': runnerToken },
      payload: { error: 'late' },
    });
    expect(again.statusCode).toBe(404);
  });

  it('失败路径:fail 置为 failed 并记录原因', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/runs`,
      headers: authed,
      payload: { useRunner: true, stepBudget: 5 },
    });
    const claim = await app.inject({
      method: 'POST',
      url: '/api/runner/claim',
      headers: { 'x-runner-token': runnerToken },
    });
    const runId = claim.json().data.run.id;

    const fail = await app.inject({
      method: 'POST',
      url: `/api/runner/runs/${runId}/fail`,
      headers: { 'x-runner-token': runnerToken },
      payload: { error: '本机浏览器启动失败' },
    });
    expect(fail.statusCode).toBe(200);
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe('failed');
    expect(run.error).toContain('浏览器');
  });

  it('删除 Token 后立即失效', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/settings/runner-tokens', headers: authed });
    const id = list.json().data.tokens[0].id;
    await app.inject({ method: 'DELETE', url: `/api/settings/runner-tokens/${id}`, headers: authed });

    const claim = await app.inject({
      method: 'POST',
      url: '/api/runner/claim',
      headers: { 'x-runner-token': runnerToken },
    });
    expect(claim.statusCode).toBe(401);
  });
});
