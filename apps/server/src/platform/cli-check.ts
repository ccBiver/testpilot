import { execFile } from 'node:child_process';

let cached: { at: number; ok: boolean } | null = null;

/**
 * 执行机(本进程所在机器)是否可用 claude CLI。
 * CLI 模式 + 平台执行 仅在自托管部署(服务器装有 Claude Code)时有意义,
 * 云端 SaaS 部署会自然拦截。结果缓存 60s。
 */
export async function serverHasClaudeCli(): Promise<boolean> {
  if (process.env.TESTPILOT_FORCE_NO_CLI === '1') return false; // 供测试模拟云端环境
  if (cached && Date.now() - cached.at < 60_000) return cached.ok;
  const ok = await new Promise<boolean>((resolve) => {
    execFile('claude', ['--version'], { timeout: 5000 }, (err) => resolve(!err));
  });
  cached = { at: Date.now(), ok };
  return ok;
}
