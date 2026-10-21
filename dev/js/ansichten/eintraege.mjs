// Kladde · js/ansichten/eintraege.mjs — Abschnitt „ZUSTAND-HELPERS“ (A2 Schnitt 4: wörtlich aus js/app.mjs, verhaltensneutral).
// Ansichten dürfen einander direkt importieren, der Kern (js/kern/) nie eine Ansicht (Zero 19.10.: „Direkt, Kern ringfrei“).
import { lnr, nachListe } from '../../logic/teilnehmer.mjs?v=3.0.0.1792601998';
import { ersetzungFuer, wirksameEvents } from '../../logic/verdichtung.mjs?v=3.0.0.1792601998';
import { dlgKurs, dlgZeigenEl } from '../kern/dialog.mjs?v=3.0.0.1792601998';
import { $, el, toast } from '../kern/dom.mjs?v=3.0.0.1792601998';
import { iconEl } from '../kern/icons.mjs?v=3.0.0.1792601998';
import { altSid } from '../../logic/identitaet.mjs?v=3.0.0.1792601998';
import { geraetId, speichern } from '../kern/tresor.mjs?v=3.0.0.1792601998';
import { GERAET } from '../kern/umgebung.mjs?v=3.0.0.1792601998';
import { aktiverKursId, beamerModus, setzeBeamerModus, terminDatum, vault } from '../kern/zustand.mjs?v=3.0.0.1792601998';
import { anzeigeVorname, BEWERTUNGS_TYPEN } from './heute.mjs?v=3.0.0.1792601998';
import { renderAlles } from './navigation.mjs?v=3.0.0.1792601998';
import { buchungsStunde, kursGewechselt } from './stempel.mjs?v=3.0.0.1792601998';
import { mappeLeeren } from './mappe.mjs?v=3.0.0.1792601998';

