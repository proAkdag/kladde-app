// kladde/logic/parser · Schülerlisten-Parser (Excel-Copy&Paste: Tab/Semikolon/Komma-tolerant)
// Pure Funktion, kein DOM — 1:1 aus index.html v0.7 extrahiert (P1.1, verhaltensneutral).
// Grenze 32 = Mappen-Grenze v1 (MAPPING.md §1); Anhebung auf 35 kommt mit der v8-Brücken-Angleichung (Block B).

function parseSchuelerListe(text){
  const schueler=[]; const warnungen=[]; const nrGesehen=new Set();
  let ohneNr=false;
  const zeilen=String(text).split(/\r?\n/).map(z=>z.trim()).filter(Boolean);
  for(const zeile of zeilen){
    let felder=zeile.split(/\t|;/).map(f=>f.trim()).filter(f=>f!=='');
    if(felder.length===1&&felder[0].includes(',')) felder=felder[0].split(',').map(f=>f.trim());
    if(!felder.length) continue;
    if(/^(nr\.?|name|nachname)$/i.test(felder[0])){ continue; }              // Kopfzeile
    let nr=null;
    if(/^\d{1,2}$/.test(felder[0])){ nr=parseInt(felder[0],10); felder=felder.slice(1); }
    const lb=felder.some(f=>/^lb$/i.test(f));
    const inhalt=felder.filter(f=>!/^lb$/i.test(f));
    if(!inhalt.length){ warnungen.push('Zeile ohne Namen übersprungen: „'+zeile.slice(0,30)+'"'); continue; }
    if(nr===null){ ohneNr=true; nr=schueler.length+1; }
    if(nr<1||nr>32){ warnungen.push('Nr '+nr+' außerhalb 1–32 — übersprungen (Mappen-Grenze)'); continue; }
    if(nrGesehen.has(nr)){ warnungen.push('Nr '+nr+' doppelt — zweite Zeile übersprungen'); continue; }
    nrGesehen.add(nr);
    schueler.push({nr,name:inhalt[0]||'',vorname:inhalt[1]||'',lb});
    if(inhalt.length===1) warnungen.push('Nr '+nr+': nur ein Namensfeld — als Nachname übernommen');
  }
  if(ohneNr&&schueler.length) warnungen.push('Keine Nr-Spalte erkannt — laufend nummeriert. Für den Excel-Export muss die Reihenfolge der Mappe entsprechen (Zeile 1 = Nr 1)!');
  schueler.sort((a,b)=>a.nr-b.nr);
  return {schueler,warnungen};
}

export { parseSchuelerListe };
