import type { Detector } from './types.js';
import { consoleErrorDetector } from './console-error.js';
import { crashDetector } from './crash.js';
import { networkFailureDetector } from './network-failure.js';
import { logcatDetector } from './logcat.js';

export type { Detector, FindingDraft } from './types.js';
export { consoleErrorDetector, crashDetector, networkFailureDetector, logcatDetector };

/** Web 探索检测器 */
export const webDetectors: readonly Detector[] = [
  crashDetector,
  consoleErrorDetector,
  networkFailureDetector,
];

/** Android 探索检测器 */
export const androidDetectors: readonly Detector[] = [logcatDetector];

/** 默认(向后兼容,= Web 检测器) */
export const defaultDetectors = webDetectors;
