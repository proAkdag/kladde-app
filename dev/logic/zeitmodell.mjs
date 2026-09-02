// kladde/logic/zeitmodell · Zeitraster der Schule (P2.2 · Plan Phase 2)
// IMMER Sekunden, nie Dezimalminuten (67,5 min = 4050 s). Pure Funktionen, kein DOM.

// resolveBloecke(zeitmodell, wochentag, datumIso?) → [{blockNr, startSek, endeSek}]
// Pausen kumulieren; tagesAusnahmen (z. B. Freitag kürzer) überschreiben bloeckeProTag.
// blockDauern je Tag: {blockNr: sek} — einzelner Block länger/kürzer (Konferenztag 45 min,
// Oberstufe 90 min); Folgeblöcke verschieben sich kumulativ.
// Kurztage (S256b): steht datumIso in zm.kurztage und existiert zm.zweitRaster, gilt an
// diesem DATUM das komplette Zweitraster (z. B. 7×45 min) — Wochentags-Ausnahmen des
// Hauptrasters greifen dann bewusst NICHT (der Kurztag ersetzt den ganzen Tag).
function resolveBloecke(zm, wochentag, datumIso = null) {
  if (datumIso && zm.zweitRaster && (zm.kurztage || []).includes(datumIso)) {
    const zweit = { ...zm.zweitRaster, tagesAusnahmen: {}, zweitRaster: null, kurztage: [] };
    return resolveBloecke(zweit, wochentag);
  }
  const ausnahme = (zm.tagesAusnahmen || {})[wochentag] || {};
  const anzahl = ausnahme.bloeckeProTag ?? zm.bloeckeProTag;
  const dauer = ausnahme.dauerSekunden ?? zm.dauerSekunden;
  const start0 = ausnahme.startSekunden ?? zm.startSekunden;
  const pausen = ausnahme.pausenNachBlock ?? zm.pausenNachBlock ?? {};
  const blockDauern = ausnahme.blockDauern || {};
  const bloecke = [];
  let t = start0;
  for (let nr = 1; nr <= anzahl; nr++) {
    const d = blockDauern[nr] ?? blockDauern[String(nr)] ?? dauer;
    bloecke.push({ blockNr: nr, startSek: t, endeSek: t + d });
    t += d + (pausen[nr] ?? pausen[String(nr)] ?? 0);
  }
  return bloecke;
}

// Sekunden → "HH:MM" (gerundet, Default) oder "HH:MM:SS" (exakt).
// Rundung: kaufmännisch auf die Minute (09:07:30 → 09:08).
function formatZeit(sek, runden = true) {
  if (runden) {
    const min = Math.round(sek / 60);
    return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  }
  const h = Math.floor(sek / 3600), m = Math.floor((sek % 3600) / 60), s = sek % 60;
  const basis = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  return s ? basis + ':' + String(s).padStart(2, '0') : basis;
}

// Anzeige-Nummer einer Stunde (S256b): Schul-Aushänge zählen mit Lücken (Zeros Raster:
// 1,2,3,4,6,7 — die Mittagspause schluckt die „5"). blockLabels = {blockNr: 'Label'} ist
// reine ANZEIGE; intern bleiben Blöcke lückenlos 1..N (Wochenplan/Slots unberührt).
// Am Kurztag gelten die Labels des Zweitrasters (Fallback: durchgezählte Nummern).
function blockLabel(zm, blockNr, datumIso = null) {
  const kurz = datumIso && zm?.zweitRaster && (zm.kurztage || []).includes(datumIso);
  const labels = (kurz ? zm.zweitRaster.blockLabels : zm?.blockLabels) || {};
  return String(labels[blockNr] ?? labels[String(blockNr)] ?? blockNr);
}

// A/B-Woche über GANZE Wochen-Differenz zum Anker-Montag mod 2 — bewusst NICHT
// ISO-Wochenparität (die kippt über den Jahreswechsel). anker = {datum:'YYYY-MM-DD', typ:'A'|'B'}.
function montagVon(datumIso) {
  const [y, m, d] = datumIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt;
}
function istAWoche(datumIso, anker) {
  if (!anker || !anker.datum) return 'A';
  const diffTage = Math.round((montagVon(datumIso) - montagVon(anker.datum)) / 86400000);
  const wochen = Math.floor(diffTage / 7);
  const gerade = ((wochen % 2) + 2) % 2 === 0;
  const ankerTyp = anker.typ === 'B' ? 'B' : 'A';
  return gerade ? ankerTyp : (ankerTyp === 'A' ? 'B' : 'A');
}

// Ferien & Feiertage (Zero 2026-09-02, Punkt 15): zm.ferien = [{von,bis,name}] (ISO-Datum, inklusiv).
// → Eintrag oder null. Autowahl sagt dann „frei", der Tagesblick schreibt den Namen.
function istFerien(zm, datumIso) {
  return (zm?.ferien || []).find(f => f.von <= datumIso && datumIso <= f.bis) || null;
}

export { resolveBloecke, formatZeit, istAWoche, blockLabel, istFerien };
