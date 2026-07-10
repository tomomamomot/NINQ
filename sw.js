const CACHE = 'ninq-v149';
const ASSETS = ['./', './index.html', './styles.css?v=84', './app.js?v=122', './firebase-sync.js?v=2', './brand.js?v=35', './calendar-layout.js?v=28', './range-entries.js?v=28', './calendar-connections.js?v=51', './navigation-controls.js?v=38', './settings-polish.js?v=2', './manifest.json?v=35', './ninq-logo.svg?v=34', './ninq-wordmark.svg?v=2', './icon-192.png?v=34', './icon-512.png?v=34', './apple-touch-icon.png?v=34'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      })
  );
});
