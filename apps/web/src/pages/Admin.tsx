import { motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ConsoleShell from '../components/ConsoleShell';
import { RunStatusBadge } from '../components/RunStatus';
import {
  api,
  ApiError,
  type ApiAdminRun,
  type ApiAdminStats,
  type ApiAdminUser,
  type ApiUser,
} from '../lib/api';

const MODE_LABELS: Record<string, string> = {
  heuristic: '启发式',
  ai: 'AI·Key',
  cli: 'AI·CLI',
};

function StatCard({ label, value, accent, delay }: { label: string; value: number; accent: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, delay }}
      className="rounded-2xl border border-slate-100 bg-white p-5 text-center shadow-sm transition-transform hover:-translate-y-0.5"
    >
      <b className="block text-3xl font-black" style={{ color: accent }}>
        {value}
      </b>
      <span className="mt-1 block text-xs text-slate-500">{label}</span>
    </motion.div>
  );
}

/** 管理后台:平台统计 / 用户管理 / 运行监控(仅 admin) */
export default function Admin() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<ApiAdminStats | null>(null);
  const [users, setUsers] = useState<ApiAdminUser[]>([]);
  const [runs, setRuns] = useState<ApiAdminRun[]>([]);
  const [error, setError] = useState('');
  const [busyUserId, setBusyUserId] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, u, r] = await Promise.all([api.adminStats(), api.adminUsers(), api.adminRuns()]);
      setStats(s);
      setUsers(u);
      setRuns(r);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载失败,请稍后再试');
    }
  }, []);

  const guard = useCallback(
    (user: ApiUser) => {
      if (user.role !== 'admin') navigate('/console', { replace: true });
    },
    [navigate],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const toggleUser = async (u: ApiAdminUser) => {
    const next = u.status === 'active' ? 'disabled' : 'active';
    if (next === 'disabled' && !window.confirm(`确定禁用 ${u.email}?其登录与任务将立即失效。`)) return;
    setBusyUserId(u.id);
    try {
      await api.adminSetUserStatus(u.id, next);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setBusyUserId('');
    }
  };

  return (
    <ConsoleShell>
      {(me) => {
        guard(me);
        return (
          <div>
            <h1 className="text-2xl font-black">管理后台</h1>
            <p className="mt-1 text-sm text-slate-400">平台运营总览,数据实时来自数据库</p>

            {error && (
              <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600">{error}</p>
            )}

            {stats && (
              <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <StatCard label="用户" value={stats.users} accent="#6366f1" delay={0} />
                <StatCard label="活跃用户" value={stats.activeUsers} accent="#10b981" delay={0.05} />
                <StatCard label="项目" value={stats.projects} accent="#06b6d4" delay={0.1} />
                <StatCard label="累计运行" value={stats.runsTotal} accent="#8b5cf6" delay={0.15} />
                <StatCard label="执行中" value={stats.runsActive} accent="#f59e0b" delay={0.2} />
                <StatCard label="未关闭 Bug" value={stats.issuesOpen} accent="#f43f5e" delay={0.25} />
              </div>
            )}

            <h2 className="mt-10 text-lg font-bold">用户管理({users.length})</h2>
            <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                    <th className="px-4 py-3 font-medium">邮箱</th>
                    <th className="px-4 py-3 font-medium">角色</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 font-medium">项目</th>
                    <th className="px-4 py-3 font-medium">运行</th>
                    <th className="px-4 py-3 font-medium">注册时间</th>
                    <th className="px-4 py-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-medium">{u.email}</td>
                      <td className="px-4 py-3">
                        {u.role === 'admin' ? (
                          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-600">管理员</span>
                        ) : (
                          <span className="text-xs text-slate-500">成员</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                            u.status === 'active' ? 'text-emerald-600' : 'text-slate-400'
                          }`}
                        >
                          <span className={`h-2 w-2 rounded-full ${u.status === 'active' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                          {u.status === 'active' ? '正常' : '已禁用'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{u.projectCount}</td>
                      <td className="px-4 py-3 text-slate-500">{u.runCount}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        {new Date(u.createdAt).toLocaleDateString('zh-CN')}
                      </td>
                      <td className="px-4 py-3">
                        {u.id !== me.id && (
                          <button
                            onClick={() => toggleUser(u)}
                            disabled={busyUserId === u.id}
                            className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                              u.status === 'active'
                                ? 'border-rose-200 text-rose-500 hover:bg-rose-50'
                                : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                            }`}
                          >
                            {u.status === 'active' ? '禁用' : '启用'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 className="mt-10 text-lg font-bold">最近运行({runs.length})</h2>
            <div className="mt-3 space-y-2">
              {runs.length === 0 && <p className="text-sm text-slate-400">还没有运行记录</p>}
              {runs.map((r, i) => (
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
        );
      }}
    </ConsoleShell>
  );
}
