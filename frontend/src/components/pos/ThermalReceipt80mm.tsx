import { useEffect, useMemo } from 'react';
import { Printer, Usb, X } from 'lucide-react';
import {
  encodeCode128B,
  formatMoneyPlain,
  type ConnectedThermalPrinter,
} from '../../lib/posHardware';
import type { Sale } from '../../types/domain';

interface Code128BarcodeSvgProps {
  value: string;
  height?: number;
}

export function Code128BarcodeSvg({ value, height = 38 }: Code128BarcodeSvgProps) {
  const widths = useMemo(() => encodeCode128B(value), [value]);
  if (!widths) return null;

  const bars: Array<{ x: number; w: number }> = [];
  let cursor = 10; // 10-module quiet zone
  for (let i = 0; i < widths.length; i += 1) {
    const w = Number(widths[i]);
    if (i % 2 === 0) {
      bars.push({ x: cursor, w });
    }
    cursor += w;
  }
  const totalWidth = cursor + 10;

  return (
    <svg
      viewBox={`0 0 ${totalWidth} ${height}`}
      className="mx-auto h-10 w-full max-w-[230px]"
      role="img"
      aria-label={`1D Barcode ${value}`}
    >
      <rect x={0} y={0} width={totalWidth} height={height} fill="#ffffff" />
      {bars.map((bar, idx) => (
        <rect key={idx} x={bar.x} y={0} width={bar.w} height={height} fill="#000000" />
      ))}
    </svg>
  );
}

interface ThermalReceipt80mmSheetProps {
  sale: Sale;
  cashierName?: string;
  forPrint?: boolean;
}

export function ThermalReceipt80mmSheet({
  sale,
  cashierName,
  forPrint = false,
}: ThermalReceipt80mmSheetProps) {
  const totalBaseKg = sale.items.reduce((sum, item) => sum + item.quantity_base, 0);
  const formattedDate = (() => {
    const d = new Date(sale.created_at);
    return Number.isNaN(d.getTime())
      ? sale.created_at
      : d.toLocaleString('en-PH', {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
  })();

  return (
    <div
      id={forPrint ? 'thermal-receipt-print-area' : undefined}
      className="mx-auto w-[302px] max-w-full border border-dashed border-[#CBD5E1] bg-white px-3.5 py-4 font-mono text-[11px] leading-[1.45] text-black"
    >
      <div className="text-center">
        <div className="text-[13px] font-bold tracking-tight">ARGIVIT COOPERATIVE</div>
        <div className="text-[10px]">Agricultural Supply Store · 80mm POS</div>
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      <div className="space-y-0.5 text-[10.5px]">
        <div className="flex justify-between gap-2">
          <span>Receipt #:</span>
          <span className="font-bold">{sale.sale_number}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Date:</span>
          <span>{formattedDate}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Terminal:</span>
          <span>{sale.terminal_id}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Cashier:</span>
          <span>{cashierName || sale.cashier_name || 'POS Cashier'}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Source:</span>
          <span className="uppercase">{sale.source.replace('_', ' ')}</span>
        </div>
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      <div className="flex justify-between text-[10px] font-bold uppercase">
        <span>Item / Qty</span>
        <span>Amount</span>
      </div>

      <div className="my-1 border-t border-dashed border-black" />

      <div className="space-y-2">
        {sale.items.map((item) => (
          <div key={item.id}>
            <div className="font-semibold leading-snug">{item.product_name}</div>
            <div className="flex justify-between gap-2 text-[10.5px]">
              <span>
                {item.quantity} × {item.unit_name}
              </span>
              <span className="tabular-nums font-medium">{formatMoneyPlain(item.line_total)}</span>
            </div>
            <div className="text-[9.5px] text-neutral-700">
              {item.sku} · @{formatMoneyPlain(item.unit_price)} · -{item.quantity_base} kg
            </div>
          </div>
        ))}
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      <div className="space-y-0.5 text-[10.5px]">
        <div className="flex justify-between">
          <span>Line Items:</span>
          <span>{sale.items.length}</span>
        </div>
        <div className="flex justify-between">
          <span>Base Stock Deducted:</span>
          <span>{totalBaseKg} kg</span>
        </div>
        <div className="flex justify-between">
          <span>Payment Method:</span>
          <span className="uppercase">{sale.payment_method.replace('_', ' ')}</span>
        </div>
      </div>

      <div className="my-2 border-t-2 border-b-2 border-double border-black py-1.5">
        <div className="flex justify-between text-[13px] font-bold">
          <span>TOTAL DUE</span>
          <span className="tabular-nums">{formatMoneyPlain(sale.total)}</span>
        </div>
      </div>

      <div className="mt-2.5 text-center">
        <Code128BarcodeSvg value={sale.sale_number} height={36} />
        <div className="mt-1 text-[10px] tracking-wider">*{sale.sale_number}*</div>
        <div className="mt-1 text-[10px]">Thank you for supporting Argivit Coop!</div>
      </div>
    </div>
  );
}

interface ThermalReceiptModalProps {
  sale: Sale | null;
  cashierName?: string;
  connectedPrinter: ConnectedThermalPrinter | null;
  isPrintingEscPos: boolean;
  onPrintBrowser: (sale: Sale) => void;
  onPrintEscPos: (sale: Sale) => void;
  onClose: () => void;
}

export function ThermalReceiptModal({
  sale,
  cashierName,
  connectedPrinter,
  isPrintingEscPos,
  onPrintBrowser,
  onPrintEscPos,
  onClose,
}: ThermalReceiptModalProps) {
  useEffect(() => {
    if (!sale) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sale, onClose]);

  if (!sale) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="thermal-preview-title"
        className="relative z-10 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-[#E2E8E4] bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[#E2E8E4] px-5 py-3.5">
          <div>
            <h2
              id="thermal-preview-title"
              className="font-display text-base font-semibold text-[#0F172A]"
            >
              80mm Thermal Receipt Preview
            </h2>
            <p className="text-xs text-[#64748B]">
              48-column roll format · {sale.sale_number}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close 80mm receipt preview"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#64748B] hover:bg-[#F7F9F8] hover:text-[#0F172A]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto bg-[#F7F9F8] p-5">
          <ThermalReceipt80mmSheet sale={sale} cashierName={cashierName} />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#E2E8E4] bg-white px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2 text-xs font-medium text-[#334155] hover:bg-[#F7F9F8]"
          >
            Close
          </button>
          {connectedPrinter ? (
            <button
              type="button"
              disabled={isPrintingEscPos}
              onClick={() => onPrintEscPos(sale)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#15803D] bg-[#F0FDF4] px-3.5 py-2 text-xs font-semibold text-[#15803D] hover:bg-emerald-100 disabled:opacity-50"
            >
              <Usb className="h-3.5 w-3.5" />
              {isPrintingEscPos ? 'Sending ESC/POS...' : 'ESC/POS Direct Print'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onPrintBrowser(sale)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#15803D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#166534]"
          >
            <Printer className="h-3.5 w-3.5" />
            Print 80mm Receipt
          </button>
        </div>
      </div>
    </div>
  );
}
