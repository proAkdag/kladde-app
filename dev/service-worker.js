// Kladde · Service Worker (Multi-File, v0.8.0)
// Cache-first fuer die App-Huelle · API IMMER Netz (Sync darf nie aus dem Cache kommen)
// CACHE_NAME ist VERSIONIERT — Konsistenz index.html-Queries ↔ ASSETS ↔ Version
// erzwingt test/sw_assets.test.mjs (Maschine statt Merkzettel).
// Atomaritaet: neuer CACHE_NAME → frische Cache-Instanz → addAll fetcht ALLES neu;
// schlaegt eine Datei fehl (Pages-Deploy unfertig), wird der Install verworfen (fail-closed).

const CACHE_NAME = 'kladde-dev-v1.7.0-1788372055';
// Caches sind ORIGIN-global, SW-Scopes nicht: Der Cleanup darf nur die EIGENE
// Versions-Familie räumen, sonst löscht der Dev-SW die Prod-Caches (und umgekehrt).
const CACHE_FAMILIE = CACHE_NAME.slice(0, CACHE_NAME.lastIndexOf('-v') + 2);

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './fonts/HankenGrotesk-subset.woff2',
  './fonts/Newsreader-subset.woff2',
  './css/kladde.css?v=1.7.0.1788372055',
  './js/app.mjs?v=1.7.0.1788372055',
  './logic/skalen.mjs?v=1.7.0.1788372055',
  './logic/verdichtung.mjs?v=1.7.0.1788372055',
  './logic/merge.mjs?v=1.7.0.1788372055',
  './logic/container.mjs?v=1.7.0.1788372055',
  './logic/parser.mjs?v=1.7.0.1788372055',
  './logic/zeitmodell.mjs?v=1.7.0.1788372055',
  './logic/rasterVorlagen.mjs?v=1.7.0.1788372055',
  './logic/autowahl.mjs?v=1.7.0.1788372055',
  './logic/migration.mjs?v=1.7.0.1788372055',
  './logic/kursStatus.mjs?v=1.7.0.1788372055',
  './logic/kursSort.mjs?v=1.7.0.1788372055',
  './logic/teilnehmer.mjs?v=1.7.0.1788372055',
  './logic/bericht.mjs?v=1.7.0.1788372055',
  './logic/auswahl.mjs?v=1.7.0.1788372055',
  './logic/fachfarben.mjs?v=1.7.0.1788372055',
  './logic/mappe.mjs?v=1.7.0.1788372055',
  './logic/xlsx.mjs?v=1.7.0.1788372055'
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

  // Navigation NETWORK-FIRST (iPad-Feldtest 2026-07-10): die frische index.html ist der
  // Update-Anker — cache-first machte die feste /dev/-URL zusammen mit Safaris HTTP-Cache
  // zur Alt-Versions-Falle. no-store umgeht auch den HTTP-Cache; offline fällt auf den
  // Precache zurück (PWA bleibt offlinefähig). Assets bleiben cache-first (?v-gestempelt).
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // ignoreSearch: modul-interne Imports (verdichtung→skalen, autowahl→zeitmodell) laufen OHNE
  // ?v-Query — der Precache kennt nur ?v-URLs. Ohne ignoreSearch ist das nach einem SW-Update
  // (alte Cache-Familie geräumt, Runtime-Kopien weg) offline ein Cache-Miss, dessen Fallback
  // die index.html als ES-Modul liefert → SyntaxError, App tot. Ein Cache = eine App-Version,
  // die Query ist beim Lookup bedeutungslos.
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
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
