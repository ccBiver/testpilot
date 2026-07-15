/** 缺陷严重级别 */
export type Severity = 'critical' | 'high' | 'medium' | 'low';

/** 多模态模型配置(BYOK):AI 探索模式的供能来源 */
export interface ModelConfig {
  apiKey: string;
  /** OpenAI 兼容接口地址,如 https://dashscope.aliyuncs.com/compatible-mode/v1 */
  baseUrl: string;
  modelName: string;
  /** qwen = Qwen-VL 坐标兼容模式(DashScope 需开启);none = 通用 */
  vlMode: 'none' | 'qwen';
}

/** 探索/执行过程中采集到的原始信号 */
export type Signal =
  | {
      kind: 'console';
      level: 'error' | 'warning';
      message: string;
      url: string;
      at: number;
    }
  | {
      kind: 'page-error';
      message: string;
      stack?: string;
      url: string;
      at: number;
    }
  | {
      kind: 'network';
      method: string;
      requestUrl: string;
      status: number;
      /** 0 表示请求失败(超时/断连),无 HTTP 状态 */
      failureText?: string;
      pageUrl: string;
      at: number;
    }
  | {
      kind: 'crash';
      pageUrl: string;
      at: number;
    };

/** 一步操作的记录(轨迹即复现步骤) */
export interface StepRecord {
  seq: number;
  /** 自然语言描述,如「点击导航栏中的“关于我们”」 */
  description: string;
  pageUrl: string;
  pageTitle: string;
  screenshotFile: string;
  at: number;
}

/** 单条缺陷发现 */
export interface Finding {
  id: string;
  detector: string;
  severity: Severity;
  title: string;
  /** 指纹,用于跨步骤/跨运行去重 */
  fingerprint: string;
  /** 命中时所在页面 */
  pageUrl: string;
  /** 命中时的步骤序号,复现步骤 = steps[0..stepSeq] */
  stepSeq: number;
  screenshotFile: string;
  evidence: Record<string, unknown>;
  at: number;
}

/** 一次运行的完整报告 */
export interface RunReport {
  runId: string;
  mode: 'heuristic' | 'ai';
  targetUrl: string;
  goal?: string;
  startedAt: number;
  finishedAt: number;
  stepBudget: number;
  stepsTaken: number;
  visitedUrls: string[];
  steps: StepRecord[];
  findings: Finding[];
}
