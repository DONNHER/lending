const http = require('node:http');
const { existsSync, statSync, createReadStream } = require('node:fs');
const { extname, resolve, sep } = require('node:path');
const { Readable, pipeline } = require('node:stream');

const ORIGIN = 'http://localhost:14783';
const EMPTY_METHODS = new Set(['GET', 'HEAD']);
const API_METHODS = new Set(['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
};
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com", "img-src 'self' data: blob: https:",
  "connect-src 'self' https:", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'",
].join('; ');

function normalizeApiOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter the Laravel server URL.');
  }
  const [first, second] = url.hostname.split('.').map(Number);
  const privateIpv4 = /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)
    && (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || first === 127);
  const local = privateIpv4 || ['localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (local && (url.port === '14783' || url.origin === ORIGIN))) {
    throw new Error('Use an HTTPS server origin or the private LAN HTTP address of your Laravel server.');
  }
  return url.origin;
}

async function verifyApiOrigin(value) {
  const origin = normalizeApiOrigin(value);
  const response = await fetch(`${origin}/api/v1/health`, { signal: AbortSignal.timeout(6000), redirect: 'error' });
  const body = response.ok && await response.json();
  if (!body || body.success !== true || body.status !== 'online') {
    throw new Error('This server did not respond as a running Agrivit API.');
  }
  return origin;
}

function json(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ success: false, message }));
}

async function proxyApi(request, response, path, getApiOrigin) {
  const config = getApiOrigin();
  if (!config) return json(response, 503, 'Configure the Laravel server in the cashier app.');
  const headers = new Headers({ Accept: 'application/json' });
  for (const name of ['authorization', 'content-type', 'content-length', 'accept', 'range']) {
    if (typeof request.headers[name] === 'string') headers.set(name, request.headers[name]);
  }
  const controller = new AbortController();
  response.on('close', () => controller.abort());
  try {
    const upstream = await fetch(`${config}${path}`, {
      method: request.method, headers, redirect: 'error',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      ...(EMPTY_METHODS.has(request.method) ? {} : { body: request, duplex: 'half' }),
    });
    const outgoing = { 'Cache-Control': 'no-store' };
    for (const name of ['content-type', 'content-disposition', 'content-range', 'accept-ranges', 'retry-after']) {
      const value = upstream.headers.get(name);
      if (value) outgoing[name] = value;
    }
    response.writeHead(upstream.status, outgoing);
    if (!upstream.body) return response.end();
    pipeline(Readable.fromWeb(upstream.body), response, () => {});
  } catch {
    if (!response.destroyed && !response.headersSent) json(response, 503, 'The configured server is unreachable.');
  }
}

function openLoopback({ dist, desktopPath, getApiOrigin }) {
  const server = http.createServer(async (request, response) => {
    response.setHeader('Content-Security-Policy', CSP);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (request.headers.host !== 'localhost:14783' || !request.url?.startsWith('/') || request.url.startsWith('//')) {
      return json(response, 403, 'Requests must come from the local cashier app.');
    }
    const target = new URL(request.url, ORIGIN);
    if (target.origin !== ORIGIN) return json(response, 403, 'Invalid app request origin.');
    if (target.pathname.startsWith('/api/v1/')) {
      // Only the app renderer can use the loopback API relay from a browser.
      if (!API_METHODS.has(request.method) ||
          (!EMPTY_METHODS.has(request.method) && request.headers.origin !== ORIGIN) ||
          (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')) {
        return json(response, 403, 'Requests must come from the local cashier app.');
      }
      return proxyApi(request, response, target.pathname + target.search, getApiOrigin);
    }
    if (!EMPTY_METHODS.has(request.method)) return json(response, 405, 'Method not allowed.');
    let relative;
    try {
      relative = decodeURIComponent(target.pathname === '/' ? '/index.html' : target.pathname);
    } catch {
      return json(response, 400, 'Invalid asset path.');
    }
    const setup = ['/setup.html', '/setup.js', '/setup.css'].includes(relative);
    const directory = setup ? desktopPath : dist;
    const file = resolve(directory, `.${relative}`);
    if (!file.startsWith(directory + sep) || !existsSync(file) || !statSync(file).isFile()) {
      return json(response, 404, 'The requested local asset was not found.');
    }
    response.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
    response.setHeader('Content-Length', statSync(file).size);
    if (request.method === 'HEAD') return response.end();
    pipeline(createReadStream(file), response, () => {});
  });

  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(14783, '127.0.0.1', () => resolveServer(server));
  });
}

module.exports = { ORIGIN, normalizeApiOrigin, verifyApiOrigin, openLoopback };
