const STATUS_META: Record<string, { label: string; cls: string; pulse?: boolean }> = {
  queued: { label: '排队中', cls: 'bg-slate-100 text-slate-500', pulse: true },
  running: { label: '探索中', cls: 'bg-indigo-50 text-indigo-600', pulse: true },
  done: { label: '已完成', cls: 'bg-emerald-50 text-emerald-600' },
  failed: { label: '失败', cls: 'bg-rose-50 text-rose-600' },
};

export function RunStatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.queued!;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.cls}`}>
      {meta.pulse && <span className="h-1.5 w-1.5 animate-ping rounded-full bg-current" />}
      {meta.label}
    </span>
  );
}

export const SEVERITY_LABELS: Record<string, { label: string; cls: string }> = {
  critical: { label: '致命', cls: 'bg-red-500' },
  high: { label: '严重', cls: 'bg-orange-500' },
  medium: { label: '中等', cls: 'bg-yellow-500' },
  low: { label: '轻微', cls: 'bg-sky-400' },
};
