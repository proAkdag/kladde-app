// Kladde · Service Worker (Multi-File, v0.8.0)
// Alles aus dem Speicher, auch die Seite (2.2.1) · API IMMER Netz (Sync darf nie aus dem Cache kommen) ·
// eine neue Fassung wird erst nach „Aktualisieren“ benutzt (Zeiger auf die freigegebene Version)
// CACHE_NAME ist VERSIONIERT — Konsistenz index.html-Queries ↔ ASSETS ↔ Version
// erzwingt test/sw_assets.test.mjs (Maschine statt Merkzettel).
// Atomaritaet: neuer CACHE_NAME → frische Cache-Instanz → addAll fetcht ALLES neu;
// schlaegt eine Datei fehl (Pages-Deploy unfertig), wird der Install verworfen (fail-closed).

const CACHE_NAME = 'kladde-dev-v3.0.0-1792601998';
// Caches sind ORIGIN-global, SW-Scopes nicht: Der Cleanup darf nur die EIGENE
// Versions-Familie räumen, sonst löscht der Dev-SW die Prod-Caches (und umgekehrt).
const CACHE_FAMILIE = CACHE_NAME.slice(0, CACHE_NAME.lastIndexOf('-v') + 2);

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
  './logo.svg',
  './fonts/HankenGrotesk-subset.woff2',
  './fonts/Newsreader-subset.woff2',
  './css/kladde.css?v=3.0.0.1792601998',
  './js/app.mjs?v=3.0.0.1792601998',
  './js/kern/icons.mjs?v=3.0.0.1792601998',
  './js/kern/dom.mjs?v=3.0.0.1792601998',
  './js/kern/dialog.mjs?v=3.0.0.1792601998',
  './js/kern/theme.mjs?v=3.0.0.1792601998',
  './js/kern/zustand.mjs?v=3.0.0.1792601998',
  './js/kern/umgebung.mjs?v=3.0.0.1792601998',
  './js/kern/update.mjs?v=3.0.0.1792601998',
  './js/kern/qr.mjs?v=3.0.0.1792601998',
  './js/kern/verbindung.mjs?v=3.0.0.1792601998',
  './js/ansichten/abgleich.mjs?v=3.0.0.1792601998',
  './logic/handschlag.mjs?v=3.0.0.1792601998',
  './js/vendor/qrcode.js?v=3.0.0.1792601998',
  './js/vendor/jsqr.js?v=3.0.0.1792601998',   // Scheibe C: nachgeladen, aber offline da
  './js/kern/tresor.mjs?v=3.0.0.1792601998',
  './js/ansichten/kurse.mjs?v=3.0.0.1792601998',
  './js/ansichten/klassenliste.mjs?v=3.0.0.1792601998',
  './js/ansichten/deck.mjs?v=3.0.0.1792601998',
  './js/ansichten/stempel.mjs?v=3.0.0.1792601998',
  './js/ansichten/heute.mjs?v=3.0.0.1792601998',
  './js/ansichten/navigation.mjs?v=3.0.0.1792601998',
  './js/ansichten/kurswahl.mjs?v=3.0.0.1792601998',
  './js/ansichten/eintraege.mjs?v=3.0.0.1792601998',
  './js/ansichten/sperre.mjs?v=3.0.0.1792601998',
  './js/ansichten/banner.mjs?v=3.0.0.1792601998',
  './js/ansichten/mehr.mjs?v=3.0.0.1792601998',
  './js/ansichten/stundenplan.mjs?v=3.0.0.1792601998',
  './js/ansichten/schueler.mjs?v=3.0.0.1792601998',
  './js/ansichten/mappe.mjs?v=3.0.0.1792601998',
  './logic/skalen.mjs?v=3.0.0.1792601998',
  './logic/verdichtung.mjs?v=3.0.0.1792601998',
  './logic/merge.mjs?v=3.0.0.1792601998',
  './logic/container.mjs?v=3.0.0.1792601998',
  './logic/parser.mjs?v=3.0.0.1792601998',
  './logic/zeitmodell.mjs?v=3.0.0.1792601998',
  './logic/rasterVorlagen.mjs?v=3.0.0.1792601998',
  './logic/autowahl.mjs?v=3.0.0.1792601998',
  './logic/migration.mjs?v=3.0.0.1792601998',
  './logic/kursStatus.mjs?v=3.0.0.1792601998',
  './logic/kursSort.mjs?v=3.0.0.1792601998',
  './logic/teilnehmer.mjs?v=3.0.0.1792601998',
  './logic/klassenliste.mjs?v=3.0.0.1792601998',
  './logic/bericht.mjs?v=3.0.0.1792601998',
  './logic/biometrie.mjs?v=3.0.0.1792601998',
  './logic/auswahl.mjs?v=3.0.0.1792601998',
  './logic/hilfe.mjs?v=3.0.0.1792601998',
  './logic/fachfarben.mjs?v=3.0.0.1792601998',
  './logic/mappe.mjs?v=3.0.0.1792601998',
  './logic/xlsx.mjs?v=3.0.0.1792601998',
  './logic/erfassListe.mjs?v=3.0.0.1792601998',
  './logic/stunden.mjs?v=3.0.0.1792601998',
  './logic/sitzplan.mjs?v=3.0.0.1792601998',
  './logic/pdfbild.mjs?v=3.0.0.1792601998',
  './logic/vertrag.mjs?v=3.0.0.1792601998',
  './logic/identitaet.mjs?v=3.0.0.1792601998',
  './logic/excelrechnen.mjs?v=3.0.0.1792601998',
  './logic/arbeiten.mjs?v=3.0.0.1792601998'
];

