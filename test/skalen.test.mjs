// kladde/test/skalen · node --test Port der Alt-Suite (P1.0, verhaltensneutral)
// Skalen-Parität gegen fixtures/skalen_vektoren.json — Soll-Werte hat PYTHON berechnet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DRITTELNOTEN, DRITTELNOTEN_SCHWELLEN, drittelnoteLabel, noteAlsWert, rundeAufDrittel, wertZuLabel } from '../logic/skalen.mjs';

const vekt = JSON.parse(readFileSync(new URL('../fixtures/skalen_vektoren.json', import.meta.url), 'utf-8'));

test('Schwellen exakt wie Python (16)', () => {
  assert.equal(JSON.stringify(vekt.schwellen), JSON.stringify(DRITTELNOTEN_SCHWELLEN));
});

test('Drittelnoten-Palette exakt wie Python (16 Labels)', () => {
  assert.equal(Object.keys(vekt.drittelnoten).length, 16);
  for (const [l, [z, n]] of Object.entries(vekt.drittelnoten)) {
    assert.ok(DRITTELNOTEN[l], 'Label fehlt: ' + l);
    assert.equal(DRITTELNOTEN[l][0], z);
    assert.equal(DRITTELNOTEN[l][1], n);
  }
});

test('drittelnoteLabel == Python für alle Stichproben (inkl. 2.0→2+ Wohlwollen)', () => {
  const falsch = vekt.stichproben.filter(([w, soll]) => drittelnoteLabel(w) !== soll);
  assert.deepEqual(falsch, []);
});

test("noteAlsWert('2-') = 7/3", () => {
  assert.ok(Math.abs(noteAlsWert('2-', 'sek1') - 7 / 3) < 1e-9);
});

test("noteAlsWert('1+') = 2/3", () => {
  assert.ok(Math.abs(noteAlsWert('1+', 'sek1') - 2 / 3) < 1e-9);
});

test("wertZuLabel(7/3) = '2-' (diskret, ohne LOOKUP-Wohlwollen)", () => {
  assert.equal(wertZuLabel(7 / 3), '2-');
});

test('rundeAufDrittel(2.2) = 7/3', () => {
  assert.ok(Math.abs(rundeAufDrittel(2.2) - 7 / 3) < 1e-9);
});

// Prüfer 2026-09-29: zwischen 5- und 6 liegt kein Palettenwert — jedes Ergebnis muss ein Label haben
test('rundeAufDrittel liefert nie einen Wert ohne Label (5,5 … 5,9)', () => {
  for (let w = 0.6; w <= 6.01; w += 0.01) {
    assert.ok(wertZuLabel(rundeAufDrittel(w)) !== null, 'ohne Label bei ' + w.toFixed(2));
  }
  assert.equal(wertZuLabel(rundeAufDrittel(17 / 3)), '5-');   // Gleichstand wie Mappen-LOOKUP
  assert.equal(wertZuLabel(rundeAufDrittel(5.55)), '5-');
  assert.equal(wertZuLabel(rundeAufDrittel(5.75)), '6');
  assert.equal(wertZuLabel(rundeAufDrittel(5.4)), '5-');      // Nachbar unverändert
});
