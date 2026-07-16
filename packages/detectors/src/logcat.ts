import { makeFingerprint } from '@testpilot/shared';
import type { Detector, FindingDraft } from './types.js';

/** 从 FATAL EXCEPTION 行里抽出异常类名与 activity manager 噪音,用于稳定指纹 */
function crashSignature(message: string): string {
  const exception = message.match(/([\w.]+(?:Exception|Error))/);
  return exception?.[1] ?? message;
}

/** Android logcat 崩溃(闪退,Critical)与 ANR(无响应,High) */
export const logcatDetector: Detector = {
  name: 'logcat',
  onSignal(signal): FindingDraft | null {
    if (signal.kind !== 'logcat') return null;

    if (signal.level === 'anr') {
      return {
        detector: this.name,
        severity: 'high',
        title: `应用无响应(ANR):${signal.pkg}`,
        fingerprint: makeFingerprint(this.name, 'anr', signal.pkg),
        pageUrl: `app://${signal.pkg}`,
        evidence: { message: signal.message },
      };
    }

    // fatal / AndroidRuntime error → 闪退
    const sig = crashSignature(signal.message);
    return {
      detector: this.name,
      severity: 'critical',
      title: `应用崩溃闪退:${sig.slice(0, 80)}`,
      fingerprint: makeFingerprint(this.name, 'crash', signal.pkg, sig),
      pageUrl: `app://${signal.pkg}`,
      evidence: { message: signal.message, tag: signal.tag },
    };
  },
};
