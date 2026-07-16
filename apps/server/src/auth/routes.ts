import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, type AuthService, type AccessPayload } from './service.js';

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email('请输入有效的邮箱地址'),
  password: z.string().min(8, '密码至少需要 8 位').max(72, '密码过长'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, '缺少刷新令牌'),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, '请输入当前密码'),
  newPassword: z.string().min(8, '新密码至少需要 8 位').max(72, '密码过长'),
});

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AccessPayload;
  }
}

/** Bearer 认证守卫 */
export function makeRequireAuth(auth: AuthService) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return reply.code(401).send({ ok: false, error: '未登录' });
    try {
      req.authUser = auth.verifyAccess(token);
    } catch (err) {
      const message = err instanceof AuthError ? err.message : '认证失败';
      return reply.code(401).send({ ok: false, error: message });
    }
  };
}

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService): void {
  const requireAuth = makeRequireAuth(auth);
  // 登录/注册按 IP 限流,防撞库
  const authRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  app.post('/api/auth/register', { config: authRateLimit }, async (req, reply) => {
    const body = credentialsSchema.parse(req.body);
    const result = await auth.register(body.email, body.password);
    return reply.code(201).send({ ok: true, data: result });
  });

  app.post('/api/auth/login', { config: authRateLimit }, async (req, reply) => {
    const body = credentialsSchema.parse(req.body);
    const result = await auth.login(body.email, body.password);
    return reply.send({ ok: true, data: result });
  });

  app.post('/api/auth/refresh', async (req, reply) => {
    const body = refreshSchema.parse(req.body);
    const result = await auth.refresh(body.refreshToken);
    return reply.send({ ok: true, data: result });
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const user = await auth.me(req.authUser!.sub);
    return reply.send({ ok: true, data: { user } });
  });

  app.put('/api/auth/password', { preHandler: requireAuth }, async (req, reply) => {
    const body = changePasswordSchema.parse(req.body);
    await auth.changePassword(req.authUser!.sub, body.oldPassword, body.newPassword);
    return reply.send({ ok: true, data: { changed: true } });
  });
}
