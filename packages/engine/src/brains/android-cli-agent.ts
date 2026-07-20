import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AiAgent, AndroidExecutor } from '@testpilot/executor';
import { claudeInvoker, type CliInvoker } from './cli.js';

interface ActionDecision {
  action: 'tap' | 'input' | 'back';
  index?: number;
  value?: string;
}

function parseActionDecision(raw: string): ActionDecision | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  for (let end = raw.lastIndexOf('}'); end > start; end = raw.lastIndexOf('}', end - 1)) {
    try {
      const p = JSON.parse(raw.slice(start, end + 1)) as Partial<ActionDecision>;
      if (p.action === 'tap' || p.action === 'input' || p.action === 'back') return p as ActionDecision;
      return null;
    } catch {
      // 缩小右边界重试
    }
  }
  return null;
}

/**
 * Android 版 CLI AiAgent:用本机 claude(看截图 + uiautomator 元素)实现 aiAction/aiBoolean,
 * 让 Android 用例执行也能零 API 成本跑在 Claude 订阅上。元素选择 → adb 点击/输入。
 */
export class AndroidCliAgent implements AiAgent {
  private tmpDir?: string;
  private shotSeq = 0;

  constructor(
    private readonly executor: AndroidExecutor,
    private readonly invoke: CliInvoker = claudeInvoker,
  ) {}

  async aiAction(instruction: string): Promise<void> {
    const elements = await this.executor.androidElements();
    const shot = await this.snap();
    const list = elements.map((e, i) => `[${i}] ${e.label}${e.clickable ? '' : '(输入框)'}`).join('\n') || '(无可交互元素)';

    const prompt = `你在操作一个 Android 应用。
截图(用 Read 工具查看):${shot}
可交互元素:
${list}

需要完成的操作:「${instruction}」

只输出一个 JSON(不要 markdown、不要解释):
{"action":"tap|input|back","index":元素编号,"value":"仅 input:要输入的文本"}
tap 点击元素;input 在某输入框填文本;back 返回上一屏。`;

    const decision = parseActionDecision(await this.invoke(prompt));
    if (!decision) throw new Error(`无法把操作「${instruction}」映射为 Android 动作`);

    if (decision.action === 'back') {
      await this.executor.back();
      return;
    }
    const target = decision.index !== undefined ? elements[decision.index] : undefined;
    if (!target) throw new Error(`操作「${instruction}」:模型选了不存在的元素 index=${decision.index}`);

    await this.executor.tap(target.center[0], target.center[1]);
    if (decision.action === 'input') {
      await this.executor.typeText(decision.value ?? '');
    }
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
