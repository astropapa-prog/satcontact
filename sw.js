const CACHE_VERSION = 'satcontact-v1';
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
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.addAll(
        PRECACHE_URLS.map(url => new Request(url, { cache: 'reload' }))
      );
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

  event.respondWith(cacheFirst(event.request));
});

async function handleBoardFetch(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const networkResponse = await fetch(request, { cache: 'no-store' });
    if (networkResponse.ok) {
      const newHtml = await networkResponse.clone().text();
      const cachedResponse = await cache.match(request);
      if (cachedResponse) {
        const oldHtml = await cachedResponse.text();
        if (oldHtml !== newHtml) {
          const allClients = await self.clients.matchAll();
          allClients.forEach(client => {
            client.postMessage({ type: 'BOARD_UPDATED' });
          });
        }
      }
      await cache.put(request, networkResponse.clone());
      return networkResponse;
    }
    const cached = await cache.match(request);
    return cached || networkResponse;
  } catch (e) {
    const cached = await cache.match(request);
    return cached || new Response('Доска объявлений недоступна', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
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
