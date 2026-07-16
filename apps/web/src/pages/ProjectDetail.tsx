import { motion } from 'framer-motion';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ConsoleShell from '../components/ConsoleShell';
import { IconArrowRight, IconBug } from '../components/Icons';
import IssueBoard from '../components/IssueBoard';
import { BackLink, GradientButton, TextInput } from '../components/Ui';
import { api, ApiError, type ApiProject, type ApiRun } from '../lib/api';
import { RunStatusBadge } from '../components/RunStatus';

/** 项目详情:发起探索 + 运行历史 / Bug 看板 */
export default function ProjectDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<ApiProject | null>(null);
  const [runs, setRuns] = useState<ApiRun[]>([]);
  const [tab, setTab] = useState<'runs' | 'issues'>('runs');
  const [goal, setGoal] = useState('');
  const [steps, setSteps] = useState('30');
  const [useRunner, setUseRunner] = useState(false);
  const [error, setError] = useState('');
  const [launching, setLaunching] = useState(false);

  const reload = useCallback(() => {
    api.getProject(id).then(setProject).catch(() => navigate('/console', { replace: true }));
    api.listRuns(id).then(setRuns).catch(() => {});
  }, [id, navigate]);

  useEffect(() => {
    reload();
    // 有进行中的运行时列表轮询
    const timer = setInterval(() => {
      api.listRuns(id).then((rs) => {
        setRuns(rs);
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [id, reload]);

  const onLaunch = async (e: FormEvent) => {
    e.preventDefault();
    setLaunching(true);
    setError('');
    try {
      const run = await api.createRun(id, {
        goal: goal.trim() || undefined,
        stepBudget: Number(steps) || 30,
        useRunner,
      });
      navigate(`/console/runs/${run.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '网络异常,请稍后再试');
      setLaunching(false);
    }
  };

  return (
    <ConsoleShell>
      {(me) => (
        <div>
          <BackLink to="/console">我的项目</BackLink>
          <div className="mt-2 flex flex-wrap items-baseline gap-3">
            <h1 className="text-2xl font-black">{project?.name ?? '…'}</h1>
            <span className="text-sm text-slate-400">{project?.targetUrl}</span>
          </div>

          {/* 发起探索 */}
          <motion.form
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onSubmit={onLaunch}
            className="mt-6 rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">发起 AI 探索</h2>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  me.quota > 0 ? 'bg-indigo-50 text-indigo-600' : 'bg-rose-50 text-rose-500'
                }`}
              >
                剩余额度 {me.quota} 次
              </span>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-[3fr_1fr_auto]">
              <TextInput
                label="探索目标(可选)"
                placeholder="比如:重点测试注册与下单流程"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-slate-600">步数预算</span>
                <input
                  type="number"
                  min={3}
                  max={100}
                  value={steps}
                  onChange={(e) => setSteps(e.target.value)}
                  className="input-glow w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                />
              </label>
              <div className="flex items-end">
                <GradientButton type="submit" disabled={launching} className="inline-flex items-center gap-1.5 !py-3 text-sm">
                  {launching ? '排队中…' : <>开测 <IconArrowRight className="h-4 w-4" /></>}
                </GradientButton>
              </div>
            </div>
            {me.runnerEnabled && (
              <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={useRunner}
                  onChange={(e) => setUseRunner(e.target.checked)}
                  className="h-4 w-4 accent-indigo-500"
                />
                用本机 Runner 执行(Claude CLI 供能,不消耗额度,可测内网/localhost)
              </label>
            )}
            {error && (
              <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600">{error}</p>
            )}
            <p className="mt-3 text-xs text-slate-400">
              {useRunner
                ? '任务将由你电脑上的 runner 领取执行,结果自动回传平台;需确保 runner 正在运行(设置页有启动命令)。'
                : 'AI 像真实用户一样点击、填表单、走完整业务流程,自动发现缺陷并生成带截图的报告;每次探索消耗 1 次额度。'}
            </p>
          </motion.form>

          {/* 标签页:运行历史 / Bug 看板 */}
          <div className="mt-8 flex gap-1 border-b border-slate-200">
            {(
              [
                { key: 'runs', label: '运行历史' },
                { key: 'issues', label: 'Bug 看板' },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative cursor-pointer px-4 py-2.5 text-sm font-bold transition-colors ${
                  tab === t.key ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {t.label}
                {tab === t.key && (
                  <motion.span
                    layoutId="tab-underline"
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-indigo-500 to-pink-500"
                  />
                )}
              </button>
            ))}
          </div>

          {tab === 'issues' ? (
            <div className="mt-5"><IssueBoard projectId={id} /></div>
          ) : runs.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">还没有运行记录,点上面「开测」发起第一次探索。</p>
          ) : (
            <div className="mt-3 space-y-2">
              {runs.map((r) => (
                <Link
                  key={r.id}
                  to={`/console/runs/${r.id}`}
                  className="group flex items-center gap-4 rounded-2xl border border-slate-100 bg-white px-5 py-3.5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <RunStatusBadge status={r.status} />
                  <span className="text-sm font-medium">
                    {r.mode === 'ai' ? 'AI 探索' : r.mode === 'cli' ? 'AI·本地 CLI' : '启发式'}
                    {r.goal ? ` · ${r.goal}` : ''}
                  </span>
                  {r.executor === 'runner' && (
                    <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-semibold text-cyan-600">
                      本机 Runner
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-1.5 text-sm">
                    {r.status === 'done' && (
                      <>
                        <IconBug className={`h-4 w-4 ${r.findingsCount ? 'text-rose-500' : 'text-emerald-500'}`} />
                        <b className={r.findingsCount ? 'text-rose-600' : 'text-emerald-600'}>
                          {r.findingsCount}
                        </b>
                        <span className="text-slate-400">缺陷</span>
                      </>
                    )}
                    {r.status === 'failed' && <span className="text-xs text-rose-500">{r.error}</span>}
                  </span>
                  <span className="text-xs text-slate-400">
                    {new Date(r.createdAt).toLocaleString('zh-CN')}
                  </span>
                  <IconArrowRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-1" />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </ConsoleShell>
  );
}
