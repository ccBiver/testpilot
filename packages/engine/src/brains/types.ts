import type { Observation } from '@testpilot/executor';

export interface BrainContext {
  goal?: string;
  stepSeq: number;
  stepBudget: number;
  /** 当前页面截图的绝对路径(上一步 recordStep 产出),供多模态大脑查看 */
  lastScreenshot?: string;
}

/** 大脑决定下一步做什么;返回 null 表示无事可做,探索结束 */
export interface StepPlan {
  /** 自然语言描述,进入复现步骤 */
  description: string;
  execute(): Promise<void>;
}

export interface Brain {
  readonly name: string;
  nextStep(obs: Observation, ctx: BrainContext): Promise<StepPlan | null>;
}
