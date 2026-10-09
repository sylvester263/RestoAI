/**
 * RestoAI Service Worker (impl-33 Part 4: offline POS shell)
 *
 *  • App shell (any page navigation) → network-first. Every successful load
 *    saves the fresh index.html as the shell, caches the JS/CSS it references
 *    and drops cached JS/CSS it no longer references — so a device that was
 *    online once always has a complete, current shell, and a new deploy
 *    replaces the old one on the next online load (no stale shell).
 *  • /assets/* (content-hashed, immutable) → cache-first.
 *  • Google Fonts → stale-while-revalidate.
 *  • /api/* → never touched. Authenticated API responses are not cached here
 *    (a shared till must not serve one person's data to the next); the offline
 *    POS keeps its menu, prices and tables in IndexedDB instead.
 *  • Push notifications → unchanged.
 *
 * Bump SW_VERSION when this file's caching logic changes; the new worker
 * takes over immediately (skipWaiting + clients.claim) and old caches go.
 */
const SW_VERSION = 'restoai-v3';
const SHELL_CACHE = `shell-${SW_VERSION}`;
const STATIC_CACHE = `static-${SW_VERSION}`;
const FONT_CACHE = `fonts-${SW_VERSION}`;
const SHELL_KEY = '/__app-shell';

self.addEventListener('install', (event) => {
  event.waitUntil(
    refreshShell()
      .catch(() => { /* offline at install: the next online load fills it */ })
      .then(() => caches.open(STATIC_CACHE))
      .then((cache) => cache.addAll(['/offline.html']).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const keep = [SHELL_CACHE, STATIC_CACHE, FONT_CACHE];
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => !keep.includes(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // network only, never cached

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
  }
});

const assetUrls = (html) => [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))];

/** Save `html` as the shell, cache its assets, drop JS/CSS it no longer uses. */
async function storeShell(html, headers) {
  const assets = assetUrls(html);
  const staticCache = await caches.open(STATIC_CACHE);
  await Promise.all(assets.map(async (a) => {
    if (!(await staticCache.match(a))) {
      const res = await fetch(a);
      if (res.ok) await staticCache.put(a, res);
    }
  }));
  const keep = new Set(assets.map((a) => new URL(a, self.location.origin).href));
  for (const req of await staticCache.keys()) {
    if (/\/assets\/.+\.(js|css)$/.test(new URL(req.url).pathname) && !keep.has(req.url)) await staticCache.delete(req);
  }
  const shellCache = await caches.open(SHELL_CACHE);
  await shellCache.put(SHELL_KEY, new Response(html, { headers: { 'Content-Type': headers.get('Content-Type') || 'text/html' } }));
}

async function refreshShell() {
  const res = await fetch('/index.html', { cache: 'no-store' });
  if (res.ok) await storeShell(await res.text(), res.headers);
}

async function navigate(request) {
  try {
    const fresh = await fetch(request);
    const type = fresh.headers.get('Content-Type') || '';
    if (fresh.ok && type.includes('text/html')) {
      const copy = fresh.clone();
      copy.text().then((html) => storeShell(html, copy.headers)).catch(() => {});
    }
    return fresh;
  } catch {
    const shell = await caches.match(SHELL_KEY);
    if (shell) return shell;
    const offline = await caches.match('/offline.html');
    return offline || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || fetchPromise;
}

// ── Push notifications ──
self.addEventListener('push', (event) => {
  let data = { title: 'RestoAI', body: 'You have a new update.' };
  try {
    data = event.data.json();
  } catch {
    // ignore malformed payloads
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'RestoAI', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [100, 50, 100],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.includes(target)) return client.focus();
        }
        return self.clients.openWindow(target);
      }),
  );
});
