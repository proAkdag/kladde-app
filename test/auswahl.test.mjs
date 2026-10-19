// kladde/test/auswahl · gewichtete Zufallswahl (P4.5) — injizierter Zufall macht die Ziehung prüfbar
import test from 'node:test';
import assert from 'node:assert/strict';
import { zufallsGewicht, gewichteteWahl } from '../logic/auswahl.mjs';

test('Gewicht fällt monoton mit Einträgen', () => {
  assert.equal(zufallsGewicht(0), 1);
  assert.equal(zufallsGewicht(1), 0.5);
  assert.ok(zufallsGewicht(3) < zufallsGewicht(1));
});

test('＋ oder ⭐ heute → seltener als o/− und als „noch nichts“ (Zero 2026-09-29)', () => {
  assert.equal(zufallsGewicht(1, true), 0.2);
  assert.ok(zufallsGewicht(1, true) < zufallsGewicht(1));   // 0,2 < 0,5 (o/−/⊘)
  assert.ok(zufallsGewicht(1, true) < zufallsGewicht(0));   // 0,2 < 1
  // 1 ohne Zeichen + 1 mit ＋: Summe 1,2 — r = 0,99 fällt noch auf A, erst r ≥ 1 auf B (≈ 17 %)
  const items = [{ n: 'A', c: 0, g: false }, { n: 'B', c: 1, g: true }];
  const w = it => zufallsGewicht(it.c, it.g);
  assert.equal(gewichteteWahl(items, w, () => 0.99 / 1.2).n, 'A');
  assert.equal(gewichteteWahl(items, w, () => 1.01 / 1.2).n, 'B');
});

test('leere Liste → null', () => {
  assert.equal(gewichteteWahl([], () => 1), null);
});

test('bevorzugt Wenig-dran (injizierter Zufall)', () => {
  // A: 0 Einträge (Gewicht 1) · B: 3 (Gewicht 0.25) · Summe 1.25
  const items = [{ n: 'A', c: 0 }, { n: 'B', c: 3 }];
  const g = it => zufallsGewicht(it.c);
  assert.equal(gewichteteWahl(items, g, () => 0).n, 'A');    // r=0 → A
  assert.equal(gewichteteWahl(items, g, () => 0.9).n, 'B');  // r=1.125 → nach A rest 0.125 < 0.25 → B
});

test('gleich gewichtet → Position folgt Zufall', () => {
  assert.equal(gewichteteWahl(['x', 'y', 'z'], () => 1, () => 0.5), 'y'); // Summe 3, r=1.5 → 2. Element
});

test('alle Gewichte 0 → gleichverteilter Fallback', () => {
  assert.equal(gewichteteWahl(['x', 'y'], () => 0, () => 0), 'x');
});
