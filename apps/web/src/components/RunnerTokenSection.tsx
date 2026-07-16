import { motion } from 'framer-motion';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type ApiRunnerToken } from '../lib/api';
import { DotLoader, GradientButton, TextInput } from './Ui';

/** 设置页的 Runner Token 管理:创建(明文只显示一次)、列表、删除;能力由管理员开通 */
export default function RunnerTokenSection({ enabled }: { enabled: boolean }) {
  const [tokens, setTokens] = useState<ApiRunnerToken[]>([]);
  const [name, setName] = useState('');
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const reload = () => api.listRunnerTokens().then(setTokens).catch(() => {});
  useEffect(() => {
    if (enabled) void reload();
  }, [enabled]);

  if (!enabled) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mt-6 max-w-xl rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-6"
      >
        <h2 className="font-bold text-slate-500">本机 Runner(未开通)</h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          Runner 可以在你自己的电脑上执行测试任务:用本机的 Claude Code 订阅跑 AI 探索、
          测试内网/localhost 站点。该能力需管理员开通,如有需要请联系管理员。
        </p>
      </motion.section>
    );
  }

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setCreating(true);
    setFreshToken(null);
    try {
      const { plaintext } = await api.createRunnerToken(name.trim() || '我的电脑');
      setFreshToken(plaintext);
      setCopied(false);
      setName('');
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建失败,请稍后再试');
    } finally {
      setCreating(false);
    }
  };

  const onDelete = async (token: ApiRunnerToken) => {
    if (!window.confirm(`删除 Runner Token「${token.name}」?正在使用它的 runner 将立即失效。`)) return;
    await api.deleteRunnerToken(token.id).catch(() => {});
    await reload();
  };

  // 发布到 npm 后改为:npx testpilot-cli runner --token <token> --server <平台地址>
  const copyCommand = freshToken
    ? `pnpm --filter testpilot-cli exec tsx src/index.ts runner --token ${freshToken}`
    : '';

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="mt-6 max-w-xl rounded-2xl border border-slate-100 bg-white p-6 shadow-sm"
    >
      <h2 className="font-bold">本机 Runner</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">
        在你自己的电脑上执行测试任务:可使用本机的 Claude Code 订阅(CLI 模式免 API Key),
        还能测试内网/localhost 站点。创建 Token 后在本机运行 runner 命令即可接单。
        默认后台无头执行,不弹任何窗口;想围观 AI 操作过程,启动命令加 --headed。
      </p>

      <form onSubmit={onCreate} className="mt-4 flex items-end gap-3">
        <div className="flex-1">
          <TextInput
            label="Runner 名称"
            placeholder="如:我的 MacBook"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <GradientButton type="submit" disabled={creating} className="!px-5 !py-2.5 text-sm">
          {creating ? <DotLoader /> : '创建 Token'}
        </GradientButton>
      </form>

      {error && <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600">{error}</p>}

      {freshToken && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3"
        >
          <p className="text-xs font-semibold text-amber-700">
            Token 只显示这一次,请立即复制保存:
          </p>
          <code className="mt-2 block break-all rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
            {freshToken}
          </code>
          <p className="mt-2 text-xs font-semibold text-amber-700">在本机项目目录运行:</p>
          <code className="mt-1 block break-all rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
            {copyCommand}
          </code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(copyCommand);
              setCopied(true);
            }}
            className="mt-2 cursor-pointer rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-200"
          >
            {copied ? '已复制 ✓' : '复制启动命令'}
          </button>
        </motion.div>
      )}

      {tokens.length > 0 && (
        <ul className="mt-4 space-y-2">
          {tokens.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2.5 text-sm"
            >
              <span className={`h-2 w-2 rounded-full ${isOnline(t) ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <span className="font-semibold text-slate-700">{t.name}</span>
              <span className="text-xs text-slate-400">
                {t.lastSeenAt ? `最近活跃 ${new Date(t.lastSeenAt).toLocaleString('zh-CN')}` : '从未连接'}
              </span>
              <button
                type="button"
                onClick={() => onDelete(t)}
                className="ml-auto cursor-pointer text-xs font-semibold text-slate-400 transition-colors hover:text-rose-500"
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
    </motion.section>
  );
}

/** 最近 30 秒有心跳视为在线 */
function isOnline(token: ApiRunnerToken): boolean {
  return !!token.lastSeenAt && Date.now() - new Date(token.lastSeenAt).getTime() < 30_000;
}
