// Kladde · Service Worker
// Cache-first fuer die App-Huelle · API IMMER Netz (Sync darf nie aus dem Cache kommen)
// CACHE_NAME ist VERSIONIERT — bei jedem App-Release hochziehen (IT-Pflicht-Op S-Kladde-Bau)

const CACHE_NAME = 'kladde-dev-v0.5.0';
// Caches sind ORIGIN-global, SW-Scopes nicht: Der Cleanup darf nur die EIGENE
// Versions-Familie räumen, sonst löscht der Dev-SW die Prod-Caches (und umgekehrt).
const CACHE_FAMILIE = CACHE_NAME.slice(0, CACHE_NAME.lastIndexOf('-v') + 2);

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith(CACHE_FAMILIE) && k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // API nie cachen — Sync/Status brauchen immer das Netz (offline: sauberer Fehler)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
