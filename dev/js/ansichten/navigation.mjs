// Kladde · js/ansichten/navigation.mjs — Abschnitt „DIALOG-HELFER + VIEWS / TABS“ (A2 Schnitt 4: wörtlich aus js/app.mjs, verhaltensneutral).
// Ansichten dürfen einander direkt importieren, der Kern (js/kern/) nie eine Ansicht (Zero 19.10.: „Direkt, Kern ringfrei“).
import { $ } from '../kern/dom.mjs?v=2.2.1.1792457964';
import { aktView, setzeAktView, vault } from '../kern/zustand.mjs?v=2.2.1.1792457964';
import { renderDeck } from './deck.mjs?v=2.2.1.1792457964';
import { setzeAktiverSchueler } from './eintraege.mjs?v=2.2.1.1792457964';
import { renderHeute } from './heute.mjs?v=2.2.1.1792457964';
import { editorCleanup, kursSeiteId, renderKurse, setzeKursSeiteId } from './kurse.mjs?v=2.2.1.1792457964';
import { aktualisiereKursChip, nachtragLeisten } from './kurswahl.mjs?v=2.2.1.1792457964';
import { renderMehr } from './mehr.mjs?v=2.2.1.1792457964';
import { renderSchueler } from './schueler.mjs?v=2.2.1.1792457964';
import { stempelAus } from './stempel.mjs?v=2.2.1.1792457964';

/* ═══ DIALOG-HELFER ═══ */

/* ═══ VIEWS / TABS (replaceState-only — Edge-Swipe-Doktrin) ═══ */
const VIEW_TITEL={heute:['Heute','Sitzplan · live erfassen'],deck:['Deck','Klasse zügig durchgehen'],schueler:['Schüler','Verläufe, Notizen & Details'],kurse:['Kurse','Klassen verwalten'],mehr:['Mehr','Einstellungen & Sicherung']};
function setzeViewTitel(v){ const t=VIEW_TITEL[v]||['','']; $('view-titel').textContent=t[0]; $('view-sub').textContent=t[1];
  document.body.dataset.ansicht=v; }   // Handy-CSS: Toast/Undo auf der Stempel-Leiste nur in „Heute“ (data-Attribut statt :has — Safari 26)
document.getElementById('hauptnav').addEventListener('click',e=>{
  const b=e.target.closest('button[data-view]'); if(!b) return;
  if(b.dataset.view===aktView){ if(aktView==='kurse'&&kursSeiteId){ setzeKursSeiteId(null); mitUebergang(renderKurse); } return; }   // „Kurse“ auf der Kurs-Seite: zurück zum Raster
  if(editorCleanup) editorCleanup();   // ein offener Sitzplan-Editor endet wie mit „Fertig“ (Prüfer 03.10. B1: sonst lief er in „Deck“/„Mehr“ weiter)
  setzeKursSeiteId(null);
  setzeAktView(b.dataset.view);
  document.querySelectorAll('#hauptnav button').forEach(x=>x.classList.toggle('aktiv',x===b));
  setzeAktiverSchueler(null); stempelAus(); // Stempelmodus lebt nur in „Heute"
  setzeViewTitel(aktView);
  mitUebergang(()=>{
    ['heute','deck','schueler','kurse','mehr'].forEach(v=>$('view-'+v).classList.toggle('hidden',v!==aktView));
    renderAlles();
    $('view-titel').focus({preventScroll:true});  // Screenreader landet in der neuen Ansicht (C5)
  });
});
// Übergangs-Helfer: View Transition wo verfügbar (PC-Chrome seit 111 / iPad ab Safari 18), sonst sofort. reduced-motion → sofort.
let uebergangLaeuft=false;
function mitUebergang(fn){
  // Läuft schon ein Übergang, wird KEIN zweiter gestartet (sonst InvalidStateError durch Abbruch)
  // — die Folgeänderung wird sofort angewandt. Kein Konsolen-Lärm, kein Flackern.
  if(!document.startViewTransition||uebergangLaeuft||matchMedia('(prefers-reduced-motion: reduce)').matches){ fn(); return; }
  uebergangLaeuft=true;
  try {
    const t=document.startViewTransition(fn);
    // ALLE drei Promises abfangen — .ready rejektet, wenn der Snapshot mitten in der
    // Animation ungültig wird (aborted); das ist erwartbar, kein Konsolen-Fehler.
    t.ready&&t.ready.catch(()=>{});
    t.updateCallbackDone&&t.updateCallbackDone.catch(e=>console.error('[kladde] Render-Fehler im View-Übergang:',e)); // NICHT still schlucken — sonst sind Render-Bugs unsichtbar (FEHLER 2026-07-09 k-undefined)
    t.finished.catch(()=>{}).finally(()=>{ uebergangLaeuft=false; });
  } catch { uebergangLaeuft=false; fn(); }
}
function renderAlles(){
  if(!vault) return;
  aktualisiereKursChip(); nachtragLeisten();   // Chip und Leiste = Buchung, auch nach Nachtrag, Stundenwahl, Ansichtswechsel
  if(aktView==='heute') renderHeute();
  else if(aktView==='deck') renderDeck();
  else if(aktView==='schueler') renderSchueler();
  else if(aktView==='kurse') renderKurse();
  else renderMehr();
}


export { VIEW_TITEL, setzeViewTitel, uebergangLaeuft, mitUebergang, renderAlles };
