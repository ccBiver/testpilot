import type { CaseResult, CaseRunReport, StepResult } from '@testpilot/shared';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CASE_META: Record<CaseRunReport['results'][number]['status'], { label: string; color: string }> = {
  passed: { label: '通过', color: '#10b981' },
  failed: { label: '失败', color: '#ef4444' },
  blocked: { label: '阻塞', color: '#eab308' },
};

const STEP_META: Record<StepResult['status'], { label: string; color: string }> = {
  pass: { label: '通过', color: '#10b981' },
  fail: { label: '失败', color: '#ef4444' },
  blocked: { label: '阻塞', color: '#eab308' },
};

function stepRow(s: StepResult): string {
  const meta = STEP_META[s.status];
  return `<li>
    <span class="dot" style="background:${meta.color}"></span>
    <div class="step-body">
      <div><b>${esc(s.action)}</b> <span class="pill" style="background:${meta.color}">${meta.label}</span></div>
      ${s.expect ? `<div class="expect">预期:${esc(s.expect)}</div>` : ''}
      ${s.detail ? `<div class="detail">${esc(s.detail)}</div>` : ''}
      <figure><img src="${esc(s.screenshotFile)}" loading="lazy" alt="步骤截图"/></figure>
    </div>
  </li>`;
}

function caseCard(c: CaseResult, index: number): string {
  const meta = CASE_META[c.status];
  return `<details class="card" ${c.status !== 'passed' ? 'open' : ''} style="animation-delay:${index * 60}ms">
    <summary>
      <span class="badge" style="background:${meta.color}">${meta.label}</span>
      <span class="title">${esc(c.name)}</span>
      <span class="count">${c.steps.length} 步</span>
      <span class="chev">▾</span>
    </summary>
    <ol class="steps">${c.steps.map(stepRow).join('')}</ol>
  </details>`;
}

export function renderCaseReport(report: CaseRunReport): string {
  const passRate = report.total ? Math.round((report.passed / report.total) * 100) : 0;
  const stats = [
    { label: '通过率', value: `${passRate}%`, accent: '#10b981' },
    { label: '通过', value: String(report.passed), accent: '#10b981' },
    { label: '失败', value: String(report.failed), accent: '#ef4444' },
    { label: '阻塞', value: String(report.blocked), accent: '#eab308' },
  ]
    .map(
      (s, i) =>
        `<div class="stat" style="animation-delay:${i * 80}ms"><b style="color:${s.accent}">${s.value}</b><span>${s.label}</span></div>`,
    )
    .join('');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>TestPilot 用例报告 · ${esc(report.target)}</title>
<style>
  :root{--bg:#fafbff;--ink:#1e293b;--muted:#64748b;--card:#fff;--line:#e2e8f0}
  *{box-sizing:border-box;margin:0}
  body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;background:var(--bg);color:var(--ink);padding:32px 20px;max-width:1000px;margin:0 auto}
  h1{font-size:26px;background:linear-gradient(90deg,#6366f1,#ec4899);-webkit-background-clip:text;background-clip:text;color:transparent;display:inline-block}
  header p{color:var(--muted);margin-top:6px;font-size:14px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:14px;margin:24px 0}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;text-align:center;animation:pop .5s cubic-bezier(.2,.9,.3,1.4) both}
  .stat b{font-size:28px;display:block}.stat span{color:var(--muted);font-size:13px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;margin-bottom:10px;overflow:hidden;animation:rise .45s ease both}
  summary{display:flex;align-items:center;gap:10px;padding:14px 16px;cursor:pointer;list-style:none}
  summary::-webkit-details-marker{display:none}
  .card[open] .chev{transform:rotate(180deg)}
  .chev{margin-left:auto;transition:transform .25s;color:var(--muted)}
  .badge{color:#fff;border-radius:999px;padding:2px 10px;font-size:12px}
  .title{font-size:14px;font-weight:600}.count{font-size:12px;color:var(--muted)}
  .steps{list-style:none;padding:0 16px 12px;border-top:1px dashed var(--line)}
  .steps li{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #f1f5f9}
  .steps li:last-child{border-bottom:0}
  .dot{width:10px;height:10px;border-radius:50%;margin-top:5px;flex-shrink:0}
  .step-body{flex:1;font-size:13px}
  .pill{color:#fff;border-radius:6px;padding:0 6px;font-size:11px;margin-left:6px}
  .expect{color:var(--muted);margin-top:3px}
  .detail{margin-top:3px;font-size:12px}
  figure{margin:8px 0 0}figure img{max-width:280px;width:100%;border-radius:8px;border:1px solid var(--line)}
  @keyframes pop{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}
  @keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
</style></head><body>
<header>
  <h1>🧪 TestPilot 用例报告</h1>
  <p>目标 <code>${esc(report.target)}</code> · ${report.platform === 'android' ? 'Android' : 'Web'} · ${new Date(report.startedAt).toLocaleString('zh-CN')}</p>
</header>
<div class="stats">${stats}</div>
<h2 style="font-size:18px;margin:20px 0 12px">用例结果(${report.total})</h2>
${report.results.map(caseCard).join('')}
</body></html>`;
}
