// Kladde · js/ansichten/kurswahl.mjs — Abschnitt „KURS-AUTOWAHL über Stundenplan-Slots“ (A2 Schnitt 4: wörtlich aus js/app.mjs, verhaltensneutral).
// Ansichten dürfen einander direkt importieren, der Kern (js/kern/) nie eine Ansicht (Zero 19.10.: „Direkt, Kern ringfrei“).
import { kursZurZeit, SLOT_ARTEN } from '../../logic/autowahl.mjs?v=3.0.1';
import { sortiereKurse } from '../../logic/kursSort.mjs?v=3.0.1';
import { stundeFaelltAus } from '../../logic/stunden.mjs?v=3.0.1';
import { blockLabel, formatZeit, resolveBloecke } from '../../logic/zeitmodell.mjs?v=3.0.1';
import { dlgKursBinden, dlgZeigenEl, dlgZu } from '../kern/dialog.mjs?v=3.0.1';
import { $, el, toast } from '../kern/dom.mjs?v=3.0.1';
import { iconEl } from '../kern/icons.mjs?v=3.0.1';
import { themeEff } from '../kern/theme.mjs?v=3.0.1';
import { aktiverKursId, aktiveTeilgruppe, aktView, anzeigeBlock, beamerModus, editorAktiv, heuteIso, setzeKursId, setzeTeilgruppe, setzeTermin, terminDatum, terminZuruecksetzen, vault } from '../kern/zustand.mjs?v=3.0.1';
import { beamerOptionenSheet, datumLabel, kurs, kursSchueler, setzeBeamer } from './eintraege.mjs?v=3.0.1';
import { angezeigteStunde, geheZuTag, planKontext, renderHeute, stundenplanAnsicht, stundeWaehlen } from './heute.mjs?v=3.0.1';
import { editorCleanup, sitzplanEditor } from './kurse.mjs?v=3.0.1';
import { mitUebergang, renderAlles } from './navigation.mjs?v=3.0.1';
import { zeigeHilfe } from './stempel.mjs?v=3.0.1';

/* ═══ KURS-AUTOWAHL über Stundenplan-Slots (freie Zeitfenster · 67,5-min-Schule) ═══ */
let autowahlInfo=null;   // {kursId, blockNr, startSek, endeSek, quelle} — für Heute-Kopf (§28)
// Handwahl (Zero-Entscheid 2026-09-02, Variante 1): die Kurs-Chip-Wahl hält BIS ZUM BLOCKWECHSEL — auch über
// Sperren/Entsperren und Neuladen hinweg. Gerätelokal in localStorage (nur Kurs-Id + Block, keine Schülerdaten);
// vorher war sie ein RAM-Flag, das jeder harte Autowahl-Lauf (Entsperren, Stundenplan speichern) überschrieb.
const HANDWAHL_KEY='kladde_handwahl';
function handwahlLesen(){ try{ const h=JSON.parse(localStorage.getItem(HANDWAHL_KEY)||'null'); return h&&h.datum===heuteIso()?h:null; }catch{ return null; } }
function handwahlSetzen(h){ if(h) localStorage.setItem(HANDWAHL_KEY,JSON.stringify(h)); else localStorage.removeItem(HANDWAHL_KEY); }
// true = Kurs oder Teilgruppe haben gewechselt → die AKTIVE Ansicht muss neu gezeichnet werden. Sonst bucht eine
// stehen gebliebene Deck-Karte oder Schülerliste nach dem Aufwachen in den neuen Kurs (Prüfer 2026-09-29).
// Wechselt dabei Kurs oder Gruppe, endet ein Nachtrag — an EINER Stelle für Takt, Rückkehr, Ausfall-Griffe des Stundenplans
// und Import (Prüfer 2026-10-01: sonst buchte die Vertretungsstunde auf das alte Nachtrag-Datum). Ein offener Sitzplan-Editor
// schließt vorher: er schreibt in das Raster SEINES Kurses (gleicher Grund wie die Editor-Sperre im Takt).
function kursAutowahl(){ const vk=aktiverKursId, vg=aktiveTeilgruppe; kursAutowahlKern();
  const wechsel=aktiverKursId!==vk||aktiveTeilgruppe!==vg;
  if(wechsel){ terminZuruecksetzen();
    aktualisiereKursChip(); nachtragLeisten(); }   // erst nach dem Zurücksetzen: der Kern schrieb den Chip noch mit dem alten Nachtrag (Prüfer 06.10., B1)
  if(aktiverKursId!==vk&&editorCleanup) editorCleanup();
  return wechsel; }
