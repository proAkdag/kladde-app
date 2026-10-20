// Kladde · js/ansichten/stundenplan.mjs — Abschnitt „STUNDENPLAN-ASSISTENT“ (A2 Schnitt 4: wörtlich aus js/app.mjs, verhaltensneutral).
// Ansichten dürfen einander direkt importieren, der Kern (js/kern/) nie eine Ansicht (Zero 19.10.: „Direkt, Kern ringfrei“).
import { kursZurZeit, setzeSlot, SLOT_ARTEN } from '../../logic/autowahl.mjs?v=2.3.0.1792517281';
import { fachKuerzel } from '../../logic/fachfarben.mjs?v=2.3.0.1792517281';
import { sortiereKurse } from '../../logic/kursSort.mjs?v=2.3.0.1792517281';
import { KURZRASTER_45, RASTER_VORLAGEN } from '../../logic/rasterVorlagen.mjs?v=2.3.0.1792517281';
import { blockLabel, formatZeit, istAWoche, resolveBloecke } from '../../logic/zeitmodell.mjs?v=2.3.0.1792517281';
import { dlgBreit, dlgZeigenEl, dlgZu } from '../kern/dialog.mjs?v=2.3.0.1792517281';
import { $, el, toast } from '../kern/dom.mjs?v=2.3.0.1792517281';
import { speichern, stammMutiert } from '../kern/tresor.mjs?v=2.3.0.1792517281';
import { heuteIso, vault } from '../kern/zustand.mjs?v=2.3.0.1792517281';
import { datumLabel } from './eintraege.mjs?v=2.3.0.1792517281';
import { faerbe, slotArtLabel, wochenplanZellArt, wochenplanZellKurs } from './kurse.mjs?v=2.3.0.1792517281';
import { kursAutowahl } from './kurswahl.mjs?v=2.3.0.1792517281';
import { renderAlles } from './navigation.mjs?v=2.3.0.1792517281';

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
    // Halbgruppe „Gr. A“, nicht „·A“ neben der A-Woche „(A)“ (Zero 06.10. „Ja, „Gr. A“, Prüfer B11)
    return (k?k.name+(kz?' '+kz:''):'?')+(s.teilgruppe?' Gr. '+s.teilgruppe:'')+(s.rhythmus&&s.rhythmus!=='jede'?' ('+s.rhythmus+')':''); }).join(' · ');
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



export { WT_KURZ, wochenplanZellText, ausnahmeFuer, setzeAusnahme, setzeAusnahmen, schultagAb, stundenplanAssistent, GRUPPEN_LABELS };
