// kladde/logic/sitzplan · der Sitzplan als Raum: Schüler UND leere Tische (Zero 2026-10-02, Empfehlung A „Tisch-Stempel“)
// Modell: { grid: {"r,c": nr}, luecken: [r], tische: ["r,c"] } — `tische` sind die LEEREN Tische; ein besetzter Platz ist
// immer ein Tisch, darum steht ein Schlüssel nie zugleich in grid und tische. Fehlt `tische`, gibt es keine leeren Tische
// (alte Stände bleiben gültig, die Zusammenführung trägt den Sitzplan als Ganzes, logic/merge.mjs).
// Regeln (Zero 02.10.):
//   · Tische setzt nur der Editor (Stempel „Tisch“): Antippen oder Wischen setzt, ein zweites Antippen nimmt den Tisch weg.
//   · Ein leerer Tisch verhält sich wie ein leeres Feld: wer dort hingesetzt wird, übernimmt ihn — auch im Unterricht.
//   · Wird ein Schüler umgesetzt oder in den Mülleimer gezogen, bleibt hinter ihm nichts stehen
//     (Zero 02.10. abends: „Die sollen aber nichts hinter sich lassen“; Mülleimer: „Ja“).
//   · Wird er aus dem Kurs genommen, bleibt sein Platz als leerer Tisch stehen (vomPlatz, alsTische).
// Rein: jede Funktion liefert einen neuen Sitzplan, der alte bleibt unberührt.

const SPALTEN = 12;
const reiheVon = key => Number(key.split(',')[0]);

function kopie(sp) {
  const s = sp || {};
  return { ...s, grid: { ...(s.grid || {}) }, tische: [...(s.tische || [])], ...(s.luecken ? { luecken: [...s.luecken] } : {}) };
}
// ein leerer Tisch-Satz wird nicht gespeichert (gleicher Stand → gleiches JSON, die Zusammenführung vergleicht Inhalte)
function fertig(sp) {
  const belegt = new Set(Object.keys(sp.grid));
  const tische = [...new Set(sp.tische)].filter(k => !belegt.has(k)).sort();
  const { tische: _t, ...rest } = sp;
  return tische.length ? { ...rest, tische } : rest;
}

// platzVon(sp, nr) → "r,c" | null
function platzVon(sp, nr) {
  for (const [key, wert] of Object.entries((sp && sp.grid) || {})) if (wert === nr) return key;
  return null;
}
function istTisch(sp, key) { return ((sp && sp.tische) || []).includes(key); }

// setzeAufPlatz(sp, key, nr, {tausch}) — nr übernimmt key (auch einen leeren Tisch). Sein alter Platz wird leer, kein Tisch,
// außer bei `tausch` auf einen besetzten Platz: dann sitzt der Bisherige auf dem alten Platz (Ziehen Platz → Platz im Editor).
// Ohne `tausch` verliert ein Bisheriger auf key seinen Platz (Ziehen aus der Namen-Schiene: er wandert in die Schiene).
function setzeAufPlatz(sp, key, nr, { tausch = false } = {}) {
  const n = kopie(sp), alt = platzVon(n, nr), belegt = n.grid[key];
  if (alt === key) return fertig(n);
  if (alt) {
    delete n.grid[alt];
    if (tausch && belegt != null) n.grid[alt] = belegt;
  }
  n.grid[key] = nr;
  return fertig(n);
}

// raeumePlatz(sp, nr) — nr verlässt den Plan, der Platz wird leer, kein Tisch (Mülleimer im Editor, Zero 02.10. abends)
function raeumePlatz(sp, nr) {
  const n = kopie(sp), alt = platzVon(n, nr);
  if (alt) delete n.grid[alt];
  return fertig(n);
}

// vorlauf(sp, n) — alle Reihen rücken um n nach hinten in der Zählung (vorne = höchste Reihe bleibt vorne): der Editor füllt so
// hinten leere Reihen auf, ohne negative Reihen zu speichern; „Fertig“ (kompaktiere) zählt wieder ab 0
function vorlauf(sp, n) {
  const o = kopie(sp);
  if (!(n > 0)) return fertig(o);
  const schiebe = key => { const [r, c] = key.split(',').map(Number); return (r + n) + ',' + c; };
  const grid = {};
  for (const [key, wert] of Object.entries(o.grid)) grid[schiebe(key)] = wert;
  return fertig({ ...o, grid, tische: o.tische.map(schiebe), ...(o.luecken ? { luecken: o.luecken.map(r => r + n) } : {}) });
}

// vomPlatz(sp, nr) — nr verlässt den Plan, weil er aus dem Kurs genommen wird; der Platz bleibt als leerer Tisch
function vomPlatz(sp, nr) {
  const n = kopie(sp), alt = platzVon(n, nr);
  if (!alt) return fertig(n);
  delete n.grid[alt]; n.tische.push(alt);
  return fertig(n);
}

// alsTische(sp, keys) — freigewordene Plätze werden leere Tische (z. B. nach entferneNachrueckend, logic/teilnehmer.mjs)
function alsTische(sp, keys) {
  const n = kopie(sp);
  for (const key of keys || []) if (key && n.grid[key] == null) n.tische.push(key);
  return fertig(n);
}

// tischStempel(sp, key, an?) — der Stempel „Tisch“: an=true setzt, an=false nimmt weg, ohne Angabe umschalten.
// Ein besetzter Platz bleibt, wie er ist (dort sitzt jemand; Schüler nimmt der Mülleimer vom Platz).
function tischStempel(sp, key, an) {
  const n = kopie(sp);
  if (n.grid[key] != null) return fertig(n);
  const da = n.tische.includes(key), soll = an === undefined ? !da : an;
  n.tische = soll ? [...n.tische, key] : n.tische.filter(t => t !== key);
  return fertig(n);
}

