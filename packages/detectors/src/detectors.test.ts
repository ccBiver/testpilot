import { describe, expect, it } from 'vitest';
import type { Signal } from '@testpilot/shared';
import { consoleErrorDetector, crashDetector, networkFailureDetector } from './index.js';

const NOW = 1_752_000_000_000;

describe('consoleErrorDetector', () => {
  const consoleSignal = (level: 'error' | 'warning', message: string): Signal => ({
    kind: 'console',
    level,
    message,
    url: 'https://a.com/p',
    at: NOW,
  });

  it('console.error → High 缺陷', () => {
    const f = consoleErrorDetector.onSignal(consoleSignal('error', 'TypeError: boom'));
    expect(f).not.toBeNull();
    expect(f?.severity).toBe('high');
    expect(f?.fingerprint).toMatch(/^console-error:/);
  });

  it('warning 与噪音(favicon/analytics)被忽略', () => {
    expect(consoleErrorDetector.onSignal(consoleSignal('warning', 'meh'))).toBeNull();
    expect(
      consoleErrorDetector.onSignal(consoleSignal('error', 'Failed to load favicon.ico')),
    ).toBeNull();
  });

  it('未捕获异常 → High,含堆栈证据', () => {
    const f = consoleErrorDetector.onSignal({
      kind: 'page-error',
      message: 'ReferenceError: x is not defined',
      stack: 'at main.js:1',
      url: 'https://a.com',
      at: NOW,
    });
    expect(f?.severity).toBe('high');
    expect(f?.evidence.stack).toBeTruthy();
  });

  it('同一错误不同行号 → 相同指纹', () => {
    const a = consoleErrorDetector.onSignal(consoleSignal('error', 'boom at line 10'));
    const b = consoleErrorDetector.onSignal(consoleSignal('error', 'boom at line 42'));
    expect(a?.fingerprint).toBe(b?.fingerprint);
  });
});

describe('networkFailureDetector', () => {
  const net = (status: number, failureText?: string): Signal => ({
    kind: 'network',
    method: 'GET',
    requestUrl: `https://a.com/api/items/7`,
    status,
    failureText,
    pageUrl: 'https://a.com/list',
    at: NOW,
  });

  it('5xx → High,404 → Medium,2xx 忽略', () => {
    expect(networkFailureDetector.onSignal(net(500))?.severity).toBe('high');
    expect(networkFailureDetector.onSignal(net(404))?.severity).toBe('medium');
    expect(networkFailureDetector.onSignal(net(200))).toBeNull();
  });

  it('请求层失败(无 HTTP 状态)→ High', () => {
    expect(networkFailureDetector.onSignal(net(0, 'net::ERR_TIMED_OUT'))?.severity).toBe('high');
  });

  it('同接口不同资源 id → 相同指纹', () => {
    const a = networkFailureDetector.onSignal(net(500));
    const b = networkFailureDetector.onSignal({ ...net(500), requestUrl: 'https://a.com/api/items/99?x=1' } as Signal);
    expect(a?.fingerprint).toBe(b?.fingerprint);
  });

  it('导航取消(ERR_ABORTED)不算缺陷', () => {
    expect(networkFailureDetector.onSignal(net(0, 'net::ERR_ABORTED'))).toBeNull();
  });

  it('埋点/统计类第三方请求被忽略(GA4/GTM/Sentry)', () => {
    const analytics = (url: string): Signal => ({ ...net(500), requestUrl: url } as Signal);
    expect(networkFailureDetector.onSignal(analytics('https://www.google.com/g/collect?v=2'))).toBeNull();
    expect(networkFailureDetector.onSignal(analytics('https://www.googletagmanager.com/gtm.js'))).toBeNull();
    expect(networkFailureDetector.onSignal(analytics('https://o123.ingest.sentry.io/api/1/envelope'))).toBeNull();
  });
});

describe('crashDetector', () => {
  it('崩溃信号 → Critical', () => {
    const f = crashDetector.onSignal({ kind: 'crash', pageUrl: 'https://a.com/x', at: NOW });
    expect(f?.severity).toBe('critical');
  });

  it('其他信号忽略', () => {
    expect(
      crashDetector.onSignal({ kind: 'console', level: 'error', message: 'x', url: 'u', at: NOW }),
    ).toBeNull();
  });
});
