import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
  CACHE_STORE: 'array',
  GEMINI_API_KEY: '',
  OLLAMA_BASE_URL: '',
  ARGIVIT_ALLOW_DEMO_AUTH: 'true',
  ARGIVIT_EMAIL_MFA: 'false',
  ARGIVIT_NOTIFICATION_STREAM: 'true',
  ARGIVIT_TEST_API_REQUESTS_PER_MINUTE: '1000',
  ARGIVIT_BACKUP_DIRECTORY: path.join(tempDir, 'backups'),
  DOCUMENT_STORAGE_DISK: 'local',
  DOCUMENT_STORAGE_LOCAL_PATH: path.join(tempDir, 'documents'),
};
let server: ChildProcess;
let baseUrl = '';
let ollama: ReturnType<typeof createHttpServer>;
let ollamaPrompt: { question: string; inventory: Array<{ id: string; available: string; category: string }> };

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

  ollama = createHttpServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    ollamaPrompt = JSON.parse(payload.messages[1].content);
    response.setHeader('Content-Type', 'application/json');
    if (ollamaPrompt.question === 'Simulate an unavailable model') {
      response.writeHead(503).end('{}');
      return;
    }
    const product_ids = ['prod-1'];
    if (ollamaPrompt.question === 'Simulate an invented product') product_ids.push('invented-id');
    response.end(JSON.stringify({ message: { content: JSON.stringify({
      explanation: 'This is a balanced granular fertilizer.', product_ids,
    }) } }));
  });
  ollama.listen(0, '127.0.0.1');
  await once(ollama, 'listening');
  const ollamaAddress = ollama.address();
  assert(ollamaAddress && typeof ollamaAddress !== 'string');
  env.OLLAMA_BASE_URL = `http://127.0.0.1:${ollamaAddress.port}`;

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
  if (ollama?.listening) await new Promise<void>((resolve) => ollama.close(() => resolve()));
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
    body.set('document_type', 'original_land_paper');
    return fetch(`${baseUrl}/api/v1/shareholder-documents`, {
      method: 'POST', headers: { Authorization: `Bearer ${owner}` }, body,
    });
  };
  const missingFile = await api('/shareholder-documents', {
    method: 'POST', token: owner, body: { document_type: 'original_land_paper', file_name: 'filename-only.pdf' },
  });
  assert.equal(missingFile.status, 422);
  const invalidUpload = await upload(new Blob(['Plain text'], { type: 'application/pdf' }), 'invalid.pdf');
  assert.equal(invalidUpload.status, 422);
  const pdf = '%PDF-1.7\n% Verification test\n%%EOF\n';
  const stored = await upload(new Blob([pdf], { type: 'application/pdf' }), 'Original.land.PDF');
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

