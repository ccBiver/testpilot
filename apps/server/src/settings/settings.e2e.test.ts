import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import type { ServerConfig } from '../config.js';
import { decryptSecret, encryptSecret, maskSecret } from './crypto.js';
import { loadUserModelConfig } from './routes.js';

const TEST_CONFIG: ServerConfig = {
  port: 0,
  jwtSecret: 'settings-test-secret',
  accessTokenTtl: '5m',
  refreshTokenTtl: '1d',
  corsOrigin: '*',
};

describe('crypto:AES-256-GCM 往返', () => {
  it('加密后可解回原文,密文不含明文', () => {
    const enc = encryptSecret('sk-dashscope-abcdef123456', 'secret-a');
    expect(enc).not.toContain('abcdef');
    expect(decryptSecret(enc, 'secret-a')).toBe('sk-dashscope-abcdef123456');
  });

  it('换密钥解密失败(抛错而非返回垃圾)', () => {
    const enc = encryptSecret('sk-xyz-12345678', 'secret-a');
    expect(() => decryptSecret(enc, 'secret-b')).toThrow();
  });

  it('掩码只露头尾', () => {
    expect(maskSecret('sk-1234567890abcd')).toBe('sk-****abcd');
    expect(maskSecret('ab')).toBe('****');
  });
});

describe('模型配置接口(BYOK)', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let token = '';
  let userId = '';

  beforeAll(async () => {
    const dbFile = path.join(mkdtempSync(path.join(os.tmpdir(), 'testpilot-byok-')), 'test.db');
    const databaseUrl = `file:${dbFile}`;
    execSync('pnpm exec prisma db push --skip-generate', {
      cwd: path.resolve(import.meta.dirname, '../..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'ignore',
    });
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    app = await buildApp(TEST_CONFIG, prisma);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'byok@testpilot.dev', password: 'password123' },
    });
    token = res.json().data.accessToken;
    userId = res.json().data.user.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it('未配置时返回 null', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/model', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.config).toBeNull();
  });

  it('首次保存必须带 apiKey', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/model',
      headers: auth(),
      payload: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelName: 'qwen-vl-max-latest', vlMode: 'qwen' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('API Key');
  });

  it('保存成功,Key 只回掩码,落库是密文', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/model',
      headers: auth(),
      payload: {
        apiKey: 'sk-test-1234567890abcd',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        modelName: 'qwen-vl-max-latest',
        vlMode: 'qwen',
      },
    });
    expect(res.statusCode).toBe(200);
    const cfg = res.json().data.config;
    expect(cfg.apiKeyMasked).toBe('sk-****abcd');
    expect(JSON.stringify(res.json())).not.toContain('sk-test-1234567890abcd');

    const row = await prisma.modelConfig.findUnique({ where: { userId } });
    expect(row?.apiKeyEnc).not.toContain('sk-test');
  });

  it('更新可不带 Key(沿用旧 Key 改模型名)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/model',
      headers: auth(),
      payload: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelName: 'qwen-vl-plus', vlMode: 'qwen' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.config.modelName).toBe('qwen-vl-plus');
    expect(res.json().data.config.apiKeyMasked).toBe('sk-****abcd');
  });

  it('runner 侧能解密取回完整配置', async () => {
    const cfg = await loadUserModelConfig(prisma, TEST_CONFIG.jwtSecret, userId);
    expect(cfg).toEqual({
      apiKey: 'sk-test-1234567890abcd',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      modelName: 'qwen-vl-plus',
      vlMode: 'qwen',
    });
  });

  it('配置 BYOK 后允许发起 AI 运行(无服务端环境变量)', async () => {
    const project = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: auth(),
      payload: { name: 'AI 项目', targetUrl: 'http://127.0.0.1:9/' },
    });
    const projectId = project.json().data.project.id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/runs`,
      headers: auth(),
      payload: { mode: 'ai', stepBudget: 3 },
    });
    expect(res.statusCode).toBe(201);
  });

  it('清除配置后,AI 运行被拒绝且提示去设置', async () => {
    const del = await app.inject({ method: 'DELETE', url: '/api/settings/model', headers: auth() });
    expect(del.statusCode).toBe(200);

    const project = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: auth(),
      payload: { name: 'AI 项目2', targetUrl: 'http://127.0.0.1:9/' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.json().data.project.id}/runs`,
      headers: auth(),
      payload: { mode: 'ai', stepBudget: 3 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('设置');
  });

  it('数据隔离:别人的配置读不到', async () => {
    const other = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'other-byok@testpilot.dev', password: 'password123' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings/model',
      headers: { authorization: `Bearer ${other.json().data.accessToken}` },
    });
    expect(res.json().data.config).toBeNull();
  });
});
