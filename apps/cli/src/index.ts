// CLI 入口:testpilot explore <url> | testpilot runner --token(shebang 由 tsup banner 注入)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { AndroidExecutor, WebExecutor, type ExplorerTarget } from '@testpilot/executor';
import { androidDetectors } from '@testpilot/detectors';
import {
  AiBrain,
  AndroidAiBrain,
  CaseRunner,
  CliBrain,
  CliWebAgent,
  Explorer,
  HeuristicBrain,
  generateCasesFromDoc,
  renderCaseReport,
  renderHtmlReport,
  type Brain,
} from '@testpilot/engine';
import { loadSuite } from './load-suite.js';

const program = new Command();

program
  .name('testpilot')
  .description('TestPilot — 本地 AI 测试工具:AI 自主探索 + 用例执行,支持 Web 与 Android')
  .version('0.2.0');

program
  .command('explore')
  .argument('<url>', '目标站点 URL')
  .option('-s, --steps <n>', '探索步数预算', '30')
  .option('-g, --goal <goal>', '探索目标描述,如「重点测试下单流程」')
  .option('-m, --mode <mode>', '探索模式:heuristic(免费爬行)| ai(需模型 key)| cli(用本机 claude 订阅)', 'heuristic')
  .option('--headed', '显示浏览器窗口', false)
  .option('-o, --out <dir>', '输出目录,默认 runs/<时间戳>')
  .action(async (url: string, opts) => {
    const { ensureChromium } = await import('./ensure-browser.js');
    ensureChromium();
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
  .command('explore-app')
  .description('探索 Android 应用(adb 驱动,需已连接模拟器/真机 + 多模态模型)')
  .argument('<package>', '应用包名或 deeplink,如 com.android.settings')
  .option('-s, --steps <n>', '探索步数预算', '20')
  .option('-g, --goal <goal>', '探索目标描述')
  .option('-d, --device <id>', 'adb 设备序列号,默认第一台')
  .option('-o, --out <dir>', '输出目录,默认 runs/<时间戳>')
  .action(async (pkg: string, opts) => {
    const outDir = path.resolve(
      opts.out ?? path.join('runs', new Date().toISOString().replace(/[:.]/g, '-')),
    );
    await mkdir(outDir, { recursive: true });

    const executor = new AndroidExecutor({ deviceId: opts.device });
    const brain = new AndroidAiBrain(executor);
    const explorer = new Explorer(executor, brain, {
      targetUrl: pkg,
      goal: opts.goal,
      stepBudget: Number(opts.steps),
      outDir,
      mode: 'ai',
      platform: 'android',
      detectors: androidDetectors,
      onProgress: (m) => console.log(m),
    });

    console.log(`📱 TestPilot 开始探索 App ${pkg}(预算:${opts.steps} 步)\n`);
    try {
      const report = await explorer.run();
      const htmlPath = path.join(outDir, 'report.html');
      await writeFile(htmlPath, renderHtmlReport(report), 'utf8');
      console.log(`\n✅ 完成:${report.stepsTaken} 步,发现 ${report.findings.length} 个缺陷`);
      console.log(`📄 报告:${htmlPath}`);
      if (report.findings.length > 0) process.exitCode = 2;
    } finally {
      await executor.dispose();
    }
  });

program
  .command('gen-cases')
  .description('从需求文档或 Figma 设计稿生成测试用例(.yaml),用本机 Claude CLI(零 API 成本)')
  .argument('[doc]', '需求文档路径(.md/.txt);用 --figma 时可省略')
  .option('--figma <url>', 'Figma 设计稿链接或 fileKey(经 Figma MCP,需 FIGMA_API_KEY)')
  .requiredOption('-t, --target <target>', '被测目标:web 填 URL,android 填包名')
  .option('-p, --platform <platform>', '平台:web | android', 'web')
  .option('-o, --out <file>', '输出用例文件路径', 'cases.yaml')
  .option('-n, --max <n>', '最多生成用例数', '8')
  .option('-f, --focus <focus>', '侧重描述,如「重点覆盖注册与支付」')
  .action(async (docPath: string | undefined, opts) => {
    const platform = opts.platform === 'android' ? 'android' : 'web';
    let doc: string;
    let kind: 'doc' | 'figma';
    if (opts.figma) {
      console.log(`🎨 经 Figma MCP 拉取设计数据(${opts.figma})…`);
      const { fetchFigmaContext } = await import('./figma.js');
      doc = await fetchFigmaContext(opts.figma);
      kind = 'figma';
    } else if (docPath) {
      doc = await readFile(path.resolve(docPath), 'utf8');
      kind = 'doc';
    } else {
      throw new Error('请提供需求文档路径,或用 --figma <链接> 指定 Figma 设计稿');
    }
    console.log(`📝 生成用例(${platform},来源 ${kind},本机 Claude CLI)…`);
    const suite = await generateCasesFromDoc({
      doc,
      kind,
      target: opts.target,
      platform,
      maxCases: Number(opts.max) || 8,
      focus: opts.focus,
    });
    const { stringify } = await import('yaml');
    const outPath = path.resolve(opts.out);
    await writeFile(outPath, stringify(suite), 'utf8');
    console.log(`✅ 生成 ${suite.cases.length} 条用例 → ${outPath}`);
    console.log(`   下一步:testpilot run-cases ${opts.out}`);
  });

program
  .command('run-cases')
  .description('执行测试用例文件(.yaml/.json),Web 或 Android')
  .argument('<file>', '用例文件路径')
  .option('-o, --out <dir>', '输出目录,默认 runs/<时间戳>')
  .option('-e, --engine <engine>', '决策引擎:cli(本机 Claude 订阅,零 API 成本)| midscene(多模态模型 key)', 'cli')
  .option('--headed', '显示浏览器窗口(仅 Web)', false)
  .action(async (file: string, opts) => {
    const suite = await loadSuite(path.resolve(file));
    const outDir = path.resolve(
      opts.out ?? path.join('runs', new Date().toISOString().replace(/[:.]/g, '-')),
    );
    await mkdir(outDir, { recursive: true });

    let target: ExplorerTarget;
    if (suite.platform === 'android') {
      target = new AndroidExecutor();
    } else {
      const { ensureChromium } = await import('./ensure-browser.js');
      ensureChromium();
      target = new WebExecutor({ headless: !opts.headed });
    }

    // 默认用本机 Claude CLI(零成本);--engine midscene 走多模态模型 key。
    // CLI 引擎目前仅 Web 支持(依赖 WebExecutor 元素树);Android 用例走 midscene。
    const useCli = opts.engine === 'cli' && suite.platform === 'web';
    const runner = new CaseRunner(target, suite, {
      outDir,
      agentFactory: useCli
        ? async (t) => new CliWebAgent(t as WebExecutor)
        : undefined,
      onProgress: (m) => console.log(m),
    });
    console.log(`引擎:${useCli ? '本机 Claude CLI' : '多模态模型(midscene)'}`);
    console.log(`🧪 执行 ${suite.cases.length} 条用例 → ${suite.target}(${suite.platform})\n`);
    try {
      const report = await runner.run();
      const htmlPath = path.join(outDir, 'cases.html');
      await writeFile(htmlPath, renderCaseReport(report), 'utf8');
      console.log(`\n✅ 完成:通过 ${report.passed} / 失败 ${report.failed} / 阻塞 ${report.blocked}(共 ${report.total})`);
      console.log(`📄 报告:${htmlPath}`);
      if (report.failed > 0) process.exitCode = 2;
    } finally {
      await target.dispose();
    }
  });

program.parseAsync().catch((err) => {
  console.error('❌ 运行失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
