import { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert, X } from 'lucide-react';

export interface ConfirmDetailRow {
  label: string;
  value: string;
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  details?: ConfirmDetailRow[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'green' | 'amber' | 'red';
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  details = [],
  confirmLabel = 'Confirm Transaction',
  cancelLabel = 'Cancel',
  tone = 'green',
  isPending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isPending) {
        onCancel();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, isPending, onCancel]);

  if (!open) return null;

  const iconBg =
    tone === 'red'
      ? 'bg-red-50 text-[#DC2626]'
      : tone === 'amber'
      ? 'bg-amber-50 text-[#B45309]'
      : 'bg-[#F0FDF4] text-[#15803D]';

  const confirmBtn =
    tone === 'red'
      ? 'bg-[#DC2626] hover:bg-red-700'
      : tone === 'amber'
      ? 'bg-[#D97706] hover:bg-[#B45309]'
      : 'bg-[#15803D] hover:bg-[#166534]';

  const Icon =
    tone === 'red' ? ShieldAlert : tone === 'amber' ? AlertTriangle : CheckCircle2;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-slate-900/50"
        onClick={() => {
          if (!isPending) onCancel();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-[#E2E8E4] bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#E2E8E4] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
              <Icon className="h-4 w-4" />
            </div>
            <h2
              id="confirm-dialog-title"
              className="font-display text-base font-semibold text-[#0F172A]"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close confirmation dialog"
            disabled={isPending}
            onClick={onCancel}
            className="rounded-lg p-1 text-[#64748B] hover:bg-[#F7F9F8] hover:text-[#0F172A] disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm leading-relaxed text-[#475569]">{description}</p>

          {details.length > 0 ? (
            <dl className="divide-y divide-[#E2E8E4] rounded-lg border border-[#E2E8E4] bg-[#F7F9F8] px-3.5 text-xs">
              {details.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-[#64748B]">{row.label}</dt>
                  <dd className="text-right font-mono font-semibold text-[#0F172A] tabular-nums">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              disabled={isPending}
              onClick={onCancel}
              className="rounded-lg border border-[#CBD5E1] bg-white px-4 py-2 text-xs font-medium text-[#334155] hover:bg-[#F7F9F8] disabled:opacity-40 whitespace-nowrap"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={onConfirm}
              className={`rounded-lg px-4 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-50 whitespace-nowrap ${confirmBtn}`}
            >
              {isPending ? 'Processing...' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
