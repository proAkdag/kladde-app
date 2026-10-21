// Kladde · js/ansichten/stempel.mjs — Abschnitt „PERMANENTE STEMPEL-RAIL“ (A2 Schnitt 4: wörtlich aus js/app.mjs, verhaltensneutral).
// Ansichten dürfen einander direkt importieren, der Kern (js/kern/) nie eine Ansicht (Zero 19.10.: „Direkt, Kern ringfrei“).
import { findeZiel, HILFE } from '../../logic/hilfe.mjs?v=2.4.2.1792566975';
import { stundeFuerBuchung } from '../../logic/stunden.mjs?v=2.4.2.1792566975';
import { verdichte, wirksameEvents } from '../../logic/verdichtung.mjs?v=2.4.2.1792566975';
import { dlgZeigen, dlgZeigenEl, dlgZu } from '../kern/dialog.mjs?v=2.4.2.1792566975';
import { $, el, esc, toast } from '../kern/dom.mjs?v=2.4.2.1792566975';
import { iconEl, iconHtml } from '../kern/icons.mjs?v=2.4.2.1792566975';
import { aktiverKursId, aktView, anzeigeBlock, beamerModus, setzeStempelTyp, stempelTyp, terminDatum, vault } from '../kern/zustand.mjs?v=2.4.2.1792566975';
import { addEvent, anzahlBewertungen, bewertProfil, eintragLabel, kurs, leererStand, schuelerVonNr, sidVonNr, standAmTermin, stornoVon, tagesStandIndex, wiederDa } from './eintraege.mjs?v=2.4.2.1792566975';
import { anzeigeVorname, bestleistungDialog, BEWERTUNGS_TYPEN, FEHLT_WORT, HANDY, kachelHtml, markenHtml, planKontext, renderHeute, sichtbareSchueler, stundeUntertitel, verweigerungDialog } from './heute.mjs?v=2.4.2.1792566975';
import { aktualisiereKursChip, handwahlLesen } from './kurswahl.mjs?v=2.4.2.1792566975';
import { renderAlles } from './navigation.mjs?v=2.4.2.1792566975';
import { renderSchueler, schuelerDetailHtml, setzeQuartalsnote, verdrahteDetail } from './schueler.mjs?v=2.4.2.1792566975';

/* ═══ PERMANENTE STEMPEL-RAIL (v2) · Werkzeug-in-die-Hand-Paradigma (Zero-Wunsch) ═══
   Stempel wählen → Kacheln antippen. Löst das alte „Schüler wählen → dann eintragen" ab. */