// reiheEinfuegen(sp, vorR, drop?) — Reihen ab vorR rücken um eins nach hinten; Schüler, Lücken und Tische rücken mit.
// drop = {nr, c}: dieser Schüler sitzt danach in der neuen Reihe (sein alter Platz wird leer, kein Tisch).
function reiheEinfuegen(sp, vorR, drop = null) {
  const n = kopie(drop ? raeumePlatz(sp, drop.nr) : sp);
  const schiebe = key => { const [r, c] = key.split(',').map(Number); return (r >= vorR ? r + 1 : r) + ',' + c; };
  const grid = {};
  for (const [key, wert] of Object.entries(n.grid)) grid[schiebe(key)] = wert;
  n.grid = grid;
  n.tische = n.tische.map(schiebe);
  if (n.luecken) n.luecken = n.luecken.map(r => (r >= vorR ? r + 1 : r));
  if (drop) { n.grid[vorR + ',' + drop.c] = drop.nr; }
  return fertig(n);
}

// belegteReihen(sp) → Reihen mit Schülern ODER leeren Tischen, aufsteigend
function belegteReihen(sp) {
  const s = sp || {};
  return [...new Set([...Object.keys(s.grid || {}), ...(s.tische || [])].map(reiheVon))].sort((a, b) => a - b);
}

// kompaktiere(sp) — beim „Fertig“ des Editors: leere Reihen raus, außer markierten Lücken (Gang) zwischen belegten Reihen;
// eine Reihe nur mit leeren Tischen ist belegt. Reihen werden 0, 1, 2 … durchnummeriert, die Nr bleibt der Anker.
function kompaktiere(sp) {
  const o = kopie(sp), belegte = belegteReihen(o);
  const maxB = belegte.length ? belegte[belegte.length - 1] : -1;
  // Lücken nur zwischen belegten Reihen: eine Lücke vor der ersten belegten Reihe wäre im Editor unsichtbar und bliebe stehen (Prüfer 03.10. B3)
  const luecken = new Set((o.luecken || []).filter(r => !belegte.includes(r) && r > belegte[0] && r < maxB));
  const alle = [...new Set([...belegte, ...luecken])].sort((a, b) => a - b);
  const neuR = new Map(alle.map((r, i) => [r, i]));
  const grid = {}, tische = [];
  for (const [key, wert] of Object.entries(o.grid)) { const [r, c] = key.split(',').map(Number); grid[neuR.get(r) + ',' + c] = wert; }
  for (const key of o.tische) { const [r, c] = key.split(',').map(Number); tische.push(neuR.get(r) + ',' + c); }
  return fertig({ ...o, grid, tische, luecken: alle.filter(r => luecken.has(r)).map(r => neuR.get(r)) });
}

// druckAnordnung(sp, schueler) — was das Sitzplan-PDF zeigt (Zero 02.10.: „die Sitzuordnung soll abgebildet sein - nur in der Spalte
// mit namen brauche ich die sitzplatznummer usw. nicht“): Reihen und Spalten wie im Unterricht (belegte Reihen, Lücken, leere Tische)
// und die Namensliste A–Z mit Schülernummer — ohne Reihe und Platz. schueler: die aktiven Schüler des Kurses; wer nicht darunter
// ist (deaktiviert), steht weder im Plan noch in der Liste. Wer keinen Platz hat, steht nur in der Liste.
// lb: LB-Schüler bekommen im PDF ein dezentes ◆ in Kachel und Liste (Zero 02.10. abends, Frage-Dialog „Dezentes Zeichen ◆“).
function druckAnordnung(sp, schueler) {
  const s = sp || {}, nachNr = new Map((schueler || []).map(x => [x.nr, x]));
  const reihen = [...new Set([...belegteReihen(s), ...(s.luecken || [])])].sort((a, b) => a - b);
  const plaetze = [];
  for (const [key, nr] of Object.entries(s.grid || {})) {
    const x = nachNr.get(nr); if (!x) continue;
    const [r, c] = key.split(',').map(Number);
    plaetze.push({ r, c, art: 'schueler', nr, vorname: x.vorname || '', name: x.name || '', lb: !!x.lb });
  }
  const besetzt = new Set(Object.keys(s.grid || {}));   // ein Gerät mit v1.13.0 kennt „tische“ nicht und setzt Schüler darauf (Prüfer 02.10., B5)
  for (const key of s.tische || []) { if (besetzt.has(key)) continue; const [r, c] = key.split(',').map(Number); plaetze.push({ r, c, art: 'tisch' }); }
  plaetze.sort((a, b) => a.r - b.r || a.c - b.c);
  const spalten = plaetze.map(p => p.c);
  const liste = [...(schueler || [])]
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'de') || String(a.vorname || '').localeCompare(String(b.vorname || ''), 'de'))
    .map(x => ({ nr: x.nr, vorname: x.vorname || '', name: x.name || '', gruppe: x.gruppe || null, lb: !!x.lb }));
  return { reihen, vonC: spalten.length ? Math.min(...spalten) : 0, bisC: spalten.length ? Math.max(...spalten) : -1, plaetze, liste };
}

export { SPALTEN, platzVon, istTisch, setzeAufPlatz, raeumePlatz, vorlauf, vomPlatz, alsTische, tischStempel, reiheEinfuegen, belegteReihen, kompaktiere, druckAnordnung };
