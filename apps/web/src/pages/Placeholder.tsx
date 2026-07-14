import { motion } from 'framer-motion';
import { IconRocket } from '../components/Icons';
import { BackLink } from '../components/Ui';

interface PlaceholderProps {
  title: string;
  /** 说明文案,按页面定制 */
  hint?: string;
  /** 内嵌在控制台外壳里(不占满屏、不显示返回首页) */
  embedded?: boolean;
}

/** 功能占位页 */
export default function Placeholder({ title, hint, embedded = false }: PlaceholderProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-6 px-4 text-center ${
        embedded ? 'py-24' : 'min-h-screen'
      }`}
    >
      <motion.span
        className="inline-flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-indigo-500 to-pink-500 text-white shadow-xl shadow-indigo-300/50"
        animate={{ y: [0, -14, 0], rotate: [0, 6, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <IconRocket className="h-12 w-12" />
      </motion.span>
      <h1 className="text-3xl font-black">
        {title} <span className="text-gradient">建设中</span>
      </h1>
      <p className="max-w-sm text-slate-500">
        {hint ?? '这个板块正在路上,敬请期待。'}
      </p>
      {!embedded && <BackLink to="/">回到首页</BackLink>}
    </div>
  );
}