/* ═══ ZUSTAND-HELPERS ═══ */
let aktiverSchueler=null, undoStack=[];
function kurs(){ return vault?.stamm.kurse.find(k=>k.id===aktiverKursId)||null; }
function kursSchueler(k){ return nachListe((vault.stamm.schueler[k.id]||[]).filter(s=>!s.inaktiv)); } // Deaktivierte (Tombstone) bleiben im Stamm, aber aus allen Listen/Plänen · nach Listen-Nr (zwei Nummern, WAHL U12)
// Bewertungs-Modus: bildet die 3 Fälle (Sek I=Drittel · Sek II=Punkte · Sek II=Drittel)
// auf die getestete 2-Wege-Logik ab — Sek-II-Drittel rechnet wie Sek I (Drittelnoten 1–6).
function bewertProfil(k){ return (k&&k.profil==='sek2'&&(k.notenmodus||'punkte')!=='drittel')?'sek2':'sek1'; }
// ── Identität (v2.2, Zero 19.10. „W2 · alle Lesestellen umstellen“) ──
// Ein Eintrag gehört über seine sid zum Kind (logic/identitaet.mjs). Die Ansichten reichen weiter die Ausweis-Nr als Griff herum: sie ist
// im Kurs eindeutig, der Abgleich vergibt sie bei Kollision neu. Diese Helfer sind die einzige Brücke zwischen Nr und sid; kein
// Eintrag wird mehr über e.schuelerNr einem Kind zugeordnet (das Feld steht nur noch in Einträgen von vor v2.2).
function sidVonNr(nr,k=kurs()){
  if(!k||nr==null) return null;
  const s=(vault.stamm.schueler[k.id]||[]).find(x=>x.nr===nr);
  return s?(s.sid||altSid(k.id,s.nr)):null;
}
function kindVonEvent(e){ return e&&e.sid?(vault.stamm.schueler[e.kursId]||[]).find(s=>s.sid===e.sid)||null:null; }
function nrVonEvent(e){ const s=kindVonEvent(e); return s?s.nr:null; }
// sid → Ausweis-Nr eines Kurses in einem Durchlauf (für Schleifen über alle Einträge)
function nrNachSid(kursId){ return new Map((vault.stamm.schueler[kursId]||[]).map(s=>[s.sid||altSid(kursId,s.nr),s.nr])); }
function addEvent(typ,nr,extra={}){   // nr: Ausweis-Nr als Griff der Ansicht; gebunden wird die sid
  if(dlgKurs&&kursGewechselt({kursId:dlgKurs})) return null;   // offener Dialog eines anderen Kurses: dieselbe Nr ist hier ein anderes Kind (dlgOeffnen)
  const k=kurs();
  if(k&&k.status==='archiviert'){ toast('Archivierter Kurs — schreibgeschützt'); return null; } // P3.3
  const sid=sidVonNr(nr,k);
  if(!sid){ toast('Kind nicht im Kurs — nichts gebucht'); return null; }   // nie ein Eintrag ohne Kind (v2.2)
  const e={id:crypto.randomUUID(),typ,sid,kursId:aktiverKursId,datum:terminDatum,ts:new Date().toISOString(),geraet:GERAET,geraetId,...extra};
  // ⏰ und ∅ tragen ihre Stunde (v1.17.1 Blockmodell): Doppelstunde (Zero 03.10.: „Dazuzählen, wenn es ein späterer Block ist“), und ⏰ nimmt
  // das ∅ derselben Stunde zurück (Zero: „⏰ nimmt ∅ zurück“) — beides regelt ersetzungFuer unten. Die Stunde kommt frisch aus der Uhr
  // (buchungsStunde), nicht aus der Autowahl: dort galt in der Pause schon der nächste Block (Prüfer 03.10. 🔴 1)
  if((typ==='versp'||typ==='fehlt_o')&&e.blockNr==null){ const st=buchungsStunde(e.datum); if(st) e.blockNr=st.blockNr; }
  // Direkt entschuldigt/unentschuldigt an einem Tag mit offenem ∅ = Klärung dieses ∅ — sonst blieb es offen stehen
  // (Klärungsliste, Kurs-Badge, Kurzbericht „1× ungeklärt“ UND „1× entschuldigt“; Prüfer 2026-09-29). Hat ⏰ das ∅ schon ersetzt („kommt
  // doch“), klärt e/u es mit — sonst stünde es nach einem ↶ der Verspätung neben dem e (Prüfer 03.10. 🟢 7)
  if((typ==='fehlt_e'||typ==='fehlt_u')&&!e.stornoVon){
    const w=wirksameEvents(vault.events), gleich=x=>x.typ==='fehlt_o'&&x.kursId===e.kursId&&x.sid===sid&&x.datum===e.datum;
    const o=w.find(gleich)||vault.events.find(x=>gleich(x)&&w.some(v=>v.typ==='versp'&&v.stornoVon===x.id));
    if(o) e.stornoVon=o.id;
  }
  // Ein Zeichen je Stunde (Zero 2026-09-29): die neue Bewertung ersetzt die bisherige, ↶ bringt sie zurück (logic/verdichtung). Ebenso je Stunde
  // ⏰ und ∅: eine neue Verspätung ersetzt die bisherige oder das ∅ („kommt doch“), ein ∅ ersetzt die Verspätung
  const ers=ersetzungFuer(vault.events,e);
  if(ers){
    for(const a of ers.still) vault.events.push(stornoEreignis(a));
    e.stornoVon=ers.ersetzt.id;
    if(ers.notiz) e.notiz=ers.notiz;
  }
  vault.events.push(e);
  undoStack.push(e); if(undoStack.length>50) undoStack.shift();
  speichern();
  zeigeUndo(e,ers?ers.ersetzt:null);
  return e;
}
function stornoEreignis(e){ return {id:crypto.randomUUID(),typ:'storno',sid:e.sid,kursId:e.kursId,datum:e.datum,ts:new Date().toISOString(),geraet:GERAET,geraetId,stornoVon:e.id}; }
function stornoVon(e){
  if(dlgKurs&&kursGewechselt({kursId:dlgKurs})) return false;   // wie addEvent: ein Dialog des alten Kurses nimmt nichts mehr zurück (dlgOeffnen)
  // Archiv ist schreibgeschützt — auch für Rücknahmen (vorher: addEvent schützte, ↶/„Irrtum" nicht · Prüfer 2026-09-29)
  const k=vault.stamm.kurse.find(x=>x.id===e.kursId);
  if(k&&k.status==='archiviert'){ toast('Archivierter Kurs — schreibgeschützt'); return false; }
  vault.events.push(stornoEreignis(e)); speichern();
  return true;
}
const TYP_LABEL={'+':'＋','o':'o','-':'−',mat:'Material',ipad_fehlt:'iPad fehlt',ipad_leer:'iPad leer',lernzeit:'Lernzeit/HA',ha:'HA',fehlt_o:'abwesend',fehlt_e:'fehlt (e)',fehlt_u:'fehlt (u)',versp:'zu spät',notiz:'Notiz',note:'Note',quartalsnote:'Quartalsnote',verweigert:'verweigert (6)'};
// Kompaktes Symbol eines Eintrags (für die entfernbaren Heute-Chips in der Aktionsbar)
// Undo/Redo-Chip: erscheint pro Aktion und BLENDET nach 6 s sanft aus (Zero-Feldtest 2026-07-10:
// ein klebender Chip stört — für späte Korrekturen gibt es Verlauf-↶ und die Deck-Historie).
// Ein Storno bietet sofort den Gegenweg an (zeigeRedo).
function chipZeig(ikon,text,onTap){
  const chip=$('undo-chip');
  chip.replaceChildren(iconEl(ikon),' '+text);
  clearTimeout(chip._t1); clearTimeout(chip._t2);
  chip.classList.remove('weg'); chip.classList.add('hidden'); void chip.offsetWidth; chip.classList.remove('hidden');
  chip._t1=setTimeout(()=>chip.classList.add('weg'),5600);
  chip._t2=setTimeout(()=>{ chip.classList.add('hidden'); chip.classList.remove('weg'); },6050);
  chip.onclick=()=>{ clearTimeout(chip._t1); clearTimeout(chip._t2); chip.classList.remove('weg'); onTap(); };
}
function eintragLabel(e){ return e.typ==='note'?(e.best?'bes. Leistung':'Note '+e.wert):e.typ==='versp'&&e.minuten?'zu spät '+e.minuten+' min':e.typ==='quartalsnote'&&e.hj&&e.quartal?'Q'+((e.hj-1)*2+e.quartal)+'-Note '+e.wert+((e.einheit?e.einheit==='punkte':kursSek2(e.kursId))?' P':e.einheit==='drittel'&&kursSek2(e.kursId)?' (Drittel)':''):(TYP_LABEL[e.typ]||e.typ); }
// Was Chip und Meldung zeigen: am Beamer keine Bewertung im Klartext (Prüfer 03.10. 🟡 4; die Regel „Bewertungen … immer verborgen“)
function kursSek2(id){ return bewertProfil(vault&&vault.stamm.kurse.find(x=>x.id===id))==='sek2'; }   // Chip „Q1-Note 11 P“ wie die Meldung (Prüfer 03.10. 🟢 9)
function sichtLabel(e){ return beamerModus&&(BEWERTUNGS_TYPEN.has(e.typ)||e.typ==='quartalsnote')?'Bewertung':eintragLabel(e); }   // auch keine Quartalsnote (Prüfer 03.10. 🟢 10)
function zeigeUndo(e,ersetzt){
  const s=kindVonEvent(e);
  // Ersetzen sichtbar machen (Mechanik erklärt sich selbst): „o → ＋“ — ein Tap bringt das alte Zeichen zurück
  chipZeig('rueck',(s?anzeigeVorname(s):'?')+': '+(ersetzt?sichtLabel(ersetzt)+' → ':'')+sichtLabel(e),
    ()=>{ stornoVon(e); toast('Rückgängig: '+sichtLabel(e)+wiederDa(e)); renderAlles(); zeigeRedo(e); });   // alle Ansichten — Deck/Schüler blieben sonst veraltet
}
// Nach einer Rücknahme: was das zurückgenommene Event ersetzt oder geklärt hatte, gilt wieder („— wieder o“)
function wiederDa(e){
  const w=e.stornoVon?wirksameEvents(vault.events).find(x=>x.id===e.stornoVon):null;
  return w?' — wieder '+sichtLabel(w):'';
}
// Storniertes Original mit einem Tap wieder einbuchen — append-only bleibt gewahrt (kein Löschen,
// der Storno bleibt im Log; addEvent stempelt id/ts frisch, alle Sachfelder reisen mit).
// v2.2: das Kind kommt über die sid (nrVonEvent), Gerät und Kennung stempelt addEvent neu; ein Eintrag aus v2 trägt noch schuelerNr — weg damit.
function bucheErneut(e){
  const {id:_id,ts:_ts,geraet:_ge,geraetId:_gi,stornoVon:_sv,sid:_sid,schuelerNr:_nr,typ,...sach}=e;
  return addEvent(typ,nrVonEvent(e),sach);
}
function zeigeRedo(e){
  const s=kindVonEvent(e);
  chipZeig('wieder',(s?s.vorname:'?')+': '+(TYP_LABEL[e.typ]||e.typ)+' wiederherstellen',
    ()=>{ bucheErneut(e); toast('Wiederhergestellt: '+(TYP_LABEL[e.typ]||e.typ)); renderAlles(); });
}
function schuelerVonNr(nr){ const k=kurs(); return k?kursSchueler(k).find(s=>s.nr===nr):null; }
// Nur zum Zeigen: das Kind zu einer Ausweis-Nr aus dem VOLLEN Stamm, Deaktivierte eingeschlossen (WAHL U1) — ein deaktiviertes
// Kind mit offenem ∅ stand sonst als „Nr 7“ in der Klärliste
function stammKind(nr,k=kurs()){ return k?(vault.stamm.schueler[k.id]||[]).find(s=>s.nr===nr)||null:null; }
const listenNr=s=>lnr(s)??'';   // sichtbare Nr = Listen-Nr (Mappenzeile); die Ausweis-Nr s.nr sieht niemand

