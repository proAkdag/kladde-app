// Kladde · js/kern/umgebung.mjs — Gerät, Pages-Kontext, DEV-Instanz (A2 Schnitt 3: wörtlich aus js/app.mjs, verhaltensneutral; der Kern kennt keine Ansicht)

// Android = „handy“ (v1.11.0): Handy und iPad laufen parallel, Import-Vorschau und Konfliktmeldungen müssen sie unterscheiden.
// iPadOS gibt sich als Mac aus („Macintosh“) — erkennbar an den Touch-Punkten; ein Mac hat keine (Zero 2026-09-30: iPad zeigte „pc“)
const GERAET = /iPad|iPhone/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) ? 'ipad'
  : /Android/.test(navigator.userAgent) ? 'handy' : 'pc';
const PAGES_KONTEXT = /\.github\.io$/.test(location.hostname);
// Zwei-Instanzen-Trennung: /dev/ = Claudes Entwicklungs-Kladde (eigene DB, Pseudo-Daten) ·
// Wurzel = Zeros Produktiv-Kladde (echte Namen — Claude betritt sie NICHT mehr).
const IST_DEV = location.pathname.includes('/dev/');
if (IST_DEV) {
  document.title = 'Kladde DEV';
  document.addEventListener('DOMContentLoaded', function () {
    const h = document.querySelector('header.app');
    if (h) h.insertAdjacentHTML('beforeend', '<span class="dev-badge">DEV</span>');
  });
}

export { GERAET, PAGES_KONTEXT, IST_DEV };
