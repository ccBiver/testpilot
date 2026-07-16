// pm2 守护本地开发服务:pm2 start ecosystem.config.cjs
// 与编辑器/AI 会话解耦,进程崩溃自动拉起。日志:pm2 logs testpilot-api
const PNPM = '/Users/biver/.nvm/versions/node/v22.21.0/bin/pnpm';

module.exports = {
  apps: [
    {
      name: 'testpilot-api',
      cwd: `${__dirname}/apps/server`,
      script: PNPM,
      args: 'dev',
      interpreter: 'none',
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: 'testpilot-web',
      cwd: `${__dirname}/apps/web`,
      script: PNPM,
      args: 'dev',
      interpreter: 'none',
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: 'testpilot-admin',
      cwd: `${__dirname}/apps/admin`,
      script: PNPM,
      args: 'dev',
      interpreter: 'none',
      autorestart: true,
      max_restarts: 10,
    },
  ],
};
