// Kladde · js/app.mjs — Bootstrap + UI (P1.1-A1: mechanischer Umzug aus index.html v0.7, verhaltensneutral)
// Logik lebt in ../logic/*.mjs — App und Tests importieren DIESELBEN Dateien (Drift unmöglich).
import { DRITTELNOTEN, wertZuLabel, drittelnoteLabel, noteAlsWert } from '../logic/skalen.mjs?v=1.23.0';
import { verdichte, wirksameEvents, ersetzungFuer, istTerminEintrag, regelText, vorschlagsZeilen, quartalsVerlauf, kursEinordnung, notenAbstand } from '../logic/verdichtung.mjs?v=1.23.0';
import { mergeContainerDaten, hebeLoeschungAuf } from '../logic/merge.mjs?v=1.23.0';
import { decodeContainerAuto, encodeContainerV2, wechslePassphrase, neueV2Identitaet, dekRohMitPassphrase, decodeContainerMitDek, importDekKey, leseHeader } from '../logic/container.mjs?v=1.23.0';
import { bioWrap, bioUnwrap } from '../logic/biometrie.mjs?v=1.23.0';
import { parseSchuelerListe, MAX_SCHUELER } from '../logic/parser.mjs?v=1.23.0';
import { migriereStamm, schemaBekannt, standardZeitraeume } from '../logic/migration.mjs?v=1.23.0';
import { resolveBloecke, formatZeit, blockLabel, istAWoche, istFerien } from '../logic/zeitmodell.mjs?v=1.23.0';
import { kursZurZeit, slotFuerBlock, geplanteBlockNrn, bereinigeAusnahmen, tagesAusfall, entfallZurueck, ausnahmeEntfernen, setzeSlot, SLOT_ARTEN } from '../logic/autowahl.mjs?v=1.23.0';
import { sortiereKurse } from '../logic/kursSort.mjs?v=1.23.0';
import { lnr, nachListe, neueAusweisNr, nrnAuseinander, planeAbgleich, wendePlanAn } from '../logic/teilnehmer.mjs?v=1.23.0';
import { schuelerBericht } from '../logic/bericht.mjs?v=1.23.0';
import { RASTER_VORLAGEN, KURZRASTER_45 } from '../logic/rasterVorlagen.mjs?v=1.23.0';
import { kursStatus } from '../logic/kursStatus.mjs?v=1.23.0';
import { zufallsGewicht, gewichteteWahl } from '../logic/auswahl.mjs?v=1.23.0';
import { HILFE, findeZiel } from '../logic/hilfe.mjs?v=1.23.0';
import { lieseMappe, pruefeKursDatei, xlsxLesbar, neuerKurs, ergaenzeNeuenKurs } from '../logic/mappe.mjs?v=1.23.0';
import { fachFarbe, fachKuerzel, FACH_LISTE, WAEHLER_HUES } from '../logic/fachfarben.mjs?v=1.23.0';
import { listenEintraege } from '../logic/erfassListe.mjs?v=1.23.0';
import { tagesStunden, stundenAm, stundeDesKurses, kursTag, naechsteStunde, kalenderwoche, tagPlus, wochentagVon, stundeFuerBuchung } from '../logic/stunden.mjs?v=1.23.0';
import { setzeAufPlatz, raeumePlatz, vorlauf, vomPlatz, tischStempel, reiheEinfuegen as spReiheEinfuegen, belegteReihen as spBelegteReihen, kompaktiere as spKompaktiere, druckAnordnung } from '../logic/sitzplan.mjs?v=1.23.0';
import { pdfAusJpeg, jpegAusDataUrl } from '../logic/pdfbild.mjs?v=1.23.0';
const APP_VERSION = '1.23.0';
// Android = „handy“ (v1.11.0): Handy und iPad laufen parallel, Import-Vorschau und Konfliktmeldungen müssen sie unterscheiden.
// iPadOS gibt sich als Mac aus („Macintosh“) — erkennbar an den Touch-Punkten; ein Mac hat keine (Zero 2026-09-30: iPad zeigte „pc“)
const GERAET = /iPad|iPhone/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) ? 'ipad'
  : /Android/.test(navigator.userAgent) ? 'handy' : 'pc';
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
let db=null, vault=null;                   // vault = entschlüsselter Zustand im RAM
let dekKey=null, containerKopf=null;        // KLD1 v2: DEK (non-extractable CryptoKey) + wiederverwendbarer Wrap-Kopf
// Die Passphrase bleibt NICHT im RAM (Prüfer 2026-09-29: sie lag die ganze Sitzung im Klartext) — Import/Pull/Einrichtung
// fragen sie einmal ab. Für die Start-Hinweise reicht, WIE entsperrt wurde und ob die Passphrase schwach war.
let anmeldung=null, passSchwach=false;     // 'pass' | 'bio'
// Sperr-Zähler: eine Aktion, die über ein await hinweg läuft (Passphrase-Wechsel, Import, Pull), prüft danach, ob inzwischen
// gesperrt wurde — sonst schrieb sie Schlüssel und Tresor in einen gesperrten Zustand zurück (Prüfer 2026-09-29)
let sperrGen=0;
const nochOffen=gen=>gen===sperrGen&&vault!==null;
let migrationsHinweis=false;                // einmaliger Banner nach v1→v2-Migration
function mitDb(){ return new Promise((res,rej)=>{ if(db) return res(db);
  const req=indexedDB.open(DB_NAME,1);
  req.onupgradeneeded=()=>req.result.createObjectStore('meta');
  req.onsuccess=()=>{db=req.result;res(db);}; req.onerror=()=>rej(req.error); }); }
function idbGet(k){ return mitDb().then(d=>new Promise((res,rej)=>{ const r=d.transaction('meta').objectStore('meta').get(k); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); })); }
function idbPut(k,v){ return mitDb().then(d=>new Promise((res,rej)=>{ const tx=d.transaction('meta','readwrite'); tx.objectStore('meta').put(v,k); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); })); }
function idbDel(k){ return mitDb().then(d=>new Promise((res,rej)=>{ const tx=d.transaction('meta','readwrite'); tx.objectStore('meta').delete(k); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); })); }

let speicherKette=Promise.resolve(); // Write-through seriell (keine Races)
// Letzter Speicherfehler (null = alles gespeichert). Solange gesetzt: nicht sperren (der RAM-Stand wäre weg) und nicht
// exportieren (die Datei hätte einen alten Stand) — vorher überdeckten Sperren/Import die Warnung (Prüfer 2026-09-29)
let speicherFehler=null;
function speichern(){
  if(!vault||!dekKey||!containerKopf) return speicherKette;
  // Offener Sitzplan-Editor: gespeichert wird der Plan des Kurses, wie „Fertig“ ihn hinterließe — vorlauf verschiebt nur im Speicher
  // (Prüfer 03.10. B1: Hintergrund + Neuladen ließ den Plan dauerhaft verschoben, beim Abgleich folgte ein falscher Stammdaten-Konflikt)
  const sp0=editorAktiv?vault.stamm.sitzplaene[aktiverKursId]:null;
  const snapshot=JSON.stringify(sp0?{...vault,stamm:{...vault.stamm,sitzplaene:{...vault.stamm.sitzplaene,[aktiverKursId]:spKompaktiere(sp0)}}}:vault);
  const key=dekKey, kopf=containerKopf;   // beim Aufruf festhalten — sperren() nullt die Variablen, bevor die Kette läuft
  // v2-Save: reines AES-GCM mit dem DEK — KEIN KDF (gemessen 0,79 ms/Save statt ~1 KDF/Tap)
  speicherKette=speicherKette
    .then(()=>encodeContainerV2(JSON.parse(snapshot),key,kopf))
    .then(blob=>idbPut('vault',blob))
    .then(()=>{ speicherFehler=null; })
    .catch(err=>{ speicherFehler=err; console.error('[kladde] speichern',err); toast('⚠ Speichern fehlgeschlagen: '+err.message+' — nicht sperren, erst Speicher freimachen',10000); });
  return speicherKette;
}
function leererVault(){
  return {schema:'kladde/v2',
    stamm:{rev:1,ts:new Date().toISOString(),geraet:GERAET,kurse:[],schueler:{},sitzplaene:{},kursprofile:{},stundenplanSlots:[],zeitmodelle:[],wochenplan:[],ausnahmeSlots:[],einstellungen:{slot:'m1'}},
    events:[]};
}
function stammMutiert(){ vault.stamm.rev++; vault.stamm.ts=new Date().toISOString(); vault.stamm.geraet=GERAET; hebeLoeschungAuf(vault.stamm,vault.stamm.ts); }   // Kurs mit gelöschter id neu angelegt → Markierung aufheben (logic/merge)

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
  finger:[['p','M7.5 4.8A8 8 0 0 1 20 11.5v1'],['p','M4 9.5a8 8 0 0 1 1.6-3'],['p','M4 13v-1a8 8 0 0 1 .3-2'],['p','M8 19.5a12 12 0 0 1-1-5.5V12a5 5 0 0 1 10 0v2'],
    ['p','M12 12v2.5a14 14 0 0 0 1.5 6.5'],['p','M16.8 17a17 17 0 0 0 .2-2'],['p','M10.2 21a14 14 0 0 1-1.2-6.5V12a3 3 0 0 1 3-3']],
  geraete:[['r',3,4,12,16,2],['r',15,9,6,11,1.5]],
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
  info:[['c',12,12,9],['p','M12 11.2v4.8'],['cf',12,7.8,0.9]],
  sitzplan:[['r',3,5,5,5,1],['r',10,5,5,5,1],['r',17,5,4,5,1],['r',3,13,5,5,1],['r',10,13,5,5,1]],
  plan:[['r',3.5,4.5,17,15,2],['p','M3.5 9.5h17M9.2 9.5v10M14.9 9.5v10']],
  mehrPunkte:[['cf',5.5,12,1.6],['cf',12,12,1.6],['cf',18.5,12,1.6]],
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
// Login (Scheibe 10, Zero 05.10.): erster Start mit drei Zeilen (Wahl „B“), Wiederkehr mit Fingerabdruck zuerst (Wahl „A · Ein Knopf“).
// auto=true nur beim Öffnen der App: dann startet die Fingerabdruck-Abfrage von selbst, nach „Sperren“ und der Zeitsperre nicht.
let bioAuto=null;   // {bio, erledigt} solange der Login mit Hülle steht — je Anzeige höchstens eine Abfrage von selbst
let bioLauf=null;   // AbortController der laufenden Abfrage: nie zwei zugleich (Prüfer S10 🔴 1)
// Meldungszeile des Logins: Hinweise („prüfe…“, Abbruch) leise, Fehler rot — ein Abbruch ist kein Fehler (Prüfer S10 🟡 5)
function lockMeldung(text,leise=false){ const m=$('lock-fehler'); m.textContent=text; m.classList.toggle('leise',leise); }
// Auge: schaltet beide Felder; beim Sperren immer zurück auf verdeckt (Prüfer S10 🟡 6 — sonst stand die nächste Passphrase im Klartext)
function augeSetzen(zeigt){
  $('pin').type=$('pin2').type=zeigt?'text':'password';
  ['pin-auge','pin2-auge'].forEach(id=>{ const a=$(id); a.replaceChildren(iconEl(zeigt?'augeZu':'auge'));
    a.setAttribute('aria-pressed',String(zeigt)); a.setAttribute('aria-label',zeigt?'Passphrase verbergen':'Passphrase anzeigen'); a.title=zeigt?'Verbergen':'Anzeigen'; });
}
async function lockInit({auto=false}={}){
  document.querySelector('.shell').inert=true;   // hinter dem Login nichts bedienbar, auch nicht per Bildschirmleser (Prüfer S10 🟢 8)
  const blob=await idbGet('vault');
  const neu=!blob;
  $('lock-text').textContent=neu?'Neue Kladde anlegen':'';
  $('lock-erklaer').classList.toggle('hidden',!neu);
  $('pin2-feld').classList.toggle('hidden',!neu);
  $('pin').placeholder=neu?'12 Zeichen oder ein Satz':'Passphrase';
  $('lock-btn').textContent=neu?'Kladde anlegen':'Öffnen';
  $('pin').value=''; $('pin2').value=''; lockMeldung('');
  augeSetzen(false);
  $('pin-staerke').textContent='';
  $('lock').classList.remove('hidden');
  // Fingerabdruck (Zero 2026-09-02): nur wenn eine Bio-Hülle liegt UND der Browser WebAuthn kann. Dann nur sein Knopf und
  // „Passphrase eingeben“; das Feld erscheint erst auf Wunsch (Zero 05.10. „A · Ein Knopf“)
  const bio=neu?null:await idbGet('bio');
  const mitBio=!!(bio&&bioVerfuegbar());
  const bioBtn=$('lock-bio');
  bioBtn.classList.toggle('hidden',!mitBio); bioBtn.classList.remove('zweit'); bioBtn.disabled=false;
  bioBtn.onclick=()=>bioEntsperren(bio);
  $('lock-pass').classList.toggle('hidden',!mitBio);
  $('lock-felder').classList.toggle('hidden',mitBio);
  // „Passphrase eingeben“ gilt für diese Anzeige: keine Abfrage mehr von selbst über dem Feld (Prüfer S10 🟡 4)
  $('lock-pass').onclick=()=>{ bioAuto=null; $('lock-pass').classList.add('hidden'); bioBtn.classList.add('zweit'); $('lock-felder').classList.remove('hidden'); lockMeldung(''); $('pin').focus(); };
  bioAuto=mitBio?{bio,erledigt:false}:null;
  if(auto) bioAutostart();
  setTimeout(()=>{ if(!mitBio) $('pin').focus(); },50);   // mit Bio-Hülle keine Tastatur hochschieben
  $('pin').oninput=()=>{ // Live-Stärke nur bei Neuanlage sinnvoll
    if(!neu){ $('pin-staerke').textContent=''; return; }
    const s=passStaerke($('pin').value);
    $('pin-staerke').textContent=s?('Stärke: '+s):'';
    $('pin-staerke').className='pass-staerke '+(s||'');
  };
  $('pin-auge').onclick=$('pin2-auge').onclick=()=>augeSetzen($('pin').type!=='text');
  $('lock-btn').onclick=async()=>{
    const pin=$('pin').value;
    if(neu){
      if(pin.length<10){ lockMeldung('Mindestens 10 Zeichen — besser 12+ oder ein kurzer Satz.'); return; }
      if(pin!==$('pin2').value){ lockMeldung('Passphrasen stimmen nicht überein.'); return; }
      const id=await neueV2Identitaet(pin);
      dekKey=id.dek; containerKopf=id.kopf;
      anmeldung='pass'; passSchwach=passStaerke(pin)==='schwach'; vault=leererVault();
      await speichern(); entsperrt();
    } else {
      $('lock-btn').disabled=true; lockMeldung('prüfe… (PBKDF2)',true);
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
          vault=r.daten; anmeldung='pass'; passSchwach=passStaerke(pin)==='schwach';
          migriereStamm(vault); // Schema kladde/v2 (P2.1) — idempotent
          bereinigeAusnahmen(vault.stamm); // folgenlose Entfälle auf freien Stunden räumen (2026-09-02)
          await speichern(); // erste v2-Schreibung — erst NACH verifiziertem Backup
          migrationsHinweis=true;
          console.log('[kladde] v1→v2 migriert (Backup verifiziert) in',Math.round(performance.now()-t0),'ms');
        } else {
          dekKey=r.dek; containerKopf=r.kopf;
          vault=r.daten; anmeldung='pass'; passSchwach=passStaerke(pin)==='schwach';
          const migriert=migriereStamm(vault); // Schema-Nachzug (v0.8-Bestand → kladde/v2)
          if(bereinigeAusnahmen(vault.stamm)||migriert) speichern(); // + folgenlose Entfälle auf freien Stunden räumen (2026-09-02)
          console.log('[kladde] Unlock (v2) in',Math.round(performance.now()-t0),'ms');
        }
        entsperrt();
      } catch(e){
        lockMeldung(e.message);
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
   Die Passphrase liegt nie im RAM — Import/Pull/Einrichtung fragen sie einmalig ab (passphraseAbfragen). */
const BIO_RP=()=>({name:'Kladde',id:location.hostname});
function bioVerfuegbar(){ return !!(window.PublicKeyCredential&&navigator.credentials&&navigator.credentials.get&&window.isSecureContext); }
// PRF-Geheimwert für eine bestehende Hülle holen (Touch/Face ID) — Nutzergeste nötig
async function bioSecret(bio,signal){
  const cred=await navigator.credentials.get({publicKey:{
    challenge:crypto.getRandomValues(new Uint8Array(32)), rpId:BIO_RP().id, userVerification:'required', timeout:60000,
    allowCredentials:[{type:'public-key',id:bio.credId}],
    extensions:{prf:{eval:{first:bio.prfSalt}}}},signal});
  const prf=cred.getClientExtensionResults().prf;
  if(!prf||!prf.results||!prf.results.first) throw new Error('Dieses Gerät liefert keinen PRF-Wert — Fingerabdruck-Hülle hier nicht nutzbar');
  return new Uint8Array(prf.results.first);
}
// Von selbst nur beim Öffnen der App und bei der Rückkehr in die App, wenn der Login mit Hülle sichtbar steht — einmal je Anzeige
function bioAutostart(){
  if(!bioAuto||bioAuto.erledigt||bioLauf||vault||document.visibilityState!=='visible'||$('lock').classList.contains('hidden')) return;
  bioAuto.erledigt=true; bioEntsperren(bioAuto.bio,{auto:true});
}
// Der Knopf wird nie gesperrt: ein Tipp bricht eine laufende Abfrage ab (auch eine hängende, WebKit 273712) und fragt neu (Prüfer S10 🟡 3)
async function bioEntsperren(bio,{auto=false}={}){
  if(bioLauf) bioLauf.abort();   // von selbst nie hier (bioAutostart prüft bioLauf), also ein Tipp
  const lauf=new AbortController(); bioLauf=lauf;
  lockMeldung('');
  const t0=performance.now();
  try{
    const secret=await bioSecret(bio,lauf.signal);
    const dekRoh=await bioUnwrap(bio,secret); secret.fill(0);
    const key=await importDekKey(dekRoh); dekRoh.fill(0);
    const roh=await idbGet('vault');
    const r=await decodeContainerMitDek(roh,key);
    if(lauf.signal.aborted) return;   // abgelöst (neuer Tipp, Passphrase), der Browser kam trotzdem zurück — nichts übernehmen
    dekKey=r.dek; containerKopf=r.kopf; vault=r.daten; anmeldung='bio'; passSchwach=false;
    const migriert=migriereStamm(vault);
    if(bereinigeAusnahmen(vault.stamm)||migriert) speichern();
    console.log('[kladde] Unlock (Fingerabdruck) in',Math.round(performance.now()-t0),'ms');
    entsperrt();
  }catch(e){
    if(lauf.signal.aborted) return;   // abgelöst: still, die neue Abfrage spricht für sich
    // AbortError/NotAllowedError = Nutzer hat abgebrochen — kein Alarm, Passphrase bleibt der Weg. Beim Start von selbst still:
    // auch ein Browser, der die Abfrage ohne Tipp nicht erlaubt, meldet NotAllowedError, dann bleibt einfach der Knopf
    const abbruch=e.name==='NotAllowedError'||e.name==='AbortError';
    if(!(auto&&abbruch)) lockMeldung(abbruch?'Abgebrochen — erneut tippen oder Passphrase eingeben.':e.message,abbruch);
  }finally{ if(bioLauf===lauf) bioLauf=null; }
}
// Einrichtung aus Mehr → Sicherheit. Braucht die Passphrase (DEK-Rohbytes) UND eine Nutzergeste.
async function bioEinrichten(){
  if(!bioVerfuegbar()){ toast('Dieser Browser kann kein WebAuthn — Fingerabdruck hier nicht möglich',4500); return; }
  const pin=await passphraseAbfragen('Zum Einrichten einmal die Passphrase');
  if(!pin) return;
  try{
    const roh=await idbGet('vault');
    const dekRoh=await dekRohMitPassphrase(roh,pin);
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
function passphraseAbfragen(titel,hinweis){
  return new Promise(resRoh=>{
    const res=aufloesenBeiClose(resRoh,null);
    const inp=el('input',{type:'password',autocomplete:'off',class:'u-w170'});
    dlgZeigenEl(el('h3',{},titel||'Passphrase'),
      el('p',{class:'u-hinweis'},hinweis||'Die Kladde behält deine Passphrase nicht im Speicher — für diesen Schritt wird sie einmal gebraucht.'),
      el('div',{class:'zeile'},el('span',{},'Passphrase'),el('span',{},inp)),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn',onclick:()=>{ const v=inp.value; dlgZu(); res(v||null); }},'Weiter'),
        el('button',{class:'btn still',onclick:()=>{ dlgZu(); res(null); }},'Abbrechen')));
    inp.onkeydown=e=>{ if(e.key==='Enter'){ const v=inp.value; dlgZu(); res(v||null); } };
    setTimeout(()=>inp.focus(),60);
  });
}
// Promise-Dialoge: X/Escape schließen #dlg ohne Knopf — dann mit `beiClose` auflösen, sonst hängt der Aufrufer
// (Stapel-Import wartete ewig · Prüfer 2026-09-29). `close` feuert erst als späterer Task: öffnet der Aufrufer sofort
// den nächsten Dialog, darf das verspätete Ereignis dessen Promise nicht treffen — darum nur bei !open, und der
// Listener geht mit dem ersten Auflösen weg. Nach dlgZeigen* aufrufen; liefert das zu benutzende res.
function aufloesenBeiClose(res,beiClose){
  const d=$('dlg'); let fertig=false;
  const fin=v=>{ if(fertig) return; fertig=true; d.removeEventListener('close',hoer); res(v); };
  const hoer=()=>{ if(!d.open) fin(beiClose); };
  setTimeout(()=>{ if(!fertig) d.addEventListener('close',hoer); },0);   // erst NACH dem Öffnen scharf (ein noch anstehendes close des Vorgängers verpufft)
  return fin;
}
function sperren({auto=false}={}){
  // Hard-Lock: RAM-Wipe + UI-Hygiene (§5) — nach dem Sperren darf kein Name mehr im DOM stehen
  // Sitzplan-Editor ZUERST räumen, solange der Tresor noch da ist: danach warf kompaktiere() auf vault=null, der Fehler
  // wurde geschluckt und die Namen-Schiene blieb hinter dem Lock im DOM (Prüfer 2026-09-29). Netz: Leiste immer entfernen.
  if(editorCleanup){ try{ editorCleanup(); }catch(err){ console.error('[kladde] Editor beim Sperren',err); } }
  $('sp-editor-bar')?.remove(); document.querySelector('.sp-ohne')?.remove(); editorAktiv=false; editorCleanup=null; document.body.classList.remove('sp-edit','sp-dragging');
  sperrGen++; vault=null; dekKey=null; containerKopf=null; anmeldung=null; passSchwach=false;
  if(tabSperreFrei){ tabSperreFrei(); tabSperreFrei=null; }   // anderer Tab darf jetzt entsperren
  aktiverSchueler=null; offenerSchueler=null; offeneZeile=null; deckListe=[]; deckVerlauf=[]; undoStack.length=0;
  stempelAus(); // RAM-Wipe: kein scharfer Stempel/Modus-Rahmen hinter dem Lock
  try{ dlgZu(); }catch{}
  $('dlg').innerHTML='';
  $('dlg').classList.remove('verdeckt');   // gesetzt beim Verlassen: blieb nach dem Sperren stehen, jeder spätere Dialog war unsichtbar und sperrte die App (05.10.)
  // Views leeren — der Lock verdeckt nur visuell; Find-in-Page/Screenreader läsen die Namen sonst weiter
  $('plan').replaceChildren(); $('datum-streifen').replaceChildren(); $('rail').replaceChildren();
  $('erfasst-ort').replaceChildren(); $('kopf-stunde').replaceChildren();   // Rahmen 2026-10-01: Stunde (Kurs + Datum) und Erfasst wohnen außerhalb der Rail
  const op=$('ohne-platz'); if(op) op.remove();
  $('erfass-umschalter')?.remove(); $('listen-sort')?.remove(); $('plan').classList.remove('liste');   // Liste: hinter dem Lock keine bedienbaren Knöpfe
  $('deck-karte').replaceChildren(); $('deck-fortschritt').textContent='';
  $('deck-optionen').replaceChildren(); $('deck-verlauf').replaceChildren();   // nur leeren — versteckt blieb „Diese Runde“ bis zum Neuladen weg (Prüfer 2026-09-29)
  ['schueler','kurse','mehr'].forEach(v=>$('view-'+v).replaceChildren());
  $('kurs-name').textContent='Kein Kurs'; $('kurs-slot').textContent='';
  $('toast').classList.add('hidden'); $('toast').textContent='';
  $('undo-chip').classList.add('hidden'); $('undo-chip').textContent='';
  $('soft-lock').classList.add('hidden');
  lockInit({auto});
}
function lockMinuten(){ const m=Number(localStorage.getItem('kladde_lock_min')); return [5,10,15,30].includes(m)?m:15; }
// Zeitsperre fällig: Ruhezeit um und keine eigene Stunde, die sie pausiert (Soft-Lock deckt dann das Verlassen)
function zeitAbgelaufen(){
  if(Date.now()-zuletztAktiv<=lockMinuten()*60*1000) return false;
  return !(unterrichtAktiv()&&localStorage.getItem('kladde_lock_unterricht')!=='0');
}
// P2.6 · Unterrichtsbewusster Hard-Lock: während eines laufenden Blocks (+10 min Nachlauf)
// nicht aussperren — sonst erzwingt die 67,5-min-Stunde die Passphrase vor der Klasse.
function unterrichtAktiv(){
  const zm=(vault?.stamm.zeitmodelle||[])[0]; if(!zm) return false;
  const j=new Date(); const wtag=((j.getDay()+6)%7)+1; if(wtag>5) return false;
  if(istFerien(zm,heuteIso())) return false;   // Ferien: kein Unterricht, normaler Auto-Lock
  const sek=j.getHours()*3600+j.getMinutes()*60+j.getSeconds();
  const h=heuteIso(), imFenster=b=>b.startSek<=sek&&sek<=b.endeSek+600;   // Kurztag: Auto-Lock-Pause endet mit dem 45er-Tag (S256b)
  // Nur EIGENE Stunden (Wochenplan + Ausnahmen, Entfall zählt nicht) pausieren die Sperre — das Schulraster allein hielt die
  // Kladde von 07:45 bis 16:18 offen, auch in der Freistunde im Lehrerzimmer (Prüfer 2026-09-29, gemessen). Ohne Wochenplan
  // bleibt das alte Raster-Verhalten.
  const plan=wochenplanAktiv();
  if(!plan.length) return resolveBloecke(zm,wtag,h).some(imFenster);
  const kontext={zeitmodell:zm,wochenplan:plan,ausnahmen:vault.stamm.ausnahmeSlots||[]};
  return resolveBloecke(zm,wtag,h).some(b=>{ if(!imFenster(b)) return false; const s=slotFuerBlock(h,wtag,b.blockNr,kontext); return !!s&&!s.entfall; });
}
// Nur EIN Tab darf entsperrt sein: jeder schreibt beim Verlassen seinen ganzen Stand — zwei offene Tabs überschrieben
// sich still (Prüfer 2026-09-29). Web Lock beim Entsperren, frei beim Sperren/Schließen. Ohne navigator.locks: wie bisher.
let tabSperreFrei=null;
function tabSperreHolen(){
  if(!navigator.locks||tabSperreFrei) return Promise.resolve(true);
  return new Promise(ok=>{ navigator.locks.request('kladde-vault',{ifAvailable:true},lock=>{
    if(!lock){ ok(false); return; }
    ok(true); return new Promise(frei=>{ tabSperreFrei=frei; });
  }).catch(()=>ok(true)); });
}
async function entsperrt(){
  if(!(await tabSperreHolen())){
    sperren(); toast('Die Kladde ist in einem anderen Tab schon offen — dort weiterarbeiten oder den anderen Tab schließen.',9000); return;
  }
  $('lock').classList.add('hidden'); document.querySelector('.shell').inert=false;
  if(bioLauf){ bioLauf.abort(); bioLauf=null; }   // mit der Passphrase geöffnet: eine hängende Abfrage blockiert die nächste nicht
  zuletztAktiv=Date.now();
  clearInterval(lockTimer);
  lockTimer=setInterval(()=>{
    if(!zeitAbgelaufen()) return;
    speichern().then(sperrenWennGespeichert);   // erst sichern — ein gescheitertes Speichern darf der Auto-Lock nicht wegwischen
  },30*1000);
  setzeViewTitel(aktView);   // data-ansicht schon beim Start — der Rahmen v1.13.0 hängt daran (Kopf am iPad, Stunde am Handy; Prüfer 2026-10-01)
  terminAufHeute(); kursAutowahl(); renderAlles();
  starteAutowahlTick();
  zeigeStartHinweise();
}
['pointerdown','keydown'].forEach(evName=>document.addEventListener(evName,()=>{zuletztAktiv=Date.now();},{capture:true,passive:true}));
// Soft-Lock (P1.4): iOS erzeugt beim App-Umschalten einen SCREENSHOT — das Overlay muss
// SOFORT und OHNE Animation stehen, sonst landen Schülernamen im App-Switcher.
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'&&vault){
    $('soft-lock').classList.remove('hidden'); // synchron, animationsfrei
    $('dlg').classList.add('verdeckt');        // ein offener Dialog liegt im Top Layer ÜBER der Abdeckung → im App-Umschalter-Bild (Prüfer 2026-09-29)
    speichern();
    if(localStorage.getItem('kladde_lock_sofort')==='1') speicherKette.then(sperrenWennGespeichert);
  } else if(document.visibilityState==='visible'&&vault){
    // Zeitsperre lief ab, während die App weg war (iOS lässt die Timer ruhen): die Abdeckung bleibt, erst sichern, dann sperren — mit
    // einer Abfrage wie beim Öffnen. Vorher stand die App bis zu 30 s offen, und ein Tipp hob die Sperre ganz auf (Prüfer S10 🟡 2)
    if(zeitAbgelaufen()) speichern().then(()=>{ if(!vault) return; if(!speicherFehler) sperren({auto:true}); else { sperrenWennGespeichert(); zurueckInDieApp(); } });
    else zurueckInDieApp();
  }
  // Login mit Fingerabdruck-Hülle: beim Verlassen wieder scharf — nicht während einer Abfrage, deren Systemdialog die Seite kurz
  // verdeckt (sonst Schleife, Prüfer S10 🔴 1) —, bei der Rückkehr startet die Abfrage einmal von selbst (Scheibe 10)
  if(document.visibilityState==='hidden'){ if(bioAuto&&!bioLauf) bioAuto.erledigt=false; }
  else if(!vault) bioAutostart();
});
function zurueckInDieApp(){
  $('soft-lock').classList.add('hidden'); $('dlg').classList.remove('verdeckt');
  // Rückkehr in die App: Block könnte gewechselt haben (Handwahl hält bis Blockwechsel) — bei Wechsel JEDE Ansicht neu
  terminAufHeute();
  if(!editorAktiv&&kursAutowahl()){ renderAlles(); const k=kurs(); if(k) toast('→ '+k.name+' · '+k.fach); }   // Wechsel beendet den Nachtrag (kursAutowahl)
  else renderAlles();   // auch ohne Kurswechsel: ein neuer Tag muss überall ankommen
  hilfeNeu();   // offene Hilfe: die Ansicht ist neu gezeichnet, Ziele und Nummern neu (Prüfer S9 B5)
}
window.addEventListener('pagehide',()=>{ if(vault) speichern(); });
$('btn-lock').addEventListener('click',()=>{ speichern().then(sperrenWennGespeichert); });
function sperrenWennGespeichert(){
  if(speicherFehler){ toast('⚠ Nicht gesperrt: das letzte Speichern ist fehlgeschlagen ('+speicherFehler.message+'). Sonst gingen die Einträge seitdem verloren.',10000); return; }
  sperren();
}

