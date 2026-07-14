import { randomBytes } from 'node:crypto';

export interface ServerConfig {
  port: number;
  jwtSecret: string;
  accessTokenTtl: string;
  refreshTokenTtl: string;
  corsOrigin: string;
  /** 运行产物(截图等)根目录,缺省为 <cwd>/data/artifacts */
  artifactsRoot?: string;
}

/** 启动时校验环境变量:生产环境缺 JWT_SECRET 直接拒绝启动 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const isProd = env.NODE_ENV === 'production';
  let jwtSecret = env.JWT_SECRET ?? '';

  if (!jwtSecret) {
    if (isProd) {
      throw new Error('生产环境必须设置 JWT_SECRET 环境变量');
    }
    jwtSecret = randomBytes(32).toString('hex');
    console.warn('⚠ 未设置 JWT_SECRET,已生成临时密钥(仅限开发,重启后所有会话失效)');
  }
  if (!env.DATABASE_URL) {
    throw new Error('必须设置 DATABASE_URL 环境变量(如 file:./dev.db)');
  }

  return {
    port: Number(env.PORT ?? 3100),
    jwtSecret,
    accessTokenTtl: env.ACCESS_TOKEN_TTL ?? '30m',
    refreshTokenTtl: env.REFRESH_TOKEN_TTL ?? '14d',
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5180',
    artifactsRoot: env.ARTIFACTS_ROOT,
  };
}