// Aggregierter Tages-Stand (für Sitzplan-Symbole + Detail). EIN Reduzierer, zwei Zugänge:
// standAmTermin(nr) für Einzel-Abfrage · tagesStandIndex(datum) für den ganzen Sitzplan in einem Durchlauf.
function leererStand(){ return {plus:0,neutral:0,minus:0,mat:0,ipad:0,lernzeit:0,notiz:0,note:null,best:false,fehlt:null,versp:0,verweigert:0,count:0}; }
function reduziereStand(evs){
  const st=leererStand(); st.count=evs.length;
  for(const e of evs){
    if(e.typ==='+') st.plus++;
    else if(e.typ==='o') st.neutral++;
    else if(e.typ==='-') st.minus++;
    else if(e.typ==='mat'||e.typ==='ha') st.mat++;
    else if(e.typ==='ipad_fehlt'||e.typ==='ipad_leer') st.ipad++;
    else if(e.typ==='lernzeit') st.lernzeit++;
    else if(e.typ==='notiz') st.notiz++;
    else if(e.typ==='note'){ st.note=e.wert; st.best=!!e.best; }  // best = via ⭐-Stempel (Kachel zeigt ⭐ statt 📊)
    else if(e.typ==='fehlt_e') st.fehlt='e';
    else if(e.typ==='fehlt_u') st.fehlt='u';
    else if(e.typ==='fehlt_o'&&st.fehlt!=='e'&&st.fehlt!=='u') st.fehlt='o'; // abwesend (offen, ungeklärt) — e/u gewinnen
    else if(e.typ==='versp') st.versp+=e.minuten||0;
    else if(e.typ==='verweigert') st.verweigert++;
  }
  return st;
}
// Bewertungen eines Tages-Stands: ＋/o/−, Note (📊 und ⭐ schreiben `note`) und ⊘ — dieselben Typen wie
// BEWERTUNGS_TYPEN. EINE Quelle für Erfasst-Zähler, Deck-Filter, End-Karte und Zufallsgewicht
// (Zero 2026-09-29: ⭐ und ⊘ galten dort nicht als Bewertung, die Kinder blieben im Deck).
function anzahlBewertungen(st){ return st?st.plus+st.neutral+st.minus+(st.note!=null?1:0)+st.verweigert:0; }
function standAmTermin(nr,datum){
  const sid=sidVonNr(nr);
  return reduziereStand(wirksameEvents(vault.events).filter(e=>e.kursId===aktiverKursId&&e.sid===sid&&e.datum===datum));
}
function tagesStandIndex(datum){
  const byNr=new Map(), nrVon=nrNachSid(aktiverKursId);
  for(const e of wirksameEvents(vault.events)){
    if(e.kursId!==aktiverKursId||e.datum!==datum) continue;
    const nr=nrVon.get(e.sid); if(nr==null) continue;
    let a=byNr.get(nr); if(!a){ a=[]; byNr.set(nr,a); }
    a.push(e);
  }
  const idx=new Map();
  for(const [nr,evs] of byNr) idx.set(nr,reduziereStand(evs));
  return idx;
}
const WOCHENTAG_KURZ=['So','Mo','Di','Mi','Do','Fr','Sa'];
function datumLabel(iso){ const [y,m,d]=iso.split('-').map(Number); const dt=new Date(y,m-1,d); return WOCHENTAG_KURZ[dt.getDay()]+' '+String(d).padStart(2,'0')+'.'+String(m).padStart(2,'0')+'.'; }
// Der Beamer-Knopf wohnt in der Heute-Leiste, die bei jedem Zeichnen neu entsteht — darum ein fester Verweis statt $('btn-beamer')
const BTN_BEAMER=el('button',{class:'ds-icon',id:'btn-beamer',type:'button',title:'Beamer-Modus: Bewertungen verstecken','aria-label':'Beamer-Modus',onclick:()=>setzeBeamer(!beamerModus)});
function setzeBeamer(an){
  setzeBeamerModus(an); localStorage.setItem('kladde_beamer',an?'1':'0');
  document.body.classList.toggle('beamer',an);
  document.body.classList.toggle('nurplan',an&&localStorage.getItem('kladde_beamer_nurplan')==='1');
  BTN_BEAMER.classList.toggle('aktiv',an); BTN_BEAMER.setAttribute('aria-pressed',String(an));
  $('beamer-hinweis').classList.toggle('hidden',!an);
  if(an){ $('undo-chip').classList.add('hidden'); $('toast').classList.add('hidden'); mappeLeeren(); }   // Mappe nie im Beamer, auch nicht im versteckten DOM (Prüfer 21.10. 🔴, B0)   // Chip/Meldung von VOR dem Einschalten nennen die Bewertung im Klartext (Prüfer 03.10. 🟢 10)
  renderAlles(); // kurz/nurplan wirken über alle Ansichten (Kachel, Deck, Aktionsbar)
}
// Beamer-Optionen-Sheet (§6): Namen abkürzen · Nur Sitzplan — Bewertungen/LB bleiben immer verborgen
// Beamer-Optionen als Schalter (Scheibe 5, Zero 03.10.: „Ja, Schalter“): sie gelten sofort, darum kein „Fertig“ — nur ×
function beamerOptionenSheet(){
  const opt=(key,label,unter)=>{
    const b=el('button',{type:'button',class:'btn still schalter',role:'switch','aria-checked':String(localStorage.getItem(key)==='1'),'aria-label':label,'aria-describedby':'sw-'+key,dataset:{opt:key},
      onclick:()=>{ const an=localStorage.getItem(key)!=='1'; localStorage.setItem(key,an?'1':'0'); b.setAttribute('aria-checked',String(an));
        if(beamerModus){ document.body.classList.toggle('nurplan',localStorage.getItem('kladde_beamer_nurplan')==='1'); renderAlles(); } }},
      el('span',{class:'schalter-text'},el('b',{},label),el('small',{id:'sw-'+key},unter)),el('span',{class:'schalter-knopf','aria-hidden':'true'}));
    return b;
  };
  dlgZeigenEl(el('h3',{},iconEl('auge'),' Projektionsmodus'),
    el('p',{class:'u-hinweis'},'Bewertungen und LB-Hinweise sind bei aktiver Projektion immer verborgen. Änderungen gelten sofort.'),
    el('div',{class:'schalter-liste'},opt('kladde_beamer_kurz','Namen abkürzen','E. Y. statt Emil Yilmaz'),opt('kladde_beamer_nurplan','Nur der Sitzplan','Datum und Extras ausblenden')));
}
// Setter für Ansichten-Module (A2 Schnitt 4): ein Import ist schreibgeschützt, geschrieben wird von außen nur hierüber
function setzeAktiverSchueler(w){ aktiverSchueler=w; }


export { aktiverSchueler, undoStack, kurs, kursSchueler, bewertProfil, sidVonNr, kindVonEvent, nrVonEvent, nrNachSid, addEvent, stornoEreignis, stornoVon, TYP_LABEL, chipZeig, eintragLabel, kursSek2, sichtLabel, zeigeUndo, wiederDa, bucheErneut, zeigeRedo, schuelerVonNr, stammKind, listenNr, leererStand, reduziereStand, anzahlBewertungen, standAmTermin, tagesStandIndex, WOCHENTAG_KURZ, datumLabel, BTN_BEAMER, setzeBeamer, beamerOptionenSheet, setzeAktiverSchueler };
