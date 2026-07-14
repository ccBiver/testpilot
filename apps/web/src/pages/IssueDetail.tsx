import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ConsoleShell from '../components/ConsoleShell';
import { ISSUE_STATUS_META, SEVERITY_META } from '../components/IssueBoard';
import { api, type ApiIssue, type ApiStep, type IssueStatus } from '../lib/api';

/** 缺陷详情:证据、截图、复现步骤、状态流转 */
export default function IssueDetail() {
  const { id = '' } = useParams();
  const [issue, setIssue] = useState<ApiIssue | null>(null);
  const [reproSteps, setReproSteps] = useState<ApiStep[]>([]);
  const [shotUrl, setShotUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let revoked: string | null = null;
    api.getIssue(id).then(async (data) => {
      setIssue(data);
      if (!data.finding) return;
      // 复现步骤与截图都来自最近一次命中的运行
      api
        .getRun(data.lastRunId)
        .then((run) => {
          const steps = run.report?.steps ?? [];
          setReproSteps(steps.filter((s) => s.seq <= data.finding!.stepSeq).slice(-6));
        })
        .catch(() => {});
      api
        .fetchArtifact(data.lastRunId, data.finding.screenshotFile)
        .then((url) => {
          revoked = url;
          setShotUrl(url);
        })
        .catch(() => {});
    }).catch(() => {});
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [id]);

  const changeStatus = async (status: IssueStatus) => {
    if (!issue) return;
    setSaving(true);
    try {
      const updated = await api.updateIssueStatus(issue.id, status);
      setIssue({ ...issue, status: updated.status });
    } finally {
      setSaving(false);
    }
  };

  if (!issue) {
    return <ConsoleShell>{() => <p className="text-sm text-slate-400">加载中…</p>}</ConsoleShell>;
  }

  const sev = SEVERITY_META[issue.severity] ?? SEVERITY_META.low!;

  return (
    <ConsoleShell>
      {() => (
        <div>
          <Link to={`/console/projects/${issue.projectId}`} className="text-sm text-slate-400 hover:text-indigo-600">
            ← 返回看板
          </Link>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className={`rounded-full px-3 py-1 text-sm font-semibold text-white ${sev.cls}`}>{sev.label}</span>
              <h1 className="text-xl font-black">{issue.title}</h1>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              检测器 {issue.detector} · 复现 ×{issue.occurrences} · 首次{' '}
              {new Date(issue.firstSeenAt).toLocaleString('zh-CN')} · 最近{' '}
              {new Date(issue.lastSeenAt).toLocaleString('zh-CN')}
            </p>

            {/* 状态流转 */}
            <div className="mt-4 flex flex-wrap gap-2">
              {(Object.entries(ISSUE_STATUS_META) as [IssueStatus, { label: string; cls: string }][]).map(
                ([value, meta]) => (
                  <button
                    key={value}
                    disabled={saving || issue.status === value}
                    onClick={() => changeStatus(value)}
                    className={`cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all disabled:cursor-default ${
                      issue.status === value
                        ? `${meta.cls} ring-2 ring-current`
                        : 'bg-white text-slate-400 shadow-sm hover:text-slate-600'
                    }`}
                  >
                    {meta.label}
                  </button>
                ),
              )}
            </div>
          </motion.div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
              <h2 className="font-bold">复现步骤</h2>
              {reproSteps.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">加载中…</p>
              ) : (
                <ol className="mt-3 space-y-2">
                  {reproSteps.map((s) => (
                    <li key={s.seq} className="flex gap-3 rounded-xl bg-white px-4 py-3 text-sm shadow-sm">
                      <b className="text-indigo-500">#{s.seq}</b>
                      <div className="min-w-0">
                        {s.description}
                        <div className="truncate text-xs text-slate-400">{s.pageUrl}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              <h2 className="mt-6 font-bold">证据</h2>
              <pre className="mt-3 max-h-56 overflow-auto rounded-xl bg-slate-100 p-4 text-xs">
                {JSON.stringify(issue.finding?.evidence ?? {}, null, 2)}
              </pre>
              <p className="mt-2 text-xs text-slate-400">
                页面:{issue.finding?.pageUrl} ·{' '}
                <Link to={`/console/runs/${issue.lastRunId}`} className="text-indigo-500 hover:underline">
                  查看完整运行 →
                </Link>
              </p>
            </motion.div>

            <motion.figure initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
              <h2 className="font-bold">现场截图</h2>
              {shotUrl ? (
                <img src={shotUrl} alt="缺陷现场截图" className="mt-3 w-full rounded-2xl border border-slate-200 shadow-sm" />
              ) : (
                <div className="mt-3 flex h-56 items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-400">
                  截图加载中…
                </div>
              )}
            </motion.figure>
          </div>
        </div>
      )}
    </ConsoleShell>
  );
}
