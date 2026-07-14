import { motion } from 'framer-motion';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import ConsoleShell from '../components/ConsoleShell';
import { IconArrowRight, IconRocket, IconSatellite } from '../components/Icons';
import { GradientButton, TextInput } from '../components/Ui';
import { api, ApiError, type ApiProject } from '../lib/api';

/** 控制台首页:项目列表 + 新建项目 */
export default function Console() {
  const [projects, setProjects] = useState<ApiProject[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(() => {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  useEffect(reload, [reload]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.createProject(name, targetUrl);
      setName('');
      setTargetUrl('');
      setShowForm(false);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '网络异常,请稍后再试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConsoleShell>
      {() => (
        <div>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-black">我的项目</h1>
            <GradientButton className="!px-5 !py-2 text-sm" onClick={() => setShowForm((v) => !v)}>
              {showForm ? '收起' : '+ 新建项目'}
            </GradientButton>
          </div>

          {showForm && (
            <motion.form
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              onSubmit={onCreate}
              className="mt-4 grid gap-4 rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm sm:grid-cols-[1fr_1.4fr_auto]"
            >
              <TextInput
                label="项目名称"
                placeholder="比如:商城前台"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <TextInput
                label="目标网址"
                placeholder="https://example.com"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
              />
              <div className="flex items-end">
                <GradientButton type="submit" disabled={saving} className="!py-3 text-sm">
                  {saving ? '创建中…' : '创建'}
                </GradientButton>
              </div>
              {error && (
                <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600 sm:col-span-3">
                  {error}
                </p>
              )}
            </motion.form>
          )}

          {projects === null ? (
            <p className="mt-10 text-center text-sm text-slate-400">加载中…</p>
          ) : projects.length === 0 ? (
            <div className="mt-14 flex flex-col items-center gap-4 text-center">
              <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-pink-500 text-white">
                <IconRocket className="h-8 w-8" />
              </span>
              <p className="text-slate-500">
                还没有项目。新建一个,填上要测试的网址,就能发起第一次探索。
              </p>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {projects.map((p, i) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Link
                    to={`/console/projects/${p.id}`}
                    className="group block rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg hover:shadow-indigo-100"
                  >
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500">
                        <IconSatellite className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-bold">{p.name}</h3>
                        <p className="truncate text-xs text-slate-400">{p.targetUrl}</p>
                      </div>
                      <IconArrowRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-indigo-400" />
                    </div>
                    <p className="mt-3 text-xs text-slate-400">已运行 {p.runCount} 次</p>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}
    </ConsoleShell>
  );
}
