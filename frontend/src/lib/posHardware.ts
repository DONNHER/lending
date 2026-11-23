import type { Product, Sale } from '../types/domain';

export const RECEIPT_COLS_80MM = 48;

export interface ScannedCodeClassification {
  kind: 'order_token' | 'product_barcode';
  normalized: string;
}

export interface EscPosBuildOptions {
  storeName?: string;
  storeSubtitle?: string;
  cashierName?: string;
  autoCut?: boolean;
  openCashDrawer?: boolean;
  printBarcode?: boolean;
}

/**
 * Normalizes and classifies raw input from a wired 1D barcode scanner
 * (USB HID keyboard wedge or RS-232/Serial) or manual barcode entry.
 */
export function classifyScannedCode(rawCode: string): ScannedCodeClassification | null {
  const normalized = rawCode.replace(/[\r\n\t]+/g, '').trim();
  if (normalized.length < 3) return null;

  if (/^ARG-ORD-[A-Z0-9-]+$/i.test(normalized)) {
    return {
      kind: 'order_token',
      normalized: normalized.toUpperCase(),
    };
  }

  return {
    kind: 'product_barcode',
    normalized,
  };
}

/**
 * Wired USB HID 1D barcode scanners transmit characters in rapid bursts
 * (< 35ms/key, typically 2-15ms) ending with Enter. Normal typing is > 60ms/key.
 */
export function isRapidScannerBurst(timestamps: number[], maxAvgIntervalMs = 45): boolean {
  if (timestamps.length < 3) return false;
  let totalDelta = 0;
  for (let i = 1; i < timestamps.length; i += 1) {
    totalDelta += Math.max(0, timestamps[i] - timestamps[i - 1]);
  }
  const avg = totalDelta / (timestamps.length - 1);
  return avg <= maxAvgIntervalMs;
}

/**
 * Matches an exact 1D barcode (EAN-13, UPC-A, Code128) or exact SKU against
 * locally cached catalog products (works online and in Offline POS Mode).
 */
export function findLocalBarcodeMatch(products: Product[], code: string): Product | null {
  const normalized = code.trim();
  if (!normalized) return null;

  const exactBarcode = products.find(
    (p) => p.status === 'active' && p.barcode && p.barcode.trim() === normalized
  );
  if (exactBarcode) return exactBarcode;

  const lower = normalized.toLowerCase();
  const exactSku = products.find(
    (p) => p.status === 'active' && p.sku.trim().toLowerCase() === lower
  );
  return exactSku || null;
}

export function pickDefaultProductUnit(product: Product) {
  return product.units.find((u) => u.is_default) || product.units[0] || null;
}

