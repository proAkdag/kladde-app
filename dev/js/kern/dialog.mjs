// Kladde · js/kern/dialog.mjs — Dialog-Rahmen (Schließen-Knopf, Inhalt, Breite) (A2 Schnitt 2: wörtlich aus js/app.mjs, verhaltensneutral; der Kern kennt keine Ansicht)
import { $, el } from './dom.mjs?v=2.1.0.1792442217';
import { iconEl } from './icons.mjs?v=2.1.0.1792442217';
import { aktiverKursId } from './zustand.mjs?v=2.1.0.1792442217';

// Dialog-Rahmen (Zero 2026-09-02): ein Schließen-Knopf oben rechts, der beim Scrollen stehen bleibt.
// Der Dialog trägt zwei Kinder: .dlg-x (absolut, außerhalb des Scrollbereichs) + .dlg-inhalt (scrollt).
// Aller Bestand schreibt weiter „in den Dialog" — nur eben in .dlg-inhalt; querySelector-Zugriffe bleiben gültig.
function dlgInhalt(){
  const d=$('dlg');
  let i=d.querySelector(':scope>.dlg-inhalt');
  if(!i){ i=el('div',{class:'dlg-inhalt'}); d.replaceChildren(el('button',{class:'dlg-x',type:'button','aria-label':'Schließen',title:'Schließen',onclick:()=>d.close()},iconEl('schliessen')),i); }
  return i;
}
function dlgZu(){ $('dlg').close(); }
// Breiter Dialog (Stundenplan): das Wochen-Grid nutzt die Breite, nicht nur die Höhe (Zero 2026-09-02).
// Nach dlgZeigen/dlgZeigenEl aufrufen — jeder neue Dialog startet wieder schmal.
function dlgBreit(){ $('dlg').classList.add('breit'); }

// Frisch geöffnet (nicht nur neu befüllt): oben anfangen — .dlg-inhalt ist für alle Dialoge dasselbe und behielt die Lage des vorigen
// (Prüfer 03.10. 🟡 3) — und den Kurs merken, für den der Dialog gilt: addEvent und stornoVon buchen nichts, wenn er inzwischen
// automatisch gewechselt hat (Zero 03.10.: „An einer Stelle“ — vorher schützte sich jede Buchungsstelle selbst, und drei vergaßen es)
let dlgKurs=null;
function dlgOeffnen(d){ if(d.open) return; d.showModal(); dlgInhalt().scrollTop=0; dlgKurs=aktiverKursId; }
// close kommt erst NACH dem laufenden Handgriff: „dlgZu(); klaere()“ prüft so noch gegen den Kurs des Dialogs
$('dlg').addEventListener('close',()=>{ if(!$('dlg').open) dlgKurs=null; });
function dlgZeigen(html,setup){
  const d=$('dlg'); d.classList.remove('breit'); dlgInhalt().innerHTML=html;
  d.querySelectorAll('[data-schliessen]').forEach(b=>b.onclick=()=>d.close());
  if(setup) setup(d);
  dlgOeffnen(d);   // nur wenn zu: aus einem offenen Detail-Blatt heraus (Tag bewerten → Note) werfen ältere Engines bei showModal auf offenem Dialog
}
// el()-Variante: Dialog aus DOM-Knoten (CSP-sicher, kein innerHTML) — für neue Views (P2.4+)
function dlgZeigenEl(...knoten){
  const d=$('dlg'); d.classList.remove('breit'); dlgInhalt().replaceChildren(...knoten);
  dlgOeffnen(d);
}
// Von Hand gewählter Kurs: ein offener Dialog gilt jetzt dem neuen Kurs (kursWechseln)
function dlgKursBinden(id){ if(dlgKurs) dlgKurs=id; }

export { dlgInhalt, dlgZu, dlgBreit, dlgKurs, dlgOeffnen, dlgZeigen, dlgZeigenEl, dlgKursBinden };
