import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebExecutor } from '@testpilot/executor';
import type { RunReport } from '@testpilot/shared';
import { startBuggySite } from '../fixtures/buggy-site.js';
import { Explorer } from './explorer.js';
import { HeuristicBrain } from './brains/heuristic.js';
import { renderHtmlReport } from './report/html.js';

describe('端到端:启发式探索带 Bug 的演示站点', () => {
  let site: Awaited<ReturnType<typeof startBuggySite>>;
  let report: RunReport;
  let brain: HeuristicBrain;
  let outDir: string;

  beforeAll(async () => {
    site = await startBuggySite();
    outDir = await mkdtemp(path.join(os.tmpdir(), 'testpilot-e2e-'));
    const executor = new WebExecutor();
    brain = new HeuristicBrain(executor, site.url);
    const explorer = new Explorer(executor, brain, {
      targetUrl: site.url,
      stepBudget: 15,
      outDir,
      mode: 'heuristic',
    });
    try {
      report = await explorer.run();
    } finally {
      await executor.dispose();
    }
  }, 120_000);

  afterAll(async () => {
    await site.close();
  });

  it('发现埋入的 JS 控制台错误', () => {
    const hits = report.findings.filter((f) => f.detector === 'console-error');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((f) => /cart is undefined|加载产品失败/.test(String(f.evidence.message)))).toBe(true);
  });

  it('发现接口 500(High)与死链 404(Medium)', () => {
    const net = report.findings.filter((f) => f.detector === 'network-failure');
    expect(net.some((f) => f.evidence.status === 500 && f.severity === 'high')).toBe(true);
    expect(net.some((f) => f.evidence.status === 404 && f.severity === 'medium')).toBe(true);
  });

  it('护栏拦截了「删除账号」按钮', () => {
    expect(brain.guardrailSkipped.some((s) => s.includes('删除'))).toBe(true);
    expect(report.steps.every((s) => !s.description.includes('删除账号'))).toBe(true);
  });

  it('每个缺陷都有截图与可读的复现步骤', () => {
    expect(report.findings.length).toBeGreaterThan(0);
    for (const f of report.findings) {
      expect(f.screenshotFile).toMatch(/screenshots\/step-\d+\.png/);
      expect(f.stepSeq).toBeGreaterThanOrEqual(1);
    }
    expect(report.steps[0]?.description).toContain('打开目标页面');
  });

  it('缺陷指纹去重:同一 500 接口多次触发只报一次', () => {
    const fingerprints = report.findings.map((f) => f.fingerprint);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });

  it('HTML 报告可渲染,report.json 已落盘', async () => {
    const html = renderHtmlReport(report);
    expect(html).toContain('TestPilot 测试报告');
    expect(html).toContain('接口/资源异常');

    const persisted = JSON.parse(await readFile(path.join(outDir, 'report.json'), 'utf8')) as RunReport;
    expect(persisted.findings.length).toBe(report.findings.length);
    expect(persisted.targetUrl).toBe(site.url);
  });

  it('目标不可达:尽早终止并产出 Critical「无法访问」缺陷,不烧步数预算', async () => {
    const deadUrl = 'http://127.0.0.1:9/'; // discard 端口,必然拒绝连接
    const dir = await mkdtemp(path.join(os.tmpdir(), 'testpilot-unreachable-'));
    const executor = new WebExecutor();
    const explorer = new Explorer(executor, new HeuristicBrain(executor, deadUrl), {
      targetUrl: deadUrl,
      stepBudget: 20,
      outDir: dir,
      mode: 'heuristic',
    });
    try {
      const result = await explorer.run();
      expect(result.stepsTaken).toBe(1);
      const nav = result.findings.find((f) => f.detector === 'navigation');
      expect(nav?.severity).toBe('critical');
      expect(nav?.title).toContain('无法访问');
    } finally {
      await executor.dispose();
    }
  }, 60_000);
});
