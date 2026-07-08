// Kladde · js/app.mjs — Bootstrap + UI (P1.1-A1: mechanischer Umzug aus index.html v0.7, verhaltensneutral)
// Logik lebt in ../logic/*.mjs — App und Tests importieren DIESELBEN Dateien (Drift unmöglich).
import { DRITTELNOTEN, wertZuLabel } from '../logic/skalen.mjs';
import { verdichte, wirksameEvents, regelText } from '../logic/verdichtung.mjs';
import { mergeContainerDaten } from '../logic/merge.mjs';
import { decodeContainerAuto, encodeContainerV2, wechslePassphrase, neueV2Identitaet } from '../logic/container.mjs';
import { parseSchuelerListe } from '../logic/parser.mjs';
const APP_VERSION = '0.8.0';
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
  return {schema:'kladde/v1',
    stamm:{rev:1,ts:new Date().toISOString(),geraet:GERAET,kurse:[],schueler:{},sitzplaene:{},kursprofile:{},stundenplanSlots:[],einstellungen:{slot:'m1'}},
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
          await speichern(); // erste v2-Schreibung — erst NACH verifiziertem Backup
          migrationsHinweis=true;
          console.log('[kladde] v1→v2 migriert (Backup verifiziert) in',Math.round(performance.now()-t0),'ms');
        } else {
          dekKey=r.dek; containerKopf=r.kopf;
          vault=r.daten; pinRam=pin;
          console.log('[kladde] Unlock (v2) in',Math.round(performance.now()-t0),'ms');
        }
        entsperrt();
      } catch(e){ $('lock-fehler').textContent=e.message; }
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
  try{ dlgZu(); }catch{}
  $('dlg').innerHTML='';
  $('aktionsbar').classList.add('hidden');
  $('undo-chip').classList.add('hidden');
  $('soft-lock').classList.add('hidden');
  lockInit();
}
function lockMinuten(){ const m=Number(localStorage.getItem('kladde_lock_min')); return [5,10,15,30].includes(m)?m:15; }
function entsperrt(){
  $('lock').classList.add('hidden');
  zuletztAktiv=Date.now();
  clearInterval(lockTimer);
  lockTimer=setInterval(()=>{ if(Date.now()-zuletztAktiv>lockMinuten()*60*1000) sperren(); },30*1000);
  kursAutowahl(); renderAlles();
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
  }
});
window.addEventListener('pagehide',()=>{ if(vault) speichern(); });
$('btn-lock').addEventListener('click',()=>{ speichern().then(sperren); });

