import { describe, expect, it } from 'vitest';
import type { CaseRunReport, RunReport } from '@testpilot/shared';
import { renderCaseMarkdown, renderMarkdownReport } from './markdown.js';

const runReport: RunReport = {
  runId: 'r1',
  mode: 'cli',
  targetUrl: 'https://x.com/',
  goal: '测注册',
  startedAt: 1_752_000_000_000,
  finishedAt: 1_752_000_012_000,
  stepBudget: 30,
  stepsTaken: 3,
  visitedUrls: ['https://x.com/', 'https://x.com/reg'],
  steps: [
    { seq: 1, description: '打开首页', pageUrl: 'https://x.com/', pageTitle: '首页', screenshotFile: 'screenshots/step-001.png', at: 0 },
    { seq: 2, description: '点击注册', pageUrl: 'https://x.com/reg', pageTitle: '注册', screenshotFile: 'screenshots/step-002.png', at: 0 },
  ],
  findings: [
    { id: 'f1', detector: 'console-error', severity: 'high', title: 'cart is undefined', fingerprint: 'x', pageUrl: 'https://x.com/', stepSeq: 2, screenshotFile: 'screenshots/step-002.png', evidence: { message: 'boom' }, at: 0 },
  ],
};

describe('renderMarkdownReport', () => {
  it('含标题、统计表、缺陷与复现步骤', () => {
    const md = renderMarkdownReport(runReport);
    expect(md).toContain('# TestPilot 探索报告');
    expect(md).toContain('| 缺陷 | 步数 | 覆盖页面 | 用时 |');
    expect(md).toContain('[严重] cart is undefined');
    expect(md).toContain('复现步骤');
    expect(md).toContain('1. 打开首页');
  });

  it('无缺陷时给出提示', () => {
    const md = renderMarkdownReport({ ...runReport, findings: [] });
    expect(md).toContain('未发现缺陷');
  });
});

const caseReport: CaseRunReport = {
  runId: 'r2',
  target: 'https://x.com/',
  platform: 'web',
  startedAt: 1_752_000_000_000,
  finishedAt: 1_752_000_005_000,
  total: 2,
  passed: 1,
  failed: 1,
  blocked: 0,
  results: [
    { id: 'a', name: '登录成功', status: 'passed', steps: [{ action: '点登录', expect: '进首页', status: 'pass', screenshotFile: 's', at: 0 }] },
    { id: 'b', name: '密码校验', status: 'failed', steps: [{ action: '提交', expect: '报错', status: 'fail', detail: '断言未满足', screenshotFile: 's', at: 0 }] },
  ],
};

describe('renderCaseMarkdown', () => {
  it('含通过率表与每条用例步骤', () => {
    const md = renderCaseMarkdown(caseReport);
    expect(md).toContain('# TestPilot 用例报告');
    expect(md).toContain('| 通过率 | 通过 | 失败 | 阻塞 | 合计 |');
    expect(md).toContain('| 50% | 1 | 1 | 0 | 2 |');
    expect(md).toContain('✅ 通过');
    expect(md).toContain('❌ 失败');
    expect(md).toContain('断言未满足');
  });
});
