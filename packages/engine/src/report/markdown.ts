import type {
  CaseResult,
  CaseRunReport,
  Finding,
  RunReport,
  Severity,
  StepRecord,
} from '@testpilot/shared';

const SEV_LABEL: Record<Severity, string> = {
  critical: '致命',
  high: '严重',
  medium: '中等',
  low: '轻微',
};
const SEV_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

function reproSteps(finding: Finding, steps: StepRecord[]): StepRecord[] {
  return steps.filter((s) => s.seq <= finding.stepSeq).slice(-6);
}

/** 探索报告 → Markdown(可粘进 Issue / PR / 文档) */
export function renderMarkdownReport(report: RunReport): string {
  const dur = Math.round((report.finishedAt - report.startedAt) / 1000);
  const lines: string[] = [];
  lines.push(`# TestPilot 探索报告`);
  lines.push('');
  lines.push(`- **目标**:${report.targetUrl}`);
  lines.push(`- **模式**:${report.mode === 'ai' ? 'AI 自主探索' : report.mode === 'cli' ? 'AI·本机 CLI' : '启发式'}`);
  if (report.goal) lines.push(`- **目标描述**:${report.goal}`);
  lines.push(`- **时间**:${new Date(report.startedAt).toLocaleString('zh-CN')}`);
  lines.push('');
  lines.push('| 缺陷 | 步数 | 覆盖页面 | 用时 |');
  lines.push('| --- | --- | --- | --- |');
  lines.push(`| ${report.findings.length} | ${report.stepsTaken}/${report.stepBudget} | ${report.visitedUrls.length} | ${dur}s |`);
  lines.push('');

  lines.push(`## 缺陷列表(${report.findings.length})`);
  lines.push('');
  if (report.findings.length === 0) {
    lines.push('> 本次探索未发现缺陷。');
  } else {
    const sorted = SEV_ORDER.flatMap((sev) => report.findings.filter((f) => f.severity === sev));
    sorted.forEach((f, i) => {
      lines.push(`### ${i + 1}. [${SEV_LABEL[f.severity]}] ${f.title}`);
      lines.push('');
      lines.push(`- 检测器:\`${f.detector}\` · 页面:\`${f.pageUrl}\``);
      const repro = reproSteps(f, report.steps).map((s) => `${s.seq}. ${s.description}`);
      if (repro.length) {
        lines.push(`- 复现步骤:`);
        repro.forEach((r) => lines.push(`  ${r}`));
      }
      const ev = f.evidence && Object.keys(f.evidence).length ? JSON.stringify(f.evidence) : '';
      if (ev) lines.push(`- 证据:\`${ev.slice(0, 300)}\``);
      lines.push(`- 截图:\`${f.screenshotFile}\``);
      lines.push('');
    });
  }

  lines.push(`## 探索轨迹(${report.steps.length} 步)`);
  lines.push('');
  report.steps.forEach((s) => lines.push(`${s.seq}. ${s.description}`));
  lines.push('');
  return lines.join('\n');
}

const CASE_LABEL = { passed: '✅ 通过', failed: '❌ 失败', blocked: '⚠️ 阻塞' } as const;
const STEP_MARK = { pass: '✓', fail: '✗', blocked: '⏸' } as const;

/** 用例报告 → Markdown */
export function renderCaseMarkdown(report: CaseRunReport): string {
  const passRate = report.total ? Math.round((report.passed / report.total) * 100) : 0;
  const lines: string[] = [];
  lines.push(`# TestPilot 用例报告`);
  lines.push('');
  lines.push(`- **目标**:${report.target}(${report.platform === 'android' ? 'Android' : 'Web'})`);
  lines.push(`- **时间**:${new Date(report.startedAt).toLocaleString('zh-CN')}`);
  lines.push('');
  lines.push('| 通过率 | 通过 | 失败 | 阻塞 | 合计 |');
  lines.push('| --- | --- | --- | --- | --- |');
  lines.push(`| ${passRate}% | ${report.passed} | ${report.failed} | ${report.blocked} | ${report.total} |`);
  lines.push('');

  report.results.forEach((c: CaseResult, i) => {
    lines.push(`## ${i + 1}. ${c.name} — ${CASE_LABEL[c.status]}`);
    lines.push('');
    c.steps.forEach((s) => {
      const expect = s.expect ? ` — 预期:${s.expect}` : '';
      const detail = s.detail ? ` (${s.detail})` : '';
      lines.push(`- ${STEP_MARK[s.status]} ${s.action}${expect}${detail}`);
    });
    lines.push('');
  });
  return lines.join('\n');
}
