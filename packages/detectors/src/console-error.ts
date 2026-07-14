import { makeFingerprint } from '@testpilot/shared';
import type { Detector, FindingDraft } from './types.js';

/** 忽略与被测应用质量无关的常见噪音 */
const NOISE_PATTERNS = [
  /favicon/i,
  /google-?analytics|gtag|doubleclick/i,
  /third-party cookie/i,
  /\[vite\]|\[HMR\]/i,
  // 浏览器对 4xx/5xx 自动打印的消息,网络检测器已有更准确的证据
  /^Failed to load resource:/i,
];

function isNoise(message: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(message));
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 页面 console.error 与未捕获异常 → High 级缺陷 */
export const consoleErrorDetector: Detector = {
  name: 'console-error',
  onSignal(signal): FindingDraft | null {
    if (signal.kind === 'console') {
      if (signal.level !== 'error' || isNoise(signal.message)) return null;
      return {
        detector: this.name,
        severity: 'high',
        title: `控制台错误:${truncate(signal.message, 80)}`,
        fingerprint: makeFingerprint(this.name, signal.message),
        pageUrl: signal.url,
        evidence: { message: truncate(signal.message) },
      };
    }
    if (signal.kind === 'page-error') {
      if (isNoise(signal.message)) return null;
      return {
        detector: this.name,
        severity: 'high',
        title: `未捕获异常:${truncate(signal.message, 80)}`,
        fingerprint: makeFingerprint(this.name, signal.message),
        pageUrl: signal.url,
        evidence: { message: truncate(signal.message), stack: signal.stack && truncate(signal.stack, 1000) },
      };
    }
    return null;
  },
};
