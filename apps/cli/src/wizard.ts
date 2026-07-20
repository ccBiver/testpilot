import * as p from '@clack/prompts';
import {
  runCases,
  runExplore,
  runExploreApp,
  runExploreIos,
  runGenCases,
  type GenCasesOptions,
} from './actions.js';

const isMac = process.platform === 'darwin';

const DEPTH_STEPS = { quick: 15, standard: 30, deep: 60 } as const;

function cancelled(v: unknown): boolean {
  if (p.isCancel(v)) {
    p.cancel('已取消');
    return true;
  }
  return false;
}

/** 交互式向导:直接 `testpilot`,一步步问答后执行,无需记命令与 flag */
export async function runWizard(): Promise<void> {
  console.clear();
  p.intro('🛰  TestPilot — 本地 AI 测试工具');

  const task = await p.select({
    message: '你想做什么?',
    options: [
      { value: 'explore', label: 'AI 自主探索', hint: '自动点点点找 Bug,无需写用例' },
      { value: 'gen', label: '生成测试用例', hint: '从需求文档 / Figma 设计稿' },
      { value: 'run', label: '执行测试用例', hint: '跑已有的 .yaml/.json 用例' },
    ],
  });
  if (cancelled(task)) return;

  if (task === 'explore') return wizardExplore();
  if (task === 'gen') return wizardGen();
  return wizardRun();
}

async function wizardExplore(): Promise<void> {
  const platform = await p.select({
    message: '测什么平台?',
    options: [
      { value: 'web', label: 'Web 网站' },
      { value: 'android', label: 'Android 应用', hint: '需已连接模拟器/真机' },
      { value: 'ios', label: 'iOS 应用', hint: isMac ? '需 Xcode + 模拟器' : '仅 macOS,当前系统不支持' },
    ],
  });
  if (cancelled(platform)) return;

  if (platform === 'ios') {
    if (!isMac) {
      p.outro('iOS 测试仅支持 macOS(需 Xcode + 模拟器 + WebDriverAgent)');
      return;
    }
    const bundleId = await p.text({ message: 'App bundle id', placeholder: 'com.apple.Preferences' });
    if (cancelled(bundleId)) return;
    const goal = await p.text({ message: '探索目标(可选)', placeholder: '回车跳过' });
    if (cancelled(goal)) return;
    const depth = await pickDepth();
    if (depth === null) return;
    if (!(await confirmRun(`iOS 探索 ${String(bundleId)}`))) return;
    await runExploreIos({ bundleId: String(bundleId), goal: goal ? String(goal) : undefined, steps: depth });
    return;
  }

  if (platform === 'android') {
    const pkg = await p.text({ message: '应用包名', placeholder: 'com.example.app' });
    if (cancelled(pkg)) return;
    const goal = await p.text({ message: '探索目标(可选)', placeholder: '重点测试注册流程,回车跳过' });
    if (cancelled(goal)) return;
    const depth = await pickDepth();
    if (depth === null) return;
    if (!(await confirmRun(`Android 探索 ${String(pkg)}`))) return;
    await runExploreApp({ pkg: String(pkg), goal: goal ? String(goal) : undefined, steps: depth });
    return;
  }

  const url = await p.text({ message: '网站地址', placeholder: 'https://example.com', validate: reqUrl });
  if (cancelled(url)) return;
  const mode = await p.select({
    message: '用什么引擎?',
    options: [
      { value: 'cli', label: '本机 Claude(推荐)', hint: '零 API 成本,看截图智能操作' },
      { value: 'ai', label: '多模态模型', hint: '需配 OPENAI_API_KEY,更快' },
      { value: 'heuristic', label: '启发式冒烟', hint: '纯爬行,不用模型,最快' },
    ],
  });
  if (cancelled(mode)) return;
  const goal = await p.text({ message: '探索目标(可选)', placeholder: '重点测试注册流程,回车跳过' });
  if (cancelled(goal)) return;
  const depth = await pickDepth();
  if (depth === null) return;
  if (!(await confirmRun(`探索 ${String(url)}`))) return;
  await runExplore({
    url: String(url),
    mode: mode as 'cli' | 'ai' | 'heuristic',
    goal: goal ? String(goal) : undefined,
    steps: depth,
  });
}

