import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from './Icons';
import { api, tokenStore, type ApiUser } from '../lib/api';

/** 控制台通用外壳:登录守卫 + 顶栏;子内容通过 render prop 拿到当前用户 */
export default function ConsoleShell({ children }: { children: (user: ApiUser) => ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<ApiUser | null>(null);

  useEffect(() => {
    if (!tokenStore.access && !tokenStore.refresh) {
      navigate('/login', { replace: true });
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => {
        api.logout();
        navigate('/login', { replace: true });
      });
  }, [navigate]);

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-400">
        加载中…
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-100 bg-white/80 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-6">
          <Link to="/"><Logo /></Link>
          <Link to="/console" className="text-sm font-semibold text-slate-600 transition-colors hover:text-indigo-600">
            我的项目
          </Link>
        </div>
        <div className="flex items-center gap-4">
          {user.role === 'admin' && (
            <Link to="/admin" className="text-sm font-semibold text-indigo-600 hover:underline">
              管理后台
            </Link>
          )}
          <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700">
            {user.email}
          </span>
          <button
            onClick={() => {
              api.logout();
              navigate('/', { replace: true });
            }}
            className="cursor-pointer text-sm font-medium text-slate-500 transition-colors hover:text-rose-500"
          >
            退出
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children(user)}</main>
    </div>
  );
}
