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
    }
  | {
      // Android logcat 崩溃/ANR
      kind: 'logcat';
      level: 'fatal' | 'anr' | 'error';
      tag: string;
      message: string;
      /** 当前所在应用包名 */
      pkg: string;
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

/** 测试用例的单步:一个自然语言动作 + 可选断言 */
export interface TestCaseStep {
  /** 要执行的操作,如「点击登录按钮」「在邮箱框输入 test@x.com」 */
  action: string;
  /** 该步执行后应满足的断言,如「页面出现验证码输入框」;省略则只执行不校验 */
  expect?: string;
}

/** 一条测试用例(可手写、可由需求文档/Figma 生成) */
export interface TestCase {
  id: string;
  name: string;
  /** 来源:manual 手写 / doc 需求文档 / figma 设计稿 */
  source?: 'manual' | 'doc' | 'figma';
  steps: TestCaseStep[];
}

/** 用例文件:一批用例 + 被测目标 */
export interface TestCaseSuite {
  /** web=URL,android=包名 */
  target: string;
  platform: 'web' | 'android';
  cases: TestCase[];
}

export type StepStatus = 'pass' | 'fail' | 'blocked';

export interface StepResult {
  action: string;
  expect?: string;
  status: StepStatus;
  /** 断言判定说明或错误原因 */
  detail?: string;
  screenshotFile: string;
  at: number;
}

export type CaseStatus = 'passed' | 'failed' | 'blocked';

export interface CaseResult {
  id: string;
  name: string;
  status: CaseStatus;
  steps: StepResult[];
}

/** 用例回归运行报告 */
export interface CaseRunReport {
  runId: string;
  target: string;
  platform: 'web' | 'android';
  startedAt: number;
  finishedAt: number;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  results: CaseResult[];
}

/** 一次运行的完整报告 */
export interface RunReport {
  runId: string;
  mode: 'heuristic' | 'ai' | 'cli';
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
