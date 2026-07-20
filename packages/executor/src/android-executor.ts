import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ModelConfig, Signal } from '@testpilot/shared';
import { applyModelConfig } from './model-config.js';
import { adbBin } from './device-apps.js';
import type { AiAgent, ExplorerTarget, TargetLocation, TargetObservation } from './target.js';

/** Midscene/appium-adb 依赖 ANDROID_HOME;未设置时探测默认 SDK 路径 */
function ensureAndroidHome(): void {
  if (process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT) return;
  const candidates = [
    path.join(homedir(), 'Library/Android/sdk'), // macOS
    path.join(homedir(), 'Android/Sdk'), // Linux
    path.join(homedir(), 'AppData/Local/Android/Sdk'), // Windows
  ];
  const found = candidates.find((p) => existsSync(p));
  if (found) process.env.ANDROID_HOME = found;
}

export interface AndroidExecutorOptions {
  /** adb 设备序列号;省略则用第一台已连接设备 */
  deviceId?: string;
  actionTimeout?: number;
}

/** Midscene AndroidAgent 的最小接口(避免把重类型泄漏到本模块) */
interface MidsceneAndroidAgent {
  aiAction(instruction: string): Promise<unknown>;
  aiBoolean(question: string): Promise<boolean>;
  screenshotBase64(): Promise<string>;
}
interface MidsceneAndroidDevice {
  connect(): Promise<unknown>;
  launch(target: string): Promise<unknown>;
  screenshotBase64(): Promise<string>;
  getElementsInfo(): Promise<Array<{ content?: string }>>;
  destroy?(): Promise<unknown>;
}

/**
 * Android 执行器:adb 驱动 + Midscene AndroidAgent 视觉操作 + logcat 崩溃采集。
 * Android 无 DOM,启发式无从下手,探索固定走 AI 大脑;这里只负责观察/截图/信号。
 */
export class AndroidExecutor implements ExplorerTarget {
  private device: MidsceneAndroidDevice | null = null;
  private _agent: MidsceneAndroidAgent | null = null;
  private logcat: ChildProcess | null = null;
  private signalBuffer: Signal[] = [];
  private currentPkg = '';
  private launchFailed = false;
  private resolvedDeviceId = '';
  private readonly opts: Required<Omit<AndroidExecutorOptions, 'deviceId'>> & { deviceId?: string };

  constructor(opts: AndroidExecutorOptions = {}) {
    this.opts = { actionTimeout: opts.actionTimeout ?? 15_000, deviceId: opts.deviceId };
  }

  /** 供 AI 大脑复用的 Midscene agent(已连接) */
  get agent(): MidsceneAndroidAgent {
    if (!this._agent) throw new Error('AndroidExecutor 未启动,请先调用 launch()');
    return this._agent;
  }

  async launch(target: string): Promise<void> {
    ensureAndroidHome();
    const mod = (await import('@midscene/android')) as unknown as {
      AndroidDevice: new (id: string, opts?: unknown) => MidsceneAndroidDevice;
      AndroidAgent: new (device: MidsceneAndroidDevice) => MidsceneAndroidAgent;
      getConnectedDevices: () => Promise<Array<{ udid: string }>>;
    };

    let deviceId = this.opts.deviceId;
    if (!deviceId) {
      const devices = await mod.getConnectedDevices().catch(() => []);
      if (devices.length === 0) {
        this.launchFailed = true;
        throw new Error('未找到已连接的 Android 设备,请先启动模拟器或用 adb 连接真机');
      }
      deviceId = devices[0]!.udid;
    }
    this.resolvedDeviceId = deviceId;

    this.device = new mod.AndroidDevice(deviceId);
    await this.device.connect();
    this._agent = new mod.AndroidAgent(this.device);

    this.currentPkg = target;
    this.startLogcat(deviceId);
    try {
      await this.device.launch(target);
    } catch {
      this.launchFailed = true;
    }
  }

  isUnreachable(): boolean {
    return this.launchFailed;
  }

  async observe(): Promise<TargetObservation> {
    const loc = await this.location();
    // Android 走 AI 大脑,不枚举可点元素;返回空列表即可(截图是主要输入)
    return { pageUrl: loc.url, pageTitle: loc.title, interactables: [] };
  }

  async location(): Promise<TargetLocation> {
    const pkg = await this.foregroundPackage().catch(() => this.currentPkg);
    if (pkg) this.currentPkg = pkg;
    return { url: `app://${this.currentPkg}`, title: this.currentPkg };
  }

  async screenshot(filePath: string): Promise<void> {
    if (!this.device) return;
    const base64 = await this.device.screenshotBase64().catch(() => '');
    if (!base64) return;
    const data = base64.replace(/^data:image\/\w+;base64,/, '');
    await writeFile(filePath, Buffer.from(data, 'base64'));
  }

  drainSignals(): Signal[] {
    const out = this.signalBuffer;
    this.signalBuffer = [];
    return out;
  }

  /** Android agent 已在 launch 时创建;这里注入模型配置后返回 */
  async createAgent(modelConfig?: ModelConfig): Promise<AiAgent> {
    const mod = (await import('@midscene/android')) as unknown as {
      overrideAIConfig: (c: Record<string, string>) => void;
    };
    applyModelConfig(modelConfig, mod.overrideAIConfig);
    return this.agent;
  }

