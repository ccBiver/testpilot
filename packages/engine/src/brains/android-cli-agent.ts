import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { AiAgent, AndroidExecutor } from '@testpilot/executor';
import { createClaudeSession, type CliInvoker } from './cli.js';

/** 一步(用例 step)最多允许的连续动作数;超出交给 expect 断言判定 */
const MAX_ACTIONS_PER_STEP = 6;
/** 每个动作后等 UI 过渡/加载的时间 */
const UI_SETTLE_MS = 1500;

interface ActionDecision {
  action: 'tap' | 'input' | 'back' | 'swipe' | 'done';
  x?: number;
  y?: number;
  value?: string;
  /** swipe 方向 */
  direction?: 'up' | 'down' | 'left' | 'right';
  /** done 时:目标达成的一句说明(可选) */
  reason?: string;
  /** done 时:若提示词里带了 expect,顺带判定其真假 */
  expect_ok?: boolean;
}

function isDecision(p: Partial<ActionDecision>): p is ActionDecision {
  return (
    p.action === 'tap' ||
    p.action === 'input' ||
    p.action === 'back' ||
    p.action === 'swipe' ||
    p.action === 'done'
  );
}

/**
 * 解析模型输出为动作序列:单个 {"action":...} 或同屏打包 {"actions":[...]}。
 * done 只允许单独出现(打包里出现则截断到 done 之前)。
 */
export function parseActionDecision(raw: string): ActionDecision[] | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  for (let end = raw.lastIndexOf('}'); end > start; end = raw.lastIndexOf('}', end - 1)) {
    try {
      const p = JSON.parse(raw.slice(start, end + 1)) as
        | Partial<ActionDecision>
        | { actions?: Partial<ActionDecision>[] };
      if ('actions' in p && Array.isArray(p.actions)) {
        const list = p.actions.filter(isDecision);
        if (list.length === 0) return null;
        const doneAt = list.findIndex((d) => d.action === 'done');
        return doneAt === -1 ? list : list.slice(0, doneAt + 1);
      }
      return isDecision(p as Partial<ActionDecision>) ? [p as ActionDecision] : null;
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
    /** 每个动作后等 UI 过渡的毫秒数(测试注入 0) */
    private readonly settleMs: number = UI_SETTLE_MS,
  ) {}

  /**
   * 执行一步用例:目标驱动的小循环。
   * 用例里的一步(如「打开合约计算器入口」)在真机上可能要点好几下(进合约页→更多→计算器),
   * 所以每轮看一次屏幕,模型给「一个动作」或「同屏可见目标的一串动作」,执行后再看,
   * 直到模型确认目标达成(done)或用完预算。预算用完不抛错——交给 expect 断言判定。
   */
  async aiAction(instruction: string): Promise<void> {
    await this.aiStep(instruction);
  }

  /**
   * 一次完成「执行 + 判定预期」:模型输出 done 的同一次调用里顺带回答 expect 是否成立,
   * 比「执行完再单独 aiBoolean」省一次完整模型调用。
   */
  async aiStep(instruction: string, expect?: string): Promise<{ ok: boolean }> {
    const { width, height } = await this.executor.screenSize();
    const history: string[] = [];

    const expectPart = expect
      ? `\n本步预期(达成目标后顺带判定):「${expect}」`
      : '';
    const doneShape = expect
      ? '{"action":"done","expect_ok":true|false,"reason":"一句话说明"}   目标已达成,并判定预期是否成立'
      : '{"action":"done","reason":"一句话说明"}                     当前屏幕表明目标已达成,本步结束';

    for (let round = 1; round <= MAX_ACTIONS_PER_STEP; round++) {
      const shot = await this.snap();
      const historyPart = history.length
        ? `\n本步已执行的动作:\n${history.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
        : '';

      const prompt = `你在操作一个 Android 应用,屏幕分辨率 ${width}×${height} 像素(左上角为原点)。
先用 Read 工具查看当前屏幕截图:${shot}
本步目标:「${instruction}」${expectPart}${historyPart}

达成目标可能需要连续多个动作(例如先进入某页、再打开某菜单、再点某项)。
输出 JSON(不要 markdown、不要解释),动作类型:
{"action":"tap","x":像素X,"y":像素Y}                      点击某处
{"action":"input","x":像素X,"y":像素Y,"value":"要输入的文本"}  点击输入框后输入
{"action":"swipe","direction":"up|down|left|right"}         滑动屏幕(找不到目标时可先滑动找)
{"action":"back"}                                          返回上一屏
${doneShape}

若接下来的几个动作,目标控件在当前截图里【已经全部可见】且互不影响
(典型:同一表单里连续填多个输入框),可打包一次输出:{"actions":[{...},{...}]}。
点击后界面会变化的(导航、开菜单、弹窗)绝不可打包,必须单个输出、看了新截图再定下一步。
坐标要落在目标控件中心,取值范围 x∈[0,${width}] y∈[0,${height}]。
第 ${round}/${MAX_ACTIONS_PER_STEP} 轮;若目标已达成务必输出 done,不要多余操作。`;

      const decisions = parseActionDecision(await this.invoke(prompt));
      if (!decisions) throw new Error(`无法把操作「${instruction}」映射为 Android 动作`);

      for (const d of decisions) {
        if (d.action === 'done') {
          return { ok: expect ? d.expect_ok === true : true };
        }
        history.push(await this.perform(d, instruction, width, height));
        if (this.settleMs > 0) await sleep(this.settleMs); // 等 UI 过渡/加载完
      }
    }
    // 预算用完:模型一直没说 done。有 expect 用一次独立判定兜底;没有则视为已尽力执行
    return { ok: expect ? await this.aiBoolean(expect) : true };
  }

  /** 执行单个动作,返回一句可读描述(供下一轮提示词回顾) */
  private async perform(d: ActionDecision, instruction: string, width: number, height: number): Promise<string> {
    if (d.action === 'back') {
      await this.executor.back();
      return '返回上一屏';
    }
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
      await this.executor.swipe(x1, y1, x2, y2);
      return `向${{ up: '上', down: '下', left: '左', right: '右' }[d.direction ?? 'up']}滑动`;
    }
    if (d.x === undefined || d.y === undefined) {
      throw new Error(`操作「${instruction}」:模型未给出有效坐标`);
    }
    await this.executor.tap(d.x, d.y);
    if (d.action === 'input') {
      await this.executor.typeText(d.value ?? '');
      return `点击 (${d.x},${d.y}) 并输入「${d.value ?? ''}」`;
    }
    return `点击 (${d.x},${d.y})`;
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
