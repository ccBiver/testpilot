import { motion } from 'framer-motion';
import { useState, type FormEvent } from 'react';
import ConsoleShell from '../components/ConsoleShell';
import RunnerTokenSection from '../components/RunnerTokenSection';
import { IconBot } from '../components/Icons';
import { DotLoader, GradientButton, TextInput } from '../components/Ui';
import { api, ApiError } from '../lib/api';

/** 修改密码卡片 */
function PasswordSection() {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (newPassword.length < 8) return setMessage({ kind: 'err', text: '新密码至少需要 8 位' });
    if (newPassword !== confirm) return setMessage({ kind: 'err', text: '两次输入的新密码不一致' });
    setSaving(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      setOldPassword('');
      setNewPassword('');
      setConfirm('');
      setMessage({ kind: 'ok', text: '密码已修改,下次登录请使用新密码' });
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof ApiError ? err.message : '修改失败,请稍后再试' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.form
      onSubmit={onSubmit}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      className="mt-6 max-w-xl rounded-2xl border border-slate-100 bg-white p-6 shadow-sm"
    >
      <h2 className="font-bold">修改密码</h2>
      <div className="mt-4 space-y-4">
        <TextInput
          label="当前密码"
          type="password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          autoComplete="current-password"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            label="新密码(至少 8 位)"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
          <TextInput
            label="确认新密码"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </div>
      </div>
      {message && (
        <motion.p
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          className={`mt-4 rounded-xl px-3 py-2 text-sm font-medium ${
            message.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
          }`}
        >
          {message.text}
        </motion.p>
      )}
      <GradientButton type="submit" disabled={saving} className="mt-5 !px-5 !py-2.5 text-sm">
        {saving ? <DotLoader /> : '保存新密码'}
      </GradientButton>
    </motion.form>
  );
}

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
              无需配置任何 API Key,每次探索消耗 1 次额度,当前剩余{' '}
              <b className="text-indigo-600">{user.quota}</b> 次。额度用完可联系管理员增加。
            </div>
          </motion.div>

          <PasswordSection />

          <RunnerTokenSection enabled={user.runnerEnabled} />
        </div>
      )}
    </ConsoleShell>
  );
}
