import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkArray,
  validateAndNormalizeImportRow,
  validateImportHeaders,
} from './productImport';

const categories = [
  { id: 'cat-fert', name: 'Fertilizers & Soil' },
  { id: 'cat-seed', name: 'Seeds & Planting' },
  { id: 'cat-feed', name: 'Livestock Feed' },
];

test('validateImportHeaders detects missing required columns and accepts case-insensitive headers', () => {
  const ok = validateImportHeaders(['SKU', 'Name', 'Category', 'CostPrice', 'Stock', 'Description']);
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.missing, []);

  const missing = validateImportHeaders(['SKU', 'Name', 'Stock']);
  assert.equal(missing.valid, false);
  assert.deepEqual(missing.missing, ['Category', 'CostPrice', 'Description']);
});

test('validateAndNormalizeImportRow validates rules and applies unit pricing defaults', () => {
  const valid = validateAndNormalizeImportRow(
    {
      SKU: 'agr-fert-999',
      Name: 'Organic Humic Soil Booster',
      Category: 'Fertilizers & Soil',
      CostPrice: 20,
      Stock: 400,
      Description: 'Granular soil conditioner for rice and corn.',
      Barcode: '480001009999',
    },
    2,
    categories
  );

  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.row.sku, 'AGR-FERT-999');
    assert.equal(valid.row.category_id, 'cat-fert');
    assert.equal(valid.row.stock_base, 400);
    assert.equal(valid.row.sack_factor, 50);
    assert.equal(valid.row.kg_price, 25);
  }

  const badCategory = validateAndNormalizeImportRow(
    {
      SKU: 'AGR-BAD-1',
      Name: 'Unknown Item',
      Category: 'Nonexistent Category',
      CostPrice: 20,
      Stock: 10,
      Description: 'Valid description',
    },
    3,
    categories
  );
  assert.equal(badCategory.ok, false);

  const negativeStock = validateAndNormalizeImportRow(
    {
      SKU: 'AGR-BAD-2',
      Name: 'Negative Stock Item',
      Category: 'Seeds & Planting',
      CostPrice: 100,
      Stock: -5,
      Description: 'Valid description',
    },
    4,
    categories
  );
  assert.equal(negativeStock.ok, false);
});

test('chunkArray splits large datasets into 1000-row chunks', () => {
  const rows = Array.from({ length: 2305 }, (_, i) => i + 1);
  const chunks = chunkArray(rows, 1000);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 1000);
  assert.equal(chunks[1].length, 1000);
  assert.equal(chunks[2].length, 305);
});
