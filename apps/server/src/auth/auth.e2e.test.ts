import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
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
};

describe('认证接口端到端', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;

  beforeAll(async () => {
    // 每次测试用独立的临时 SQLite,push schema 后连接
    const dbFile = path.join(mkdtempSync(path.join(os.tmpdir(), 'testpilot-db-')), 'test.db');
    const databaseUrl = `file:${dbFile}`;
    execSync('pnpm exec prisma db push --skip-generate', {
      cwd: path.resolve(import.meta.dirname, '../..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'ignore',
    });
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    app = await buildApp(TEST_CONFIG, prisma);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const register = (email: string, password: string) =>
    app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password } });

  it('注册成功返回用户与令牌,第一个用户是 admin', async () => {
    const res = await register('boss@testpilot.dev', 'password123');
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.user.role).toBe('admin');
    expect(body.data.accessToken).toBeTruthy();
    expect(body.data.refreshToken).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain('passwordHash');
  });

  it('第二个用户是普通 user,邮箱大小写归一化', async () => {
    const res = await register('  Member@Testpilot.DEV ', 'password123');
    expect(res.statusCode).toBe(201);
    expect(res.json().data.user.role).toBe('user');
    expect(res.json().data.user.email).toBe('member@testpilot.dev');
  });

  it('重复邮箱注册 → 409', async () => {
    const res = await register('boss@testpilot.dev', 'password456');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('已被注册');
  });

  it('非法邮箱 / 短密码 → 400 且提示可读', async () => {
    expect((await register('not-an-email', 'password123')).statusCode).toBe(400);
    const short = await register('x@y.com', '123');
    expect(short.statusCode).toBe(400);
    expect(short.json().error).toContain('至少');
  });

  it('登录成功;密码错误统一返回 401 不暴露邮箱是否存在', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'boss@testpilot.dev', password: 'password123' },
    });
    expect(ok.statusCode).toBe(200);

    const wrongPw = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'boss@testpilot.dev', password: 'wrong-password' },
    });
    const noUser = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ghost@testpilot.dev', password: 'password123' },
    });
    expect(wrongPw.statusCode).toBe(401);
    expect(noUser.statusCode).toBe(401);
    expect(wrongPw.json().error).toBe(noUser.json().error);
  });

  it('me:带 token 返回用户;无 token / 坏 token → 401', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'boss@testpilot.dev', password: 'password123' },
    });
    const token = login.json().data.accessToken as string;

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.user.email).toBe('boss@testpilot.dev');

    expect((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { authorization: 'Bearer bad.token.here' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('refresh 换发新令牌;access token 不能当 refresh 用', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'boss@testpilot.dev', password: 'password123' },
    });
    const { accessToken, refreshToken } = login.json().data;

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().data.accessToken).toBeTruthy();

    const misuse = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: accessToken },
    });
    expect(misuse.statusCode).toBe(401);
  });

  it('被禁用的账号无法登录', async () => {
    await prisma.user.update({
      where: { email: 'member@testpilot.dev' },
      data: { status: 'disabled' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'member@testpilot.dev', password: 'password123' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('禁用');
  });

  it('登录接口按 IP 限流(10 次/分钟)→ 429', async () => {
    const results: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'boss@testpilot.dev', password: 'wrong-password' },
        remoteAddress: '10.9.9.9',
      });
      results.push(res.statusCode);
    }
    expect(results).toContain(429);
  });
});
