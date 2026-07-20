// CLI 入口:直接 `testpilot` 进交互向导;子命令供脚本化/老手用(shebang 由 tsup banner 注入)
import { Command } from 'commander';
import { runCases, runExplore, runExploreApp, runExploreIos, runGenCases } from './actions.js';

const program = new Command();

program
  .name('testpilot')
  .description('TestPilot — 本地 AI 测试工具:AI 自主探索 + 用例执行,支持 Web 与 Android')
  .version('0.2.0');

// 无子命令 → 交互式向导(一步步问答,无需记 flag)
program
  .action(async () => {
    const { runWizard } = await import('./wizard.js');
    await runWizard();
  });

program
  .command('explore')
  .description('AI 自主探索 Web 站点')
  .argument('<url>', '目标站点 URL')
  .option('-s, --steps <n>', '探索步数预算', '30')
  .option('-g, --goal <goal>', '探索目标描述,如「重点测试下单流程」')
  .option('-m, --mode <mode>', '引擎:heuristic(免费爬行)| ai(模型 key)| cli(本机 claude)', 'cli')
  .option('--headed', '显示浏览器窗口', false)
  .option('-o, --out <dir>', '输出目录,默认 runs/<时间戳>')
  .action((url: string, opts) =>
    runExplore({
      url,
      mode: opts.mode === 'ai' ? 'ai' : opts.mode === 'heuristic' ? 'heuristic' : 'cli',
      goal: opts.goal,
      steps: Number(opts.steps) || 30,
      headed: opts.headed,
      out: opts.out,
    }),
  );

program
  .command('explore-app')
  .description('AI 自主探索 Android 应用(adb 驱动,需模拟器/真机)')
  .argument('<package>', '应用包名,如 com.android.settings')
  .option('-s, --steps <n>', '探索步数预算', '20')
  .option('-g, --goal <goal>', '探索目标描述')
  .option('-d, --device <id>', 'adb 设备序列号,默认第一台')
  .option('-o, --out <dir>', '输出目录')
  .action((pkg: string, opts) =>
    runExploreApp({ pkg, goal: opts.goal, steps: Number(opts.steps) || 20, device: opts.device, out: opts.out }),
  );

program
  .command('explore-ios')
  .description('AI 自主探索 iOS 应用(仅 macOS,需 Xcode + 模拟器 + 多模态模型)')
  .argument('<bundleId>', 'App bundle id,如 com.apple.Preferences')
  .option('-s, --steps <n>', '探索步数预算', '20')
  .option('-g, --goal <goal>', '探索目标描述')
  .option('-d, --device <id>', '模拟器 udid,默认已启动的')
  .option('-o, --out <dir>', '输出目录')
  .action((bundleId: string, opts) =>
    runExploreIos({ bundleId, goal: opts.goal, steps: Number(opts.steps) || 20, device: opts.device, out: opts.out }),
  );

program
  .command('gen-cases')
  .description('从需求文档或 Figma 设计稿生成测试用例(.yaml)')
  .argument('[doc]', '需求文档路径(.md/.txt);用 --figma 时可省略')
  .option('--figma <url>', 'Figma 链接或 fileKey(默认桌面 App 授权,无需 token)')
  .option('--figma-token', '改用个人令牌方式(需 FIGMA_API_KEY)', false)
  .requiredOption('-t, --target <target>', '被测目标:web 填 URL,android 填包名')
  .option('-p, --platform <platform>', '平台:web | android', 'web')
  .option('-o, --out <file>', '输出用例文件路径', 'cases.yaml')
  .option('-n, --max <n>', '最多生成用例数', '8')
  .option('-f, --focus <focus>', '侧重描述')
  .action(async (docPath: string | undefined, opts) => {
    await runGenCases({
      docPath,
      figma: opts.figma,
      figmaSource: opts.figmaToken ? 'token' : 'desktop',
      target: opts.target,
      platform: opts.platform === 'android' ? 'android' : 'web',
      out: opts.out,
      max: Number(opts.max) || 8,
      focus: opts.focus,
    });
    console.log(`   下一步:testpilot run-cases ${opts.out}`);
  });

program
  .command('run-cases')
  .description('执行测试用例文件(.yaml/.json)')
  .argument('<file>', '用例文件路径')
  .option('-o, --out <dir>', '输出目录')
  .option('-e, --engine <engine>', '引擎:cli(本机 Claude)| midscene(模型 key)', 'cli')
  .option('--headed', '显示浏览器窗口(仅 Web)', false)
  .action((file: string, opts) =>
    runCases({ file, engine: opts.engine === 'midscene' ? 'midscene' : 'cli', headed: opts.headed, out: opts.out }),
  );

program.parseAsync().catch((err) => {
  console.error('❌ 运行失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
