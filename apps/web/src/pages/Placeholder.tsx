import { motion } from 'framer-motion';
import { IconRocket } from '../components/Icons';
import { BackLink } from '../components/Ui';

/** 控制台/后台占位页,M1 实现 */
export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
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
        M1 里这里会出现项目管理、测试任务与 Bug 看板。当前可以先用 CLI 发起探索测试。
      </p>
      <BackLink to="/">回到首页</BackLink>
    </div>
  );
}
