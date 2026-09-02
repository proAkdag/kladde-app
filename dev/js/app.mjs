// Kladde · js/app.mjs — Bootstrap + UI (P1.1-A1: mechanischer Umzug aus index.html v0.7, verhaltensneutral)
// Logik lebt in ../logic/*.mjs — App und Tests importieren DIESELBEN Dateien (Drift unmöglich).
import { DRITTELNOTEN, wertZuLabel, drittelnoteLabel, noteAlsWert } from '../logic/skalen.mjs?v=1.9.1.1788379122';
import { verdichte, wirksameEvents, regelText, vorschlagsZeilen, quartalsVerlauf, kursEinordnung, notenAbstand } from '../logic/verdichtung.mjs?v=1.9.1.1788379122';
import { mergeContainerDaten } from '../logic/merge.mjs?v=1.9.1.1788379122';
import { decodeContainerAuto, encodeContainerV2, wechslePassphrase, neueV2Identitaet, dekRohMitPassphrase, decodeContainerMitDek, importDekKey, leseHeader } from '../logic/container.mjs?v=1.9.1.1788379122';
import { bioWrap, bioUnwrap } from '../logic/biometrie.mjs?v=1.9.1.1788379122';
import { parseSchuelerListe, MAX_SCHUELER } from '../logic/parser.mjs?v=1.9.1.1788379122';
import { migriereStamm, schemaBekannt, standardZeitraeume } from '../logic/migration.mjs?v=1.9.1.1788379122';
import { resolveBloecke, formatZeit, blockLabel, istAWoche, istFerien } from '../logic/zeitmodell.mjs?v=1.9.1.1788379122';
import { kursZurZeit, slotFuerBlock, geplanteBlockNrn, bereinigeAusnahmen, SLOT_ARTEN } from '../logic/autowahl.mjs?v=1.9.1.1788379122';
import { sortiereKurse } from '../logic/kursSort.mjs?v=1.9.1.1788379122';
import { entferneNachrueckend, listenAbgleich, wendeAbgleichAn } from '../logic/teilnehmer.mjs?v=1.9.1.1788379122';
import { schuelerBericht } from '../logic/bericht.mjs?v=1.9.1.1788379122';
import { RASTER_VORLAGEN, KURZRASTER_45 } from '../logic/rasterVorlagen.mjs?v=1.9.1.1788379122';
import { kursStatus } from '../logic/kursStatus.mjs?v=1.9.1.1788379122';
import { zufallsGewicht, gewichteteWahl } from '../logic/auswahl.mjs?v=1.9.1.1788379122';
import { lieseMappe, xlsxLesbar } from '../logic/mappe.mjs?v=1.9.1.1788379122';
import { fachFarbe, fachKuerzel, FACH_LISTE, WAEHLER_HUES } from '../logic/fachfarben.mjs?v=1.9.1.1788379122';
const APP_VERSION = '1.9.1';
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
function idbDel(k){ return mitDb().then(d=>new Promise((res,rej)=>{ const tx=d.transaction('meta','readwrite'); tx.objectStore('meta').delete(k); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); })); }

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

/* ═══ ICONS · Linien-Duktus (Zero-Freigabe 2026-09-02 · Prüfstand W5.1 Emoji→SVG) ═══
   24er Raster · Strich 1,7 · runde Enden · currentColor. EINE Datenquelle, zwei Renderer:
   iconEl() für el()-Views (createElementNS, CSP-sauber), iconHtml() für die HTML-String-Renderer im Bestand.
   Primitive: ['p', d] Pfad · ['c', cx, cy, r] Kreis · ['cf', cx, cy, r] gefüllter Punkt · ['r', x, y, w, h, rx] Rechteck.
   Vorlage + Entscheide: design/ICONS_VORSCHAU_2026-09-02.html. Kachel-Marken zeichnen mit Strich 2,4 (CSS .mk .ico). */
const ICON={
  plus:[['p','M12 5v14M5 12h14']],
  neutral:[['c',12,12,6]],
  minus:[['p','M5 12h14']],
  note:[['p','M5 20v-7M12 20V5M19 20v-9M3 20h18']],
  abwesend:[['c',12,12,7.5],['p','M7 17 17 7']],
  entsch:[['p','M5 12.5l4.5 4.5L19 7']],
  unentsch:[['p','M6 6l12 12M18 6 6 18']],
  versp:[['c',12,12.5,7.5],['p','M12 8.5v4.5l3 2M5 4 3 6M19 4l2 2']],
  ipad:[['r',5,3,14,18,2],['p','M10.5 17.5h3']],
  material:[['p','M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z'],['p','M4 19a2 2 0 0 1 2-2h13']],
  lernzeit:[['r',5,3,14,18,2],['p','M9 8h6M9 12h6M9 16h3']],
  notiz:[['p','M4 20l4-1L19 8a2.1 2.1 0 0 0-3-3L5 16z'],['p','M14 6l3 3']],
  best:[['p','M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z']],
  verweigert:[['c',12,12,8],['p','M8 12h8']],
  entfernen:[['p','M9 5h11a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 20 19H9l-6-7z'],['p','M12 9.5l5 5M17 9.5l-5 5']],
  mond:[['p','M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z']],
  sonne:[['c',12,12,4],['p','M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4']],
  auge:[['p','M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z'],['c',12,12,2.8]],
  augeZu:[['p','M3 3l18 18M10.6 5.9A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 3.9M6.6 6.6C3.9 8.6 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.5 0 2.8-.3 4-.9'],['p','M9.9 9.9a2.9 2.9 0 0 0 4.1 4.1']],
  schloss:[['r',5,11,14,10,2],['p','M8 11V8a4 4 0 0 1 8 0v3']],
  wuerfel:[['r',3,3,18,18,3],['cf',8,8,1.3],['cf',16,8,1.3],['cf',12,12,1.3],['cf',8,16,1.3],['cf',16,16,1.3]],
  papierkorb:[['p','M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3']],
  erneut:[['p','M20 12a8 8 0 1 1-2.3-5.7'],['p','M20 4v5h-5']],
  drucken:[['p','M6 9V3h12v6'],['p','M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2'],['p','M6 14h12v7H6z']],
  kopieren:[['r',9,9,11,11,2],['p','M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1']],
  rueck:[['p','M9 14 4 9l5-5'],['p','M4 9h10a6 6 0 0 1 0 12h-3']],
  wieder:[['p','m15 14 5-5-5-5'],['p','M20 9H10a6 6 0 0 0 0 12h3']],
  mischen:[['p','M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5']],
  warnung:[['p','M12 3 2 21h20z'],['p','M12 9.5v5M12 17.5v.3']],
  schliessen:[['p','M6 6l12 12M18 6 6 18']],
};
const SVG_NS='http://www.w3.org/2000/svg';
function iconEl(key){
  const svg=document.createElementNS(SVG_NS,'svg');
  svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('class','ico'); svg.setAttribute('aria-hidden','true');
  for(const [t,...a] of ICON[key]){
    let e;
    if(t==='p'){ e=document.createElementNS(SVG_NS,'path'); e.setAttribute('d',a[0]); }
    else if(t==='r'){ e=document.createElementNS(SVG_NS,'rect'); e.setAttribute('x',a[0]); e.setAttribute('y',a[1]); e.setAttribute('width',a[2]); e.setAttribute('height',a[3]); e.setAttribute('rx',a[4]); }
    else { e=document.createElementNS(SVG_NS,'circle'); e.setAttribute('cx',a[0]); e.setAttribute('cy',a[1]); e.setAttribute('r',a[2]); if(t==='cf'){ e.setAttribute('fill','currentColor'); e.setAttribute('stroke','none'); } }
    svg.append(e);
  }
  return svg;
}
function iconHtml(key){
  return '<svg viewBox="0 0 24 24" class="ico" aria-hidden="true">'+ICON[key].map(([t,...a])=>
    t==='p'?'<path d="'+a[0]+'"/>'
    :t==='r'?'<rect x="'+a[0]+'" y="'+a[1]+'" width="'+a[2]+'" height="'+a[3]+'" rx="'+a[4]+'"/>'
    :'<circle cx="'+a[0]+'" cy="'+a[1]+'" r="'+a[2]+'"'+(t==='cf'?' fill="currentColor" stroke="none"':'')+'/>').join('')+'</svg>';
}
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
  // Fingerabdruck (Zero 2026-09-02): nur wenn eine Bio-Hülle liegt UND der Browser WebAuthn kann — sonst bleibt der Knopf weg
  const bio=neu?null:await idbGet('bio');
  const bioBtn=$('lock-bio');
  bioBtn.classList.toggle('hidden',!(bio&&bioVerfuegbar()));
  bioBtn.onclick=()=>bioEntsperren(bio);
  if(bio&&bioVerfuegbar()) $('lock-text').textContent='Fingerabdruck oder Passphrase';
  setTimeout(()=>{ if(!(bio&&bioVerfuegbar())) $('pin').focus(); },50);   // mit Bio-Hülle keine Tastatur hochschieben
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
    $('pin-auge').replaceChildren(iconEl(zeigt?'auge':'augeZu'));
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
          bereinigeAusnahmen(vault.stamm); // folgenlose Entfälle auf freien Stunden räumen (2026-09-02)
          await speichern(); // erste v2-Schreibung — erst NACH verifiziertem Backup
          migrationsHinweis=true;
          console.log('[kladde] v1→v2 migriert (Backup verifiziert) in',Math.round(performance.now()-t0),'ms');
        } else {
          dekKey=r.dek; containerKopf=r.kopf;
          vault=r.daten; pinRam=pin;
          const migriert=migriereStamm(vault); // Schema-Nachzug (v0.8-Bestand → kladde/v2)
          if(bereinigeAusnahmen(vault.stamm)||migriert) speichern(); // + folgenlose Entfälle auf freien Stunden räumen (2026-09-02)
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
/* ═══ FINGERABDRUCK / FACE ID · WebAuthn-Passkey mit PRF (Zero 2026-09-02) ═══
   Kryptografie in logic/biometrie.mjs (Node-getestet). Hier nur die WebAuthn-Geste und der Vault-Weg.
   Paket in IndexedDB 'bio': {credId, prfSalt, salt, iv, wrappedDek, angelegt}. Rückweg immer die Passphrase.
   pinRam bleibt nach Bio-Unlock null — Import/Pull fragen die Passphrase dann einmalig ab (passphraseAbfragen). */
const BIO_RP=()=>({name:'Kladde',id:location.hostname});
function bioVerfuegbar(){ return !!(window.PublicKeyCredential&&navigator.credentials&&navigator.credentials.get&&window.isSecureContext); }
// PRF-Geheimwert für eine bestehende Hülle holen (Touch/Face ID) — Nutzergeste nötig
async function bioSecret(bio){
  const cred=await navigator.credentials.get({publicKey:{
    challenge:crypto.getRandomValues(new Uint8Array(32)), rpId:BIO_RP().id, userVerification:'required', timeout:60000,
    allowCredentials:[{type:'public-key',id:bio.credId}],
    extensions:{prf:{eval:{first:bio.prfSalt}}}}});
  const prf=cred.getClientExtensionResults().prf;
  if(!prf||!prf.results||!prf.results.first) throw new Error('Dieses Gerät liefert keinen PRF-Wert — Fingerabdruck-Hülle hier nicht nutzbar');
  return new Uint8Array(prf.results.first);
}
async function bioEntsperren(bio){
  const btn=$('lock-bio'); btn.disabled=true; $('lock-fehler').textContent='';
  const t0=performance.now();
  try{
    const secret=await bioSecret(bio);
    const dekRoh=await bioUnwrap(bio,secret); secret.fill(0);
    const key=await importDekKey(dekRoh); dekRoh.fill(0);
    const roh=await idbGet('vault');
    const r=await decodeContainerMitDek(roh,key);
    dekKey=r.dek; containerKopf=r.kopf; vault=r.daten; pinRam=null;
    const migriert=migriereStamm(vault);
    if(bereinigeAusnahmen(vault.stamm)||migriert) speichern();
    console.log('[kladde] Unlock (Fingerabdruck) in',Math.round(performance.now()-t0),'ms');
    entsperrt();
  }catch(e){
    // AbortError/NotAllowedError = Nutzer hat abgebrochen — kein Alarm, Passphrase bleibt der Weg
    $('lock-fehler').textContent=(e.name==='NotAllowedError'||e.name==='AbortError')?'Abgebrochen — Passphrase eingeben oder erneut versuchen.':e.message;
  }
  btn.disabled=false;
}
// Einrichtung aus Mehr → Sicherheit. Braucht die Passphrase (DEK-Rohbytes) UND eine Nutzergeste.
async function bioEinrichten(){
  if(!bioVerfuegbar()){ toast('Dieser Browser kann kein WebAuthn — Fingerabdruck hier nicht möglich',4500); return; }
  const pin=pinRam||await passphraseAbfragen('Zum Einrichten einmal die Passphrase');
  if(!pin) return;
  try{
    const roh=await idbGet('vault');
    const dekRoh=await dekRohMitPassphrase(roh,pin);
    pinRam=pin;
    const userId=crypto.getRandomValues(new Uint8Array(16));
    const cred=await navigator.credentials.create({publicKey:{
      rp:BIO_RP(), user:{id:userId,name:'kladde'+(IST_DEV?'-dev':''),displayName:'Kladde'+(IST_DEV?' DEV':'')},
      challenge:crypto.getRandomValues(new Uint8Array(32)), timeout:60000,
      pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
      authenticatorSelection:{authenticatorAttachment:'platform',residentKey:'required',userVerification:'required'},
      extensions:{prf:{}}}});
    const ext=cred.getClientExtensionResults();
    if(!ext.prf||!ext.prf.enabled){ dekRoh.fill(0); toast('Passkey angelegt, aber ohne PRF-Erweiterung — dieses Gerät/System kann die Hülle nicht bilden (iPadOS 18+ nötig). Nichts gespeichert.',7000); return; }
    const prfSalt=crypto.getRandomValues(new Uint8Array(32));
    const bioTeil={credId:new Uint8Array(cred.rawId),prfSalt};
    const secret=await bioSecret(bioTeil);                 // zweite Geste: PRF-Wert dieses Passkeys
    const paket=await bioWrap(dekRoh,secret); dekRoh.fill(0); secret.fill(0);
    await idbPut('bio',{...bioTeil,...paket,angelegt:new Date().toISOString()});
    toast('Fingerabdruck eingerichtet — beim nächsten Öffnen erscheint der Knopf',4500);
    renderMehr();
  }catch(e){
    toast((e.name==='NotAllowedError'||e.name==='AbortError')?'Abgebrochen — nichts gespeichert':'⚠ Einrichtung: '+e.message,5000);
  }
}
async function bioEntfernen(){ await idbDel('bio'); toast('Fingerabdruck entfernt — es gilt wieder nur die Passphrase'); renderMehr(); }
// Passphrase nachfragen (nach Fingerabdruck-Unlock für Import/Pull/Einrichtung) → Promise<string|null>
function passphraseAbfragen(titel){
  return new Promise(res=>{
    const inp=el('input',{type:'password',autocomplete:'off',class:'u-w170'});
    dlgZeigenEl(el('h3',{},titel||'Passphrase'),
      el('p',{class:'u-hinweis'},'Nach dem Öffnen per Fingerabdruck kennt die Kladde deine Passphrase nicht — für diesen Schritt wird sie einmal gebraucht.'),
      el('div',{class:'zeile'},el('span',{},'Passphrase'),el('span',{},inp)),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn',onclick:()=>{ const v=inp.value; dlgZu(); res(v||null); }},'Weiter'),
        el('button',{class:'btn still',onclick:()=>{ dlgZu(); res(null); }},'Abbrechen')));
    inp.onkeydown=e=>{ if(e.key==='Enter'){ const v=inp.value; dlgZu(); res(v||null); } };
    setTimeout(()=>inp.focus(),60);
  });
}
function sperren(){
  // Hard-Lock: RAM-Wipe + UI-Hygiene (§5) — nach dem Sperren darf kein Name mehr im DOM stehen
  vault=null; pinRam=null; dekKey=null; containerKopf=null;
  aktiverSchueler=null; offenerSchueler=null; deckListe=[]; deckVerlauf=[]; undoStack.length=0;
  stempelAus(); // RAM-Wipe: kein scharfer Stempel/Modus-Rahmen hinter dem Lock
  if(editorCleanup){ try{ editorCleanup(); }catch{} } // Sitzplan-Editor-Leiste + Listener räumen
  try{ dlgZu(); }catch{}
  $('dlg').innerHTML='';
  // Views leeren — der Lock verdeckt nur visuell; Find-in-Page/Screenreader läsen die Namen sonst weiter
  $('plan').replaceChildren(); $('datum-streifen').replaceChildren(); $('rail').replaceChildren();
  const op=$('ohne-platz'); if(op) op.remove();
  $('deck-karte').replaceChildren(); $('deck-fortschritt').textContent='';
  $('deck-optionen').replaceChildren(); $('deck-verlauf').replaceChildren(); $('deck-verlauf').classList.add('hidden');
  ['schueler','kurse','mehr'].forEach(v=>$('view-'+v).replaceChildren());
  $('kurs-name').textContent='Kein Kurs'; $('kurs-slot').textContent='';
  $('toast').classList.add('hidden'); $('toast').textContent='';
  $('undo-chip').classList.add('hidden'); $('undo-chip').textContent='';
  $('soft-lock').classList.add('hidden');
  lockInit();
}
function lockMinuten(){ const m=Number(localStorage.getItem('kladde_lock_min')); return [5,10,15,30].includes(m)?m:15; }
// P2.6 · Unterrichtsbewusster Hard-Lock: während eines laufenden Blocks (+10 min Nachlauf)
// nicht aussperren — sonst erzwingt die 67,5-min-Stunde die Passphrase vor der Klasse.
function unterrichtAktiv(){
  const zm=(vault?.stamm.zeitmodelle||[])[0]; if(!zm) return false;
  const j=new Date(); const wtag=((j.getDay()+6)%7)+1; if(wtag>5) return false;
  if(istFerien(zm,heuteIso())) return false;   // Ferien: kein Unterricht, normaler Auto-Lock
  const sek=j.getHours()*3600+j.getMinutes()*60+j.getSeconds();
  return resolveBloecke(zm,wtag,heuteIso()).some(b=>b.startSek<=sek&&sek<=b.endeSek+600); // Kurztag: Auto-Lock-Pause endet mit dem 45er-Tag (S256b)
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
    kursAutowahl(); // Rückkehr in die App: Block könnte gewechselt haben (Handwahl hält bis Blockwechsel)
    if(aktView==='heute') renderHeute();
  }
});
window.addEventListener('pagehide',()=>{ if(vault) speichern(); });
$('btn-lock').addEventListener('click',()=>{ speichern().then(sperren); });

/* ═══ ZUSTAND-HELPERS ═══ */
let aktiverKursId=null, terminDatum=heuteIso(), aktiverSchueler=null, undoStack=[];
function heuteIso(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function kurs(){ return vault?.stamm.kurse.find(k=>k.id===aktiverKursId)||null; }
function kursSchueler(k){ return (vault.stamm.schueler[k.id]||[]).filter(s=>!s.inaktiv); } // Deaktivierte (Tombstone) bleiben im Stamm, aber aus allen Listen/Plänen
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
function zeigeUndo(e){
  const s=schuelerVonNr(e.schuelerNr);
  chipZeig('rueck',(s?s.vorname:'Nr '+e.schuelerNr)+': '+(TYP_LABEL[e.typ]||e.typ),
    ()=>{ stornoVon(e); toast('Rückgängig: '+(TYP_LABEL[e.typ]||e.typ)); renderHeute(); zeigeRedo(e); });
}
// Storniertes Original mit einem Tap wieder einbuchen — append-only bleibt gewahrt (kein Löschen,
// der Storno bleibt im Log; addEvent stempelt id/ts frisch, alle Sachfelder reisen mit).
function bucheErneut(e){
  const {id:_id,ts:_ts,geraet:_ge,stornoVon:_sv,typ,schuelerNr,...sach}=e;
  return addEvent(typ,schuelerNr,sach);
}
function zeigeRedo(e){
  const s=schuelerVonNr(e.schuelerNr);
  chipZeig('wieder',(s?s.vorname:'Nr '+e.schuelerNr)+': '+(TYP_LABEL[e.typ]||e.typ)+' wiederherstellen',
    ()=>{ bucheErneut(e); toast('Wiederhergestellt: '+(TYP_LABEL[e.typ]||e.typ)); renderHeute(); });
}
function schuelerVonNr(nr){ const k=kurs(); return k?kursSchueler(k).find(s=>s.nr===nr):null; }

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
    el('h3',{},iconEl('auge'),' Projektionsmodus'),
    el('p',{class:'u-hinweis'},'Bewertungen und LB-Hinweise sind bei aktiver Projektion immer verborgen.'),
    opt('kladde_beamer_kurz','Namen abkürzen (E. Y.)'),
    opt('kladde_beamer_nurplan','Nur Sitzplan (Datums-Extras aus)'),
    el('div',{class:'btn-reihe'},el('button',{class:'btn',onclick:dlgZu},'Fertig')));
}

