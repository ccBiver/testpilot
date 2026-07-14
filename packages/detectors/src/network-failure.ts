import { makeFingerprint, normalizeUrl, type Severity } from '@testpilot/shared';
import type { Detector, FindingDraft } from './types.js';

/** 埋点/统计/监控类第三方请求,与被测应用质量无关 */
const IGNORED_URL_PATTERNS = [
  /favicon\.ico/i,
  /google-?analytics|googletagmanager|gtag|doubleclick|hm\.baidu/i,
  /google\.[a-z.]+\/(g|j|r)\/collect/i, // GA4 上报
  /sentry|posthog|mixpanel|segment\.(io|com)|clarity\.ms|hotjar|umami|plausible/i,
  /facebook\.(com|net)\/tr|connect\.facebook/i,
];

function severityOf(status: number, failureText?: string): Severity | null {
  if (failureText) {
    // 导航离开时浏览器主动取消未完成请求,属正常行为
    if (/ERR_ABORTED/i.test(failureText)) return null;
    return 'high'; // 其余请求层失败(超时/断连/DNS)
  }
  if (status >= 500) return 'high';
  if (status === 404 || status === 403 || status === 401) return 'medium';
  if (status >= 400) return 'medium';
  return null;
}

/** HTTP 4xx/5xx 与请求失败 → 缺陷;404 死链降为 Medium */
export const networkFailureDetector: Detector = {
  name: 'network-failure',
  onSignal(signal): FindingDraft | null {
    if (signal.kind !== 'network') return null;
    if (IGNORED_URL_PATTERNS.some((re) => re.test(signal.requestUrl))) return null;

    const severity = severityOf(signal.status, signal.failureText);
    if (!severity) return null;

    const statusLabel = signal.failureText ? `请求失败(${signal.failureText})` : `HTTP ${signal.status}`;
    return {
      detector: this.name,
      severity,
      title: `接口/资源异常:${statusLabel} ${signal.method} ${normalizeUrl(signal.requestUrl)}`,
      fingerprint: makeFingerprint(
        this.name,
        signal.method,
        normalizeUrl(signal.requestUrl),
        signal.failureText ?? String(signal.status),
      ),
      pageUrl: signal.pageUrl,
      evidence: {
        method: signal.method,
        requestUrl: signal.requestUrl,
        status: signal.status,
        failureText: signal.failureText,
      },
    };
  },
};
