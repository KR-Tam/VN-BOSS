// VN Boss service worker — network-only passthrough.
// Intentionally does NOT cache anything so that HTML/JS updates are always
// fetched fresh (avoids stale content in in-app browsers). Its only job is to
// satisfy the installability requirement for "Add to Home Screen" / desktop install.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