/* ═══ KURS-AUTOWAHL über Stundenplan-Slots (freie Zeitfenster · 67,5-min-Schule) ═══ */
let autowahlInfo=null;   // {kursId, blockNr, startSek, endeSek, quelle} — für Heute-Kopf (§28)
// Handwahl (Zero-Entscheid 2026-09-02, Variante 1): die Kurs-Chip-Wahl hält BIS ZUM BLOCKWECHSEL — auch über
// Sperren/Entsperren und Neuladen hinweg. Gerätelokal in localStorage (nur Kurs-Id + Block, keine Schülerdaten);
// vorher war sie ein RAM-Flag, das jeder harte Autowahl-Lauf (Entsperren, Stundenplan speichern) überschrieb.
const HANDWAHL_KEY='kladde_handwahl';
function handwahlLesen(){ try{ const h=JSON.parse(localStorage.getItem(HANDWAHL_KEY)||'null'); return h&&h.datum===heuteIso()?h:null; }catch{ return null; } }
function handwahlSetzen(h){ if(h) localStorage.setItem(HANDWAHL_KEY,JSON.stringify(h)); else localStorage.removeItem(HANDWAHL_KEY); }
function kursAutowahl(){
  if(!vault) return;
  const jetzt=new Date();
  const zm=(vault.stamm.zeitmodelle||[])[0];
  autowahlInfo=null;
  let hand=handwahlLesen();
  if(hand&&!vault.stamm.kurse.some(k=>k.id===hand.kursId&&k.status!=='archiviert')){ handwahlSetzen(null); hand=null; }   // Kurs weg/archiviert → Handwahl gegenstandslos
  const handAnwenden=(bisSek)=>{ aktiverKursId=hand.kursId; aktiveTeilgruppe=hand.teilgruppe||null; $('kurs-slot').textContent=' · von Hand'+(bisSek!=null?' · bis '+formatZeit(bisSek):'')+(hand.teilgruppe?' · Gr. '+hand.teilgruppe:''); };
  if(zm){
    const t=kursZurZeit(jetzt,{zeitmodell:zm,wochenplan:vault.stamm.wochenplan||[],ausnahmen:vault.stamm.ausnahmeSlots||[]});
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
        if(t.kursId){ aktiverKursId=t.kursId; aktiveTeilgruppe=t.teilgruppe||null; }
        else if(!aktiverKursId||kursIstArchiviert(aktiverKursId)) aktiverKursId=ersterKursId();
        $('kurs-slot').textContent=' · Std. '+blockLabel(zm,t.blockNr,heuteIsoStr)+' · '+formatZeit(block.startSek)+'–'+formatZeit(block.endeSek)+(t.art?' · '+SLOT_ARTEN[t.art].label:'')+(t.teilgruppe?' · Gr. '+t.teilgruppe:'')+(t.quelle==='kommend'?' (gleich)':'');
      }
      aktualisiereKursChip(); return;
    }
  }
  if(hand){ handAnwenden(null); aktualisiereKursChip(); return; }   // Pause/Freistunde: die Handwahl bleibt bis zum nächsten Block
  // Fallback: Alt-Slots (Expertenmodus, freie Zeitfenster) — bleibt, solange kein Wochenplan existiert
  const wtag=((jetzt.getDay()+6)%7)+1;
  const hhmm=String(jetzt.getHours()).padStart(2,'0')+':'+String(jetzt.getMinutes()).padStart(2,'0');
  const slot=vault.stamm.stundenplanSlots.find(s=>s.wochentag===wtag&&s.von<=hhmm&&hhmm<=s.bis);
  if(slot){ aktiverKursId=slot.kursId; aktiveTeilgruppe=slot.teilgruppe||null; $('kurs-slot').textContent=' · '+slot.von+'–'+slot.bis+(slot.teilgruppe?' · Gr. '+slot.teilgruppe:''); }
  else if(!aktiverKursId||kursIstArchiviert(aktiverKursId)) aktiverKursId=ersterKursId();
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
// 60-s-Tick (P2.5): nur bei sichtbarer Heute-Ansicht, nie über offene Dialoge hinweg
let autowahlTick=null;
function starteAutowahlTick(){
  clearInterval(autowahlTick);
  autowahlTick=setInterval(()=>{
    if(!vault||document.visibilityState!=='visible'||aktView!=='heute'||$('dlg').open) return;
    const vorher=aktiverKursId;
    kursAutowahl();
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
    sortiereKurse(vault.stamm.kurse).map(x=>'<button class="btn'+(k&&x.id===k.id?'':' still')+' u-btn-block" data-kurs="'+x.id+'">'+esc(x.name)+' · '+esc(x.fach)+'</button>').join('')+
    '<div class="zeile"><span>Teilgruppe</span><span><select id="tg-sel"><option value="">alle</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select></span></div>'+
    '<div class="btn-reihe"><button class="btn still" data-schliessen>Schließen</button></div>',
    el=>{
      // Der Stundenplan wohnt seit S257b als eigenes Symbol in der Kopfleiste (#btn-plan) — nicht mehr hier versteckt (Zero).
      // Griff „Diese Stunde fällt aus" (S257): nur wenn JETZT laut Plan eine Stunde läuft/ansteht.
      // Ein-Tap-Entfall via ausnahmeSlots; steht der Entfall schon, wird der Knopf zum Rückweg.
      const zmA=(vault.stamm.zeitmodelle||[])[0];
      const jetzt=new Date(), wtJetzt=((jetzt.getDay()+6)%7)+1;
      if(zmA&&wtJetzt<=5){
        const planJetzt=kursZurZeit(jetzt,{zeitmodell:zmA,wochenplan:vault.stamm.wochenplan||[],ausnahmen:[]}); // Plan OHNE Ausnahmen — welcher Block wäre dran?
        if(planJetzt){
          const heuteD=heuteIso();
          const a=ausnahmeFuer(heuteD,planJetzt.blockNr);
          const entfallen=a&&a.kursId===null;
          const kPlan=vault.stamm.kurse.find(x=>x.id===planJetzt.kursId);
          const lbl=blockLabel(zmA,planJetzt.blockNr,heuteD);
          const btn=document.createElement('button');
          btn.className='btn '+(entfallen?'still':'gefahr');
          btn.textContent=entfallen?('Entfall zurücknehmen (Std. '+lbl+')'):('Std. '+lbl+' fällt aus'+(kPlan?' ('+kPlan.name+')':planJetzt.art?' ('+SLOT_ARTEN[planJetzt.art].label+')':''));
          btn.onclick=()=>{
            if(entfallen){ entferneAusnahme(heuteD,planJetzt.blockNr); toast('Entfall zurückgenommen — es gilt der Plan'); }
            else { setzeAusnahme(heuteD,planJetzt.blockNr,null,'entfall'); toast('Std. '+lbl+' heute: Entfall vermerkt'); }
            dlgZu(); kursAutowahl();
            if(!autowahlInfo) $('kurs-slot').textContent='';   // kein Block mehr aktiv → alten Slot-Text nicht stehen lassen
            if(aktView==='heute') renderHeute();
          };
          const reihe=el.querySelector('.btn-reihe'); if(reihe) reihe.prepend(btn);
        }
      }
      el.querySelector('#tg-sel').value=aktiveTeilgruppe||'';
      // Handwahl speichern (Variante 1): gebunden an den laufenden Block — der nächste Block löst sie wieder
      el.querySelectorAll('[data-kurs]').forEach(b=>b.onclick=()=>{
        handwahlSetzen({kursId:b.dataset.kurs,teilgruppe:el.querySelector('#tg-sel').value||null,datum:heuteIso(),blockNr:autowahlInfo?.blockNr??null});
        dlgZu(); kursAutowahl(); mitUebergang(renderAlles); });
      el.querySelector('#tg-sel').onchange=e=>{ aktiveTeilgruppe=e.target.value||null; const h=handwahlLesen(); if(h){ h.teilgruppe=aktiveTeilgruppe; handwahlSetzen(h); } renderHeute(); };
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
$('btn-plan').addEventListener('click',()=>{ if(vault) stundenplanAnsicht(); });   // Stundenplan direkt aus der Kopfleiste (S257b · Zero)

/* ═══ THEME · Tag/Nacht/System · Default Nacht (Zero-Entscheid E1) ═══ */
const THEME_KEY='kladde_theme';
const themePref=()=>{ const t=localStorage.getItem(THEME_KEY); return (t==='tag'||t==='nacht'||t==='system')?t:'nacht'; };
const themeHell=()=>matchMedia('(prefers-color-scheme: light)').matches;
const themeEff=()=>{ const p=themePref(); return p==='system'?(themeHell()?'tag':'nacht'):p; };
function themeAnwenden(){
  const eff=themeEff();
  document.documentElement.dataset.theme=eff;
  const mc=document.querySelector('meta[name="theme-color"]'); if(mc) mc.content=eff==='tag'?'#F4F0E7':'#17150F';
  const b=$('btn-theme'); if(b){ b.replaceChildren(iconEl(eff==='tag'?'sonne':'mond')); b.title='Ansicht: '+(themePref()==='system'?'System (folgt Gerät)':eff==='tag'?'Tag':'Nacht'); }
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
// Dialog-Rahmen (Zero 2026-09-02): ein Schließen-Knopf oben rechts, der beim Scrollen stehen bleibt.
// Der Dialog trägt zwei Kinder: .dlg-x (absolut, außerhalb des Scrollbereichs) + .dlg-inhalt (scrollt).
// Aller Bestand schreibt weiter „in den Dialog" — nur eben in .dlg-inhalt; querySelector-Zugriffe bleiben gültig.
function dlgInhalt(){
  const d=$('dlg');
  let i=d.querySelector(':scope>.dlg-inhalt');
  if(!i){ i=el('div',{class:'dlg-inhalt'}); d.replaceChildren(el('button',{class:'dlg-x',type:'button','aria-label':'Schließen',title:'Schließen',onclick:()=>d.close()},iconEl('schliessen')),i); }
  return i;
}
function dlgZeigen(html,setup){
  const d=$('dlg'); d.classList.remove('breit'); dlgInhalt().innerHTML=html;
  d.querySelectorAll('[data-schliessen]').forEach(b=>b.onclick=()=>d.close());
  if(setup) setup(d);
  d.showModal();
}
function dlgZu(){ $('dlg').close(); }
// el()-Variante: Dialog aus DOM-Knoten (CSP-sicher, kein innerHTML) — für neue Views (P2.4+)
function dlgZeigenEl(...knoten){
  const d=$('dlg'); d.classList.remove('breit'); dlgInhalt().replaceChildren(...knoten);
  if(!d.open) d.showModal();
}
// Breiter Dialog (Stundenplan): das Wochen-Grid nutzt die Breite, nicht nur die Höhe (Zero 2026-09-02).
// Nach dlgZeigen/dlgZeigenEl aufrufen — jeder neue Dialog startet wieder schmal.
function dlgBreit(){ $('dlg').classList.add('breit'); }

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
  const liste=kursSchueler(k);
  if(aktiveTeilgruppe){
    const g=liste.filter(s=>(s.gruppe||'')===aktiveTeilgruppe);
    if(g.length) return g;   // Gruppe existiert → filtern
    aktiveTeilgruppe=null;    // Gruppe im Kurs nicht vorhanden → Filter fällt weg (kein leerer Plan)
  }
  return liste;
}
// SVG-Line-Icons für die Datums-Zeile — einheitliche Größe (Emoji rendern unterschiedlich groß), Duktus wie Sidebar
const SVG_DS={
  zufall:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.3" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.3" fill="currentColor" stroke="none"/></svg>',
  legende:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11.2v4.8"/><circle cx="12" cy="7.8" r="0.7" fill="currentColor" stroke="none"/></svg>',
  sitzplan:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="5" height="5" rx="1"/><rect x="10" y="5" width="5" height="5" rx="1"/><rect x="17" y="5" width="4" height="5" rx="1"/><rect x="3" y="13" width="5" height="5" rx="1"/><rect x="10" y="13" width="5" height="5" rx="1"/></svg>',
  datum:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 9.5h16"/><path d="M9 3.5v3"/><path d="M15 3.5v3"/></svg>'
};
function datumStreifen(){
  const el=$('datum-streifen'); const k=kurs(); if(!k){ el.innerHTML=''; el.className=''; return; }
  const heute=heuteIso(), istHeute=terminDatum===heute;
  el.className='datum-streifen'+(istHeute?'':' nachtrag');
  const jetztText=(istHeute&&autowahlInfo)
    ?'Jetzt · '+datumLabel(terminDatum)+' · '+formatZeit(autowahlInfo.startSek)+'–'+formatZeit(autowahlInfo.endeSek)+(autowahlInfo.quelle==='kommend'?' (gleich)':'')
    :(istHeute?'Heute':'Nachtrag')+' · '+datumLabel(terminDatum);
  // Halbgruppen-Chips: nur wenn der Kurs Gruppen hat — A–D direkt filtern (Zero-Wunsch)
  const gruppen=[...new Set(kursSchueler(k).map(s=>s.gruppe).filter(Boolean))].sort();
  const chips=gruppen.length?('<span class="tg-chips"><button data-tg="" class="tg-chip'+(!aktiveTeilgruppe?' an':'')+'">Alle</button>'+
    gruppen.map(g=>'<button data-tg="'+g+'" class="tg-chip'+(aktiveTeilgruppe===g?' an':'')+'">'+g+'</button>').join('')+'</span>'):'';
  el.innerHTML='<span class="heute-tag">'+jetztText+'</span>'+
    (istHeute?'':'<span class="nachtrag-hinweis">Einträge gehen auf diesen Termin</span>')+chips+
    '<span class="rechts">'+
    (istHeute?'':'<button data-heute class="ds-txt">↩ Heute</button>')+
    '<button data-zufall class="ds-icon" title="Zufällig – bevorzugt wer noch selten dran war">'+SVG_DS.zufall+'</button>'+
    '<button data-legende class="ds-icon" title="Symbol-Legende">'+SVG_DS.legende+'</button>'+
    '<button data-sitzplan class="ds-icon" title="Sitzplan bearbeiten">'+SVG_DS.sitzplan+'</button>'+
    '<button data-datum class="ds-icon" title="Anderer Termin (Nachtrag)">'+SVG_DS.datum+'</button></span>';
  el.querySelector('[data-datum]').onclick=oeffneDatum;
  el.querySelector('[data-zufall]').onclick=zufallsSchueler;
  el.querySelector('[data-legende]').onclick=zeigeLegende;
  el.querySelector('[data-sitzplan]').onclick=()=>{ if(aktiverKursId) sitzplanEditor(aktiverKursId); };
  el.querySelectorAll('[data-tg]').forEach(b=>b.onclick=()=>{ aktiveTeilgruppe=b.dataset.tg||null; mitUebergang(renderHeute); });
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
  toast('Zufall: '+anzeigeVorname(s)+' '+anzeigeNachname(s));
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
function kachelHtml(s,st,r,c){
  let cls='kachel schueler';
  if(aktiverSchueler===s.nr) cls+=' gewaehlt';
  if(!beamerModus){
    if(st.fehlt) cls+=' netto-fehlt';
    else if(st.plus>st.minus) cls+=' netto-plus';
    else if(st.minus>st.plus) cls+=' netto-minus';
  }
  const marken=markenHtml(st);
  return '<div class="'+cls+'" data-nr="'+s.nr+'" data-r="'+r+'" data-c="'+c+'">'+
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
  const spDaten=vault.stamm.sitzplaene[k.id]||{};
  const grid=spDaten.grid||{};
  const luecken=new Set(spDaten.luecken||[]);   // bewusst leere Reihen (Gang) — überleben das Kompaktieren (Zero 2026-09-02)
  plan.classList.toggle('hidden',Object.keys(grid).length===0&&!editorAktiv);
  const sichtbar=new Set(sichtSchueler.map(s=>s.nr));
  const SPALTEN=12;
  const belegteReihen=[...new Set(Object.keys(grid).map(key=>Number(key.split(',')[0])))].sort((a,b)=>a-b);
  // Editor: alle Reihen bis zur letzten belegten + 1 leere „Ghost"-Reihe am Ende (wächst beim Befüllen).
  // Unterricht: belegte Reihen + markierte Lücken (kompakt — kein unbeabsichtigter Leerraum, TAFEL direkt unter der letzten).
  let reihen;
  if(editorAktiv){
    const maxR=belegteReihen.length?belegteReihen[belegteReihen.length-1]:-1;
    reihen=[]; for(let r=0;r<=maxR+1;r++) reihen.push(r);
  } else reihen=[...new Set([...belegteReihen,...luecken])].sort((a,b)=>a-b);
  let html='';
  const maxBelegt=belegteReihen.length?belegteReihen[belegteReihen.length-1]:-1;
  for(const r of reihen){
    // Ghost-„＋": leere Reihe hier einfügen — vor belegten Reihen (oben + zwischen); „unten" deckt die wachsende Ghost-Reihe ab
    if(editorAktiv && r<=maxBelegt) html+='<button class="reihe-plus" data-vor="'+r+'" title="Leere Reihe hier einfügen">＋</button>';
    html+='<div class="plan-reihe'+(luecken.has(r)?' luecke':'')+'" data-r="'+r+'">';
    // Leere Reihe zwischen belegten (nicht die wachsende Ghost-Reihe): „Lücke lassen" macht sie zum festen Gang
    if(editorAktiv && r<=maxBelegt && !belegteReihen.includes(r)) html+='<button class="luecke-btn" data-luecke="'+r+'" title="'+(luecken.has(r)?'Antippen hebt die Lücke auf':'Reihe bleibt als Gang leer')+'">'+(luecken.has(r)?'✓ Lücke bleibt':'Lücke lassen')+'</button>';
    for(let c=0;c<SPALTEN;c++){
      const nr=grid[r+','+c];
      const s=nr?kursSchueler(k).find(x=>x.nr===nr):null;
      if(s&&sichtbar.has(s.nr)) html+=kachelHtml(s,idx.get(s.nr)||leererStand(),r,c);
      else html+='<div class="kachel leer" data-r="'+r+'" data-c="'+c+'"></div>';
    }
    html+='</div>';
  }
  plan.innerHTML=html;
  const ohnePlatz=sichtSchueler.filter(s=>!Object.values(grid).includes(s.nr));
  if(ohnePlatz.length&&!editorAktiv){  // im Editor zeigt die Namen-Schiene dieselben Schüler — Panel wäre doppelt (Tag-Simulation L5)
    let liste=$('ohne-platz'); if(!liste){ liste=document.createElement('div'); liste.id='ohne-platz'; liste.className='panel'; $('plan-wrap').after(liste); }
    liste.innerHTML='<h2>Ohne Sitzplatz</h2>'+ohnePlatz.map(s=>'<button class="btn still u-m3" data-nr="'+s.nr+'">'+esc(s.vorname)+' '+esc(s.name)+(s.lb?' · LB':'')+'</button>').join('');
    liste.querySelectorAll('[data-nr]').forEach(b=>b.onclick=()=>{ const nr=Number(b.dataset.nr); if(stempelTyp) stempleKachel(nr); else schuelerBlatt(nr); });  // Stempel gilt auch ohne Sitzplatz (Tag-Simulation L1)
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
// Fehlende sind nicht bewertbar (Zero-Feldtest 2026-07-10): keine ＋/o/−, keine direkte Note,
// kein ⭐, kein ⊘ (Verweigerung setzt Anwesenheit voraus). Die 6 bei unentschuldigtem Fehlen
// entsteht RECHNERISCH (verdichte: u zählt als 6/0 P termingewichtet) — nie per Hand-Stempel.
// Frei bleiben: ⏰ (kommt zu spät), ✎ Notiz, Lernzeit/Material-Doku, Anwesenheits-Stempel, ⌫.
const BEWERTUNGS_TYPEN=new Set(['+','o','-','note','bestleistung','verweigert']);
const FEHLT_WORT={o:'abwesend (offen)',e:'entschuldigt',u:'unentschuldigt'};
function bewertGuard(nr){
  const st=standAmTermin(nr,terminDatum);
  if(!st.fehlt) return true;
  const s=schuelerVonNr(nr);
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
  if(stempelTyp==='versp'){ verspDialog(s); return; }              // Minuten-Abfrage je Schüler
  if(stempelTyp==='notiz'){ notizDialog(s); return; }              // Kurznotiz je Schüler
  if(stempelTyp==='note'){ noteDialog(s); return; }                // Notenauswahl je Schüler (Rail-2×2-Feld 📊)
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
  stornoVon(letzte); toast('entfernt: '+(TYP_LABEL[letzte.typ]||letzte.typ)); renderHeute(); zeigeRedo(letzte);
}
// v1.1.0 · Verweigerung: anwesend, aber keine/verweigerte Leistung → zählt als 6 (Sek II 0 P),
// termingewichtet (logic/verdichtung). Kurznotiz gekoppelt — dokumentiert den Grund (bei einer 6 ratsam).
function verweigerungDialog(s){
  if(!s) return;
  const ta=el('textarea',{rows:'2',class:'u-textarea u-fs16',placeholder:'z. B. Mitarbeit verweigert, Aufgabe nicht bearbeitet'});
  dlgZeigenEl(
    el('h3',{},iconEl('verweigert'),' Verweigerung · '+esc(s.vorname)),
    el('p',{class:'u-hinweis'},'Zählt für diese Stunde als 6 (Sek II: 0 P), termingewichtet. Kurznotiz zur Begründung:'),
    ta,
    el('div',{class:'btn-reihe'},
      el('button',{class:'btn',onclick:()=>{ addEvent('verweigert',s.nr,{notiz:ta.value.trim()}); dlgZu(); toast('Verweigerung notiert (zählt 6) · '+esc(s.vorname)); renderHeute(); pulseKachel(s.nr); }},'Eintragen (6)'),
      el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
  setTimeout(()=>ta.focus(),60);
}
// v1.3 · Besondere Leistung (Zero 2026-07-09): Gegenstück zur Verweigerung — trägt automatisch die
// Bestnote als direkte note ein (Sek I: 1 · Sek II: 15 P, bestehender note-Pfad, keine Logik-Änderung)
// + optionale gekoppelte Notiz zur Begründung. Kachel zeigt danach 📊 (+ ✎ bei Notiz).
function bestleistungDialog(s){
  if(!s) return;
  const sek2=bewertProfil(kurs())==='sek2';
  const wert=sek2?'15':'1', label=sek2?'15 P':'Note 1';
  const ta=el('textarea',{rows:'2',class:'u-textarea u-fs16',placeholder:'z. B. herausragender Beitrag, eigenständige Lösung vorgestellt'});
  dlgZeigenEl(
    el('h3',{},iconEl('best'),' Besondere Leistung · '+esc(s.vorname)),
    el('p',{class:'u-hinweis'},'Trägt '+label+' als direkte Note ein. Kurznotiz zur Begründung (empfohlen):'),
    ta,
    el('div',{class:'btn-reihe'},
      el('button',{class:'btn',onclick:()=>{ addEvent('note',s.nr,{wert,best:true}); const txt=ta.value.trim(); if(txt) addEvent('notiz',s.nr,{notiz:txt}); dlgZu(); toast('Besondere Leistung: '+label+' · '+esc(s.vorname)); renderHeute(); pulseKachel(s.nr); }},'Eintragen ('+label+')'),
      el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
  setTimeout(()=>ta.focus(),60);
}
/* ═══ PERMANENTE STEMPEL-RAIL (v2) · Werkzeug-in-die-Hand-Paradigma (Zero-Wunsch) ═══
   Stempel wählen → Kacheln antippen. Löst das alte „Schüler wählen → dann eintragen" ab. */
const RAIL_TITEL={'+':'Positiv','o':'Neutral','-':'Negativ','note':'Direkte Note','fehlt_o':'Abwesend (∅)','fehlt_e':'Entschuldigt gefehlt (e)','fehlt_u':'Unentschuldigt gefehlt (u)','versp':'Verspätung (Minuten)','ipad_fehlt':'iPad fehlt/leer','mat':'Material vergessen','lernzeit':'Lernzeit/HA nicht erledigt','notiz':'Notiz','bestleistung':'Besondere Leistung (Note 1)','verweigert':'Verweigerung (zählt 6)','entfernen':'Letzten Eintrag entfernen'};
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
    erfasst=da.filter(s=>{const st=idx.get(s.nr);return st&&(st.plus+st.neutral+st.minus)>0;}).length; }
  const fill=el('div',{}); fill.style.width=(total?Math.round(erfasst/total*100):0)+'%';
  const komplett=total>0&&erfasst===total;  // alle erfasst → grünes „Stunde komplett"-Signal
  const erfasstKarte=el('div',{class:'rail-karte erfasst-karte'+(komplett?' komplett':'')},
    el('div',{class:'erfasst-kopf'},
      el('span',{class:'rail-titel'},'Erfasst'),
      el('span',{class:'rail-erfasst-zahl'}, String(erfasst), el('small',{},'/'+total))),
    el('div',{class:'rail-bar'}, fill));
  rail.replaceChildren(erfasstKarte, stempelKarte);  // Erfasst oben (auf Höhe der Datums-Leiste). Aktiv-Zustand zeigt NUR der leuchtende Stempel (Zero 2026-07-10: keine Statuszeile — sie ließ die Rail springen)
}
function pulseKachel(nr){
  const k=$('plan').querySelector('.kachel[data-nr="'+nr+'"]'); if(!k) return;
  k.classList.remove('puls'); void k.offsetWidth; k.classList.add('puls'); // Reflow-Re-Trigger (Werft flash_animation)
}
// Per-Schüler-Dialoge — aus dem Stempelfluss (⏰/✎) ODER dem „…"-Menü des Detail-Blatts erreichbar.
function verspDialog(s){ if(!s) return;
  // Vorschlag aus dem Stundenplan: jetzt − Blockbeginn (nur heute + laufender Block; sonst leer)
  let vorschlag='', hinweis='';
  if(terminDatum===heuteIso() && autowahlInfo && autowahlInfo.startSek!=null){
    const now=new Date(), jetztSek=now.getHours()*3600+now.getMinutes()*60+now.getSeconds();
    const min=Math.round((jetztSek-autowahlInfo.startSek)/60);
    if(min>=1 && min<=90){ vorschlag=String(min); hinweis='<p class="u-hinweis">Nach Stundenplan: '+min+' min (Block ab '+formatZeit(autowahlInfo.startSek)+') — anpassbar.</p>'; }
  }
  dlgZeigen('<h3>Verspätung · '+esc(s.vorname)+'</h3>'+hinweis+'<input type="number" id="min-in" inputmode="numeric" placeholder="Minuten" min="1" max="90" value="'+vorschlag+'"><div class="btn-reihe"><button class="btn" data-ok>Eintragen</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
    d=>{ d.querySelector('[data-ok]').onclick=()=>{ const m=Number(d.querySelector('#min-in').value)||0; if(m>0){ addEvent('versp',s.nr,{minuten:m}); toast(esc(s.vorname)+': '+m+' min zu spät'); renderHeute(); } dlgZu(); }; setTimeout(()=>{const mi=d.querySelector('#min-in'); mi.focus(); mi.select();},60); });
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
  const fehlt=standAmTermin(s.nr,terminDatum).fehlt;
  // Bewertungs-Aktionen (⭐/⊘/Note) für Fehlende gar nicht erst anbieten (Zero 2026-07-10)
  dlgZeigen('<h3>'+esc(s.vorname)+' '+esc(s.name)+'</h3>'+
    (fehlt?'<p class="u-warn13">Fehlt heute ('+(FEHLT_WORT[fehlt]||fehlt)+') — Bewertung gesperrt. Der ⌫-Stempel entfernt die Abwesenheit.</p>'
      :'<p class="u-hinweis">Fehlt jetzt: „abwesend" — e/u klärst du später in der Wiedervorlage.</p>')+
    '<div class="btn-reihe">'+
    (fehlt?'':'<button class="btn still" data-t="fehlt_o">abwesend</button>'+
      '<button class="btn still" data-t="bestleistung">'+iconHtml('best')+' bes. Leistung…</button>'+
      '<button class="btn still" data-t="verweigert">'+iconHtml('verweigert')+' verweigert (6)…</button>')+
    '<button class="btn still" data-t="versp">zu spät…</button>'+
    (fehlt?'':'<button class="btn still" data-t="note">Note…</button>')+
    '<button class="btn still" data-t="notiz">Notiz…</button>'+
    '<button class="btn still" data-t="lernzeit">Lernzeit/HA</button></div>'+
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
        else if(t==='bestleistung') bestleistungDialog(s);
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
  // Anatomie-Beispiel = ECHTE kachelHtml-Ausgabe (eine Quelle der Wahrheit — Legende driftet nie vom Plan)
  const demo=kachelHtml({nr:0,vorname:'Anna',name:'Anders',lb:true},
    {plus:2,neutral:0,minus:0,fehlt:null,note:'2',mat:true,ipad:false,lernzeit:false,notiz:true,versp:1,verweigert:false},0,0);
  const mk=(cls,t)=>'<span class="mk '+cls+'">'+t+'</span>';
  const zeile=(sym,txt)=>'<div class="lg-zeile"><span class="lg-sym">'+sym+'</span><span>'+txt+'</span></div>';
  const kopf=t=>'<div class="tag-kopf">'+t+'</div>';
  dlgZeigen('<h3>Legende</h3><div class="legende">'+
    '<div class="lg-kachel">'+demo+
      '<div class="lg-anatomie">'+
      '<div>oben <b>Vorname</b> + LB-Badge, darunter der Nachname</div>'+
      '<div>unten alle <b>Marken</b> des heutigen Tages</div>'+
      '<div><b>Kachelfarbe</b> = Tagesstand (hier: überwiegend ＋)</div></div></div>'+
    kopf('Tagesstand — Kachelfarbe')+
    zeile('<span class="lg-swatch plus"></span>','überwiegend Plus')+
    zeile('<span class="lg-swatch minus"></span>','überwiegend Minus')+
    zeile('<span class="lg-swatch"></span>','neutral oder noch kein Eintrag')+
    kopf('Bewertung')+
    zeile(mk('p','＋2')+' '+mk('m','−'),'Plus / Minus — Zahl = wie oft heute')+
    zeile(mk('o','o'),'neutrale Meldung')+
    zeile(mk('sym',iconHtml('note')),'direkte Note')+
    zeile(mk('sym',iconHtml('best')),'besondere Leistung — Bestnote mit Begründung')+
    zeile(mk('verw',iconHtml('verweigert')),'Verweigerung — zählt als 6 (Sek II: 0 P)')+
    kopf('Organisatorisches')+
    zeile(mk('sym',iconHtml('material')),'Material vergessen')+
    zeile(mk('sym',iconHtml('ipad')),'iPad fehlt / leer')+
    zeile(mk('sym',iconHtml('lernzeit')),'Lernzeit / Hausaufgabe nicht erledigt')+
    zeile(mk('sym',iconHtml('notiz')),'Notiz vorhanden')+
    zeile(mk('sym',iconHtml('versp')),'Verspätung (Minuten)')+
    kopf('Anwesenheit')+
    zeile(mk('abw','abw'),'abwesend — Klärung offen (Wiedervorlage)')+
    zeile(mk('e','e')+' '+mk('u','u'),'entschuldigt / unentschuldigt gefehlt')+
    kopf('Sonderfälle')+
    zeile('<span class="chip chip-info">LB</span>','zieldifferent — Bewertung möglich (Konferenz-Grundlage), nur kein Noten-Vorschlag')+
    zeile(iconHtml('auge'),'Beamer-Modus (oben rechts) versteckt alle Bewertungen für die Projektion')+
    '</div><div class="btn-reihe"><button class="btn still" data-schliessen>Schließen</button></div>');
}

/* ═══ DECK · Stundenende-Ritual (Swipe: ←− →+ ↑Notiz ↓weiter) ═══ */
let deckListe=[], deckIdx=0, deckNurOhne=false;
let deckRundeStart=null;
let deckVerlauf=[]; // Buchungen DIESER Deck-Runde [{nr,name,evId,typ}] — mitlaufende, korrigierbare Historie (Zero-Feldtest 2026-07-10)
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
  if(!deckListe.length||deckListe._kurs!==k.id||deckListe._datum!==terminDatum||deckListe._nurOhne!==deckNurOhne) neuesDeck(false);
  zeigeDeckKarte();
}
function zeigeDeckKarte(){
  const karte=$('deck-karte');
  const total=deckListe.length;
  // EIN Indexlauf statt eines vollen Event-Durchlaufs je Schueler (gemessen bei 7.624 Events:
  // 146 ms -> 7 ms je Deck-Runde, Faktor 21; die Funktion gab es laengst, sie wurde hier nur
  // nicht benutzt). Derselbe Index traegt unten die End-Karte und die Abwesenheits-Anzeige.
  const idxNow=tagesStandIndex(terminDatum);
  const erfasst=deckListe.filter(s=>{const st=idxNow.get(s.nr);return !!st&&st.plus+st.neutral+st.minus>0;}).length;
  const balken='<div class="deck-bar"><div data-w="'+(total?100*erfasst/total:0)+'"></div></div>';
  const setzeBalken=()=>{ const d=$('deck-fortschritt').querySelector('[data-w]'); if(d) d.style.width=d.dataset.w+'%'; }; // CSSOM (CSP)
  if(deckIdx>=total){
    // End-Karte: „Fehlende durchgehen" — noch nicht erfasste Anwesende in ein Nur-Ohne-Deck (P4.4)
    const fehlend=deckListe.filter(s=>{const st=idxNow.get(s.nr);return !st||(st.plus+st.neutral+st.minus)===0;}).length;
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
// „Diese Runde" zeigte nur, was per Swipe/Knopf gebucht wurde — was aus dem Mehr-Menue kam
// (Notiz, Note, zu spaet …), fehlte und liess sich dort folglich nicht antippen. Nachtragen
// statt Umbau: alles, was seit Rundenbeginn fuer einen Schueler DIESES Decks entstand.
// Bewertungen tragen ihr Symbol, alles andere ein Stift — der Tap fuehrt in dieselbe Korrektur.
function ergaenzeVerlaufAusEvents(){
  const k=kurs(); if(!k||!deckRundeStart) return;
  const imDeck=new Set(deckListe.map(s=>s.nr));
  const bekannt=new Set(deckVerlauf.map(v=>v.evId).filter(Boolean));
  const neu=wirksameEvents(vault.events).filter(e=>
    e.kursId===k.id&&e.datum===terminDatum&&imDeck.has(e.schuelerNr)&&
    e.typ!=='storno'&&String(e.ts||'')>=deckRundeStart&&!bekannt.has(e.id));
  for(const e of neu.sort((a,b)=>String(a.ts).localeCompare(String(b.ts)))){
    const s=schuelerVonNr(e.schuelerNr);
    deckVerlauf.unshift({nr:e.schuelerNr,name:s?anzeigeVorname(s):'Nr '+e.schuelerNr,
      evId:e.id,typ:DECK_SYMBOL[e.typ]?e.typ:null,fremd:!DECK_SYMBOL[e.typ]});
  }
}
function renderDeckVerlauf(){
  const box=$('deck-verlauf'); if(!box) return;
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
    if(v.evId){ const alt=vault.events.find(x=>x.id===v.evId); if(alt) stornoVon(alt); }
    if(typ){ const e=addEvent(typ,v.nr); v.evId=e?e.id:null; v.typ=e?typ:null; }
    else { v.evId=null; v.typ=null; }
    dlgZu(); renderDeckVerlauf(); zeigeDeckKarte(); toast(v.name+': '+(typ?DECK_SYMBOL[typ]:'Eintrag entfernt'));
  };
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
  const s=deckListe[deckIdx];
  if(aktion==='notiz'){ zeigeMehrAktionen(s); return; }
  // Der Bewertungs-Guard galt bisher nur fuer den Stempelpfad (stempleKachel). Das Deck baut
  // seine Liste zwar ohne Abwesende, prueft aber NICHT nach: wer waehrend der laufenden Runde
  // als abwesend gestempelt wird (kurzer Wechsel nach „Heute"), blieb im Stapel und liess sich
  // bewerten — genau das, was der Guard anderswo verhindert. Zero-Befund 2026-08-30.
  // zeigeDeckKarte() danach: der Hinweis auf der Karte soll SOFORT stehen, nicht erst beim
  // naechsten Kartenwechsel — sonst tippt man ein zweites Mal ins Leere.
  if((aktion==='+'||aktion==='o'||aktion==='-')&&!bewertGuard(s.nr)){ zeigeDeckKarte(); return; }
  busy=true;
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
    busy=false;
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
let offenerSchueler=null, zeitraumFilter=null, schuelerSuche='', schuelerFilter=null, sListeScroll=0;
let schuelerAnsicht='liste', schuelerSort='nr';   // Zero 2026-09-02: Modi Liste·Noten·Termine·Fehlzeiten · Sortierung Nr·Name·Vorschlag·Anlass
function aktivesSchuljahr(){ return (vault.stamm.schuljahre||[]).find(j=>j.id===vault.stamm.aktivesSchuljahrId)||null; }
function renderSchueler(){
  const k=kurs(); const wrap=$('view-schueler');
  if(!k){ wrap.innerHTML='<p class="u-leise">Kein Kurs gewählt.</p>'; return; }
  // Beamer/Projektion: sensible Auswertung KOMPLETT sperren (§3.4)
  if(beamerModus){ wrap.innerHTML='<div class="panel"><h2>'+iconHtml('auge')+' Projektionsmodus</h2><p class="u-leise">Die Schüler-Auswertung ist bei aktiver Projektion ausgeblendet. Auge oben antippen zum Beenden.</p></div>'; return; }
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
  let html=modusChipsHtml()+'<div class="s-suche"><input id="s-suche" type="text" placeholder="Schüler suchen …" aria-label="Schüler suchen" autocomplete="off" enterkeyhint="search" value="'+esc(schuelerSuche)+'"></div>';
  // Zeitraum-Wähler (Quartalsansicht) — ein Tap statt Datumsgrenzen tippen
  if(sj&&sj.zeitraeume&&sj.zeitraeume.length){
    html+='<div class="zr-leiste"><button class="zr-chip'+(!zr?' an':'')+'" aria-pressed="'+(!zr)+'" data-zr="">Gesamt</button>'+
      sj.zeitraeume.map(z=>'<button class="zr-chip'+(zr&&zr.id===z.id?' an':'')+'" aria-pressed="'+!!(zr&&zr.id===z.id)+'" data-zr="'+z.id+'">'+esc(kurzL(z.label))+'</button>').join('')+'</div>';
  }
  // Stille Nacharbeits-Filter (C3): Offen / ohne Vorschlag / gesetzt — hidden-Filter, kein Re-Render
  html+='<div class="zr-leiste s-filter">'+[['offen','Offen'],['ohnev','ohne Vorschlag'],['gesetzt','gesetzt'],['lb','LB'],['ohneheute','heute ohne Eintrag'],['runter','Verlauf ↓']]
    .map(([id,lab])=>'<button class="zr-chip'+(schuelerFilter===id?' an':'')+'" aria-pressed="'+(schuelerFilter===id)+'" data-sf="'+id+'">'+lab+'</button>').join('')+'</div>';
  // Sortierung (Punkt 3): Nr (Mappen-Reihenfolge) · Name · Vorschlag (beste zuerst) · Anlass (Handlungsbedarf zuerst)
  html+='<div class="zr-leiste s-sort"><span class="u-hinweis">Sortieren</span>'+[['nr','Nr'],['name','Name'],['vorschlag','Vorschlag'],['anlass','Anlass']]
    .map(([id,lab])=>'<button class="zr-chip'+(schuelerSort===id?' an':'')+'" aria-pressed="'+(schuelerSort===id)+'" data-ss="'+id+'">'+lab+'</button>').join('')+'</div>';
  // Klärungsliste (P3.5 Phase 2): offene Abwesenheiten klären — ausgeschrieben, Alter in Tagen (C3)
  if(offeneO.length){
    html+='<div class="panel"><h2>Offene Fehlzeiten ('+offeneO.length+')</h2>'+
      offeneO.map(e=>{ const s=kursSchueler(k).find(x=>x.nr===e.schuelerNr);
        const tageOffen=Math.floor((new Date(heute)-new Date(e.datum))/86400000);
        const alt=tageOffen>7;
        return '<div class="klaer-zeile'+(alt?' alt':'')+'"><span>'+esc(s?s.vorname+' '+s.name:'Nr '+e.schuelerNr)+' · '+datumLabel(e.datum)+(alt?' · '+tageOffen+' Tage offen':'')+'</span>'+
          '<span class="klaer-btns"><button class="btn still u-btn-klein" data-klaer="e" data-o="'+e.id+'">Entsch.</button>'+
          '<button class="btn still u-btn-klein" data-klaer="u" data-o="'+e.id+'">Unentsch.</button>'+
          '<button class="btn still u-btn-klein" data-klaer="irrtum" data-o="'+e.id+'">Irrtum</button></span></div>'; }).join('')+'</div>';
  }
  html+='<div class="panel"><h2>'+esc(k.name)+' · '+esc(zr?zr.label:'Verdichtung')+'</h2><p class="u-regelzeile">'+esc(regelText(bewertProfil(k)))+'</p>'+
    '<div class="btn-reihe"><button class="btn still u-btn-klein" data-kopiere title="Nr + Note in die Zwischenablage — in die Excel-Klassenmappe einfügen">'+iconHtml('kopieren')+' '+esc(zr?kurzL(zr.label):'Gesamt')+'-Vorschläge für Excel kopieren</button></div>';
  // Terminliste des Kurses für den „seit N Terminen kein Eintrag"-Anlass (C3)
  const alleTermine=[...new Set(wirksameEvents(kursEvents).filter(e=>e.datum&&e.typ!=='quartalsnote').map(e=>e.datum))].sort();
  const heuteNrs=new Set(wirksameEvents(kursEvents).filter(e=>e.datum===heute&&e.typ!=='quartalsnote'&&e.typ!=='storno').map(e=>e.schuelerNr));
  const profil=bewertProfil(k);
  // Erst rechnen, dann sortieren, dann zeichnen (Punkt 3) — die Vorschlagswerte braucht die Sortierung
  const daten=kursSchueler(k).map(s=>{
    const v=verdichte(kursEvents,s.nr,{...vOpt,lb:s.lb});
    // Entscheidung zuerst (C3): gesetzte Quartalsnote > Vorschlag; Detailwerte leben auf der Vollseite
    const qnEv=zr?quartalsnotenVon(kursEvents,s.nr)[QN_KEY[zr.id]]:null;
    const offenN=offeneO.filter(e=>e.schuelerNr===s.nr).length;
    let anlass='', anlassWarn=false;
    if(offenN){ anlass=offenN+' offene Fehlzeit'+(offenN>1?'en':''); anlassWarn=true; }
    else if(alleTermine.length){
      const mit=new Set(wirksameEvents(kursEvents).filter(e=>e.schuelerNr===s.nr&&e.datum).map(e=>e.datum));
      let ohne=0; for(let i=alleTermine.length-1;i>=0&&!mit.has(alleTermine[i]);i--) ohne++;
      if(ohne>=3) anlass='seit '+ohne+' Terminen kein Eintrag';
    }
    const abw=qnEv&&v.vorschlag?notenAbstand(qnEv.wert,v.vorschlag.wert,profil):null;   // Punkt 4: gesetzte Note ↔ Vorschlag
    return {s,v,qnEv,offenN,anlass,anlassWarn,abw};
  });
  sortiereSchuelerDaten(daten,schuelerSort,profil);
  for(const {s,v,qnEv,offenN,anlass,anlassWarn,abw} of daten){
    const flags=[]; if(offenN) flags.push('offen'); if(qnEv) flags.push('gesetzt'); if(!qnEv&&!v.vorschlag) flags.push('ohnev');
    if(s.lb) flags.push('lb'); if(!heuteNrs.has(s.nr)) flags.push('ohneheute'); if(v.pfeil==='↓') flags.push('runter');
    const entscheidung=qnEv?'<span class="qn-fest" title="gesetzte Quartalsnote">'+esc(String(qnEv.wert))+' <small>gesetzt</small></span>'+
        (abw!=null&&abw>=1?'<small class="s-abw" title="weicht mindestens eine Stufe vom Vorschlag ab">'+iconHtml('warnung')+' V '+esc(v.vorschlag.label)+'</small>':'')
      :(v.vorschlag?'<span class="s-vorschlag"><small>Vorschlag</small> '+esc(v.vorschlag.label)+'</span>':'—');
    html+='<div class="s-block" data-name="'+esc((s.vorname+' '+s.name).toLowerCase())+'" data-flags="'+flags.join(' ')+'"><button type="button" class="s-item" data-nr="'+s.nr+'">'+
      '<span class="u-minw104"><b>'+esc(s.vorname)+'</b> <small class="u-leise">'+esc(s.name)+'</small>'+(s.lb?' <span class="lb-badge">LB</span>':'')+'</span>'+
      '<span class="u-flex1">'+(anlass?'<small class="s-anlass'+(anlassWarn?' warn':'')+'">'+anlass+'</small>':'')+'</span>'+
      '<span class="u-wert-rechts">'+entscheidung+'</span>'+
      '<span class="pfeil">›</span></button></div>';
  }
  // Sammeln (Punkt 5): alle offenen Vorschläge des Quartals in einem Zug — mit Prüfliste, nie still
  const sammelbar=zr&&/^q[1-4]$/.test(zr.id)?daten.filter(d=>!d.qnEv&&d.v.vorschlag&&!d.s.lb):[];
  if(sammelbar.length) html+='<div class="btn-reihe"><button class="btn still u-btn-klein" data-sammeln>Alle '+sammelbar.length+' offenen Vorschläge als '+esc(kurzL(zr.label))+'-Note übernehmen…</button></div>';
  html+='</div>';
  wrap.innerHTML=html;
  verdrahteModus(wrap);
  wrap.querySelectorAll('[data-ss]').forEach(b=>b.onclick=()=>{ schuelerSort=b.dataset.ss; mitUebergang(renderSchueler); });
  const bsam=wrap.querySelector('[data-sammeln]'); if(bsam) bsam.onclick=()=>quartalsnotenSammeln(k,zr,sammelbar);
  // Schüler-Suche + Nacharbeits-Filter: Live-Filter per hidden-Klasse (kein Re-Render → Fokus bleibt, iPad-Tastatur zu-fest)
  const filterS=()=>{ const q=schuelerSuche.trim().toLowerCase();
    wrap.querySelectorAll('.s-block').forEach(b=>{
      const passtQ=!q||(b.dataset.name||'').includes(q);
      const passtF=!schuelerFilter||(b.dataset.flags||'').split(' ').includes(schuelerFilter);
      b.classList.toggle('hidden', !(passtQ&&passtF));
    }); };
  const suche=$('s-suche'); if(suche){ suche.oninput=e=>{ schuelerSuche=e.target.value; filterS(); }; filterS(); }
  wrap.querySelectorAll('[data-sf]').forEach(b=>b.onclick=()=>{
    schuelerFilter=(schuelerFilter===b.dataset.sf)?null:b.dataset.sf;
    wrap.querySelectorAll('[data-sf]').forEach(x=>{ const an=x.dataset.sf===schuelerFilter; x.classList.toggle('an',an); x.setAttribute('aria-pressed',String(an)); });
    filterS();
  });
  wrap.querySelectorAll('[data-zr]').forEach(b=>b.onclick=()=>{ const id=b.dataset.zr; zeitraumFilter=id&&sj?sj.zeitraeume.find(z=>z.id===id):null; offenerSchueler=null; mitUebergang(renderSchueler); });
  wrap.querySelectorAll('[data-klaer]').forEach(b=>b.onclick=ev=>{ ev.stopPropagation();
    const o=vault.events.find(x=>x.id===b.dataset.o); if(!o) return;
    const art=b.dataset.klaer;
    const sName=(kursSchueler(k).find(x=>x.nr===o.schuelerNr)||{}).vorname||('Nr '+o.schuelerNr);
    // Klärung = Storno des fehlt_o + neues fehlt_e/fehlt_u am ORIGINALDATUM (Merge-fest, verdichte löst jüngste-ts)
    const klaere=()=>{ addEvent(art==='e'?'fehlt_e':'fehlt_u',o.schuelerNr,{datum:o.datum,stornoVon:o.id}); toast('Geklärt: '+(art==='e'?'entschuldigt':'unentschuldigt')+' ('+datumLabel(o.datum)+')'); renderSchueler(); };
    if(art==='irrtum'){ stornoVon(o); toast('Irrtum — Abwesenheit entfernt'); zeigeRedo(o); renderSchueler(); }
    else if(art==='u'){
      // Unentschuldigt ist folgenreich (NRW §48) → kurze Bestätigung mit Name + Datum (C3)
      dlgZeigenEl(el('h3',{},'Unentschuldigt?'),
        el('p',{class:'u-hinweis'},sName+' · '+datumLabel(o.datum)+' als unentschuldigt festschreiben?'),
        el('div',{class:'btn-reihe'},
          el('button',{class:'btn gefahr',onclick:()=>{ dlgZu(); klaere(); }},'Unentschuldigt'),
          el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
    }
    else klaere();
  });
  wrap.querySelectorAll('.s-item').forEach(el=>el.onclick=()=>{
    const nr=Number(el.dataset.nr);
    if(offenerSchueler!==nr) sListeScroll=(document.querySelector('main')||{}).scrollTop||0;  // Rückkehr-Anker (C3)
    offenerSchueler=(offenerSchueler===nr?null:nr); mitUebergang(renderSchueler);
  });
  const bkv=wrap.querySelector('[data-kopiere]'); if(bkv) bkv.onclick=kopiereVorschlaege;
  verdrahteDetail(wrap);
}
// P4.5 · „Vorschläge kopieren": Nr⇥Vorschlag[⇥F-Summen] in die Zwischenablage (kein Datei-Export).
// Der Mensch fügt in die Excel-Klassenmappe ein — Excel bleibt die Noten-Zentrale (User-Entscheid „Beides").
async function kopiereVorschlaege(){
  const k=kurs(); if(!k) return;
  const zr=zeitraumFilter;
  const kursEvents=vault.events.filter(e=>e.kursId===k.id);
  let nFest=0;
  const rows=kursSchueler(k).map(s=>{
    const v=verdichte(kursEvents,s.nr,{profil:bewertProfil(k),lb:s.lb,von:zr?zr.von:'',bis:zr?zr.bis:'9999-12-31'});
    const f=(v.nFehltE||v.nFehltU||v.nVerweigert)?(v.nFehltE+'e/'+v.nFehltU+'u'+(v.nVerweigert?'/'+v.nVerweigert+'verw':'')):'';
    // GESETZTE Quartalsnote des gewählten Zeitraums schlägt den Live-Vorschlag (der Lehrer hat entschieden)
    const qnEv=zr?quartalsnotenVon(kursEvents,s.nr)[QN_KEY[zr.id]]:null;
    if(qnEv) nFest++;
    return {nr:s.nr,vorschlag:qnEv?String(qnEv.wert):(v.vorschlag?v.vorschlag.label:''),fSummen:f};
  });
  inZwischenablage(vorschlagsZeilen(rows),'Kopiert ('+rows.length+' Zeilen'+(nFest?' · '+nFest+' gesetzte Quartalsnoten bevorzugt':'')+') — in Excel einfügen','Vorschläge kopieren');
}
// Text in die Zwischenablage; ohne Clipboard-Zugriff ein Textfeld zum manuellen Kopieren (eine Stelle für Vorschläge + Kurzbericht)
async function inZwischenablage(text,toastText,titel){
  try{ await navigator.clipboard.writeText(text); toast(toastText); }
  catch{
    const ta=el('textarea',{class:'u-textarea u-fs14',rows:'10',readonly:'readonly'}); ta.value=text;
    dlgZeigenEl(el('h3',{},titel),
      el('p',{class:'u-hinweis'},'Markieren und kopieren (Strg/⌘ + C).'),
      ta,
      el('div',{class:'btn-reihe'},el('button',{class:'btn',onclick:dlgZu},'Schließen')));
    setTimeout(()=>{ ta.focus(); ta.select(); },60);
  }
}
// Sortierung der Listenzeilen (Punkt 3). „Vorschlag": gesetzte Note zählt vor dem Vorschlag, beste zuerst; ohne Wert ans Ende.
function sortiereSchuelerDaten(daten,sort,profil){
  const wert=d=>{ if(d.qnEv){ try{ return noteAlsWert(d.qnEv.wert,profil); }catch{ return null; } } return d.v.vorschlag?d.v.vorschlag.wert:null; };
  const nachNr=(a,b)=>a.s.nr-b.s.nr;
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
    return el('div',{class:'zeile'},el('span',{},cb,' ',d.s.vorname+' '+d.s.name),el('span',{class:'wert'},d.v.vorschlag.label));
  });
  dlgZeigenEl(el('h3',{},zr.label+' · Vorschläge übernehmen'),
    el('p',{class:'u-hinweis'},'Jede angehakte Zeile wird als Quartalsnote gesetzt — genau wie im Einzeldialog, änderbar bleibt sie. Haken weg = bleibt offen.'),
    el('div',{class:'u-scroll58'},...zeilen),
    el('div',{class:'btn-reihe'},
      el('button',{class:'btn',onclick:()=>{
        let n=0;
        for(const d of liste){ if(!haken.get(d.s.nr)) continue;
          const wert=sek2?String(d.v.vorschlag.wert):(wertZuLabel(d.v.vorschlag.wert)||'3');
          addEvent('quartalsnote',d.s.nr,{hj,quartal,wert,zeitraumId:zr.id}); n++; }
        dlgZu(); toast(n+' Quartalsnoten gesetzt ('+zr.label+')'); renderSchueler();
      }},'Setzen'),
      el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
}
/* ═══ Übersichts-Tabellen (Zero 2026-09-02 · Punkte 1·2·6·7·9): Noten · Termine · Fehlzeiten — el()-gebaut, druckbar ═══ */
const SCHUELER_MODI=[['liste','Liste'],['noten','Noten'],['termine','Termine'],['fehlzeiten','Fehlzeiten']];
function modusChipsHtml(){ return '<div class="zr-leiste s-modus">'+SCHUELER_MODI.map(([id,lab])=>'<button class="zr-chip'+(schuelerAnsicht===id?' an':'')+'" aria-pressed="'+(schuelerAnsicht===id)+'" data-sm="'+id+'">'+lab+'</button>').join('')+'</div>'; }
function modusChipsEl(){ return el('div',{class:'zr-leiste s-modus'},...SCHUELER_MODI.map(([id,lab])=>el('button',{class:'zr-chip'+(schuelerAnsicht===id?' an':''),'aria-pressed':String(schuelerAnsicht===id),dataset:{sm:id}},lab))); }
function verdrahteModus(wrap){ wrap.querySelectorAll('[data-sm]').forEach(b=>b.onclick=()=>{ schuelerAnsicht=b.dataset.sm; offenerSchueler=null; mitUebergang(renderSchueler); }); }
function zrChipsEl(sj,zr,kurzL){
  if(!sj||!sj.zeitraeume||!sj.zeitraeume.length) return el('span',{});
  const chip=(id,lab,an)=>el('button',{class:'zr-chip'+(an?' an':''),'aria-pressed':String(!!an),onclick:()=>{ zeitraumFilter=id?sj.zeitraeume.find(z=>z.id===id):null; mitUebergang(renderSchueler); }},lab);
  return el('div',{class:'zr-leiste'},chip('','Gesamt',!zr),...sj.zeitraeume.map(z=>chip(z.id,kurzL(z.label),zr&&zr.id===z.id)));
}
function renderSchuelerTabelle(wrap,k,kursEvents,sj,zr,kurzL){
  const profil=bewertProfil(k);
  const wirksam=wirksameEvents(kursEvents);
  const von=zr?zr.von:'', bis=zr?zr.bis:'9999-12-31';
  const schueler=kursSchueler(k);
  const verspVon=nr=>wirksam.filter(e=>e.schuelerNr===nr&&e.typ==='versp'&&e.datum>=von&&e.datum<=bis).reduce((a,e)=>a+(e.minuten||0),0);
  const titel={noten:'Notenübersicht',termine:'Termin-Matrix',fehlzeiten:'Fehlzeiten'}[schuelerAnsicht]||'';
  const kopf=el('div',{class:'druck-kopf'},el('b',{},k.name+' · '+k.fach),' · '+titel+' · '+(zr?zr.label:'Gesamt')+' · Stand '+datumLabel(heuteIso()));
  const namenBtn=s=>el('button',{class:'ut-name',onclick:()=>{ offenerSchueler=s.nr; mitUebergang(renderSchueler); }},el('b',{},s.vorname),' ',el('small',{class:'u-leise'},s.name),s.lb?el('span',{class:'lb-badge'},'LB'):null);
  const tabelle=el('table',{class:'ut-tabelle'});
  let hinweis='';
  if(schuelerAnsicht==='noten'){
    const zeitr=(sj&&sj.zeitraeume)||[];
    const spalten=['q1','q2','hj1','q3','q4','hj2'].map(id=>zeitr.find(z=>z.id===id)).filter(Boolean);
    const quartale=spalten.filter(z=>/^q/.test(z.id));
    tabelle.append(el('thead',{},el('tr',{},el('th',{},'Nr'),el('th',{class:'links'},'Name'),el('th',{},'＋ / o / −'),el('th',{},'e / u'),el('th',{},iconEl('versp')),...spalten.map(z=>el('th',{},kurzL(z.label))),el('th',{},'Jahr'))));
    const tb=el('tbody',{});
    for(const s of schueler){
      const v=verdichte(kursEvents,s.nr,{profil,lb:s.lb,von,bis});
      const qn=quartalsnotenVon(kursEvents,s.nr);
      const versp=verspVon(s.nr);
      const zellen=spalten.map(z=>{
        const vz=verdichte(kursEvents,s.nr,{profil,lb:s.lb,von:z.von,bis:z.bis});
        const ev=/^q/.test(z.id)?qn[QN_KEY[z.id]]:null;
        if(ev){ const abw=vz.vorschlag?notenAbstand(ev.wert,vz.vorschlag.wert,profil):null;
          return el('td',{},el('button',{class:'nt-zelle gesetzt',title:'gesetzt · antippen zum Ändern',onclick:()=>setzeQuartalsnote(s,vz.vorschlag||{wert:null,label:'—'},z,{fixiert:true})},String(ev.wert)),
            abw!=null&&abw>=1?el('small',{class:'s-abw',title:'weicht mindestens eine Stufe vom Vorschlag ab'},iconEl('warnung'),' V '+vz.vorschlag.label):null); }
        if(/^q/.test(z.id)&&!s.lb&&vz.vorschlag) return el('td',{},el('button',{class:'nt-zelle vor',title:'Vorschlag · antippen zum Setzen',onclick:()=>setzeQuartalsnote(s,vz.vorschlag,z,{fixiert:true})},'V '+vz.vorschlag.label));
        return el('td',{class:'u-leise'},vz.vorschlag?'V '+vz.vorschlag.label:'—');   // HJ: nur Vorschlag — die Halbjahresnote rechnet die Mappe aus Q1/Q2 (Punkt 11)
      });
      const verlauf=quartalsVerlauf(kursEvents,s.nr,quartale,{profil,lb:s.lb}).filter(e=>e.score!==null).map(e=>e.id.toUpperCase()+(e.pfeil?' '+e.pfeil:'')).join('  ');
      tb.append(el('tr',{},el('td',{class:'u-leise'},String(s.nr)),el('td',{class:'links'},namenBtn(s)),
        el('td',{},v.nPlus+' / '+v.nNull+' / '+v.nMinus),el('td',{},(v.nFehltE||v.nFehltU)?v.nFehltE+' / '+v.nFehltU:'—'),el('td',{},versp?versp+' min':'—'),
        ...zellen,el('td',{class:'u-leise ut-verlauf'},verlauf||'—')));
    }
    tabelle.append(tb);
    hinweis='Q-Zelle antippen: setzen oder ändern · V = Vorschlag, du entscheidest · HJ zeigt nur den Vorschlag über das Halbjahr, die Halbjahresnote rechnet die Klassenmappe aus Q1/Q2 · Warndreieck = gesetzte Note weicht mindestens eine Stufe vom Vorschlag ab · Jahr = Bilanz-Verlauf von Quartal zu Quartal.';
  } else if(schuelerAnsicht==='termine'){
    const relevant=e=>e.datum&&e.typ!=='quartalsnote'&&e.typ!=='storno'&&e.datum>=von&&e.datum<=bis;
    const termine=[...new Set(wirksam.filter(relevant).map(e=>e.datum))].sort();
    const idx=new Map();   // datum → nr → events
    for(const e of wirksam){ if(!relevant(e)) continue; let m=idx.get(e.datum); if(!m){ m=new Map(); idx.set(e.datum,m); } if(!m.has(e.schuelerNr)) m.set(e.schuelerNr,[]); m.get(e.schuelerNr).push(e); }
    tabelle.classList.add('ut-matrix');
    tabelle.append(el('thead',{},el('tr',{},el('th',{class:'links'},'Name'),...termine.map(t=>el('th',{},el('span',{class:'ut-datum'},datumLabel(t)))))));
    const tb=el('tbody',{});
    for(const s of schueler){
      tb.append(el('tr',{},el('td',{class:'links'},namenBtn(s)),...termine.map(t=>{ const evs=(idx.get(t)||new Map()).get(s.nr); return el('td',{class:'ut-marken'},...(evs?markenEl(reduziereStand(evs)):[])); })));
    }
    tabelle.append(tb);
    hinweis=termine.length?termine.length+' Termine · Marken wie auf der Sitzplan-Kachel (Legende unter „Heute").':'Noch keine Termine in diesem Zeitraum.';
  } else {   // fehlzeiten (Punkt 6)
    const p=vault.stamm.kursprofile[k.id]||{};
    const schwelle=Number.isFinite(p.uSchwelle)?p.uSchwelle:3;
    tabelle.append(el('thead',{},el('tr',{},el('th',{},'Nr'),el('th',{class:'links'},'Name'),el('th',{},'entsch.'),el('th',{},'unentsch.'),el('th',{},'offen'),el('th',{},iconEl('versp'),' min'),el('th',{},iconEl('verweigert')))));
    const tb=el('tbody',{});
    for(const s of schueler){
      const v=verdichte(kursEvents,s.nr,{profil,lb:s.lb,von,bis});
      const versp=verspVon(s.nr);
      const warn=schwelle>0&&v.nFehltU>=schwelle;
      tb.append(el('tr',{class:warn?'ut-warn':''},el('td',{class:'u-leise'},String(s.nr)),el('td',{class:'links'},namenBtn(s)),
        el('td',{},v.nFehltE?String(v.nFehltE):'—'),el('td',{class:warn?'u-fehl':''},v.nFehltU?String(v.nFehltU)+' ':'—',warn?iconEl('warnung'):null),el('td',{},v.nFehltO?String(v.nFehltO):'—'),el('td',{},versp?String(versp):'—'),el('td',{},v.nVerweigert?String(v.nVerweigert):'—')));
    }
    tabelle.append(tb);
    const schwIn=el('input',{type:'number',min:'0',max:'99',value:String(schwelle),class:'u-w72',onchange:e=>{ const n=parseInt(e.target.value,10); vault.stamm.kursprofile[k.id]={...(vault.stamm.kursprofile[k.id]||{}),uSchwelle:isNaN(n)?3:n}; stammMutiert(); speichern(); renderSchueler(); }});
    hinweis=el('div',{class:'zeile'},el('span',{class:'u-hinweis'},iconEl('warnung'),' ab so vielen unentschuldigten Terminen (0 = aus) — gilt für diesen Kurs'),el('span',{},schwIn));
  }
  wrap.replaceChildren(modusChipsEl(), zrChipsEl(sj,zr,kurzL), kopf,
    el('div',{class:'btn-reihe ut-aktionen'},
      el('button',{class:'btn still u-btn-klein',onclick:()=>window.print()},iconEl('drucken'),' Drucken'),
      ...(schuelerAnsicht==='noten'?[el('button',{class:'btn still u-btn-klein',onclick:kopiereVorschlaege},iconEl('kopieren'),' Vorschläge für Excel kopieren')]:[])),
    el('div',{class:'ut-wrap'},tabelle),
    typeof hinweis==='string'?el('p',{class:'u-hinweis'},hinweis):hinweis);
  verdrahteModus(wrap);
}
// ═══ Quartalsnoten-Lebensweg (S216 · Zeros Befund „da fehlt ein Baustein") ═══
// Gesetzte quartalsnote-Events waren nach dem Setzen unsichtbar (nur Verlaufszeile).
// Jetzt: Übersicht Q1–Q4 auf der Schüler-Seite · Liste + „Vorschläge kopieren" bevorzugen die gesetzte Note.
const QN_KEY={q1:'1-1',q2:'1-2',q3:'2-1',q4:'2-2'};
function quartalsnotenVon(kursEvents,nr){
  const m={};
  for(const e of wirksameEvents(kursEvents)) if(e.typ==='quartalsnote'&&e.schuelerNr===nr){
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
  const v=verdichte(kursEvents,s.nr,{profil:bewertProfil(k),lb:s.lb,von:zr?zr.von:'',bis:zr?zr.bis:'9999-12-31'});
  const qn=quartalsnotenVon(kursEvents,s.nr);
  const zellen=['q1','q2','q3','q4'].map(id=>{
    const z=sj&&sj.zeitraeume?sj.zeitraeume.find(x=>x.id===id):null;
    const ev=qn[QN_KEY[id]];
    const vz=z?verdichte(kursEvents,s.nr,{profil:bewertProfil(k),lb:s.lb,von:z.von,bis:z.bis}):null;
    return '<button class="qn-zelle'+(ev?'':' offen')+'" data-qz="'+id+'">'+
      '<span class="qn-label">'+id.toUpperCase()+'</span>'+
      '<span class="qn-note">'+(ev?esc(String(ev.wert)):'—')+'</span>'+
      '<span class="qn-sub">'+(vz&&vz.vorschlag?'Vorschlag '+esc(vz.vorschlag.label):(s.lb?'LB — frei benotbar':'noch kein Vorschlag'))+'</span></button>';
  }).join('');
  // Verlauf über die Quartale (Punkt 7) + Einordnung im Kurs (Punkt 10: Median + Anteil dahinter — Prozent, kein Rang, kein Wort)
  const quartale=sj&&sj.zeitraeume?sj.zeitraeume.filter(z=>/^q[1-4]$/.test(z.id)):[];
  const verlaufTxt=quartalsVerlauf(kursEvents,s.nr,quartale,{profil:bewertProfil(k),lb:s.lb}).filter(e=>e.score!==null).map(e=>e.id.toUpperCase()+(e.pfeil?' '+e.pfeil:'')).join('  ');
  let einordnungTxt='';
  if(v.vorschlag&&!s.lb){
    const pr=bewertProfil(k);
    const werte=kursSchueler(k).filter(x=>!x.lb).map(x=>verdichte(kursEvents,x.nr,{profil:pr,von:zr?zr.von:'',bis:zr?zr.bis:'9999-12-31'}).vorschlag?.wert).filter(w=>w!=null);
    const e=kursEinordnung(werte,v.vorschlag.wert,pr);
    if(e&&e.n>=3) einordnungTxt='Kurs: Median '+(pr==='sek2'?Math.round(e.median)+' P':drittelnoteLabel(e.median))+' · dieser Vorschlag liegt vor '+Math.round(e.anteilDahinter*100)+' % der '+e.n+' Vorschläge';
  }
  wrap.innerHTML='<div class="sseite-kopf"><button class="btn still" id="s-zurueck">‹ Alle Schüler</button>'+
    '<div class="sseite-name">'+esc(s.vorname)+' '+esc(s.name)+(s.lb?' <span class="lb-badge">LB</span>':'')+'</div></div>'+
    '<div class="panel"><h2>Quartalsnoten'+(sj?' · '+esc(sj.label):'')+'</h2>'+
    '<div class="qn-grid">'+zellen+'</div>'+
    '<p class="u-hinweis">Zelle antippen zum Setzen/Ändern — der Zeitraum-Vorschlag ist vorbelegt, du entscheidest. ● in der Liste = gesetzt.</p>'+
    (verlaufTxt?'<p class="u-hinweis">Verlauf über das Jahr: '+esc(verlaufTxt)+'</p>':'')+'</div>'+
    '<div class="panel"><h2>Bilanz · '+esc(zr?zr.label:'Gesamt')+'</h2>'+schuelerDetailHtml(s,k,v)+
    (einordnungTxt?'<p class="u-hinweis">'+esc(einordnungTxt)+'</p>':'')+
    '<div class="btn-reihe"><button class="btn still u-btn-klein" id="s-bericht" title="Bilanz, Fehlzeiten, Quartalsnoten und Notizen als Text — für Elternsprechtag und Zeugnisbemerkung">'+iconHtml('kopieren')+' Kurzbericht kopieren</button></div></div>';
  $('s-zurueck').onclick=()=>{ offenerSchueler=null; mitUebergang(()=>{ renderSchueler(); const m=document.querySelector('main'); if(m) m.scrollTop=sListeScroll; }); };  // zurück an die alte Listenposition (C3)
  // Kurzbericht (Punkt 8): reiner Text aus logic/bericht.mjs, Zeitraum wie die Bilanz oben
  $('s-bericht').onclick=()=>{
    const evs=wirksameEvents(kursEvents).filter(e=>e.schuelerNr===s.nr&&e.typ!=='storno'&&(!zr||(e.datum>=zr.von&&e.datum<=zr.bis)));
    const qn=quartalsnotenVon(kursEvents,s.nr);
    const text=schuelerBericht({name:s.vorname+' '+s.name,kurs:k.name,fach:k.fach,zeitraum:zr?zr.label:(sj?sj.label:''),profil:bewertProfil(k),v,
      quartalsnoten:['q1','q2','q3','q4'].filter(id=>qn[QN_KEY[id]]).map(id=>({label:id.toUpperCase(),wert:qn[QN_KEY[id]].wert})),
      notizen:evs.filter(e=>e.notiz&&String(e.notiz).trim()).sort((a,b)=>String(a.datum).localeCompare(String(b.datum))).map(e=>({datum:e.datum,text:e.notiz,typ:e.typ})),
      verspMinuten:evs.filter(e=>e.typ==='versp').reduce((a,e)=>a+(e.minuten||0),0),datumLabel});
    inZwischenablage(text,'Kurzbericht kopiert · '+s.vorname,'Kurzbericht');
  };
  wrap.querySelectorAll('[data-qz]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.qz; const z=sj&&sj.zeitraeume?sj.zeitraeume.find(x=>x.id===id):null; if(!z){ toast('Kein Schuljahres-Zeitraum definiert'); return; }
    const vz=verdichte(kursEvents,s.nr,{profil:bewertProfil(k),lb:s.lb,von:z.von,bis:z.bis});
    setzeQuartalsnote(s,vz.vorschlag||{wert:null,label:'—'},z,{fixiert:true});  // Q-Zellen-Tap setzt GENAU dieses Quartal (C3)
  });
  verdrahteDetail(wrap);
}
function schuelerDetailHtml(s,k,v){
  const evs=wirksameEvents(vault.events.filter(e=>e.kursId===k.id&&e.schuelerNr===s.nr)).filter(e=>e.typ!=='storno'); // Storno-Buchungen nicht im Verlauf zeigen
  const verspSum=evs.filter(e=>e.typ==='versp').reduce((a,e)=>a+(e.minuten||0),0);
  const fehltU=evs.filter(e=>e.typ==='fehlt_u').length, fehltE=evs.filter(e=>e.typ==='fehlt_e').length;
  const proTag={};
  for(const e of evs) (proTag[e.datum]=proTag[e.datum]||[]).push(e);
  const tage=Object.keys(proTag).sort();  // chronologisch: links alt → rechts neu (Zero 2026-07-09)
  // Horizontaler Zeitstrahl: je Tag eine kompakte Karte mit den mk-Marken (gleiche Sprache wie die Sitzplan-Kachel);
  // Tap expandiert die Einträge des Tages darunter (mit ↶-Storno). Kein Runterscrollen mehr.
  const evZeile=e=>'<div class="ev-zeile"><span>'+(e.best?iconHtml('best')+' ':'')+esc(TYP_LABEL[e.typ]||e.typ)+(e.minuten?' '+e.minuten+' min':'')+(e.wert?' '+esc(String(e.wert)):'')+(e.notiz?' · '+esc(e.notiz):'')+'</span>'+
    '<button class="btn still ev-storno u-btn-klein" data-storno="'+e.id+'">'+iconHtml('rueck')+'</button></div>';
  let strahl='', details='';
  for(const t of tage){
    const st=reduziereStand(proTag[t]);
    strahl+='<button class="zs-tag" data-tag="'+t+'"><span class="zs-datum">'+datumLabel(t)+'</span><span class="zs-marken">'+markenHtml(st)+'</span></button>';
    details+='<div class="tag-detail-inhalt" data-tag="'+t+'"><div class="tag-kopf">'+datumLabel(t)+'</div>'+
      proTag[t].sort((a,b)=>String(a.ts).localeCompare(String(b.ts))).map(evZeile).join('')+'</div>';
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
function verdrahteDetail(wrap){
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
  wrap.querySelectorAll('.ev-storno').forEach(b=>b.onclick=e=>{ e.stopPropagation(); const ev=vault.events.find(x=>x.id===b.dataset.storno); if(ev){ stornoVon(ev); toast('storniert'); zeigeRedo(ev); renderSchueler(); } });
  wrap.querySelectorAll('[data-quartal]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); const s=schuelerVonNr(Number(b.dataset.quartal)); const kk=kurs(); const zr=zeitraumFilter; const v=verdichte(vault.events.filter(x=>x.kursId===kk.id),s.nr,{profil:bewertProfil(kk),lb:s.lb,von:zr?zr.von:'',bis:zr?zr.bis:'9999-12-31'}); setzeQuartalsnote(s,v.vorschlag,zr); });
}
// quartalsnote-Event trägt Zeitraum-Kontext — bleibt IMMER 'quartalsnote', NIE 'note'
// (verbotener Pfad 2: eine Übernahme darf nie in verdichte() zurückfließen).
// fixiert (C3): der Tap auf eine Q-Zelle setzt GENAU dieses Quartal — der seltene Weg
// „anderen Zeitraum wählen" bleibt hinter „ändern…" statt als gleichrangige Zweitentscheidung.
function setzeQuartalsnote(s,vorschlag,zeitraum,{fixiert=false}={}){
  const k=kurs(); const sek2=bewertProfil(k)==='sek2';
  const optionen=sek2?Array.from({length:16},(_,i)=>String(15-i)):Object.keys(DRITTELNOTEN);
  const vorwahl=sek2?String(vorschlag.wert):(wertZuLabel(vorschlag.wert)||'3');
  const zrHinweis=zeitraum?' <small class="u-leise">('+esc(zeitraum.label)+')</small>':'';
  const fixe=fixiert&&zeitraum;
  const zeitraumZeilen=fixe
    ? '<div class="zeile"><span>Zeitraum</span><span><b>'+esc(zeitraum.label)+'</b> <button class="btn still u-btn-klein" id="q-anders" type="button">ändern…</button></span></div>'+
      '<div id="q-hjq" class="hidden">'
    : '<div id="q-hjq">';
  dlgZeigen('<h3>Quartalsnote · '+esc(s.vorname)+zrHinweis+'</h3><p class="u-hinweis">Vorschlag: '+esc(vorschlag.label)+' — du entscheidest.</p>'+
    zeitraumZeilen+
    '<div class="zeile"><span>HJ</span><select id="q-hj"><option value="1">1. HJ</option><option value="2">2. HJ</option></select></div>'+
    '<div class="zeile"><span>Quartal</span><select id="q-q"><option value="1">Q1</option><option value="2">Q2</option></select></div>'+
    '</div>'+
    '<div class="zeile"><span>Note</span><select id="q-note">'+optionen.map(o=>'<option'+(o===vorwahl?' selected':'')+'>'+o+'</option>').join('')+'</select></div>'+
    '<div class="btn-reihe"><button class="btn" data-ok>Setzen</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
    el=>{
      // Zeitraum → HJ/Quartal vorbelegen (Excel-Slot-Mapping), bleibt editierbar
      if(zeitraum){ const q=zeitraum.id; const hj=/q[34]|hj2/.test(q)?'2':'1'; el.querySelector('#q-hj').value=hj; if(/q1|q3/.test(q)) el.querySelector('#q-q').value='1'; else if(/q2|q4/.test(q)) el.querySelector('#q-q').value='2'; }
      const anders=el.querySelector('#q-anders'); if(anders) anders.onclick=()=>{ el.querySelector('#q-hjq').classList.remove('hidden'); anders.disabled=true; };
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
    '<div class="zeile"><span>Fach</span><span><input type="text" id="kn-fach" placeholder="z. B. Mathematik" class="u-w160" list="fach-liste">'+
    '<datalist id="fach-liste">'+FACH_LISTE.map(f=>'<option value="'+esc(f)+'">').join('')+'</datalist></span></div>'+
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
            (geparst.warnungen.length?'<br>'+iconHtml('warnung')+' '+esc(geparst.warnungen[0])+(geparst.warnungen.length>1?' (+'+(geparst.warnungen.length-1)+')':''):'')
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
    const fachI=el('input',{type:'text',value:w.fach,placeholder:'z. B. Mathematik',class:'u-w160',list:'fach-liste',oninput:e=>w.fach=e.target.value});
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
      el('div',{class:'zeile'},el('span',{},'Fach'),el('span',{},fachI,fachDatalist())),
      el('div',{class:'zeile'},el('span',{},'Schuljahr'),el('span',{},jahrI)),
      el('div',{class:'zeile'},el('span',{},'Stufe'),el('span',{},profilSel)),
      notenBox,
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn',onclick:()=>{
          if(!w.name.trim()||!w.fach.trim()){ toast('Kursname und Fach angeben'); return; } // kein stiller „Kurs"-Default (C4)
          schritt=2; s2();
        }},'Weiter: Schülerliste'),
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
      ...g.warnungen.map(x=>el('div',{class:'u-warn13'},iconEl('warnung'),' '+x)),
      el('div',{class:'u-scroll30'},...zeilen),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn still',onclick:()=>{ schritt=2; s2(); }},'← Zurück'),
        el('button',{class:'btn',...(g.schueler.length?{}:{disabled:'disabled'}),onclick:()=>{ schritt=4; s4(); }},'Weiter: Sitzplan')));
  }
  function s4(){ // Sitzplan + eindeutige Zusammenfassung vor dem Anlegen (§15 · C4)
    const g=w.geparst, lbAnz=g.schueler.filter(s=>s.lb).length;
    const profilTxt=w.profil==='sek2'?('Sek II · '+(w.notenmodus==='drittel'?'Drittelnoten':'Punkte')):'Sek I · Drittelnoten';
    dlgZeigenEl(kopf('Sitzplan & Anlegen'),
      el('p',{},el('b',{},w.name.trim()+' · '+w.fach.trim()),' — '+profilTxt+' · '+g.schueler.length+' Schüler'+(lbAnz?' · '+lbAnz+'× LB':'')+' · Schuljahr '+(w.jahr.trim()||'—')),
      el('p',{class:'u-hinweis'},'Sitzplan jetzt anlegen? Änderbar jederzeit unter „Kurse → ⋯ → Sitzplan bearbeiten".'),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn',onclick:()=>fertig('alpha')},'Alphabetisch verteilen (empfohlen)'),
        el('button',{class:'btn still',onclick:()=>fertig('leer')},'Leeres Raster')),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn still',onclick:()=>fertig('spaeter')},'Später'),
        el('button',{class:'btn still',onclick:()=>{ schritt=3; s3(); }},'← Zurück')));
  }
  function fertig(sitz){
    const name=w.name.trim(), fach=w.fach.trim(), jahr=w.jahr.trim();
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
// P4.2 · Status-Badge einer Kurskarte („Klasse auf einen Blick") — nutzt die getestete kursStatus-Logik.
// „läuft gerade" + offene Fehlzeiten sind zwei Fakten → zwei Badges statt Verdrängung (C4).
function kursBadgeHtml(k){
  const evs=wirksameEvents(vault.events.filter(e=>e.kursId===k.id));
  const st=kursStatus(k,{events:evs,jetztLaeuft:autowahlInfo?.kursId===k.id});
  const txt=st.code==='jetzt'?'läuft gerade'
    :st.code==='offen'?st.n+'× Fehlzeit offen'
    :st.code==='leer'?'neu'
    :st.code==='aktiv'?'zuletzt '+datumLabel(st.letzterDatum)
    :'archiviert';
  const ton=st.ton==='jetzt'?' jetzt':st.ton==='warn'?' warn':'';
  const haupt='<span class="kurs-badge'+ton+'">'+esc(txt)+'</span>';
  return st.code==='jetzt'&&st.offen?haupt+'<span class="kurs-badge warn">'+st.offen+' offen</span>':haupt;
}
// Lesbares Bewertungs-Profil statt internem Code (C4: „sek1" sagt niemandem etwas)
function profilLabel(k){
  if(k.profil==='sek2') return 'Sek II · '+((k.notenmodus||'punkte')==='drittel'?'Drittelnoten':'Punkte');
  return 'Sek I · Drittelnoten';
}
// Kurskarten-Tap = Kurs BENUTZEN: wählen und ins Unterrichts-Cockpit springen (Zero-Entscheid 2026-07-10).
// Verwalten liegt auf dem ⋯-Knopf der Karte (kursDetailSheet).
function oeffneKurs(id){
  aktiverKursId=id; aktualisiereKursChip();
  aktView='heute';
  document.querySelectorAll('#hauptnav button').forEach(x=>x.classList.toggle('aktiv',x.dataset.view==='heute'));
  aktiverSchueler=null; stempelAus();
  setzeViewTitel('heute');
  mitUebergang(()=>{
    ['heute','deck','schueler','kurse','mehr'].forEach(v=>$('view-'+v).classList.toggle('hidden',v!=='heute'));
    renderAlles();
    $('view-titel').focus({preventScroll:true});
  });
}
function renderKurse(){
  const wrap=$('view-kurse');
  // Kopfzeile: aktives Schuljahr + Verwaltungs-Aktionen (Stundenplan-Signal · Schuljahres-Assistent)
  const sj=aktivesSchuljahr();
  const spEingerichtet=(vault.stamm.zeitmodelle||[]).length>0;
  let html='<div class="kurse-kopf"><div class="kk-sj">Schuljahr <b>'+esc(sj?sj.label:'—')+'</b></div>'+
    '<div class="btn-reihe"><button class="btn'+(spEingerichtet?' still':'')+' u-btn-klein" id="btn-stundenplan">'+(spEingerichtet?'Stundenplan':'Stundenplan einrichten')+'</button>'+
    (sj?'<button class="btn still u-btn-klein" id="btn-zeitraeume" title="Datumsgrenzen der Quartale">Quartale…</button>':'')+'</div></div>';
  // Kurse des AKTIVEN Schuljahres, nicht archiviert → Karten-Grid (Tap = benutzen · ⋯ = verwalten)
  const aktiveId=vault.stamm.aktivesSchuljahrId;
  const sichtbar=sortiereKurse(vault.stamm.kurse.filter(k=>(k.schuljahrId||aktiveId)===aktiveId&&k.status!=='archiviert'));   // Schul-Reihenfolge 5a … Q2 (Zero 2026-09-02)
  const archiviert=vault.stamm.kurse.filter(k=>k.status==='archiviert');
  html+='<div class="kurs-grid">';
  for(const k of sichtbar){
    const anz=kursSchueler(k).length;
    html+='<div class="kk-wrap"><button class="kurs-karte" data-kurs="'+k.id+'" title="Kurs öffnen"><span class="kurs-band"></span>'+
      '<span class="kk-txt"><span class="k-name">'+esc(k.name)+'</span>'+
      '<span class="k-meta">'+esc(k.fach)+' · '+profilLabel(k)+' · '+anz+' Schüler</span>'+
      '<span class="k-badge">'+kursBadgeHtml(k)+'</span></span></button>'+
      '<button class="kk-mehr" data-verwalten="'+k.id+'" title="Verwalten">⋯</button></div>';
  }
  html+='<button class="kurs-karte neu" id="btn-kurs-anlegen">＋ Kurs anlegen</button></div>';
  html+='<input type="file" id="file-kurs" accept=".xlsx,.json,application/json" multiple class="hidden">';
  // Archiv (P3.3) — schreibgeschützt, eingeklappt, nach Schuljahr gruppiert (C4)
  if(archiviert.length){
    const jahre=new Map();
    for(const k of archiviert){
      const label=(vault.stamm.schuljahre||[]).find(j=>j.id===k.schuljahrId)?.label||'ohne Schuljahr';
      if(!jahre.has(label)) jahre.set(label,[]);
      jahre.get(label).push(k);
    }
    html+='<details class="panel"><summary><b>Archiv ('+archiviert.length+')</b></summary>'+
      [...jahre.entries()].sort((a,b)=>b[0].localeCompare(a[0],'de')).map(([label,ks])=>
        '<div class="archiv-jahr"><div class="archiv-jahr-kopf">'+esc(label)+' · '+ks.length+'</div>'+
        sortiereKurse(ks).map(k=>'<div class="zeile"><span>'+esc(k.name)+' · '+esc(k.fach)+'</span>'+
          '<span class="u-akt"><button class="btn still u-btn-klein" data-reaktivieren="'+k.id+'" title="Wieder aktiv setzen">'+iconHtml('erneut')+' aktivieren</button><button class="btn still u-btn-klein" data-oeffnen="'+k.id+'">öffnen</button><button class="btn gefahr u-btn-klein" data-loeschen="'+k.id+'">löschen</button></span></div>').join('')+'</div>').join('')+'</details>';
  }
  // Jahresabschluss: selten + folgenreich → eigener Verwaltungsbereich unten statt Kopfzeile (C4)
  html+='<div class="kurse-fuss"><span class="u-leise">Jahresabschluss</span><button class="btn still u-btn-klein" id="btn-schuljahr">Neues Schuljahr…</button></div>';
  wrap.innerHTML=html;
  $('btn-stundenplan').onclick=spEingerichtet?stundenplanAnsicht:stundenplanAssistent;  // Reinschauen = 1 Tap; Einrichten nur, wenn noch nichts da ist (S256d)
  $('btn-schuljahr').onclick=schuljahrAssistent;
  const bz=$('btn-zeitraeume'); if(bz) bz.onclick=zeitraeumeDialog;
  $('btn-kurs-anlegen').onclick=kursAnlegenSheet;
  wrap.querySelectorAll('[data-kurs]').forEach(b=>b.onclick=()=>oeffneKurs(b.dataset.kurs));
  wrap.querySelectorAll('[data-verwalten]').forEach(b=>b.onclick=()=>kursDetailSheet(b.dataset.verwalten));
  wrap.querySelectorAll('[data-oeffnen]').forEach(b=>b.onclick=()=>{ aktiverKursId=b.dataset.oeffnen; aktualisiereKursChip(); aktView='schueler'; document.querySelectorAll('#hauptnav button').forEach(x=>x.classList.toggle('aktiv',x.dataset.view==='schueler')); setzeViewTitel('schueler'); ['heute','deck','schueler','kurse','mehr'].forEach(v=>$('view-'+v).classList.toggle('hidden',v!=='schueler')); renderSchueler(); toast('Archiv-Kurs (schreibgeschützt)'); });
  wrap.querySelectorAll('[data-loeschen]').forEach(b=>b.onclick=()=>loescheKursEndgueltig(b.dataset.loeschen));
  wrap.querySelectorAll('[data-reaktivieren]').forEach(b=>b.onclick=()=>reaktiviereKurs(b.dataset.reaktivieren));
  // Fachfarbe je Kachel — erst nach innerHTML, weil das Band im HTML-String entsteht
  wrap.querySelectorAll('.kurs-karte[data-kurs]').forEach(b=>
    faerbe(b.querySelector('.kurs-band'),vault.stamm.kurse.find(x=>x.id===b.dataset.kurs)));
  // Stapel-Import (Zero 2026-08-30): mehrere kurs.json auf einmal — der PC-Konverter
  // (mappen_konverter.py) wirft pro Mappe eine Datei aus, die kommen zum Schuljahresstart im Bund.
  // Je Datei eigenes try: eine kaputte Datei darf die anderen nicht mitreissen (fail-soft je Kurs,
  // fail-closed je Datei). Gespeichert wird EINMAL am Ende, nicht je Kurs.
  $('file-kurs').onchange=async e=>{
    const dateien=[...e.target.files]; if(!dateien.length) return;
    const geladen=[], fehler=[], abgleiche=[]; let warnungen=0;
    if(dateien.some(f=>/\.xlsx$/i.test(f.name))&&!xlsxLesbar()){
      toast('⚠ Dieser Browser kann keine Mappen entpacken — bitte kurs.json vom PC nutzen',5000);
      e.target.value=''; return;
    }
    for(const f of dateien){
      try {
        // Mappe (.xlsx) wird hier gelesen, kurs.json bleibt der Weg vom PC-Werkzeug —
        // beide Leser muessen dasselbe ergeben, gesichert durch test/mappe.test.mjs
        const kursJson=/\.xlsx$/i.test(f.name) ? await lieseMappe(f,f.name) : JSON.parse(await f.text());
        if(kursJson.schema!=='kladde/v1'||!kursJson.kurs) throw new Error('kein kladde/v1-Kurs');
        const k=kursJson.kurs; k.slot=k.slot||'m1';
        const idx=vault.stamm.kurse.findIndex(x=>x.id===k.id);
        warnungen+=kursJson.warnungen?.length||0;
        if(idx>=0){ abgleiche.push({k:vault.stamm.kurse[idx],neu:kursJson.schueler}); continue; }   // Bestand: erst abgleichen, dann anwenden (Punkt 12)
        vault.stamm.kurse.push(k);
        vault.stamm.schueler[k.id]=kursJson.schueler;
        geladen.push(k);
      } catch(err){ fehler.push(f.name+': '+err.message); }
    }
    for(const a of abgleiche){ if(await listenAbgleichDialog(a.k,a.neu)) geladen.push(a.k); }   // nacheinander, jeder Kurs sein Blatt
    if(geladen.length){
      stammMutiert(); speichern();
      aktiverKursId=geladen[geladen.length-1].id; aktualisiereKursChip();
      renderKurse();
    }
    // Ein Toast fuer den ganzen Stapel — bei genau einem Kurs bleibt der Wortlaut wie bisher
    const teile=[];
    if(geladen.length===1) teile.push('Importiert: '+geladen[0].name+' ('+(vault.stamm.schueler[geladen[0].id]||[]).length+' Schüler)');
    else if(geladen.length) teile.push('Importiert: '+geladen.length+' Kurse ('+geladen.map(k=>k.name).join(' · ')+')');
    if(warnungen) teile.push(warnungen+' Warnung(en)');
    if(fehler.length) teile.push('⚠ '+fehler.length+' Datei(en) nicht gelesen — '+fehler.join(' | '));
    if(teile.length) toast(teile.join(' · '),fehler.length?6000:3500);
    e.target.value='';
  };
}
// Kurs-Detail-Sheet (Studio): Einstellungen (Slot/Noten/HA) + Aktionen aus der Karten-Ansicht.
// el()/dlgZeigenEl — CSP-sauber (kein innerHTML). dlgZu() vor jeder Aktion → sauberer Wechsel in #dlg- ODER Vollbild-Ziele.
function kursDetailSheet(id){
  const k=vault.stamm.kurse.find(x=>x.id===id); if(!k) return;
  const anz=kursSchueler(k).length;
  const p=vault.stamm.kursprofile[k.id]||{};
  const slotSel=el('select',{onchange:e=>{ k.slot=e.target.value; stammMutiert(); speichern(); toast('Export-Slot: '+e.target.value); }},
    ...['m1','m2','m3','m4','m5','m6'].map(m=>el('option',(k.slot||'m1')===m?{selected:'selected'}:{},m)));
  const zeilen=[el('div',{class:'zeile'},el('span',{},'Kladde-m-Slot (Export)'),el('span',{},slotSel))];
  // Farbe je Kurs (Zero 2026-08-30): der Fach-Standard ist vorbelegt, die Wahl gilt nur hier.
  // Sie ueberschreibt nur den Farbton — Helligkeit und Buntheit bleiben, damit kein Kurs sticht.
  const tupfer=[el('button',{class:'farbtupf auto'+(Number.isFinite(k.farbHue)?'':' an'),title:'Standard des Fachs',
    onclick:()=>{ delete k.farbHue; stammMutiert(); speichern(); renderKurse(); kursDetailSheet(id); }},'Fach')];
  for(const h of WAEHLER_HUES){
    const t=el('button',{class:'farbtupf'+(k.farbHue===h?' an':''),title:'Farbe '+h+'°',
      onclick:()=>{ k.farbHue=h; stammMutiert(); speichern(); renderKurse(); kursDetailSheet(id); }});
    t.style.setProperty('--f',fachFarbe(k.fach,h));
    tupfer.push(t);
  }
  zeilen.push(el('div',{class:'zeile'},el('span',{},'Farbe'),el('span',{class:'farbwahl'},...tupfer)));
  if(k.profil==='sek2'){
    // Bewertungsmodus ändert den semantischen Rahmen aller Vorschläge → Bestätigung statt Still-Speichern (C4)
    const nmSel=el('select',{onchange:e=>{
      const neu=e.target.value;
      if(neu===(k.notenmodus||'punkte')) return;
      const label=neu==='drittel'?'Drittelnoten':'Punkte 0–15';
      dlgZeigenEl(
        el('h3',{},'Noten-Eingabe wechseln?'),
        el('p',{class:'u-hinweis'},'Dieser Kurs verwendet künftig '+label+'. Vorschläge und Noteneingaben erscheinen dann in dieser Einheit — bereits erfasste Ereignisse bleiben unverändert.'),
        el('div',{class:'btn-reihe'},
          el('button',{class:'btn',onclick:()=>{ k.notenmodus=neu; stammMutiert(); speichern(); toast('Sek II: '+label); kursDetailSheet(id); }},'Wechseln'),
          el('button',{class:'btn still',onclick:()=>kursDetailSheet(id)},'Abbrechen')));
    }},
      el('option',{value:'punkte',...((k.notenmodus||'punkte')==='punkte'?{selected:'selected'}:{})},'Punkte 0–15'),
      el('option',{value:'drittel',...(k.notenmodus==='drittel'?{selected:'selected'}:{})},'Drittelnoten'));
    zeilen.push(el('div',{class:'zeile'},el('span',{},'Sek II · Noten-Eingabe'),el('span',{},nmSel)));
  }
  const haCb=el('input',{type:'checkbox',class:'u-check',...(p.ha?{checked:'checked'}:{}),onchange:e=>{ vault.stamm.kursprofile[k.id]={...(vault.stamm.kursprofile[k.id]||{}),ha:e.target.checked}; stammMutiert(); speichern(); }});
  zeilen.push(el('div',{class:'zeile'},el('span',{},'HA-Typ aktiv (SekI-Schule: aus)'),el('span',{},haCb)));
  dlgZeigenEl(
    el('h3',{},k.name+' · '+k.fach),
    el('p',{class:'u-hinweis'},profilLabel(k)+' · '+anz+' Schüler'),
    ...zeilen,
    el('div',{class:'btn-reihe'},
      el('button',{class:'btn still',onclick:()=>{ dlgZu(); schuelerPflegeDialog(k.id); }},'Teilnehmer'),
      el('button',{class:'btn still',onclick:()=>{ dlgZu(); sitzplanEditor(k.id); }},'Sitzplan bearbeiten')),
    el('div',{class:'btn-reihe'},
      el('button',{class:'btn still',onclick:()=>{ dlgZu(); slotsEditor(k.id); }},'Stundenplan-Slots'),
      el('button',{class:'btn still',onclick:()=>{ dlgZu(); gruppenEditor(k.id); }},'Halbgruppen')),
    el('div',{class:'btn-reihe'},
      el('button',{class:'btn still',onclick:()=>{ dlgZu(); kursDuplizierenDialog(k.id); }},'Duplizieren (anderes Fach)…')),
    el('div',{class:'btn-reihe'},
      el('button',{class:'btn gefahr',onclick:()=>{ dlgZu(); archiviereKurs(k.id); }},'Archivieren'),
      el('button',{class:'btn still',onclick:()=>{ dlgZu(); renderKurse(); }},'Fertig')));
}
// Quartals-Grenzen (Zero 2026-09-02): die Zeiträume kamen bisher nur aus standardZeitraeume() und waren nirgends
// änderbar. Vier Quartale sind die Eingabe; die Halbjahre folgen daraus (HJ1 = Q1-Anfang … Q2-Ende, HJ2 analog),
// damit Liste, Noten-Tabelle und Quartalsnoten-Karte nie auseinanderlaufen. Gilt für das aktive Schuljahr.
function zeitraeumeDialog(){
  const sj=aktivesSchuljahr(); if(!sj){ toast('Kein aktives Schuljahr'); return; }
  const zr=sj.zeitraeume||[];
  const q=['q1','q2','q3','q4'].map(id=>zr.find(z=>z.id===id)).filter(Boolean);
  if(q.length<4){ toast('Zeiträume unvollständig — Schuljahr neu anlegen'); return; }
  const felder=q.map(z=>({z,von:el('input',{type:'date',value:z.von}),bis:el('input',{type:'date',value:z.bis})}));
  const fehler=el('div',{class:'u-fehlerfeld'});
  dlgZeigenEl(el('h3',{},'Quartale · '+sj.label),
    el('p',{class:'u-hinweis'},'Datumsgrenzen der Quartale. Die Halbjahre ergeben sich daraus (1. HJ = Anfang Q1 bis Ende Q2). Einträge bleiben unberührt — nur die Zuordnung zu Zeiträumen ändert sich.'),
    ...felder.map(f=>el('div',{class:'zeile'},el('span',{},f.z.label),el('span',{},f.von,' – ',f.bis))),
    fehler,
    el('div',{class:'btn-reihe'},
      el('button',{class:'btn',onclick:()=>{
        for(let i=0;i<felder.length;i++){
          const f=felder[i];
          if(!f.von.value||!f.bis.value){ fehler.textContent=f.z.label+': Datum fehlt'; return; }
          if(f.bis.value<f.von.value){ fehler.textContent=f.z.label+': Ende liegt vor dem Anfang'; return; }
          if(i>0&&f.von.value<=felder[i-1].bis.value){ fehler.textContent=f.z.label+' muss nach dem '+felder[i-1].z.label+' beginnen'; return; }
        }
        for(const f of felder){ f.z.von=f.von.value; f.z.bis=f.bis.value; }
        const hj1=zr.find(z=>z.id==='hj1'), hj2=zr.find(z=>z.id==='hj2');
        if(hj1){ hj1.von=felder[0].von.value; hj1.bis=felder[1].bis.value; }
        if(hj2){ hj2.von=felder[2].von.value; hj2.bis=felder[3].bis.value; }
        stammMutiert(); speichern(); dlgZu(); toast('Quartale gespeichert'); renderKurse();
      }},'Speichern'),
      el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
}
// Kurs duplizieren (Punkt 13): gleiche Klasse in zweitem Fach — Liste, Sitzplan (mit Lücken), Halbgruppen und
// Kursprofil kommen mit; Einträge nie. Die Farbe folgt dem neuen Fach (kein geerbter farbHue).
function kursDuplizierenDialog(id){
  const k=vault.stamm.kurse.find(x=>x.id===id); if(!k) return;
  const nameIn=el('input',{type:'text',value:k.name,class:'u-w130'});
  const fachIn=el('input',{type:'text',value:'',placeholder:'z. B. Physik',class:'u-w160',list:'fach-liste'});
  dlgZeigenEl(el('h3',{},'Kurs duplizieren'),
    el('p',{class:'u-hinweis'},'Übernommen werden Schülerliste, Sitzplan, Halbgruppen und Einstellungen — keine Einträge.'),
    el('div',{class:'zeile'},el('span',{},'Klasse/Kurs'),el('span',{},nameIn)),
    el('div',{class:'zeile'},el('span',{},'Fach'),el('span',{},fachIn,fachDatalist())),
    el('div',{class:'btn-reihe'},
      el('button',{class:'btn',onclick:()=>{
        const name=nameIn.value.trim(), fach=fachIn.value.trim();
        if(!name||!fach){ toast('Name und Fach angeben'); return; }
        const neuId=slugId(name+'-'+fach+'-'+(k.schuljahr||''));
        if(vault.stamm.kurse.some(x=>x.id===neuId)){ toast('Diesen Kurs gibt es schon'); return; }
        const {farbHue:_f,...rest}=k;
        vault.stamm.kurse.push({...rest,id:neuId,name,fach,status:'aktiv'});
        vault.stamm.schueler[neuId]=JSON.parse(JSON.stringify(vault.stamm.schueler[k.id]||[]));
        if(vault.stamm.sitzplaene[k.id]) vault.stamm.sitzplaene[neuId]=JSON.parse(JSON.stringify(vault.stamm.sitzplaene[k.id]));
        if(vault.stamm.kursprofile[k.id]) vault.stamm.kursprofile[neuId]={...vault.stamm.kursprofile[k.id]};
        stammMutiert(); speichern(); dlgZu(); renderKurse(); toast('Dupliziert: '+name+' · '+fach);
      }},'Anlegen'),
      el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
  setTimeout(()=>fachIn.focus(),60);
}
// Liste aus Mappe AKTUALISIEREN (Punkt 12): Abgleich über die Nr zeigen, dann anwenden — nie still ersetzen.
// → Promise<boolean> (true = übernommen), damit der Stapel-Import mehrere Kurse nacheinander abfragen kann.
function listenAbgleichDialog(k,neu){
  return new Promise(res=>{
    const alt=vault.stamm.schueler[k.id]||[];
    const ab=listenAbgleich(alt,neu);
    if(!(ab.neue.length+ab.entfernt.length+ab.reaktiviert.length+ab.geaendert.length)){ toast(k.name+': Liste unverändert ('+ab.gleich+' Schüler)'); res(false); return; }
    const hatEv=nr=>vault.events.some(e=>e.kursId===k.id&&e.schuelerNr===nr&&e.typ!=='storno');
    const block=(titel,arr,fmt)=>arr.length?[el('div',{class:'tag-kopf'},titel+' ('+arr.length+')'),...arr.slice(0,40).map(x=>el('div',{class:'zeile'},el('span',{},fmt(x))))]:[];
    dlgZeigenEl(el('h3',{},'Liste aktualisieren · '+k.name),
      el('p',{class:'u-hinweis'},'Die Mappe wird über die Nr mit dem Bestand abgeglichen. Sitzplan, Halbgruppen und Einträge bleiben. '+ab.gleich+' Schüler unverändert.'),
      el('div',{class:'u-scroll58'},
        ...block('Neu',ab.neue,s=>'Nr '+s.nr+' · '+s.vorname+' '+s.name+(s.lb?' · LB':'')),
        ...block('Geändert',ab.geaendert,g=>'Nr '+g.nr+' · '+g.alt.vorname+' '+g.alt.name+' → '+g.neu.vorname+' '+g.neu.name+(!!g.alt.lb!==!!g.neu.lb?(g.neu.lb?' · LB':' · LB weg'):'')),
        ...block('Nicht mehr in der Mappe',ab.entfernt,s=>'Nr '+s.nr+' · '+s.vorname+' '+s.name+(hatEv(s.nr)?' → wird deaktiviert (hat Einträge)':' → wird entfernt')),
        ...block('Wieder in der Mappe',ab.reaktiviert,s=>'Nr '+s.nr+' · '+s.vorname+' '+s.name+' → wieder aktiv')),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn',onclick:()=>{
          vault.stamm.schueler[k.id]=wendeAbgleichAn(alt,ab,hatEv);
          const grid=(vault.stamm.sitzplaene[k.id]||{}).grid; if(grid) for(const e of ab.entfernt) for(const key in grid) if(grid[key]===e.nr) delete grid[key];
          stammMutiert(); speichern(); dlgZu(); res(true);
        }},'Übernehmen'),
        el('button',{class:'btn still',onclick:()=>{ dlgZu(); res(false); }},'Abbrechen')));
  });
}
// Kurs anlegen — Auswahl-Sheet (Geführt / Schnell / kurs.json), aus der dashed Karte im Grid.
function kursAnlegenSheet(){
  dlgZeigenEl(
    el('h3',{},'Kurs anlegen'),
    el('p',{class:'u-hinweis'},'Am einfachsten: die Kursmappe(n) direkt laden — auch mehrere auf einmal. Alternativ in Excel die Listen-Spalten (Nr · Name · Vorname · ggf. LB) markieren, kopieren und hier einfügen.'),
    el('div',{class:'btn-reihe'},
      el('button',{class:'btn',onclick:()=>{ dlgZu(); kursWizard(); }},'Geführt (Wizard)'),
      el('button',{class:'btn still',onclick:()=>{ dlgZu(); kursAnlegenDialog(); }},'Schnell (Einfügen)'),
      el('button',{class:'btn still',onclick:()=>{ dlgZu(); $('file-kurs').click(); }},'Mappe laden (.xlsx)')));
}
// Teilnehmer nachträglich pflegen — hinzufügen/deaktivieren/reaktivieren (Zero 2026-07-09 · Tombstone-P0 2026-07-10).
// Eine Nr wird NIE an ein anderes Kind vergeben: Deaktivierte bleiben mit inaktiv:true im Stamm
// (Events + Excel-Zeile bleiben gebunden, Reaktivieren möglich); Nrn aus Alt-Events meidet freieNr per Scan.
// Fokus-sicher: neu gerendert wird NUR bei Submit/Aktion, nie beim Tippen (Stundenplan-Lehre).
function schuelerPflegeDialog(kursId){
  const k=vault.stamm.kurse.find(x=>x.id===kursId); if(!k) return;
  if(k.status==='archiviert'){ toast('Archivierter Kurs — schreibgeschützt'); return; }
  const alle=()=>vault.stamm.schueler[k.id]||[];
  const freieNr=()=>{
    const belegt=new Set(alle().map(s=>s.nr));
    for(const e of vault.events) if(e.kursId===k.id) belegt.add(e.schuelerNr);
    for(let n=1;n<=MAX_SCHUELER;n++) if(!belegt.has(n)) return n;
    return null;
  };
  const raeumeSitzplatz=(nr)=>{ const grid=(vault.stamm.sitzplaene[k.id]||{}).grid; if(grid) for(const key in grid) if(grid[key]===nr) delete grid[key]; };
  const deaktiviere=(s)=>{
    const hatEv=vault.events.some(e=>e.kursId===k.id&&e.schuelerNr===s.nr&&e.typ!=='storno');
    if(!hatEv){
      // Ohne Einträge ist echtes Entfernen gefahrlos (kein Erbe möglich) — der Tippfehler-Weg.
      // Hat der ganze KURS noch keine Einträge, dürfen die Folgenden nachrücken (Zero 2026-09-02):
      // in Excel war die Zeile gelöscht und die Mappe zählte neu — Nr n = Zeile n+5 muss stimmen
      // (MAPPING.md §1). Sobald irgendein Eintrag existiert, binden Events an Nrn → nur noch Lücke lassen.
      const kursHatEv=vault.events.some(e=>e.kursId===k.id&&e.typ!=='storno');
      const dahinter=alle().filter(x=>x.nr>s.nr).length;
      const nachrueckbar=!kursHatEv&&dahinter>0;
      const nurEntfernen=()=>{
        vault.stamm.schueler[k.id]=alle().filter(x=>x.nr!==s.nr);
        raeumeSitzplatz(s.nr);
        stammMutiert(); speichern(); toast('Entfernt: '+(s.vorname||s.name)); zeige();
      };
      const nachruecken=()=>{
        const r=entferneNachrueckend(alle(),(vault.stamm.sitzplaene[k.id]||{}).grid||{},s.nr);
        vault.stamm.schueler[k.id]=r.schueler;
        if(vault.stamm.sitzplaene[k.id]) vault.stamm.sitzplaene[k.id].grid=r.grid;
        stammMutiert(); speichern(); toast('Entfernt: '+(s.vorname||s.name)+' · '+dahinter+' nachgerückt'); zeige();
      };
      dlgZeigenEl(
        el('h3',{},'Entfernen?'),
        el('p',{class:'u-hinweis'},s.vorname+' '+s.name+' hat noch keine Einträge und wird vollständig entfernt.'),
        el('p',{class:'u-hinweis'},nachrueckbar
          ?'Der Kurs hat noch keine Einträge: die '+dahinter+' Schüler nach Nr '+s.nr+' können nachrücken — wie die Excel-Liste nach dem Löschen der Zeile.'
          :(kursHatEv?'Nr '+s.nr+' wird wieder frei — die anderen Nummern bleiben, weil der Kurs schon Einträge hat.':'Nr '+s.nr+' wird wieder frei.')),
        el('div',{class:'btn-reihe'},
          ...(nachrueckbar?[el('button',{class:'btn gefahr',onclick:nachruecken},'Entfernen, Rest rückt nach')]:[]),
          el('button',{class:'btn '+(nachrueckbar?'still':'gefahr'),onclick:nurEntfernen},nachrueckbar?'Nur entfernen (Nr '+s.nr+' bleibt frei)':'Entfernen'),
          el('button',{class:'btn still',onclick:zeige},'Abbrechen')));
      return;
    }
    dlgZeigenEl(
      el('h3',{},'Deaktivieren?'),
      el('p',{class:'u-hinweis'},s.vorname+' '+s.name+' aus allen Listen und dem Sitzplan nehmen? Die Einträge bleiben erhalten. Nr '+s.nr+' bleibt für dieses Kind reserviert — Reaktivieren ist jederzeit möglich.'),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn gefahr',onclick:()=>{
          s.inaktiv=true;
          raeumeSitzplatz(s.nr);
          stammMutiert(); speichern(); toast('Deaktiviert: '+(s.vorname||s.name)); zeige();
        }},'Deaktivieren'),
        el('button',{class:'btn still',onclick:zeige},'Abbrechen')));
  };
  // Namenskorrektur (Zero 2026-08-30): Der Name ist reine Anzeige — gebunden wird ueber die Nr
  // (MAPPING.md §1: "Namen werden NIE zum Matchen benutzt"), Events/Sitzplan/Sync/Excel-Zeile bleiben also
  // unberuehrt. Fokus-sicher wie der Stundenplan: kein oninput, neu gerendert wird erst bei Speichern.
  const bearbeite=(s)=>{
    const vnIn=el('input',{type:'text',value:s.vorname||'',placeholder:'Vorname',class:'u-w130'});
    const nnIn=el('input',{type:'text',value:s.name||'',placeholder:'Nachname',class:'u-w130'});
    const lbIn=el('input',{type:'checkbox',class:'u-check',...(s.lb?{checked:'checked'}:{})});
    dlgZeigenEl(
      el('h3',{},'Bearbeiten · Nr '+s.nr),
      el('p',{class:'u-hinweis'},'Nr '+s.nr+' bleibt — Bewertungen, Sitzplan und Excel-Zeile bleiben gebunden.'),
      el('div',{class:'zeile'},el('span',{},'Name'),el('span',{},vnIn,' ',nnIn)),
      el('div',{class:'zeile'},el('span',{},'LB (zieldifferent)'),lbIn),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn',onclick:()=>{
          const vorname=vnIn.value.trim(), name=nnIn.value.trim();
          if(!vorname&&!name){ toast('Name fehlt'); return; }
          s.vorname=vorname; s.name=name; s.lb=lbIn.checked;
          stammMutiert(); speichern(); toast('Geändert: '+(vorname||name)); zeige();
        }},'Speichern'),
        el('button',{class:'btn still',onclick:zeige},'Abbrechen')));
  };
  const zeige=()=>{
    // Anzeige alphabetisch nach Nachname; die Nr bleibt intern der feste Anker (Events/Sitzplan/Sync/Excel-Zeile)
    const sortiert=arr=>arr.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','de')||(a.vorname||'').localeCompare(b.vorname||'','de'));
    const aktive=sortiert(alle().filter(s=>!s.inaktiv));
    const inaktive=sortiert(alle().filter(s=>s.inaktiv));
    const zeilen=aktive.length?aktive.map(s=>el('div',{class:'zeile'},
      el('span',{},s.vorname+' '+s.name+(s.lb?' · LB':''),el('small',{class:'u-leise'},' · Nr '+s.nr)),
      el('span',{class:'u-akt'},
        el('button',{class:'btn still u-btn-klein',title:'Bearbeiten',onclick:()=>bearbeite(s)},iconEl('notiz')),
        el('button',{class:'btn gefahr u-btn-klein',title:'Deaktivieren',onclick:()=>deaktiviere(s)},iconEl('papierkorb'))))):[el('p',{class:'u-leise'},'Noch keine Schüler.')];
    const inaktivBlock=inaktive.length?[el('div',{class:'tag-gruppe'},
      el('div',{class:'tag-kopf'},'Inaktiv (Nr bleibt reserviert)'),
      ...inaktive.map(s=>el('div',{class:'zeile'},
        el('span',{class:'u-leise'},s.vorname+' '+s.name+' · Nr '+s.nr),
        el('button',{class:'btn still u-btn-klein',title:'Reaktivieren',onclick:()=>{ s.inaktiv=false; stammMutiert(); speichern(); toast('Reaktiviert: '+(s.vorname||s.name)); zeige(); }},iconEl('erneut')))))]:[];
    const vnIn=el('input',{type:'text',placeholder:'Vorname',class:'u-w130'});
    const nnIn=el('input',{type:'text',placeholder:'Nachname',class:'u-w130'});
    const lbIn=el('input',{type:'checkbox',class:'u-check'});
    const hinzu=()=>{
      const vorname=vnIn.value.trim(), name=nnIn.value.trim();
      if(!vorname&&!name){ toast('Name fehlt'); return; }
      const list=vault.stamm.schueler[k.id]=vault.stamm.schueler[k.id]||[];
      const nr=freieNr();
      if(nr===null){ toast('Keine freie Nr mehr — alle '+MAX_SCHUELER+' sind vergeben oder reserviert'); return; }
      list.push({nr,name,vorname,lb:lbIn.checked}); list.sort((a,b)=>a.nr-b.nr);
      stammMutiert(); speichern(); toast('Hinzugefügt: '+(vorname||name)); zeige();
    };
    dlgZeigenEl(
      el('h3',{},'Teilnehmer · '+k.name),
      el('p',{class:'u-hinweis'},aktive.length+' Schüler · alphabetisch nach Nachname · die Nr vergibt das System (max '+MAX_SCHUELER+') und vergibt sie nie doppelt.'),
      el('div',{class:'u-scroll30'},...zeilen),
      ...inaktivBlock,
      el('div',{class:'tag-gruppe'},
        el('div',{class:'tag-kopf'},'Hinzufügen'),
        el('div',{class:'zeile'},el('span',{},'Name'),el('span',{},vnIn,' ',nnIn)),
        el('div',{class:'zeile'},el('span',{},'LB (zieldifferent)'),lbIn),
        el('div',{class:'btn-reihe'},el('button',{class:'btn',onclick:hinzu},'＋ Hinzufügen'))),
      el('div',{class:'btn-reihe'},el('button',{class:'btn still',onclick:()=>{ dlgZu(); renderKurse(); }},'Fertig')));
  };
  zeige();
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
  const aktiveKurse=sortiereKurse(vault.stamm.kurse.filter(k=>(k.schuljahrId||vault.stamm.aktivesSchuljahrId)===alt.id&&k.status!=='archiviert'));
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
// Archivierung zurücknehmen (Zero 2026-08-30). Zwei Fälle, weil die Kursliste NUR das aktive
// Schuljahr zeigt: ein Kurs aus einem früheren Jahr stünde nach dem Reaktivieren weder in der
// Liste noch im Archiv — er wäre unsichtbar. Darum wandert er dann ins aktive Schuljahr, und
// das wird vorher gesagt statt still getan. Die Kurs-Id bleibt unangetastet (Events, Sitzplan
// und Excel-Zeile hängen daran), nur schuljahrId/schuljahr werden nachgezogen.
function reaktiviereKurs(id){
  const k=vault.stamm.kurse.find(x=>x.id===id); if(!k) return;
  const aktivId=vault.stamm.aktivesSchuljahrId;
  const sj=aktivesSchuljahr();
  const machs=(jahrWechsel)=>{
    k.status='aktiv';
    if(jahrWechsel){ k.schuljahrId=aktivId; if(sj) k.schuljahr=sj.label; }
    stammMutiert(); speichern(); renderKurse();
    toast('Wieder aktiv: '+k.name+(jahrWechsel&&sj?' · jetzt in '+sj.label:''));
  };
  if((k.schuljahrId||aktivId)===aktivId){ machs(false); return; }  // gleiches Jahr: einfach zurück
  const alt=(vault.stamm.schuljahre||[]).find(j=>j.id===k.schuljahrId)?.label||'einem früheren Jahr';
  dlgZeigenEl(
    el('h3',{},'Kurs zurückholen?'),
    el('p',{class:'u-hinweis'},k.name+' · '+k.fach+' gehört zu '+alt+'. Die Kursliste zeigt nur das aktive Schuljahr — der Kurs wird deshalb nach '+(sj?sj.label:'das aktive Jahr')+' geholt.'),
    el('p',{class:'u-hinweis'},'Alle bisherigen Einträge dieses Kurses kommen mit. Wenn du nur die Struktur (Namen, Sitzplan) ins neue Jahr übernehmen willst, ist „Neues Schuljahr…" der richtige Weg — der lässt die Bewertungen im alten Jahr.'),
    el('div',{class:'btn-reihe'},
      el('button',{class:'btn',onclick:()=>{ dlgZu(); machs(true); }},'Zurückholen'),
      el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
}
// Fach-Vorschlagsliste: EIN Feld zum Tippen UND Auswaehlen (datalist ist im Werk erprobt —
// die Sitzplan-Platzvergabe nutzt es schon). Freitext bleibt moeglich; die Normalisierung in
// fachfarben.mjs faengt „Mathe"/„MA"/„SoWi" ohnehin ab.
function fachDatalist(){
  return el('datalist',{id:'fach-liste'},...FACH_LISTE.map(f=>el('option',{value:f})));
}
// Fachfarbe auf ein Element legen. Per CSSOM, weil inline style-Attribute per CSP gesperrt sind.
function faerbe(elm,k){ if(elm&&k) elm.style.setProperty('--f',fachFarbe(k.fach,k.farbHue)); }
// Erster Kurs eines Wochenplan-Blocks (fuer die Faerbung der Stundenplan-Zelle)
// woche = 'A'|'B' filtert auf den Rhythmus (Punkt 14, Ansicht „diese Woche"); null = alle Slots
const passtWoche=(p,woche)=>!woche||!p.rhythmus||p.rhythmus==='jede'||p.rhythmus===woche;
function wochenplanZellKurs(plan,wt,nr,woche=null){
  const s=plan.find(p=>p.wochentag===wt&&p.blockNr===nr&&passtWoche(p,woche));
  return s?(vault.stamm.kurse.find(x=>x.id===s.kursId)||null):null;
}
// Slot-Art eines Blocks (klasse/reserve) oder null — für die gestrichelte Zell-Optik
function wochenplanZellArt(plan,wt,nr,woche=null){ const s=plan.find(p=>p.wochentag===wt&&p.blockNr===nr&&p.art&&passtWoche(p,woche)); return s?s.art:null; }
const slotArtLabel=s=>(s&&s.art&&SLOT_ARTEN[s.art])?SLOT_ARTEN[s.art].label:'';
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
  const keyOf=kachel=>kachel.dataset.r+','+kachel.dataset.c;  // explizite Reihe,Platz — Ghost-Zeilen-Layout (nicht mehr DOM-Index)
  toast('Namen aus der Leiste auf Plätze ziehen · Platz→Platz verschiebt · in den Mülleimer = entfernen · leeren Platz antippen wählt klassisch',6500);

  // ── Editor-Leiste: Namen-Schiene (noch nicht platziert) + Mülleimer + Fertig ──
  const rail=el('div',{class:'sp-rail'});
  const trash=el('div',{class:'sp-trash',title:'Zum Entfernen hierher ziehen'},iconEl('papierkorb'));
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
  function zielReset(){ plan.querySelectorAll('.kachel.ziel, .reihe-plus.ziel').forEach(z=>z.classList.remove('ziel')); trash.classList.remove('ziel'); }
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
    else { const plus=t&&t.closest('.reihe-plus');
      if(plus&&plan.contains(plus)) plus.classList.add('ziel');  // Drop-zwischen: neue Reihe hier (Ghost-Punkt 2)
      else { const kach=t&&t.closest('.kachel'); if(kach&&plan.contains(kach)) kach.classList.add('ziel'); } }
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
    const plus=t&&t.closest('.reihe-plus');
    if(plus&&plan.contains(plus)){  // Drop auf ＋ zwischen den Reihen → neue Reihe dort, Schüler an der Finger-Spalte (Ghost-Punkt 2)
      if(d.vonKey) delete g[d.vonKey];
      const reihe=plan.querySelector('.plan-reihe'); let c=0;
      if(reihe){ const rr=reihe.getBoundingClientRect(); c=Math.max(0,Math.min(11,Math.floor((e.clientX-rr.left)/(rr.width/12)))); }
      reiheEinfuegen(Number(plus.dataset.vor),d.nr,c);
      renderRail(); toast('Neue Reihe');
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
  const plusClick=e=>{ const p=e.target.closest('.reihe-plus'); if(p){ e.stopPropagation(); reiheEinfuegen(Number(p.dataset.vor)); return; }
    const l=e.target.closest('.luecke-btn'); if(l){ e.stopPropagation(); toggleLuecke(Number(l.dataset.luecke)); } };
  rail.addEventListener('pointerdown',railDown);
  plan.addEventListener('click',plusClick);
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
  function reiheEinfuegen(vorR,dropNr,dropC){  // Ghost-＋: Reihen ab vorR um +1 schieben → leere Reihe bei vorR; optional Schüler direkt hineindroppen
    const g=sp().grid, neu={};
    for(const key in g){ const [r,c]=key.split(',').map(Number); neu[(r>=vorR?r+1:r)+','+c]=g[key]; }
    if(dropNr!=null) neu[vorR+','+dropC]=dropNr;
    sp().luecken=(sp().luecken||[]).map(r=>r>=vorR?r+1:r);   // markierte Lücken rücken mit
    vault.stamm.sitzplaene[k.id].grid=neu; stammMutiert(); speichern(); renderHeute();
  }
  function kompaktiere(){  // leere Reihen raus — außer markierte Lücken (Gang); r-Werte neu durchnummerieren (0,1,2…) — Nr bleibt der Anker, nur die Position ändert sich
    const o=sp(), g=o.grid;
    const belegte=[...new Set(Object.keys(g).map(key=>Number(key.split(',')[0])))].sort((a,b)=>a-b);
    const maxB=belegte.length?belegte[belegte.length-1]:-1;
    const luecken=new Set((o.luecken||[]).filter(r=>!belegte.includes(r)&&r<maxB));   // Lücke nur ZWISCHEN belegten Reihen; eine besetzte Reihe ist keine Lücke mehr
    const alle=[...new Set([...belegte,...luecken])].sort((a,b)=>a-b);
    const neu={}, neuL=[];
    alle.forEach((altR,neuR)=>{ if(luecken.has(altR)){ neuL.push(neuR); return; } for(let c=0;c<12;c++){ const nr=g[altR+','+c]; if(nr!=null) neu[neuR+','+c]=nr; } });
    o.grid=neu; o.luecken=neuL; stammMutiert(); speichern();
  }
  function toggleLuecke(r){  // „Lücke lassen" ↔ aufheben (Zero 2026-09-02: leere Reihe zwischen Tischen bewusst stehen lassen)
    const o=sp(), l=new Set(o.luecken||[]);
    if(l.has(r)) l.delete(r); else l.add(r);
    o.luecken=[...l].sort((a,b)=>a-b); stammMutiert(); speichern(); renderHeute();
  }
  function beenden(){
    kompaktiere();
    editorAktiv=false; editorCleanup=null;
    document.body.classList.remove('sp-edit','sp-dragging');
    rail.removeEventListener('pointerdown',railDown);
    plan.removeEventListener('click',plusClick);
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
// Zell-Beschriftung eines Wochenplan-Blocks — EINE Quelle für Ansicht UND Assistent (S256d).
// Zeigt ALLE Slots des Blocks (A/B-Paare: „8c (A) · 7b (B)" — vorher verschwand der zweite).
function wochenplanZellText(plan,wt,nr,woche=null){
  const slots=plan.filter(p=>p.wochentag===wt&&p.blockNr===nr&&passtWoche(p,woche));
  if(!slots.length) return '—';
  // Klasse UND Fach-Kuerzel (Zero 2026-08-30): dieselbe Klasse in zwei Faechern war sonst
  // nicht auseinanderzuhalten — man riet.
  return slots.map(s=>{ if(s.art) return (SLOT_ARTEN[s.art]||{}).kurz||s.art;   // Klassen-/Reservestunde: kein Kurs
    const k=vault.stamm.kurse.find(x=>x.id===s.kursId);
    const kz=k?fachKuerzel(k.fach):'';
    return (k?k.name+(kz?' '+kz:''):'?')+(s.teilgruppe?'·'+s.teilgruppe:'')+(s.rhythmus&&s.rhythmus!=='jede'?' ('+s.rhythmus+')':''); }).join(' · ');
}
/* ── Ausfall & Vertretung (S257 · „was macht man wenn eine Stunde oder ein Tag ausfällt") ──
   Schreibt NUR das bestehende, Node-getestete ausnahmeSlots-Modell (Ausnahme schlägt Plan ·
   kursId null = Entfall ⇒ Autowahl „frei"). Für die NOTEN ist Ausfall ohnehin folgenlos —
   Kurstermine entstehen nur aus Events (verbotener Pfad 3); die Griffe heilen die ANZEIGE. */
function ausnahmeFuer(datum,blockNr){ return (vault.stamm.ausnahmeSlots||[]).find(a=>a.datum===datum&&a.blockNr===blockNr)||null; }
function setzeAusnahme(datum,blockNr,kursId,grund){ // ersetzt einen vorhandenen Eintrag des Blocks (find() nimmt sonst den alten)
  vault.stamm.ausnahmeSlots=(vault.stamm.ausnahmeSlots||[]).filter(a=>!(a.datum===datum&&a.blockNr===blockNr));
  vault.stamm.ausnahmeSlots.push({datum,blockNr,kursId,teilgruppe:null,grund:grund||null});
  stammMutiert(); speichern();
}
function entferneAusnahme(datum,blockNr){
  vault.stamm.ausnahmeSlots=(vault.stamm.ausnahmeSlots||[]).filter(a=>!(a.datum===datum&&a.blockNr===blockNr));
  stammMutiert(); speichern();
}
function naechstesDatumFuerWt(wt,abIso){ // ab-Datum (Default heute), wenn der Wochentag passt — sonst das nächste Vorkommen
  const d=abIso?new Date(abIso+'T12:00:00'):new Date();
  for(let i=0;i<7;i++){
    if(((d.getDay()+6)%7)+1===wt) return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    d.setDate(d.getDate()+1);
  }
  return heuteIso();
}
function schultagAb(startIso,richtung){ // nächster/voriger Mo–Fr-Tag (Wochenenden übersprungen)
  const d=new Date(startIso+'T12:00:00');
  do{ d.setDate(d.getDate()+richtung); }while(((d.getDay()+6)%7)+1>5);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
// Ausnahme-Blatt einer Stunde: Entfall · Vertretung · Rücknahme · ganzer Tag — datumsbezogen.
// „Zurück zum Plan" kehrt auf das im Blatt gewählte Datum zurück (der Rückweg IST der Datums-Sprung).
function ausnahmeBlatt(wt,blockNr,datumVorbelegt){
  const zm=(vault.stamm.zeitmodelle||[])[0]; if(!zm) return;
  const planText=wochenplanZellText(vault.stamm.wochenplan||[],wt,blockNr);
  const datumIn=el('input',{type:'date',value:datumVorbelegt||naechstesDatumFuerWt(wt)});
  const status=el('div',{class:'sp-ergebnis'});
  const aktionen=el('div',{});
  const kursSel=el('select',{},...sortiereKurse(vault.stamm.kurse.filter(k=>k.status!=='archiviert')).map(k=>el('option',{value:k.id},k.name+' · '+k.fach)));
  const zeige=()=>{
    const d=datumIn.value; if(!d){ status.replaceChildren(); return; }
    const wtVonDatum=((new Date(d+'T12:00:00').getDay()+6)%7)+1;
    const falschTag=wtVonDatum!==wt;
    const a=ausnahmeFuer(d,blockNr);
    // Nur BELEGTE Stunden können ausfallen (Zero 2026-09-02: der Tages-Entfall trug auch freie Stunden als „entfällt" ein)
    const kontextOhne={wochenplan:vault.stamm.wochenplan||[],ausnahmen:[],zeitmodell:zm};
    const geplant=geplanteBlockNrn(d,wt,resolveBloecke(zm,wt,d),kontextOhne);
    const dieserGeplant=geplant.includes(blockNr);
    // Stunde tauschen (Punkt 17): zwei Blöcke desselben Tages tauschen ihre Kurse — als zwei Vertretungen mit Grund „tausch"
    const meinPlan=slotFuerBlock(d,wt,blockNr,kontextOhne);
    const tauschKandidaten=meinPlan&&meinPlan.kursId?geplant.filter(nr=>nr!==blockNr).map(nr=>({nr,slot:slotFuerBlock(d,wt,nr,kontextOhne)})).filter(x=>x.slot&&x.slot.kursId):[];
    const tauschSel=el('select',{},...tauschKandidaten.map(x=>el('option',{value:String(x.nr)},'Std. '+blockLabel(zm,x.nr,d)+' · '+((vault.stamm.kurse.find(kk=>kk.id===x.slot.kursId)||{}).name||x.slot.kursId))));
    const alleEntfall=geplant.length>0&&geplant.every(nr=>{ const x=ausnahmeFuer(d,nr); return x&&x.kursId===null; });
    status.replaceChildren(el('b',{class:a?(a.kursId?'u-gut':'u-fehl'):'u-leise'},
      falschTag?'Achtung: Datum ist kein '+WT_KURZ[wt]+' — bitte prüfen'
      :(a?(a.kursId?('Vertretung: '+((vault.stamm.kurse.find(k=>k.id===a.kursId)||{}).name||a.kursId)):'Fällt aus'):'Keine Ausnahme — es gilt der Plan')));
    aktionen.replaceChildren(
      el('div',{class:'btn-reihe'},
        ...(dieserGeplant
          ?[el('button',{class:'btn gefahr',onclick:()=>{ setzeAusnahme(datumIn.value,blockNr,null,'entfall'); toast('Std. '+blockLabel(zm,blockNr,datumIn.value)+' am '+datumLabel(datumIn.value)+' fällt aus'); kursAutowahl(); zeige(); }},'Fällt aus')]
          :[el('span',{class:'u-hinweis u-selfcenter'},'Laut Plan frei — nichts, was ausfallen könnte.')]),
        ...(a?[el('button',{class:'btn still',onclick:()=>{ entferneAusnahme(datumIn.value,blockNr); toast('Ausnahme entfernt — es gilt der Plan'); kursAutowahl(); zeige(); }},'Ausnahme entfernen')]:[])),
      el('div',{class:'zeile'},el('span',{},'Vertretung'),el('span',{},kursSel,' ',
        el('button',{class:'btn still u-btn-klein',onclick:()=>{ setzeAusnahme(datumIn.value,blockNr,kursSel.value,'vertretung'); toast('Vertretung gesetzt'); kursAutowahl(); zeige(); }},'Setzen'))),
      ...(tauschKandidaten.length?[el('div',{class:'zeile'},el('span',{},'Tauschen mit'),el('span',{},tauschSel,' ',
        el('button',{class:'btn still u-btn-klein',onclick:()=>{
          const andere=Number(tauschSel.value); const s2=slotFuerBlock(d,wt,andere,kontextOhne);
          setzeAusnahme(d,blockNr,s2.kursId,'tausch'); setzeAusnahme(d,andere,meinPlan.kursId,'tausch');
          toast('Getauscht: Std. '+blockLabel(zm,blockNr,d)+' ↔ Std. '+blockLabel(zm,andere,d)); kursAutowahl(); zeige();
        }},'Tauschen')))]:[]),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn still',onclick:()=>{
          const d2=datumIn.value;
          if(alleEntfall){ for(const b of resolveBloecke(zm,wt,d2)) entferneAusnahme(d2,b.blockNr); toast('Tages-Entfall zurückgenommen'); }
          else if(!geplant.length){ toast('Laut Plan ist an diesem Tag nichts — kein Entfall nötig'); }
          else { for(const nr of geplant) setzeAusnahme(d2,nr,null,'entfall'); toast(datumLabel(d2)+' fällt komplett aus ('+geplant.length+' Std.)'); }   // datumLabel trägt den Wochentag schon („Mo Mo" war ein Vorbestand)
          kursAutowahl(); zeige();
        }},alleEntfall?'Tages-Entfall zurücknehmen':'Ganzer Tag fällt aus')));
  };
  datumIn.addEventListener('change',zeige);
  zeige();
  dlgZeigenEl(el('h3',{},WT_KURZ[wt]+' · Std. '+blockLabel(zm,blockNr)),
    el('p',{class:'u-hinweis'},'Laut Plan: '+planText+'. Ausnahmen gelten nur am gewählten Datum — der Wochenplan bleibt unberührt. Für die Noten ist Ausfall ohnehin folgenlos (Termine entstehen nur aus Einträgen).'),
    el('div',{class:'zeile'},el('span',{},'Datum'),el('span',{},datumIn)),
    status, aktionen,
    el('div',{class:'btn-reihe'},el('button',{class:'btn',onclick:()=>stundenplanAnsicht(datumIn.value||undefined)},'‹ Zurück zum Plan')));
}
// ── Stundenplan-ANSICHT (S256d/S257b) ──
// Oben der TAGESBLICK (S257b · „Features, die das Leben erleichtern"): die einzige Stelle, die
// Raster + Wochenplan + A/B-Woche + Kurztag + Ausfälle/Vertretungen für ein KONKRETES Datum
// zusammensetzt — blätterbar über Schultage, Zeile antippen = Ausnahme-Blatt mit diesem Datum.
// Darunter die generische Wochen-Matrix; „Bearbeiten…" → Assistent.
let ansichtWoche=null;   // 'A' | 'B' | 'beide' — Wochenfilter der Stundenplan-Ansicht (Punkt 14), null = Woche des Tagesblicks
function stundenplanAnsicht(ansichtDatum){
  const zm=(vault.stamm.zeitmodelle||[])[0];
  if(!zm){ stundenplanAssistent(); return; }
  const plan=vault.stamm.wochenplan||[];
  const heute=heuteIso();
  const heuteWt=((new Date().getDay()+6)%7)+1;
  // Tagesblick-Datum: gewünschtes Datum, Wochenende rollt auf den nächsten Schultag
  let tagDatum=ansichtDatum||heute;
  if(((new Date(tagDatum+'T12:00:00').getDay()+6)%7)+1>5) tagDatum=schultagAb(tagDatum,1);
  const tagWt=((new Date(tagDatum+'T12:00:00').getDay()+6)%7)+1;
  const kontext={wochenplan:plan,ausnahmen:vault.stamm.ausnahmeSlots||[],zeitmodell:zm};
  const jetztS=new Date(), jetztSek=jetztS.getHours()*3600+jetztS.getMinutes()*60+jetztS.getSeconds();
  const ferien=istFerien(zm,tagDatum);                       // Punkt 15: Ferientag → keine Zeilen, Name im Kopf
  const tagBloecke=ferien?[]:resolveBloecke(zm,tagWt,tagDatum);
  const zeilen=[];
  for(const b of tagBloecke){
    const slot=slotFuerBlock(tagDatum,tagWt,b.blockNr,kontext);
    const planSlot=slotFuerBlock(tagDatum,tagWt,b.blockNr,{...kontext,ausnahmen:[]});
    if(!slot&&!planSlot) continue;                             // freie Stunde ohne Plan und Ausnahme
    const entfall=!!(slot&&slot.entfall);
    const wirksam=entfall?null:(slot||planSlot);
    const kZeig=wirksam?vault.stamm.kurse.find(x=>x.id===wirksam.kursId):(planSlot?vault.stamm.kurse.find(x=>x.id===planSlot.kursId):null);
    const vertretung=!entfall&&slot&&slot.quelle==='ausnahme';
    const laeuft=tagDatum===heute&&jetztSek>=b.startSek&&jetztSek<=b.endeSek;
    zeilen.push(el('button',{class:'sp-tag-zeile'+(laeuft?' sp-jetzt':''),title:'Ausfall/Vertretung…',
      onclick:()=>ausnahmeBlatt(tagWt,b.blockNr,tagDatum)},
      el('span',{class:'sp-tz-std'},'Std. '+blockLabel(zm,b.blockNr,tagDatum)),
      el('span',{class:'sp-tz-zeit'},formatZeit(b.startSek)+'–'+formatZeit(b.endeSek)),
      el('span',{class:'sp-tz-kurs'+(entfall?' sp-entf':'')},(kZeig?kZeig.name+' · '+kZeig.fach:(slotArtLabel(wirksam||planSlot)||'—'))+(wirksam&&wirksam.teilgruppe?' · Gr. '+wirksam.teilgruppe:'')),
      entfall?el('span',{class:'sp-tz-badge fehl'},'entfällt'):(vertretung?el('span',{class:'sp-tz-badge'},'Vertretung'):el('span',{}))));
  }
  const wocheAktuell=zm.abWochenAnker?istAWoche(tagDatum,zm.abWochenAnker):null;
  const woche=wocheAktuell?' · '+wocheAktuell+'-Woche':'';
  const kurz=(zm.kurztage||[]).includes(tagDatum)?' · Kurzstunden':'';
  const tagblick=el('div',{class:'sp-tagblick'},
    el('div',{class:'sp-tag-kopf'},
      el('button',{class:'tg-chip','aria-label':'voriger Schultag',onclick:()=>stundenplanAnsicht(schultagAb(tagDatum,-1))},'‹'),
      el('span',{class:'sp-tag-titel'},(tagDatum===heute?'Heute · ':'')+datumLabel(tagDatum)+tagDatum.slice(0,4)+woche+kurz+(ferien?' · '+ferien.name:'')),
      el('button',{class:'tg-chip','aria-label':'nächster Schultag',onclick:()=>stundenplanAnsicht(schultagAb(tagDatum,1))},'›'),
      tagDatum!==heute?el('button',{class:'tg-chip',onclick:()=>stundenplanAnsicht()},'Heute'):el('span',{})),
    ...(zeilen.length?zeilen:[el('p',{class:'u-hinweis'},ferien?'Ferien/Feiertag: '+ferien.name+' — kein Unterricht.':'Kein Unterricht an diesem Tag.')]));
  // Wochenansicht nach A/B (Punkt 14): Default = Rhythmus der Tagesblick-Woche · „beide" zeigt alle Slots wie bisher
  const zeigWoche=zm.abWochenAnker?(ansichtWoche||wocheAktuell):null;
  const filterWoche=zeigWoche==='beide'?null:zeigWoche;
  const abChips=zm.abWochenAnker?el('div',{class:'sp-tagchips'},...[['A','A-Woche'],['B','B-Woche'],['beide','beide']].map(([v,t])=>
    el('button',{class:'tg-chip'+(zeigWoche===v?' an':''),'aria-pressed':String(zeigWoche===v),onclick:()=>{ ansichtWoche=v; stundenplanAnsicht(tagDatum); }},t+(v===wocheAktuell?' (aktuell)':'')))):el('span',{});
  const grid=el('div',{class:'sp-woche'});
  grid.append(el('div',{class:'sp-ecke'},''));
  for(const wt of [1,2,3,4,5]){ const abw=!!(zm.tagesAusnahmen||{})[wt];
    grid.append(el('div',{class:'sp-th'+(wt===heuteWt?' sp-heute':''),...(abw?{title:'abweichende Zeiten — siehe Bearbeiten'}:{})},WT_KURZ[wt]+(abw?' *':''))); }
  const regel=resolveBloecke(zm,1);
  for(let nr=1;nr<=zm.bloeckeProTag;nr++){
    const rb=regel[nr-1];
    grid.append(el('div',{class:'sp-th sp-blockkopf'},blockLabel(zm,nr),el('small',{class:'sp-zeit'},rb?formatZeit(rb.startSek)+'–'+formatZeit(rb.endeSek):'')));
    for(const wt of [1,2,3,4,5]){
      const laeuft=wt===heuteWt&&autowahlInfo&&autowahlInfo.blockNr===nr;
      const zellText=wochenplanZellText(plan,wt,nr,filterWoche);
      const spZelle=el('button',{class:'sp-zelle sp-lese'+(zellText!=='—'?' belegt':'')+(wochenplanZellArt(plan,wt,nr,filterWoche)?' sp-art':'')+(laeuft?' sp-jetzt':''),
        title:(laeuft?'läuft gerade · ':'')+'Ausfall/Vertretung…',
        onclick:()=>ausnahmeBlatt(wt,nr,naechstesDatumFuerWt(wt,tagDatum))},zellText);
      faerbe(spZelle,wochenplanZellKurs(plan,wt,nr,filterWoche));
      grid.append(spZelle);
    }
    const p=zm.pausenNachBlock[nr]??zm.pausenNachBlock[String(nr)]??0;
    if(p&&nr<zm.bloeckeProTag) grid.append(el('div',{class:'sp-pausenzeile'},'Pause · '+(p/60)+' min'));
  }
  // Kommende Ausnahmen (S257): datumsgebunden — das Wochen-Grid kann sie nicht tragen, die Zeile schon.
  const ausn=(vault.stamm.ausnahmeSlots||[]).filter(a=>a.datum>=heute).sort((x,y)=>x.datum===y.datum?x.blockNr-y.blockNr:(x.datum<y.datum?-1:1));
  const ausnBox=el('div',{});
  if(ausn.length){
    ausnBox.append(el('div',{class:'tag-kopf'},'Kommende Ausnahmen'));
    for(const a of ausn.slice(0,8)){
      const kName=a.kursId?((vault.stamm.kurse.find(k=>k.id===a.kursId)||{}).name||a.kursId):null;
      ausnBox.append(el('div',{class:'zeile'},
        el('span',{},datumLabel(a.datum)+a.datum.slice(0,4)+' · Std. '+blockLabel(zm,a.blockNr,a.datum)+' — '+(kName?(a.grund==='tausch'?'Tausch: ':'Vertretung: ')+kName:'fällt aus')),
        el('span',{},el('button',{class:'btn still u-btn-klein',title:'Ausnahme entfernen',onclick:()=>{ entferneAusnahme(a.datum,a.blockNr); kursAutowahl(); stundenplanAnsicht(); }},'✕'))));
    }
    if(ausn.length>8) ausnBox.append(el('p',{class:'u-hinweis'},'… und '+(ausn.length-8)+' weitere'));
  }
  const kommende=(zm.kurztage||[]).filter(d=>d>=heute).sort();
  dlgZeigenEl(el('h3',{},'Stundenplan'),
    tagblick,
    el('p',{class:'u-hinweis'},'Stunde antippen für Ausfall/Vertretung.'),
    abChips,
    el('div',{class:'sp-woche-wrap'},grid),
    ausnBox,
    kommende.length?el('p',{class:'u-hinweis'},'Kurzstunden-Tage ('+(zm.zweitRaster?(zm.zweitRaster.dauerSekunden/60)+' min':'')+'): '+kommende.map(d=>datumLabel(d)+d.slice(0,4)).join(' · ')):el('span',{}),
    el('div',{class:'btn-reihe'},
      el('button',{class:'btn still',onclick:()=>{ dlgZu(); stundenplanAssistent(); }},'Bearbeiten…'),
      el('button',{class:'btn',onclick:dlgZu},'Schließen')));
  dlgBreit();
}
function stundenplanAssistent(){
  // Arbeitskopie (erst bei „Fertig" in den Vault) — bestehendes Zeitmodell weiterbearbeiten
  const zm0=(vault.stamm.zeitmodelle||[])[0];
  const zm=zm0?JSON.parse(JSON.stringify(zm0)):{id:'std',name:'Regelraster',startSekunden:27900,dauerSekunden:4050,bloeckeProTag:6,pausenNachBlock:{},tagesAusnahmen:{},abWochenAnker:null,anzeigeRunden:true};
  const plan=JSON.parse(JSON.stringify(vault.stamm.wochenplan||[]));
  let schritt=1, malKurs;   // Maler-Zustand (S256b): undefined = kein Kurs in der Hand · 'FREI' · kursId
  const dlg=$('dlg');
  const speichereUndZu=()=>{
    vault.stamm.zeitmodelle=[zm];
    vault.stamm.wochenplan=plan;
    stammMutiert(); speichern(); dlgZu();
    kursAutowahl(); renderAlles(); // aktive Ansicht (auch Kurse) auffrischen
    toast('Stundenplan gespeichert');
  };
  // Wochenplan-Eintrag: Kurs-Id ODER Stempel ohne Kurs ('@klasse'/'@reserve' → art, Zero 2026-09-02)
  const neuerSlot=(wt,nr,wert)=>wert.startsWith('@')
    ?{id:'wp-'+wt+'-'+nr,wochentag:wt,blockNr:nr,kursId:null,art:wert.slice(1),teilgruppe:null,rhythmus:'jede'}
    :{id:'wp-'+wt+'-'+nr,wochentag:wt,blockNr:nr,kursId:wert,teilgruppe:null,rhythmus:'jede'};

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
    // Tages-genaue Vorschau (Mo–Fr-Chips) mit Minuten-Feld je Block: abweichende Dauern (Konferenztag 45,
    // Oberstufe 90) landen in tagesAusnahmen[tag].blockDauern — Folgeblöcke rücken live (Zero 2026-07-09).
    // Fokus-Lehre: beim Tippen werden NUR die Zeit-Spans beschrieben, nie die Inputs neu gebaut (FEHLER 2026-07-09).
    let vorschauTag=1;
    const zeitSpans=[];
    const zeitenRefresh=()=>{
      resolveBloecke(zm,vorschauTag).forEach((b,i)=>{
        const sek=(b.startSek%60)||(b.endeSek%60);
        if(zeitSpans[i]) zeitSpans[i].textContent=formatZeit(b.startSek)+'–'+formatZeit(b.endeSek)+(sek?' ('+formatZeit(b.startSek,false)+'–'+formatZeit(b.endeSek,false)+')':'');
      });
    };
    const nurVorschau=()=>{
      zeitSpans.length=0;
      const ausn=(zm.tagesAusnahmen||{})[vorschauTag]||{};
      // Stunden je Tag (S256b): ersetzt die alte „Freitag kürzer"-Checkbox — gilt für JEDEN Tag
      // (Zeros Konferenz-Dienstag endet nach Stunde 4). onchange statt oninput: Neubau erst nach
      // Verlassen/Spinner-Klick, der Fokus überlebt das Tippen (Stundenplan-Lehre).
      const tagBloecke=el('input',{type:'number',min:'1',max:'12',value:String(ausn.bloeckeProTag??zm.bloeckeProTag),class:'u-w72'+(ausn.bloeckeProTag!=null?' sp-dmin abweich':''),
        onchange:e=>{ const v=parseInt(e.target.value,10); if(!(v>=1&&v<=12)) return;
          zm.tagesAusnahmen=zm.tagesAusnahmen||{};
          const a=zm.tagesAusnahmen[vorschauTag]=zm.tagesAusnahmen[vorschauTag]||{};
          if(v===zm.bloeckeProTag){ delete a.bloeckeProTag; if(!Object.keys(a).length) delete zm.tagesAusnahmen[vorschauTag]; }
          else a.bloeckeProTag=v;
          nurVorschau();
        }});
      vorschau.replaceChildren(
        el('div',{class:'tag-kopf'},'So sieht der Tag aus:'),
        el('div',{class:'sp-tagchips'}, ...[1,2,3,4,5].map(wt=>el('button',{class:'tg-chip'+(vorschauTag===wt?' an':''),onclick:()=>{ vorschauTag=wt; nurVorschau(); }},WT_KURZ[wt]))),
        el('div',{class:'zeile'},el('span',{},'Stunden am '+WT_KURZ[vorschauTag]),el('span',{},tagBloecke)));
      const regelDauer=ausn.dauerSekunden??zm.dauerSekunden;
      for(const b of resolveBloecke(zm,vorschauTag)){
        const zs=el('span',{class:'wert'});
        zeitSpans.push(zs);
        const abw=(ausn.blockDauern||{})[b.blockNr]!=null;
        const din=el('input',{type:'number',min:'20',max:'180',step:'0.5',value:String((b.endeSek-b.startSek)/60),class:'u-w72 sp-dmin'+(abw?' abweich':''),
          oninput:e=>{ const v=parseFloat(e.target.value.replace(',','.')); if(!(v>0)) return;
            const sekNeu=Math.round(v*60);
            zm.tagesAusnahmen=zm.tagesAusnahmen||{};
            const a=zm.tagesAusnahmen[vorschauTag]=zm.tagesAusnahmen[vorschauTag]||{};
            a.blockDauern=a.blockDauern||{};
            if(sekNeu===regelDauer){ delete a.blockDauern[b.blockNr]; e.target.classList.remove('abweich');
              if(!Object.keys(a.blockDauern).length) delete a.blockDauern;
              if(!Object.keys(a).length) delete zm.tagesAusnahmen[vorschauTag]; }
            else { a.blockDauern[b.blockNr]=sekNeu; e.target.classList.add('abweich'); }
            zeitenRefresh();
          }});
        vorschau.append(el('div',{class:'zeile'},el('span',{},'Std. '+blockLabel(zm,b.blockNr)+' ',din,' min'),zs));
      }
      zeitenRefresh();
    };
    const renderVorschau=()=>{ renderPausen(); nurVorschau(); };
    // ── Vorlagen (S256b · „intuitiv zuerst"): ein Tap füllt die ARBEITSKOPIE komplett —
    // Zeiten, Pausen, Konferenztag, Stunden-Nummern, Kurzraster. Gespeichert wird erst bei
    // „Fertig"; alle Felder darunter bleiben die Feinjustierung.
    const vorlagenBox=el('div',{class:'sp-tagchips sp-vorlagen'},
      ...RASTER_VORLAGEN.map(v=>el('button',{class:'tg-chip',title:v.hinweis,'aria-label':'Vorlage: '+v.name,
        onclick:()=>{ const kopie=JSON.parse(JSON.stringify(v.zeitmodell));
          zm.startSekunden=kopie.startSekunden; zm.dauerSekunden=kopie.dauerSekunden; zm.bloeckeProTag=kopie.bloeckeProTag;
          zm.pausenNachBlock=kopie.pausenNachBlock; zm.tagesAusnahmen=kopie.tagesAusnahmen||{};
          zm.blockLabels=kopie.blockLabels||null; zm.zweitRaster=kopie.zweitRaster||null;
          zm.kurztage=zm.kurztage||[];   // eingetragene Kurztage überleben den Vorlagen-Wechsel
          renderS1(); toast('Vorlage „'+v.name+'" übernommen — „Fertig" speichert');
        }},v.name)));
    // ── Kurzstunden-Tage (S256b): an gelisteten DATEN gilt das Zweitraster (z. B. 7×45 min) —
    // Wochenplan und Stundenfolge bleiben, nur die Uhrzeiten wechseln (Autowahl folgt automatisch).
    const kurzBox=el('div',{});
    const renderKurz=()=>{
      kurzBox.replaceChildren(el('div',{class:'tag-kopf'},'Kurzstunden-Tage'));
      if(!zm.zweitRaster){
        kurzBox.append(
          el('p',{class:'u-hinweis'},'Für Tage mit verkürzten Stunden (Zeugniskonferenz, Hitzefrei-Plan …).'),
          el('div',{class:'btn-reihe'},el('button',{class:'btn still u-btn-klein',onclick:()=>{
            zm.zweitRaster=JSON.parse(JSON.stringify(KURZRASTER_45)); zm.kurztage=zm.kurztage||[]; renderKurz();
          }},'45-Minuten-Kurzraster anlegen')));
        return;
      }
      const zr=zm.zweitRaster;
      const zb=resolveBloecke({...zr,tagesAusnahmen:{}},1);
      kurzBox.append(el('div',{class:'zeile'},
        el('span',{},zr.name||'Kurzraster',el('small',{class:'u-leise'},' · '+formatZeit(zb[0].startSek)+'–'+formatZeit(zb[zb.length-1].endeSek)+' · '+zr.bloeckeProTag+'×'+(zr.dauerSekunden/60)+' min')),
        el('span',{},el('button',{class:'btn still u-btn-klein',onclick:kurzrasterDialog},'ändern…'))));
      for(const d of (zm.kurztage||[]).slice().sort()){
        kurzBox.append(el('div',{class:'zeile'},
          el('span',{},datumLabel(d)+d.slice(0,4)),
          el('span',{},el('button',{class:'btn still u-btn-klein',title:'Tag entfernen',onclick:()=>{ zm.kurztage=zm.kurztage.filter(x=>x!==d); renderKurz(); }},'✕'))));
      }
      const din=el('input',{type:'date'});
      kurzBox.append(el('div',{class:'zeile'},el('span',{},din),
        el('span',{},el('button',{class:'btn still u-btn-klein',onclick:()=>{
          const d=din.value;
          if(!d){ toast('Datum wählen'); return; }
          if((zm.kurztage||[]).includes(d)){ toast('Tag ist schon eingetragen'); return; }
          (zm.kurztage=zm.kurztage||[]).push(d); renderKurz();
        }},'＋ Tag'))));
    };
    // Feinjustierung des Kurzrasters — gleiche Felder wie das Hauptraster, zurück nach S1.
    function kurzrasterDialog(){
      const zr=zm.zweitRaster;
      const pBox=el('div',{class:'sp-pausen'});
      const vBox=el('div',{class:'sp-vorschau'});
      const vAkt=()=>{ const b=resolveBloecke({...zr,tagesAusnahmen:{}},1);
        vBox.replaceChildren(...b.map(x=>el('div',{class:'zeile'},el('span',{},'Std. '+x.blockNr),el('span',{class:'wert'},formatZeit(x.startSek)+'–'+formatZeit(x.endeSek)+((x.startSek%60||x.endeSek%60)?' ('+formatZeit(x.startSek,false)+'–'+formatZeit(x.endeSek,false)+')':''))))); };
      const pAkt=()=>{ pBox.replaceChildren();
        for(let n=1;n<zr.bloeckeProTag;n++){
          const pin=el('input',{type:'number',min:'0',max:'120',step:'0.5',value:String((zr.pausenNachBlock[n]||0)/60),class:'u-w110',
            oninput:e=>{ const v=parseFloat(e.target.value.replace(',','.')); zr.pausenNachBlock[n]=Math.round((v||0)*60); vAkt(); }});
          pBox.append(el('div',{class:'zeile'},el('span',{},'Pause nach Std. '+n),el('span',{},pin,' min')));
        } };
      const startIn=el('input',{type:'time',value:formatZeit(zr.startSekunden),class:'u-w130',
        oninput:e=>{ const [h,m]=e.target.value.split(':').map(Number); if(!isNaN(h)){ zr.startSekunden=h*3600+m*60; vAkt(); } }});
      const dauerIn=el('input',{type:'number',min:'20',max:'120',step:'0.5',value:String(zr.dauerSekunden/60),class:'u-w110',
        oninput:e=>{ const v=parseFloat(e.target.value.replace(',','.')); if(v>0){ zr.dauerSekunden=Math.round(v*60); vAkt(); } }});
      const blockIn=el('input',{type:'number',min:'1',max:'12',value:String(zr.bloeckeProTag),class:'u-w110',
        onchange:e=>{ const v=parseInt(e.target.value,10); if(v>=1&&v<=12){ zr.bloeckeProTag=v; pAkt(); vAkt(); } }});
      pAkt(); vAkt();
      dlgZeigenEl(el('h3',{},'Kurzstunden-Raster'),
        el('div',{class:'zeile'},el('span',{},'Beginn'),el('span',{},startIn)),
        el('div',{class:'zeile'},el('span',{},'Stundenlänge (min)'),el('span',{},dauerIn)),
        el('div',{class:'zeile'},el('span',{},'Stunden'),el('span',{},blockIn)),
        pBox, vBox,
        el('div',{class:'btn-reihe'},
          el('button',{class:'btn',onclick:()=>renderS1()},'Fertig'),
          el('button',{class:'btn gefahr u-btn-klein',onclick:()=>{ zm.zweitRaster=null; zm.kurztage=[]; renderS1(); }},'Kurzraster entfernen')));
    }
    // Ferien & Feiertage (Punkt 15): Datumsbereiche — die Autowahl sagt dort „frei", der Tagesblick zeigt den Namen
    const ferienBox=el('div',{});
    const renderFerien=()=>{
      ferienBox.replaceChildren(el('div',{class:'tag-kopf'},'Ferien & Feiertage'));
      for(const f of (zm.ferien||[]).slice().sort((a,b)=>a.von.localeCompare(b.von))){
        ferienBox.append(el('div',{class:'zeile'},el('span',{},f.name+' · '+datumLabel(f.von)+f.von.slice(0,4)+(f.bis!==f.von?' – '+datumLabel(f.bis)+f.bis.slice(0,4):'')),
          el('span',{},el('button',{class:'btn still u-btn-klein',title:'entfernen',onclick:()=>{ zm.ferien=zm.ferien.filter(x=>x!==f); renderFerien(); }},'✕'))));
      }
      const vonIn=el('input',{type:'date'}), bisIn=el('input',{type:'date'}), nameIn=el('input',{type:'text',placeholder:'z. B. Herbstferien',class:'u-w130'});
      ferienBox.append(el('div',{class:'zeile'},el('span',{},vonIn,' – ',bisIn),el('span',{},nameIn,' ',el('button',{class:'btn still u-btn-klein',onclick:()=>{
        const von=vonIn.value, bis=bisIn.value||vonIn.value, name=nameIn.value.trim()||'Ferien';
        if(!von){ toast('Datum wählen'); return; }
        if(bis<von){ toast('Ende liegt vor dem Anfang'); return; }
        (zm.ferien=zm.ferien||[]).push({von,bis,name}); renderFerien();
      }},'＋'))));
    };
    renderVorschau(); renderKurz(); renderFerien();
    dlgZeigenEl(kopf('Zeitraster'),
      el('p',{class:'u-hinweis'},'Vorlage antippen — oder unten frei einstellen:'),
      vorlagenBox,
      el('div',{class:'zeile'},el('span',{},'Unterrichtsbeginn'),el('span',{},startInput)),
      el('div',{class:'zeile'},el('span',{},'Blocklänge (min, 67,5 = 67.5)'),el('span',{},dauerInput)),
      el('div',{class:'zeile'},el('span',{},'Blöcke pro Tag'),el('span',{},blockInput)),
      pausenBox, vorschau, kurzBox, ferienBox,
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn',onclick:()=>{ schritt=2; renderS2(); }},'Weiter: Wochenplan'),
        el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
    dlgBreit();
  }

  // ── Schritt 2: Wochenplan — Kurs in die Hand nehmen und Stunden MALEN (S256b, Stempel-Paradigma
  // wie die Rail im Sitzplan) · ohne Auswahl öffnet der Tap die Details (Teilgruppe/A-B, Bestand) ──
  function renderS2(){
    const tage=[1,2,3,4,5];
    const grid=el('div',{class:'sp-woche'});
    const palette=el('div',{class:'sp-tagchips sp-malpalette'});
    const zelleText=(wt,nr)=>wochenplanZellText(plan,wt,nr);
    const renderPalette=()=>{
      const aid=vault.stamm.aktivesSchuljahrId;
      const kurse=vault.stamm.kurse.filter(k=>(k.schuljahrId||aid)===aid&&k.status!=='archiviert');
      const chip=(wert,txt,titel)=>el('button',{class:'tg-chip'+(malKurs===wert?' an':''),title:titel||'','aria-pressed':malKurs===wert?'true':'false',
        onclick:()=>{ malKurs=(malKurs===wert)?undefined:wert; renderPalette(); }},txt);   // nochmal antippen = ablegen (wie Stempel)
      // Fach sichtbar am Chip, nicht nur im title — auf dem iPad gibt es kein Hover. Farbband = Fachfarbe (Zero 2026-09-02: Farbschema auch beim Bearbeiten)
      const kursChip=k=>{ const c=chip(k.id,k.name+' '+fachKuerzel(k.fach),k.name+' · '+k.fach); c.classList.add('mal-chip'); c.prepend(el('span',{class:'mal-band'})); faerbe(c,k); return c; };
      palette.replaceChildren(
        ...sortiereKurse(kurse).map(kursChip),
        // Stempel ohne Kurs (Zero 2026-09-02): Klassenstunde · Reservestunde
        ...Object.entries(SLOT_ARTEN).map(([art,a])=>chip('@'+art,a.label,a.label+' — ohne Kurs')),
        chip('FREI','✕ frei','Stunde leeren'));
      if(!kurse.length) palette.append(el('span',{class:'u-hinweis'},'Noch keine Kurse — unter „Kurse" anlegen.'));
      grid.classList.toggle('malen',malKurs!==undefined);   // Kurs in der Hand: Touch scrollt nicht, der Finger malt (Punkt 16)
    };
    const male=(wt,nr)=>{ const i=plan.findIndex(p=>p.wochentag===wt&&p.blockNr===nr); if(i>=0) plan.splice(i,1); if(malKurs!=='FREI') plan.push(neuerSlot(wt,nr,malKurs)); };
    // Doppelstunden ziehen (Punkt 16): mit dem Kurs in der Hand über Zellen wischen — jede Zelle einmal je Strich.
    // Listener am Grid (nicht am Dokument): sie sterben mit dem Dialog. Ein reiner Tap bleibt der Klick-Weg.
    let strich=null, strichWar=false;
    grid.addEventListener('pointerdown',e=>{ if(malKurs===undefined) return; const z=e.target.closest('.sp-zelle'); if(!z) return; strich={start:z.dataset.wt+'-'+z.dataset.nr,gemalt:new Set(),bewegt:false}; });
    grid.addEventListener('pointermove',e=>{
      if(!strich) return;
      const t=document.elementFromPoint(e.clientX,e.clientY); const z=t&&t.closest('.sp-zelle'); if(!z||!grid.contains(z)) return;
      const key=z.dataset.wt+'-'+z.dataset.nr;
      if(!strich.bewegt){ if(key===strich.start) return; strich.bewegt=true; const [sw,sn]=strich.start.split('-').map(Number); male(sw,sn); strich.gemalt.add(strich.start); }
      if(!strich.gemalt.has(key)){ male(Number(z.dataset.wt),Number(z.dataset.nr)); strich.gemalt.add(key); renderGrid(); }
    });
    const strichEnde=()=>{ if(strich&&strich.bewegt){ strichWar=true; setTimeout(()=>{ strichWar=false; },0); renderGrid(); } strich=null; };
    grid.addEventListener('pointerup',strichEnde); grid.addEventListener('pointercancel',strichEnde); grid.addEventListener('pointerleave',strichEnde);
    const renderGrid=()=>{
      grid.replaceChildren();
      grid.append(el('div',{class:'sp-ecke'},''));
      // Tage mit Abweichung (blockDauern/Blockzahl) tragen ein * — Details in Schritt 1 (Tages-Chips)
      for(const wt of tage){ const abw=!!(zm.tagesAusnahmen||{})[wt];
        grid.append(el('div',{class:'sp-th',...(abw?{title:'abweichende Zeiten — siehe Zeitraster'}:{})},WT_KURZ[wt]+(abw?' *':''))); }
      const regel=resolveBloecke(zm,1);
      for(let nr=1;nr<=zm.bloeckeProTag;nr++){
        const rb=regel[nr-1];
        grid.append(el('div',{class:'sp-th sp-blockkopf'},blockLabel(zm,nr),el('small',{class:'sp-zeit'},rb?formatZeit(rb.startSek)+'–'+formatZeit(rb.endeSek):'')));
        for(const wt of tage){
          const belegt=plan.some(p=>p.wochentag===wt&&p.blockNr===nr);
          const zelle=el('button',{class:'sp-zelle'+(belegt?' belegt':'')+(wochenplanZellArt(plan,wt,nr)?' sp-art':''),dataset:{wt:String(wt),nr:String(nr)},onclick:()=>{
            if(strichWar){ strichWar=false; return; }                          // der Wisch-Strich hat schon gemalt (Punkt 16)
            if(malKurs===undefined){ blockDialog(wt,nr,renderGrid); return; }   // Detail-Weg (Teilgruppe/A-B) bleibt
            male(wt,nr); renderGrid();
          }},zelleText(wt,nr));
          faerbe(zelle,wochenplanZellKurs(plan,wt,nr));   // Fachfarbe wie in der Ansicht — fehlte im Editor (Zero 2026-09-02)
          grid.append(zelle);
        }
        const p=zm.pausenNachBlock[nr]??zm.pausenNachBlock[String(nr)]??0;
        if(p&&nr<zm.bloeckeProTag) grid.append(el('div',{class:'sp-pausenzeile'},'Pause · '+(p/60)+' min'));
      }
    };
    renderPalette(); renderGrid();
    const ab=zm.abWochenAnker;
    dlgZeigenEl(kopf('Wochenplan'),
      el('p',{class:'u-hinweis'},'Kurs antippen, dann Stunden malen — ohne Auswahl öffnet Tippen die Details (Teilgruppe, A/B-Woche).'),
      palette,
      el('div',{class:'sp-woche-wrap'},grid),
      (ab?el('div',{class:'zeile'},el('span',{},'A/B-Anker'),el('span',{class:'wert'},ab.datum+' = '+ab.typ)):el('span',{})),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn still',onclick:()=>{ schritt=1; renderS1(); }},'← Zeitraster'),
        el('button',{class:'btn',onclick:()=>{ schritt=3; renderS3(); }},'Weiter: Prüfen')));
    dlgBreit();
  }

  function blockDialog(wt,nr,zurueck){
    const s=plan.find(p=>p.wochentag===wt&&p.blockNr===nr)||{};
    const gewaehlt=s.art?'@'+s.art:(s.kursId||'');
    const kursSel=el('select',{},
      el('option',{value:''},'— frei —'),
      ...sortiereKurse(vault.stamm.kurse).map(k=>el('option',{value:k.id,...(gewaehlt===k.id?{selected:'selected'}:{})},k.name+' · '+k.fach)),
      ...Object.entries(SLOT_ARTEN).map(([art,a])=>el('option',{value:'@'+art,...(gewaehlt==='@'+art?{selected:'selected'}:{})},a.label)));
    const tgSel=el('select',{}, ...['','A','B','C','D'].map(g=>el('option',{value:g,...(s.teilgruppe===g?{selected:'selected'}:{})},g||'alle')));
    const rhSel=el('select',{}, ...[['jede','jede Woche'],['A','A-Woche'],['B','B-Woche']].map(([v,t])=>el('option',{value:v,...((s.rhythmus||'jede')===v?{selected:'selected'}:{})},t)));
    dlgZeigenEl(el('h3',{},WT_KURZ[wt]+' · Std. '+blockLabel(zm,nr)),
      el('div',{class:'zeile'},el('span',{},'Kurs'),el('span',{},kursSel)),
      el('div',{class:'zeile'},el('span',{},'Teilgruppe'),el('span',{},tgSel)),
      el('div',{class:'zeile'},el('span',{},'Rhythmus'),el('span',{},rhSel)),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn',onclick:()=>{
          const i=plan.findIndex(p=>p.wochentag===wt&&p.blockNr===nr);
          if(i>=0) plan.splice(i,1);
          const wert=kursSel.value;
          if(wert){
            const rhythmus=rhSel.value;
            plan.push({...neuerSlot(wt,nr,wert),teilgruppe:tgSel.value||null,rhythmus});
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
  // S256b: echtes DATUM statt Wochentag — so stimmen A/B-Woche UND Kurzstunden-Tage in der
  // Probe (vorher rechnete ein wochenneutraler Basis-Montag, der beides verfehlen konnte).
  function renderS3(){
    const jetzt=new Date();
    const datumInput=el('input',{type:'date',value:heuteIso()});
    const zeitInput=el('input',{type:'time',value:String(jetzt.getHours()).padStart(2,'0')+':'+String(jetzt.getMinutes()).padStart(2,'0'),class:'u-w130'});
    const ergebnis=el('div',{class:'sp-ergebnis'});
    const pruef=()=>{
      const d=datumInput.value||heuteIso();
      const [y,mo,ta]=d.split('-').map(Number); const [h,m]=zeitInput.value.split(':').map(Number);
      const basis=new Date(y,mo-1,ta,h||0,m||0,0);
      const wt=((basis.getDay()+6)%7)+1;
      const kurztag=!!(zm.zweitRaster&&(zm.kurztage||[]).includes(d));
      if(wt>5){ ergebnis.replaceChildren(el('b',{class:'u-leise'},'→ Wochenende — kein Unterricht')); return; }
      const t=kursZurZeit(basis,{zeitmodell:zm,wochenplan:plan,ausnahmen:vault.stamm.ausnahmeSlots||[]}); // echte Ausfälle/Vertretungen zählen mit (S257)
      const k=t&&vault.stamm.kurse.find(x=>x.id===t.kursId);
      const woche=zm.abWochenAnker?' · '+istAWocheLabel(d):'';
      ergebnis.replaceChildren(el('b',{class:t?'u-gut':'u-leise'},
        t?('→ '+(k?k.name+' · '+k.fach:(slotArtLabel(t)||t.kursId))+' · Std. '+blockLabel(zm,t.blockNr,d)+(t.teilgruppe?' · Gr. '+t.teilgruppe:'')+(t.quelle==='kommend'?' (gleich)':'')):'→ frei / kein Kurs'),
        el('div',{class:'u-hinweis'},WT_KURZ[wt]+woche+(kurztag?' · Kurzstunden-Tag ('+(zm.zweitRaster.dauerSekunden/60)+' min)':'')));
    };
    pruef();
    dlgZeigenEl(kopf('Autowahl prüfen'),
      el('p',{class:'u-hinweis'},'Datum und Zeit einstellen — so entscheidet die Kladde im Unterricht (auch A/B-Woche und Kurzstunden-Tage).'),
      el('div',{class:'zeile'},el('span',{},'Testzeit'),el('span',{},datumInput,' ',zeitInput,' ',el('button',{class:'btn still u-btn-klein',onclick:pruef},'prüfen'))),
      ergebnis,
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn still',onclick:()=>{ schritt=2; renderS2(); }},'← Wochenplan'),
        el('button',{class:'btn',onclick:speichereUndZu},'Fertig & speichern')));
    dlgBreit();
  }
  function istAWocheLabel(datumIso){ return istAWoche(datumIso,zm.abWochenAnker)+'-Woche'; }

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
  // Zwei FESTE Spalten (Zero-Feldtest 2026-07-10: automatischer Spaltenfluss kippte am iPad zu 4:1):
  // links die Aktionen (Sicherheit · Sichern · Sync), rechts die Info/Optik (Werkstatt · Darstellung).
  wrap.innerHTML=
    '<div class="mehr-spalte">'+
    '<div class="panel"><h2>Sicherheit</h2>'+
    '<div class="zeile"><span>Automatisch sperren nach</span><span><select id="sec-lockmin">'+[5,10,15,30].map(m=>'<option value="'+m+'"'+(lockMinuten()===m?' selected':'')+'>'+m+' min</option>').join('')+'</select></span></div>'+
    '<div class="zeile"><span>Beim Verlassen sofort sperren</span><span><input type="checkbox" id="sec-sofort"'+(localStorage.getItem('kladde_lock_sofort')==='1'?' checked':'')+' class="u-check"></span></div>'+
    '<div class="zeile"><span>Während des Unterrichts nicht sperren</span><span><input type="checkbox" id="sec-unterricht"'+(localStorage.getItem('kladde_lock_unterricht')!=='0'?' checked':'')+' class="u-check"></span></div>'+
    '<div class="zeile"><span>Fingerabdruck / Face ID</span><span id="sec-bio">…</span></div>'+
    '<div class="btn-reihe"><button class="btn still" id="sec-pass">Passphrase ändern…</button></div></div>'+
    '<div class="panel"><h2>Sichern & Übertragen</h2>'+
    '<p class="u-hinweis">Container ist AES-GCM-verschlüsselt (Passphrase nötig zum Öffnen). iPad: „In Dateien sichern" → SMB-Ordner des PCs.</p>'+
    '<div class="btn-reihe"><button class="btn" id="btn-export">Container exportieren</button>'+
    '<button class="btn still" id="btn-import">Container importieren/mergen</button></div>'+
    '<input type="file" id="file-cont" accept=".enc,application/octet-stream" class="hidden"></div>'+
    (PAGES_KONTEXT?'':'<div class="panel"><h2>Heimnetz-Sync (PC-Server)</h2><div class="btn-reihe">'+
      '<button class="btn" id="btn-push">Push</button><button class="btn" id="btn-pull">Pull + Merge</button>'+
      '<span id="sync-status" class="u-hinweis u-selfcenter"></span></div></div>')+
    '</div>'+
    '<div class="mehr-spalte" id="mehr-spalte-b">'+
    '<div class="panel"><h2>Werkstatt</h2>'+
    '<div class="zeile"><span>Version</span><span class="wert">v'+APP_VERSION+' · '+GERAET+(PAGES_KONTEXT?' · Pages':' · Heimnetz')+'</span></div>'+
    '<div class="zeile"><span>Modus</span><span class="wert" id="dg-mode">…</span></div>'+
    '<div class="zeile"><span>persist()</span><span class="wert" id="dg-persist">…</span></div>'+
    '<div class="zeile"><span>Speicher</span><span class="wert" id="dg-quota">…</span></div>'+
    '<div class="zeile"><span>Ereignisse im Log</span><span class="wert">'+vault.events.length+'</span></div>'+
    '<div class="zeile"><span>Letzte Sicherung</span><span class="wert" id="dg-save">Write-through aktiv</span></div>'+
    '<div class="zeile"><span>Regel</span><span class="wert u-maxw55">'+esc(regelText(bewertProfil(kurs())))+'</span></div></div>'+
    '</div>';
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
  // Fingerabdruck-Zeile: Zustand aus IndexedDB, Knopf je nach Lage (einrichten/entfernen/nicht möglich)
  idbGet('bio').then(bio=>{
    const z=$('sec-bio'); if(!z) return;
    if(!bioVerfuegbar()){ z.replaceChildren(el('span',{class:'u-hinweis'},'hier nicht verfügbar')); return; }
    z.replaceChildren(bio
      ?el('button',{class:'btn still u-btn-klein',onclick:bioEntfernen},'eingerichtet · entfernen')
      :el('button',{class:'btn u-btn-klein',onclick:bioEinrichten},'einrichten…'));
  });
  if(!PAGES_KONTEXT){
    $('btn-push').onclick=syncPush;
    $('btn-pull').onclick=syncPull;
    fetch('/api/kladde/status',{cache:'no-store'}).then(r=>r.json()).then(s=>{ $('sync-status').textContent='Server ok · Zert bis '+s.zert_bis; }).catch(()=>{ $('sync-status').textContent='Server nicht erreichbar'; });
  }
  // Darstellung: Tag/Nacht/System (Zero-Entscheid E1: Default Nacht) — 3-Weg, ergänzt den Header-Schnell-Toggle. el()-Neubau (CSP).
  const themeBtn=(p,txt)=>el('button',{class:'btn'+(themePref()===p?'':' still'),onclick:()=>{ localStorage.setItem(THEME_KEY,p); themeAnwenden(); renderMehr(); }},txt);
  $('mehr-spalte-b').append(el('div',{class:'panel'},
    el('h2',{},'Darstellung'),
    el('div',{class:'zeile'},el('span',{},'Erscheinungsbild'),
      el('span',{class:'seg'}, themeBtn('tag','Tag'), themeBtn('nacht','Nacht'), themeBtn('system','System'))),
    el('p',{class:'u-hinweis'},'System folgt dem Gerät. Der Mond/Sonne-Knopf oben schaltet schnell zwischen Tag und Nacht.')));
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
  const pin=pinRam||await passphraseAbfragen('Passphrase für den Import'); if(!pin) return;
  let fremd;
  try {
    fremd=(await decodeContainerAuto(new Uint8Array(await f.arrayBuffer()),pin)).daten; pinRam=pin;
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
      ?'<p class="u-warn13">'+iconHtml('warnung')+' '+esc(dry.konflikte[0])+'</p>'
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
    const pin=pinRam||await passphraseAbfragen('Passphrase für den Pull'); if(!pin) return;
    const fremd=(await decodeContainerAuto(new Uint8Array(await r.arrayBuffer()),pin)).daten; pinRam=pin;
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
  // Fingerabdruck-Einstieg (Zero 2026-09-02): ein Knopf, der erst nach einer Einrichtung erscheint, braucht einen
  // sichtbaren Weg dorthin. Einmalig nach einem Passphrase-Login, wenn das Gerät WebAuthn kann und noch keine Hülle liegt;
  // × merkt sich die Ablehnung dauerhaft (localStorage), „Einrichten" führt direkt in bioEinrichten.
  if(pinRam&&bioVerfuegbar()&&!localStorage.getItem('kladde_bio_hinweis')&&!(await idbGet('bio'))){
    zeigeBanner('<span>Schneller öffnen: Fingerabdruck / Face ID einrichten — die Passphrase bleibt als Rückweg.</span><button class="btn" data-bio>Einrichten</button>',
      b=>{ b.querySelector('[data-bio]').onclick=()=>{ b.classList.add('hidden'); bioEinrichten(); };
           b.querySelector('[data-zu]').addEventListener('click',()=>localStorage.setItem('kladde_bio_hinweis','1')); });
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
  // updateViaCache:'none' — sw.js-Checks gehen IMMER übers Netz, nie durch Safaris HTTP-Cache
  // (sonst re-registriert sich nach einem Reset der ALTE sw.js aus dem 10-min-Cache: Henne-Ei am iPad)
  navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'}).then(reg=>{
    const updateBanner=()=>zeigeBanner('<span>Neue Version geladen.</span><button class="btn" data-reload>Neu laden</button>',
      b=>{ b.querySelector('[data-reload]').onclick=()=>location.reload(); });
    // Update-Banner (P1.7, vorgezogen aus P4): kein stilles Doppel-Reload-Rätsel mehr
    reg.addEventListener('updatefound',()=>{
      const nw=reg.installing;
      if(nw) nw.addEventListener('statechange',()=>{
        if(nw.state==='installed'&&navigator.serviceWorker.controller) updateBanner();
      });
    });
    if(reg.waiting&&navigator.serviceWorker.controller) updateBanner();  // Update kam früher an, Banner wurde verpasst
    // iPad-Safari prüft den SW nur nach eigener träger Heuristik → beim Start und bei jedem
    // Sichtbarwerden AKTIV nachschauen (Zero 2026-07-10: iPad blieb auf altem Precache hängen)
    reg.update().catch(()=>{});
    document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') reg.update().catch(()=>{}); });
  }).catch(()=>{});
});
if(navigator.storage?.persist) navigator.storage.persist();
idbGet('starts').then(n=>idbPut('starts',(n||0)+1));
document.body.classList.toggle('beamer',beamerModus);
document.body.classList.toggle('nurplan',beamerModus&&localStorage.getItem('kladde_beamer_nurplan')==='1');
$('btn-beamer').classList.toggle('aktiv',beamerModus);
$('beamer-hinweis').classList.toggle('hidden',!beamerModus);
$('btn-beamer').replaceChildren(iconEl('auge')); $('btn-lock').replaceChildren(iconEl('schloss')); $('pin-auge').replaceChildren(iconEl('auge'));
$('beamer-hinweis').querySelector('span').prepend(iconEl('auge'),' ');   // Emoji→Linien-Icons: index.html trägt keine Symbole mehr, JS setzt sie (eine Quelle)
lockInit();