function asciiSafe(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

export function formatMoneyPlain(amount: number): string {
  return `PHP ${amount.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Formats a left/right pair into an exact fixed-width monospace line (48 chars for 80mm Font A).
 */
export function formatReceiptColumns(
  left: string,
  right: string,
  width = RECEIPT_COLS_80MM
): string {
  const cleanLeft = asciiSafe(left);
  const cleanRight = asciiSafe(right);
  if (cleanRight.length >= width) {
    return cleanRight.slice(0, width);
  }
  const maxLeft = Math.max(0, width - cleanRight.length - 1);
  const truncatedLeft =
    cleanLeft.length > maxLeft ? `${cleanLeft.slice(0, Math.max(0, maxLeft - 1))}.` : cleanLeft;
  const spaces = Math.max(1, width - truncatedLeft.length - cleanRight.length);
  return `${truncatedLeft}${' '.repeat(spaces)}${cleanRight}`;
}

export function centerText(text: string, width = RECEIPT_COLS_80MM): string {
  const clean = asciiSafe(text);
  if (clean.length >= width) return clean.slice(0, width);
  const pad = Math.floor((width - clean.length) / 2);
  return `${' '.repeat(pad)}${clean}`;
}

function formatReceiptTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Generates clean 48-column monospace text lines sized for 80mm thermal paper.
 */
export function format80mmReceiptLines(
  sale: Sale,
  opts: EscPosBuildOptions = {}
): string[] {
  const storeName = opts.storeName || 'ARGIVIT AGRICULTURAL SUPPLY COOP';
  const storeSubtitle = opts.storeSubtitle || '80mm Official POS Receipt';
  const cashierName = opts.cashierName || sale.cashier_name || 'POS Cashier';
  const sep = '-'.repeat(RECEIPT_COLS_80MM);
  const eqSep = '='.repeat(RECEIPT_COLS_80MM);

  const lines: string[] = [
    centerText(storeName),
    centerText(storeSubtitle),
    sep,
    formatReceiptColumns('Receipt #:', sale.sale_number),
    formatReceiptColumns('Date:', formatReceiptTimestamp(sale.created_at)),
    formatReceiptColumns('Terminal:', sale.terminal_id),
    formatReceiptColumns('Cashier:', cashierName),
    formatReceiptColumns(
      'Mode:',
      sale.source === 'offline_sync'
        ? 'OFFLINE QUEUE'
        : sale.source === 'preorder_fulfillment'
        ? 'PRE-ORDER PICKUP'
        : 'DIRECT POS'
    ),
    sep,
    formatReceiptColumns('ITEM / QTY', 'AMOUNT'),
    sep,
  ];

  let totalBaseKg = 0;
  for (const item of sale.items) {
    totalBaseKg += item.quantity_base;
    lines.push(asciiSafe(item.product_name).slice(0, RECEIPT_COLS_80MM));
    lines.push(
      formatReceiptColumns(
        `  ${item.quantity} x ${item.unit_name} @ ${formatMoneyPlain(item.unit_price)}`,
        formatMoneyPlain(item.line_total)
      )
    );
    lines.push(`  [${item.sku} · -${item.quantity_base} kg base]`.slice(0, RECEIPT_COLS_80MM));
  }

  lines.push(sep);
  lines.push(formatReceiptColumns('Line Items:', `${sale.items.length}`));
  lines.push(formatReceiptColumns('Base Stock Deducted:', `${totalBaseKg} kg`));
  lines.push(
    formatReceiptColumns('Payment Method:', sale.payment_method.replace('_', ' ').toUpperCase())
  );
  lines.push(eqSep);
  lines.push(formatReceiptColumns('TOTAL DUE:', formatMoneyPlain(sale.total)));
  lines.push(eqSep);
  lines.push(centerText(`*${sale.sale_number}*`));
  lines.push(centerText('Thank you for supporting Argivit Coop!'));

  return lines;
}

/**
 * Builds an ESC/POS binary payload ready for 80mm thermal printers over
 * Web Serial (RS-232/Virtual COM) or WebUSB.
 */
export function buildEscPosReceiptBytes(
  sale: Sale,
  opts: EscPosBuildOptions = {}
): Uint8Array {
  const bytes: number[] = [];
  const push = (...vals: number[]) => bytes.push(...vals);
  const pushText = (text: string) => {
    const clean = asciiSafe(text);
    for (let i = 0; i < clean.length; i += 1) {
      bytes.push(clean.charCodeAt(i) & 0x7f);
    }
  };
  const pushLine = (text: string) => {
    pushText(text);
    push(0x0a); // LF
  };

  const storeName = opts.storeName || 'ARGIVIT COOPERATIVE';
  const storeSubtitle = opts.storeSubtitle || 'Agricultural Supply POS · 80mm';
  const cashierName = opts.cashierName || sale.cashier_name || 'POS Cashier';
  const sep = '-'.repeat(RECEIPT_COLS_80MM);
  const eqSep = '='.repeat(RECEIPT_COLS_80MM);

  // ESC @ - Initialize printer
  push(0x1b, 0x40);

  // Center + Double size + Bold for store header
  push(0x1b, 0x61, 0x01); // ESC a 1 (Center)
  push(0x1b, 0x45, 0x01); // ESC E 1 (Bold on)
  push(0x1d, 0x21, 0x11); // GS ! 0x11 (2x width & height)
  pushLine(storeName.slice(0, 24));
  push(0x1d, 0x21, 0x00); // GS ! 0x00 (Normal size)
  push(0x1b, 0x45, 0x00); // Bold off
  pushLine(storeSubtitle);

  // Left align metadata & line items
  push(0x1b, 0x61, 0x00); // ESC a 0 (Left)
  pushLine(sep);
  pushLine(formatReceiptColumns('Receipt #:', sale.sale_number));
  pushLine(formatReceiptColumns('Date:', formatReceiptTimestamp(sale.created_at)));
  pushLine(formatReceiptColumns('Terminal:', sale.terminal_id));
  pushLine(formatReceiptColumns('Cashier:', cashierName));
  pushLine(sep);

  for (const item of sale.items) {
    push(0x1b, 0x45, 0x01);
    pushLine(asciiSafe(item.product_name).slice(0, RECEIPT_COLS_80MM));
    push(0x1b, 0x45, 0x00);
    pushLine(
      formatReceiptColumns(
        `  ${item.quantity} x ${item.unit_name} @ ${formatMoneyPlain(item.unit_price)}`,
        formatMoneyPlain(item.line_total)
      )
    );
  }

  pushLine(sep);
  pushLine(
    formatReceiptColumns('Payment:', sale.payment_method.replace('_', ' ').toUpperCase())
  );
  pushLine(eqSep);
  push(0x1b, 0x45, 0x01); // Bold total
  pushLine(formatReceiptColumns('TOTAL DUE:', formatMoneyPlain(sale.total)));
  push(0x1b, 0x45, 0x00);
  pushLine(eqSep);

  // Native ESC/POS 1D Code 128 barcode for sale_number
  if (opts.printBarcode !== false) {
    const barcodeValue = asciiSafe(sale.sale_number).slice(0, 24);
    if (barcodeValue.length > 0) {
      const code128Data = `{B${barcodeValue}`;
      push(0x1b, 0x61, 0x01); // Center
      push(0x1d, 0x68, 56); // GS h 56 (barcode height)
      push(0x1d, 0x77, 2); // GS w 2 (module width)
      push(0x1d, 0x48, 2); // GS H 2 (HRI text below barcode)
      push(0x1d, 0x6b, 0x49, code128Data.length); // GS k 73 len
      pushText(code128Data);
      push(0x0a);
    }
  }

  push(0x1b, 0x61, 0x01);
  pushLine('Thank you for supporting Argivit Coop!');
  push(0x1b, 0x64, 0x04); // ESC d 4 (feed 4 lines)

  if (opts.openCashDrawer && sale.payment_method === 'cash') {
    // ESC p 0 25 250 - Kick drawer pin 2
    push(0x1b, 0x70, 0x00, 0x19, 0xfa);
  }

  if (opts.autoCut !== false) {
    // GS V 66 0 - Feed & partial cut
    push(0x1d, 0x56, 0x42, 0x00);
  }

  return new Uint8Array(bytes);
}

// Minimal Code 128B pattern table for crisp browser 1D barcode rendering
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

/**
 * Encodes ASCII text into a Code 128B module-width string (alternating bar/space widths).
 */
export function encodeCode128B(rawText: string): string {
  const clean = asciiSafe(rawText).slice(0, 32);
  if (!clean) return '';

  const startCodeB = 104;
  let checksum = startCodeB;
  const codes: number[] = [startCodeB];

  for (let i = 0; i < clean.length; i += 1) {
    const val = clean.charCodeAt(i) - 32;
    if (val < 0 || val > 95) continue;
    codes.push(val);
    checksum += val * codes.length - val; // weight is 1-based position in data (i + 1)
  }

  // Recompute exact weighted checksum: start(104) + sum((idx) * val)
  let exactSum = startCodeB;
  for (let i = 1; i < codes.length; i += 1) {
    exactSum += codes[i] * i;
  }
  codes.push(exactSum % 103);
  codes.push(106); // Stop pattern

  return codes.map((c) => CODE128_PATTERNS[c] || '').join('');
}

// Browser Web Serial / WebUSB runtime helpers
interface SerialPortLike {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}

interface UsbEndpointLike {
  endpointNumber: number;
  direction: 'in' | 'out';
}

interface UsbAlternateLike {
  interfaceClass: number;
  endpoints: UsbEndpointLike[];
}

interface UsbInterfaceLike {
  interfaceNumber: number;
  alternates: UsbAlternateLike[];
}

interface UsbDeviceLike {
  productName?: string;
  open: () => Promise<void>;
  selectConfiguration: (configurationValue: number) => Promise<void>;
  claimInterface: (interfaceNumber: number) => Promise<void>;
  transferOut: (endpointNumber: number, data: BufferSource) => Promise<{ status: string }>;
  configuration: { interfaces: UsbInterfaceLike[] } | null;
}

type NavigatorWithHardware = Navigator & {
  serial?: {
    requestPort: () => Promise<SerialPortLike>;
  };
  usb?: {
    requestDevice: (opts: { filters: Array<Record<string, number>> }) => Promise<UsbDeviceLike>;
  };
};

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export function isWebUsbSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
}

export type SerialPrinterHandle = {
  kind: 'serial';
  label: string;
  port: SerialPortLike;
  baudRate: number;
};

export type UsbPrinterHandle = {
  kind: 'usb';
  label: string;
  device: UsbDeviceLike;
  interfaceNumber: number;
  endpointNumber: number;
};

export type ConnectedThermalPrinter = SerialPrinterHandle | UsbPrinterHandle;

export async function connectSerialThermalPrinter(baudRate = 9600): Promise<SerialPrinterHandle> {
  const nav = navigator as NavigatorWithHardware;
  if (!nav.serial) {
    throw new Error('Web Serial is unavailable in this browser. Use Browser 80mm Print instead.');
  }
  const port = await nav.serial.requestPort();
  if (!port.writable) {
    await port.open({ baudRate });
  }
  return {
    kind: 'serial',
    label: `Serial 80mm (${baudRate} bps)`,
    port,
    baudRate,
  };
}

export async function connectUsbThermalPrinter(): Promise<UsbPrinterHandle> {
  const nav = navigator as NavigatorWithHardware;
  if (!nav.usb) {
    throw new Error('WebUSB is unavailable in this browser. Use Browser 80mm Print instead.');
  }
  const device = await nav.usb.requestDevice({
    filters: [{ classCode: 7 }], // USB Printer class
  });
  await device.open();
  if (!device.configuration) {
    await device.selectConfiguration(1);
  }
  const interfaces = device.configuration?.interfaces || [];
  let interfaceNumber = 0;
  let endpointNumber = 1;
  for (const iface of interfaces) {
    const printerAlt =
      iface.alternates.find((a) => a.interfaceClass === 7) || iface.alternates[0];
    const outEp = printerAlt?.endpoints.find((e) => e.direction === 'out');
    if (outEp) {
      interfaceNumber = iface.interfaceNumber;
      endpointNumber = outEp.endpointNumber;
      break;
    }
  }
  await device.claimInterface(interfaceNumber);
  return {
    kind: 'usb',
    label: device.productName || 'USB 80mm Thermal Printer',
    device,
    interfaceNumber,
    endpointNumber,
  };
}

export async function sendEscPosToPrinter(
  printer: ConnectedThermalPrinter,
  payload: Uint8Array
): Promise<void> {
  if (printer.kind === 'serial') {
    if (!printer.port.writable) {
      await printer.port.open({ baudRate: printer.baudRate });
    }
    const writer = printer.port.writable!.getWriter();
    try {
      await writer.write(payload);
    } finally {
      writer.releaseLock();
    }
    return;
  }

  const copy = new Uint8Array(payload.byteLength);
  copy.set(payload);
  await printer.device.transferOut(printer.endpointNumber, copy.buffer);
}

/**
 * Connects a wired 1D barcode scanner configured in RS-232 / USB Virtual COM mode
 * and invokes `onScan` whenever a newline/CR-terminated barcode arrives.
 */
export async function connectSerialBarcodeScanner(
  onScan: (code: string) => void,
  onDisconnect?: () => void
): Promise<{ close: () => Promise<void> }> {
  const nav = navigator as NavigatorWithHardware;
  if (!nav.serial) {
    throw new Error('Web Serial is unavailable. Keep your wired scanner in USB HID Keyboard mode.');
  }
  const port = await nav.serial.requestPort();
  await port.open({ baudRate: 9600 });

  let cancelled = false;
  let buffer = '';
  const decoder = new TextDecoder();

  const reader = port.readable?.getReader();
  (async () => {
    try {
      while (!cancelled && reader) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split(/[\r\n]+/);
          buffer = parts.pop() || '';
          for (const part of parts) {
            const clean = part.trim();
            if (clean) onScan(clean);
          }
        }
      }
    } catch {
      // Port closed or unplugged
    } finally {
      reader?.releaseLock();
      onDisconnect?.();
    }
  })();

  return {
    close: async () => {
      cancelled = true;
      try {
        await reader?.cancel();
        await port.close();
      } catch {
        // Ignore close cleanup errors
      }
    },
  };
}

export function playScannerBeep(success: boolean) {
  if (typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  try {
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = success ? 'sine' : 'sawtooth';
    osc.frequency.setValueAtTime(success ? 1320 : 340, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (success ? 0.09 : 0.22));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (success ? 0.1 : 0.23));
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 300);
  } catch {
    // Ignore autoplay restriction errors
  }
}
