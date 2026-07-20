import { writeFile } from 'node:fs/promises';
import type { ModelConfig, Signal } from '@testpilot/shared';
import { applyModelConfig } from './model-config.js';
import type { AiAgent, ExplorerTarget, TargetLocation, TargetObservation } from './target.js';

export interface IosExecutorOptions {
  /** 模拟器 udid;省略则用已启动的模拟器 */
  deviceId?: string;
}

interface MidsceneIosAgent {
  aiAction(instruction: string): Promise<unknown>;
  aiBoolean(question: string): Promise<boolean>;
}
interface MidsceneIosDevice {
  connect(): Promise<unknown>;
  launch(uri: string): Promise<unknown>;
  screenshotBase64(): Promise<string>;
  destroy?(): Promise<unknown>;
}

/**
 * iOS 执行器:仅 macOS 支持(依赖 Xcode + 模拟器 + WebDriverAgent)。
 * 视觉驱动(Midscene IOSAgent),不走本机 claude 元素点击——iOS 未暴露公开坐标点击,
 * 故 iOS 探索/用例需多模态模型(--engine midscene / AI 模式)。
 */
export class IosExecutor implements ExplorerTarget {
  private device: MidsceneIosDevice | null = null;
  private _agent: MidsceneIosAgent | null = null;
  private currentApp = '';
  private launchFailed = false;
  private readonly opts: IosExecutorOptions;

  constructor(opts: IosExecutorOptions = {}) {
    this.opts = opts;
  }

  get agent(): MidsceneIosAgent {
    if (!this._agent) throw new Error('IosExecutor 未启动,请先调用 launch()');
    return this._agent;
  }

  async launch(target: string): Promise<void> {
    if (process.platform !== 'darwin') {
      throw new Error('iOS 测试仅支持 macOS(需 Xcode + 模拟器 + WebDriverAgent)');
    }
    const mod = (await import('@midscene/ios')) as unknown as {
      IOSDevice: new (opts?: { deviceId?: string }) => MidsceneIosDevice;
      IOSAgent: new (device: MidsceneIosDevice) => MidsceneIosAgent;
      checkIOSEnvironment: () => Promise<{ available: boolean; error?: string }>;
    };

    const env = await mod.checkIOSEnvironment();
    if (!env.available) {
      throw new Error(`iOS 环境不可用:${env.error ?? '请确认 Xcode 与模拟器已就绪'}`);
    }

    this.device = new mod.IOSDevice(this.opts.deviceId ? { deviceId: this.opts.deviceId } : undefined);
    try {
      await this.device.connect();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        'iOS 前置未就绪:需先让 WebDriverAgent 运行在 localhost:8100。' +
          '一次性设置:用 Xcode 构建并在目标模拟器上运行 WebDriverAgentRunner' +
          '(或 `npx appium driver run xcuitest build-wda`)。\n原始错误:' +
          detail,
      );
    }
    this._agent = new mod.IOSAgent(this.device);

    this.currentApp = target;
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
    // 视觉驱动,不枚举元素;截图是主要输入
    return { pageUrl: loc.url, pageTitle: loc.title, interactables: [] };
  }

  async location(): Promise<TargetLocation> {
    return { url: `app://${this.currentApp}`, title: this.currentApp };
  }

  async screenshot(filePath: string): Promise<void> {
    if (!this.device) return;
    const base64 = await this.device.screenshotBase64().catch(() => '');
    if (!base64) return;
    const data = base64.replace(/^data:image\/\w+;base64,/, '');
    await writeFile(filePath, Buffer.from(data, 'base64'));
  }

  /** iOS 暂无 logcat 等价物;崩溃检测后续接 simctl 日志 */
  drainSignals(): Signal[] {
    return [];
  }

  async createAgent(modelConfig?: ModelConfig): Promise<AiAgent> {
    const mod = (await import('@midscene/ios')) as unknown as {
      overrideAIConfig: (c: Record<string, string>) => void;
    };
    applyModelConfig(modelConfig, mod.overrideAIConfig);
    return this.agent;
  }

  async dispose(): Promise<void> {
    await this.device?.destroy?.().catch(() => {});
    this.device = null;
    this._agent = null;
  }
}
