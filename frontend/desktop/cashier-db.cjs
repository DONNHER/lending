const { DatabaseSync } = require('node:sqlite');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function validItem(item) {
  return item && ['product_id', 'product_name', 'sku', 'unit_id', 'unit_name']
    .every((field) => typeof item[field] === 'string' && item[field] !== '') &&
    ['quantity', 'conversion_factor', 'quantity_base'].every((field) => Number.isFinite(item[field]) && item[field] > 0) &&
    ['unit_price', 'line_total'].every((field) => Number.isFinite(item[field]) && item[field] >= 0);
}

function openCashierDatabase(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS register_settings (
      setting TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pending_sales (
      event_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );
  `);

  const readSetting = db.prepare('SELECT value FROM register_settings WHERE setting = ?');
  const writeSetting = db.prepare(`
    INSERT INTO register_settings (setting, value) VALUES (?, ?)
    ON CONFLICT (setting) DO UPDATE SET value = excluded.value
  `);
  const readSales = db.prepare('SELECT payload FROM pending_sales ORDER BY rowid');
  const recordSale = db.prepare('INSERT INTO pending_sales (event_id, payload) VALUES (?, ?) ON CONFLICT (event_id) DO NOTHING');
  const deleteSale = db.prepare('DELETE FROM pending_sales WHERE event_id = ?');

  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function getOutbox() {
    return readSales.all().map((row) => JSON.parse(row.payload));
  }

  return {
    getApiOrigin: () => readSetting.get('api_origin')?.value ?? null,
    setApiOrigin(origin) {
      return transaction(() => {
        const current = readSetting.get('api_origin')?.value;
        if (current === origin) return false;
        if (db.prepare('SELECT 1 FROM pending_sales LIMIT 1').get()) {
          throw new Error('Sync the pending cash sales before switching servers.');
        }
        writeSetting.run('api_origin', origin);
        db.prepare("DELETE FROM register_settings WHERE setting = 'catalog'").run();
        return true;
      });
    },
    snapshot: () => ({
      catalog: JSON.parse(readSetting.get('catalog')?.value ?? 'null'),
      outbox: getOutbox(),
    }),
    saveCatalog(products) {
      if (!Array.isArray(products) || products.some((product) => typeof product?.id !== 'string')) {
        throw new Error('The product catalog is invalid.');
      }
      writeSetting.run('catalog', JSON.stringify(products));
    },
    queueSale(event) {
      if (typeof event?.event_id !== 'string' || !UUID.test(event.event_id) ||
          event.event_type !== 'pos.sale.completed' || event.terminal_id !== 'TERMINAL-001' ||
          typeof event.cashier_id !== 'string' || !event.cashier_id || !Number.isFinite(Date.parse(event.occurred_at)) ||
          event.payload?.payment_method !== 'cash' || event.payload.sale_id !== event.event_id ||
          !Array.isArray(event.payload.items) || !event.payload.items.length ||
          !event.payload.items.every(validItem) ||
          !Number.isFinite(event.payload.total) || event.payload.total < 0) {
        throw new Error('Only a valid cash sale can be saved for offline sync.');
      }
      return transaction(() => {
        recordSale.run(event.event_id, JSON.stringify(event));
        return getOutbox();
      });
    },
    acknowledgeSales(ids) {
      if (!Array.isArray(ids) || ids.length > 50 || ids.some((id) => typeof id !== 'string' || !UUID.test(id))) {
        throw new Error('The sync acknowledgement is invalid.');
      }
      return transaction(() => {
        for (const id of ids) deleteSale.run(id);
        return getOutbox();
      });
    },
    close: () => db.close(),
  };
}

module.exports = { openCashierDatabase };
