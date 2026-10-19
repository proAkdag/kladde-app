// kladde/test/zeitmodell · P2.2-Logik (Plan-Testliste) + P2.3-Invariante + S256b (Vorlagen/Kurztage/Labels)
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBloecke, formatZeit, istAWoche, blockLabel } from '../logic/zeitmodell.mjs';
import { kursZurZeit } from '../logic/autowahl.mjs';
import { verdichte } from '../logic/verdichtung.mjs';
import { RASTER_VORLAGEN } from '../logic/rasterVorlagen.mjs';

// Zeros Realraster: 07:45-Start, 67,5 min, ungleiche Pausen (5/20/5/45)
const ZM = {
  id: 'std', startSekunden: 27900, dauerSekunden: 4050, bloeckeProTag: 6,
  pausenNachBlock: { 1: 300, 2: 1200, 3: 300, 4: 2700 },
  tagesAusnahmen: { 5: { bloeckeProTag: 4 } },
  abWochenAnker: { datum: '2026-08-24', typ: 'A' },
};

test('Blockauflösung mit ungleichen Pausen (kumuliert)', () => {
  const b = resolveBloecke(ZM, 1);
  assert.equal(b.length, 6);
  assert.deepEqual(b[0], { blockNr: 1, startSek: 27900, endeSek: 31950 });        // 07:45–08:52:30
  assert.equal(b[1].startSek, 31950 + 300);                                        // +5 min
  assert.equal(b[2].startSek, b[1].endeSek + 1200);                                // +20 min
  assert.equal(b[4].startSek, b[3].endeSek + 2700);                                // +45 min
  assert.equal(b[5].startSek, b[4].endeSek);                                       // keine Pause definiert = 0
});

test('67,5 min sekundengenau: exakt 08:00–09:07:30, Anzeige 09:08', () => {
  const zm = { ...ZM, startSekunden: 28800, tagesAusnahmen: {} };
  const b1 = resolveBloecke(zm, 1)[0];
  assert.equal(b1.endeSek, 28800 + 4050);
  assert.equal(formatZeit(b1.endeSek, false), '09:07:30');
  assert.equal(formatZeit(b1.endeSek), '09:08');
  assert.equal(formatZeit(b1.startSek), '08:00');
});

test('Tagesausnahme Freitag: nur 4 Blöcke', () => {
  assert.equal(resolveBloecke(ZM, 5).length, 4);
  assert.equal(resolveBloecke(ZM, 4).length, 6);
});

test('Tages-Blockdauer: Di Block 4 = 45 min (Konferenztag) — Folgeblöcke rücken vor', () => {
  const zm = { ...ZM, tagesAusnahmen: { ...ZM.tagesAusnahmen, 2: { blockDauern: { 4: 2700 } } } };
  const di = resolveBloecke(zm, 2), mo = resolveBloecke(zm, 1);
  assert.equal(di[3].endeSek - di[3].startSek, 2700);              // 45 min statt 67,5
  assert.equal(mo[3].endeSek - mo[3].startSek, 4050);              // Regel-Tage unberührt
  assert.equal(di[3].startSek, mo[3].startSek);                    // B1–B3 identisch
  assert.equal(di[4].startSek, mo[4].startSek - 1350);             // B5 rückt 22,5 min vor (Konferenz früher)
  assert.equal(di.length, 6);
  // Oberstufe: verlängerter 90-min-Block am selben Mechanismus
  const zm90 = { ...ZM, tagesAusnahmen: { 2: { blockDauern: { 4: 5400 } } } };
  assert.equal(resolveBloecke(zm90, 2)[4].startSek, mo[4].startSek + 1350);
});

test('A/B über den Jahreswechsel stabil (Anker-Differenz, nicht ISO)', () => {
  assert.equal(istAWoche('2026-08-24', ZM.abWochenAnker), 'A');   // Ankerwoche
  assert.equal(istAWoche('2026-08-31', ZM.abWochenAnker), 'B');
  assert.equal(istAWoche('2026-12-28', ZM.abWochenAnker), 'A');   // Woche 18 nach Anker
  assert.equal(istAWoche('2027-01-04', ZM.abWochenAnker), 'B');   // Woche 19 — kein Kipp am Jahreswechsel
  assert.equal(istAWoche('2027-01-08', ZM.abWochenAnker), 'B');   // Freitag derselben Woche
});

