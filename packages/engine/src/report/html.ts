import type { Finding, RunReport, Severity, StepRecord } from '@testpilot/shared';

const SEVERITY_META: Record<Severity, { label: string; color: string }> = {
  critical: { label: '致命', color: '#ef4444' },
  high: { label: '严重', color: '#f97316' },
  medium: { label: '中等', color: '#eab308' },
  low: { label: '轻微', color: '#38bdf8' },
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function reproSteps(finding: Finding, steps: StepRecord[]): StepRecord[] {
  return steps.filter((s) => s.seq <= finding.stepSeq).slice(-6);
}

function findingCard(f: Finding, steps: StepRecord[], index: number): string {
  const meta = SEVERITY_META[f.severity];
  const repro = reproSteps(f, steps)
    .map((s) => `<li><b>步骤 ${s.seq}</b> ${esc(s.description)}</li>`)
    .join('');
  const evidence = esc(JSON.stringify(f.evidence, null, 2));
  return `
  <details class="card" style="animation-delay:${index * 60}ms">
    <summary>
      <span class="badge" style="background:${meta.color}">${meta.label}</span>
      <span class="title">${esc(f.title)}</span>
      <span class="chev">▾</span>
    </summary>
    <div class="body">
      <p class="meta">检测器 <code>${esc(f.detector)}</code> · 页面 <code>${esc(f.pageUrl)}</code> · 指纹 <code>${esc(f.fingerprint)}</code></p>
      <div class="cols">
        <div>
          <h4>复现步骤</h4>
          <ol>${repro}</ol>
          <h4>证据</h4>
          <pre>${evidence}</pre>
        </div>
        <figure><img src="${esc(f.screenshotFile)}" alt="现场截图" loading="lazy" /><figcaption>命中时截图(步骤 ${f.stepSeq})</figcaption></figure>
      </div>
    </div>
  </details>`;
}

export function renderHtmlReport(report: RunReport): string {
  const bySeverity = (sev: Severity) => report.findings.filter((f) => f.severity === sev);
  const order: Severity[] = ['critical', 'high', 'medium', 'low'];
  const sorted = order.flatMap(bySeverity);
  const durationSec = Math.round((report.finishedAt - report.startedAt) / 1000);

  const statCards = [
    { label: '发现缺陷', value: String(report.findings.length), accent: '#f43f5e' },
    { label: '探索步数', value: `${report.stepsTaken}/${report.stepBudget}`, accent: '#8b5cf6' },
    { label: '覆盖页面', value: String(report.visitedUrls.length), accent: '#06b6d4' },
    { label: '用时', value: `${durationSec}s`, accent: '#10b981' },
  ]
    .map(
      (s, i) =>
        `<div class="stat" style="animation-delay:${i * 80}ms"><b style="color:${s.accent}">${s.value}</b><span>${s.label}</span></div>`,
    )
    .join('');

  const timeline = report.steps
    .map(
      (s) =>
        `<li><span class="dot"></span><div><b>步骤 ${s.seq}</b> ${esc(s.description)}<br/><small>${esc(s.pageUrl)}</small></div></li>`,
    )
    .join('');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>TestPilot 报告 · ${esc(report.targetUrl)}</title>
<style>
  :root{--bg:#fafbff;--ink:#1e293b;--muted:#64748b;--card:#fff;--line:#e2e8f0}
  *{box-sizing:border-box;margin:0}
  body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;background:var(--bg);color:var(--ink);padding:32px 20px;max-width:1000px;margin:0 auto}
  header h1{font-size:26px;background:linear-gradient(90deg,#6366f1,#ec4899);-webkit-background-clip:text;background-clip:text;color:transparent;display:inline-block}
  header p{color:var(--muted);margin-top:6px;font-size:14px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin:24px 0}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;text-align:center;animation:pop .5s cubic-bezier(.2,.9,.3,1.4) both;transition:transform .2s}
  .stat:hover{transform:translateY(-3px)}
  .stat b{font-size:28px;display:block}.stat span{color:var(--muted);font-size:13px}
  h2{font-size:18px;margin:28px 0 12px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;margin-bottom:10px;overflow:hidden;animation:rise .45s ease both}
  .card summary{display:flex;align-items:center;gap:10px;padding:14px 16px;cursor:pointer;list-style:none}
  .card summary::-webkit-details-marker{display:none}
  .card[open] .chev{transform:rotate(180deg)}
  .chev{margin-left:auto;transition:transform .25s;color:var(--muted)}
  .badge{color:#fff;border-radius:999px;padding:2px 10px;font-size:12px;flex-shrink:0}
  .title{font-size:14px;font-weight:600}
  .body{padding:0 16px 16px;border-top:1px dashed var(--line)}
  .meta{font-size:12px;color:var(--muted);margin:10px 0}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  @media(max-width:720px){.cols{grid-template-columns:1fr}}
  h4{font-size:13px;margin:8px 0 6px;color:#6366f1}
  ol{padding-left:20px;font-size:13px;line-height:1.9}
  pre{background:#f1f5f9;border-radius:10px;padding:10px;font-size:12px;overflow:auto;max-height:180px}
  code{background:#f1f5f9;border-radius:6px;padding:1px 6px;font-size:12px}
  figure img{width:100%;border-radius:10px;border:1px solid var(--line)}
  figcaption{font-size:12px;color:var(--muted);text-align:center;margin-top:6px}
  .timeline{list-style:none;padding-left:6px}
  .timeline li{display:flex;gap:12px;padding:7px 0;font-size:13px;border-left:2px solid #e0e7ff;padding-left:14px;position:relative}
  .dot{position:absolute;left:-6px;top:13px;width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#ec4899)}
  .timeline small{color:var(--muted)}
  .empty{background:linear-gradient(135deg,#ecfdf5,#f0fdfa);border:1px solid #a7f3d0;color:#047857;border-radius:14px;padding:22px;text-align:center;font-weight:600}
  @keyframes pop{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}
  @keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
</style></head><body>
<header>
  <h1><svg viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22" style="vertical-align:-3px;margin-right:6px"><path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4 4-4 4-4-4"/><path d="m8 12 4 4 6-6-4-4Z"/><path d="m16 8 3-3"/><path d="M9 21a6 6 0 0 0-6-6"/></svg>TestPilot 测试报告</h1>
  <p>目标 <code>${esc(report.targetUrl)}</code> · 模式 ${report.mode === 'ai' ? 'AI 自主探索' : '启发式爬行'}${report.goal ? ` · 目标「${esc(report.goal)}」` : ''} · ${new Date(report.startedAt).toLocaleString('zh-CN')}</p>
</header>
<div class="stats">${statCards}</div>
<h2>缺陷列表(${report.findings.length})</h2>
${sorted.length ? sorted.map((f, i) => findingCard(f, report.steps, i)).join('') : '<div class="empty">✔ 本次探索未发现缺陷</div>'}
<h2>探索轨迹(${report.steps.length} 步)</h2>
<ul class="timeline">${timeline}</ul>
</body></html>`;
}
