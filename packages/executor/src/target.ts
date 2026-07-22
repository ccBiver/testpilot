import type { ModelConfig, Signal } from '@testpilot/shared';
import type { Interactable } from './web-executor.js';

/** Midscene 多模态 agent 的统一子集(Web/Android 都提供),供 AI 探索与用例执行复用 */
export interface AiAgent {
  /** 执行一个自然语言操作 */
  aiAction(instruction: string): Promise<unknown>;
  /** 判定断言真假(不抛异常,返回 true/false) */
  aiBoolean(question: string): Promise<boolean>;
  /**
   * 可选:一次完成「执行操作 + 判定预期」。
   * 支持的 agent 能在确认目标达成的同一次模型调用里顺带判断 expect,省一次调用;
   * trace 是本步实际执行的动作轨迹(对 agent 不透明的 JSON 值),可存下来供下次回放。
   */
  aiStep?(instruction: string, expect?: string): Promise<{ ok: boolean; trace?: unknown }>;
  /**
   * 可选:按之前录制的轨迹直接回放(不叫模型,秒级)。
   * 回放后是否真达成由调用方用 expect 断言判定,失败再降级回 aiStep 自愈。
   */
  replay?(trace: unknown): Promise<void>;
}

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
  /** 创建多模态 AI agent(用例执行 / AI 探索);需模型配置或环境变量 */
  createAgent(modelConfig?: ModelConfig): Promise<AiAgent>;
  /** 释放资源 */
  dispose(): Promise<void>;
}
