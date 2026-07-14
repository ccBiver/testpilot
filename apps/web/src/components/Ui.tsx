import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

/** 主按钮:渐变底 + uiverse 风格悬停扫光 + 按压回弹 */
export function GradientButton({
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      {...rest}
      className={`btn-shine cursor-pointer rounded-full bg-gradient-to-r from-indigo-500 to-pink-500 px-6 py-3 font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-pink-500/30 active:translate-y-0 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}

/** 次按钮:描边幽灵样式 */
export function GhostButton({
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      {...rest}
      className={`cursor-pointer rounded-full border-2 border-slate-200 bg-white px-6 py-3 font-semibold text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-300 hover:text-indigo-600 active:scale-95 ${className}`}
    >
      {children}
    </button>
  );
}

/** 输入框:uiverse 风格聚焦发光 */
export function TextInput({
  label,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-600">{label}</span>
      <input
        {...rest}
        className={`input-glow w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-sm outline-none placeholder:text-slate-300 ${className}`}
      />
    </label>
  );
}

/** 三点弹跳加载器(uiverse 常见模式) */
export function DotLoader() {
  return (
    <span className="inline-flex items-center gap-1.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-2 w-2 animate-bounce rounded-full bg-white"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </span>
  );
}

const SEVERITY_STYLES: Record<string, string> = {
  致命: 'bg-red-500',
  严重: 'bg-orange-500',
  中等: 'bg-yellow-500',
  轻微: 'bg-sky-400',
};

/** 缺陷级别徽章 */
export function SeverityBadge({ level }: { level: keyof typeof SEVERITY_STYLES }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold text-white ${SEVERITY_STYLES[level] ?? 'bg-slate-400'}`}>
      {level}
    </span>
  );
}
