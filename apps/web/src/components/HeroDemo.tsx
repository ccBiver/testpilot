import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { IconBug, IconChevronRight } from './Icons';
import { SeverityBadge } from './Ui';

interface DemoEvent {
  kind: 'step' | 'bug';
  text: string;
  level?: '致命' | '严重' | '中等';
}

const SCRIPT: DemoEvent[] = [
  { kind: 'step', text: '打开首页,识别到 12 个可交互元素' },
  { kind: 'step', text: '点击「登录」,输入测试账号' },
  { kind: 'step', text: '进入商品列表,滚动浏览' },
  { kind: 'bug', text: '接口异常:HTTP 500 /api/products', level: '严重' },
  { kind: 'step', text: '点击「加入购物车」' },
  { kind: 'bug', text: '控制台错误:cart is undefined', level: '严重' },
  { kind: 'step', text: '打开「我的订单」页面' },
  { kind: 'bug', text: '页面白屏:渲染内容为空', level: '致命' },
];

/** 宣传页 Hero 右侧:循环播放的「AI 探索实况」模拟窗口 */
export default function HeroDemo() {
  const [count, setCount] = useState(1);

  useEffect(() => {
    const timer = setInterval(() => {
      setCount((c) => (c >= SCRIPT.length ? 1 : c + 1));
    }, 1400);
    return () => clearInterval(timer);
  }, []);

  const visible = SCRIPT.slice(0, count).slice(-5);
  const bugCount = SCRIPT.slice(0, count).filter((e) => e.kind === 'bug').length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30, rotate: 1 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ duration: 0.7, delay: 0.3 }}
      className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-indigo-200/60"
    >
      {/* 窗口标题栏 */}
      <div className="flex items-center gap-2 rounded-t-2xl border-b border-slate-100 bg-slate-50/80 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-red-400" />
        <span className="h-3 w-3 rounded-full bg-yellow-400" />
        <span className="h-3 w-3 rounded-full bg-green-400" />
        <span className="ml-2 flex items-center gap-2 text-xs font-medium text-slate-500">
          <motion.span
            className="inline-block h-2 w-2 rounded-full bg-emerald-500"
            animate={{ opacity: [1, 0.2, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
          AI 探索中 · demo-shop.example.com
        </span>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-500">
          <IconBug className="h-3 w-3" /> {bugCount} 个缺陷
        </span>
      </div>

      {/* 事件流 */}
      <div className="flex h-72 flex-col justify-end gap-2 overflow-hidden p-4">
        <AnimatePresence initial={false}>
          {visible.map((e) => (
            <motion.div
              key={e.text}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className={
                e.kind === 'bug'
                  ? 'flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700'
                  : 'flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-600'
              }
            >
              {e.kind === 'bug' ? (
                <>
                  <IconBug className="h-4 w-4 shrink-0 text-rose-500" />
                  <span className="flex-1">{e.text}</span>
                  {e.level && <SeverityBadge level={e.level} />}
                </>
              ) : (
                <>
                  <IconChevronRight className="h-4 w-4 shrink-0 text-indigo-400" />
                  <span>{e.text}</span>
                </>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
