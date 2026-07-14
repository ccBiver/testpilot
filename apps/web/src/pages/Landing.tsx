import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import HeroDemo from '../components/HeroDemo';
import {
  IconArrowRight,
  IconBot,
  IconCamera,
  IconRefresh,
  IconSatellite,
  IconSmartphone,
  IconSparkles,
  Logo,
} from '../components/Icons';
import { GhostButton, GradientButton } from '../components/Ui';

const rise = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.55 },
} as const;

const FEATURES = [
  { icon: IconBot, tint: 'bg-indigo-50 text-indigo-500', title: 'AI 自主探索', desc: '像真实用户一样点击、输入、走流程,不写一行脚本,自动发现崩溃、报错与流程阻塞。' },
  { icon: IconSmartphone, tint: 'bg-pink-50 text-pink-500', title: 'Web + App 双端', desc: '一套平台同时覆盖网页与 Android 应用,视觉驱动不依赖选择器,UI 改版也不怕。' },
  { icon: IconCamera, tint: 'bg-cyan-50 text-cyan-500', title: '证据齐全的报告', desc: '每个 Bug 附截图、复现步骤、控制台与网络错误证据,严重级别自动分级,拒绝口说无凭。' },
  { icon: IconRefresh, tint: 'bg-emerald-50 text-emerald-500', title: '用例回归', desc: '用自然语言或表格导入用例,一键回归,发版前自动验证核心流程没被改坏。' },
];

const STEPS = [
  { num: '01', title: '提交目标', desc: '粘贴网址或上传 App,写一句探索目标,比如「重点测试下单流程」。' },
  { num: '02', title: 'AI 开测', desc: '探索代理自动遍历页面与流程,内置护栏,绝不触碰支付、删除等危险操作。' },
  { num: '03', title: '收获报告', desc: 'Bug 自动去重归档到看板,按严重级别排序,点开就能看到复现路径。' },
];

const DEMO_BUGS = [
  { level: '致命', color: 'bg-red-500', title: '结算页白屏:JS 运行时崩溃', tag: '崩溃' },
  { level: '严重', color: 'bg-orange-500', title: '商品搜索接口 HTTP 500', tag: '接口' },
  { level: '严重', color: 'bg-orange-500', title: '未捕获异常:cart is undefined', tag: '控制台' },
  { level: '中等', color: 'bg-yellow-500', title: '帮助中心链接 404 死链', tag: '死链' },
];

