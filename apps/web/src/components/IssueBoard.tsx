import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ApiIssue, type IssueStatus } from '../lib/api';
import { IconArrowRight, IconBug } from './Icons';

export const ISSUE_STATUS_META: Record<IssueStatus, { label: string; cls: string }> = {
  open: { label: '待确认', cls: 'bg-rose-50 text-rose-600' },
  confirmed: { label: '已确认', cls: 'bg-orange-50 text-orange-600' },
  fixing: { label: '修复中', cls: 'bg-indigo-50 text-indigo-600' },
  closed: { label: '已关闭', cls: 'bg-emerald-50 text-emerald-600' },
  false_positive: { label: '误报', cls: 'bg-slate-100 text-slate-500' },
};

export const SEVERITY_META: Record<string, { label: string; cls: string }> = {
  critical: { label: '致命', cls: 'bg-red-500' },
  high: { label: '严重', cls: 'bg-orange-500' },
  medium: { label: '中等', cls: 'bg-yellow-500' },
  low: { label: '轻微', cls: 'bg-sky-400' },
};

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: '全部' },
  ...Object.entries(ISSUE_STATUS_META).map(([value, m]) => ({ value, label: m.label })),
];

/** 项目 Bug 看板:跨运行聚合的缺陷列表 + 状态筛选 */
export default function IssueBoard({ projectId }: { projectId: string }) {
  const [issues, setIssues] = useState<ApiIssue[] | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    setIssues(null);
    api
      .listIssues(projectId, { status: status || undefined })
      .then(setIssues)
      .catch(() => setIssues([]));
  }, [projectId, status]);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatus(f.value)}
            className={`cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
              status === f.value
                ? 'bg-gradient-to-r from-indigo-500 to-pink-500 text-white shadow-md shadow-indigo-500/30'
                : 'bg-white text-slate-500 shadow-sm hover:text-indigo-600'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {issues === null ? (
        <p className="mt-6 text-sm text-slate-400">加载中…</p>
      ) : issues.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-8 text-center">
          <IconBug className="mx-auto h-8 w-8 text-emerald-400" />
          <p className="mt-2 text-sm font-medium text-emerald-600">
            {status ? '该状态下没有缺陷' : '看板空空如也,发起一次探索试试'}
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {issues.map((issue, i) => {
            const sev = SEVERITY_META[issue.severity] ?? SEVERITY_META.low!;
            const st = ISSUE_STATUS_META[issue.status];
            return (
              <motion.div
                key={issue.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <Link
                  to={`/console/issues/${issue.id}`}
                  className="group flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-5 py-3.5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold text-white ${sev.cls}`}>
                    {sev.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{issue.title}</span>
                  {issue.occurrences > 1 && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      复现 ×{issue.occurrences}
                    </span>
                  )}
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
                  <span className="hidden text-xs text-slate-400 sm:block">
                    {new Date(issue.lastSeenAt).toLocaleDateString('zh-CN')}
                  </span>
                  <IconArrowRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-1" />
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
