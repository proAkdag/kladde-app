// Kladde · js/ansichten/deck.mjs — Abschnitt „DECK“ (A2 Schnitt 4: wörtlich aus js/app.mjs, verhaltensneutral).
// Ansichten dürfen einander direkt importieren, der Kern (js/kern/) nie eine Ansicht (Zero 19.10.: „Direkt, Kern ringfrei“).
import { wirksameEvents } from '../../logic/verdichtung.mjs?v=2.2.1';
import { dlgZeigenEl, dlgZu } from '../kern/dialog.mjs?v=2.2.1';
import { $, el, esc, toast } from '../kern/dom.mjs?v=2.2.1';
import { iconEl, iconHtml } from '../kern/icons.mjs?v=2.2.1';
import { aktiverKursId, aktiveTeilgruppe, aktView, beamerModus, terminDatum, vault } from '../kern/zustand.mjs?v=2.2.1';
import { addEvent, anzahlBewertungen, kurs, nrNachSid, stammKind, stornoVon, tagesStandIndex, TYP_LABEL } from './eintraege.mjs?v=2.2.1';
import { anzeigeNachname, anzeigeVorname, bewertGuard, busy, FEHLT_WORT, setzeBusy, sichtbareSchueler } from './heute.mjs?v=2.2.1';
import { aktualisiereKursChip, nachtragLeisten } from './kurswahl.mjs?v=2.2.1';
import { mitUebergang } from './navigation.mjs?v=2.2.1';
import { schuelerBlatt } from './stempel.mjs?v=2.2.1';

/* ═══ DECK · Stundenende-Ritual (Swipe: ←− →+ ↑Schülerblatt ↓weiter) ═══ */
let deckListe=[], deckIdx=0, deckNurOhne=true;   // Zero 02.10.: „Deck soll standardmäßig mit nur offene Einträge starten“
let deckRundeStart=null;
let deckVerlauf=[]; // Buchungen DIESER Deck-Runde [{nr,name,evId,typ}] — mitlaufende, korrigierbare Historie (Zero-Feldtest 2026-07-10)
function baueDeckListe(){
  const k=kurs(); if(!k) return [];
  // Abwesende (fehlt_o/e/u) nie im Deck — kein Bewerten von Fehlenden
  const nrVon=nrNachSid(k.id);   // Eintrag → Kind über die sid (v2.2)
  const abw=new Set(wirksameEvents(vault.events).filter(e=>e.kursId===k.id&&e.datum===terminDatum&&(e.typ==='fehlt_o'||e.typ==='fehlt_e'||e.typ==='fehlt_u')).map(e=>nrVon.get(e.sid)));
  let liste=sichtbareSchueler(k).filter(s=>!abw.has(s.nr));
  if(deckNurOhne){ const idx=tagesStandIndex(terminDatum); liste=liste.filter(s=>anzahlBewertungen(idx.get(s.nr))===0); }
  return liste;
}
function deckBasis(k){ if(!k) return ''; const nrs=sichtbareSchueler(k).map(s=>s.nr).join(',');   // zuerst: kann aktiveTeilgruppe zurücksetzen
  return (aktiveTeilgruppe||'')+'|'+nrs; }
