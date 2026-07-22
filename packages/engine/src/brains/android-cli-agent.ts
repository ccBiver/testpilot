import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AiAgent, AndroidExecutor } from '@testpilot/executor';
import { createClaudeSession, type CliInvoker } from './cli.js';

interface ActionDecision {
  action: 'tap' | 'input' | 'back' | 'swipe';
  x?: number;
  y?: number;
  value?: string;
  /** swipe 方向 */
  direction?: 'up' | 'down' | 'left' | 'right';
}

export function parseActionDecision(raw: string): ActionDecision | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  for (let end = raw.lastIndexOf('}'); end > start; end = raw.lastIndexOf('}', end - 1)) {
    try {
      const p = JSON.parse(raw.slice(start, end + 1)) as Partial<ActionDecision>;
      if (p.action === 'tap' || p.action === 'input' || p.action === 'back' || p.action === 'swipe') {
        return p as ActionDecision;
      }
      return null;
    } catch {
      // 缩小右边界重试
    }
  }
  return null;
}

/**
 * Android 版 CLI AiAgent:用本机 claude「看截图 → 给点击坐标」实现 aiAction/aiBoolean。
 * 坐标式(非元素式):对 Flutter/游戏/Canvas 这类无原生控件树的应用同样有效,零 API 成本。
 * 截图像素与 adb input 同一坐标系,claude 直接按截图给像素坐标。
 */
export class AndroidCliAgent implements AiAgent {
  private tmpDir?: string;
  private shotSeq = 0;

  constructor(
    private readonly executor: AndroidExecutor,
    // 每个 agent 实例一个 claude 会话:多步共享上下文、命中提示词缓存
    private readonly invoke: CliInvoker = createClaudeSession(),
  ) {}

  async aiAction(instruction: string): Promise<void> {
    const { width, height } = await this.executor.screenSize();
    const shot = await this.snap();

    const prompt = `你在操作一个 Android 应用,屏幕分辨率 ${width}×${height} 像素(左上角为原点)。
先用 Read 工具查看这张截图:${shot}
需要完成的操作:「${instruction}」

判断该点屏幕上哪个位置,只输出一个 JSON(不要 markdown、不要解释):
{"action":"tap","x":像素X,"y":像素Y}                      点击某处
{"action":"input","x":像素X,"y":像素Y,"value":"要输入的文本"}  点击输入框后输入
{"action":"swipe","direction":"up|down|left|right"}         滑动屏幕(找不到目标时可先滑动)
{"action":"back"}                                          返回上一屏
坐标要落在目标控件中心,取值范围 x∈[0,${width}] y∈[0,${height}]。`;

    const d = parseActionDecision(await this.invoke(prompt));
    if (!d) throw new Error(`无法把操作「${instruction}」映射为 Android 动作`);

    if (d.action === 'back') return void (await this.executor.back());
    if (d.action === 'swipe') {
      const cx = width / 2;
      const cy = height / 2;
      const dist = (d.direction === 'left' || d.direction === 'right' ? width : height) * 0.6;
      const map = {
        up: [cx, cy + dist / 2, cx, cy - dist / 2],
        down: [cx, cy - dist / 2, cx, cy + dist / 2],
        left: [cx + dist / 2, cy, cx - dist / 2, cy],
        right: [cx - dist / 2, cy, cx + dist / 2, cy],
      } as const;
      const [x1, y1, x2, y2] = map[d.direction ?? 'up'];
      return void (await this.executor.swipe(x1, y1, x2, y2));
    }
    if (d.x === undefined || d.y === undefined) {
      throw new Error(`操作「${instruction}」:模型未给出有效坐标`);
    }
    await this.executor.tap(d.x, d.y);
    if (d.action === 'input') await this.executor.typeText(d.value ?? '');
  }

  async aiBoolean(question: string): Promise<boolean> {
    const shot = await this.snap();
    const prompt = `用 Read 工具查看这张 Android 应用截图:${shot}
判断以下描述是否成立:「${question}」
只回答一个词:yes 或 no。`;
    const raw = (await this.invoke(prompt)).trim().toLowerCase();
    const m = raw.match(/\b(yes|no)\b(?![\s\S]*\b(yes|no)\b)/);
    return m?.[1] === 'yes';
  }

  private async snap(): Promise<string> {
    if (!this.tmpDir) this.tmpDir = await mkdtemp(path.join(os.tmpdir(), 'testpilot-andcli-'));
    const file = path.join(this.tmpDir, `s${++this.shotSeq}.png`);
    await this.executor.screenshot(file);
    return file;
  }
}
