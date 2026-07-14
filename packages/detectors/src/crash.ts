import { makeFingerprint, normalizeUrl } from '@testpilot/shared';
import type { Detector, FindingDraft } from './types.js';

/** 页面进程崩溃 → Critical */
export const crashDetector: Detector = {
  name: 'crash',
  onSignal(signal): FindingDraft | null {
    if (signal.kind !== 'crash') return null;
    return {
      detector: this.name,
      severity: 'critical',
      title: `页面崩溃:${normalizeUrl(signal.pageUrl)}`,
      fingerprint: makeFingerprint(this.name, normalizeUrl(signal.pageUrl)),
      pageUrl: signal.pageUrl,
      evidence: {},
    };
  },
};