/* ═══ ZUSTAND-HELPERS ═══ */
let aktiverKursId=null, terminDatum=heuteIso(), aktiverSchueler=null, undoStack=[];
function heuteIso(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function kurs(){ return vault?.stamm.kurse.find(k=>k.id===aktiverKursId)||null; }
function kursSchueler(k){ return (vault.stamm.schueler[k.id]||[]); }
function profilTypen(k){
  const p=vault.stamm.kursprofile[k.id]||{};
  const basis=['+','o','-','mat','ipad_fehlt','ipad_leer','lernzeit'];
  if(p.ha) basis.push('ha');
  return basis;
}
// Bewertungs-Modus: bildet die 3 Fälle (Sek I=Drittel · Sek II=Punkte · Sek II=Drittel)
// auf die getestete 2-Wege-Logik ab — Sek-II-Drittel rechnet wie Sek I (Drittelnoten 1–6).
function bewertProfil(k){ return (k&&k.profil==='sek2'&&(k.notenmodus||'punkte')!=='drittel')?'sek2':'sek1'; }
function addEvent(typ,schuelerNr,extra={}){
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
const TYP_LABEL={'+':'＋','o':'o','-':'−',mat:'Material',ipad_fehlt:'iPad fehlt',ipad_leer:'iPad leer',lernzeit:'Lernzeit',ha:'HA',fehlt_e:'fehlt (e)',fehlt_u:'fehlt (u)',versp:'zu spät',notiz:'Notiz',note:'Note'};
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
function leererStand(){ return {plus:0,neutral:0,minus:0,mat:0,ipad:0,lernzeit:0,notiz:0,note:null,fehlt:null,versp:0,count:0}; }
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
    else if(e.typ==='versp') st.versp+=e.minuten||0;
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
function setzeBeamer(an){ beamerModus=an; localStorage.setItem('kladde_beamer',an?'1':'0'); document.body.classList.toggle('beamer',an); $('btn-beamer').classList.toggle('aktiv',an); if(aktView==='heute') renderHeute(); }

/* ═══ KURS-AUTOWAHL über Stundenplan-Slots (freie Zeitfenster · 67,5-min-Schule) ═══ */
function kursAutowahl(){
  if(!vault) return;
  const jetzt=new Date();
  const wtag=((jetzt.getDay()+6)%7)+1; // Mo=1
  const hhmm=String(jetzt.getHours()).padStart(2,'0')+':'+String(jetzt.getMinutes()).padStart(2,'0');
  const slot=vault.stamm.stundenplanSlots.find(s=>s.wochentag===wtag&&s.von<=hhmm&&hhmm<=s.bis);
  if(slot){ aktiverKursId=slot.kursId; aktiveTeilgruppe=slot.teilgruppe||null; $('kurs-slot').textContent=' · '+slot.von+'–'+slot.bis+(slot.teilgruppe?' · Gr. '+slot.teilgruppe:''); }
  else if(!aktiverKursId&&vault.stamm.kurse.length) aktiverKursId=vault.stamm.kurse[0].id;
  aktualisiereKursChip();
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
    vault.stamm.kurse.map(x=>'<button class="btn'+(k&&x.id===k.id?'':' still')+'" class="u-btn-block" data-kurs="'+x.id+'">'+esc(x.name)+' · '+esc(x.fach)+'</button>').join('')+
    '<div class="zeile"><span>Teilgruppe</span><span><select id="tg-sel"><option value="">alle</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select></span></div>'+
    '<div class="btn-reihe"><button class="btn still" data-schliessen>Schließen</button></div>',
    el=>{
      el.querySelector('#tg-sel').value=aktiveTeilgruppe||'';
      el.querySelectorAll('[data-kurs]').forEach(b=>b.onclick=()=>{ aktiverKursId=b.dataset.kurs; aktiveTeilgruppe=el.querySelector('#tg-sel').value||null; $('kurs-slot').textContent=aktiveTeilgruppe?' · Gr. '+aktiveTeilgruppe:''; dlgZu(); aktualisiereKursChip(); mitUebergang(renderAlles); });
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

/* ═══ VIEWS / TABS (replaceState-only — Edge-Swipe-Doktrin) ═══ */
let aktView='heute';
document.querySelector('nav.tabs').addEventListener('click',e=>{
  const b=e.target.closest('button[data-view]'); if(!b||b.dataset.view===aktView) return;
  aktView=b.dataset.view;
  document.querySelectorAll('nav.tabs button').forEach(x=>x.classList.toggle('aktiv',x===b));
  $('aktionsbar').classList.add('hidden'); aktiverSchueler=null;
  mitUebergang(()=>{
    ['heute','deck','schueler','kurse','mehr'].forEach(v=>$('view-'+v).classList.toggle('hidden',v!==aktView));
    renderAlles();
  });
});
// Übergangs-Helfer: View Transition wo verfügbar (PC-Chrome seit 111 / iPad ab Safari 18), sonst sofort. reduced-motion → sofort.
function mitUebergang(fn){
  if(!document.startViewTransition||matchMedia('(prefers-reduced-motion: reduce)').matches){ fn(); return; }
  try {
    const t=document.startViewTransition(fn);
    // Schneller Folgewechsel bricht die laufende Transition ab (InvalidStateError) —
    // erwartetes Verhalten, keine unhandled rejection in die Konsole kippen.
    t.finished.catch(()=>{});
  } catch { fn(); }
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
function sichtbareSchueler(k){
  let liste=kursSchueler(k);
  if(aktiveTeilgruppe) liste=liste.filter(s=>(s.gruppe||'')===aktiveTeilgruppe);
  return liste;
}
function datumStreifen(erfasst,total){
  const el=$('datum-streifen'); if(!kurs()){ el.innerHTML=''; el.className=''; return; }
  const heute=heuteIso(), istHeute=terminDatum===heute;
  el.className='datum-streifen'+(istHeute?'':' nachtrag');
  const zaehler=total?'<span class="erf-zaehler" title="heute mit +/o/− erfasst">'+erfasst+'/'+total+'</span>':'';
  el.innerHTML='<span class="heute-tag">'+(istHeute?'Heute':'Nachtrag')+' · '+datumLabel(terminDatum)+'</span>'+
    (istHeute?zaehler:'<span class="nachtrag-hinweis">Einträge gehen auf diesen Termin</span>')+
    '<span class="rechts">'+
    (istHeute?'':'<button data-heute>↩ Heute</button>')+
    '<button data-zufall title="Zufällig – bevorzugt wer heute noch nicht dran war">🎲</button>'+
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
  // Fair: nur echte SoMi (+/o/−) oder direkte Note zählt als „dran"; Abwesende raus.
  const info=new Map(alle.map(s=>[s.nr,standAmTermin(s.nr,terminDatum)]));
  const anwesend=alle.filter(s=>!info.get(s.nr).fehlt);
  const dran=new Set(anwesend.filter(s=>{const st=info.get(s.nr);return st.plus+st.neutral+st.minus+(st.note!=null?1:0)>0;}).map(s=>s.nr));
  let pool=anwesend.filter(s=>!dran.has(s.nr));
  let hinweis='';
  if(!pool.length){ pool=anwesend.length?anwesend:alle; hinweis=' · alle dran'; }
  const s=pool[Math.floor(Math.random()*pool.length)];
  aktiverSchueler=s.nr;
  renderHeute(); renderAktionsbar();
  const kachel=$('plan').querySelector('.kachel[data-nr="'+s.nr+'"]');
  if(kachel) kachel.scrollIntoView({block:'center',behavior:'smooth'});
  toast('🎲 '+s.vorname+' '+s.name+hinweis);
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
  if(st.fehlt) marken+='<span class="mk '+(st.fehlt==='u'?'u':'o')+'">'+st.fehlt+'</span>';
  return '<div class="'+cls+'" data-nr="'+s.nr+'">'+
    '<div class="kopf"><span class="vn">'+esc(s.vorname)+'</span>'+(s.lb?'<span class="lb-badge">LB</span>':'')+'</div>'+
    '<span class="nn">'+esc(s.name)+'</span>'+
    '<div class="marken">'+marken+'</div></div>';
}
function renderHeute(){
  const k=kurs(); const plan=$('plan');
  plan.classList.toggle('editor',editorAktiv);
  if(!k){ datumStreifen(0,0); $('heute-leer').classList.remove('hidden'); plan.innerHTML=''; return; }
  $('heute-leer').classList.add('hidden');
  const idx=tagesStandIndex(terminDatum);
  const sichtSchueler=sichtbareSchueler(k);
  const erfasst=sichtSchueler.filter(s=>{const st=idx.get(s.nr);return st&&(st.plus+st.neutral+st.minus)>0;}).length;
  datumStreifen(erfasst,sichtSchueler.length);
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
    liste.innerHTML='<h2>Ohne Sitzplatz</h2>'+ohnePlatz.map(s=>'<button class="btn still" class="u-m3" data-nr="'+s.nr+'">'+esc(s.vorname)+' '+esc(s.name)+(s.lb?' · LB':'')+'</button>').join('');
    liste.querySelectorAll('[data-nr]').forEach(b=>b.onclick=()=>waehleSchueler(Number(b.dataset.nr)));
  } else { const l=$('ohne-platz'); if(l) l.remove(); }
}
$('plan').addEventListener('pointerup',e=>{
  const kachel=e.target.closest('.kachel.schueler'); if(!kachel||busy) return;
  if($('plan').classList.contains('editor')) return;
  waehleSchueler(Number(kachel.dataset.nr));
});
function waehleSchueler(nr){
  aktiverSchueler=nr;
  renderHeute(); renderAktionsbar();
}
function pulseKachel(nr){
  const k=$('plan').querySelector('.kachel[data-nr="'+nr+'"]'); if(!k) return;
  k.classList.remove('puls'); void k.offsetWidth; k.classList.add('puls'); // Reflow-Re-Trigger (Werft flash_animation)
}
function renderAktionsbar(){
  const k=kurs(); const bar=$('aktionsbar');
  if(!k||aktiverSchueler===null){ bar.classList.add('hidden'); return; }
  const s=schuelerVonNr(aktiverSchueler); if(!s){ bar.classList.add('hidden'); return; }
  const typen=profilTypen(k);
  let html='<span class="wer">'+esc(s.vorname)+'</span>';
  for(const t of typen){
    const cls=t==='+'?' class="plus"':t==='-'?' class="minus"':'';
    html+='<button'+cls+' data-typ="'+t+'">'+({'+':'＋','o':'o','-':'−',mat:'📕',ipad_fehlt:'📱∅',ipad_leer:'🔋',lernzeit:'📝',ha:'HA'}[t]||t)+'</button>';
  }
  html+='<button data-blatt title="Verlauf ansehen">📖</button><button data-mehr>…</button><button data-zu>✕</button>';
  bar.innerHTML=html; bar.classList.remove('hidden');
  bar.querySelectorAll('[data-typ]').forEach(b=>b.onclick=()=>{
    if(busy) return; busy=true;
    const nr=aktiverSchueler;
    addEvent(b.dataset.typ,nr);
    b.style.borderColor='var(--band)';
    setTimeout(()=>{ b.style.borderColor=''; busy=false; },220);
    renderHeute();
    pulseKachel(nr);
  });
  bar.querySelector('[data-zu]').onclick=()=>{ aktiverSchueler=null; bar.classList.add('hidden'); renderHeute(); };
  bar.querySelector('[data-mehr]').onclick=()=>zeigeMehrAktionen(s);
  bar.querySelector('[data-blatt]').onclick=()=>schuelerBlatt(aktiverSchueler);
}
function zeigeMehrAktionen(s){
  dlgZeigen('<h3>'+esc(s.vorname)+' '+esc(s.name)+'</h3><div class="btn-reihe">'+
    '<button class="btn still" data-t="fehlt_e">fehlt (e)</button>'+
    '<button class="btn still" data-t="fehlt_u">fehlt (u)</button>'+
    '<button class="btn still" data-t="versp">zu spät…</button>'+
    '<button class="btn still" data-t="note">Note…</button>'+
    '<button class="btn still" data-t="notiz">Notiz…</button></div>'+
    '<div class="btn-reihe"><button class="btn still" data-schliessen>Schließen</button></div>',
    el=>{
      el.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{
        const t=b.dataset.t; dlgZu();
        if(t==='versp'){
          dlgZeigen('<h3>Verspätung</h3><input type="number" id="min-in" inputmode="numeric" placeholder="Minuten" min="1" max="67"><div class="btn-reihe"><button class="btn" data-ok>Eintragen</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
            d=>{ d.querySelector('[data-ok]').onclick=()=>{ const m=Number(d.querySelector('#min-in').value)||0; if(m>0){ addEvent('versp',s.nr,{minuten:m}); toast(esc(s.vorname)+': '+m+' min zu spät'); } dlgZu(); }; });
        } else if(t==='note'){
          const k=kurs(); const sek2=bewertProfil(k)==='sek2';
          const optionen=sek2?Array.from({length:16},(_,i)=>String(15-i)):Object.keys(DRITTELNOTEN);
          dlgZeigen('<h3>Direkte Note</h3><select id="note-in">'+optionen.map(o=>'<option>'+o+'</option>').join('')+'</select><div class="btn-reihe"><button class="btn" data-ok>Eintragen</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
            d=>{ d.querySelector('[data-ok]').onclick=()=>{ addEvent('note',s.nr,{wert:d.querySelector('#note-in').value}); dlgZu(); }; });
        } else if(t==='notiz'){
          dlgZeigen('<h3>Notiz</h3><textarea id="notiz-in" rows="3" class="u-textarea"></textarea><div class="btn-reihe"><button class="btn" data-ok>Speichern</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
            d=>{ d.querySelector('[data-ok]').onclick=()=>{ const txt=d.querySelector('#notiz-in').value.trim(); if(txt) addEvent('notiz',s.nr,{notiz:txt}); dlgZu(); }; });
        } else { addEvent(t,s.nr); renderHeute(); }
      });
    });
}

// Detail-Blatt vom Sitzplan aus (Master-Detail · „Schüler genauer betrachten" ohne Heute zu verlassen)
function schuelerBlatt(nr){
  const k=kurs(); const s=schuelerVonNr(nr); if(!k||!s) return;
  const v=verdichte(vault.events.filter(e=>e.kursId===k.id),nr,{profil:bewertProfil(k),lb:s.lb});
  dlgZeigen('<h3>'+esc(s.vorname)+' '+esc(s.name)+(s.lb?' · LB':'')+'</h3>'+schuelerDetailHtml(s,k,v)+
    '<div class="btn-reihe"><button class="btn still" data-schliessen>Schließen</button></div>',
    el=>{
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
let deckListe=[], deckIdx=0;
function renderDeck(){
  const k=kurs();
  if(!k){ $('deck-karte').innerHTML='<span class="sub">Kein Kurs gewählt.</span>'; $('deck-fortschritt').textContent=''; return; }
  if(!deckListe.length||deckListe._kurs!==k.id||deckListe._datum!==terminDatum){
    deckListe=[...sichtbareSchueler(k)]; deckListe._kurs=k.id; deckListe._datum=terminDatum; deckIdx=0;
  }
  zeigeDeckKarte();
}
function zeigeDeckKarte(){
  const karte=$('deck-karte');
  const total=deckListe.length;
  const erfasst=deckListe.filter(s=>{const st=standAmTermin(s.nr,terminDatum);return st.plus+st.neutral+st.minus>0;}).length;
  const balken='<div class="deck-bar"><div data-w="'+(total?100*erfasst/total:0)+'"></div></div>';
  const setzeBalken=()=>{ const d=$('deck-fortschritt').querySelector('[data-w]'); if(d) d.style.width=d.dataset.w+'%'; }; // CSSOM (CSP)
  if(deckIdx>=total){
    karte.innerHTML='<span class="gross">✓</span><span class="sub">'+total+' Karten durch · '+erfasst+' erfasst.</span>';
    $('deck-fortschritt').innerHTML='fertig · <b>'+erfasst+'</b> / '+total+' erfasst'+balken;
    setzeBalken();
    return;
  }
  const s=deckListe[deckIdx];
  $('deck-fortschritt').innerHTML='Karte '+(deckIdx+1)+' / '+total+' · <b>'+erfasst+'</b> erfasst'+balken;
  setzeBalken();
  karte.innerHTML='<span class="gross">'+esc(s.vorname)+'</span><span class="sub">'+esc(s.name)+(s.lb?' · LB':'')+'</span>';
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

/* ═══ SCHÜLER · Verdichtung + Inline-Detail-Akkordeon (kein Popup) ═══ */
let offenerSchueler=null;
function renderSchueler(){
  const k=kurs(); const wrap=$('view-schueler');
  if(!k){ wrap.innerHTML='<p class="u-leise">Kein Kurs gewählt.</p>'; return; }
  const kursEvents=vault.events.filter(e=>e.kursId===k.id);
  const offeneU=wirksameEvents(kursEvents).filter(e=>e.typ==='fehlt_u');
  let html='';
  if(offeneU.length){
    html+='<div class="panel"><h2>Wiedervorlage · offene u ('+offeneU.length+')</h2>'+
      offeneU.map(e=>{ const s=kursSchueler(k).find(x=>x.nr===e.schuelerNr);
        return '<div class="zeile"><span>'+esc(s?s.vorname+' '+s.name:'Nr '+e.schuelerNr)+' · '+datumLabel(e.datum)+'</span><button class="btn still" data-ue="'+e.id+'">→ e</button></div>'; }).join('')+'</div>';
  }
  html+='<div class="panel"><h2>'+esc(k.name)+' · Verdichtung</h2><p class="u-regelzeile">'+esc(regelText(bewertProfil(k)))+'</p>';
  for(const s of kursSchueler(k)){
    const v=verdichte(kursEvents,s.nr,{profil:bewertProfil(k),lb:s.lb});
    const sum=Math.max(1,v.nPlus+v.nNull+v.nMinus);
    const offen=offenerSchueler===s.nr;
    html+='<div class="s-block'+(offen?' offen':'')+'"><div class="s-item" data-nr="'+s.nr+'">'+
      '<div class="u-minw104"><b>'+esc(s.vorname)+'</b> <small class="u-leise">'+esc(s.name)+'</small>'+(s.lb?' <span class="lb-badge">LB</span>':'')+'</div>'+
      '<div class="u-flex1"><div class="balken"><div class="bal-p" data-w="'+(100*v.nPlus/sum)+'"></div><div class="bal-o" data-w="'+(100*v.nNull/sum)+'"></div><div class="bal-m" data-w="'+(100*v.nMinus/sum)+'"></div></div>'+
      '<small class="u-leise">'+v.nPlus+'⁺ '+v.nNull+'° '+v.nMinus+'⁻ · '+Math.round(100*v.aktivQuote)+'% · '+v.pfeil+'</small></div>'+
      '<div class="u-wert-rechts">'+(v.vorschlag?esc(v.vorschlag.label):'—')+'</div>'+
      '<span class="pfeil">'+(offen?'▾':'›')+'</span></div>'+
      (offen?schuelerDetailHtml(s,k,v):'')+'</div>';
  }
  html+='</div>';
  wrap.innerHTML=html;
  // dynamische Balken-Breiten via CSSOM (CSP: Inline-Style-Attribute in HTML-Strings sind verboten)
  wrap.querySelectorAll('.balken [data-w]').forEach(d=>{ d.style.width=d.dataset.w+'%'; });
  wrap.querySelectorAll('[data-ue]').forEach(b=>b.onclick=ev=>{ ev.stopPropagation();
    const e=vault.events.find(x=>x.id===b.dataset.ue);
    if(e){ addEvent('fehlt_e',e.schuelerNr,{datum:e.datum,stornoVon:e.id}); toast('Nachgetragen: entschuldigt ('+datumLabel(e.datum)+')'); renderSchueler(); }
  });
  wrap.querySelectorAll('.s-item').forEach(el=>el.onclick=()=>{ const nr=Number(el.dataset.nr); offenerSchueler=(offenerSchueler===nr?null:nr); mitUebergang(renderSchueler); });
  verdrahteDetail(wrap);
}
function schuelerDetailHtml(s,k,v){
  const evs=wirksameEvents(vault.events.filter(e=>e.kursId===k.id&&e.schuelerNr===s.nr));
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
        '<button class="btn still ev-storno" class="u-btn-klein" data-storno="'+e.id+'">↶</button></div>').join('')+'</div>';
  }
  if(!tage.length) liste='<p class="u-hinweis">Noch keine Einträge.</p>';
  return '<div class="s-detail">'+
    '<div class="zeile"><span>Beteiligung</span><span class="wert">'+v.beteiligtTermine+' / '+v.kursTermine+' Termine · Verlauf '+v.pfeil+'</span></div>'+
    (fehltE||fehltU||verspSum?'<div class="zeile"><span>Fehl / Verspätung</span><span class="wert">'+(fehltE?fehltE+'× e ':'')+(fehltU?fehltU+'× u ':'')+(verspSum?'· '+verspSum+' min':'')+'</span></div>':'')+
    '<div class="zeile"><span>Vorschlag</span><span class="wert">'+(v.vorschlag?esc(v.vorschlag.label):(s.lb?'— (LB)':'—'))+'</span></div>'+
    (v.vorschlag&&!s.lb?'<div class="btn-reihe"><button class="btn" data-quartal="'+s.nr+'">Als Quartalsnote setzen…</button></div>':'')+
    '<div class="tag-kopf" class="u-kopf-leise">Verlauf ('+evs.length+')</div>'+liste+'</div>';
}
function verdrahteDetail(wrap){
  wrap.querySelectorAll('.ev-storno').forEach(b=>b.onclick=e=>{ e.stopPropagation(); const ev=vault.events.find(x=>x.id===b.dataset.storno); if(ev){ stornoVon(ev); toast('storniert'); renderSchueler(); } });
  wrap.querySelectorAll('[data-quartal]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); const s=schuelerVonNr(Number(b.dataset.quartal)); const kk=kurs(); const v=verdichte(vault.events.filter(x=>x.kursId===kk.id),s.nr,{profil:bewertProfil(kk),lb:s.lb}); setzeQuartalsnote(s,v.vorschlag); });
}
function setzeQuartalsnote(s,vorschlag){
  const k=kurs(); const sek2=bewertProfil(k)==='sek2';
  const optionen=sek2?Array.from({length:16},(_,i)=>String(15-i)):Object.keys(DRITTELNOTEN);
  const vorwahl=sek2?String(vorschlag.wert):(wertZuLabel(vorschlag.wert)||'3');
  dlgZeigen('<h3>Quartalsnote · '+esc(s.vorname)+'</h3><p class="u-hinweis">Vorschlag: '+esc(vorschlag.label)+' — du entscheidest.</p>'+
    '<div class="zeile"><span>HJ</span><select id="q-hj"><option value="1">1. HJ</option><option value="2">2. HJ</option></select></div>'+
    '<div class="zeile"><span>Quartal</span><select id="q-q"><option value="1">Q1</option><option value="2">Q2</option></select></div>'+
    '<div class="zeile"><span>Note</span><select id="q-note">'+optionen.map(o=>'<option'+(o===vorwahl?' selected':'')+'>'+o+'</option>').join('')+'</select></div>'+
    '<div class="btn-reihe"><button class="btn" data-ok>Setzen</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
    el=>{ el.querySelector('[data-ok]').onclick=()=>{
      addEvent('quartalsnote',s.nr,{hj:Number(el.querySelector('#q-hj').value),quartal:Number(el.querySelector('#q-q').value),wert:el.querySelector('#q-note').value});
      toast('Quartalsnote gesetzt: '+el.querySelector('#q-note').value); dlgZu(); if(aktView==='schueler') renderSchueler();
    }; });
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

function renderKurse(){
  const wrap=$('view-kurse');
  let html='<div class="panel"><h2>Neuer Kurs</h2>'+
    '<p class="u-hinweis">Am schnellsten: in Excel die Klassenlisten-Spalten markieren (Nr · Name · Vorname · ggf. LB), kopieren, hier einfügen. Alternativ die kurs.json vom PC-Werkzeug laden.</p>'+
    '<div class="btn-reihe"><button class="btn" id="btn-kurs-neu">Kurs anlegen (Einfügen)</button>'+
    '<button class="btn still" id="btn-import-kurs">kurs.json laden</button></div>'+
    '<input type="file" id="file-kurs" accept=".json,application/json" class="hidden"></div>';
  for(const k of vault.stamm.kurse){
    const anz=kursSchueler(k).length;
    const p=vault.stamm.kursprofile[k.id]||{};
    html+='<div class="panel"><h2>'+esc(k.name)+' · '+esc(k.fach)+' <small class="u-notransform">('+k.profil+' · '+anz+' Schüler)</small></h2>'+
      '<div class="zeile"><span>Kladde-m-Slot (Export)</span><span><select data-slot="'+k.id+'">'+['m1','m2','m3','m4','m5','m6'].map(m=>'<option'+((k.slot||'m1')===m?' selected':'')+'>'+m+'</option>').join('')+'</select></span></div>'+
      (k.profil==='sek2'?'<div class="zeile"><span>Sek II · Noten-Eingabe</span><span><select data-notenmodus="'+k.id+'"><option value="punkte"'+((k.notenmodus||'punkte')==='punkte'?' selected':'')+'>Punkte 0–15</option><option value="drittel"'+(k.notenmodus==='drittel'?' selected':'')+'>Drittelnoten</option></select></span></div>':'')+
      '<div class="zeile"><span>HA-Typ aktiv (SekI-Schule: aus)</span><span><input type="checkbox" data-ha="'+k.id+'"'+(p.ha?' checked':'')+' class="u-check"></span></div>'+
      '<div class="btn-reihe">'+
      '<button class="btn still" data-plan-edit="'+k.id+'">Sitzplan bearbeiten</button>'+
      '<button class="btn still" data-slots="'+k.id+'">Stundenplan-Slots</button>'+
      '<button class="btn still" data-gruppen="'+k.id+'">Halbgruppen</button>'+
      '<button class="btn gefahr" data-kurs-weg="'+k.id+'">Entfernen</button></div></div>';
  }
  wrap.innerHTML=html;
  $('btn-kurs-neu').onclick=kursAnlegenDialog;
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
  wrap.querySelectorAll('[data-kurs-weg]').forEach(b=>b.onclick=()=>{
    dlgZeigen('<h3>Kurs entfernen?</h3><p class="u-leise">Ereignisse bleiben im Log (Storno-Prinzip), aber der Kurs verschwindet aus allen Listen.</p><div class="btn-reihe"><button class="btn gefahr" data-ok>Entfernen</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
      el=>{ el.querySelector('[data-ok]').onclick=()=>{ vault.stamm.kurse=vault.stamm.kurse.filter(x=>x.id!==b.dataset.kursWeg); stammMutiert(); speichern(); if(aktiverKursId===b.dataset.kursWeg) aktiverKursId=null; dlgZu(); renderKurse(); aktualisiereKursChip(); }; });
  });
  wrap.querySelectorAll('[data-plan-edit]').forEach(b=>b.onclick=()=>sitzplanEditor(b.dataset.planEdit));
  wrap.querySelectorAll('[data-slots]').forEach(b=>b.onclick=()=>slotsEditor(b.dataset.slots));
  wrap.querySelectorAll('[data-gruppen]').forEach(b=>b.onclick=()=>gruppenEditor(b.dataset.gruppen));
}
function sitzplanEditor(kursId){
  aktiverKursId=kursId; aktualisiereKursChip();
  aktView='heute';
  document.querySelectorAll('nav.tabs button').forEach(x=>x.classList.toggle('aktiv',x.dataset.view==='heute'));
  ['heute','deck','schueler','kurse','mehr'].forEach(v=>$('view-'+v).classList.toggle('hidden',v!=='heute'));
  editorAktiv=true;
  renderHeute();
  const plan=$('plan');
  toast('Editor: leere Kachel antippen → Schüler wählen · Schüler antippen → entfernen',5200);
  const k=kurs();
  const handler=e=>{
    const kachel=e.target.closest('.kachel'); if(!kachel) return;
    e.stopPropagation();
    const idx=[...plan.children].indexOf(kachel);
    const r=Math.floor(idx/12), c=idx%12;
    const sp=vault.stamm.sitzplaene[k.id]=vault.stamm.sitzplaene[k.id]||{grid:{}};
    const key=r+','+c;
    if(sp.grid[key]){ delete sp.grid[key]; stammMutiert(); speichern(); renderHeute(); return; }
    const vergeben=new Set(Object.values(sp.grid));
    const frei=kursSchueler(k).filter(s=>!vergeben.has(s.nr));
    dlgZeigen('<h3>Platz '+(r+1)+'/'+(c+1)+'</h3><input type="text" id="s-such" placeholder="Name tippen…" list="s-liste"><datalist id="s-liste">'+
      frei.map(s=>'<option value="'+esc(s.vorname+' '+s.name+' ('+s.nr+')')+'">').join('')+'</datalist>'+
      '<div class="u-scroll30">'+frei.map(s=>'<button class="btn still" class="u-btn-block u-eng" data-setz="'+s.nr+'">'+esc(s.vorname)+' '+esc(s.name)+'</button>').join('')+'</div>'+
      '<div class="btn-reihe"><button class="btn still" data-schliessen>Abbrechen</button></div>',
      el=>{
        const setze=nr=>{ sp.grid[key]=nr; stammMutiert(); speichern(); dlgZu(); renderHeute(); };
        el.querySelectorAll('[data-setz]').forEach(x=>x.onclick=()=>setze(Number(x.dataset.setz)));
        el.querySelector('#s-such').oninput=ev2=>{
          const m=ev2.target.value.match(/\((\d+)\)/); if(m) setze(Number(m[1]));
        };
        setTimeout(()=>el.querySelector('#s-such').focus(),60);
      });
  };
  plan.addEventListener('pointerup',handler);
  const fertigBtn=document.createElement('button');
  fertigBtn.className='btn'; fertigBtn.textContent='Sitzplan fertig'; fertigBtn.style.cssText='position:fixed;left:12px;bottom:calc(env(safe-area-inset-bottom) + 84px);z-index:40';
  fertigBtn.onclick=()=>{ editorAktiv=false; plan.removeEventListener('pointerup',handler); fertigBtn.remove(); renderHeute(); };
  document.body.appendChild(fertigBtn);
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
    '<div class="zeile"><span>Regel</span><span class="wert" class="u-maxw55">'+esc(regelText(bewertProfil(kurs())))+'</span></div></div>';
  const standalone=window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
  $('dg-mode').textContent=standalone?'standalone (installiert)':'Browser-Tab';
  if(navigator.storage?.persisted) navigator.storage.persisted().then(p=>$('dg-persist').textContent=p?'gewährt':'nicht gewährt');
  if(navigator.storage?.estimate) navigator.storage.estimate().then(e=>{ const mb=n=>(n/1048576).toFixed(1)+' MB'; $('dg-quota').textContent=mb(e.usage||0)+' / '+mb(e.quota||0); });
  $('btn-export').onclick=exportiereContainer;
  $('btn-import').onclick=()=>$('file-cont').click();
  $('file-cont').onchange=importiereContainer;
  $('sec-lockmin').onchange=e=>{ localStorage.setItem('kladde_lock_min',e.target.value); toast('Auto-Lock: '+e.target.value+' min'); };
  $('sec-sofort').onchange=e=>localStorage.setItem('kladde_lock_sofort',e.target.checked?'1':'0');
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
function merkeExport(){ if(vault) idbPut('letzterExport',{ts:Date.now(),events:vault.events.length}); }
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
document.body.classList.toggle('beamer',beamerModus); $('btn-beamer').classList.toggle('aktiv',beamerModus);
lockInit();