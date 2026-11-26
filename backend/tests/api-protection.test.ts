import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('API caps mixed traffic per IP and sends security headers on errors and HTTPS responses', () => {
  const backendDir = path.resolve(import.meta.dirname, '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'argivit-api-protection-'));
  const database = path.join(tempDir, 'protection.sqlite');
  const env = {
    ...process.env,
    APP_ENV: 'production',
    APP_DEBUG: 'false',
    DB_CONNECTION: 'sqlite',
    DB_SQLITE_DATABASE: database,
    DB_URL: '',
    DATABASE_URL: '',
    AUTH_BASE_URL: '',
    AUTH_JWKS_URL: '',
    CACHE_STORE: 'array',
    ARGIVIT_EMAIL_MFA: 'false',
    ARGIVIT_TEST_API_REQUESTS_PER_MINUTE: '1000',
  };
  const php = (args: string[]) => {
    const result = spawnSync('php', args, { cwd: backendDir, env, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    return result.stdout;
  };

  try {
    fs.closeSync(fs.openSync(database, 'wx'));
    php(['artisan', 'migrate', '--force']);
    const results = JSON.parse(php(['-r', String.raw`
      require 'vendor/autoload.php';
      $app = require 'bootstrap/app.php';
      $kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
      Carbon\CarbonImmutable::setTestNow('2026-01-01T00:00:15Z');

      function api($endpoint, $method = 'GET', $ip = '192.0.2.10', $scheme = 'http', $forwardedProto = '') {
          global $kernel;
          $request = Illuminate\Http\Request::create(
              $scheme.'://example.test/api/v1'.$endpoint, $method, server: [
                  'HTTP_ACCEPT' => 'application/json',
                  'CONTENT_TYPE' => 'application/json',
                  'REMOTE_ADDR' => $ip,
                  'HTTP_X_FORWARDED_PROTO' => $forwardedProto,
              ], content: '{}'
          );
          $response = $kernel->handle($request);
          $headers = $response->headers;
          $kernel->terminate($request, $response);

          return [
              'status' => $response->getStatusCode(),
              'limit' => $headers->get('X-RateLimit-Limit'),
              'remaining' => $headers->get('X-RateLimit-Remaining'),
              'tier' => $headers->get('X-RateLimit-Tier'),
              'retry' => $headers->get('Retry-After'),
              'csp' => $headers->get('Content-Security-Policy'),
              'frame' => $headers->get('X-Frame-Options'),
              'content' => $headers->get('X-Content-Type-Options'),
              'hsts' => $headers->get('Strict-Transport-Security'),
          ];
      }

      $result = [];
      for ($attempt = 1; $attempt <= 40; $attempt++) {
          $result['beforeAuthCap'] = api('/auth/login', 'POST');
      }
      $result['authCap'] = api('/auth/login', 'POST');

      for ($attempt = 42; $attempt < 100; $attempt++) {
          $result['health'] = api('/health');
      }
      $result['beforeGlobalCap'] = api('/admin/governance');
      $result['globalCap'] = api('/health');
      $result['otherIp'] = api('/health', ip: '192.0.2.11', scheme: 'https');
      $result['spoofedHttps'] = api('/health', ip: '192.0.2.12', forwardedProto: 'https');
      $result['notFound'] = api('/missing');
      $result['limits'] = App\Http\Middleware\ApiRateLimit::telemetry();

      Carbon\CarbonImmutable::setTestNow('2026-01-01T00:01:00Z');
      $result['nextMinute'] = api('/health');
      echo json_encode($result, JSON_THROW_ON_ERROR);
    `]));

    assert.equal(results.beforeAuthCap.status, 422);
    assert.equal(results.beforeAuthCap.limit, '40');
    assert.equal(results.beforeAuthCap.remaining, '0');
    assert.equal(results.authCap.status, 429);
    assert.equal(results.authCap.tier, 'auth');
    assert.equal(results.authCap.retry, '45');
    assert.equal(results.health.status, 200);
    assert.equal(results.beforeGlobalCap.status, 401);
    assert.equal(results.beforeGlobalCap.tier, 'admin');
    assert.equal(results.beforeGlobalCap.remaining, '0');
    assert.equal(results.globalCap.status, 429);
    assert.equal(results.globalCap.tier, 'global');
    assert.equal(results.globalCap.limit, '100');
    assert.equal(results.globalCap.retry, '45');
    assert.equal(results.otherIp.status, 200);
    assert.equal(results.otherIp.remaining, '99');
    assert.equal(results.otherIp.hsts, 'max-age=31536000');
    assert.equal(results.spoofedHttps.hsts, null);
    assert.equal(results.notFound.status, 404);
    assert.equal(results.nextMinute.status, 200);
    assert.equal(results.nextMinute.remaining, '99');

    for (const response of [results.health, results.authCap, results.globalCap, results.notFound, results.otherIp]) {
      assert.match(response.csp, /default-src 'none'/);
      assert.match(response.csp, /frame-ancestors 'none'/);
      assert.equal(response.frame, 'DENY');
      assert.equal(response.content, 'nosniff');
    }

    const tiers = Object.fromEntries(results.limits.tiers.map(
      (tier: { tier: string; limit_per_min: number }) => [tier.tier, tier.limit_per_min],
    ));
    assert.deepEqual(tiers, { global: 100, auth: 40, public: 100, standard: 100, admin: 100 });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
