// Kladde · js/ansichten/banner.mjs — Abschnitt „HINWEIS-BANNER“ (A2 Schnitt 4: wörtlich aus js/app.mjs, verhaltensneutral).
// Ansichten dürfen einander direkt importieren, der Kern (js/kern/) nie eine Ansicht (Zero 19.10.: „Direkt, Kern ringfrei“).
import { $ } from '../kern/dom.mjs?v=2.1.0.1792442217';
import { anmeldung, idbGet, migrationsHinweis, passSchwach, setzeMigrationsHinweis } from '../kern/tresor.mjs?v=2.1.0.1792442217';
import { vault } from '../kern/zustand.mjs?v=2.1.0.1792442217';
import { exportiereContainer, tageSeit } from './mehr.mjs?v=2.1.0.1792442217';
import { bioEinrichten, bioVerfuegbar } from './sperre.mjs?v=2.1.0.1792442217';

/* ═══ HINWEIS-BANNER (Migration · Passphrase-Empfehlung · Backup · Update) ═══ */
function zeigeBanner(html,setup){
  const b=$('banner');
  b.innerHTML=html+'<button class="banner-zu" data-zu title="Ausblenden">×</button>';
  b.classList.remove('hidden');
  b.querySelector('[data-zu]').onclick=()=>b.classList.add('hidden');
  if(setup) setup(b);
}
async function zeigeStartHinweise(){
  if(migrationsHinweis){
    setzeMigrationsHinweis(false);
    zeigeBanner('<span>Kladde nutzt jetzt das schnellere Format v2. Empfohlen: einmal sichern (deine bisherige Sicherung bleibt mit alter Passphrase lesbar).</span><button class="btn" data-exp>Jetzt sichern</button>',
      b=>{ b.querySelector('[data-exp]').onclick=()=>{ b.classList.add('hidden'); exportiereContainer(); }; });
    return;
  }
  // Einmaliger, nicht blockierender Hinweis für Bestands-Kurz-PINs (§1.3 — kein Zwang, Zwang erzeugt Post-its)
  if(anmeldung==='pass'&&passSchwach&&!localStorage.getItem('kladde_pass_hinweis')){
    localStorage.setItem('kladde_pass_hinweis','1');
    zeigeBanner('<span>Deine PIN ist kurz — für echte Schülerdaten ist eine Passphrase (12+ Zeichen) empfohlen: Mehr → Sicherheit → Passphrase ändern.</span>');
    return;
  }
  // Fingerabdruck-Einstieg (Zero 2026-09-02): ein Knopf, der erst nach einer Einrichtung erscheint, braucht einen
  // sichtbaren Weg dorthin. Einmalig nach einem Passphrase-Login, wenn das Gerät WebAuthn kann und noch keine Hülle liegt;
  // × merkt sich die Ablehnung dauerhaft (localStorage), „Einrichten" führt direkt in bioEinrichten.
  if(anmeldung==='pass'&&bioVerfuegbar()&&!localStorage.getItem('kladde_bio_hinweis')&&!(await idbGet('bio'))){
    zeigeBanner('<span>Schneller öffnen: Fingerabdruck / Face ID einrichten — die Passphrase bleibt als Rückweg.</span><button class="btn" data-bio>Einrichten</button>',
      b=>{ b.querySelector('[data-bio]').onclick=()=>{ b.classList.add('hidden'); bioEinrichten(); };
           b.querySelector('[data-zu]').addEventListener('click',()=>localStorage.setItem('kladde_bio_hinweis','1')); });
    return;
  }
  // Backup-Erinnerung (P1.5): das realste Verlustszenario ist Gerätedefekt/Speicherbereinigung, nicht der Angreifer
  try{
    const le=await idbGet('letzterExport');
    const tage=le?tageSeit(le.ts):Infinity;   // Kalendertage wie in „Mehr → Sichern“ (Scheibe 7)
    if(tage>7&&vault&&vault.events.length>(le?.events??0)){
      zeigeBanner('<span>'+(le&&le.art==='download'?'Letzter Download ':'Letzte Sicherung ')+(le?'vor '+tage+' Tagen':'noch nie')+' — jetzt sichern?</span><button class="btn" data-exp>Jetzt sichern</button>',
        b=>{ b.querySelector('[data-exp]').onclick=()=>{ b.classList.add('hidden'); exportiereContainer(); }; });
    }
  }catch{}
}


export { zeigeBanner, zeigeStartHinweise };
