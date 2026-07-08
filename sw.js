// VN Boss service worker — SELF-UNREGISTERING KILL SWITCH.
// The previous passthrough service worker intercepted every fetch and broke
// cross-origin API calls (news failed to load) plus caused intermittent access
// problems. This version does the opposite: it unregisters itself, clears any
// caches, and reloads controlled pages, so existing installs are cleaned up.
// It has NO fetch handler, so it never intercepts network requests.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch (error) {}
    try {
      await self.registration.unregister();
    } catch (error) {}
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => client.navigate(client.url));
    } catch (error) {}
  })());
});
