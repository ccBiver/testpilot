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
  jwtSecret: 'test-secret-admin',
  accessTokenTtl: '5m',
  refreshTokenTtl: '1d',
  corsOrigin: '*',
};

describe('管理后台接口', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let adminToken: string;
  let memberToken: string;
  let memberId: string;

  beforeAll(async () => {
    const dbFile = path.join(mkdtempSync(path.join(os.tmpdir(), 'testpilot-admin-')), 'test.db');
    const databaseUrl = `file:${dbFile}`;
    execSync('pnpm exec prisma db push --skip-generate', {
      cwd: path.resolve(import.meta.dirname, '../..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'ignore',
    });
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    app = await buildApp({ ...TEST_CONFIG, artifactsRoot: mkdtempSync(path.join(os.tmpdir(), 'tp-art-')) }, prisma);

    const register = async (email: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email, password: 'password123' },
      });
      return res.json().data;
    };
    const admin = await register('root@testpilot.dev'); // 第一个用户自动 admin
    const member = await register('member@testpilot.dev');
    adminToken = admin.accessToken;
    memberToken = member.accessToken;
    memberId = member.user.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const get = (url: string, token: string) =>
    app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

  it('普通用户访问管理接口 → 403', async () => {
    for (const url of ['/api/admin/stats', '/api/admin/users', '/api/admin/runs']) {
      expect((await get(url, memberToken)).statusCode).toBe(403);
    }
  });

  it('管理员可读统计与用户列表', async () => {
    const stats = await get('/api/admin/stats', adminToken);
    expect(stats.statusCode).toBe(200);
    expect(stats.json().data.stats.users).toBe(2);

    const users = await get('/api/admin/users', adminToken);
    expect(users.statusCode).toBe(200);
    const list = users.json().data.users;
    expect(list).toHaveLength(2);
    expect(list.some((u: { role: string }) => u.role === 'admin')).toBe(true);
    expect(JSON.stringify(list)).not.toContain('passwordHash');
  });

  it('禁用用户后其登录被拒,管理接口对其失效;可重新启用', async () => {
    const disable = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${memberId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { status: 'disabled' },
    });
    expect(disable.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'member@testpilot.dev', password: 'password123' },
    });
    expect(login.statusCode).toBe(403);

    const enable = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${memberId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { status: 'active' },
    });
    expect(enable.statusCode).toBe(200);
    const loginAgain = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'member@testpilot.dev', password: 'password123' },
    });
    expect(loginAgain.statusCode).toBe(200);
  });

  it('管理员不能禁用自己;目标不存在 → 404', async () => {
    const meRes = await get('/api/auth/me', adminToken);
    const selfId = meRes.json().data.user.id;
    const self = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${selfId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { status: 'disabled' },
    });
    expect(self.statusCode).toBe(400);

    const ghost = await app.inject({
      method: 'PATCH',
      url: '/api/admin/users/no-such-id',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { status: 'disabled' },
    });
    expect(ghost.statusCode).toBe(404);
  });

  it('被禁用的管理员 token 立即失效(守卫查库)', async () => {
    // 再注册一个用户提升为 admin,禁用后验证其管理权限失效
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'admin2@testpilot.dev', password: 'password123' },
    });
    const { user, accessToken } = second.json().data;
    await prisma.user.update({ where: { id: user.id }, data: { role: 'admin' } });
    expect((await get('/api/admin/stats', accessToken)).statusCode).toBe(200);

    await prisma.user.update({ where: { id: user.id }, data: { status: 'disabled' } });
    expect((await get('/api/admin/stats', accessToken)).statusCode).toBe(403);
  });
});
