// Kladde · js/kern/update.mjs — Update im Hintergrund, übernommen nur auf Klick (Zero 20.10.).
// Der Service Worker liefert die freigegebene Fassung; liegt eine neuere bereit, meldet er sie hier. „Aktualisieren“ gibt sie frei
// und lädt neu. Die Prüfung blockiert nie das Öffnen: sie läuft nach dem Laden und bei jedem Sichtbarwerden.
let neueFassung = false;
const hoerer = new Set();

// Gefragt wird der neueste fertig geladene Worker. Ein wartender kennt die neue Fassung schon; wann der Browser ihn aktiv
// schaltet, ist egal (gemessen 20.10. in Chromium: bis ~30 s), weil auch der alte Worker nach der Freigabe aus dem neuen Cache liefert.
function frageSW(reg, typ) {
  const sw = reg && (reg.waiting || reg.active);
  if (!sw) return Promise.resolve(null);
  return new Promise((ok) => {
    const kanal = new MessageChannel();
    const t = setTimeout(() => ok(null), 3000);
    kanal.port1.onmessage = (e) => { clearTimeout(t); ok(e.data); };
    sw.postMessage({ typ }, [kanal.port2]);
  });
}

let registrierung = null;
async function pruefe() {
  const s = await frageSW(registrierung, 'status');
  const jetzt = !!(s && s.frei && s.neu && s.frei !== s.neu);
  if (jetzt !== neueFassung) { neueFassung = jetzt; hoerer.forEach((f) => f(neueFassung)); }
}

function updateStarten() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    // updateViaCache:'none' — sw.js-Checks gehen IMMER übers Netz, nie durch Safaris HTTP-Cache
    // (sonst re-registriert sich nach einem Reset der ALTE sw.js aus dem 10-min-Cache: Henne-Ei am iPad)
    navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).then((reg) => {
      registrierung = reg;
      const beobachte = (nw) => nw && nw.addEventListener('statechange', () => { if (nw.state === 'installed' || nw.state === 'activated') pruefe(); });
      beobachte(reg.installing);   // die Prüfung beim Öffnen kann schon vor register() begonnen haben
      reg.addEventListener('updatefound', () => beobachte(reg.installing));
      navigator.serviceWorker.addEventListener('controllerchange', () => pruefe());
      pruefe();
      // iPad-Safari prüft den SW nur nach eigener träger Heuristik → nach dem Start und bei jedem Sichtbarwerden
      // im Hintergrund nachschauen (Zero 2026-07-10: iPad blieb auf altem Precache hängen)
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().then(pruefe, () => {});
      });
    }).catch(() => {});
  });
}

const updateBereit = () => neueFassung;
function beiUpdate(f) { hoerer.add(f); }
async function aktualisieren() {
  const r = await frageSW(registrierung, 'freigeben');
  if (r && r.frei) location.reload();
  return !!(r && r.frei);
}

export { updateStarten, updateBereit, beiUpdate, aktualisieren };
