const CACHE_VERSION = 'satcontact-v3';
const RUNTIME_CACHE = 'satcontact-runtime';

const PRECACHE_URLS = [
  './',
  'style.css',
  'utils.js',
  'app.js',
  'tle.js',
  'tle-worker.js',
  'gps-service.js',
  'map.js',
  'map-render.js',
  'ar.js',
  'ar-render.js',
  'news.js',
  'lib/satellite.min.js',
  'lib/d3.min.js',
  'lib/topojson.min.js',
  'lib/aws4fetch.min.js',
  'data/Frequencies.xml',
  'data/countries-50m.json',
  'data/board-media/ava.jpg',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png'
];

self.addEventListener('install', (event) => {
  var boardUrl = new URL('data/board.html', self.location).href;
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.addAll(
        PRECACHE_URLS.map(url => new Request(url, { cache: 'reload' }))
      );
    }).then(function () {
      return caches.open(RUNTIME_CACHE).then(function (cache) {
        return fetch(boardUrl, { cache: 'no-store' })
          .then(function (res) {
            if (res.ok) return cache.put(new Request(boardUrl), res);
          })
          .catch(function () {});
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names
          .filter((name) => name !== CACHE_VERSION && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/data/board.html')) {
    event.respondWith(handleBoardFetch(event.request));
    return;
  }

  if (url.pathname.endsWith('/data/tle.txt')) {
    event.respondWith(networkFirst(event.request, RUNTIME_CACHE));
    return;
  }

  if (url.pathname.includes('/data/board-media/')) {
    event.respondWith(networkFirst(event.request, RUNTIME_CACHE));
    return;
  }

  if (url.pathname.endsWith('/data/Frequencies.xml')) {
    event.respondWith(networkFirst(event.request, RUNTIME_CACHE));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});

async function handleBoardFetch(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cacheKey = new Request(request.url.split('?')[0], { method: 'GET' });
  try {
    const bustUrl = request.url.split('?')[0] + '?_=' + Date.now();
    const networkResponse = await fetch(bustUrl, { cache: 'no-store' });
    if (networkResponse.ok) {
      const newHtml = await networkResponse.clone().text();
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        const oldHtml = await cachedResponse.text();
        if (oldHtml !== newHtml) {
          const allClients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
          allClients.forEach(client => {
            client.postMessage({ type: 'BOARD_UPDATED' });
          });
        }
      }
      await cache.put(cacheKey, networkResponse.clone());
      return networkResponse;
    }
    const cached = await cache.match(cacheKey);
    return cached || networkResponse;
  } catch (e) {
    const cached = await cache.match(cacheKey);
    return cached || new Response('Доска объявлений недоступна', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  return cached || fetch(request);
}
