// Kladde · js/ansichten/kurse.mjs — Abschnitt „KURSE“ (A2 Schnitt 4: wörtlich aus js/app.mjs, verhaltensneutral).
// Ansichten dürfen einander direkt importieren, der Kern (js/kern/) nie eine Ansicht (Zero 19.10.: „Direkt, Kern ringfrei“).
import { SLOT_ARTEN } from '../../logic/autowahl.mjs?v=2.3.0';
import { FACH_LISTE, fachFarbe, WAEHLER_HUES } from '../../logic/fachfarben.mjs?v=2.3.0';
import { sortiereKurse } from '../../logic/kursSort.mjs?v=2.3.0';
import { kursStatus } from '../../logic/kursStatus.mjs?v=2.3.0';
import { markiereEntfernt as markiereEntferntIn, neueSid, ohneSid } from '../../logic/identitaet.mjs?v=2.3.0';
import { ergaenzeNeuenKurs, lieseMappe, neuerKurs, pruefeKursDatei, xlsxLesbar } from '../../logic/mappe.mjs?v=2.3.0';
import { entferneKursReferenzen } from '../../logic/merge.mjs?v=2.3.0';
import { standardZeitraeume } from '../../logic/migration.mjs?v=2.3.0';
import { istAlphabetisch, liesEinfuegen, nummeriere, ordneNeu, sortiereAlpha, verschiebe, doppelte } from '../../logic/klassenliste.mjs?v=2.3.0';
import { MAX_SCHUELER } from '../../logic/parser.mjs?v=2.3.0';
import { jpegAusDataUrl, pdfAusJpeg } from '../../logic/pdfbild.mjs?v=2.3.0';
import { druckAnordnung, raeumePlatz, setzeAufPlatz, belegteReihen as spBelegteReihen, kompaktiere as spKompaktiere, reiheEinfuegen as spReiheEinfuegen, tischStempel, vomPlatz, vorlauf } from '../../logic/sitzplan.mjs?v=2.3.0';
import { lnr, nachListe, neueAusweisNr, planeAbgleich, wendePlanAn, schreibform } from '../../logic/teilnehmer.mjs?v=2.3.0';
import { wirksameEvents } from '../../logic/verdichtung.mjs?v=2.3.0';
import { dlgZeigen, dlgZeigenEl, dlgZu } from '../kern/dialog.mjs?v=2.3.0';
import { $, el, esc, toast } from '../kern/dom.mjs?v=2.3.0';
import { iconEl, iconHtml } from '../kern/icons.mjs?v=2.3.0';
import { speichern, stammMutiert } from '../kern/tresor.mjs?v=2.3.0';
import { aktiverKursId, aktView, heuteIso, setzeAktView, setzeEditorAktiv, setzeKursId, setzeTermin, vault } from '../kern/zustand.mjs?v=2.3.0';
import { datumLabel, kurs, kursSchueler, listenNr, setzeAktiverSchueler, sidVonNr, stammKind } from './eintraege.mjs?v=2.3.0';
import { renderHeute, stundenplanAnsicht } from './heute.mjs?v=2.3.0';
import { autowahlInfo, handwahlSetzen, kursAutowahl, kursWechseln } from './kurswahl.mjs?v=2.3.0';
import { downloadGestartet, exportiereContainer, exportiereContainerJetzt, exportInSitzung, setzeExportInSitzung } from './mehr.mjs?v=2.3.0';
import { mitUebergang, renderAlles, setzeViewTitel } from './navigation.mjs?v=2.3.0';
import { aktivesSchuljahr, renderSchueler, setzeZeitraumFilter } from './schueler.mjs?v=2.3.0';
import { aufloesenBeiClose } from './sperre.mjs?v=2.3.0';
import { eingabeZeile, kinderListe, reihenfolgeSchalter } from './klassenliste.mjs?v=2.3.0';
import { stempelAus } from './stempel.mjs?v=2.3.0';   // renderRail: eigene innere Funktion (Editor)
import { GRUPPEN_LABELS, stundenplanAssistent } from './stundenplan.mjs?v=2.3.0';

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
// Kurs anlegen (Scheibe E „Klassenliste“, Zero 20.10. Wahl B „Eingabezeile + Liste, zwei Schritte“, design/e_klasse_2026-10-20/WAHL.md;
// vorher Scheibe 8 „Ein Blatt“ mit einem Textfeld). Schritt 1 Klasse: oben „Mappe laden“ als Haupttat, darunter Name, Fach, Schuljahr,
// Stufe, Sitzplan. Schritt 2 Kinder: Eingabezeile (Vorname ⏎ Nachname ⏎), Schalter Alphabetisch | Eigene Reihenfolge (↑↓ und Ziehen),
// ✎ je Zeile, „Aus Excel oder Untis einfügen …“ füllt die Liste. Angelegt wird mit Nr = Zeile 1…n über legeKursAn (ein Weg, Scheibe 8).
// Beide Schritte werden einmal gebaut und nur umgeschaltet; beim Tippen wird nur die Liste neu gezeichnet (Fokus-Lehre).
// Die Ids kn-* nutzen die Proben (P14, P29, P30, P44, P45): kn-liste ist das Einfügefeld, kn-ok legt an.
function kursAnlegenBlatt(){
  const w={name:'',fach:'',jahr:(aktivesSchuljahr()?.label)||'',profil:'sek1',notenmodus:'punkte',sitz:'alpha'};
  // kinder = sichtbare Reihenfolge im Modus „eigen“; im Modus „alpha“ wird sortiert angezeigt. quelle 'einf' = aus dem Einfügefeld
  let kinder=[], modus='alpha', eingefuegt={hinweise:[],luecken:false,n:0}, verwerfenOk=false;
  const sichtbar=()=>modus==='alpha'?sortiereAlpha(kinder):kinder;
  const ok=el('button',{class:'btn',id:'kn-ok',disabled:''},'Kurs anlegen');
  const weiter=el('button',{type:'button',class:'btn',id:'kn-weiter',disabled:''},'Weiter: Kinder');
  const bereit=()=>{ const kopf=!!(w.name.trim()&&w.fach.trim()); weiter.disabled=!kopf; ok.disabled=!(kopf&&kinder.length&&kinder.length<=MAX_SCHUELER); };
  const feld=(id,schluessel,ph,klasse,extra={})=>el('input',{type:'text',id,value:w[schluessel],placeholder:ph,class:klasse,...extra,oninput:e=>{ w[schluessel]=e.target.value; bereit(); }});
  // Segment: nur seine Knöpfe werden neu gezeichnet, nie die Textfelder
  const seg=(werte,schluessel,danach)=>{ const box=el('div',{class:'seg kn-seg'});
    const zeichne=()=>box.replaceChildren(...werte.map(([v,t])=>el('button',{type:'button',class:'btn'+(w[schluessel]===v?'':' still'),'aria-pressed':String(w[schluessel]===v),dataset:{kn:schluessel+'-'+v},
      onclick:()=>{ w[schluessel]=v; zeichne(); if(danach) danach(); }},t)));
    zeichne(); return box; };
  const notenZeile=el('div',{class:'kn-reihe hidden'},el('span',{},'Noten'),seg([['punkte','Punkte 0–15'],['drittel','Drittelnoten']],'notenmodus'));
  const felder=el('div',{class:'kn-felder'},
    el('div',{class:'zeile'},el('span',{},'Klasse/Kurs'),el('span',{},feld('kn-name','name','z. B. 7b','u-w130',{'aria-label':'Klasse/Kurs'}))),
    el('div',{class:'zeile'},el('span',{},'Fach'),el('span',{},feld('kn-fach','fach','z. B. Mathematik','u-w160',{list:'fach-liste','aria-label':'Fach'}),fachDatalist())),
    el('div',{class:'zeile'},el('span',{},'Schuljahr'),el('span',{},feld('kn-jahr','jahr','2026/27','u-w110',{'aria-label':'Schuljahr'}))),
    el('div',{class:'kn-reihe'},el('span',{},'Stufe'),seg([['sek1','Sek I'],['sek2','Oberstufe']],'profil',()=>notenZeile.classList.toggle('hidden',w.profil!=='sek2'))),
    notenZeile,
    el('div',{class:'kn-reihe'},el('span',{},'Sitzplan'),seg([['alpha','Alphabetisch verteilen'],['spaeter','Später']],'sitz')));
  // ── Schritt 2 · Kinder ──
  const schritte=el('div',{class:'ke-schritte',role:'list'});
  const zeigeSchritt=n=>{ schritte.replaceChildren(el('span',{role:'listitem',class:n===1?'an':'','aria-current':n===1?'step':null},'1 · Klasse'),el('span',{role:'listitem',class:n===2?'an':'','aria-current':n===2?'step':null},'2 · Kinder'));
    s1.classList.toggle('hidden',n!==1); s2.classList.toggle('hidden',n!==2); };
  const kopfZeile=el('p',{class:'u-hinweis ke-kopfzeile'});
  const liste=kinderListe();
  const grenze=el('p',{class:'ke-grenze'}), dopp=el('p',{class:'u-warn13 ke-doppelt hidden'});
  const zaehler=el('span',{class:'ke-zahl'});
  const zeichne=()=>{
    const s=sichtbar();
    // jede Hand an der Liste übernimmt zuerst das Eingefügte (fest): sonst baute die nächste Eingabe ins Feld es neu und ✎/✕ waren weg
    liste.zeige(s,{ordnen:modus==='eigen',bearbeite:true,nachBearbeiten:()=>eingabe.fokus(),
      beiVerschiebe:(von,nach)=>{ fest(); kinder=verschiebe(kinder,von,nach); zeichne(); },
      beiAendern:(i,neu)=>{ fest(); Object.assign(s[i],neu); zeichne(); },
      beiEntfernen:i=>{ fest(); kinder=kinder.filter(k=>k!==s[i]); zeichne(); }});
    const n=kinder.length;
    grenze.textContent=!n?'Noch keine Kinder. Vorname, Nachname, ⏎ — die Tastatur bleibt offen.':n>MAX_SCHUELER?'Die Mappe hat '+MAX_SCHUELER+' Zeilen — bitte '+(n-MAX_SCHUELER)+' Kind'+(n-MAX_SCHUELER>1?'er':'')+' entfernen.':n===MAX_SCHUELER?'Die Mappe ist voll ('+MAX_SCHUELER+' Zeilen).':'';
    grenze.classList.toggle('hidden',!grenze.textContent);
    const d=doppelte(kinder); dopp.textContent=d.length?'Zweimal in der Liste: '+d.join(', ')+'. Gewollt? Sonst mit ✎ entfernen.':''; dopp.classList.toggle('hidden',!d.length);
    zaehler.textContent=n+(n===1?' Kind':' Kinder')+' · Nr = Zeile in der Mappe';
    bereit();
  };
  const schalter=reihenfolgeSchalter(modus,m=>{ fest(); if(m==='eigen') kinder=sortiereAlpha(kinder); modus=m; zeichne(); });   // „Eigene“ beginnt mit dem, was zu sehen war
  // eine ganze Liste im Namensfeld (Excel, Untis) geht ins Einfügefeld (Prüfer 20.10. 🟡 5: sonst wurde sie EIN Kind)
  const eingabe=eingabeZeile({ids:{vor:'kn-vor',nach:'kn-nach',plus:'kn-plus'},beiListe:text=>{ einfAuf.click(); ta.value=(ta.value.trim()?ta.value.replace(/\s*$/,'\n'):'')+text; ta.dispatchEvent(new Event('input')); },beiNeu:k=>{
    if(kinder.length>=MAX_SCHUELER){ toast('Die Mappe hat '+MAX_SCHUELER+' Zeilen — mehr Kinder passen nicht'); return false; }
    kinder.push({vorname:k.vorname,name:k.name,lb:k.lb,quelle:'tipp'}); zeichne(); return true; }});
  // Einfügen (Excel/Untis): das Feld ist live — was darin steht, steht in der Liste (getippte Kinder bleiben). Trägt die Liste eine
  // Nr-Spalte, gilt ihre Reihenfolge (nicht alphabetisch → „Eigene Reihenfolge“); die Kladde nummeriert lückenlos. Sobald eine Hand an
  // der Liste ist (✎, ✕, ↑↓, Ziehen, Schalter), wird das Eingefügte fest: Feld leer, die Kinder bleiben wie geändert (Prüfer 20.10. 🟡 1).
  const info=el('div',{class:'ke-erkannt'});
  const hinweisListe=r=>[...r.hinweise.map(x=>el('div',{class:'u-warn13'},iconEl('warnung'),' '+x)),
    ...(r.luecken?[el('div',{class:'u-warn13'},iconEl('warnung'),' Die Nr-Spalte hat Lücken — die Kladde nummeriert lückenlos 1–'+r.n+'. Für eine bestehende Mappe „Mappe laden“ nehmen.')]:[])];
  const fest=()=>{ const n=kinder.filter(k=>k.quelle==='einf').length; if(!n) return;
    kinder.forEach(k=>{ if(k.quelle==='einf') k.quelle='fest'; }); ta.value='';
    info.replaceChildren(el('b',{class:'u-gut'},n+' Kinder übernommen'),' — sie stehen unten in der Liste. Weitere Zeilen hier einfügen.',...hinweisListe(eingefuegt)); };
  const ta=el('textarea',{id:'kn-liste',rows:'5',class:'u-textarea u-fs16','aria-label':'Liste einfügen',placeholder:'1\tMustermann\tMax\n2\tBeispiel\tBerna\tLB'});
  ta.addEventListener('input',()=>{
    const r=liesEinfuegen(ta.value), neu=r.kinder.map(k=>({...k,quelle:'einf'})), getippt=kinder.filter(k=>k.quelle!=='einf');
    if(r.mitNr&&!istAlphabetisch(neu)){ if(modus==='alpha') kinder=sortiereAlpha(getippt); modus='eigen'; schalter.setze('eigen'); kinder=[...neu,...kinder.filter(k=>k.quelle!=='einf')]; }
    else kinder=r.mitNr?[...neu,...getippt]:[...getippt,...neu];
    eingefuegt={hinweise:r.hinweise,luecken:r.luecken,n:neu.length};   // n für den Lücken-Satz
    const lb=neu.filter(k=>k.lb).length;
    info.replaceChildren(...(neu.length?[el('b',{class:'u-gut'},neu.length+' Kinder erkannt'),(lb?' · '+lb+'× LB':'')+(r.mitNr?' · Reihenfolge aus der Nr-Spalte':'')+' — unten zum Prüfen eingetragen']:[ta.value.trim()?'Noch keine Zeilen erkannt.':'']),
      // alle Hinweise, nie gekürzt: „Nr 36 … übersprungen“ heißt, ein Kind fehlt (Plan v0.8–v1.0 §15, Prüfer 05.10. Y2)
      ...hinweisListe(eingefuegt));
    zeichne();
  });
  const einfBox=el('div',{class:'ke-einf-feld hidden'},el('p',{class:'u-hinweis'},'In Excel oder Untis die Spalten Nr · Name · Vorname (ggf. LB) markieren, kopieren und hier einfügen. Auch „Nachname, Vorname“ oder „Vorname Nachname“, eine Zeile je Kind.'),ta,info);
  const einfAuf=el('button',{type:'button',class:'btn still ke-einfuegen',dataset:{knEinfuegen:''},onclick:()=>{ einfBox.classList.remove('hidden'); einfAuf.classList.add('hidden'); ta.focus(); }},'Aus Excel oder Untis einfügen …');
  const frage=el('div',{class:'ke-verwerfen hidden',role:'alert'});
  const abbrechen=()=>{ if(verwerfenOk||!kinder.length){ verwerfenOk=true; dlgZu(); return; }
    frage.replaceChildren(el('span',{},kinder.length+(kinder.length===1?' Kind ist':' Kinder sind')+' noch nicht angelegt.'),el('span',{class:'btn-reihe'},
      el('button',{type:'button',class:'btn',dataset:{knWeiterEingeben:''},onclick:()=>{ frage.classList.add('hidden'); eingabe.fokus(); }},'Weiter eingeben'),
      el('button',{type:'button',class:'btn still gefahr',dataset:{knVerwerfen:''},onclick:()=>{ verwerfenOk=true; dlgZu(); }},'Verwerfen')));
    frage.classList.remove('hidden'); frage.scrollIntoView({block:'nearest'}); frage.querySelector('[data-kn-weiter-eingeben]').focus(); };
  const schutz=e=>{ if(!verwerfenOk&&kinder.length){ e.preventDefault(); abbrechen(); } };
  $('dlg').addEventListener('cancel',schutz);
  $('dlg').addEventListener('close',()=>$('dlg').removeEventListener('cancel',schutz),{once:true});
  const s1=el('div',{class:'kn-schritt1'},
    el('button',{type:'button',class:'btn kn-mappe',dataset:{knMappe:''},onclick:()=>{ dlgZu(); const f=$('file-kurs'); if(f) f.click(); }},
      el('b',{},'Mappe laden'),el('small',{},'Eine oder mehrere Kursmappen (.xlsx). Name, Fach und Schüler kommen aus der Mappe.')),
    el('div',{class:'kn-oder'},'oder hier anlegen'),
    felder,
    el('div',{class:'btn-reihe'},weiter,el('button',{class:'btn still',onclick:abbrechen},'Abbrechen')));
  const s2=el('div',{class:'kn-schritt2 hidden'},
    kopfZeile,eingabe,
    el('div',{class:'ke-kopf'},el('h4',{},'Kinder'),schalter),
    einfBox,liste.el,grenze,dopp,einfAuf,
    el('div',{class:'ke-fuss'},zaehler,el('span',{class:'btn-reihe'},ok,el('button',{class:'btn still',onclick:abbrechen},'Abbrechen'))));
  weiter.onclick=()=>{ if(weiter.disabled) return;
    kopfZeile.replaceChildren([w.name.trim(),w.fach.trim(),w.jahr.trim(),w.profil==='sek2'?'Oberstufe':'Sek I'].filter(Boolean).join(' · ')+' — ',
      el('button',{type:'button',class:'ke-link',dataset:{knZurueck:''},onclick:()=>zeigeSchritt(1)},'ändern'));
    zeigeSchritt(2); eingabe.fokus(); };
  ok.onclick=()=>{ if(!ok.disabled){ verwerfenOk=true; legeKursAn(w,nummeriere(sichtbar()),eingefuegt.hinweise); } };
  zeigeSchritt(1); zeichne();
  dlgZeigenEl(el('h3',{},'Kurs anlegen'),schritte,s1,s2,frage);
  setTimeout(()=>$('kn-name')?.focus(),60);
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
  setzeAktView('heute');
  document.querySelectorAll('#hauptnav button').forEach(x=>x.classList.toggle('aktiv',x.dataset.view==='heute'));
  setzeAktiverSchueler(null); stempelAus();
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
  wrap.querySelectorAll('[data-oeffnen]').forEach(b=>b.onclick=()=>{ kursWechseln(b.dataset.oeffnen); setzeAktView('schueler'); document.querySelectorAll('#hauptnav button').forEach(x=>x.classList.toggle('aktiv',x.dataset.view==='schueler')); setzeViewTitel('schueler'); ['heute','deck','schueler','kurse','mehr'].forEach(v=>$('view-'+v).classList.toggle('hidden',v!=='schueler')); renderSchueler(); toast('Archiv-Kurs (schreibgeschützt)'); });
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
  // Aktive nach Listen-Nr (Scheibe E, 20.10.: vorher alphabetisch mit Nr daneben — eine eigene Reihenfolge war nicht zu sehen), inaktive alphabetisch
  const aktive=nachListe(alle.filter(s=>!s.inaktiv)), inaktive=sortiert(alle.filter(s=>s.inaktiv));
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
  // Kinder ergänzen (Scheibe E2, Zero 20.10. Wahl B): mehrere Kinder nacheinander, der Dialog bleibt offen. Jedes Kind kommt unten an die
  // Liste (3A, Zero 05.10.: Lücken bleiben frei), bekommt eine neue Ausweis-Nr über der Höchstmarke und eine eigene sid; gespeichert wird
  // je Kind. Hat der Kurs Halbgruppen, fragt die Zeile gleich nach der Gruppe (sonst fehlt das Kind in jeder Gruppenstunde).
  const hinzufuegen=()=>{
    const gruppen=[...new Set(griffe.alle().map(s=>s.gruppe).filter(Boolean))].sort();
    const neuNr=new Set(), liste=kinderListe(), hinweis=el('p',{class:'u-hinweis'});
    const zeichne=()=>{
      const akt=nachListe(griffe.alle().filter(s=>!s.inaktiv)), naechste=Math.max(0,...griffe.alle().map(lnr).filter(n=>n!=null))+1;
      liste.zeige(akt,{nummer:i=>lnr(akt[i]),neu:i=>neuNr.has(akt[i].nr)});
      hinweis.textContent=naechste<=MAX_SCHUELER?'Neue Kinder kommen unten an die Liste (nächste Nr '+naechste+'). Trage sie in der Mappe in dieselbe Zeile ein.':'Die Liste hat schon '+MAX_SCHUELER+' Zeilen wie die Mappe. Neu nummerieren geht nur über „Mappe laden“ (Kurse → Kurs anlegen).';
    };
    const eingabe=eingabeZeile({gruppen,beiNeu:({vorname,name,lb,gruppe})=>{
      const alle=griffe.alle(), naechsteListe=Math.max(0,...alle.map(lnr).filter(n=>n!=null))+1;   // 3A (Zero 05.10.): unten anhängen, Lücken bleiben frei
      if(naechsteListe>MAX_SCHUELER){ toast('Keine Zeile mehr frei — die Mappe hat '+MAX_SCHUELER+' Zeilen'); return false; }
      const nr=neueAusweisNr(alle,vault.events.filter(e=>e.kursId===k.id),k.ausweisBis||0);   // Ausweis-Nr: nie wiederverwendet, ohne Grenze (WAHL U5, Prüfer R4)
      const list=vault.stamm.schueler[k.id]=vault.stamm.schueler[k.id]||[];
      list.push({nr,sid:neueSid(),...(naechsteListe!==nr?{liste:naechsteListe}:{}),name,vorname,lb:!!lb,...(gruppe?{gruppe}:{})}); list.sort((a,b)=>a.nr-b.nr); k.ausweisBis=Math.max(k.ausweisBis||0,nr);
      const gleich=alle.find(s=>!s.inaktiv&&schreibform(s.vorname)===schreibform(vorname)&&schreibform(s.name)===schreibform(name));   // vor dem push gesucht
      stammMutiert(); speichern(); neuNr.add(nr); toast('Hinzugefügt: '+(vorname||name)+' · Nr '+naechsteListe+(gleich?' · gleicher Name wie Nr '+lnr(gleich):''),gleich?6000:undefined); zeichne(); return true; }});
    zeichne();
    dlgZeigenEl(el('h3',{},'Kinder ergänzen · '+k.name),hinweis,eingabe,liste.el,
      el('div',{class:'ke-fuss'},el('span',{},'Jedes Kind ist sofort gespeichert.'),el('span',{class:'btn-reihe'},el('button',{class:'btn',dataset:{ksFertig:''},onclick:dlgZu},'Fertig'))));
    $('dlg').addEventListener('close',nochmal,{once:true});   // auch × und Esc zeigen danach die neue Liste
    setTimeout(()=>eingabe.fokus(),60);
  };
  // Reihenfolge ändern (Scheibe E3, Zero 20.10.): vertauscht nur die Listen-Nrn der aktiven Kinder (logic/klassenliste ordneNeu) —
  // Einträge, Sitzplatz, Halbgruppe und sid hängen an der Ausweis-Nr und bleiben beim Kind. Die Mappe muss nachziehen: das sagt der
  // Dialog, bevor gespeichert wird, nie still. Lücken und die Zeilen inaktiver Kinder bleiben, wo sie sind.
  const reihenfolge=()=>{
    let folge=nachListe(griffe.alle().filter(s=>!s.inaktiv)), modus=istAlphabetisch(folge)?'alpha':'eigen';
    const vorher=folge.map(s=>s.nr).join(','), nummern=folge.map(lnr).sort((a,b)=>a-b), liste=kinderListe();
    const sichtbar=()=>modus==='alpha'?sortiereAlpha(folge):folge;
    const zeichne=()=>liste.zeige(sichtbar(),{ordnen:modus==='eigen',nummer:i=>nummern[i],beiVerschiebe:(von,nach)=>{ folge=verschiebe(folge,von,nach); zeichne(); }});
    const schalter=reihenfolgeSchalter(modus,m=>{ if(m==='eigen') folge=sortiereAlpha(folge); modus=m; zeichne(); });
    zeichne();
    dlgZeigenEl(el('h3',{},'Reihenfolge ändern · '+k.name),
      el('div',{class:'ke-satz'},'Die Nummern ändern sich. Einträge, Sitzplätze und Halbgruppen bleiben beim Kind. Trage die neue Reihenfolge danach auch in der Mappe ein.'),
      el('div',{class:'ke-kopf'},el('h4',{},'Kinder'),schalter),liste.el,
      el('div',{class:'ke-fuss'},el('span',{},folge.length+' Kinder · Nr = Zeile in der Mappe'),el('span',{class:'btn-reihe'},
        el('button',{class:'btn',dataset:{ksReihenfolgeOk:''},onclick:()=>{
          const neu=sichtbar().map(s=>s.nr);
          if(neu.join(',')===vorher){ dlgZu(); toast('Reihenfolge unverändert'); return; }
          const list=ordneNeu(griffe.alle(),neu);
          if(!list){ toast('⚠ Reihenfolge nicht übernommen — bitte neu öffnen'); return; }   // nie halb umordnen
          vault.stamm.schueler[k.id]=list; stammMutiert(); speichern(); dlgZu(); toast('Reihenfolge gespeichert · in der Mappe nachziehen',5000); nochmal(); }},'Speichern'),
        el('button',{class:'btn still',onclick:dlgZu},'Abbrechen'))));
  };
  const inaktivBlock=inaktive.length?el('details',{class:'ks-inaktiv'},el('summary',{},'Inaktiv ('+inaktive.length+') · Einträge bleiben erhalten'),
    ...inaktive.map(s=>el('div',{class:'zeile'},el('span',{class:'u-leise'},s.vorname+' '+s.name+(lnr(s)!=null?' · Nr '+lnr(s):'')),
      el('button',{type:'button',class:'btn still',dataset:{ksAktivieren:String(s.nr)},onclick:()=>{
        // ohne Listen-Nr (beim Anpassen abgegeben) kommt das Kind unten an die Liste wie „+ Schüler“ (3A) — sonst fehlte es still im Kopierblock (Prüfer Y5)
        let zeile='';
        if(lnr(s)==null){ const n=Math.max(0,...alle.map(lnr).filter(x=>x!=null))+1; if(n>MAX_SCHUELER){ toast('Keine Zeile mehr frei — die Mappe hat '+MAX_SCHUELER+' Zeilen'); return; }
          if(n===s.nr) delete s.liste; else s.liste=n; zeile=' · Nr '+n+' — in der Mappe in diese Zeile eintragen'; }
        s.inaktiv=false;
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
      // Quartalsnoten ebenso (Codex 07.10. B4: Q1 = 13 P stand nach dem Wechsel als „13“ unter Drittelnoten)
      const kev=wirksameEvents(vault.events).filter(x=>x.kursId===k.id);
      const nNoten=kev.filter(x=>x.typ==='note').length, nQn=kev.filter(x=>x.typ==='quartalsnote').length;
      if(nNoten||nQn){ e.target.value=k.notenmodus||'punkte';
        toast('Wechsel nicht möglich: '+[nNoten?nNoten+' direkte Note'+(nNoten>1?'n':''):null,nQn?nQn+' Quartalsnote'+(nQn>1?'n':''):null].filter(Boolean).join(' und ')+' in der alten Einheit — erst stornieren',5000); return; }
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
      el('div',{class:'btn-reihe'},el('button',{type:'button',class:'btn still',dataset:{ksNeu:''},onclick:hinzufuegen},'＋ Schüler hinzufügen'),
        aktive.length>1?el('button',{type:'button',class:'btn still',dataset:{ksReihenfolge:''},onclick:reihenfolge},'Reihenfolge ändern …'):null)),
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
        vault.stamm.schueler[neuId]=ohneSid(vault.stamm.schueler[k.id]);
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
// Die Warnung zum Mischbetrieb mit Geräten vor v1.20.0 (Prüfer R3) ist entfallen: Prod ist seit 05.10. mindestens v1.20.0 (Zero 06.10. „Ganz weg“)
const markiereEntfernt=(kinder,k)=>markiereEntferntIn(vault.stamm,kinder,k.id,new Date().toISOString());   // v2.2 Löschmarke (B2)
const LA_FRAGE={teil:['Ja, Name geändert','Nein, anderes Kind'],gleich:['Ja, dasselbe Kind','Nein, ein anderes'],wieder:['Ja, wieder da','Nein, ein neues Kind']};
function listenAbgleichDialog(k,neu,herkunft){
  return new Promise(resRoh=>{
    const res=aufloesenBeiClose(resRoh,false);   // X/Escape = Abbrechen
    const alt=vault.stamm.schueler[k.id]||[];
    const kursEv=vault.events.filter(e=>e.kursId===k.id);
    const hatEv=nr=>{ const sid=sidVonNr(nr,k); return kursEv.some(e=>e.sid===sid&&e.typ!=='storno'); };   // Eintrag → Kind über die sid (v2.2)
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
      const zeileEl=(nr,r,marke,fs,klasse='')=>el('div',{class:'la-zeile'+klasse},el('span',{class:'la-nr'},nr==null?'–':String(nr)),el('span',{class:'la-name'},name(r)),
        marke?el('span',{class:'la-marke'+(marke[1]||'')},marke[0]):null,...[].concat(fs||[]).map(frageEl));
      // die beantworteten Fragen einer Zeile: ein „Ja“ allein, sonst JEDES „Nein“ — jedes bleibt sichtbar und änderbar (vorher nur das letzte; Prüfer N5, Zero 06.10.)
      const fragenZu=z=>{ const an=plan.fragen.filter(f=>f.zeile===z.zeile&&f.antwort!==undefined), ja=an.find(f=>f.antwort===true); return ja?[ja]:an.filter(f=>f.antwort===false); };
      const zeilen=[
        ...plan.zeilen.map(z=>{ const fs=fragenZu(z), f=fs[0];
          const marke=f&&f.antwort!==false?[LA_MARKE[f.art],' la-warn']:!z.kind?['neu',' la-neu']
            :[z.art==='reaktiviert'?'wieder da':null,z.alt!==z.neu&&z.alt!=null?'bisher '+z.alt:null,!!z.kind.lb!==!!z.zeile.lb?(z.zeile.lb?'LB':'LB weg'):null].filter(Boolean).join(' · ');
          return {nr:z.neu,el:zeileEl(z.neu,z.zeile,typeof marke==='string'?(marke?[marke]:null):marke,fs,!z.kind?' la-ist-neu':'')}; }),
        // offene Fragen stehen an ihrer Stelle (planeAbgleich: Mappenzeile bzw. bisherige Nr), bis sie beantwortet sind; die „Nein“ derselben
        // Zeile davor — sonst verschwand ein eben gegebenes „Nein“, und an seiner Stelle lag die Folgefrage (Prüfer 06.10. B4: Doppeltipp)
        ...plan.fragen.filter(f=>f.antwort===undefined).map(f=>({nr:f.stelle,el:zeileEl(f.stelle,f.zeile,[LA_MARKE[f.art],' la-warn'],[...plan.fragen.filter(g=>g.zeile===f.zeile&&g.antwort===false),f],' la-ist-frage')}))
      ].sort((a,b)=>(a.nr??Infinity)-(b.nr??Infinity));
      // Abgang erst nach den Fragen (Prüfer N3, Zero 06.10.): solange eine Frage offen ist, steht nicht fest, wer geht — auch ein Kind ohne
      // eigene Frage kann nach einem „Nein“ noch gefragt werden (gleicher Vorname). Darum jeder Abgang „noch offen“, kein „wird deaktiviert/entfernt“
      const offen=plan.offen>0, mitEv=offen?[]:plan.weg.filter(w=>hatEv(w.kind.nr)), ohneEv=offen?[]:plan.weg.filter(w=>!hatEv(w.kind.nr));
      liste.replaceChildren(...zeilen.map(z=>z.el),
        ...(plan.weg.length+plan.sonstige.length?[el('div',{class:'tag-kopf'},'Nicht mehr in der Mappe ('+(plan.weg.length+plan.sonstige.length)+')'),
          // die Nr wird nur abgegeben, wenn jetzt ein anderes Kind ihre Zeile trägt — sonst bleibt sie als Lücke (Prüfer Y4). Solange eine Frage
          // offen ist, steht die bisherige Nr da, auch bei den schon Inaktiven: nach einem „Nein“ kann ein gleichnamiges inaktives Kind gefragt werden (Prüfer 06.10. B1, B5)
          ...plan.weg.map(w=>zeileEl(offen||w.neu!=null?w.alt:null,w.kind,[offen?'noch offen · erst nach den Fragen':w.alt==null?'ohne Nr':w.neu==null?'gibt Nr '+w.alt+' ab':'Nr '+w.alt+' bleibt frei'],null,' la-ist-weg')),
          ...plan.sonstige.map(o=>zeileEl(offen?o.alt:null,o.kind,['schon inaktiv · '+(offen?'noch offen · erst nach den Fragen':'gibt Nr '+o.alt+' ab')],null,' la-ist-weg')),
          mitEv.length?el('p',{class:'u-hinweis'},(mitEv.length===1?'Hat Einträge: wird deaktiviert':'Haben Einträge: werden deaktiviert')+', die Einträge bleiben erhalten'+(ohneEv.length?' ('+aufzaehlen(mitEv.map(w=>name(w.kind)))+')':'')+'.'):null,
          ohneEv.length?el('p',{class:'u-hinweis'},'Ohne Einträge, '+(ohneEv.length===1?'wird':'werden')+' entfernt: '+aufzaehlen(ohneEv.map(w=>name(w.kind)))+'.'):null]:[]).filter(Boolean));
      liste.scrollTop=oben;
      const gesperrt=plan.offen>0||plan.fehler.length>0;
      unten.replaceChildren(...[
        ...plan.fehler.map(t=>el('p',{class:'u-warn13'},iconEl('warnung'),' '+t)),
        modus==='anpassen'&&plan.geaendert>0?el('p',{class:'u-warn13'},iconEl('warnung'),' Stehen in der Mappe schon Noten oder KA-Punkte, hängen sie dort jetzt an anderen Zeilen. Dann „Bisherige behalten“ wählen.'):null,
        el('div',{class:'btn-reihe'},
          el('button',{class:'btn',dataset:{laUebernehmen:''},disabled:gesperrt?'':null,onclick:uebernehmen},'Übernehmen'),
          el('button',{class:'btn still',onclick:()=>{ dlgZu(); res(false); }},'Abbrechen'),
          // alle Antworten zurück (Prüfer N5): danach sind die Fragen wieder offen, „Übernehmen“ ist gesperrt, bis neu beantwortet. Der Fokus geht
          // auf den Text der ersten Frage, nicht auf ihr „Ja“: ein zweites Enter hätte sonst gleich wieder beantwortet (Prüfer 06.10. B2)
          ...(Object.keys(antworten).length?[el('button',{type:'button',class:'btn still',dataset:{laZuruecksetzen:''},
            onclick:()=>{ for(const id of Object.keys(antworten)) delete antworten[id]; zeichne();
              const t=$('dlg').querySelector('.la-frage .la-klein'); if(t){ t.tabIndex=-1; t.focus(); } }},'Antworten zurücksetzen')]:[])),
        plan.offen?el('p',{class:'u-hinweis'},'„Übernehmen“ geht, sobald '+(plan.offen===1?'die Frage':'die Fragen')+' oben beantwortet '+(plan.offen===1?'ist':'sind')+'.'):null
      ].filter(Boolean));
    };
    const uebernehmen=()=>{
      if(!vault) return;
      const plan=planeAbgleich(alt,neu,modus,antworten);
      const neuListe=wendePlanAn(alt,plan,hatEv,kursEv,k.ausweisBis||0);
      if(!neuListe) return;   // offene Frage oder Fehler: nie halb übernehmen
      // v2.2 Identität: neue Kinder bekommen eine eigene sid; wer ohne Einträge ganz entfernt wurde, bekommt eine Löschmarke —
      // sonst holte der Abgleich ihn mit dem älteren Stand des anderen Geräts zurück (Befund B2)
      for(const s of neuListe) if(!s.sid&&!alt.some(a=>a.nr===s.nr)) s.sid=neueSid();
      markiereEntfernt(alt.filter(a=>!neuListe.some(s=>s.nr===a.nr)),k);
      vault.stamm.schueler[k.id]=neuListe;
      k.ausweisBis=Math.max(k.ausweisBis||0,...alt.map(s=>s.nr),...neuListe.map(s=>s.nr));   // Höchstmarke: keine dieser Nrn wird je neu vergeben (Prüfer R4)
      if(vault.stamm.sitzplaene[k.id]) for(const w of plan.weg) vault.stamm.sitzplaene[k.id]=vomPlatz(vault.stamm.sitzplaene[k.id],w.kind.nr);   // der Platz bleibt als leerer Tisch
      stammMutiert(); speichern(); dlgZu(); res(true);
    };
    // mit Fach: es gibt zwei Kurse „9a“ (Zero 07.10. „Titel mit Fach“); Kurs und Fach mit geschützten Leerzeichen, am Handy brach sonst „7b ·“ / „Mathematik“
    dlgZeigenEl(el('h3',{},'Liste aktualisieren · '+k.name+(k.fach?'\u00a0·\u00a0'+k.fach:'')),
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
    const sid=sidVonNr(s.nr,k), hatEv=vault.events.some(e=>e.kursId===k.id&&e.sid===sid&&e.typ!=='storno');
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
            markiereEntfernt([s],k);   // v2.2: kommt mit dem älteren Stand des anderen Geräts nicht zurück (B2)
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
    // Nur ein Download, kein Teilen: ob die Datei ankam, weiß die App nicht — du bestätigst es (Review 19.10. §8)
    const bestaetigen=!exportInSitzung&&downloadGestartet
      ? el('label',{class:'zeile'},el('span',{},el('input',{type:'checkbox',class:'u-check',onchange:e=>{ if(e.target.checked){ setzeExportInSitzung(true); s1(); } }}),' Die Sicherungsdatei liegt sichtbar in meinen Downloads bzw. Dateien'))
      : null;
    dlgZeigenEl(kopf('Sicherung'),
      el('p',{},'Bevor du das neue Schuljahr startest, sichere die aktuelle Kladde. „Weiter" wird erst nach einer Sicherung frei.'),
      bestaetigen,
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
      if(w.liste) vault.stamm.schueler[neuKursId]=ohneSid(vault.stamm.schueler[k.id]);
      if(w.plan){
        if(vault.stamm.sitzplaene[k.id]) vault.stamm.sitzplaene[neuKursId]=JSON.parse(JSON.stringify(vault.stamm.sitzplaene[k.id]));
        // Wochenplan-Blöcke des alten Kurses auf den neuen umhängen (Lücken-Fix #5)
        for(const wp of (vault.stamm.wochenplan||[])) if(wp.kursId===k.id) vault.stamm.wochenplan.push({...wp,id:wp.id+'-'+neuId,kursId:neuKursId});
      }
      // Events: bewusst NICHT übernehmen (verbotener Pfad 8)
    }
    vault.stamm.aktivesSchuljahrId=neuId;
    setzeKursId(null); setzeZeitraumFilter(null);
    stammMutiert(); speichern(); dlgZu(); kursAutowahl(); renderKurse();
    toast('Schuljahr '+neuLabel+' gestartet');
  }
  s1();
}

// P3.3 · Archivieren (Standard) — Kurs bleibt vollständig erhalten, nur schreibgeschützt + ausgeblendet
function archiviereKurs(id){
  const k=vault.stamm.kurse.find(x=>x.id===id); if(!k) return;
  dlgZeigen('<h3>Kurs archivieren?</h3><p class="u-leise">'+esc(k.name)+' verschwindet aus der aktiven Liste. Alle Einträge bleiben verschlüsselt erhalten und im Archiv einsehbar (schreibgeschützt).</p><div class="btn-reihe"><button class="btn" data-ok>Archivieren</button><button class="btn still" data-schliessen>Abbrechen</button></div>',
    el=>{ el.querySelector('[data-ok]').onclick=()=>{ k.status='archiviert'; stammMutiert(); speichern(); if(aktiverKursId===id){ setzeKursId(null); kursAutowahl(); } dlgZu(); renderKurse(); toast('Archiviert: '+k.name); }; });
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
        // Auch die beigelegten verworfenen Stände (bis zu drei ganze Stammdaten-Kopien) tragen Namen und Liste.
        // Eine Liste aller Kurs-Stellen (logic/merge, Review 19.10. §4) — am Ort zugewiesen, andere Stellen halten vault.stamm
        for(const st of vault.verworfeneStaende||[]) Object.assign(st,entferneKursReferenzen(st,[id]));
        Object.assign(vault.stamm,entferneKursReferenzen(vault.stamm,[id]));
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
  // Name in der Kachel: erst kleiner, bis er passt (nicht unter min); passt er so nicht, bricht ein Doppelname am Bindestrich in zwei Zeilen um;
  // erst dann „…“. Die Schrift wuchs mit der Kachel, lange Vornamen wurden so bei jeder Spaltenzahl gekürzt (gemessen 06.10.; Zero 06.10.:
  // „Schrift passt sich an“, Doppelnamen „Am Bindestrich umbrechen“). Liefert Schriftgröße und Zeilen.
  const zeilen=(t,max,px,min,gew)=>{ let p=Math.round(px); const m=Math.round(min); font(p,gew);
    while(p>m&&g.measureText(t).width>max){ p--; font(p,gew); }
    if(g.measureText(t).width<=max||!t.includes('-')) return {p,z:[passe(t,max)]};
    const breiter=z=>Math.max(...z.map(s=>g.measureText(s).width));
    const z=[...t.matchAll(/-/g)].map(x=>[t.slice(0,x.index+1),t.slice(x.index+1)]).sort((a,b)=>breiter(a)-breiter(b))[0];   // die längere Hälfte so kurz wie möglich
    p=Math.round(px); font(p,gew); while(p>m&&breiter(z)>max){ p--; font(p,gew); }
    return {p,z:z.map(s=>passe(s,max))};
  };
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
    const v=zeilen(p.vorname,ka-28,ka*.17,Math.max(ka*.11,17),700), n=zeilen(p.name,ka-28,ka*.13,Math.max(ka*.09,14),400);   // Mindestgröße 17 px = 6,1 pt, 14 px = 5 pt
    // Vorname auf .42, Nachname .18 darunter; jede weitere Zeile schiebt den Block um die Hälfte nach oben (eine Zeile je Name: wie bisher).
    // Die letzte Zeile bleibt über der Nr (vier Zeilen liefen sonst hinein); nach oben nie über den Rand
    const sV=v.p*1.1, sN=n.p*1.2, spanne=(v.z.length-1)*sV+ka*.18+(n.z.length-1)*sN, unten=y+ka-16-Math.round(ka*.11)*.75-3;
    let zy=y+ka*.42-(spanne-ka*.18)/2; zy=Math.max(y+8+v.p*.75,zy-Math.max(0,zy+spanne+n.p*.22-unten));
    v.z.forEach((s,i)=>{ font(v.p,700); text(s,x+14,zy,TINTE); zy+=i<v.z.length-1?sV:ka*.18; });
    n.z.forEach(s=>{ font(n.p,400); text(s,x+14,zy,LEISE); zy+=sN; });
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
  setzeAktView('heute');
  document.querySelectorAll('#hauptnav button').forEach(x=>x.classList.toggle('aktiv',x.dataset.view==='heute')); setzeViewTitel('heute');
  ['heute','deck','schueler','kurse','mehr'].forEach(v=>$('view-'+v).classList.toggle('hidden',v!=='heute'));
  setzeEditorAktiv(true);
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
    setzeEditorAktiv(false); editorCleanup=null;
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
// Setter für Ansichten-Module (A2 Schnitt 4): ein Import ist schreibgeschützt, geschrieben wird von außen nur hierüber
function setzeKursSeiteId(w){ kursSeiteId=w; }
function setzeEditorCleanup(w){ editorCleanup=w; }

export { slugId, alphaGrid, legeKursAn, kursAnlegenBlatt, kursBadgeHtml, profilLabel, oeffneKurs, kursSeiteId, renderKurse, kursSeite, zeitraeumeDialog, kursDuplizierenDialog, LA_MARKE, LA_FRAGE, listenAbgleichDialog, teilnehmerGriffe, naechsterName, naechstesSchuljahr, schuljahrAssistent, archiviereKurs, reaktiviereKurs, fachDatalist, faerbe, wochenplanZellKurs, wochenplanZellArt, slotArtLabel, loescheKursEndgueltig, sitzplanPdfZeichnen, sitzplanPdf, editorCleanup, sitzplanEditor, slotsEditor, setzeKursSeiteId, setzeEditorCleanup };
