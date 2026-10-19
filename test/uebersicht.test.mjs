// kladde/test/uebersicht · Schüler-/Notenübersicht-Logik (Zero 2026-09-02, Punkte 4·7·8·10·12·15)
import test from 'node:test';
import assert from 'node:assert/strict';
import { quartalsVerlauf, kursEinordnung, notenAbstand } from '../logic/verdichtung.mjs';
import { schuelerBericht } from '../logic/bericht.mjs';
import { istFerien } from '../logic/zeitmodell.mjs';
import { kursZurZeit } from '../logic/autowahl.mjs';

const ev = (typ, datum, nr = 1) => ({ id: typ + datum + nr, typ, datum, ts: datum + 'T08:00:00Z', schuelerNr: nr, kursId: 'k' });
const ZR = [
  { id: 'q1', label: '1. Quartal', von: '2026-08-01', bis: '2026-11-06' },
  { id: 'q2', label: '2. Quartal', von: '2026-11-07', bis: '2027-01-31' },
  { id: 'q3', label: '3. Quartal', von: '2027-02-01', bis: '2027-04-15' },
];

test('Quartals-Verlauf: Pfeil nur zwischen Zeiträumen mit Daten, leeres Quartal übersprungen', () => {
  const evs = [ev('-', '2026-09-01'), ev('-', '2026-09-02'), ev('+', '2027-02-10'), ev('+', '2027-02-11')];
  const v = quartalsVerlauf(evs, 1, ZR, { profil: 'sek1' });
  assert.equal(v[0].score, -1); assert.equal(v[0].pfeil, null);
  assert.equal(v[1].score, null); assert.equal(v[1].pfeil, null);      // Q2 leer
  assert.equal(v[2].score, 1); assert.equal(v[2].pfeil, '↑');           // Q3 gegen Q1
});

test('Einordnung Sek I: Median + Anteil dahinter (kleiner = besser)', () => {
  const e = kursEinordnung([1, 2, 3, 4, 5], 2, 'sek1');
  assert.equal(e.median, 3); assert.equal(e.n, 5); assert.equal(e.anteilDahinter, 0.6);
  const e2 = kursEinordnung([5, 8, 11, 14], 11, 'sek2');
  assert.equal(e2.median, 9.5); assert.equal(e2.anteilDahinter, 0.5);
  assert.equal(kursEinordnung([], 2, 'sek1'), null);
  assert.equal(kursEinordnung([1, 2], null, 'sek1'), null);
});

test('Notenabstand: Sek I in Noten, Sek II in 3-Punkte-Stufen, Tippfehler → null', () => {
  assert.equal(notenAbstand('2', 3, 'sek1'), 1);
  assert.ok(Math.abs(notenAbstand('2-', 2 + 1 / 3, 'sek1')) < 1e-9);
  assert.equal(notenAbstand('12', 9, 'sek2'), 1);
  assert.equal(notenAbstand('xx', 3, 'sek1'), null);
  assert.equal(notenAbstand('2', null, 'sek1'), null);
});

test('Kurzbericht: alle Zeilen, Notizen datiert, ohne Fehlzeiten „keine"', () => {
  const t = schuelerBericht({ name: 'Anna Anders', kurs: '7b', fach: 'Mathematik', zeitraum: '1. Quartal', profil: 'sek1',
    v: { nPlus: 3, nNull: 1, nMinus: 0, beteiligtTermine: 4, kursTermine: 6, pfeil: '↑', vorschlag: { label: '2+' }, nFehltE: 0, nFehltU: 0, nFehltO: 0, nVerweigert: 0 },
    quartalsnoten: [{ label: 'Q1', wert: '2' }], notizen: [{ datum: '2026-09-01', text: 'gutes Referat' }], verspMinuten: 0, datumLabel: d => 'Di ' + d.slice(8) + '.' });
  const z = t.split('\n');
  assert.equal(z[0], 'Anna Anders · 7b · Mathematik · 1. Quartal');
  assert.ok(z[1].includes('3× ＋') && z[1].includes('4 von 6'));
  assert.equal(z[2], 'Vorschlag: 2+');
  assert.equal(z[3], 'Fehlzeiten: keine');
  assert.equal(z[4], 'Quartalsnoten: Q1 2');
  assert.equal(z[6], '  Di 01. gutes Referat');
});

// Listen-Abgleich und Sofort-Schutz (bis v1.19.0): abgelöst durch die zwei Nummern, Tests in schuelerliste.test.mjs;
// die alten Fälle liegen in _archiv/test_v1.19.0/uebersicht.test.mjs.
test('Ferien: Treffer inklusiv, Autowahl sagt frei', () => {
  const zm = { startSekunden: 27900, dauerSekunden: 4050, bloeckeProTag: 6, pausenNachBlock: {}, tagesAusnahmen: {},
    ferien: [{ von: '2026-10-12', bis: '2026-10-24', name: 'Herbstferien' }] };
  assert.equal(istFerien(zm, '2026-10-12').name, 'Herbstferien');
  assert.equal(istFerien(zm, '2026-10-24').name, 'Herbstferien');
  assert.equal(istFerien(zm, '2026-10-26'), null);
  const plan = [{ wochentag: 1, blockNr: 1, kursId: '7b', rhythmus: 'jede' }];
  assert.equal(kursZurZeit(new Date(2026, 9, 12, 8, 0, 0), { zeitmodell: zm, wochenplan: plan, ausnahmen: [] }), null);   // Mo in den Ferien
  assert.equal(kursZurZeit(new Date(2026, 9, 26, 8, 0, 0), { zeitmodell: zm, wochenplan: plan, ausnahmen: [] })?.kursId, '7b');
});
