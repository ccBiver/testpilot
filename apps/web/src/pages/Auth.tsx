import { motion } from 'framer-motion';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Icons';
import { DotLoader, GradientButton, TextInput } from '../components/Ui';
import { api, ApiError } from '../lib/api';

interface AuthProps {
  mode: 'login' | 'register';
}

/** 登录/注册页。M1 接入后端前,提交为模拟行为(进入控制台占位页)。 */
export default function Auth({ mode }: AuthProps) {
  const isLogin = mode === 'login';
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const validate = (): string => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '请输入有效的邮箱地址';
    if (password.length < 8) return '密码至少需要 8 位';
    if (!isLogin && password !== confirm) return '两次输入的密码不一致';
    return '';
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const message = validate();
    setError(message);
    if (message) return;
    setLoading(true);
    try {
      if (isLogin) {
        await api.login(email, password);
      } else {
        await api.register(email, password);
      }
      navigate('/console');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '网络异常,请稍后再试');
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="blob left-[-100px] top-[-60px] h-80 w-80 bg-indigo-300" />
      <div className="blob bottom-[-80px] right-[-80px] h-96 w-96 bg-pink-300" style={{ animationDelay: '-6s' }} />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md rounded-3xl border border-slate-100 bg-white/90 p-8 shadow-2xl shadow-indigo-200/50 backdrop-blur"
      >
        <Link to="/"><Logo /></Link>
        <h1 className="mt-6 text-2xl font-black">{isLogin ? '欢迎回来' : '开始抓 Bug'}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {isLogin ? '登录后继续你的测试任务' : '注册一个账号,发起第一次 AI 探索'}
        </p>

        <form onSubmit={onSubmit} className="mt-7 space-y-4">
          <TextInput
            label="邮箱"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <TextInput
            label="密码"
            type="password"
            placeholder="至少 8 位"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
          />
          {!isLogin && (
            <TextInput
              label="确认密码"
              type="password"
              placeholder="再输一次"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          )}

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
            {loading ? <DotLoader /> : isLogin ? '登录' : '注册并开测'}
          </GradientButton>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          {isLogin ? (
            <>还没有账号?<Link to="/register" className="font-semibold text-indigo-600 hover:underline">免费注册</Link></>
          ) : (
            <>已有账号?<Link to="/login" className="font-semibold text-indigo-600 hover:underline">直接登录</Link></>
          )}
        </p>
      </motion.div>
    </div>
  );
}
