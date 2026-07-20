import * as p from '@clack/prompts';
import {
  foregroundAndroidApp,
  listAndroidApps,
  listAndroidDevices,
  listBootedIosApps,
  type DeviceApp,
} from '@testpilot/executor';
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
    const bundleId = await pickIosApp();
    if (bundleId === null) return;
    const goal = await p.text({ message: '探索目标(可选)', placeholder: '回车跳过' });
    if (cancelled(goal)) return;
    const depth = await pickDepth();
    if (depth === null) return;
    if (!(await confirmRun(`iOS 探索 ${bundleId}`))) return;
    await runExploreIos({ bundleId, goal: goal ? String(goal) : undefined, steps: depth });
    return;
  }

  if (platform === 'android') {
    const app = await pickAndroidApp();
    if (app === null) return;
    const goal = await p.text({ message: '探索目标(可选)', placeholder: '重点测试注册流程,回车跳过' });
    if (cancelled(goal)) return;
    const depth = await pickDepth();
    if (depth === null) return;
    if (!(await confirmRun(`Android 探索 ${app.id}`))) return;
    await runExploreApp({ pkg: app.id, device: app.deviceId, goal: goal ? String(goal) : undefined, steps: depth });
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
  const sources = await p.multiselect({
    message: '用例依据什么生成?(空格多选,功能 + UI 可一起)',
    options: [
      { value: 'doc', label: '需求文档', hint: '功能规格 · .md/.txt/.pdf/.docx' },
      { value: 'figma', label: 'Figma 设计稿', hint: 'UI 规格 · 经 Figma MCP' },
    ],
    required: true,
  });
  if (cancelled(sources)) return;
  const picked = sources as string[];

  const gen: Partial<GenCasesOptions> = {};
  if (picked.includes('doc')) {
    const docPath = await p.text({
      message: '需求文档路径(可把文件从访达拖进来)',
      placeholder: 'requirements.md / .pdf / .docx',
    });
    if (cancelled(docPath)) return;
    gen.docPath = String(docPath);
  }
  if (picked.includes('figma')) {
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
  }

  const precondition = await pickPrecondition();
  if (precondition === null) return;
  if (precondition) gen.precondition = precondition;

  const out = await p.text({ message: '用例文件保存到', placeholder: 'cases.yaml', defaultValue: 'cases.yaml' });
  if (cancelled(out)) return;

  // 生成只管「测什么」:不问平台/目标,产出的用例不绑定任何 URL/包名
  const outPath = await runGenCases({ ...gen, out: String(out) || 'cases.yaml' });

  // 生成后可直接执行(此时才问在哪跑),省掉一条命令
  const runNow = await p.confirm({ message: '马上执行这批用例?(现在选在哪跑)' });
  if (cancelled(runNow) || !runNow) {
    p.outro(`稍后执行:testpilot run-cases ${String(out) || 'cases.yaml'} -t <URL/包名>`);
    return;
  }
  const where = await pickTargetAndPlatform();
  if (where === null) return;
  const engine = await pickEngine();
  if (engine === null) return;
  await runCases({ file: outPath, ...where, engine });
}

async function wizardRun(): Promise<void> {
  const file = await p.text({ message: '用例文件路径', placeholder: 'cases.yaml', defaultValue: 'cases.yaml' });
  if (cancelled(file)) return;
  const where = await pickTargetAndPlatform();
  if (where === null) return;
  const engine = await pickEngine();
  if (engine === null) return;
  await runCases({ file: String(file) || 'cases.yaml', ...where, engine });
}

/** 执行时选「在哪跑」:平台 + 目标 */
async function pickTargetAndPlatform(): Promise<{
  target: string;
  platform: 'web' | 'android';
  deviceId?: string;
} | null> {
  const platform = await p.select({
    message: '在哪跑这些用例?',
    options: [
      { value: 'web', label: 'Web 网站' },
      { value: 'android', label: 'Android 应用', hint: '需已连接模拟器/真机' },
    ],
  });
  if (cancelled(platform)) return null;
  if (platform === 'android') {
    const app = await pickAndroidApp();
    return app === null ? null : { target: app.id, platform: 'android', deviceId: app.deviceId };
  }
  const url = await p.text({ message: '网站地址', placeholder: 'https://example.com', validate: reqUrl });
  if (cancelled(url)) return null;
  return { target: String(url), platform: 'web' };
}

