// Kladde · js/kern/icons.mjs — Linien-Icons, eine Datenquelle für el()- und HTML-String-Renderer (A2 Schnitt 2: wörtlich aus js/app.mjs, verhaltensneutral; der Kern kennt keine Ansicht)
/* ═══ ICONS · Linien-Duktus (Zero-Freigabe 2026-09-02 · Prüfstand W5.1 Emoji→SVG) ═══
   24er Raster · Strich 1,7 · runde Enden · currentColor. EINE Datenquelle, zwei Renderer:
   iconEl() für el()-Views (createElementNS, CSP-sauber), iconHtml() für die HTML-String-Renderer im Bestand.
   Primitive: ['p', d] Pfad · ['c', cx, cy, r] Kreis · ['cf', cx, cy, r] gefüllter Punkt · ['r', x, y, w, h, rx] Rechteck.
   Vorlage + Entscheide: design/ICONS_VORSCHAU_2026-09-02.html. Kachel-Marken zeichnen mit Strich 2,4 (CSS .mk .ico). */
const ICON={
  plus:[['p','M12 5v14M5 12h14']],
  tabelle:[['r',3,4,18,16,2],['p','M3 10h18M9 10v10']],   // Liste aus Excel/Untis einfügen (Scheibe E, kompakt)
  ziehen:[['p','M8 20V4M4.5 7.5 8 4l3.5 3.5'],['p','M16 4v16M12.5 16.5 16 20l3.5-3.5']],   // eigene Reihenfolge
  griff:[['cf',9,6,1.5],['cf',15,6,1.5],['cf',9,12,1.5],['cf',15,12,1.5],['cf',9,18,1.5],['cf',15,18,1.5]],   // Ziehgriff
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

export { iconEl, iconHtml };
