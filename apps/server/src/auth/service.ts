import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { PrismaClient, User } from '@prisma/client';
import type { ServerConfig } from '../config.js';

export interface PublicUser {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AccessPayload {
  sub: string;
  email: string;
  role: string;
  typ: 'access';
}

export class AuthError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: ServerConfig,
  ) {}

  /** 注册:邮箱唯一;第一个注册的用户自动成为 admin */
  async register(email: string, password: string): Promise<{ user: PublicUser } & TokenPair> {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) throw new AuthError(409, '该邮箱已被注册');

    const userCount = await this.prisma.user.count();
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        role: userCount === 0 ? 'admin' : 'user',
      },
    });
    return { user: toPublicUser(user), ...this.issueTokens(user) };
  }

  async login(email: string, password: string): Promise<{ user: PublicUser } & TokenPair> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    // 统一报错文案,不暴露「邮箱是否存在」
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new AuthError(401, '邮箱或密码不正确');
    }
    if (user.status !== 'active') throw new AuthError(403, '账号已被禁用,请联系管理员');
    return { user: toPublicUser(user), ...this.issueTokens(user) };
  }

  /** 刷新:校验 refresh token 并重新查库(角色/禁用状态以最新为准) */
  async refresh(refreshToken: string): Promise<{ user: PublicUser } & TokenPair> {
    const payload = this.verifyToken(refreshToken);
    if (payload.typ !== 'refresh') throw new AuthError(401, '无效的刷新令牌');
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new AuthError(401, '用户不存在');
    if (user.status !== 'active') throw new AuthError(403, '账号已被禁用,请联系管理员');
    return { user: toPublicUser(user), ...this.issueTokens(user) };
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AuthError(401, '用户不存在');
    return toPublicUser(user);
  }

  /** 校验 Bearer access token,守卫用 */
  verifyAccess(token: string): AccessPayload {
    const payload = this.verifyToken(token);
    if (payload.typ !== 'access') throw new AuthError(401, '无效的访问令牌');
    return payload as AccessPayload;
  }

  private issueTokens(user: User): TokenPair {
    const accessToken = jwt.sign(
      { sub: user.id, email: user.email, role: user.role, typ: 'access' },
      this.config.jwtSecret,
      { expiresIn: this.config.accessTokenTtl } as jwt.SignOptions,
    );
    const refreshToken = jwt.sign(
      { sub: user.id, typ: 'refresh' },
      this.config.jwtSecret,
      { expiresIn: this.config.refreshTokenTtl } as jwt.SignOptions,
    );
    return { accessToken, refreshToken };
  }

  private verifyToken(token: string): { sub: string; typ: string; email?: string; role?: string } {
    try {
      return jwt.verify(token, this.config.jwtSecret) as {
        sub: string;
        typ: string;
        email?: string;
        role?: string;
      };
    } catch {
      throw new AuthError(401, '令牌无效或已过期');
    }
  }
}
