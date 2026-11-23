const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, rmdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { openCashierDatabase } = require('./cashier-db.cjs');

const id = 'f8af6d04-5171-4116-a118-3b94f3e1ac72';
const sale = {
  event_id: id, event_type: 'pos.sale.completed', terminal_id: 'TERMINAL-001',
  cashier_id: 'cashier', occurred_at: '2026-11-21T00:00:00.000Z',
  payload: {
    sale_id: id, payment_method: 'cash', total: 35,
    items: [{ product_id: 'grain', product_name: 'Grain', sku: 'GRAIN', unit_id: 'kg', unit_name: 'kg',
      quantity: 1, conversion_factor: 1, quantity_base: 1, unit_price: 35, line_total: 35 }],
  },
};

test('desktop SQLite keeps cash sales on restart and clears only acknowledged sale IDs', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'argivit-offline-'));
  const path = join(directory, 'register.sqlite');
  let register = openCashierDatabase(path);
  t.after(() => {
    register.close();
    for (const suffix of ['', '-shm', '-wal']) rmSync(`${path}${suffix}`, { force: true });
    rmdirSync(directory);
  });
  register.setApiOrigin('https://store.example.com');
  register.saveCatalog([{ id: 'grain' }]);
  assert.throws(() => register.queueSale({ ...sale, payload: { ...sale.payload, payment_method: 'gcash' } }), /cash sale/);
  assert.deepEqual(register.queueSale(sale), [sale]);
  assert.deepEqual(register.queueSale(sale), [sale]);
  assert.throws(() => register.setApiOrigin('https://other.example.com'), /Sync the pending/);
  register.close();

  register = openCashierDatabase(path);
  assert.deepEqual(register.snapshot(), { catalog: [{ id: 'grain' }], outbox: [sale] });
  assert.deepEqual(register.acknowledgeSales(['ad4272bc-49a6-4448-802d-fd718abce8b2']), [sale]);
  assert.deepEqual(register.acknowledgeSales([id]), []);
  assert.equal(register.setApiOrigin('https://other.example.com'), true);
  assert.deepEqual(register.snapshot(), { catalog: null, outbox: [] });
});
