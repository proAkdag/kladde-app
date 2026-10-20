// Kladde · js/ansichten/heute.mjs — Abschnitt „HEUTE“ (A2 Schnitt 4: wörtlich aus js/app.mjs, verhaltensneutral).
// Ansichten dürfen einander direkt importieren, der Kern (js/kern/) nie eine Ansicht (Zero 19.10.: „Direkt, Kern ringfrei“).
import { gewichteteWahl, zufallsGewicht } from '../../logic/auswahl.mjs?v=2.4.0.1792533458';
import { ausnahmeEntfernen, entfallZurueck, geplanteBlockNrn, SLOT_ARTEN, slotFuerBlock, tagesAusfall } from '../../logic/autowahl.mjs?v=2.4.0.1792533458';
import { listenEintraege } from '../../logic/erfassListe.mjs?v=2.4.0.1792533458';
import { fachKuerzel } from '../../logic/fachfarben.mjs?v=2.4.0.1792533458';
import { sortiereKurse } from '../../logic/kursSort.mjs?v=2.4.0.1792533458';
import { setzeAufPlatz, belegteReihen as spBelegteReihen } from '../../logic/sitzplan.mjs?v=2.4.0.1792533458';
import { kalenderwoche, kursTag, naechsteStunde, stundeDesKurses, stundenAm, tagesStunden, tagPlus, wochentagVon } from '../../logic/stunden.mjs?v=2.4.0.1792533458';
import { lnr } from '../../logic/teilnehmer.mjs?v=2.4.0.1792533458';
import { istTerminEintrag, wirksameEvents } from '../../logic/verdichtung.mjs?v=2.4.0.1792533458';
import { blockLabel, formatZeit, istAWoche, istFerien, resolveBloecke } from '../../logic/zeitmodell.mjs?v=2.4.0.1792533458';
import { dlgBreit, dlgInhalt, dlgZeigenEl, dlgZu } from '../kern/dialog.mjs?v=2.4.0.1792533458';
import { $, el, esc, toast } from '../kern/dom.mjs?v=2.4.0.1792533458';
import { iconEl, iconHtml } from '../kern/icons.mjs?v=2.4.0.1792533458';
import { speichern, stammMutiert } from '../kern/tresor.mjs?v=2.4.0.1792533458';
import { aktiverKursId, aktiveTeilgruppe, beamerModus, editorAktiv, heuteIso, setzeAnzeigeBlock, setzeTeilgruppe, setzeTermin, stempelTyp, terminDatum, terminNachtrag, vault } from '../kern/zustand.mjs?v=2.4.0.1792533458';
import { addEvent, aktiverSchueler, anzahlBewertungen, bewertProfil, BTN_BEAMER, datumLabel, eintragLabel, kurs, kursSchueler, leererStand, schuelerVonNr, setzeAktiverSchueler, sidVonNr, stammKind, standAmTermin, stornoVon, tagesStandIndex, wiederDa, WOCHENTAG_KURZ, zeigeRedo } from './eintraege.mjs?v=2.4.0.1792533458';
import { faerbe, sitzplanEditor } from './kurse.mjs?v=2.4.0.1792533458';
import { autowahlInfo, gruppeWaehlen, gueltigeGruppe, handwahlSetzen, kursAutowahl, nachAusnahme, wochenplanAktiv } from './kurswahl.mjs?v=2.4.0.1792533458';
import { mitUebergang, renderAlles } from './navigation.mjs?v=2.4.0.1792533458';
import { buchungsStunde, hilfeNeu, kursGewechselt, noteDialog, notizDialog, pulseKachel, renderRail, schuelerBlatt, tagFeld, verspStempel } from './stempel.mjs?v=2.4.0.1792533458';
import { ausnahmeFuer, schultagAb, setzeAusnahme, setzeAusnahmen, stundenplanAssistent, WT_KURZ } from './stundenplan.mjs?v=2.4.0.1792533458';

