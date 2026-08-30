// kladde/logic/rasterVorlagen · Zeitraster-Vorlagen für den Stundenplan-Assistenten (S256b)
// Pure Daten, kein DOM — App und Tests importieren DIESELBE Quelle (Drift unmöglich).
// Zeros Metrik: „intuitiv und einfach, aber wer feiner justieren will, kann" — die Vorlage
// füllt die ARBEITSKOPIE des Assistenten; alle Felder bleiben danach frei editierbar,
// gespeichert wird erst bei „Fertig".
//
// Sekunden-Doktrin (zeitmodell.mjs): IMMER Sekunden, nie Dezimalminuten (67,5 min = 4050 s).
//
// Quelle Vorlage 1+2: Zeros Aushänge 2026-08-29 —
//   Standardraster: 7:45–8:52:30 · 9:13–10:20:30 · 10:26–11:33:30 · 11:49–12:56:30 ·
//                   13:47–14:54:30 · 15:00–16:07:30; Stundennummern 1,2,3,4,6,7 (die
//                   Mittagspause schluckt die „5"); Dienstag = Konferenztag: 4 Stunden,
//                   die vierte 45 min (Klassenrat bis 12:34).
//   Kurzstundenraster (z. B. Fr 19.06. + Mo 22.06.): 7 × 45 min,
//                   7:45–8:30 · 8:35–9:20 · 9:40–10:25 · 10:30–11:15 · 11:30–12:15 ·
//                   12:20–13:05 · 13:10–13:55.

// Das 45er-Kurzraster einmal definiert — dient als zweitRaster der Standard-Vorlage UND
// als eigenständige Ganztags-Vorlage für Schulen im 45-Minuten-Takt.
const KURZRASTER_45 = {
  name: 'Kurzstunden (45 min)',
  startSekunden: 27900,          // 07:45
  dauerSekunden: 2700,           // 45 min
  bloeckeProTag: 7,
  pausenNachBlock: { 1: 300, 2: 1200, 3: 300, 4: 900, 5: 300, 6: 300 }, // 5/20/5/15/5/5
};

const RASTER_VORLAGEN = [
  {
    id: 'std675',
    name: '67,5-Minuten-Raster',
    hinweis: 'Start 7:45 · Stunden 1–4, 6, 7 · Di Konferenztag (4. Stunde 45 min, danach frei) · Kurzstunden-Raster liegt bei',
    zeitmodell: {
      startSekunden: 27900,      // 07:45
      dauerSekunden: 4050,       // 67,5 min
      bloeckeProTag: 6,
      pausenNachBlock: { 1: 1230, 2: 330, 3: 930, 4: 3030, 5: 330 },   // 20,5 / 5,5 / 15,5 / 50,5 / 5,5
      tagesAusnahmen: { 2: { bloeckeProTag: 4, blockDauern: { 4: 2700 } } },
      blockLabels: { 5: '6', 6: '7' },   // Anzeige wie auf dem Aushang — Block 5/6 heißen Stunde 6/7
      zweitRaster: { ...KURZRASTER_45, pausenNachBlock: { ...KURZRASTER_45.pausenNachBlock } },
      kurztage: [],
    },
  },
  {
    id: 'takt45',
    name: '45-Minuten-Raster',
    hinweis: 'Start 7:45 · 7 Stunden · Pausen 5/20/5/15/5/5',
    zeitmodell: {
      startSekunden: KURZRASTER_45.startSekunden,
      dauerSekunden: KURZRASTER_45.dauerSekunden,
      bloeckeProTag: KURZRASTER_45.bloeckeProTag,
      pausenNachBlock: { ...KURZRASTER_45.pausenNachBlock },
      tagesAusnahmen: {},
    },
  },
  {
    id: 'block90',
    name: '90-Minuten-Blöcke',
    hinweis: 'Start 8:00 · 4 Blöcke · Pausen 15/30/15',
    zeitmodell: {
      startSekunden: 28800,      // 08:00
      dauerSekunden: 5400,       // 90 min
      bloeckeProTag: 4,
      pausenNachBlock: { 1: 900, 2: 1800, 3: 900 },
      tagesAusnahmen: {},
    },
  },
];

export { RASTER_VORLAGEN, KURZRASTER_45 };
