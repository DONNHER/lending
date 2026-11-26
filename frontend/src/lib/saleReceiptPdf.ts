import { jsPDF } from 'jspdf';
import type { Sale } from '../types/domain';
import {
  RECEIPT_FOOTER,
  RECEIPT_STORE,
  RECEIPT_SUBTITLE,
  RECEIPT_WIDTH_MM,
  receiptBarcode,
  saleReceiptDetails,
} from './saleReceipt';

const MARGIN = 5;
const TEXT_WIDTH = RECEIPT_WIDTH_MM - 2 * MARGIN;
const MAX_PAGE_HEIGHT = 1000;

interface ReceiptBlock {
  height: number;
  draw: (top: number) => void;
}

export function createSaleReceiptPdf(sale: Sale, cashierName?: string) {
  const doc = new jsPDF({ unit: 'mm', format: [RECEIPT_WIDTH_MM, 120], orientation: 'portrait' });
  doc.setProperties({ title: `Receipt ${sale.sale_number}` });
  const { facts, items, payment, total } = saleReceiptDetails(sale, cashierName);
  const blocks: ReceiptBlock[] = [];

  function write(
    value: string,
    options: { size?: number; bold?: boolean; centered?: boolean; right?: string } = {},
  ) {
    const { size = 9, bold = false, centered = false, right } = options;
    const setFont = () => doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size);
    setFont();
    const rightWidth = right ? doc.getTextWidth(right) + 4 : 0;
    const lines: string[] = doc.splitTextToSize(value, TEXT_WIDTH - rightWidth);
    const lineHeight = size * 0.42;
    blocks.push({
      height: lineHeight * lines.length,
      draw: (top) => {
        setFont();
        lines.forEach((line, index) => {
          doc.text(line, centered ? RECEIPT_WIDTH_MM / 2 : MARGIN, top + lineHeight * (index + 0.75), {
            align: centered ? 'center' : 'left',
          });
        });
        if (right) doc.text(right, RECEIPT_WIDTH_MM - MARGIN, top + lineHeight * 0.75, { align: 'right' });
      },
    });
  }

  function rule() {
    blocks.push({
      height: 4,
      draw: (top) => doc.setLineWidth(0.18).line(MARGIN, top + 2, RECEIPT_WIDTH_MM - MARGIN, top + 2),
    });
  }

  write(RECEIPT_STORE, { size: 12, bold: true, centered: true });
  write(RECEIPT_SUBTITLE, { centered: true });
  rule();
  facts.forEach(([label, value]) => write(`${label}: ${value}`));
  rule();
  write('ITEM / QTY', { bold: true, right: 'AMOUNT' });
  for (const item of items) {
    write(item.name, { bold: true });
    write(item.unit, { right: item.total });
    write(item.detail, { size: 8 });
    blocks.push({ height: 1, draw: () => {} });
  }
  rule();
  write('Payment', { right: payment });
  write('TOTAL', { size: 12, bold: true, right: total });
  rule();

  const barcode = receiptBarcode(sale.sale_number);
  if (barcode) {
    blocks.push({
      height: 12,
      draw: (top) => {
        const scale = Math.min(0.38, TEXT_WIDTH / barcode.width);
        const origin = (RECEIPT_WIDTH_MM - scale * barcode.width) / 2;
        doc.setFillColor('#000000');
        barcode.bars.forEach((bar) => doc.rect(origin + bar.x * scale, top, bar.width * scale, 10.5, 'F'));
      },
    });
  }
  write(sale.sale_number, { centered: true });
  write(RECEIPT_FOOTER, { size: 8, centered: true });

  doc.deletePage(1);
  let page: ReceiptBlock[] = [];
  let height = 2 * MARGIN;
  const addPage = () => {
    doc.addPage([RECEIPT_WIDTH_MM, Math.max(RECEIPT_WIDTH_MM, height)], 'portrait');
    let y = MARGIN;
    page.forEach((block) => {
      block.draw(y);
      y += block.height;
    });
    page = [];
    height = 2 * MARGIN;
  };
  for (const block of blocks) {
    if (height + block.height > MAX_PAGE_HEIGHT && page.length > 0) addPage();
    page.push(block);
    height += block.height;
  }
  addPage();
  return doc;
}
