import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { checkGuardrail, type Interactable, type WebExecutor } from '@testpilot/executor';
import type { Brain, BrainContext, StepPlan } from './types.js';

/** CLI 决策器:输入完整提示词,返回模型的原始文本输出 */
export type CliInvoker = (prompt: string) => Promise<string>;

export interface CliDecision {
  action: 'open_link' | 'click_button' | 'fill_input' | 'stop';
  index?: number;
  value?: string;
  description: string;
}

const STEP_TIMEOUT_MS = 180_000; // 看图+推理比纯文本慢,给足时间避免误判超时
const CLI_MAX_RETRIES = 2; // claude 偶发非零退出(冷启动/瞬时故障)时重试,避免一次抖动就判失败

/**
 * 模型:sonnet 视觉定位准确且比默认(opus 级)便宜约 8 倍;实测 haiku 给坐标会偏,不可用。
 * 可用 TESTPILOT_CLAUDE_MODEL 覆盖。
 */
const CLI_MODEL = process.env.TESTPILOT_CLAUDE_MODEL ?? 'sonnet';

/** 单次调用本机 claude CLI 无头模式;传 resumeId 则续用已有会话(命中提示词缓存,且保留步骤记忆) */
function invokeOnce(prompt: string, resumeId?: string): Promise<{ text: string; sessionId?: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'claude',
      [
        '-p',
        prompt,
        '--allowedTools',
        'Read',
        '--model',
        CLI_MODEL,
        // json 输出带 session_id,用于后续 --resume 复用会话
        '--output-format',
        'json',
        ...(resumeId ? ['--resume', resumeId] : []),
        // 决策不需要用户的 MCP 服务器 / rules / CLAUDE.md;隔离掉可省下数万 token 的冷启动上下文
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--setting-sources',
        '',
      ],
      // cwd 指到临时目录,避免把当前项目的 CLAUDE.md/记忆装进上下文
      { timeout: STEP_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, cwd: tmpdir() },
      (err, stdout, stderr) => {
        if (err) {
          if (/ENOENT/.test(String(err))) {
            reject(new Error('未找到 claude 命令,请确认本机已安装 Claude Code CLI'));
            return;
          }
          const timedOut = (err as { killed?: boolean }).killed;
          const code = (err as { code?: number | string }).code;
          const detail = (stderr || stdout || '').trim().slice(0, 300);
          const reason = timedOut
            ? `超时(>${STEP_TIMEOUT_MS / 1000}s)`
            : `退出码 ${code}${detail ? `:${detail}` : ''}`;
          reject(new Error(reason));
          return;
        }
        resolve(parseCliEnvelope(stdout));
      },
    );
    // 立刻给 stdin 送 EOF:提示词已用 -p 传入,不再从管道读输入。
    // 否则 claude 无头模式会等待 stdin,3 秒后告警「no stdin data received」甚至失败。
    child.stdin?.end();
  });
}

/** 解析 --output-format json 的信封;拿不到就原样返回文本(向后兼容) */
export function parseCliEnvelope(stdout: string): { text: string; sessionId?: string } {
  try {
    const d = JSON.parse(stdout) as { result?: unknown; session_id?: unknown; is_error?: unknown };
    if (typeof d.result === 'string') {
      if (d.is_error === true) throw new Error(`模型返回错误:${d.result.slice(0, 200)}`);
      return { text: d.result, sessionId: typeof d.session_id === 'string' ? d.session_id : undefined };
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('模型返回错误')) throw err;
    // 非 JSON(旧版 CLI 或纯文本)→ 按原样处理
  }
  return { text: stdout };
}

/**
 * 会话式决策器:同一实例的多次调用续用同一个 claude 会话。
 * 好处:①系统提示词/历史命中提示词缓存,成本约降一个数量级;
 * ②模型记得之前每一步做了什么,决策更连贯。
 * 失败重试时放弃旧会话换新会话,避免坏会话卡死。
 */
export function createClaudeSession(): CliInvoker {
  let sessionId: string | undefined;
  return async (prompt) => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= CLI_MAX_RETRIES; attempt++) {
      try {
        const { text, sessionId: sid } = await invokeOnce(prompt, sessionId);
        if (sid) sessionId = sid;
        return text;
      } catch (err) {
        lastErr = err;
        // ENOENT(没装 claude)不必重试;其余失败换全新会话再试
        if (err instanceof Error && err.message.includes('未找到 claude 命令')) break;
        sessionId = undefined;
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`claude CLI 调用失败(已重试 ${CLI_MAX_RETRIES} 次):${msg}`);
  };
}

/** 默认决策器:单次独立调用(生成用例等一次性场景);瞬时失败自动重试 */
export const claudeInvoker: CliInvoker = async (prompt) => {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= CLI_MAX_RETRIES; attempt++) {
    try {
      return (await invokeOnce(prompt)).text;
    } catch (err) {
      lastErr = err;
      // ENOENT(没装 claude)不必重试
      if (err instanceof Error && err.message.includes('未找到 claude 命令')) break;
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`claude CLI 调用失败(已重试 ${CLI_MAX_RETRIES} 次):${msg}`);
};

/**
 * CLI 大脑:用本机 Claude Code(claude -p)做决策——零 API 成本,用订阅额度。
 * 每步把「页面观察(元素清单)+ 截图路径 + 历史」交给 CLI,拿回一个 JSON 决策并执行。
 * 适合本地开发与自用;多用户平台场景请用 BYOK(AiBrain)。
 */
export class CliBrain implements Brain {
  readonly name = 'cli';
  private readonly history: string[] = [];

