// Kladde · js/kern/tresor.mjs — IndexedDB, Schlüssel im RAM, seriell verschlüsselt speichern (A2 Schnitt 3: wörtlich aus js/app.mjs, verhaltensneutral; der Kern kennt keine Ansicht)
import { encodeContainerV2 } from '../../logic/container.mjs?v=2.1.0.1792442217';
import { hebeLoeschungAuf } from '../../logic/merge.mjs?v=2.1.0.1792442217';
import { kompaktiere as spKompaktiere } from '../../logic/sitzplan.mjs?v=2.1.0.1792442217';
import { toast } from './dom.mjs?v=2.1.0.1792442217';
import { GERAET, IST_DEV } from './umgebung.mjs?v=2.1.0.1792442217';
import { vault, aktiverKursId, editorAktiv } from './zustand.mjs?v=2.1.0.1792442217';

/* ═══ STORAGE · Vault = KLD1-Container in IndexedDB ═══ */
const DB_NAME=IST_DEV?'kladde_dev':'kladde_v1'; // getrennte Vaults für Dev- und Produktiv-Instanz
let db=null;                               // vault (entschlüsselter Zustand im RAM) liegt in kern/zustand.mjs
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

// ── Setter (die einzigen Schreibstellen von außen) ──
function setzeSchluessel(dek,kopf){ dekKey=dek; containerKopf=kopf; }
function setzeAnmeldung(art,schwach){ anmeldung=art; passSchwach=schwach; }
function sperrGenWeiter(){ sperrGen++; }
function setzeMigrationsHinweis(an){ migrationsHinweis=an; }

export { DB_NAME, dekKey, containerKopf, anmeldung, passSchwach, sperrGen, nochOffen, migrationsHinweis, mitDb, idbGet, idbPut, idbDel, speicherKette, speicherFehler, speichern, leererVault, stammMutiert, setzeSchluessel, setzeAnmeldung, sperrGenWeiter, setzeMigrationsHinweis };
