import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { getPrisma, disposePrisma } from './db.js';
import { buildApp } from './app.js';

// tsx 不自动加载 .env,用 Node 内置 loadEnvFile
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  // 无 .env 时依赖真实环境变量,由 loadConfig 校验
}

const config = loadConfig();
const app = await buildApp(config, getPrisma());

try {
  await app.listen({ port: config.port, host: '127.0.0.1' });
  console.log(`🛰  TestPilot API 已启动:http://127.0.0.1:${config.port}`);
} catch (err) {
  app.log.error(err);
  await disposePrisma();
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await disposePrisma();
    process.exit(0);
  });
}
