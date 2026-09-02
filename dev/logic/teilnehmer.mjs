// kladde/logic/teilnehmer · Teilnehmer entfernen MIT Nachrücken (Zero 2026-09-02).
//
// Anlass: Ein Schüler zu viel importiert, vor dem ersten Unterricht wieder entfernt — in Excel
// war die Zeile gelöscht und die Klassenliste rückte nach, in der Kladde blieb die Nr-Lücke.
// Nr und Mappenzeile liefen auseinander (MAPPING.md §1: Nr n = Zeile n+5); Zero musste den
// Kurs löschen und neu laden.
//
// REGEL: Nachrücken ist NUR erlaubt, solange der Kurs keine Einträge hat — Events binden an
// die Nr (Tombstone-Regel), danach würde jede Verschiebung Bewertungen umhängen. Der Aufrufer
// prüft das; diese Funktion rechnet nur.
//
// Rein: liefert neue Liste + neues Sitzplan-Grid, mutiert nichts.

function entferneNachrueckend(schueler, grid, nr) {
  const liste = (schueler || [])
    .filter(s => s.nr !== nr)
    .map(s => (s.nr > nr ? { ...s, nr: s.nr - 1 } : s))
    .sort((a, b) => a.nr - b.nr);
  const neuGrid = {};
  for (const [key, wert] of Object.entries(grid || {})) {
    if (wert === nr) continue;                 // der Platz des Entfernten wird frei
    neuGrid[key] = wert > nr ? wert - 1 : wert;
  }
  return { schueler: liste, grid: neuGrid };
}

// ── Liste aus Mappe AKTUALISIEREN statt still ersetzen (Zero 2026-09-02, Punkt 12) ──
// Der Mappen-Import überschrieb die Schülerliste komplett: Tombstones weg, Gruppen weg,
// Sitzplan zeigte auf verschobene Nrn. Jetzt: erst abgleichen, dann zeigen, dann anwenden.
// Join-Schlüssel ist die Nr (MAPPING.md §1) — Namen werden nie zum Matchen benutzt.
function listenAbgleich(alt, neu) {
  const altNr = new Map((alt || []).map(s => [s.nr, s]));
  const neuNr = new Map((neu || []).map(s => [s.nr, s]));
  const neue = (neu || []).filter(s => !altNr.has(s.nr));
  const entfernt = (alt || []).filter(s => !s.inaktiv && !neuNr.has(s.nr));
  const reaktiviert = (alt || []).filter(s => s.inaktiv && neuNr.has(s.nr));
  const geaendert = []; let gleich = 0;
  for (const s of neu || []) {
    const a = altNr.get(s.nr);
    if (!a || a.inaktiv) continue;
    if (a.name !== s.name || a.vorname !== s.vorname || !!a.lb !== !!s.lb) geaendert.push({ nr: s.nr, alt: a, neu: s });
    else gleich++;
  }
  return { neue, entfernt, reaktiviert, geaendert, gleich };
}

// Wendet den Abgleich an — rein, liefert die neue Liste. Entfernte MIT Einträgen werden
// Tombstone (inaktiv, Nr bleibt reserviert), ohne Einträge echt entfernt (wie im Teilnehmer-Dialog).
// Gruppen und sonstige Felder der Bestandsschüler bleiben erhalten.
function wendeAbgleichAn(alt, ab, hatEvents) {
  const list = (alt || []).map(s => ({ ...s }));
  const by = nr => list.find(x => x.nr === nr);
  for (const g of ab.geaendert) { const s = by(g.nr); if (s) { s.name = g.neu.name; s.vorname = g.neu.vorname; s.lb = !!g.neu.lb; } }
  for (const r of ab.reaktiviert) { const s = by(r.nr); if (s) { s.inaktiv = false; } }
  for (const e of ab.entfernt) {
    const i = list.findIndex(x => x.nr === e.nr);
    if (i < 0) continue;
    if (hatEvents(e.nr)) list[i].inaktiv = true; else list.splice(i, 1);
  }
  for (const n of ab.neue) list.push({ nr: n.nr, name: n.name, vorname: n.vorname, lb: !!n.lb });
  return list.sort((a, b) => a.nr - b.nr);
}

export { entferneNachrueckend, listenAbgleich, wendeAbgleichAn };
