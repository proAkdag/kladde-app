// Kladde · js/ansichten/schueler.mjs — Abschnitt „SCHÜLER + Übersichts-Tabellen“ (A2 Schnitt 4: wörtlich aus js/app.mjs, verhaltensneutral).
// Ansichten dürfen einander direkt importieren, der Kern (js/kern/) nie eine Ansicht (Zero 19.10.: „Direkt, Kern ringfrei“).
import { schuelerBericht } from '../../logic/bericht.mjs?v=2.3.0.1792517281';
import { drittelnoteLabel, einheitPasst, einheitVon, noteAlsWert, wertZuLabel } from '../../logic/skalen.mjs?v=2.3.0.1792517281';
import { sidVonKind } from '../../logic/identitaet.mjs?v=2.3.0.1792517281';
import { lnr } from '../../logic/teilnehmer.mjs?v=2.3.0.1792517281';
import { istTerminEintrag, kursEinordnung, notenAbstand, quartalsVerlauf, regelText, verdichte, vorschlagsZeilen, wirksameEvents } from '../../logic/verdichtung.mjs?v=2.3.0.1792517281';
import { dlgZeigenEl, dlgZu } from '../kern/dialog.mjs?v=2.3.0.1792517281';
import { $, el, esc, toast } from '../kern/dom.mjs?v=2.3.0.1792517281';
import { iconEl, iconHtml } from '../kern/icons.mjs?v=2.3.0.1792517281';
import { speichern, stammMutiert } from '../kern/tresor.mjs?v=2.3.0.1792517281';
import { aktiverKursId, aktView, beamerModus, heuteIso, vault } from '../kern/zustand.mjs?v=2.3.0.1792517281';
import { addEvent, bewertProfil, datumLabel, kindVonEvent, kurs, kursSchueler, listenNr, nrVonEvent, reduziereStand, schuelerVonNr, sidVonNr, stammKind, stornoVon, TYP_LABEL, wiederDa, zeigeRedo } from './eintraege.mjs?v=2.3.0.1792517281';
import { FEHLT_WORT, markenEl, markenHtml } from './heute.mjs?v=2.3.0.1792517281';
import { nachtragLeisten } from './kurswahl.mjs?v=2.3.0.1792517281';
import { mitUebergang } from './navigation.mjs?v=2.3.0.1792517281';
import { kursGewechselt, NOTEN_DRITTEL, notizDialog, oeffneTag, tagBewerten, tagBewertenHtml } from './stempel.mjs?v=2.3.0.1792517281';

