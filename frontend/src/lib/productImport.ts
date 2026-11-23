import { roundCurrency, roundQuantity } from './domainRules';

export const REQUIRED_PRODUCT_IMPORT_HEADERS = [
  'SKU',
  'Name',
  'Category',
  'CostPrice',
  'Stock',
  'Description',
] as const;

export const OPTIONAL_PRODUCT_IMPORT_HEADERS = [
  'Barcode',
  'SackWeightKg',
  'SackPrice',
  'KgPrice',
] as const;

export const PRODUCT_IMPORT_CHUNK_SIZE = 1000;

export interface RawProductImportRow {
  [key: string]: unknown;
}

export interface NormalizedProductImportRow {
  rowNumber: number;
  sku: string;
  name: string;
  category_id: string;
  category_name: string;
  description: string;
  cost_price: number;
  stock_base: number;
  barcode: string | null;
  sack_factor: number;
  sack_price: number;
  kg_price: number;
  image_key: 'fertilizer' | 'seeds' | 'feed';
}

export interface ProductImportRowError {
  rowNumber: number;
  sku: string;
  name: string;
  reason: string;
}

export interface CategoryLookupItem {
  id: string;
  name: string;
}

function normalizeHeaderKey(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

const HEADER_ALIASES: Record<string, string[]> = {
  SKU: ['sku', 'productsku', 'code', 'isbn'],
  Name: ['name', 'productname', 'title'],
  Category: ['category', 'categoryname', 'categoryid'],
  CostPrice: ['costprice', 'cost', 'costperkg', 'price', 'unitcost'],
  Stock: ['stock', 'stockkg', 'stockbase', 'quantity', 'openingstock'],
  Description: ['description', 'desc', 'details'],
  Barcode: ['barcode', 'ean', 'upc'],
  SackWeightKg: ['sackweightkg', 'sackfactor', 'sackkg', 'conversionfactor'],
  SackPrice: ['sackprice', 'sack_price'],
  KgPrice: ['kgprice', 'retailprice', 'perkgprice', 'kg_price'],
};

function readField(row: RawProductImportRow, canonicalKey: keyof typeof HEADER_ALIASES): unknown {
  const aliases = HEADER_ALIASES[canonicalKey];
  for (const [rawKey, value] of Object.entries(row)) {
    if (aliases.includes(normalizeHeaderKey(rawKey))) {
      return value;
    }
  }
  return undefined;
}

export function validateImportHeaders(headers: string[]): {
  valid: boolean;
  missing: string[];
} {
  const normalizedSet = new Set(headers.map((h) => normalizeHeaderKey(String(h || ''))));
  const missing: string[] = [];

  for (const required of REQUIRED_PRODUCT_IMPORT_HEADERS) {
    const aliases = HEADER_ALIASES[required];
    const matched = aliases.some((alias) => normalizedSet.has(alias));
    if (!matched) {
      missing.push(required);
    }
  }

  return { valid: missing.length === 0, missing };
}

function inferImageKey(categoryName: string): 'fertilizer' | 'seeds' | 'feed' {
  const lower = categoryName.toLowerCase();
  if (lower.includes('seed')) return 'seeds';
  if (lower.includes('feed') || lower.includes('livestock')) return 'feed';
  return 'fertilizer';
}

export function validateAndNormalizeImportRow(
  rawRow: RawProductImportRow,
  rowNumber: number,
  categories: CategoryLookupItem[]
): { ok: true; row: NormalizedProductImportRow } | { ok: false; error: ProductImportRowError } {
  const rawSku = String(readField(rawRow, 'SKU') ?? '').trim();
  const rawName = String(readField(rawRow, 'Name') ?? '').trim();
  const rawCategory = String(readField(rawRow, 'Category') ?? '').trim();
  const rawDesc = String(readField(rawRow, 'Description') ?? '').trim();
  const rawCost = readField(rawRow, 'CostPrice');
  const rawStock = readField(rawRow, 'Stock');
  const rawBarcode = String(readField(rawRow, 'Barcode') ?? '').trim();
  const rawSackFactor = readField(rawRow, 'SackWeightKg');
  const rawSackPrice = readField(rawRow, 'SackPrice');
  const rawKgPrice = readField(rawRow, 'KgPrice');

  const failRow = (reason: string): { ok: false; error: ProductImportRowError } => ({
    ok: false,
    error: {
      rowNumber,
      sku: rawSku || '—',
      name: rawName || '—',
      reason,
    },
  });

  if (!rawSku || rawSku.length < 2 || rawSku.length > 64) {
    return failRow('SKU is required and must be 2–64 characters.');
  }
  if (!rawName || rawName.length > 255) {
    return failRow('Name is required and must not exceed 255 characters.');
  }
  if (!rawDesc || rawDesc.length < 2) {
    return failRow('Description is required (minimum 2 characters).');
  }

  const matchedCategory = categories.find(
    (c) =>
      c.id.toLowerCase() === rawCategory.toLowerCase() ||
      c.name.toLowerCase() === rawCategory.toLowerCase()
  );
  if (!matchedCategory) {
    return failRow(`Category "${rawCategory || '(blank)'}" does not exist in cooperative categories.`);
  }

  const costPrice = Number(rawCost);
  if (!Number.isFinite(costPrice) || costPrice <= 0 || costPrice > 999999.99) {
    return failRow('CostPrice must be a positive number up to 999,999.99.');
  }

  const stockNum = Number(rawStock);
  if (!Number.isFinite(stockNum) || stockNum < 0 || !Number.isInteger(stockNum)) {
    return failRow('Stock must be a non-negative integer.');
  }

  const sackFactor =
    rawSackFactor !== undefined && String(rawSackFactor).trim() !== ''
      ? Number(rawSackFactor)
      : 50;
  if (!Number.isFinite(sackFactor) || sackFactor <= 0 || sackFactor > 1000) {
    return failRow('SackWeightKg must be a positive number up to 1,000.');
  }

  const kgPrice =
    rawKgPrice !== undefined && String(rawKgPrice).trim() !== ''
      ? Number(rawKgPrice)
      : roundCurrency(costPrice * 1.25);
  if (!Number.isFinite(kgPrice) || kgPrice <= 0 || kgPrice > 999999.99) {
    return failRow('KgPrice must be positive and at most 999,999.99.');
  }

  const sackPrice =
    rawSackPrice !== undefined && String(rawSackPrice).trim() !== ''
      ? Number(rawSackPrice)
      : roundCurrency(kgPrice * sackFactor * 0.94);
  if (!Number.isFinite(sackPrice) || sackPrice <= 0 || sackPrice > 999999.99) {
    return failRow('SackPrice must be positive and at most 999,999.99.');
  }

  return {
    ok: true,
    row: {
      rowNumber,
      sku: rawSku.toUpperCase(),
      name: rawName,
      category_id: matchedCategory.id,
      category_name: matchedCategory.name,
      description: rawDesc,
      cost_price: roundCurrency(costPrice),
      stock_base: roundQuantity(stockNum),
      barcode: rawBarcode ? rawBarcode : null,
      sack_factor: roundQuantity(sackFactor),
      sack_price: roundCurrency(sackPrice),
      kg_price: roundCurrency(kgPrice),
      image_key: inferImageKey(matchedCategory.name),
    },
  };
}

export function chunkArray<T>(items: T[], chunkSize: number = PRODUCT_IMPORT_CHUNK_SIZE): T[][] {
  const safeSize = Math.max(1, Math.floor(chunkSize));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += safeSize) {
    chunks.push(items.slice(i, i + safeSize));
  }
  return chunks;
}
