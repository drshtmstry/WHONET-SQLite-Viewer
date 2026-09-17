// Pass-through Service Worker for PWA installability (NO CACHE)
// Immediately cleans up any existing caches to ensure fresh network fetches every time.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    }).then(() => self.clients.claim())
  );
});

// Always fetch directly from network without caching
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