// Freigegebene Version (Zero 20.10.: „nur nach klicken das Update auch gezogen wird“): Der SW liefert aus dem Cache, den der
// Zeiger nennt, nicht automatisch aus dem neuesten. Ein wartender SW würde beim nächsten Kaltstart ohne Klick aktiv; darum
// darf der neue SW sofort übernehmen (skipWaiting), die neue Fassung kommt aber erst mit „Aktualisieren“ (Nachricht 'freigeben').
// Der Zeiger liegt je Familie in einem eigenen Cache, der nicht mit CACHE_FAMILIE beginnt (der Cleanup räumt ihn nie).
const ZEIGER = CACHE_FAMILIE.slice(0, -2) + '-zeiger';   // kladde-zeiger · kladde-dev-zeiger
async function freigegeben() {
  const r = await (await caches.open(ZEIGER)).match('freigegeben');
  const name = r ? await r.text() : null;
  return name && (await caches.has(name)) ? name : null;
}
async function setzeFrei(name) { await (await caches.open(ZEIGER)).put('freigegeben', new Response(name)); }
async function raeumeAlte(behalte) {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith(CACHE_FAMILIE) && !behalte.includes(k)).map((k) => caches.delete(k)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // cache:'reload' — sonst kann './' bzw. './index.html' (ohne ?v) aus dem HTTP-Cache kommen (Pages ~10 min) und
      // eine ALTE Seite mit neuem JavaScript in den Offline-Cache legen (Prüfer 2026-09-29)
      .then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      // Erster Besuch oder Fassung vor 2.2.1 (kein Zeiger): diese Version ist sofort die freigegebene
      .then(async () => { if (!(await freigegeben())) await setzeFrei(CACHE_NAME); })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    freigegeben().then((frei) => raeumeAlte([CACHE_NAME, frei])).then(() => self.clients.claim())
  );
});

// Seite fragt: läuft die neueste Fassung? · Klick auf „Aktualisieren“: neueste freigeben, alte räumen.
self.addEventListener('message', (event) => {
  const typ = event.data && event.data.typ, port = event.ports && event.ports[0];
  if (!port) return;
  if (typ === 'status') {
    event.waitUntil(freigegeben().then((frei) => port.postMessage({ frei, neu: CACHE_NAME })));
  } else if (typ === 'freigeben') {
    event.waitUntil(setzeFrei(CACHE_NAME).then(() => raeumeAlte([CACHE_NAME])).then(() => port.postMessage({ frei: CACHE_NAME })));
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // API nie cachen — Sync/Status brauchen immer das Netz (offline: sauberer Fehler)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Alles aus dem Speicher, auch die Seite selbst (Zero 20.10.: „Ich will dass die App sich öffnet und nicht zuerst auf
  // Updates oder was anderes prüft“). Bis 2.2.0 holte die Navigation zuerst das Netz, ohne Zeitgrenze: in einem WLAN, das
  // verbunden ist, aber nicht antwortet, öffnete die App nicht (gemessen 20.10.: nach 20 s nicht offen). Updates kommen über
  // die SW-Prüfung im Hintergrund (reg.update, updateViaCache:'none') und den Klick — nicht mehr über die Seite.
  // ignoreSearch: modul-interne Imports (verdichtung→skalen, autowahl→zeitmodell) laufen OHNE ?v-Query — der Precache kennt
  // nur ?v-URLs. Ein Cache = eine App-Version, die Query ist beim Lookup bedeutungslos.
  event.respondWith((async () => {
    const name = (await freigegeben()) || CACHE_NAME;
    const cache = await caches.open(name);
    const navi = event.request.mode === 'navigate';
    const treffer = (await cache.match(event.request, { ignoreSearch: true })) || (navi ? await cache.match('./index.html') : null);
    if (treffer) return treffer;
    try {
      const response = await fetch(event.request);
      if (!navi && response && response.status === 200 && response.type === 'basic') cache.put(event.request, response.clone());
      return response;
    } catch {
      return (await cache.match('./index.html')) || Response.error();
    }
  })());
});
