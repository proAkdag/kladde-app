// Kladde · js/app.mjs — Bootstrap + UI (P1.1-A1: mechanischer Umzug aus index.html v0.7, verhaltensneutral)
// Logik lebt in ../logic/*.mjs — App und Tests importieren DIESELBEN Dateien (Drift unmöglich).
import { DRITTELNOTEN, wertZuLabel } from '../logic/skalen.mjs?v=1.3.0.1783575500';
import { verdichte, wirksameEvents, regelText, vorschlagsZeilen } from '../logic/verdichtung.mjs?v=1.3.0.1783575500';
import { mergeContainerDaten } from '../logic/merge.mjs?v=1.3.0.1783575500';
import { decodeContainerAuto, encodeContainerV2, wechslePassphrase, neueV2Identitaet } from '../logic/container.mjs?v=1.3.0.1783575500';
import { parseSchuelerListe } from '../logic/parser.mjs?v=1.3.0.1783575500';
import { migriereStamm, schemaBekannt, standardZeitraeume } from '../logic/migration.mjs?v=1.3.0.1783575500';
import { resolveBloecke, formatZeit } from '../logic/zeitmodell.mjs?v=1.3.0.1783575500';
import { kursZurZeit } from '../logic/autowahl.mjs?v=1.3.0.1783575500';
import { kursStatus } from '../logic/kursStatus.mjs?v=1.3.0.1783575500';
import { zufallsGewicht, gewichteteWahl } from '../logic/auswahl.mjs?v=1.3.0.1783575500';
const APP_VERSION = '1.3.0';
const GERAET = /iPad|iPhone/.test(navigator.userAgent) ? 'ipad' : 'pc';
const PAGES_KONTEXT = /\.github\.io$/.test(location.hostname);
// Zwei-Instanzen-Trennung: /dev/ = Claudes Entwicklungs-Kladde (eigene DB, Pseudo-Daten) ·
// Wurzel = Zeros Produktiv-Kladde (echte Namen — Claude betritt sie NICHT mehr).
const IST_DEV = location.pathname.includes('/dev/');
if (IST_DEV) {
  document.title = 'Kladde DEV';
  document.addEventListener('DOMContentLoaded', function () {
    const h = document.querySelector('header.app');
    if (h) h.insertAdjacentHTML('beforeend', '<span class="dev-badge">DEV</span>');
  });
}

/* ═══ STORAGE · Vault = KLD1-Container in IndexedDB ═══ */
const DB_NAME=IST_DEV?'kladde_dev':'kladde_v1'; // getrennte Vaults für Dev- und Produktiv-Instanz
let db=null, pinRam=null, vault=null;      // vault = entschlüsselter Zustand im RAM · pinRam für Import/Pull/Wechsel
let dekKey=null, containerKopf=null;        // KLD1 v2: DEK (non-extractable CryptoKey) + wiederverwendbarer Wrap-Kopf
let migrationsHinweis=false;                // einmaliger Banner nach v1→v2-Migration
function mitDb(){ return new Promise((res,rej)=>{ if(db) return res(db);
  const req=indexedDB.open(DB_NAME,1);
  req.onupgradeneeded=()=>req.result.createObjectStore('meta');
  req.onsuccess=()=>{db=req.result;res(db);}; req.onerror=()=>rej(req.error); }); }
function idbGet(k){ return mitDb().then(d=>new Promise((res,rej)=>{ const r=d.transaction('meta').objectStore('meta').get(k); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); })); }
function idbPut(k,v){ return mitDb().then(d=>new Promise((res,rej)=>{ const tx=d.transaction('meta','readwrite'); tx.objectStore('meta').put(v,k); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); })); }

let speicherKette=Promise.resolve(); // Write-through seriell (keine Races)
function speichern(){
  if(!vault||!dekKey||!containerKopf) return speicherKette;
  const snapshot=JSON.stringify(vault);
  // v2-Save: reines AES-GCM mit dem DEK — KEIN KDF (gemessen 0,79 ms/Save statt ~1 KDF/Tap)
  speicherKette=speicherKette
    .then(()=>encodeContainerV2(JSON.parse(snapshot),dekKey,containerKopf))
    .then(blob=>idbPut('vault',blob))
    .catch(err=>{ console.error('[kladde] speichern',err); toast('⚠ Speichern fehlgeschlagen: '+err.message); });
  return speicherKette;
}
function leererVault(){
  return {schema:'kladde/v2',
    stamm:{rev:1,ts:new Date().toISOString(),geraet:GERAET,kurse:[],schueler:{},sitzplaene:{},kursprofile:{},stundenplanSlots:[],zeitmodelle:[],wochenplan:[],ausnahmeSlots:[],einstellungen:{slot:'m1'}},
    events:[]};
}
function stammMutiert(){ vault.stamm.rev++; vault.stamm.ts=new Date().toISOString(); vault.stamm.geraet=GERAET; }

/* ═══ PIN / LOCK (Auto-Lock 15 min · visibilitychange-Flush) ═══ */
const $=id=>document.getElementById(id);
let lockTimer=null, zuletztAktiv=Date.now();
function toast(text,ms=2600){ const t=$('toast'); t.textContent=text; t.classList.add('hidden'); void t.offsetWidth; t.classList.remove('hidden'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.add('hidden'),ms); }

// Passphrase-Stärke (rein lokal, keine Lib): Länge + Zeichenklassen (§1/§34)
function passStaerke(p){
  if(!p) return null;
  const klassen=(/[a-zäöüß]/i.test(p)?1:0)+(/\d/.test(p)?1:0)+(/[^a-z0-9äöüß]/i.test(p)?1:0);
  if(p.length>=12&&klassen>=2) return 'gut';
  if(p.length>=10) return 'okay';
  return 'schwach';
}
async function lockInit(){
  const blob=await idbGet('vault');
  const neu=!blob;
  $('lock-text').innerHTML=neu
    ?'Passphrase festlegen<br><small>Für echte Schülerdaten empfohlen: mindestens 12 Zeichen oder ein kurzer Satz.<br><b>Wichtig:</b> Ohne Passphrase können die Daten nicht wiederhergestellt werden.</small>'
    :'Passphrase eingeben';
  $('pin2').classList.toggle('hidden',!neu);
  $('lock-btn').textContent=neu?'Kladde anlegen':'Öffnen';
  $('pin').value=''; $('pin2').value=''; $('lock-fehler').textContent='';
  $('pin-staerke').textContent='';
  $('lock').classList.remove('hidden');
  setTimeout(()=>$('pin').focus(),50);
  $('pin').oninput=()=>{ // Live-Stärke nur bei Neuanlage sinnvoll
    if(!neu){ $('pin-staerke').textContent=''; return; }
    const s=passStaerke($('pin').value);
    $('pin-staerke').textContent=s?('Stärke: '+s):'';
    $('pin-staerke').className='pass-staerke '+(s||'');
  };
  $('pin-auge').onclick=()=>{
    const p=$('pin'), p2=$('pin2');
    const zeigt=p.type==='text';
    p.type=zeigt?'password':'text'; p2.type=p.type;
    $('pin-auge').textContent=zeigt?'👁':'🙈';
  };
  $('lock-btn').onclick=async()=>{
    const pin=$('pin').value;
    if(neu){
      if(pin.length<10){ $('lock-fehler').textContent='Mindestens 10 Zeichen — besser 12+ oder ein kurzer Satz.'; return; }
      if(pin!==$('pin2').value){ $('lock-fehler').textContent='Passphrasen stimmen nicht überein.'; return; }
      const id=await neueV2Identitaet(pin);
      dekKey=id.dek; containerKopf=id.kopf;
      pinRam=pin; vault=leererVault();
      await speichern(); entsperrt();
    } else {
      $('lock-btn').disabled=true; $('lock-fehler').textContent='prüfe… (PBKDF2)';
      const t0=performance.now();
      try {
        const roh=await idbGet('vault');
        const r=await decodeContainerAuto(roh,pin);
        if(r.version===1){
          // ── Stille Migration v1→v2 · Auflage 1: v1-Backup mit READ-BACK, sonst KEIN v2-Write ──
          await idbPut('vault_v1_backup',roh);
          const rb=await idbGet('vault_v1_backup');
          let identisch=Boolean(rb)&&rb.length===roh.length;
          if(identisch){ for(let i=0;i<roh.length;i++){ if(rb[i]!==roh[i]){ identisch=false; break; } } }
          if(!identisch) throw new Error('v1-Sicherung fehlgeschlagen — Migration abgebrochen, Daten unverändert.');
          const id=await neueV2Identitaet(pin);
          dekKey=id.dek; containerKopf=id.kopf;
          vault=r.daten; pinRam=pin;
          migriereStamm(vault); // Schema kladde/v2 (P2.1) — idempotent
          await speichern(); // erste v2-Schreibung — erst NACH verifiziertem Backup
          migrationsHinweis=true;
          console.log('[kladde] v1→v2 migriert (Backup verifiziert) in',Math.round(performance.now()-t0),'ms');
        } else {
          dekKey=r.dek; containerKopf=r.kopf;
          vault=r.daten; pinRam=pin;
          if(migriereStamm(vault)) speichern(); // Schema-Nachzug (v0.8-Bestand → kladde/v2)
          console.log('[kladde] Unlock (v2) in',Math.round(performance.now()-t0),'ms');
        }
        entsperrt();
      } catch(e){
        $('lock-fehler').textContent=e.message;
        const p=$('pin'); p.classList.remove('schuett'); void p.offsetWidth; p.classList.add('schuett'); // §31 Konflikt: Zurückweisung
      }
      $('lock-btn').disabled=false;
    }
  };
  const enter=e=>{ if(e.key==='Enter') $('lock-btn').click(); };
  $('pin').onkeydown=enter; $('pin2').onkeydown=enter;
}
function sperren(){
  // Hard-Lock: RAM-Wipe + UI-Hygiene (§5) — nach dem Sperren darf kein Name mehr im DOM stehen
  vault=null; pinRam=null; dekKey=null; containerKopf=null;
  aktiverSchueler=null; offenerSchueler=null; deckListe=[]; undoStack.length=0;
  stempelAus(); // RAM-Wipe: kein scharfer Stempel/Modus-Rahmen hinter dem Lock
  if(editorCleanup){ try{ editorCleanup(); }catch{} } // Sitzplan-Editor-Leiste + Listener räumen
  try{ dlgZu(); }catch{}
  $('dlg').innerHTML='';
  $('undo-chip').classList.add('hidden');
  $('soft-lock').classList.add('hidden');
  lockInit();
}
function lockMinuten(){ const m=Number(localStorage.getItem('kladde_lock_min')); return [5,10,15,30].includes(m)?m:15; }
// P2.6 · Unterrichtsbewusster Hard-Lock: während eines laufenden Blocks (+10 min Nachlauf)
// nicht aussperren — sonst erzwingt die 67,5-min-Stunde die Passphrase vor der Klasse.
function unterrichtAktiv(){
  const zm=(vault?.stamm.zeitmodelle||[])[0]; if(!zm) return false;
  const j=new Date(); const wtag=((j.getDay()+6)%7)+1; if(wtag>5) return false;
  const sek=j.getHours()*3600+j.getMinutes()*60+j.getSeconds();
  return resolveBloecke(zm,wtag).some(b=>b.startSek<=sek&&sek<=b.endeSek+600);
}
function entsperrt(){
  $('lock').classList.add('hidden');
  zuletztAktiv=Date.now();
  clearInterval(lockTimer);
  lockTimer=setInterval(()=>{
    if(Date.now()-zuletztAktiv<=lockMinuten()*60*1000) return;
    if(unterrichtAktiv()&&localStorage.getItem('kladde_lock_unterricht')!=='0') return; // pausiert; Soft-Lock deckt Verlassen
    sperren();
  },30*1000);
  kursAutowahl(); renderAlles();
  starteAutowahlTick();
  zeigeStartHinweise();
}
['pointerdown','keydown'].forEach(evName=>document.addEventListener(evName,()=>{zuletztAktiv=Date.now();},{capture:true,passive:true}));
// Soft-Lock (P1.4): iOS erzeugt beim App-Umschalten einen SCREENSHOT — das Overlay muss
// SOFORT und OHNE Animation stehen, sonst landen Schülernamen im App-Switcher.
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'&&vault){
    $('soft-lock').classList.remove('hidden'); // synchron, animationsfrei
    speichern();
    if(localStorage.getItem('kladde_lock_sofort')==='1') speicherKette.then(sperren);
  } else if(document.visibilityState==='visible'&&vault){
    $('soft-lock').classList.add('hidden');
    kursAutowahl(true); // Rückkehr in die App: Block könnte gewechselt haben (sanft)
    if(aktView==='heute') renderHeute();
  }
});
window.addEventListener('pagehide',()=>{ if(vault) speichern(); });
$('btn-lock').addEventListener('click',()=>{ speichern().then(sperren); });

/* ═══ ZUSTAND-HELPERS ═══ */
let aktiverKursId=null, terminDatum=heuteIso(), aktiverSchueler=null, undoStack=[];
function heuteIso(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function kurs(){ return vault?.stamm.kurse.find(k=>k.id===aktiverKursId)||null; }
function kursSchueler(k){ return (vault.stamm.schueler[k.id]||[]); }
// Bewertungs-Modus: bildet die 3 Fälle (Sek I=Drittel · Sek II=Punkte · Sek II=Drittel)
// auf die getestete 2-Wege-Logik ab — Sek-II-Drittel rechnet wie Sek I (Drittelnoten 1–6).
function bewertProfil(k){ return (k&&k.profil==='sek2'&&(k.notenmodus||'punkte')!=='drittel')?'sek2':'sek1'; }
function addEvent(typ,schuelerNr,extra={}){
  const k=kurs();
  if(k&&k.status==='archiviert'){ toast('Archivierter Kurs — schreibgeschützt'); return null; } // P3.3
  const e={id:crypto.randomUUID(),typ,schuelerNr,kursId:aktiverKursId,datum:terminDatum,ts:new Date().toISOString(),geraet:GERAET,...extra};
  vault.events.push(e);
  undoStack.push(e); if(undoStack.length>50) undoStack.shift();
  speichern();
  zeigeUndo(e);
  return e;
}
function stornoVon(e){
  const s={id:crypto.randomUUID(),typ:'storno',schuelerNr:e.schuelerNr,kursId:e.kursId,datum:e.datum,ts:new Date().toISOString(),geraet:GERAET,stornoVon:e.id};
  vault.events.push(s); speichern();
}
const TYP_LABEL={'+':'＋','o':'o','-':'−',mat:'Material',ipad_fehlt:'iPad fehlt',ipad_leer:'iPad leer',lernzeit:'Lernzeit',ha:'HA',fehlt_o:'abwesend',fehlt_e:'fehlt (e)',fehlt_u:'fehlt (u)',versp:'zu spät',notiz:'Notiz',note:'Note',quartalsnote:'Quartalsnote',verweigert:'verweigert (6)'};
// Kompaktes Symbol eines Eintrags (für die entfernbaren Heute-Chips in der Aktionsbar)
function zeigeUndo(e){
  const chip=$('undo-chip');
  const s=schuelerVonNr(e.schuelerNr);
  chip.textContent='↶ '+(s?s.vorname:'Nr '+e.schuelerNr)+': '+(TYP_LABEL[e.typ]||e.typ);
  chip.classList.add('hidden'); void chip.offsetWidth; chip.classList.remove('hidden');
  clearTimeout(chip._t); chip._t=setTimeout(()=>chip.classList.add('hidden'),6000);
  chip.onclick=()=>{ stornoVon(e); chip.classList.add('hidden'); toast('Rückgängig: '+(TYP_LABEL[e.typ]||e.typ)); renderHeute(); };
}
function schuelerVonNr(nr){ const k=kurs(); return k?kursSchueler(k).find(s=>s.nr===nr):null; }

// Aggregierter Tages-Stand (für Sitzplan-Symbole + Detail). EIN Reduzierer, zwei Zugänge:
// standAmTermin(nr) für Einzel-Abfrage · tagesStandIndex(datum) für den ganzen Sitzplan in einem Durchlauf.
function leererStand(){ return {plus:0,neutral:0,minus:0,mat:0,ipad:0,lernzeit:0,notiz:0,note:null,fehlt:null,versp:0,verweigert:0,count:0}; }
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
    else if(e.typ==='note') st.note=e.wert;
    else if(e.typ==='fehlt_e') st.fehlt='e';
    else if(e.typ==='fehlt_u') st.fehlt='u';
    else if(e.typ==='fehlt_o'&&st.fehlt!=='e'&&st.fehlt!=='u') st.fehlt='o'; // abwesend (offen, ungeklärt) — e/u gewinnen
    else if(e.typ==='versp') st.versp+=e.minuten||0;
    else if(e.typ==='verweigert') st.verweigert++;
  }
  return st;
}
function standAmTermin(nr,datum){
  return reduziereStand(wirksameEvents(vault.events).filter(e=>e.kursId===aktiverKursId&&e.schuelerNr===nr&&e.datum===datum));
}
function tagesStandIndex(datum){
  const byNr=new Map();
  for(const e of wirksameEvents(vault.events)){
    if(e.kursId!==aktiverKursId||e.datum!==datum) continue;
    let a=byNr.get(e.schuelerNr); if(!a){ a=[]; byNr.set(e.schuelerNr,a); }
    a.push(e);
  }
  const idx=new Map();
  for(const [nr,evs] of byNr) idx.set(nr,reduziereStand(evs));
  return idx;
}
const WOCHENTAG_KURZ=['So','Mo','Di','Mi','Do','Fr','Sa'];
function datumLabel(iso){ const [y,m,d]=iso.split('-').map(Number); const dt=new Date(y,m-1,d); return WOCHENTAG_KURZ[dt.getDay()]+' '+String(d).padStart(2,'0')+'.'+String(m).padStart(2,'0')+'.'; }
// Beamer-Modus: UI-Präferenz (localStorage, nicht im verschlüsselten Vault)
let beamerModus=localStorage.getItem('kladde_beamer')==='1';
function setzeBeamer(an){
  beamerModus=an; localStorage.setItem('kladde_beamer',an?'1':'0');
  document.body.classList.toggle('beamer',an);
  document.body.classList.toggle('nurplan',an&&localStorage.getItem('kladde_beamer_nurplan')==='1');
  $('btn-beamer').classList.toggle('aktiv',an);
  $('beamer-hinweis').classList.toggle('hidden',!an);
  renderAlles(); // kurz/nurplan wirken über alle Ansichten (Kachel, Deck, Aktionsbar)
}
// Beamer-Optionen-Sheet (§6): Namen abkürzen · Nur Sitzplan — Bewertungen/LB bleiben immer verborgen
function beamerOptionenSheet(){
  const opt=(key,label)=>{
    const cb=el('input',{type:'checkbox',class:'u-check',...(localStorage.getItem(key)==='1'?{checked:'checked'}:{}),
      onchange:e=>{ localStorage.setItem(key,e.target.checked?'1':'0');
        if(beamerModus){ document.body.classList.toggle('nurplan',localStorage.getItem('kladde_beamer_nurplan')==='1'); renderAlles(); } }});
    return el('div',{class:'zeile'},el('span',{},label),el('span',{},cb));
  };
  dlgZeigenEl(
    el('h3',{},'👁 Projektionsmodus'),
    el('p',{class:'u-hinweis'},'Bewertungen und LB-Hinweise sind bei aktiver Projektion immer verborgen.'),
    opt('kladde_beamer_kurz','Namen abkürzen (E. Y.)'),
    opt('kladde_beamer_nurplan','Nur Sitzplan (Datums-Extras aus)'),
    el('div',{class:'btn-reihe'},el('button',{class:'btn',onclick:dlgZu},'Fertig')));
}

