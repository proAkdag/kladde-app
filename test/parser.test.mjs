// kladde/test/parser · Schülerlisten-Parser (NEU in P1.1 — Verhalten unverändert aus v0.7, jetzt testfixiert)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSchuelerListe } from '../logic/parser.mjs';

test('Tab-Format mit Nr/Name/Vorname/LB', () => {
  const r = parseSchuelerListe('1\tMustermann\tMax\n2\tBeispiel\tBerna\tLB');
  assert.equal(r.schueler.length, 2);
  assert.deepEqual(r.schueler[0], { nr: 1, name: 'Mustermann', vorname: 'Max', lb: false });
  assert.deepEqual(r.schueler[1], { nr: 2, name: 'Beispiel', vorname: 'Berna', lb: true });
  assert.equal(r.warnungen.length, 0);
});

test('Kopfzeile wird übersprungen', () => {
  const r = parseSchuelerListe('Nr\tName\tVorname\n1\tA\tB');
  assert.equal(r.schueler.length, 1);
});

test('Semikolon- und Komma-Format', () => {
  const r1 = parseSchuelerListe('1;Alpha;Anna\n2;Beta;Ben');
  assert.equal(r1.schueler.length, 2);
  const r2 = parseSchuelerListe('Gamma, Gero');
  assert.equal(r2.schueler.length, 1);
  assert.equal(r2.schueler[0].name, 'Gamma');
  assert.equal(r2.schueler[0].vorname, 'Gero');
});

test('doppelte Nr: zweite Zeile übersprungen + Warnung', () => {
  const r = parseSchuelerListe('1\tA\tB\n1\tC\tD');
  assert.equal(r.schueler.length, 1);
  assert.ok(r.warnungen.some(w => w.includes('doppelt')));
});

test('ohne Nr-Spalte: laufend nummeriert + Export-Warnung', () => {
  const r = parseSchuelerListe('Alpha\tAnna\nBeta\tBen');
  assert.equal(r.schueler.length, 2);
  assert.equal(r.schueler[0].nr, 1);
  assert.equal(r.schueler[1].nr, 2);
  assert.ok(r.warnungen.some(w => w.includes('Keine Nr-Spalte')));
});

test('Nr außerhalb 1–35 wird abgelehnt, 33–35 sind gültig (Mappen-Grenze v15)', () => {
  const r = parseSchuelerListe('36\tZuviel\tZoe\n35\tGrenze\tGustav');
  assert.equal(r.schueler.length, 1);
  assert.equal(r.schueler[0].nr, 35);
  assert.ok(r.warnungen.some(w => w.includes('außerhalb 1–35')));
});

test('nur ein Namensfeld → als Nachname + Hinweis', () => {
  const r = parseSchuelerListe('5\tEinname');
  assert.equal(r.schueler[0].name, 'Einname');
  assert.equal(r.schueler[0].vorname, '');
  assert.ok(r.warnungen.some(w => w.includes('ein Namensfeld')));
});

test('sortiert nach Nr', () => {
  const r = parseSchuelerListe('3\tC\tc\n1\tA\ta\n2\tB\tb');
  assert.deepEqual(r.schueler.map(s => s.nr), [1, 2, 3]);
});
