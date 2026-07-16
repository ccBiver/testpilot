import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import Shell from '../components/Shell';
import { RunStatusBadge } from '../components/Ui';
import { api, ApiError, type AdminRun, type PlatformStats } from '../lib/api';

const MODE_LABELS: Record<string, string> = {
  heuristic: '内部冒烟',
  ai: 'AI·平台模型',
  cli: 'AI·本地 CLI',
};

function StatCard({ label, value, accent, delay }: { label: string; value: number; accent: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, delay }}
      className="rounded-2xl border border-slate-100 bg-white p-5 text-center shadow-sm transition-transform hover:-translate-y-0.5"
    >
      <b className="block text-3xl font-black" style={{ color: accent }}>{value}</b>
      <span className="mt-1 block text-xs text-slate-500">{label}</span>
    </motion.div>
  );
}

/** 近 14 天每日运行数(来自最近 50 条运行的客户端聚合) */
function useDailyCounts(runs: AdminRun[]) {
  return useMemo(() => {
    const days: { label: string; count: number }[] = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        count: runs.filter((r) => r.createdAt.slice(0, 10) === key).length,
      });
    }
    return days;
  }, [runs]);
}

export default function Dashboard() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [runs, setRuns] = useState<AdminRun[]>([]);
  const [error, setError] = useState('');
  const daily = useDailyCounts(runs);
  const maxDaily = Math.max(1, ...daily.map((d) => d.count));

  useEffect(() => {
    Promise.all([api.stats(), api.runs()])
      .then(([s, r]) => {
        setStats(s);
        setRuns(r);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : '加载失败'));
  }, []);

  return (
    <Shell>
      {() => (
        <div>
          <h1 className="text-2xl font-black">仪表盘</h1>
          <p className="mt-1 text-sm text-slate-400">平台运营总览,数据实时来自数据库</p>
          {error && <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600">{error}</p>}

          {stats && (
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
              <StatCard label="用户" value={stats.users} accent="#6366f1" delay={0} />
              <StatCard label="活跃用户" value={stats.activeUsers} accent="#10b981" delay={0.05} />
              <StatCard label="项目" value={stats.projects} accent="#06b6d4" delay={0.1} />
              <StatCard label="累计运行" value={stats.runsTotal} accent="#8b5cf6" delay={0.15} />
              <StatCard label="执行中" value={stats.runsActive} accent="#f59e0b" delay={0.2} />
              <StatCard label="未关闭 Bug" value={stats.issuesOpen} accent="#f43f5e" delay={0.25} />
            </div>
          )}

          <h2 className="mt-10 text-lg font-bold">近 14 天运行趋势</h2>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm"
          >
            <div className="flex h-36 items-end gap-1.5">
              {daily.map((d, i) => (
                <div key={d.label} className="group flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] font-semibold text-indigo-500 opacity-0 transition-opacity group-hover:opacity-100">
                    {d.count}
                  </span>
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${Math.max(4, (d.count / maxDaily) * 100)}%` }}
                    transition={{ duration: 0.5, delay: i * 0.03 }}
                    className={`w-full rounded-t-md ${
                      d.count > 0 ? 'bg-gradient-to-t from-indigo-500 to-pink-400' : 'bg-slate-100'
                    }`}
                  />
                  <span className="text-[10px] text-slate-400">{d.label}</span>
                </div>
              ))}
            </div>
          </motion.div>

          <h2 className="mt-10 text-lg font-bold">最近运行({runs.length})</h2>
          <div className="mt-3 space-y-2">
            {runs.length === 0 && <p className="text-sm text-slate-400">还没有运行记录</p>}
            {runs.slice(0, 20).map((r, i) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.4) }}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3 text-sm shadow-sm"
              >
                <RunStatusBadge status={r.status} />
                <span className="font-medium">{r.projectName}</span>
                <span className="text-xs text-slate-400">{r.userEmail}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                  {MODE_LABELS[r.mode] ?? r.mode}
                  {r.executor === 'runner' ? ' · Runner' : ''}
                </span>
                <span className="ml-auto text-xs text-slate-400">
                  {r.findingsCount} 缺陷 · {r.stepsTaken} 步 · {new Date(r.createdAt).toLocaleString('zh-CN')}
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}
