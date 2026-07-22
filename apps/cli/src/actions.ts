import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AndroidExecutor, IosExecutor, WebExecutor, type ExplorerTarget } from '@testpilot/executor';
import { androidDetectors } from '@testpilot/detectors';
import {
  AiBrain,
  AndroidAiBrain,
  AndroidCliAgent,
  MobileAiBrain,
  CaseRunner,
  CliBrain,
  CliWebAgent,
  Explorer,
  HeuristicBrain,
  generateCasesFromDoc,
  renderCaseReport,
  renderCaseMarkdown,
  renderHtmlReport,
  renderMarkdownReport,
  type Brain,
  type SuiteTraces,
} from '@testpilot/engine';
import { loadSuite } from './load-suite.js';

const log = (m: string) => console.log(m);

function newOutDir(explicit?: string): string {
  return path.resolve(explicit ?? path.join('runs', new Date().toISOString().replace(/[:.]/g, '-')));
}

export interface ExploreOptions {
  url: string;
  mode: 'heuristic' | 'ai' | 'cli';
  goal?: string;
  steps: number;
  headed?: boolean;
  out?: string;
}

/** Web 自主探索 */
export async function runExplore(opts: ExploreOptions): Promise<void> {
  const { ensureChromium } = await import('./ensure-browser.js');
  ensureChromium();
  const outDir = newOutDir(opts.out);
  await mkdir(outDir, { recursive: true });

  const executor = new WebExecutor({ headless: !opts.headed });
  let brain: Brain;
  if (opts.mode === 'ai') brain = new AiBrain(executor);
  else if (opts.mode === 'cli') brain = new CliBrain(executor);
  else brain = new HeuristicBrain(executor, opts.url, opts.goal);
  const explorer = new Explorer(executor, brain, {
    targetUrl: opts.url,
    goal: opts.goal,
    stepBudget: opts.steps,
    outDir,
    mode: opts.mode,
    onProgress: log,
  });

  console.log(`🛰️  开始探索 ${opts.url}(模式:${opts.mode},预算:${opts.steps} 步)\n`);
  try {
    const report = await explorer.run();
    const htmlPath = path.join(outDir, 'report.html');
    await writeFile(htmlPath, renderHtmlReport(report), 'utf8');
    await writeFile(path.join(outDir, 'report.md'), renderMarkdownReport(report), 'utf8');
    console.log(`\n✅ 完成:${report.stepsTaken} 步,覆盖 ${report.visitedUrls.length} 个页面,发现 ${report.findings.length} 个缺陷`);
    console.log(`📄 报告:${htmlPath}`);
    console.log(`📝 Markdown:${htmlPath.replace(/\.html$/, '.md')}`);
    if (report.findings.length > 0) process.exitCode = 2;
  } finally {
    await executor.dispose();
  }
}

export interface ExploreAppOptions {
  pkg: string;
  goal?: string;
  steps: number;
  device?: string;
  out?: string;
}

/** Android 自主探索 */
export async function runExploreApp(opts: ExploreAppOptions): Promise<void> {
  const outDir = newOutDir(opts.out);
  await mkdir(outDir, { recursive: true });

  const executor = new AndroidExecutor({ deviceId: opts.device });
  const brain = new AndroidAiBrain(executor);
  const explorer = new Explorer(executor, brain, {
    targetUrl: opts.pkg,
    goal: opts.goal,
    stepBudget: opts.steps,
    outDir,
    mode: 'ai',
    platform: 'android',
    detectors: androidDetectors,
    onProgress: log,
  });

  console.log(`📱 开始探索 App ${opts.pkg}(预算:${opts.steps} 步)\n`);
  try {
    const report = await explorer.run();
    const htmlPath = path.join(outDir, 'report.html');
    await writeFile(htmlPath, renderHtmlReport(report), 'utf8');
    await writeFile(path.join(outDir, 'report.md'), renderMarkdownReport(report), 'utf8');
    console.log(`\n✅ 完成:${report.stepsTaken} 步,发现 ${report.findings.length} 个缺陷`);
    console.log(`📄 报告:${htmlPath}`);
    console.log(`📝 Markdown:${htmlPath.replace(/\.html$/, '.md')}`);
    if (report.findings.length > 0) process.exitCode = 2;
  } finally {
    await executor.dispose();
  }
}

