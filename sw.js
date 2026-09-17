const CACHE = 'ninq-v182';
const ASSETS = ['./', './index.html', './styles.css?v=97', './data-core.js?v=3', './app.js?v=155', './safety-ui.js?v=3', './firebase-sync.js?v=5', './brand.js?v=35', './calendar-layout.js?v=28', './range-entries.js?v=28', './calendar-connections.js?v=51', './navigation-controls.js?v=42', './settings-polish.js?v=2', './manifest.json?v=35', './ninq-logo.svg?v=34', './ninq-wordmark.svg?v=2', './icon-192.png?v=34', './icon-512.png?v=34', './apple-touch-icon.png?v=34'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('ninq-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const basePath = new URL('./', self.location.href).pathname;
  if (event.request.mode === 'navigate' && ![basePath, `${basePath}index.html`].includes(url.pathname)) return;
  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const asset = event.request.mode === 'navigate' ? './index.html' : event.request;
      const cached = await cache.match(asset);
      if (cached) return cached;
      return fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        if (response.ok) event.waitUntil(cache.put(event.request, copy));
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});