/* ═══ KURS-AUTOWAHL über Stundenplan-Slots (freie Zeitfenster · 67,5-min-Schule) ═══ */
let autowahlInfo=null;   // {kursId, blockNr, startSek, endeSek, quelle} — für Heute-Kopf (§28)
let manuelleWahl=false;  // Kurs-Chip-Wahl übersteht sanfte Ticks; neuer laufender Block hebt sie auf
function kursAutowahl(sanft=false){
  if(!vault) return;
  const jetzt=new Date();
  const zm=(vault.stamm.zeitmodelle||[])[0];
  const vorherBlock=autowahlInfo?.blockNr;
  autowahlInfo=null;
  if(zm){
    const t=kursZurZeit(jetzt,{zeitmodell:zm,wochenplan:vault.stamm.wochenplan||[],ausnahmen:vault.stamm.ausnahmeSlots||[]});
    if(t){
      const wtag=((jetzt.getDay()+6)%7)+1;
      const block=resolveBloecke(zm,wtag).find(b=>b.blockNr===t.blockNr);
      autowahlInfo={...t,startSek:block.startSek,endeSek:block.endeSek};
      if(t.quelle!=='kommend'&&t.blockNr!==vorherBlock) manuelleWahl=false; // Blockwechsel hebt manuelle Wahl auf
      if(!sanft||!manuelleWahl){
        aktiverKursId=t.kursId; aktiveTeilgruppe=t.teilgruppe||null;
        $('kurs-slot').textContent=' · Block '+t.blockNr+' · '+formatZeit(block.startSek)+'–'+formatZeit(block.endeSek)+(t.teilgruppe?' · Gr. '+t.teilgruppe:'')+(t.quelle==='kommend'?' (gleich)':'');
      }
      aktualisiereKursChip(); return;
    }
  }
  // Fallback: Alt-Slots (Expertenmodus, freie Zeitfenster) — bleibt, solange kein Wochenplan existiert
  const wtag=((jetzt.getDay()+6)%7)+1;
  const hhmm=String(jetzt.getHours()).padStart(2,'0')+':'+String(jetzt.getMinutes()).padStart(2,'0');
  const slot=vault.stamm.stundenplanSlots.find(s=>s.wochentag===wtag&&s.von<=hhmm&&hhmm<=s.bis);
  if(slot&&(!sanft||!manuelleWahl)){ aktiverKursId=slot.kursId; aktiveTeilgruppe=slot.teilgruppe||null; $('kurs-slot').textContent=' · '+slot.von+'–'+slot.bis+(slot.teilgruppe?' · Gr. '+slot.teilgruppe:''); }
  else if(!aktiverKursId||kursIstArchiviert(aktiverKursId)){
    // Fallback: erster NICHT-archivierter Kurs des aktiven Schuljahres (nie ein Archiv-Kurs)
    const aid=vault.stamm.aktivesSchuljahrId;
    const w=vault.stamm.kurse.find(x=>(x.schuljahrId||aid)===aid&&x.status!=='archiviert')||vault.stamm.kurse.find(x=>x.status!=='archiviert');
    aktiverKursId=w?w.id:null;
  }
  aktualisiereKursChip();
}
function kursIstArchiviert(id){ const k=vault.stamm.kurse.find(x=>x.id===id); return k&&k.status==='archiviert'; }
// 60-s-Tick (P2.5): nur bei sichtbarer Heute-Ansicht, nie über offene Dialoge hinweg
let autowahlTick=null;
function starteAutowahlTick(){
  clearInterval(autowahlTick);
  autowahlTick=setInterval(()=>{
    if(!vault||document.visibilityState!=='visible'||aktView!=='heute'||$('dlg').open) return;
    const vorher=aktiverKursId;
    kursAutowahl(true);
    if(aktiverKursId!==vorher){ mitUebergang(renderHeute); const k=kurs(); toast('→ '+(k?k.name+' · '+k.fach:'')); }
  },60000);
}
let aktiveTeilgruppe=null;
function aktualisiereKursChip(){
  const k=kurs();
  $('kurs-name').textContent=k?k.name+' · '+k.fach:'Kein Kurs';
  if(!kurs()) $('kurs-slot').textContent='';
}
$('kurs-chip').addEventListener('click',()=>{
  if(!vault) return;
  const k=kurs();
  dlgZeigen('<h3>Kurs wählen</h3>'+
    vault.stamm.kurse.map(x=>'<button class="btn'+(k&&x.id===k.id?'':' still')+' u-btn-block" data-kurs="'+x.id+'">'+esc(x.name)+' · '+esc(x.fach)+'</button>').join('')+
    '<div class="zeile"><span>Teilgruppe</span><span><select id="tg-sel"><option value="">alle</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select></span></div>'+
    '<div class="btn-reihe"><button class="btn still" data-schliessen>Schließen</button></div>',
    el=>{
      el.querySelector('#tg-sel').value=aktiveTeilgruppe||'';
      el.querySelectorAll('[data-kurs]').forEach(b=>b.onclick=()=>{ aktiverKursId=b.dataset.kurs; aktiveTeilgruppe=el.querySelector('#tg-sel').value||null; manuelleWahl=true; $('kurs-slot').textContent=aktiveTeilgruppe?' · Gr. '+aktiveTeilgruppe:''; dlgZu(); aktualisiereKursChip(); mitUebergang(renderAlles); });
      el.querySelector('#tg-sel').onchange=e=>{ aktiveTeilgruppe=e.target.value||null; renderHeute(); };
    });
});
function oeffneDatum(){
  dlgZeigen('<h3>Termin wählen</h3><p class="u-leise u-fs14">Für Nacharbeit — Einträge gehen auf diesen Termin.</p>'+
    '<input type="date" id="datum-in" value="'+terminDatum+'"><div class="btn-reihe"><button class="btn" data-ok>Übernehmen</button><button class="btn still" data-heute>Heute</button></div>',
    el=>{
      el.querySelector('[data-ok]').onclick=()=>{ terminDatum=el.querySelector('#datum-in').value||heuteIso(); dlgZu(); mitUebergang(renderHeute); };
      el.querySelector('[data-heute]').onclick=()=>{ terminDatum=heuteIso(); dlgZu(); mitUebergang(renderHeute); };
    });
}
$('btn-beamer').addEventListener('click',()=>setzeBeamer(!beamerModus));
$('beamer-opt').addEventListener('click',beamerOptionenSheet);

/* ═══ THEME · Tag/Nacht/System · Default Nacht (Zero-Entscheid E1) ═══ */
const THEME_KEY='kladde_theme';
const themePref=()=>{ const t=localStorage.getItem(THEME_KEY); return (t==='tag'||t==='nacht'||t==='system')?t:'nacht'; };
const themeHell=()=>matchMedia('(prefers-color-scheme: light)').matches;
const themeEff=()=>{ const p=themePref(); return p==='system'?(themeHell()?'tag':'nacht'):p; };
function themeAnwenden(){
  const eff=themeEff();
  document.documentElement.dataset.theme=eff;
  const mc=document.querySelector('meta[name="theme-color"]'); if(mc) mc.content=eff==='tag'?'#F4F0E7':'#17150F';
  const b=$('btn-theme'); if(b){ b.textContent=eff==='tag'?'☀':'🌙'; b.title='Ansicht: '+(themePref()==='system'?'System (folgt Gerät)':eff==='tag'?'Tag':'Nacht'); }
}
$('btn-theme')?.addEventListener('click',()=>{ localStorage.setItem(THEME_KEY, themeEff()==='tag'?'nacht':'tag'); themeAnwenden(); });
matchMedia('(prefers-color-scheme: light)').addEventListener('change',()=>{ if(themePref()==='system') themeAnwenden(); });
themeAnwenden();

/* ═══ SICHERE DOM-ERZEUGUNG (P1.7 · Migrationsregel: neue Views nutzen el(), Bestand esc()) ═══ */
// el('div', {class:'zeile', onclick:fn}, 'Text', kindEl, …) — Kinder IMMER via textContent/append,
// nie HTML-Parsing: Schülernamen/Notizen können strukturell kein Markup einschleusen.
function el(tag, props, ...kinder){
  const e=document.createElement(tag);
  for(const [k,v] of Object.entries(props||{})){
    if(k==='class') e.className=v;
    else if(k==='dataset') Object.assign(e.dataset,v);
    else if(k.startsWith('on')&&typeof v==='function') e[k]=v;
    else if(v!==undefined&&v!==null) e.setAttribute(k,v);
  }
  for(const kind of kinder){
    if(kind===null||kind===undefined) continue;
    e.append(kind.nodeType?kind:document.createTextNode(String(kind)));
  }
  return e;
}

/* ═══ DIALOG-HELFER ═══ */
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function dlgZeigen(html,setup){
  const d=$('dlg'); d.innerHTML=html;
  d.querySelectorAll('[data-schliessen]').forEach(b=>b.onclick=()=>d.close());
  if(setup) setup(d);
  d.showModal();
}
function dlgZu(){ $('dlg').close(); }
// el()-Variante: Dialog aus DOM-Knoten (CSP-sicher, kein innerHTML) — für neue Views (P2.4+)
function dlgZeigenEl(...knoten){
  const d=$('dlg'); d.replaceChildren(...knoten);
  if(!d.open) d.showModal();
}

