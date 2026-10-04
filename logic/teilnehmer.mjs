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
  // Inaktives Kind (Tombstone, Einträge gebunden) nur bei GLEICHEM Namen reaktivieren — steht in der Mappe unter
  // dessen Nr ein anderer Name, ist es ein anderes Kind: nicht still zurückholen, sondern melden (Prüfer 2026-09-29)
  const gleicherName = s => { const n = neuNr.get(s.nr); return n.name === s.name && n.vorname === s.vorname; };
  const reaktiviert = (alt || []).filter(s => s.inaktiv && neuNr.has(s.nr) && gleicherName(s));
  const nrBelegt = (alt || []).filter(s => s.inaktiv && neuNr.has(s.nr) && !gleicherName(s)).map(s => ({ nr: s.nr, alt: s, neu: neuNr.get(s.nr) }));
  const geaendert = []; let gleich = 0;
  for (const s of neu || []) {
    const a = altNr.get(s.nr);
    if (!a || a.inaktiv) continue;
    if (a.name !== s.name || a.vorname !== s.vorname || !!a.lb !== !!s.lb) geaendert.push({ nr: s.nr, alt: a, neu: s });
    else gleich++;
  }
  return { neue, entfernt, reaktiviert, geaendert, gleich, nrBelegt };
}

// Wendet den Abgleich an — rein, liefert die neue Liste. Entfernte MIT Einträgen werden
// Tombstone (inaktiv, Nr bleibt reserviert), ohne Einträge echt entfernt (wie „Aus dem Kurs nehmen“ auf der Kurs-Seite).
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

// Sofort-Schutz (Zero 04.10.): Ist die Mappe gegenüber der Kladde verschoben (Kind eingeschoben oder nachgerückt), steht an
// einer Nr MIT Einträgen ein anderes Kind — „Geändert“ hängte dessen Einträge, Sitzplatz und Halbgruppe an dieses Kind.
// Anderes Kind, wenn
//  (a) die Mappe an dieser Nr ein Kind nennt, das in der Kladde unter einer ANDEREN Nr steht (nachgerückt — fängt auch
//      Geschwister mit gleichem Nachnamen), oder
//  (b) ein Kind der Kladde in der Mappe als „Neu“ unter anderer Nr auftaucht: dann ist die Mappe verschoben und jede
//      „Geändert“-Nr mit Einträgen gesperrt (Einschub direkt vor dem letzten Kind, Prüfer 04.10. K3-c), oder
//  (c) Vor- UND Nachname in der Schreibform anders sind.
// Ein Namenswechsel mit gleichem Vornamen (A→K), Rufname und Schreibvarianten bleiben erlaubt.
// Schreibform (Prüfer 04.10. K2-b): ohne Groß/Klein, Umlaut/ß als ae/oe/ue/ss, Akzente weg (ş→s, ç→c), Bindestrich und
// Apostroph als Leerraum — „Ayse Celik“ = „Ayşe Çelik“, „Mueller“ = „Müller“, „Anna-Lena“ = „Anna Lena“.
const schreibform = t => String(t ?? '').normalize('NFC').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/\p{M}/gu, '').replace(/[-‐‑'’]/g, ' ').split(/\s+/).filter(Boolean).join(' ');
function fremdeKinder(ab, hatEvents, alt = []) {
  const wer = s => schreibform(s.vorname) + '|' + schreibform(s.name);
  const nrnVon = new Map();   // Schreibform → alle Nrn (gleiche Namen gibt es, Prüfer K2-c)
  for (const s of alt || []) { const w = wer(s); if (!nrnVon.has(w)) nrnVon.set(w, new Set()); nrnVon.get(w).add(s.nr); }
  const anderswo = s => { const n = nrnVon.get(wer(s)); return !!n && !n.has(s.nr); };
  const verschoben = (ab.neue || []).some(anderswo);
  return (ab.geaendert || []).filter(g => hatEvents(g.nr) && (verschoben || anderswo(g.neu)
    || (schreibform(g.alt.vorname) !== schreibform(g.neu.vorname) && schreibform(g.alt.name) !== schreibform(g.neu.name))));
}

export { entferneNachrueckend, fremdeKinder, listenAbgleich, wendeAbgleichAn };
