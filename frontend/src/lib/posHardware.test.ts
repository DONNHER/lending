import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEscPosReceiptBytes,
  classifyScannedCode,
  encodeCode128B,
  findLocalBarcodeMatch,
  format80mmReceiptLines,
  formatReceiptColumns,
  isRapidScannerBurst,
  RECEIPT_COLS_80MM,
} from './posHardware';
import type { Product, Sale } from '../types/domain';

const sampleProducts: Product[] = [
  {
    id: 'prod-1',
    category_id: 'cat-fert',
    sku: 'AGR-FERT-001',
    barcode: '480001001001',
    name: 'Complete Fertilizer NPK 14-14-14',
    description: 'Balanced granular fertilizer',
    base_unit: 'kg',
    cost_price: 21,
    status: 'active',
    image_url: '',
    stock_base: 2500,
    units: [
      {
        id: 'u-1',
        product_id: 'prod-1',
        unit_name: 'sack (50 kg)',
        conversion_factor: 50,
        selling_price: 1250,
        is_default: true,
      },
    ],
  },
];

const sampleSale: Sale = {
  id: 'sale-1',
  sale_number: 'SALE-2026-9901',
  cashier_id: 'usr-cash-1',
  cashier_name: 'Cashier Lea',
  terminal_id: 'TERMINAL-001',
  total: 2500,
  payment_method: 'cash',
  status: 'completed',
  source: 'online_pos',
  created_at: '2026-11-15T08:00:00.000Z',
  items: [
    {
      id: 'si-1',
      sale_id: 'sale-1',
      product_id: 'prod-1',
      product_name: 'Complete Fertilizer NPK 14-14-14',
      sku: 'AGR-FERT-001',
      quantity: 2,
      unit_id: 'u-1',
      unit_name: 'sack (50 kg)',
      conversion_factor: 50,
      quantity_base: 100,
      unit_price: 1250,
      line_total: 2500,
    },
  ],
};

test('classifyScannedCode distinguishes 1D product barcodes and ARG-ORD pickup tokens', () => {
  assert.deepEqual(classifyScannedCode('480001001001\r\n'), {
    kind: 'product_barcode',
    normalized: '480001001001',
  });
  assert.deepEqual(classifyScannedCode('  arg-ord-8821 \n'), {
    kind: 'order_token',
    normalized: 'ARG-ORD-8821',
  });
  assert.equal(classifyScannedCode('ab'), null);
});

test('isRapidScannerBurst separates wired HID scanner bursts from manual typing', () => {
  // 12 chars ~10ms apart (wired USB HID scanner)
  const scannerTimes = Array.from({ length: 12 }, (_, idx) => 1000 + idx * 10);
  assert.equal(isRapidScannerBurst(scannerTimes), true);

  // Slow manual typing ~140ms apart
  const humanTimes = [1000, 1140, 1290, 1430, 1580];
  assert.equal(isRapidScannerBurst(humanTimes), false);
});

test('findLocalBarcodeMatch resolves exact 1D barcode and SKU case-insensitively', () => {
  assert.equal(findLocalBarcodeMatch(sampleProducts, '480001001001')?.id, 'prod-1');
  assert.equal(findLocalBarcodeMatch(sampleProducts, 'agr-fert-001')?.id, 'prod-1');
  assert.equal(findLocalBarcodeMatch(sampleProducts, '999999999999'), null);
});

test('formatReceiptColumns and format80mmReceiptLines stay strictly within 48 columns for 80mm thermal rolls', () => {
  const row = formatReceiptColumns('Long Cooperative Fertilizer Product Name', 'PHP 1,250.00');
  assert.equal(row.length, RECEIPT_COLS_80MM);
  assert.ok(row.endsWith('PHP 1,250.00'));

  const lines = format80mmReceiptLines(sampleSale);
  assert.ok(lines.some((l) => l.includes('SALE-2026-9901')));
  assert.ok(lines.some((l) => l.includes('PHP 2,500.00')));
  for (const line of lines) {
    assert.ok(line.length <= RECEIPT_COLS_80MM, `Line exceeded 48 cols: ${line}`);
  }
});

test('buildEscPosReceiptBytes outputs valid ESC/POS initialization, sale text, cash drawer kick, and auto-cut', () => {
  const bytes = buildEscPosReceiptBytes(sampleSale, {
    autoCut: true,
    openCashDrawer: true,
  });
  // ESC @ init at start
  assert.equal(bytes[0], 0x1b);
  assert.equal(bytes[1], 0x40);

  const ascii = Array.from(bytes)
    .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : ' '))
    .join('');
  assert.ok(ascii.includes('SALE-2026-9901'));
  assert.ok(ascii.includes('PHP 2,500.00'));

  // Contains ESC p cash drawer command (0x1b 0x70 0x00 0x19 0xfa)
  const hasDrawerKick = bytes.some(
    (_, idx) => bytes[idx] === 0x1b && bytes[idx + 1] === 0x70 && bytes[idx + 2] === 0x00
  );
  assert.equal(hasDrawerKick, true);

  // Ends with GS V 66 0 cut command (0x1d 0x56 0x42 0x00)
  assert.deepEqual(Array.from(bytes.slice(-4)), [0x1d, 0x56, 0x42, 0x00]);
});

test('encodeCode128B produces non-empty bar width digits ending with stop pattern', () => {
  const encoded = encodeCode128B('SALE-2026-9901');
  assert.ok(encoded.length > 30);
  assert.ok(/^[1-4]+$/.test(encoded));
  assert.ok(encoded.endsWith('2331112'));
});
