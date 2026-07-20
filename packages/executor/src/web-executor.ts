import { chromium, type Browser, type Page } from 'playwright';
import type { ModelConfig, Signal } from '@testpilot/shared';
import { applyModelConfig } from './model-config.js';
import type { AiAgent, ExplorerTarget } from './target.js';

/** 页面上可交互的候选目标(供探索大脑决策) */
export type Interactable =
  | { kind: 'link'; text: string; url: string }
  | { kind: 'button'; text: string; nth: number }
  | { kind: 'input'; label: string; inputType: string; nth: number };

export interface Observation {
  pageUrl: string;
  pageTitle: string;
  interactables: Interactable[];
}

export interface WebExecutorOptions {
  headless?: boolean;
  /** 视口,默认桌面 */
  viewport?: { width: number; height: number };
  /** 单步操作超时(ms) */
  actionTimeout?: number;
}

/**
 * Web 执行器:封装 Playwright,负责页面信号采集(console/network/crash)、
 * 观察(截图 + 可交互元素)与基础操作。AI 模式下 Midscene 直接复用 this.page。
 */
export class WebExecutor implements ExplorerTarget {
  private browser: Browser | null = null;
  private _page: Page | null = null;
  private signalBuffer: Signal[] = [];
  private readonly opts: Required<WebExecutorOptions>;

  constructor(opts: WebExecutorOptions = {}) {
    this.opts = {
      headless: opts.headless ?? true,
      viewport: opts.viewport ?? { width: 1366, height: 850 },
      actionTimeout: opts.actionTimeout ?? 10_000,
    };
  }

  get page(): Page {
    if (!this._page) throw new Error('Executor 未启动,请先调用 launch()');
    return this._page;
  }

  async launch(startUrl: string): Promise<void> {
    this.browser = await chromium.launch({ headless: this.opts.headless });
    const context = await this.browser.newContext({
      viewport: this.opts.viewport,
      // 默认 UA 带 HeadlessChrome,常被站点风控直接断连;伪装成普通 Chrome
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      locale: 'zh-CN',
    });
    this._page = await context.newPage();
    this._page.setDefaultTimeout(this.opts.actionTimeout);
    this.wireSignals(this._page);
    await this.goto(startUrl);
    // 首次导航失败(断连/超时)再试一次,规避瞬时网络抖动
    if (this.isUnreachable()) {
      await this.page.waitForTimeout(2000);
      await this.goto(startUrl);
    }
  }

  /** 当前是否停留在浏览器错误页(导航失败) */
  isUnreachable(): boolean {
    return this.page.url().startsWith('chrome-error://');
  }

  private wireSignals(page: Page): void {
    page.on('console', (msg) => {
      const level = msg.type();
      if (level !== 'error' && level !== 'warning') return;
      this.signalBuffer.push({
        kind: 'console',
        level,
        message: msg.text(),
        url: page.url(),
        at: Date.now(),
      });
    });
    page.on('pageerror', (err) => {
      this.signalBuffer.push({
        kind: 'page-error',
        message: err.message,
        stack: err.stack,
        url: page.url(),
        at: Date.now(),
      });
    });
    page.on('response', (res) => {
      if (res.status() < 400) return;
      this.signalBuffer.push({
        kind: 'network',
        method: res.request().method(),
        requestUrl: res.url(),
        status: res.status(),
        pageUrl: page.url(),
        at: Date.now(),
      });
    });
    page.on('requestfailed', (req) => {
      this.signalBuffer.push({
        kind: 'network',
        method: req.method(),
        requestUrl: req.url(),
        status: 0,
        failureText: req.failure()?.errorText ?? 'unknown failure',
        pageUrl: page.url(),
        at: Date.now(),
      });
    });
    page.on('crash', () => {
      this.signalBuffer.push({ kind: 'crash', pageUrl: page.url(), at: Date.now() });
    });
  }

  /** 取走缓冲区内的全部信号(增量语义) */
  drainSignals(): Signal[] {
    const drained = this.signalBuffer;
    this.signalBuffer = [];
    return drained;
  }