/* ═══ VIEWS / TABS (replaceState-only — Edge-Swipe-Doktrin) ═══ */
let aktView='heute';
const VIEW_TITEL={heute:['Heute','Sitzplan · live erfassen'],deck:['Deck','Klasse zügig durchgehen'],schueler:['Schüler','Verläufe, Notizen & Details'],kurse:['Kurse','Klassen verwalten'],mehr:['Mehr','Einstellungen & Sicherung']};
function setzeViewTitel(v){ const t=VIEW_TITEL[v]||['','']; $('view-titel').textContent=t[0]; $('view-sub').textContent=t[1]; }
document.getElementById('hauptnav').addEventListener('click',e=>{
  const b=e.target.closest('button[data-view]'); if(!b||b.dataset.view===aktView) return;
  aktView=b.dataset.view;
  document.querySelectorAll('#hauptnav button').forEach(x=>x.classList.toggle('aktiv',x===b));
  aktiverSchueler=null; stempelAus(); // Stempelmodus lebt nur in „Heute"
  setzeViewTitel(aktView);
  mitUebergang(()=>{
    ['heute','deck','schueler','kurse','mehr'].forEach(v=>$('view-'+v).classList.toggle('hidden',v!==aktView));
    renderAlles();
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
    t.updateCallbackDone&&t.updateCallbackDone.catch(()=>{});
    t.finished.catch(()=>{}).finally(()=>{ uebergangLaeuft=false; });
  } catch { uebergangLaeuft=false; fn(); }
}
function renderAlles(){
  if(!vault) return;
  if(aktView==='heute') renderHeute();
  else if(aktView==='deck') renderDeck();
  else if(aktView==='schueler') renderSchueler();
  else if(aktView==='kurse') renderKurse();
  else renderMehr();
}

/* ═══ HEUTE · Sitzplan 12×12 (Beamer-Regel: keine Werte sichtbar) ═══ */
let busy=false; // Härtungs-Regel 6: Eingabe-Lock
let editorAktiv=false; // Sitzplan-Editor-Modus (State-Flag statt Klassen-Sniffing)
let stempelTyp=null;               // P4.5: scharfer Serien-Stempel (+/o/-/fehlt_o) oder null
const stempelCooldown=new Set();   // ~80 ms je Kachel (Alex-Auflage): kein Doppel-Stempel beim Wischen
// Beamer „Namen abkürzen" (§6): „Elif Yilmaz" → „E. Y." bei Projektion (sensibel)
function beamerKurz(){ return beamerModus && localStorage.getItem('kladde_beamer_kurz')==='1'; }
function anzeigeVorname(s){ return beamerKurz()?(s.vorname?s.vorname[0]+'.':''):s.vorname; }
function anzeigeNachname(s){ return beamerKurz()?(s.name?s.name[0]+'.':''):s.name; }
function sichtbareSchueler(k){
  let liste=kursSchueler(k);
  if(aktiveTeilgruppe) liste=liste.filter(s=>(s.gruppe||'')===aktiveTeilgruppe);
  return liste;
}
function datumStreifen(){
  const el=$('datum-streifen'); if(!kurs()){ el.innerHTML=''; el.className=''; return; }
  const heute=heuteIso(), istHeute=terminDatum===heute;
  el.className='datum-streifen'+(istHeute?'':' nachtrag');
  const jetztText=(istHeute&&autowahlInfo)
    ?'Jetzt · '+datumLabel(terminDatum)+' · '+formatZeit(autowahlInfo.startSek)+'–'+formatZeit(autowahlInfo.endeSek)+(autowahlInfo.quelle==='kommend'?' (gleich)':'')
    :(istHeute?'Heute':'Nachtrag')+' · '+datumLabel(terminDatum);
  el.innerHTML='<span class="heute-tag">'+jetztText+'</span>'+
    (istHeute?'':'<span class="nachtrag-hinweis">Einträge gehen auf diesen Termin</span>')+
    '<span class="rechts">'+
    (istHeute?'':'<button data-heute>↩ Heute</button>')+
    '<button data-zufall title="Zufällig – bevorzugt wer noch selten dran war">🎲</button>'+
    '<button data-legende title="Symbol-Legende">?</button>'+
    '<button data-datum title="Anderer Termin (Nachtrag)">📅</button></span>';
  el.querySelector('[data-datum]').onclick=oeffneDatum;
  el.querySelector('[data-zufall]').onclick=zufallsSchueler;
  el.querySelector('[data-legende]').onclick=zeigeLegende;
  const bh=el.querySelector('[data-heute]'); if(bh) bh.onclick=()=>{ terminDatum=heute; mitUebergang(renderHeute); };
}
function zufallsSchueler(){
  const k=kurs(); if(!k) return;
  const alle=sichtbareSchueler(k); if(!alle.length) return;
  const info=new Map(alle.map(s=>[s.nr,standAmTermin(s.nr,terminDatum)]));
  const anwesend=alle.filter(s=>!info.get(s.nr).fehlt);      // Fehlende raus
  const pool=anwesend.length?anwesend:alle;
  // Gewicht ∝ 1/(1+heutige Einträge): wer noch selten dran war, kommt eher (getestet: logic/auswahl.mjs)
  const s=gewichteteWahl(pool,ss=>{ const st=info.get(ss.nr); return zufallsGewicht(st.plus+st.neutral+st.minus+(st.note!=null?1:0)); });
  if(!s) return;
  aktiverSchueler=s.nr;
  renderHeute();
  const kachel=$('plan').querySelector('.kachel[data-nr="'+s.nr+'"]');
  if(kachel) kachel.scrollIntoView({block:'center',behavior:'smooth'});
  toast('🎲 '+anzeigeVorname(s)+' '+anzeigeNachname(s));
}
function kachelHtml(s,st){
  let cls='kachel schueler';
  if(aktiverSchueler===s.nr) cls+=' gewaehlt';
  if(!beamerModus){
    if(st.fehlt) cls+=' netto-fehlt';
    else if(st.plus>st.minus) cls+=' netto-plus';
    else if(st.minus>st.plus) cls+=' netto-minus';
  }
  let marken='';
  if(st.plus&&!st.minus) marken+='<span class="mk p">＋'+(st.plus>1?st.plus:'')+'</span>';
  else if(st.minus&&!st.plus) marken+='<span class="mk m">−'+(st.minus>1?st.minus:'')+'</span>';
  else if(st.plus&&st.minus) marken+='<span class="mk p">'+st.plus+'</span><span class="mk m">'+st.minus+'</span>';
  else if(st.neutral) marken+='<span class="mk o">o</span>';
  if(st.note!=null) marken+='<span class="mk sym">📊</span>';
  if(st.mat) marken+='<span class="mk sym">📕</span>';
  if(st.ipad) marken+='<span class="mk sym">📱</span>';
  if(st.lernzeit) marken+='<span class="mk sym">📝</span>';
  if(st.notiz) marken+='<span class="mk sym">✎</span>';
  if(st.versp) marken+='<span class="mk sym">⏰</span>';
  if(st.verweigert) marken+='<span class="mk verw">⊘</span>';
  if(st.fehlt) marken+='<span class="mk '+(st.fehlt==='u'?'u':st.fehlt==='e'?'e':'abw')+'">'+(st.fehlt==='o'?'abw':st.fehlt)+'</span>';
  return '<div class="'+cls+'" data-nr="'+s.nr+'">'+
    '<div class="kopf"><span class="vn">'+esc(anzeigeVorname(s))+'</span>'+(s.lb?'<span class="lb-badge">LB</span>':'')+'</div>'+
    '<span class="nn">'+esc(anzeigeNachname(s))+'</span>'+
    '<div class="marken">'+marken+'</div></div>';
}
function renderHeute(){
  const k=kurs(); const plan=$('plan');
  plan.classList.toggle('editor',editorAktiv);
  if(!k){ datumStreifen(); renderRail(); $('heute-leer').classList.remove('hidden'); plan.innerHTML=''; return; }
  $('heute-leer').classList.add('hidden');
  const idx=tagesStandIndex(terminDatum);
  const sichtSchueler=sichtbareSchueler(k);
  datumStreifen(); renderRail();
  const grid=(vault.stamm.sitzplaene[k.id]||{}).grid||{};
  plan.classList.toggle('hidden',Object.keys(grid).length===0&&!editorAktiv);
  const sichtbar=new Set(sichtSchueler.map(s=>s.nr));
  let html='';
  for(let r=0;r<12;r++) for(let c=0;c<12;c++){
    const nr=grid[r+','+c];
    const s=nr?kursSchueler(k).find(x=>x.nr===nr):null;
    if(s&&sichtbar.has(s.nr)) html+=kachelHtml(s,idx.get(s.nr)||leererStand());
    else html+='<div class="kachel leer"></div>';
  }
  plan.innerHTML=html;
  const ohnePlatz=sichtSchueler.filter(s=>!Object.values(grid).includes(s.nr));
  if(ohnePlatz.length){
    let liste=$('ohne-platz'); if(!liste){ liste=document.createElement('div'); liste.id='ohne-platz'; liste.className='panel'; $('plan-wrap').after(liste); }
    liste.innerHTML='<h2>Ohne Sitzplatz</h2>'+ohnePlatz.map(s=>'<button class="btn still u-m3" data-nr="'+s.nr+'">'+esc(s.vorname)+' '+esc(s.name)+(s.lb?' · LB':'')+'</button>').join('');
    liste.querySelectorAll('[data-nr]').forEach(b=>b.onclick=()=>schuelerBlatt(Number(b.dataset.nr)));
  } else { const l=$('ohne-platz'); if(l) l.remove(); }
}
$('plan').addEventListener('pointerup',e=>{
  const kachel=e.target.closest('.kachel.schueler'); if(!kachel) return;
  if(editorAktiv||$('plan').classList.contains('editor')) return;
  const nr=Number(kachel.dataset.nr);
  if(stempelTyp){ stempleKachel(nr); return; }   // Stempel scharf: direkt setzen, kein Dialog
  if(busy) return;
  schuelerBlatt(nr);   // leere Hand = anschauen (Detail-Blatt · Master-Detail)
});
// P4.5 · Serien-Stempel: eine Kachel bekommt den scharfen Stempel. Pro Kachel ~80 ms Sperre,
// damit ein Wischen nicht doppelt zählt — aber verschiedene Kacheln bleiben frei (kein globaler Lock).
function stempleKachel(nr){
  if(stempelCooldown.has(nr)) return;
  stempelCooldown.add(nr); setTimeout(()=>stempelCooldown.delete(nr),80);
  const s=schuelerVonNr(nr);
  if(stempelTyp==='verweigert'){ verweigerungDialog(s); return; }  // 6 mit gekoppelter Kurznotiz
  if(stempelTyp==='versp'){ verspDialog(s); return; }              // Minuten-Abfrage je Schüler
  if(stempelTyp==='notiz'){ notizDialog(s); return; }              // Kurznotiz je Schüler
  if(stempelTyp==='entfernen'){ entferneLetzten(nr); pulseKachel(nr); return; } // schnelle Korrektur im Stempelfluss
  addEvent(stempelTyp,nr);        // +/o/−/∅/e/u/📱/📕 direkt · landet im Undo-Stapel (LIFO)
  renderHeute();                  // Zähler + Kachel-Symbole aktualisieren
  pulseKachel(nr);
}
// Letzten heutigen Eintrag eines Schülers entfernen (Storno) — für ↩-Stempel + Aktionsbar
function entferneLetzten(nr){
  const evs=wirksameEvents(vault.events).filter(e=>e.kursId===aktiverKursId&&e.schuelerNr===nr&&e.datum===terminDatum&&e.typ!=='storno'&&e.typ!=='quartalsnote');
  if(!evs.length){ toast('nichts zu entfernen'); return; }
  const letzte=evs.reduce((a,e)=>String(e.ts)>String(a.ts)?e:a);
  stornoVon(letzte); toast('entfernt: '+(TYP_LABEL[letzte.typ]||letzte.typ)); renderHeute();
}
// v1.1.0 · Verweigerung: anwesend, aber keine/verweigerte Leistung → zählt als 6 (Sek II 0 P),
// termingewichtet (logic/verdichtung). Kurznotiz gekoppelt — dokumentiert den Grund (bei einer 6 ratsam).
function verweigerungDialog(s){
  if(!s) return;
  const ta=el('textarea',{rows:'2',class:'u-textarea u-fs16',placeholder:'z. B. Mitarbeit verweigert, Aufgabe nicht bearbeitet'});
  dlgZeigenEl(
    el('h3',{},'⊘ Verweigerung · '+esc(s.vorname)),
    el('p',{class:'u-hinweis'},'Zählt für diese Stunde als 6 (Sek II: 0 P), termingewichtet. Kurznotiz zur Begründung:'),
    ta,
    el('div',{class:'btn-reihe'},
      el('button',{class:'btn',onclick:()=>{ addEvent('verweigert',s.nr,{notiz:ta.value.trim()}); dlgZu(); toast('Verweigerung notiert (zählt 6) · '+esc(s.vorname)); renderHeute(); pulseKachel(s.nr); }},'Eintragen (6)'),
      el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
  setTimeout(()=>ta.focus(),60);
}
/* ═══ PERMANENTE STEMPEL-RAIL (v2) · Werkzeug-in-die-Hand-Paradigma (Zero-Wunsch) ═══
   Stempel wählen → Kacheln antippen. Löst das alte „Schüler wählen → dann eintragen" ab. */
const RAIL_TITEL={'+':'Positiv','o':'Neutral','-':'Negativ','fehlt_o':'Abwesend (∅)','fehlt_e':'Entschuldigt gefehlt (e)','fehlt_u':'Unentschuldigt gefehlt (u)','versp':'Verspätung (Minuten)','ipad_fehlt':'iPad fehlt/leer','mat':'Material vergessen','notiz':'Notiz','verweigert':'Verweigerung (zählt 6)','entfernen':'Letzten Eintrag entfernen'};
function setStempel(typ){
  stempelTyp=(stempelTyp===typ)?null:typ; // gleichen Stempel nochmal antippen → aus
  document.body.classList.toggle('stempeln',stempelTyp!==null);
  document.body.classList.toggle('st-plus',stempelTyp==='+');
  document.body.classList.toggle('st-minus',stempelTyp==='-'||stempelTyp==='entfernen');
  renderRail();
}
function stempelAus(){ stempelTyp=null; document.body.classList.remove('stempeln','st-plus','st-minus'); } // Verlassen von „Heute"
function renderRail(){
  const rail=$('rail'); if(!rail) return;
  const mk=(typ,txt,cls)=>el('button',{class:'rail-btn'+(cls?' '+cls:'')+(stempelTyp===typ?' an':''),title:RAIL_TITEL[typ]||'',onclick:()=>setStempel(typ)},txt);
  const tr=()=>el('div',{class:'rail-trenner'});
  const stempelKarte=el('div',{class:'rail-karte'},
    el('div',{class:'rail-titel'},'Stempel'),
    el('div',{class:'rail-gruppe'}, mk('+','＋','plus'), mk('o','o'), mk('-','−','minus')),
    tr(),
    el('div',{class:'rail-gruppe'}, mk('fehlt_o','∅'), mk('fehlt_e','✓'), mk('fehlt_u','✗'), mk('versp','⏰')),
    tr(),
    el('div',{class:'rail-gruppe'}, mk('ipad_fehlt','📱'), mk('mat','📕')),
    tr(),
    el('div',{class:'rail-gruppe'}, mk('notiz','✎'), mk('verweigert','⊘','verw')),
    tr(),
    mk('entfernen','⌫','breit'));
  const k=kurs(); let erfasst=0,total=0;
  if(k){ const idx=tagesStandIndex(terminDatum); const sicht=sichtbareSchueler(k); total=sicht.length;
    erfasst=sicht.filter(s=>{const st=idx.get(s.nr);return st&&(st.plus+st.neutral+st.minus)>0;}).length; }
  const fill=el('div',{}); fill.style.width=(total?Math.round(erfasst/total*100):0)+'%';
  const erfasstKarte=el('div',{class:'rail-karte'},
    el('div',{class:'rail-titel'},'Erfasst'),
    el('div',{class:'rail-erfasst-zahl'}, String(erfasst), el('small',{},' / '+total)),
    el('div',{class:'rail-bar'}, fill));
  rail.replaceChildren(stempelKarte, erfasstKarte);
}
function pulseKachel(nr){
  const k=$('plan').querySelector('.kachel[data-nr="'+nr+'"]'); if(!k) return;
  k.classList.remove('puls'); void k.offsetWidth; k.classList.add('puls'); // Reflow-Re-Trigger (Werft flash_animation)
}
// Per-Schüler-Dialoge — aus dem Stempelfluss (⏰/✎) ODER dem „…"-Menü des Detail-Blatts erreichbar.
function verspDialog(s){ if(!s) return;
  dlgZeigen('<h3>Verspätung · '+esc(s.vorname)+'</h3><input type="number" id="min-in" inputmode="numeric" placeholder="Minuten" min="1" max="67"><div class="btn-reihe"><button class="btn" data-ok>Eintragen</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
    d=>{ d.querySelector('[data-ok]').onclick=()=>{ const m=Number(d.querySelector('#min-in').value)||0; if(m>0){ addEvent('versp',s.nr,{minuten:m}); toast(esc(s.vorname)+': '+m+' min zu spät'); renderHeute(); } dlgZu(); }; setTimeout(()=>d.querySelector('#min-in').focus(),60); });
}
function notizDialog(s){ if(!s) return;
  dlgZeigen('<h3>Notiz · '+esc(s.vorname)+'</h3><textarea id="notiz-in" rows="3" class="u-textarea u-fs16"></textarea><div class="btn-reihe"><button class="btn" data-ok>Speichern</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
    d=>{ d.querySelector('[data-ok]').onclick=()=>{ const txt=d.querySelector('#notiz-in').value.trim(); if(txt){ addEvent('notiz',s.nr,{notiz:txt}); toast('Notiz gespeichert · '+esc(s.vorname)); renderHeute(); } dlgZu(); }; setTimeout(()=>d.querySelector('#notiz-in').focus(),60); });
}
function noteDialog(s){ if(!s) return;
  const k=kurs(); const sek2=bewertProfil(k)==='sek2';
  const optionen=sek2?Array.from({length:16},(_,i)=>String(15-i)):Object.keys(DRITTELNOTEN);
  dlgZeigen('<h3>Direkte Note · '+esc(s.vorname)+'</h3><select id="note-in">'+optionen.map(o=>'<option>'+o+'</option>').join('')+'</select><div class="btn-reihe"><button class="btn" data-ok>Eintragen</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
    d=>{ d.querySelector('[data-ok]').onclick=()=>{ addEvent('note',s.nr,{wert:d.querySelector('#note-in').value}); toast('Note eingetragen · '+esc(s.vorname)); renderHeute(); dlgZu(); }; });
}
function zeigeMehrAktionen(s){
  dlgZeigen('<h3>'+esc(s.vorname)+' '+esc(s.name)+'</h3>'+
    '<p class="u-hinweis">Fehlt jetzt: „abwesend" — e/u klärst du später in der Wiedervorlage.</p>'+
    '<div class="btn-reihe">'+
    '<button class="btn still" data-t="fehlt_o">abwesend</button>'+
    '<button class="btn still" data-t="verweigert">⊘ verweigert (6)…</button>'+
    '<button class="btn still" data-t="versp">zu spät…</button>'+
    '<button class="btn still" data-t="note">Note…</button>'+
    '<button class="btn still" data-t="notiz">Notiz…</button></div>'+
    '<div class="btn-reihe"><button class="btn still" data-t="fehlt_e">direkt entschuldigt</button>'+
    '<button class="btn still" data-t="fehlt_u">direkt unentsch.</button></div>'+
    '<div class="btn-reihe"><button class="btn still" data-schliessen>Schließen</button></div>',
    el=>{
      el.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{
        const t=b.dataset.t; dlgZu();
        if(t==='versp') verspDialog(s);
        else if(t==='note') noteDialog(s);
        else if(t==='notiz') notizDialog(s);
        else if(t==='verweigert') verweigerungDialog(s);
        else { addEvent(t,s.nr); renderHeute(); }
      });
    });
}

// Detail-Blatt vom Sitzplan aus (Master-Detail · „Schüler genauer betrachten" ohne Heute zu verlassen)
function schuelerBlatt(nr){
  const k=kurs(); const s=schuelerVonNr(nr); if(!k||!s) return;
  const v=verdichte(vault.events.filter(e=>e.kursId===k.id),nr,{profil:bewertProfil(k),lb:s.lb});
  dlgZeigen('<h3>'+esc(s.vorname)+' '+esc(s.name)+(s.lb?' · LB':'')+'</h3>'+schuelerDetailHtml(s,k,v)+
    '<div class="btn-reihe"><button class="btn still" data-akt>＋ Eintrag hinzufügen …</button><button class="btn still" data-schliessen>Schließen</button></div>',
    el=>{
      el.querySelector('[data-akt]').onclick=()=>{ dlgZu(); zeigeMehrAktionen(s); };
      el.querySelectorAll('.ev-storno').forEach(b=>b.onclick=ev=>{ ev.stopPropagation(); const e=vault.events.find(x=>x.id===b.dataset.storno); if(e){ stornoVon(e); toast('storniert'); dlgZu(); renderHeute(); schuelerBlatt(nr); } });
      el.querySelectorAll('[data-quartal]').forEach(b=>b.onclick=ev=>{ ev.stopPropagation(); dlgZu(); setzeQuartalsnote(s,v.vorschlag); });
    });
}
function zeigeLegende(){
  const chip=(cls,t)=>'<span class="chip '+cls+'">'+t+'</span>';
  dlgZeigen('<h3>Legende</h3><div class="legende">'+
    '<div>'+chip('chip-gut','＋')+' überwiegend Plus (Kachel grün)</div>'+
    '<div>'+chip('chip-fehl','−')+' überwiegend Minus (Kachel rot)</div>'+
    '<div>'+chip('chip-kante','o')+' nur neutrale Meldungen</div>'+
    '<div>📊 direkte Note · 📕 Material vergessen · 📱 iPad fehlt/leer</div>'+
    '<div>📝 Lernzeit · ✎ Notiz · ⏰ Verspätung (Minuten)</div>'+
    '<div><b>e</b> entschuldigt gefehlt · <b class="u-fehl">u</b> unentschuldigt (Wiedervorlage)</div>'+
    '<div>'+chip('chip-info','LB')+' zieldifferent — kein Notenvorschlag</div>'+
    '<div class="u-leise u-mt4">👁 Beamer-Modus (oben) versteckt alle Bewertungen für die Projektion.</div>'+
    '</div><div class="btn-reihe"><button class="btn still" data-schliessen>Schließen</button></div>');
}

/* ═══ DECK · Stundenende-Ritual (Swipe: ←− →+ ↑Notiz ↓weiter) ═══ */
let deckListe=[], deckIdx=0, deckNurOhne=false;
function baueDeckListe(){
  const k=kurs(); if(!k) return [];
  // Abwesende (fehlt_o/e/u) nie im Deck — kein Bewerten von Fehlenden
  const abw=new Set(wirksameEvents(vault.events).filter(e=>e.kursId===k.id&&e.datum===terminDatum&&(e.typ==='fehlt_o'||e.typ==='fehlt_e'||e.typ==='fehlt_u')).map(e=>e.schuelerNr));
  let liste=sichtbareSchueler(k).filter(s=>!abw.has(s.nr));
  if(deckNurOhne){ const idx=tagesStandIndex(terminDatum); liste=liste.filter(s=>{const st=idx.get(s.nr);return !st||(st.plus+st.neutral+st.minus)===0;}); }
  return liste;
}
function mischeArray(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function neuesDeck(mischen){
  const k=kurs(); let liste=baueDeckListe(); if(mischen) liste=mischeArray(liste);
  liste._kurs=k?k.id:null; liste._datum=terminDatum; liste._nurOhne=deckNurOhne;
  deckListe=liste; deckIdx=0;
}
function renderDeckOptionen(){
  const box=$('deck-optionen'); if(!kurs()){ box.replaceChildren(); return; }
  box.replaceChildren(
    el('button',{class:(deckNurOhne?'an':''),onclick:()=>{ deckNurOhne=!deckNurOhne; neuesDeck(false); mitUebergang(renderDeck); }}, deckNurOhne?'✓ nur ohne Eintrag':'nur ohne Eintrag'),
    el('button',{onclick:()=>{ neuesDeck(true); zeigeDeckKarte(); toast('gemischt'); }},'🔀 mischen'));
}
function renderDeck(){
  const k=kurs();
  renderDeckOptionen();
  if(!k){ $('deck-karte').innerHTML='<span class="sub">Kein Kurs gewählt.</span>'; $('deck-fortschritt').textContent=''; return; }
  if(!deckListe.length||deckListe._kurs!==k.id||deckListe._datum!==terminDatum||deckListe._nurOhne!==deckNurOhne) neuesDeck(false);
  zeigeDeckKarte();
}
function zeigeDeckKarte(){
  const karte=$('deck-karte');
  const total=deckListe.length;
  const erfasst=deckListe.filter(s=>{const st=standAmTermin(s.nr,terminDatum);return st.plus+st.neutral+st.minus>0;}).length;
  const balken='<div class="deck-bar"><div data-w="'+(total?100*erfasst/total:0)+'"></div></div>';
  const setzeBalken=()=>{ const d=$('deck-fortschritt').querySelector('[data-w]'); if(d) d.style.width=d.dataset.w+'%'; }; // CSSOM (CSP)
  if(deckIdx>=total){
    // End-Karte: „Fehlende durchgehen" — noch nicht erfasste Anwesende in ein Nur-Ohne-Deck (P4.4)
    const idx=tagesStandIndex(terminDatum);
    const fehlend=deckListe.filter(s=>{const st=idx.get(s.nr);return !st||(st.plus+st.neutral+st.minus)===0;}).length;
    karte.innerHTML='<span class="gross">✓</span><span class="sub">'+total+' Karten durch · '+erfasst+' erfasst.</span>'+
      (fehlend&&!deckNurOhne?'<div class="btn-reihe u-center"><button class="btn" data-fehlende>Fehlende durchgehen ('+fehlend+')</button></div>':'');
    $('deck-fortschritt').innerHTML='fertig · <b>'+erfasst+'</b> / '+total+' erfasst'+balken;
    setzeBalken();
    const bf=karte.querySelector('[data-fehlende]'); if(bf) bf.onclick=()=>{ deckNurOhne=true; neuesDeck(false); mitUebergang(renderDeck); };
    return;
  }
  const s=deckListe[deckIdx];
  $('deck-fortschritt').innerHTML='Karte '+(deckIdx+1)+' / '+total+' · <b>'+erfasst+'</b> erfasst'+balken;
  setzeBalken();
  karte.innerHTML='<span class="gross">'+esc(anzeigeVorname(s))+'</span><span class="sub">'+esc(anzeigeNachname(s))+(s.lb&&!beamerModus?' · LB':'')+'</span>';
}
function deckAktion(aktion){
  if(busy||deckIdx>=deckListe.length) return;
  const s=deckListe[deckIdx];
  if(aktion==='notiz'){ zeigeMehrAktionen(s); return; }
  busy=true;
  if(aktion==='+'||aktion==='o'||aktion==='-') addEvent(aktion,s.nr);
  const karte=$('deck-karte');
  const reduziert=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const weiter=()=>{
    karte.classList.remove('weg-plus','weg-minus','weg-weiter');
    deckIdx++; zeigeDeckKarte();
    if(!reduziert){ karte.classList.remove('rein'); void karte.offsetWidth; karte.classList.add('rein'); }
    busy=false;
  };
  if(reduziert){ weiter(); return; }
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
  karte.addEventListener('pointerdown',e=>{ start=[e.clientX,e.clientY]; try{karte.setPointerCapture(e.pointerId);}catch{} });
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
// PC-Pfeiltasten fürs Deck (P4.4): ← − · → + · ↑ Notiz · ↓ weiter — nur in der Deck-Ansicht, nie über Dialog
document.addEventListener('keydown',e=>{
  if(aktView!=='deck'||!vault||$('dlg').open) return;
  const a={ArrowLeft:'-',ArrowRight:'+',ArrowUp:'notiz',ArrowDown:'skip'}[e.key];
  if(!a) return;
  e.preventDefault(); deckAktion(a);
});

/* ═══ SCHÜLER · Verdichtung + Inline-Detail-Akkordeon (kein Popup) ═══ */
let offenerSchueler=null, zeitraumFilter=null;
function aktivesSchuljahr(){ return (vault.stamm.schuljahre||[]).find(j=>j.id===vault.stamm.aktivesSchuljahrId)||null; }
function renderSchueler(){
  const k=kurs(); const wrap=$('view-schueler');
  if(!k){ wrap.innerHTML='<p class="u-leise">Kein Kurs gewählt.</p>'; return; }
  // Beamer/Projektion: sensible Auswertung KOMPLETT sperren (§3.4)
  if(beamerModus){ wrap.innerHTML='<div class="panel"><h2>👁 Projektionsmodus</h2><p class="u-leise">Die Schüler-Auswertung ist bei aktiver Projektion ausgeblendet. Auge oben antippen zum Beenden.</p></div>'; return; }
  const kursEvents=vault.events.filter(e=>e.kursId===k.id);
  const sj=aktivesSchuljahr();
  const zr=zeitraumFilter;
  const vOpt={profil:bewertProfil(k),von:zr?zr.von:'',bis:zr?zr.bis:'9999-12-31'};
  const kurzL=l=>l.replace('. Quartal','. Q').replace('. Halbjahr','. HJ');
  const heute=heuteIso();
  const offeneO=wirksameEvents(kursEvents).filter(e=>e.typ==='fehlt_o').sort((a,b)=>String(a.datum).localeCompare(String(b.datum)));
  let html='';
  // Zeitraum-Wähler (Quartalsansicht) — ein Tap statt Datumsgrenzen tippen
  if(sj&&sj.zeitraeume&&sj.zeitraeume.length){
    html+='<div class="zr-leiste"><button class="zr-chip'+(!zr?' an':'')+'" data-zr="">Gesamt</button>'+
      sj.zeitraeume.map(z=>'<button class="zr-chip'+(zr&&zr.id===z.id?' an':'')+'" data-zr="'+z.id+'">'+esc(kurzL(z.label))+'</button>').join('')+'</div>';
  }
  // Klärungsliste (P3.5 Phase 2): offene Abwesenheiten e/u/Irrtum klären. >7 Tage hervorgehoben.
  if(offeneO.length){
    html+='<div class="panel"><h2>Offene Fehlzeiten ('+offeneO.length+')</h2>'+
      offeneO.map(e=>{ const s=kursSchueler(k).find(x=>x.nr===e.schuelerNr);
        const alt=(new Date(heute)-new Date(e.datum))/86400000>7;
        return '<div class="klaer-zeile'+(alt?' alt':'')+'"><span>'+esc(s?s.vorname+' '+s.name:'Nr '+e.schuelerNr)+' · '+datumLabel(e.datum)+(alt?' ⏳':'')+'</span>'+
          '<span class="klaer-btns"><button class="btn still u-btn-klein" data-klaer="e" data-o="'+e.id+'">E</button>'+
          '<button class="btn still u-btn-klein" data-klaer="u" data-o="'+e.id+'">U</button>'+
          '<button class="btn still u-btn-klein" data-klaer="irrtum" data-o="'+e.id+'">Irrtum</button></span></div>'; }).join('')+'</div>';
  }
  html+='<div class="panel"><h2>'+esc(k.name)+' · '+esc(zr?zr.label:'Verdichtung')+'</h2><p class="u-regelzeile">'+esc(regelText(bewertProfil(k)))+'</p>'+
    '<div class="btn-reihe"><button class="btn still u-btn-klein" data-kopiere title="Nr + Vorschlag in die Zwischenablage — in die Excel-Klassenmappe einfügen">⧉ Vorschläge kopieren</button></div>';
  for(const s of kursSchueler(k)){
    const v=verdichte(kursEvents,s.nr,{...vOpt,lb:s.lb});
    const sum=Math.max(1,v.nPlus+v.nNull+v.nMinus);
    const offen=offenerSchueler===s.nr;
    const fInfo=(v.nFehltE||v.nFehltU||v.nFehltO||v.nVerweigert)?' · F '+v.nFehltE+'e/'+v.nFehltU+'u'+(v.nFehltO?'/'+v.nFehltO+'o':'')+(v.nVerweigert?' ⊘'+v.nVerweigert:''):'';
    html+='<div class="s-block'+(offen?' offen':'')+'"><div class="s-item" data-nr="'+s.nr+'">'+
      '<div class="u-minw104"><b>'+esc(s.vorname)+'</b> <small class="u-leise">'+esc(s.name)+'</small>'+(s.lb?' <span class="lb-badge">LB</span>':'')+'</div>'+
      '<div class="u-flex1"><div class="balken"><div class="bal-p" data-w="'+(100*v.nPlus/sum)+'"></div><div class="bal-o" data-w="'+(100*v.nNull/sum)+'"></div><div class="bal-m" data-w="'+(100*v.nMinus/sum)+'"></div></div>'+
      '<small class="u-leise">'+v.nPlus+'⁺ '+v.nNull+'° '+v.nMinus+'⁻ · '+Math.round(100*v.aktivQuote)+'% · '+v.pfeil+fInfo+'</small></div>'+
      '<div class="u-wert-rechts">'+(v.vorschlag?esc(v.vorschlag.label):'—')+'</div>'+
      '<span class="pfeil">'+(offen?'▾':'›')+'</span></div>'+
      (offen?schuelerDetailHtml(s,k,v):'')+'</div>';
  }
  html+='</div>';
  wrap.innerHTML=html;
  // dynamische Balken-Breiten via CSSOM (CSP: Inline-Style-Attribute in HTML-Strings sind verboten)
  wrap.querySelectorAll('.balken [data-w]').forEach(d=>{ d.style.width=d.dataset.w+'%'; });
  wrap.querySelectorAll('[data-zr]').forEach(b=>b.onclick=()=>{ const id=b.dataset.zr; zeitraumFilter=id&&sj?sj.zeitraeume.find(z=>z.id===id):null; offenerSchueler=null; mitUebergang(renderSchueler); });
  wrap.querySelectorAll('[data-klaer]').forEach(b=>b.onclick=ev=>{ ev.stopPropagation();
    const o=vault.events.find(x=>x.id===b.dataset.o); if(!o) return;
    const art=b.dataset.klaer;
    // Klärung = Storno des fehlt_o + neues fehlt_e/fehlt_u am ORIGINALDATUM (Merge-fest, verdichte löst jüngste-ts)
    if(art==='irrtum'){ stornoVon(o); toast('Irrtum — Abwesenheit entfernt'); }
    else { addEvent(art==='e'?'fehlt_e':'fehlt_u',o.schuelerNr,{datum:o.datum,stornoVon:o.id}); toast('Geklärt: '+(art==='e'?'entschuldigt':'unentschuldigt')+' ('+datumLabel(o.datum)+')'); }
    renderSchueler();
  });
  wrap.querySelectorAll('.s-item').forEach(el=>el.onclick=()=>{ const nr=Number(el.dataset.nr); offenerSchueler=(offenerSchueler===nr?null:nr); mitUebergang(renderSchueler); });
  const bkv=wrap.querySelector('[data-kopiere]'); if(bkv) bkv.onclick=kopiereVorschlaege;
  verdrahteDetail(wrap);
}
// P4.5 · „Vorschläge kopieren": Nr⇥Vorschlag[⇥F-Summen] in die Zwischenablage (kein Datei-Export).
// Der Mensch fügt in die Excel-Klassenmappe ein — Excel bleibt die Noten-Zentrale (User-Entscheid „Beides").
async function kopiereVorschlaege(){
  const k=kurs(); if(!k) return;
  const zr=zeitraumFilter;
  const kursEvents=vault.events.filter(e=>e.kursId===k.id);
  const rows=kursSchueler(k).map(s=>{
    const v=verdichte(kursEvents,s.nr,{profil:bewertProfil(k),lb:s.lb,von:zr?zr.von:'',bis:zr?zr.bis:'9999-12-31'});
    const f=(v.nFehltE||v.nFehltU||v.nVerweigert)?(v.nFehltE+'e/'+v.nFehltU+'u'+(v.nVerweigert?'/'+v.nVerweigert+'verw':'')):'';
    return {nr:s.nr,vorschlag:v.vorschlag?v.vorschlag.label:'',fSummen:f};
  });
  const text=vorschlagsZeilen(rows);
  try{
    await navigator.clipboard.writeText(text);
    toast('Vorschläge kopiert ('+rows.length+' Zeilen) — in Excel einfügen');
  }catch{
    // Fallback ohne Clipboard-Zugriff: Text zum manuellen Kopieren anzeigen
    const ta=el('textarea',{class:'u-textarea u-fs14',rows:'10',readonly:'readonly'}); ta.value=text;
    dlgZeigenEl(el('h3',{},'Vorschläge kopieren'),
      el('p',{class:'u-hinweis'},'Markieren und kopieren (Strg/⌘ + C), dann in Excel einfügen.'),
      ta,
      el('div',{class:'btn-reihe'},el('button',{class:'btn',onclick:dlgZu},'Schließen')));
    setTimeout(()=>{ ta.focus(); ta.select(); },60);
  }
}
function schuelerDetailHtml(s,k,v){
  const evs=wirksameEvents(vault.events.filter(e=>e.kursId===k.id&&e.schuelerNr===s.nr)).filter(e=>e.typ!=='storno'); // Storno-Buchungen nicht im Verlauf zeigen
  const verspSum=evs.filter(e=>e.typ==='versp').reduce((a,e)=>a+(e.minuten||0),0);
  const fehltU=evs.filter(e=>e.typ==='fehlt_u').length, fehltE=evs.filter(e=>e.typ==='fehlt_e').length;
  const proTag={};
  for(const e of evs) (proTag[e.datum]=proTag[e.datum]||[]).push(e);
  const tage=Object.keys(proTag).sort().reverse();
  let liste='';
  for(const t of tage){
    liste+='<div class="tag-gruppe"><div class="tag-kopf">'+datumLabel(t)+'</div>'+
      proTag[t].sort((a,b)=>String(a.ts).localeCompare(String(b.ts))).map(e=>
        '<div class="ev-zeile"><span>'+esc(TYP_LABEL[e.typ]||e.typ)+(e.minuten?' '+e.minuten+' min':'')+(e.wert?' '+esc(String(e.wert)):'')+(e.notiz?' · '+esc(e.notiz):'')+'</span>'+
        '<button class="btn still ev-storno u-btn-klein" data-storno="'+e.id+'">↶</button></div>').join('')+'</div>';
  }
  if(!tage.length) liste='<p class="u-hinweis">Noch keine Einträge.</p>';
  return '<div class="s-detail">'+
    '<div class="zeile"><span>Beteiligung</span><span class="wert">'+v.beteiligtTermine+' / '+v.kursTermine+' Termine · Verlauf '+v.pfeil+'</span></div>'+
    (fehltE||fehltU||verspSum?'<div class="zeile"><span>Fehl / Verspätung</span><span class="wert">'+(fehltE?fehltE+'× e ':'')+(fehltU?fehltU+'× u ':'')+(verspSum?'· '+verspSum+' min':'')+'</span></div>':'')+
    '<div class="zeile"><span>Vorschlag</span><span class="wert">'+(v.vorschlag?esc(v.vorschlag.label):(s.lb?'— (LB)':'—'))+'</span></div>'+
    (v.vorschlag&&!s.lb?'<div class="btn-reihe"><button class="btn" data-quartal="'+s.nr+'">Als Quartalsnote setzen…</button></div>':'')+
    '<div class="tag-kopf u-kopf-leise">Verlauf ('+evs.length+')</div>'+liste+'</div>';
}
function verdrahteDetail(wrap){
  wrap.querySelectorAll('.ev-storno').forEach(b=>b.onclick=e=>{ e.stopPropagation(); const ev=vault.events.find(x=>x.id===b.dataset.storno); if(ev){ stornoVon(ev); toast('storniert'); renderSchueler(); } });
  wrap.querySelectorAll('[data-quartal]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); const s=schuelerVonNr(Number(b.dataset.quartal)); const kk=kurs(); const zr=zeitraumFilter; const v=verdichte(vault.events.filter(x=>x.kursId===kk.id),s.nr,{profil:bewertProfil(kk),lb:s.lb,von:zr?zr.von:'',bis:zr?zr.bis:'9999-12-31'}); setzeQuartalsnote(s,v.vorschlag,zr); });
}
// quartalsnote-Event trägt Zeitraum-Kontext — bleibt IMMER 'quartalsnote', NIE 'note'
// (verbotener Pfad 2: eine Übernahme darf nie in verdichte() zurückfließen).
function setzeQuartalsnote(s,vorschlag,zeitraum){
  const k=kurs(); const sek2=bewertProfil(k)==='sek2';
  const optionen=sek2?Array.from({length:16},(_,i)=>String(15-i)):Object.keys(DRITTELNOTEN);
  const vorwahl=sek2?String(vorschlag.wert):(wertZuLabel(vorschlag.wert)||'3');
  const zrHinweis=zeitraum?' <small class="u-leise">('+esc(zeitraum.label)+')</small>':'';
  dlgZeigen('<h3>Quartalsnote · '+esc(s.vorname)+zrHinweis+'</h3><p class="u-hinweis">Vorschlag: '+esc(vorschlag.label)+' — du entscheidest.</p>'+
    '<div class="zeile"><span>HJ</span><select id="q-hj"><option value="1">1. HJ</option><option value="2">2. HJ</option></select></div>'+
    '<div class="zeile"><span>Quartal</span><select id="q-q"><option value="1">Q1</option><option value="2">Q2</option></select></div>'+
    '<div class="zeile"><span>Note</span><select id="q-note">'+optionen.map(o=>'<option'+(o===vorwahl?' selected':'')+'>'+o+'</option>').join('')+'</select></div>'+
    '<div class="btn-reihe"><button class="btn" data-ok>Setzen</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
    el=>{
      // Zeitraum → HJ/Quartal vorbelegen (Excel-Slot-Mapping), bleibt editierbar
      if(zeitraum){ const q=zeitraum.id; const hj=/q[34]|hj2/.test(q)?'2':'1'; el.querySelector('#q-hj').value=hj; if(/q1|q3/.test(q)) el.querySelector('#q-q').value='1'; else if(/q2|q4/.test(q)) el.querySelector('#q-q').value='2'; }
      el.querySelector('[data-ok]').onclick=()=>{
        addEvent('quartalsnote',s.nr,{hj:Number(el.querySelector('#q-hj').value),quartal:Number(el.querySelector('#q-q').value),wert:el.querySelector('#q-note').value,zeitraumId:zeitraum?zeitraum.id:null});
        toast('Quartalsnote gesetzt: '+el.querySelector('#q-note').value); dlgZu(); if(aktView==='schueler') renderSchueler();
      };
    });
}

/* ═══ KURSE · Import / Profil / Slots / Sitzplan-Editor ═══ */
/* Kurs direkt in der App anlegen: Excel-Spalten kopieren → einfügen (Tab/Semikolon-tolerant) */
function slugId(text){ return String(text).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'kurs'; }
function kursAnlegenDialog(){
  dlgZeigen('<h3>Kurs anlegen</h3>'+
    '<div class="zeile"><span>Klasse/Kurs</span><span><input type="text" id="kn-name" placeholder="z. B. 7b" class="u-w130"></span></div>'+
    '<div class="zeile"><span>Fach</span><span><input type="text" id="kn-fach" placeholder="z. B. Mathematik" class="u-w160"></span></div>'+
    '<div class="zeile"><span>Schuljahr</span><span><input type="text" id="kn-jahr" placeholder="2026/27" class="u-w110"></span></div>'+
    '<div class="zeile"><span>Stufe</span><span><select id="kn-profil"><option value="sek1">Sek I (Drittelnoten)</option><option value="sek2">Oberstufe (Punkte)</option></select></span></div>'+
    '<p class="u-hinweis u-mt10">Schülerliste — aus Excel kopieren (Nr · Name · Vorname · ggf. LB) und hier einfügen, oder tippen (eine Zeile pro Kind, „Name; Vorname"):</p>'+
    '<textarea id="kn-liste" rows="8" class="u-textarea u-fs16" placeholder="1\tMustermann\tMax\n2\tBeispiel\tBerna\tLB"></textarea>'+
    '<div id="kn-vorschau" class="u-vorschau">Noch keine Zeilen.</div>'+
    '<div class="btn-reihe"><button class="btn" id="kn-ok" disabled>Kurs anlegen</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
    el=>{
      const liste=el.querySelector('#kn-liste'), vorschau=el.querySelector('#kn-vorschau'), ok=el.querySelector('#kn-ok');
      let geparst={schueler:[],warnungen:[]};
      liste.addEventListener('input',()=>{
        geparst=parseSchuelerListe(liste.value);
        const lbAnz=geparst.schueler.filter(s=>s.lb).length;
        vorschau.innerHTML=geparst.schueler.length
          ? '<b class="u-gut">'+geparst.schueler.length+' Schüler erkannt</b>'+(lbAnz?' · '+lbAnz+'× LB':'')+
            ' — '+esc(geparst.schueler.slice(0,3).map(s=>s.nr+' '+s.vorname+' '+s.name).join(' · '))+(geparst.schueler.length>3?' …':'')+
            (geparst.warnungen.length?'<br>⚠ '+esc(geparst.warnungen[0])+(geparst.warnungen.length>1?' (+'+(geparst.warnungen.length-1)+')':''):'')
          : 'Noch keine Zeilen erkannt.';
        ok.disabled=!geparst.schueler.length;
      });
      ok.onclick=()=>{
        const name=el.querySelector('#kn-name').value.trim()||'Kurs';
        const fach=el.querySelector('#kn-fach').value.trim()||'';
        const jahr=el.querySelector('#kn-jahr').value.trim()||'';
        const profil=el.querySelector('#kn-profil').value;
        const k={id:slugId(name+'-'+fach+'-'+jahr),name,fach,schuljahr:jahr,lehrkraft:'',profil,slot:'m1'};
        const idx=vault.stamm.kurse.findIndex(x=>x.id===k.id);
        if(idx>=0) vault.stamm.kurse[idx]=k; else vault.stamm.kurse.push(k);
        vault.stamm.schueler[k.id]=geparst.schueler;
        stammMutiert(); speichern();
        aktiverKursId=k.id; aktualisiereKursChip();
        dlgZu();
        toast('Angelegt: '+name+' ('+geparst.schueler.length+' Schüler)'+(geparst.warnungen.length?' · '+geparst.warnungen.length+' Hinweis(e)':''));
        renderKurse();
      };
    });
}

// P4.1 · Kurs-Wizard (§15, 4 Schritte) — geführte Alternative; der Schnellpfad kursAnlegenDialog bleibt.
function alphaGrid(schueler){
  const sortiert=schueler.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'de'));
  const grid={}, cols=6;
  sortiert.forEach((s,i)=>{ grid[Math.floor(i/cols)+','+(i%cols)]=s.nr; });
  return grid;
}
function kursWizard(){
  const w={name:'',fach:'',jahr:(aktivesSchuljahr()?.label)||'',profil:'sek1',notenmodus:'punkte',rohListe:'',geparst:{schueler:[],warnungen:[]}};
  let schritt=1;
  const kopf=t=>el('div',{class:'sp-kopf'},el('h3',{},t),el('div',{class:'sp-steps'},...[1,2,3,4].map(n=>el('span',{class:'sp-step'+(n===schritt?' an':'')},String(n)))));

  function s1(){ // Kursdaten
    const nameI=el('input',{type:'text',value:w.name,placeholder:'z. B. 7b',class:'u-w130',oninput:e=>w.name=e.target.value});
    const fachI=el('input',{type:'text',value:w.fach,placeholder:'z. B. Mathematik',class:'u-w160',oninput:e=>w.fach=e.target.value});
    const jahrI=el('input',{type:'text',value:w.jahr,placeholder:'2026/27',class:'u-w110',oninput:e=>w.jahr=e.target.value});
    const notenBox=el('div',{});
    const renderNoten=()=>{ notenBox.replaceChildren();
      if(w.profil==='sek2'){ const ns=el('select',{onchange:e=>w.notenmodus=e.target.value},
        el('option',{value:'punkte',...(w.notenmodus==='punkte'?{selected:'selected'}:{})},'Punkte 0–15'),
        el('option',{value:'drittel',...(w.notenmodus==='drittel'?{selected:'selected'}:{})},'Drittelnoten'));
        notenBox.append(el('div',{class:'zeile'},el('span',{},'Noten-Eingabe'),el('span',{},ns))); } };
    const profilSel=el('select',{onchange:e=>{ w.profil=e.target.value; renderNoten(); }},
      el('option',{value:'sek1',...(w.profil==='sek1'?{selected:'selected'}:{})},'Sek I (Drittelnoten)'),
      el('option',{value:'sek2',...(w.profil==='sek2'?{selected:'selected'}:{})},'Oberstufe (Punkte)'));
    renderNoten();
    dlgZeigenEl(kopf('Kursdaten'),
      el('div',{class:'zeile'},el('span',{},'Klasse/Kurs'),el('span',{},nameI)),
      el('div',{class:'zeile'},el('span',{},'Fach'),el('span',{},fachI)),
      el('div',{class:'zeile'},el('span',{},'Schuljahr'),el('span',{},jahrI)),
      el('div',{class:'zeile'},el('span',{},'Stufe'),el('span',{},profilSel)),
      notenBox,
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn',onclick:()=>{ schritt=2; s2(); }},'Weiter: Schülerliste'),
        el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
  }
  function s2(){ // Schülerliste
    const ta=el('textarea',{rows:'8',class:'u-textarea u-fs16',placeholder:'1\tMustermann\tMax\n2\tBeispiel\tBerna\tLB'}); ta.value=w.rohListe;
    const info=el('div',{class:'u-vorschau'});
    const aktualisiere=()=>{ w.rohListe=ta.value; w.geparst=parseSchuelerListe(ta.value);
      info.replaceChildren(w.geparst.schueler.length?el('b',{class:'u-gut'},w.geparst.schueler.length+' Schüler erkannt'):'Noch keine Zeilen erkannt.'); };
    ta.addEventListener('input',aktualisiere); aktualisiere();
    dlgZeigenEl(kopf('Schülerliste'),
      el('p',{class:'u-hinweis'},'Aus Excel kopieren: Nr · Name · Vorname · ggf. LB — oder tippen (eine Zeile je Kind).'),
      ta, info,
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn still',onclick:()=>{ schritt=1; s1(); }},'← Zurück'),
        el('button',{class:'btn',onclick:()=>{ schritt=3; s3(); }},'Weiter: Vorschau')));
  }
  function s3(){ // Vorschau + Warnungen (vollständig, §15)
    const g=w.geparst, lbAnz=g.schueler.filter(s=>s.lb).length;
    const zeilen=g.schueler.slice(0,40).map(s=>el('div',{class:'zeile'},el('span',{},s.nr+' '+s.vorname+' '+s.name+(s.lb?' · LB':''))));
    dlgZeigenEl(kopf('Vorschau'),
      el('p',{},el('b',{class:g.schueler.length?'u-gut':'u-fehl'},g.schueler.length+' Schüler erkannt'),lbAnz?' · '+lbAnz+'× LB':''),
      ...g.warnungen.map(x=>el('div',{class:'u-warn13'},'⚠ '+x)),
      el('div',{class:'u-scroll30'},...zeilen),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn still',onclick:()=>{ schritt=2; s2(); }},'← Zurück'),
        el('button',{class:'btn',...(g.schueler.length?{}:{disabled:'disabled'}),onclick:()=>{ schritt=4; s4(); }},'Weiter: Sitzplan')));
  }
  function s4(){ // Sitzplan (§15)
    dlgZeigenEl(kopf('Sitzplan'),
      el('p',{class:'u-hinweis'},'Sitzplan jetzt anlegen? Änderbar jederzeit unter „Kurse → Sitzplan bearbeiten".'),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn',onclick:()=>fertig('alpha')},'Alphabetisch verteilen'),
        el('button',{class:'btn still',onclick:()=>fertig('leer')},'Leeres Raster')),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn still',onclick:()=>fertig('spaeter')},'Später'),
        el('button',{class:'btn still',onclick:()=>{ schritt=3; s3(); }},'← Zurück')));
  }
  function fertig(sitz){
    const name=w.name.trim()||'Kurs', fach=w.fach.trim()||'', jahr=w.jahr.trim()||'';
    const aid=vault.stamm.aktivesSchuljahrId;
    const k={id:slugId(name+'-'+fach+'-'+jahr),name,fach,schuljahr:jahr,schuljahrId:aid,lehrkraft:'',profil:w.profil,slot:'m1',status:'aktiv'};
    if(w.profil==='sek2') k.notenmodus=w.notenmodus;
    const idx=vault.stamm.kurse.findIndex(x=>x.id===k.id);
    if(idx>=0) vault.stamm.kurse[idx]=k; else vault.stamm.kurse.push(k);
    vault.stamm.schueler[k.id]=w.geparst.schueler;
    if(sitz==='alpha') vault.stamm.sitzplaene[k.id]={grid:alphaGrid(w.geparst.schueler)};
    else if(sitz==='leer') vault.stamm.sitzplaene[k.id]={grid:{}};
    stammMutiert(); speichern();
    aktiverKursId=k.id; aktualisiereKursChip(); dlgZu();
    toast('Angelegt: '+name+' ('+w.geparst.schueler.length+' Schüler)'+(w.geparst.warnungen.length?' · '+w.geparst.warnungen.length+' Hinweis(e)':''));
    renderKurse();
  }
  s1();
}
// P4.2 · Status-Badge einer Kurskarte („Klasse auf einen Blick") — nutzt die getestete kursStatus-Logik
function kursBadgeHtml(k){
  const evs=wirksameEvents(vault.events.filter(e=>e.kursId===k.id));
  const st=kursStatus(k,{events:evs,jetztLaeuft:autowahlInfo?.kursId===k.id});
  const txt=st.code==='jetzt'?'läuft gerade'
    :st.code==='offen'?st.n+'× Fehlzeit offen'
    :st.code==='leer'?'neu'
    :st.code==='aktiv'?'zuletzt '+datumLabel(st.letzterDatum)
    :'archiviert';
  const ton=st.ton==='jetzt'?' jetzt':st.ton==='warn'?' warn':'';
  return '<span class="kurs-badge'+ton+'">'+esc(txt)+'</span>';
}
function renderKurse(){
  const wrap=$('view-kurse');
  let html='<div class="panel"><h2>Neuer Kurs</h2>'+
    '<p class="u-hinweis">Am schnellsten: in Excel die Klassenlisten-Spalten markieren (Nr · Name · Vorname · ggf. LB), kopieren, hier einfügen. Alternativ die kurs.json vom PC-Werkzeug laden.</p>'+
    '<div class="btn-reihe"><button class="btn" id="btn-kurs-wizard">Kurs anlegen (geführt)</button>'+
    '<button class="btn still" id="btn-kurs-neu">Schnell (Einfügen)</button>'+
    '<button class="btn still" id="btn-import-kurs">kurs.json laden</button></div>'+
    '<input type="file" id="file-kurs" accept=".json,application/json" class="hidden"></div>'+
    '<div class="panel"><h2>Stundenplan</h2>'+
    '<p class="u-hinweis">Zeitraster + Wochenplan deiner Schule — die Kladde öffnet dann automatisch den richtigen Kurs.'+
    ((vault.stamm.zeitmodelle||[]).length?' <b class="u-gut">eingerichtet</b>':' <b class="u-warn13">noch nicht eingerichtet</b>')+'</p>'+
    '<div class="btn-reihe"><button class="btn" id="btn-stundenplan">Stundenplan einrichten</button></div></div>';
  // Schuljahr-Panel (P3.2)
  const sj=aktivesSchuljahr();
  html+='<div class="panel"><h2>Schuljahr</h2>'+
    '<div class="zeile"><span>Aktiv</span><span class="wert">'+esc(sj?sj.label:'—')+'</span></div>'+
    '<div class="btn-reihe"><button class="btn still" id="btn-schuljahr">Neues Schuljahr starten…</button></div></div>';
  // Kurse des AKTIVEN Schuljahres, nicht archiviert
  const aktiveId=vault.stamm.aktivesSchuljahrId;
  const sichtbar=vault.stamm.kurse.filter(k=>(k.schuljahrId||aktiveId)===aktiveId&&k.status!=='archiviert');
  const archiviert=vault.stamm.kurse.filter(k=>k.status==='archiviert');
  for(const k of sichtbar){
    const anz=kursSchueler(k).length;
    const p=vault.stamm.kursprofile[k.id]||{};
    html+='<div class="panel"><h2>'+esc(k.name)+' · '+esc(k.fach)+kursBadgeHtml(k)+' <small class="u-notransform">('+k.profil+' · '+anz+' Schüler)</small></h2>'+
      '<div class="zeile"><span>Kladde-m-Slot (Export)</span><span><select data-slot="'+k.id+'">'+['m1','m2','m3','m4','m5','m6'].map(m=>'<option'+((k.slot||'m1')===m?' selected':'')+'>'+m+'</option>').join('')+'</select></span></div>'+
      (k.profil==='sek2'?'<div class="zeile"><span>Sek II · Noten-Eingabe</span><span><select data-notenmodus="'+k.id+'"><option value="punkte"'+((k.notenmodus||'punkte')==='punkte'?' selected':'')+'>Punkte 0–15</option><option value="drittel"'+(k.notenmodus==='drittel'?' selected':'')+'>Drittelnoten</option></select></span></div>':'')+
      '<div class="zeile"><span>HA-Typ aktiv (SekI-Schule: aus)</span><span><input type="checkbox" data-ha="'+k.id+'"'+(p.ha?' checked':'')+' class="u-check"></span></div>'+
      '<div class="btn-reihe">'+
      '<button class="btn still" data-plan-edit="'+k.id+'">Sitzplan bearbeiten</button>'+
      '<button class="btn still" data-slots="'+k.id+'">Stundenplan-Slots</button>'+
      '<button class="btn still" data-gruppen="'+k.id+'">Halbgruppen</button>'+
      '<button class="btn still" data-archiv="'+k.id+'">Archivieren</button></div></div>';
  }
  // Archiv (P3.3) — schreibgeschützt, eingeklappt
  if(archiviert.length){
    html+='<details class="panel"><summary><b>Archiv ('+archiviert.length+')</b></summary>'+
      archiviert.map(k=>'<div class="zeile"><span>'+esc(k.name)+' · '+esc(k.fach)+' <small class="u-leise">'+esc((vault.stamm.schuljahre||[]).find(j=>j.id===k.schuljahrId)?.label||'')+'</small></span>'+
        '<span><button class="btn still u-btn-klein" data-oeffnen="'+k.id+'">öffnen</button> <button class="btn gefahr u-btn-klein" data-loeschen="'+k.id+'">löschen</button></span></div>').join('')+'</details>';
  }
  wrap.innerHTML=html;
  $('btn-kurs-wizard').onclick=kursWizard;
  $('btn-kurs-neu').onclick=kursAnlegenDialog;
  $('btn-stundenplan').onclick=stundenplanAssistent;
  $('btn-schuljahr').onclick=schuljahrAssistent;
  wrap.querySelectorAll('[data-archiv]').forEach(b=>b.onclick=()=>archiviereKurs(b.dataset.archiv));
  wrap.querySelectorAll('[data-oeffnen]').forEach(b=>b.onclick=()=>{ aktiverKursId=b.dataset.oeffnen; aktualisiereKursChip(); aktView='schueler'; document.querySelectorAll('#hauptnav button').forEach(x=>x.classList.toggle('aktiv',x.dataset.view==='schueler')); setzeViewTitel('schueler'); ['heute','deck','schueler','kurse','mehr'].forEach(v=>$('view-'+v).classList.toggle('hidden',v!=='schueler')); renderSchueler(); toast('Archiv-Kurs (schreibgeschützt)'); });
  wrap.querySelectorAll('[data-loeschen]').forEach(b=>b.onclick=()=>loescheKursEndgueltig(b.dataset.loeschen));
  $('btn-import-kurs').onclick=()=>$('file-kurs').click();
  $('file-kurs').onchange=async e=>{
    const f=e.target.files[0]; if(!f) return;
    try {
      const kursJson=JSON.parse(await f.text());
      if(kursJson.schema!=='kladde/v1'||!kursJson.kurs) throw new Error('kein kladde/v1-Kurs');
      const k=kursJson.kurs; k.slot=k.slot||'m1';
      const idx=vault.stamm.kurse.findIndex(x=>x.id===k.id);
      if(idx>=0) vault.stamm.kurse[idx]=k; else vault.stamm.kurse.push(k);
      vault.stamm.schueler[k.id]=kursJson.schueler;
      stammMutiert(); speichern();
      aktiverKursId=k.id; aktualisiereKursChip();
      toast('Importiert: '+k.name+' ('+kursJson.schueler.length+' Schüler'+(kursJson.warnungen?.length?' · '+kursJson.warnungen.length+' Warnung(en)':'')+')');
      renderKurse();
    } catch(err){ toast('⚠ Import: '+err.message,4000); }
    e.target.value='';
  };
  wrap.querySelectorAll('[data-slot]').forEach(sel=>sel.onchange=()=>{ const k=vault.stamm.kurse.find(x=>x.id===sel.dataset.slot); k.slot=sel.value; stammMutiert(); speichern(); toast('Export-Slot: '+sel.value); });
  wrap.querySelectorAll('[data-notenmodus]').forEach(sel=>sel.onchange=()=>{ const k=vault.stamm.kurse.find(x=>x.id===sel.dataset.notenmodus); k.notenmodus=sel.value; stammMutiert(); speichern(); toast('Sek II: '+(sel.value==='drittel'?'Drittelnoten':'Punkte 0–15')); });
  wrap.querySelectorAll('[data-ha]').forEach(cb=>cb.onchange=()=>{ vault.stamm.kursprofile[cb.dataset.ha]={...(vault.stamm.kursprofile[cb.dataset.ha]||{}),ha:cb.checked}; stammMutiert(); speichern(); });
  wrap.querySelectorAll('[data-plan-edit]').forEach(b=>b.onclick=()=>sitzplanEditor(b.dataset.planEdit));
  wrap.querySelectorAll('[data-slots]').forEach(b=>b.onclick=()=>slotsEditor(b.dataset.slots));
  wrap.querySelectorAll('[data-gruppen]').forEach(b=>b.onclick=()=>gruppenEditor(b.dataset.gruppen));
}
// Auto-Inkrement des Kursnamens fürs neue Jahr (7b→8b · 10a→11a · EF→Q1 · Q1→Q2), immer editierbar
function naechsterName(name){
  const s=String(name).trim();
  if(/^EF\b/i.test(s)) return s.replace(/^EF/i,'Q1');
  const q=s.match(/^Q([1-3])\b/i); if(q) return s.replace(/^Q[1-3]/i,'Q'+(Number(q[1])+1));
  const m=s.match(/^(\d+)(.*)$/); if(m){ const n=Number(m[1]); if(n>=1&&n<=12) return (n+1)+m[2]; }
  return s;
}
function naechstesSchuljahr(label){ const j=parseInt(label,10); return isNaN(j)?label:(j+1)+'/'+String((j+2)%100).padStart(2,'0'); }

// P3.2 · Schuljahres-Assistent (5 Schritte, el(); Events werden NIE übernommen — verbotener Pfad 8)
function schuljahrAssistent(){
  const alt=aktivesSchuljahr(); if(!alt){ toast('Kein aktives Schuljahr'); return; }
  const neuLabel=naechstesSchuljahr(alt.label);
  const aktiveKurse=vault.stamm.kurse.filter(k=>(k.schuljahrId||vault.stamm.aktivesSchuljahrId)===alt.id&&k.status!=='archiviert');
  const wahl=new Map(aktiveKurse.map(k=>[k.id,{nehmen:true,name:naechsterName(k.name),liste:true,plan:true}]));
  let schritt=1;
  const kopf=t=>el('div',{class:'sp-kopf'},el('h3',{},t),el('div',{class:'sp-steps'},...[1,2,3,4].map(n=>el('span',{class:'sp-step'+(n===schritt?' an':'')},String(n)))));

  function s1(){ // Sicherung erzwingen
    dlgZeigenEl(kopf('Sicherung'),
      el('p',{},'Bevor du das neue Schuljahr startest, sichere die aktuelle Kladde. „Weiter" wird erst nach einem Export frei.'),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn',onclick:async()=>{ await exportiereContainerJetzt(); s1(); }},exportInSitzung?'✓ exportiert — nochmal':'Container exportieren'),
        el('button',{class:'btn'+(exportInSitzung?'':' still'),onclick:()=>{ if(!exportInSitzung){ toast('Bitte zuerst exportieren'); return; } schritt=2; s2(); }},'Weiter'),
        el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
  }
  function s2(){ // Altes Jahr
    dlgZeigenEl(kopf('Altes Jahr'),
      el('p',{},esc(alt.label)+' wird archiviert (schreibgeschützt erhalten). Du findest es unter „Archiv".'),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn still',onclick:()=>{ schritt=1; s1(); }},'← Zurück'),
        el('button',{class:'btn',onclick:()=>{ schritt=3; s3(); }},'Weiter: Kurse')));
  }
  function s3(){ // Kursübernahme
    const zeilen=aktiveKurse.map(k=>{
      const w=wahl.get(k.id);
      const nameIn=el('input',{type:'text',value:w.name,class:'u-w130',oninput:e=>w.name=e.target.value});
      const nehmen=el('input',{type:'checkbox',class:'u-check',...(w.nehmen?{checked:'checked'}:{}),onchange:e=>w.nehmen=e.target.checked});
      const liste=el('input',{type:'checkbox',class:'u-check',...(w.liste?{checked:'checked'}:{}),onchange:e=>w.liste=e.target.checked});
      const plan=el('input',{type:'checkbox',class:'u-check',...(w.plan?{checked:'checked'}:{}),onchange:e=>w.plan=e.target.checked});
      return el('div',{class:'panel'},
        el('div',{class:'zeile'},el('span',{},nehmen,' ',esc(k.name)+' · '+esc(k.fach)),el('span',{},'→ ',nameIn)),
        el('div',{class:'zeile'},el('span',{class:'u-hinweis'},'Schülerliste'),el('span',{},liste)),
        el('div',{class:'zeile'},el('span',{class:'u-hinweis'},'Sitzplan + Wochenplan'),el('span',{},plan)));
    });
    dlgZeigenEl(kopf('Kurse übernehmen'),
      el('p',{class:'u-hinweis'},'Bewertungen, Notizen und Fehlzeiten werden NIE ins neue Jahr übernommen — nur Struktur.'),
      ...zeilen,
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn still',onclick:()=>{ schritt=2; s2(); }},'← Zurück'),
        el('button',{class:'btn',onclick:()=>{ schritt=4; s4(); }},'Weiter')));
  }
  function s4(){ // Ausführen + Übersicht
    const uebernommen=aktiveKurse.filter(k=>wahl.get(k.id).nehmen);
    dlgZeigenEl(kopf('Fertig'),
      el('p',{},'Neues Schuljahr '+neuLabel+' anlegen, '+uebernommen.length+' Kurs(e) übernehmen, '+alt.label+' archivieren?'),
      el('p',{class:'u-hinweis'},'Neue Kurse legst du danach mit „Kurs anlegen" an.'),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn still',onclick:()=>{ schritt=3; s3(); }},'← Zurück'),
        el('button',{class:'btn',onclick:ausfuehren},'Schuljahr starten')));
  }
  function ausfuehren(){
    const neuId=slugId(neuLabel);
    // neues Schuljahr
    if(!vault.stamm.schuljahre.some(j=>j.id===neuId))
      vault.stamm.schuljahre.push({id:neuId,label:neuLabel,status:'aktiv',angelegtAm:new Date().toISOString(),abgeschlossenAm:null,zeitraeume:standardZeitraeume(neuLabel)});
    // altes archivieren
    alt.status='abgeschlossen'; alt.abgeschlossenAm=new Date().toISOString();
    for(const k of aktiveKurse) k.status='archiviert';
    // übernehmen
    for(const k of aktiveKurse){
      const w=wahl.get(k.id); if(!w.nehmen) continue;
      const neuKursId=slugId(w.name+'-'+k.fach+'-'+neuLabel);
      const nk={...k,id:neuKursId,name:w.name,schuljahr:neuLabel,schuljahrId:neuId,status:'aktiv'};
      vault.stamm.kurse.push(nk);
      if(w.liste) vault.stamm.schueler[neuKursId]=JSON.parse(JSON.stringify(vault.stamm.schueler[k.id]||[]));
      if(w.plan){
        if(vault.stamm.sitzplaene[k.id]) vault.stamm.sitzplaene[neuKursId]=JSON.parse(JSON.stringify(vault.stamm.sitzplaene[k.id]));
        // Wochenplan-Blöcke des alten Kurses auf den neuen umhängen (Lücken-Fix #5)
        for(const wp of (vault.stamm.wochenplan||[])) if(wp.kursId===k.id) vault.stamm.wochenplan.push({...wp,id:wp.id+'-'+neuId,kursId:neuKursId});
      }
      // Events: bewusst NICHT übernehmen (verbotener Pfad 8)
    }
    vault.stamm.aktivesSchuljahrId=neuId;
    aktiverKursId=null; zeitraumFilter=null;
    stammMutiert(); speichern(); dlgZu(); kursAutowahl(); renderKurse();
    toast('Schuljahr '+neuLabel+' gestartet');
  }
  s1();
}

