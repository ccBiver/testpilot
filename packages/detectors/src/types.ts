import type { Finding, Signal } from '@testpilot/shared';

/** 检测器命中后产出的缺陷草稿,id/step/截图等运行期字段由探索器补全 */
export type FindingDraft = Omit<Finding, 'id' | 'stepSeq' | 'screenshotFile' | 'at'>;

export interface Detector {
  readonly name: string;
  /** 返回 null 表示该信号不构成缺陷 */
  onSignal(signal: Signal): FindingDraft | null;
}
