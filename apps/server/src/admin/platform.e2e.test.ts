import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import type { ServerConfig } from '../config.js';
import { loadPlatformModelConfig } from '../platform/config.js';

const TEST_CONFIG: ServerConfig = {
  port: 0,
  jwtSecret: 'test-secret-platform',
  accessTokenTtl: '5m',
  refreshTokenTtl: '1d',
  corsOrigin: '*',
};

describe('平台化模式:统一模型 / 注册开关 / Runner 权限', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let adminHeaders: Record<string, string>;
  let memberHeaders: Record<string, string>;
  let memberId: string;

  beforeAll(async () => {
    const dbFile = path.join(mkdtempSync(path.join(os.tmpdir(), 'testpilot-platform-')), 'test.db');
    execSync('pnpm exec prisma db push --skip-generate', {
      cwd: path.resolve(import.meta.dirname, '../..'),
      env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
      stdio: 'ignore',
    });
    prisma = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
    app = await buildApp(
      { ...TEST_CONFIG, artifactsRoot: mkdtempSync(path.join(os.tmpdir(), 'tp-art-')) },
      prisma,
    );

    const register = async (email: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email, password: 'password123' },
      });
      return res.json().data;
    };
    const admin = await register('root@testpilot.dev');
    const member = await register('member@testpilot.dev');
    adminHeaders = { authorization: `Bearer ${admin.accessToken}` };
    memberHeaders = { authorization: `Bearer ${member.accessToken}` };
    memberId = member.user.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('平台模型配置', () => {
    it('首次保存必须带 API Key;保存后 Key 不回明文', async () => {
      const noKey = await app.inject({
        method: 'PUT',
        url: '/api/admin/model-config',
        headers: adminHeaders,
        payload: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelName: 'qwen-vl-max', vlMode: 'qwen' },
      });
      expect(noKey.statusCode).toBe(400);

      const saved = await app.inject({
        method: 'PUT',
        url: '/api/admin/model-config',
        headers: adminHeaders,
        payload: {
          apiKey: 'sk-test-1234567890',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          modelName: 'qwen-vl-max',
          vlMode: 'qwen',
        },
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().data.model.hasApiKey).toBe(true);
      expect(JSON.stringify(saved.json())).not.toContain('sk-test-1234567890');
    });

    it('落库加密,读取解密后与原文一致;更新可不带 Key', async () => {
      const stored = await prisma.systemConfig.findUnique({ where: { key: 'model.apiKeyEnc' } });
      expect(stored?.value).not.toContain('sk-test-1234567890');

      const cfg = await loadPlatformModelConfig(prisma, TEST_CONFIG.jwtSecret);
      expect(cfg?.apiKey).toBe('sk-test-1234567890');
      expect(cfg?.vlMode).toBe('qwen');

      const updated = await app.inject({
        method: 'PUT',
        url: '/api/admin/model-config',
        headers: adminHeaders,
        payload: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelName: 'qwen-vl-plus', vlMode: 'qwen' },
      });
      expect(updated.statusCode).toBe(200);
      const cfg2 = await loadPlatformModelConfig(prisma, TEST_CONFIG.jwtSecret);
      expect(cfg2?.modelName).toBe('qwen-vl-plus');
      expect(cfg2?.apiKey).toBe('sk-test-1234567890'); // 沿用旧 Key
    });

    it('普通用户无法读写平台模型配置', async () => {
      expect(
        (await app.inject({ method: 'GET', url: '/api/admin/model-config', headers: memberHeaders })).statusCode,
      ).toBe(403);
    });

    it('平台配置就绪后,普通用户可直接发起 AI 探索(无需自己的 Key)', async () => {
      const proj = await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: memberHeaders,
        payload: { name: '测试项目', targetUrl: 'https://example.com/' },
      });
      const run = await app.inject({
        method: 'POST',
        url: `/api/projects/${proj.json().data.project.id}/runs`,
        headers: memberHeaders,
        payload: { stepBudget: 3 },
      });
      expect(run.statusCode).toBe(201);
      expect(run.json().data.run.mode).toBe('ai');
      expect(run.json().data.run.executor).toBe('cloud');
    });
  });

  describe('Runner 权限门控', () => {
    it('未开通时:建 Token 403,发起 runner 任务 403', async () => {
      const tok = await app.inject({
        method: 'POST',
        url: '/api/settings/runner-tokens',
        headers: memberHeaders,
        payload: { name: '我的机器' },
      });
      expect(tok.statusCode).toBe(403);
      expect(tok.json().error).toContain('管理员');
    });

    it('管理员开通后可建 Token;回收后已有 Token 立即失效', async () => {
      const enable = await app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${memberId}`,
        headers: adminHeaders,
        payload: { runnerEnabled: true },
      });
      expect(enable.statusCode).toBe(200);
      expect(enable.json().data.user.runnerEnabled).toBe(true);

      const tok = await app.inject({
        method: 'POST',
        url: '/api/settings/runner-tokens',
        headers: memberHeaders,
        payload: { name: '我的机器' },
      });
      expect(tok.statusCode).toBe(201);
      const plaintext = tok.json().data.plaintext as string;

      const claimOk = await app.inject({
        method: 'POST',
        url: '/api/runner/claim',
        headers: { 'x-runner-token': plaintext },
      });
      expect(claimOk.statusCode).toBe(200);

      await app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${memberId}`,
        headers: adminHeaders,
        payload: { runnerEnabled: false },
      });
      const claimBlocked = await app.inject({
        method: 'POST',
        url: '/api/runner/claim',
        headers: { 'x-runner-token': plaintext },
      });
      expect(claimBlocked.statusCode).toBe(403);
    });

    it('me 接口返回 runnerEnabled 供前端展示', async () => {
      const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: memberHeaders });
      expect(me.json().data.user.runnerEnabled).toBe(false);
    });
  });

  describe('免费额度体系', () => {
    let quotaHeaders: Record<string, string>;
    let quotaUserId: string;
    let quotaProjectId: string;

    it('管理员设置默认额度后,新用户按新额度发放', async () => {
      const put = await app.inject({
        method: 'PUT',
        url: '/api/admin/quota',
        headers: adminHeaders,
        payload: { defaultFreeRuns: 2 },
      });
      expect(put.statusCode).toBe(200);

      const reg = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'quota@testpilot.dev', password: 'password123' },
      });
      expect(reg.json().data.user.quota).toBe(2);
      quotaHeaders = { authorization: `Bearer ${reg.json().data.accessToken}` };
      quotaUserId = reg.json().data.user.id;

      const proj = await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: quotaHeaders,
        payload: { name: '额度项目', targetUrl: 'https://example.com/' },
      });
      quotaProjectId = proj.json().data.project.id;
    });

    it('每次平台 AI 探索消耗 1 次额度,用完 → 403', async () => {
      for (let i = 0; i < 2; i++) {
        const run = await app.inject({
          method: 'POST',
          url: `/api/projects/${quotaProjectId}/runs`,
          headers: quotaHeaders,
          payload: { stepBudget: 3 },
        });
        expect(run.statusCode).toBe(201);
      }
      const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: quotaHeaders });
      expect(me.json().data.user.quota).toBe(0);

      const exhausted = await app.inject({
        method: 'POST',
        url: `/api/projects/${quotaProjectId}/runs`,
        headers: quotaHeaders,
        payload: { stepBudget: 3 },
      });
      expect(exhausted.statusCode).toBe(403);
      expect(exhausted.json().error).toContain('额度');
    });

    it('本机 Runner 执行不消耗额度(额度为 0 也能发起)', async () => {
      await prisma.user.update({ where: { id: quotaUserId }, data: { runnerEnabled: true } });
      await app.inject({
        method: 'POST',
        url: '/api/settings/runner-tokens',
        headers: quotaHeaders,
        payload: { name: '额度用户的机器' },
      });
      const run = await app.inject({
        method: 'POST',
        url: `/api/projects/${quotaProjectId}/runs`,
        headers: quotaHeaders,
        payload: { useRunner: true, stepBudget: 3 },
      });
      expect(run.statusCode).toBe(201);
      expect(run.json().data.run.mode).toBe('cli');

      const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: quotaHeaders });
      expect(me.json().data.user.quota).toBe(0); // 未被扣减
    });

    it('管理员可给用户加额度,加完立即可用', async () => {
      const patch = await app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${quotaUserId}`,
        headers: adminHeaders,
        payload: { quota: 5 },
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().data.user.quota).toBe(5);

      const run = await app.inject({
        method: 'POST',
        url: `/api/projects/${quotaProjectId}/runs`,
        headers: quotaHeaders,
        payload: { stepBudget: 3 },
      });
      expect(run.statusCode).toBe(201);
    });
  });

  describe('注册开关', () => {
    it('关闭后新注册被拒,已有用户登录不受影响;重新打开恢复', async () => {
      await app.inject({
        method: 'PUT',
        url: '/api/admin/registration',
        headers: adminHeaders,
        payload: { enabled: false },
      });

      const blocked = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'newbie@testpilot.dev', password: 'password123' },
      });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error).toContain('注册暂未开放');

      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'member@testpilot.dev', password: 'password123' },
      });
      expect(login.statusCode).toBe(200);

      await app.inject({
        method: 'PUT',
        url: '/api/admin/registration',
        headers: adminHeaders,
        payload: { enabled: true },
      });
      const reopened = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'newbie@testpilot.dev', password: 'password123' },
      });
      expect(reopened.statusCode).toBe(201);
    });
  });
});