  constructor(
    private readonly executor: WebExecutor,
    // 探索是多步过程,复用同一 claude 会话:命中缓存且模型记得走过的路径
    private readonly invoke: CliInvoker = createClaudeSession(),
  ) {}

  async nextStep(obs: Parameters<Brain['nextStep']>[0], ctx: BrainContext): Promise<StepPlan | null> {
    let feedback = '';
    // 最多重试 2 次:输出不可解析或决策被护栏拦截时,把原因反馈给模型再要一次
    for (let attempt = 0; attempt < 3; attempt++) {
      const raw = await this.invoke(this.buildPrompt(obs, ctx, feedback));
      const decision = parseDecision(raw);
      if (!decision) {
        feedback = '你上一次的输出无法解析,请只输出一个 JSON 对象,不要任何其他文字。';
        continue;
      }
      if (decision.action === 'stop') {
        this.history.push(`结束:${decision.description}`);
        return null;
      }

      const target = decision.index !== undefined ? obs.interactables[decision.index] : undefined;
      if (!target) {
        feedback = `你上一次给的 index=${decision.index} 不存在,请从元素清单中选择有效编号。`;
        continue;
      }

      const guardText = `${labelOf(target)} ${decision.value ?? ''} ${decision.description}`;
      const verdict = checkGuardrail(guardText);
      if (!verdict.allowed) {
        feedback = `你上一步选择的「${labelOf(target)}」被安全护栏拦截(敏感词:${verdict.matchedWord}),请换一个安全的操作。`;
        continue;
      }

      const plan = this.planFor(decision, target);
      if (!plan) {
        feedback = `动作 ${decision.action} 与元素类型 ${target.kind} 不匹配,请重新选择。`;
        continue;
      }
      return plan;
    }
    return null; // 连续拿不到可执行决策,结束探索
  }

  private planFor(decision: CliDecision, target: Interactable): StepPlan | null {
    const done = (description: string, execute: () => Promise<void>): StepPlan => ({
      description,
      execute: async () => {
        await execute();
        this.history.push(description);
      },
    });

    if (decision.action === 'open_link' && target.kind === 'link') {
      return done(`AI(CLI):${decision.description}`, () => this.executor.goto(target.url));
    }
    if (decision.action === 'click_button' && target.kind === 'button') {
      return done(`AI(CLI):${decision.description}`, () =>
        this.executor.clickButton(target.nth, target.text || undefined),
      );
    }
    if (decision.action === 'fill_input' && target.kind === 'input' && decision.value !== undefined) {
      return done(`AI(CLI):${decision.description}`, () =>
        this.executor.fillInput(target.nth, decision.value ?? ''),
      );
    }
    return null;
  }

  private buildPrompt(
    obs: Parameters<Brain['nextStep']>[0],
    ctx: BrainContext,
    feedback: string,
  ): string {
    const elements = obs.interactables
      .map((item, i) => `[${i}] ${describeInteractable(item)}`)
      .join('\n');
    const historyPart = this.history.length
      ? `你已经执行过的操作:\n${this.history.slice(-6).join('\n')}\n`
      : '';
    const screenshotPart = ctx.lastScreenshot
      ? `当前页面截图(可用 Read 工具查看):${ctx.lastScreenshot}\n`
      : '';
    const goalPart = ctx.goal ? `测试目标:${ctx.goal}` : '测试目标:全面探索,发现功能异常';

    return `你是一名正在测试网站的真实用户。${goalPart}(第 ${ctx.stepSeq}/${ctx.stepBudget} 步)。
当前页面:「${obs.pageTitle}」 ${obs.pageUrl}
${screenshotPart}${historyPart}${feedback ? `注意:${feedback}\n` : ''}
页面可交互元素:
${elements}

请决定下一步操作,只输出一个 JSON 对象(不要 markdown 代码块、不要解释):
{"action":"open_link|click_button|fill_input|stop","index":元素编号,"value":"仅 fill_input 需要:要填写的内容","description":"用一句中文描述这步操作"}

规则:
1. 优先推进测试目标对应的业务流程(如注册:找到并填写表单每个字段,最后点提交);
2. 表单用测试数据:邮箱形如 tp-test@example.com,密码 TestPilot@2026,姓名/昵称随意;
3. 严禁任何不可逆操作:支付、下单、删除、注销、对外发送消息;
4. 目标已完成或无有意义的下一步时,action 用 "stop" 并在 description 里说明结论。`;
  }
}

function describeInteractable(item: Interactable): string {
  if (item.kind === 'link') return `链接「${item.text || item.url}」`;
  if (item.kind === 'button') return `按钮「${item.text || `#${item.nth}`}」`;
  return `输入框「${item.label || `#${item.nth}`}」(类型 ${item.inputType})`;
}

function labelOf(item: Interactable): string {
  if (item.kind === 'link') return item.text || item.url;
  if (item.kind === 'button') return item.text;
  return item.label;
}

/** 从 CLI 输出中提取第一个 JSON 对象(容忍模型偶尔带点前后缀) */
export function parseDecision(raw: string): CliDecision | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  for (let end = raw.lastIndexOf('}'); end > start; end = raw.lastIndexOf('}', end - 1)) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<CliDecision>;
      if (
        typeof parsed.description === 'string' &&
        (parsed.action === 'open_link' ||
          parsed.action === 'click_button' ||
          parsed.action === 'fill_input' ||
          parsed.action === 'stop')
      ) {
        return parsed as CliDecision;
      }
      return null;
    } catch {
      // 继续缩小右边界重试
    }
  }
  return null;
}
