import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import {
  RECEIPT_FOOTER,
  RECEIPT_STORE,
  RECEIPT_SUBTITLE,
  receiptBarcode,
  saleReceiptDetails,
} from '../../lib/saleReceipt';
import type { Sale } from '../../types/domain';

interface Code128BarcodeSvgProps {
  value: string;
  height?: number;
}

export function Code128BarcodeSvg({ value, height = 38 }: Code128BarcodeSvgProps) {
  const barcode = useMemo(() => receiptBarcode(value), [value]);
  if (!barcode) return null;

  return (
    <svg
      viewBox={[0, 0, barcode.width, height].join(' ')}
      className="mx-auto h-10 w-full max-w-[230px]"
      role="img"
      aria-label={'1D Barcode ' + value}
    >
      <rect width={barcode.width} height={height} fill="#fff" />
      {barcode.bars.map((bar) => (
        <rect key={bar.x} x={bar.x} width={bar.width} height={height} fill="#000" />
      ))}
    </svg>
  );
}

interface ThermalReceipt80mmSheetProps {
  sale: Sale;
  cashierName?: string;
}

export function ThermalReceipt80mmSheet({ sale, cashierName }: ThermalReceipt80mmSheetProps) {
  const { facts, items, payment, total } = saleReceiptDetails(sale, cashierName);

  return (
    <div className="mx-auto w-[80mm] max-w-full border border-dashed border-[#CBD5E1] bg-white p-[5mm] font-mono text-[11px] leading-[1.45] text-black">
      <div className="border-b border-dashed border-black pb-2 text-center">
        <div className="text-[13px] font-bold">{RECEIPT_STORE}</div>
        <div>{RECEIPT_SUBTITLE}</div>
      </div>

      <dl className="space-y-0.5 border-b border-dashed border-black py-2">
        {facts.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="shrink-0">{label}</dt>
            <dd className="min-w-0 break-words text-right">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex justify-between gap-2 border-b border-dashed border-black py-1 text-[10px] font-bold uppercase">
        <span>Item / Qty</span>
        <span>Amount</span>
      </div>

      <ul className="space-y-2 border-b border-dashed border-black py-2">
        {items.map((item) => (
          <li key={item.id}>
            <div className="break-words font-semibold">{item.name}</div>
            <div className="flex justify-between gap-2">
              <span>{item.unit}</span>
              <span className="shrink-0 font-medium tabular-nums">{item.total}</span>
            </div>
            <div className="break-words text-[10px] text-neutral-700">{item.detail}</div>
          </li>
        ))}
      </ul>

      <dl className="py-2">
        <div className="flex justify-between gap-2">
          <dt>Payment</dt>
          <dd>{payment}</dd>
        </div>
        <div className="mt-2 flex justify-between gap-2 border-y-2 border-double border-black py-1 text-[13px] font-bold">
          <dt>Total</dt>
          <dd className="tabular-nums">{total}</dd>
        </div>
      </dl>

      <div className="text-center text-[10px]">
        <Code128BarcodeSvg value={sale.sale_number} height={36} />
        <div className="mt-1 break-all tracking-wide">{sale.sale_number}</div>
        <div className="mt-1">{RECEIPT_FOOTER}</div>
      </div>
    </div>
  );
}

interface ThermalReceiptModalProps {
  sale: Sale | null;
  cashierName?: string;
  onClose: () => void;
}

export function ThermalReceiptModal({ sale, cashierName, onClose }: ThermalReceiptModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const isOpen = sale !== null;

  useEffect(() => {
    const element = dialog.current;
    if (isOpen && element && !element.open) element.showModal();
  }, [isOpen]);

  function close() {
    dialog.current?.close();
    setExportError(false);
    onClose();
  }

  async function exportPdf(receipt: Sale) {
    setExporting(true);
    setExportError(false);
    try {
      const { createSaleReceiptPdf } = await import('../../lib/saleReceiptPdf');
      const filename = receipt.sale_number.replace(/[^\w-]/g, '-');
      createSaleReceiptPdf(receipt, cashierName).save('receipt-' + filename + '.pdf');
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  if (!sale) return null;

  return (
    <dialog
      ref={dialog}
      aria-labelledby="thermal-preview-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-md overflow-hidden rounded-xl border border-[#E2E8E4] bg-white p-0 shadow-xl backdrop:bg-slate-900/50"
    >
      <div className="flex max-h-[85dvh] flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-[#E2E8E4] px-5 py-3.5">
          <div>
            <h2 id="thermal-preview-title" className="font-display text-base font-semibold text-[#0F172A]">
              80 mm receipt preview
            </h2>
            <p className="break-all text-xs text-[#64748B]">{sale.sale_number}</p>
          </div>
          <button
            type="button"
            aria-label="Close receipt preview"
            onClick={close}
            className="rounded-lg p-2 text-[#475569] hover:bg-[#F7F9F8] focus-visible:outline-2 focus-visible:outline-[#15803D]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#F7F9F8] p-4 sm:p-5">
          <ThermalReceipt80mmSheet sale={sale} cashierName={cashierName} />
        </div>

        <footer className="border-t border-[#E2E8E4] bg-white px-5 py-3.5">
          {exportError && <p role="alert" className="mb-2 text-sm text-red-700">The PDF could not be exported. Try again.</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="rounded-lg border border-[#CBD5E1] px-3.5 py-2 text-sm font-medium text-[#334155] hover:bg-[#F7F9F8]">
              Close
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => void exportPdf(sale)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#15803D] px-4 py-2 text-sm font-semibold text-white hover:bg-[#166534] disabled:opacity-50"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {exporting ? 'Exporting…' : 'Export PDF'}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
