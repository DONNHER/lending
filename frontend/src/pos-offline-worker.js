const PREFIX = 'argivit-pos-shell-';
const CACHE = PREFIX + VERSION;
const assetPaths = new Set(ASSETS.slice(1));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) =>
    cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))
  ));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { signal: AbortSignal.timeout(4000) });
        if (response.ok || response.status < 500) return response;
      } catch {
        // The previously installed shell remains available during an outage.
      }
      return (await (await caches.open(CACHE)).match('/')) ?? Response.error();
    })());
  } else if (assetPaths.has(url.pathname)) {
    event.respondWith((async () => (await (await caches.open(CACHE)).match(url.pathname)) ?? fetch(request))());
  }
});
