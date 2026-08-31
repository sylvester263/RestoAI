/**
 * RestoAI Service Worker
 *
 * Caching strategies:
 *  • Static assets (JS/CSS/fonts) → Cache-first with versioned cache name
 *  • Google Fonts       → Stale-while-revalidate (fonts rarely change)
 *  • API calls          → Network-first with short cache fallback (offline resilience)
 *  • Navigation (HTML)  → Network-first, serve offline shell on failure
 *  • Push notifications → handled here (see push + notificationclick below)
 *
 * The cache version string below is bumped on each deploy so old caches
 * are cleaned up automatically in the `activate` step.
 */

const CACHE_VERSION = 'restoai-v2';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const FONT_CACHE = `fonts-${CACHE_VERSION}`;
const API_CACHE = `api-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  '/offline.html',
];

// ── Install: pre-cache the offline shell ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: purge old caches ──
self.addEventListener('activate', (event) => {
  const keep = [STATIC_CACHE, FONT_CACHE, API_CACHE];
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => !keep.includes(n)).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: strategy per request type ──
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Static JS/CSS bundles → cache-first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Google Fonts CSS + font files → stale-while-revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  // API calls → network-first, fallback to stale cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, API_CACHE, 60 * 1000));
    return;
  }

  // Navigation (HTML pages) → network-first, serve offline shell
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }
});

// ── Strategy helpers ──

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

async function networkFirst(request, cacheName, maxAge = 0) {
  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Navigation fallback → offline shell
    if (request.mode === 'navigate') {
      const shell = await caches.match('/offline.html');
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
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
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Focus an existing tab if possible
        for (const client of clients) {
          if (client.url.includes(target)) return client.focus();
        }
        // Otherwise open a new one
        return self.clients.openWindow(target);
      })
  );
});
