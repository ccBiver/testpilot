import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { IconFolder, IconLogout, IconSettings, Logo } from './Icons';
import { api, tokenStore, type ApiUser } from '../lib/api';

interface NavItem {
  to: string;
  label: string;
  icon: typeof IconFolder;
  /** 判断当前路由是否属于该导航项 */
  isActive: (path: string) => boolean;
}

// 管理能力在独立的管理后台站点(apps/admin),用户端不出现任何管理入口
const NAV_ITEMS: NavItem[] = [
  {
    to: '/console',
    label: '我的项目',
    icon: IconFolder,
    isActive: (p) => p.startsWith('/console') && !p.startsWith('/console/settings'),
  },
  {
    to: '/console/settings',
    label: '设置',
    icon: IconSettings,
    isActive: (p) => p.startsWith('/console/settings'),
  },
];

/** 控制台通用外壳:登录守卫 + 侧边栏;子内容通过 render prop 拿到当前用户 */
export default function ConsoleShell({ children }: { children: (user: ApiUser) => ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
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

  const items = NAV_ITEMS;
  const logout = () => {
    api.logout();
    navigate('/', { replace: true });
  };

  const linkCls = (active: boolean) =>
    `group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all ${
      active
        ? 'bg-gradient-to-r from-indigo-500 to-pink-500 text-white shadow-md shadow-indigo-500/25'
        : 'text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'
    }`;

  return (
    <div className="flex min-h-screen">
      {/* 桌面侧边栏 */}
      <aside className="sticky top-0 hidden h-screen w-60 flex-col border-r border-slate-100 bg-white/70 p-4 backdrop-blur md:flex">
        <Link to="/" className="px-2 py-2"><Logo /></Link>
        <nav className="mt-6 space-y-1.5">
          {items.map((item) => {
            const active = item.isActive(pathname);
            return (
              <Link key={item.to} to={item.to} className={linkCls(active)}>
                <item.icon
                  className={`h-4.5 w-4.5 transition-transform group-hover:scale-110 ${active ? '' : 'text-slate-400 group-hover:text-indigo-500'}`}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
          <p className="truncate text-xs font-semibold text-slate-600" title={user.email}>
            {user.email}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">{user.role === 'admin' ? '管理员' : '成员'}</p>
          <button
            onClick={logout}
            className="mt-2.5 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-slate-50 py-1.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-500"
          >
            <IconLogout className="h-3.5 w-3.5" /> 退出登录
          </button>
        </div>
      </aside>

      {/* 移动端顶栏 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-100 bg-white/80 px-4 py-3 backdrop-blur md:hidden">
          <Link to="/"><Logo /></Link>
          <div className="flex items-center gap-1">
            {items.map((item) => {
              const active = item.isActive(pathname);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-label={item.label}
                  className={`rounded-xl p-2.5 transition-colors ${active ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:text-indigo-500'}`}
                >
                  <item.icon className="h-5 w-5" />
                </Link>
              );
            })}
            <button onClick={logout} aria-label="退出登录" className="cursor-pointer rounded-xl p-2.5 text-slate-400 transition-colors hover:text-rose-500">
              <IconLogout className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 md:px-8">{children(user)}</main>
      </div>
    </div>
  );
}