// P3.3 · Archivieren (Standard) — Kurs bleibt vollständig erhalten, nur schreibgeschützt + ausgeblendet
function archiviereKurs(id){
  const k=vault.stamm.kurse.find(x=>x.id===id); if(!k) return;
  dlgZeigen('<h3>Kurs archivieren?</h3><p class="u-leise">'+esc(k.name)+' verschwindet aus der aktiven Liste. Alle Einträge bleiben verschlüsselt erhalten und im Archiv einsehbar (schreibgeschützt).</p><div class="btn-reihe"><button class="btn" data-ok>Archivieren</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
    el=>{ el.querySelector('[data-ok]').onclick=()=>{ k.status='archiviert'; stammMutiert(); speichern(); if(aktiverKursId===id){ aktiverKursId=null; kursAutowahl(); } dlgZu(); renderKurse(); toast('Archiviert: '+k.name); }; });
}
// Endgültiges Löschen — NUR im Archiv, doppelt bestätigt (Kursname abtippen), Zwangs-Export vorher
function loescheKursEndgueltig(id){
  const k=vault.stamm.kurse.find(x=>x.id===id); if(!k) return;
  dlgZeigen('<h3>Endgültig löschen</h3><p class="u-warn13">Unwiderruflich: Kurs, Schülerliste, Sitzplan und ALLE Ereignisse werden entfernt.</p>'+
    '<p class="u-hinweis">Sichere vorher (falls noch nicht geschehen). Zum Bestätigen den Kursnamen „'+esc(k.name)+'" eintippen:</p>'+
    '<input type="text" id="del-confirm" autocomplete="off" class="u-w170">'+
    '<div class="btn-reihe"><button class="btn still" id="del-export">Erst exportieren</button><button class="btn gefahr" id="del-ok" disabled>Löschen</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
    el=>{
      el.querySelector('#del-confirm').oninput=e=>{ el.querySelector('#del-ok').disabled=e.target.value.trim()!==k.name; };
      el.querySelector('#del-export').onclick=()=>{ dlgZu(); exportiereContainer(); };
      el.querySelector('#del-ok').onclick=()=>{
        vault.stamm.kurse=vault.stamm.kurse.filter(x=>x.id!==id);
        delete vault.stamm.schueler[id]; delete vault.stamm.sitzplaene[id]; delete vault.stamm.kursprofile[id];
        vault.stamm.wochenplan=(vault.stamm.wochenplan||[]).filter(w=>w.kursId!==id);
        vault.events=vault.events.filter(e=>e.kursId!==id);
        stammMutiert(); speichern(); dlgZu(); renderKurse(); toast('Endgültig gelöscht: '+k.name);
      };
    });
}
let editorCleanup=null; // Aufräumen des Sitzplan-Editors (auch aus sperren() erreichbar)
function sitzplanEditor(kursId){
  if(editorCleanup){ try{ editorCleanup(); }catch{} }
  aktiverKursId=kursId; aktualisiereKursChip();
  aktView='heute';
  document.querySelectorAll('#hauptnav button').forEach(x=>x.classList.toggle('aktiv',x.dataset.view==='heute')); setzeViewTitel('heute');
  ['heute','deck','schueler','kurse','mehr'].forEach(v=>$('view-'+v).classList.toggle('hidden',v!=='heute'));
  editorAktiv=true;
  document.body.classList.add('sp-edit');
  renderHeute();
  const plan=$('plan');
  const k=kurs();
  const sp=()=>(vault.stamm.sitzplaene[k.id]=vault.stamm.sitzplaene[k.id]||{grid:{}});
  const keyOf=kachel=>{ const i=[...plan.children].indexOf(kachel); return Math.floor(i/12)+','+(i%12); };
  toast('Namen aus der Leiste auf Plätze ziehen · Platz→Platz verschiebt · in den 🗑 = entfernen · leeren Platz antippen wählt klassisch',6500);

  // ── Editor-Leiste: Namen-Schiene (noch nicht platziert) + Mülleimer + Fertig ──
  const rail=el('div',{class:'sp-rail'});
  const trash=el('div',{class:'sp-trash',title:'Zum Entfernen hierher ziehen'},'🗑');
  const bar=el('div',{id:'sp-editor-bar',class:'sp-editor-bar'},
    el('span',{class:'sp-rail-label'},'Nicht platziert:'), rail, trash,
    el('button',{class:'btn',onclick:()=>beenden()},'Fertig'));
  document.body.appendChild(bar);
  function renderRail(){
    const vergeben=new Set(Object.values(sp().grid));
    const frei=kursSchueler(k).filter(s=>!vergeben.has(s.nr));
    rail.replaceChildren(...(frei.length
      ? frei.map(s=>el('div',{class:'sp-chip',dataset:{nr:String(s.nr)}},esc(s.vorname)+' '+esc(s.name)))
      : [el('span',{class:'u-hinweis'},'alle platziert ✓')]));
  }
  renderRail();

  // ── Pointer-Drag (Touch + Maus; HTML5-DnD ist auf iPad-Safari tot) ──
  let drag=null, justDragged=false;
  function zielReset(){ plan.querySelectorAll('.kachel.ziel').forEach(z=>z.classList.remove('ziel')); trash.classList.remove('ziel'); }
  function onMove(e){
    if(!drag) return;
    if(!drag.moving){
      if(Math.hypot(e.clientX-drag.x0,e.clientY-drag.y0)<8) return;
      drag.moving=true; document.body.classList.add('sp-dragging');
      const s=schuelerVonNr(drag.nr);
      drag.ghost=el('div',{class:'sp-ghost'}, s?s.vorname+' '+s.name:('Nr '+drag.nr));
      document.body.appendChild(drag.ghost);
    }
    e.preventDefault();
    drag.ghost.style.left=e.clientX+'px'; drag.ghost.style.top=e.clientY+'px';
    drag.ghost.style.display='none';
    const t=document.elementFromPoint(e.clientX,e.clientY);
    drag.ghost.style.display='';
    zielReset();
    if(t&&t.closest('.sp-trash')) trash.classList.add('ziel');
    else { const kach=t&&t.closest('.kachel'); if(kach&&plan.contains(kach)) kach.classList.add('ziel'); }
  }
  function onUp(e){
    if(!drag) return;
    const d=drag; drag=null;
    if(!d.moving) return; // reiner Tap → Plan-Tap-Handler entscheidet
    justDragged=true; setTimeout(()=>{ justDragged=false; },0);
    document.body.classList.remove('sp-dragging');
    if(d.ghost) d.ghost.remove();
    const t=document.elementFromPoint(e.clientX,e.clientY);
    zielReset();
    const g=sp().grid;
    if(t&&t.closest('.sp-trash')){
      if(d.vonKey){ delete g[d.vonKey]; stammMutiert(); speichern(); renderHeute(); renderRail(); toast('entfernt'); }
      return;
    }
    const kach=t&&t.closest('.kachel');
    if(kach&&plan.contains(kach)){
      const zielKey=keyOf(kach), belegt=g[zielKey];
      if(String(belegt)===String(d.nr)) return; // auf sich selbst
      if(d.vonKey){ delete g[d.vonKey]; if(belegt!=null) g[d.vonKey]=belegt; } // Platz→Platz: bei belegt tauschen
      g[zielKey]=d.nr;                                                         // Schiene→Platz: bisheriger wandert in die Schiene
      stammMutiert(); speichern(); renderHeute(); renderRail();
    }
  }
  const railDown=e=>{ const c=e.target.closest('.sp-chip'); if(!c) return; e.preventDefault(); drag={nr:Number(c.dataset.nr),vonKey:null,moving:false,ghost:null,x0:e.clientX,y0:e.clientY}; };
  const planDown=e=>{ const kach=e.target.closest('.kachel.schueler'); if(!kach) return; drag={nr:Number(kach.dataset.nr),vonKey:keyOf(kach),moving:false,ghost:null,x0:e.clientX,y0:e.clientY}; };
  const planTap=e=>{
    if(justDragged||(drag&&drag.moving)) return;
    const kach=e.target.closest('.kachel'); if(!kach) return;
    const key=keyOf(kach); if(sp().grid[key]) return; // gesetzt → nur Drag (kein Lösch-Tap mehr)
    e.stopPropagation(); picker(key);
  };
  const onCancel=()=>{ if(drag&&drag.ghost) drag.ghost.remove(); drag=null; document.body.classList.remove('sp-dragging'); zielReset(); };
  rail.addEventListener('pointerdown',railDown);
  plan.addEventListener('pointerdown',planDown);
  plan.addEventListener('pointerup',planTap);
  document.addEventListener('pointermove',onMove,{passive:false});
  document.addEventListener('pointerup',onUp,true);
  document.addEventListener('pointercancel',onCancel,true);

  function picker(key){
    const [r,c]=key.split(',').map(Number);
    const vergeben=new Set(Object.values(sp().grid));
    const frei=kursSchueler(k).filter(s=>!vergeben.has(s.nr));
    dlgZeigen('<h3>Platz '+(r+1)+'/'+(c+1)+'</h3><input type="text" id="s-such" placeholder="Name tippen…" list="s-liste"><datalist id="s-liste">'+
      frei.map(s=>'<option value="'+esc(s.vorname+' '+s.name+' ('+s.nr+')')+'">').join('')+'</datalist>'+
      '<div class="u-scroll30">'+frei.map(s=>'<button class="btn still u-btn-block u-eng" data-setz="'+s.nr+'">'+esc(s.vorname)+' '+esc(s.name)+'</button>').join('')+'</div>'+
      '<div class="btn-reihe"><button class="btn still" data-schliessen>Abbrechen</button></div>',
      elx=>{
        const setze=nr=>{ sp().grid[key]=nr; stammMutiert(); speichern(); dlgZu(); renderHeute(); renderRail(); };
        elx.querySelectorAll('[data-setz]').forEach(x=>x.onclick=()=>setze(Number(x.dataset.setz)));
        elx.querySelector('#s-such').oninput=ev2=>{ const m=ev2.target.value.match(/\((\d+)\)/); if(m) setze(Number(m[1])); };
        setTimeout(()=>elx.querySelector('#s-such').focus(),60);
      });
  }
  function beenden(){
    editorAktiv=false; editorCleanup=null;
    document.body.classList.remove('sp-edit','sp-dragging');
    rail.removeEventListener('pointerdown',railDown);
    plan.removeEventListener('pointerdown',planDown);
    plan.removeEventListener('pointerup',planTap);
    document.removeEventListener('pointermove',onMove,{passive:false});
    document.removeEventListener('pointerup',onUp,true);
    document.removeEventListener('pointercancel',onCancel,true);
    if(drag&&drag.ghost) drag.ghost.remove();
    bar.remove(); zielReset(); renderHeute();
  }
  editorCleanup=beenden;
}
function slotsEditor(kursId){
  const k=vault.stamm.kurse.find(x=>x.id===kursId);
  const slots=vault.stamm.stundenplanSlots;
  const meine=slots.filter(s=>s.kursId===kursId);
  const wt=['','Mo','Di','Mi','Do','Fr'];
  dlgZeigen('<h3>Stundenplan · '+esc(k.name)+'</h3><p class="u-hinweis">Freie Zeitfenster (67,5-min-Raster deiner Schule) — steuert die Kurs-Autowahl.</p>'+
    '<div id="slot-liste">'+meine.map((s,i)=>'<div class="zeile"><span>'+wt[s.wochentag]+' '+s.von+'–'+s.bis+(s.teilgruppe?' · Gr. '+s.teilgruppe:'')+'</span><button class="btn still" data-weg="'+slots.indexOf(s)+'">✕</button></div>').join('')+'</div>'+
    '<div class="zeile"><span>Neu</span><span><select id="sl-tag"><option value="1">Mo</option><option value="2">Di</option><option value="3">Mi</option><option value="4">Do</option><option value="5">Fr</option></select></span></div>'+
    '<div class="zeile"><span>von / bis</span><span><input type="time" id="sl-von" value="08:00" class="u-w108"> <input type="time" id="sl-bis" value="09:07" class="u-w108"></span></div>'+
    '<div class="zeile"><span>Teilgruppe</span><span><select id="sl-tg"><option value="">alle</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select></span></div>'+
    '<div class="btn-reihe"><button class="btn" data-add>Slot hinzufügen</button><button class="btn still" data-schliessen>Fertig</button></div>',
    el=>{
      el.querySelectorAll('[data-weg]').forEach(b=>b.onclick=()=>{ slots.splice(Number(b.dataset.weg),1); stammMutiert(); speichern(); dlgZu(); slotsEditor(kursId); });
      el.querySelector('[data-add]').onclick=()=>{
        slots.push({wochentag:Number(el.querySelector('#sl-tag').value),von:el.querySelector('#sl-von').value,bis:el.querySelector('#sl-bis').value,kursId,teilgruppe:el.querySelector('#sl-tg').value||undefined});
        stammMutiert(); speichern(); dlgZu(); slotsEditor(kursId);
      };
    });
}
/* ═══ STUNDENPLAN-ASSISTENT (P2.4 · 3 Schritte, mit el() gebaut — Migrationsregel) ═══ */
const WT_KURZ=['','Mo','Di','Mi','Do','Fr'];
function stundenplanAssistent(){
  // Arbeitskopie (erst bei „Fertig" in den Vault) — bestehendes Zeitmodell weiterbearbeiten
  const zm0=(vault.stamm.zeitmodelle||[])[0];
  const zm=zm0?JSON.parse(JSON.stringify(zm0)):{id:'std',name:'Regelraster',startSekunden:27900,dauerSekunden:4050,bloeckeProTag:6,pausenNachBlock:{},tagesAusnahmen:{},abWochenAnker:null,anzeigeRunden:true};
  const plan=JSON.parse(JSON.stringify(vault.stamm.wochenplan||[]));
  let schritt=1;
  const dlg=$('dlg');
  const speichereUndZu=()=>{
    vault.stamm.zeitmodelle=[zm];
    vault.stamm.wochenplan=plan;
    stammMutiert(); speichern(); dlgZu();
    kursAutowahl(); renderAlles(); // aktive Ansicht (auch Kurse) auffrischen
    toast('Stundenplan gespeichert');
  };

  function kopf(titel){
    return el('div',{class:'sp-kopf'},
      el('h3',{},titel),
      el('div',{class:'sp-steps'}, ...[1,2,3].map(n=>el('span',{class:'sp-step'+(n===schritt?' an':'')},String(n)))));
  }

  // ── Schritt 1: Zeitraster + Live-Vorschau (= resolveBloecke, kann nicht driften) ──
  function renderS1(){
    const startInput=el('input',{type:'time',value:formatZeit(zm.startSekunden),class:'u-w130',
      oninput:e=>{ const [h,m]=e.target.value.split(':').map(Number); if(!isNaN(h)){ zm.startSekunden=h*3600+m*60; nurVorschau(); } }});
    const dauerInput=el('input',{type:'number',value:String(zm.dauerSekunden/60),min:'20',max:'120',step:'0.5',class:'u-w110',
      oninput:e=>{ const v=parseFloat(e.target.value.replace(',','.')); if(v>0){ zm.dauerSekunden=Math.round(v*60); nurVorschau(); } }});
    const blockInput=el('input',{type:'number',value:String(zm.bloeckeProTag),min:'1',max:'12',class:'u-w110',
      oninput:e=>{ const v=parseInt(e.target.value,10); if(v>=1&&v<=12){ zm.bloeckeProTag=v; renderVorschau(); } }}); // Block-Anzahl ändert die Pausen-Zeilen → volles renderVorschau
    const pausenBox=el('div',{class:'sp-pausen'});
    // Pausen in Minuten mit 0,5-Genauigkeit: bei 67,5-min-Blöcken bringt eine :30-Pause die Blockgrenzen
    // auf glatte Minuten. parseInt hätte die 30 s verschluckt (Drift gegen den echten Schulplan · FEHLER 2026-07-09).
    const renderPausen=()=>{
      pausenBox.replaceChildren();
      for(let n=1;n<zm.bloeckeProTag;n++){
        const pin=el('input',{type:'number',min:'0',max:'120',step:'0.5',value:String((zm.pausenNachBlock[n]||0)/60),class:'u-w110',
          oninput:e=>{ const v=parseFloat(e.target.value.replace(',','.')); zm.pausenNachBlock[n]=Math.round((v||0)*60); nurVorschau(); }});
        pausenBox.append(el('div',{class:'zeile'},el('span',{},'Pause nach Block '+n),el('span',{},pin,' min')));
      }
    };
    const vorschau=el('div',{class:'sp-vorschau'});
    // nurVorschau rührt die Pausen-Inputs NICHT an — sonst verliert der getippte Input je Ziffer den Fokus,
    // die iPad-Tastatur klappt zu (FEHLER 2026-07-09). Exakte HH:MM:SS in Klammern, wenn eine Grenze auf :30 fällt.
    const nurVorschau=()=>{
      vorschau.replaceChildren(el('div',{class:'tag-kopf'},'So sieht der Tag aus (Mo–Do):'));
      for(const b of resolveBloecke(zm,1)){
        const sek=(b.startSek%60)||(b.endeSek%60);
        vorschau.append(el('div',{class:'zeile'},el('span',{},'Block '+b.blockNr),
          el('span',{class:'wert'},formatZeit(b.startSek)+'–'+formatZeit(b.endeSek)+(sek?' ('+formatZeit(b.startSek,false)+'–'+formatZeit(b.endeSek,false)+')':''))));
      }
    };
    const renderVorschau=()=>{ renderPausen(); nurVorschau(); };
    const frTag=zm.tagesAusnahmen&&zm.tagesAusnahmen[5];
    const frCheck=el('input',{type:'checkbox',class:'u-check',...(frTag?{checked:'checked'}:{}),
      onchange:e=>{ zm.tagesAusnahmen=zm.tagesAusnahmen||{}; if(e.target.checked) zm.tagesAusnahmen[5]={bloeckeProTag:Math.max(1,zm.bloeckeProTag-2)}; else delete zm.tagesAusnahmen[5]; }});
    renderVorschau();
    dlgZeigenEl(kopf('Zeitraster'),
      el('div',{class:'zeile'},el('span',{},'Unterrichtsbeginn'),el('span',{},startInput)),
      el('div',{class:'zeile'},el('span',{},'Blocklänge (min, 67,5 = 67.5)'),el('span',{},dauerInput)),
      el('div',{class:'zeile'},el('span',{},'Blöcke pro Tag'),el('span',{},blockInput)),
      el('div',{class:'zeile'},el('span',{},'Freitag kürzer'),el('span',{},frCheck)),
      pausenBox, vorschau,
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn',onclick:()=>{ schritt=2; renderS2(); }},'Weiter: Wochenplan'),
        el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
  }

  // ── Schritt 2: Wochenplan (Mo–Fr × Blöcke, Block antippen → Kurs/Teilgruppe/Rhythmus) ──
  function renderS2(){
    const tage=[1,2,3,4,5];
    const grid=el('div',{class:'sp-woche'});
    const zelleText=(wt,nr)=>{ const s=plan.find(p=>p.wochentag===wt&&p.blockNr===nr); if(!s) return '—'; const k=vault.stamm.kurse.find(x=>x.id===s.kursId); return (k?k.name:'?')+(s.teilgruppe?'·'+s.teilgruppe:'')+(s.rhythmus&&s.rhythmus!=='jede'?' ('+s.rhythmus+')':''); };
    const renderGrid=()=>{
      grid.replaceChildren();
      grid.append(el('div',{class:'sp-ecke'},''));
      for(const wt of tage) grid.append(el('div',{class:'sp-th'},WT_KURZ[wt]));
      for(let nr=1;nr<=zm.bloeckeProTag;nr++){
        grid.append(el('div',{class:'sp-th'},String(nr)));
        for(const wt of tage){
          const belegt=plan.some(p=>p.wochentag===wt&&p.blockNr===nr);
          grid.append(el('button',{class:'sp-zelle'+(belegt?' belegt':''),onclick:()=>blockDialog(wt,nr,renderGrid)},zelleText(wt,nr)));
        }
      }
    };
    renderGrid();
    const ab=zm.abWochenAnker;
    dlgZeigenEl(kopf('Wochenplan'),
      el('p',{class:'u-hinweis'},'Block antippen → Kurs zuweisen. A/B nur nötig, wenn dein Plan im Zwei-Wochen-Rhythmus läuft.'),
      el('div',{class:'sp-woche-wrap'},grid),
      (ab?el('div',{class:'zeile'},el('span',{},'A/B-Anker'),el('span',{class:'wert'},ab.datum+' = '+ab.typ)):el('span',{})),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn still',onclick:()=>{ schritt=1; renderS1(); }},'← Zeitraster'),
        el('button',{class:'btn',onclick:()=>{ schritt=3; renderS3(); }},'Weiter: Prüfen')));
  }

  function blockDialog(wt,nr,zurueck){
    const s=plan.find(p=>p.wochentag===wt&&p.blockNr===nr)||{};
    const kursSel=el('select',{},
      el('option',{value:''},'— frei —'),
      ...vault.stamm.kurse.map(k=>el('option',{value:k.id,...(s.kursId===k.id?{selected:'selected'}:{})},k.name+' · '+k.fach)));
    const tgSel=el('select',{}, ...['','A','B','C','D'].map(g=>el('option',{value:g,...(s.teilgruppe===g?{selected:'selected'}:{})},g||'alle')));
    const rhSel=el('select',{}, ...[['jede','jede Woche'],['A','A-Woche'],['B','B-Woche']].map(([v,t])=>el('option',{value:v,...((s.rhythmus||'jede')===v?{selected:'selected'}:{})},t)));
    dlgZeigenEl(el('h3',{},WT_KURZ[wt]+' · Block '+nr),
      el('div',{class:'zeile'},el('span',{},'Kurs'),el('span',{},kursSel)),
      el('div',{class:'zeile'},el('span',{},'Teilgruppe'),el('span',{},tgSel)),
      el('div',{class:'zeile'},el('span',{},'Rhythmus'),el('span',{},rhSel)),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn',onclick:()=>{
          const i=plan.findIndex(p=>p.wochentag===wt&&p.blockNr===nr);
          if(i>=0) plan.splice(i,1);
          const kursId=kursSel.value;
          if(kursId){
            const rhythmus=rhSel.value;
            plan.push({id:'wp-'+wt+'-'+nr,wochentag:wt,blockNr:nr,kursId,teilgruppe:tgSel.value||null,rhythmus});
            // A/B-Anker abfragen, sobald erster A/B-Slot entsteht und noch keiner gesetzt ist (Lücken-Fix #6)
            if((rhythmus==='A'||rhythmus==='B')&&!zm.abWochenAnker){ dlgZu(); ankerDialog(()=>{ schritt=2; renderS2(); }); return; }
          }
          dlgZu(); schritt=2; renderS2();
        }},'Übernehmen'),
        el('button',{class:'btn still',onclick:()=>{ dlgZu(); schritt=2; renderS2(); }},'Abbrechen')));
  }

  function ankerDialog(weiter){
    const d=el('input',{type:'date'});
    const t=el('select',{},el('option',{value:'A'},'A-Woche'),el('option',{value:'B'},'B-Woche'));
    dlgZeigenEl(el('h3',{},'A/B-Woche festlegen'),
      el('p',{class:'u-hinweis'},'An welchem Datum beginnt welche Woche? Ein Montag genügt — die Kladde rechnet den Rhythmus daraus.'),
      el('div',{class:'zeile'},el('span',{},'Woche ab'),el('span',{},d)),
      el('div',{class:'zeile'},el('span',{},'ist'),el('span',{},t)),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn',onclick:()=>{ if(d.value){ zm.abWochenAnker={datum:d.value,typ:t.value}; } dlgZu(); weiter(); }},'Setzen'),
        el('button',{class:'btn still',onclick:()=>{ dlgZu(); weiter(); }},'Später')));
  }

  // ── Schritt 3: Autowahl prüfen (Testzeit-Widget) + Speichern ──
  function renderS3(){
    const tagSel=el('select',{}, ...[1,2,3,4,5].map(wt=>el('option',{value:String(wt)},WT_KURZ[wt])));
    const zeitInput=el('input',{type:'time',value:'08:10',class:'u-w130'});
    const ergebnis=el('div',{class:'sp-ergebnis'});
    const pruef=()=>{
      const wt=Number(tagSel.value); const [h,m]=zeitInput.value.split(':').map(Number);
      // Referenz-Montag der Anker-A-Woche, dann auf gewählten Wochentag schieben (Testzeit ist wochenneutral)
      const basis=new Date(2026,7,24+(wt-1),h||0,m||0,0);
      const t=kursZurZeit(basis,{zeitmodell:zm,wochenplan:plan,ausnahmen:[]});
      const k=t&&vault.stamm.kurse.find(x=>x.id===t.kursId);
      ergebnis.replaceChildren(el('b',{class:t?'u-gut':'u-leise'}, t?('→ '+(k?k.name+' · '+k.fach:t.kursId)+(t.teilgruppe?' · Gr. '+t.teilgruppe:'')+(t.quelle==='kommend'?' (gleich)':'')):'→ frei / kein Kurs'));
    };
    pruef();
    dlgZeigenEl(kopf('Autowahl prüfen'),
      el('p',{class:'u-hinweis'},'Stelle eine Zeit ein — so entscheidet die Kladde im Unterricht.'),
      el('div',{class:'zeile'},el('span',{},'Testzeit'),el('span',{},tagSel,' ',zeitInput,' ',el('button',{class:'btn still u-btn-klein',onclick:pruef},'prüfen'))),
      ergebnis,
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn still',onclick:()=>{ schritt=2; renderS2(); }},'← Wochenplan'),
        el('button',{class:'btn',onclick:speichereUndZu},'Fertig & speichern')));
  }

  renderS1();
}

