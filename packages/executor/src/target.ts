import type { Signal } from '@testpilot/shared';
import type { Interactable } from './web-executor.js';

/** 探索目标当前位置(Web=URL/标题;Android=当前 Activity/包名) */
export interface TargetLocation {
  url: string;
  title: string;
}

/** 一次观察:位置 + 可交互元素(启发式大脑用;AI 大脑主要靠截图) */
export interface TargetObservation {
  pageUrl: string;
  pageTitle: string;
  interactables: Interactable[];
}

/**
 * 探索目标的统一执行器接口。Explorer 只依赖它,不感知 Web/Android 差异。
 * WebExecutor(Playwright)与 AndroidExecutor(adb)各自实现。
 */
export interface ExplorerTarget {
  /** 启动并打开目标(Web=URL,Android=包名/deeplink) */
  launch(target: string): Promise<void>;
  /** 目标是否不可达(打开失败) */
  isUnreachable(): boolean;
  /** 观察当前界面 */
  observe(): Promise<TargetObservation>;
  /** 当前位置 */
  location(): Promise<TargetLocation>;
  /** 截图落盘到绝对路径 */
  screenshot(filePath: string): Promise<void>;
  /** 取出自上次调用以来采集到的信号(console/network/logcat 等) */
  drainSignals(): Signal[];
  /** 释放资源 */
  dispose(): Promise<void>;
}