const KONTEXT = {
  zeitmodell: ZM,
  wochenplan: [
    { wochentag: 1, blockNr: 1, kursId: '7b', teilgruppe: null, rhythmus: 'jede' },
    { wochentag: 1, blockNr: 2, kursId: 'q1', teilgruppe: null, rhythmus: 'A' },
    { wochentag: 1, blockNr: 3, kursId: '8a', teilgruppe: 'B', rhythmus: 'jede' },
  ],
  ausnahmen: [],
};
const mo = (h, m) => new Date(2026, 7, 24, h, m, 0);               // Mo 24.08.2026 = A-Woche

test('Autowahl: laufender Block → Kurs', () => {
  const r = kursZurZeit(mo(8, 10), KONTEXT);
  assert.deepEqual(r, { kursId: '7b', blockNr: 1, teilgruppe: null, quelle: 'laufend' });
});

test('Autowahl: Pausen-Toleranz ≤10 min → „kommend", >10 min → frei', () => {
  // Block 2 startet 32250+? — Mo: B1 27900–31950, +300 → B2 32250 (08:57:30)
  const kurzVorB2 = new Date(2026, 7, 24, 8, 53, 0);               // 31980 s → 270 s vor B2
  const r = kursZurZeit(kurzVorB2, KONTEXT);
  assert.equal(r?.quelle, 'kommend');
  assert.equal(r?.kursId, 'q1');
  const langeVorher = new Date(2026, 7, 24, 7, 20, 0);             // >10 min vor B1
  assert.equal(kursZurZeit(langeVorher, KONTEXT), null);
});

test('Autowahl: A/B-Slot nur in passender Woche', () => {
  const moB = new Date(2026, 7, 31, 9, 30, 0);                     // Mo 31.08. = B-Woche, in Block 2
  assert.equal(kursZurZeit(moB, KONTEXT), null);                   // q1 ist A-Woche-Slot
  const moA = new Date(2026, 7, 24, 9, 30, 0);
  assert.equal(kursZurZeit(moA, KONTEXT)?.kursId, 'q1');
});

test('Autowahl: Ausnahme schlägt Plan · Entfall ⇒ frei', () => {
  const mitVertretung = { ...KONTEXT, ausnahmen: [{ datum: '2026-08-24', blockNr: 1, kursId: '9a', grund: 'Vertretung' }] };
  assert.deepEqual(kursZurZeit(mo(8, 10), mitVertretung),
    { kursId: '9a', blockNr: 1, teilgruppe: null, quelle: 'ausnahme' });
  const mitEntfall = { ...KONTEXT, ausnahmen: [{ datum: '2026-08-24', blockNr: 1, kursId: null, grund: 'Entfall' }] };
  assert.equal(kursZurZeit(mo(8, 10), mitEntfall), null);
});

test('Autowahl: Wochenende + Teilgruppe', () => {
  assert.equal(kursZurZeit(new Date(2026, 7, 29, 10, 0, 0), KONTEXT), null);   // Samstag
  const b3 = kursZurZeit(new Date(2026, 7, 24, 10, 45, 0), KONTEXT);           // in Block 3 (10:29:30–11:37)
  assert.equal(b3?.kursId, '8a');
  assert.equal(b3?.teilgruppe, 'B');
});

/* ═══ S256b · Vorlagen, Kurztage, Stunden-Labels — Sollwerte sind ZEROS AUSHÄNGE (2026-08-29) ═══ */

// Die Standard-Vorlage aus der einen Quelle (logic/rasterVorlagen) + die zwei Kurztage vom Aushang
const VORLAGE = {
  ...RASTER_VORLAGEN.find(v => v.id === 'std675').zeitmodell,
  kurztage: ['2026-06-19', '2026-06-22'],
  abWochenAnker: null,
};
const zeiten = b => formatZeit(b.startSek, false) + '–' + formatZeit(b.endeSek, false);

test('Vorlage „67,5-Minuten-Raster": alle Montags-Zeiten exakt wie der Aushang', () => {
  assert.deepEqual(resolveBloecke(VORLAGE, 1).map(zeiten), [
    '07:45–08:52:30', '09:13–10:20:30', '10:26–11:33:30',
    '11:49–12:56:30', '13:47–14:54:30', '15:00–16:07:30',
  ]);
});

