import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { Finding, RunReport } from '@testpilot/shared';
import { buildApp } from '../app.js';
import type { ServerConfig } from '../config.js';
import { upsertIssuesFromRun } from './service.js';

const TEST_CONFIG: ServerConfig = {
  port: 0,
  jwtSecret: 'test-secret-do-not-use-in-prod',
  accessTokenTtl: '5m',
  refreshTokenTtl: '1d',
  corsOrigin: '*',
};

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: 'f-1',
  detector: 'network-failure',
  severity: 'high',
  title: '接口/资源异常:HTTP 500 GET https://a.com/api/items',
  fingerprint: 'network-failure:abc123',
  pageUrl: 'https://a.com/list',
  stepSeq: 3,
  screenshotFile: 'screenshots/step-003.png',
  evidence: { status: 500 },
  at: 1,
  ...over,
});

const reportWith = (...findings: Finding[]): RunReport => ({
  runId: 'r',
  mode: 'heuristic',
  targetUrl: 'https://a.com',
  startedAt: 1,
  finishedAt: 2,
  stepBudget: 10,
  stepsTaken: 5,
  visitedUrls: [],
  steps: [],
  findings,
});

describe('Bug 看板(Issue 聚合与路由)', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let token = '';
  let projectId = '';
  let userId = '';

  const authed = (url: string, method = 'GET', payload?: unknown) =>
    app.inject({ method: method as 'GET', url, payload: payload as never, headers: { authorization: `Bearer ${token}` } });

  beforeAll(async () => {
    const dbFile = path.join(mkdtempSync(path.join(os.tmpdir(), 'testpilot-issues-')), 'test.db');
    const databaseUrl = `file:${dbFile}`;
    execSync('pnpm exec prisma db push --skip-generate', {
      cwd: path.resolve(import.meta.dirname, '../..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'ignore',
    });
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    app = await buildApp(TEST_CONFIG, prisma);

    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'qa@testpilot.dev', password: 'password123' },
    });
    token = reg.json().data.accessToken;
    userId = reg.json().data.user.id;
    const proj = await authed('/api/projects', 'POST', { name: '演示', targetUrl: 'https://a.com' });
    projectId = proj.json().data.project.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const makeRun = async () => {
    const run = await prisma.run.create({
      data: { projectId, userId, status: 'done' },
    });
    return { id: run.id, projectId, userId };
  };

  it('两次运行命中同一指纹 → 看板只有一条,occurrences=2,lastRunId 更新', async () => {
    const run1 = await makeRun();
    const run2 = await makeRun();
    await upsertIssuesFromRun(prisma, run1, reportWith(finding()));
    await upsertIssuesFromRun(prisma, run2, reportWith(finding({ severity: 'critical' })));

    const res = await authed(`/api/projects/${projectId}/issues`);
    const issues = res.json().data.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].occurrences).toBe(2);
    expect(issues[0].severity).toBe('critical'); // 级别取最高
    expect(issues[0].firstRunId).toBe(run1.id);
    expect(issues[0].lastRunId).toBe(run2.id);
  });

  it('closed 复发自动重开;false_positive 不重开', async () => {
    const issue = (await prisma.issue.findFirstOrThrow({ where: { projectId } }))!;

    await prisma.issue.update({ where: { id: issue.id }, data: { status: 'closed' } });
    await upsertIssuesFromRun(prisma, await makeRun(), reportWith(finding()));
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe('open');

    await prisma.issue.update({ where: { id: issue.id }, data: { status: 'false_positive' } });
    await upsertIssuesFromRun(prisma, await makeRun(), reportWith(finding()));
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe(
      'false_positive',
    );
  });

  it('不同指纹产生独立 Issue,列表按级别排序,支持筛选', async () => {
    await upsertIssuesFromRun(
      prisma,
      await makeRun(),
      reportWith(
        finding({ fingerprint: 'console-error:xyz', detector: 'console-error', severity: 'medium', title: '控制台错误:x' }),
      ),
    );
    const all = (await authed(`/api/projects/${projectId}/issues`)).json().data.issues;
    expect(all.length).toBe(2);
    expect(all[0].severity).toBe('critical'); // critical 排最前

    const mediums = (await authed(`/api/projects/${projectId}/issues?severity=medium`)).json().data.issues;
    expect(mediums).toHaveLength(1);
    expect(mediums[0].detector).toBe('console-error');
  });

  it('详情返回 Finding 快照;状态流转生效;非法状态 400', async () => {
    const list = (await authed(`/api/projects/${projectId}/issues`)).json().data.issues;
    const id = list[0].id;

    const detail = (await authed(`/api/issues/${id}`)).json().data.issue;
    expect(detail.finding.evidence).toBeTruthy();
    expect(detail.finding.screenshotFile).toContain('screenshots/');

    const patched = await authed(`/api/issues/${id}`, 'PATCH', { status: 'confirmed' });
    expect(patched.json().data.issue.status).toBe('confirmed');

    expect((await authed(`/api/issues/${id}`, 'PATCH', { status: 'whatever' })).statusCode).toBe(400);
  });

  it('数据隔离:他人的 Issue 不可见也不可改', async () => {
    const other = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'other@testpilot.dev', password: 'password123' },
    });
    const otherToken = other.json().data.accessToken;
    const list = (await authed(`/api/projects/${projectId}/issues`)).json().data.issues;

    const stolen = await app.inject({
      method: 'GET',
      url: `/api/issues/${list[0].id}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(stolen.statusCode).toBe(404);
  });
});
