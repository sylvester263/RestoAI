/**
 * impl-33 Part 4: register the service worker that keeps the POS shell
 * available offline (production builds only — Vite's dev server serves
 * unhashed modules that must not be cached).
 *
 * A new worker takes over by itself (skipWaiting); the page then fires
 * `app-update-ready` so the UI can offer a reload. Offline sales live in
 * IndexedDB, so reloading never loses anything.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // First install isn't an "update"; only a replaced worker is.
    if (hadController) window.dispatchEvent(new Event('app-update-ready'));
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
    }).catch((err) => console.warn('[sw] registration failed:', err.message));
  });
}
