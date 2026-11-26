import { encodeCode128B, formatMoneyPlain, formatReceiptTimestamp } from './posHardware';
import type { Sale } from '../types/domain';

export const RECEIPT_WIDTH_MM = 80;
export const RECEIPT_STORE = 'ARGIVIT COOPERATIVE';
export const RECEIPT_SUBTITLE = 'Agricultural Supply Store';
export const RECEIPT_FOOTER = 'Thank you for shopping with Argivit Coop.';

const sources: Record<Sale['source'], string> = {
  online_pos: 'POS sale',
  offline_sync: 'Offline POS sale',
  preorder_fulfillment: 'Pre-order pickup',
};

export function saleReceiptDetails(sale: Sale, cashierName?: string) {
  return {
    facts: [
      ['Receipt #', sale.sale_number],
      ['Date', formatReceiptTimestamp(sale.created_at)],
      ['Terminal', sale.terminal_id],
      ['Cashier', sale.cashier_name || cashierName || 'POS Cashier'],
      ['Source', sources[sale.source]],
    ],
    items: sale.items.map((item) => ({
      id: item.id,
      name: item.product_name,
      unit: `${item.quantity} × ${item.unit_name}`,
      detail: `${item.sku} · ${formatMoneyPlain(item.unit_price)} each`,
      total: formatMoneyPlain(item.line_total),
    })),
    payment: sale.payment_method.replaceAll('_', ' ').toUpperCase(),
    total: formatMoneyPlain(sale.total),
  };
}

export function receiptBarcode(value: string) {
  const widths = encodeCode128B(value);
  const bars: Array<{ x: number; width: number }> = [];
  let cursor = 10;
  Array.from(widths, Number).forEach((width, index) => {
    if (index % 2 === 0) bars.push({ x: cursor, width });
    cursor += width;
  });
  return widths ? { bars, width: cursor + 10 } : null;
}
