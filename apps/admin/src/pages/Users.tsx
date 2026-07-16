import { useCallback, useEffect, useState } from 'react';
import Shell from '../components/Shell';
import { api, ApiError, type AdminUser } from '../lib/api';

export default function Users() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [resetInfo, setResetInfo] = useState<{ email: string; tempPassword: string } | null>(null);

  const load = useCallback(() => {
    api.users().then(setUsers).catch((err) => setError(err instanceof ApiError ? err.message : '加载失败'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = async (
    u: AdminUser,
    body: { status?: 'active' | 'disabled'; runnerEnabled?: boolean; quota?: number },
    confirmText?: string,
  ) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyId(u.id);
    setError('');
    try {
      await api.patchUser(u.id, body);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setBusyId('');
    }
  };

  const resetPassword = async (u: AdminUser) => {
    if (!window.confirm(`确定重置 ${u.email} 的密码?其当前密码将立即失效。`)) return;
    setBusyId(u.id);
    setError('');
    try {
      const tempPassword = await api.resetPassword(u.id);
      setResetInfo({ email: u.email, tempPassword });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '重置失败');
    } finally {
      setBusyId('');
    }
  };

  const editQuota = (u: AdminUser) => {
    const input = window.prompt(`设置 ${u.email} 的剩余额度(当前 ${u.quota} 次):`, String(u.quota));
    if (input === null) return;
    const value = Number(input);
    if (!Number.isInteger(value) || value < 0) {
      setError('额度必须是非负整数');
      return;
    }
    void patch(u, { quota: value });
  };

  return (
    <Shell>
      {(me) => (
        <div>
          <h1 className="text-2xl font-black">用户管理</h1>
          <p className="mt-1 text-sm text-slate-400">共 {users.length} 位用户</p>
          {error && <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600">{error}</p>}
          {resetInfo && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
              <span className="font-medium text-amber-800">
                已重置 {resetInfo.email} 的密码,临时密码(仅显示这一次):
              </span>
              <code className="rounded-lg bg-white px-3 py-1 font-mono text-sm font-bold text-slate-800">
                {resetInfo.tempPassword}
              </code>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(resetInfo.tempPassword).catch(() => {});
                }}
                className="cursor-pointer rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-200"
              >
                复制
              </button>
              <button
                onClick={() => setResetInfo(null)}
                className="cursor-pointer text-xs text-amber-500 hover:underline"
              >
                关闭
              </button>
            </div>
          )}

          <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="px-4 py-3 font-medium">邮箱</th>
                  <th className="px-4 py-3 font-medium">角色</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">Runner</th>
                  <th className="px-4 py-3 font-medium">额度</th>
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
                    <td className="px-4 py-3">
                      <button
                        onClick={() =>
                          patch(
                            u,
                            { runnerEnabled: !u.runnerEnabled },
                            u.runnerEnabled ? `确定回收 ${u.email} 的 Runner 权限?` : undefined,
                          )
                        }
                        disabled={busyId === u.id}
                        className={`cursor-pointer rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                          u.runnerEnabled
                            ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                            : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                        }`}
                      >
                        {u.runnerEnabled ? '已开通' : '未开通'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => editQuota(u)}
                        disabled={busyId === u.id}
                        className="cursor-pointer rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50"
                      >
                        {u.quota} 次
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{u.projectCount}</td>
                    <td className="px-4 py-3 text-slate-500">{u.runCount}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{new Date(u.createdAt).toLocaleDateString('zh-CN')}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {u.id !== me.id && (
                          <button
                            onClick={() =>
                              patch(
                                u,
                                { status: u.status === 'active' ? 'disabled' : 'active' },
                                u.status === 'active' ? `确定禁用 ${u.email}?其登录与任务将立即失效。` : undefined,
                              )
                            }
                            disabled={busyId === u.id}
                            className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                              u.status === 'active'
                                ? 'border-rose-200 text-rose-500 hover:bg-rose-50'
                                : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                            }`}
                          >
                            {u.status === 'active' ? '禁用' : '启用'}
                          </button>
                        )}
                        <button
                          onClick={() => resetPassword(u)}
                          disabled={busyId === u.id}
                          className="cursor-pointer rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-500 transition-colors hover:border-amber-200 hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50"
                        >
                          重置密码
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Shell>
  );
}