const GRUPPEN_LABELS=['A','B','C','D'];
function gruppenEditor(kursId){
  const k=vault.stamm.kurse.find(x=>x.id===kursId);
  const liste=vault.stamm.schueler[kursId]||[];
  dlgZeigen('<h3>Halbgruppen · '+esc(k.name)+'</h3><p class="u-hinweis">Gruppe direkt antippen.</p>'+
    '<div class="u-scroll58">'+liste.map(s=>'<div class="gr-zeile"><span class="gr-name">'+esc(s.vorname)+' '+esc(s.name)+'</span><span class="gr-btns">'+
      '<button class="gr-b'+(!s.gruppe?' an':'')+'" data-g="'+s.nr+'" data-w="">—</button>'+
      GRUPPEN_LABELS.map(g=>'<button class="gr-b'+(s.gruppe===g?' an':'')+'" data-g="'+s.nr+'" data-w="'+g+'">'+g+'</button>').join('')+'</span></div>').join('')+'</div>'+
    '<div class="btn-reihe"><button class="btn still" data-schliessen>Fertig</button></div>',
    el=>{
      el.querySelectorAll('[data-g]').forEach(b=>b.onclick=()=>{
        const s=liste.find(x=>x.nr===Number(b.dataset.g));
        s.gruppe=b.dataset.w||undefined;
        stammMutiert(); speichern();
        el.querySelectorAll('[data-g="'+b.dataset.g+'"]').forEach(x=>x.classList.toggle('an',(x.dataset.w||'')===(s.gruppe||'')));
      });
    });
}

