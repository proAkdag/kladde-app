// Kladde · js/ansichten/sperre.mjs — Abschnitt „PIN / LOCK + FINGERABDRUCK / FACE ID“ (A2 Schnitt 4: wörtlich aus js/app.mjs, verhaltensneutral).
// Ansichten dürfen einander direkt importieren, der Kern (js/kern/) nie eine Ansicht (Zero 19.10.: „Direkt, Kern ringfrei“).
import { bereinigeAusnahmen, slotFuerBlock } from '../../logic/autowahl.mjs?v=2.4.1.1792548369';
import { bioUnwrap, bioWrap } from '../../logic/biometrie.mjs?v=2.4.1.1792548369';
import { decodeContainerAuto, decodeContainerMitDek, dekRohMitPassphrase, importDekKey, neueV2Identitaet } from '../../logic/container.mjs?v=2.4.1.1792548369';
import { sichereRoh } from '../../logic/identitaet.mjs?v=2.4.1.1792548369';
import { migriereStamm } from '../../logic/migration.mjs?v=2.4.1.1792548369';
import { istFerien, resolveBloecke } from '../../logic/zeitmodell.mjs?v=2.4.1.1792548369';
import { dlgZeigenEl, dlgZu } from '../kern/dialog.mjs?v=2.4.1.1792548369';
import { $, el, toast } from '../kern/dom.mjs?v=2.4.1.1792548369';
import { iconEl } from '../kern/icons.mjs?v=2.4.1.1792548369';
import { idbDel, idbGet, idbPut, leererVault, setzeAnmeldung, setzeMigrationsHinweis, setzeSchluessel, speicherFehler, speicherKette, speichern, sperrGenWeiter } from '../kern/tresor.mjs?v=2.4.1.1792548369';
import { IST_DEV } from '../kern/umgebung.mjs?v=2.4.1.1792548369';
import { aktView, editorAktiv, heuteIso, setzeEditorAktiv, setzeVault, terminAufHeute, vault } from '../kern/zustand.mjs?v=2.4.1.1792548369';
import { zeigeStartHinweise } from './banner.mjs?v=2.4.1.1792548369';
import { setzeDeckListe, setzeDeckVerlauf } from './deck.mjs?v=2.4.1.1792548369';
import { kurs, setzeAktiverSchueler, undoStack } from './eintraege.mjs?v=2.4.1.1792548369';
import { editorCleanup, setzeEditorCleanup } from './kurse.mjs?v=2.4.1.1792548369';
import { kursAutowahl, starteAutowahlTick, wochenplanAktiv } from './kurswahl.mjs?v=2.4.1.1792548369';
import { renderMehr } from './mehr.mjs?v=2.4.1.1792548369';
import { renderAlles, setzeViewTitel } from './navigation.mjs?v=2.4.1.1792548369';
import { setzeOffenerSchueler, setzeOffeneZeile } from './schueler.mjs?v=2.4.1.1792548369';
import { hilfeNeu, stempelAus } from './stempel.mjs?v=2.4.1.1792548369';

/* ═══ PIN / LOCK (Auto-Lock 15 min · visibilitychange-Flush) ═══ */

let lockTimer=null, zuletztAktiv=Date.now();

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
// v2.2 (Schema kladde/v3, Identität): vor der ersten v3-Schreibung den gelesenen Container sichern, mit Rücklese-Prüfung — dasselbe
// Muster wie v1→v2 (Auflage 1). Scheitert sie, wird nichts migriert gespeichert. Einmalig: ein v3-Tresor braucht keine Sicherung mehr.
async function sichereVorV3(roh,daten){
  if(daten&&daten.schema==='kladde/v3') return;
  await sichereRoh(roh,v=>idbPut('vault_v2_backup',v),()=>idbGet('vault_v2_backup'));   // rein und getestet (logic/identitaet, Prüfer 20.10. G5)
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
      setzeSchluessel(id.dek,id.kopf);
      setzeAnmeldung('pass',passStaerke(pin)==='schwach'); setzeVault(leererVault());
      migriereStamm(vault);   // derselbe Stand wie nach dem Entsperren: Schuljahr mit Zeiträumen sofort da (Codex 07.10. B3: Q1 ging erst nach Sperren)
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
          setzeSchluessel(id.dek,id.kopf);
          setzeVault(r.daten); setzeAnmeldung('pass',passStaerke(pin)==='schwach');
          migriereStamm(vault); // Schema kladde/v2 (P2.1) — idempotent
          bereinigeAusnahmen(vault.stamm); // folgenlose Entfälle auf freien Stunden räumen (2026-09-02)
          await speichern(); // erste v2-Schreibung — erst NACH verifiziertem Backup
          setzeMigrationsHinweis(true);
          console.log('[kladde] v1→v2 migriert (Backup verifiziert) in',Math.round(performance.now()-t0),'ms');
        } else {
          await sichereVorV3(roh,r.daten);   // v2.2: erst gesichert, dann v3
          setzeSchluessel(r.dek,r.kopf);
          setzeVault(r.daten); setzeAnmeldung('pass',passStaerke(pin)==='schwach');
          const migriert=migriereStamm(vault); // Schema-Nachzug (v0.8-Bestand → kladde/v2 → v3)
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
    await sichereVorV3(roh,r.daten);   // v2.2: erst gesichert, dann v3
    if(lauf.signal.aborted) return;
    setzeSchluessel(r.dek,r.kopf); setzeVault(r.daten); setzeAnmeldung('bio',false);
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
  $('sp-editor-bar')?.remove(); document.querySelector('.sp-ohne')?.remove(); setzeEditorAktiv(false); setzeEditorCleanup(null); document.body.classList.remove('sp-edit','sp-dragging');
  sperrGenWeiter(); setzeVault(null); setzeSchluessel(null,null); setzeAnmeldung(null,false);
  if(tabSperreFrei){ tabSperreFrei(); tabSperreFrei=null; }   // anderer Tab darf jetzt entsperren
  setzeAktiverSchueler(null); setzeOffenerSchueler(null); setzeOffeneZeile(null); setzeDeckListe([]); setzeDeckVerlauf([]); undoStack.length=0;
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
  $('kurs-name').textContent='Kein Kurs'; $('kurs-slot').textContent=''; $('kurs-chip').classList.remove('nachtrag');
  ['deck-nachtrag','schueler-nachtrag'].forEach(id=>{ $(id).hidden=true; $(id).replaceChildren(); delete $(id).dataset.text; });
  $('datum-streifen').className='';   // der Nachtrag-Rand des Streifens blieb hinter dem Lock stehen (Prüfer 06.10., B10)
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


export { lockTimer, zuletztAktiv, passStaerke, bioAuto, bioLauf, lockMeldung, augeSetzen, lockInit, BIO_RP, bioVerfuegbar, bioSecret, bioAutostart, bioEntsperren, bioEinrichten, bioEntfernen, passphraseAbfragen, aufloesenBeiClose, sperren, lockMinuten, zeitAbgelaufen, unterrichtAktiv, tabSperreFrei, tabSperreHolen, entsperrt, zurueckInDieApp, sperrenWennGespeichert };