  /** uiautomator dump 取可交互元素(文本/描述 + 中心坐标),供本机 CLI 大脑选择 */
  async androidElements(): Promise<AndroidElement[]> {
    await this.adbShell(['uiautomator', 'dump', '/sdcard/tp_ui.xml']).catch(() => '');
    const xml = await this.adbShell(['cat', '/sdcard/tp_ui.xml']).catch(() => '');
    return parseUiautomator(xml);
  }

  /** 点击屏幕坐标 */
  async tap(x: number, y: number): Promise<void> {
    await this.adbShell(['input', 'tap', String(x), String(y)]);
  }

  /** 在当前焦点输入文本(空格转 %s;中文需 IME,暂不支持) */
  async typeText(text: string): Promise<void> {
    await this.adbShell(['input', 'text', text.replace(/ /g, '%s')]);
  }

  /** 返回键 */
  async back(): Promise<void> {
    await this.adbShell(['input', 'keyevent', '4']);
  }

  async dispose(): Promise<void> {
    this.logcat?.kill();
    this.logcat = null;
    await this.device?.destroy?.().catch(() => {});
    this.device = null;
    this._agent = null;
  }

  /** 通过 adb 读当前前台包名(dumpsys 兜底,失败返回空) */
  private async foregroundPackage(): Promise<string> {
    const out = await this.adbShell([
      'dumpsys',
      'activity',
      'activities',
    ]).catch(() => '');
    // 匹配 topResumedActivity / mResumedActivity 里的包名
    const m = out.match(/(?:topResumedActivity|mResumedActivity|ResumedActivity)[^\n]*\s([a-zA-Z][\w.]+)\//);
    return m?.[1] ?? '';
  }

  private adbShell(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const base = this.resolvedDeviceId ? ['-s', this.resolvedDeviceId] : [];
      const proc = spawn(adbBin(), [...base, 'shell', ...args], { timeout: 10_000 });
      let out = '';
      proc.stdout.on('data', (d) => (out += d.toString()));
      proc.on('error', reject);
      proc.on('close', () => resolve(out));
    });
  }

  /** 持续读 logcat,解析崩溃(FATAL EXCEPTION)与 ANR */
  private startLogcat(deviceId: string): void {
    // 清空历史日志,只关心本次运行期间的新日志
    spawn(adbBin(), ['-s', deviceId, 'logcat', '-c']);
    const proc = spawn(adbBin(), ['-s', deviceId, 'logcat', '-v', 'brief', '*:E']);
    this.logcat = proc;
    let buffer = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) this.parseLogcatLine(line);
    });
    proc.on('error', () => {
      /* logcat 起不来不阻断探索,只是没有崩溃信号 */
    });
  }

  private parseLogcatLine(line: string): void {
    // FATAL EXCEPTION:Java 层崩溃(闪退)
    if (/FATAL EXCEPTION/i.test(line) || /\bE\/AndroidRuntime\b/i.test(line)) {
      this.signalBuffer.push({
        kind: 'logcat',
        level: 'fatal',
        tag: 'AndroidRuntime',
        message: line.trim().slice(0, 400),
        pkg: this.currentPkg,
        at: Date.now(),
      });
      return;
    }
    // ANR:应用无响应
    if (/ANR in /i.test(line)) {
      this.signalBuffer.push({
        kind: 'logcat',
        level: 'anr',
        tag: 'ActivityManager',
        message: line.trim().slice(0, 400),
        pkg: this.currentPkg,
        at: Date.now(),
      });
    }
  }
}

/** uiautomator dump 出的可交互元素 */
export interface AndroidElement {
  /** 展示标签:text 优先,其次 content-desc */
  label: string;
  className: string;
  clickable: boolean;
  /** 中心坐标,用于 adb input tap */
  center: [number, number];
}

/**
 * 解析 uiautomator dump 的 XML,取有文本/描述且可点击(或输入类)的节点。
 * 不引 XML 库,按 <node .../> 逐个正则提取属性。
 */
export function parseUiautomator(xml: string): AndroidElement[] {
  const elements: AndroidElement[] = [];
  const seen = new Set<string>();
  for (const node of xml.match(/<node\b[^>]*?\/?>/g) ?? []) {
    const attr = (name: string) => node.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';
    const text = attr('text').trim();
    const desc = attr('content-desc').trim();
    const label = text || desc;
    const className = attr('class');
    const clickable = attr('clickable') === 'true';
    const isInput = /EditText/i.test(className);
    // 只保留有意义、能操作的元素
    if (!label && !isInput) continue;
    if (!clickable && !isInput) continue;

    const bounds = attr('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!bounds) continue;
    const [x1, y1, x2, y2] = [bounds[1], bounds[2], bounds[3], bounds[4]].map(Number) as [number, number, number, number];
    const center: [number, number] = [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)];

    const key = `${label}|${className}|${center[0]},${center[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    elements.push({ label: label || `[${className.split('.').pop()}]`, className, clickable, center });
  }
  return elements;
}