test('Loans unlock only after a manager approves land papers and records the required capital', async () => {
  const member = await api<{ token: string }>('/auth/register', {
    method: 'POST', body: { email: 'land.paper@argivitstore.com', password: 'Argivit2026!', first_name: 'Isabel', last_name: 'Reyes' },
  });
  assert.equal(member.status, 201);
  const token = member.json.data.token;
  const manager = await api<{ token: string }>('/auth/login', {
    method: 'POST', body: { email: 'manager@argivitstore.com', password: 'Argivit2026!' },
  });
  assert.equal(manager.status, 200);
  const managerToken = manager.json.data.token;

  const membership = () => api<{
    profile: { id: string; verification_status: string };
    loan_access: boolean;
    required_share_capital: number;
    capital_payments: Array<{ amount: number; status: string }>;
  }>('/shareholders/me', { token });
  const initial = (await membership()).json.data;
  assert.equal(initial.profile.verification_status, 'incomplete');
  assert.equal(initial.loan_access, false);
  const memberPath = `/shareholders/${initial.profile.id}`;
  const approve = () => api(`${memberPath}/verify`, { method: 'POST', token: managerToken, body: { decision: 'approved' } });
  const record = (amount: number, reference: string, actorToken = managerToken) => api(`${memberPath}/share-capital/payments`, {
    method: 'POST', token: actorToken, body: { amount, reference, payment_method: 'cash' },
  });
  const dashboard = () => api('/loans/dashboard', { token });
  const upload = async (type: string) => {
    const body = new FormData();
    body.set('document_type', type);
    body.set('file', new Blob(['%PDF-1.7\n% Land paper test\n%%EOF\n'], { type: 'application/pdf' }), 'land-paper.pdf');
    return fetch(`${baseUrl}/api/v1/shareholder-documents`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
  };

  assert.equal((await dashboard()).status, 403);
  assert.equal((await approve()).status, 422);
  assert.equal((await record(2000, 'TEST-LAND-CAP-1')).status, 422);
  assert.equal((await record(2000, 'TEST-LAND-CAP-1', token)).status, 403);
  assert.equal((await api('/share-capital/payments', { method: 'POST', token, body: { amount: 5000, reference: 'TEST-SELF-CAP', payment_method: 'cash' } })).status, 403);

  assert.equal((await upload('government_id')).status, 422);
  const paper = await upload('notarized_land_paper');
  assert.equal(paper.status, 201);
  const { data: { id: documentId } } = await paper.json() as { data: { id: string } };
  assert.equal((await membership()).json.data.profile.verification_status, 'pending_review');
  assert.equal((await approve()).status, 422);
  const review = await api(`/documents/${documentId}/review`, {
    method: 'POST', token: managerToken, body: { decision: 'approved' },
  });
  assert.equal(review.status, 200);
  assert.equal((await approve()).status, 200);
  assert.equal((await dashboard()).status, 403);
  assert.equal((await record(2000, 'TEST-LAND-CAP-1')).status, 201);
  assert.equal((await membership()).json.data.loan_access, false);
  assert.equal((await record(2000, 'TEST-LAND-CAP-1')).status, 422);
  assert.equal((await record(initial.required_share_capital - 2000, 'TEST-LAND-CAP-2')).status, 201);

  const unlocked = (await membership()).json.data;
  assert.equal(unlocked.loan_access, true);
  assert.equal(unlocked.capital_payments.length, 2);
  assert.ok(unlocked.capital_payments.every((payment) => payment.status === 'verified'));
  assert.equal((await dashboard()).status, 200);
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

test('shop assistance uses scoped live inventory and safely handles model failures', async () => {
  const login = await api<{ token: string }>('/auth/login', {
    method: 'POST', body: { email: 'mateo@argivitstore.com', password: 'Argivit2026!' },
  });
  const token = login.json.data.token;
  const category = 'Fertilizers & Soil';
  type Assistance = { explanation: string; products: Array<{ id: string; stock_base: number }>; fallback: boolean };
  const ask = (question: string) => api<Assistance>('/shop/assistance', { method: 'POST', token, body: { question, category } });

  const denied = await api('/shop/assistance', { method: 'POST', body: { question: 'Do you have fertilizer?' } });
  assert.equal(denied.status, 401);

  const result = await ask('Do you have NPK fertilizer?');
  assert.equal(result.status, 200);
  assert.equal(result.json.data.explanation, 'This is a balanced granular fertilizer.');
  assert.equal(result.json.data.fallback, false);
  assert.deepEqual(result.json.data.products.map(({ id }) => id), ['prod-1']);
  assert.equal(ollamaPrompt.question, 'Do you have NPK fertilizer?');
  assert.ok(ollamaPrompt.inventory.every((product) => product.category === category));
  const recommended = result.json.data.products[0];
  assert.ok(recommended.stock_base > 0);
  assert.equal(ollamaPrompt.inventory.find(({ id }) => id === 'prod-1')?.available, `${recommended.stock_base} kg`);

  const invented = await ask('Simulate an invented product');
  assert.deepEqual(invented.json.data.products.map(({ id }) => id), ['prod-1']);
  assert.match(invented.json.data.explanation, /verify/);

  const unavailable = await ask('Simulate an unavailable model');
  assert.equal(unavailable.status, 200);
  assert.equal(unavailable.json.data.fallback, true);
  assert.deepEqual(unavailable.json.data.products, []);
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

test('scheduled database, upload and full backups verify and retain the newest copies', () => {
  function artisan(...args: string[]) {
    const result = spawnSync('php', ['artisan', ...args, '--no-ansi'], {
      cwd: backendDir, env, encoding: 'utf8', windowsHide: true,
    });
    assert.equal(result.status, 0, result.stdout || result.stderr);
  }

  const db = new DatabaseSync(database);
  try {
    const sources = db.prepare("SELECT count(*) AS count FROM shareholder_documents WHERE file_path LIKE 'verification/%'").get();
    assert.ok(Number(sources?.count) > 0, 'Expected the uploaded document from the API contract fixtures');
    artisan('argivit:backup', 'database');
    artisan('argivit:backup', 'uploads');
    artisan('argivit:backup', 'full');

    const records = db.prepare("SELECT backup_type, storage_location, status FROM backup_monitoring WHERE backup_type LIKE 'scheduled_%'").all();
    assert.equal(records.length, 3);
    const files = new Map(records.map((record) => {
      assert.equal(record.status, 'verified');
      const filename = String(record.storage_location).slice('Private local backup: '.length);
      const file = path.join(env.ARGIVIT_BACKUP_DIRECTORY, filename);
      assert.ok(fs.statSync(file).size > 0);
      return [record.backup_type, file];
    }));
    assert.equal(fs.readFileSync(files.get('scheduled_database')!).subarray(0, 15).toString(), 'SQLite format 3');
    assert.equal(fs.readFileSync(files.get('scheduled_full')!).subarray(0, 2).toString(), 'PK');

    db.prepare("UPDATE backup_monitoring SET created_at = '2000-01-01T00:00:00.000Z' WHERE backup_type = 'scheduled_database'").run();
    artisan('argivit:prune-backups');
    assert.equal(fs.existsSync(files.get('scheduled_database')!), false);
    assert.equal(fs.existsSync(files.get('scheduled_uploads')!), true);
    assert.equal(db.prepare("SELECT status FROM backup_monitoring WHERE backup_type = 'scheduled_database'").get()?.status, 'expired');

    db.prepare("INSERT INTO audit_logs (id, actor_id, actor_name, action, entity_type, entity_id, metadata_json, created_at) VALUES ('test-archive-90', 'test', 'Test', 'test.archive', 'test', 'test', '{}', '2000-01-01T00:00:00.000Z')").run();
    artisan('argivit:archive-audit');
    assert.ok(db.prepare("SELECT archived_at FROM audit_logs WHERE id = 'test-archive-90'").get()?.archived_at);
  } finally {
    db.close();
  }
});

test('session timeout, devices, force sign-out, and impersonation share revocation semantics', async () => {
  type Login = { token: string; session: { id: string; expires_at: string; remembered: boolean; idle_timeout: boolean } };
  const signIn = async (email: string, remember: boolean) => {
    const response = await api<Login>('/auth/login', {
      method: 'POST', body: { email, password: 'Argivit2026!', remember },
    });
    assert.equal(response.status, 200);
    return response.json.data;
  };

  const manager = await signIn('manager@argivitstore.com', false);
  assert.equal(manager.session.remembered, false);
  assert.equal(manager.session.idle_timeout, true);
  const secondDevice = await signIn('manager@argivitstore.com', true);
  const active = await api<Array<{ id: string; current: boolean }>>('/auth/sessions', { token: manager.token });
  assert.ok(active.json.data.some((device) => device.id === manager.session.id && device.current));
  assert.ok(active.json.data.some((device) => device.id === secondDevice.session.id && !device.current));

  const db = new DatabaseSync(database);
  try {
    const minuteAgo = new Date(Date.now() - 60_000).toISOString();
    db.prepare('UPDATE user_sessions SET last_active_at = ? WHERE id = ?').run(minuteAgo, manager.session.id);
    const touch = await api<Login['session']>('/auth/session/activity', { method: 'POST', token: manager.token });
    assert.equal(touch.status, 200);
    assert.ok(Date.parse(touch.json.data.expires_at) >= Date.now() + 29 * 60_000);

    assert.equal((await api('/auth/sessions/' + secondDevice.session.id, { method: 'DELETE', token: manager.token })).status, 200);
    assert.equal((await api('/auth/me', { token: secondDevice.token })).status, 401);

    const cashier = await signIn('cashier@argivitstore.com', true);
    assert.equal(cashier.session.idle_timeout, false);
    db.prepare("UPDATE user_sessions SET last_active_at = '2000-01-01T00:00:00.000Z' WHERE id IN (?, ?)").run(manager.session.id, cashier.session.id);
    assert.equal((await api('/auth/me', { token: manager.token })).status, 401);
    assert.equal((await api('/auth/session/activity', { method: 'POST', token: manager.token })).status, 401);
    assert.equal((await api('/auth/me', { token: cashier.token })).status, 200);

    const admin = await signIn('admin@argivitstore.com', true);
    const secondAdminDevice = await signIn('admin@argivitstore.com', true);
    const borrowed = await api<Login>('/admin/impersonation', {
      method: 'POST', token: admin.token, body: { target_user_id: 'usr-manager' },
    });
    assert.equal(borrowed.status, 200);
    const impersonatedToken = borrowed.json.data.token;
    assert.equal((await api('/auth/me', { token: impersonatedToken })).status, 200);
    assert.equal((await api('/admin/users/usr-admin/force-logout', { method: 'POST', token: impersonatedToken })).status, 403);
    const signedOut = await api<{ sessions_revoked: number }>('/admin/users/usr-admin/force-logout', {
      method: 'POST', token: secondAdminDevice.token,
    });
    assert.equal(signedOut.status, 200);
    assert.ok(signedOut.json.data.sessions_revoked >= 2);
    assert.equal((await api('/auth/me', { token: admin.token })).status, 401);
    assert.equal((await api('/auth/me', { token: secondAdminDevice.token })).status, 401);
    assert.equal((await api('/admin/impersonation', { method: 'DELETE', token: impersonatedToken })).status, 401);
    assert.equal((await api('/auth/me', { token: cashier.token })).status, 200);
  } finally {
    db.close();
  }
});

test('member and operator notifications are scoped, deduplicated, configurable and streamable', async () => {
  const logIn = async (email: string) => {
    const response = await api<{ token: string }>('/auth/login', {
      method: 'POST', body: { email, password: 'Argivit2026!' },
    });
    assert.equal(response.status, 200);
    return response.json.data.token;
  };
  const member = await logIn('mateo@argivitstore.com');
  const manager = await logIn('manager@argivitstore.com');
  const admin = await logIn('admin@argivitstore.com');
  type Inbox = { items: Array<{ id: string; title: string }>; unread: number; preferences: Record<string, boolean>; stream_enabled: boolean };
  const inbox = (token: string) => api<Inbox>('/notifications', { token });
  assert.equal((await api('/notifications')).status, 401);
  assert.equal((await api('/notifications/events')).status, 401);
  const aboutMember = (await inbox(member)).json.data;
  const notice = aboutMember.items.find((item) => item.title === 'Membership review updated' || item.title === 'Loan application reviewed');
  assert.ok(notice);
  assert.equal(aboutMember.stream_enabled, true);
  assert.equal((await api('/notifications/' + notice.id, { method: 'DELETE', token: manager })).status, 200);
  assert.ok((await inbox(member)).json.data.items.some((item) => item.id === notice.id));
  assert.ok(!(await inbox(manager)).json.data.items.some((item) => item.id === notice.id));
  assert.equal((await api('/notifications/read-all', { method: 'POST', token: member })).status, 200);
  assert.equal((await inbox(member)).json.data.unread, 0);
  assert.equal((await api('/notifications/' + notice.id, { method: 'DELETE', token: member })).status, 200);
  assert.ok(!(await inbox(member)).json.data.items.some((item) => item.id === notice.id));

  const prefs = await api('/notifications/preferences', { method: 'PATCH', token: manager, body: { kind: 'warning', enabled: false } });
  assert.equal(prefs.status, 200);
  assert.equal((await inbox(manager)).json.data.preferences.warning, false);

  const db = new DatabaseSync(database);
  try {
    db.prepare("UPDATE inventory_balances SET quantity_base = 0 WHERE product_id = 'prod-1'").run();
    for (let iteration = 0; iteration < 2; iteration++) {
      const scheduled = spawnSync('php', ['artisan', 'argivit:notifications', '--no-ansi'], {
        cwd: backendDir, env, encoding: 'utf8', windowsHide: true,
      });
      assert.equal(scheduled.status, 0, scheduled.stdout || scheduled.stderr);
    }
    assert.equal((await inbox(admin)).json.data.items.filter((item) => item.title === 'Products out of stock').length, 1);
    assert.equal((await inbox(manager)).json.data.items.filter((item) => item.title === 'Products out of stock').length, 0);
  } finally {
    db.close();
  }

  const live = await fetch(baseUrl + '/api/v1/notifications/events', {
    headers: { Authorization: 'Bearer ' + admin, Accept: 'text/event-stream' }, signal: AbortSignal.timeout(24_000),
  });
  assert.equal(live.status, 200);
  assert.match(live.headers.get('Content-Type') ?? '', /^text\/event-stream/);
  const reader = live.body!.getReader();
  try {
    let frame = '';
    while (!frame.includes('\n\n')) {
      const next = await reader.read();
      if (next.done) break;
      frame += Buffer.from(next.value).toString('utf8');
    }
    assert.match(frame, /^data: /);
    const snapshot = JSON.parse(frame.split('\n\n')[0].slice(6)) as Inbox;
    assert.ok(snapshot.items.some((item) => item.title === 'Products out of stock'));
  } finally {
    await reader.cancel();
  }
});
