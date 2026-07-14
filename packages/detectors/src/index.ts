import type { Detector } from './types.js';
import { consoleErrorDetector } from './console-error.js';
import { crashDetector } from './crash.js';
import { networkFailureDetector } from './network-failure.js';

export type { Detector, FindingDraft } from './types.js';
export { consoleErrorDetector, crashDetector, networkFailureDetector };

export const defaultDetectors: readonly Detector[] = [
  crashDetector,
  consoleErrorDetector,
  networkFailureDetector,
];