/* ═══ ZUSTAND-HELPERS ═══ */
let aktiverKursId=null, terminDatum=heuteIso(), aktiverSchueler=null, undoStack=[];
// Nachtrag (bewusst gewählter Termin) ≠ veraltetes „heute": ohne diesen Merker gingen nach einer Nacht im Speicher
// alle Stempel auf gestern, und ein Nachtrag überlebte den automatischen Kurswechsel (Prüfer 2026-09-29)
let terminNachtrag=false;
// Die in „Stunde wählen“ gewählte Stunde: Kopf und — für ⏰ und ∅ — die Stunde der Buchung (buchungsStunde). Zwei Stunden desselben Kurses
// an einem Tag bleiben EIN Termin. Die Wahl hält bis zur nächsten Wahl, „Heute“/‹ › (setzeTermin) oder einem Kurswechsel (Zero 03.10.: „Wahl hält“);
// Blättern wählt keine Stunde — im Nachtrag gilt dann die Tagesregel wie in Prod (Prüfer 03.10., zweite Runde 🟡 2)
let anzeigeBlock=null;
function terminAufHeute(){ if(!terminNachtrag) terminDatum=heuteIso(); }
function heuteIso(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function kurs(){ return vault?.stamm.kurse.find(k=>k.id===aktiverKursId)||null; }
function kursSchueler(k){ return nachListe((vault.stamm.schueler[k.id]||[]).filter(s=>!s.inaktiv)); } // Deaktivierte (Tombstone) bleiben im Stamm, aber aus allen Listen/Plänen · nach Listen-Nr (zwei Nummern, WAHL U12)
// Bewertungs-Modus: bildet die 3 Fälle (Sek I=Drittel · Sek II=Punkte · Sek II=Drittel)
// auf die getestete 2-Wege-Logik ab — Sek-II-Drittel rechnet wie Sek I (Drittelnoten 1–6).
function bewertProfil(k){ return (k&&k.profil==='sek2'&&(k.notenmodus||'punkte')!=='drittel')?'sek2':'sek1'; }
function addEvent(typ,schuelerNr,extra={}){
  if(dlgKurs&&kursGewechselt({kursId:dlgKurs})) return null;   // offener Dialog eines anderen Kurses: dieselbe Nr ist hier ein anderes Kind (dlgOeffnen)
  const k=kurs();
  if(k&&k.status==='archiviert'){ toast('Archivierter Kurs — schreibgeschützt'); return null; } // P3.3
  const e={id:crypto.randomUUID(),typ,schuelerNr,kursId:aktiverKursId,datum:terminDatum,ts:new Date().toISOString(),geraet:GERAET,...extra};
  // ⏰ und ∅ tragen ihre Stunde (v1.17.1 Blockmodell): Doppelstunde (Zero 03.10.: „Dazuzählen, wenn es ein späterer Block ist“), und ⏰ nimmt
  // das ∅ derselben Stunde zurück (Zero: „⏰ nimmt ∅ zurück“) — beides regelt ersetzungFuer unten. Die Stunde kommt frisch aus der Uhr
  // (buchungsStunde), nicht aus der Autowahl: dort galt in der Pause schon der nächste Block (Prüfer 03.10. 🔴 1)
  if((typ==='versp'||typ==='fehlt_o')&&e.blockNr==null){ const st=buchungsStunde(e.datum); if(st) e.blockNr=st.blockNr; }
  // Direkt entschuldigt/unentschuldigt an einem Tag mit offenem ∅ = Klärung dieses ∅ — sonst blieb es offen stehen
  // (Klärungsliste, Kurs-Badge, Kurzbericht „1× ungeklärt“ UND „1× entschuldigt“; Prüfer 2026-09-29). Hat ⏰ das ∅ schon ersetzt („kommt
  // doch“), klärt e/u es mit — sonst stünde es nach einem ↶ der Verspätung neben dem e (Prüfer 03.10. 🟢 7)
  if((typ==='fehlt_e'||typ==='fehlt_u')&&!e.stornoVon){
    const w=wirksameEvents(vault.events), gleich=x=>x.typ==='fehlt_o'&&x.kursId===e.kursId&&x.schuelerNr===schuelerNr&&x.datum===e.datum;
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
function stornoEreignis(e){ return {id:crypto.randomUUID(),typ:'storno',schuelerNr:e.schuelerNr,kursId:e.kursId,datum:e.datum,ts:new Date().toISOString(),geraet:GERAET,stornoVon:e.id}; }
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
function eintragLabel(e){ return e.typ==='note'?(e.best?'bes. Leistung':'Note '+e.wert):e.typ==='versp'&&e.minuten?'zu spät '+e.minuten+' min':e.typ==='quartalsnote'&&e.hj&&e.quartal?'Q'+((e.hj-1)*2+e.quartal)+'-Note '+e.wert+(kursSek2(e.kursId)?' P':''):(TYP_LABEL[e.typ]||e.typ); }
// Was Chip und Meldung zeigen: am Beamer keine Bewertung im Klartext (Prüfer 03.10. 🟡 4; die Regel „Bewertungen … immer verborgen“)
function kursSek2(id){ return bewertProfil(vault&&vault.stamm.kurse.find(x=>x.id===id))==='sek2'; }   // Chip „Q1-Note 11 P“ wie die Meldung (Prüfer 03.10. 🟢 9)
function sichtLabel(e){ return beamerModus&&(BEWERTUNGS_TYPEN.has(e.typ)||e.typ==='quartalsnote')?'Bewertung':eintragLabel(e); }   // auch keine Quartalsnote (Prüfer 03.10. 🟢 10)
function zeigeUndo(e,ersetzt){
  const s=stammKind(e.schuelerNr);
  // Ersetzen sichtbar machen (Mechanik erklärt sich selbst): „o → ＋“ — ein Tap bringt das alte Zeichen zurück
  chipZeig('rueck',(s?anzeigeVorname(s):'Nr '+e.schuelerNr)+': '+(ersetzt?sichtLabel(ersetzt)+' → ':'')+sichtLabel(e),
    ()=>{ stornoVon(e); toast('Rückgängig: '+sichtLabel(e)+wiederDa(e)); renderAlles(); zeigeRedo(e); });   // alle Ansichten — Deck/Schüler blieben sonst veraltet
}
// Nach einer Rücknahme: was das zurückgenommene Event ersetzt oder geklärt hatte, gilt wieder („— wieder o“)
function wiederDa(e){
  const w=e.stornoVon?wirksameEvents(vault.events).find(x=>x.id===e.stornoVon):null;
  return w?' — wieder '+sichtLabel(w):'';
}
// Storniertes Original mit einem Tap wieder einbuchen — append-only bleibt gewahrt (kein Löschen,
// der Storno bleibt im Log; addEvent stempelt id/ts frisch, alle Sachfelder reisen mit).
function bucheErneut(e){
  const {id:_id,ts:_ts,geraet:_ge,stornoVon:_sv,typ,schuelerNr,...sach}=e;
  return addEvent(typ,schuelerNr,sach);
}
function zeigeRedo(e){
  const s=stammKind(e.schuelerNr);
  chipZeig('wieder',(s?s.vorname:'Nr '+e.schuelerNr)+': '+(TYP_LABEL[e.typ]||e.typ)+' wiederherstellen',
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
// Der Beamer-Knopf wohnt in der Heute-Leiste, die bei jedem Zeichnen neu entsteht — darum ein fester Verweis statt $('btn-beamer')
const BTN_BEAMER=el('button',{class:'ds-icon',id:'btn-beamer',type:'button',title:'Beamer-Modus: Bewertungen verstecken','aria-label':'Beamer-Modus',onclick:()=>setzeBeamer(!beamerModus)});
function setzeBeamer(an){
  beamerModus=an; localStorage.setItem('kladde_beamer',an?'1':'0');
  document.body.classList.toggle('beamer',an);
  document.body.classList.toggle('nurplan',an&&localStorage.getItem('kladde_beamer_nurplan')==='1');
  BTN_BEAMER.classList.toggle('aktiv',an); BTN_BEAMER.setAttribute('aria-pressed',String(an));
  $('beamer-hinweis').classList.toggle('hidden',!an);
  if(an){ $('undo-chip').classList.add('hidden'); $('toast').classList.add('hidden'); }   // Chip/Meldung von VOR dem Einschalten nennen die Bewertung im Klartext (Prüfer 03.10. 🟢 10)
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
  if(wechsel){ terminDatum=heuteIso(); terminNachtrag=false; anzeigeBlock=null; }
  if(aktiverKursId!==vk&&editorCleanup) editorCleanup();
  return wechsel; }
function kursAutowahlKern(){
  if(!vault) return;
  const jetzt=new Date();
  const zm=(vault.stamm.zeitmodelle||[])[0];
  autowahlInfo=null;
  let hand=handwahlLesen();
  if(hand&&!vault.stamm.kurse.some(k=>k.id===hand.kursId&&k.status!=='archiviert')){ handwahlSetzen(null); hand=null; }   // Kurs weg/archiviert → Handwahl gegenstandslos
  const handAnwenden=(bisSek)=>{ aktiverKursId=hand.kursId; aktiveTeilgruppe=hand.teilgruppe||null; $('kurs-slot').textContent=' · von Hand'+(bisSek!=null?' · bis '+formatZeit(bisSek):'')+(hand.teilgruppe?' · Gr. '+hand.teilgruppe:''); };
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
        if(t.kursId){ aktiverKursId=t.kursId; aktiveTeilgruppe=gueltigeGruppe(t.kursId,t.teilgruppe); }
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
let aktiveTeilgruppe=null;
function aktualisiereKursChip(){
  const k=kurs();
  $('kurs-name').textContent=k?k.name+' · '+k.fach:'Kein Kurs';
  if(!kurs()) $('kurs-slot').textContent='';
}
// Kurs-Chip (Kopf der anderen Ansichten) = „Stunde wählen“ — ersetzt den alten Dialog „Kurs wählen“ (Plan Scheibe 1b, Prüfer 2026-10-01)
$('kurs-chip').addEventListener('click',()=>{ if(vault) stundeWaehlen(terminDatum); });
// Plan-Gruppe nur, wenn der Kurs Schüler in ihr hat: sonst setzte sichtbareSchueler sie beim Zeichnen zurück, der nächste
// Autowahl-Lauf wertete das als Wechsel und beendete den Nachtrag — Stempel landeten auf heute (Prüfer-Nachprüfung N1, gemessen)
function gueltigeGruppe(kursId,g){ const k=g&&vault.stamm.kurse.find(x=>x.id===kursId); return k&&kursSchueler(k).some(s=>s.gruppe===g)?g:null; }
// Kurs direkt wechseln (Kurskarte, Kurs anlegen, Assistent, Import, Archiv öffnen): wie jeder Kurswechsel über die Autowahl —
// ein offener Sitzplan-Editor schließt vorher, ein Nachtrag endet, die Gruppe des alten Kurses fällt weg (Prüfer B1/B2/N2)
function kursWechseln(id){
  if(id!==aktiverKursId){ if(editorCleanup) editorCleanup(); setzeTermin(heuteIso()); aktiveTeilgruppe=null; }
  aktiverKursId=id; aktualisiereKursChip(); if(dlgKurs) dlgKurs=id;   // von Hand gewählt: ein offener Dialog gilt jetzt dem neuen Kurs
}
// Halbgruppe von Hand oder aus der Plan-Stunde: als Handwahl am laufenden Block, sonst setzte der 60-s-Takt sie zurück
function gruppeWaehlen(g){ aktiveTeilgruppe=g||null; handwahlSetzen({kursId:aktiverKursId,teilgruppe:aktiveTeilgruppe,datum:heuteIso(),blockNr:autowahlInfo?.blockNr??null}); }
// Nach einem Ausfall-Griff (Stundenplan, Scheibe 2): Autowahl neu — ein Ausfall der laufenden Stunde ändert den Kurs, ein Wechsel
// beendet den Nachtrag (kursAutowahl) — und die Ansicht dahinter IMMER auffrischen: sonst bliebe „Std. 3“ einer ausgefallenen Stunde
// oder in „Kurse“ die Plakette „läuft gerade“ stehen (Prüfer 2026-10-02). → Text „→ Kurs“ bei einem Wechsel, sonst ''.
function nachAusnahme(){
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
// Werkzeug unten links: Symbol + Beschriftung (die Leiste hat dort Platz, Zero 2026-10-01)
function werkzeug(b,icon,text){ b.replaceChildren(iconEl(icon),el('span',{class:'nav-label'},text)); }
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

/* ═══ THEME · Tag/Nacht/System · Default Nacht (Zero-Entscheid E1) ═══ */
const THEME_KEY='kladde_theme';
const themePref=()=>{ const t=localStorage.getItem(THEME_KEY); return (t==='tag'||t==='nacht'||t==='system')?t:'nacht'; };
const themeHell=()=>matchMedia('(prefers-color-scheme: light)').matches;
const themeEff=()=>{ const p=themePref(); return p==='system'?(themeHell()?'tag':'nacht'):p; };
function themeAnwenden(){
  const eff=themeEff();
  document.documentElement.dataset.theme=eff;
  const mc=document.querySelector('meta[name="theme-color"]'); if(mc) mc.content=eff==='tag'?'#F4F0E7':'#17150F';
  const b=$('btn-theme'); if(b){ werkzeug(b,eff==='tag'?'sonne':'mond',eff==='tag'?'Tag':'Nacht'); b.title='Ansicht: '+(themePref()==='system'?'System (folgt Gerät)':eff==='tag'?'Tag':'Nacht'); }
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
function dlgZu(){ $('dlg').close(); }
// el()-Variante: Dialog aus DOM-Knoten (CSP-sicher, kein innerHTML) — für neue Views (P2.4+)
function dlgZeigenEl(...knoten){
  const d=$('dlg'); d.classList.remove('breit'); dlgInhalt().replaceChildren(...knoten);
  dlgOeffnen(d);
}
// Breiter Dialog (Stundenplan): das Wochen-Grid nutzt die Breite, nicht nur die Höhe (Zero 2026-09-02).
// Nach dlgZeigen/dlgZeigenEl aufrufen — jeder neue Dialog startet wieder schmal.
function dlgBreit(){ $('dlg').classList.add('breit'); }

/* ═══ VIEWS / TABS (replaceState-only — Edge-Swipe-Doktrin) ═══ */
let aktView='heute';
const VIEW_TITEL={heute:['Heute','Sitzplan · live erfassen'],deck:['Deck','Klasse zügig durchgehen'],schueler:['Schüler','Verläufe, Notizen & Details'],kurse:['Kurse','Klassen verwalten'],mehr:['Mehr','Einstellungen & Sicherung']};
function setzeViewTitel(v){ const t=VIEW_TITEL[v]||['','']; $('view-titel').textContent=t[0]; $('view-sub').textContent=t[1];
  document.body.dataset.ansicht=v; }   // Handy-CSS: Toast/Undo auf der Stempel-Leiste nur in „Heute“ (data-Attribut statt :has — Safari 26)
document.getElementById('hauptnav').addEventListener('click',e=>{
  const b=e.target.closest('button[data-view]'); if(!b) return;
  if(b.dataset.view===aktView){ if(aktView==='kurse'&&kursSeiteId){ kursSeiteId=null; mitUebergang(renderKurse); } return; }   // „Kurse“ auf der Kurs-Seite: zurück zum Raster
  if(editorCleanup) editorCleanup();   // ein offener Sitzplan-Editor endet wie mit „Fertig“ (Prüfer 03.10. B1: sonst lief er in „Deck“/„Mehr“ weiter)
  kursSeiteId=null;
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
    aktiveTeilgruppe=null;    // Gruppe im Kurs nicht vorhanden → Filter fällt weg (kein leerer Plan)
  }
  return liste;
}
// ── „Stunde“ = Kurs + Datum in EINEM Element (Zero 2026-10-01, Untermenü-Runde Scheibe 1) ──
// ‹ › springt zur vorigen/nächsten Stunde DIESES Kurses laut Plan (logic/stunden.mjs), « » um eine Woche;
// ein Tipp auf die Stunde öffnet „Stunde wählen“: Woche + Stunden des Tages, ein Tipp öffnet (kein „Übernehmen“).
// Hat der Kurs an einem Tag weder Stunde noch Einträge, gibt es nur die Auswahl (Zero: „7b sollte dann nicht mehr sichtbar sein“).
function planKontext(){ return {zeitmodell:(vault.stamm.zeitmodelle||[])[0]||null,wochenplan:wochenplanAktiv(),ausnahmen:vault.stamm.ausnahmeSlots||[]}; }
function setzeTermin(datum){ terminDatum=datum; terminNachtrag=datum!==heuteIso(); anzeigeBlock=null; }
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
  if(editorAktiv){ toast('Erst den Sitzplan-Editor mit „Fertig“ schließen'); return; }   // der Editor schreibt in das Raster SEINES Kurses
  const heute=heuteIso(), zm=planKontext().zeitmodell;
  const tagDirekt=d=>{ dlgZu(); zeigeTag(d,null); };
  let tag=start||heute, offenZeile=null, wahl=null, meldung='';
  // die gezeigte Stunde ist in der Woche vorgewählt — beim Öffnen über „Plan“ und beim ersten Wechsel in den Reiter Woche
  const vorwahl=()=>{ const k=kurs(); if(!wahl&&k&&zm){ const st=angezeigteStunde(k); if(st) wahl={datum:terminDatum,blockNr:st.blockNr}; } };
  if(reiter==='woche') vorwahl();
  const kursVon=id=>id?vault.stamm.kurse.find(y=>y.id===id)||null:null;
  const titel=x=>{ const kx=kursVon(x.kursId); return (kx?kx.name+' · '+kx.fach:(SLOT_ARTEN[x.art]?.label||'—'))+(x.teilgruppe?' · Gr. '+x.teilgruppe:''); };
  const kurzTitel=x=>{ const kx=kursVon(x.kursId), kz=kx?fachKuerzel(kx.fach):''; return (kx?kx.name+(kz?' '+kz:''):(SLOT_ARTEN[x.art]?.kurz||'—'))+(x.teilgruppe?' · '+x.teilgruppe:''); };
  const zusatzText=(d,x)=>x.quelle==='entfall'?'fällt aus':x.quelle==='ausnahme'?(ausnahmeFuer(d,x.blockNr)?.grund==='tausch'?'Tausch':'Vertretung'):'';
  // „läuft gerade“ nur für eine Stunde, die stattfindet (Prüfer 2026-10-02: eine ausgefallene hieß sonst grün „läuft“)
  const laeuftJetzt=(d,b,x)=>{ if(d!==heute||!b||x.quelle==='entfall') return false; const j=new Date(), s=j.getHours()*3600+j.getMinutes()*60+j.getSeconds(); return s>=b.startSek&&s<=b.endeSek; };
  const hatEintraege=(kursId,d)=>!!kursId&&wirksameEvents(vault.events).some(e=>e.kursId===kursId&&e.datum===d&&istTerminEintrag(e));
  const ausn=()=>(vault.stamm.ausnahmeSlots??=[]);
  // Ausfall-Griffe einer Stunde und ihres Tages: ein Tipp wirkt, nur für GENAU dieses Datum. Danach steht an derselben Stelle
  // der Gegenknopf — er bekommt den Fokus und ist kurz gegen einen Doppeltipp gesperrt (Prüfer 2026-10-02).
  const aktionen=(d,x)=>{
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
      ...(d>heute?{disabled:''}:{}),onclick:()=>{ if(ohnePlan){ tagDirekt(d); return; } tag=d; offenZeile=null; zeichne('[data-tag="'+d+'"]'); }},WOCHENTAG_KURZ[wochentagVon(d)],el('small',{},d.slice(8,10)+'.'));
    const blaettern=(r,txt)=>el('button',{type:'button',class:'sw-tag sw-pf',title:txt,'aria-label':txt,
      ...(r>0&&tagPlus(mo,7)>heute?{disabled:''}:{}),onclick:()=>{ const z=tagPlus(t,7*r); tag=z>heute?heute:z; offenZeile=null; zeichne('.sw-pf[title="'+txt+'"]'); }},r<0?'«':'»');
    const alle=tagesStunden(t,ctx), stunden=alle.filter(x=>x.quelle!=='entfall'), ferien=zm?istFerien(zm,t):null;
    const hatKurs=k&&stunden.some(x=>x.kursId===k.id);
    const ausK=!!k&&alle.some(x=>x.kursId===k.id&&x.quelle==='entfall');   // ausgefallen ist nicht „nicht im Plan“ (Prüfer 02.10., B1)
    // Kurse mit Einträgen an dem Tag, aber ohne stattfindende Stunde (Planwechsel, Ausfall): eine Zeile „Einträge“, ein Tipp öffnet
    const mitEintrag=new Set(wirksameEvents(vault.events).filter(e=>e.datum===t&&istTerminEintrag(e)).map(e=>e.kursId));
    const eintragKurse=sortiereKurse(vault.stamm.kurse.filter(x=>x.status!=='archiviert'&&mitEintrag.has(x.id)&&!stunden.some(s=>s.kursId===x.id)));
    const eintragZeilen=eintragKurse.map(kx=>{ const z=el('button',{type:'button',class:'sw-stunde'+(k&&kx.id===k.id&&t===terminDatum?' an':''),dataset:{kurs:kx.id,eintrag:''},onclick:()=>oeffneStunde(kx.id,t,null,null)},
      el('span',{class:'sw-nr'}),el('span',{class:'kurs-band'}),el('b',{},kx.name+' · '+kx.fach),el('span',{class:'sw-badge'},'Einträge')); faerbe(z,kx); return el('div',{class:'sw-zeile'},z); });
    const offen=k&&t===terminDatum?angezeigteStunde(k):null;   // nur die angezeigte Stunde ist markiert, nicht jede des Kurses
    const zeilen=alle.flatMap(x=>{
      const kx=kursVon(x.kursId), entf=x.quelle==='entfall', lbl='Std. '+blockLabel(zm,x.blockNr,t), auf=offenZeile===x.blockNr, zusatz=zusatzText(t,x);
      const ist=!entf&&kx&&offen&&kx.id===k.id&&x.blockNr===offen.blockNr;
      const z=el('button',{type:'button',class:'sw-stunde'+(ist?' an':'')+(entf?' entf':''),dataset:{kurs:x.kursId||''},...(ist?{'aria-current':'true'}:{}),
        ...(kx&&kx.status!=='archiviert'&&!entf?{}:{disabled:''}),onclick:()=>oeffneStunde(kx.id,t,x.teilgruppe,x.blockNr)},   // archiviert (alte Vertretung): nicht wählbar (N5)
        el('span',{class:'sw-nr'},lbl),el('span',{class:'kurs-band'}),el('b',{},titel(x)),
        zusatz?el('span',{class:'sw-badge'+(entf?' fehl':'')},zusatz):el('span',{class:'sw-zeit'},formatZeit(x.startSek)));
      faerbe(z,kx);
      const name='Aktionen · '+lbl+' · '+titel(x);
      const mehr=el('button',{type:'button',class:'sw-mehr',dataset:{mehr:String(x.blockNr)},title:name,'aria-label':name,'aria-expanded':String(auf),
        onclick:()=>{ offenZeile=auf?null:x.blockNr; zeichne('[data-mehr="'+x.blockNr+'"]'); }},'⋯');
      const zeile=el('div',{class:'sw-zeile'+(auf?' offen':'')},z,mehr);
      return auf?[zeile,el('div',{class:'sw-aktion'},...aktionen(t,x))]:[zeile];
    });
    const hinweis=ferien?'Ferien/Feiertag: '+ferien.name+' — kein Unterricht.'
      :ohnePlan?k.name+' steht nicht im Stundenplan — Tag antippen öffnet '+k.name+' dort.'
      :!zm?'Kein Stundenplan angelegt — Kurs unten wählen.'
      :!alle.length?'Kein Unterricht laut Plan.'
      :k&&!hatKurs&&eintragKurse.some(x=>x.id===k.id)?(ausK?k.name+' fällt an diesem Tag aus — die Einträge bleiben unter „Einträge“.':k.name+' hat an diesem Tag laut Plan keine Stunde, aber Einträge.')
      :k&&!hatKurs?(ausK?k.name+' fällt an diesem Tag aus. Welche Stunde öffnen?':k.name+' hat an diesem Tag keine Stunde. Welche öffnen?'):'';
    const kurz=zm&&(zm.kurztage||[]).includes(t)?' · Kurzstunden':'';
    const datumFeld=el('input',{type:'date',class:'sw-datum',value:t,max:heute,'aria-label':'anderes Datum',onchange:e=>{ const v=e.target.value; if(v&&v<=heute){ if(ohnePlan){ tagDirekt(v); return; } tag=v; offenZeile=null; zeichne('.sw-datum'); } }});
    return [
      el('div',{class:'sw-woche'},blaettern(-1,'eine Woche zurück'),...woche.map(tagKnopf),blaettern(1,'eine Woche vor')),
      el('p',{class:'sw-kopf'},el('b',{},datumLabel(t)+(t===heute?' · heute':'')+kurz),hinweis?el('span',{},' · '+hinweis):''),
      ...(alle.length?[el('p',{class:'sw-tipp'},'Antippen öffnet die Stunde · ⋯ für Ausfall')]:[]),
      el('div',{class:'sw-liste'},...zeilen,...eintragZeilen),
      // offen, wenn es nichts anderes zu wählen gibt (kein Plan, kein Unterricht) · archivierte Kurse nie (die Handwahl verwürfe sie)
      el('details',{class:'sw-alle',...(!zm||!stunden.length||ohnePlan?{open:''}:{})},el('summary',{},'Alle Kurse'),
        el('div',{class:'sw-liste'},...sortiereKurse(vault.stamm.kurse.filter(x=>x.status!=='archiviert')).map(kx=>{ const st=stundeDesKurses(kx.id,t,ctx);   // hat er an dem Tag eine Plan-Stunde: deren Gruppe
          // die Zeile öffnet den Kurs, keine bestimmte Stunde: heute ist er damit „jetzt gewählt“ (Zero 03.10.), im Nachtrag gilt die Tagesregel
          const z=el('button',{type:'button',class:'sw-stunde',dataset:{kurs:kx.id},onclick:()=>oeffneStunde(kx.id,t,st?.teilgruppe??null,null)},
          el('span',{class:'kurs-band'}),el('b',{},kx.name+' · '+kx.fach)); faerbe(z,kx); return z; }))),
      el('div',{class:'btn-reihe sw-fuss'},datumFeld,
        // hat der Kurs heute keine Stunde: im Dialog auf heute blättern statt ihn neu zu öffnen (sähe aus wie „nichts passiert“, N4)
        el('button',{type:'button',class:'btn still',dataset:{heuteDlg:''},onclick:()=>{ if(k&&kursImPlan(k)&&!kursTag(k.id,heute,ctxK)){ tag=heute; offenZeile=null; zeichne('[data-heute-dlg]'); return; } dlgZu(); geheZuTag(heute); }},'Heute'),
        el('button',{type:'button',class:'btn still',onclick:dlgZu},'Schließen'))];
  };
  const zeichneWoche=ctx=>{
    if(!zm) return [el('p',{class:'sw-kopf'},'Kein Stundenplan angelegt.'),
      el('div',{class:'btn-reihe'},el('button',{type:'button',class:'btn',onclick:()=>{ dlgZu(); stundenplanAssistent(); }},'Stundenplan einrichten…'))];
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
    const grid=el('div',{class:'sp-woche sp-c-woche'},el('div',{class:'sp-ecke'}));
    for(const s of spalten){ const abw=!!(zm.tagesAusnahmen||{})[s.wt], kurz=(zm.kurztage||[]).includes(s.d);
      grid.append(el('div',{class:'sp-th sp-c-th'+(s.d===heute?' sp-heute':''),...(s.fe?{title:s.fe.name}:abw&&!kurz?{title:'abweichende Zeiten'}:{})},
        el('b',{},WT_KURZ[s.wt]+(abw&&!kurz?' *':'')),el('small',{},tm(s.d)),kurz?el('small',{class:'sp-c-kurz'},'Kurzstd.'):null)); }
    for(let nr=1;nr<=reihen;nr++){
      const zk=zeilenKopf(nr);
      grid.append(el('div',{class:'sp-th sp-blockkopf'},zk.label,el('small',{class:'sp-zeit'},zk.zeit!=null?formatZeit(zk.zeit):'')));
      for(const s of spalten){
        const x=s.st.find(y=>y.blockNr===nr);
        if(!x){ grid.append(el('div',{class:'sp-zelle sp-c-leer'+(s.fe?' ferien':'')},s.fe&&nr===1?s.fe.name:'')); continue; }
        const b=s.bl.find(y=>y.blockNr===nr), an=!!wahl&&wahl.datum===s.d&&wahl.blockNr===nr, zusatz=zusatzText(s.d,x);
        const z=el('button',{type:'button',class:'sp-zelle sp-c'+(x.kursId?' belegt':'')+(x.art?' sp-art':'')+(x.quelle==='entfall'?' entf':'')+(laeuftJetzt(s.d,b,x)?' sp-jetzt':'')+(an?' an':''),
          dataset:{datum:s.d,nr:String(nr)},'aria-pressed':String(an),'aria-label':datumLabel(s.d)+' Std. '+blockLabel(zm,nr,s.d)+' · '+titel(x)+(zusatz?' · '+zusatz:''),
          onclick:()=>{ wahl={datum:s.d,blockNr:nr}; tag=s.d; zeichne('[data-datum="'+s.d+'"][data-nr="'+nr+'"]',true,true); }},
          el('span',{class:'sp-c-name'},kurzTitel(x)),zusatz?el('small',{},zusatz):null);
        faerbe(z,kursVon(x.kursId)); grid.append(z);
      }
    }
    const feld=el('div',{class:'sp-c-feld'});
    const x=wahl&&spalten.find(s=>s.d===wahl.datum)?.st.find(y=>y.blockNr===wahl.blockNr);
    if(x){
      const d=wahl.datum, b=resolveBloecke(zm,wochentagVon(d),d).find(y=>y.blockNr===x.blockNr), kx=kursVon(x.kursId), entf=x.quelle==='entfall';
      const kannOeffnen=!!kx&&kx.status!=='archiviert'&&!entf&&d<=heute;
      feld.append(
        el('b',{class:'sp-c-feldkopf'},datumLabel(d)+' · Std. '+blockLabel(zm,x.blockNr,d)+(b?' · '+formatZeit(b.startSek)+'–'+formatZeit(b.endeSek):'')),
        el('p',{class:'u-hinweis'},(entf?'Fällt aus':x.quelle==='ausnahme'?zusatzText(d,x)+' (alter Eintrag)':'Laut Plan')+' · '+titel(x),laeuftJetzt(d,b,x)?el('span',{class:'u-gut'},' · läuft gerade'):null),
        ...(kx?[el('button',{type:'button',class:'btn',dataset:{spOeffnen:''},...(kannOeffnen?{}:{disabled:''}),...(d>heute?{title:'Nachtrag geht nur in die Vergangenheit'}:{}),
          onclick:()=>oeffneStunde(kx.id,d,x.teilgruppe,x.blockNr)},kx.name+' · '+kx.fach+' öffnen')]:[]),
        ...aktionen(d,x),
        el('p',{class:'u-hinweis'},'Gilt nur für diesen Tag. Den Wochenplan änderst du unter „Plan bearbeiten“.'));
    } else feld.append(el('p',{class:'u-hinweis'},'Stunde antippen: öffnen oder Ausfall eintragen.'));
    return [el('div',{class:'sp-c'},el('div',{class:'sp-c-raster'},kopf,el('div',{class:'sp-woche-wrap'},grid)),feld),
      el('div',{class:'btn-reihe sw-fuss'},el('button',{type:'button',class:'btn still sp-c-bearb',onclick:()=>{ dlgZu(); stundenplanAssistent(); }},'Plan bearbeiten…'))];
  };
  // Neu zeichnen: Plan-Kontext jedes Mal frisch (ein Ausfall ersetzt das ausnahmeSlots-Array), Scrollstand und Fokus bleiben.
  // Die Rückmeldung eines Griffs steht einmal im Dialog (role=status) — der Toast liegt unter dem modalen Dialog (Prüfer 2026-10-02).
  const zeichne=(fokus,behalten=true,feldZeigen=false,sperre=false)=>{
    const ctx=planKontext(), box=dlgInhalt(), y=box.scrollTop;
    const seg=el('span',{class:'sw-reiter',role:'group','aria-label':'Ansicht'},...[['tag','Tag'],['woche','Woche']].map(([r,txt])=>
      el('button',{type:'button',class:reiter===r?'an':'',dataset:{reiter:r},'aria-pressed':String(reiter===r),
        onclick:()=>{ if(reiter===r) return; reiter=r; offenZeile=null; if(r==='woche') vorwahl(); zeichne('[data-reiter="'+r+'"]',false); }},txt)));
    dlgZeigenEl(el('div',{class:'sw-kopfzeile'},el('h3',{},'Stunde'),seg),el('p',{class:'sw-meldung',role:'status'},meldung),...(reiter==='woche'?zeichneWoche(ctx):zeichneTag(ctx)));
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
  if(!(vault.stamm.zeitmodelle||[])[0]){ stundenplanAssistent(); return; }
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
  setzeTermin(datum); anzeigeBlock=blockNr??null; mitUebergang(renderAlles);
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
    aktiverSchueler=s.nr;
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
function kachelHtml(s,st,r,c){
  const cls=kachelKlassen(s,st);
  const marken=markenHtml(st);
  return '<div class="'+cls+'" data-nr="'+s.nr+'" data-r="'+r+'" data-c="'+c+'">'+
    '<div class="kopf"><span class="vn">'+esc(anzeigeVorname(s))+'</span>'+(s.lb?'<span class="lb-badge">LB</span>':'')+'</div>'+
    '<span class="nn">'+esc(anzeigeNachname(s))+'</span>'+
    '<div class="marken">'+marken+'</div></div>';
}
function listenZeile(s,e,st){
  return el('div',{class:kachelKlassen(s,st)+' listen-zeile',dataset:{nr:String(s.nr)}},
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
  const wuerfel=el('button',{type:'button',class:'wuerfel',dataset:{zufall:''},title:'Zufällig – wer heute noch nichts hat, kommt eher dran; mit ＋ oder ⭐ selten','aria-label':'Zufall',onclick:zufallsSchueler},iconEl('wuerfel'));
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
      else if(nr==null&&tische.has(r+','+c)) html+='<div class="kachel tisch" data-r="'+r+'" data-c="'+c+'" title="Leerer Tisch"></div>';
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
  if(editorAktiv||$('plan').classList.contains('editor')) return;
  if(t&&Math.hypot(e.clientX-t.x,e.clientY-t.y)>=8) return;   // gewischt, nicht getippt (Schwelle wie im Editor)
  if(kachel.classList.contains('tisch')){ if(!stempelTyp&&!busy) tischWahl(kachel.dataset.r+','+kachel.dataset.c); return; }   // mit scharfem Stempel geschieht nichts (Wischen über den Plan)
  const nr=Number(kachel.dataset.nr);
  if(stempelTyp){ stempleKachel(nr); return; }   // Stempel scharf: direkt setzen, kein Dialog
  if(busy) return;
  schuelerBlatt(nr);   // leere Hand = anschauen (Detail-Blatt · Master-Detail)
});
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
  const evs=wirksameEvents(vault.events).filter(e=>e.kursId===aktiverKursId&&e.schuelerNr===nr&&e.datum===terminDatum&&e.typ!=='storno'&&e.typ!=='quartalsnote');
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
const offenesO=(nr,st)=>wirksameEvents(vault.events).some(e=>e.typ==='fehlt_o'&&e.kursId===aktiverKursId&&e.schuelerNr===nr&&e.datum===terminDatum&&(e.blockNr==null||st?.blockNr==null||e.blockNr===st.blockNr));
// Die wirksamen Verspätungen dieses Schülers in dieser Stunde (tag=true: am ganzen Tag) — meist eine; mehrere nur aus Altbestand oder von zwei
// Geräten. Ein neuer Wert ersetzt die der Stunde: addEvent → ersetzungFuer (logic/verdichtung; Prüfer 03.10. 🔴 1/🟡 2; Doppelstunde Zero 03.10.)
function verspAmTermin(nr,tag=false,st=buchungsStunde()){
  const b=st?.blockNr??null;
  const l=wirksameEvents(vault.events).filter(e=>e.typ==='versp'&&e.kursId===aktiverKursId&&e.schuelerNr===nr&&e.datum===terminDatum&&(tag||e.blockNr==null||b==null||e.blockNr===b));
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
  // Beamer: das Blatt zeigt Vorschlag, Fehlzeiten, LB und Notizen — nie an die Wand (Prüfer 2026-09-29; die Schüler-Ansicht sperrt schon)
  if(beamerModus){ toast('Projektion aktiv — Details erst nach dem Beamer-Modus'); return; }
  const v=verdichte(vault.events.filter(e=>e.kursId===k.id),nr,{profil:bewertProfil(k),lb:s.lb});
  const opt={kursId:aktiverKursId}, sek2=bewertProfil(k)==='sek2';
  let offen=null;   // das aufgeklappte Feld: 'note' | 'versp' | 'notiz' | 'best' | 'verw'
  const stunde=el('section',{class:'sb-stunde','aria-label':'Diese Stunde'});
  // eintraege: [[typ, extra], …] — die letzte Buchung ist die, die ↶ zurücknimmt (beim ⭐ die Note, nicht die Notiz)
  const buche=(eintraege,text)=>{ if(kursGewechselt(opt)) return; for(const [typ,extra] of eintraege) if(!addEvent(typ,nr,extra||{})) return;
    dlgZu(); toast(text+' · '+s.vorname); renderHeute(); pulseKachel(nr); if(danach) danach(eintraege[eintraege.length-1][0]); };
  const zeichne=fokus=>{
    const fehlt=standAmTermin(nr,terminDatum).fehlt;
    const bew=wirksameEvents(vault.events).filter(e=>e.kursId===aktiverKursId&&e.schuelerNr===nr&&e.datum===terminDatum&&BEWERTUNGS_TYPEN.has(e.typ))
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
  const demo=kachelHtml({nr:0,vorname:'Anna',name:'Anders',lb:true},{...leererStand(),plus:1,mat:1,notiz:1,versp:5},0,0);
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
    zeile('<span class="lg-swatch"></span>','sonst (o, Note, ⭐, ⊘ oder noch nichts)')+
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

/* ═══ DECK · Stundenende-Ritual (Swipe: ←− →+ ↑Schülerblatt ↓weiter) ═══ */
let deckListe=[], deckIdx=0, deckNurOhne=true;   // Zero 02.10.: „Deck soll standardmäßig mit nur offene Einträge starten“
let deckRundeStart=null;
let deckVerlauf=[]; // Buchungen DIESER Deck-Runde [{nr,name,evId,typ}] — mitlaufende, korrigierbare Historie (Zero-Feldtest 2026-07-10)
function baueDeckListe(){
  const k=kurs(); if(!k) return [];
  // Abwesende (fehlt_o/e/u) nie im Deck — kein Bewerten von Fehlenden
  const abw=new Set(wirksameEvents(vault.events).filter(e=>e.kursId===k.id&&e.datum===terminDatum&&(e.typ==='fehlt_o'||e.typ==='fehlt_e'||e.typ==='fehlt_u')).map(e=>e.schuelerNr));
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
  const imDeck=new Set(deckListe.map(s=>s.nr));
  const bekannt=new Set(deckVerlauf.map(v=>v.evId).filter(Boolean));
  const neu=wirksameEvents(vault.events).filter(e=>
    e.kursId===k.id&&e.datum===terminDatum&&imDeck.has(e.schuelerNr)&&
    e.typ!=='storno'&&String(e.ts||'')>=deckRundeStart&&!bekannt.has(e.id));
  for(const e of neu.sort((a,b)=>String(a.ts).localeCompare(String(b.ts)))){
    const s=stammKind(e.schuelerNr);
    deckVerlauf.unshift({nr:e.schuelerNr,name:s?anzeigeVorname(s):'Nr '+e.schuelerNr,
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

/* ═══ SCHÜLER · Verdichtung + Inline-Detail-Akkordeon (kein Popup) ═══ */
let offenerSchueler=null, offeneZeile=null, zeitraumFilter=null, schuelerSuche='', schuelerFilter=null, sListeScroll=0;
let schuelerAnsicht='liste', schuelerSort='nr';   // Zero 2026-09-02: Modi Liste·Noten·Termine·Fehlzeiten · Sortierung Nr·Name·Vorschlag·Anlass
function aktivesSchuljahr(){ return (vault.stamm.schuljahre||[]).find(j=>j.id===vault.stamm.aktivesSchuljahrId)||null; }
function renderSchueler(){
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
  const klaerZeilen=offeneO.map(e=>{ const s=stammKind(e.schuelerNr,k);
    const tageOffen=Math.floor((new Date(heute)-new Date(e.datum))/86400000);
    const alt=tageOffen>7;
    return '<div class="klaer-zeile'+(alt?' alt':'')+'"><span class="klaer-wer"><b>'+esc(s?s.vorname+' '+s.name:'Nr '+e.schuelerNr)+'</b><small>'+datumLabel(e.datum)+(alt?' · '+tageOffen+' Tage offen':'')+'</small></span>'+
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
      const mit=new Set(wirksameEvents(kursEvents).filter(e=>e.schuelerNr===s.nr&&istTerminEintrag(e)).map(e=>e.datum));
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
    const sName=(stammKind(o.schuelerNr,k)||{}).vorname||('Nr '+o.schuelerNr);
    // Klärung = Storno des fehlt_o + neues fehlt_e/fehlt_u am ORIGINALDATUM (Merge-fest, verdichte löst jüngste-ts)
    // Ohne Buchung (Archiv, Kurswechsel) keine Erfolgsmeldung: der Grund steht frei, ein offenes Blatt schließt (Prüfer 03.10. 🟢 11)
    const klaere=()=>{ if(!addEvent(art==='e'?'fehlt_e':'fehlt_u',o.schuelerNr,{datum:o.datum,stornoVon:o.id})){ dlgZu(); return; }
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
      el('div',{class:'s-seite s-klaer-blatt'},...offen.map((o,i)=>{ const s=stammKind(o.schuelerNr,k), tage=Math.floor((new Date(heuteIso())-new Date(o.datum))/86400000);
        return el('div',{class:'klaer-zeile'+(tage>7?' alt':'')},el('span',{class:'klaer-wer'},el('b',{},s?s.vorname+' '+s.name:'Nr '+o.schuelerNr),el('small',{},datumLabel(o.datum)+(tage>7?' · '+tage+' Tage offen':''))),
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
  const v=verdichte(kursEvents,s.nr,{...vOpt,lb:s.lb});
  const sum=Math.max(1,v.nPlus+v.nNull+v.nMinus);
  const teil=(cls,n)=>{ const d=el('span',{class:cls}); d.style.width=(100*n/sum)+'%'; return d; };  // CSSOM statt style-Attribut (CSP)
  const bilanz=el('div',{class:'s-auf-zeile'},
    el('span',{class:'balken'},teil('bal-p',v.nPlus),teil('bal-o',v.nNull),teil('bal-m',v.nMinus)),
    el('span',{class:'s-auf-zahl'},v.nPlus+'⁺ '+v.nNull+'° '+v.nMinus+'⁻'),
    el('span',{class:'u-leise'},'Beteiligung '+v.beteiligtTermine+' / '+v.kursTermine+' Termine · Verlauf '+v.pfeil));
  const sj=aktivesSchuljahr(); const qn=quartalsnotenVon(kursEvents,s.nr);
  const zellen=['q1','q2','q3','q4'].map(id=>{
    const z=sj&&sj.zeitraeume?sj.zeitraeume.find(x=>x.id===id):null;
    const ev=qn[QN_KEY[id]];
    const vz=z?verdichte(kursEvents,s.nr,{profil:bewertProfil(k),lb:s.lb,von:z.von,bis:z.bis}):null;
    return el('button',{class:'qn-zelle klein'+(ev?'':' offen'),type:'button',onclick:()=>{
        if(!z){ toast('Kein Schuljahres-Zeitraum definiert'); return; }
        setzeQuartalsnote(s,(vz&&vz.vorschlag)||{wert:null,label:'—'},z); }},
      el('span',{class:'qn-label'},id.toUpperCase()),
      el('span',{class:'qn-note'},ev?String(ev.wert):'—'),
      el('span',{class:'qn-sub'},vz&&vz.vorschlag?'Vorschlag '+vz.vorschlag.label:(s.lb?'LB':'—')));
  });
  const knopf=(txt,fn)=>el('button',{class:'btn still u-btn-klein',type:'button',onclick:fn},txt);
  const fehl=offeneO.filter(e=>e.schuelerNr===s.nr).map(o=>el('div',{class:'klaer-zeile'},
    el('span',{},'Fehlzeit '+datumLabel(o.datum)),
    el('span',{class:'klaer-btns'},knopf('Entsch.',()=>klaerKlick(o.id,'e')),knopf('Unentsch.',()=>klaerKlick(o.id,'u')),knopf('Irrtum',()=>klaerKlick(o.id,'irrtum')))));
  const evs=wirksameEvents(kursEvents).filter(e=>e.schuelerNr===s.nr&&istTerminEintrag(e));
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
    const v=verdichte(kursEvents,s.nr,{profil:bewertProfil(k),lb:s.lb,von:zr?zr.von:'',bis:zr?zr.bis:'9999-12-31'});
    const f=(v.nFehltE||v.nFehltU||v.nVerweigert)?(v.nFehltE+'e/'+v.nFehltU+'u'+(v.nVerweigert?'/'+v.nVerweigert+'verw':'')):'';
    // GESETZTE Quartalsnote des gewählten Zeitraums schlägt den Live-Vorschlag (der Lehrer hat entschieden)
    const qnEv=zr?quartalsnotenVon(kursEvents,s.nr)[QN_KEY[zr.id]]:null;
    if(qnEv) nFest++;
    return {nr:lnr(s),vorschlag:qnEv?String(qnEv.wert):(v.vorschlag?v.vorschlag.label:''),fSummen:f};
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
  const wert=d=>{ if(d.qnEv){ try{ return noteAlsWert(d.qnEv.wert,profil); }catch{ return null; } } return d.v.vorschlag?d.v.vorschlag.wert:null; };
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
          if(!addEvent('quartalsnote',d.s.nr,{hj,quartal,wert,zeitraumId:zr.id})){ dlgZu(); return; } n++; }   // nichts gebucht (Archiv, Kurswechsel): nicht weiter, die Meldung nennt den Grund
        dlgZu(); toast(n+' Quartalsnoten gesetzt ('+zr.label+')'); renderSchueler();
      }},'Setzen'),
      el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
}
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
  const verspVon=nr=>wirksam.filter(e=>e.schuelerNr===nr&&e.typ==='versp'&&e.datum>=von&&e.datum<=bis).reduce((a,e)=>a+(e.minuten||0),0);
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
      const v=verdichte(kursEvents,s.nr,{profil,lb:s.lb,von,bis});
      const qn=quartalsnotenVon(kursEvents,s.nr);
      const versp=verspVon(s.nr);
      const zellen=spalten.map(z=>{
        const vz=verdichte(kursEvents,s.nr,{profil,lb:s.lb,von:z.von,bis:z.bis});
        const ev=/^q/.test(z.id)?qn[QN_KEY[z.id]]:null;
        if(ev){ const abw=vz.vorschlag?notenAbstand(ev.wert,vz.vorschlag.wert,profil):null;
          return el('td',{},el('button',{class:'nt-zelle gesetzt',title:'gesetzt · antippen zum Ändern',onclick:()=>setzeQuartalsnote(s,vz.vorschlag||{wert:null,label:'—'},z)},String(ev.wert)),
            abw!=null&&abw>=1?el('small',{class:'s-abw',title:'weicht mindestens eine Stufe vom Vorschlag ab'},iconEl('warnung'),' V '+vz.vorschlag.label):null); }
        if(/^q/.test(z.id)&&!s.lb&&vz.vorschlag) return el('td',{},el('button',{class:'nt-zelle vor',title:'Vorschlag · antippen zum Setzen',onclick:()=>setzeQuartalsnote(s,vz.vorschlag,z)},'V '+vz.vorschlag.label));
        return el('td',{class:'u-leise'},vz.vorschlag?'V '+vz.vorschlag.label:'—');   // HJ: nur Vorschlag — die Halbjahresnote rechnet die Mappe aus Q1/Q2 (Punkt 11)
      });
      const verlauf=quartalsVerlauf(kursEvents,s.nr,quartale,{profil,lb:s.lb}).filter(e=>e.score!==null).map(e=>e.id.toUpperCase()+(e.pfeil?' '+e.pfeil:'')).join('  ');
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
      const v=verdichte(kursEvents,s.nr,{profil,lb:s.lb,von,bis}), vz=verdichte(kursEvents,s.nr,{profil,lb:s.lb,von:zq.von,bis:zq.bis}), ev=quartalsnotenVon(kursEvents,s.nr)[QN_KEY[zq.id]];
      const setzen=()=>setzeQuartalsnote(s,vz.vorschlag,zq);
      const zelle=ev?el('button',{type:'button',class:'nt-zelle gesetzt',onclick:setzen},String(ev.wert)):!s.lb&&vz.vorschlag?el('button',{type:'button',class:'nt-zelle vor',onclick:setzen},'V '+vz.vorschlag.label):!s.lb?el('button',{type:'button',class:'nt-zelle vor','aria-label':'Quartalsnote setzen',onclick:setzen},'—'):el('span',{class:'u-leise'},'—');   // „—“ = noch kein Vorschlag, setzen geht trotzdem (Prüfer 03.10. 🟢 12)
      return el('div',{class:'s-nzeile'},el('button',{type:'button',class:'ut-name',onclick:()=>{ offenerSchueler=s.nr; mitUebergang(renderSchueler); }},el('small',{class:'u-leise'},listenNr(s)+' '),el('b',{},s.vorname),' ',el('small',{class:'u-leise'},s.name),s.lb?el('span',{class:'lb-badge'},'LB'):null),
        el('span',{class:'s-nbil'},v.nPlus+' / '+v.nNull+' / '+v.nMinus),zelle); }));
    const tabHinweis='Q-Zelle antippen: setzen oder ändern · V = Vorschlag, du entscheidest · HJ zeigt nur den Vorschlag über das Halbjahr, die Halbjahresnote rechnet die Klassenmappe aus Q1/Q2 · Warndreieck = gesetzte Note weicht mindestens eine Stufe vom Vorschlag ab · Jahr = Bilanz-Verlauf von Quartal zu Quartal.';
    // Unter der Handy-Liste ihr eigener Satz — die Liste zeigt weder HJ noch Warndreieck noch Jahr (Prüfer 03.10. 🟢 9); das CSS zeigt je Breite einen
    hinweis=handyListe?el('div',{},el('p',{class:'u-hinweis ut-nur-tabelle'},tabHinweis),
      el('p',{class:'u-hinweis s-nur-liste'},'Note antippen: setzen oder ändern · V = Vorschlag, — = noch keiner, du entscheidest · das Quartal der Spalte über „Zeitraum“ wählen.')):tabHinweis;
  } else if(schuelerAnsicht==='termine'){
    const relevant=e=>istTerminEintrag(e)&&e.datum>=von&&e.datum<=bis;
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
    '<p class="u-hinweis">Zelle antippen zum Setzen/Ändern — der Vorschlag ist umrandet, ein Tipp setzt, du entscheidest. ● in der Liste = gesetzt.</p>'+
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
    // Klartext mit Name und Notizen verlässt hier den Tresor (Prüfer 2026-09-29): sagen, wo er jetzt liegt. Nicht selbst leeren —
    // beim Wechsel zu Mail sperrt „sofort sperren“ die Kladde, bevor eingefügt ist.
    const warn='Liegt danach unverschlüsselt in der Zwischenablage (mit Handoff auch auf Mac/iPhone) — nach dem Einfügen etwas anderes kopieren.';
    inZwischenablage(text,'Kurzbericht kopiert · '+s.vorname+' — '+warn,'Kurzbericht',{ms:7000,hinweis:warn});
  };
  wrap.querySelectorAll('[data-qz]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.qz; const z=sj&&sj.zeitraeume?sj.zeitraeume.find(x=>x.id===id):null; if(!z){ toast('Kein Schuljahres-Zeitraum definiert'); return; }
    const vz=verdichte(kursEvents,s.nr,{profil:bewertProfil(k),lb:s.lb,von:z.von,bis:z.bis});
    setzeQuartalsnote(s,vz.vorschlag||{wert:null,label:'—'},z);  // Q-Zellen-Tap setzt GENAU dieses Quartal (C3)
  });
  verdrahteDetail(wrap,tag=>{ renderSchueler(); oeffneTag($('view-schueler'),tag); });
}
function schuelerDetailHtml(s,k,v){
  const evs=wirksameEvents(vault.events.filter(e=>e.kursId===k.id&&e.schuelerNr===s.nr)).filter(e=>e.typ!=='storno'); // Storno-Buchungen nicht im Verlauf zeigen
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
  wrap.querySelectorAll('[data-quartal]').forEach(b=>b.onclick=e=>{ e.stopPropagation(); const s=schuelerVonNr(Number(b.dataset.quartal)); const kk=kurs(); const zr=zeitraumFilter; const v=verdichte(vault.events.filter(x=>x.kursId===kk.id),s.nr,{profil:bewertProfil(kk),lb:s.lb,von:zr?zr.von:'',bis:zr?zr.bis:'9999-12-31'}); setzeQuartalsnote(s,v.vorschlag,zr); });
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
    const v=verdichte(kev,s.nr,{profil:bewertProfil(k),lb:s.lb,von:z.von,bis:z.bis}).vorschlag, ev=quartalsnotenVon(kev,s.nr)[QN_KEY[z.id]];
    const vor=v?(sek2?String(v.wert):wertZuLabel(v.wert))||null:null, jetzt=ev?String(ev.wert):null, q=Number(z.id.slice(1));
    const buche=w=>{ if(kursGewechselt(opt)) return;
      if(w===jetzt){ dlgZu(); toast('unverändert: '+z.id.toUpperCase()+'-Note '+zeige(w)+' · '+s.vorname); return; }
      if(addEvent('quartalsnote',s.nr,{hj:q>2?2:1,quartal:q%2?1:2,wert:w,zeitraumId:z.id})){ dlgZu(); toast(z.id.toUpperCase()+'-Note '+zeige(w)+' · '+s.vorname); if(aktView==='schueler') renderSchueler(); } else dlgZu(); };   // nichts gebucht: die Meldung liegt frei
    dlgZeigenEl(el('h3',{},'Quartalsnote · '+s.vorname+' '+s.name),
      el('div',{class:'zr-leiste qn-wahl',role:'group','aria-label':'Quartal'},...qs.map(x=>el('button',{type:'button',class:'zr-chip'+(x.id===z.id?' an':''),'aria-pressed':String(x.id===z.id),dataset:{qn:x.id},onclick:()=>{ z=x; zeichne(); const b=$('dlg').querySelector('[data-qn="'+x.id+'"]'); if(b) b.focus(); }},x.id.toUpperCase()))),
      el('section',{class:'sb-stunde'},el('div',{class:'sb-feld ruhig'},
        el('p',{class:'u-hinweis'},(jetzt?'Gesetzt: '+zeige(jetzt)+' · ':'')+(vor?'Vorschlag: '+zeige(vor):s.lb?'LB, kein Vorschlag':'noch kein Vorschlag')+' — ein Tipp setzt die Note, du entscheidest.'),
        el('div',{class:'sb-wahl'},...(sek2?Array.from({length:16},(_,i)=>String(15-i)):NOTEN_DRITTEL).map(w=>el('button',{type:'button',class:'btn still'+(w===vor?' vorschlag':'')+(w===jetzt?' gesetzt':''),
          dataset:{qnNote:w},...(w===jetzt?{'aria-pressed':'true'}:{}),onclick:()=>buche(w)},zeige(w)))))));
  };
  zeichne();
}

/* ═══ KURSE · Import / Profil / Slots / Sitzplan-Editor ═══ */
/* Kurs direkt in der App anlegen: Excel-Spalten kopieren → einfügen (Tab/Semikolon-tolerant) */
function slugId(text){ return String(text).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'kurs'; }
// Sitzplan „alphabetisch verteilen“ beim Anlegen: 6 Spalten, nach Nachnamen (vorher nur im Wizard)
function alphaGrid(schueler){
  const sortiert=schueler.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'de'));
  const grid={}, cols=6;
  sortiert.forEach((s,i)=>{ grid[Math.floor(i/cols)+','+(i%cols)]=s.nr; });
  return grid;
}
// Ein Weg legt jeden Kurs an (Scheibe 8, Zero 05.10.): vorher legte „Schnell“ einen anderen Kurs an als der Wizard — ohne Schuljahr,
// Status und bei der Oberstufe ohne Noten-Eingabe (app.mjs v1.20.0 Z. 2520 gegen 2615). Gibt es den Kurs schon, nie still ersetzen:
// die Liste geht in „Liste aktualisieren“ (Prüfer 2026-09-29, v1.20.0).
function legeKursAn(w,schueler,warnungen){
  const name=w.name.trim(), fach=w.fach.trim();
  const k=neuerKurs({name,fach,schuljahr:w.jahr.trim(),profil:w.profil,notenmodus:w.notenmodus},vault.stamm.aktivesSchuljahrId);   // logic/mappe
  const idx=vault.stamm.kurse.findIndex(x=>x.id===k.id);
  dlgZu();
  if(idx>=0){ listenAbgleichDialog(vault.stamm.kurse[idx],schueler,'einfuegen').then(ok=>{ if(ok){ toast('Liste abgeglichen: '+name); renderKurse(); } }); return; }
  vault.stamm.kurse.push(k);
  vault.stamm.schueler[k.id]=schueler;
  if(w.sitz==='alpha') vault.stamm.sitzplaene[k.id]={grid:alphaGrid(schueler)};
  stammMutiert(); speichern();
  kursWechseln(k.id);
  toast('Angelegt: '+name+' ('+schueler.length+' Schüler)'+(warnungen.length?' · '+warnungen.length+' Hinweis(e)':''));
  renderKurse();
}
// Kurs anlegen (Scheibe 8, Zero 05.10. Wahl 1 A „Ein Blatt“, design/s8_entwuerfe_2026-10-05/WAHL.md): oben „Mappe laden“ als Haupttat,
// darunter eine Liste einfügen. Name, Fach, Schuljahr, Stufe und Sitzplan erscheinen, sobald Zeilen erkannt sind. Vorher drei Wege
// (Wizard, „Schnell“, Mappe). Die Felder werden einmal gebaut und nur ein- und ausgeblendet, beim Tippen wird nichts neu gebaut
// (Fokus-Lehre). Die Ids kn-* nutzen die Proben (P14, P29, P30).
function kursAnlegenBlatt(){
  const w={name:'',fach:'',jahr:(aktivesSchuljahr()?.label)||'',profil:'sek1',notenmodus:'punkte',sitz:'alpha'};
  let geparst={schueler:[],warnungen:[]};
  const ok=el('button',{class:'btn',id:'kn-ok',disabled:''},'Kurs anlegen');
  const bereit=()=>{ ok.disabled=!(geparst.schueler.length&&w.name.trim()&&w.fach.trim()); };
  const feld=(id,schluessel,ph,klasse,extra={})=>el('input',{type:'text',id,value:w[schluessel],placeholder:ph,class:klasse,...extra,oninput:e=>{ w[schluessel]=e.target.value; bereit(); }});
  // Segment: nur seine Knöpfe werden neu gezeichnet, nie die Textfelder
  const seg=(werte,schluessel,danach)=>{ const box=el('div',{class:'seg kn-seg'});
    const zeichne=()=>box.replaceChildren(...werte.map(([v,t])=>el('button',{type:'button',class:'btn'+(w[schluessel]===v?'':' still'),'aria-pressed':String(w[schluessel]===v),dataset:{kn:schluessel+'-'+v},
      onclick:()=>{ w[schluessel]=v; zeichne(); if(danach) danach(); }},t)));
    zeichne(); return box; };
  const notenZeile=el('div',{class:'kn-reihe hidden'},el('span',{},'Noten'),seg([['punkte','Punkte 0–15'],['drittel','Drittelnoten']],'notenmodus'));
  const felder=el('div',{class:'kn-felder hidden'},
    el('div',{class:'zeile'},el('span',{},'Klasse/Kurs'),el('span',{},feld('kn-name','name','z. B. 7b','u-w130',{'aria-label':'Klasse/Kurs'}))),
    el('div',{class:'zeile'},el('span',{},'Fach'),el('span',{},feld('kn-fach','fach','z. B. Mathematik','u-w160',{list:'fach-liste','aria-label':'Fach'}),fachDatalist())),
    el('div',{class:'zeile'},el('span',{},'Schuljahr'),el('span',{},feld('kn-jahr','jahr','2026/27','u-w110',{'aria-label':'Schuljahr'}))),
    el('div',{class:'kn-reihe'},el('span',{},'Stufe'),seg([['sek1','Sek I'],['sek2','Oberstufe']],'profil',()=>notenZeile.classList.toggle('hidden',w.profil!=='sek2'))),
    notenZeile,
    el('div',{class:'kn-reihe'},el('span',{},'Sitzplan'),seg([['alpha','Alphabetisch verteilen'],['spaeter','Später']],'sitz')));
  const spaeter=el('p',{class:'u-hinweis'},'Name, Fach und Schuljahr fragt die Kladde, sobald Zeilen erkannt sind.');
  const info=el('div',{class:'u-vorschau'},'Noch keine Zeilen erkannt.');
  const ta=el('textarea',{id:'kn-liste',rows:'6',class:'u-textarea u-fs16',placeholder:'1\tMustermann\tMax\n2\tBeispiel\tBerna\tLB'});
  ta.addEventListener('input',()=>{
    geparst=parseSchuelerListe(ta.value);
    const n=geparst.schueler.length, lb=geparst.schueler.filter(s=>s.lb).length;
    info.replaceChildren(...(n?[el('b',{class:'u-gut'},n+' Schüler erkannt'),(lb?' · '+lb+'× LB':'')+' — '+geparst.schueler.slice(0,3).map(s=>s.nr+' '+s.vorname+' '+s.name).join(' · ')+(n>3?' …':'')]:['Noch keine Zeilen erkannt.']),
      // alle Hinweise, nie gekürzt: „Nr 36 … übersprungen“ heißt, ein Kind fehlt (Plan v0.8–v1.0 §15, Prüfer 05.10. Y2)
      ...geparst.warnungen.map(x=>el('div',{class:'u-warn13'},iconEl('warnung'),' '+x)));
    felder.classList.toggle('hidden',!n); spaeter.classList.toggle('hidden',!!n); bereit();
  });
  ok.onclick=()=>{ if(!ok.disabled) legeKursAn(w,geparst.schueler,geparst.warnungen); };
  dlgZeigenEl(el('h3',{},'Kurs anlegen'),
    el('button',{type:'button',class:'btn kn-mappe',dataset:{knMappe:''},onclick:()=>{ dlgZu(); const f=$('file-kurs'); if(f) f.click(); }},
      el('b',{},'Mappe laden'),el('small',{},'Eine oder mehrere Kursmappen (.xlsx). Name, Fach und Schüler kommen aus der Mappe.')),
    el('div',{class:'kn-oder'},'oder eine Liste einfügen'),
    el('p',{class:'u-hinweis'},'In Excel die Spalten Nr · Name · Vorname (ggf. LB) markieren, kopieren und hier einfügen — oder tippen, eine Zeile je Kind.'),
    ta,info,spaeter,felder,
    el('div',{class:'btn-reihe'},ok,el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
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
// Verwalten liegt auf dem ⋯-Knopf der Karte (Kurs-Seite, kursSeite).
function oeffneKurs(id){
  kursWechseln(id); setzeTermin(heuteIso());   // Kurs benutzen = jetzt: auch beim selben Kurs endet ein Nachtrag
  handwahlSetzen({kursId:id,teilgruppe:null,datum:heuteIso(),blockNr:autowahlInfo?.blockNr??null});   // Kurskarte = Handwahl, sonst drehte der Takt binnen 60 s zurück
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
// Kurs-Seite statt Raster, solange eine offen ist (Scheibe 4) — ‹ Kurse, „Kurse“ unten oder ein Ansichtswechsel schließt sie
let kursSeiteId=null;
function renderKurse(){
  const wrap=$('view-kurse');
  if(kursSeiteId){ const ks=vault.stamm.kurse.find(x=>x.id===kursSeiteId&&x.status!=='archiviert'); if(ks){ kursSeite(ks); return; } kursSeiteId=null; }
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
  $('btn-kurs-anlegen').onclick=kursAnlegenBlatt;
  wrap.querySelectorAll('[data-kurs]').forEach(b=>b.onclick=()=>oeffneKurs(b.dataset.kurs));
  wrap.querySelectorAll('[data-verwalten]').forEach(b=>b.onclick=()=>{ kursSeiteId=b.dataset.verwalten; mitUebergang(renderKurse); });
  wrap.querySelectorAll('[data-oeffnen]').forEach(b=>b.onclick=()=>{ kursWechseln(b.dataset.oeffnen); aktView='schueler'; document.querySelectorAll('#hauptnav button').forEach(x=>x.classList.toggle('aktiv',x.dataset.view==='schueler')); setzeViewTitel('schueler'); ['heute','deck','schueler','kurse','mehr'].forEach(v=>$('view-'+v).classList.toggle('hidden',v!=='schueler')); renderSchueler(); toast('Archiv-Kurs (schreibgeschützt)'); });
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
    const geladen=[], fehler=[], abgleiche=[], warnungen=[];
    if(dateien.some(f=>/\.xlsx$/i.test(f.name))&&!xlsxLesbar()){
      toast('⚠ Dieser Browser kann keine Mappen entpacken — bitte kurs.json vom PC nutzen',5000);
      e.target.value=''; return;
    }
    for(const f of dateien){
      try {
        // Mappe (.xlsx) wird hier gelesen, kurs.json bleibt der Weg vom PC-Werkzeug —
        // beide Leser muessen dasselbe ergeben, gesichert durch test/mappe.test.mjs
        const roh=/\.xlsx$/i.test(f.name) ? await lieseMappe(f,f.name) : JSON.parse(await f.text());
        const kursJson=pruefeKursDatei(roh);   // doppelte Nr, fehlende id, fremde Felder → vorher abfangen (logic/mappe)
        const k=ergaenzeNeuenKurs(kursJson.kurs,vault.stamm.aktivesSchuljahrId);   // neuer Kurs in derselben Form wie aus „Liste einfügen“ (Scheibe 8)
        const idx=vault.stamm.kurse.findIndex(x=>x.id===k.id);
        warnungen.push(...kursJson.warnungen.map(w=>k.name+': '+w));
        if(idx>=0){ abgleiche.push({k:vault.stamm.kurse[idx],neu:kursJson.schueler}); continue; }   // Bestand: erst abgleichen, dann anwenden (Punkt 12)
        // Neuer Kurs zählt zum aktiven Schuljahr; trägt die Mappe ein anderes, sagt es ein Hinweis (Prüfer 05.10. G3)
        const sjAkt=aktivesSchuljahr();
        if(sjAkt&&k.schuljahr&&k.schuljahr!==sjAkt.label) warnungen.push(k.name+': Schuljahr der Mappe '+k.schuljahr+' — angelegt im aktiven Schuljahr '+sjAkt.label);
        vault.stamm.kurse.push(k);
        vault.stamm.schueler[k.id]=kursJson.schueler;
        geladen.push(k);
      } catch(err){ fehler.push(f.name+': '+err.message); }
    }
    for(const a of abgleiche){ if(!vault) break; if(await listenAbgleichDialog(a.k,a.neu,'mappe')) geladen.push(a.k); }   // nacheinander, jeder Kurs sein Blatt; gesperrt → Schluss (Prüfer 04.10. K4-b)
    if(geladen.length){
      stammMutiert(); speichern();
      kursWechseln(geladen[geladen.length-1].id);
      renderKurse();
    }
    // Ein Toast fuer den ganzen Stapel — bei genau einem Kurs bleibt der Wortlaut wie bisher
    const teile=[];
    if(geladen.length===1) teile.push('Importiert: '+geladen[0].name+' ('+(vault.stamm.schueler[geladen[0].id]||[]).length+' Schüler)');
    else if(geladen.length) teile.push('Importiert: '+geladen.length+' Kurse ('+geladen.map(k=>k.name).join(' · ')+')');
    e.target.value='';
    // Warnungen und Fehler als Liste zum Lesen — vorher nur „2 Warnung(en)“ im Toast, der Text (z. B. „LB nicht übernommen“) blieb unsichtbar
    if(warnungen.length||fehler.length){
      const liste=(titel,zeilen)=>zeilen.length?[el('div',{class:'tag-kopf'},titel),el('ul',{class:'u-hinweis'},...zeilen.map(z=>el('li',{},z)))]:[];
      dlgZeigenEl(el('h3',{},'Kurs-Import'),
        ...(teile.length?[el('p',{},teile.join(' · '))]:[]),
        ...liste('Nicht gelesen',fehler),
        ...liste('Bitte prüfen',warnungen),
        el('div',{class:'btn-reihe'},el('button',{class:'btn',onclick:dlgZu},'Verstanden')));
    } else if(teile.length) toast(teile.join(' · '),3500);
  };
}
// Kurs-Seite (Scheibe 4, Zero 2026-10-02: Variante A „Kurs-Seite“): „⋯“ an der Kurskarte öffnet sie in „Kurse“ statt des Blatts.
// Oben Schüler und Halbgruppen in EINER Liste (vorher zwei Dialoge, Teilnehmer und Halbgruppen), darunter der Sitzplan (bearbeiten,
// als PDF), die Einstellungen in Alltagssprache und zuletzt „Selten“ (duplizieren, Stundenplan-Slots, archivieren). „HA-Typ aktiv“
// entfällt: der Schalter schrieb kursprofile.ha, aber nichts las es (App und Brücke, gemessen 02.10.). Alles speichert sofort, kein „Fertig“.
// Hinzufügen und Bearbeiten bleiben kleine Dialoge — die Seite zeichnet nach jeder Änderung neu und nähme Getipptes sonst mit.
function kursSeite(k){
  const wrap=$('view-kurse');
  const nochmal=()=>{ if(kursSeiteId===k.id&&aktView==='kurse') renderKurse(); };
  const griffe=teilnehmerGriffe(k,()=>{ dlgZu(); nochmal(); });
  const alle=griffe.alle();
  const sortiert=arr=>arr.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||'','de')||(a.vorname||'').localeCompare(b.vorname||'','de'));
  const aktive=sortiert(alle.filter(s=>!s.inaktiv)), inaktive=sortiert(alle.filter(s=>s.inaktiv));
  const panel=(titel,...inhalt)=>el('section',{class:'panel ks-panel'},el('h2',{},titel),...inhalt);
  // Gruppe: ein Tipp setzt und speichert; die Knöpfe der Zeile leuchten sofort um (kein Neuzeichnen, die Liste bleibt stehen)
  const gruppe=s=>{
    const box=el('span',{class:'ks-gruppen',role:'group','aria-label':'Halbgruppe von '+s.vorname+' '+s.name});
    box.append(...['',...GRUPPEN_LABELS].map(g=>el('button',{type:'button',class:'gr-b'+((s.gruppe||'')===g?' an':''),dataset:{gr:g},
      'aria-pressed':String((s.gruppe||'')===g),title:g?'Gruppe '+g:'ohne Gruppe',
      onclick:()=>{ s.gruppe=g||undefined; stammMutiert(); speichern();
        box.querySelectorAll('.gr-b').forEach(x=>{ const an=x.dataset.gr===(s.gruppe||''); x.classList.toggle('an',an); x.setAttribute('aria-pressed',String(an)); }); }},g||'—')));
    return box;
  };
  const zeile=s=>el('div',{class:'ks-zeile',dataset:{nr:String(s.nr)}},
    el('span',{class:'ks-name'},el('span',{},s.vorname+' '+s.name),s.lb?el('span',{class:'lb-badge'},'LB'):null,el('small',{class:'u-leise'},'Nr '+listenNr(s))),
    gruppe(s),
    el('button',{type:'button',class:'btn still ks-stift',dataset:{ksBearbeiten:String(s.nr)},title:'Bearbeiten','aria-label':'Bearbeiten · '+s.vorname+' '+s.name,onclick:()=>griffe.bearbeite(s)},iconEl('notiz')));
  // Hinzufügen: hat der Kurs Halbgruppen, fragt der Dialog gleich nach der Gruppe (sonst fehlt das Kind in jeder Gruppenstunde)
  const hinzufuegen=()=>{
    const naechsteListe=Math.max(0,...alle.map(lnr).filter(n=>n!=null))+1;   // 3A (Zero 05.10.): unten anhängen, Lücken bleiben frei
    const auseinander=naechsteListe!==neueAusweisNr(alle,vault.events.filter(e=>e.kursId===k.id),k.ausweisBis||0);   // Prüfer R3
    const vnIn=el('input',{type:'text',placeholder:'Vorname',class:'u-w130'}), nnIn=el('input',{type:'text',placeholder:'Nachname',class:'u-w130'});
    const lbIn=el('input',{type:'checkbox',class:'u-check'});
    const gruppen=[...new Set(alle.map(s=>s.gruppe).filter(Boolean))].sort();
    const grIn=gruppen.length?el('select',{dataset:{ksGruppe:''}},el('option',{value:''},'ohne'),...gruppen.map(g=>el('option',{value:g},g))):null;
    dlgZeigenEl(el('h3',{},'Schüler hinzufügen · '+k.name),
      el('p',{class:'u-hinweis'},naechsteListe<=MAX_SCHUELER?'Das Kind kommt unten an die Liste (Nr '+naechsteListe+'). Trage es in der Mappe in dieselbe Zeile ein.':'Die Liste hat schon '+MAX_SCHUELER+' Zeilen wie die Mappe. Neu nummerieren geht nur über „Mappe laden“ (Kurse → Kurs anlegen).'),
      auseinander&&naechsteListe<=MAX_SCHUELER?el('p',{class:'u-warn13'},iconEl('warnung'),' '+MISCH_WARNUNG):null,
      el('div',{class:'zeile'},el('span',{},'Name'),el('span',{},vnIn,' ',nnIn)),
      el('label',{class:'zeile'},el('span',{},'LB (zieldifferent)'),lbIn),
      ...(grIn?[el('div',{class:'zeile'},el('span',{},'Halbgruppe'),grIn)]:[]),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn',dataset:{ksHinzu:''},onclick:()=>{
          const vorname=vnIn.value.trim(), name=nnIn.value.trim();
          if(!vorname&&!name){ toast('Name fehlt'); return; }
          if(naechsteListe>MAX_SCHUELER){ toast('Keine Zeile mehr frei — die Mappe hat '+MAX_SCHUELER+' Zeilen'); return; }
          const nr=neueAusweisNr(alle,vault.events.filter(e=>e.kursId===k.id),k.ausweisBis||0);   // Ausweis-Nr: nie wiederverwendet, ohne Grenze (WAHL U5, Prüfer R4)
          const list=vault.stamm.schueler[k.id]=vault.stamm.schueler[k.id]||[];
          list.push({nr,...(naechsteListe!==nr?{liste:naechsteListe}:{}),name,vorname,lb:lbIn.checked,...(grIn&&grIn.value?{gruppe:grIn.value}:{})}); list.sort((a,b)=>a.nr-b.nr); k.ausweisBis=Math.max(k.ausweisBis||0,nr);
          stammMutiert(); speichern(); dlgZu(); toast('Hinzugefügt: '+(vorname||name)+' · Nr '+naechsteListe); nochmal(); }},'＋ Hinzufügen'),
        el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
    setTimeout(()=>vnIn.focus(),60);
  };
  const inaktivBlock=inaktive.length?el('details',{class:'ks-inaktiv'},el('summary',{},'Inaktiv ('+inaktive.length+') · Einträge bleiben erhalten'),
    ...inaktive.map(s=>el('div',{class:'zeile'},el('span',{class:'u-leise'},s.vorname+' '+s.name+(lnr(s)!=null?' · Nr '+lnr(s):'')),
      el('button',{type:'button',class:'btn still',dataset:{ksAktivieren:String(s.nr)},onclick:()=>{
        // ohne Listen-Nr (beim Anpassen abgegeben) kommt das Kind unten an die Liste wie „+ Schüler“ (3A) — sonst fehlte es still im Kopierblock (Prüfer Y5)
        let zeile='';
        if(lnr(s)==null){ const n=Math.max(0,...alle.map(lnr).filter(x=>x!=null))+1; if(n>MAX_SCHUELER){ toast('Keine Zeile mehr frei — die Mappe hat '+MAX_SCHUELER+' Zeilen'); return; }
          if(n===s.nr) delete s.liste; else s.liste=n; zeile=' · Nr '+n+' — in der Mappe in diese Zeile eintragen'; }
        const vorher=alle.map(x=>({...x})); s.inaktiv=false;
        if(nrnAuseinander(vorher,[s])) zeile+='. '+MISCH_WARNUNG;   // Prüfer R3
        stammMutiert(); speichern(); toast('Reaktiviert: '+(s.vorname||s.name)+zeile,zeile?(zeile.length>60?9000:6000):undefined); nochmal(); }},iconEl('erneut'),' aktivieren')))):null;
  // Einstellungen: Farbe (der Fach-Standard ist vorbelegt, Zero 2026-08-30), Noten-Spalte der Mappe (MAPPING.md §3), Sek II: Noten-Eingabe
  const tupfer=[el('button',{type:'button',class:'farbtupf auto'+(Number.isFinite(k.farbHue)?'':' an'),title:'Standard des Fachs','aria-pressed':String(!Number.isFinite(k.farbHue)),
    onclick:()=>{ delete k.farbHue; stammMutiert(); speichern(); nochmal(); }},'Fach')];
  for(const h of WAEHLER_HUES){
    const t=el('button',{type:'button',class:'farbtupf'+(k.farbHue===h?' an':''),title:'Farbe '+h+'°','aria-label':'Farbe '+h+'°','aria-pressed':String(k.farbHue===h),
      onclick:()=>{ k.farbHue=h; stammMutiert(); speichern(); nochmal(); }});
    t.style.setProperty('--f',fachFarbe(k.fach,h));
    tupfer.push(t);
  }
  const spalte=el('select',{dataset:{ksSpalte:''},'aria-label':'Noten-Spalte in der Mappe',onchange:e=>{ k.slot=e.target.value; stammMutiert(); speichern(); toast('Noten-Spalte: '+e.target.value); }},
    ...['m1','m2','m3','m4','m5','m6'].map(m=>el('option',(k.slot||'m1')===m?{selected:'selected'}:{},m)));
  const einst=[el('div',{class:'zeile'},el('span',{},'Farbe'),el('span',{class:'farbwahl'},...tupfer)),
    el('div',{class:'zeile'},el('span',{},'Noten-Spalte in der Mappe'),spalte),
    el('p',{class:'u-hinweis ks-erkl'},'Dorthin schreibt die Brücke die Quartalsnote aus der Kladde: m1 ist Spalte J im 1. und Spalte T im 2. Quartal des Halbjahrs (m2 = K/U … m6 = O/Y).')];
  if(k.profil==='sek2'){
    // Bewertungsmodus ändert den semantischen Rahmen aller Vorschläge → Bestätigung statt Still-Speichern (C4)
    const nmSel=el('select',{'aria-label':'Noten-Eingabe',onchange:e=>{
      const wahl=e.target.value;
      if(wahl===(k.notenmodus||'punkte')) return;
      // Direkte Noten (📊/⭐) sind in der alten Einheit gebucht und wären danach unlesbar — darum sperren, solange es welche gibt (Prüfer 2026-09-29)
      const nNoten=wirksameEvents(vault.events).filter(x=>x.kursId===k.id&&x.typ==='note').length;
      if(nNoten){ e.target.value=k.notenmodus||'punkte'; toast('Wechsel nicht möglich: '+nNoten+' direkte Note'+(nNoten>1?'n':'')+' in der alten Einheit — erst stornieren',5000); return; }
      const label=wahl==='drittel'?'Drittelnoten':'Punkte 0–15';
      dlgZeigenEl(
        el('h3',{},'Noten-Eingabe wechseln?'),
        el('p',{class:'u-hinweis'},'Dieser Kurs verwendet künftig '+label+'. Vorschläge und Noteneingaben erscheinen dann in dieser Einheit — bereits erfasste Ereignisse bleiben unverändert.'),
        el('div',{class:'btn-reihe'},
          el('button',{class:'btn',onclick:()=>{ k.notenmodus=wahl; stammMutiert(); speichern(); toast('Sek II: '+label); dlgZu(); nochmal(); }},'Wechseln'),
          el('button',{class:'btn still',onclick:()=>{ dlgZu(); nochmal(); }},'Abbrechen')));
    }},
      el('option',{value:'punkte',...((k.notenmodus||'punkte')==='punkte'?{selected:'selected'}:{})},'Punkte 0–15'),
      el('option',{value:'drittel',...(k.notenmodus==='drittel'?{selected:'selected'}:{})},'Drittelnoten'));
    einst.push(el('div',{class:'zeile'},el('span',{},'Sek II · Noten-Eingabe'),nmSel));
  }
  const band=el('span',{class:'kurs-band'}); faerbe(band,k);
  wrap.replaceChildren(el('div',{class:'ks'},
    el('button',{type:'button',class:'btn still ks-zurueck',dataset:{ksZurueck:''},onclick:()=>{ kursSeiteId=null; mitUebergang(renderKurse); }},'‹ Kurse'),
    el('h2',{class:'ks-titel'},band,k.name+' · '+k.fach),
    el('p',{class:'u-hinweis ks-unter'},profilLabel(k)+' · '+aktive.length+' Schüler'),
    panel('Schüler und Halbgruppen',
      el('p',{class:'u-hinweis'},'Halbgruppe direkt antippen · ✎ für Name, LB und „Aus dem Kurs nehmen“.'),
      el('div',{class:'ks-liste'},...(aktive.length?aktive.map(zeile):[el('p',{class:'u-leise'},'Noch keine Schüler.')])),
      inaktivBlock,
      el('div',{class:'btn-reihe'},el('button',{type:'button',class:'btn still',dataset:{ksNeu:''},onclick:hinzufuegen},'＋ Schüler hinzufügen'))),
    panel('Sitzplan',el('div',{class:'btn-reihe'},
      el('button',{type:'button',class:'btn still',dataset:{ksSitzplan:''},onclick:()=>sitzplanEditor(k.id)},'Sitzplan bearbeiten'),
      el('button',{type:'button',class:'btn still',dataset:{sitzplanPdf:''},'aria-label':'Sitzplan als PDF',onclick:()=>sitzplanPdf(k)},'Als PDF'))),
    panel('Einstellungen',...einst),
    panel('Selten',
      el('div',{class:'btn-reihe'},
        el('button',{type:'button',class:'btn still',onclick:()=>kursDuplizierenDialog(k.id)},'Für ein anderes Fach duplizieren …'),
        el('button',{type:'button',class:'btn still',dataset:{ksSlots:''},onclick:()=>slotsEditor(k.id)},'Stundenplan-Slots …'),
        el('button',{type:'button',class:'btn gefahr',dataset:{ksArchiv:''},onclick:()=>archiviereKurs(k.id)},'Kurs archivieren …')),
      el('p',{class:'u-hinweis'},'Stundenplan-Slots: alte Zeitfenster aus der Zeit vor dem Stundenplan. Die Kladde nimmt sie nur, wenn laut Stundenplan gerade keine Stunde läuft.'))));
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
// Liste AKTUALISIEREN (zwei Nummern, Zero 04./05.10., design/schuelerliste_2026-10-05/WAHL.md 1A · 2A): Die Kladde erkennt die Kinder
// am Namen (logic/teilnehmer.mjs planeAbgleich), fragt Unklares nach und zeigt die ganze neue Liste, wie sie gleich in der Mappe steht.
// Die Wahl oben: „Nummern wie in der Mappe“ (Listen-Nr = Mappenzeile) oder „Bisherige behalten, Neue unten“. Vorwahl nach Herkunft:
// Mappe/kurs.json → anpassen, Einfügen → behalten. Einträge, Sitzplatz und Halbgruppe hängen an der Ausweis-Nr und bleiben beim Kind.
// „Übernehmen“ bleibt gesperrt, solange eine Frage offen ist (wendePlanAn liefert dann null). Nie still ersetzen.
// → Promise<boolean> (true = übernommen), damit der Stapel-Import mehrere Kurse nacheinander abfragen kann.
const LA_MARKE={teil:'Name?',gleich:'gleicher Name',wieder:'wieder da?'};
// Ein Gerät mit älterem Stand kennt nur die Ausweis-Nr und gibt Druck, PDF und „Vorschläge kopieren“ in anderen Zeilen aus (Prüfer R3).
// Gewarnt wird, wo Ausweis- und Listen-Nr neu auseinanderlaufen (nrnAuseinander): Dialog, „+ Schüler“, Aktivieren
const MISCH_WARNUNG='Nutzt du die Kladde auf mehreren Geräten: erst alle auf diesen Stand bringen (einmal mit Netz öffnen). Ein älterer Stand zeigt und kopiert sonst andere Nummern.';
const LA_FRAGE={teil:['Ja, Name geändert','Nein, anderes Kind'],gleich:['Ja, dasselbe Kind','Nein, ein anderes'],wieder:['Ja, wieder da','Nein, ein neues Kind']};
function listenAbgleichDialog(k,neu,herkunft){
  return new Promise(resRoh=>{
    const res=aufloesenBeiClose(resRoh,false);   // X/Escape = Abbrechen
    const alt=vault.stamm.schueler[k.id]||[];
    const kursEv=vault.events.filter(e=>e.kursId===k.id);
    const hatEv=nr=>kursEv.some(e=>e.schuelerNr===nr&&e.typ!=='storno');
    let modus=herkunft==='einfuegen'?'behalten':'anpassen';
    const antworten={};
    if(planeAbgleich(alt,neu,'anpassen').unveraendert){   // „anpassen“ sieht jede Änderung, auch eine neue Reihenfolge (Prüfer G5)
      toast(k.name+': Liste unverändert ('+kursSchueler(k).length+' Schüler)'); res(false); return; }
    const name=r=>((r.vorname||'')+' '+(r.name||'')).trim();
    const aufzaehlen=t=>t.length>1?t.slice(0,-1).join(', ')+' und '+t[t.length-1]:t[0]||'';
    const seg=el('div',{class:'la-seg seg',role:'group','aria-label':'Nummern'});
    const segText=el('p',{class:'u-hinweis la-segtext'});
    const liste=el('div',{class:'u-scroll58 la-liste'});
    const unten=el('div',{class:'la-unten'});
    const fokus=sel=>{ const b=$('dlg').querySelector(sel); if(b) b.focus(); };   // neu gezeichnet: der Fokus bleibt auf dem gewählten Knopf
    const zeichne=()=>{
      const plan=planeAbgleich(alt,neu,modus,antworten), oben=liste.scrollTop;
      seg.replaceChildren(...[['anpassen','Nummern wie in der Mappe'],['behalten','Bisherige behalten, Neue unten']].map(([m,t])=>
        el('button',{type:'button',class:'btn'+(modus===m?'':' still'),'aria-pressed':String(modus===m),dataset:{laModus:m},onclick:()=>{ if(modus!==m){ modus=m; zeichne(); fokus('[data-la-modus="'+m+'"]'); } }},t)));
      const neue=plan.zeilen.filter(z=>!z.kind);
      segText.textContent=modus==='anpassen'
        ?'Für eine Mappe ohne Noten (Schuljahresanfang): Die Kladde übernimmt die Nummern der Mappe. '+(plan.geaendert===0?'Keine Nummer ändert sich.':plan.geaendert===1?'Ein Kind bekommt eine andere Nummer.':plan.geaendert+' Kinder bekommen eine andere Nummer.')
        :'Für eine Mappe, die schon Noten trägt: Alle behalten ihre Nummer'+(neue.length
          ?', '+(neue.length>3?neue.length+' Neue':aufzaehlen(neue.map(z=>name(z.zeile))))+' '+(neue.length===1?'kommt':'kommen')+' unten an (Nr '+aufzaehlen(neue.map(z=>String(z.neu)))+'). Trage '+(neue.length===1?'es':'sie')+' in der Mappe genauso ein.'
          :'.');
      // Rückfrage (Zero 03.10., A→K): bleibt nach der Antwort sichtbar und änderbar; die gewählte Antwort leuchtet
      // je Paar aus Kind und Mappenzeile eine Frage (Prüfer 05.10. R1): Teiltreffer (A→K), gleicher Name mehrmals (R2), Abgang kommt wieder (Y2)
      const frageText=f=>f.art==='gleich'?'Bisher „'+name(f.kind)+'“ mit Nr '+(lnr(f.kind)??'–')+' — dasselbe Kind? Den Namen gibt es mehrmals.'
        :f.art==='wieder'?'Bisher „'+name(f.kind)+'“, nicht mehr im Kurs — wieder dasselbe Kind?':'Bisher „'+name(f.kind)+'“ — dasselbe Kind?';
      const frageEl=f=>el('div',{class:'la-frage'},
        el('span',{class:'la-klein'},frageText(f)),
        el('span',{class:'la-wahl'},...[[true,LA_FRAGE[f.art][0]],[false,LA_FRAGE[f.art][1]]].map(([a,t])=>
          el('button',{type:'button',class:'btn'+(f.antwort===a?'':' still'),'aria-pressed':String(f.antwort===a),dataset:{laFrage:f.id,laAntwort:String(a)},
            onclick:()=>{ antworten[f.id]=a; zeichne(); fokus('[data-la-frage="'+f.id+'"][data-la-antwort="'+a+'"]'); }},t))));
      const zeileEl=(nr,r,marke,f,klasse='')=>el('div',{class:'la-zeile'+klasse},el('span',{class:'la-nr'},nr==null?'–':String(nr)),el('span',{class:'la-name'},name(r)),
        marke?el('span',{class:'la-marke'+(marke[1]||'')},marke[0]):null,f?frageEl(f):null);
      const frageZu=z=>{ const an=plan.fragen.filter(f=>f.zeile===z.zeile); return an.find(f=>f.antwort===true)||an.filter(f=>f.antwort===false).pop(); };   // die gültige Antwort zeigen
      const zeilen=[
        ...plan.zeilen.map(z=>{ const f=frageZu(z);
          const marke=f&&f.antwort!==false?[LA_MARKE[f.art],' la-warn']:!z.kind?['neu',' la-neu']
            :[z.art==='reaktiviert'?'wieder da':null,z.alt!==z.neu&&z.alt!=null?'bisher '+z.alt:null,!!z.kind.lb!==!!z.zeile.lb?(z.zeile.lb?'LB':'LB weg'):null].filter(Boolean).join(' · ');
          return {nr:z.neu,el:zeileEl(z.neu,z.zeile,typeof marke==='string'?(marke?[marke]:null):marke,f,!z.kind?' la-ist-neu':'')}; }),
        // offene Fragen stehen an ihrer Stelle (planeAbgleich: Mappenzeile bzw. bisherige Nr), bis sie beantwortet sind
        ...plan.fragen.filter(f=>f.antwort===undefined).map(f=>({nr:f.stelle,el:zeileEl(f.stelle,f.zeile,[LA_MARKE[f.art],' la-warn'],f,' la-ist-frage')}))
      ].sort((a,b)=>(a.nr??Infinity)-(b.nr??Infinity));
      const mitEv=plan.weg.filter(w=>hatEv(w.kind.nr)), ohneEv=plan.weg.filter(w=>!hatEv(w.kind.nr));
      liste.replaceChildren(...zeilen.map(z=>z.el),
        ...(plan.weg.length+plan.sonstige.length?[el('div',{class:'tag-kopf'},'Nicht mehr in der Mappe ('+(plan.weg.length+plan.sonstige.length)+')'),
          // die Nr wird nur abgegeben, wenn jetzt ein anderes Kind ihre Zeile trägt — sonst bleibt sie als Lücke (Prüfer Y4)
          ...plan.weg.map(w=>zeileEl(w.neu==null?null:w.alt,w.kind,[w.alt==null?'ohne Nr':w.neu==null?'gibt Nr '+w.alt+' ab':'Nr '+w.alt+' bleibt frei'],null,' la-ist-weg')),
          ...plan.sonstige.map(o=>zeileEl(null,o.kind,['schon inaktiv · gibt Nr '+o.alt+' ab'],null,' la-ist-weg')),
          mitEv.length?el('p',{class:'u-hinweis'},(mitEv.length===1?'Hat Einträge: wird deaktiviert':'Haben Einträge: werden deaktiviert')+', die Einträge bleiben erhalten'+(ohneEv.length?' ('+aufzaehlen(mitEv.map(w=>name(w.kind)))+')':'')+'.'):null,
          ohneEv.length?el('p',{class:'u-hinweis'},'Ohne Einträge, '+(ohneEv.length===1?'wird':'werden')+' entfernt: '+aufzaehlen(ohneEv.map(w=>name(w.kind)))+'.'):null]:[]).filter(Boolean));
      liste.scrollTop=oben;
      const gesperrt=plan.offen>0||plan.fehler.length>0;
      // Mischbetrieb (Prüfer R3): am Ergebnis gemessen, in beiden Modi; solange Fragen offen sind, gibt es kein Ergebnis
      const probe=gesperrt?null:wendePlanAn(alt,plan,hatEv,kursEv,k.ausweisBis||0);
      const auseinander=probe?nrnAuseinander(alt,probe):modus==='anpassen'&&plan.geaendert>0;
      unten.replaceChildren(...[
        ...plan.fehler.map(t=>el('p',{class:'u-warn13'},iconEl('warnung'),' '+t)),
        modus==='anpassen'&&plan.geaendert>0?el('p',{class:'u-warn13'},iconEl('warnung'),' Stehen in der Mappe schon Noten oder KA-Punkte, hängen sie dort jetzt an anderen Zeilen. Dann „Bisherige behalten“ wählen.'):null,
        auseinander?el('p',{class:'u-warn13'},iconEl('warnung'),' '+MISCH_WARNUNG):null,
        el('div',{class:'btn-reihe'},
          el('button',{class:'btn',dataset:{laUebernehmen:''},disabled:gesperrt?'':null,onclick:uebernehmen},'Übernehmen'),
          el('button',{class:'btn still',onclick:()=>{ dlgZu(); res(false); }},'Abbrechen')),
        plan.offen?el('p',{class:'u-hinweis'},'„Übernehmen“ geht, sobald '+(plan.offen===1?'die Frage':'die Fragen')+' oben beantwortet '+(plan.offen===1?'ist':'sind')+'.'):null
      ].filter(Boolean));
    };
    const uebernehmen=()=>{
      if(!vault) return;
      const plan=planeAbgleich(alt,neu,modus,antworten);
      const neuListe=wendePlanAn(alt,plan,hatEv,kursEv,k.ausweisBis||0);
      if(!neuListe) return;   // offene Frage oder Fehler: nie halb übernehmen
      vault.stamm.schueler[k.id]=neuListe;
      k.ausweisBis=Math.max(k.ausweisBis||0,...alt.map(s=>s.nr),...neuListe.map(s=>s.nr));   // Höchstmarke: keine dieser Nrn wird je neu vergeben (Prüfer R4)
      if(vault.stamm.sitzplaene[k.id]) for(const w of plan.weg) vault.stamm.sitzplaene[k.id]=vomPlatz(vault.stamm.sitzplaene[k.id],w.kind.nr);   // der Platz bleibt als leerer Tisch
      stammMutiert(); speichern(); dlgZu(); res(true);
    };
    dlgZeigenEl(el('h3',{},'Liste aktualisieren · '+k.name),
      el('p',{class:'u-hinweis'},'Die Kladde erkennt die Kinder am Namen. Einträge, Sitzplatz und Halbgruppe bleiben bei jedem Kind, auch wenn sich seine Nummer ändert.'),
      seg,segText,liste,unten);
    zeichne();
  });
}
// Teilnehmer nachträglich pflegen — hinzufügen/deaktivieren/reaktivieren (Zero 2026-07-09 · Tombstone-P0 2026-07-10).
// Eine Ausweis-Nr wird NIE an ein anderes Kind vergeben: Deaktivierte bleiben mit inaktiv:true im Stamm (Events bleiben gebunden,
// Reaktivieren möglich). Ihre Listen-Nr bleibt frei, bis „Liste aktualisieren“ die Zeile einem anderen Kind gibt (Prüfer Y4).
// Neue Kinder hängt die Kurs-Seite unten an (3A, Zero 05.10.).
// Fokus-sicher: neu gerendert wird NUR bei Submit/Aktion, nie beim Tippen (Stundenplan-Lehre).
// Seit Scheibe 4 (02.10.) die Griffe der Kurs-Seite statt eines eigenen Dialogs: `zeige` zeichnet danach neu und ist „Abbrechen“.
function teilnehmerGriffe(k,zeige){
  const alle=()=>vault.stamm.schueler[k.id]||[];
  const raeumeSitzplatz=(nr)=>{ if(vault.stamm.sitzplaene[k.id]) vault.stamm.sitzplaene[k.id]=vomPlatz(vault.stamm.sitzplaene[k.id],nr); };   // der Platz bleibt als leerer Tisch
  const deaktiviere=(s)=>{
    const hatEv=vault.events.some(e=>e.kursId===k.id&&e.schuelerNr===s.nr&&e.typ!=='storno');
    if(!hatEv){
      // Ohne Einträge ist echtes Entfernen gefahrlos (kein Erbe möglich) — der Tippfehler-Weg. Die Nummern der anderen bleiben:
      // umnummeriert wird nur über „Liste aktualisieren“ (Zero 05.10., 3A), sonst liefen Kladde und Mappe auseinander.
      dlgZeigenEl(
        el('h3',{},'Entfernen?'),
        el('p',{class:'u-hinweis'},s.vorname+' '+s.name+' hat noch keine Einträge und wird vollständig entfernt.'),
        el('p',{class:'u-hinweis'},lnr(s)!=null?'Nr '+lnr(s)+' bleibt frei. In der Mappe in dieser Zeile Name und Vorname leeren.':'Die anderen Nummern bleiben.'),
        el('div',{class:'btn-reihe'},
          el('button',{class:'btn gefahr',onclick:()=>{
            k.ausweisBis=Math.max(k.ausweisBis||0,...alle().map(x=>x.nr));   // Höchstmarke: die Nr kommt nie wieder (Prüfer R4)
            vault.stamm.schueler[k.id]=alle().filter(x=>x.nr!==s.nr);
            raeumeSitzplatz(s.nr);
            stammMutiert(); speichern(); toast('Entfernt: '+(s.vorname||s.name)); zeige();
          }},'Entfernen'),
          el('button',{class:'btn still',onclick:zeige},'Abbrechen')));
      return;
    }
    dlgZeigenEl(
      el('h3',{},'Deaktivieren?'),
      el('p',{class:'u-hinweis'},s.vorname+' '+s.name+' aus allen Listen und dem Sitzplan nehmen? Die Einträge bleiben erhalten.'+(lnr(s)!=null?' Nr '+lnr(s)+' bleibt frei, bis die Mappe die Zeile einem anderen Kind gibt.':'')+' Reaktivieren ist jederzeit möglich.'),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn gefahr',onclick:()=>{
          s.inaktiv=true;
          raeumeSitzplatz(s.nr);
          stammMutiert(); speichern(); toast('Deaktiviert: '+(s.vorname||s.name)); zeige();
        }},'Deaktivieren'),
        el('button',{class:'btn still',onclick:zeige},'Abbrechen')));
  };
  // Namenskorrektur (Zero 2026-08-30): Einträge, Sitzplatz und Halbgruppe hängen an der Ausweis-Nr, ein neuer Name ändert
  // daran nichts. „Liste aktualisieren“ ordnet aber über den Namen zu (MAPPING §1, `planeAbgleich`), und die Brücke prüft den
  // Namen je Zeile: die Mappe gleich mitkorrigieren. Fokus-sicher wie der Stundenplan: kein oninput, neu gerendert wird erst bei Speichern.
  const bearbeite=(s)=>{
    const vnIn=el('input',{type:'text',value:s.vorname||'',placeholder:'Vorname',class:'u-w130'});
    const nnIn=el('input',{type:'text',value:s.name||'',placeholder:'Nachname',class:'u-w130'});
    const lbIn=el('input',{type:'checkbox',class:'u-check',...(s.lb?{checked:'checked'}:{})});
    dlgZeigenEl(
      el('h3',{},'Bearbeiten · Nr '+listenNr(s)),
      el('p',{class:'u-hinweis'},'Einträge und Sitzplatz bleiben beim Kind, auch wenn sich seine Nr ändert.'),
      // Nachprüfung 2 P7: nur hier umbenannt, hielte „Liste aktualisieren“ das Kind für gegangen und seine Zeile für ein neues Kind
      el('p',{class:'u-hinweis'},'Einen neuen Namen auch in der Mappe eintragen: Beim Aktualisieren der Liste erkennt die Kladde die Kinder am Namen.'),
      el('div',{class:'zeile'},el('span',{},'Name'),el('span',{},vnIn,' ',nnIn)),
      el('label',{class:'zeile'},el('span',{},'LB (zieldifferent)'),lbIn),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn',onclick:()=>{
          const vorname=vnIn.value.trim(), name=nnIn.value.trim();
          if(!vorname&&!name){ toast('Name fehlt'); return; }
          s.vorname=vorname; s.name=name; s.lb=lbIn.checked;
          stammMutiert(); speichern(); toast('Geändert: '+(vorname||name)); zeige();
        }},'Speichern'),
        el('button',{class:'btn gefahr',dataset:{ksWeg:''},onclick:()=>deaktiviere(s)},'Aus dem Kurs nehmen …'),
        el('button',{class:'btn still',onclick:zeige},'Abbrechen')));
  };
  return {alle,deaktiviere,bearbeite};
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
      el('p',{},'Bevor du das neue Schuljahr startest, sichere die aktuelle Kladde. „Weiter" wird erst nach einer Sicherung frei.'),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn',onclick:async()=>{ await exportiereContainerJetzt(); s1(); }},exportInSitzung?'✓ gesichert — nochmal':'Sicherung speichern'),
        el('button',{class:'btn'+(exportInSitzung?'':' still'),onclick:()=>{ if(!exportInSitzung){ toast('Bitte zuerst sichern'); return; } schritt=2; s2(); }},'Weiter'),
        el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
  }
  function s2(){ // Altes Jahr
    dlgZeigenEl(kopf('Altes Jahr'),
      el('p',{},alt.label+' wird archiviert (schreibgeschützt erhalten). Du findest es unter „Archiv".'),
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
        el('div',{class:'zeile'},el('span',{},nehmen,' ',k.name+' · '+k.fach),el('span',{},'→ ',nameIn)),
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
// Erster Kurs eines Wochenplan-Blocks (fuer die Faerbung der Zelle im Assistenten; der A/B-Filter der alten Ansicht ist mit ihr gegangen)
function wochenplanZellKurs(plan,wt,nr){
  const s=plan.find(p=>p.wochentag===wt&&p.blockNr===nr);
  return s?(vault.stamm.kurse.find(x=>x.id===s.kursId)||null):null;
}
// Slot-Art eines Blocks (klasse/reserve) oder null — für die gestrichelte Zell-Optik
function wochenplanZellArt(plan,wt,nr){ const s=plan.find(p=>p.wochentag===wt&&p.blockNr===nr&&p.art); return s?s.art:null; }
const slotArtLabel=s=>(s&&s.art&&SLOT_ARTEN[s.art])?SLOT_ARTEN[s.art].label:'';
// Endgültiges Löschen — NUR im Archiv, doppelt bestätigt (Kursname abtippen), Zwangs-Export vorher
function loescheKursEndgueltig(id){
  const k=vault.stamm.kurse.find(x=>x.id===id); if(!k) return;
  dlgZeigen('<h3>Endgültig löschen</h3><p class="u-warn13">Unwiderruflich: Kurs, Schülerliste, Sitzplan und ALLE Ereignisse werden entfernt.</p>'+
    '<p class="u-hinweis">Sichere vorher (falls noch nicht geschehen). Zum Bestätigen den Kursnamen „'+esc(k.name)+'" eintippen:</p>'+
    '<input type="text" id="del-confirm" autocomplete="off" class="u-w170">'+
    '<div class="btn-reihe"><button class="btn still" id="del-export">Erst sichern</button><button class="btn gefahr" id="del-ok" disabled>Löschen</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
    el=>{
      el.querySelector('#del-confirm').oninput=e=>{ el.querySelector('#del-ok').disabled=e.target.value.trim()!==k.name; };
      el.querySelector('#del-export').onclick=()=>{ dlgZu(); exportiereContainer(); };
      el.querySelector('#del-ok').onclick=()=>{
        // Lösch-Markierung: sonst holt der nächste Import vom zweiten Gerät Kurs und Einträge zurück (logic/merge)
        vault.stamm.geloescht={...(vault.stamm.geloescht||{}),[id]:{am:new Date().toISOString()}};
        // Auch die beigelegten verworfenen Stände (bis zu drei ganze Stammdaten-Kopien) tragen Namen und Liste
        for(const st of vault.verworfeneStaende||[]){
          st.kurse=(st.kurse||[]).filter(x=>x.id!==id);
          for(const feld of ['schueler','sitzplaene','kursprofile']) if(st[feld]) delete st[feld][id];
          if(Array.isArray(st.wochenplan)) st.wochenplan=st.wochenplan.filter(w=>w.kursId!==id);
        }
        vault.stamm.kurse=vault.stamm.kurse.filter(x=>x.id!==id);
        delete vault.stamm.schueler[id]; delete vault.stamm.sitzplaene[id]; delete vault.stamm.kursprofile[id];
        vault.stamm.wochenplan=(vault.stamm.wochenplan||[]).filter(w=>w.kursId!==id);
        vault.events=vault.events.filter(e=>e.kursId!==id);
        stammMutiert(); speichern(); dlgZu(); renderKurse(); toast('Endgültig gelöscht: '+k.name);
      };
    });
}
// Sitzplan als PDF (Zero 2026-10-02, Variante P2 + Klarstellung: „die Sitzuordnung soll abgebildet sein - nur in der Spalte mit namen
// brauche ich die sitzplatznummer usw. nicht“): der Plan wie im Unterricht, Tafel unten, leere Tische gestrichelt; rechts die Schülerliste nach Nr
// mit Schülernummer. Die Kladde zeichnet auf eine Zeichenfläche (A4 quer, 200 dpi) und schreibt die PDF selbst (logic/pdfbild.mjs).
// LB-Schüler tragen ein dezentes ◆ in Kachel und Liste, unten „◆ = LB“ (Zero 02.10. abends, Frage-Dialog: „Dezentes Zeichen ◆“).
// Die Nr steht auch klein in der Kachel — sie verbindet Plan und Liste.
function sitzplanPdfZeichnen(k){
  const B=2339, H=1654, cv=document.createElement('canvas'); cv.width=B; cv.height=H;
  const g=cv.getContext('2d'), schrift=getComputedStyle(document.body).fontFamily||'system-ui, sans-serif';
  const a=druckAnordnung(vault.stamm.sitzplaene[k.id]||{},kursSchueler(k));
  const font=(px,gew=400)=>{ g.font=gew+' '+Math.round(px)+'px '+schrift; };
  const passe=(t,max)=>{ if(g.measureText(t).width<=max) return t; let s=t; while(s.length>1&&g.measureText(s+'…').width>max) s=s.slice(0,-1); return s+'…'; };
  const text=(t,x,y,farbe,ausr='left')=>{ g.fillStyle=farbe; g.textAlign=ausr; g.fillText(t,x,y); };
  const RAND=90, TINTE='#1d1a16', LEISE='#6b645a', LINIE='#2a2622', HAAR='#d9d3c7';
  g.fillStyle='#fff'; g.fillRect(0,0,B,H); g.textBaseline='alphabetic';
  // Kopf: Kurs, „Sitzplan“, Stand
  const titel=k.name+' · '+k.fach; font(56,700); text(titel,RAND,RAND+50,TINTE);
  const tb=g.measureText(titel).width; font(30); text('Sitzplan',RAND+tb+28,RAND+50,LEISE);
  text('Stand '+datumLabel(heuteIso())+heuteIso().slice(0,4),B-RAND,RAND+50,LEISE,'right');
  g.strokeStyle=LINIE; g.lineWidth=3; g.beginPath(); g.moveTo(RAND,RAND+76); g.lineTo(B-RAND,RAND+76); g.stroke();
  // Plan links, Tafel darunter
  const LB_LISTE=600, planY=RAND+120, planB=B-2*RAND-LB_LISTE-70, planH=H-planY-RAND-120, LU=22;
  const nC=Math.max(1,a.bisC-a.vonC+1), nR=Math.max(1,a.reihen.length);
  const ka=Math.min(320,(planB-(nC-1)*LU)/nC,(planH-(nR-1)*LU)/nR), breite=nC*ka+(nC-1)*LU, x0=RAND+(planB-breite)/2;
  const zeileVon=new Map(a.reihen.map((r,i)=>[r,i]));
  for(const p of a.plaetze){ const i=zeileVon.get(p.r); if(i==null) continue;
    const x=x0+(p.c-a.vonC)*(ka+LU), y=planY+i*(ka+LU);
    g.beginPath(); g.roundRect(x,y,ka,ka,14); g.lineWidth=3;
    if(p.art==='tisch'){ g.setLineDash([14,10]); g.strokeStyle=LEISE; g.stroke(); g.setLineDash([]); font(ka*.12); text('frei',x+ka/2,y+ka/2+ka*.04,LEISE,'center'); continue; }
    g.strokeStyle=LINIE; g.stroke();
    font(ka*.17,700); text(passe(p.vorname,ka-28),x+14,y+ka*.42,TINTE);
    font(ka*.13); text(passe(p.name,ka-28),x+14,y+ka*.42+ka*.18,LEISE);
    font(ka*.11); text(String(p.nr),x+ka-14,y+ka-16,LEISE,'right');
    if(p.lb){ font(ka*.12); text('◆',x+ka-14,y+ka*.2,LEISE,'right'); }
  }
  const tafY=planY+nR*ka+(nR-1)*LU+44, tafB=Math.min(breite,900);
  g.beginPath(); g.roundRect(x0+(breite-tafB)/2,tafY,tafB,60,10); g.strokeStyle=LINIE; g.lineWidth=3; g.stroke();
  font(26,600); text('T A F E L',x0+breite/2,tafY+40,TINTE,'center');
  // Schülerliste nach Schülernummer (Zero 03.10.: „Sollte nach Schülernummer sortiert sein“ — die Schule führt ein Kind nach einer Namensänderung weiter auf seiner Nr) — ohne Reihe und Platz
  const lx=B-RAND-LB_LISTE; font(34,700); text('Schülerliste',lx,planY+30,TINTE);
  const zh=Math.min(46,(H-RAND-planY-70)/Math.max(1,a.liste.length)); let y=planY+70;
  font(zh*.42,600); text('Nr.',lx+60,y,LEISE,'right'); text('Name',lx+84,y,LEISE);
  for(const x of a.liste){ y+=zh; font(zh*.56); text(String(x.nr),lx+60,y,LEISE,'right');
    text(passe(x.name+', '+x.vorname+(x.gruppe?' · Gr. '+x.gruppe:''),LB_LISTE-90-(x.lb?zh*.7:0)),lx+84,y,TINTE);
    if(x.lb) text('◆',lx+LB_LISTE,y,LEISE,'right');
    g.strokeStyle=HAAR; g.lineWidth=1.5; g.beginPath(); g.moveTo(lx,y+zh*.32); g.lineTo(lx+LB_LISTE,y+zh*.32); g.stroke(); }
  font(20); text('Kladde · Sitzplan',RAND,H-40,LEISE);
  if(a.liste.some(x=>x.lb)) text('◆ = LB',B-RAND,H-40,LEISE,'right');   // Legende nur, wenn jemand das Zeichen trägt
  return cv;
}
// Speichern wie die Urkunde (Muster urkundeSpeichern, Skill werkstatt-web-2026): alles synchron bis zum Teilen, damit die Geste trägt.
// iPad/iPhone: Teilen-Blatt („In Dateien sichern“, Drucken); geht das nicht, das Bild zum langen Drücken (kein Vollbild-Hänger).
// Sonst ein echter Download (Android teilte sonst, statt zu speichern).
function sitzplanPdf(k){
  const cv=sitzplanPdfZeichnen(k), url=cv.toDataURL('image/jpeg',.9);
  const name=('Sitzplan '+k.name+' '+k.fach).replace(/[\\/:*?"<>|]/g,'-')+'.pdf';
  const datei=new File([pdfAusJpeg(jpegAusDataUrl(url),cv.width,cv.height,{titel:'Sitzplan '+k.name+' · '+k.fach})],name,{type:'application/pdf'});
  const ua=navigator.userAgent||'', apple=/\b(iPhone|iPod|iPad)\b/.test(ua)||(/\bMacintosh\b/.test(ua)&&(navigator.maxTouchPoints||0)>1);
  let teilbar=false; try{ teilbar=!!(navigator.canShare&&navigator.canShare({files:[datei]})); }catch{}
  const bild=()=>dlgZeigenEl(el('h3',{},'Sitzplan sichern'),el('p',{class:'u-hinweis'},'Lange auf das Bild drücken und „Zu Fotos hinzufügen“ oder „Bild sichern“ wählen.'),
    el('img',{class:'sp-pdf-bild',src:url,alt:'Sitzplan '+k.name}),el('div',{class:'btn-reihe'},el('button',{type:'button',class:'btn still',onclick:dlgZu},'Fertig')));
  if(apple){
    if(!teilbar||!navigator.share){ bild(); return; }
    navigator.share({files:[datei],title:'Sitzplan '+k.name}).then(()=>toast('Sitzplan übergeben')).catch(err=>{ if(err&&err.name==='AbortError') return; bild(); });
    return;
  }
  const href=URL.createObjectURL(datei), a2=document.createElement('a'); a2.href=href; a2.download=name; a2.rel='noopener';
  document.body.appendChild(a2); a2.click(); a2.remove(); setTimeout(()=>URL.revokeObjectURL(href),10000);
  toast('Sitzplan gespeichert: '+name);
}
let editorCleanup=null; // Aufräumen des Sitzplan-Editors (auch aus sperren() erreichbar)
function sitzplanEditor(kursId){
  if(editorCleanup){ try{ editorCleanup(); }catch{} }
  kursWechseln(kursId);   // wie jeder Kurswechsel: ein Nachtrag endet, die Gruppe des alten Kurses fällt weg (Prüfer 03.10. B6)
  aktView='heute';
  document.querySelectorAll('#hauptnav button').forEach(x=>x.classList.toggle('aktiv',x.dataset.view==='heute')); setzeViewTitel('heute');
  ['heute','deck','schueler','kurse','mehr'].forEach(v=>$('view-'+v).classList.toggle('hidden',v!=='heute'));
  editorAktiv=true;
  document.body.classList.add('sp-edit');
  // Vorne bleibt vorne: hinten so viele leere Reihen auffüllen, dass mindestens 6 zu sehen sind und die letzte belegte Reihe direkt
  // über der Tafel steht. Nur die Zählung rückt (keine negativen Reihen), „Fertig“ kompaktiert wieder ab 0 (logic/sitzplan.mjs vorlauf).
  { const s0=vault.stamm.sitzplaene[kursId], br=s0?spBelegteReihen(s0):[], maxR=br.length?br[br.length-1]:-1;
    if(maxR>=0&&maxR<5) vault.stamm.sitzplaene[kursId]=vorlauf(s0,5-maxR); }
  renderHeute();
  // Fokus horizontal mittig (Zero 02.10.): am Handy ist das Raster breiter als der Schirm und stand sonst am linken Rand
  const wrap=$('plan-wrap'); wrap.scrollLeft=Math.max(0,(wrap.scrollWidth-wrap.clientWidth)/2);
  const plan=$('plan');
  const k=kurs();
  const sp=()=>(vault.stamm.sitzplaene[k.id]=vault.stamm.sitzplaene[k.id]||{grid:{}});
  const keyOf=kachel=>kachel.dataset.r+','+kachel.dataset.c;  // explizite Reihe,Platz — Ghost-Zeilen-Layout (nicht mehr DOM-Index)

  // ── Liste „Ohne Platz“ (Zero 02.10. abends): A–Z nach Nachname, am iPad als Spalte rechts statt der Stempel-Leiste, am Handy unter
  // der Tafel (CSS). Einen Namen antippen macht ihn scharf, ein leerer Platz oder Tisch angetippt setzt ihn, dann ist der nächste scharf;
  // ziehen geht weiter („Weiter auch ziehen können“). Der Hinweis steht hier statt als Toast über der Liste.
  const rail=el('div',{class:'sp-rail'});
  const ohneKopf=el('div',{class:'sp-ohne-kopf'});
  const ohne=el('section',{class:'sp-ohne','aria-label':'Ohne Platz'},ohneKopf,
    el('p',{class:'sp-ohne-hinweis'},'Namen antippen, dann einen Platz · oder halten und ziehen. Im Raster verschiebt oder tauscht Ziehen, der Mülleimer nimmt vom Platz, „Tisch“ setzt leere Tische.'),rail);
  document.querySelector('#view-heute .heute-grid').append(ohne);
  // ── Editor-Leiste: Tisch · Mülleimer · Fertig ──
  const trash=el('div',{class:'sp-trash',title:'Zum Entfernen hierher ziehen'},iconEl('papierkorb'));
  // Stempel „Tisch“ (Zero 2026-10-02, Variante A): scharf setzt Antippen oder Wischen leere Tische, ein Tipp auf einen Tisch nimmt ihn weg —
  // der erste Platz eines Strichs entscheidet, ob der Strich setzt oder wegnimmt. Schüler ziehen geht erst wieder ohne Stempel.
  let tischScharf=false, wisch=null, scharf=null;   // scharf: Nr des Namens, den der nächste Tipp auf einen Platz setzt
  const tischBtn=el('button',{type:'button',class:'btn still sp-tisch','aria-pressed':'false','aria-label':'Tisch-Stempel',title:'Tisch-Stempel: Plätze antippen oder wischen setzt leere Tische, einen Tisch antippen nimmt ihn weg',
    onclick:()=>{ tischScharf=!tischScharf; tischBtn.setAttribute('aria-pressed',String(tischScharf)); document.body.classList.toggle('sp-tisch-scharf',tischScharf);
      if(tischScharf&&scharf!=null){ scharf=null; renderRail(); } }},el('span',{class:'sp-tisch-ico','aria-hidden':'true'}),el('span',{class:'sp-tisch-text'},'Tisch'));
  const bar=el('div',{id:'sp-editor-bar',class:'sp-editor-bar'},tischBtn,trash,el('button',{class:'btn',onclick:()=>beenden()},'Fertig'));
  document.body.appendChild(bar);
  // Am iPad scrollt die Liste in sich und endet über der Leiste, auch wenn ein Banner die Seite nach unten schiebt (Prüfer 03.10. G2)
  const BREIT=matchMedia('(min-width: 721px)');
  const passeListe=()=>{ ohne.style.maxHeight=BREIT.matches?Math.max(160,Math.floor(bar.getBoundingClientRect().top-ohne.getBoundingClientRect().top-8))+'px':''; };
  passeListe(); addEventListener('resize',passeListe);
  const ohnePlatzAZ=()=>{ const vergeben=new Set(Object.values(sp().grid));
    return kursSchueler(k).filter(s=>!vergeben.has(s.nr)).sort((a,b)=>String(a.name).localeCompare(String(b.name),'de')||String(a.vorname).localeCompare(String(b.vorname),'de')); };
  function renderRail(){
    const frei=ohnePlatzAZ();
    if(scharf!=null&&!frei.some(s=>s.nr===scharf)) scharf=null;
    ohneKopf.replaceChildren(el('b',{},'Ohne Platz'),...(frei.length?[el('span',{},String(frei.length))]:[]));
    rail.replaceChildren(...(frei.length
      ? frei.map(s=>el('div',{class:'sp-chip'+(s.nr===scharf?' an':''),role:'button',tabindex:'0','aria-pressed':String(s.nr===scharf),dataset:{nr:String(s.nr)}},
          el('b',{},s.vorname),el('small',{},s.name)))
      : [el('span',{class:'u-hinweis'},'Alle haben einen Platz ✓')]));
  }
  const schaerfen=nr=>{ scharf=scharf===nr?null:nr;
    if(scharf!=null&&tischScharf){ tischScharf=false; tischBtn.setAttribute('aria-pressed','false'); document.body.classList.remove('sp-tisch-scharf'); }
    renderRail(); };
  const railTaste=e=>{ const c=e.target.closest('.sp-chip'); if(c&&(e.key==='Enter'||e.key===' ')){ e.preventDefault(); schaerfen(Number(c.dataset.nr)); } };
  rail.addEventListener('keydown',railTaste);
  renderRail();

  // ── Pointer-Drag (Touch + Maus; HTML5-DnD ist auf iPad-Safari tot) ──
  const HALTEN_MS=300;   // so lange gehalten, zieht ein Name aus der Liste auch senkrecht (Prüfer 03.10. B5)
  let drag=null, justDragged=false, tipp=null;   // tipp: wo der Finger aufsetzte — Wischen ist kein Antippen (Zero 2026-10-01: iPad öffnete beim Scrollen den Platz-Dialog)
  function zielReset(){ plan.querySelectorAll('.kachel.ziel, .reihe-plus.ziel').forEach(z=>z.classList.remove('ziel')); trash.classList.remove('ziel'); }
  function tischAn(kach){   // ein Platz unter dem Tisch-Stempel; besetzte Plätze bleiben, wie sie sind
    if(!kach||!plan.contains(kach)||!kach.dataset.r) return;
    const key=keyOf(kach); if(wisch.keys.has(key)) return; wisch.keys.add(key);
    if(sp().grid[key]!=null) return;
    if(wisch.an===null) wisch.an=!(sp().tische||[]).includes(key);
    vault.stamm.sitzplaene[k.id]=tischStempel(sp(),key,wisch.an); wisch.geaendert=true; renderHeute();
  }
  function onMove(e){
    if(wisch){ e.preventDefault(); const t=document.elementFromPoint(e.clientX,e.clientY); tischAn(t&&t.closest('.kachel')); return; }
    if(!drag) return;
    if(!drag.moving){
      const dx=e.clientX-drag.x0, dy=e.clientY-drag.y0;
      if(Math.hypot(dx,dy)<8) return;
      // aus der Liste: senkrecht scrollt sie bzw. die Seite (touch-action: pan-y) — gezogen wird bei überwiegend waagerechtem Start
      // oder nach dem Halten (Prüfer 03.10. B5/F1; am Handy steht das Raster über der Liste, dort ist Halten der Weg)
      if(drag.vonKey==null&&Math.abs(dx)<=Math.abs(dy)&&performance.now()-drag.t0<HALTEN_MS){ drag=null; return; }
      drag.moving=true; document.body.classList.add('sp-dragging');
      const s=stammKind(drag.nr);
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
    if(wisch){ const w=wisch; wisch=null; if(w.geaendert){ stammMutiert(); speichern(); } return; }   // ein Strich = eine Speicherung
    if(!drag) return;
    const d=drag; drag=null;
    if(!d.moving){ if(d.vonKey==null) schaerfen(d.nr); return; }   // Tipp auf einen Namen der Liste: scharf · Tipp im Raster → planTap
    justDragged=true; setTimeout(()=>{ justDragged=false; },0);
    if(d.ghost) d.ghost.remove();
    // erst messen, dann „sp-dragging“ weg: die Ablage vor der Tafel ist nur beim Ziehen sichtbar (gemessen 02.10., P22 V2)
    const t=document.elementFromPoint(e.clientX,e.clientY);
    document.body.classList.remove('sp-dragging');
    zielReset();
    const g=sp().grid;
    if(t&&t.closest('.sp-trash')){
      // Mülleimer: der Platz wird leer, kein Tisch (Zero 02.10. abends: „Ja“) — „Aus dem Kurs nehmen“ lässt weiter einen Tisch (vomPlatz)
      if(d.vonKey){ vault.stamm.sitzplaene[k.id]=raeumePlatz(sp(),d.nr); stammMutiert(); speichern(); renderHeute(); renderRail(); toast('vom Platz genommen'); }
      return;
    }
    const plus=t&&t.closest('.reihe-plus');
    if(plus&&plan.contains(plus)){  // Drop auf ＋ zwischen den Reihen → neue Reihe dort, Schüler an der Finger-Spalte (Ghost-Punkt 2)
      // Spalte unter dem Finger aus den Kachel-Rechtecken: die Kacheln stehen mittig in der breiteren Reihe (Prüfer 03.10. B2)
      const ks=[...(plan.querySelector('.plan-reihe .kachel')?.parentElement.querySelectorAll('.kachel')||[])]; let c=0;
      if(ks.length){ const i=ks.findIndex(x=>e.clientX<x.getBoundingClientRect().right); c=Number(ks[i<0?ks.length-1:i].dataset.c); }
      reiheEinfuegen(Number(plus.dataset.vor),d.nr,c);
      renderRail(); toast('Neue Reihe');
      return;
    }
    const kach=t&&t.closest('.kachel');
    if(kach&&plan.contains(kach)){
      const zielKey=keyOf(kach), belegt=g[zielKey];
      if(String(belegt)===String(d.nr)) return; // auf sich selbst
      // Platz→Platz: bei belegt tauschen, sonst wird der alte Platz leer (kein Tisch) · Schiene→Platz: bisheriger wandert in die Schiene
      vault.stamm.sitzplaene[k.id]=setzeAufPlatz(sp(),zielKey,d.nr,{tausch:!!d.vonKey});
      stammMutiert(); speichern(); renderHeute(); renderRail();
    }
  }
  const railDown=e=>{ const c=e.target.closest('.sp-chip'); if(!c) return; e.preventDefault(); drag={nr:Number(c.dataset.nr),vonKey:null,moving:false,ghost:null,x0:e.clientX,y0:e.clientY,t0:performance.now()}; };
  // Nach dem Halten (bzw. sobald gezogen wird) darf der Browser nicht mehr scrollen, sonst bricht pointercancel das Ziehen ab
  const railTouch=e=>{ if(drag&&drag.vonKey==null&&(drag.moving||performance.now()-drag.t0>=HALTEN_MS)) e.preventDefault(); };
  const planDown=e=>{ const kach=e.target.closest('.kachel'); if(!kach) return; tipp={x:e.clientX,y:e.clientY};
    if(tischScharf){ e.preventDefault(); wisch={an:null,keys:new Set(),geaendert:false}; tischAn(kach); return; }
    if(!kach.classList.contains('schueler')) return;
    drag={nr:Number(kach.dataset.nr),vonKey:keyOf(kach),moving:false,ghost:null,x0:e.clientX,y0:e.clientY}; };
  const planTap=e=>{
    const t=tipp; tipp=null;
    if(justDragged||(drag&&drag.moving)||tischScharf) return;   // Tisch-Stempel: schon beim Aufsetzen erledigt
    const kach=e.target.closest('.kachel'); if(!kach) return;
    if(t&&Math.hypot(e.clientX-t.x,e.clientY-t.y)>=8) return;   // gewischt, nicht getippt (Schwelle wie beim Ziehen)
    const key=keyOf(kach);
    if(scharf!=null){   // ein scharfer Name: ein leerer Platz oder Tisch nimmt ihn auf, danach ist der nächste A–Z scharf
      e.stopPropagation();
      if(sp().grid[key]!=null){ toast('Platz besetzt — zum Tauschen ziehen'); return; }   // nie still verdrängen
      const liste=ohnePlatzAZ(), i=liste.findIndex(s=>s.nr===scharf), nr=scharf;
      vault.stamm.sitzplaene[k.id]=setzeAufPlatz(sp(),key,nr); stammMutiert(); speichern();
      const weiter=liste.slice(i+1).concat(liste.slice(0,Math.max(0,i))).find(s=>s.nr!==nr);
      scharf=weiter?weiter.nr:null; renderHeute(); renderRail(); return;
    }
    if(sp().grid[key]) return; // gesetzt → nur Drag (kein Lösch-Tap mehr)
    e.stopPropagation(); picker(key);
  };
  const onCancel=()=>{ tipp=null; if(wisch&&wisch.geaendert){ stammMutiert(); speichern(); } wisch=null; if(drag&&drag.ghost) drag.ghost.remove(); drag=null; document.body.classList.remove('sp-dragging'); zielReset(); };
  const plusClick=e=>{ const p=e.target.closest('.reihe-plus'); if(p){ e.stopPropagation(); reiheEinfuegen(Number(p.dataset.vor)); return; }
    const l=e.target.closest('.luecke-btn'); if(l){ e.stopPropagation(); toggleLuecke(Number(l.dataset.luecke)); } };
  rail.addEventListener('pointerdown',railDown);
  rail.addEventListener('touchmove',railTouch,{passive:false});
  plan.addEventListener('click',plusClick);
  plan.addEventListener('pointerdown',planDown);
  plan.addEventListener('pointerup',planTap);
  document.addEventListener('pointermove',onMove,{passive:false});
  document.addEventListener('pointerup',onUp,true);
  document.addEventListener('pointercancel',onCancel,true);

  function picker(key){
    // Titel ohne Reihennummer: sie zählte die aufgefüllten Leer-Reihen mit (Prüfer 03.10. G4)
    const vergeben=new Set(Object.values(sp().grid));
    const frei=kursSchueler(k).filter(s=>!vergeben.has(s.nr));
    dlgZeigen('<h3>Wer sitzt hier?</h3><input type="text" id="s-such" placeholder="Name tippen…" list="s-liste"><datalist id="s-liste">'+
      frei.map(s=>'<option value="'+esc(s.vorname+' '+s.name+' ('+listenNr(s)+')')+'">').join('')+'</datalist>'+
      '<div class="u-scroll30">'+frei.map(s=>'<button class="btn still u-btn-block u-eng" data-setz="'+s.nr+'">'+esc(s.vorname)+' '+esc(s.name)+'</button>').join('')+'</div>'+
      '<div class="btn-reihe"><button class="btn still" data-schliessen>Abbrechen</button></div>',
      elx=>{
        const setze=nr=>{ vault.stamm.sitzplaene[k.id]=setzeAufPlatz(sp(),key,nr); stammMutiert(); speichern(); dlgZu(); renderHeute(); renderRail(); };   // auch auf einen leeren Tisch
        elx.querySelectorAll('[data-setz]').forEach(x=>x.onclick=()=>setze(Number(x.dataset.setz)));
        elx.querySelector('#s-such').oninput=ev2=>{ const m=ev2.target.value.match(/\((\d+)\)/), kand=m?frei.filter(x=>lnr(x)===Number(m[1])):[], s=kand.find(x=>ev2.target.value.startsWith(x.vorname+' '+x.name+' ('))||kand[0]; if(s) setze(s.nr); };   // „(7)“ ist die Listen-Nr (WAHL U9)
        setTimeout(()=>elx.querySelector('#s-such').focus(),60);
      });
  }
  function reiheEinfuegen(vorR,dropNr,dropC){  // Ghost-＋: Reihen ab vorR um +1 schieben → leere Reihe bei vorR; optional Schüler direkt hineindroppen
    vault.stamm.sitzplaene[k.id]=spReiheEinfuegen(sp(),vorR,dropNr!=null?{nr:dropNr,c:dropC}:null);   // Lücken und Tische rücken mit
    stammMutiert(); speichern(); renderHeute();
  }
  function kompaktiere(){  // leere Reihen raus — außer markierten Lücken (Gang) und Reihen mit leeren Tischen; Nr bleibt der Anker (logic/sitzplan.mjs)
    vault.stamm.sitzplaene[k.id]=spKompaktiere(sp()); stammMutiert(); speichern();
  }
  function toggleLuecke(r){  // „Lücke lassen" ↔ aufheben (Zero 2026-09-02: leere Reihe zwischen Tischen bewusst stehen lassen)
    const o=sp(), l=new Set(o.luecken||[]);
    if(l.has(r)) l.delete(r); else l.add(r);
    o.luecken=[...l].sort((a,b)=>a-b); stammMutiert(); speichern(); renderHeute();
  }
  function beenden(){
    kompaktiere();
    editorAktiv=false; editorCleanup=null;
    document.body.classList.remove('sp-edit','sp-dragging','sp-tisch-scharf');
    rail.removeEventListener('pointerdown',railDown); rail.removeEventListener('keydown',railTaste); rail.removeEventListener('touchmove',railTouch,{passive:false});
    removeEventListener('resize',passeListe);
    plan.removeEventListener('click',plusClick);
    plan.removeEventListener('pointerdown',planDown);
    plan.removeEventListener('pointerup',planTap);
    document.removeEventListener('pointermove',onMove,{passive:false});
    document.removeEventListener('pointerup',onUp,true);
    document.removeEventListener('pointercancel',onCancel,true);
    if(drag&&drag.ghost) drag.ghost.remove();
    bar.remove(); ohne.remove(); zielReset(); renderHeute();
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
// Zell-Beschriftung eines Wochenplan-Blocks im Assistenten (S256d; die Ansicht zeigt seit Scheibe 2 die konkrete Woche, stundeWaehlen).
// Zeigt ALLE Slots des Blocks (A/B-Paare: „8c (A) · 7b (B)" — vorher verschwand der zweite).
function wochenplanZellText(plan,wt,nr){
  const slots=plan.filter(p=>p.wochentag===wt&&p.blockNr===nr);
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
   Kurstermine entstehen nur aus Events (verbotener Pfad 3); die Griffe heilen die ANZEIGE.
   Seit Scheibe 2 (Zero 2026-10-02) setzt die App nur noch Entfälle — Vertretung und Tausch sind raus („ich bewerte nur
   meine eigenen klassen“); alte Einträge mit Kurs liest sie weiter und entfernt sie auf Wunsch (Griffe in stundeWaehlen). */
function ausnahmeFuer(datum,blockNr){ return (vault.stamm.ausnahmeSlots||[]).find(a=>a.datum===datum&&a.blockNr===blockNr)||null; }
function setzeAusnahme(datum,blockNr,kursId,grund){ // ersetzt einen vorhandenen Eintrag des Blocks (find() nimmt sonst den alten)
  vault.stamm.ausnahmeSlots=(vault.stamm.ausnahmeSlots||[]).filter(a=>!(a.datum===datum&&a.blockNr===blockNr));
  vault.stamm.ausnahmeSlots.push({datum,blockNr,kursId,teilgruppe:null,grund:grund||null});
  stammMutiert(); speichern();
}
// Neuer Stand aus den reinen Ausfall-Funktionen (logic/autowahl: tagesAusfall, entfallZurueck, ausnahmeEntfernen).
// Dasselbe Array = nichts geändert → nicht speichern, keine Revision hochzählen (beim Import gewinnt die höhere rev, Prüfer 2026-10-02).
function setzeAusnahmen(neu){
  if(neu===vault.stamm.ausnahmeSlots) return false;
  vault.stamm.ausnahmeSlots=neu; stammMutiert(); speichern(); return true;
}
function schultagAb(startIso,richtung){ // nächster/voriger Mo–Fr-Tag (Wochenenden übersprungen)
  const d=new Date(startIso+'T12:00:00');
  do{ d.setDate(d.getDate()+richtung); }while(((d.getDay()+6)%7)+1>5);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function stundenplanAssistent(){
  // Arbeitskopie (erst bei „Fertig" in den Vault) — bestehendes Zeitmodell weiterbearbeiten
  const zm0=(vault.stamm.zeitmodelle||[])[0];
  const zm=zm0?JSON.parse(JSON.stringify(zm0)):{id:'std',name:'Regelraster',startSekunden:27900,dauerSekunden:4050,bloeckeProTag:6,pausenNachBlock:{},tagesAusnahmen:{},abWochenAnker:null,anzeigeRunden:true};
  const plan=JSON.parse(JSON.stringify(vault.stamm.wochenplan||[]));
  let schritt=1, malKurs;   // Maler-Zustand (S256b): undefined = kein Kurs in der Hand · 'FREI' · kursId
  const s1={tag:1,fein:false,kurz:false,ferien:false};   // Zeitraster: gewählter Tag, offene Aufklapper (Scheibe 8)
  let detail=null, detailRh='jede', detailTg='', ankerTyp='A';   // Wochenplan: Stunde mit offenen Details (Scheibe 8, Wahl 3 B)
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

  // ── Schritt 1: Zeitraster (Scheibe 8, Zero 05.10. Wahl 2 B „Vorlage zuerst“, design/s8_entwuerfe_2026-10-05/WAHL.md) ──
  // Oben die Vorlagen, darunter die Summe und die Zeiten des Tages zum Lesen, genau wie auf dem Aushang (08:52:30, nicht gerundet).
  // „Feineinstellung“ (Beginn, Länge, Pausen, einzelne Tage), Kurzstunden und Ferien klappen am Ort auf; vorher war das Kurzraster
  // ein eigener Dialog. Sekunden-Doktrin, Eingaben per parseFloat auf 0,5 min (FEHLER 2026-07-09). Fokus-Lehre: beim Tippen werden
  // nur Zeit-Texte beschrieben; neu gebaut wird erst bei Tag-, Längen- oder Stundenzahl-Wechsel, und nie das Feld, in dem getippt wird.
  function renderS1(){
    const genau=b=>formatZeit(b.startSek,false)+'–'+formatZeit(b.endeSek,false);
    const minuten=sek=>String(sek/60).replace('.',',');
    const zahl=t=>parseFloat(String(t).replace(',','.'));
    const summe=el('p',{class:'sp-summe'}), tagChips=el('div',{class:'sp-tagchips'}), leseBox=el('div',{class:'sp-lesezeiten'}), feinTag=el('div',{});
    let leseSpans=[], feinSpans=[];
    const zeichneSumme=()=>{ const r=resolveBloecke({...zm,tagesAusnahmen:{}},1);
      summe.replaceChildren(el('b',{},zm.bloeckeProTag+(zm.bloeckeProTag===1?' Stunde':' Stunden')+' à '+minuten(zm.dauerSekunden)+' min'),r.length?' · '+formatZeit(r[0].startSek,false)+'–'+formatZeit(r[r.length-1].endeSek,false):''); };
    // Neubau nach einer geänderten Stundenzahl erst, wenn der Fokus angekommen ist: onchange feuert beim Wechsel ins nächste Feld,
    // und das wird mit neu gebaut. Danach dasselbe Feld wieder fokussieren, erkannt an seinem Namen (Prüfer 05.10. G1, so schon in v1.20.0)
    const nameVon=x=>x.getAttribute('aria-label')||x.closest('label')?.firstChild?.textContent||'';
    const nachWechsel=neubau=>setTimeout(()=>{ const a=document.activeElement, n=a&&a!==document.body?nameVon(a):''; neubau();
      if(n&&!a.isConnected){ const z=[...dlg.querySelectorAll('input,select')].find(x=>nameVon(x)===n); if(z) z.focus(); } },0);
    const zeichneTag=()=>{
      const bl=resolveBloecke(zm,s1.tag), ausn=(zm.tagesAusnahmen||{})[s1.tag]||{}, regelDauer=ausn.dauerSekunden??zm.dauerSekunden;
      tagChips.replaceChildren(...[1,2,3,4,5].map(wt=>el('button',{type:'button',class:'tg-chip'+(s1.tag===wt?' an':''),'aria-pressed':String(s1.tag===wt),dataset:{spTag:String(wt)},
        onclick:()=>{ s1.tag=wt; zeichneTag(); }},WT_KURZ[wt]+((zm.tagesAusnahmen||{})[wt]?' *':''))));
      leseSpans=bl.map(b=>el('span',{},genau(b)));
      leseBox.replaceChildren(...bl.map((b,i)=>el('span',{},el('b',{},'Std. '+blockLabel(zm,b.blockNr)),' ',leseSpans[i])));
      // Stunden je Tag (S256b): onchange statt oninput, der Neubau kommt erst nach dem Verlassen des Feldes
      const tagBloecke=el('input',{type:'number',min:'1',max:'12',value:String(ausn.bloeckeProTag??zm.bloeckeProTag),class:'u-w72'+(ausn.bloeckeProTag!=null?' sp-dmin abweich':''),'aria-label':'Stunden am '+WT_KURZ[s1.tag],
        onchange:e=>{ const v=parseInt(e.target.value,10); if(!(v>=1&&v<=12)) return;
          zm.tagesAusnahmen=zm.tagesAusnahmen||{};
          const a=zm.tagesAusnahmen[s1.tag]=zm.tagesAusnahmen[s1.tag]||{};
          if(v===zm.bloeckeProTag){ delete a.bloeckeProTag; if(!Object.keys(a).length) delete zm.tagesAusnahmen[s1.tag]; }
          else a.bloeckeProTag=v;
          nachWechsel(zeichneTag);
        }});
      feinSpans=[];
      const zeilen=[el('div',{class:'zeile'},el('span',{},'Stunden am '+WT_KURZ[s1.tag]),el('span',{},tagBloecke))];
      bl.forEach((b,i)=>{
        const zs=el('span',{class:'wert'},genau(b)); feinSpans.push(zs);
        const abw=(ausn.blockDauern||{})[b.blockNr]!=null;
        // abweichende Länge an einem Tag (Konferenztag 45, Oberstufe 90) → tagesAusnahmen[tag].blockDauern (Zero 2026-07-09)
        const din=el('input',{type:'number',min:'20',max:'180',step:'0.5',value:String((b.endeSek-b.startSek)/60),class:'u-w72 sp-dmin'+(abw?' abweich':''),'aria-label':'Länge Stunde '+blockLabel(zm,b.blockNr)+' in Minuten',
          oninput:e=>{ const v=zahl(e.target.value); if(!(v>0)) return;
            const sekNeu=Math.round(v*60);
            zm.tagesAusnahmen=zm.tagesAusnahmen||{};
            const a=zm.tagesAusnahmen[s1.tag]=zm.tagesAusnahmen[s1.tag]||{};
            a.blockDauern=a.blockDauern||{};
            if(sekNeu===regelDauer){ delete a.blockDauern[b.blockNr]; e.target.classList.remove('abweich');
              if(!Object.keys(a.blockDauern).length) delete a.blockDauern;
              if(!Object.keys(a).length) delete zm.tagesAusnahmen[s1.tag]; }
            else { a.blockDauern[b.blockNr]=sekNeu; e.target.classList.add('abweich'); }
            zeitenRefresh();
          }});
        zeilen.push(el('div',{class:'zeile sp-std'},el('span',{},'Std. '+blockLabel(zm,b.blockNr)+' ',din,' min'),zs));
        // Pause in Minuten mit 0,5-Genauigkeit: bei 67,5-min-Blöcken bringt eine :30-Pause die Grenzen auf glatte Minuten.
        // Die Pausen gelten an allen Tagen; Tagesausnahmen mit eigenen Pausen kennt zeitmodell.mjs, die App legt sie nicht an.
        if(i<bl.length-1) zeilen.push(el('div',{class:'zeile sp-pause'},el('span',{},'Pause'),el('span',{},
          el('input',{type:'number',min:'0',max:'120',step:'0.5',value:String(((zm.pausenNachBlock||{})[b.blockNr]||0)/60),class:'u-w72','aria-label':'Pause nach Stunde '+blockLabel(zm,b.blockNr)+' in Minuten',
            oninput:e=>{ zm.pausenNachBlock[b.blockNr]=Math.round((zahl(e.target.value)||0)*60); zeitenRefresh(); }}),' min')));
      });
      feinTag.replaceChildren(...zeilen,el('p',{class:'u-hinweis'},'Pausen gelten an allen Tagen, die Länge einer Stunde darf je Tag abweichen.'));
      zeichneSumme();
    };
    const zeitenRefresh=()=>{
      const bl=resolveBloecke(zm,s1.tag);
      if(bl.length!==leseSpans.length){ zeichneTag(); return; }
      bl.forEach((b,i)=>{ leseSpans[i].textContent=genau(b); feinSpans[i].textContent=genau(b); });
      zeichneSumme();
    };
    // Beginn, Länge, Blöcke: liegen außerhalb der Tagesliste und überleben deren Neubau
    // Name kommt vom sichtbaren Wort im <label> (Label in Name, Prüfer 05.10. G5)
    const startInput=el('input',{type:'time',value:formatZeit(zm.startSekunden),
      oninput:e=>{ const [h,m]=e.target.value.split(':').map(Number); if(!isNaN(h)){ zm.startSekunden=h*3600+m*60; zeitenRefresh(); } }});
    const dauerInput=el('input',{type:'number',value:String(zm.dauerSekunden/60),min:'20',max:'120',step:'0.5',
      oninput:e=>{ const v=zahl(e.target.value); if(v>0){ zm.dauerSekunden=Math.round(v*60); zeichneTag(); } }});
    const blockInput=el('input',{type:'number',value:String(zm.bloeckeProTag),min:'1',max:'12',
      oninput:e=>{ const v=parseInt(e.target.value,10); if(v>=1&&v<=12){ zm.bloeckeProTag=v; zeichneTag(); } }});
    // Vorlagen (S256b „intuitiv zuerst“): ein Tipp füllt die ARBEITSKOPIE komplett, gespeichert wird erst bei „Fertig“
    const vorlagenBox=el('div',{class:'sp-tagchips sp-vorlagen'},
      ...RASTER_VORLAGEN.map(v=>el('button',{type:'button',class:'tg-chip',title:v.hinweis,'aria-label':'Vorlage: '+v.name,
        onclick:()=>{ const kopie=JSON.parse(JSON.stringify(v.zeitmodell));
          zm.startSekunden=kopie.startSekunden; zm.dauerSekunden=kopie.dauerSekunden; zm.bloeckeProTag=kopie.bloeckeProTag;
          zm.pausenNachBlock=kopie.pausenNachBlock; zm.tagesAusnahmen=kopie.tagesAusnahmen||{};
          zm.blockLabels=kopie.blockLabels||null; zm.zweitRaster=kopie.zweitRaster||null;
          zm.kurztage=zm.kurztage||[];   // eingetragene Kurztage überleben den Vorlagen-Wechsel
          renderS1(); toast('Vorlage „'+v.name+'" übernommen — „Fertig" speichert');
        }},v.name)));
    // Kurzstunden-Tage (S256b): an gelisteten DATEN gilt das Zweitraster — am Ort, nicht mehr als eigener Dialog
    const kurzSumme=el('span',{}), kurzInhalt=el('div',{});
    const kurzText=()=>'Kurzstunden-Tage · '+(zm.zweitRaster?zm.zweitRaster.bloeckeProTag+'×'+minuten(zm.zweitRaster.dauerSekunden)+' min · '+(zm.kurztage||[]).length+((zm.kurztage||[]).length===1?' Tag':' Tage'):'keine');
    const zeichneKurz=()=>{
      kurzSumme.textContent=kurzText();
      if(!zm.zweitRaster){
        kurzInhalt.replaceChildren(el('p',{class:'u-hinweis'},'Für Tage mit verkürzten Stunden (Zeugniskonferenz, Hitzefrei-Plan …).'),
          el('div',{class:'btn-reihe'},el('button',{type:'button',class:'btn still u-btn-klein',onclick:()=>{ zm.zweitRaster=JSON.parse(JSON.stringify(KURZRASTER_45)); zm.kurztage=zm.kurztage||[]; zeichneKurz(); }},'45-Minuten-Kurzraster anlegen')));
        return;
      }
      const zr=zm.zweitRaster;   // pausenNachBlock legt erst ein Tippen an — Zeichnen schreibt nichts (Prüfer 05.10. G7)
      const bl=resolveBloecke({...zr,tagesAusnahmen:{}},1), spans=[];
      const kurzZeiten=()=>{ const b=resolveBloecke({...zr,tagesAusnahmen:{}},1); b.forEach((x,i)=>{ if(spans[i]) spans[i].textContent=genau(x); }); kurzSumme.textContent=kurzText(); };
      const zeilen=[];
      bl.forEach((b,i)=>{ const zs=el('span',{class:'wert'},genau(b)); spans.push(zs);
        zeilen.push(el('div',{class:'zeile sp-std'},el('span',{},'Std. '+b.blockNr),zs));
        if(i<bl.length-1) zeilen.push(el('div',{class:'zeile sp-pause'},el('span',{},'Pause'),el('span',{},
          el('input',{type:'number',min:'0',max:'120',step:'0.5',value:String(((zr.pausenNachBlock||{})[b.blockNr]||0)/60),class:'u-w72','aria-label':'Kurzstunden: Pause nach Stunde '+b.blockNr+' in Minuten',
            oninput:e=>{ (zr.pausenNachBlock=zr.pausenNachBlock||{})[b.blockNr]=Math.round((zahl(e.target.value)||0)*60); kurzZeiten(); }}),' min'))); });
      const din=el('input',{type:'date','aria-label':'Kurzstunden-Tag'});
      kurzInhalt.replaceChildren(
        el('div',{class:'sp-drei'},
          el('label',{},'Beginn',el('input',{type:'time',value:formatZeit(zr.startSekunden),'aria-label':'Kurzstunden: Beginn',
            oninput:e=>{ const [h,m]=e.target.value.split(':').map(Number); if(!isNaN(h)){ zr.startSekunden=h*3600+m*60; kurzZeiten(); } }})),
          el('label',{},'Länge (min)',el('input',{type:'number',min:'20',max:'120',step:'0.5',value:String(zr.dauerSekunden/60),'aria-label':'Kurzstunden: Länge (min)',
            oninput:e=>{ const v=zahl(e.target.value); if(v>0){ zr.dauerSekunden=Math.round(v*60); kurzZeiten(); } }})),
          el('label',{},'Stunden',el('input',{type:'number',min:'1',max:'12',value:String(zr.bloeckeProTag),'aria-label':'Kurzstunden: Stunden',
            onchange:e=>{ const v=parseInt(e.target.value,10); if(v>=1&&v<=12){ zr.bloeckeProTag=v; nachWechsel(zeichneKurz); } }}))),
        ...zeilen,
        el('div',{class:'tag-kopf'},'Gilt an diesen Tagen'),
        ...(zm.kurztage||[]).slice().sort().map(d=>el('div',{class:'zeile'},el('span',{},datumLabel(d)+d.slice(0,4)),
          el('span',{},el('button',{type:'button',class:'btn still u-btn-klein',title:'Tag entfernen','aria-label':'Tag entfernen',onclick:()=>{ zm.kurztage=zm.kurztage.filter(x=>x!==d); zeichneKurz(); }},'✕')))),
        el('div',{class:'zeile'},el('span',{},din),el('span',{},el('button',{type:'button',class:'btn still u-btn-klein',onclick:()=>{
          const d=din.value;
          if(!d){ toast('Datum wählen'); return; }
          if((zm.kurztage||[]).includes(d)){ toast('Tag ist schon eingetragen'); return; }
          (zm.kurztage=zm.kurztage||[]).push(d); zeichneKurz();
        }},'＋ Tag'))),
        el('div',{class:'btn-reihe'},el('button',{type:'button',class:'btn gefahr u-btn-klein',onclick:()=>{ zm.zweitRaster=null; zm.kurztage=[]; zeichneKurz(); }},'Kurzraster entfernen')));
    };
    // Ferien & Feiertage (Punkt 15): Datumsbereiche — die Autowahl sagt dort „frei“, der Stundenplan zeigt den Namen
    const ferienSumme=el('span',{}), ferienInhalt=el('div',{});
    const zeichneFerien=()=>{
      const f=zm.ferien||[];
      ferienSumme.textContent='Ferien & Feiertage · '+(f.length?f.length+' eingetragen':'keine');
      const vonIn=el('input',{type:'date','aria-label':'von'}), bisIn=el('input',{type:'date','aria-label':'bis'}), nameIn=el('input',{type:'text',placeholder:'z. B. Herbstferien',class:'u-w130','aria-label':'Name der Ferien'});
      ferienInhalt.replaceChildren(
        ...f.slice().sort((a,b)=>a.von.localeCompare(b.von)).map(x=>el('div',{class:'zeile'},el('span',{},x.name+' · '+datumLabel(x.von)+x.von.slice(0,4)+(x.bis!==x.von?' – '+datumLabel(x.bis)+x.bis.slice(0,4):'')),
          el('span',{},el('button',{type:'button',class:'btn still u-btn-klein',title:'entfernen','aria-label':'entfernen',onclick:()=>{ zm.ferien=zm.ferien.filter(y=>y!==x); zeichneFerien(); }},'✕')))),
        el('div',{class:'zeile'},el('span',{},vonIn,' – ',bisIn),el('span',{},nameIn,' ',el('button',{type:'button',class:'btn still u-btn-klein',onclick:()=>{
          const von=vonIn.value, bis=bisIn.value||vonIn.value, name=nameIn.value.trim()||'Ferien';
          if(!von){ toast('Datum wählen'); return; }
          if(bis<von){ toast('Ende liegt vor dem Anfang'); return; }
          (zm.ferien=zm.ferien||[]).push({von,bis,name}); zeichneFerien();
        }},'＋'))));
    };
    // Aufklapper behalten ihren Zustand über einen Neubau (Vorlage antippen); offene Feineinstellung ersetzt die Lese-Zeiten
    const aufklapp=(schluessel,kopfzeile,inhalt)=>{ const d=el('details',{class:'s-regel sp-auf',dataset:{spAuf:schluessel},...(s1[schluessel]?{open:''}:{})},el('summary',{},kopfzeile),inhalt);
      d.addEventListener('toggle',()=>{ s1[schluessel]=d.open; if(schluessel==='fein') leseBox.classList.toggle('hidden',d.open); }); return d; };
    zeichneTag(); zeichneKurz(); zeichneFerien();
    leseBox.classList.toggle('hidden',s1.fein);
    dlgZeigenEl(kopf('Zeitraster'),
      el('p',{class:'u-hinweis'},'Vorlage antippen:'),
      vorlagenBox, summe,
      el('div',{class:'sp-vorschau'},el('div',{class:'tag-kopf'},'So sieht der Tag aus:'),tagChips,leseBox),
      aufklapp('fein',el('span',{},'Feineinstellung · Beginn, Länge, Pausen, einzelne Tage'),
        el('div',{},el('div',{class:'sp-drei'},el('label',{},'Beginn',startInput),el('label',{},'Länge (min)',dauerInput),el('label',{},'Stunden',blockInput)),feinTag)),
      aufklapp('kurz',kurzSumme,kurzInhalt),
      aufklapp('ferien',ferienSumme,ferienInhalt),
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn',onclick:()=>{ schritt=2; renderS2(); }},'Weiter: Wochenplan'),
        el('button',{class:'btn still',onclick:dlgZu},'Abbrechen')));
    dlgBreit();
  }

  // ── Schritt 2: Wochenplan — Kurs in die Hand nehmen und Stunden MALEN (S256b, Stempel-Paradigma wie die Rail im Sitzplan) ──
  // Ohne Kurs in der Hand öffnet eine Stunde ihre Details ÜBER dem Raster an Stelle der Palette (Scheibe 8, Zero 05.10. Wahl 3 B):
  // Woche, Kurs und Teilgruppe gelten mit einem Tipp, die A/B-Woche wird am Ort festgelegt. Vorher ersetzte ein eigener Dialog den
  // Assistenten (drei Auswahllisten und „Übernehmen“), für den Anker ein zweiter. Geschrieben wird in dieselbe Arbeitskopie (setzeSlot).
  function renderS2(){
    detail=null;
    const tage=[1,2,3,4,5];
    const grid=el('div',{class:'sp-woche'});
    const palette=el('div',{class:'sp-tagchips sp-malpalette'});
    const oben=el('div',{class:'sp-oben'}), hinweis=el('p',{class:'u-hinweis'}), ankerAnzeige=el('div',{});
    let ankerNeu=false;   // „ändern“ am gesetzten Anker ist offen
    const zelleText=(wt,nr)=>wochenplanZellText(plan,wt,nr);
    const aid=vault.stamm.aktivesSchuljahrId;
    const kurse=sortiereKurse(vault.stamm.kurse.filter(k=>(k.schuljahrId||aid)===aid&&k.status!=='archiviert'));
    const renderPalette=()=>{
      const chip=(wert,txt,titel)=>el('button',{class:'tg-chip'+(malKurs===wert?' an':''),title:titel||'','aria-pressed':malKurs===wert?'true':'false',
        onclick:()=>{ malKurs=(malKurs===wert)?undefined:wert; renderPalette(); }},txt);   // nochmal antippen = ablegen (wie Stempel)
      // Fach sichtbar am Chip, nicht nur im title — auf dem iPad gibt es kein Hover. Farbband = Fachfarbe (Zero 2026-09-02: Farbschema auch beim Bearbeiten)
      const kursChip=k=>{ const c=chip(k.id,k.name+' '+fachKuerzel(k.fach),k.name+' · '+k.fach); c.classList.add('mal-chip'); c.prepend(el('span',{class:'mal-band'})); faerbe(c,k); return c; };
      palette.replaceChildren(
        ...kurse.map(kursChip),
        // Stempel ohne Kurs (Zero 2026-09-02): Klassenstunde · Reservestunde
        ...Object.entries(SLOT_ARTEN).map(([art,a])=>chip('@'+art,a.label,a.label+' — ohne Kurs')),
        chip('FREI','✕ frei','Stunde leeren'));
      if(!kurse.length) palette.append(el('span',{class:'u-hinweis'},'Noch keine Kurse — unter „Kurse" anlegen.'));
      grid.classList.toggle('malen',malKurs!==undefined);   // Kurs in der Hand: Touch scrollt nicht, der Finger malt (Punkt 16)
    };
    // Malen belegt „jede Woche“ und räumt damit auch ein A/B-Paar (logic/autowahl setzeSlot)
    const male=(wt,nr)=>{ plan.splice(0,plan.length,...setzeSlot(plan,wt,nr,'jede',malKurs==='FREI'?null:neuerSlot(wt,nr,malKurs))); };
    // Ein Block kann ein A/B-Paar tragen — die Details zeigen den Slot der gewählten Woche
    const rhVon=p=>(p.rhythmus==='A'||p.rhythmus==='B')?p.rhythmus:'jede';
    const imBlock=(wt,nr)=>plan.filter(p=>p.wochentag===wt&&p.blockNr===nr);
    const slotMit=(wt,nr,rh)=>{ const b=imBlock(wt,nr); return b.find(p=>rhVon(p)===rh)||(rh!=='jede'&&b.find(p=>rhVon(p)==='jede'))||{}; };
    // A/B-Woche festlegen oder ändern: erst „Festlegen“ übernimmt. Das Datumsfeld meldet beim Tippen schon nach der ersten Jahresziffer
    // ein Datum (0002-…), darum nie bei change; ein Jahr außerhalb 2000–2099 gilt nicht (Prüfer 05.10. Y1, v1.20.0 übernahm bei „Setzen“)
    // „Festlegen“ steht in einer eigenen Knopfreihe — neben der gewählten Woche sah es aus wie eine dritte Wahl (Bild 05.10.)
    const ankerFelder=(fertig,abbrechen)=>{
      const datum=el('input',{type:'date','aria-label':'Die Woche ab',value:zm.abWochenAnker?.datum||''});
      const knoepfe=[['A','A-Woche'],['B','B-Woche']].map(([v,txt])=>el('button',{type:'button',class:'btn'+(ankerTyp===v?'':' still'),'aria-pressed':String(ankerTyp===v),dataset:{spAnker:v},
        onclick:()=>{ ankerTyp=v; knoepfe.forEach(b=>{ const an=b.dataset.spAnker===v; b.classList.toggle('still',!an); b.setAttribute('aria-pressed',String(an)); }); }},txt));
      const ok=el('button',{type:'button',class:'btn u-btn-klein',dataset:{spAnkerOk:''},onclick:()=>{
        const v=datum.value, j=Number(v.slice(0,4));
        if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||j<2000||j>2099){ toast('Datum prüfen — z. B. 05.10.2026'); return; }
        zm.abWochenAnker={datum:v,typ:ankerTyp}; fertig(); }},'Festlegen');
      return [el('span',{},'Die Woche ab'),datum,el('span',{},'ist'),el('div',{class:'seg sp-seg'},...knoepfe),
        el('div',{class:'btn-reihe'},ok,...(abbrechen?[el('button',{type:'button',class:'btn still u-btn-klein',onclick:abbrechen},'Abbrechen')]:[]))];
    };
    const zeigeAnker=()=>{ const ab=zm.abWochenAnker;
      if(!ab){ ankerAnzeige.replaceChildren(); return; }
      ankerAnzeige.replaceChildren(ankerNeu
        ?el('div',{class:'sp-anker'},...ankerFelder(()=>{ ankerNeu=false; zeigeAnker(); zeichneOben(); },()=>{ ankerNeu=false; zeigeAnker(); }))
        :el('div',{class:'zeile'},el('span',{},'A/B-Woche'),el('span',{class:'wert'},'ab '+datumLabel(ab.datum)+ab.datum.slice(0,4)+' = '+ab.typ+'-Woche ',
          el('button',{type:'button',class:'btn still u-btn-klein',dataset:{spAnkerAendern:''},onclick:()=>{ ankerNeu=true; ankerTyp=ab.typ; zeigeAnker(); }},'ändern')))); };
    const seg=(werte,aktiv,setze,datenName)=>el('div',{class:'seg sp-seg'},...werte.map(([v,txt])=>el('button',{type:'button',class:'btn'+(aktiv===v?'':' still'),'aria-pressed':String(aktiv===v),
      dataset:{[datenName]:v||'alle'},onclick:()=>setze(v)},txt)));
    const panel=()=>{
      const {wt,nr}=detail, t=slotMit(wt,nr,detailRh);
      // A/B-Paar unter „jede Woche“: hier steht kein Kurs für beide Wochen. Kein Chip gilt als gewählt, ein Satz sagt, was ein Tipp tut —
      // vorher leuchtete „✕ frei“, und ein Tipp darauf leerte beide Wochen (Prüfer 05.10. Y3)
      const paar=detailRh==='jede'&&imBlock(wt,nr).some(p=>rhVon(p)!=='jede')&&!imBlock(wt,nr).some(p=>rhVon(p)==='jede');
      const wert=paar?null:(t.art?'@'+t.art:(t.kursId||''));
      const schreibe=w=>{ plan.splice(0,plan.length,...setzeSlot(plan,wt,nr,detailRh,w?{...neuerSlot(wt,nr,w),teilgruppe:w.startsWith('@')?null:(detailTg||null)}:null)); zeichneOben(); renderGrid(); };
      // Ein Kurs, der hier steht, aber nicht in der Palette (archiviert, anderes Schuljahr), bleibt als Chip sichtbar
      const fremd=wert&&!wert.startsWith('@')&&!kurse.some(k=>k.id===wert)?vault.stamm.kurse.filter(k=>k.id===wert):[];
      const chip=(w,txt,k)=>{ const c=el('button',{type:'button',class:'tg-chip'+(k?' mal-chip':'')+(wert===w?' an':''),'aria-pressed':String(wert===w),dataset:{spKurs:w||'frei'},onclick:()=>schreibe(w)},
        ...(k?[el('span',{class:'mal-band'})]:[]),txt); if(k) faerbe(c,k); return c; };
      return el('div',{class:'sp-detail',dataset:{spDetail:wt+'-'+nr}},
        el('div',{class:'sp-detail-kopf'},el('span',{},WT_KURZ[wt]+' · Std. '+blockLabel(zm,nr)),
          el('button',{type:'button',class:'btn still u-btn-klein',dataset:{spFertig:''},onclick:()=>{ detail=null; zeichneOben(); renderGrid(); }},'Fertig')),
        el('div',{class:'sp-reihe'},el('span',{},'Woche'),seg([['jede','jede Woche'],['A','A-Woche'],['B','B-Woche']],detailRh,v=>{ detailRh=v; detailTg=slotMit(wt,nr,v).teilgruppe||''; zeichneOben(); },'spWoche')),
        el('div',{class:'sp-reihe-kopf'},'Kurs'+(detailRh==='jede'?'':' in der '+detailRh+'-Woche')),
        ...(paar?[el('p',{class:'u-hinweis',dataset:{spPaar:''}},'A- und B-Woche sind verschieden belegt: '+zelleText(wt,nr)+'. Ein Tipp hier gilt für beide Wochen.')]:[]),
        el('div',{class:'sp-tagchips sp-malpalette'},...[...kurse,...fremd].map(k=>chip(k.id,k.name+' '+fachKuerzel(k.fach),k)),
          ...Object.entries(SLOT_ARTEN).map(([art,a])=>chip('@'+art,a.label)),chip('','✕ frei')),
        // Teilgruppe erst, wenn hier ein Kurs steht — ohne Kurs schrieb ein Tipp nichts und sah doch gewählt aus (Prüfer 05.10. Y3)
        ...(t.kursId?[el('div',{class:'sp-reihe'},el('span',{},'Teilgruppe'),seg([['','alle'],['A','A'],['B','B'],['C','C'],['D','D']],detailTg,v=>{ detailTg=v; schreibe(t.kursId); },'spGruppe'))]:[]),
        // A/B ohne Anker (Lücken-Fix #6): am Ort festlegen — ein Montag genügt
        ...(detailRh!=='jede'&&!zm.abWochenAnker?[el('div',{class:'sp-anker'},el('span',{},'A/B-Woche festlegen:'),...ankerFelder(()=>{ zeichneOben(); zeigeAnker(); }))]:[]),
        el('p',{class:'u-hinweis'},'Ein Tipp gilt sofort.'));
    };
    const zeichneOben=()=>{
      if(detail){ oben.replaceChildren(panel()); hinweis.textContent='Details der markierten Stunde — „Fertig“ bringt die Kurs-Palette zurück.'; }
      else { renderPalette(); oben.replaceChildren(palette); hinweis.textContent='Kurs antippen, dann Stunden malen — ohne Kurs in der Hand öffnet Tippen die Details der Stunde.'; }
    };
    const oeffne=(wt,nr)=>{ const b=imBlock(wt,nr);
      detail={wt,nr}; detailRh=b.length?rhVon(b[0]):'jede'; detailTg=slotMit(wt,nr,detailRh).teilgruppe||''; ankerTyp='A';
      zeichneOben(); renderGrid(); oben.scrollIntoView({block:'nearest'}); };
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
          const belegt=plan.some(p=>p.wochentag===wt&&p.blockNr===nr), gewaehlt=!!detail&&detail.wt===wt&&detail.nr===nr;
          const zelle=el('button',{class:'sp-zelle'+(belegt?' belegt':'')+(wochenplanZellArt(plan,wt,nr)?' sp-art':'')+(gewaehlt?' sp-gewaehlt':''),dataset:{wt:String(wt),nr:String(nr)},
            ...(gewaehlt?{'aria-current':'true'}:{}),onclick:()=>{
            if(strichWar){ strichWar=false; return; }                          // der Wisch-Strich hat schon gemalt (Punkt 16)
            if(malKurs===undefined){ oeffne(wt,nr); return; }                  // Detail-Weg (Teilgruppe/A-B) — über dem Raster
            male(wt,nr); renderGrid();
          }},zelleText(wt,nr));
          faerbe(zelle,wochenplanZellKurs(plan,wt,nr));   // Fachfarbe wie in der Ansicht — fehlte im Editor (Zero 2026-09-02)
          grid.append(zelle);
        }
        const p=zm.pausenNachBlock[nr]??zm.pausenNachBlock[String(nr)]??0;
        if(p&&nr<zm.bloeckeProTag) grid.append(el('div',{class:'sp-pausenzeile'},'Pause · '+String(p/60).replace('.',',')+' min'));
      }
    };
    zeichneOben(); renderGrid(); zeigeAnker();
    dlgZeigenEl(kopf('Wochenplan'),hinweis,oben,
      el('div',{class:'sp-woche-wrap'},grid),
      ankerAnzeige,
      el('div',{class:'btn-reihe'},
        el('button',{class:'btn still',onclick:()=>{ schritt=1; renderS1(); }},'← Zeitraster'),
        el('button',{class:'btn',onclick:()=>{ schritt=3; renderS3(); }},'Weiter: Prüfen')));
    dlgBreit();
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

const GRUPPEN_LABELS=['A','B','C','D'];   // Halbgruppen der Kurs-Seite


/* ═══ MEHR · Sichern & Übertragen · Sicherheit · Darstellung · Technik (Scheibe 7, Zero 04.10.: 1 A · 2 B · 3 B · 4 A · 5 B) ═══ */
// Kalendertage seit einem Zeitpunkt: Banner und „Sichern“ zählen gleich (Math.round fängt die 23-/25-h-Tage der Zeitumstellung)
function tageSeit(ts){ const d=new Date(ts), h=new Date(); return Math.round((new Date(h.getFullYear(),h.getMonth(),h.getDate())-new Date(d.getFullYear(),d.getMonth(),d.getDate()))/86400000); }
// Datenschutz-Satz (Zero 03.10. „Nur Datenschutz-Satz“, Ort 04.10. „Fuß der Seite“). Der Satz des Design-Gerüsts („verlassen das Gerät nur
// verschlüsselt“) stimmte nicht: Drucken, Sitzplan-PDF, „Vorschläge kopieren“ und „Kurzbericht kopieren“ geben Klartext heraus (Prüfer 04.10.).
const DATENSCHUTZ_SATZ='Kein Tracking, keine fremden Server: Deine Einträge liegen verschlüsselt auf diesem Gerät und verlassen es unverschlüsselt nur, wenn du druckst, ein Sitzplan-PDF erzeugst oder Vorschläge bzw. einen Kurzbericht kopierst.';
// Kopf von „Sichern“: Stand der letzten Sicherung aus IndexedDB `letzterExport`. Aufgerufen von renderMehr und nach jedem Sichern
// (merkeExport: Speichern und „An den PC senden“) — vorher blieb der Kopf nach dem Sichern stehen (Prüfer 04.10.).
// Gezählt werden nur Einträge; Stammdaten-Änderungen (Listen, Sitzpläne) sieht die Zahl nicht, darum „keine neuen Einträge“.
function sicherungsKopf(){
  const stand=$('ms-stand'); if(!stand||!vault) return;
  const n=vault.events.length, pad=x=>String(x).padStart(2,'0');
  idbGet('letzterExport').then(le=>{
    if(!le){ stand.classList.add('ms-alt'); stand.replaceChildren(el('b',{class:'ms-gross'},'Noch nie gesichert'),el('span',{class:'ms-klein'},(n===1?'1 Eintrag':n+' Einträge')+' nur auf diesem Gerät')); return; }
    const d=new Date(le.ts), tage=tageSeit(le.ts), neu=Math.max(0,n-(le.events||0));
    stand.classList.toggle('ms-alt',tage>7&&neu>0);   // dieselbe Schwelle wie das Sicherungs-Banner
    stand.replaceChildren(el('b',{class:'ms-gross'},tage<=0?'Heute gesichert':tage===1?'Gestern gesichert':'Gesichert vor '+tage+' Tagen'),
      el('span',{class:'ms-klein'},WOCHENTAG_KURZ[d.getDay()]+' '+pad(d.getDate())+'.'+pad(d.getMonth()+1)+'., '+pad(d.getHours())+':'+pad(d.getMinutes())+' · '+
        (neu===0?'seitdem keine neuen Einträge':neu===1?'seitdem 1 neuer Eintrag':'seitdem '+neu+' neue Einträge')));
  }).catch(()=>{});
}
function renderMehr(){
  const wrap=$('view-mehr'), n=vault.events.length;
  const zeile=(l,w,id)=>el('div',{class:'zeile'},el('span',{},l),el('span',{class:'wert',id},w));
  // Segment-Wahl an Ort und Stelle: Fokus und Lage bleiben, kein Neubau der Ansicht (Prüfer 04.10., Fokus-Regel)
  const waehleImSeg=b=>{ for(const x of b.parentElement.children){ const an=x===b; x.classList.toggle('still',!an); x.setAttribute('aria-pressed',String(an)); } };
  // Schalter wie die Beamer-Optionen (Scheibe 5): die ganze Zeile ist das Ziel, die Wahl gilt sofort
  const schalter=(key,label,unter,an)=>{
    const b=el('button',{type:'button',class:'btn still schalter',role:'switch','aria-checked':String(an),dataset:{opt:key},
      onclick:()=>{ const neu=b.getAttribute('aria-checked')!=='true'; b.setAttribute('aria-checked',String(neu)); localStorage.setItem(key,neu?'1':'0'); }},
      el('span',{class:'schalter-text'},el('b',{},label),el('small',{},unter)),el('span',{class:'schalter-knopf','aria-hidden':'true'}));
    return b; };
  // Sichern & Übertragen: den Stand der letzten Sicherung füllt sicherungsKopf() nach dem Einhängen
  const stand=el('div',{class:'ms-kopf',id:'ms-stand'});
  const datei=el('input',{type:'file',id:'file-cont',accept:'.enc,application/octet-stream',class:'hidden'}); datei.onchange=importiereContainer;
  const sichern=el('div',{class:'panel'},el('h2',{},'Sichern & Übertragen'),stand,
    el('div',{class:'btn-reihe'},el('button',{class:'btn',id:'btn-export',onclick:exportiereContainer},'Sicherung speichern'),
      el('button',{class:'btn still',id:'btn-import',onclick:()=>datei.click()},'Sicherung einlesen')),
    el('p',{class:'u-hinweis'},'Die Datei ist verschlüsselt und öffnet sich nur mit deiner Passphrase. Mit ihr kommt die Kladde auch auf dein zweites Gerät. Am iPad: „In Dateien sichern“ → Ordner am PC.'),datei);
  // Abgleich mit dem PC gibt es nur in der Heimnetz-Instanz (auf github.io fehlt der Server)
  let pc=null;
  if(!PAGES_KONTEXT){
    const st=el('span',{id:'sync-status',class:'u-hinweis u-selfcenter'});
    pc=el('div',{class:'panel'},el('h2',{},'Mit dem PC abgleichen'),
      el('div',{class:'btn-reihe'},el('button',{class:'btn',id:'btn-push',onclick:syncPush},'An den PC senden'),el('button',{class:'btn',id:'btn-pull',onclick:syncPull},'Vom PC holen'),st));
    fetch('/api/kladde/status',{cache:'no-store'}).then(r=>r.json()).then(s=>{ st.textContent='PC erreichbar · Zertifikat bis '+s.zert_bis; }).catch(()=>{ st.textContent='PC nicht erreichbar'; });
  }
  // Sicherheit: Minuten mit einem Tipp, Schalter statt 22-px-Kästchen
  const lockSeg=el('span',{class:'seg',role:'group','aria-label':'Automatisch sperren nach'},...[5,10,15,30].map(m=>el('button',{type:'button',class:'btn'+(lockMinuten()===m?'':' still'),
    'aria-pressed':String(lockMinuten()===m),dataset:{lockMin:String(m)},onclick:e=>{ localStorage.setItem('kladde_lock_min',String(m)); toast('Sperrt nach '+m+' min'); waehleImSeg(e.currentTarget); }},m+' min')));
  const bio=el('span',{id:'sec-bio'},'…');
  idbGet('bio').then(b=>{
    if(!bioVerfuegbar()){ bio.replaceChildren(el('span',{class:'u-hinweis'},'hier nicht verfügbar')); return; }
    bio.replaceChildren(b?el('button',{class:'btn still u-btn-klein',onclick:bioEntfernen},'eingerichtet · entfernen'):el('button',{class:'btn u-btn-klein',onclick:bioEinrichten},'einrichten…'));
  });
  const sicherheit=el('div',{class:'panel'},el('h2',{},'Sicherheit'),
    el('div',{class:'ms-block'},el('span',{},'Automatisch sperren nach'),lockSeg),
    el('div',{class:'schalter-liste'},
      schalter('kladde_lock_sofort','Beim Verlassen sofort sperren','Sonst deckt die Kladde beim App-Wechsel nur ab.',localStorage.getItem('kladde_lock_sofort')==='1'),
      schalter('kladde_lock_unterricht','Im Unterricht nicht sperren','Während einer Stunde läuft die Zeit oben nicht ab.',localStorage.getItem('kladde_lock_unterricht')!=='0')),
    el('div',{class:'zeile'},el('span',{},'Fingerabdruck / Face ID'),bio),
    el('div',{class:'btn-reihe'},el('button',{class:'btn still',id:'sec-pass',onclick:passphraseWechselDialog},'Passphrase ändern…')));
  // Darstellung: Tag/Nacht/System (Zero-Entscheid E1: Default Nacht) als eigene Zeile, damit „System“ am Handy nicht am Rand klebt
  const themeBtn=(p,txt)=>el('button',{type:'button',class:'btn'+(themePref()===p?'':' still'),'aria-pressed':String(themePref()===p),onclick:e=>{ localStorage.setItem(THEME_KEY,p); themeAnwenden(); waehleImSeg(e.currentTarget); }},txt);
  const darstellung=el('div',{class:'panel'},el('h2',{},'Darstellung'),
    el('div',{class:'ms-block'},el('span',{},'Erscheinungsbild'),el('span',{class:'seg',role:'group','aria-label':'Erscheinungsbild'},themeBtn('tag','Tag'),themeBtn('nacht','Nacht'),themeBtn('system','System'))),
    el('p',{class:'u-hinweis'},'System folgt dem Gerät. Der Mond/Sonne-Knopf oben schaltet schnell zwischen Tag und Nacht.'));
  // Technik: eingeklappt, in Alltagssprache (vorher „Werkstatt“ mit persist(), Log-Zähler, Formel offen)
  const standalone=window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true, k=kurs();
  const technik=el('details',{class:'panel ms-technik'},
    el('summary',{},el('span',{},'Technik'),el('span',{class:'wert'},'v'+APP_VERSION)),
    zeile('Version','v'+APP_VERSION+' · '+GERAET+(PAGES_KONTEXT?' · Pages':' · Heimnetz')),
    zeile('Läuft als',standalone?'installierte App':'Browser-Tab'),
    zeile('Speicher dauerhaft','…','dg-persist'),
    zeile('Speicher belegt','…','dg-quota'),
    zeile('Einträge gesamt',String(n)),
    k?el('div',{class:'ms-block ms-regel'},el('span',{},'Notenregel '+k.name),el('span',{class:'u-hinweis'},regelText(bewertProfil(k)))):null);
  if(navigator.storage?.persisted) navigator.storage.persisted().then(p=>{ const z=$('dg-persist'); if(z) z.textContent=p?'ja':'nein (der Browser darf räumen)'; });
  if(navigator.storage?.estimate) navigator.storage.estimate().then(e=>{ const z=$('dg-quota'); if(z) z.textContent=((e.usage||0)/1048576).toFixed(1)+' MB'; });
  // Zwei FESTE Spalten (Zero-Feldtest 10.07.), verteilt nach Höhe: links Sichern (+ PC) und Darstellung, rechts Sicherheit und Technik.
  // Am Handy dieselbe Reihenfolge untereinander. Der Datenschutz-Satz steht am Fuß über beiden Spalten.
  wrap.replaceChildren(el('div',{class:'mehr-spalte'},sichern,pc,darstellung),el('div',{class:'mehr-spalte',id:'mehr-spalte-b'},sicherheit,technik),
    el('p',{class:'ms-satz'},DATENSCHUTZ_SATZ));
  sicherungsKopf();
}
async function aktuellerContainerBlob(){
  await speichern();
  if(speicherFehler) throw new Error('Speichern fehlgeschlagen — die Datei hätte einen alten Stand');
  return idbGet('vault');
}
function exportiereContainer(){
  // Export-Warnung (Konzept §2) — sensibilisieren, dann die bewährte Kaskade
  dlgZeigen('<h3>Sicherung speichern</h3>'+
    '<p>Diese Datei enthält deine Kladde verschlüsselt. Sie kann nur mit deiner Passphrase geöffnet werden.</p>'+
    '<p class="u-hinweis">Die Sicherheit hängt von der Stärke deiner Passphrase ab. Bewahre die Datei geschützt auf.</p>'+
    '<div class="btn-reihe"><button class="btn" data-ok>Speichern</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
    el=>{ el.querySelector('[data-ok]').onclick=()=>{ dlgZu(); exportiereContainerJetzt(); }; });
}
let exportInSitzung=false; // für Schuljahr-Assistent: „Weiter" erst nach echtem Export
function merkeExport(){
  exportInSitzung=true; if(vault) idbPut('letzterExport',{ts:Date.now(),events:vault.events.length}).then(sicherungsKopf).catch(()=>{});   // „Mehr“ offen: Kopf gleich nachziehen
  // Die v1-Sicherung aus der Umstellung v1→v2 trägt den alten Stand (auch längst gelöschte Kurse) mit der alten Passphrase.
  // Mit einer v2-Sicherung hat sie ihren Zweck erfüllt (Prüfer 2026-09-29: „Endgültig löschen“ war nicht endgültig).
  idbDel('vault_v1_backup').catch(()=>{});
}
async function exportiereContainerJetzt(){
  let bytes, name;
  try {
    bytes=await aktuellerContainerBlob();
    name='kladde-'+GERAET+'-'+heuteIso()+'.enc';
  } catch(err){ toast('⚠ Sicherung: '+err.message,4000); return; }
  // FEHLER:519-Kaskade: share primär (iOS), bei Nicht-Abbruch-Fehler → Download-Fallback
  const file=new File([bytes],name,{type:'application/octet-stream'});
  if(navigator.canShare&&navigator.canShare({files:[file]})){
    try {
      await navigator.share({files:[file],title:'Kladde-Sicherung'});
      merkeExport();
      toast('Sicherung übergeben');
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
  toast('Sicherung wird gespeichert: '+name);
}
async function importiereContainer(e){
  const f=e.target.files[0]; e.target.value=''; if(!f) return;
  const gen=sperrGen;
  const pin=await passphraseAbfragen('Passphrase der Sicherung'); if(!pin) return;
  const bytes=new Uint8Array(await f.arrayBuffer());
  let fremd;
  try {
    fremd=(await decodeContainerAuto(bytes,pin)).daten;
  } catch{
    // Container eines Geräts mit ANDERER Passphrase: einmal nach deren Passphrase fragen — vorher endete der Import nur mit
    // „gleiche Passphrase auf beiden Geräten?“. Deine eigene Passphrase bleibt unverändert.
    if(!nochOffen(gen)) return;
    const fremdPin=await passphraseAbfragen('Passphrase dieser Sicherung','Mit deiner Passphrase ließ sich die Datei nicht öffnen. Stammt sie von einem Gerät mit anderer Passphrase, gib diese hier ein. Deine eigene bleibt unverändert.');
    if(!fremdPin) return;
    try { fremd=(await decodeContainerAuto(bytes,fremdPin)).daten; }
    catch(err){ toast('⚠ Einlesen: '+err.message,5000); return; }
  }
  if(!nochOffen(gen)) return;   // während PBKDF2 gesperrt → nichts mehr anfassen
  if(!schemaBekannt(fremd.schema)){ toast('⚠ Diese Sicherung ('+fremd.schema+') stammt aus einer neueren App — bitte die App aktualisieren (neu laden).',6000); return; }
  // Import-Vorschau (Konzept §3): erst zeigen, dann mergen — nie still
  const eigeneIds=new Set(vault.events.map(x=>x.id));
  const neue=(fremd.events||[]).filter(x=>!eigeneIds.has(x.id)).length;
  const dry=mergeContainerDaten(vault,fremd);
  dlgZeigen('<h3>Sicherung erkannt</h3>'+
    '<div class="zeile"><span>Quelle</span><span class="wert">'+esc(fremd.stamm?.geraet||'?')+'</span></div>'+
    '<div class="zeile"><span>Letzter Stand</span><span class="wert">'+esc(String(fremd.stamm?.ts||'?').slice(0,16).replace('T',' '))+'</span></div>'+
    '<div class="zeile"><span>Kurse</span><span class="wert">'+(fremd.stamm?.kurse?.length||0)+'</span></div>'+
    '<div class="zeile"><span>Ereignisse</span><span class="wert">'+(fremd.events?.length||0)+' · davon '+neue+' neu</span></div>'+
    (dry.konflikte.length
      ?dry.konflikte.slice(0,5).map(t=>'<p class="u-warn13">'+iconHtml('warnung')+' '+esc(t)+'</p>').join('')+(dry.konflikte.length>5?'<p class="u-hinweis">… und '+(dry.konflikte.length-5)+' weitere</p>':'')
      :'<p class="u-hinweis">Keine Stammdaten-Konflikte.</p>')+
    // Sicherer Import (Zero 2026-09-29): was nur im anderen Stand stand, wird ergänzt — vorher ging es still verloren
    (dry.hinweise&&dry.hinweise.length?'<p class="u-hinweis">Ergänzt aus dem anderen Stand: '+esc(dry.hinweise.slice(0,4).join(' · '))+(dry.hinweise.length>4?' · … ('+dry.hinweise.length+')':'')+'</p>':'')+
    '<div class="btn-reihe"><button class="btn" data-ok>Einlesen und zusammenführen</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
    el=>{ el.querySelector('[data-ok]').onclick=async()=>{
      dlgZu();
      if(!nochOffen(gen)) return;
      // Verworfener Stand liegt bei (max 3, FIFO) — gerätelokal informativ, überlebt eigene Saves
      if(dry.verworfen){
        (dry.daten.verworfeneStaende=vault.verworfeneStaende||[]).push(dry.verworfen);
        while(dry.daten.verworfeneStaende.length>3) dry.daten.verworfeneStaende.shift();
      } else if(vault.verworfeneStaende){ dry.daten.verworfeneStaende=vault.verworfeneStaende; }
      vault=dry.daten; stammOhneBump(); await speichern();
      toast('Zusammengeführt: '+vault.events.length+' Einträge'+(dry.konflikte.length?' · ⚠ '+dry.konflikte[0]:''),dry.konflikte.length?6000:2600);
      kursAutowahl(); renderAlles();
    }; });
}
function stammOhneBump(){ /* Merge-Ergebnis behält die Sieger-rev — bewusst kein rev++ */ }
function passphraseWechselDialog(){
  dlgZeigen('<h3>Passphrase ändern</h3>'+
    '<p class="u-warn13">Wichtig: auf BEIDEN Geräten ändern — sonst brauchst du für jede Sicherung des anderen Geräts dessen Passphrase.</p>'+
    // Ehrlich statt beruhigend (Prüfer 2026-09-29, gemessen): der innere Datenschlüssel bleibt gleich. Ihn zu erneuern hat Zero
    // abgelehnt („nicht nötig“) — dann muss der Text aber sagen, was der Wechsel NICHT leistet.
    '<p class="u-hinweis">Bereits gespeicherte Sicherungen öffnen sich weiter mit der alten Passphrase. Der innere Datenschlüssel bleibt derselbe: Wer die alte Passphrase und eine alte Sicherung hat, kann auch künftige Sicherungen öffnen. Der Wechsel schützt also vor dem Weitergeben der neuen, nicht vor einer schon bekannten alten Passphrase.</p>'+
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
      const gen=sperrGen;
      try{
        await speichern();
        const blob=await idbGet('vault');
        const g=await wechslePassphrase(blob,alt,neu);   // zweimal PBKDF2 + DEK-Rewrap
        if(!nochOffen(gen)){ feh.textContent=''; return; }   // inzwischen gesperrt: nichts schreiben, Schlüssel nicht zurück in den RAM
        await idbPut('vault',g.bytes);
        dekKey=g.dek; containerKopf=g.kopf;
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
    merkeExport(); // Sicherung liegt jetzt auf dem PC — zählt als Sicherung (Backup-Banner)
    toast('An den PC gesendet · Stand '+j.generationen);
  } catch(err){ toast('⚠ An den PC: '+err.message,4000); }
}
async function syncPull(){
  try {
    const von=GERAET==='pc'?'ipad':'pc';
    const r=await fetch('/api/kladde/pull/'+von,{cache:'no-store'});
    if(r.status===404){ toast('Noch keine Sicherung von „'+von+'" auf dem PC'); return; }
    if(!r.ok) throw new Error('HTTP '+r.status);
    const gen=sperrGen;
    const pin=await passphraseAbfragen('Passphrase der Sicherung vom PC'); if(!pin) return;
    const fremd=(await decodeContainerAuto(new Uint8Array(await r.arrayBuffer()),pin)).daten;
    if(!nochOffen(gen)) return;
    if(!schemaBekannt(fremd.schema)){ toast('⚠ Diese Sicherung ('+fremd.schema+') stammt aus einer neueren App — bitte die App aktualisieren.',6000); return; }
    const dry=mergeContainerDaten(vault,fremd);
    const anwenden=async()=>{
      if(!nochOffen(gen)) return;
      if(vault.verworfeneStaende&&!dry.daten.verworfeneStaende) dry.daten.verworfeneStaende=vault.verworfeneStaende;
      vault=dry.daten; await speichern();
      toast('Vom PC geholt: '+vault.events.length+' Einträge'+(dry.konflikte.length?' · ⚠ '+dry.konflikte[0]:''),dry.konflikte.length?6000:2600);
      kursAutowahl(); renderAlles();
    };
    // Ein Handgriff bleibt ein Handgriff — Bestätigung NUR bei Stammdaten-Konflikt (P1.6)
    if(dry.konflikte.length){
      dlgZeigen('<h3>Stammdaten-Konflikt</h3><p class="u-fs14">'+esc(dry.konflikte[0])+'</p>'+
        '<div class="btn-reihe"><button class="btn" data-ok>Übernehmen</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
        el=>{ el.querySelector('[data-ok]').onclick=()=>{ dlgZu(); anwenden(); }; });
    } else await anwenden();
  } catch(err){ toast('⚠ Vom PC: '+err.message+' (richtige Passphrase?)',4500); }
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
    zeigeBanner('<span>Kladde nutzt jetzt das schnellere Format v2. Empfohlen: einmal sichern (deine bisherige Sicherung bleibt mit alter Passphrase lesbar).</span><button class="btn" data-exp>Jetzt sichern</button>',
      b=>{ b.querySelector('[data-exp]').onclick=()=>{ b.classList.add('hidden'); exportiereContainer(); }; });
    return;
  }
  // Einmaliger, nicht blockierender Hinweis für Bestands-Kurz-PINs (§1.3 — kein Zwang, Zwang erzeugt Post-its)
  if(anmeldung==='pass'&&passSchwach&&!localStorage.getItem('kladde_pass_hinweis')){
    localStorage.setItem('kladde_pass_hinweis','1');
    zeigeBanner('<span>Deine PIN ist kurz — für echte Schülerdaten ist eine Passphrase (12+ Zeichen) empfohlen: Mehr → Sicherheit → Passphrase ändern.</span>');
    return;
  }
  // Fingerabdruck-Einstieg (Zero 2026-09-02): ein Knopf, der erst nach einer Einrichtung erscheint, braucht einen
  // sichtbaren Weg dorthin. Einmalig nach einem Passphrase-Login, wenn das Gerät WebAuthn kann und noch keine Hülle liegt;
  // × merkt sich die Ablehnung dauerhaft (localStorage), „Einrichten" führt direkt in bioEinrichten.
  if(anmeldung==='pass'&&bioVerfuegbar()&&!localStorage.getItem('kladde_bio_hinweis')&&!(await idbGet('bio'))){
    zeigeBanner('<span>Schneller öffnen: Fingerabdruck / Face ID einrichten — die Passphrase bleibt als Rückweg.</span><button class="btn" data-bio>Einrichten</button>',
      b=>{ b.querySelector('[data-bio]').onclick=()=>{ b.classList.add('hidden'); bioEinrichten(); };
           b.querySelector('[data-zu]').addEventListener('click',()=>localStorage.setItem('kladde_bio_hinweis','1')); });
    return;
  }
  // Backup-Erinnerung (P1.5): das realste Verlustszenario ist Gerätedefekt/Speicherbereinigung, nicht der Angreifer
  try{
    const le=await idbGet('letzterExport');
    const tage=le?tageSeit(le.ts):Infinity;   // Kalendertage wie in „Mehr → Sichern“ (Scheibe 7)
    if(tage>7&&vault&&vault.events.length>(le?.events??0)){
      zeigeBanner('<span>Letzte Sicherung '+(le?'vor '+tage+' Tagen':'noch nie')+' — jetzt sichern?</span><button class="btn" data-exp>Jetzt sichern</button>',
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
BTN_BEAMER.classList.toggle('aktiv',beamerModus); BTN_BEAMER.setAttribute('aria-pressed',String(beamerModus));
$('beamer-hinweis').classList.toggle('hidden',!beamerModus);
BTN_BEAMER.replaceChildren(iconEl('auge')); $('pin-auge').replaceChildren(iconEl('auge'));
$('lock-bio').prepend(iconEl('finger'));
document.querySelectorAll('#lock-erklaer [data-ikon]').forEach(li=>li.prepend(iconEl(li.dataset.ikon)));
werkzeug($('btn-plan'),'plan','Plan'); werkzeug($('btn-lock'),'schloss','Sperren'); werkzeug($('btn-hilfe'),'info','Hilfe');
$('btn-menue').replaceChildren(iconEl('mehrPunkte'));
$('btn-hilfe-k').replaceChildren(iconEl('info'));
$('beamer-hinweis').querySelector('span').prepend(iconEl('auge'),' ');   // Emoji→Linien-Icons: index.html trägt keine Symbole mehr, JS setzt sie (eine Quelle)
lockInit({auto:true});   // App geöffnet: mit Fingerabdruck-Hülle startet die Abfrage von selbst (Zero 05.10. „Fingerabdruck zuerst“)