const RAIL_TITEL={'+':'Positiv','o':'Neutral','-':'Negativ','note':'Direkte Note','fehlt_o':'Abwesend (∅)','fehlt_e':'Entschuldigt gefehlt (e)','fehlt_u':'Unentschuldigt gefehlt (u)','versp':'Verspätung (Minuten)','ipad_fehlt':'iPad fehlt/leer','mat':'Material vergessen','lernzeit':'Lernzeit/HA nicht erledigt','notiz':'Notiz','bestleistung':'Besondere Leistung (Note 1)','verweigert':'Verweigerung (zählt 6)','entfernen':'Letzten Eintrag entfernen'};
function setStempel(typ){
  setzeStempelTyp((stempelTyp===typ)?null:typ); // gleichen Stempel nochmal antippen → aus
  document.body.classList.toggle('stempeln',stempelTyp!==null);
  document.body.classList.toggle('st-plus',stempelTyp==='+');
  document.body.classList.toggle('st-minus',stempelTyp==='-'||stempelTyp==='entfernen');
  renderRail();
}
function stempelAus(){ setzeStempelTyp(null); document.body.classList.remove('stempeln','st-plus','st-minus'); } // Verlassen von „Heute"
function renderRail(){
  const rail=$('rail'); if(!rail) return;
  // Long-Press zeigt das Label (Touch hat keine Tooltips) — lpFired unterdrückt dann den Stempel-Klick
  const mk=(typ,txt,cls)=>{
    let lpTimer, lpFired=false;
    const start=()=>{ lpFired=false; lpTimer=setTimeout(()=>{ lpFired=true; toast(RAIL_TITEL[typ]||typ); },450); };
    const stop=()=>clearTimeout(lpTimer);
    return el('button',{class:'rail-btn'+(cls?' '+cls:'')+(stempelTyp===typ?' an':''),title:RAIL_TITEL[typ]||'',
      'aria-label':RAIL_TITEL[typ]||typ,'aria-pressed':stempelTyp===typ?'true':'false',
      onclick:()=>{ if(lpFired){ lpFired=false; return; } setStempel(typ); },
      onpointerdown:start, onpointerup:stop, onpointerleave:stop, onpointercancel:stop},txt);
  };
  // Semantische Sektionen mit Mini-Überschrift (C2) — ersetzt Karten-Titel + Trennlinien fast platzneutral
  const sekt=(label,inhalt)=>el('div',{class:'rail-sektion'},el('div',{class:'rail-mini'},label),inhalt);
  const stempelKarte=el('div',{class:'rail-karte'},
    sekt('Beteiligung', el('div',{class:'rail-gruppe raster2'}, mk('+','＋','plus'), mk('o','o'), mk('-','−','minus'), mk('note',iconEl('note')))),
    sekt('Anwesenheit', el('div',{class:'rail-gruppe raster2'}, mk('fehlt_o',iconEl('abwesend')), mk('fehlt_e',iconEl('entsch')), mk('fehlt_u',iconEl('unentsch')), mk('versp',iconEl('versp')))),
    sekt('Organisation', el('div',{class:'rail-gruppe raster2'}, mk('ipad_fehlt',iconEl('ipad')), mk('mat',iconEl('material')), mk('lernzeit',iconEl('lernzeit')), mk('notiz',iconEl('notiz')))),
    sekt('Besonderes', el('div',{class:'rail-gruppe'}, mk('bestleistung',iconEl('best'),'best'), mk('verweigert',iconEl('verweigert'),'verw'))),
    sekt('Korrektur', mk('entfernen',iconEl('entfernen'),'breit')));
  const k=kurs(); let erfasst=0,total=0;
  if(k){ const idx=tagesStandIndex(terminDatum); const sicht=sichtbareSchueler(k);
    const da=sicht.filter(s=>!(idx.get(s.nr)||{}).fehlt);  // Abwesende nicht im Nenner: „komplett" = alle ANWESENDEN erfasst (Tag-Simulation L2)
    total=da.length;
    erfasst=da.filter(s=>anzahlBewertungen(idx.get(s.nr))>0).length; }
  const fill=el('div',{}); fill.style.width=(total?Math.round(erfasst/total*100):0)+'%';
  const komplett=total>0&&erfasst===total;  // alle erfasst → grünes „Stunde komplett"-Signal
  const erfasstKarte=el('div',{class:'rail-karte erfasst-karte'+(komplett?' komplett':'')},
    el('div',{class:'erfasst-kopf'},
      el('span',{class:'rail-titel'},'Erfasst'),
      el('span',{class:'rail-erfasst-zahl'}, String(erfasst), el('small',{},'/'+total))),
    el('div',{class:'rail-bar'}, fill));
  // iPad: „Erfasst“ in der oberen Rasterzeile neben der Leiste (gleich hoch, Zero 2026-10-01) · Handy: Zeile über den Stempeln
  if(HANDY.matches){ $('erfasst-ort').replaceChildren(); rail.replaceChildren(erfasstKarte, stempelKarte); }
  else { $('erfasst-ort').replaceChildren(erfasstKarte); rail.replaceChildren(stempelKarte); }  // Erfasst oben (auf Höhe der Datums-Leiste). Aktiv-Zustand zeigt NUR der leuchtende Stempel (Zero 2026-07-10: keine Statuszeile — sie ließ die Rail springen)
}
function pulseKachel(nr){
  const k=$('plan').querySelector('.kachel[data-nr="'+nr+'"]'); if(!k) return;
  k.classList.remove('puls'); void k.offsetWidth; k.classList.add('puls'); // Reflow-Re-Trigger (Werft flash_animation)
}
// Per-Schüler-Dialoge aus dem Stempelfluss (⏰/✎/📊) und aus „Tag bewerten“. Note und Minuten sind seit Scheibe 5 (Zero 03.10.: „A · Kompaktes
// Notengitter“) dieselben Gitter wie im Schülerblatt: ein Tipp bucht, kein Auswahlfeld und kein „Eintragen“.
// Die Stunde, die eine Buchung betrifft (logic/stunden stundeFuerBuchung): die gewählte, sonst eine eigene Stunde des Kurses — die laufende, in
// der Pause die gerade beendete — oder der Block, für den er jetzt von Hand gewählt wurde. EINE Quelle für Block, Minutenvorschlag und Kopf
// (Prüfer 03.10. 🔴 1, 🟡 2/3; zweite Runde 🔴 1). Frisch bei jedem Aufruf: das Deck hat keinen Takt.
function buchungsStunde(datum=terminDatum){
  const h=handwahlLesen();
  return stundeFuerBuchung(planKontext(),{jetzt:new Date(),termin:datum,kursId:aktiverKursId,gewaehlt:datum===terminDatum?anzeigeBlock:null,
    handBlock:h&&h.kursId===aktiverKursId&&!h.nurStunde?h.blockNr??null:null});
}
// Ein Dialog bucht auf die Stunde, die er beim Öffnen zeigt; war da keine bestimmbar, bestimmt addEvent sie beim Buchen (Prüfer 🟢 7)
const stundeFeld=st=>st&&st.blockNr!=null?{blockNr:st.blockNr}:{};
// Vorschlag aus dem Stundenplan: jetzt − Beginn der Stunde, nur wenn sie gerade läuft (sonst null: Nachtrag, Pause, gewählte frühere Stunde)
function verspVorschlag(st=buchungsStunde()){
  if(!st||!st.laeuft) return null;
  const now=new Date(), min=Math.round((now.getHours()*3600+now.getMinutes()*60+now.getSeconds()-st.startSek)/60);
  return min>=1&&min<=90?min:null;
}
// Ein offenes ∅ dieses Schülers in dieser Stunde: dann nimmt ⏰ es zurück („kommt doch“), auch mit denselben Minuten (Prüfer 03.10. 🟢 8)
const offenesO=(nr,st)=>{ const sid=sidVonNr(nr); return wirksameEvents(vault.events).some(e=>e.typ==='fehlt_o'&&e.kursId===aktiverKursId&&e.sid===sid&&e.datum===terminDatum&&(e.blockNr==null||st?.blockNr==null||e.blockNr===st.blockNr)); };
// Die wirksamen Verspätungen dieses Schülers in dieser Stunde (tag=true: am ganzen Tag) — meist eine; mehrere nur aus Altbestand oder von zwei
// Geräten. Ein neuer Wert ersetzt die der Stunde: addEvent → ersetzungFuer (logic/verdichtung; Prüfer 03.10. 🔴 1/🟡 2; Doppelstunde Zero 03.10.)
function verspAmTermin(nr,tag=false,st=buchungsStunde()){
  const b=st?.blockNr??null;
  const sid=sidVonNr(nr), l=wirksameEvents(vault.events).filter(e=>e.typ==='versp'&&e.kursId===aktiverKursId&&e.sid===sid&&e.datum===terminDatum&&(tag||e.blockNr==null||b==null||e.blockNr===b));
  return l.length?{minuten:l.reduce((s,e)=>s+(Number(e.minuten)||0),0),teile:l.map(e=>Number(e.minuten)||0)}:null;
}
const verspText=a=>'Gebucht: '+a.minuten+' min'+(a.teile.length>1?' ('+a.teile.join(' + ')+')':'')+'. Andere Minuten antippen — ersetzt.';
// Verspätung als Stempel (Zero 03.10.: „soll von der uhrzeit selbst berechnet werden als stempel und dann die möglichkeit die zeit anzupassen
// wenn nötig“): der erste Tipp bucht die Minuten seit Blockbeginn, ein zweiter Tipp auf denselben Schüler öffnet die Minuten zum Anpassen.
// Ohne laufenden Block (Nachtrag, Pause) gibt es nichts zu rechnen — dann gleich die Minuten.
function verspStempel(s){ if(!s) return;
  const st=buchungsStunde(), vor=verspVorschlag(st);
  if(verspAmTermin(s.nr,false,st)||!vor) return verspDialog(s,st);
  const heute=verspAmTermin(s.nr,true,st), doch=offenesO(s.nr,st), e=addEvent('versp',s.nr,{minuten:vor,...stundeFeld(st)});   // eine Verspätung eines früheren Blocks bleibt, die neue kommt dazu
  if(e){ toast((doch?'kommt doch: ':'')+vor+' min zu spät · '+s.vorname+(heute?' · zusammen heute '+(heute.minuten+vor)+' min':'')+' — nochmal antippen zum Ändern',4000); renderHeute(); pulseKachel(s.nr); }
}
function verspDialog(s,st=buchungsStunde()){ if(!s) return;
  const opt={kursId:aktiverKursId}, alt=verspAmTermin(s.nr,false,st), vor=verspVorschlag(st), jetzt=alt?alt.minuten:null;
  const buche=m=>{ if(kursGewechselt(opt)) return; const doch=offenesO(s.nr,st);
    if(m===jetzt&&!doch) toast('unverändert: '+m+' min · '+s.vorname);
    else if(addEvent('versp',s.nr,{minuten:m,...stundeFeld(st)})) toast((doch?'kommt doch: ':'')+m+' min zu spät · '+s.vorname);   // ersetzt die Verspätung oder das ∅ der Stunde (ersetzungFuer)
    dlgZu(); renderHeute(); pulseKachel(s.nr); };
  const ein=el('input',{type:'text',inputmode:'numeric',class:'sb-min',placeholder:'andere','aria-label':'andere Minuten',maxlength:'2'});
  const warn=el('p',{class:'u-warn13 sb-warn',role:'status'});
  dlgZeigenEl(el('h3',{},'zu spät · '+(beamerModus?anzeigeVorname(s):s.vorname+' '+s.name)),
    el('section',{class:'sb-stunde'},el('div',{class:'sb-feld ruhig'},
      el('p',{class:'u-hinweis'},alt?verspText(alt):'Minuten antippen — gebucht.'+(vor?' Nach Stundenplan: '+vor+' min.':'')),
      el('div',{class:'sb-wahl'},...[...new Set([...(jetzt?[jetzt]:[]),...(vor?[vor]:[]),5,10,15,20,30,45])].map(m=>
        el('button',{type:'button',class:'btn still'+(m===(jetzt??vor)?' vorschlag':''),dataset:{min:String(m)},onclick:()=>buche(m)},m+' min'))),
      el('div',{class:'sb-wahl'},ein,el('button',{type:'button',class:'btn still',dataset:{minOk:''},onclick:()=>{ const m=Number(ein.value)||0;
        if(m>=1&&m<=90) buche(m); else warn.textContent='Bitte 1 bis 90 Minuten eingeben.'; }},'Eintragen'))),warn));
}
function notizDialog(s){ if(!s) return; const opt={kursId:aktiverKursId};   // Kurswechsel-Netz (Prüfer 03.10. 🟡 3)
  dlgZeigen('<h3>Notiz · '+esc(s.vorname)+'</h3><textarea id="notiz-in" rows="3" class="u-textarea u-fs16"></textarea><div class="btn-reihe"><button class="btn" data-ok>Speichern</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
    d=>{ d.querySelector('[data-ok]').onclick=()=>{ if(kursGewechselt(opt)) return; const txt=d.querySelector('#notiz-in').value.trim(); if(txt){ addEvent('notiz',s.nr,{notiz:txt}); toast('Notiz gespeichert · '+s.vorname); renderHeute(); if(aktView==='schueler') renderSchueler(); } dlgZu(); }; setTimeout(()=>d.querySelector('#notiz-in').focus(),60); });
}
// Eingabe-Reihenfolge der Drittelnoten 1+ 1 1− … 6 — Object.keys(DRITTELNOTEN) stellt die ganzen Noten vorn (Zahl-Schlüssel), gesehen 02.10.
const NOTEN_DRITTEL=[1,2,3,4,5].flatMap(n=>[n+'+',String(n),n+'-']).concat('6');
function noteDialog(s,opt={}){ if(!s) return;
  opt={kursId:aktiverKursId,...opt};   // auch der Stempel bucht nach einem Kurswechsel nicht mehr (dieselbe Nr ist dann ein anderer Mensch)
  const sek2=bewertProfil(kurs())==='sek2';
  const buche=w=>{ if(kursGewechselt(opt)) return;
    if(addEvent('note',s.nr,{wert:w,...tagFeld(opt)})) toast(beamerModus?'Note gebucht · '+anzeigeVorname(s):'Note '+(sek2?w+' P':w)+' · '+s.vorname);   // an der Wand ohne Wert (Prüfer 03.10. 🟡 4)
    dlgZu(); (opt.danach||renderHeute)(); if(!opt.danach) pulseKachel(s.nr); };
  dlgZeigenEl(el('h3',{},'Note · '+(beamerModus?anzeigeVorname(s):s.vorname+' '+s.name)),
    el('section',{class:'sb-stunde'},el('div',{class:'sb-feld ruhig'},el('p',{class:'u-hinweis'},'Note antippen — gebucht. ↶ nimmt sie zurück.'),
      el('div',{class:'sb-wahl'},...(sek2?Array.from({length:16},(_,i)=>String(15-i)):NOTEN_DRITTEL).map(w=>
        el('button',{type:'button',class:'btn still',dataset:{note:w},onclick:()=>buche(w)},sek2?w+' P':w))))));
}
function tagFeld(opt){ return opt&&opt.datum?{datum:opt.datum}:{}; }
// Bewertung an einem Tag aus dem Verlauf setzen (Zero 2026-09-30: „Noten für einen Tag ändern“ · ganze Seite und Detail-Blatt).
// Dieselbe Regel wie der Stempel: ein Zeichen je Stunde, das neue ersetzt das alte (addEvent → ersetzungFuer), ↶ holt es zurück.
// Wer an dem Tag fehlte, wird nicht bewertet — wie bewertGuard im Sitzplan, nur für diesen Tag statt für den Termin.
const TAG_BEWERTUNGEN=[['+','＋','plus'],['o','o',''],['-','−','minus'],['note','note',''],['bestleistung','best','best'],['verweigert','verweigert','verw']];  // [typ, Zeichen oder Icon-Name, Rail-Klasse]
// Reihe unter den Einträgen eines Tages; das jetzt gültige Zeichen leuchtet wie der scharfe Stempel.
// sperre = Grund, warum hier nicht bewertet wird (steht sichtbar in der Reihe — ein Toast läge unter dem Detail-Blatt).
// data-kurs: der Kurs, für den die Reihe gezeichnet wurde (Schutz beim Kurswechsel, siehe verdrahteDetail).
function tagBewertenHtml(nr,tag,tagEvents,sperre,kursId){
  const alle=tagEvents.filter(e=>BEWERTUNGS_TYPEN.has(e.typ)).sort((a,b)=>String(a.ts).localeCompare(String(b.ts)));
  const bew=alle[alle.length-1]||null;
  const jetzt=bew?(bew.typ==='note'&&bew.best?'bestleistung':bew.typ):null;
  // Alte Tage (vor der Regel vom 29.09.) tragen oft mehrere Zeichen — ein Tipp ersetzt alle (Zero 2026-09-30: „Ersetzen + Hinweis“)
  const hinweis=alle.length>1?'An diesem Tag stehen '+alle.length+' Zeichen ('+alle.map(eintragLabel).join(' ')+') — ein Tipp ersetzt '+(alle.length===2?'beide':'alle')+'.'
    :'Bewertung dieses Tages — ein neues Zeichen ersetzt das alte';
  return '<div class="tag-bewerten"><div class="'+(sperre||alle.length>1?'u-warn13':'u-hinweis')+'">'+esc(sperre||hinweis)+'</div><div class="tag-bewerten-btns">'+
    TAG_BEWERTUNGEN.map(([typ,z,cls])=>'<button class="rail-btn'+(cls?' '+cls:'')+(jetzt===typ?' an':'')+'" data-tagbewerten="'+typ+'" data-nr="'+nr+'" data-tag="'+tag+'" data-kurs="'+esc(kursId)+'"'+(sperre?' disabled':'')+' aria-pressed="'+(jetzt===typ)+'" aria-label="'+RAIL_TITEL[typ]+'" title="'+RAIL_TITEL[typ]+'">'+
      (typ==='+'||typ==='o'||typ==='-'?z:iconHtml(z))+'</button>').join('')+'</div></div>';
}
// Der Kurs kann wechseln, während ein Dialog offen ist (Rückkehr in die App nach Blockwechsel) — dann nichts buchen:
// dieselbe Nummer ist im neuen Kurs ein anderer Mensch (Prüfer 2026-09-30: Emil 7b → Gustav 8c).
function kursGewechselt(opt){
  if(!opt||!opt.kursId||opt.kursId===aktiverKursId) return false;
  if($('dlg').open) dlgZu();
  toast('Der Kurs hat inzwischen gewechselt — nichts gebucht. Bitte den Schüler neu öffnen.',4000); renderAlles();
  return true;
}
function tagBewerten(nr,tag,typ,danach){
  const s=schuelerVonNr(nr); if(!s) return;
  const st=standAmTermin(nr,tag);
  if(st.fehlt){ toast(s.vorname+' fehlte an diesem Tag — '+(FEHLT_WORT[st.fehlt]||st.fehlt)+'. Erst die Abwesenheit zurücknehmen (↶), dann bewerten.',3200); return; }
  const opt={datum:tag,danach,kursId:aktiverKursId};
  if(typ==='verweigert') return verweigerungDialog(s,opt);
  if(typ==='bestleistung') return bestleistungDialog(s,opt);
  if(typ==='note') return noteDialog(s,opt);
  addEvent(typ,nr,{datum:tag}); danach();
}
// Nach dem Neuzeichnen denselben Tag wieder aufklappen und in den sichtbaren Teil des Zeitstrahls holen
function oeffneTag(wurzel,tag){
  const b=wurzel&&wurzel.querySelector('.zs-tag[data-tag="'+tag+'"]'); if(!b) return;
  b.click(); b.scrollIntoView({block:'nearest',inline:'center'});
  // nach verdrahteDetail, das den Strahl ans neueste Ende schiebt · Tages-Einträge in die Mitte: am unteren Rand läge die
  // Bewertungs-Reihe unter dem Rückgängig-Chip, und ein zweiter Tipp träfe den Chip (Prüfer 2026-09-30)
  setTimeout(()=>{ b.scrollIntoView({block:'nearest',inline:'center'}); const d=wurzel.querySelector('.tag-detail-inhalt.an'); if(d) d.scrollIntoView({block:'center',inline:'nearest'}); },0);
}
// Schülerblatt vom Sitzplan aus (Scheibe 3, Zero 2026-10-02: Variante A „Ein Blatt, Aktionen oben“). Oben „Diese Stunde“ mit allen
// Griffen: ein Tipp bucht auf den Termin, das Blatt schließt, ↶ steht bereit. Note und „zu spät“ klappen im Blatt auf (ein Tipp auf
// Note bzw. Minuten bucht), Notiz, ⭐ und ⊘ mit Textfeld und einem Knopf; immer nur ein Feld offen. Darunter der Rückblick wie bisher.
// Vorher kostete eine Note drei Ebenen (Blatt → „＋ Eintrag hinzufügen …“ → „Note…“ → Auswahl + „Eintragen“), der Rückblick war dabei weg.
// Wer fehlt, bekommt keine Bewertungsknöpfe (wie bewertGuard); ein Zeichen je Stunde regelt addEvent (ersetzungFuer).
// danach: nach einer Buchung (das Deck zeigt dann die nächste Karte, Scheibe 5)
function schuelerBlatt(nr,{danach}={}){
  const k=kurs(); const s=schuelerVonNr(nr); if(!k||!s) return;
  aktualisiereKursChip();   // das Blatt bucht in die Stunde von jetzt: der Chip dahinter nennt dieselbe (Deck ohne Takt, Prüfer 06.10., B5)
  // Beamer: das Blatt zeigt Vorschlag, Fehlzeiten, LB und Notizen — nie an die Wand (Prüfer 2026-09-29; die Schüler-Ansicht sperrt schon)
  if(beamerModus){ toast('Projektion aktiv — Details erst nach dem Beamer-Modus'); return; }
  const v=verdichte(vault.events.filter(e=>e.kursId===k.id),sidVonNr(nr,k),{profil:bewertProfil(k),lb:s.lb});
  const opt={kursId:aktiverKursId}, sek2=bewertProfil(k)==='sek2';
  let offen=null;   // das aufgeklappte Feld: 'note' | 'versp' | 'notiz' | 'best' | 'verw'
  const stunde=el('section',{class:'sb-stunde','aria-label':'Diese Stunde'});
  // eintraege: [[typ, extra], …] — die letzte Buchung ist die, die ↶ zurücknimmt (beim ⭐ die Note, nicht die Notiz)
  const buche=(eintraege,text)=>{ if(kursGewechselt(opt)) return; for(const [typ,extra] of eintraege) if(!addEvent(typ,nr,extra||{})) return;
    dlgZu(); toast(text+' · '+s.vorname); renderHeute(); pulseKachel(nr); if(danach) danach(eintraege[eintraege.length-1][0]); };
  const zeichne=fokus=>{
    const fehlt=standAmTermin(nr,terminDatum).fehlt;
    const sid=sidVonNr(nr), bew=wirksameEvents(vault.events).filter(e=>e.kursId===aktiverKursId&&e.sid===sid&&e.datum===terminDatum&&BEWERTUNGS_TYPEN.has(e.typ))
      .sort((a,b)=>String(a.ts).localeCompare(String(b.ts))).pop();
    const jetzt=bew?(bew.typ==='note'&&bew.best?'bestleistung':bew.typ):null;
    // Meldungen stehen IM Blatt — ein Toast läge unter dem Dialog (Prüfer 02.10., B2); ein schon gebuchtes e/u bucht nicht noch einmal (B8)
    const warn=el('p',{class:'u-warn13 sb-warn',role:'status'}), schonGebucht=()=>{ warn.textContent='Schon gebucht — ↶ nimmt es zurück.'; };
    const griff=(id,inhalt,fn,{an,auf}={})=>el('button',{type:'button',class:'btn still sb-griff',dataset:{sb:id},
      ...(an!=null?{'aria-pressed':String(!!an)}:{}),...(auf!=null?{'aria-expanded':String(auf)}:{}),onclick:fn},...[].concat(inhalt));
    const klapp=id=>()=>{ offen=offen===id?null:id; zeichne('[data-sb="'+id+'"]'); };
    const griffe=[
      ...(fehlt?[]:[
        griff('+','＋',()=>buche([['+']],'＋'),{an:jetzt==='+'}),
        griff('o','o',()=>buche([['o']],'o'),{an:jetzt==='o'}),
        griff('-','−',()=>buche([['-']],'−'),{an:jetzt==='-'}),
        griff('note',[iconEl('note'),' Note'],klapp('note'),{an:jetzt==='note',auf:offen==='note'}),
        griff('best',[iconEl('best'),' besondere Leistung'],klapp('best'),{an:jetzt==='bestleistung',auf:offen==='best'}),
        griff('verw',[iconEl('verweigert'),' verweigert'],klapp('verw'),{an:jetzt==='verweigert',auf:offen==='verw'}),
        griff('fehlt_o','abwesend',()=>buche([['fehlt_o']],'abwesend'))]),
      griff('versp','zu spät',klapp('versp'),{auf:offen==='versp'}),
      griff('notiz',[iconEl('notiz'),' Notiz'],klapp('notiz'),{auf:offen==='notiz'}),
      griff('lernzeit','Lernzeit/HA',()=>buche([['lernzeit']],'Lernzeit/HA')),
      griff('fehlt_e','entschuldigt',fehlt==='e'?schonGebucht:()=>buche([['fehlt_e']],'entschuldigt gefehlt'),{an:fehlt==='e'}),
      griff('fehlt_u','unentschuldigt',fehlt==='u'?schonGebucht:()=>buche([['fehlt_u']],'unentschuldigt gefehlt'),{an:fehlt==='u'})];
    const wahl=(werte,beschr,fn,vorn)=>el('div',{class:'sb-wahl'},...werte.map(w=>el('button',{type:'button',class:'btn still'+(w===vorn?' vorschlag':''),dataset:{sbWahl:String(w)},onclick:()=>fn(w)},beschr(w))));
    const textFeld=(hinweis,platzhalter,knopf,fn)=>{ const ta=el('textarea',{rows:'2',class:'u-textarea u-fs16',placeholder:platzhalter});
      return [el('p',{class:'u-hinweis'},hinweis),ta,el('div',{class:'btn-reihe'},el('button',{type:'button',class:'btn',dataset:{sbOk:offen},onclick:()=>fn(ta.value.trim())},knopf))]; };
    const st=buchungsStunde(), doch=fehlt==='o'&&offenesO(nr,st), bestWert=sek2?'15':'1', bestLabel=sek2?'15 P':'Note 1', vor=verspVorschlag(st);
    const altV=verspAmTermin(nr,false,st), jetztV=altV?altV.minuten:null;
    const versp=m=>{ if(m===jetztV&&!doch){ dlgZu(); toast('unverändert: '+m+' min · '+s.vorname); return; }
      buche([['versp',{minuten:m,...stundeFeld(st)}]],(doch?'kommt doch: ':'')+m+' min zu spät'); };   // ersetzt die Verspätung oder das ∅ der Stunde, nie addiert
    const minEin=el('input',{type:'text',inputmode:'numeric',class:'sb-min',placeholder:'andere','aria-label':'andere Minuten',maxlength:'2'});
    const feld=offen==='note'?[el('p',{class:'u-hinweis'},'Note antippen — gebucht. ↶ nimmt sie zurück.'),
        wahl(sek2?Array.from({length:16},(_,i)=>String(15-i)):NOTEN_DRITTEL,w=>sek2?w+' P':w,w=>buche([['note',{wert:w}]],'Note '+(sek2?w+' P':w)))]
      :offen==='versp'?[el('p',{class:'u-hinweis'},altV?verspText(altV):'Minuten antippen — gebucht.'+(vor?' Nach Stundenplan: '+vor+' min.':'')),
        wahl([...new Set([...(jetztV?[jetztV]:[]),...(vor?[vor]:[]),5,10,15,20,30,45])],m=>m+' min',m=>versp(m),jetztV??vor),
        el('div',{class:'sb-wahl'},minEin,el('button',{type:'button',class:'btn still',dataset:{sbMinOk:''},onclick:()=>{ const m=Number(minEin.value)||0;
          if(m>=1&&m<=90) versp(m); else warn.textContent='Bitte 1 bis 90 Minuten eingeben.'; }},'Eintragen'))]
      :offen==='notiz'?textFeld('Notiz zu dieser Stunde:','Notiz','Notiz speichern',t=>{ if(t) buche([['notiz',{notiz:t}]],'Notiz gespeichert'); else warn.textContent='Die Notiz ist leer.'; })
      :offen==='best'?textFeld('Trägt '+bestLabel+' als direkte Note ein. Begründung (empfohlen):','z. B. herausragender Beitrag','Eintragen ('+bestLabel+')',
        t=>buche([...(t?[['notiz',{notiz:t}]]:[]),['note',{wert:bestWert,best:true}]],'Besondere Leistung: '+bestLabel))
      :offen==='verw'?textFeld('Zählt für diese Stunde als 6 (Sek II: 0 P). Begründung:','z. B. Mitarbeit verweigert','Eintragen (6)',
        t=>buche([['verweigert',{notiz:t}]],'Verweigerung notiert (zählt 6)'))
      :null;
    stunde.replaceChildren(
      el('div',{class:'sb-kopf'},el('b',{},'Diese Stunde'),fehlt?el('span',{class:'u-warn13'},'fehlt · '+(FEHLT_WORT[fehlt]||fehlt)+' — keine Bewertung; '+(doch?'„zu spät“ (kommt doch) oder ':'')+'⌫ im Plan nimmt die Abwesenheit zurück'):null),
      el('div',{class:'sb-griffe'},...griffe),...(feld?[el('div',{class:'sb-feld'},...feld)]:[]),warn);
    const f=fokus&&stunde.querySelector(fokus); if(f) f.focus({preventScroll:true});
    const ta=stunde.querySelector('.sb-feld textarea'); if(ta) ta.focus();
  };
  dlgZeigen('<h3>'+esc(s.vorname)+' '+esc(s.name)+(s.lb?' · LB':'')+'</h3><p class="u-hinweis sb-unter">'+esc(k.name+' · '+k.fach+' · '+stundeUntertitel(k))+'</p>'+
    '<div class="sb-ort"></div><div class="tag-kopf sb-rueck">Rückblick</div>'+schuelerDetailHtml(s,k,v)+
    '<div class="btn-reihe"><button class="btn still" data-schliessen>Schließen</button></div>',
    el=>{
      el.querySelector('.sb-ort').replaceWith(stunde); zeichne();
      verdrahteDetail(el,tag=>{ dlgZu(); renderHeute(); schuelerBlatt(nr,{danach}); oeffneTag($('dlg'),tag); });   // Zeitstrahl-Tage, Balkenbreiten — fehlten hier (Tap tat nichts, Balken leer); Storno/Quartal unten überschrieben
      el.querySelectorAll('.ev-storno').forEach(b=>b.onclick=ev=>{ ev.stopPropagation(); const e=vault.events.find(x=>x.id===b.dataset.storno); if(e&&stornoVon(e)){ toast('storniert'+wiederDa(e)); dlgZu(); renderHeute(); schuelerBlatt(nr,{danach}); } });
      el.querySelectorAll('[data-quartal]').forEach(b=>b.onclick=ev=>{ ev.stopPropagation(); dlgZu(); setzeQuartalsnote(s,v.vorschlag); });
    });
}
// Zeichen im Sitzplan = die Legende, als eigene Seite der Hilfe zu „Heute“ (Scheibe 9, Zero 05.10. Wahl 2 B; Zero 01.10.: „Legende
// gehört in die Hilfe zu ‚Heute‘“). Leiste über dem Sitzplan und Beamer erklären jetzt die Zeilen der Hilfe, darum hier nicht doppelt.
function zeigeZeichen(){
  hilfeAus();
  // Anatomie-Beispiel und Marken = ECHTE kachelHtml/markenHtml-Ausgabe (eine Quelle der Wahrheit — Legende driftet nie vom Plan).
  // Neu 2026-09-29 (Zero: „Symbol-Legende ist veraltet"): gegliedert wie die Stempel-Leiste, je Zeile Stempel → Marke → Bedeutung,
  // ein Zeichen je Stunde, Notenwerte der Kurve.
  const sek2=bewertProfil(kurs())==='sek2';
  const wert=(note,p)=>sek2?p+' P':note;
  const demo=kachelHtml({nr:0,vorname:'Anna',name:'Anders',lb:true},{...leererStand(),plus:1,mat:1,notiz:1,versp:5},0,0,false);
  const marke=teil=>markenHtml({...leererStand(),...teil});
  const stempel=inhalt=>'<span class="lg-stempel">'+inhalt+'</span>';
  const zeile3=(st,teil,txt)=>'<div class="lg-zeile drei">'+stempel(st)+'<span class="lg-sym">'+(teil?marke(teil):'')+'</span><span>'+txt+'</span></div>';
  const zeile=(sym,txt)=>'<div class="lg-zeile"><span class="lg-sym">'+sym+'</span><span>'+txt+'</span></div>';
  const kopf=t=>'<div class="tag-kopf">'+t+'</div>';
  const hinweis=t=>'<p class="lg-hinweis">'+t+'</p>';
  dlgZeigen('<h3 tabindex="-1">Zeichen im Sitzplan</h3><div class="legende">'+
    '<div class="lg-kachel">'+demo+
      '<div class="lg-anatomie">'+
      '<div>oben <b>Vorname</b> + LB-Badge, darunter der Nachname</div>'+
      '<div>unten die <b>Marken</b> der Stunde</div>'+
      '<div><b>Kachelfarbe</b> = Bewertung der Stunde (hier ＋)</div>'+
      '<div>Stempel links wählen, dann Kacheln antippen</div></div></div>'+
    '<div class="lg-zeile drei lg-spalten"><span>Stempel</span><span>Kachel</span><span>Bedeutung</span></div>'+
    kopf('Bewertung — ein Zeichen je Stunde')+
    zeile3('＋',{plus:1},'positiv — '+wert('1−','13'))+
    zeile3('o',{neutral:1},'neutral — '+wert('3','8'))+
    zeile3('−',{minus:1},'negativ — '+wert('5+','3'))+
    zeile3(iconHtml('best'),{note:'1',best:true},'besondere Leistung — '+wert('1','15')+', mit Begründung')+
    zeile3(iconHtml('verweigert'),{verweigert:1},'Verweigerung — '+wert('6','0')+', mit Begründung')+
    zeile3(iconHtml('note'),{note:'2'},'direkte Note, frei gewählt')+
    hinweis('Ein neues Zeichen ersetzt das alte derselben Stunde, ↶ holt es zurück. Notizen, Fehlzeiten und Organisatorisches bleiben stehen. '+
      'Die Werte gelten, wenn alle Stunden so aussehen — gemischt liegt der Vorschlag dazwischen.')+
    kopf('Anwesenheit')+
    zeile3(iconHtml('abwesend'),{fehlt:'o'},'abwesend — Klärung offen (Reiter Schüler)')+
    zeile3(iconHtml('entsch'),{fehlt:'e'},'entschuldigt gefehlt')+
    zeile3(iconHtml('unentsch'),{fehlt:'u'},'unentschuldigt gefehlt — zählt als '+wert('6','0'))+
    zeile3(iconHtml('versp'),{versp:5},'zu spät — der erste Tipp bucht die Minuten seit Stundenbeginn, ein zweiter Tipp ändert sie. In einer späteren Stunde des Tages zählt eine neue dazu; auf ein ∅ derselben Stunde heißt es „kommt doch“')+
    hinweis('Wer fehlt, wird nicht bewertet — erst ⌫, dann bewerten.')+
    kopf('Organisation')+
    zeile3(iconHtml('ipad'),{ipad:1},'iPad fehlt / leer')+
    zeile3(iconHtml('material'),{mat:1},'Material vergessen')+
    zeile3(iconHtml('lernzeit'),{lernzeit:1},'Lernzeit / Hausaufgabe nicht erledigt')+
    zeile3(iconHtml('notiz'),{notiz:1},'Notiz')+
    kopf('Korrektur')+
    zeile3(iconHtml('entfernen'),null,'letzten Eintrag der Stunde entfernen — ein ersetztes Zeichen kommt zurück')+
    kopf('Kachelfarbe')+
    zeile('<span class="lg-swatch plus"></span>','＋')+
    zeile('<span class="lg-swatch minus"></span>','−')+
    zeile('<span class="lg-swatch fehlt"></span>','fehlt')+
    zeile('<span class="lg-swatch"></span>','sonst (o, Note, Bestleistung, ⊘ oder noch nichts)')+   // ohne ⭐-Emoji neben den SVG-Zeichen (W5.1)
    kopf('Sonderfälle')+
    zeile('<span class="chip chip-info">LB</span>','Förderschwerpunkt Lernen, zieldifferent — Bewertung möglich (Konferenz-Grundlage), nur kein Noten-Vorschlag')+
    '</div><div class="btn-reihe"><button class="btn still" data-hilfe-zurueck>‹ Hilfe</button><button class="btn still" data-schliessen>Schließen</button></div>',
    d=>{ d.querySelector('[data-hilfe-zurueck]').onclick=zeigeHilfe; });
  $('dlg').querySelector('h3').focus();   // der Inhalt ist ersetzt: Fokus auf den neuen Titel, nicht auf die Seite (Prüfer S9 B10)
}

