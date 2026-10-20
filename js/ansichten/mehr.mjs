// Kladde · js/ansichten/mehr.mjs — Abschnitt „MEHR“ (A2 Schnitt 4: wörtlich aus js/app.mjs, verhaltensneutral).
// Ansichten dürfen einander direkt importieren, der Kern (js/kern/) nie eine Ansicht (Zero 19.10.: „Direkt, Kern ringfrei“).
import { decodeContainerAuto, wechslePassphrase } from '../../logic/container.mjs?v=2.3.0';
import { mergeContainerDaten, uebernehmeMerge } from '../../logic/merge.mjs?v=2.3.0';
import { migriereStamm, schemaBekannt } from '../../logic/migration.mjs?v=2.3.0';
import { regelText } from '../../logic/verdichtung.mjs?v=2.3.0';
import { dlgZeigen, dlgZeigenEl, dlgZu } from '../kern/dialog.mjs?v=2.3.0';
import { $, el, esc, toast } from '../kern/dom.mjs?v=2.3.0';
import { iconHtml } from '../kern/icons.mjs?v=2.3.0';
import { THEME_KEY, themeAnwenden, themePref } from '../kern/theme.mjs?v=2.3.0';
import { idbDel, idbGet, idbPut, nochOffen, setzeSchluessel, speicherFehler, speichern, sperrGen } from '../kern/tresor.mjs?v=2.3.0';
import { GERAET, PAGES_KONTEXT } from '../kern/umgebung.mjs?v=2.3.0';
import { heuteIso, setzeVault, vault } from '../kern/zustand.mjs?v=2.3.0';
import { bewertProfil, kurs, WOCHENTAG_KURZ } from './eintraege.mjs?v=2.3.0';
import { kursAutowahl } from './kurswahl.mjs?v=2.3.0';
import { renderAlles } from './navigation.mjs?v=2.3.0';
import { aufloesenBeiClose, bioEinrichten, bioEntfernen, bioVerfuegbar, lockMinuten, passphraseAbfragen } from './sperre.mjs?v=2.3.0';
import { APP_VERSION } from '../app.mjs?v=2.3.0';
import { aktualisieren, updateBereit } from '../kern/update.mjs?v=2.3.0';

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
    const wann=tage<=0?'heute':tage===1?'gestern':'vor '+tage+' Tagen';   // Download: angestoßen, nicht bestätigt (Review §8)
    stand.replaceChildren(el('b',{class:'ms-gross'},le.art==='download'?'Download '+wann+' gestartet':tage<=0?'Heute gesichert':tage===1?'Gestern gesichert':'Gesichert vor '+tage+' Tagen'),
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
    // Kopplung einmal je Gerät (Codex 07.10. S1) — die Zeile erscheint nur, wenn der PC erreichbar ist und dieses Gerät noch nicht gekoppelt
    const code=el('input',{type:'text',id:'sync-code',autocomplete:'off',autocapitalize:'off',spellcheck:'false',placeholder:'abcd-1234',class:'u-w110','aria-label':'Kopplungscode'});
    code.onkeydown=e=>{ if(e.key==='Enter') koppeln(code.value); };
    const koppel=el('div',{class:'zeile hidden',id:'sync-koppel'},el('span',{},'Kopplungscode'),
      el('span',{},code,' ',el('button',{class:'btn still',id:'btn-koppeln',onclick:()=>koppeln(code.value)},'Koppeln')));
    pc=el('div',{class:'panel'},el('h2',{},'Mit dem PC abgleichen'),
      el('div',{class:'btn-reihe'},el('button',{class:'btn',id:'btn-push',onclick:syncPush},'An den PC senden'),el('button',{class:'btn',id:'btn-pull',onclick:syncPull},'Vom PC holen'),st),koppel);
    fetch('/api/kladde/status',{cache:'no-store',headers:kopplungKopf()}).then(r=>r.json()).then(s=>{
      st.textContent='PC erreichbar · '+(s.gekoppelt?'gekoppelt':'nicht gekoppelt')+' · Zertifikat bis '+s.zert_bis;
      koppel.classList.toggle('hidden',!!s.gekoppelt);
    }).catch(()=>{ st.textContent='PC nicht erreichbar'; });
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
  // Excel bleibt als Vorlage zum Mitnehmen (Zero 19.10.: „soll der Excel weg aber auch bleiben und als Vorlage auch runterladbar sein“)
  const vorlage=el('div',{class:'panel'},el('h2',{},'Excel-Vorlage'),
    el('div',{class:'btn-reihe'},...VORLAGEN.map(v=>el('button',{class:'btn still',dataset:{vorlage:v.id},onclick:()=>vorlageHerunterladen(v)},v.knopf))),
    el('p',{class:'u-hinweis'},'Leere Klassenmappe für Excel, für alle, die dort weiterarbeiten möchten. Die Kladde braucht sie nicht.'));
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
  // Update (Zero 20.10.): nach × im Hinweis der Weg hierher; nur sichtbar, solange eine neue Fassung bereitliegt
  const update=updateBereit()?el('div',{class:'panel',id:'ms-update'},el('h2',{},'Update'),
    el('p',{},'Neues Update verfügbar.'),
    el('div',{class:'btn-reihe'},el('button',{class:'btn',onclick:()=>aktualisieren()},'Aktualisieren'))):null;
  wrap.replaceChildren(el('div',{class:'mehr-spalte'},sichern,pc,darstellung,vorlage),el('div',{class:'mehr-spalte',id:'mehr-spalte-b'},update,sicherheit,technik),
    el('p',{class:'ms-satz'},DATENSCHUTZ_SATZ));
  sicherungsKopf();
}
const VORLAGEN=[
  {id:'seki',knopf:'Klassenmappe Sek I',datei:'./vorlagen/Klassenmappe_SekI_Vorlage_v15.2.xlsx'},
  {id:'sekii',knopf:'Kursmappe Oberstufe',datei:'./vorlagen/Kursmappe_Oberstufe_Vorlage_v15.2.xlsx'}];