/* ═══ MEHR · Sync (Export/Import) + Heimnetz + Diagnose ═══ */
function renderMehr(){
  const wrap=$('view-mehr');
  wrap.innerHTML=
    '<div class="panel"><h2>Sicherheit</h2>'+
    '<div class="zeile"><span>Automatisch sperren nach</span><span><select id="sec-lockmin">'+[5,10,15,30].map(m=>'<option value="'+m+'"'+(lockMinuten()===m?' selected':'')+'>'+m+' min</option>').join('')+'</select></span></div>'+
    '<div class="zeile"><span>Beim Verlassen sofort sperren</span><span><input type="checkbox" id="sec-sofort"'+(localStorage.getItem('kladde_lock_sofort')==='1'?' checked':'')+' class="u-check"></span></div>'+
    '<div class="zeile"><span>Während des Unterrichts nicht sperren</span><span><input type="checkbox" id="sec-unterricht"'+(localStorage.getItem('kladde_lock_unterricht')!=='0'?' checked':'')+' class="u-check"></span></div>'+
    '<div class="btn-reihe"><button class="btn still" id="sec-pass">Passphrase ändern…</button></div></div>'+
    '<div class="panel"><h2>Sichern & Übertragen</h2>'+
    '<p class="u-hinweis">Container ist AES-GCM-verschlüsselt (Passphrase nötig zum Öffnen). iPad: „In Dateien sichern" → SMB-Ordner des PCs.</p>'+
    '<div class="btn-reihe"><button class="btn" id="btn-export">Container exportieren</button>'+
    '<button class="btn still" id="btn-import">Container importieren/mergen</button></div>'+
    '<input type="file" id="file-cont" accept=".enc,application/octet-stream" class="hidden"></div>'+
    (PAGES_KONTEXT?'':'<div class="panel"><h2>Heimnetz-Sync (PC-Server)</h2><div class="btn-reihe">'+
      '<button class="btn" id="btn-push">Push</button><button class="btn" id="btn-pull">Pull + Merge</button>'+
      '<span id="sync-status" class="u-hinweis u-selfcenter"></span></div></div>')+
    '<div class="panel"><h2>Werkstatt</h2>'+
    '<div class="zeile"><span>Version</span><span class="wert">v'+APP_VERSION+' · '+GERAET+(PAGES_KONTEXT?' · Pages':' · Heimnetz')+'</span></div>'+
    '<div class="zeile"><span>Modus</span><span class="wert" id="dg-mode">…</span></div>'+
    '<div class="zeile"><span>persist()</span><span class="wert" id="dg-persist">…</span></div>'+
    '<div class="zeile"><span>Speicher</span><span class="wert" id="dg-quota">…</span></div>'+
    '<div class="zeile"><span>Ereignisse im Log</span><span class="wert">'+vault.events.length+'</span></div>'+
    '<div class="zeile"><span>Letzte Sicherung</span><span class="wert" id="dg-save">Write-through aktiv</span></div>'+
    '<div class="zeile"><span>Regel</span><span class="wert u-maxw55">'+esc(regelText(bewertProfil(kurs())))+'</span></div></div>';
  const standalone=window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
  $('dg-mode').textContent=standalone?'standalone (installiert)':'Browser-Tab';
  if(navigator.storage?.persisted) navigator.storage.persisted().then(p=>$('dg-persist').textContent=p?'gewährt':'nicht gewährt');
  if(navigator.storage?.estimate) navigator.storage.estimate().then(e=>{ const mb=n=>(n/1048576).toFixed(1)+' MB'; $('dg-quota').textContent=mb(e.usage||0)+' / '+mb(e.quota||0); });
  $('btn-export').onclick=exportiereContainer;
  $('btn-import').onclick=()=>$('file-cont').click();
  $('file-cont').onchange=importiereContainer;
  $('sec-lockmin').onchange=e=>{ localStorage.setItem('kladde_lock_min',e.target.value); toast('Auto-Lock: '+e.target.value+' min'); };
  $('sec-sofort').onchange=e=>localStorage.setItem('kladde_lock_sofort',e.target.checked?'1':'0');
  $('sec-unterricht').onchange=e=>localStorage.setItem('kladde_lock_unterricht',e.target.checked?'1':'0');
  $('sec-pass').onclick=passphraseWechselDialog;
  if(!PAGES_KONTEXT){
    $('btn-push').onclick=syncPush;
    $('btn-pull').onclick=syncPull;
    fetch('/api/kladde/status',{cache:'no-store'}).then(r=>r.json()).then(s=>{ $('sync-status').textContent='Server ok · Zert bis '+s.zert_bis; }).catch(()=>{ $('sync-status').textContent='Server nicht erreichbar'; });
  }
}
async function aktuellerContainerBlob(){
  await speichern();
  return idbGet('vault');
}
function exportiereContainer(){
  // Export-Warnung (Konzept §2) — sensibilisieren, dann die bewährte Kaskade
  dlgZeigen('<h3>Container exportieren</h3>'+
    '<p>Diese Datei enthält deine Kladde verschlüsselt. Sie kann nur mit deiner Passphrase geöffnet werden.</p>'+
    '<p class="u-hinweis">Die Sicherheit hängt von der Stärke deiner Passphrase ab. Bewahre die Datei geschützt auf.</p>'+
    '<div class="btn-reihe"><button class="btn" data-ok>Exportieren</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
    el=>{ el.querySelector('[data-ok]').onclick=()=>{ dlgZu(); exportiereContainerJetzt(); }; });
}
let exportInSitzung=false; // für Schuljahr-Assistent: „Weiter" erst nach echtem Export
function merkeExport(){ exportInSitzung=true; if(vault) idbPut('letzterExport',{ts:Date.now(),events:vault.events.length}); }
async function exportiereContainerJetzt(){
  let bytes, name;
  try {
    bytes=await aktuellerContainerBlob();
    name='kladde-'+GERAET+'-'+heuteIso()+'.enc';
  } catch(err){ toast('⚠ Export: '+err.message,4000); return; }
  // FEHLER:519-Kaskade: share primär (iOS), bei Nicht-Abbruch-Fehler → Download-Fallback
  const file=new File([bytes],name,{type:'application/octet-stream'});
  if(navigator.canShare&&navigator.canShare({files:[file]})){
    try {
      await navigator.share({files:[file],title:'Kladde-Container'});
      merkeExport();
      toast('Export übergeben (Share)');
      return;
    } catch(err){
      if(err.name==='AbortError') return;            // bewusst abgebrochen
      console.warn('[kladde] share→download-Fallback:',err.message);
    }
  }
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
  const a=document.createElement('a'); a.href=url; a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  merkeExport();
  toast('Export gestartet: '+name);
}
async function importiereContainer(e){
  const f=e.target.files[0]; e.target.value=''; if(!f) return;
  let fremd;
  try {
    fremd=(await decodeContainerAuto(new Uint8Array(await f.arrayBuffer()),pinRam)).daten;
  } catch(err){ toast('⚠ Import: '+err.message+' (gleiche Passphrase auf beiden Geräten?)',5000); return; }
  if(!schemaBekannt(fremd.schema)){ toast('⚠ Container-Schema '+fremd.schema+' ist neuer als diese App — bitte App aktualisieren (neu laden).',6000); return; }
  // Import-Vorschau (Konzept §3): erst zeigen, dann mergen — nie still
  const eigeneIds=new Set(vault.events.map(x=>x.id));
  const neue=(fremd.events||[]).filter(x=>!eigeneIds.has(x.id)).length;
  const dry=mergeContainerDaten(vault,fremd);
  dlgZeigen('<h3>Container erkannt</h3>'+
    '<div class="zeile"><span>Quelle</span><span class="wert">'+esc(fremd.stamm?.geraet||'?')+'</span></div>'+
    '<div class="zeile"><span>Letzter Stand</span><span class="wert">'+esc(String(fremd.stamm?.ts||'?').slice(0,16).replace('T',' '))+'</span></div>'+
    '<div class="zeile"><span>Kurse</span><span class="wert">'+(fremd.stamm?.kurse?.length||0)+'</span></div>'+
    '<div class="zeile"><span>Ereignisse</span><span class="wert">'+(fremd.events?.length||0)+' · davon '+neue+' neu</span></div>'+
    (dry.konflikte.length
      ?'<p class="u-warn13">⚠ '+esc(dry.konflikte[0])+'</p>'
      :'<p class="u-hinweis">Keine Stammdaten-Konflikte.</p>')+
    '<div class="btn-reihe"><button class="btn" data-ok>Importieren und mergen</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
    el=>{ el.querySelector('[data-ok]').onclick=async()=>{
      dlgZu();
      // Verworfener Stand liegt bei (max 3, FIFO) — gerätelokal informativ, überlebt eigene Saves
      if(dry.verworfen){
        (dry.daten.verworfeneStaende=vault.verworfeneStaende||[]).push(dry.verworfen);
        while(dry.daten.verworfeneStaende.length>3) dry.daten.verworfeneStaende.shift();
      } else if(vault.verworfeneStaende){ dry.daten.verworfeneStaende=vault.verworfeneStaende; }
      vault=dry.daten; stammOhneBump(); await speichern();
      toast('Gemergt: '+vault.events.length+' Ereignisse'+(dry.konflikte.length?' · ⚠ '+dry.konflikte[0]:''),dry.konflikte.length?6000:2600);
      kursAutowahl(); renderAlles();
    }; });
}
function stammOhneBump(){ /* Merge-Ergebnis behält die Sieger-rev — bewusst kein rev++ */ }
function passphraseWechselDialog(){
  dlgZeigen('<h3>Passphrase ändern</h3>'+
    '<p class="u-warn13">Wichtig: auf BEIDEN Geräten ändern — sonst können Import und Heimnetz-Sync den fremden Container nicht mehr öffnen. Bereits exportierte Sicherungen behalten die alte Passphrase.</p>'+
    '<div class="zeile"><span>Aktuelle</span><span><input type="password" id="pw-alt" autocomplete="off" class="u-w170"></span></div>'+
    '<div class="zeile"><span>Neue (min. 10)</span><span><input type="password" id="pw-neu" autocomplete="off" class="u-w170"></span></div>'+
    '<div class="zeile"><span>Wiederholen</span><span><input type="password" id="pw-neu2" autocomplete="off" class="u-w170"></span></div>'+
    '<div id="pw-fehler" class="u-fehlerfeld"></div>'+
    '<div class="btn-reihe"><button class="btn" data-ok>Ändern</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
    el=>{ el.querySelector('[data-ok]').onclick=async()=>{
      const alt=el.querySelector('#pw-alt').value, neu=el.querySelector('#pw-neu').value;
      const feh=el.querySelector('#pw-fehler');
      if(neu.length<10){ feh.textContent='Mindestens 10 Zeichen — besser 12+ oder ein kurzer Satz.'; return; }
      if(neu!==el.querySelector('#pw-neu2').value){ feh.textContent='Passphrasen stimmen nicht überein.'; return; }
      try{
        await speichern();
        const blob=await idbGet('vault');
        const g=await wechslePassphrase(blob,alt,neu);   // Millisekunden: nur DEK-Rewrap
        await idbPut('vault',g.bytes);
        dekKey=g.dek; containerKopf=g.kopf; pinRam=neu;
        dlgZu(); toast('Passphrase geändert — denke an das zweite Gerät.',5000);
      }catch(err){ feh.textContent=err.message; }
    }; });
}
async function syncPush(){
  try {
    const bytes=await aktuellerContainerBlob();
    const r=await fetch('/api/kladde/push/'+GERAET,{method:'POST',body:bytes});
    if(!r.ok) throw new Error('HTTP '+r.status);
    const j=await r.json();
    merkeExport(); // Container liegt jetzt auf dem PC — zählt als Sicherung (Backup-Banner)
    toast('Push ok · Generation '+j.generationen);
  } catch(err){ toast('⚠ Push: '+err.message,4000); }
}
async function syncPull(){
  try {
    const von=GERAET==='pc'?'ipad':'pc';
    const r=await fetch('/api/kladde/pull/'+von,{cache:'no-store'});
    if(r.status===404){ toast('Noch kein Container von „'+von+'" auf dem Server'); return; }
    if(!r.ok) throw new Error('HTTP '+r.status);
    const fremd=(await decodeContainerAuto(new Uint8Array(await r.arrayBuffer()),pinRam)).daten;
    if(!schemaBekannt(fremd.schema)){ toast('⚠ Container-Schema '+fremd.schema+' ist neuer als diese App — bitte App aktualisieren.',6000); return; }
    const dry=mergeContainerDaten(vault,fremd);
    const anwenden=async()=>{
      if(vault.verworfeneStaende&&!dry.daten.verworfeneStaende) dry.daten.verworfeneStaende=vault.verworfeneStaende;
      vault=dry.daten; await speichern();
      toast('Pull+Merge ok: '+vault.events.length+' Ereignisse'+(dry.konflikte.length?' · ⚠ '+dry.konflikte[0]:''),dry.konflikte.length?6000:2600);
      kursAutowahl(); renderAlles();
    };
    // Ein Handgriff bleibt ein Handgriff — Bestätigung NUR bei Stammdaten-Konflikt (P1.6)
    if(dry.konflikte.length){
      dlgZeigen('<h3>Stammdaten-Konflikt</h3><p class="u-fs14">'+esc(dry.konflikte[0])+'</p>'+
        '<div class="btn-reihe"><button class="btn" data-ok>Übernehmen</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
        el=>{ el.querySelector('[data-ok]').onclick=()=>{ dlgZu(); anwenden(); }; });
    } else await anwenden();
  } catch(err){ toast('⚠ Pull: '+err.message+' (gleiche Passphrase?)',4500); }
}

