import { motion } from 'framer-motion';
import ConsoleShell from '../components/ConsoleShell';
import RunnerTokenSection from '../components/RunnerTokenSection';
import { IconBot } from '../components/Icons';

/** 设置页:AI 由平台统一供能,这里管理 Runner 等个人能力 */
export default function Settings() {
  return (
    <ConsoleShell>
      {(user) => (
        <div>
          <h1 className="text-2xl font-black">设置</h1>
          <p className="mt-1 text-sm text-slate-400">管理你的测试能力与接入凭证。</p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 flex max-w-xl items-start gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5"
          >
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-pink-500 text-white">
              <IconBot className="h-5 w-5" />
            </span>
            <div className="text-sm leading-relaxed text-slate-600">
              <b className="text-slate-800">AI 探索由平台内置模型供能</b>
              <br />
              无需配置任何 API Key,发起探索时选「AI 探索」即可,模型费用由平台承担。
            </div>
          </motion.div>

          <RunnerTokenSection enabled={user.runnerEnabled} />
        </div>
      )}
    </ConsoleShell>
  );
}