/** 多台 adb 设备时先选一台;0 台提示,1 台直接用 */
async function resolveAndroidDevice(): Promise<string | undefined | null> {
  const devices = await listAndroidDevices();
  if (devices.length === 0) {
    p.log.warn('未检测到 Android 设备,请先启动模拟器或用 adb 连接真机(仍可手动输入包名)');
    return undefined;
  }
  if (devices.length === 1) return devices[0];
  const pick = await p.select({
    message: '检测到多台设备,用哪台?',
    options: devices.map((d) => ({ value: d, label: d })),
  });
  if (cancelled(pick)) return null;
  return String(pick);
}

/** 从连接的 Android 设备选 App(当前前台 / 已装列表 / 手动),返回包名 + 设备 */
async function pickAndroidApp(): Promise<{ id: string; deviceId?: string } | null> {
  const deviceId = await resolveAndroidDevice();
  if (deviceId === null) return null; // 用户取消选设备
  const s = p.spinner();
  s.start('读取设备上的应用…');
  const [fg, apps] = await Promise.all([foregroundAndroidApp(deviceId), listAndroidApps(deviceId)]);
  s.stop(apps.length ? `设备上有 ${apps.length} 个应用` : '未读到应用(可手动输入)');
  const id = await chooseApp(fg ? { id: fg, name: '当前打开的应用' } : null, apps, '应用包名', 'com.example.app');
  return id === null ? null : { id, deviceId };
}

/** 从已启动 iOS 模拟器选 App(用户应用列表 / 手动),返回 bundle id */
async function pickIosApp(): Promise<string | null> {
  const s = p.spinner();
  s.start('读取模拟器上的应用…');
  const apps = await listBootedIosApps();
  s.stop(apps.length ? `模拟器上有 ${apps.length} 个用户应用` : '未读到用户应用(可手动输入)');
  return chooseApp(null, apps, 'App bundle id', 'com.apple.Preferences');
}

/** 通用应用选择:前台优先 + 列表 + 手动输入 */
async function chooseApp(
  foreground: DeviceApp | null,
  apps: DeviceApp[],
  manualLabel: string,
  manualPlaceholder: string,
): Promise<string | null> {
  const options: { value: string; label: string; hint?: string }[] = [];
  if (foreground) options.push({ value: foreground.id, label: `⭐ ${foreground.name}`, hint: foreground.id });
  for (const a of apps) {
    if (foreground && a.id === foreground.id) continue;
    options.push({ value: a.id, label: a.name ? `${a.name}` : a.id, hint: a.name ? a.id : undefined });
  }
  options.push({ value: '__manual__', label: '✍️ 手动输入包名 / bundle id' });

  const pick = await p.select({ message: '测哪个 App?', options, maxItems: 12 });
  if (cancelled(pick)) return null;
  if (pick !== '__manual__') return String(pick);

  const manual = await p.text({
    message: manualLabel,
    placeholder: manualPlaceholder,
    validate: (v) => (!v ? '不能为空' : undefined),
  });
  if (cancelled(manual)) return null;
  return String(manual);
}

/**
 * 生成用例时的「起始状态」:决定用例是否包含登录步骤。
 * 返回一句描述给模型;返回 '' 表示不指定;null 表示取消。
 */
async function pickPrecondition(): Promise<string | null> {
  const state = await p.select({
    message: '被测应用现在处于什么状态?(决定用例是否包含登录步骤)',
    options: [
      { value: 'logged-in', label: '已登录', hint: '跳过登录,用例直接从主页进功能(测已登录后的流程选这个)' },
      { value: 'logged-out', label: '未登录', hint: '用例包含打开应用 → 登录步骤(适合测登录/注册本身)' },
      { value: 'custom', label: '自定义前置条件…', hint: '如「已登录且已实名,账户有余额」' },
    ],
    initialValue: 'logged-in',
  });
  if (cancelled(state)) return null;
  if (state === 'logged-in') return '应用已登录,当前停在已登录的主界面';
  if (state === 'logged-out') return '应用未登录,从打开应用/登录页开始';
  const custom = await p.text({
    message: '描述起始状态',
    placeholder: '已登录,账户有余额,停在合约交易页',
    validate: (v) => (!v ? '不能为空(或返回上一步选预设)' : undefined),
  });
  if (cancelled(custom)) return null;
  return String(custom);
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
