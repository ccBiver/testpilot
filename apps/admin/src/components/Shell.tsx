import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AdminLogo, IconGauge, IconLogout, IconSettings, IconUsers } from './Icons';
import { api, tokenStore, type AdminMe } from '../lib/api';

const NAV = [
  { to: '/', label: '仪表盘', icon: IconGauge },
  { to: '/users', label: '用户管理', icon: IconUsers },
  { to: '/platform', label: '平台设置', icon: IconSettings },
] as const;

/** 管理后台外壳:深色侧边栏 + 管理员守卫(非 admin 一律回登录页) */
export default function Shell({ children }: { children: (me: AdminMe) => ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [me, setMe] = useState<AdminMe | null>(null);

  useEffect(() => {
    if (!tokenStore.access && !tokenStore.refresh) {
      navigate('/login', { replace: true });
      return;
    }
    api
      .me()
      .then((user) => {
        if (user.role !== 'admin') throw new Error('not admin');
        setMe(user);
      })
      .catch(() => {
        api.logout();
        navigate('/login', { replace: true });
      });
  }, [navigate]);

  if (!me) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-400">加载中…</div>
    );
  }

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col bg-slate-900 px-4 py-6">
        <Link to="/"><AdminLogo /></Link>
        <nav className="mt-10 space-y-1.5">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                isActive(item.to)
                  ? 'bg-gradient-to-r from-indigo-500 to-pink-500 text-white shadow-lg shadow-indigo-900/40'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <item.icon className="h-4.5 w-4.5" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto rounded-xl bg-slate-800/70 p-4">
          <p className="truncate text-xs font-medium text-slate-300">{me.email}</p>
          <p className="mt-0.5 text-[10px] text-slate-500">管理员</p>
          <button
            onClick={() => {
              api.logout();
              navigate('/login', { replace: true });
            }}
            className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:bg-rose-500/20 hover:text-rose-300"
          >
            <IconLogout className="h-3.5 w-3.5" /> 退出登录
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-8">{children(me)}</main>
    </div>
  );
}