// ═══ Hilfe je Ansicht (Scheibe 9, Zero 05.10. Wahl 1 C „Feld mit Nummern“, design/s9_hilfe_2026-10-05/WAHL.md) ═══
// Ein Feld über dem „i“ (am Handy ein Blatt von unten) nennt die Funktionen der Ansicht, in der man ist (logic/hilfe.mjs). Eine Zeile
// erscheint nur, wenn ihr Knopf auf dem Gerät sichtbar ist. Jeder Knopf, der nicht unter dem Feld liegt, trägt Rahmen und Nummer;
// die Zeile trägt dieselbe Nummer. Die Ebene mit den Nummern liegt unter dem Feld und verschwindet mit ihm.
let hilfeOffen=null;   // {zeilen:[{z,ziel,el}],handy} solange die Hilfe offen ist
function hilfeAus(){
  document.querySelector('.hilfe-marken')?.remove();
  window.removeEventListener('resize',hilfeNeu);
  $('dlg').classList.remove('hilfe'); hilfeOffen=null;
}
// Größe geändert oder Ansicht neu gezeichnet (Drehen über 600 px, Rückkehr in die App): sind Ziele weg oder hat das Gerät die Form
// gewechselt, die Hilfe neu aufbauen, sonst nur die Nummern neu setzen (Prüfer S9 B5: vorher saßen alle Rahmen an den alten Knöpfen)
function hilfeNeu(){
  if(!hilfeOffen||!$('dlg').open) return;
  if(hilfeOffen.handy!==HANDY.matches||hilfeOffen.zeilen.some(x=>!x.ziel.isConnected)) zeigeHilfe(); else hilfeNummern();
}
function hilfeNummern(){
  if(!hilfeOffen||!$('dlg').open) return;
  document.querySelector('.hilfe-marken')?.remove();
  const feld=$('dlg').getBoundingClientRect(), ebene=el('div',{class:'hilfe-marken','aria-hidden':'true'});
  // ganz im Bild und nicht unter dem Feld — sonst steht die Nummer in der Zeile, und der Rahmen ist nicht zu sehen (Prüfer S9 B9)
  const frei=r=>(r.right<=feld.left||r.left>=feld.right||r.bottom<=feld.top||r.top>=feld.bottom)&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;
  let n=0;
  for(const x of hilfeOffen.zeilen){
    x.el.querySelector('.hl-n')?.remove();
    const r=x.ziel.getBoundingClientRect();
    if(!x.ziel.isConnected||!frei(r)) continue;
    n++;
    const ring=el('div',{class:'hl-ring'}); ring.style.left=(r.left-3)+'px'; ring.style.top=(r.top-3)+'px'; ring.style.width=(r.width+6)+'px'; ring.style.height=(r.height+6)+'px';
    const nr=el('span',{class:'hl-n'},String(n)); nr.style.left=Math.max(2,r.left-10)+'px'; nr.style.top=Math.max(2,r.top-10)+'px';
    ebene.append(ring,nr);
    x.el.querySelector('b').prepend(el('span',{class:'hl-n'},String(n)));
  }
  document.body.append(ebene);
}
function zeigeHilfe(){
  const h=HILFE[aktView]; if(!h) return;
  hilfeAus();
  const sichtbar=e=>{ const r=e.getBoundingClientRect(); return r.width>0&&r.height>0&&!e.closest('[hidden],.hidden,dialog'); };
  const zeilen=h.zeilen.map(z=>({z,ziel:findeZiel(z,sel=>document.querySelectorAll(sel),sichtbar)})).filter(x=>x.ziel)
    .map(x=>({...x,el:el('div',{class:'hl-z'},el('b',{},x.z.begriff),el('span',{},x.z.text))}));
  // „Zeichen ›“ im Kopf neben dem Titel (Zero 05.10. zu Prüfer-B1: „Kürzer + Zeichen oben“), immer ohne Scrollen zu sehen
  const titel=el('h3',{tabindex:'-1'},'Hilfe · '+h.titel), warOffen=$('dlg').open;
  dlgZeigenEl(el('div',{class:'hl-kopf'},titel,
      ...(h.zeichen?[el('button',{type:'button',class:'btn still hl-zeichen',dataset:{hilfeZeichen:''},'aria-label':'Zeichen im Sitzplan',onclick:zeigeZeichen},'Zeichen',el('span',{'aria-hidden':'true'},' ›'))]:[])),
    ...zeilen.map(x=>x.el));
  // von „‹ Hilfe“ (Feld war offen): Fokus auf den Titel, sonst fiele er auf die Seite (Prüfer S9 B10)
  if(warOffen) titel.focus();
  const d=$('dlg'); d.classList.add('hilfe');
  hilfeOffen={zeilen,handy:HANDY.matches};
  d.addEventListener('close',hilfeAus,{once:true});
  window.addEventListener('resize',hilfeNeu);
  // erst wenn das Feld steht: welche Knöpfe liegen frei — noch einmal nach dem Einfahren (0,24 s, ohne reduzierte Bewegung)
  requestAnimationFrame(hilfeNummern); setTimeout(hilfeNummern,300);
}


export { RAIL_TITEL, setStempel, stempelAus, renderRail, pulseKachel, buchungsStunde, stundeFeld, verspVorschlag, offenesO, verspAmTermin, verspText, verspStempel, verspDialog, notizDialog, NOTEN_DRITTEL, noteDialog, tagFeld, TAG_BEWERTUNGEN, tagBewertenHtml, kursGewechselt, tagBewerten, oeffneTag, schuelerBlatt, zeigeZeichen, hilfeOffen, hilfeAus, hilfeNeu, hilfeNummern, zeigeHilfe };
