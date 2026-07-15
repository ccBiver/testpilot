#!/usr/bin/env tsx
// CLI 入口:testpilot explore <url>
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { WebExecutor } from '@testpilot/executor';
import { AiBrain, CliBrain, Explorer, HeuristicBrain, renderHtmlReport, type Brain } from '@testpilot/engine';

const program = new Command();

program
  .name('testpilot')
  .description('TestPilot — AI 自主探索测试 CLI(M0)');

program
  .command('explore')
  .argument('<url>', '目标站点 URL')
  .option('-s, --steps <n>', '探索步数预算', '30')
  .option('-g, --goal <goal>', '探索目标描述,如「重点测试下单流程」')
  .option('-m, --mode <mode>', '探索模式:heuristic(免费爬行)| ai(需模型 key)| cli(用本机 claude 订阅)', 'heuristic')
  .option('--headed', '显示浏览器窗口', false)
  .option('-o, --out <dir>', '输出目录,默认 runs/<时间戳>')
  .action(async (url: string, opts) => {
    const mode = opts.mode === 'ai' ? 'ai' : opts.mode === 'cli' ? 'cli' : 'heuristic';
    const outDir = path.resolve(
      opts.out ?? path.join('runs', new Date().toISOString().replace(/[:.]/g, '-')),
    );
    await mkdir(outDir, { recursive: true });

    const executor = new WebExecutor({ headless: !opts.headed });
    let brain: Brain;
    if (mode === 'ai') brain = new AiBrain(executor);
    else if (mode === 'cli') brain = new CliBrain(executor);
    else brain = new HeuristicBrain(executor, url, opts.goal);
    const explorer = new Explorer(executor, brain, {
      targetUrl: url,
      goal: opts.goal,
      stepBudget: Number(opts.steps),
      outDir,
      mode,
      onProgress: (m) => console.log(m),
    });

    console.log(`🛰️  TestPilot 开始探索 ${url}(模式:${mode},预算:${opts.steps} 步)\n`);
    try {
      const report = await explorer.run();
      const htmlPath = path.join(outDir, 'report.html');
      await writeFile(htmlPath, renderHtmlReport(report), 'utf8');
      console.log(`\n✅ 完成:${report.stepsTaken} 步,覆盖 ${report.visitedUrls.length} 个页面,发现 ${report.findings.length} 个缺陷`);
      console.log(`📄 报告:${htmlPath}`);
      if (report.findings.length > 0) process.exitCode = 2; // 供 CI 判定
    } finally {
      await executor.dispose();
    }
  });

program
  .command('runner')
  .description('启动自托管 Runner:领取平台任务在本机执行(可用本机 claude 订阅与内网)')
  .requiredOption('-t, --token <token>', 'Runner Token(控制台「设置」页创建,tpr_ 开头)')
  .option('--server <url>', '平台地址', 'http://localhost:3100')
  .action(async (opts) => {
    const { Runner } = await import('./runner.js');
    const runner = new Runner({ serverUrl: opts.server, token: opts.token });
    process.on('SIGINT', () => {
      console.log('\n👋 Runner 退出');
      runner.stop();
      process.exit(0);
    });
    await runner.loop();
  });

program.parseAsync().catch((err) => {
  console.error('❌ 运行失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
