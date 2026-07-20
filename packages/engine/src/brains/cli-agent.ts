import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AiAgent, WebExecutor } from '@testpilot/executor';
import { claudeInvoker, type CliInvoker } from './cli.js';

interface ActionDecision {
  action: 'open_link' | 'click_button' | 'fill_input';
  index: number;
  value?: string;
}

/** 从模型输出提取动作决策(仅需 action + index,容忍前后缀文字) */
function parseActionDecision(raw: string): ActionDecision | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  for (let end = raw.lastIndexOf('}'); end > start; end = raw.lastIndexOf('}', end - 1)) {
    try {
      const p = JSON.parse(raw.slice(start, end + 1)) as Partial<ActionDecision>;
      if (
        typeof p.index === 'number' &&
        (p.action === 'open_link' || p.action === 'click_button' || p.action === 'fill_input')
      ) {
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
 * CLI 版 AiAgent:用本机 claude CLI(看截图 + 元素树)实现 aiAction / aiBoolean,
 * 让用例执行(CaseRunner)零 API 成本跑在 Claude 订阅上。Web 专用(依赖 WebExecutor)。
 */
export class CliWebAgent implements AiAgent {
  private tmpDir?: string;
  private shotSeq = 0;

  constructor(
    private readonly executor: WebExecutor,
    private readonly invoke: CliInvoker = claudeInvoker,
  ) {}

  /** 执行一步自然语言操作:观察元素 + 截图 → claude 选元素/动作 → 执行 */
  async aiAction(instruction: string): Promise<void> {
    const obs = await this.executor.observe();
    const shot = await this.snap();
    const elements = obs.interactables.map((it, i) => `[${i}] ${describe(it)}`).join('\n') || '(无可交互元素)';

    const prompt = `你在操作一个网页,当前页面「${obs.pageTitle}」。
截图(用 Read 工具查看):${shot}
可交互元素:
${elements}

需要完成的操作:「${instruction}」

只输出一个 JSON(不要 markdown、不要解释):
{"action":"open_link|click_button|fill_input","index":元素编号,"value":"仅 fill_input:要填的内容"}
若操作无法用上述元素完成,返回 {"action":"open_link","index":-1} 之外的最接近选择。`;

    const decision = parseActionDecision(await this.invoke(prompt));
    if (!decision) {
      throw new Error(`无法把操作「${instruction}」映射到页面元素`);
    }
    const target = obs.interactables[decision.index];
    if (!target) throw new Error(`操作「${instruction}」:模型选了不存在的元素 index=${decision.index}`);

    if (decision.action === 'open_link' && target.kind === 'link') {
      await this.executor.goto(target.url);
    } else if (decision.action === 'click_button' && target.kind === 'button') {
      await this.executor.clickButton(target.nth, target.text || undefined);
    } else if (decision.action === 'fill_input' && target.kind === 'input') {
      await this.executor.fillInput(target.nth, decision.value ?? '');
    } else {
      throw new Error(`操作「${instruction}」:动作 ${decision.action} 与元素类型 ${target.kind} 不匹配`);
    }
  }

  /** 断言判定:截图 → claude 看图回答 yes/no */
  async aiBoolean(question: string): Promise<boolean> {
    const shot = await this.snap();
    const prompt = `用 Read 工具查看这张网页截图:${shot}
判断以下描述是否成立:「${question}」
只回答一个词:yes 或 no,不要任何其他内容。`;
    const raw = (await this.invoke(prompt)).trim().toLowerCase();
    // 取最后一个 yes/no,容忍模型偶尔啰嗦
    const m = raw.match(/\b(yes|no)\b(?![\s\S]*\b(yes|no)\b)/);
    return m?.[1] === 'yes';
  }

  private async snap(): Promise<string> {
    if (!this.tmpDir) this.tmpDir = await mkdtemp(path.join(os.tmpdir(), 'testpilot-cliagent-'));
    const file = path.join(this.tmpDir, `s${++this.shotSeq}.png`);
    await this.executor.screenshot(file);
    return file;
  }
}

function describe(it: { kind: string; text?: string; url?: string; label?: string; inputType?: string; nth?: number }): string {
  if (it.kind === 'link') return `链接「${it.text || it.url}」`;
  if (it.kind === 'button') return `按钮「${it.text || `#${it.nth}`}」`;
  return `输入框「${it.label || `#${it.nth}`}」(${it.inputType})`;
}