  async goto(url: string): Promise<void> {
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      await this.page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    } catch {
      // 导航失败本身会以 network 信号形式进入检测器,这里不中断探索
    }
  }

  /** 观察当前页面:标题、URL、可交互元素(同站链接 + 可见按钮) */
  async observe(): Promise<Observation> {
    const pageUrl = this.page.url();
    const pageTitle = await this.page.title().catch(() => '');

    // 字符串形式注入:tsx/esbuild 会给函数注入 __name 等辅助符号,在浏览器上下文不存在,
    // 导致 evaluate 抛错采集为空(vitest 下却正常)。字符串脚本不经任何转换,运行时一致。
    const COLLECT_SCRIPT = `(() => {
      const visible = (el) => el.checkVisibility
        ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        : true;
      const links = [...document.querySelectorAll('a[href]')].filter(visible).map((el) => ({
        text: (el.textContent || '').trim().slice(0, 60),
        href: el.href,
      }));
      const buttons = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')]
        .filter(visible)
        .map((el, i) => ({
          text: ((el.innerText || el.value) || '').trim().slice(0, 60),
          nth: i,
        }));
      const labelFor = (el) => {
        if (el.labels && el.labels.length > 0) return el.labels[0].textContent || '';
        return el.getAttribute('aria-label') || el.placeholder || el.name || '';
      };
      const inputs = [...document.querySelectorAll(
        'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea'
      )]
        .filter(visible)
        .map((el, i) => ({
          label: labelFor(el).trim().slice(0, 60),
          inputType: (el.type || 'text'),
          nth: i,
        }));
      return { links, buttons, inputs };
    })()`;

    interface RawCollect {
      links: { text: string; href: string }[];
      buttons: { text: string; nth: number }[];
      inputs: { label: string; inputType: string; nth: number }[];
    }
    const collect = (): Promise<RawCollect> =>
      (this.page.evaluate(COLLECT_SCRIPT) as Promise<RawCollect>).catch(() => ({
        links: [],
        buttons: [],
        inputs: [],
      }));

    let raw = await collect();
    // SPA 首屏可能还在渲染:一个可交互元素都没有时等一拍重试一次
    if (raw.links.length === 0 && raw.buttons.length === 0 && raw.inputs.length === 0) {
      await this.page.waitForTimeout(1500);
      raw = await collect();
    }

    const interactables: Interactable[] = [];
    for (const l of raw.links) {
      // 同站判断放宽到主域一致:注册/登录常在子域(account.xxx.com),同源过滤会漏掉
      if (!l.href || !isSameSite(l.href, pageUrl)) continue;
      if (l.href.startsWith('javascript:')) continue;
      // 去掉 hash 后与当前页相同 → 页内锚点,跳过;不同 → 是真实导航,保留
      const withoutHash = l.href.split('#')[0] ?? l.href;
      if (withoutHash === pageUrl.split('#')[0]) continue;
      interactables.push({ kind: 'link', text: l.text, url: withoutHash });
    }
    for (const b of raw.buttons) {
      interactables.push({ kind: 'button', text: b.text, nth: b.nth });
    }
    for (const i of raw.inputs) {
      interactables.push({ kind: 'input', label: i.label, inputType: i.inputType, nth: i.nth });
    }
    return { pageUrl, pageTitle, interactables };
  }

  /** 当前位置(实现 ExplorerTarget) */
  async location(): Promise<{ url: string; title: string }> {
    return { url: this.page.url(), title: await this.page.title().catch(() => '') };
  }

  /** 创建 Midscene PlaywrightAgent(复用当前页面) */
  async createAgent(modelConfig?: ModelConfig): Promise<AiAgent> {
    const mod = (await import('@midscene/web/playwright')) as unknown as {
      PlaywrightAgent: new (page: unknown) => AiAgent;
      overrideAIConfig: (c: Record<string, string>) => void;
    };
    applyModelConfig(modelConfig, mod.overrideAIConfig);
    return new mod.PlaywrightAgent(this.page);
  }

  async screenshot(filePath: string): Promise<void> {
    await this.page.screenshot({ path: filePath, fullPage: false }).catch(() => {});
  }

  /** 点击按钮:有文案时按文案精确匹配(与 observe 结果最稳),否则按可见序号 */
  async clickButton(nth: number, text?: string): Promise<void> {
    const base = this.page.locator('button, [role="button"], input[type="submit"]');
    const locator = text
      ? base.filter({ hasText: text }).first()
      : base.locator('visible=true').nth(nth);
    await locator.click({ timeout: this.opts.actionTimeout }).catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  }

  /** 填写第 nth 个可见输入框(与 observe 的枚举顺序一致) */
  async fillInput(nth: number, value: string): Promise<void> {
    const locator = this.page
      .locator(
        'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea',
      )
      .locator('visible=true')
      .nth(nth);
    await locator.fill(value, { timeout: this.opts.actionTimeout }).catch(() => {});
  }

  async dispose(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this._page = null;
  }
}

/** 同站:主域(最后两段)一致即可,如 www.a.com 与 account.a.com */
export function isSameSite(url: string, referenceUrl: string): boolean {
  const site = (raw: string): string | null => {
    try {
      const { hostname } = new URL(raw);
      const labels = hostname.split('.');
      return labels.length <= 2 ? hostname : labels.slice(-2).join('.');
    } catch {
      return null;
    }
  };
  const a = site(url);
  const b = site(referenceUrl);
  return a !== null && a === b;
}