export interface ExploreIosOptions {
  /** bundle id,如 com.apple.Preferences */
  bundleId: string;
  goal?: string;
  steps: number;
  device?: string;
  out?: string;
}

/** iOS 自主探索(仅 macOS,视觉驱动需模型) */
export async function runExploreIos(opts: ExploreIosOptions): Promise<void> {
  const outDir = newOutDir(opts.out);
  await mkdir(outDir, { recursive: true });

  const executor = new IosExecutor({ deviceId: opts.device });
  const brain = new MobileAiBrain(executor);
  const explorer = new Explorer(executor, brain, {
    targetUrl: opts.bundleId,
    goal: opts.goal,
    stepBudget: opts.steps,
    outDir,
    mode: 'ai',
    platform: 'android', // 报告文案层面按移动端处理
    onProgress: log,
  });

  console.log(`🍎 开始探索 iOS App ${opts.bundleId}(预算:${opts.steps} 步)\n`);
  try {
    const report = await explorer.run();
    const htmlPath = path.join(outDir, 'report.html');
    await writeFile(htmlPath, renderHtmlReport(report), 'utf8');
    await writeFile(path.join(outDir, 'report.md'), renderMarkdownReport(report), 'utf8');
    console.log(`\n✅ 完成:${report.stepsTaken} 步,发现 ${report.findings.length} 个缺陷`);
    console.log(`📄 报告:${htmlPath}`);
    console.log(`📝 Markdown:${htmlPath.replace(/\.html$/, '.md')}`);
    if (report.findings.length > 0) process.exitCode = 2;
  } finally {
    await executor.dispose();
  }
}

export interface GenCasesOptions {
  /** 需求文档路径(功能规格,.md/.txt/.pdf/.docx),可与 figma 同时提供 */
  docPath?: string;
  /** Figma 链接/fileKey(UI 规格),可与 docPath 同时提供 */
  figma?: string;
  figmaSource?: 'desktop' | 'token';
  out: string;
  max?: number;
  focus?: string;
  /** 起始状态,如「已登录,从主页开始」;决定是否生成登录步骤 */
  precondition?: string;
}

/** 从需求文档 +/或 Figma 生成用例(可同时,功能+UI 合并),返回落盘路径 */
export async function runGenCases(opts: GenCasesOptions): Promise<string> {
  const parts: string[] = [];

  if (opts.docPath) {
    const { readDoc } = await import('./read-doc.js');
    console.log(`📄 读取需求文档:${opts.docPath}`);
    parts.push(`【需求文档 · 功能规格】\n${await readDoc(opts.docPath)}`);
  }
  if (opts.figma) {
    const source = opts.figmaSource ?? 'desktop';
    console.log(`🎨 经 Figma MCP 拉取设计数据(${source === 'desktop' ? '桌面授权,无需 token' : '个人令牌'})…`);
    const { fetchFigmaContext } = await import('./figma.js');
    parts.push(`【Figma 设计稿 · UI 规格】\n${await fetchFigmaContext(opts.figma, { source })}`);
  }
  if (parts.length === 0) {
    throw new Error('请至少提供需求文档路径,或指定 Figma 设计稿(两者可同时提供)');
  }

  const kind: 'doc' | 'figma' | 'both' =
    opts.docPath && opts.figma ? 'both' : opts.docPath ? 'doc' : 'figma';
  console.log(`📝 生成用例(来源 ${kind},本机 Claude CLI)…`);
  const suite = await generateCasesFromDoc({
    doc: parts.join('\n\n'),
    kind,
    maxCases: opts.max ?? 8,
    focus: opts.focus,
    precondition: opts.precondition,
  });
  const { stringify } = await import('yaml');
  const outPath = path.resolve(opts.out);
  await writeFile(outPath, stringify(suite), 'utf8');
  console.log(`✅ 生成 ${suite.cases.length} 条用例 → ${outPath}`);
  return outPath;
}

