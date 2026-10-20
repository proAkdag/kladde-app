// Kladde · js/app.mjs — Start (A2 Modul-Umbau 19.10.: nur noch INIT). Fachlogik in ../logic/, Gemeinsames in ./kern/, Ansichten in ./ansichten/.
// Jede Ansicht wird hier geladen. Ausgewertet werden sie in Importreihenfolge der Ringe (Tiefensuche), NICHT in der Reihenfolge
// der früheren Abschnitte; das ist gleichgültig, weil keine Ansicht beim Laden etwas aus einer anderen braucht (test/kern.test.mjs)
// und die Listener reihenfolge-unabhängig sind (gemessen 19.10.: auf document nur keydown von Deck und Aktivitätsmerker).
// APP_VERSION bleibt hier: deploy_prod/deploy_pages, versionshub.py und die Tests lesen sie aus dieser Datei.
import { iconEl } from './kern/icons.mjs?v=2.4.0.1792533458';
import { $, werkzeug } from './kern/dom.mjs?v=2.4.0.1792533458';
import { idbGet, idbPut, geraetIdLaden } from './kern/tresor.mjs?v=2.4.0.1792533458';
import { beamerModus } from './kern/zustand.mjs?v=2.4.0.1792533458';
// Ansichten (Zero 19.10.: „Direkt, Kern ringfrei“)
import { lockInit } from './ansichten/sperre.mjs?v=2.4.0.1792533458';
import { BTN_BEAMER } from './ansichten/eintraege.mjs?v=2.4.0.1792533458';
import './ansichten/kurswahl.mjs?v=2.4.0.1792533458';
import './ansichten/navigation.mjs?v=2.4.0.1792533458';
import './ansichten/heute.mjs?v=2.4.0.1792533458';
import './ansichten/stempel.mjs?v=2.4.0.1792533458';
import './ansichten/deck.mjs?v=2.4.0.1792533458';
import './ansichten/schueler.mjs?v=2.4.0.1792533458';
import './ansichten/kurse.mjs?v=2.4.0.1792533458';
import './ansichten/stundenplan.mjs?v=2.4.0.1792533458';
import './ansichten/mehr.mjs?v=2.4.0.1792533458';
import { zeigeBanner } from './ansichten/banner.mjs?v=2.4.0.1792533458';
import { updateStarten } from './kern/update.mjs?v=2.4.0.1792533458';
const APP_VERSION = '2.4.0';

/* ═══ INIT ═══ */
// Update im Hintergrund, übernommen nur auf Klick (Zero 20.10.) — js/kern/update.mjs; Hinweis und Mehr-Eintrag in den Ansichten
updateStarten();
if(navigator.storage?.persist) navigator.storage.persist();
idbGet('starts').then(n=>idbPut('starts',(n||0)+1));
geraetIdLaden().catch(()=>{});   // v2.2: Geräte-Kennung für neue Einträge (lange vor dem ersten Eintrag da: erst kommt das Entsperren)
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