/* ═══ HINWEIS-BANNER (Migration · Passphrase-Empfehlung · Backup · Update) ═══ */
function zeigeBanner(html,setup){
  const b=$('banner');
  b.innerHTML=html+'<button class="banner-zu" data-zu title="Ausblenden">×</button>';
  b.classList.remove('hidden');
  b.querySelector('[data-zu]').onclick=()=>b.classList.add('hidden');
  if(setup) setup(b);
}
async function zeigeStartHinweise(){
  if(migrationsHinweis){
    migrationsHinweis=false;
    zeigeBanner('<span>Kladde nutzt jetzt das schnellere Container-Format v2. Empfohlen: einmal exportieren (deine bisherige Sicherung bleibt mit alter Passphrase lesbar).</span><button class="btn" data-exp>Jetzt exportieren</button>',
      b=>{ b.querySelector('[data-exp]').onclick=()=>{ b.classList.add('hidden'); exportiereContainer(); }; });
    return;
  }
  // Einmaliger, nicht blockierender Hinweis für Bestands-Kurz-PINs (§1.3 — kein Zwang, Zwang erzeugt Post-its)
  if(pinRam&&passStaerke(pinRam)==='schwach'&&!localStorage.getItem('kladde_pass_hinweis')){
    localStorage.setItem('kladde_pass_hinweis','1');
    zeigeBanner('<span>Deine PIN ist kurz — für echte Schülerdaten ist eine Passphrase (12+ Zeichen) empfohlen: Mehr → Sicherheit → Passphrase ändern.</span>');
    return;
  }
  // Backup-Erinnerung (P1.5): das realste Verlustszenario ist Gerätedefekt/Speicherbereinigung, nicht der Angreifer
  try{
    const le=await idbGet('letzterExport');
    const tage=le?Math.floor((Date.now()-le.ts)/86400000):Infinity;
    if(tage>7&&vault&&vault.events.length>(le?.events??0)){
      zeigeBanner('<span>Letzte Sicherung '+(le?'vor '+tage+' Tagen':'noch nie')+' — jetzt exportieren?</span><button class="btn" data-exp>Jetzt exportieren</button>',
        b=>{ b.querySelector('[data-exp]').onclick=()=>{ b.classList.add('hidden'); exportiereContainer(); }; });
    }
  }catch{}
}

/* ═══ INIT ═══ */
if('serviceWorker' in navigator) window.addEventListener('load',()=>{
  navigator.serviceWorker.register('./service-worker.js').then(reg=>{
    // Update-Banner (P1.7, vorgezogen aus P4): kein stilles Doppel-Reload-Rätsel mehr
    reg.addEventListener('updatefound',()=>{
      const nw=reg.installing;
      if(nw) nw.addEventListener('statechange',()=>{
        if(nw.state==='installed'&&navigator.serviceWorker.controller)
          zeigeBanner('<span>Neue Version geladen.</span><button class="btn" data-reload>Neu laden</button>',
            b=>{ b.querySelector('[data-reload]').onclick=()=>location.reload(); });
      });
    });
  }).catch(()=>{});
});
if(navigator.storage?.persist) navigator.storage.persist();
idbGet('starts').then(n=>idbPut('starts',(n||0)+1));
document.body.classList.toggle('beamer',beamerModus);
document.body.classList.toggle('nurplan',beamerModus&&localStorage.getItem('kladde_beamer_nurplan')==='1');
$('btn-beamer').classList.toggle('aktiv',beamerModus);
$('beamer-hinweis').classList.toggle('hidden',!beamerModus);
lockInit();