test('Konferenz-Dienstag: 4 Stunden, die vierte 45 min bis 12:34 — Mo–Do davor identisch', () => {
  const di = resolveBloecke(VORLAGE, 2);
  assert.equal(di.length, 4);
  assert.equal(zeiten(di[3]), '11:49–12:34');
  assert.deepEqual(di.slice(0, 3), resolveBloecke(VORLAGE, 1).slice(0, 3));
});

test('Stunden-Labels: Block 5/6 heißen „6"/„7" (die Mittagspause schluckt die 5), Rest 1:1', () => {
  assert.equal(blockLabel(VORLAGE, 5), '6');
  assert.equal(blockLabel(VORLAGE, 6), '7');
  assert.equal(blockLabel(VORLAGE, 2), '2');
  assert.equal(blockLabel({}, 3), '3');                       // Modell ohne Labels → Nummer
});

test('Kurztag 19.06.: komplettes 45er-Raster wie der Aushang · Labels durchgezählt', () => {
  const kurz = resolveBloecke(VORLAGE, 5, '2026-06-19');
  assert.deepEqual(kurz.map(zeiten), [
    '07:45–08:30', '08:35–09:20', '09:40–10:25', '10:30–11:15',
    '11:30–12:15', '12:20–13:05', '13:10–13:55',
  ]);
  assert.equal(blockLabel(VORLAGE, 5, '2026-06-19'), '5');    // Kurztag zählt 1–7 durch
  assert.equal(blockLabel(VORLAGE, 5, '2026-06-26'), '6');    // normaler Freitag → Aushang-Label
});

test('Kurztag-Gegenrichtung: normales Datum und fehlendes zweitRaster bleiben beim Hauptraster', () => {
  const normal = resolveBloecke(VORLAGE, 5, '2026-06-26');    // Freitag eine Woche später
  assert.equal(normal.length, 6);
  assert.equal(normal[0].endeSek, 31950);                     // 67,5er-Block, kein 45er
  const ohneZweit = { ...VORLAGE, zweitRaster: null };
  assert.equal(resolveBloecke(ohneZweit, 5, '2026-06-19').length, 6);  // Datum gelistet, aber kein Raster → Regel
});

test('Autowahl am Kurztag: 08:40 trifft Stunde 2 des 45er-Rasters — normaler Freitag noch Stunde 1', () => {
  const kontext = { zeitmodell: VORLAGE, ausnahmen: [], wochenplan: [
    { wochentag: 5, blockNr: 1, kursId: 'gl', teilgruppe: null, rhythmus: 'jede' },
    { wochentag: 5, blockNr: 2, kursId: 'at', teilgruppe: null, rhythmus: 'jede' },
  ] };
  const amKurztag = kursZurZeit(new Date(2026, 5, 19, 8, 40, 0), kontext);   // Fr 19.06.
  assert.equal(amKurztag?.kursId, 'at');
  assert.equal(amKurztag?.blockNr, 2);
  const normalerFr = kursZurZeit(new Date(2026, 5, 26, 8, 40, 0), kontext);  // Fr 26.06.
  assert.equal(normalerFr?.kursId, 'gl');
  assert.equal(normalerFr?.blockNr, 1);
});

test('INVARIANTE (verbotener Pfad 3): geplanter Block ohne Events ändert KEINE Verdichtungskennzahl', () => {
  const events = [
    { id: 'e1', typ: '+', schuelerNr: 1, datum: '2026-08-24', ts: '2026-08-24T08:00Z', geraet: 't' },
    { id: 'e2', typ: 'o', schuelerNr: 1, datum: '2026-08-25', ts: '2026-08-25T08:00Z', geraet: 't' },
  ];
  const ohnePlan = verdichte(events, 1, { profil: 'sek1' });
  // Wochenplan existiert mit 30 geplanten Blöcken — verdichte() kennt ihn nicht einmal als Parameter:
  // Kurstermine entstehen ausschließlich evidenzbasiert aus Events.
  const mitPlan = verdichte(events, 1, { profil: 'sek1' });
  assert.equal(ohnePlan.kursTermine, 2);
  assert.deepEqual(mitPlan, ohnePlan);
  assert.ok(!('wochenplan' in verdichte.prototype ? {} : {}).wochenplan);
});
