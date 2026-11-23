import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

const backendDir = path.resolve(import.meta.dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'argivit-laravel-test-'));
const database = path.join(tempDir, 'contract.sqlite');
const env = {
  ...process.env,
  APP_ENV: 'testing',
  APP_DEBUG: 'false',
  DB_CONNECTION: 'sqlite',
  DB_SQLITE_DATABASE: database,
  DB_URL: '',
  DATABASE_URL: '',
  JWT_SECRET: 'argivit-test-signing-key-with-more-than-32-bytes',
  AUTH_JWKS_URL: '',
  ARGIVIT_ALLOW_DEMO_AUTH: 'true',
  ARGIVIT_BACKUP_DIRECTORY: path.join(tempDir, 'backups'),
  DOCUMENT_STORAGE_DISK: 'local',
  DOCUMENT_STORAGE_LOCAL_PATH: path.join(tempDir, 'documents'),
};
let server: ChildProcess;
let baseUrl = '';

async function api<T = unknown>(
  endpoint: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<{ status: number; json: { success: boolean; message: string; data: T; meta?: unknown; errors?: Record<string, string[]> } }> {
  const res = await fetch(`${baseUrl}/api/v1${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const json = (await res.json()) as {
    success: boolean;
    message: string;
    data: T;
    meta?: unknown;
    errors?: Record<string, string[]>;
  };
  return { status: res.status, json };
}

before(async () => {
  fs.closeSync(fs.openSync(database, 'wx'));
  const setup = spawnSync('php', ['artisan', 'migrate', '--force', '--seed', '--seeder=DemoSeeder'], {
    cwd: backendDir, env, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(setup.status, 0, setup.error?.message || setup.stderr || setup.stdout);

  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  baseUrl = 'http://127.0.0.1:' + address.port;
  server = spawn('php', ['-S', '127.0.0.1:' + address.port, '-t', 'public', 'public/index.php'], {
    cwd: backendDir, env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
  });
  let startupLog = '';
  server.stderr?.on('data', (chunk) => { startupLog = (startupLog + String(chunk)).slice(-4000); });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(baseUrl + '/api/v1/health', { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
      throw new Error('Health status ' + response.status + ' ' + await response.text());
    } catch (error) {
      if (attempt === 49) throw new Error('Laravel failed to start. ' + startupLog, { cause: error });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
});

after(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('health endpoint reports online status', async () => {
  const res = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { success: boolean; application: string; status: string };
  assert.equal(body.success, true);
  assert.equal(body.application, 'Argivit Store API');
  assert.equal(body.status, 'online');
});

test('auth synchronize, session revocation on logout, RBAC, and impersonation work end-to-end', async () => {
  // Synchronize external user (role claim injection must be ignored -> always shareholder)
  const syncRes = await api<{ token: string; user: { id: string; role: string }; permissions: string[] }>('/auth/synchronize', {
    method: 'POST',
    body: {
      auth_user_id: 'ext-usr-991',
      email: 'ext.farmer@argivitstore.com',
      name: 'Carlos Mendoza',
      role: 'admin',
    },
  });
  assert.equal(syncRes.status, 200);
  assert.equal(syncRes.json.data.user.role, 'shareholder');
  assert.ok(syncRes.json.data.permissions.includes('shop.order'));

  const extToken = syncRes.json.data.token;

  // Shareholder blocked from admin/manager endpoints
  const usersDenied = await api('/users', { token: extToken });
  assert.equal(usersDenied.status, 403);

  // Logout revokes user_sessions token immediately
  const logoutRes = await api('/auth/logout', { method: 'POST', token: extToken });
  assert.equal(logoutRes.status, 200);

  const afterLogout = await api('/auth/me', { token: extToken });
  assert.equal(afterLogout.status, 401);

  // Admin login & impersonation
  const adminLogin = await api<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email: 'admin@argivitstore.com', password: 'Argivit2026!' },
  });
  assert.equal(adminLogin.status, 200);
  const adminToken = adminLogin.json.data.token;

  const impStart = await api<{ token: string; user: { role: string }; impersonated_by: { id: string } }>('/admin/impersonation', {
    method: 'POST',
    token: adminToken,
    body: { target_user_id: 'usr-cashier' },
  });
  assert.equal(impStart.status, 200);
  assert.equal(impStart.json.data.user.role, 'cashier');
  assert.equal(impStart.json.data.impersonated_by.id, 'usr-admin');

  const impExit = await api<{ user: { role: string }; impersonated_by: null }>('/admin/impersonation', {
    method: 'DELETE',
    token: impStart.json.data.token,
  });
  assert.equal(impExit.status, 200);
  assert.equal(impExit.json.data.user.role, 'admin');
  assert.equal(impExit.json.data.impersonated_by, null);
});

test('shareholder registration, document review history, and ownership enforcement', async () => {
  const mgrLogin = await api<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email: 'manager@argivitstore.com', password: 'Argivit2026!' },
  });
  const mgrToken = mgrLogin.json.data.token;

  // Cashier has no shareholder profile yet -> register one via /shareholders/register
  const cashLogin = await api<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email: 'cashier@argivitstore.com', password: 'Argivit2026!' },
  });
  const cashToken = cashLogin.json.data.token;

  const regSh = await api<{ profile: { id: string }; capital_account: { required_amount: number } }>(
    '/shareholders/register',
    {
      method: 'POST',
      token: cashToken,
      body: {
        first_name: 'Lea',
        last_name: 'Mendoza',
        contact_number: '+63 917 888 1234',
        address: 'Cabanatuan City, Nueva Ecija',
      },
    }
  );
  assert.equal(regSh.status, 201);
  assert.equal(regSh.json.data.capital_account.required_amount, 5000);

  // Mateo cannot view Rosa's documents
  const mateoLogin = await api<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email: 'mateo@argivitstore.com', password: 'Argivit2026!' },
  });
  const forbiddenDocs = await api('/shareholders/sh-2/documents', { token: mateoLogin.json.data.token });
  assert.equal(forbiddenDocs.status, 403);

  // Manager reviews doc-3 and document_reviews history is returned
  const revRes = await api('/documents/doc-3/review', {
    method: 'POST',
    token: mgrToken,
    body: { decision: 'approved', remarks: 'Clear ID scan verified.' },
  });
  assert.equal(revRes.status, 200);

  const sh2Docs = await api<Array<{ id: string; review_status: string; reviews: Array<{ decision: string; remarks: string }> }>>(
    '/shareholders/sh-2/documents',
    { token: mgrToken }
  );
  assert.equal(sh2Docs.status, 200);
  const doc3 = sh2Docs.json.data.find((d) => d.id === 'doc-3');
  assert.equal(doc3?.review_status, 'approved');
  assert.equal(doc3?.reviews[0]?.remarks, 'Clear ID scan verified.');
});

test('verification files require supported attachments and can only be downloaded by the owner or reviewers', async () => {
  const login = async (email: string) => {
    const result = await api<{ token: string }>('/auth/login', {
      method: 'POST', body: { email, password: 'Argivit2026!' },
    });
    assert.equal(result.status, 200);
    return result.json.data.token;
  };
  const owner = await login('mateo@argivitstore.com');
  const manager = await login('manager@argivitstore.com');
  const cashier = await login('cashier@argivitstore.com');
  const otherMember = await login('rosa@argivitstore.com');

  const upload = (file: Blob, filename: string) => {
    const body = new FormData();
    body.set('file', file, filename);
    body.set('document_type', 'government_id');
    return fetch(`${baseUrl}/api/v1/shareholder-documents`, {
      method: 'POST', headers: { Authorization: `Bearer ${owner}` }, body,
    });
  };
  const missingFile = await api('/shareholder-documents', {
    method: 'POST', token: owner, body: { document_type: 'government_id', file_name: 'filename-only.pdf' },
  });
  assert.equal(missingFile.status, 422);
  const invalidUpload = await upload(new Blob(['Plain text'], { type: 'application/pdf' }), 'invalid.pdf');
  assert.equal(invalidUpload.status, 422);
  const pdf = '%PDF-1.7\n% Verification test\n%%EOF\n';
  const stored = await upload(new Blob([pdf], { type: 'application/pdf' }), 'Member.id.PDF');
  const storedBody = await stored.json() as { data: { id: string }; message: string };
  assert.equal(stored.status, 201, storedBody.message);

  const docs = await api<Array<{ id: string; has_file: boolean; file_path: string }>>('/shareholders/sh-1/documents', { token: owner });
  const doc = docs.json.data.find((entry) => entry.id === storedBody.data.id);
  assert.equal(doc?.has_file, true);
  assert.equal(doc?.file_path, `/api/v1/documents/${storedBody.data.id}/download`);

  for (const token of [owner, manager]) {
    const response = await fetch(`${baseUrl}${doc!.file_path}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition') || '', /^attachment;/);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
    assert.equal(await response.text(), pdf);
  }
  for (const token of [cashier, otherMember]) {
    const response = await fetch(`${baseUrl}${doc!.file_path}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 403);
  }
});

test('products GET/PATCH, indexed search, and auditable inventory adjustments', async () => {
  const mgrLogin = await api<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email: 'manager@argivitstore.com', password: 'Argivit2026!' },
  });
  const mgrToken = mgrLogin.json.data.token;

  const searchRes = await api<Array<{ sku: string }>>('/products/search?q=480001001001', { token: mgrToken });
  assert.equal(searchRes.status, 200);
  assert.equal(searchRes.json.data.length, 1);
  assert.equal(searchRes.json.data[0].sku, 'AGR-FERT-001');

  const prodGet = await api<{ id: string; cost_price: number }>('/products/prod-1', { token: mgrToken });
  assert.equal(prodGet.status, 200);
  assert.equal(prodGet.json.data.id, 'prod-1');

  const prodPatch = await api<{ cost_price: number }>('/products/prod-1', {
    method: 'PATCH',
    token: mgrToken,
    body: { cost_price: 22.0 },
  });
  assert.equal(prodPatch.status, 200);
  assert.equal(prodPatch.json.data.cost_price, 22.0);

  const balPage1 = await api<Array<{ id: string }>>('/inventory/balances?page=1&per_page=8', { token: mgrToken });
  assert.equal(balPage1.status, 200);
  assert.equal(balPage1.json.data.length, 8);
  assert.equal((balPage1.json.meta as Record<string, unknown>)?.has_more, true);

  const adjRes = await api('/inventory/adjustments', {
    method: 'POST',
    token: mgrToken,
    body: {
      product_id: 'prod-1',
      direction: 'increase',
      quantity_base: 50,
      notes: 'Cycle count surplus reconciliation',
    },
  });
  assert.equal(adjRes.status, 201);
});

test('online order draft -> confirm -> POS scan & fulfill, plus ownership guard', async () => {
  const mateoLogin = await api<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email: 'mateo@argivitstore.com', password: 'Argivit2026!' },
  });
  const mateoToken = mateoLogin.json.data.token;

  const rosaLogin = await api<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email: 'rosa@argivitstore.com', password: 'Argivit2026!' },
  });
  const rosaToken = rosaLogin.json.data.token;

  // Verify paginated storefront catalog returns 12 items on page 1 with has_more=true, then remaining on page 2
  const shopPage1 = await api<Array<{ id: string }>>('/shop/products?page=1&per_page=12', {
    token: mateoToken,
  });
  assert.equal(shopPage1.status, 200);
  assert.equal(shopPage1.json.data.length, 12);
  assert.equal((shopPage1.json.meta as Record<string, unknown>)?.has_more, true);
  assert.equal((shopPage1.json.meta as Record<string, unknown>)?.total, 20);

  const shopPage2 = await api<Array<{ id: string }>>('/shop/products?page=2&per_page=12', {
    token: mateoToken,
  });
  assert.equal(shopPage2.status, 200);
  assert.equal(shopPage2.json.data.length, 8);
  assert.equal((shopPage2.json.meta as Record<string, unknown>)?.has_more, false);

  type ShopProduct = { id: string; units: Array<{ is_default: boolean; selling_price: number }> };
  const defaultPrice = (product: ShopProduct) => (product.units.find((unit) => unit.is_default) ?? product.units[0]).selling_price;
  for (const [sort, direction] of [['price_asc', 1], ['price_desc', -1]] as const) {
    const pages = await Promise.all([1, 2].map((page) => api<ShopProduct[]>(
      `/shop/products?page=${page}&per_page=12&sort=${sort}`, { token: mateoToken },
    )));
    assert.ok(pages.every(({ status }) => status === 200));
    const products = pages.flatMap(({ json }) => json.data);
    assert.equal(new Set(products.map(({ id }) => id)).size, 20);
    const prices = products.map(defaultPrice);
    assert.deepEqual(prices, prices.toSorted((left, right) => direction * (left - right)));
  }

  const draftRes = await api<{ id: string; status: string; token_code: string }>('/orders', {
    method: 'POST',
    token: mateoToken,
    body: {
      status: 'draft',
      notes: 'Hold for afternoon pickup',
      items: [{ product_id: 'prod-1', unit_id: 'unit-1-sack', quantity: 1 }],
    },
  });
  assert.equal(draftRes.status, 201);
  assert.equal(draftRes.json.data.status, 'draft');

  // Rosa cannot view or confirm Mateo's order
  const forbiddenOrder = await api(`/orders/${draftRes.json.data.id}`, { token: rosaToken });
  assert.equal(forbiddenOrder.status, 403);

  const confirmRes = await api<{ status: string }>(`/orders/${draftRes.json.data.id}/confirm`, {
    method: 'POST',
    token: mateoToken,
  });
  assert.equal(confirmRes.status, 200);
  assert.equal(confirmRes.json.data.status, 'confirmed');

  const mgrLogin = await api<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email: 'manager@argivitstore.com', password: 'Argivit2026!' },
  });
  const mgrToken = mgrLogin.json.data.token;

  const scanRes = await api<{ id: string }>(`/pos/orders/scan/${draftRes.json.data.token_code}`, {
    token: mgrToken,
  });
  assert.equal(scanRes.status, 200);

  const fulfillRes = await api<{ total: number }>(`/pos/orders/${draftRes.json.data.id}/fulfill`, {
    method: 'POST',
    token: mgrToken,
    body: { payment_method: 'cash', terminal_id: 'TERMINAL-001' },
  });
  assert.equal(fulfillRes.status, 201);
  assert.equal(fulfillRes.json.data.total, 1250);
});

test('loan applications/me, review, disbursement, schedule, payment allocation, and history', async () => {
  const mateoLogin = await api<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email: 'mateo@argivitstore.com', password: 'Argivit2026!' },
  });
  const mateoToken = mateoLogin.json.data.token;

  const mgrLogin = await api<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email: 'manager@argivitstore.com', password: 'Argivit2026!' },
  });
  const mgrToken = mgrLogin.json.data.token;

  const applyRes = await api<{ id: string }>('/loans/applications', {
    method: 'POST',
    token: mateoToken,
    body: {
      requested_amount: 10000,
      term_months: 3,
      purpose: 'Wet season fertilizer and seed procurement',
    },
  });
  assert.equal(applyRes.status, 201);

  const myApps = await api<Array<{ id: string }>>('/loans/applications/me', { token: mateoToken });
  assert.equal(myApps.status, 200);
  assert.ok(myApps.json.data.some((a) => a.id === applyRes.json.data.id));

  const dashRes = await api<{ evaluation: { capital_multiplier: number; maximum_loan: number } }>(
    '/loans/dashboard',
    { token: mateoToken }
  );
  assert.equal(dashRes.status, 200);
  assert.equal(dashRes.json.data.evaluation.capital_multiplier, 6);
  assert.equal(dashRes.json.data.evaluation.maximum_loan, 30000);

  const reviewRes = await api<{ loan_id: string }>(`/loans/applications/${applyRes.json.data.id}/review`, {
    method: 'POST',
    token: mgrToken,
    body: { decision: 'approved', remarks: 'Within 6x share capital ceiling.' },
  });
  assert.equal(reviewRes.status, 200);
  const loanId = reviewRes.json.data.loan_id;

  const disbRes = await api(`/loans/${loanId}/disburse`, {
    method: 'POST',
    token: mgrToken,
  });
  assert.equal(disbRes.status, 200);

  // Even before paying the first installment, shareholder can still withdraw/apply until available credit runs out
  const secondWithdrawRes = await api<{ id: string }>('/loans/applications', {
    method: 'POST',
    token: mateoToken,
    body: {
      requested_amount: 5000,
      term_months: 3,
      purpose: 'Additional crop protection inputs',
    },
  });
  assert.equal(secondWithdrawRes.status, 201);

  const eligAfterSecond = await api<{ available_credit: number; eligible: boolean }>('/loans/eligibility', {
    token: mateoToken,
  });
  assert.equal(eligAfterSecond.status, 200);
  assert.equal(eligAfterSecond.json.data.eligible, true);
  assert.equal(eligAfterSecond.json.data.available_credit, 14400);

  const schedRes = await api<{ computed_total_payable: number; installments: Array<{ amount_due: number }> }>(
    `/loans/${loanId}/schedule`,
    { token: mateoToken }
  );
  assert.equal(schedRes.status, 200);
  assert.equal(schedRes.json.data.computed_total_payable, 10600);
  assert.equal(schedRes.json.data.installments.length, 3);

  // Only the manager can record a repayment.
  const shareholderPayDenied = await api(`/loans/${loanId}/payments`, {
    method: 'POST',
    token: mateoToken,
    body: { amount: schedRes.json.data.installments[0].amount_due, payment_method: 'cash', reference: 'LPAY-DENIED' },
  });
  assert.equal(shareholderPayDenied.status, 403);

  for (const role of ['cashier', 'admin']) {
    const login = await api<{ token: string }>('/auth/login', {
      method: 'POST',
      body: { email: `${role}@argivitstore.com`, password: 'Argivit2026!' },
    });
    const denied = await api(`/loans/${loanId}/payments`, {
      method: 'POST',
      token: login.json.data.token,
      body: { amount: 1, payment_method: 'cash', reference: `LPAY-${role}` },
    });
    assert.equal(denied.status, 403);
    if (role === 'admin') {
      const impersonation = await api<{ token: string }>('/admin/impersonation', {
        method: 'POST', token: login.json.data.token, body: { target_user_id: 'usr-manager' },
      });
      assert.equal(impersonation.status, 200);
      const deniedWhileImpersonating = await api(`/loans/${loanId}/payments`, {
        method: 'POST', token: impersonation.json.data.token,
        body: { amount: 1, payment_method: 'cash', reference: 'LPAY-IMPERSONATED' },
      });
      assert.equal(deniedWhileImpersonating.status, 403);
    }
  }

  const payRes = await api(`/loans/${loanId}/payments`, {
    method: 'POST',
    token: mgrToken,
    body: { amount: schedRes.json.data.installments[0].amount_due, payment_method: 'cash', reference: 'LPAY-TEST-01' },
  });
  assert.equal(payRes.status, 201);

  const histRes = await api<{
    reviews: Array<unknown>;
    disbursements: Array<unknown>;
    payments: Array<unknown>;
    loan: { computed_balance: number };
  }>(`/loans/${loanId}/history`, { token: mateoToken });
  assert.equal(histRes.status, 200);
  assert.equal(histRes.json.data.reviews.length, 1);
  assert.equal(histRes.json.data.disbursements.length, 1);
  assert.equal(histRes.json.data.payments.length, 1);
  assert.ok(histRes.json.data.loan.computed_balance < 10600);

  // Marking next installment overdue suspends withdrawal/application privileges
  const overdueRes = await api(`/loans/${loanId}/simulate-overdue`, {
    method: 'POST',
    token: mgrToken,
  });
  assert.equal(overdueRes.status, 200);

  const blockedWithdraw = await api('/loans/applications', {
    method: 'POST',
    token: mateoToken,
    body: {
      requested_amount: 1000,
      term_months: 3,
      purpose: 'Should fail while overdue',
    },
  });
  assert.equal(blockedWithdraw.status, 422);
});

test('offline sync single event idempotency, batch inspection, and cursor-based sync changes', async () => {
  const cashLogin = await api<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email: 'cashier@argivitstore.com', password: 'Argivit2026!' },
  });
  const cashToken = cashLogin.json.data.token;

  const cursorBefore = new Date(Date.now() - 60_000).toISOString();
  const eventId = `evt-test-${Date.now()}`;
  const payload = {
    event_id: eventId,
    event_type: 'pos.sale.completed',
    terminal_id: 'TERMINAL-002',
    occurred_at: new Date().toISOString(),
    payload: {
      sale_id: `loc-${Date.now()}`,
      payment_method: 'cash',
      items: [
        {
          product_id: 'prod-2',
          product_name: 'Prilled Urea 46-0-0 Nitrogen',
          sku: 'AGR-FERT-002',
          unit_id: 'unit-2-sack',
          unit_name: 'sack (50 kg)',
          quantity: 1,
          conversion_factor: 50,
          quantity_base: 50,
          unit_price: 1380,
          line_total: 1380,
        },
      ],
      total: 1380,
    },
  };

  const firstPush = await api<{ batch_id: string; status: string; sync_cursor: string }>('/sync/events', {
    method: 'POST',
    token: cashToken,
    body: payload,
  });
  assert.equal(firstPush.status, 200);
  assert.equal(firstPush.json.data.status, 'processed');

  // Re-sending same event_id must return duplicate_ignored
  const dupPush = await api<{ status: string }>('/sync/events', {
    method: 'POST',
    token: cashToken,
    body: payload,
  });
  assert.equal(dupPush.status, 200);
  assert.equal(dupPush.json.data.status, 'duplicate_ignored');

  const batchGet = await api<{ id: string; events: Array<{ event_id: string }> }>(
    `/sync/batches/${firstPush.json.data.batch_id}`,
    { token: cashToken }
  );
  assert.equal(batchGet.status, 200);
  assert.equal(batchGet.json.data.events[0].event_id, eventId);

  const changesRes = await api<{ next_cursor: string; products: Array<{ id: string }> }>(
    `/sync/changes?cursor=${encodeURIComponent(cursorBefore)}&terminal_id=TERMINAL-002`,
    { token: cashToken }
  );
  assert.equal(changesRes.status, 200);
  assert.ok(changesRes.json.data.next_cursor);
  assert.ok(changesRes.json.data.products.some((p) => p.id === 'prod-2'));
});

test('replaying a cash sale after an interrupted checkout does not deduct stock twice', async () => {
  const login = await api<{ token: string; user: { id: string } }>('/auth/login', {
    method: 'POST',
    body: { email: 'cashier@argivitstore.com', password: 'Argivit2026!' },
  });
  const { token, user } = login.json.data;
  const saleId = crypto.randomUUID();
  const terminalId = 'TERMINAL-001';
  const productId = 'prod-2';
  const item = { product_id: productId, unit_id: 'unit-2-sack', quantity: 1 };
  const before = await api<{ stock_base: number }>(`/products/${productId}`, { token });
  const checkout = await api<{ id: string }>('/pos/checkout', {
    method: 'POST', token,
    body: { terminal_id: terminalId, client_sale_id: saleId, payment_method: 'cash', items: [item] },
  });
  assert.equal(checkout.status, 201);

  const replay = await api<{ results: Array<{ status: string; central_sale_id: string }> }>('/sync/batches', {
    method: 'POST', token,
    body: { terminal_id: terminalId, events: [{
      event_id: saleId,
      event_type: 'pos.sale.completed',
      terminal_id: terminalId,
      cashier_id: user.id,
      occurred_at: new Date().toISOString(),
      payload: {
        sale_id: saleId, payment_method: 'cash', total: 1380,
        items: [{ ...item, product_name: 'Prilled Urea', sku: 'AGR-FERT-002', unit_name: 'sack (50 kg)',
          conversion_factor: 50, quantity_base: 50, unit_price: 1380, line_total: 1380 }],
      },
    }] },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.data.results[0].status, 'duplicate_ignored');
  assert.equal(replay.json.data.results[0].central_sale_id, checkout.json.data.id);
  const after = await api<{ stock_base: number }>(`/products/${productId}`, { token });
  assert.equal(after.json.data.stock_base, before.json.data.stock_base - 50);
});

test('period reports, rate-limit headers, bulk product import, governance backups, and audit filtering', async () => {
  const adminLogin = await api<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email: 'admin@argivitstore.com', password: 'Argivit2026!' },
  });
  const adminToken = adminLogin.json.data.token;

  const mgrLogin = await api<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email: 'manager@argivitstore.com', password: 'Argivit2026!' },
  });
  const mgrToken = mgrLogin.json.data.token;

  // Verify rate-limit headers & period filtering across daily/weekly/monthly/annually
  for (const period of ['daily', 'weekly', 'monthly', 'annually'] as const) {
    const rawRes = await fetch(`${baseUrl}/api/v1/reports/overview?period=${period}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(rawRes.status, 200);
    assert.ok(Number(rawRes.headers.get('x-ratelimit-limit')) > 0);
    assert.ok(rawRes.headers.get('x-ratelimit-remaining') !== null);
    assert.equal(rawRes.headers.get('x-ratelimit-tier'), 'admin');

    const body = (await rawRes.json()) as {
      data: {
        period: string;
        pos_report: { total_revenue: number; by_payment_method: unknown[] };
        loans_report: { total_principal: number; loans: unknown[] };
      };
    };
    assert.equal(body.data.period, period);
    assert.equal(typeof body.data.pos_report.total_revenue, 'number');
    assert.ok(Array.isArray(body.data.pos_report.by_payment_method));
    assert.ok(Array.isArray(body.data.loans_report.loans));
  }

  // Bulk Excel/CSV import: 1 valid new SKU, 1 skip-on-failure invalid category
  const importCreate = await api<{
    created_count: number;
    updated_count: number;
    skipped_count: number;
    failed_count: number;
    failures: Array<{ sku: string; reason: string }>;
  }>('/products/import', {
    method: 'POST',
    token: mgrToken,
    body: {
      filename: 'test-catalog.xlsx',
      format: 'xlsx',
      duplicate_mode: 'skip',
      chunk_index: 0,
      total_chunks: 1,
      rows: [
        {
          rowNumber: 2,
          sku: 'AGR-BULK-901',
          name: 'Cooperative Bio-Organic Compost 50kg',
          category_id: 'cat-fert',
          description: 'Enriched organic soil conditioner for cooperative rice plots.',
          cost_price: 18.5,
          stock_base: 400,
          barcode: '480009990001',
          sack_factor: 50,
        },
        {
          rowNumber: 3,
          sku: 'AGR-BAD-902',
          name: 'Invalid Category Product',
          category_id: 'cat-nonexistent',
          description: 'Should skip with detailed error.',
          cost_price: 25,
          stock_base: 50,
        },
      ],
    },
  });
  assert.equal(importCreate.status, 201);
  assert.equal(importCreate.json.data.created_count, 1);
  assert.equal(importCreate.json.data.failed_count, 1);
  assert.equal(importCreate.json.data.failures[0].sku, 'AGR-BAD-902');

  // Re-importing same SKU with skip vs update
  const importSkip = await api<{ skipped_count: number; created_count: number }>('/products/import', {
    method: 'POST',
    token: mgrToken,
    body: {
      filename: 'test-catalog-skip.xlsx',
      format: 'xlsx',
      duplicate_mode: 'skip',
      rows: [
        {
          rowNumber: 2,
          sku: 'AGR-BULK-901',
          name: 'Cooperative Bio-Organic Compost 50kg',
          category_id: 'cat-fert',
          description: 'Duplicate should be skipped.',
          cost_price: 19,
          stock_base: 450,
        },
      ],
    },
  });
  assert.equal(importSkip.status, 201);
  assert.equal(importSkip.json.data.skipped_count, 1);
  assert.equal(importSkip.json.data.created_count, 0);

  const importUpdate = await api<{ updated_count: number }>('/products/import', {
    method: 'POST',
    token: mgrToken,
    body: {
      filename: 'test-catalog-update.xlsx',
      format: 'xlsx',
      duplicate_mode: 'update',
      rows: [
        {
          rowNumber: 2,
          sku: 'AGR-BULK-901',
          name: 'Cooperative Bio-Organic Compost 50kg Updated',
          category_id: 'cat-fert',
          description: 'Updated via Excel duplicate update mode.',
          cost_price: 19.75,
          stock_base: 600,
        },
      ],
    },
  });
  assert.equal(importUpdate.status, 201);
  assert.equal(importUpdate.json.data.updated_count, 1);

  const importLogsRes = await api<Array<{ filename: string }>>('/products/import-logs', { token: mgrToken });
  assert.equal(importLogsRes.status, 200);
  assert.ok(importLogsRes.json.data.some((l) => l.filename === 'test-catalog.xlsx'));

  // Export logs endpoint
  const exportLogRes = await api<{ id: string }>('/reports/export-logs', {
    method: 'POST',
    token: adminToken,
    body: {
      export_type: 'reports_pos',
      format: 'pdf',
      period: 'monthly',
      row_count: 14,
    },
  });
  assert.equal(exportLogRes.status, 201);

  // Manager cannot trigger manual DB backup (Admin only), Admin can
  const mgrBackupDenied = await api('/admin/backups/trigger', { method: 'POST', token: mgrToken });
  assert.equal(mgrBackupDenied.status, 403);

  const adminBackupRes = await api<{ id: string; status: string }>('/admin/backups/trigger', {
    method: 'POST',
    token: adminToken,
  });
  assert.equal(adminBackupRes.status, 201);
  assert.equal(adminBackupRes.json.data.status, 'verified');

  const govRes = await api<{
    backups: Array<{ id: string }>;
    scheduled_tasks: Array<{ task_name: string }>;
    rate_limits: { tiers: Array<{ tier: string }> };
    import_logs: Array<{ filename: string }>;
    export_logs: Array<{ export_type: string }>;
  }>('/admin/governance', { token: adminToken });
  assert.equal(govRes.status, 200);
  assert.ok(govRes.json.data.backups.some((b) => b.id === adminBackupRes.json.data.id));
  assert.ok(govRes.json.data.scheduled_tasks.some((t) => t.task_name === 'backup:run'));
  assert.ok(govRes.json.data.rate_limits.tiers.some((t) => t.tier === 'admin'));
  assert.ok(govRes.json.data.export_logs.some((e) => e.export_type === 'reports_pos'));

  // Audit log query filter
  const auditFiltered = await api<Array<{ action: string }>>(
    '/admin/audit-logs?action=system.backup_created&q=backup',
    { token: adminToken }
  );
  assert.equal(auditFiltered.status, 200);
  assert.ok(auditFiltered.json.data.length >= 1);
  assert.equal(auditFiltered.json.data[0].action, 'system.backup_created');
});

test('manager acceptance posts a conflicted cash sale once under the original cashier', async () => {
  const cashier = await api<{ token: string; user: { id: string } }>('/auth/login', {
    method: 'POST', body: { email: 'cashier@argivitstore.com', password: 'Argivit2026!' },
  });
  const manager = await api<{ token: string }>('/auth/login', {
    method: 'POST', body: { email: 'manager@argivitstore.com', password: 'Argivit2026!' },
  });
  const cashierToken = cashier.json.data.token;
  const managerToken = manager.json.data.token;
  const productId = 'prod-2';
  const before = await api<{ stock_base: number }>(`/products/${productId}`, { token: cashierToken });
  assert.equal(before.status, 200);
  const eventId = crypto.randomUUID();
  const terminalId = 'TERMINAL-001';
  const quantity = Math.floor(before.json.data.stock_base / 50) + 1;
  const total = quantity * 1380;
  const event = {
    event_id: eventId, event_type: 'pos.sale.completed', terminal_id: terminalId,
    cashier_id: cashier.json.data.user.id, occurred_at: new Date().toISOString(),
    payload: { sale_id: eventId, payment_method: 'cash', total, items: [{
      product_id: productId, product_name: 'Prilled Urea', sku: 'AGR-FERT-002',
      unit_id: 'unit-2-sack', unit_name: 'sack (50 kg)', quantity,
      conversion_factor: 50, quantity_base: quantity * 50, unit_price: 1380, line_total: total,
    }] },
  };
  const conflicted = await api<{ status: string }>('/sync/events', { method: 'POST', token: cashierToken, body: event });
  assert.equal(conflicted.json.data.status, 'conflict');
  const list = await api<{ conflicts: Array<{ id: string; event_id: string }> }>('/sync/conflicts', { token: managerToken });
  const conflict = list.json.data.conflicts.find((entry) => entry.event_id === eventId);
  assert(conflict);
  const resolve = () => api<{ central_sale_id: string }>(`/sync/conflicts/${conflict.id}/resolve`, {
    method: 'POST', token: managerToken, body: { resolution: 'accepted_negative_adjustment' },
  });
  const accepted = await resolve();
  assert.equal(accepted.status, 200);
  const saleId = accepted.json.data.central_sale_id;
  assert.equal(saleId, `sale-${eventId}`);
  const repeated = await resolve();
  assert.equal(repeated.status, 200);
  assert.equal(repeated.json.data.central_sale_id, saleId);
  const replayed = await api<{ status: string; central_sale_id: string }>('/sync/events', { method: 'POST', token: cashierToken, body: event });
  assert.equal(replayed.json.data.status, 'duplicate_ignored');
  assert.equal(replayed.json.data.central_sale_id, saleId);
  const sales = await api<Array<{ id: string; cashier_id: string; payment_method: string; total: number }>>('/pos/sales', { token: cashierToken });
  const matchingSales = sales.json.data.filter((sale) => sale.id === saleId);
  assert.equal(matchingSales.length, 1);
  assert.equal(matchingSales[0].cashier_id, cashier.json.data.user.id);
  assert.equal(matchingSales[0].payment_method, 'cash');
  assert.equal(matchingSales[0].total, total);
  const after = await api<{ stock_base: number }>(`/products/${productId}`, { token: cashierToken });
  assert.equal(after.json.data.stock_base, before.json.data.stock_base - quantity * 50);
});