// Selbst holen und prüfen statt nackter Link: offline liefert der Service Worker bei einem Fehlgriff index.html (service-worker.js),
// die als „.xlsx“ gespeichert würde. Eine Excel-Datei ist ein ZIP und beginnt mit „PK“.
async function vorlageHerunterladen(v){
  const name=v.datei.split('/').pop();
  let bytes;
  try{
    const r=await fetch(v.datei,{cache:'no-store'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    bytes=new Uint8Array(await r.arrayBuffer());
    if(bytes.length<4||bytes[0]!==0x50||bytes[1]!==0x4b) throw new Error('keine Excel-Datei erhalten');
  }catch(err){ toast('⚠ Vorlage nicht geladen ('+err.message+') — dafür braucht die App Netz',5000); return; }
  const file=new File([bytes],name,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  if(navigator.canShare&&navigator.canShare({files:[file]})){
    try{ await navigator.share({files:[file],title:name}); return; }
    catch(err){ if(err.name==='AbortError') return; }   // sonst Download wie bei der Sicherung
  }
  const url=URL.createObjectURL(file);
  const a=document.createElement('a'); a.href=url; a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('Download gestartet: '+name,4000);
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
// Ein Browser-Download sagt nach a.click() nicht, ob die Datei angekommen ist (Review 19.10. §8). Er zählt als „gestartet“:
// der Kopf sagt es so, und das Schuljahr-Tor öffnet erst, wenn du bestätigst, dass die Datei sichtbar da liegt.
let downloadGestartet=false;
function merkeExport(art){
  if(art==='download'){ downloadGestartet=true; if(vault) idbPut('letzterExport',{ts:Date.now(),events:vault.events.length,art:'download'}).then(sicherungsKopf).catch(()=>{});
    idbDel('vault_v1_backup').catch(()=>{}); return; }   // wie vor v2.1 (Prüfer 19.10. B1): die v1-Sicherung trägt längst gelöschte Kurse
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
  merkeExport('download');
  toast('Download gestartet: '+name+' — bitte nachsehen, ob die Datei angekommen ist',5000);
}
// Unterschiede zweier Stände (merge.mjs: Schülerliste je Kurs mit Fach, zuletzt ein reiner Stand-Konflikt) — Import-Vorschau und „Vom PC holen“
// zeigen dieselbe Liste, bis zu fünf Meldungen (Prüfer P2, Zero 06.10. „Text klarer, Abfrage bleibt“)
// ── Fragen des Abgleichs (v2.2 Identität, Zero 19.10. „Fragen: dasselbe Kind?“) ──
// logic/merge.mjs liefert `fragen`: 'zwei' = gleiche Nummer aus der Zeit vor v2.2, anderer Name (umbenannt — oder ein anderes Kind?) ·
// 'dasselbe' = gleicher Name, auf zwei Geräten getrennt angelegt. Eine Karte je Frage, „Weiter“ erst, wenn alle beantwortet sind (wie
// „Liste aktualisieren“); jede Antwort rechnet den Abgleich neu. → antworten { [id]: true|false } oder null (abgebrochen).
// Antwort-Sinn wie in merge.mjs: 'zwei' true = zwei Kinder · 'dasselbe' true = dasselbe Kind.
function fragenKlaeren(fremd,gen){
  const antworten={};
  if(!mergeContainerDaten(vault,fremd).fragen.length) return Promise.resolve(antworten);
  return new Promise(resRoh=>{
    const res=aufloesenBeiClose(resRoh,null);   // X/Escape = Abbrechen
    const wer=s=>((s.vorname||'')+' '+(s.name||'')).trim();
    const zeichne=()=>{
      if(!nochOffen(gen)){ dlgZu(); return; }
      const dry=mergeContainerDaten(vault,fremd,{antworten});
      const karte=f=>{
        const gleich=f.art==='dasselbe', zwei=!gleich;   // welcher Wert „dasselbe Kind“ bzw. „zwei Kinder“ bedeutet
        const text=f.art==='zwei'
          ?f.kurs+': „'+wer(f.hier)+'“ ('+f.geraetHier+') und „'+wer(f.dort)+'“ ('+f.geraetDort+') tragen dieselbe Nummer. Umbenannt oder zwei Kinder?'
          :f.kurs+': „'+wer(f.dort)+'“ steht auf beiden Geräten, getrennt angelegt. Dasselbe Kind?';
        const knopf=(wert,lab)=>el('button',{class:'btn'+(f.antwort===wert?'':' still'),'aria-pressed':String(f.antwort===wert),dataset:{frage:f.id},
          onclick:()=>{ antworten[f.id]=wert; zeichne(); }},lab);
        return el('div',{class:'abgleich-frage'},el('p',{},text),el('div',{class:'btn-reihe'},
          knopf(gleich,f.art==='zwei'?'Dasselbe Kind (umbenannt)':'Dasselbe Kind'),knopf(zwei,'Zwei Kinder')));
      };
      dlgZeigenEl(el('h3',{},'Bitte klären'),
        el('p',{class:'u-hinweis'},'Die beiden Stände unterscheiden sich bei einzelnen Kindern. Die App rät nicht — ihre Einträge bleiben bei dem Kind, das du wählst.'),
        ...dry.fragen.map(karte),
        el('div',{class:'btn-reihe'},
          el('button',{class:'btn',dataset:{weiter:''},disabled:dry.offen>0?'':undefined,onclick:()=>{ if(dry.offen) return; res(antworten); dlgZu(); }},dry.offen?'Noch '+dry.offen+' offen':'Weiter'),
          el('button',{class:'btn still',onclick:()=>{ res(null); dlgZu(); }},'Abbrechen')));
    };
    zeichne();
  });
}
function konfliktListe(k){ return k.slice(0,5).map(t=>'<p class="u-warn13">'+iconHtml('warnung')+' '+esc(t)+'</p>').join('')+(k.length>5?'<p class="u-hinweis">… und '+(k.length-5)+' weitere</p>':''); }
function unterschiedeTitel(k){ return k.every(t=>/^Stammdaten-Konflikt/.test(t))?'Unterschiede zwischen den Ständen':'Unterschiede in der Schülerliste'; }
function unterschiede(n){ return n===1?'1 Unterschied':n+' Unterschiede'; }
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
  const antworten=await fragenKlaeren(fremd,gen);   // v2.2: erst die Kinder klären, dann die Vorschau
  if(!antworten||!nochOffen(gen)) return;
  // Import-Vorschau (Konzept §3): erst zeigen, dann mergen — nie still
  const eigeneIds=new Set(vault.events.map(x=>x.id));
  const neue=(fremd.events||[]).filter(x=>!eigeneIds.has(x.id)).length;
  const dry=mergeContainerDaten(vault,fremd,{antworten});
  dlgZeigen('<h3>Sicherung erkannt</h3>'+
    '<div class="zeile"><span>Quelle</span><span class="wert">'+esc(fremd.stamm?.geraet||'?')+'</span></div>'+
    '<div class="zeile"><span>Letzter Stand</span><span class="wert">'+esc(String(fremd.stamm?.ts||'?').slice(0,16).replace('T',' '))+'</span></div>'+
    '<div class="zeile"><span>Kurse</span><span class="wert">'+(fremd.stamm?.kurse?.length||0)+'</span></div>'+
    '<div class="zeile"><span>Ereignisse</span><span class="wert">'+(fremd.events?.length||0)+' · davon '+neue+' neu</span></div>'+
    (dry.konflikte.length?konfliktListe(dry.konflikte):'<p class="u-hinweis">Keine Unterschiede in der Schülerliste.</p>')+
    // Sicherer Import (Zero 2026-09-29): was nur im anderen Stand stand, wird ergänzt — vorher ging es still verloren
    // mit „; “ getrennt: der Kursname trägt selbst ein „ · “ (7b · M, Prüfer 06.10. B13)
    (dry.hinweise&&dry.hinweise.length?'<p class="u-hinweis">Ergänzt aus dem anderen Stand: '+esc(dry.hinweise.slice(0,4).join('; '))+(dry.hinweise.length>4?'; … ('+dry.hinweise.length+')':'')+'</p>':'')+
    '<div class="btn-reihe"><button class="btn" data-ok>Einlesen und zusammenführen</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
    el=>{ el.querySelector('[data-ok]').onclick=async()=>{
      dlgZu();
      if(!nochOffen(gen)) return;
      // Verworfener Stand liegt bei (max 3, FIFO) — derselbe Weg wie „Vom PC holen“ (logic/merge uebernehmeMerge, Review 19.10. §5)
      tresorUebernehmen(dry); stammOhneBump(); await speichern();
      // kurz mit Zahl wie „Vom PC holen“ (Prüfer 06.10. B10): die Meldungen stehen in der Vorschau
      toast('Zusammengeführt: '+vault.events.length+' Einträge'+(dry.konflikte.length?' · '+unterschiede(dry.konflikte.length):''),dry.konflikte.length?4000:2600);
      kursAutowahl(); renderAlles();
    }; });
}
// Import und Pull übernehmen gleich (Review 19.10. §5) und landen im selben Schema wie nach dem Entsperren — ein alter Stand ohne
// Schuljahr bekam es sonst erst nach dem nächsten Sperren (Prüfer 19.10. B10)
function tresorUebernehmen(dry){ setzeVault(uebernehmeMerge(vault,dry)); migriereStamm(vault); }
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
        setzeSchluessel(g.dek,g.kopf);
        dlgZu(); toast('Passphrase geändert — denke an das zweite Gerät.',5000);
      }catch(err){ feh.textContent=err.message; }
    }; });
}
// Kopplung mit dem PC-Server (Codex 07.10. S1): der Code steht im Server-Fenster, die App schickt ihn bei Status, Senden und Holen mit.
// Er liegt nur in dieser Heimnetz-Instanz (eigene Origin), nie im Tresor und nie in einer Sicherung.
function kopplungKopf(){ let c=null; try{ c=localStorage.getItem('kladde_kopplung'); }catch{} return c?{'X-Kladde-Kopplung':c}:{}; }
const NICHT_GEKOPPELT='Erst mit dem PC koppeln: den Kopplungscode aus dem Server-Fenster unter „Mit dem PC abgleichen“ eingeben';
async function koppeln(code){
  code=String(code||'').trim().toLowerCase();
  if(!/^[0-9a-f]{4}-[0-9a-f]{4}$/.test(code)){ toast('Der Kopplungscode hat die Form abcd-1234',4000); return; }
  try{ localStorage.setItem('kladde_kopplung',code); }catch{ toast('⚠ Dieser Browser speichert den Code nicht',4000); return; }
  try{
    const s=await fetch('/api/kladde/status',{cache:'no-store',headers:kopplungKopf()}).then(r=>r.json());
    if(s.gekoppelt){ toast('Mit dem PC gekoppelt'); renderMehr(); return; }
    try{ localStorage.removeItem('kladde_kopplung'); }catch{}
    toast('Der Code stimmt nicht — bitte im Server-Fenster nachsehen',5000);
  }catch(err){ toast('⚠ PC nicht erreichbar: '+err.message,4000); }
}
// Stand eines Geräts auf dem PC: der Server benennt Generationen nach der UTC-Zeit (20261019T103257…Z)
function pcStandLabel(stem){
  const m=/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)/.exec(String(stem||'')); if(!m) return '?';
  const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5])), pad=x=>String(x).padStart(2,'0');
  return pad(d.getDate())+'.'+pad(d.getMonth()+1)+'., '+pad(d.getHours())+':'+pad(d.getMinutes());
}
// Review 19.10. §7: der PC holte immer „ipad“, ein Handy-Stand war vom PC aus nicht zu holen. Jetzt nennt der Server die Geräte mit Stand.
function waehleQuelle(quellen){
  return new Promise(resRoh=>{
    const res=aufloesenBeiClose(resRoh,null);
    dlgZeigenEl(el('h3',{},'Von welchem Gerät holen?'),
      el('div',{class:'btn-reihe'},...quellen.map(([g,v])=>el('button',{class:'btn',dataset:{quelle:g},onclick:()=>{ dlgZu(); res(g); }},g+' · Stand '+pcStandLabel(v.letzter)))),
      el('div',{class:'btn-reihe'},el('button',{class:'btn still',onclick:()=>{ dlgZu(); res(null); }},'Abbrechen')));
  });
}
async function syncPush(){
  try {
    const bytes=await aktuellerContainerBlob();
    const r=await fetch('/api/kladde/push/'+GERAET,{method:'POST',body:bytes,headers:kopplungKopf()});
    if(r.status===401){ toast(NICHT_GEKOPPELT,6000); return; }
    if(!r.ok) throw new Error('HTTP '+r.status);
    const j=await r.json();
    merkeExport(); // Sicherung liegt jetzt auf dem PC — zählt als Sicherung (Backup-Banner)
    toast('An den PC gesendet · Stand '+j.generationen);
  } catch(err){ toast('⚠ An den PC: '+err.message,4000); }
}
async function syncPull(){
  try {
    const st=await fetch('/api/kladde/status',{cache:'no-store',headers:kopplungKopf()}).then(x=>x.json());
    if(!st.gekoppelt){ toast(NICHT_GEKOPPELT,6000); return; }
    const quellen=Object.entries(st.geraete||{}).filter(([g,v])=>g!==GERAET&&v&&v.letzter);
    if(!quellen.length){ toast('Noch keine Sicherung eines anderen Geräts auf dem PC'); return; }
    const von=quellen.length===1?quellen[0][0]:await waehleQuelle(quellen); if(!von) return;
    const r=await fetch('/api/kladde/pull/'+von,{cache:'no-store',headers:kopplungKopf()});
    if(r.status===401){ toast(NICHT_GEKOPPELT,6000); return; }
    if(r.status===404){ toast('Noch keine Sicherung von „'+von+'" auf dem PC'); return; }
    if(!r.ok) throw new Error('HTTP '+r.status);
    const gen=sperrGen;
    const pin=await passphraseAbfragen('Passphrase der Sicherung vom PC'); if(!pin) return;
    const fremd=(await decodeContainerAuto(new Uint8Array(await r.arrayBuffer()),pin)).daten;
    if(!nochOffen(gen)) return;
    if(!schemaBekannt(fremd.schema)){ toast('⚠ Diese Sicherung ('+fremd.schema+') stammt aus einer neueren App — bitte die App aktualisieren.',6000); return; }
    const antworten=await fragenKlaeren(fremd,gen);   // v2.2: erst die Kinder klären — nie still übernehmen
    if(!antworten||!nochOffen(gen)) return;
    const dry=mergeContainerDaten(vault,fremd,{antworten});
    const anwenden=async()=>{
      if(!nochOffen(gen)) return;
      tresorUebernehmen(dry); await speichern();   // legt den unterlegenen Stand bei wie der Dateiimport (Review 19.10. §5)
      toast('Vom PC geholt: '+vault.events.length+' Einträge'+(dry.konflikte.length?' · '+unterschiede(dry.konflikte.length):''),dry.konflikte.length?4000:2600);
      kursAutowahl(); renderAlles();
    };
    // Ein Handgriff bleibt ein Handgriff — Bestätigung NUR bei Unterschieden in den Stammdaten (P1.6). Ohne gemeinsamen Vorgänger weiß die App
    // nicht, welcher Stand recht hat, darum bleibt die Frage; die Meldungen stehen alle da, mit Kurs und Fach (Prüfer P2, Zero 06.10.)
    if(dry.konflikte.length){
      dlgZeigen('<h3>'+unterschiedeTitel(dry.konflikte)+'</h3>'+konfliktListe(dry.konflikte)+
        '<div class="btn-reihe"><button class="btn" data-ok>Übernehmen</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
        el=>{ el.querySelector('[data-ok]').onclick=()=>{ dlgZu(); anwenden(); }; });
    } else await anwenden();
  } catch(err){ toast('⚠ Vom PC: '+err.message+' (richtige Passphrase?)',4500); }
}
// Setter für Ansichten-Module (A2 Schnitt 4): ein Import ist schreibgeschützt, geschrieben wird von außen nur hierüber
function setzeExportInSitzung(w){ exportInSitzung=w; }


export { tageSeit, DATENSCHUTZ_SATZ, sicherungsKopf, renderMehr, VORLAGEN, vorlageHerunterladen, aktuellerContainerBlob, exportiereContainer, exportInSitzung, downloadGestartet, merkeExport, exportiereContainerJetzt, konfliktListe, unterschiedeTitel, unterschiede, importiereContainer, tresorUebernehmen, stammOhneBump, passphraseWechselDialog, kopplungKopf, NICHT_GEKOPPELT, koppeln, pcStandLabel, waehleQuelle, syncPush, syncPull, setzeExportInSitzung };
