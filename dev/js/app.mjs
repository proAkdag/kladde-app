// Kladde · js/app.mjs — Start (A2 Modul-Umbau 19.10.: nur noch INIT). Fachlogik in ../logic/, Gemeinsames in ./kern/, Ansichten in ./ansichten/.
// Jede Ansicht wird hier geladen. Ausgewertet werden sie in Importreihenfolge der Ringe (Tiefensuche), NICHT in der Reihenfolge
// der früheren Abschnitte; das ist gleichgültig, weil keine Ansicht beim Laden etwas aus einer anderen braucht (test/kern.test.mjs)
// und die Listener reihenfolge-unabhängig sind (gemessen 19.10.: auf document nur keydown von Deck und Aktivitätsmerker).
// APP_VERSION bleibt hier: deploy_prod/deploy_pages, versionshub.py und die Tests lesen sie aus dieser Datei.
import { iconEl } from './kern/icons.mjs?v=2.1.0.1792442217';
import { $, werkzeug } from './kern/dom.mjs?v=2.1.0.1792442217';
import { idbGet, idbPut } from './kern/tresor.mjs?v=2.1.0.1792442217';
import { beamerModus } from './kern/zustand.mjs?v=2.1.0.1792442217';
// Ansichten (Zero 19.10.: „Direkt, Kern ringfrei“)
import { lockInit } from './ansichten/sperre.mjs?v=2.1.0.1792442217';
import { BTN_BEAMER } from './ansichten/eintraege.mjs?v=2.1.0.1792442217';
import './ansichten/kurswahl.mjs?v=2.1.0.1792442217';
import './ansichten/navigation.mjs?v=2.1.0.1792442217';
import './ansichten/heute.mjs?v=2.1.0.1792442217';
import './ansichten/stempel.mjs?v=2.1.0.1792442217';
import './ansichten/deck.mjs?v=2.1.0.1792442217';
import './ansichten/schueler.mjs?v=2.1.0.1792442217';
import './ansichten/kurse.mjs?v=2.1.0.1792442217';
import './ansichten/stundenplan.mjs?v=2.1.0.1792442217';
import './ansichten/mehr.mjs?v=2.1.0.1792442217';
import { zeigeBanner } from './ansichten/banner.mjs?v=2.1.0.1792442217';
const APP_VERSION = '2.1.0';

/* ═══ INIT ═══ */
if('serviceWorker' in navigator) window.addEventListener('load',()=>{
  // updateViaCache:'none' — sw.js-Checks gehen IMMER übers Netz, nie durch Safaris HTTP-Cache
  // (sonst re-registriert sich nach einem Reset der ALTE sw.js aus dem 10-min-Cache: Henne-Ei am iPad)
  navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'}).then(reg=>{
    const updateBanner=()=>zeigeBanner('<span>Neue Version geladen.</span><button class="btn" data-reload>Neu laden</button>',
      b=>{ b.querySelector('[data-reload]').onclick=()=>location.reload(); });
    // Update-Banner (P1.7, vorgezogen aus P4): kein stilles Doppel-Reload-Rätsel mehr
    reg.addEventListener('updatefound',()=>{
      const nw=reg.installing;
      if(nw) nw.addEventListener('statechange',()=>{
        if(nw.state==='installed'&&navigator.serviceWorker.controller) updateBanner();
      });
    });
    if(reg.waiting&&navigator.serviceWorker.controller) updateBanner();  // Update kam früher an, Banner wurde verpasst
    // iPad-Safari prüft den SW nur nach eigener träger Heuristik → beim Start und bei jedem
    // Sichtbarwerden AKTIV nachschauen (Zero 2026-07-10: iPad blieb auf altem Precache hängen)
    reg.update().catch(()=>{});
    document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') reg.update().catch(()=>{}); });
  }).catch(()=>{});
});
if(navigator.storage?.persist) navigator.storage.persist();
idbGet('starts').then(n=>idbPut('starts',(n||0)+1));
document.body.classList.toggle('beamer',beamerModus);
document.body.classList.toggle('nurplan',beamerModus&&localStorage.getItem('kladde_beamer_nurplan')==='1');
BTN_BEAMER.classList.toggle('aktiv',beamerModus); BTN_BEAMER.setAttribute('aria-pressed',String(beamerModus));
$('beamer-hinweis').classList.toggle('hidden',!beamerModus);
BTN_BEAMER.replaceChildren(iconEl('auge')); $('pin-auge').replaceChildren(iconEl('auge'));
$('lock-bio').prepend(iconEl('finger'));
document.querySelectorAll('#lock-erklaer [data-ikon]').forEach(li=>li.prepend(iconEl(li.dataset.ikon)));
werkzeug($('btn-plan'),'plan','Plan'); werkzeug($('btn-lock'),'schloss','Sperren'); werkzeug($('btn-hilfe'),'info','Hilfe');
$('btn-menue').replaceChildren(iconEl('mehrPunkte'));
$('btn-hilfe-k').replaceChildren(iconEl('info'));
$('beamer-hinweis').querySelector('span').prepend(iconEl('auge'),' ');   // Emoji→Linien-Icons: index.html trägt keine Symbole mehr, JS setzt sie (eine Quelle)
lockInit({auto:true});   // App geöffnet: mit Fingerabdruck-Hülle startet die Abfrage von selbst (Zero 05.10. „Fingerabdruck zuerst“)


export { APP_VERSION };   // nur für „Mehr“ (Versionsanzeige)