function mischeArray(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function neuesDeck(mischen){
  const k=kurs(); let liste=baueDeckListe(); if(mischen) liste=mischeArray(liste);
  liste._kurs=k?k.id:null; liste._datum=terminDatum; liste._nurOhne=deckNurOhne;
  liste._basis=deckBasis(k);   // Teilgruppe + aktive Teilnehmer: ändert sich das, baut sich die Runde neu (Prüfer 2026-09-29)
  deckListe=liste; deckIdx=0; deckVerlauf=[];
  deckRundeStart=new Date().toISOString();   // Marke fuer Buchungen, die nicht per Swipe entstehen
}
function renderDeckOptionen(){
  const box=$('deck-optionen'); if(!kurs()){ box.replaceChildren(); return; }
  box.replaceChildren(
    el('button',{class:(deckNurOhne?'an':''),onclick:()=>{ deckNurOhne=!deckNurOhne; neuesDeck(false); mitUebergang(renderDeck); }}, deckNurOhne?'✓ nur ohne Eintrag':'nur ohne Eintrag'),
    el('button',{onclick:()=>{ neuesDeck(true); zeigeDeckKarte(); toast('gemischt'); }},iconEl('mischen'),' mischen'));
}
function renderDeck(){
  const k=kurs();
  renderDeckOptionen();
  if(!k){ $('deck-karte').innerHTML='<span class="sub">Kein Kurs gewählt.</span>'; $('deck-fortschritt').textContent=''; return; }
  // „nur ohne Eintrag" hängt an den Bewertungen: wer inzwischen im Sitzplan bewertet wurde, fällt aus
  // einer noch nicht begonnenen Runde heraus (eine laufende Runde behält ihre Karten und ihren Platz).
  const frischeNurOhne=deckNurOhne&&deckIdx===0&&!deckVerlauf.length;
  if(!deckListe.length||deckListe._kurs!==k.id||deckListe._datum!==terminDatum||deckListe._nurOhne!==deckNurOhne||deckListe._basis!==deckBasis(k)||frischeNurOhne) neuesDeck(false);
  zeigeDeckKarte();
}
function zeigeDeckKarte(){
  aktualisiereKursChip(); nachtragLeisten();   // das Deck hat keinen Takt: je Karte frisch (die Stunde kann inzwischen gewechselt haben)
  const karte=$('deck-karte');
  const total=deckListe.length;
  $('view-deck').classList.toggle('deck-ende',deckIdx>=total);   // End-Karte: Knöpfe und Wischhilfe täten nichts (Prüfer 03.10. 🟢 11)
  // EIN Indexlauf statt eines vollen Event-Durchlaufs je Schueler (gemessen bei 7.624 Events:
  // 146 ms -> 7 ms je Deck-Runde, Faktor 21; die Funktion gab es laengst, sie wurde hier nur
  // nicht benutzt). Derselbe Index traegt unten die End-Karte und die Abwesenheits-Anzeige.
  const idxNow=tagesStandIndex(terminDatum);
  const erfasst=deckListe.filter(s=>anzahlBewertungen(idxNow.get(s.nr))>0).length;
  const balken='<div class="deck-bar"><div data-w="'+(total?100*erfasst/total:0)+'"></div></div>';
  const setzeBalken=()=>{ const d=$('deck-fortschritt').querySelector('[data-w]'); if(d) d.style.width=d.dataset.w+'%'; }; // CSSOM (CSP)
  if(deckIdx>=total){
    // End-Karte: „Fehlende durchgehen" — noch nicht erfasste Anwesende in ein Nur-Ohne-Deck (P4.4)
    const fehlend=deckListe.filter(s=>anzahlBewertungen(idxNow.get(s.nr))===0).length;
    // Grenzfall leeres Deck freundlich erklären statt „0 Karten durch" (Tag-Simulation B1)
    const leerText=deckNurOhne?'Alle Anwesenden sind heute schon erfasst.':'Keine Schüler im Deck — heute alle abwesend.';
    karte.innerHTML='<span class="gross">'+(fehlend?iconHtml('erneut'):'✓')+'</span><span class="sub">'+
      (total===0?leerText:total+' Karten durch · '+erfasst+' erfasst'+(fehlend?' · '+fehlend+' noch offen.':'.'))+'</span>'+
      (fehlend?'<div class="btn-reihe u-center"><button class="btn" data-fehlende>'+
        (deckNurOhne?'Nochmal durchgehen':'Fehlende durchgehen')+' ('+fehlend+')</button></div>':'');
    $('deck-fortschritt').innerHTML=total===0?'':'fertig · <b>'+erfasst+'</b> / '+total+' erfasst'+balken;
    setzeBalken();
    renderDeckVerlauf();  // gerade auf der End-Karte will man die Runde noch korrigieren können
    const bf=karte.querySelector('[data-fehlende]'); if(bf) bf.onclick=()=>{ deckNurOhne=true; neuesDeck(false); mitUebergang(renderDeck); };
    return;
  }
  const s=deckListe[deckIdx];
  $('deck-fortschritt').innerHTML='Karte '+(deckIdx+1)+' / '+total+' · <b>'+erfasst+'</b> erfasst'+balken;
  setzeBalken();
  // Wurde jemand waehrend der Runde als abwesend gestempelt, sagt es die Karte — sonst tippt
  // man ins Leere und bekommt erst danach den Guard-Toast.
  const fehltJetzt=(idxNow.get(s.nr)||{}).fehlt;
  karte.innerHTML='<span class="gross">'+esc(anzeigeVorname(s))+'</span><span class="sub">'+esc(anzeigeNachname(s))+(s.lb&&!beamerModus?' · LB':'')+'</span>'+
    (fehltJetzt?'<span class="deck-fehlt">fehlt heute ('+esc(FEHLT_WORT[fehltJetzt]||fehltJetzt)+') · ↓ weiter</span>':'');
  renderDeckVerlauf();
}
// Mitlaufende Runden-Historie (Zero-Feldtest): jede Buchung als Zeile, Tap → korrigieren.
// Nur UI-Log — die Wahrheit sind die Events (Korrektur = storno + neu, append-only).
const DECK_SYMBOL={'+':'＋','o':'o','-':'−'};
const DECK_WEITER=new Set(['+','o','-','note','verweigert','fehlt_o','fehlt_e','fehlt_u']);   // nach diesen Buchungen aus dem Schülerblatt kommt die nächste Karte
// „Diese Runde" zeigte nur, was per Swipe/Knopf gebucht wurde — was außerhalb der Karte kam (bis 03.10. das Mehr-Menü, heute Schülerblatt und Stempel)
// (Notiz, Note, zu spaet …), fehlte und liess sich dort folglich nicht antippen. Nachtragen
// statt Umbau: alles, was seit Rundenbeginn fuer einen Schueler DIESES Decks entstand.
// Bewertungen tragen ihr Symbol, alles andere ein Stift — der Tap fuehrt in dieselbe Korrektur.
function ergaenzeVerlaufAusEvents(){
  const k=kurs(); if(!k||!deckRundeStart) return;
  const imDeck=new Set(deckListe.map(s=>s.nr)), nrVon=nrNachSid(k.id);   // Eintrag → Kind über die sid (v2.2)
  const bekannt=new Set(deckVerlauf.map(v=>v.evId).filter(Boolean));
  const neu=wirksameEvents(vault.events).filter(e=>
    e.kursId===k.id&&e.datum===terminDatum&&imDeck.has(nrVon.get(e.sid))&&
    e.typ!=='storno'&&String(e.ts||'')>=deckRundeStart&&!bekannt.has(e.id));
  for(const e of neu.sort((a,b)=>String(a.ts).localeCompare(String(b.ts)))){
    const nr=nrVon.get(e.sid), s=stammKind(nr);
    deckVerlauf.unshift({nr,name:s?anzeigeVorname(s):'?',
      evId:e.id,typ:DECK_SYMBOL[e.typ]?e.typ:null,fremd:!DECK_SYMBOL[e.typ]});
  }
}
function renderDeckVerlauf(){
  const box=$('deck-verlauf'); if(!box) return;
  // Zurückgenommene Buchungen (Undo-Chip, ⌫, Verlauf-↶) nicht weiter als gültig zeigen — sonst stornierte eine
  // spätere Korrektur das schon stornierte Event, und das neue blieb stehen (Prüfer 2026-09-29)
  const wirksam=new Set(wirksameEvents(vault.events).map(e=>e.id));
  for(const v of deckVerlauf) if(v.evId&&!wirksam.has(v.evId)){ v.evId=null; v.typ=null; v.fremd=false; }
  ergaenzeVerlaufAusEvents();
  // NICHT mehr ein-/ausblenden: das Feld hielt bis zur ersten Buchung keinen Platz und schob
  // die Karte danach zur Seite (Zero am Gerät 2026-08-30). Leer steht jetzt ein ruhiger Hinweis.
  box.replaceChildren(
    el('div',{class:'rail-titel'},'Diese Runde'),
    ...(deckVerlauf.length?[]:[el('p',{class:'dv-leer'},'Noch nichts gebucht.')]),
    ...deckVerlauf.map(v=>el('button',{class:'dv-zeile'+(v.typ?'':' leer'),onclick:()=>deckKorrektur(v)},
      el('span',{class:'dv-name'},v.name),
      el('span',{class:'dv-mark'+(v.typ==='+'?' plus':v.typ==='-'?' minus':'')},
        v.typ?DECK_SYMBOL[v.typ]:iconEl(v.fremd?'notiz':'entfernen')))));
}
function deckKorrektur(v){
  const setze=typ=>{
    if(typ&&!bewertGuard(v.nr)){ dlgZu(); return; }   // Abwesende nicht bewerten — der Guard galt hier bisher nicht
    if(v.evId){ const alt=vault.events.find(x=>x.id===v.evId); if(alt) stornoVon(alt); }
    if(typ){ const e=addEvent(typ,v.nr); v.evId=e?e.id:null; v.typ=e?typ:null; }
    else { v.evId=null; v.typ=null; }
    v.fremd=false;
    dlgZu(); renderDeckVerlauf(); zeigeDeckKarte(); toast(v.name+': '+(typ?DECK_SYMBOL[typ]:'Eintrag entfernt'));
  };
  // Zeilen aus dem Schülerblatt (Notiz, Note, abwesend …; bis 03.10. das „Mehr-Menü“) nur zeigen und entfernen, nie durch ＋/o/− ERSETZEN —
  // sonst verschwand z. B. eine Abwesenheit still hinter einem ＋ (Prüfer 2026-09-29)
  if(v.fremd){
    const alt=vault.events.find(x=>x.id===v.evId);
    dlgZeigenEl(el('h3',{},v.name),
      el('p',{class:'u-hinweis'},'Eintrag außerhalb der Karte: '+(alt?(TYP_LABEL[alt.typ]||alt.typ):'—')+'. Bewerten geht über die Karte.'),
      el('div',{class:'btn-reihe'},
        ...(v.evId?[el('button',{class:'btn gefahr',onclick:()=>setze(null)},'Eintrag entfernen')]:[]),
        el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
    return;
  }
  const wahl=typ=>el('button',{class:'btn'+(v.typ===typ?'':' still'),onclick:()=>setze(typ)},DECK_SYMBOL[typ]);
  dlgZeigenEl(
    el('h3',{},v.name+' korrigieren'),
    el('p',{class:'u-hinweis'},'Aktuell: '+(v.typ?DECK_SYMBOL[v.typ]:'kein Eintrag')+' — neu wählen oder entfernen.'),
    el('div',{class:'btn-reihe'},wahl('+'),wahl('o'),wahl('-')),
    el('div',{class:'btn-reihe'},
      ...(v.typ?[el('button',{class:'btn gefahr',onclick:()=>setze(null)},'Eintrag entfernen')]:[]),
      el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
}
function deckAktion(aktion){
  if(busy||deckIdx>=deckListe.length) return;
  // Zweites Netz: gehört die Runde nicht mehr zum aktiven Kurs, wird nichts gebucht (sonst ＋ unter fremder Nr)
  if(deckListe._kurs!==aktiverKursId){ neuesDeck(false); zeigeDeckKarte(); toast('Kurs gewechselt — neue Runde'); return; }
  if(deckListe._datum!==terminDatum){ neuesDeck(false); zeigeDeckKarte(); toast('Datum gewechselt — neue Runde'); return; }   // „Stunde wählen“ geht auch im Deck (Prüfer N3)
  const s=deckListe[deckIdx];
  // ↑ öffnet das Schülerblatt (Scheibe 5, Zero 03.10.: „A · Schülerblatt“). Weiter geht es nach einer Bewertung oder Abwesenheit; nach Notiz,
  // „zu spät“ oder Lernzeit bleibt die Karte für − o + stehen (Prüfer 03.10. ❓ 8)
  if(aktion==='notiz'){ schuelerBlatt(s.nr,{danach:typ=>{ if(aktView!=='deck'||deckListe[deckIdx]!==s) return; if(DECK_WEITER.has(typ)) deckAktion('skip'); else { zeigeDeckKarte(); renderDeckVerlauf(); } }}); return; }
  // Der Bewertungs-Guard galt bisher nur fuer den Stempelpfad (stempleKachel). Das Deck baut
  // seine Liste zwar ohne Abwesende, prueft aber NICHT nach: wer waehrend der laufenden Runde
  // als abwesend gestempelt wird (kurzer Wechsel nach „Heute"), blieb im Stapel und liess sich
  // bewerten — genau das, was der Guard anderswo verhindert. Zero-Befund 2026-08-30.
  // zeigeDeckKarte() danach: der Hinweis auf der Karte soll SOFORT stehen, nicht erst beim
  // naechsten Kartenwechsel — sonst tippt man ein zweites Mal ins Leere.
  if((aktion==='+'||aktion==='o'||aktion==='-')&&!bewertGuard(s.nr)){ zeigeDeckKarte(); return; }
  setzeBusy(true);
  if(aktion==='+'||aktion==='o'||aktion==='-'){
    const e=addEvent(aktion,s.nr);
    if(e) deckVerlauf.unshift({nr:s.nr,name:anzeigeVorname(s),evId:e.id,typ:aktion});
  }
  const karte=$('deck-karte');
  const reduziert=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const weiter=()=>{
    karte.classList.remove('weg-plus','weg-minus','weg-weiter');
    deckIdx++; zeigeDeckKarte();
    if(!reduziert){ karte.classList.remove('rein'); void karte.offsetWidth; karte.classList.add('rein'); }
    setzeBusy(false);
  };
  if(reduziert){ weiter(); return; }
  karte.classList.remove('rein');  // sonst überschreibt die spätere .rein-Regel die weg-Animation ab Karte 2 (iPad-Feldtest: „nur der erste animiert")
  karte.classList.add(aktion==='+'?'weg-plus':aktion==='-'?'weg-minus':'weg-weiter');
  let fertig=false;
  const einmal=e=>{ if(fertig) return; if(e&&e.animationName==='kladde-karte-rein') return; fertig=true; karte.removeEventListener('animationend',einmal); weiter(); };
  karte.addEventListener('animationend',einmal);
  setTimeout(einmal,320); // Failsafe, falls animationend ausbleibt
}
document.querySelectorAll('[data-deck]').forEach(b=>b.addEventListener('click',()=>deckAktion(b.dataset.deck==='skip'?'skip':b.dataset.deck)));
(function deckSwipe(){
  const karte=$('deck-karte');
  let start=null;
  // Knöpfe auf der Karte (End-Karte „Fehlende durchgehen") nicht als Wisch-Start: die Pointer-Capture lenkte ihren Klick auf die Karte um
  karte.addEventListener('pointerdown',e=>{ if(e.target.closest('button')) return; start=[e.clientX,e.clientY]; try{karte.setPointerCapture(e.pointerId);}catch{} });
  const ende=e=>{
    if(!start) return;
    const dx=e.clientX-start[0], dy=e.clientY-start[1]; start=null;
    const ax=Math.abs(dx), ay=Math.abs(dy);
    if(Math.max(ax,ay)<40) return;
    if(ax>ay) deckAktion(dx>0?'+':'-');
    else deckAktion(dy>0?'skip':'notiz');
  };
  karte.addEventListener('pointerup',ende);
  document.addEventListener('pointercancel',()=>{start=null;},{capture:true}); // Härtungs-Regel 1
})();
// PC-Pfeiltasten fürs Deck (P4.4): ← − · → + · ↑ Schülerblatt (Scheibe 5) · ↓ weiter — nur in der Deck-Ansicht, nie über Dialog
document.addEventListener('keydown',e=>{
  if(aktView!=='deck'||!vault||$('dlg').open) return;
  const a={ArrowLeft:'-',ArrowRight:'+',ArrowUp:'notiz',ArrowDown:'skip'}[e.key];
  if(!a) return;
  e.preventDefault(); deckAktion(a);
});
// Setter für Ansichten-Module (A2 Schnitt 4): ein Import ist schreibgeschützt, geschrieben wird von außen nur hierüber
function setzeDeckListe(w){ deckListe=w; }
function setzeDeckVerlauf(w){ deckVerlauf=w; }


export { deckListe, deckIdx, deckNurOhne, deckRundeStart, deckVerlauf, baueDeckListe, deckBasis, mischeArray, neuesDeck, renderDeckOptionen, renderDeck, zeigeDeckKarte, DECK_SYMBOL, DECK_WEITER, ergaenzeVerlaufAusEvents, renderDeckVerlauf, deckKorrektur, deckAktion, setzeDeckListe, setzeDeckVerlauf };