export interface RunCasesOptions {
  file: string;
  engine: 'cli' | 'midscene';
  /** 执行目标:web=URL,android=包名;覆盖用例文件里的值 */
  target: string;
  /** 平台;覆盖用例文件里的值 */
  platform: 'web' | 'android';
  /** Android adb 设备序列号(多设备时指定) */
  deviceId?: string;
  headed?: boolean;
  out?: string;
}

/** 轨迹文件路径:cases.yaml → cases.trace.json(与用例文件同目录) */
function traceFileOf(caseFile: string): string {
  const resolved = path.resolve(caseFile);
  const ext = path.extname(resolved);
  return `${ext ? resolved.slice(0, -ext.length) : resolved}.trace.json`;
}

/** 执行用例文件(目标与平台在此提供,不依赖用例文件里是否绑定) */
export async function runCases(opts: RunCasesOptions): Promise<void> {
  const loaded = await loadSuite(path.resolve(opts.file));
  const suite = { ...loaded, target: opts.target, platform: opts.platform };
  const outDir = newOutDir(opts.out);
  await mkdir(outDir, { recursive: true });

  // 上次运行录制的动作轨迹:命中则秒级回放,省去 AI 找路(改过的步骤自动失效)
  const traceFile = traceFileOf(opts.file);
  let traces: SuiteTraces | undefined;
  try {
    const { readFile } = await import('node:fs/promises');
    traces = JSON.parse(await readFile(traceFile, 'utf8')) as SuiteTraces;
    console.log(`⚡ 发现上次运行轨迹,将优先回放:${traceFile}`);
  } catch {
    // 没有轨迹文件:首跑,全程 AI
  }

  let target: ExplorerTarget;
  if (opts.platform === 'android') {
    target = new AndroidExecutor({ deviceId: opts.deviceId });
  } else {
    const { ensureChromium } = await import('./ensure-browser.js');
    ensureChromium();
    target = new WebExecutor({ headless: !opts.headed });
  }

  // CLI 引擎:Web 用 CliWebAgent,Android 用 AndroidCliAgent(uiautomator 元素 + adb)
  const useCli = opts.engine === 'cli';
  const agentFactory = useCli
    ? async (t: ExplorerTarget) =>
        opts.platform === 'android'
          ? new AndroidCliAgent(t as AndroidExecutor)
          : new CliWebAgent(t as WebExecutor)
    : undefined;
  const runner = new CaseRunner(target, suite, { outDir, agentFactory, traces, onProgress: log });
  console.log(`引擎:${useCli ? '本机 Claude CLI' : '多模态模型(midscene)'}`);
  console.log(`🧪 执行 ${suite.cases.length} 条用例 → ${opts.target}(${opts.platform})\n`);
  try {
    const report = await runner.run();

    // 把本次通过步骤的轨迹合并存盘(按步覆盖),下次重跑可秒级回放
    if (Object.keys(runner.traces).length > 0) {
      const merged: SuiteTraces = { ...traces };
      for (const [caseId, stepTraces] of Object.entries(runner.traces)) {
        const list = [...(merged[caseId] ?? [])];
        stepTraces.forEach((t, i) => {
          if (t) list[i] = t;
        });
        merged[caseId] = list;
      }
      await writeFile(traceFile, JSON.stringify(merged, null, 2), 'utf8');
      console.log(`⚡ 已保存运行轨迹 → ${traceFile}(下次重跑自动回放提速)`);
    }
    const htmlPath = path.join(outDir, 'cases.html');
    await writeFile(htmlPath, renderCaseReport(report), 'utf8');
    await writeFile(path.join(outDir, 'cases.md'), renderCaseMarkdown(report), 'utf8');
    console.log(`\n✅ 完成:通过 ${report.passed} / 失败 ${report.failed} / 阻塞 ${report.blocked}(共 ${report.total})`);
    console.log(`📄 报告:${htmlPath}`);
    console.log(`📝 Markdown:${htmlPath.replace(/\.html$/, '.md')}`);
    if (report.failed > 0) process.exitCode = 2;
  } finally {
    await target.dispose();
  }
}