function kursAutowahlKern(){
  if(!vault) return;
  const jetzt=new Date();
  const zm=(vault.stamm.zeitmodelle||[])[0];
  autowahlInfo=null;
  let hand=handwahlLesen();
  if(hand&&!vault.stamm.kurse.some(k=>k.id===hand.kursId&&k.status!=='archiviert')){ handwahlSetzen(null); hand=null; }   // Kurs weg/archiviert → Handwahl gegenstandslos
  const handAnwenden=(bisSek)=>{ setzeKursId(hand.kursId); setzeTeilgruppe(hand.teilgruppe||null); $('kurs-slot').textContent=' · von Hand'+(bisSek!=null?' · bis '+formatZeit(bisSek,false):'')+(hand.teilgruppe?' · Gr. '+hand.teilgruppe:''); };
  if(zm){
    const t=kursZurZeit(jetzt,{zeitmodell:zm,wochenplan:wochenplanAktiv(),ausnahmen:vault.stamm.ausnahmeSlots||[]});
    if(t){
      const wtag=((jetzt.getDay()+6)%7)+1;
      const heuteIsoStr=heuteIso();
      const block=resolveBloecke(zm,wtag,heuteIsoStr).find(b=>b.blockNr===t.blockNr); // Kurztag-Daten → Zweitraster-Zeiten (S256b)
      autowahlInfo={...t,startSek:block.startSek,endeSek:block.endeSek};
      // Neuer laufender Block hebt die Handwahl auf — sie ist an den Block gebunden, in dem sie getroffen wurde
      if(hand&&t.quelle!=='kommend'&&hand.blockNr!==t.blockNr){ handwahlSetzen(null); hand=null; }
      if(hand) handAnwenden(block.endeSek);
      else {
        // Klassen-/Reservestunde (art, kein Kurs): der zuletzt aktive Kurs bleibt stehen, der Slot-Text sagt, was laut Plan läuft
        if(t.kursId){ setzeKursId(t.kursId); setzeTeilgruppe(gueltigeGruppe(t.kursId,t.teilgruppe)); }
        else if(!aktiverKursId||kursIstArchiviert(aktiverKursId)) setzeKursId(ersterKursId());
        $('kurs-slot').textContent=' · Std. '+blockLabel(zm,t.blockNr,heuteIsoStr)+' · '+formatZeit(block.startSek,false)+'–'+formatZeit(block.endeSek,false)+(t.art?' · '+SLOT_ARTEN[t.art].label:'')+(t.teilgruppe?' · Gr. '+t.teilgruppe:'')+(t.quelle==='kommend'?' (gleich)':'');
      }
      aktualisiereKursChip(); return;
    }
  }
  if(hand){ handAnwenden(null); aktualisiereKursChip(); return; }   // Pause/Freistunde: die Handwahl bleibt bis zum nächsten Block
  // Fallback: Alt-Slots (Expertenmodus, freie Zeitfenster) — bleibt, solange kein Wochenplan existiert
  const wtag=((jetzt.getDay()+6)%7)+1;
  const hhmm=String(jetzt.getHours()).padStart(2,'0')+':'+String(jetzt.getMinutes()).padStart(2,'0');
  const slot=vault.stamm.stundenplanSlots.find(s=>s.wochentag===wtag&&s.von<=hhmm&&hhmm<=s.bis);
  if(slot){ setzeKursId(slot.kursId); setzeTeilgruppe(slot.teilgruppe||null); $('kurs-slot').textContent=' · '+slot.von+'–'+slot.bis+(slot.teilgruppe?' · Gr. '+slot.teilgruppe:''); }
  else if(!aktiverKursId||kursIstArchiviert(aktiverKursId)) setzeKursId(ersterKursId());
  aktualisiereKursChip();
}
// Fallback: erster NICHT-archivierter Kurs des aktiven Schuljahres (nie ein Archiv-Kurs) — in Schul-Reihenfolge (5a zuerst)
function ersterKursId(){
  const aid=vault.stamm.aktivesSchuljahrId;
  const aktive=sortiereKurse(vault.stamm.kurse.filter(x=>x.status!=='archiviert'));
  const w=aktive.find(x=>(x.schuljahrId||aid)===aid)||aktive[0];
  return w?w.id:null;
}
function kursIstArchiviert(id){ const k=vault.stamm.kurse.find(x=>x.id===id); return k&&k.status==='archiviert'; }
// Wochenplan ohne Slots archivierter Kurse — der Schuljahreswechsel hängt die neuen Slots HINTER die alten, und
// slotFuerBlock nimmt den ersten Treffer: ohne Filter wählte die Autowahl den Vorjahreskurs (Prüfer 2026-09-29).
// Nur zum LESEN; der Wochenplan-Assistent bearbeitet weiter den vollständigen Plan (Archiv-Rückholung behält ihre Slots).
function wochenplanAktiv(){ return (vault.stamm.wochenplan||[]).filter(w=>!w.kursId||!kursIstArchiviert(w.kursId)); }
// 60-s-Tick (P2.5): nur bei sichtbarer Heute-Ansicht, nie über offene Dialoge hinweg
let autowahlTick=null;
function starteAutowahlTick(){
  clearInterval(autowahlTick);
  autowahlTick=setInterval(()=>{
    if(!vault||document.visibilityState!=='visible'||aktView!=='heute'||$('dlg').open||editorAktiv) return;   // nie im Sitzplan-Editor: Ziehen schriebe sonst in das Raster des neuen Kurses
    if(kursAutowahl()){ mitUebergang(renderHeute); const k=kurs(); toast('→ '+(k?k.name+' · '+k.fach:'')); }   // Kurswechsel beendet einen Nachtrag (kursAutowahl)
  },60000);
}
// Kurs-Chip (Kopf außer „Heute“): die Stunde, in die jetzt gebucht wird — dieselbe Quelle wie der Kopf in „Heute“ (angezeigteStunde),
// im Nachtrag mit Datum. Vorher kam sie aus der Autowahl: in der Pause „Std. 3 (gleich)“, gebucht in Std. 2; im Nachtrag die Stunde von
// heute, gebucht auf das Nachtrag-Datum (Prüfer 03.10. 🟢 5, gefunden 06.10.; Zero 06.10. „B · Chip und Leiste“). Ohne Zeitraster bleibt
// der Text der Alt-Slots (kursAutowahlKern), im Nachtrag Datum und „Nachtrag“.
// Nachtrag = Termin nicht heute, wie der Rand des Streifens in „Heute“ — auch nach Mitternacht ohne Sperre (Prüfer 06.10., B3)
function imNachtrag(){ return terminDatum!==heuteIso(); }
function aktualisiereKursChip(){
  const k=kurs(), zm=vault?planKontext().zeitmodell:null, nachtrag=!!k&&imNachtrag();
  $('kurs-name').textContent=k?k.name+' · '+k.fach:'Kein Kurs';
  $('kurs-chip').classList.toggle('nachtrag',nachtrag);
  if(!k){ $('kurs-slot').textContent=''; return; }
  if(!zm){ if(nachtrag) $('kurs-slot').textContent=' · '+datumLabel(terminDatum)+' · Nachtrag'; return; }   // Alt-Slots: sonst stünde das Zeitfenster von heute da (B4)
  const st=angezeigteStunde(k), h=handwahlLesen(), vonHand=!!h&&h.kursId===k.id&&!h.nurStunde&&!nachtrag;
  $('kurs-slot').textContent=(nachtrag?' · '+datumLabel(terminDatum):'')+(st?' · Std. '+blockLabel(zm,st.blockNr,terminDatum)+' · '+formatZeit(st.startSek,false)+(st.endeSek!=null?'–'+formatZeit(st.endeSek,false):''):'')
    +(aktiveTeilgruppe?' · Gr. '+aktiveTeilgruppe:'')+(vonHand?' · von Hand':'')+(nachtrag?' · Nachtrag':'');
}
// Nachtrag außerhalb von „Heute“ (Zero 06.10. „B · Chip und Leiste“): über der Deck-Karte und über der Schüler-Ansicht, wohin neue Einträge
// gehen, mit „↩ Heute“ wie in „Heute“ (geheZuTag; hat der Kurs heute keine Stunde, fragt der Dialog wie dort, N4). Ohne Nachtrag unsichtbar.
// Nur Datum und Stunde, kein Name. Neu gebaut nur bei neuem Text: sonst verlöre „↩ Heute“ bei jeder Deck-Karte den Fokus (Prüfer 06.10., B8).
function nachtragLeisten(){
  const k=vault?kurs():null, an=!!k&&imNachtrag(), st=an?angezeigteStunde(k):null, zm=an?planKontext().zeitmodell:null;
  const text=an?'Nachtrag: neue Einträge gehen auf '+datumLabel(terminDatum)+(st&&zm?' · Std. '+blockLabel(zm,st.blockNr,terminDatum):''):'';
  for(const [id,ansicht] of [['deck-nachtrag','deck'],['schueler-nachtrag','schueler']]){
    const l=$(id); l.hidden=!(an&&aktView===ansicht);
    if(l.hidden){ l.replaceChildren(); delete l.dataset.text; continue; }
    if(l.dataset.text===text) continue;
    l.dataset.text=text;
    l.replaceChildren(el('span',{class:'nachtrag-hinweis',role:'status'},text),
      el('button',{type:'button',class:'btn still u-btn-klein',dataset:{nachtragHeute:''},onclick:()=>{ geheZuTag(heuteIso()); if(!$('dlg').open) $('view-titel').focus({preventScroll:true}); }},'↩ Heute'));
  }
}
// Kurs-Chip (Kopf der anderen Ansichten) = „Stunde wählen“ — ersetzt den alten Dialog „Kurs wählen“ (Plan Scheibe 1b, Prüfer 2026-10-01)
$('kurs-chip').addEventListener('click',()=>{ if(vault) stundeWaehlen(terminDatum); });
// Plan-Gruppe nur, wenn der Kurs Schüler in ihr hat: sonst setzte sichtbareSchueler sie beim Zeichnen zurück, der nächste
// Autowahl-Lauf wertete das als Wechsel und beendete den Nachtrag — Stempel landeten auf heute (Prüfer-Nachprüfung N1, gemessen)
function gueltigeGruppe(kursId,g){ const k=g&&vault.stamm.kurse.find(x=>x.id===kursId); return k&&kursSchueler(k).some(s=>s.gruppe===g)?g:null; }
// Kurs direkt wechseln (Kurskarte, Kurs anlegen, Assistent, Import, Archiv öffnen): wie jeder Kurswechsel über die Autowahl —
// ein offener Sitzplan-Editor schließt vorher, ein Nachtrag endet, die Gruppe des alten Kurses fällt weg (Prüfer B1/B2/N2)
function kursWechseln(id){
  if(id!==aktiverKursId){ if(editorCleanup) editorCleanup(); setzeTermin(heuteIso()); setzeTeilgruppe(null); }
  setzeKursId(id); aktualisiereKursChip(); dlgKursBinden(id);   // von Hand gewählt: ein offener Dialog gilt jetzt dem neuen Kurs
}
// Halbgruppe von Hand oder aus der Plan-Stunde: als Handwahl am laufenden Block, sonst setzte der 60-s-Takt sie zurück
function gruppeWaehlen(g){ setzeTeilgruppe(g||null); handwahlSetzen({kursId:aktiverKursId,teilgruppe:aktiveTeilgruppe,datum:heuteIso(),blockNr:autowahlInfo?.blockNr??null}); }
// Nach einem Ausfall-Griff (Stundenplan, Scheibe 2): Autowahl neu — ein Ausfall der laufenden Stunde ändert den Kurs, ein Wechsel
// beendet den Nachtrag (kursAutowahl) — und die Ansicht dahinter IMMER auffrischen: sonst bliebe „Std. 3“ einer ausgefallenen Stunde
// oder in „Kurse“ die Plakette „läuft gerade“ stehen (Prüfer 2026-10-02). → Text „→ Kurs“ bei einem Wechsel, sonst ''.
function nachAusnahme(){
  // Ausfall löst auch die Kurswahl (Zero 06.10. „Ja, zurück zum laufenden Kurs“): fällt heute die gewählte Stunde des aktiven Kurses
  // (oder sein Hand-Block) aus, endet seine Handwahl, und die Autowahl nimmt den Kurs, der jetzt läuft. Im Nachtrag bleibt alles, wie es ist.
  const h=handwahlLesen(), ctx=planKontext();
  if(h&&h.kursId===aktiverKursId&&!imNachtrag()&&((anzeigeBlock!=null&&stundeFaelltAus(ctx,terminDatum,anzeigeBlock,aktiverKursId))
    ||(!h.nurStunde&&h.blockNr!=null&&stundeFaelltAus(ctx,terminDatum,h.blockNr,aktiverKursId)))) handwahlSetzen(null);
  const wechsel=kursAutowahl();
  if(!autowahlInfo&&!handwahlLesen()) $('kurs-slot').textContent='';   // kein Block mehr aktiv → alten Slot-Text nicht stehen lassen (eine Handwahl schreibt ihren eigenen)
  renderAlles();
  const k=wechsel?kurs():null;
  return k?'→ '+k.name+' · '+k.fach:'';
}
$('beamer-opt').addEventListener('click',beamerOptionenSheet);
$('beamer-aus').addEventListener('click',()=>setzeBeamer(false));   // Ausgang in jeder Ansicht — der Augen-Knopf sitzt seit v1.13.0 nur in der Heute-Leiste (Prüfer 2026-10-01)
$('btn-plan').addEventListener('click',()=>{ if(vault) stundenplanAnsicht(); });   // Stundenplan: seit 2026-10-01 unten in der linken Leiste (Zero: Rahmen verdichten)
$('btn-hilfe').addEventListener('click',()=>{ if(vault) zeigeHilfe(); });   // Hilfe je Ansicht (Scheibe 9, Zero 05.10. Wahl 1 C · 2 B · 3 B)
$('btn-hilfe-k').addEventListener('click',()=>{ if(vault) zeigeHilfe(); });   // Handy: eigenes „i“ in der Kopfzeile (Wahl 3 B), nicht mehr im ⋯-Menü
$('btn-menue').addEventListener('click',()=>{ if(vault) werkzeugMenue(); });
// Handy: was am iPad in der Leiste bzw. unten links sitzt, liegt hinter „⋯“ (Kopfzeile ist voll)
function werkzeugMenue(){
  const zeile=(icon,text,fn,an)=>el('button',{class:'btn still u-btn-block menue-zeile'+(an?' an':''),type:'button',onclick:()=>{ dlgZu(); fn(); }},iconEl(icon),el('span',{},text));
  const heute=aktView==='heute'&&!!kurs();
  dlgZeigenEl(el('h3',{},'Werkzeuge'),
    ...(heute?[zeile('sitzplan','Sitzplan bearbeiten',()=>{ if(aktiverKursId) sitzplanEditor(aktiverKursId); })]:[]),
    zeile('plan','Stundenplan',()=>stundenplanAnsicht()),
    zeile(beamerModus?'augeZu':'auge',beamerModus?'Beamer-Modus aus':'Beamer-Modus an',()=>setzeBeamer(!beamerModus),beamerModus),
    zeile(themeEff()==='tag'?'mond':'sonne',themeEff()==='tag'?'Nacht-Ansicht':'Tag-Ansicht',()=>$('btn-theme').click()),
    zeile('schloss','Sperren',()=>$('btn-lock').click()),
    el('div',{class:'btn-reihe'},el('button',{class:'btn still',type:'button',onclick:dlgZu},'Schließen')));
}


export { autowahlInfo, HANDWAHL_KEY, handwahlLesen, handwahlSetzen, kursAutowahl, kursAutowahlKern, ersterKursId, kursIstArchiviert, wochenplanAktiv, autowahlTick, starteAutowahlTick, imNachtrag, aktualisiereKursChip, nachtragLeisten, gueltigeGruppe, kursWechseln, gruppeWaehlen, nachAusnahme, werkzeugMenue };