export default function Landing() {
  return (
    <div className="relative overflow-hidden">
      {/* 漂浮背景色斑 */}
      <div className="blob left-[-120px] top-[-80px] h-96 w-96 bg-indigo-300" />
      <div className="blob right-[-100px] top-40 h-80 w-80 bg-pink-300" style={{ animationDelay: '-5s' }} />
      <div className="blob bottom-0 left-1/3 h-72 w-72 bg-cyan-200" style={{ animationDelay: '-9s' }} />

      {/* 导航 */}
      <nav className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link to="/"><Logo size="lg" /></Link>
        <div className="hidden gap-8 text-sm font-medium text-slate-600 md:flex">
          <a href="#features" className="transition-colors hover:text-indigo-600">功能</a>
          <a href="#how" className="transition-colors hover:text-indigo-600">工作原理</a>
          <a href="#report" className="transition-colors hover:text-indigo-600">报告示例</a>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-sm font-semibold text-slate-600 transition-colors hover:text-indigo-600">登录</Link>
          <Link to="/register">
            <GradientButton className="!px-5 !py-2 text-sm">免费注册</GradientButton>
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 mx-auto flex max-w-6xl flex-col items-center gap-12 px-6 pb-24 pt-14 lg:flex-row">
        <div className="flex-1">
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55 }}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-600">
              <IconSparkles className="h-3.5 w-3.5" /> AI 驱动的自动化测试平台
            </span>
            <h1 className="mt-5 text-4xl font-black leading-tight md:text-6xl">
              让 AI 替你
              <br />
              把 <span className="text-gradient">Bug</span> 找出来
            </h1>
            <p className="mt-5 max-w-md text-lg text-slate-500">
              给一个网址或 App,TestPilot 像真实用户一样自主探索,
              自动发现缺陷,生成带截图和复现步骤的 Bug 报告。
            </p>
          </motion.div>
          <motion.div
            className="mt-8 flex flex-wrap gap-4"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.15 }}
          >
            <Link to="/register">
              <GradientButton className="inline-flex items-center gap-2">
                立即开测 <IconArrowRight className="h-4 w-4" />
              </GradientButton>
            </Link>
            <a href="#how"><GhostButton>看看怎么工作的</GhostButton></a>
          </motion.div>
          <motion.p
            className="mt-6 text-xs text-slate-400"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
          >
            无需写测试脚本 · 内置危险操作护栏 · 支持自托管模型控制成本
          </motion.p>
        </div>
        <div className="flex flex-1 justify-center"><HeroDemo /></div>
      </section>

      {/* 功能亮点 */}
      <section id="features" className="relative z-10 mx-auto max-w-6xl px-6 py-20">
        <motion.h2 {...rise} className="text-center text-3xl font-black">
          为什么选 <span className="text-gradient">TestPilot</span>
        </motion.h2>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              {...rise}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              whileHover={{ y: -6, rotate: i % 2 ? 0.6 : -0.6 }}
              className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm shadow-slate-200/60 transition-shadow hover:shadow-xl hover:shadow-indigo-100"
            >
              <span className={`inline-flex h-12 w-12 items-center justify-center rounded-xl ${f.tint}`}>
                <f.icon className="h-6 w-6" />
              </span>
              <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* 工作原理 */}
      <section id="how" className="relative z-10 mx-auto max-w-6xl px-6 py-20">
        <motion.h2 {...rise} className="text-center text-3xl font-black">三步拿到 Bug 报告</motion.h2>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <motion.div key={s.num} {...rise} transition={{ duration: 0.5, delay: i * 0.12 }} className="relative rounded-2xl bg-white p-8 shadow-sm">
              <span className="text-5xl font-black text-transparent" style={{ WebkitTextStroke: '2px #c7d2fe' }}>{s.num}</span>
              <h3 className="mt-3 text-lg font-bold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{s.desc}</p>
              {i < 2 && (
                <IconArrowRight className="absolute -right-7 top-1/2 hidden h-5 w-5 -translate-y-1/2 text-indigo-300 md:block" />
              )}
            </motion.div>
          ))}
        </div>
      </section>

      {/* 报告示例 */}
      <section id="report" className="relative z-10 mx-auto max-w-4xl px-6 py-20">
        <motion.h2 {...rise} className="text-center text-3xl font-black">报告长这样</motion.h2>
        <motion.p {...rise} className="mt-3 text-center text-slate-500">每个缺陷都有级别、证据和复现步骤,点开即查</motion.p>
        <div className="mt-10 space-y-3">
          {DEMO_BUGS.map((b, i) => (
            <motion.div
              key={b.title}
              {...rise}
              transition={{ duration: 0.45, delay: i * 0.08 }}
              whileHover={{ x: 6 }}
              className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-5 py-4 shadow-sm"
            >
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold text-white ${b.color}`}>{b.level}</span>
              <span className="flex-1 text-sm font-medium">{b.title}</span>
              <span className="hidden rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500 sm:block">{b.tag}</span>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-500">
                查看复现 <IconArrowRight className="h-3.5 w-3.5" />
              </span>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-24 pt-8">
        <motion.div
          {...rise}
          className="btn-shine relative overflow-hidden rounded-3xl bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-pink-500 px-8 py-16 text-center text-white"
        >
          <h2 className="text-3xl font-black md:text-4xl">今晚提交,明早看报告</h2>
          <p className="mx-auto mt-3 max-w-md text-white/80">注册即可发起第一次 AI 探索测试,Bug 看板等你来收。</p>
          <Link to="/register" className="mt-8 inline-block">
            <button className="cursor-pointer rounded-full bg-white px-8 py-3.5 font-bold text-indigo-600 shadow-xl transition-transform hover:-translate-y-0.5 hover:scale-105 active:scale-95">
              免费注册,立即开测
            </button>
          </Link>
        </motion.div>
      </section>

      <footer className="relative z-10 flex items-center justify-center gap-2 border-t border-slate-100 py-8 text-xs text-slate-400">
        <IconSatellite className="h-3.5 w-3.5" /> TestPilot · AI 自主测试平台 · © 2026
      </footer>
    </div>
  );
}
