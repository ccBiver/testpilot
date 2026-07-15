import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium } from 'playwright';

/**
 * 确保 Chromium 就绪:npx/全新安装的机器没有浏览器缓存,
 * 首次运行自动执行 playwright install chromium(约 100MB,仅一次)。
 */
export function ensureChromium(log: (m: string) => void = console.log): void {
  try {
    if (existsSync(chromium.executablePath())) return;
  } catch {
    // executablePath 在未安装时也可能直接抛错,继续走安装
  }

  log('🧩 首次运行:正在下载 Chromium 浏览器(约 100MB,仅需一次)…');
  const require = createRequire(import.meta.url);
  const cliPath = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
  const result = spawnSync(process.execPath, [cliPath, 'install', 'chromium'], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error('Chromium 下载失败,请手动执行:npx playwright install chromium');
  }
  log('✅ 浏览器就绪');
}
