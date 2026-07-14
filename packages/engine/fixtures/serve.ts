#!/usr/bin/env tsx
/** 常驻启动演示用带 Bug 站点:pnpm --filter @testpilot/engine demo:site */
import { startBuggySite } from './buggy-site.js';

const site = await startBuggySite(Number(process.env.PORT ?? 8899));
console.log(`🐞 演示站点(埋有 JS 报错 / 接口 500 / 死链):${site.url}`);
console.log('Ctrl+C 退出');
process.on('SIGINT', async () => {
  await site.close();
  process.exit(0);
});
