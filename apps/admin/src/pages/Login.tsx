import { motion } from 'framer-motion';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconShield } from '../components/Icons';
import { DotLoader, GradientButton, TextInput } from '../components/Ui';
import { api, ApiError } from '../lib/api';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败,请稍后再试');
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-2xl shadow-indigo-950/50"
      >
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-pink-500 text-white shadow-lg shadow-indigo-500/40">
          <IconShield className="h-6 w-6" />
        </span>
        <h1 className="mt-5 text-2xl font-black">管理后台</h1>
        <p className="mt-1 text-sm text-slate-500">仅限管理员账号登录</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <TextInput
            label="邮箱"
            type="email"
            placeholder="admin@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <TextInput
            label="密码"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {error && (
            <motion.p
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600"
            >
              {error}
            </motion.p>
          )}
          <GradientButton type="submit" disabled={loading} className="w-full">
            {loading ? <DotLoader /> : '登录'}
          </GradientButton>
        </form>
      </motion.div>
    </div>
  );
}
