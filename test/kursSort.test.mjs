// kladde/test/kursSort · Kurslisten in Schul-Reihenfolge (Zero 2026-09-02)
import test from 'node:test';
import assert from 'node:assert/strict';
import { sortiereKurse, kursSchluessel } from '../logic/kursSort.mjs';

const k = (name, fach = 'Mathematik') => ({ name, fach });

test('Klassenstufen numerisch: 5 vor 10, Zug alphabetisch, Oberstufe am Ende', () => {
  const rein = [k('Q1'), k('10a'), k('5b'), k('EF'), k('7b'), k('5a'), k('Q2'), k('9c')];
  assert.deepEqual(sortiereKurse(rein).map(x => x.name), ['5a', '5b', '7b', '9c', '10a', 'EF', 'Q1', 'Q2']);
});

test('gleiche Klasse in zwei Fächern: nach Fach', () => {
  const rein = [k('7b', 'Physik'), k('7b', 'Mathematik'), k('7a', 'Physik')];
  assert.deepEqual(sortiereKurse(rein).map(x => x.name + ' ' + x.fach), ['7a Physik', '7b Mathematik', '7b Physik']);
});

test('Freitext-Namen (AG, Förderkurs) hinter der Oberstufe, alphabetisch', () => {
  const rein = [k('Schach-AG'), k('Q1'), k('Förderkurs'), k('6a')];
  assert.deepEqual(sortiereKurse(rein).map(x => x.name), ['6a', 'Q1', 'Förderkurs', 'Schach-AG']);
});

test('Original bleibt unberührt (Kopie)', () => {
  const rein = [k('9a'), k('5a')];
  sortiereKurse(rein);
  assert.equal(rein[0].name, '9a');
});

test('Schlüssel: „10a" → Ziffern-Klasse, „EF Ma" → Oberstufe 0, „Q2" → Oberstufe 2', () => {
  assert.deepEqual(kursSchluessel('10a'), [0, 10, 'a', '']);
  assert.deepEqual(kursSchluessel('EF Ma'), [1, 0, '', 'Ma']);
  assert.deepEqual(kursSchluessel('q2'), [1, 2, '', '']);
});
