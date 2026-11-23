import type { ReactNode } from 'react';
import { AlertCircle, Inbox, RefreshCw } from 'lucide-react';

export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading content">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-12 w-full rounded-lg border border-[#E2E8E4] bg-[#EEF3F0]/60 animate-pulse"
        />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-[#E2E8E4] bg-white px-6 py-12 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-[#EEF3F0] text-[#15803D]">
        <Inbox className="h-5 w-5" />
      </div>
      <h3 className="font-display text-base font-semibold text-[#0F172A]">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-[#475569]">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start justify-between gap-4 rounded-xl border border-red-200 bg-red-50/70 p-5 sm:flex-row sm:items-center"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#DC2626]" />
        <div>
          <h3 className="font-display text-sm font-semibold text-[#991B1B]">Unable to load data</h3>
          <p className="mt-0.5 text-sm text-[#7F1D1D]">{message}</p>
        </div>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-medium text-[#991B1B] hover:bg-red-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function StatusLabel({
  tone,
  label,
}: {
  tone: 'green' | 'amber' | 'red' | 'neutral';
  label: string;
}) {
  const styles: Record<typeof tone, string> = {
    green: 'bg-emerald-50 text-[#15803D] border-emerald-200',
    amber: 'bg-amber-50 text-[#B45309] border-amber-200',
    red: 'bg-red-50 text-[#DC2626] border-red-200',
    neutral: 'bg-slate-100 text-[#475569] border-slate-200',
  };
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${styles[tone]}`}
    >
      {label}
    </span>
  );
}
