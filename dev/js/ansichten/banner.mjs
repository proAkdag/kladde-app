// Kladde · js/ansichten/banner.mjs — Abschnitt „HINWEIS-BANNER“ (A2 Schnitt 4: wörtlich aus js/app.mjs, verhaltensneutral).
// Ansichten dürfen einander direkt importieren, der Kern (js/kern/) nie eine Ansicht (Zero 19.10.: „Direkt, Kern ringfrei“).
import { $ } from '../kern/dom.mjs?v=2.3.1.1792523037';
import { anmeldung, idbGet, migrationsHinweis, passSchwach, setzeMigrationsHinweis } from '../kern/tresor.mjs?v=2.3.1.1792523037';
import { vault } from '../kern/zustand.mjs?v=2.3.1.1792523037';
import { exportiereContainer, renderMehr, tageSeit } from './mehr.mjs?v=2.3.1.1792523037';
import { aktualisieren, beiUpdate, updateBereit } from '../kern/update.mjs?v=2.3.1.1792523037';
import { aktView } from '../kern/zustand.mjs?v=2.3.1.1792523037';
import { bioEinrichten, bioVerfuegbar } from './sperre.mjs?v=2.3.1.1792523037';

/* ═══ HINWEIS-BANNER (Migration · Passphrase-Empfehlung · Backup · Update) ═══ */
function zeigeBanner(html,setup){
  const b=$('banner');
  b.innerHTML=html+'<button class="banner-zu" data-zu title="Ausblenden">×</button>';
  b.classList.remove('hidden');
  b.querySelector('[data-zu]').onclick=()=>b.classList.add('hidden');
  if(setup) setup(b);
}
// Update (Zero 20.10.): „Neues Update verfügbar“ — erst der Klick holt es. × blendet den Hinweis für diese Sitzung aus;
// aktualisieren lässt sich dann unter Mehr. Hinter der Sperre bleibt der Hinweis zu (dort ist nichts bedienbar).
let updateAbgelehnt=false;
function zeigeUpdateHinweis(){
  zeigeBanner('<span>Neues Update verfügbar.</span><button class="btn" data-update>Aktualisieren</button>',
    b=>{ b.querySelector('[data-update]').onclick=()=>aktualisieren();
         b.querySelector('[data-zu]').addEventListener('click',()=>{ updateAbgelehnt=true; }); });
}
// Belegt ein anderer Hinweis den Platz (Fingerabdruck, Sicherung), rückt das Update nach, sobald er zu ist — egal über welchen Weg
// (×, „Einrichten“, „Jetzt sichern“): der Beobachter sieht das Ausblenden selbst (Probe U4, 20.10.).
const updateNachruecken=()=>{ if(updateBereit()&&vault&&!updateAbgelehnt&&$('banner').classList.contains('hidden')) zeigeUpdateHinweis(); };
new MutationObserver(updateNachruecken).observe($('banner'),{attributes:true,attributeFilter:['class']});
beiUpdate(()=>{
  if(aktView==='mehr') renderMehr();
  updateNachruecken();
});
async function zeigeStartHinweise(){
  if(migrationsHinweis){
    setzeMigrationsHinweis(false);
    zeigeBanner('<span>Kladde nutzt jetzt das schnellere Format v2. Empfohlen: einmal sichern (deine bisherige Sicherung bleibt mit alter Passphrase lesbar).</span><button class="btn" data-exp>Jetzt sichern</button>',
      b=>{ b.querySelector('[data-exp]').onclick=()=>{ b.classList.add('hidden'); exportiereContainer(); }; });
    return;
  }
  if(updateBereit()&&!updateAbgelehnt){ zeigeUpdateHinweis(); return; }
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
