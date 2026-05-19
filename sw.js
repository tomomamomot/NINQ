const CACHE = 'ninq-v63';
const ENHANCEMENT_SCRIPTS = [
  '<script src="brand.js?v=35"></script>',
  '<script src="calendar-layout.js?v=25"></script>',
  '<script src="range-entries.js?v=28"></script>',
  '<script src="calendar-connections.js?v=37"></script>',
  '<script src="navigation-controls.js?v=37"></script>',
  '<script src="ui-preferences.js?v=21"></script>',
];
const ASSETS = ['./', './index.html', './styles.css?v=32', './app.js?v=38', './brand.js?v=35', './calendar-layout.js?v=25', './range-entries.js?v=28', './calendar-connections.js?v=37', './navigation-controls.js?v=37', './ui-preferences.js?v=21', './manifest.json?v=35', './ninq-logo.svg?v=34', './icon-192.png?v=34', './icon-512.png?v=34', './apple-touch-icon.png?v=34'];

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

function shouldInjectEnhancements(request) {
  if (request.mode !== 'navigate') return false;
  const url = new URL(request.url);
  return url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
}

function injectEnhancements(html) {
  const scripts = ENHANCEMENT_SCRIPTS.filter((script) => !html.includes(script.match(/src="([^"]+)/)?.[1] || ''));
  return scripts.length ? html.replace('</body>', `${scripts.join('\n')}\n</body>`) : html;
}

async function htmlResponseWithEnhancements(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    const html = injectEnhancements(await response.clone().text());
    const injected = new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
    cache.put(request, injected.clone());
    return injected;
  } catch (error) {
    const cached = await cache.match(request) || await cache.match('./index.html');
    if (!cached) throw error;
    const html = injectEnhancements(await cached.clone().text());
    return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  if (shouldInjectEnhancements(event.request)) {
    event.respondWith(htmlResponseWithEnhancements(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
  );
});
