import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const backend = path.resolve(import.meta.dirname, '..');

test('Laravel emails one-time codes before issuing login and registration sessions', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'argivit-mfa-test-'));
  const database = path.join(directory, 'mfa.sqlite');
  fs.closeSync(fs.openSync(database, 'wx'));
  const inbox: Array<{ recipient: string; body: string }> = [];
  let rejectDelivery = false;
  const smtp = createServer((socket) => {
    let buffer = '';
    let recipient = '';
    let lines: string[] | null = null;
    socket.on('error', () => {});
    socket.write('220 Local SMTP test\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const received = buffer.split('\r\n');
      buffer = received.pop() ?? '';
      for (const line of received) {
        if (lines) {
          if (line !== '.') {
            lines.push(line);
            continue;
          }
          if (!rejectDelivery) inbox.push({ recipient, body: lines.join('\n') });
          lines = null;
          socket.write(rejectDelivery ? '451 Delivery failed\r\n' : '250 Accepted\r\n');
        } else if (/^EHLO |^HELO |^MAIL FROM:/i.test(line)) {
          socket.write('250 OK\r\n');
        } else if (/^RCPT TO:/i.test(line)) {
          recipient = line;
          socket.write('250 OK\r\n');
        } else if (line === 'DATA') {
          lines = [];
          socket.write('354 Send message\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 Closing\r\n');
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  });

  smtp.listen(0, '127.0.0.1');
  await once(smtp, 'listening');
  const env = {
    ...process.env, APP_ENV: 'testing', APP_DEBUG: 'false', DB_CONNECTION: 'sqlite', DB_SQLITE_DATABASE: database,
    DB_URL: '', DATABASE_URL: '', AUTH_BASE_URL: 'https://unused.example.test/auth', AUTH_JWKS_URL: 'https://unused.example.test/jwks',
    JWT_SECRET: 'argivit-mfa-test-only-key-with-at-least-32-bytes',
    ARGIVIT_EMAIL_MFA: 'true', ARGIVIT_ALLOW_DEMO_AUTH: 'true', MAIL_SCHEME: 'smtp', MAIL_HOST: '127.0.0.1',
    MAIL_PORT: String((smtp.address() as AddressInfo).port), MAIL_USERNAME: '', MAIL_PASSWORD: '',
    MAIL_REQUIRE_TLS: 'false', MAIL_FROM_ADDRESS: 'argivit@example.test', ARGIVIT_WEB_URL: 'https://argivit.example.test',
  };
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const { port } = reservation.address() as AddressInfo;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const base = `http://127.0.0.1:${port}/api/v1`;
  const setup = spawnSync('php', ['artisan', 'migrate', '--force', '--seed', '--seeder=DemoSeeder'], { cwd: backend, env, encoding: 'utf8', windowsHide: true });
  assert.equal(setup.status, 0, setup.stdout || setup.stderr);
  const api = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', 'public', 'public/index.php'], { cwd: backend, env, stdio: 'ignore', windowsHide: true });

  const request = async (endpoint: string, body?: object, token?: string, method = body ? 'POST' : 'GET') => {
    const response = await fetch(base + endpoint, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(6500),
    });
    return { status: response.status, data: (await response.json()).data };
  };
  const password = 'Argivit2026!';
  const login = (email: string, submittedPassword = password) => request('/auth/login', { email, password: submittedPassword });
  const verify = (id: string, code: string) => request('/auth/mfa/verify', { challenge_id: id, code });
  const codeFromLastEmail = (email: string) => {
    const message = inbox.at(-1);
    assert.ok(message?.recipient.includes(email));
    const code = message!.body.match(/code(?: for email MFA)? is (\d{6})/)?.[1];
    assert.ok(code);
    return code;
  };
  const wrongCode = (code: string) => code === '000000' ? '111111' : '000000';

  try {
    for (let attempt = 0; ; attempt++) {
      try {
        assert.equal((await request('/health')).status, 200);
        break;
      } catch (error) {
        if (attempt === 49) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    assert.equal((await request('/auth/config')).data.auth_url, null);
    const managerEmail = 'manager@argivitstore.com';
    const first = await login(managerEmail);
    assert.equal(first.status, 202);
    assert.equal(first.data.mfa_required, true);
    assert.equal(first.data.token, undefined);
    assert.equal(first.data.code, undefined);
    assert.equal(first.data.expires_in, 300);
    const code = codeFromLastEmail(managerEmail);
    const id = first.data.challenge_id;
    assert.equal((await login(managerEmail)).status, 429);
    assert.equal(inbox.length, 1);
    assert.equal((await verify(id, wrongCode(code))).status, 422);

    const verified = await verify(id, code);
    assert.equal(verified.status, 200);
    assert.equal(verified.data.user.role, 'manager');
    assert.equal((await request('/auth/me', undefined, verified.data.token)).status, 200);
    assert.equal((await verify(id, code)).status, 422);

    const next = await login(managerEmail);
    const nextCode = codeFromLastEmail(managerEmail);
    for (let attempt = 1; attempt <= 5; attempt++) {
      assert.equal((await verify(next.data.challenge_id, wrongCode(nextCode))).status, attempt === 5 ? 429 : 422);
    }
    assert.equal((await verify(next.data.challenge_id, nextCode)).status, 429);

    const memberEmail = 'mfa-member@example.test';
    const registration = await request('/auth/register', { email: memberEmail, password, first_name: 'Sample', last_name: 'Member' });
    assert.equal(registration.status, 202);
    assert.equal(registration.data.token, undefined);
    const registrationCode = codeFromLastEmail(memberEmail);
    const member = await verify(registration.data.challenge_id, registrationCode);
    assert.equal(member.data.user.role, 'shareholder');
    assert.equal((await request('/auth/register', { email: 'weak@example.test', password: 'password', first_name: 'Sample', last_name: 'Member' })).status, 422);
    assert.equal((await request('/auth/synchronize', { auth_user_id: 'demo', email: 'sync@example.test', name: 'Sample' })).status, 503);

    const expiring = await login('mateo@argivitstore.com');
    const expiringCode = codeFromLastEmail('mateo@argivitstore.com');
    const sqlite = new DatabaseSync(database);
    try {
      const digest = sqlite.prepare('SELECT code_digest FROM email_mfa_challenges WHERE id = ?').get(expiring.data.challenge_id)?.code_digest;
      assert.equal(typeof digest === 'string' && digest.length === 64 && digest !== expiringCode, true);
      sqlite.prepare('UPDATE email_mfa_challenges SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00Z', expiring.data.challenge_id);
    } finally {
      sqlite.close();
    }
    assert.equal((await verify(expiring.data.challenge_id, expiringCode)).status, 422);

    const cashierEmail = 'cashier@argivitstore.com';
    for (let attempt = 1; attempt <= 5; attempt++) {
      const email = attempt % 2 === 0 ? cashierEmail.toUpperCase() : cashierEmail;
      assert.equal((await login(email, 'invalid-test-password')).status, attempt === 5 ? 429 : 401);
    }
    assert.equal((await login(cashierEmail)).status, 429);
    const auditDatabase = new DatabaseSync(database);
    try {
      const denied = auditDatabase.prepare("SELECT metadata_json FROM audit_logs WHERE actor_id = 'usr-cashier' AND action = 'auth.password_failed'").all();
      assert.equal(denied.length, 5);
      assert.ok(denied.every(({ metadata_json }) => JSON.parse(String(metadata_json)).ip === '127.0.0.1'));
      assert.equal(auditDatabase.prepare("SELECT count(*) AS total FROM audit_logs WHERE actor_id = 'usr-cashier' AND action = 'auth.suspicious_activity'").get()?.total, 1);
      const attempt = auditDatabase.prepare('SELECT account_digest FROM sign_in_attempts').get();
      assert.match(String(attempt?.account_digest), /^[a-f0-9]{64}$/);
      auditDatabase.prepare('UPDATE sign_in_attempts SET expires_at = 0 WHERE account_digest = ?').run(String(attempt?.account_digest));
    } finally {
      auditDatabase.close();
    }
    const adminEmail = 'admin@argivitstore.com';
    const adminLogin = await login(adminEmail);
    assert.equal(adminLogin.status, 202);
    const admin = await verify(adminLogin.data.challenge_id, codeFromLastEmail(adminEmail));
    assert.equal(admin.data.user.role, 'admin');
    const settingsPath = '/admin/security/email-mfa';
    assert.equal((await request(settingsPath, undefined, verified.data.token)).status, 403);
    assert.equal((await request(settingsPath + '/challenge', { enabled: false, password }, verified.data.token)).status, 403);
    assert.deepEqual((await request(settingsPath, undefined, admin.data.token)).data, { enabled: true, can_configure: true });

    const disable = await request(settingsPath + '/challenge', { enabled: false, password }, admin.data.token);
    assert.equal(disable.status, 202);
    const disablingCode = codeFromLastEmail(adminEmail);
    assert.equal((await verify(disable.data.challenge_id, disablingCode)).status, 422);
    const changed = await request(settingsPath, { enabled: false, challenge_id: disable.data.challenge_id, code: disablingCode }, admin.data.token, 'PATCH');
    assert.deepEqual(changed.data, { enabled: false, can_configure: true });
    assert.equal((await request(settingsPath, { enabled: false, challenge_id: disable.data.challenge_id, code: disablingCode }, admin.data.token, 'PATCH')).status, 422);
    assert.equal((await login('rosa@argivitstore.com')).status, 200);

    const enable = await request(settingsPath + '/challenge', { enabled: true, password }, admin.data.token);
    assert.equal(enable.status, 202);
    const enablingCode = codeFromLastEmail(adminEmail);
    const enabled = await request(settingsPath, { enabled: true, challenge_id: enable.data.challenge_id, code: enablingCode }, admin.data.token, 'PATCH');
    assert.deepEqual(enabled.data, { enabled: true, can_configure: true });
    const rosaMfa = await login('rosa@argivitstore.com');
    assert.equal(rosaMfa.status, 202);
    assert.equal(rosaMfa.data.token, undefined);

    const recoveryDb = new DatabaseSync(database);
    const openLink = async (inboxLength: number) => {
      for (let attempt = 0; inbox.length === inboxLength && attempt < 50; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const mail = inbox.at(-1);
      assert.ok(mail?.recipient.includes(memberEmail));
      const link = mail!.body.replace(/=\n/g, '').replace(/=3D/g, '=');
      const token = link.match(/https:\/\/argivit\.example\.test\/#reset-password=([0-9a-f]{64})/)?.[1];
      assert.ok(token);
      return token;
    };
    try {
      recoveryDb.prepare("DELETE FROM api_rate_limits WHERE tier = 'auth'").run();
      const inboxBefore = inbox.length;
      const forgot = await request('/auth/password/forgot', { email: memberEmail });
      const unknown = await request('/auth/password/forgot', { email: 'unknown-reset@example.test' });
      assert.deepEqual(forgot, unknown);
      assert.equal(forgot.status, 202);
      const expiredLink = await openLink(inboxBefore);
      assert.equal(inbox.length, inboxBefore + 1);
      const row = recoveryDb.prepare('SELECT token_digest FROM password_reset_requests WHERE user_id = ?').get(member.data.user.id);
      assert.equal(typeof row?.token_digest === 'string' && row.token_digest.length === 64 && row.token_digest !== expiredLink, true);
      recoveryDb.prepare('UPDATE password_reset_requests SET expires_at = 0, requested_at = 0 WHERE user_id = ?').run(member.data.user.id);
      const newPassword = 'Updated2026!';
      const reset = (token: string) => request('/auth/password/reset', {
        token, password: newPassword, password_confirmation: newPassword,
      });
      assert.equal((await reset(expiredLink)).status, 422);

      const adminReset = '/admin/users/' + member.data.user.id + '/password-reset';
      assert.equal((await request(adminReset, {}, verified.data.token)).status, 403);
      const beforeAdminMail = inbox.length;
      assert.equal((await request(adminReset, {}, admin.data.token)).status, 202);
      const token = await openLink(beforeAdminMail);
      assert.notEqual(token, expiredLink);
      assert.equal((await reset(token)).status, 200);
      assert.equal((await reset(token)).status, 422);
      assert.equal((await request('/auth/me', undefined, member.data.token)).status, 401);
      assert.equal((await login(memberEmail)).status, 401);
      const remembered = await request('/auth/login', { email: memberEmail, password: newPassword, remember: false });
      assert.equal(remembered.status, 202);
      const signedInAgain = await verify(remembered.data.challenge_id, codeFromLastEmail(memberEmail));
      assert.equal(signedInAgain.status, 200);
      assert.equal(signedInAgain.data.session.remembered, false);
    } finally {
      recoveryDb.close();
    }

    rejectDelivery = true;
    const failed = await login(cashierEmail);
    assert.equal(failed.status, 503);
    assert.equal(failed.data?.token, undefined);
  } finally {
    if (api.exitCode === null && api.signalCode === null) {
      const exited = once(api, 'exit');
      api.kill();
      await exited;
    }
    await new Promise<void>((resolve) => smtp.close(() => resolve()));
    for (const filename of ['mfa.sqlite', 'mfa.sqlite-shm', 'mfa.sqlite-wal']) {
      const file = path.join(directory, filename);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.rmdirSync(directory);
  }
});
