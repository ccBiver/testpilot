import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import ConsoleShell from '../components/ConsoleShell';
import { IconBug, IconChevronRight } from '../components/Icons';
import { RunStatusBadge, SEVERITY_LABELS } from '../components/RunStatus';
import { BackLink } from '../components/Ui';
import { api, type ApiFinding, type ApiRun } from '../lib/api';

/** 需要鉴权的截图:fetch → blob URL */
function Screenshot({ runId, file, className }: { runId: string; file: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    api.fetchArtifact(runId, file).then((u) => {
      url = u;
      setSrc(u);
    }).catch(() => {});
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [runId, file]);
  if (!src) return <div className={`animate-pulse rounded-xl bg-slate-100 ${className ?? 'h-40'}`} />;
  return <img src={src} alt="运行截图" className={`rounded-xl border border-slate-100 ${className ?? ''}`} />;
}

function FindingCard({ finding, run, index }: { finding: ApiFinding; run: ApiRun; index: number }) {
  const [open, setOpen] = useState(false);
  const sev = SEVERITY_LABELS[finding.severity] ?? SEVERITY_LABELS.low!;
  const repro = run.report?.steps.filter((s) => s.seq <= finding.stepSeq).slice(-6) ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm"
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left"
      >
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold text-white ${sev.cls}`}>
          {sev.label}
        </span>
        <span className="flex-1 text-sm font-semibold">{finding.title}</span>
        <IconChevronRight className={`h-4 w-4 text-slate-300 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="grid gap-4 border-t border-dashed border-slate-100 px-5 py-4 md:grid-cols-2">
          <div>
            <h4 className="text-xs font-bold text-indigo-500">复现步骤</h4>
            <ol className="mt-2 space-y-1.5 text-sm text-slate-600">
              {repro.map((s) => (
                <li key={s.seq}>
                  <b className="text-slate-800">步骤 {s.seq}</b> {s.description}
                </li>
              ))}
            </ol>
            <h4 className="mt-4 text-xs font-bold text-indigo-500">证据</h4>
            <pre className="mt-2 max-h-44 overflow-auto rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              {JSON.stringify(finding.evidence, null, 2)}
            </pre>
            <p className="mt-2 truncate text-xs text-slate-400">页面:{finding.pageUrl}</p>
          </div>
          <Screenshot runId={run.id} file={finding.screenshotFile} className="w-full" />
        </div>
      )}
    </motion.div>
  );
}

/** 运行详情:进行中轮询,完成后展示缺陷与轨迹 */
export default function RunDetail() {
  const { id = '' } = useParams();
  const [run, setRun] = useState<ApiRun | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const load = () =>
      api.getRun(id).then((r) => {
        setRun(r);
        if ((r.status === 'done' || r.status === 'failed') && timer) {
          clearInterval(timer);
          timer = null;
        }
      }).catch(() => {});
    load();
    timer = setInterval(load, 1500);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [id]);

  const durationSec =
    run?.startedAt && run.finishedAt
      ? Math.max(1, Math.round((+new Date(run.finishedAt) - +new Date(run.startedAt)) / 1000))
      : null;

  return (
    <ConsoleShell>
      {() => (
        <div>
          {run && <BackLink to={`/console/projects/${run.projectId}`}>返回项目</BackLink>}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-black">运行详情</h1>
            {run && <RunStatusBadge status={run.status} />}
            {run?.goal && <span className="text-sm text-slate-400">目标「{run.goal}」</span>}
          </div>

          {!run && <p className="mt-10 text-center text-sm text-slate-400">加载中…</p>}

          {run && (run.status === 'queued' || run.status === 'running') && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-10 flex flex-col items-center gap-4 text-center"
            >
              <motion.span
                className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-pink-500 text-white shadow-lg shadow-indigo-300/50"
                animate={{ rotate: [0, 8, -8, 0] }}
                transition={{ duration: 1.6, repeat: Infinity }}
              >
                <IconBug className="h-8 w-8" />
              </motion.span>
              <p className="text-slate-500">
                {run.status === 'queued' ? '排队中,马上开始…' : 'AI 正在像真实用户一样探索目标站点…'}
              </p>
              <p className="text-xs text-slate-400">页面会自动刷新,无需手动操作</p>
            </motion.div>
          )}

          {run?.status === 'failed' && (
            <div className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
              运行失败:{run.error ?? '未知原因'}
            </div>
          )}

          {run?.status === 'done' && run.report && (
            <div className="mt-6">
              {/* 统计 */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: '发现缺陷', value: run.findingsCount, accent: run.findingsCount ? 'text-rose-500' : 'text-emerald-500' },
                  { label: '探索步数', value: `${run.stepsTaken}/${run.stepBudget}`, accent: 'text-violet-500' },
                  { label: '覆盖页面', value: run.report.visitedUrls.length, accent: 'text-cyan-500' },
                  { label: '用时', value: durationSec ? `${durationSec}s` : '—', accent: 'text-emerald-500' },
                ].map((s, i) => (
                  <motion.div
                    key={s.label}
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.06 }}
                    className="rounded-2xl border border-slate-100 bg-white p-4 text-center shadow-sm"
                  >
                    <b className={`block text-2xl font-black ${s.accent}`}>{s.value}</b>
                    <span className="text-xs text-slate-400">{s.label}</span>
                  </motion.div>
                ))}
              </div>

              {/* 缺陷 */}
              <h2 className="mt-8 font-bold">缺陷列表({run.findingsCount})</h2>
              {run.report.findings.length === 0 ? (
                <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center text-sm font-semibold text-emerald-700">
                  本次探索未发现缺陷
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {[...run.report.findings]
                    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
                    .map((f, i) => (
                      <FindingCard key={f.id} finding={f} run={run} index={i} />
                    ))}
                </div>
              )}

              {/* 轨迹 */}
              <h2 className="mt-8 font-bold">探索轨迹({run.report.steps.length} 步)</h2>
              <ul className="mt-3 space-y-0.5 border-l-2 border-indigo-100 pl-5">
                {run.report.steps.map((s) => (
                  <li key={s.seq} className="relative py-1.5 text-sm text-slate-600">
                    <span className="absolute -left-[26px] top-2.5 h-2.5 w-2.5 rounded-full bg-gradient-to-br from-indigo-500 to-pink-500" />
                    <b className="text-slate-800">步骤 {s.seq}</b> {s.description}
                    <span className="block truncate text-xs text-slate-400">{s.pageUrl}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </ConsoleShell>
  );
}

function severityRank(sev: string): number {
  return ['critical', 'high', 'medium', 'low'].indexOf(sev);
}