/* ═══ SCHÜLER · Verdichtung + Inline-Detail-Akkordeon (kein Popup) ═══ */
let offenerSchueler=null, offeneZeile=null, zeitraumFilter=null, schuelerSuche='', schuelerFilter=null, sListeScroll=0;
let schuelerAnsicht='liste', schuelerSort='nr';   // Zero 2026-09-02: Modi Liste·Noten·Termine·Fehlzeiten · Sortierung Nr·Name·Vorschlag·Anlass
// Quartalsnote zeigen (v2.2): in fremder Einheit (Kursmodus inzwischen gewechselt) steht die Einheit dabei — „13 P“ ist keine Drittelnote 13
const qnText=(ev,k)=>String(ev.wert)+(einheitPasst(ev,k)?'':(einheitVon(ev,k)==='punkte'?' P':' (Drittel)'));
function aktivesSchuljahr(){ return (vault.stamm.schuljahre||[]).find(j=>j.id===vault.stamm.aktivesSchuljahrId)||null; }
function renderSchueler(){
  nachtragLeisten();   // renderSchueler läuft auch direkt (nicht nur über renderAlles)
  const k=kurs(); const wrap=$('view-schueler');
  if(!k){ wrap.innerHTML='<p class="u-leise">Kein Kurs gewählt.</p>'; return; }
  // Beamer/Projektion: sensible Auswertung KOMPLETT sperren (§3.4)
  if(beamerModus){ wrap.innerHTML='<div class="panel"><h2>'+iconHtml('auge')+' Projektionsmodus</h2><p class="u-leise">Die Schüler-Auswertung ist bei aktiver Projektion ausgeblendet. Oben im Hinweis „Beenden“ antippen.</p></div>'; return; }
  const kursEvents=vault.events.filter(e=>e.kursId===k.id);
  // Vollseite statt Akkordeon (Zero 2026-07-09): gewählter Schüler bekommt die ganze Ansicht
  if(offenerSchueler!=null){ const s=schuelerVonNr(offenerSchueler); if(s){ renderSchuelerSeite(wrap,k,s,kursEvents); return; } offenerSchueler=null; }
  const sj=aktivesSchuljahr();
  const zr=zeitraumFilter;
  const vOpt={profil:bewertProfil(k),von:zr?zr.von:'',bis:zr?zr.bis:'9999-12-31'};
  const kurzL=l=>l.replace('. Quartal','. Q').replace('. Halbjahr','. HJ');
  // Ansichts-Modi (Zero 2026-09-02): Liste · Noten (Tabelle) · Termine (Matrix) · Fehlzeiten — die Tabellen sind el()-gebaut
  if(schuelerAnsicht!=='liste'){ renderSchuelerTabelle(wrap,k,kursEvents,sj,zr,kurzL); return; }
  const heute=heuteIso();
  const offeneO=wirksameEvents(kursEvents).filter(e=>e.typ==='fehlt_o').sort((a,b)=>String(a.datum).localeCompare(String(b.datum)));
  // Kopf (Zero 2026-09-29): Ansicht + EINE Zeile Suche · Zeitraum · Filter · Sortierung statt fünf Chip-Reihen —
  // native select öffnet am iPad den System-Wähler; aktiver Zeitraum/Filter bekommt den Goldrand (Liste ist eingeschränkt)
  const optionen=(liste,wahl)=>liste.map(([id,lab])=>'<option value="'+id+'"'+(wahl===id?' selected':'')+'>'+esc(lab)+'</option>').join('');
  const zrListe=sj&&sj.zeitraeume&&sj.zeitraeume.length?[['','Gesamt'],...sj.zeitraeume.map(z=>[z.id,z.label])]:null;
  let html=modusChipsHtml()+'<div class="s-kopf">'+
    '<input id="s-suche" class="s-such-feld" type="text" placeholder="Schüler suchen …" aria-label="Schüler suchen" autocomplete="off" enterkeyhint="search" value="'+esc(schuelerSuche)+'">'+
    (zrListe?'<select id="s-zr" class="s-wahl'+(zr?' an':'')+'" aria-label="Zeitraum">'+optionen(zrListe,zr?zr.id:'')+'</select>':'')+
    '<select id="s-filter" class="s-wahl'+(schuelerFilter?' an':'')+'" aria-label="Filter">'+optionen(S_FILTER,schuelerFilter||'')+'</select>'+
    '<select id="s-sort" class="s-wahl" aria-label="Sortierung">'+optionen(S_SORT,schuelerSort)+'</select></div>';
  // Klärungsliste (P3.5 Phase 2) als rechte Spalte wie die Stempel-Rail (Zero 2026-09-29) — die Liste beginnt oben
  const klaerZeilen=offeneO.map(e=>{ const s=kindVonEvent(e);
    const tageOffen=Math.floor((new Date(heute)-new Date(e.datum))/86400000);
    const alt=tageOffen>7;
    return '<div class="klaer-zeile'+(alt?' alt':'')+'"><span class="klaer-wer"><b>'+esc(s?s.vorname+' '+s.name:'?')+'</b><small>'+datumLabel(e.datum)+(alt?' · '+tageOffen+' Tage offen':'')+'</small></span>'+
      '<span class="klaer-btns"><button class="btn still u-btn-klein" data-klaer="e" data-o="'+e.id+'">Entsch.</button>'+
      '<button class="btn still u-btn-klein" data-klaer="u" data-o="'+e.id+'">Unentsch.</button>'+
      '<button class="btn still u-btn-klein" data-klaer="irrtum" data-o="'+e.id+'">Irrtum</button></span></div>'; }).join('');
  // Keine offenen Fehlzeiten: eine Zeile über der Liste statt einer leeren Karte (Zero 2026-09-30, Codex-Prüfbericht)
  const seite=offeneO.length?'<aside class="s-seite" aria-label="Offene Fehlzeiten"><div class="rail-karte"><div class="rail-titel">Offene Fehlzeiten ('+offeneO.length+')</div>'+
    klaerZeilen+'</div></aside>':'';
  // Am Handy steht die Klärung als Leiste über der Liste, ein Tipp öffnet das Klärblatt (Scheibe 6, Zero 03.10.: „A · Leiste über der Liste“) —
  // vorher standen dort alle Klär-Karten vor der Liste. Am iPad bleibt die Spalte, die Leiste zeigt nur das CSS ≤ 900 px.
  html='<div class="s-layout"><div class="s-haupt">'+(offeneO.length?'<button type="button" class="s-klaer-leiste" data-klaer-leiste aria-haspopup="dialog"><span>'+iconHtml('warnung')+' <b>'+offeneO.length+' offene Fehlzeit'+(offeneO.length>1?'en':'')+'</b></span><span>klären ›</span></button>':'<p class="s-fz-leer u-hinweis">Keine offenen Fehlzeiten.</p>')+html;
  // Rechenregel aufklappbar — sichtbar bleibt der Vorschlag in der Liste (Zero 2026-09-30, Codex-Prüfbericht)
  html+='<div class="panel"><h2>'+esc(k.name)+' · '+esc(zr?zr.label:'Verdichtung')+'</h2><details class="s-regel"><summary>Wie entsteht der Vorschlag?</summary><p class="u-regelzeile">'+esc(regelText(bewertProfil(k)))+'</p></details>'+
    '<div class="btn-reihe"><button class="btn still u-btn-klein" data-kopiere title="Nr + Note in die Zwischenablage — in die Excel-Klassenmappe einfügen">'+iconHtml('kopieren')+' '+esc(zr?kurzL(zr.label):'Gesamt')+'-Vorschläge für Excel kopieren</button></div>';
  // Terminliste des Kurses für den „seit N Terminen kein Eintrag"-Anlass (C3)
  const alleTermine=[...new Set(wirksameEvents(kursEvents).filter(istTerminEintrag).map(e=>e.datum))].sort();
  const heuteNrs=new Set(wirksameEvents(kursEvents).filter(e=>e.datum===heute&&e.typ!=='quartalsnote'&&e.typ!=='storno').map(e=>e.sid));   // sids (v2.2)
  const profil=bewertProfil(k);
  // Erst rechnen, dann sortieren, dann zeichnen (Punkt 3) — die Vorschlagswerte braucht die Sortierung
  const daten=kursSchueler(k).map(s=>{
    const v=verdichte(kursEvents,sidVonKind(s,k.id),{...vOpt,lb:s.lb});
    // Entscheidung zuerst (C3): gesetzte Quartalsnote > Vorschlag; Detailwerte leben auf der Vollseite
    const qnEv=zr?quartalsnotenVon(kursEvents,sidVonKind(s,k.id))[QN_KEY[zr.id]]:null;
    const offenN=offeneO.filter(e=>e.sid===sidVonKind(s,k.id)).length;
    let anlass='', anlassWarn=false;
    if(offenN){ anlass=offenN+' offene Fehlzeit'+(offenN>1?'en':''); anlassWarn=true; }
    else if(alleTermine.length){
      const mit=new Set(wirksameEvents(kursEvents).filter(e=>e.sid===sidVonKind(s,k.id)&&istTerminEintrag(e)).map(e=>e.datum));
      let ohne=0; for(let i=alleTermine.length-1;i>=0&&!mit.has(alleTermine[i]);i--) ohne++;
      if(ohne>=3) anlass='seit '+ohne+' Terminen kein Eintrag';
    }
    const abw=qnEv&&v.vorschlag&&einheitPasst(qnEv,k)?notenAbstand(qnEv.wert,v.vorschlag.wert,profil):null;   // Punkt 4: gesetzte Note ↔ Vorschlag
    return {s,v,qnEv,offenN,anlass,anlassWarn,abw};
  });
  sortiereSchuelerDaten(daten,schuelerSort,profil);
  for(const {s,v,qnEv,offenN,anlass,anlassWarn,abw} of daten){
    const flags=[]; if(offenN) flags.push('offen'); if(qnEv) flags.push('gesetzt'); if(!qnEv&&!v.vorschlag) flags.push('ohnev');
    if(s.lb) flags.push('lb'); if(!heuteNrs.has(sidVonKind(s,k.id))) flags.push('ohneheute'); if(v.pfeil==='↓') flags.push('runter');
    const entscheidung=qnEv?'<span class="qn-fest" title="gesetzte Quartalsnote">'+esc(qnText(qnEv,k))+' <small>gesetzt</small></span>'+
        (abw!=null&&abw>=1?'<small class="s-abw" title="weicht mindestens eine Stufe vom Vorschlag ab">'+iconHtml('warnung')+' V '+esc(v.vorschlag.label)+'</small>':'')
      :(v.vorschlag?'<span class="s-vorschlag"><small>Vorschlag</small> '+esc(v.vorschlag.label)+'</span>':'—');
    html+='<div class="s-block" data-name="'+esc((s.vorname+' '+s.name).toLowerCase())+'" data-flags="'+flags.join(' ')+'"><button type="button" class="s-item" data-nr="'+s.nr+'" aria-expanded="false">'+
      '<span class="u-minw104"><b>'+esc(s.vorname)+'</b> <small class="u-leise">'+esc(s.name)+'</small>'+(s.lb?' <span class="lb-badge">LB</span>':'')+'</span>'+
      '<span class="u-flex1">'+(anlass?'<small class="s-anlass'+(anlassWarn?' warn':'')+'">'+anlass+'</small>':'')+'</span>'+
      '<span class="u-wert-rechts">'+entscheidung+'</span>'+
      '<span class="pfeil">›</span></button></div>';
  }
  // Sammeln (Punkt 5): alle offenen Vorschläge des Quartals in einem Zug — mit Prüfliste, nie still
  const sammelbar=zr&&/^q[1-4]$/.test(zr.id)?daten.filter(d=>!d.qnEv&&d.v.vorschlag&&!d.s.lb):[];
  if(sammelbar.length) html+='<div class="btn-reihe"><button class="btn still u-btn-klein" data-sammeln>Alle '+sammelbar.length+' offenen Vorschläge als '+esc(kurzL(zr.label))+'-Note übernehmen…</button></div>';
  html+='</div></div>'+seite+'</div>';
  wrap.innerHTML=html;
  verdrahteModus(wrap);
  $('s-sort').onchange=e=>{ schuelerSort=e.target.value; mitUebergang(renderSchueler); };
  const bsam=wrap.querySelector('[data-sammeln]'); if(bsam) bsam.onclick=()=>quartalsnotenSammeln(k,zr,sammelbar);
  // Schüler-Suche + Nacharbeits-Filter: Live-Filter per hidden-Klasse (kein Re-Render → Fokus bleibt, iPad-Tastatur zu-fest)
  const filterS=()=>{ const q=schuelerSuche.trim().toLowerCase();
    wrap.querySelectorAll('.s-block').forEach(b=>{
      const passtQ=!q||(b.dataset.name||'').includes(q);
      const passtF=!schuelerFilter||(b.dataset.flags||'').split(' ').includes(schuelerFilter);
      b.classList.toggle('hidden', !(passtQ&&passtF));
    }); };
  const suche=$('s-suche'); if(suche){ suche.oninput=e=>{ schuelerSuche=e.target.value; filterS(); }; filterS(); }
  $('s-filter').onchange=e=>{ schuelerFilter=e.target.value||null; e.target.classList.toggle('an',!!schuelerFilter); filterS(); };
  const zrSel=$('s-zr'); if(zrSel) zrSel.onchange=e=>{ const id=e.target.value; zeitraumFilter=id&&sj?sj.zeitraeume.find(z=>z.id===id):null; offenerSchueler=null; mitUebergang(renderSchueler); };
  // Klärung — aus der Seitenspalte UND aus der aufgeklappten Zeile (eine Funktion, zwei Orte)
  const klaerKlick=(oId,art,danach)=>{   // danach(meldung): das Klärblatt zeichnet sich neu (Handy) und nennt dort, was geschah
    const o=vault.events.find(x=>x.id===oId); if(!o) return;
    const sName=(kindVonEvent(o)||{}).vorname||'?';
    // Klärung = Storno des fehlt_o + neues fehlt_e/fehlt_u am ORIGINALDATUM (Merge-fest, verdichte löst jüngste-ts)
    // Ohne Buchung (Archiv, Kurswechsel) keine Erfolgsmeldung: der Grund steht frei, ein offenes Blatt schließt (Prüfer 03.10. 🟢 11)
    const klaere=()=>{ if(!addEvent(art==='e'?'fehlt_e':'fehlt_u',nrVonEvent(o),{datum:o.datum,stornoVon:o.id})){ dlgZu(); return; }
      const m='Geklärt: '+(art==='e'?'entschuldigt':'unentschuldigt')+' ('+datumLabel(o.datum)+')'; toast(m); renderSchueler(); if(danach) danach(m); };
    if(art==='irrtum'){ if(stornoVon(o)){ const m='Irrtum — Abwesenheit entfernt'; toast(m); zeigeRedo(o); renderSchueler(); if(danach) danach(m); } else dlgZu(); }
    else if(art==='u'){
      // Unentschuldigt ist folgenreich (NRW §48) → kurze Bestätigung mit Name + Datum (C3)
      dlgZeigenEl(el('h3',{},'Unentschuldigt?'),
        el('p',{class:'u-hinweis'},sName+' · '+datumLabel(o.datum)+' als unentschuldigt festschreiben?'),
        el('div',{class:'btn-reihe'},
          el('button',{class:'btn gefahr',onclick:()=>{ dlgZu(); klaere(); }},'Unentschuldigt'),
          el('button',{class:'btn still',onclick:()=>{ if(danach) danach(); else dlgZu(); }},'Abbrechen')));
    }
    else klaere();
  };
  wrap.querySelectorAll('[data-klaer]').forEach(b=>b.onclick=ev=>{ ev.stopPropagation(); klaerKlick(b.dataset.o,b.dataset.klaer); });
  // Klärblatt (Handy): dieselben Zeilen wie die Spalte am iPad, nach jeder Klärung frisch aus dem Log gezeichnet; ohne offene schließt es.
  // Meldung und ↶ stehen IM Blatt — Toast und Chip lägen unter dem Dialog (Prüfer 03.10. 🟡 2, wie im Schülerblatt): der Knopf tut, was
  // der Chip gerade anbietet (↶, nach einem Irrtum ↷), danach nennt das Blatt dessen Meldung
  let blattZeile=null;   // Tastatur: nach dem Neuzeichnen steht der Fokus auf der Zeile, die nachgerückt ist (Prüfer 03.10. 🟢 8)
  const klaerBlatt=meldung=>{
    const offen=wirksameEvents(vault.events).filter(e=>e.kursId===k.id&&e.typ==='fehlt_o').sort((a,b)=>String(a.datum).localeCompare(String(b.datum)));
    if(!offen.length){ dlgZu(); toast((meldung?meldung+' · ':'')+'keine offenen Fehlzeiten mehr'); return; }
    const chip=$('undo-chip'), rueck=meldung&&chip.onclick?el('button',{type:'button',class:'btn still u-btn-klein',dataset:{klaerRueck:''},
      onclick:()=>{ const tap=chip.onclick; blattZeile=null; tap(); klaerBlatt($('toast').textContent); }},...[...chip.childNodes].map(n=>n.cloneNode(true))):null;
    const knopf=(o,art,txt,i)=>el('button',{type:'button',class:'btn still u-btn-klein',dataset:{klaer:art},onclick:()=>{ blattZeile=i; klaerKlick(o.id,art,klaerBlatt); }},txt);
    dlgZeigenEl(el('h3',{},'Offene Fehlzeiten ('+offen.length+')'),
      el('p',{class:'u-hinweis'},'Ein Tipp klärt: entschuldigt, unentschuldigt oder Irrtum (∅ war falsch).'),
      el('div',{class:'s-seite s-klaer-blatt'},...offen.map((o,i)=>{ const s=kindVonEvent(o), tage=Math.floor((new Date(heuteIso())-new Date(o.datum))/86400000);
        return el('div',{class:'klaer-zeile'+(tage>7?' alt':'')},el('span',{class:'klaer-wer'},el('b',{},s?s.vorname+' '+s.name:'?'),el('small',{},datumLabel(o.datum)+(tage>7?' · '+tage+' Tage offen':''))),
          el('span',{class:'klaer-btns'},knopf(o,'e','Entsch.',i),knopf(o,'u','Unentsch.',i),knopf(o,'irrtum','Irrtum',i))); })),
      el('p',{class:'u-hinweis sb-warn klaer-status',role:'status'},...(meldung?[meldung,rueck?' ':null,rueck]:[])));   // am Blattende, unten angeheftet (CSS)
    if(blattZeile!=null){ const z=$('dlg').querySelectorAll('.klaer-zeile')[Math.min(blattZeile,offen.length-1)], b=z&&z.querySelector('button'); if(b) b.focus(); }
  };
  const bkl=wrap.querySelector('[data-klaer-leiste]'); if(bkl) bkl.onclick=()=>{ blattZeile=null; klaerBlatt(); };
  // Zeile antippen klappt sie auf (Zero 2026-09-29: „Dropdown bei Schülerklick") — immer nur eine offen;
  // die Vollseite bleibt hinter „ganze Seite ›" für Verlauf, Zeitstrahl und Kurzbericht
  const zu=(block,sofort)=>{
    const auf=block.querySelector('.s-auf'); block.classList.remove('offen');
    block.querySelector('.s-item').setAttribute('aria-expanded','false');
    if(!auf) return;
    if(sofort){ auf.remove(); return; }
    let weg=false; const entferne=()=>{ if(!weg){ weg=true; auf.remove(); } };
    auf.addEventListener('transitionend',entferne,{once:true}); setTimeout(entferne,320);  // Rückfall ohne transitionend (reduced motion)
  };
  const auf=(block,animiert)=>{
    const s=schuelerVonNr(Number(block.querySelector('.s-item').dataset.nr)); if(!s) return;
    const flaeche=el('div',{class:'s-auf'},el('div',{class:'s-auf-innen'},schuelerAufklapp(k,s,kursEvents,vOpt,offeneO,klaerKlick)));
    block.append(flaeche);
    if(animiert) void flaeche.offsetHeight;   // 0fr erst messen lassen, dann auf 1fr — sonst springt es ohne Übergang
    block.classList.add('offen'); block.querySelector('.s-item').setAttribute('aria-expanded','true');
  };
  wrap.querySelectorAll('.s-item').forEach(b=>b.onclick=()=>{
    const block=b.closest('.s-block'), nr=Number(b.dataset.nr);
    if(offeneZeile===nr){ offeneZeile=null; zu(block,false); return; }
    // die bisher offene Zeile sofort schließen und den Scroll so nachführen, dass die angetippte Zeile unter dem Finger bleibt
    const alt=offeneZeile!=null?wrap.querySelector('.s-item[data-nr="'+offeneZeile+'"]'):null;
    if(alt){ const vorher=b.getBoundingClientRect().top; zu(alt.closest('.s-block'),true);
      const m=document.querySelector('main'); if(m) m.scrollTop+=b.getBoundingClientRect().top-vorher; }
    offeneZeile=nr; auf(block,true);
  });
  if(offeneZeile!=null){ const b=wrap.querySelector('.s-item[data-nr="'+offeneZeile+'"]'); if(b) auf(b.closest('.s-block'),false); else offeneZeile=null; }
  const bkv=wrap.querySelector('[data-kopiere]'); if(bkv) bkv.onclick=kopiereVorschlaege;
}
// Inhalt der aufgeklappten Zeile (Zero 2026-09-29: „Kompakt + ganze Seite ›") — el()-gebaut (CSP), erst beim Öffnen:
// Bilanz ＋/o/− · Q1–Q4 zum Antippen · offene Fehlzeiten mit Klärung · letzte Einträge · Notiz · ganze Seite
function schuelerAufklapp(k,s,kursEvents,vOpt,offeneO,klaerKlick){
  const v=verdichte(kursEvents,sidVonKind(s,k.id),{...vOpt,lb:s.lb});
  const sum=Math.max(1,v.nPlus+v.nNull+v.nMinus);
  const teil=(cls,n)=>{ const d=el('span',{class:cls}); d.style.width=(100*n/sum)+'%'; return d; };  // CSSOM statt style-Attribut (CSP)
  const bilanz=el('div',{class:'s-auf-zeile'},
    el('span',{class:'balken'},teil('bal-p',v.nPlus),teil('bal-o',v.nNull),teil('bal-m',v.nMinus)),
    el('span',{class:'s-auf-zahl'},v.nPlus+'⁺ '+v.nNull+'° '+v.nMinus+'⁻'),
    el('span',{class:'u-leise'},'Beteiligung '+v.beteiligtTermine+' / '+v.kursTermine+' Termine · Verlauf '+v.pfeil));
  const sj=aktivesSchuljahr(); const qn=quartalsnotenVon(kursEvents,sidVonKind(s,k.id));
  const zellen=['q1','q2','q3','q4'].map(id=>{
    const z=sj&&sj.zeitraeume?sj.zeitraeume.find(x=>x.id===id):null;
    const ev=qn[QN_KEY[id]];
    const vz=z?verdichte(kursEvents,sidVonKind(s,k.id),{profil:bewertProfil(k),lb:s.lb,von:z.von,bis:z.bis}):null;
    return el('button',{class:'qn-zelle klein'+(ev?'':' offen'),type:'button',onclick:()=>{
        if(!z){ toast('Kein Schuljahres-Zeitraum definiert'); return; }
        setzeQuartalsnote(s,(vz&&vz.vorschlag)||{wert:null,label:'—'},z); }},
      el('span',{class:'qn-label'},id.toUpperCase()),
      el('span',{class:'qn-note'},ev?qnText(ev,k):'—'),
      el('span',{class:'qn-sub'},vz&&vz.vorschlag?'Vorschlag '+vz.vorschlag.label:(s.lb?'LB':'—')));
  });
  const knopf=(txt,fn)=>el('button',{class:'btn still u-btn-klein',type:'button',onclick:fn},txt);
  const fehl=offeneO.filter(e=>e.sid===sidVonKind(s,k.id)).map(o=>el('div',{class:'klaer-zeile'},
    el('span',{},'Fehlzeit '+datumLabel(o.datum)),
    el('span',{class:'klaer-btns'},knopf('Entsch.',()=>klaerKlick(o.id,'e')),knopf('Unentsch.',()=>klaerKlick(o.id,'u')),knopf('Irrtum',()=>klaerKlick(o.id,'irrtum')))));
  const evs=wirksameEvents(kursEvents).filter(e=>e.sid===sidVonKind(s,k.id)&&istTerminEintrag(e));
  const tage=[...new Set(evs.map(e=>e.datum))].sort().reverse().slice(0,5);
  const zuletzt=tage.map(t=>datumLabel(t)+' '+[...new Set(evs.filter(e=>e.datum===t).map(e=>TYP_LABEL[e.typ]||e.typ))].join(' + ')).join(' · ');
  return el('div',{class:'s-auf-inhalt'},
    bilanz,
    el('div',{class:'qn-grid klein'},...zellen),
    ...fehl,
    el('div',{class:'s-auf-zuletzt'},tage.length?'Zuletzt: '+zuletzt:'Noch keine Einträge.'),
    el('div',{class:'btn-reihe s-auf-aktionen'},
      knopf('✎ Notiz',()=>notizDialog(s)),
      el('button',{class:'btn still',type:'button',onclick:()=>{
        sListeScroll=(document.querySelector('main')||{}).scrollTop||0;  // Rückkehr-Anker (C3)
        offenerSchueler=s.nr; mitUebergang(renderSchueler); }},'ganze Seite ›')));
}
// P4.5 · „Vorschläge kopieren": Nr⇥Vorschlag[⇥F-Summen] in die Zwischenablage (kein Datei-Export).
// Der Mensch fügt in die Excel-Klassenmappe ein — Excel bleibt die Noten-Zentrale (User-Entscheid „Beides").
async function kopiereVorschlaege(){
  const k=kurs(); if(!k) return;
  const nrn=kursSchueler(k).map(lnr).filter(n=>n!=null), doppelt=nrn.find((n,i)=>nrn.indexOf(n)!==i);   // nie eine Note in die Zeile eines anderen Kindes (Prüfer Y6)
  if(doppelt!=null){ toast('⚠ Nr '+doppelt+' ist doppelt vergeben — erst die Mappe neu laden (Kurse → Kurs anlegen → Mappe laden)',6000); return; }
  const zr=zeitraumFilter;
  const kursEvents=vault.events.filter(e=>e.kursId===k.id);
  let nFest=0;
  const rows=kursSchueler(k).map(s=>{
    const v=verdichte(kursEvents,sidVonKind(s,k.id),{profil:bewertProfil(k),lb:s.lb,von:zr?zr.von:'',bis:zr?zr.bis:'9999-12-31'});
    const f=(v.nFehltE||v.nFehltU||v.nVerweigert)?(v.nFehltE+'e/'+v.nFehltU+'u'+(v.nVerweigert?'/'+v.nVerweigert+'verw':'')):'';
    // GESETZTE Quartalsnote des gewählten Zeitraums schlägt den Live-Vorschlag (der Lehrer hat entschieden)
    const qnEv=zr?quartalsnotenVon(kursEvents,sidVonKind(s,k.id))[QN_KEY[zr.id]]:null;
    if(qnEv) nFest++;
    return {nr:lnr(s),vorschlag:qnEv?qnText(qnEv,k):(v.vorschlag?v.vorschlag.label:''),fSummen:f};
  });
  const text=vorschlagsZeilen(rows), zeilen=text?text.split('\n').length:0;   // eine Zeile je Listen-Nr 1…höchste, Lücken leer (WAHL U2)
  inZwischenablage(text,'Kopiert ('+zeilen+' Zeilen'+(nFest?' · '+nFest+' gesetzte Quartalsnoten bevorzugt':'')+') — in Excel einfügen','Vorschläge kopieren');
}
// Text in die Zwischenablage; ohne Clipboard-Zugriff ein Textfeld zum manuellen Kopieren (eine Stelle für Vorschläge + Kurzbericht)
async function inZwischenablage(text,toastText,titel,opt={}){
  try{ await navigator.clipboard.writeText(text); toast(toastText,opt.ms); }
  catch{
    const ta=el('textarea',{class:'u-textarea u-fs14',rows:'10',readonly:'readonly'}); ta.value=text;
    dlgZeigenEl(el('h3',{},titel),
      el('p',{class:'u-hinweis'},'Markieren und kopieren (Strg/⌘ + C).'+(opt.hinweis?' '+opt.hinweis:'')),
      ta,
      el('div',{class:'btn-reihe'},el('button',{class:'btn',onclick:dlgZu},'Schließen')));
    setTimeout(()=>{ ta.focus(); ta.select(); },60);
  }
}
// Sortierung der Listenzeilen (Punkt 3). „Vorschlag": gesetzte Note zählt vor dem Vorschlag, beste zuerst; ohne Wert ans Ende.
function sortiereSchuelerDaten(daten,sort,profil){
  const wert=d=>{ if(d.qnEv){ try{ return d.qnEv.einheit&&d.qnEv.einheit!==(profil==='sek2'?'punkte':'drittel')?null:noteAlsWert(d.qnEv.wert,profil); }catch{ return null; } } return d.v.vorschlag?d.v.vorschlag.wert:null; };
  const nachNr=(a,b)=>(lnr(a.s)??Infinity)-(lnr(b.s)??Infinity)||a.s.nr-b.s.nr;   // „nach Nr“ = Listen-Nr (zwei Nummern)
  const cmp={
    nr:nachNr,
    name:(a,b)=>(a.s.name||'').localeCompare(b.s.name||'','de')||(a.s.vorname||'').localeCompare(b.s.vorname||'','de'),
    vorschlag:(a,b)=>{ const wa=wert(a), wb=wert(b); if(wa==null&&wb==null) return nachNr(a,b); if(wa==null) return 1; if(wb==null) return -1; return (profil==='sek2'?wb-wa:wa-wb)||nachNr(a,b); },
    anlass:(a,b)=>((b.anlassWarn?1:0)-(a.anlassWarn?1:0))||((b.anlass?1:0)-(a.anlass?1:0))||nachNr(a,b),
  }[sort]||nachNr;
  daten.sort(cmp);
}
// Quartalsnoten sammeln (Punkt 5): Prüfliste mit Häkchen, dann je Schüler ein quartalsnote-Event — derselbe Weg wie der Einzeldialog
function quartalsnotenSammeln(k,zr,liste){
  const sek2=bewertProfil(k)==='sek2';
  const hj=/q[34]/.test(zr.id)?2:1, quartal=/q[13]/.test(zr.id)?1:2;
  const haken=new Map(liste.map(d=>[d.s.nr,true]));
  const zeilen=liste.map(d=>{
    const cb=el('input',{type:'checkbox',class:'u-check',checked:'checked',onchange:e=>haken.set(d.s.nr,e.target.checked)});
    return el('label',{class:'zeile'},el('span',{},cb,' ',d.s.vorname+' '+d.s.name),el('span',{class:'wert'},d.v.vorschlag.label));   // ganze Zeile = Ziel (Checkbox 22 px)
  });
  dlgZeigenEl(el('h3',{},zr.label+' · Vorschläge übernehmen'),
    el('p',{class:'u-hinweis'},'Jede angehakte Zeile wird als Quartalsnote gesetzt — genau wie im Einzeldialog, änderbar bleibt sie. Haken weg = bleibt offen.'),
    el('div',{class:'u-scroll58'},...zeilen),
    el('div',{class:'btn-reihe'},
      el('button',{class:'btn',onclick:()=>{
        let n=0;
        for(const d of liste){ if(!haken.get(d.s.nr)) continue;
          const wert=sek2?String(d.v.vorschlag.wert):wertZuLabel(d.v.vorschlag.wert);
          if(!wert) continue;   // nie still eine Ersatznote (vorher '3') — ohne Label bleibt die Zeile offen
          if(!addEvent('quartalsnote',d.s.nr,{hj,quartal,wert,zeitraumId:zr.id,einheit:sek2?'punkte':'drittel'})){ dlgZu(); return; } n++; }   // nichts gebucht (Archiv, Kurswechsel): nicht weiter, die Meldung nennt den Grund
        dlgZu(); toast(n+' Quartalsnoten gesetzt ('+zr.label+')'); renderSchueler();
      }},'Setzen'),
      el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
}
// Setter für Ansichten-Module (A2 Schnitt 4): ein Import ist schreibgeschützt, geschrieben wird von außen nur hierüber
function setzeOffenerSchueler(w){ offenerSchueler=w; }
function setzeOffeneZeile(w){ offeneZeile=w; }
function setzeZeitraumFilter(w){ zeitraumFilter=w; }
/* ═══ Übersichts-Tabellen (Zero 2026-09-02 · Punkte 1·2·6·7·9): Noten · Termine · Fehlzeiten — el()-gebaut, druckbar ═══ */
const SCHUELER_MODI=[['liste','Liste'],['noten','Noten'],['termine','Termine'],['fehlzeiten','Fehlzeiten']];
// Nacharbeits-Filter (C3) und Sortierung (Punkt 3) — seit 2026-09-29 als Auswahllisten im Listenkopf
const S_FILTER=[['','Alle Schüler'],['offen','Offene Fehlzeiten'],['ohnev','ohne Vorschlag'],['gesetzt','Note gesetzt'],['lb','nur LB'],['ohneheute','heute ohne Eintrag'],['runter','Verlauf ↓']];
const S_SORT=[['nr','nach Nr'],['name','nach Name'],['vorschlag','nach Vorschlag'],['anlass','nach Anlass']];
function modusChipsHtml(){ return '<div class="zr-leiste s-modus">'+SCHUELER_MODI.map(([id,lab])=>'<button class="zr-chip'+(schuelerAnsicht===id?' an':'')+'" aria-pressed="'+(schuelerAnsicht===id)+'" data-sm="'+id+'">'+lab+'</button>').join('')+'</div>'; }
function modusChipsEl(){ return el('div',{class:'zr-leiste s-modus'},...SCHUELER_MODI.map(([id,lab])=>el('button',{class:'zr-chip'+(schuelerAnsicht===id?' an':''),'aria-pressed':String(schuelerAnsicht===id),dataset:{sm:id}},lab))); }
function verdrahteModus(wrap){ wrap.querySelectorAll('[data-sm]').forEach(b=>b.onclick=()=>{ schuelerAnsicht=b.dataset.sm; offenerSchueler=null; mitUebergang(renderSchueler); }); }
// Zeitraum der Tabellen als Auswahl wie in der Liste (Scheibe 6, Zero 03.10.: „Als Auswahl wie in der Liste“) — vorher eine zweite Chip-Reihe,
// die am Handy aus dem Bild lief
function zrAuswahlEl(sj,zr){
  if(!sj||!sj.zeitraeume||!sj.zeitraeume.length) return null;
  const s=el('select',{class:'s-wahl'+(zr?' an':''),'aria-label':'Zeitraum'},el('option',{value:''},'Gesamt'),...sj.zeitraeume.map(z=>el('option',{value:z.id,...(zr&&zr.id===z.id?{selected:''}:{})},z.label)));
  s.onchange=e=>{ const id=e.target.value; zeitraumFilter=id?sj.zeitraeume.find(z=>z.id===id):null; offenerSchueler=null; mitUebergang(renderSchueler); };
  return s;
}
function renderSchuelerTabelle(wrap,k,kursEvents,sj,zr,kurzL){
  const profil=bewertProfil(k);
  const wirksam=wirksameEvents(kursEvents);
  const von=zr?zr.von:'', bis=zr?zr.bis:'9999-12-31';
  const schueler=kursSchueler(k);
  const verspVon=nr=>{ const sid=sidVonNr(nr,k); return wirksam.filter(e=>e.sid===sid&&e.typ==='versp'&&e.datum>=von&&e.datum<=bis).reduce((a,e)=>a+(e.minuten||0),0); };
  const titel={noten:'Notenübersicht',termine:'Termin-Matrix',fehlzeiten:'Fehlzeiten'}[schuelerAnsicht]||'';
  const kopf=el('div',{class:'druck-kopf'},el('b',{},k.name+' · '+k.fach),' · '+titel+' · '+(zr?zr.label:'Gesamt')+' · Stand '+datumLabel(heuteIso()));
  const namenBtn=s=>el('button',{class:'ut-name',onclick:()=>{ offenerSchueler=s.nr; mitUebergang(renderSchueler); }},el('b',{},s.vorname),' ',el('small',{class:'u-leise'},s.name),s.lb?el('span',{class:'lb-badge'},'LB'):null);
  const tabelle=el('table',{class:'ut-tabelle'});
  let hinweis='', handyListe=null;
  if(schuelerAnsicht==='noten'){
    const zeitr=(sj&&sj.zeitraeume)||[];
    const spalten=['q1','q2','hj1','q3','q4','hj2'].map(id=>zeitr.find(z=>z.id===id)).filter(Boolean);
    const quartale=spalten.filter(z=>/^q/.test(z.id));
    tabelle.append(el('thead',{},el('tr',{},el('th',{},'Nr'),el('th',{class:'links'},'Name'),el('th',{},'＋ / o / −'),el('th',{},'e / u'),el('th',{},iconEl('versp')),...spalten.map(z=>el('th',{},kurzL(z.label))),el('th',{},'Jahr'))));
    const tb=el('tbody',{});
    for(const s of schueler){
      const v=verdichte(kursEvents,sidVonKind(s,k.id),{profil,lb:s.lb,von,bis});
      const qn=quartalsnotenVon(kursEvents,sidVonKind(s,k.id));
      const versp=verspVon(s.nr);
      const zellen=spalten.map(z=>{
        const vz=verdichte(kursEvents,sidVonKind(s,k.id),{profil,lb:s.lb,von:z.von,bis:z.bis});
        const ev=/^q/.test(z.id)?qn[QN_KEY[z.id]]:null;
        if(ev){ const abw=vz.vorschlag?notenAbstand(ev.wert,vz.vorschlag.wert,profil):null;
          return el('td',{},el('button',{class:'nt-zelle gesetzt',title:'gesetzt · antippen zum Ändern',onclick:()=>setzeQuartalsnote(s,vz.vorschlag||{wert:null,label:'—'},z)},qnText(ev,k)),
            abw!=null&&abw>=1?el('small',{class:'s-abw',title:'weicht mindestens eine Stufe vom Vorschlag ab'},iconEl('warnung'),' V '+vz.vorschlag.label):null); }
        if(/^q/.test(z.id)&&!s.lb&&vz.vorschlag) return el('td',{},el('button',{class:'nt-zelle vor',title:'Vorschlag · antippen zum Setzen',onclick:()=>setzeQuartalsnote(s,vz.vorschlag,z)},'V '+vz.vorschlag.label));
        return el('td',{class:'u-leise'},vz.vorschlag?'V '+vz.vorschlag.label:'—');   // HJ: nur Vorschlag — die Halbjahresnote rechnet die Mappe aus Q1/Q2 (Punkt 11)
      });
      const verlauf=quartalsVerlauf(kursEvents,sidVonKind(s,k.id),quartale,{profil,lb:s.lb}).filter(e=>e.score!==null).map(e=>e.id.toUpperCase()+(e.pfeil?' '+e.pfeil:'')).join('  ');
      tb.append(el('tr',{},el('td',{class:'u-leise'},String(listenNr(s))),el('td',{class:'links'},namenBtn(s)),
        el('td',{},v.nPlus+' / '+v.nNull+' / '+v.nMinus),el('td',{},(v.nFehltE||v.nFehltU)?v.nFehltE+' / '+v.nFehltU:'—'),el('td',{},versp?versp+' min':'—'),
        ...zellen,el('td',{class:'u-leise ut-verlauf'},verlauf||'—')));
    }
    tabelle.append(tb);
    // Am Handy eine Liste mit EINER Notenspalte (Scheibe 6, Zero 03.10.: „B · Liste mit einer Notenspalte“): das gewählte Quartal, sonst das
    // laufende. Die Tabelle bleibt für iPad und Druck, das CSS zeigt je Breite eins von beiden — vorher war am Handy nur „1. Q“ angeschnitten
    // Halbjahr gewählt: ein Quartal DIESES Halbjahres (im Oktober beim 2. HJ das Q3) — sonst stand das laufende neben der Bilanz eines anderen (Prüfer 03.10. 🟡 4)
    const imZr=zr?quartale.filter(q=>q.von>=zr.von&&q.bis<=zr.bis):[];
    const zq=zr&&/^q/.test(zr.id)?zr:quartalVon(imZr.length?imZr:quartale,heuteIso());
    if(zq) handyListe=el('div',{class:'s-nliste'},el('div',{class:'s-nkopf'},el('span',{},'Name'),el('span',{},'＋ / o / −'),el('span',{},kurzL(zq.label))),...schueler.map(s=>{
      const v=verdichte(kursEvents,sidVonKind(s,k.id),{profil,lb:s.lb,von,bis}), vz=verdichte(kursEvents,sidVonKind(s,k.id),{profil,lb:s.lb,von:zq.von,bis:zq.bis}), ev=quartalsnotenVon(kursEvents,sidVonKind(s,k.id))[QN_KEY[zq.id]];
      const setzen=()=>setzeQuartalsnote(s,vz.vorschlag,zq);
      const zelle=ev?el('button',{type:'button',class:'nt-zelle gesetzt',onclick:setzen},qnText(ev,k)):!s.lb&&vz.vorschlag?el('button',{type:'button',class:'nt-zelle vor',onclick:setzen},'V '+vz.vorschlag.label):!s.lb?el('button',{type:'button',class:'nt-zelle vor','aria-label':'Quartalsnote setzen',onclick:setzen},'—'):el('span',{class:'u-leise'},'—');   // „—“ = noch kein Vorschlag, setzen geht trotzdem (Prüfer 03.10. 🟢 12)
      return el('div',{class:'s-nzeile'},el('button',{type:'button',class:'ut-name',onclick:()=>{ offenerSchueler=s.nr; mitUebergang(renderSchueler); }},el('small',{class:'u-leise'},listenNr(s)+' '),el('b',{},s.vorname),' ',el('small',{class:'u-leise'},s.name),s.lb?el('span',{class:'lb-badge'},'LB'):null),
        el('span',{class:'s-nbil'},v.nPlus+' / '+v.nNull+' / '+v.nMinus),zelle); }));
    const tabHinweis='Q-Zelle antippen: setzen oder ändern · V = Vorschlag, du entscheidest · HJ zeigt nur den Vorschlag über das Halbjahr, die Halbjahresnote rechnet die Klassenmappe aus Q1/Q2 · Warndreieck = gesetzte Note weicht mindestens eine Stufe vom Vorschlag ab · Jahr = Bilanz-Verlauf von Quartal zu Quartal.';
    // Unter der Handy-Liste ihr eigener Satz — die Liste zeigt weder HJ noch Warndreieck noch Jahr (Prüfer 03.10. 🟢 9); das CSS zeigt je Breite einen
    hinweis=handyListe?el('div',{},el('p',{class:'u-hinweis ut-nur-tabelle'},tabHinweis),
      el('p',{class:'u-hinweis s-nur-liste'},'Note antippen: setzen oder ändern · V = Vorschlag, — = noch keiner, du entscheidest · das Quartal der Spalte über „Zeitraum“ wählen.')):tabHinweis;
  } else if(schuelerAnsicht==='termine'){
    const relevant=e=>istTerminEintrag(e)&&e.datum>=von&&e.datum<=bis;
    const termine=[...new Set(wirksam.filter(relevant).map(e=>e.datum))].sort();
    const idx=new Map();   // datum → sid → events (v2.2)
    for(const e of wirksam){ if(!relevant(e)) continue; let m=idx.get(e.datum); if(!m){ m=new Map(); idx.set(e.datum,m); } if(!m.has(e.sid)) m.set(e.sid,[]); m.get(e.sid).push(e); }
    tabelle.classList.add('ut-matrix');
    tabelle.append(el('thead',{},el('tr',{},el('th',{class:'links'},'Name'),...termine.map(t=>el('th',{},el('span',{class:'ut-datum'},datumLabel(t)))))));
    const tb=el('tbody',{});
    for(const s of schueler){
      tb.append(el('tr',{},el('td',{class:'links'},namenBtn(s)),...termine.map(t=>{ const evs=(idx.get(t)||new Map()).get(sidVonKind(s,k.id)); return el('td',{class:'ut-marken'},...(evs?markenEl(reduziereStand(evs)):[])); })));
    }
    tabelle.append(tb);
    hinweis=termine.length?termine.length+' Termine · Marken wie auf der Sitzplan-Kachel (Legende unter „Heute").':'Noch keine Termine in diesem Zeitraum.';
  } else {   // fehlzeiten (Punkt 6)
    const p=vault.stamm.kursprofile[k.id]||{};
    const schwelle=Number.isFinite(p.uSchwelle)?p.uSchwelle:3;
    tabelle.append(el('thead',{},el('tr',{},el('th',{},'Nr'),el('th',{class:'links'},'Name'),el('th',{},'entsch.'),el('th',{},'unentsch.'),el('th',{},'offen'),el('th',{},iconEl('versp'),' min'),el('th',{},iconEl('verweigert')))));
    const tb=el('tbody',{});
    for(const s of schueler){
      const v=verdichte(kursEvents,sidVonKind(s,k.id),{profil,lb:s.lb,von,bis});
      const versp=verspVon(s.nr);
      const warn=schwelle>0&&v.nFehltU>=schwelle;
      tb.append(el('tr',{class:warn?'ut-warn':''},el('td',{class:'u-leise'},String(listenNr(s))),el('td',{class:'links'},namenBtn(s)),
        el('td',{},v.nFehltE?String(v.nFehltE):'—'),el('td',{class:warn?'u-fehl':''},v.nFehltU?String(v.nFehltU)+' ':'—',warn?iconEl('warnung'):null),el('td',{},v.nFehltO?String(v.nFehltO):'—'),el('td',{},versp?String(versp):'—'),el('td',{},v.nVerweigert?String(v.nVerweigert):'—')));
    }
    tabelle.append(tb);
    const schwIn=el('input',{type:'number',min:'0',max:'99',value:String(schwelle),class:'u-w72',onchange:e=>{ const n=parseInt(e.target.value,10); vault.stamm.kursprofile[k.id]={...(vault.stamm.kursprofile[k.id]||{}),uSchwelle:isNaN(n)?3:n}; stammMutiert(); speichern(); renderSchueler(); }});
    hinweis=el('div',{class:'zeile'},el('span',{class:'u-hinweis'},iconEl('warnung'),' ab so vielen unentschuldigten Terminen (0 = aus) — gilt für diesen Kurs'),el('span',{},schwIn));
  }
  wrap.replaceChildren(modusChipsEl(), kopf,
    el('div',{class:'btn-reihe ut-aktionen'},zrAuswahlEl(sj,zr),
      el('button',{class:'btn still u-btn-klein',onclick:()=>window.print()},iconEl('drucken'),' Drucken'),
      ...(schuelerAnsicht==='noten'?[el('button',{class:'btn still u-btn-klein',onclick:kopiereVorschlaege},iconEl('kopieren'),' Vorschläge für Excel kopieren')]:[])),
    el('div',{class:'ut-wrap'+(handyListe?' ut-noten':'')},tabelle),...(handyListe?[handyListe]:[]),
    typeof hinweis==='string'?el('p',{class:'u-hinweis'},hinweis):hinweis);
  verdrahteModus(wrap);
}
// ═══ Quartalsnoten-Lebensweg (S216 · Zeros Befund „da fehlt ein Baustein") ═══
// Gesetzte quartalsnote-Events waren nach dem Setzen unsichtbar (nur Verlaufszeile).
// Jetzt: Übersicht Q1–Q4 auf der Schüler-Seite · Liste + „Vorschläge kopieren" bevorzugen die gesetzte Note.
const QN_KEY={q1:'1-1',q2:'1-2',q3:'2-1',q4:'2-2'};
// Das Quartal von heute — in den Ferien das zuletzt begonnene, vor dem ersten das erste (Notengitter und Notenliste am Handy, Scheibe 6)
function quartalVon(qs,h){ return qs.find(z=>z.von<=h&&h<=z.bis)||qs.filter(z=>z.von<=h).pop()||qs[0]||null; }
function quartalsnotenVon(kursEvents,sid){   // sid: das Kind (v2.2)
  const m={};
  for(const e of wirksameEvents(kursEvents)) if(e.typ==='quartalsnote'&&e.sid===sid){
    const key=e.hj+'-'+e.quartal;
    if(!m[key]||String(e.ts)>String(m[key].ts)) m[key]=e;  // jüngste je HJ/Q gewinnt
  }
  return m;
}
// Vollseite eines Schülers (ersetzt das Akkordeon · Zero 2026-07-09): Quartalsnoten-Karte,
// Bilanz des gewählten Zeitraums, voller datierter Verlauf, Zurück zur Liste.
function renderSchuelerSeite(wrap,k,s,kursEvents){
  const sj=aktivesSchuljahr();
  const zr=zeitraumFilter;
  const v=verdichte(kursEvents,sidVonKind(s,k.id),{profil:bewertProfil(k),lb:s.lb,von:zr?zr.von:'',bis:zr?zr.bis:'9999-12-31'});
  const qn=quartalsnotenVon(kursEvents,sidVonKind(s,k.id));
  const zellen=['q1','q2','q3','q4'].map(id=>{
    const z=sj&&sj.zeitraeume?sj.zeitraeume.find(x=>x.id===id):null;
    const ev=qn[QN_KEY[id]];
    const vz=z?verdichte(kursEvents,sidVonKind(s,k.id),{profil:bewertProfil(k),lb:s.lb,von:z.von,bis:z.bis}):null;
    return '<button class="qn-zelle'+(ev?'':' offen')+'" data-qz="'+id+'">'+
      '<span class="qn-label">'+id.toUpperCase()+'</span>'+
      '<span class="qn-note">'+(ev?esc(qnText(ev,k)):'—')+'</span>'+
      '<span class="qn-sub">'+(vz&&vz.vorschlag?'Vorschlag '+esc(vz.vorschlag.label):(s.lb?'LB — frei benotbar':'noch kein Vorschlag'))+'</span></button>';
  }).join('');
  // Verlauf über die Quartale (Punkt 7) + Einordnung im Kurs (Punkt 10: Median + Anteil dahinter — Prozent, kein Rang, kein Wort)
  const quartale=sj&&sj.zeitraeume?sj.zeitraeume.filter(z=>/^q[1-4]$/.test(z.id)):[];
  const verlaufTxt=quartalsVerlauf(kursEvents,sidVonKind(s,k.id),quartale,{profil:bewertProfil(k),lb:s.lb}).filter(e=>e.score!==null).map(e=>e.id.toUpperCase()+(e.pfeil?' '+e.pfeil:'')).join('  ');
  let einordnungTxt='';
  if(v.vorschlag&&!s.lb){
    const pr=bewertProfil(k);
    const werte=kursSchueler(k).filter(x=>!x.lb).map(x=>verdichte(kursEvents,sidVonKind(x,k.id),{profil:pr,von:zr?zr.von:'',bis:zr?zr.bis:'9999-12-31'}).vorschlag?.wert).filter(w=>w!=null);
    const e=kursEinordnung(werte,v.vorschlag.wert,pr);
    if(e&&e.n>=3) einordnungTxt='Kurs: Median '+(pr==='sek2'?Math.round(e.median)+' P':drittelnoteLabel(e.median))+' · dieser Vorschlag liegt vor '+Math.round(e.anteilDahinter*100)+' % der '+e.n+' Vorschläge';
  }
  wrap.innerHTML='<div class="sseite-kopf"><button class="btn still" id="s-zurueck">‹ Alle Schüler</button>'+
    '<div class="sseite-name">'+esc(s.vorname)+' '+esc(s.name)+(s.lb?' <span class="lb-badge">LB</span>':'')+'</div></div>'+
    '<div class="panel"><h2>Quartalsnoten'+(sj?' · '+esc(sj.label):'')+'</h2>'+
    '<div class="qn-grid">'+zellen+'</div>'+
    '<p class="u-hinweis">Zelle antippen zum Setzen/Ändern — der Vorschlag ist umrandet, ein Tipp setzt, du entscheidest. ● in der Liste = gesetzt.</p>'+
    (verlaufTxt?'<p class="u-hinweis">Verlauf über das Jahr: '+esc(verlaufTxt)+'</p>':'')+'</div>'+
    '<div class="panel"><h2>Bilanz · '+esc(zr?zr.label:'Gesamt')+'</h2>'+schuelerDetailHtml(s,k,v)+
    (einordnungTxt?'<p class="u-hinweis">'+esc(einordnungTxt)+'</p>':'')+
    '<div class="btn-reihe"><button class="btn still u-btn-klein" id="s-bericht" title="Bilanz, Fehlzeiten, Quartalsnoten und Notizen als Text — für Elternsprechtag und Zeugnisbemerkung">'+iconHtml('kopieren')+' Kurzbericht kopieren</button></div></div>';
  $('s-zurueck').onclick=()=>{ offenerSchueler=null; mitUebergang(()=>{ renderSchueler(); const m=document.querySelector('main'); if(m) m.scrollTop=sListeScroll; }); };  // zurück an die alte Listenposition (C3)
  // Kurzbericht (Punkt 8): reiner Text aus logic/bericht.mjs, Zeitraum wie die Bilanz oben
  $('s-bericht').onclick=()=>{
    const evs=wirksameEvents(kursEvents).filter(e=>e.sid===sidVonKind(s,k.id)&&e.typ!=='storno'&&(!zr||(e.datum>=zr.von&&e.datum<=zr.bis)));
    const qn=quartalsnotenVon(kursEvents,sidVonKind(s,k.id));
    const text=schuelerBericht({name:s.vorname+' '+s.name,kurs:k.name,fach:k.fach,zeitraum:zr?zr.label:(sj?sj.label:''),profil:bewertProfil(k),v,
      quartalsnoten:['q1','q2','q3','q4'].filter(id=>qn[QN_KEY[id]]).map(id=>({label:id.toUpperCase(),wert:qnText(qn[QN_KEY[id]],k)})),
      notizen:evs.filter(e=>e.notiz&&String(e.notiz).trim()).sort((a,b)=>String(a.datum).localeCompare(String(b.datum))).map(e=>({datum:e.datum,text:e.notiz,typ:e.typ})),
      verspMinuten:evs.filter(e=>e.typ==='versp').reduce((a,e)=>a+(e.minuten||0),0),datumLabel});
    // Klartext mit Name und Notizen verlässt hier den Tresor (Prüfer 2026-09-29): sagen, wo er jetzt liegt. Nicht selbst leeren —
    // beim Wechsel zu Mail sperrt „sofort sperren“ die Kladde, bevor eingefügt ist.
    const warn='Liegt danach unverschlüsselt in der Zwischenablage (mit Handoff auch auf Mac/iPhone) — nach dem Einfügen etwas anderes kopieren.';
    inZwischenablage(text,'Kurzbericht kopiert · '+s.vorname+' — '+warn,'Kurzbericht',{ms:7000,hinweis:warn});
  };
  wrap.querySelectorAll('[data-qz]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.qz; const z=sj&&sj.zeitraeume?sj.zeitraeume.find(x=>x.id===id):null; if(!z){ toast('Kein Schuljahres-Zeitraum definiert'); return; }
    const vz=verdichte(kursEvents,sidVonKind(s,k.id),{profil:bewertProfil(k),lb:s.lb,von:z.von,bis:z.bis});
    setzeQuartalsnote(s,vz.vorschlag||{wert:null,label:'—'},z);  // Q-Zellen-Tap setzt GENAU dieses Quartal (C3)
  });
  verdrahteDetail(wrap,tag=>{ renderSchueler(); oeffneTag($('view-schueler'),tag); });
}
function schuelerDetailHtml(s,k,v){
  const evs=wirksameEvents(vault.events.filter(e=>e.kursId===k.id&&e.sid===sidVonKind(s,k.id))).filter(e=>e.typ!=='storno'); // Storno-Buchungen nicht im Verlauf zeigen
  const verspSum=evs.filter(e=>e.typ==='versp').reduce((a,e)=>a+(e.minuten||0),0);
  // Je Termin die jüngste Klärung, wie Vorschlag und Tabellen (verdichte) — Einträge zu zählen ergab bei doppeltem
  // Stempel oder zwei Geräten „1× e 1× u“ für eine Stunde (Prüfer 2026-09-29)
  const fehltU=v.nFehltU, fehltE=v.nFehltE;
  const proTag={};
  for(const e of evs) (proTag[e.datum]=proTag[e.datum]||[]).push(e);
  const tage=Object.keys(proTag).sort();  // chronologisch: links alt → rechts neu (Zero 2026-07-09)
  // Horizontaler Zeitstrahl: je Tag eine kompakte Karte mit den mk-Marken (gleiche Sprache wie die Sitzplan-Kachel);
  // Tap expandiert die Einträge des Tages darunter (mit ↶-Storno). Kein Runterscrollen mehr.
  const evZeile=e=>'<div class="ev-zeile"><span>'+(e.best?iconHtml('best')+' ':'')+esc(TYP_LABEL[e.typ]||e.typ)+(e.minuten?' '+e.minuten+' min':'')+(e.wert?' '+esc(String(e.wert)):'')+(e.notiz?' · '+esc(e.notiz):'')+'</span>'+
    '<button class="btn still ev-storno u-btn-klein" data-storno="'+e.id+'">'+iconHtml('rueck')+'</button></div>';
  // Tag bewerten nur an echten Unterrichtstagen des Kurses, nicht in der Zukunft, nicht im Archiv, nicht bei Abwesenheit
  // (Prüfer 2026-09-30: ein Tag mit nur einer Quartalsnote wurde durch ein ＋ zum neuen Kurstermin und senkte die Beteiligung aller)
  const terminTage=new Set(wirksameEvents(vault.events.filter(e=>e.kursId===k.id)).filter(istTerminEintrag).map(e=>e.datum));
  const heute=heuteIso();
  const sperreFuer=(t,st)=>k.status==='archiviert'?'Archiv-Kurs — schreibgeschützt.'
    :t>heute?'Der Tag liegt in der Zukunft.'
    :!terminTage.has(t)?'An diesem Tag hatte der Kurs keinen Unterricht — hier wird nicht bewertet.'
    :st.fehlt?s.vorname+' fehlte an diesem Tag ('+(FEHLT_WORT[st.fehlt]||st.fehlt)+') — erst die Abwesenheit zurücknehmen (↶), dann bewerten.':'';
  let strahl='', details='';
  for(const t of tage){
    const st=reduziereStand(proTag[t]);
    strahl+='<button class="zs-tag" data-tag="'+t+'"><span class="zs-datum">'+datumLabel(t)+'</span><span class="zs-marken">'+markenHtml(st)+'</span></button>';
    details+='<div class="tag-detail-inhalt" data-tag="'+t+'"><div class="tag-kopf">'+datumLabel(t)+'</div>'+
      proTag[t].sort((a,b)=>String(a.ts).localeCompare(String(b.ts))).map(evZeile).join('')+tagBewertenHtml(s.nr,t,proTag[t],sperreFuer(t,st),k.id)+'</div>';
  }
  // Gegenwartszeile (C3): der Verlauf beginnt mit dem jüngsten Stand, nicht mit einer Suchaufgabe
  const letzterTag=tage[tage.length-1];
  const gegenwart=letzterTag
    ? '<div class="zs-gegenwart">Letzter Eintrag: <b>'+datumLabel(letzterTag)+'</b> · '+
      esc([...new Set(proTag[letzterTag].map(e=>TYP_LABEL[e.typ]||e.typ))].slice(0,3).join(' + '))+'</div>'
    : '';
  const verlauf=tage.length
    ? gegenwart+'<div class="zeitstrahl">'+strahl+'</div><p class="zs-hinweis u-hinweis">Tag antippen für Einzel-Einträge.</p>'+details
    : '<p class="u-hinweis">Noch keine Einträge.</p>';
  // Notizen-Sammlung: alle Texte (Notizen + Begründungen aus ⊘/⭐) auf einen Blick, neueste zuerst
  const notizen=evs.filter(e=>e.notiz&&String(e.notiz).trim()).sort((a,b)=>String(b.datum).localeCompare(String(a.datum))||String(b.ts).localeCompare(String(a.ts)));
  const notizListe=notizen.length
    ? notizen.map(e=>'<div class="notiz-zeile"><span class="notiz-datum">'+datumLabel(e.datum)+'</span><span>'+(e.typ==='verweigert'?'<span class="mk verw">'+iconHtml('verweigert')+'</span> ':'')+esc(e.notiz)+'</span></div>').join('')
    : '';
  // Detailwerte (Balken + Zählung) leben seit C3 HIER — die Liste zeigt nur noch die Entscheidung
  const sum=Math.max(1,v.nPlus+v.nNull+v.nMinus);
  return '<div class="s-detail">'+
    '<div class="zeile"><span>＋ / o / −</span><span class="wert u-flex1"><span class="balken"><span class="bal-p" data-w="'+(100*v.nPlus/sum)+'"></span><span class="bal-o" data-w="'+(100*v.nNull/sum)+'"></span><span class="bal-m" data-w="'+(100*v.nMinus/sum)+'"></span></span> '+v.nPlus+'⁺ '+v.nNull+'° '+v.nMinus+'⁻ · '+Math.round(100*v.aktivQuote)+'%</span></div>'+
    '<div class="zeile"><span>Beteiligung</span><span class="wert">'+v.beteiligtTermine+' / '+v.kursTermine+' Termine · Verlauf '+v.pfeil+'</span></div>'+
    (fehltE||fehltU||verspSum?'<div class="zeile"><span>Fehl / Verspätung</span><span class="wert">'+(fehltE?fehltE+'× e ':'')+(fehltU?fehltU+'× u ':'')+(verspSum?'· '+verspSum+' min':'')+'</span></div>':'')+
    '<div class="zeile"><span>Vorschlag</span><span class="wert">'+(v.vorschlag?esc(v.vorschlag.label):(s.lb?'— (LB)':'—'))+'</span></div>'+
    (v.vorschlag&&!s.lb?'<div class="btn-reihe"><button class="btn" data-quartal="'+s.nr+'">Als Quartalsnote setzen…</button></div>':'')+
    '<div class="tag-kopf u-kopf-leise">Verlauf ('+evs.length+')</div>'+verlauf+
    (notizListe?'<div class="tag-kopf u-kopf-leise">Notizen ('+notizen.length+')</div><div class="notiz-liste">'+notizListe+'</div>':'')+
    '</div>';
}
function verdrahteDetail(wrap,danach){
  // Tag bewerten (v1.11.0): danach(tag) zeichnet die Ansicht neu und klappt denselben Tag wieder auf
  if(danach) wrap.querySelectorAll('[data-tagbewerten]').forEach(b=>b.onclick=e=>{ e.stopPropagation();
    if(kursGewechselt({kursId:b.dataset.kurs})) return;
    const tag=b.dataset.tag; tagBewerten(Number(b.dataset.nr),tag,b.dataset.tagbewerten,()=>danach(tag)); });
  // Zeitstrahl: Tag antippen → Einträge des Tages darunter (nur einer offen); initial ans neueste Ende scrollen
  wrap.querySelectorAll('.zs-tag').forEach(b=>b.onclick=()=>{
    const t=b.dataset.tag, war=b.classList.contains('an');
    wrap.querySelectorAll('.zs-tag.an').forEach(x=>x.classList.remove('an'));
    wrap.querySelectorAll('.tag-detail-inhalt.an').forEach(x=>x.classList.remove('an'));
    if(!war){ b.classList.add('an'); const d=wrap.querySelector('.tag-detail-inhalt[data-tag="'+t+'"]'); if(d) d.classList.add('an'); }
  });
  // ans neueste Ende scrollen — synchron (scrollWidth-Read erzwingt Layout); rAF/smooth scheitern in Hintergrund-Tabs
  const zs=wrap.querySelector('.zeitstrahl'); if(zs) zs.scrollLeft=zs.scrollWidth;
  const zsT=wrap.querySelector('.zeitstrahl'); if(zsT) setTimeout(()=>{ zsT.scrollLeft=zsT.scrollWidth; },0);  // Zweitversuch nach Task-Flush (View-Transition-Fälle)
  // dynamische Balken-Breiten via CSSOM (CSP: Inline-Style-Attribute in HTML-Strings sind verboten)
  wrap.querySelectorAll('.balken [data-w]').forEach(d=>{ d.style.width=d.dataset.w+'%'; });
  // ↶-Storno im Verlauf bietet sofort den Gegenweg an (C3 — nutzt den C2-Redo-Chip, der fixed über allen Views liegt)
  wrap.querySelectorAll('.ev-storno').forEach(b=>b.onclick=e=>{ e.stopPropagation(); const ev=vault.events.find(x=>x.id===b.dataset.storno); if(ev&&stornoVon(ev)){ toast('storniert'+wiederDa(ev)); zeigeRedo(ev); renderSchueler(); } });
  wrap.querySelectorAll('[data-quartal]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); const s=schuelerVonNr(Number(b.dataset.quartal)); const kk=kurs(); const zr=zeitraumFilter; const v=verdichte(vault.events.filter(x=>x.kursId===kk.id),sidVonKind(s,kk.id),{profil:bewertProfil(kk),lb:s.lb,von:zr?zr.von:'',bis:zr?zr.bis:'9999-12-31'}); setzeQuartalsnote(s,v.vorschlag,zr); });
}
// quartalsnote-Event trägt Zeitraum-Kontext — bleibt IMMER 'quartalsnote', NIE 'note'
// (verbotener Pfad 2: eine Übernahme darf nie in verdichte() zurückfließen).
// Notengitter (Scheibe 6, Zero 03.10.: „A · Notengitter“) wie Stempel und Schülerblatt: oben Q1–Q4 (der übergebene Zeitraum, sonst das laufende
// Quartal), die gesetzte Note gefüllt, der Vorschlag umrandet — nie vorgewählt. Ein Tipp setzt, Meldung und ↶ folgen (addEvent). Vorher: Auswahl-
// liste + „Setzen“, das Quartal hinter „ändern…“ und zwei weiteren Auswahllisten. Dieselbe Note noch einmal bucht nichts.
function setzeQuartalsnote(s,vorschlag,zeitraum){
  const k=kurs(); if(!k||!s) return;
  const sek2=bewertProfil(k)==='sek2', sj=aktivesSchuljahr(), qs=((sj&&sj.zeitraeume)||[]).filter(z=>/^q[1-4]$/.test(z.id));
  if(!qs.length){ toast('Kein Schuljahres-Zeitraum definiert'); return; }
  let z=(zeitraum&&qs.find(q=>q.id===zeitraum.id))||quartalVon(qs,heuteIso());
  const opt={kursId:aktiverKursId};   // nach einem Kurswechsel nichts buchen (dieselbe Nr ist dann ein anderes Kind)
  const zeige=w=>sek2?w+' P':w;
  const zeichne=()=>{
    const kev=vault.events.filter(x=>x.kursId===k.id);
    const v=verdichte(kev,sidVonKind(s,k.id),{profil:bewertProfil(k),lb:s.lb,von:z.von,bis:z.bis}).vorschlag, ev=quartalsnotenVon(kev,sidVonKind(s,k.id))[QN_KEY[z.id]];
    // Eine Note in fremder Einheit (Kursmodus inzwischen gewechselt) wird nicht gedeutet: nicht als „gesetzt“ markiert, jede Wahl bucht (Prüfer 20.10. G3)
    const vor=v?(sek2?String(v.wert):wertZuLabel(v.wert))||null:null, passt=ev&&einheitPasst(ev,k), jetzt=passt?String(ev.wert):null, q=Number(z.id.slice(1));
    const buche=w=>{ if(kursGewechselt(opt)) return;
      if(w===jetzt){ dlgZu(); toast('unverändert: '+z.id.toUpperCase()+'-Note '+zeige(w)+' · '+s.vorname); return; }
      if(addEvent('quartalsnote',s.nr,{hj:q>2?2:1,quartal:q%2?1:2,wert:w,zeitraumId:z.id,einheit:sek2?'punkte':'drittel'})){ dlgZu(); toast(z.id.toUpperCase()+'-Note '+zeige(w)+' · '+s.vorname); if(aktView==='schueler') renderSchueler(); } else dlgZu(); };   // nichts gebucht: die Meldung liegt frei
    dlgZeigenEl(el('h3',{},'Quartalsnote · '+s.vorname+' '+s.name),
      el('div',{class:'zr-leiste qn-wahl',role:'group','aria-label':'Quartal'},...qs.map(x=>el('button',{type:'button',class:'zr-chip'+(x.id===z.id?' an':''),'aria-pressed':String(x.id===z.id),dataset:{qn:x.id},onclick:()=>{ z=x; zeichne(); const b=$('dlg').querySelector('[data-qn="'+x.id+'"]'); if(b) b.focus(); }},x.id.toUpperCase()))),
      el('section',{class:'sb-stunde'},el('div',{class:'sb-feld ruhig'},
        el('p',{class:'u-hinweis'},(jetzt?'Gesetzt: '+zeige(jetzt)+' · ':ev?'Gesetzt: '+qnText(ev,k)+' · ':'')+(vor?'Vorschlag: '+zeige(vor):s.lb?'LB, kein Vorschlag':'noch kein Vorschlag')+' — ein Tipp setzt die Note, du entscheidest.'),
        el('div',{class:'sb-wahl'},...(sek2?Array.from({length:16},(_,i)=>String(15-i)):NOTEN_DRITTEL).map(w=>el('button',{type:'button',class:'btn still'+(w===vor?' vorschlag':'')+(w===jetzt?' gesetzt':''),
          dataset:{qnNote:w},...(w===jetzt?{'aria-pressed':'true'}:{}),onclick:()=>buche(w)},zeige(w)))))));
  };
  zeichne();
}


export { offenerSchueler, offeneZeile, zeitraumFilter, schuelerSuche, schuelerFilter, sListeScroll, schuelerAnsicht, schuelerSort, aktivesSchuljahr, renderSchueler, schuelerAufklapp, kopiereVorschlaege, inZwischenablage, sortiereSchuelerDaten, quartalsnotenSammeln, setzeOffenerSchueler, setzeOffeneZeile, setzeZeitraumFilter, SCHUELER_MODI, S_FILTER, S_SORT, modusChipsHtml, modusChipsEl, verdrahteModus, zrAuswahlEl, renderSchuelerTabelle, QN_KEY, quartalVon, quartalsnotenVon, renderSchuelerSeite, schuelerDetailHtml, verdrahteDetail, setzeQuartalsnote };
