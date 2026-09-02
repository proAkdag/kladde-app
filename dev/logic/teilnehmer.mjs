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

export { entferneNachrueckend };