async function wizardGen(): Promise<void> {
  const source = await p.select({
    message: '用例从哪里生成?',
    options: [
      { value: 'doc', label: '需求文档', hint: '.md / .txt 文件' },
      { value: 'figma', label: 'Figma 设计稿', hint: '经 Figma MCP' },
    ],
  });
  if (cancelled(source)) return;

  const gen: Partial<GenCasesOptions> = {};
  if (source === 'figma') {
    const url = await p.text({ message: 'Figma 链接或 fileKey', placeholder: 'https://figma.com/design/...' });
    if (cancelled(url)) return;
    const auth = await p.select({
      message: 'Figma 授权方式?',
      options: [
        { value: 'desktop', label: '桌面 App 授权(推荐)', hint: '无需 token,需开启 Dev Mode MCP' },
        { value: 'token', label: '个人令牌', hint: '需 FIGMA_API_KEY' },
      ],
    });
    if (cancelled(auth)) return;
    gen.figma = String(url);
    gen.figmaSource = auth as 'desktop' | 'token';
  } else {
    const docPath = await p.text({ message: '需求文档路径', placeholder: 'requirements.md' });
    if (cancelled(docPath)) return;
    gen.docPath = String(docPath);
  }

  const platform = await p.select({
    message: '被测平台?',
    options: [
      { value: 'web', label: 'Web 网站' },
      { value: 'android', label: 'Android 应用' },
    ],
  });
  if (cancelled(platform)) return;
  const target = await p.text({
    message: platform === 'android' ? '应用包名' : '网站地址',
    placeholder: platform === 'android' ? 'com.example.app' : 'https://example.com',
  });
  if (cancelled(target)) return;
  const out = await p.text({ message: '用例文件保存到', placeholder: 'cases.yaml', defaultValue: 'cases.yaml' });
  if (cancelled(out)) return;

  const outPath = await runGenCases({
    ...gen,
    target: String(target),
    platform: platform as 'web' | 'android',
    out: String(out) || 'cases.yaml',
  });

  // 生成后直接问要不要立即执行,省掉一条命令
  const runNow = await p.confirm({ message: '马上执行这批用例?' });
  if (cancelled(runNow) || !runNow) {
    p.outro(`稍后可执行:testpilot run-cases ${String(out) || 'cases.yaml'}`);
    return;
  }
  const engine = await pickEngine();
  if (engine === null) return;
  await runCases({ file: outPath, engine });
}

async function wizardRun(): Promise<void> {
  const file = await p.text({ message: '用例文件路径', placeholder: 'cases.yaml', defaultValue: 'cases.yaml' });
  if (cancelled(file)) return;
  const engine = await pickEngine();
  if (engine === null) return;
  if (!(await confirmRun(`执行用例 ${String(file) || 'cases.yaml'}`))) return;
  await runCases({ file: String(file) || 'cases.yaml', engine });
}

async function pickDepth(): Promise<number | null> {
  const depth = await p.select({
    message: '测试深度?',
    options: [
      { value: 'quick', label: '快速体检', hint: '约 3~5 分钟' },
      { value: 'standard', label: '标准(推荐)', hint: '约 5~10 分钟' },
      { value: 'deep', label: '深度测试', hint: '约 10~20 分钟' },
    ],
    initialValue: 'standard',
  });
  if (cancelled(depth)) return null;
  return DEPTH_STEPS[depth as keyof typeof DEPTH_STEPS];
}

async function pickEngine(): Promise<'cli' | 'midscene' | null> {
  const engine = await p.select({
    message: '用什么引擎执行?',
    options: [
      { value: 'cli', label: '本机 Claude(推荐)', hint: '零 API 成本' },
      { value: 'midscene', label: '多模态模型', hint: '需模型 key,更快' },
    ],
  });
  if (cancelled(engine)) return null;
  return engine as 'cli' | 'midscene';
}

async function confirmRun(summary: string): Promise<boolean> {
  const ok = await p.confirm({ message: `准备${summary},开始?` });
  if (cancelled(ok) || !ok) {
    p.outro('已退出');
    return false;
  }
  return true;
}

function reqUrl(v: string | undefined): string | undefined {
  if (!v || !/^https?:\/\//.test(v)) return '请输入以 http(s):// 开头的网址';
  return undefined;
}