/* ═══ HEUTE · Sitzplan 12×12 (Beamer-Regel: keine Werte sichtbar) ═══ */
let busy=false; // Härtungs-Regel 6: Eingabe-Lock
const stempelCooldown=new Set();   // ~80 ms je Kachel (Alex-Auflage): kein Doppel-Stempel beim Wischen
// Beamer „Namen abkürzen" (§6): „Elif Yilmaz" → „E. Y." bei Projektion (sensibel)
function beamerKurz(){ return beamerModus && localStorage.getItem('kladde_beamer_kurz')==='1'; }
function anzeigeVorname(s){ return beamerKurz()?(s.vorname?s.vorname[0]+'.':''):s.vorname; }
function anzeigeNachname(s){ return beamerKurz()?(s.name?s.name[0]+'.':''):s.name; }
// Liste statt Sitzplan (Zero 2026-10-01: „B mit der option nach vornamen zu sortieren“): nur am Handy, Wahl je Gerät.
// Die Zeilen tragen `kachel schueler` + data-nr — Stempel, leere Hand, Zufall und Puls laufen über dieselben Wege wie die Kacheln.
const HANDY=matchMedia('(max-width: 599px)');
function erfassWahl(){ return localStorage.getItem('kladde_erfassung')==='liste'?'liste':'sitzplan'; }
function listenSortierung(){ return localStorage.getItem('kladde_listen_sort')==='vorname'?'vorname':'nachname'; }
function sichtbareSchueler(k){
  const liste=kursSchueler(k);
  if(aktiveTeilgruppe){
    const g=liste.filter(s=>(s.gruppe||'')===aktiveTeilgruppe);
    if(g.length) return g;   // Gruppe existiert → filtern
    setzeTeilgruppe(null);    // Gruppe im Kurs nicht vorhanden → Filter fällt weg (kein leerer Plan)
  }
  return liste;
}
// ── „Stunde“ = Kurs + Datum in EINEM Element (Zero 2026-10-01, Untermenü-Runde Scheibe 1) ──
// ‹ › springt zur vorigen/nächsten Stunde DIESES Kurses laut Plan (logic/stunden.mjs), « » um eine Woche;
// ein Tipp auf die Stunde öffnet „Stunde wählen“: Woche + Stunden des Tages, ein Tipp öffnet (kein „Übernehmen“).
// Hat der Kurs an einem Tag weder Stunde noch Einträge, gibt es nur die Auswahl (Zero: „7b sollte dann nicht mehr sichtbar sein“).
function planKontext(){ return {zeitmodell:(vault.stamm.zeitmodelle||[])[0]||null,wochenplan:wochenplanAktiv(),ausnahmen:vault.stamm.ausnahmeSlots||[]}; }
// Kurs ohne Plan-Stunden (oder Schule ohne Zeitraster): ‹ › geht Schultag für Schultag, wie vorher der Kalender
function kursImPlan(k){ return !!planKontext().zeitmodell&&wochenplanAktiv().some(w=>w.kursId===k.id); }
// Planwechsel (Zero 02.10.): Tage mit Einträgen des Kurses zählen wie Plan-Tage — ein neuer Plan kennt die alten Tage nicht
function eintragsTage(kursId){ return new Set(wirksameEvents(vault.events).filter(e=>e.kursId===kursId&&istTerminEintrag(e)).map(e=>e.datum)); }
function kursKontext(k){ return {...planKontext(),eintragsTage:eintragsTage(k.id)}; }
// Tag für den aktiven Kurs zeigen: Termin + Halbgruppe der Plan-Stunde (null = ganzer Kurs). Heute gilt die Gruppe der laufenden Stunde der
// Autowahl, sonst die übergebene (Prüfer 2026-10-01: Gruppe und „Std.“ stimmten nicht). Eine Stunde wählt das Blättern nicht (setzeTermin): der
// Kopf nennt heute die Stunde der Buchung, im Nachtrag die erste des Tages (angezeigteStunde).
// renderAlles: „Stunde wählen“ gibt es auch in Deck und Schüler — eine stehen gebliebene Deck-Karte buchte sonst aufs neue Datum (N3)
function zeigeTag(datum,st){
  const k=kurs(), heute=datum===heuteIso(); if(heute&&k&&autowahlInfo?.kursId===k.id) st=autowahlInfo;
  setzeTermin(datum);
  const g=st&&k?gueltigeGruppe(k.id,st.teilgruppe):aktiveTeilgruppe;
  if(g!==aktiveTeilgruppe) gruppeWaehlen(g);
  mitUebergang(renderAlles);
}
// Tag öffnen — hat der Kurs dort laut Plan keine Stunde und keine Einträge, nur die Auswahl (Zero 2026-10-01: „7b sollte dann nicht mehr sichtbar sein“)
function geheZuTag(datum){
  const k=kurs(); if(!k) return;
  const st=kursImPlan(k)?kursTag(k.id,datum,kursKontext(k)):null;
  if(kursImPlan(k)&&!st){ stundeWaehlen(datum); return; }
  zeigeTag(datum,st);
}
function springeStunde(richtung){
  const k=kurs(); if(!k) return;
  const heute=heuteIso();
  const st=kursImPlan(k)?naechsteStunde(k.id,terminDatum,richtung,kursKontext(k),heute):null;
  const ziel=kursImPlan(k)?st?.datum:schultagAb(terminDatum,richtung);
  if(!ziel||ziel>heute){ toast(richtung<0?'Keine frühere Stunde im Plan':'Nachtrag geht nur in die Vergangenheit'); return; }
  zeigeTag(ziel,st);
}
function springeWoche(richtung){
  const k=kurs(); if(!k) return;
  const ziel=tagPlus(terminDatum,7*richtung);
  if(ziel>heuteIso()){ toast('Nachtrag geht nur in die Vergangenheit'); return; }
  geheZuTag(ziel);
}
// Die Stunde, die „Stunde“ nennt: die Stunde der Buchungen (buchungsStunde — gewählt, laufend, in der Pause die gerade beendete), im Nachtrag
// ohne Wahl die erste des Kurses an dem Tag. Kopf und Buchung zeigen so dieselbe Stunde (Prüfer 03.10. 🟡 3: Kopf „Std. 1“, gebucht auf 6)
function angezeigteStunde(k){
  const ctx=planKontext(); if(!ctx.zeitmodell) return null;
  const alle=stundenAm(terminDatum,ctx).filter(s=>s.kursId===k.id), st=k.id===aktiverKursId?buchungsStunde():null;
  return (st&&(alle.find(s=>s.blockNr===st.blockNr)||(st.startSek!=null?st:null)))||alle[0]||null;
}
function stundeUntertitel(k){
  const zm=planKontext().zeitmodell, st=angezeigteStunde(k);
  return datumLabel(terminDatum)+(st?' · Std. '+blockLabel(zm,st.blockNr,terminDatum)+' · '+formatZeit(st.startSek):'')+
    (aktiveTeilgruppe?' · Gr. '+aktiveTeilgruppe:'')+(terminNachtrag?' · Nachtrag':'');
}
// mitHeute=false am Handy: dort steht „↩ Heute“ im Streifen unter dem Kopf (die Kopfzeile ist voll, Prüfer 2026-10-01)
function stundeNav(k,mitHeute=true){
  const heute=heuteIso(), istHeute=terminDatum===heute;
  const pf=(text,titel,fn,aus,kl)=>el('button',{type:'button',class:'ds-icon ds-pfeil'+(kl?' '+kl:''),title:titel,'aria-label':titel,onclick:fn,...(aus?{disabled:''}:{})},text);
  const knopf=el('button',{type:'button',class:'stunde-knopf',dataset:{stunde:''},title:'Stunde wählen','aria-haspopup':'dialog',onclick:()=>stundeWaehlen(terminDatum)},
    el('span',{class:'kurs-band'}),
    el('span',{class:'stunde-txt'},el('b',{},k.name+' · '+k.fach),el('small',{class:terminNachtrag?'nachtrag-hinweis':''},stundeUntertitel(k))),
    el('span',{class:'stunde-pfeil','aria-hidden':'true'},'▾'));
  faerbe(knopf,k);
  return el('span',{class:'ds-nav'},
    pf('«','eine Woche zurück',()=>springeWoche(-1),false,'woche'),
    pf('‹','vorige Stunde '+k.name,()=>springeStunde(-1)),
    knopf,
    pf('›','nächste Stunde '+k.name,()=>springeStunde(1),istHeute),
    pf('»','eine Woche vor',()=>springeWoche(1),tagPlus(terminDatum,7)>heute,'woche'),
    ...(istHeute||!mitHeute?[]:[heuteKnopf()]));
}
function heuteKnopf(){ return el('button',{type:'button',class:'ds-txt',dataset:{heute:''},onclick:()=>geheZuTag(heuteIso())},'↩ Heute'); }
function datumStreifen(){
  const s=$('datum-streifen'), kopf=$('kopf-stunde'); const k=kurs();
  if(!k){ s.replaceChildren(); s.className=''; kopf.replaceChildren(); return; }
  s.className='datum-streifen'+(terminDatum===heuteIso()?'':' nachtrag');
  // Halbgruppen-Chips: nur wenn der Kurs Gruppen hat — A–D direkt filtern (Zero-Wunsch)
  // Gruppen-Chip = Handwahl (hält bis zum Blockwechsel) — sonst setzte der 60-s-Takt die Gruppe still zurück (Prüfer 2026-09-29)
  const gruppen=[...new Set(kursSchueler(k).map(x=>x.gruppe).filter(Boolean))].sort();
  const chip=(g,text)=>el('button',{type:'button',class:'tg-chip'+((aktiveTeilgruppe||'')===g?' an':''),'aria-pressed':String((aktiveTeilgruppe||'')===g),dataset:{tg:g},
    onclick:()=>{ gruppeWaehlen(g); mitUebergang(renderHeute); }},text);
  // im Sitzplan-Editor keine Gruppen-Chips: er zeigt immer alle Schüler (Zero 02.10. abends, E5)
  const chips=gruppen.length&&!editorAktiv?[el('span',{class:'tg-chips'},chip('','Alle'),...gruppen.map(g=>chip(g,g)))]:[];
  // Handy: die Stunde sitzt in der Kopfzeile, Sitzplan bearbeiten + Beamer hinter „⋯“ — der Streifen trägt die Gruppen
  // und im Nachtrag „↩ Heute“ (ein Tipp zurück, Plan „fertig heißt“ 4; warnfarbener Rand = Nachtrag sichtbar)
  if(HANDY.matches){ const zurueck=terminDatum!==heuteIso()?[el('span',{class:'nachtrag-hinweis'},'Nachtrag · '+datumLabel(terminDatum)),heuteKnopf()]:[];   // im Kopf wird „Nachtrag“ abgeschnitten
    kopf.replaceChildren(stundeNav(k,false)); s.replaceChildren(...chips,...zurueck); s.hidden=!chips.length&&!zurueck.length; return; }
  kopf.replaceChildren(); s.hidden=false;
  s.replaceChildren(stundeNav(k),...chips,
    el('span',{class:'rechts'},
      el('button',{type:'button',class:'ds-icon',dataset:{sitzplan:''},title:'Sitzplan bearbeiten','aria-label':'Sitzplan bearbeiten',onclick:()=>{ if(aktiverKursId) sitzplanEditor(aktiverKursId); }},iconEl('sitzplan')),
      BTN_BEAMER));
}
// „Stunde“ (Scheibe 2, Zero 2026-10-02: Variante C „Ein Ort“) — EIN Dialog mit den Reitern Tag und Woche.
// Tag: Woche (Mo–Fr, « » blättert, nur bis heute) + Stunden des Tages; ein Tipp öffnet, „⋯“ an der Zeile zeigt den Ausfall.
// Woche: eine konkrete Woche mit Datum, ‹ › auch vorwärts (ein Ausfall lässt sich vorab eintragen); eine Zelle antippen wählt
// die Stunde, das Feld daneben öffnet sie oder trägt den Ausfall ein — kein Blatt im Dialog. Vertretung und Tausch gibt es nicht
// mehr (Zero: „ich bewerte nur meine eigenen klassen“); alte Einträge stehen da und lassen sich entfernen.
// Zustand: `tag` gehört beiden Reitern — der Reiter Tag zeigt höchstens heute, ändert `tag` dabei aber nicht, sonst verlöre der
// Rückweg eine künftige Woche (Prüfer 2026-10-02). Kurs und „ohne Plan“ je Zeichnung frisch: ein Ausfall kann den Kurs wechseln.
function stundeWaehlen(start,reiter='tag'){
  // Bei offenem Sitzplan-Editor nur ansehen (Zero 06.10. „Nur lesend öffnen“): kein Öffnen, kein Ausfall, kein „Plan bearbeiten“, keine
  // „Alle Kurse“ — der Editor schreibt in das Raster SEINES Kurses, jeder Kurswechsel aus dem Dialog beendete ihn (Fehlerklasse N2, v1.13)
  const nurLesen=editorAktiv;
  const heute=heuteIso(), zm=planKontext().zeitmodell;
  const tagDirekt=d=>{ dlgZu(); zeigeTag(d,null); };
  let tag=start||heute, offenZeile=null, wahl=null, meldung='', kommendOffen=false;
  // die gezeigte Stunde ist in der Woche vorgewählt — beim Öffnen über „Plan“ und beim ersten Wechsel in den Reiter Woche
  const vorwahl=()=>{ const k=kurs(); if(!wahl&&k&&zm){ const st=angezeigteStunde(k); if(st) wahl={datum:terminDatum,blockNr:st.blockNr}; } };
  if(reiter==='woche') vorwahl();
  const kursVon=id=>id?vault.stamm.kurse.find(y=>y.id===id)||null:null;
  const titel=x=>{ const kx=kursVon(x.kursId); return (kx?kx.name+' · '+kx.fach:(SLOT_ARTEN[x.art]?.label||'—'))+(x.teilgruppe?' · Gr. '+x.teilgruppe:''); };
  // Halbgruppe als „Gr. A“, nie „· A“ neben dem Wochen-Hinweis „A: …“ (Zero 06.10. „Ja, „Gr. A““)
  const kurzTitel=x=>{ const kx=kursVon(x.kursId), kz=kx?fachKuerzel(kx.fach):''; return (kx?kx.name+(kz?' '+kz:''):(SLOT_ARTEN[x.art]?.kurz||'—'))+(x.teilgruppe?' Gr. '+x.teilgruppe:''); };
  const zusatzText=(d,x)=>x.quelle==='entfall'?'fällt aus':x.quelle==='ausnahme'?(ausnahmeFuer(d,x.blockNr)?.grund==='tausch'?'Tausch':'Vertretung'):'';
  // „läuft gerade“ nur für eine Stunde, die stattfindet (Prüfer 2026-10-02: eine ausgefallene hieß sonst grün „läuft“)
  const laeuftJetzt=(d,b,x)=>{ if(d!==heute||!b||x.quelle==='entfall') return false; const j=new Date(), s=j.getHours()*3600+j.getMinutes()*60+j.getSeconds(); return s>=b.startSek&&s<=b.endeSek; };
  const hatEintraege=(kursId,d)=>!!kursId&&wirksameEvents(vault.events).some(e=>e.kursId===kursId&&e.datum===d&&istTerminEintrag(e));
  const ausn=()=>(vault.stamm.ausnahmeSlots??=[]);
  // Ausfall-Griffe einer Stunde und ihres Tages: ein Tipp wirkt, nur für GENAU dieses Datum. Danach steht an derselben Stelle
  // der Gegenknopf — er bekommt den Fokus und ist kurz gegen einen Doppeltipp gesperrt (Prüfer 2026-10-02).
  const aktionen=(d,x)=>{
    if(nurLesen) return [];
    const lbl='Std. '+blockLabel(zm,x.blockNr,d);
    const nachher=(text,gegen)=>{ const wechsel=nachAusnahme(); meldung=text+(wechsel?' · '+wechsel:''); toast(meldung); zeichne('[data-ausfall="'+gegen+'"]',true,false,true); };
    const tausch=x.quelle==='ausnahme'&&ausnahmeFuer(d,x.blockNr)?.grund==='tausch';
    const paar=tausch?ausn().filter(a=>a.datum===d&&a.grund==='tausch').map(a=>blockLabel(zm,a.blockNr,d)).sort():[];
    const stunde=x.quelle==='entfall'
      ?el('button',{type:'button',class:'btn still',dataset:{ausfall:'zurueck'},onclick:()=>{ setzeAusnahmen(entfallZurueck(ausn(),d,x.blockNr)); nachher(lbl+' am '+datumLabel(d)+': Ausfall zurückgenommen','setzen'); }},'Ausfall zurücknehmen')
      :x.quelle==='ausnahme'
      ?el('button',{type:'button',class:'btn still',dataset:{ausfall:'entfernen'},onclick:()=>{ setzeAusnahmen(ausnahmeEntfernen(ausn(),d,x.blockNr)); nachher((tausch?'Tausch aufgehoben':'Ausnahme entfernt')+' — es gilt der Plan','setzen'); }},
        tausch?'Tausch aufheben (Std. '+paar.join(' ↔ ')+')':'Ausnahme entfernen')
      :el('button',{type:'button',class:'btn gefahr',dataset:{ausfall:'setzen'},onclick:()=>{ setzeAusnahme(d,x.blockNr,null,'entfall'); nachher(lbl+' am '+datumLabel(d)+' fällt aus','zurueck'); }},'Fällt aus');
    // Nur laut Plan belegte Stunden fallen aus (Zero 2026-09-02); ohne eine ist kein Tag-Knopf da (vorher Toast „0 Std.“ + Revision)
    const wt=wochentagVon(d), geplant=geplanteBlockNrn(d,wt,resolveBloecke(zm,wt,d),{...planKontext(),ausnahmen:[]});
    const alleAus=geplant.length>0&&geplant.every(nr=>ausnahmeFuer(d,nr)?.kursId===null);
    const ganzerTag=geplant.length?el('button',{type:'button',class:'btn still',dataset:{ausfall:'tag'},onclick:()=>{ setzeAusnahmen(tagesAusfall(ausn(),d,geplant,!alleAus));
      nachher(alleAus?datumLabel(d)+': Tages-Ausfall zurückgenommen':datumLabel(d)+' fällt komplett aus ('+geplant.length+' Std.)','tag'); }},
      (alleAus?'Tages-Ausfall zurücknehmen':'Ganzer Tag fällt aus')+' ('+datumLabel(d)+')'):null;
    // Ausfall an einer Stunde, die schon Einträge hat: sie bleiben, ‹ › und die Zeile „Einträge“ führen weiter zu ihnen (Planwechsel 02.10.)
    const hinweis=x.quelle==='plan'&&d<=heute&&hatEintraege(x.kursId,d)?el('p',{class:'u-hinweis sw-hinweis'},'Hier gibt es schon Einträge — sie bleiben. Fällt die Stunde aus, bleibt der Tag über ‹ › und die Zeile „Einträge“ erreichbar.'):null;
    return [stunde,ganzerTag,hinweis].filter(Boolean);
  };
  const zeichneTag=ctx=>{
    const k=kurs(), ohnePlan=!!k&&!kursImPlan(k);   // Kurs ohne Plan-Stunden: ein Tipp auf den Tag öffnet ihn dort (Plan „fertig heißt“ 1)
    const ctxK={...ctx,eintragsTage:k?eintragsTage(k.id):null};   // Planwechsel: die Leiste markiert auch Tage mit Einträgen
    const t=tag>heute?heute:tag;   // Nachtrag geht nur in die Vergangenheit — die Woche darf vorwärts, der Tag nicht
    const mo=tagPlus(t,1-wochentagVon(t));   // Montag der Woche
    const woche=[0,1,2,3,4].map(i=>tagPlus(mo,i));
    const tagKnopf=d=>el('button',{type:'button',class:'sw-tag'+(d===t?' an':'')+(k&&kursTag(k.id,d,ctxK)?' std':''),dataset:{tag:d},...(d===t?{'aria-current':'date'}:{}),
      ...(d>heute?{disabled:''}:{}),onclick:()=>{ if(ohnePlan&&!nurLesen){ tagDirekt(d); return; } tag=d; offenZeile=null; zeichne('[data-tag="'+d+'"]'); }},WOCHENTAG_KURZ[wochentagVon(d)],el('small',{},d.slice(8,10)+'.'));
    const blaettern=(r,txt)=>el('button',{type:'button',class:'sw-tag sw-pf',title:txt,'aria-label':txt,
      ...(r>0&&tagPlus(mo,7)>heute?{disabled:''}:{}),onclick:()=>{ const z=tagPlus(t,7*r); tag=z>heute?heute:z; offenZeile=null; zeichne('.sw-pf[title="'+txt+'"]'); }},r<0?'«':'»');
    const alle=tagesStunden(t,ctx), stunden=alle.filter(x=>x.quelle!=='entfall'), ferien=zm?istFerien(zm,t):null;
    const hatKurs=k&&stunden.some(x=>x.kursId===k.id);
    const ausK=!!k&&alle.some(x=>x.kursId===k.id&&x.quelle==='entfall');   // ausgefallen ist nicht „nicht im Plan“ (Prüfer 02.10., B1)
    // Kurse mit Einträgen an dem Tag, aber ohne stattfindende Stunde (Planwechsel, Ausfall): eine Zeile „Einträge“, ein Tipp öffnet
    const mitEintrag=new Set(wirksameEvents(vault.events).filter(e=>e.datum===t&&istTerminEintrag(e)).map(e=>e.kursId));
    const eintragKurse=sortiereKurse(vault.stamm.kurse.filter(x=>x.status!=='archiviert'&&mitEintrag.has(x.id)&&!stunden.some(s=>s.kursId===x.id)));
    const eintragZeilen=eintragKurse.map(kx=>{ const z=el('button',{type:'button',class:'sw-stunde'+(k&&kx.id===k.id&&t===terminDatum?' an':''),dataset:{kurs:kx.id,eintrag:''},...(nurLesen?{disabled:''}:{}),onclick:()=>oeffneStunde(kx.id,t,null,null)},
      el('span',{class:'sw-nr'}),el('span',{class:'kurs-band'}),el('b',{},kx.name+' · '+kx.fach),el('span',{class:'sw-badge'},'Einträge')); faerbe(z,kx); return el('div',{class:'sw-zeile'},z); });
    const offen=k&&t===terminDatum?angezeigteStunde(k):null;   // nur die angezeigte Stunde ist markiert, nicht jede des Kurses
    const zeilen=alle.flatMap(x=>{
      const kx=kursVon(x.kursId), entf=x.quelle==='entfall', lbl='Std. '+blockLabel(zm,x.blockNr,t), auf=offenZeile===x.blockNr, zusatz=zusatzText(t,x);
      const ist=!entf&&kx&&offen&&kx.id===k.id&&x.blockNr===offen.blockNr;
      const z=el('button',{type:'button',class:'sw-stunde'+(ist?' an':'')+(entf?' entf':'')+(kx?.status==='archiviert'?' archiv':''),dataset:{kurs:x.kursId||''},...(ist?{'aria-current':'true'}:{}),
        ...(kx&&kx.status!=='archiviert'&&!entf&&!nurLesen?{}:{disabled:''}),onclick:()=>oeffneStunde(kx.id,t,x.teilgruppe,x.blockNr)},   // archiviert (alte Vertretung): nicht wählbar (N5)
        el('span',{class:'sw-nr'},lbl),el('span',{class:'kurs-band'}),el('b',{},titel(x)),
        zusatz?el('span',{class:'sw-badge'+(entf?' fehl':'')},zusatz):el('span',{class:'sw-zeit'},formatZeit(x.startSek)));
      faerbe(z,kx);
      const name='Aktionen · '+lbl+' · '+titel(x);
      const mehr=el('button',{type:'button',class:'sw-mehr',dataset:{mehr:String(x.blockNr)},title:name,'aria-label':name,'aria-expanded':String(auf),
        onclick:()=>{ offenZeile=auf?null:x.blockNr; zeichne('[data-mehr="'+x.blockNr+'"]'); }},'⋯');
      const zeile=el('div',{class:'sw-zeile'+(auf?' offen':'')},z,...(nurLesen?[]:[mehr]));
      return auf?[zeile,el('div',{class:'sw-aktion'},...aktionen(t,x))]:[zeile];
    });
    const hinweis=ferien?'Ferien/Feiertag: '+ferien.name+' — kein Unterricht.'
      // nur lesend: ohne Aufforderung, die gesperrt ist (Prüfer 06.10., B1)
      :ohnePlan?k.name+' steht nicht im Stundenplan'+(nurLesen?'.':' — Tag antippen öffnet '+k.name+' dort.')
      :!zm?'Kein Stundenplan angelegt'+(nurLesen?'.':' — Kurs unten wählen.')
      :!alle.length?'Kein Unterricht laut Plan.'
      :k&&!hatKurs&&eintragKurse.some(x=>x.id===k.id)?(ausK?k.name+' fällt an diesem Tag aus — die Einträge bleiben unter „Einträge“.':k.name+' hat an diesem Tag laut Plan keine Stunde, aber Einträge.')
      :k&&!hatKurs?(ausK?k.name+' fällt an diesem Tag aus.':k.name+' hat an diesem Tag keine Stunde.')+(nurLesen?'':ausK?' Welche Stunde öffnen?':' Welche öffnen?'):'';
    const kurz=zm&&(zm.kurztage||[]).includes(t)?' · Kurzstunden':'';
    const datumFeld=el('input',{type:'date',class:'sw-datum',value:t,max:heute,'aria-label':'anderes Datum',onchange:e=>{ const v=e.target.value; if(v&&v<=heute){ if(ohnePlan&&!nurLesen){ tagDirekt(v); return; } tag=v; offenZeile=null; zeichne('.sw-datum'); } }});
    return [
      el('div',{class:'sw-woche'},blaettern(-1,'eine Woche zurück'),...woche.map(tagKnopf),blaettern(1,'eine Woche vor')),
      // iPad: links die Stunden schmal, rechts „Alle Kurse“, Datum und Heute (Zero 06.10. „Schmale Liste“); Handy untereinander wie bisher
      el('div',{class:'sw-tag-spalten'},
        el('div',{class:'sw-tag-links'},
          el('p',{class:'sw-kopf'},el('b',{},datumLabel(t)+(t===heute?' · heute':'')+kurz),hinweis?el('span',{},' · '+hinweis):''),
          ...(alle.length&&!nurLesen?[el('p',{class:'sw-tipp'},'Antippen öffnet die Stunde · ⋯ für Ausfall')]:[]),
          el('div',{class:'sw-liste'+(nurLesen?' nur-lesen':'')},...zeilen,...eintragZeilen)),
        el('div',{class:'sw-tag-rechts'},
          // offen, wenn es nichts anderes zu wählen gibt (kein Plan, kein Unterricht) · archivierte Kurse nie (die Handwahl verwürfe sie)
          ...(nurLesen?[]:[el('details',{class:'sw-alle',...(!zm||!stunden.length||ohnePlan?{open:''}:{})},el('summary',{},'Alle Kurse'),
            el('div',{class:'sw-liste'},...sortiereKurse(vault.stamm.kurse.filter(x=>x.status!=='archiviert')).map(kx=>{ const st=stundeDesKurses(kx.id,t,ctx);   // hat er an dem Tag eine Plan-Stunde: deren Gruppe
              // die Zeile öffnet den Kurs, keine bestimmte Stunde: heute ist er damit „jetzt gewählt“ (Zero 03.10.), im Nachtrag gilt die Tagesregel
              const z=el('button',{type:'button',class:'sw-stunde',dataset:{kurs:kx.id},onclick:()=>oeffneStunde(kx.id,t,st?.teilgruppe??null,null)},
              el('span',{class:'kurs-band'}),el('b',{},kx.name+' · '+kx.fach)); faerbe(z,kx); return z; })))]),
          el('div',{class:'btn-reihe sw-fuss'},datumFeld,
            // hat der Kurs heute keine Stunde: im Dialog auf heute blättern statt ihn neu zu öffnen (sähe aus wie „nichts passiert“, N4);
            // nur lesend: nie aus dem Dialog heraus
            el('button',{type:'button',class:'btn still',dataset:{heuteDlg:''},onclick:()=>{ if(nurLesen||(k&&kursImPlan(k)&&!kursTag(k.id,heute,ctxK))){ tag=heute; offenZeile=null; zeichne('[data-heute-dlg]'); return; } dlgZu(); geheZuTag(heute); }},'Heute'),
            el('button',{type:'button',class:'btn still',onclick:dlgZu},'Schließen'))))];
  };
  const zeichneWoche=ctx=>{
    if(!zm) return [el('p',{class:'sw-kopf'},'Kein Stundenplan angelegt.'),
      ...(nurLesen?[]:[el('div',{class:'btn-reihe'},el('button',{type:'button',class:'btn',onclick:()=>{ dlgZu(); stundenplanAssistent(); }},'Stundenplan einrichten…'))])];
    const mo=tagPlus(tag,1-wochentagVon(tag)), fr=tagPlus(mo,4);
    const tm=d=>d.slice(8,10)+'.'+d.slice(5,7)+'.';
    const spalten=[0,1,2,3,4].map(i=>{ const d=tagPlus(mo,i), wt=i+1, fe=istFerien(zm,d); return {d,wt,fe,bl:fe?[]:resolveBloecke(zm,wt,d),st:tagesStunden(d,ctx)}; });
    const reihen=Math.max(zm.bloeckeProTag,...spalten.map(s=>s.bl.length));
    // Zeilenkopf: Nummer und Uhrzeit nur, wo alle Tage der Woche sich einig sind (Kurztag, abweichende Tageszeiten: Prüfer 2026-10-02)
    const einig=werte=>{ const w=[...new Set(werte)]; return w.length===1?w[0]:null; };
    const zeilenKopf=nr=>{ const mit=spalten.filter(s=>!s.fe&&s.bl.some(b=>b.blockNr===nr));
      return { label:einig(mit.map(s=>blockLabel(zm,nr,s.d)))??String(nr), zeit:einig(mit.map(s=>s.bl.find(b=>b.blockNr===nr).startSek)) }; };
    const pf=(r,txt)=>el('button',{type:'button',class:'sp-c-pf',title:txt,'aria-label':txt,onclick:()=>{ tag=tagPlus(tag,7*r); zeichne('.sp-c-pf[title="'+txt+'"]'); }},r<0?'‹':'›');
    const kopf=el('div',{class:'sp-c-kopf'},pf(-1,'Woche zurück'),
      el('span',{class:'sp-c-titel'},el('b',{},'KW '+kalenderwoche(mo)+' · '+tm(mo)+'–'+tm(fr)),el('small',{},zm.abWochenAnker?istAWoche(mo,zm.abWochenAnker)+'-Woche':'')),
      pf(1,'Woche vor'),
      ...(heute>=mo&&heute<=tagPlus(mo,6)?[]:[el('button',{type:'button',class:'btn still u-btn-klein sp-c-heute',onclick:()=>{ tag=heute; zeichne('.sp-c-pf[title="Woche vor"]'); }},'Diese Woche')]));
    // A/B (Zero 06.10. „Leise in der Zelle“): wo die andere Woche laut Plan anders ist, steht sie klein in der Zelle („A: 7b Ma“, „A: frei“).
    // Plan ohne Ausnahmen; dasselbe Datum eine Woche später ist die andere Woche. Ohne A/B-Anker nie.
    const abJetzt=zm.abWochenAnker?istAWoche(mo,zm.abWochenAnker):null, ohneAus={...ctx,ausnahmen:[]};
    const gleichSlot=(p,q)=>(p?.kursId??null)===(q?.kursId??null)&&(p?.teilgruppe??null)===(q?.teilgruppe??null)&&(p?.art??null)===(q?.art??null);
    // kurz für die Zelle („A: 5a NW Gr. A“), lang für Screenreader (Prüfer 06.10., B6)
    const andere=(d,wt,nr)=>{ if(!abJetzt) return null; const hier=slotFuerBlock(d,wt,nr,ohneAus), dort=slotFuerBlock(tagPlus(d,7),wt,nr,ohneAus);
      if(gleichSlot(hier,dort)) return null; const w=abJetzt==='A'?'B':'A';
      return {kurz:w+': '+(dort?kurzTitel(dort):'frei'),lang:'in der '+w+'-Woche: '+(dort?titel(dort):'frei')}; };
    const grid=el('div',{class:'sp-woche sp-c-woche'},el('div',{class:'sp-ecke'}));
    for(const s of spalten){ const abw=!!(zm.tagesAusnahmen||{})[s.wt], kurz=(zm.kurztage||[]).includes(s.d);
      grid.append(el('div',{class:'sp-th sp-c-th'+(s.d===heute?' sp-heute':''),...(s.fe?{title:s.fe.name}:abw&&!kurz?{title:'abweichende Zeiten'}:{})},
        el('b',{},WT_KURZ[s.wt]+(abw&&!kurz?' *':'')),el('small',{},tm(s.d)),kurz?el('small',{class:'sp-c-kurz'},'Kurzstd.'):null)); }
    for(let nr=1;nr<=reihen;nr++){
      const zk=zeilenKopf(nr);
      grid.append(el('div',{class:'sp-th sp-blockkopf'},zk.label,el('small',{class:'sp-zeit'},zk.zeit!=null?formatZeit(zk.zeit):'')));
      for(const s of spalten){
        const x=s.st.find(y=>y.blockNr===nr), ab=s.fe||!s.bl.some(y=>y.blockNr===nr)?null:andere(s.d,s.wt,nr);
        if(!x){ grid.append(el('div',{class:'sp-zelle sp-c-leer'+(s.fe?' ferien':'')+(ab?' mit-ab':'')},s.fe&&nr===1?s.fe.name:ab?el('small',{class:'sp-c-ab'},
          el('span',{class:'sp-c-sr'},datumLabel(s.d)+' Std. '+blockLabel(zm,nr,s.d)+' · frei · '+ab.lang),el('span',{'aria-hidden':'true'},ab.kurz)):'')); continue; }
        const b=s.bl.find(y=>y.blockNr===nr), an=!!wahl&&wahl.datum===s.d&&wahl.blockNr===nr, zusatz=zusatzText(s.d,x);
        const z=el('button',{type:'button',class:'sp-zelle sp-c'+(x.kursId?' belegt':'')+(x.art?' sp-art':'')+(x.quelle==='entfall'?' entf':'')+(laeuftJetzt(s.d,b,x)?' sp-jetzt':'')+(an?' an':''),
          dataset:{datum:s.d,nr:String(nr)},'aria-pressed':String(an),'aria-label':datumLabel(s.d)+' Std. '+blockLabel(zm,nr,s.d)+' · '+titel(x)+(zusatz?' · '+zusatz:'')+(ab?' · '+ab.lang:''),
          onclick:()=>{ wahl={datum:s.d,blockNr:nr}; tag=s.d; zeichne('[data-datum="'+s.d+'"][data-nr="'+nr+'"]',true,true); }},
          el('span',{class:'sp-c-name'},kurzTitel(x)),zusatz?el('small',{},zusatz):null,ab?el('small',{class:'sp-c-ab'},ab.kurz):null);
        faerbe(z,kursVon(x.kursId)); grid.append(z);
      }
    }
    const feld=el('div',{class:'sp-c-feld'});
    const x=wahl&&spalten.find(s=>s.d===wahl.datum)?.st.find(y=>y.blockNr===wahl.blockNr);
    if(x){
      const d=wahl.datum, b=resolveBloecke(zm,wochentagVon(d),d).find(y=>y.blockNr===x.blockNr), kx=kursVon(x.kursId), entf=x.quelle==='entfall';
      const kannOeffnen=!!kx&&kx.status!=='archiviert'&&!entf&&d<=heute&&!nurLesen;
      feld.append(
        el('b',{class:'sp-c-feldkopf'},datumLabel(d)+' · Std. '+blockLabel(zm,x.blockNr,d)+(b?' · '+formatZeit(b.startSek)+'–'+formatZeit(b.endeSek):'')),
        el('p',{class:'u-hinweis'},(entf?'Fällt aus':x.quelle==='ausnahme'?zusatzText(d,x)+' (alter Eintrag)':'Laut Plan')+' · '+titel(x),laeuftJetzt(d,b,x)?el('span',{class:'u-gut'},' · läuft gerade'):null),
        ...(kx?[el('button',{type:'button',class:'btn',dataset:{spOeffnen:''},...(kannOeffnen?{}:{disabled:''}),...(d>heute?{title:'Nachtrag geht nur in die Vergangenheit'}:{}),
          onclick:()=>oeffneStunde(kx.id,d,x.teilgruppe,x.blockNr)},kx.name+' · '+kx.fach+' öffnen')]:[]),
        ...aktionen(d,x),
        ...(nurLesen?[]:[el('p',{class:'u-hinweis'},'Gilt nur für diesen Tag. Den Wochenplan änderst du unter „Plan bearbeiten“.')]));
    } else feld.append(el('p',{class:'u-hinweis'},nurLesen?'Stunde antippen zum Ansehen.':'Stunde antippen: öffnen oder Ausfall eintragen.'));
    // Kommende Ausfälle (Zero 06.10. „Liste in der Woche“): ab heute, je Stunde eine Zeile, ein ganzer Tag als eine Zeile;
    // ein Tipp blättert in die Woche und wählt die Stunde. Nur da, wenn es welche gibt.
    // Heute nur, was noch kommt: eine schon vorbeigegangene Stunde ist kein kommender Ausfall (Prüfer 06.10., B4)
    const kommend=[], j=new Date(), jetztSek=j.getHours()*3600+j.getMinutes()*60+j.getSeconds();
    for(const d of [...new Set(ausn().filter(a=>!a.kursId&&a.datum>=heute).map(a=>a.datum))].sort()){
      const wt=wochentagVon(d), st=tagesStunden(d,ctx).filter(y=>y.quelle==='entfall');
      const rest=d===heute?st.filter(y=>y.endeSek==null||y.endeSek>jetztSek):st;
      if(!rest.length) continue;
      const geplant=geplanteBlockNrn(d,wt,resolveBloecke(zm,wt,d),ohneAus);
      if(geplant.length>1&&geplant.every(nr=>st.some(y=>y.blockNr===nr))) kommend.push({d,nr:rest[0].blockNr,text:datumLabel(d)+' · ganzer Tag ('+st.length+' Std.)'});
      else for(const y of rest) kommend.push({d,nr:y.blockNr,text:datumLabel(d)+' · Std. '+blockLabel(zm,y.blockNr,d)+' · '+kurzTitel(y)});
    }
    const ausfaelle=kommend.length?el('details',{class:'sw-alle sp-c-kommend',...(kommendOffen?{open:''}:{}),ontoggle:e=>{ kommendOffen=e.currentTarget.open; }},
      el('summary',{},'Kommende Ausfälle ('+kommend.length+')'),
      el('div',{class:'sw-liste'},...kommend.map(a=>el('button',{type:'button',class:'sw-stunde sp-c-kommend-z',dataset:{kommend:a.d+'/'+a.nr},
        onclick:()=>{ tag=a.d; wahl={datum:a.d,blockNr:a.nr}; zeichne('[data-kommend="'+a.d+'/'+a.nr+'"]',true,true); }},a.text)))):null;
    return [el('div',{class:'sp-c'},el('div',{class:'sp-c-raster'},kopf,el('div',{class:'sp-woche-wrap'},grid)),el('div',{class:'sp-c-rechts'},feld,ausfaelle)),
      ...(nurLesen?[]:[el('div',{class:'btn-reihe sw-fuss'},el('button',{type:'button',class:'btn still sp-c-bearb',onclick:()=>{ dlgZu(); stundenplanAssistent(); }},'Plan bearbeiten…'))])];
  };
  // Neu zeichnen: Plan-Kontext jedes Mal frisch (ein Ausfall ersetzt das ausnahmeSlots-Array), Scrollstand und Fokus bleiben.
  // Die Rückmeldung eines Griffs steht einmal im Dialog (role=status) — der Toast liegt unter dem modalen Dialog (Prüfer 2026-10-02).
  const zeichne=(fokus,behalten=true,feldZeigen=false,sperre=false)=>{
    const ctx=planKontext(), box=dlgInhalt(), y=box.scrollTop;
    const seg=el('span',{class:'sw-reiter',role:'group','aria-label':'Ansicht'},...[['tag','Tag'],['woche','Woche']].map(([r,txt])=>
      el('button',{type:'button',class:reiter===r?'an':'',dataset:{reiter:r},'aria-pressed':String(reiter===r),
        onclick:()=>{ if(reiter===r) return; reiter=r; offenZeile=null; if(r==='woche') vorwahl(); zeichne('[data-reiter="'+r+'"]',false); }},txt)));
    dlgZeigenEl(el('div',{class:'sw-kopfzeile'},el('h3',{},'Stunde'),seg),
      ...(nurLesen?[el('p',{class:'u-hinweis sw-nurlesen'},'Nur ansehen: Der Sitzplan-Editor ist offen. Mit „Fertig“ schließen, dann öffnen oder Ausfall eintragen.')]:[]),
      el('p',{class:'sw-meldung',role:'status'},meldung),...(reiter==='woche'?zeichneWoche(ctx):zeichneTag(ctx)));
    meldung='';
    dlgBreit();
    box.scrollTop=behalten?y:0;
    // nie auf einen gesperrten Knopf (» in der laufenden Woche): Safari 26 wirft den Fokus sonst an den Seitenanfang (Prüfer 02.10., B4)
    if(fokus){ const f=box.querySelector(fokus); (f&&!f.disabled?f:box.querySelector('[data-ausfall]')||box.querySelector('[aria-current="date"]')||box.querySelector('[data-reiter][aria-pressed="true"]'))?.focus({preventScroll:true}); }
    // Gegen den Doppeltipp: der Gegenknopf an derselben Stelle nimmt ~0,4 s keine Tipps an (pointer-events, kein disabled —
    // ein fokussierter Knopf, der disabled wird, wirft den Fokus in Safari 26 an den Seitenanfang)
    if(sperre){ const g=box.querySelectorAll('[data-ausfall]'); g.forEach(b=>b.classList.add('kurz-gesperrt')); setTimeout(()=>g.forEach(b=>b.classList.remove('kurz-gesperrt')),400); }
    // Handy: das Feld steht unter dem Raster — nach dem Antippen so weit scrollen, dass es zu sehen ist (nur .dlg-inhalt scrollt)
    const feld=feldZeigen&&box.querySelector('.sp-c-feld');
    if(feld){ const fb=feld.getBoundingClientRect(), bb=box.getBoundingClientRect(); if(fb.bottom>bb.bottom) box.scrollTop+=Math.min(fb.bottom-bb.bottom,fb.top-bb.top); }
  };
  zeichne(null,false);
}
// „Plan“ (Leiste unten links, ⋯-Menü am Handy, „Stundenplan“ in Kurse): derselbe Dialog im Reiter Woche — ohne Zeitraster gleich der Assistent
function stundenplanAnsicht(){
  if(!(vault.stamm.zeitmodelle||[])[0]){ if(editorAktiv){ toast('Erst den Sitzplan-Editor mit „Fertig“ schließen'); return; } stundenplanAssistent(); return; }
  stundeWaehlen(terminDatum,'woche');
}
// Eine Stunde öffnen = Kurs von Hand wählen (hält bis zum Blockwechsel, wie „Kurs wählen“) + Termin setzen. Nur „Alle Kurse“ für heute heißt
// „ich unterrichte den Kurs jetzt“: dann gehört der Block der Handwahl zu seinen Stunden. Wer eine bestimmte Stunde oder einen anderen Tag
// öffnet, trägt nach (nurStunde) — der laufende Block bleibt fremd (Zero 03.10. ~16:3x: „Nur wenn jetzt gewählt“).
// Erst Autowahl (frische Blocknummer — sonst bände die Handwahl an einen vergangenen Block und fiele sofort), dann Handwahl,
// Termin erst NACH der Prüfung, dass der Kurs wirklich übernommen ist (Prüfer 2026-10-01: sonst Kurs Y auf dem Datum von X).
function oeffneStunde(kursId,datum,teilgruppe,blockNr){
  if(editorAktiv){ toast('Erst den Sitzplan-Editor mit „Fertig“ schließen'); return; }
  kursAutowahl();
  handwahlSetzen({kursId,teilgruppe:gueltigeGruppe(kursId,teilgruppe),datum:heuteIso(),blockNr:autowahlInfo?.blockNr??null,...(blockNr!=null||datum!==heuteIso()?{nurStunde:true}:{})});
  kursAutowahl(); dlgZu();
  if(aktiverKursId!==kursId){ toast('Dieser Kurs lässt sich nicht öffnen'); mitUebergang(renderAlles); return; }
  setzeTermin(datum); setzeAnzeigeBlock(blockNr??null); mitUebergang(renderAlles);
}
// Zufall mit kurzem Lichtlauf (Zero 2026-09-29): der Rahmen springt über ein paar Kacheln, wird langsamer und
// bleibt beim Gezogenen stehen (≈ 0,6 s). Die Wahl steht VOR dem Lauf fest — der Lauf ist nur Bühne.
let zufallLaeuft=false;
function zufallsSchueler(){
  if(zufallLaeuft) return;
  const k=kurs(); if(!k) return;
  const alle=sichtbareSchueler(k); if(!alle.length) return;
  const info=new Map(alle.map(s=>[s.nr,standAmTermin(s.nr,terminDatum)]));
  const anwesend=alle.filter(s=>!info.get(s.nr).fehlt);      // Fehlende raus
  const pool=anwesend.length?anwesend:alle;
  // Gewicht ∝ 1/(1+heutige Bewertungen), wer heute schon ＋ oder ⭐ hat, noch seltener (getestet: logic/auswahl.mjs)
  const s=gewichteteWahl(pool,ss=>{ const st=info.get(ss.nr); return zufallsGewicht(anzahlBewertungen(st),st.plus>st.minus||st.best); });
  if(!s) return;
  const kachelVon=nr=>$('plan').querySelector('.kachel[data-nr="'+nr+'"]');
  const landen=()=>{
    setzeAktiverSchueler(s.nr);
    renderHeute();
    const kachel=kachelVon(s.nr);
    if(kachel){ kachel.scrollIntoView({block:'nearest',behavior:'smooth'}); kachel.classList.add('zufall-treffer'); }
    toast('Zufall: '+anzeigeVorname(s)+' '+anzeigeNachname(s));
  };
  const andere=pool.filter(x=>x.nr!==s.nr&&kachelVon(x.nr));   // nur Kacheln, die wirklich im Plan stehen
  if(matchMedia('(prefers-reduced-motion: reduce)').matches||!andere.length){ landen(); return; }
  const takte=[60,70,85,105,130,165];   // wird langsamer
  zufallLaeuft=true; let vorher=null, i=0;
  const schritt=()=>{
    $('plan').querySelectorAll('.kachel.zufall-lauf').forEach(x=>x.classList.remove('zufall-lauf'));
    if(i>=takte.length){ zufallLaeuft=false; landen(); return; }
    const wahl=andere.length>1?andere.filter(x=>x.nr!==vorher):andere;
    vorher=wahl[Math.floor(Math.random()*wahl.length)].nr;
    kachelVon(vorher)?.classList.add('zufall-lauf');   // nach einem Neuzeichnen (Takt) frisch gesucht
    setTimeout(schritt,takte[i++]);
  };
  schritt();
}
// Marken eines Tagesstands als mk-Chips — EINE Quelle für Kachel, Zeitstrahl und Legende
// EINE Marken-Quelle als Daten [{cls,text}] — markenHtml (HTML-String, Bestand) und markenEl (el(), Termin-Matrix) driften nie
function markenListe(st){
  const m=[];
  if(st.plus&&!st.minus) m.push({cls:'p',text:'＋'+(st.plus>1?st.plus:'')});
  else if(st.minus&&!st.plus) m.push({cls:'m',text:'−'+(st.minus>1?st.minus:'')});
  else if(st.plus&&st.minus) m.push({cls:'p',text:String(st.plus)},{cls:'m',text:String(st.minus)});
  else if(st.neutral) m.push({cls:'o',text:'o'});
  if(st.note!=null) m.push({cls:'sym',ikon:st.best?'best':'note'});
  if(st.mat) m.push({cls:'sym',ikon:'material'});
  if(st.ipad) m.push({cls:'sym',ikon:'ipad'});
  if(st.lernzeit) m.push({cls:'sym',ikon:'lernzeit'});
  if(st.notiz) m.push({cls:'sym',ikon:'notiz'});
  if(st.versp) m.push({cls:'sym',ikon:'versp'});
  if(st.verweigert) m.push({cls:'verw',ikon:'verweigert'});
  if(st.fehlt) m.push({cls:st.fehlt==='u'?'u':st.fehlt==='e'?'e':'abw',text:st.fehlt==='o'?'abw':st.fehlt});
  return m;
}
function markenHtml(st){ return markenListe(st).map(x=>'<span class="mk '+x.cls+'">'+(x.ikon?iconHtml(x.ikon):x.text)+'</span>').join(''); }
function markenEl(st){ return markenListe(st).map(x=>el('span',{class:'mk '+x.cls},x.ikon?iconEl(x.ikon):x.text)); }
function kachelKlassen(s,st){
  let cls='kachel schueler';
  if(aktiverSchueler===s.nr) cls+=' gewaehlt';
  if(!beamerModus){
    if(st.fehlt) cls+=' netto-fehlt';
    else if(st.plus>st.minus) cls+=' netto-plus';
    else if(st.minus>st.plus) cls+=' netto-minus';
  }
  return cls;
}
// Bedienbar = Tab-Ziel, Enter/Leertaste wie Antippen (Codex 07.10. B5); die Legenden-Kachel ist nur Anschauung
function kachelHtml(s,st,r,c,bedienbar=true){
  const cls=kachelKlassen(s,st);
  const marken=markenHtml(st);
  return '<div class="'+cls+'" data-nr="'+s.nr+'" data-r="'+r+'" data-c="'+c+'"'+(bedienbar?' role="button" tabindex="0"':'')+'>'+
    '<div class="kopf"><span class="vn">'+esc(anzeigeVorname(s))+'</span>'+(s.lb?'<span class="lb-badge">LB</span>':'')+'</div>'+
    '<span class="nn">'+esc(anzeigeNachname(s))+'</span>'+
    '<div class="marken">'+marken+'</div></div>';
}
function listenZeile(s,e,st){
  return el('div',{class:kachelKlassen(s,st)+' listen-zeile',role:'button',tabindex:'0',dataset:{nr:String(s.nr)}},
    el('span',{class:'vn'},e.vorname),el('span',{class:'nn'},e.kurz),s.lb?el('span',{class:'lb-badge'},'LB'):null,
    el('span',{class:'marken'},...markenEl(st)));
}
// Umschalter „Sitzplan | Liste“ (+ „Nachname | Vorname“) — per JS, damit index.html für ein altes app.mjs gleich bleibt.
// Im Sitzplan steht er UNTER dem Plan: darüber kostete er bei 800 px Höhe die fünfte Kachelreihe (P2 gemessen); in der Liste oben.
// „Sitzplan | 🎲 | Liste“ (Zero 2026-10-01: Würfel zwischen Sitzplan und Liste, „schön griffbereit“) — am iPad in der Leiste,
// am Handy als feste Zeile direkt über den Stempeln, in beiden Ansichten an derselben Stelle. Sortierung steht oben in der Liste.
function erfassUmschalter(zeigen,listeAktiv){
  let u=$('erfass-umschalter');
  if(!zeigen){ if(u) u.remove(); $('listen-sort')?.remove(); return; }
  if(!u) u=el('div',{id:'erfass-umschalter'});
  if(HANDY.matches) $('view-heute').append(u); else $('datum-streifen').querySelector('.rechts')?.prepend(u);
  // Neuzeichnen ersetzt die Knöpfe — den Fokus auf den gedrückten zurücksetzen (Tastatur/Screenreader, Prüfer 2026-10-01)
  const knopf=(schluessel,wert,text,an)=>{ const feld=schluessel==='kladde_erfassung'?'erfassung':'sort';
    return el('button',{type:'button','aria-pressed':String(an),dataset:{[feld]:wert},
      onclick:e=>{ const hatteFokus=document.activeElement===e.currentTarget; localStorage.setItem(schluessel,wert); renderHeute();
        if(hatteFokus) document.querySelector('[data-'+feld+'="'+wert+'"]')?.focus(); }},text); };
  const wuerfel=el('button',{type:'button',class:'wuerfel',dataset:{zufall:''},title:'Zufällig – wer heute noch nichts hat, kommt eher dran; mit ＋ oder Bestleistung selten','aria-label':'Zufall',onclick:zufallsSchueler},iconEl('wuerfel'));
  u.replaceChildren(el('div',{class:'seg',role:'group','aria-label':'Erfassen als'},
    knopf('kladde_erfassung','sitzplan','Sitzplan',!listeAktiv),wuerfel,knopf('kladde_erfassung','liste','Liste',listeAktiv)));
  if(listeAktiv){
    const sort=listenSortierung();
    let s=$('listen-sort'); if(!s){ s=el('div',{id:'listen-sort',class:'seg',role:'group','aria-label':'Sortieren nach'}); }
    s.replaceChildren(knopf('kladde_listen_sort','nachname','Nachname',sort==='nachname'),knopf('kladde_listen_sort','vorname','Vorname',sort==='vorname'));
    $('plan-wrap').before(s);
  } else $('listen-sort')?.remove();
}
function renderHeute(){
  const k=kurs(); const plan=$('plan');
  plan.classList.toggle('editor',editorAktiv);
  const listeAktiv=!!k&&!editorAktiv&&erfassWahl()==='liste';   // seit 2026-10-01 auch am iPad (Zero: „am iPad auch die features mit Sitzplan/Liste“)
  plan.classList.toggle('liste',listeAktiv);
  if(!k){ erfassUmschalter(false,false); datumStreifen(); renderRail(); $('heute-leer').classList.remove('hidden'); plan.innerHTML=''; return; }
  $('heute-leer').classList.add('hidden');
  const idx=tagesStandIndex(terminDatum);
  // Editor: immer alle Schüler — mit Gruppenfilter stünden die Plätze der anderen Gruppe als leer da (Zero 02.10. abends, E5)
  const sichtSchueler=editorAktiv?kursSchueler(k):sichtbareSchueler(k);
  datumStreifen(); erfassUmschalter(!editorAktiv,listeAktiv); renderRail();   // Umschalter NACH dem Streifen: am iPad sitzt er darin
  const spDaten=vault.stamm.sitzplaene[k.id]||{};
  const grid=spDaten.grid||{};
  const luecken=new Set(spDaten.luecken||[]);   // bewusst leere Reihen (Gang) — überleben das Kompaktieren (Zero 2026-09-02)
  const tische=new Set(spDaten.tische||[]);   // leere Tische (Zero 2026-10-02): wie ein leeres Feld, Antippen setzt einen Schüler hin (logic/sitzplan.mjs)
  plan.classList.toggle('hidden',Object.keys(grid).length===0&&!tische.size&&!editorAktiv&&!listeAktiv);
  // In einer Halbgruppen-Stunde fiele, wer (noch) keiner Gruppe angehört, aus jeder Ansicht heraus — etwa ein
  // gerade hinzugefügter Schüler. Er steht hier mit „ohne Gruppe" und zählt nicht in n/m der Gruppe (Zero 2026-09-29).
  const ohneGruppe=aktiveTeilgruppe?kursSchueler(k).filter(s=>!s.gruppe):[];
  if(listeAktiv){   // Liste: alle sichtbaren Schüler, also braucht nur „ohne Gruppe" das Zusatz-Panel
    const nachNr=new Map(sichtSchueler.map(s=>[s.nr,s]));
    const eintraege=listenEintraege(sichtSchueler.map(s=>({nr:s.nr,liste:lnr(s),vorname:anzeigeVorname(s),nachname:anzeigeNachname(s)})),listenSortierung());
    plan.replaceChildren(el('div',{class:'erfass-liste'},...eintraege.map(e=>listenZeile(nachNr.get(e.nr),e,idx.get(e.nr)||leererStand()))));
    ohnePlatzPanel(ohneGruppe); return;
  }
  const sichtbar=new Set(sichtSchueler.map(s=>s.nr));
  const SPALTEN=12;
  const belegteReihen=spBelegteReihen(spDaten);   // Reihen mit Schülern oder leeren Tischen
  // Editor: vorne bleibt vorne — die letzte belegte Reihe steht direkt über der Tafel, leere Reihen stehen hinten (oben), bis 6 zu sehen
  // sind (Zero 02.10.: „Leerer Sitzplan soll mit 6 Reihen starten“ · „Ich will auch Kinder in die erste Reihe setzen können“). Den Platz
  // hinten schafft sitzplanEditor beim Öffnen (vorlauf), „Fertig“ kompaktiert. Eine neue erste Reihe entsteht nur durch Ziehen auf die
  // Zone unter der letzten Reihe.
  // Unterricht: belegte Reihen + markierte Lücken (kompakt — kein unbeabsichtigter Leerraum, TAFEL direkt unter der letzten).
  let reihen;
  const minBelegt=belegteReihen.length?belegteReihen[0]:-1, maxBelegt=belegteReihen.length?belegteReihen[belegteReihen.length-1]:-1;
  if(editorAktiv){ reihen=[]; for(let r=0;r<=Math.max(maxBelegt,5);r++) reihen.push(r); }
  else reihen=[...new Set([...belegteReihen,...luecken])].sort((a,b)=>a-b);
  // Editor: Spalten nach Bedarf (Zero 02.10. abends: „Ja“) — leer 8, sonst bis zur letzten belegten Spalte + eine Reserve, höchstens 12
  let spaltenN=SPALTEN;
  if(editorAktiv){ const cs=[...Object.keys(grid),...tische].map(key=>Number(key.split(',')[1])); spaltenN=Math.min(SPALTEN,Math.max(8,(cs.length?Math.max(...cs):-1)+2)); }
  let html='';
  for(const r of reihen){
    // „＋": leere Reihe hier einfügen — vor der ersten belegten Reihe und zwischen belegten (hinten stehen ohnehin leere Reihen)
    if(editorAktiv && r>=minBelegt && r<=maxBelegt) html+='<button class="reihe-plus" data-vor="'+r+'" title="Leere Reihe hier einfügen">＋</button>';
    html+='<div class="plan-reihe'+(luecken.has(r)?' luecke':'')+'" data-r="'+r+'">';
    // Leere Reihe zwischen belegten: „Lücke lassen" macht sie zum festen Gang (vor der ersten belegten Reihe gibt es keinen Gang)
    if(editorAktiv && r>minBelegt && r<maxBelegt && !belegteReihen.includes(r)) html+='<button class="luecke-btn" data-luecke="'+r+'" title="'+(luecken.has(r)?'Antippen hebt die Lücke auf':'Reihe bleibt als Gang leer')+'">'+(luecken.has(r)?'✓ Lücke bleibt':'Lücke lassen')+'</button>';
    for(let c=0;c<spaltenN;c++){
      const nr=grid[r+','+c];
      const s=nr?kursSchueler(k).find(x=>x.nr===nr):null;
      if(s&&sichtbar.has(s.nr)) html+=kachelHtml(s,idx.get(s.nr)||leererStand(),r,c);
      else if(nr==null&&tische.has(r+','+c)) html+='<div class="kachel tisch" data-r="'+r+'" data-c="'+c+'" title="Leerer Tisch" role="button" tabindex="0" aria-label="Leerer Tisch"></div>';
      else html+='<div class="kachel leer" data-r="'+r+'" data-c="'+c+'"></div>';
    }
    html+='</div>';
  }
  // Ablagezone für eine neue erste Reihe: nur beim Ziehen sichtbar (CSS), sonst bliebe vor der Tafel wieder eine Lücke — sie setzt
  // direkt über die Tafel, hinter die letzte angezeigte Reihe (Prüfer 03.10. G1: maxBelegt+1 lag bei kleinen Plänen mitten im Raster)
  if(editorAktiv&&maxBelegt>=0) html+='<button class="reihe-plus vorne" data-vor="'+(reihen[reihen.length-1]+1)+'" title="Neue erste Reihe" tabindex="-1">＋</button>';
  plan.innerHTML=html;
  if(editorAktiv){ $('plan-wrap').style.setProperty('--ed-n',String(spaltenN)); plan.style.setProperty('--sp-r',String(reihen.length)); }
  // Nur die belegten Spalten zeigen, damit die Kacheln die Breite füllen — Handy seit v1.11.0, iPad seit 2026-10-01
  // (Zero: der gewonnene Platz gehört dem Sitzplan). `--sp-r` (Reihen) begrenzt am iPad die Kachelgröße auf die Höhe.
  if(!editorAktiv){
    const spalten=[...Object.keys(grid),...tische].map(key=>Number(key.split(',')[1]));
    const von=spalten.length?Math.min(...spalten):0, bis=spalten.length?Math.max(...spalten):SPALTEN-1;
    plan.style.setProperty('--sp-n',String(bis-von+1));
    plan.style.setProperty('--sp-r',String(Math.max(1,reihen.length)));
    plan.querySelectorAll('.kachel').forEach(x=>{ const c=Number(x.dataset.c); if(c<von||c>bis) x.classList.add('aussen'); });
  }
  ohnePlatzPanel([...sichtSchueler.filter(s=>!Object.values(grid).includes(s.nr)),...ohneGruppe]);
}
function ohnePlatzPanel(ohnePlatz){
  if(ohnePlatz.length&&!editorAktiv){  // im Editor zeigt die Namen-Schiene dieselben Schüler — Panel wäre doppelt (Tag-Simulation L5)
    let liste=$('ohne-platz'); if(!liste){ liste=document.createElement('div'); liste.id='ohne-platz'; liste.className='panel'; $('plan-wrap').after(liste); }
    // Beamer: wie die Kacheln — abgekürzte Namen, kein LB an der Wand (Prüfer 2026-09-29)
    liste.innerHTML='<h2>Ohne Sitzplatz</h2>'+ohnePlatz.map(s=>'<button class="btn still u-m3" data-nr="'+s.nr+'">'+esc(anzeigeVorname(s))+' '+esc(anzeigeNachname(s))+(s.lb&&!beamerModus?' · LB':'')+(aktiveTeilgruppe&&!s.gruppe?' · ohne Gruppe':'')+'</button>').join('');
    liste.querySelectorAll('[data-nr]').forEach(b=>b.onclick=()=>{ const nr=Number(b.dataset.nr); if(stempelTyp) stempleKachel(nr); else schuelerBlatt(nr); });  // Stempel gilt auch ohne Sitzplatz (Tag-Simulation L1)
  } else { const l=$('ohne-platz'); if(l) l.remove(); }
}
// Leerer Tisch im Unterricht (Zero 2026-10-02: „wenn ich auf ein leeren Tisch später tippe will ich immer noch Schüler dort
// eintragen können. Dann übernimmt der Schüler den Platz“) — sein alter Platz wird leer (Zero 02.10. abends: „nichts hinter sich lassen“). Tische selbst setzt nur der Editor.
function tischWahl(key){
  const k=kurs(); if(!k) return;
  const vergeben=new Set(Object.values((vault.stamm.sitzplaene[k.id]||{}).grid||{}));
  const alle=kursSchueler(k).slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'de')||String(a.vorname).localeCompare(String(b.vorname),'de'));
  const knopf=s=>el('button',{type:'button',class:'btn still',dataset:{tischSetz:String(s.nr)},onclick:()=>{
    vault.stamm.sitzplaene[k.id]=setzeAufPlatz(vault.stamm.sitzplaene[k.id]||{grid:{}},key,s.nr); stammMutiert(); speichern(); dlgZu(); renderHeute();
    toast(anzeigeVorname(s)+' sitzt jetzt hier'); }},anzeigeVorname(s)+' '+anzeigeNachname(s));
  const ohne=alle.filter(s=>!vergeben.has(s.nr)), mit=alle.filter(s=>vergeben.has(s.nr));
  dlgZeigenEl(el('h3',{},'Leerer Tisch'),
    el('p',{class:'u-hinweis'},'Antippen setzt den Schüler hierher. Sein alter Platz wird frei.'),
    el('p',{class:'tisch-wahl-kopf'},'Ohne Platz'),ohne.length?el('div',{class:'tisch-wahl'},...ohne.map(knopf)):el('p',{class:'u-hinweis'},'Alle haben einen Platz.'),
    ...(mit.length?[el('p',{class:'tisch-wahl-kopf'},'Umsetzen'),el('div',{class:'tisch-wahl'},...mit.map(knopf))]:[]),
    el('div',{class:'btn-reihe'},el('button',{type:'button',class:'btn still',onclick:dlgZu},'Abbrechen')));
}
let planTipp=null;   // wo der Finger aufsetzte — Wischen ist kein Antippen, öffnet kein Blatt und stempelt nicht (Zero 2026-10-01)
$('plan').addEventListener('pointerdown',e=>{ planTipp={x:e.clientX,y:e.clientY}; });
$('plan').addEventListener('pointerup',e=>{
  const t=planTipp; planTipp=null;
  const kachel=e.target.closest('.kachel.schueler, .kachel.tisch'); if(!kachel) return;
  if(t&&Math.hypot(e.clientX-t.x,e.clientY-t.y)>=8) return;   // gewischt, nicht getippt (Schwelle wie im Editor)
  kachelAktion(kachel);
});
// Tastatur (Codex 07.10. B5): Enter und Leertaste auf einer Kachel tun dasselbe wie Antippen
$('plan').addEventListener('keydown',e=>{
  if((e.key!=='Enter'&&e.key!==' ')||e.repeat) return;
  const kachel=e.target.closest('.kachel.schueler, .kachel.tisch'); if(!kachel||kachel!==e.target) return;
  if(editorAktiv||$('plan').classList.contains('editor')) return;   // der Editor bedient seine Tasten selbst (Prüfer 19.10. B4)
  e.preventDefault();   // Leertaste scrollt sonst die Seite
  const platz='[data-r="'+kachel.dataset.r+'"][data-c="'+kachel.dataset.c+'"]';
  kachelAktion(kachel);
  // Ein Stempel zeichnet den Plan neu und nähme den Fokus mit — er bleibt auf demselben Platz, eine Serie geht per Tastatur (Prüfer 19.10. B3)
  requestAnimationFrame(()=>{ if($('dlg').open) return; const neu=$('plan').querySelector('.kachel'+platz); if(neu&&neu!==document.activeElement) neu.focus(); });
});
function kachelAktion(kachel){
  if(editorAktiv||$('plan').classList.contains('editor')) return;
  if(kachel.classList.contains('tisch')){ if(!stempelTyp&&!busy) tischWahl(kachel.dataset.r+','+kachel.dataset.c); return; }   // mit scharfem Stempel geschieht nichts (Wischen über den Plan)
  const nr=Number(kachel.dataset.nr);
  if(stempelTyp){ stempleKachel(nr); return; }   // Stempel scharf: direkt setzen, kein Dialog
  if(busy) return;
  schuelerBlatt(nr);   // leere Hand = anschauen (Detail-Blatt · Master-Detail)
}
HANDY.addEventListener('change',()=>{ if(vault){ renderHeute(); hilfeNeu(); } });   // über 600 px gedreht: Stunde und Umschalter wandern zwischen Kopf/fester Zeile (Handy) und Streifen (v1.13.0)
// P4.5 · Serien-Stempel: eine Kachel bekommt den scharfen Stempel. Pro Kachel ~80 ms Sperre,
// damit ein Wischen nicht doppelt zählt — aber verschiedene Kacheln bleiben frei (kein globaler Lock).
// Fehlende sind nicht bewertbar (Zero-Feldtest 2026-07-10): keine ＋/o/−, keine direkte Note,
// kein ⭐, kein ⊘ (Verweigerung setzt Anwesenheit voraus). Die 6 bei unentschuldigtem Fehlen
// entsteht RECHNERISCH (verdichte: u zählt als 6/0 P termingewichtet) — nie per Hand-Stempel.
// Frei bleiben: ⏰ (kommt zu spät), ✎ Notiz, Lernzeit/Material-Doku, Anwesenheits-Stempel, ⌫.
const BEWERTUNGS_TYPEN=new Set(['+','o','-','note','bestleistung','verweigert']);
const FEHLT_WORT={o:'abwesend (offen)',e:'entschuldigt',u:'unentschuldigt'};
function bewertGuard(nr){
  const st=standAmTermin(nr,terminDatum);
  if(!st.fehlt) return true;
  const s=stammKind(nr);
  toast((s?s.vorname:'Nr '+nr)+' fehlt heute — '+(FEHLT_WORT[st.fehlt]||st.fehlt)+'. Erst Abwesenheit entfernen (⌫), dann bewerten.',3200);
  return false;
}
function stempleKachel(nr){
  if(stempelCooldown.has(nr)) return;
  stempelCooldown.add(nr); setTimeout(()=>stempelCooldown.delete(nr),80);
  if(BEWERTUNGS_TYPEN.has(stempelTyp)&&!bewertGuard(nr)) return;
  const s=schuelerVonNr(nr);
  if(stempelTyp==='verweigert'){ verweigerungDialog(s); return; }  // 6 mit gekoppelter Kurznotiz
  if(stempelTyp==='bestleistung'){ bestleistungDialog(s); return; } // Gegenstück: Bestnote mit Begründung
  if(stempelTyp==='versp'){ verspStempel(s); return; }             // bucht die Minuten seit Blockbeginn, ein zweiter Tipp passt an
  if(stempelTyp==='notiz'){ notizDialog(s); return; }              // Kurznotiz je Schüler
  if(stempelTyp==='note'){ noteDialog(s); return; }                // Notenauswahl je Schüler (Rail-2×2-Feld 📊)
  if(stempelTyp==='entfernen'){ entferneLetzten(nr); pulseKachel(nr); return; } // schnelle Korrektur im Stempelfluss
  addEvent(stempelTyp,nr);        // +/o/−/∅/e/u/📱/📕 direkt · landet im Undo-Stapel (LIFO)
  renderHeute();                  // Zähler + Kachel-Symbole aktualisieren
  pulseKachel(nr);
}
// Letzten heutigen Eintrag eines Schülers entfernen (Storno) — für ↩-Stempel + Aktionsbar
function entferneLetzten(nr){
  const sid=sidVonNr(nr);   // Eintrag → Kind über die sid (v2.2)
  const evs=wirksameEvents(vault.events).filter(e=>e.kursId===aktiverKursId&&e.sid===sid&&e.datum===terminDatum&&e.typ!=='storno'&&e.typ!=='quartalsnote');
  if(!evs.length){ toast('nichts zu entfernen'); return; }
  const letzte=evs.reduce((a,e)=>String(e.ts)>String(a.ts)?e:a);
  stornoVon(letzte); toast('entfernt: '+eintragLabel(letzte)+wiederDa(letzte)); renderHeute(); zeigeRedo(letzte);
}
// v1.1.0 · Verweigerung: anwesend, aber keine/verweigerte Leistung → zählt als 6 (Sek II 0 P),
// termingewichtet (logic/verdichtung). Kurznotiz gekoppelt — dokumentiert den Grund (bei einer 6 ratsam).
// opt (v1.11.0, Tag bewerten aus dem Verlauf): {datum} bucht auf diesen Tag statt auf den Termin, {danach} zeichnet neu statt „Heute“
function verweigerungDialog(s,opt={}){
  if(!s) return;
  opt={kursId:aktiverKursId,...opt};   // auch aus dem Stempel: nach einem Kurswechsel nichts buchen (Prüfer 03.10. 🟡 3)
  const ta=el('textarea',{rows:'2',class:'u-textarea u-fs16',placeholder:'z. B. Mitarbeit verweigert, Aufgabe nicht bearbeitet'});
  dlgZeigenEl(
    el('h3',{},iconEl('verweigert'),' Verweigerung · '+s.vorname),
    el('p',{class:'u-hinweis'},'Zählt für diese Stunde als 6 (Sek II: 0 P), termingewichtet. Kurznotiz zur Begründung:'),
    ta,
    el('div',{class:'btn-reihe'},
      el('button',{class:'btn',onclick:()=>{ if(kursGewechselt(opt)) return; addEvent('verweigert',s.nr,{notiz:ta.value.trim(),...tagFeld(opt)}); dlgZu(); toast('Verweigerung notiert (zählt 6) · '+s.vorname); (opt.danach||renderHeute)(); pulseKachel(s.nr); }},'Eintragen (6)'),
      el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
  setTimeout(()=>ta.focus(),60);
}
// v1.3 · Besondere Leistung (Zero 2026-07-09): Gegenstück zur Verweigerung — trägt automatisch die
// Bestnote als direkte note ein (Sek I: 1 · Sek II: 15 P, bestehender note-Pfad, keine Logik-Änderung)
// + optionale gekoppelte Notiz zur Begründung. Kachel zeigt danach 📊 (+ ✎ bei Notiz).
function bestleistungDialog(s,opt={}){
  if(!s) return;
  opt={kursId:aktiverKursId,...opt};   // auch aus dem Stempel: nach einem Kurswechsel nichts buchen (Prüfer 03.10. 🟡 3)
  const sek2=bewertProfil(kurs())==='sek2';
  const wert=sek2?'15':'1', label=sek2?'15 P':'Note 1';
  const ta=el('textarea',{rows:'2',class:'u-textarea u-fs16',placeholder:'z. B. herausragender Beitrag, eigenständige Lösung vorgestellt'});
  // Note zuletzt buchen: der ↶-Chip nimmt dann den ⭐ zurück, nicht die Notiz
  dlgZeigenEl(
    el('h3',{},iconEl('best'),' Besondere Leistung · '+s.vorname),
    el('p',{class:'u-hinweis'},'Trägt '+label+' als direkte Note ein. Kurznotiz zur Begründung (empfohlen):'),
    ta,
    el('div',{class:'btn-reihe'},
      el('button',{class:'btn',onclick:()=>{ if(kursGewechselt(opt)) return; const txt=ta.value.trim(); if(txt) addEvent('notiz',s.nr,{notiz:txt,...tagFeld(opt)}); addEvent('note',s.nr,{wert,best:true,...tagFeld(opt)}); dlgZu(); toast('Besondere Leistung: '+label+' · '+s.vorname); (opt.danach||renderHeute)(); pulseKachel(s.nr); }},'Eintragen ('+label+')'),
      el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
  setTimeout(()=>ta.focus(),60);
}
// Setter für Ansichten-Module (A2 Schnitt 4): ein Import ist schreibgeschützt, geschrieben wird von außen nur hierüber
function setzeBusy(w){ busy=w; }

export { busy, stempelCooldown, beamerKurz, anzeigeVorname, anzeigeNachname, HANDY, erfassWahl, listenSortierung, sichtbareSchueler, planKontext, kursImPlan, eintragsTage, kursKontext, zeigeTag, geheZuTag, springeStunde, springeWoche, angezeigteStunde, stundeUntertitel, stundeNav, heuteKnopf, datumStreifen, stundeWaehlen, stundenplanAnsicht, oeffneStunde, zufallLaeuft, zufallsSchueler, markenListe, markenHtml, markenEl, kachelKlassen, kachelHtml, listenZeile, erfassUmschalter, renderHeute, ohnePlatzPanel, tischWahl, planTipp, kachelAktion, BEWERTUNGS_TYPEN, FEHLT_WORT, bewertGuard, stempleKachel, entferneLetzten, verweigerungDialog, bestleistungDialog, setzeBusy };
