// kladde/test/sitzplan · leere Tische (Zero 2026-10-02: „Die sollen sich aber auch wie leere Felder verhalten … Dann übernimmt der Schüler den Platz“)
import test from 'node:test';
import assert from 'node:assert/strict';
import { platzVon, istTisch, setzeAufPlatz, raeumePlatz, vorlauf, vomPlatz, alsTische, tischStempel, reiheEinfuegen, belegteReihen, kompaktiere } from '../logic/sitzplan.mjs';

const SP = { grid: { '0,0': 1, '0,1': 2, '2,0': 3 }, luecken: [1], tische: ['0,2', '2,3'] };
const einfrieren = o => JSON.stringify(o);

test('setzeAufPlatz: ein Schüler übernimmt einen leeren Tisch, sein alter Platz wird leer (Zero 02.10.: „nichts hinter sich lassen“)', () => {
  const n = setzeAufPlatz(SP, '0,2', 3);
  assert.deepEqual(n.grid, { '0,0': 1, '0,1': 2, '0,2': 3 });
  assert.deepEqual(n.tische, ['2,3']);
  assert.equal(istTisch(n, '2,0'), false);
});
test('setzeAufPlatz mit tausch auf einen freien Platz (Ziehen im Editor): der alte Platz wird leer', () => {
  const n = setzeAufPlatz(SP, '1,4', 2, { tausch: true });
  assert.deepEqual(n.grid, { '0,0': 1, '1,4': 2, '2,0': 3 });
  assert.deepEqual(n.tische, ['0,2', '2,3']);
});
test('setzeAufPlatz: Schüler ohne Platz nimmt einen Tisch — kein neuer Tisch entsteht', () => {
  const n = setzeAufPlatz(SP, '2,3', 9);
  assert.equal(n.grid['2,3'], 9);
  assert.deepEqual(n.tische, ['0,2']);
});
test('setzeAufPlatz mit tausch auf besetzten Platz: beide tauschen, kein Tisch entsteht', () => {
  const n = setzeAufPlatz(SP, '0,1', 1, { tausch: true });
  assert.deepEqual(n.grid, { '0,0': 2, '0,1': 1, '2,0': 3 });
  assert.deepEqual(n.tische, ['0,2', '2,3']);
});
test('setzeAufPlatz ohne tausch auf besetzten Platz: der Bisherige verliert den Platz (Namen-Schiene)', () => {
  const n = setzeAufPlatz(SP, '0,1', 9);
  assert.equal(n.grid['0,1'], 9); assert.equal(platzVon(n, 2), null);
  assert.deepEqual(n.tische, ['0,2', '2,3']);
});
test('setzeAufPlatz auf den eigenen Platz ändert nichts', () => {
  assert.deepEqual(setzeAufPlatz(SP, '0,0', 1), SP);
});
test('vomPlatz: der Platz bleibt als leerer Tisch', () => {
  const n = vomPlatz(SP, 2);
  assert.equal(platzVon(n, 2), null);
  assert.ok(istTisch(n, '0,1'));
});
test('raeumePlatz (Mülleimer): der Platz wird leer, kein Tisch; andere Tische bleiben', () => {
  const n = raeumePlatz(SP, 2);
  assert.equal(platzVon(n, 2), null);
  assert.equal(istTisch(n, '0,1'), false);
  assert.deepEqual(n.tische, ['0,2', '2,3']);
  assert.deepEqual(raeumePlatz(SP, 99), SP);   // nicht im Plan: nichts ändert sich
});
test('vorlauf: alle Reihen rücken um n nach hinten in der Zählung, Lücken und Tische mit; kompaktiere stellt den Plan wieder her', () => {
  const n = vorlauf(SP, 3);
  assert.deepEqual(n.grid, { '3,0': 1, '3,1': 2, '5,0': 3 });
  assert.deepEqual(n.tische, ['3,2', '5,3']);
  assert.deepEqual(n.luecken, [4]);
  assert.deepEqual(kompaktiere(n), kompaktiere(SP));
  assert.deepEqual(vorlauf(SP, 0), SP);
  assert.equal('luecken' in vorlauf({ grid: { '0,0': 1 } }, 2), false);
});
test('alsTische: nur freie Plätze werden Tische', () => {
  const n = alsTische(SP, ['1,4', '0,0', null]);
  assert.deepEqual(n.tische, ['0,2', '1,4', '2,3']);
});
test('tischStempel: setzt, nimmt weg, lässt besetzte Plätze in Ruhe', () => {
  assert.deepEqual(tischStempel(SP, '1,1').tische, ['0,2', '1,1', '2,3']);
  assert.deepEqual(tischStempel(SP, '0,2').tische, ['2,3']);
  assert.deepEqual(tischStempel(SP, '0,0'), SP);
  assert.deepEqual(tischStempel(SP, '0,2', true).tische, ['0,2', '2,3']);   // Wischen setzt nur, nimmt nie weg
  assert.equal(tischStempel({ grid: {}, tische: ['0,0'] }, '0,0').tische, undefined);   // kein leeres Feld im Speicher
});
test('reiheEinfuegen: Schüler, Lücken und Tische rücken mit', () => {
  const n = reiheEinfuegen(SP, 1);
  assert.deepEqual(n.grid, { '0,0': 1, '0,1': 2, '3,0': 3 });
  assert.deepEqual(n.luecken, [2]);
  assert.deepEqual(n.tische, ['0,2', '3,3']);
});
test('reiheEinfuegen mit Schüler: er sitzt in der neuen Reihe, sein alter Platz wird leer', () => {
  const n = reiheEinfuegen(SP, 2, { nr: 1, c: 5 });
  assert.equal(n.grid['2,5'], 1);
  assert.equal(platzVon(n, 1), '2,5');
  assert.deepEqual(n.tische, ['0,2', '3,3']);
});
test('kompaktiere: eine Reihe nur mit Tischen bleibt, leere Reihen fallen, Lücke zwischen belegten bleibt', () => {
  const n = kompaktiere({ grid: { '0,0': 1, '4,0': 2 }, tische: ['2,1'], luecken: [3] });
  assert.deepEqual(n.grid, { '0,0': 1, '3,0': 2 });
  assert.deepEqual(n.tische, ['1,1']);
  assert.deepEqual(n.luecken, [2]);
});
test('kompaktiere: Reihe nur mit Tischen am Ende bleibt (sonst verschwände der Raum hinten)', () => {
  const n = kompaktiere({ grid: { '0,0': 1 }, tische: ['3,2'], luecken: [] });
  assert.deepEqual(n.tische, ['1,2']);
  assert.deepEqual(belegteReihen(n), [0, 1]);
});
test('kompaktiere: eine Lücke vor der ersten belegten Reihe fällt weg (Prüfer 03.10. B3), zwischen belegten bleibt sie', () => {
  const n = kompaktiere({ grid: { '5,0': 2, '7,0': 3 }, luecken: [4, 6] });
  assert.deepEqual(n.grid, { '0,0': 2, '2,0': 3 });
  assert.deepEqual(n.luecken, [1]);
});
test('rein: die Eingabe bleibt unberührt, ein Stand ohne Tische bekommt kein Feld „tische“', () => {
  const vorher = einfrieren(SP);
  setzeAufPlatz(SP, '0,2', 3); vomPlatz(SP, 1); tischStempel(SP, '5,5'); reiheEinfuegen(SP, 0, { nr: 2, c: 0 }); kompaktiere(SP);
  assert.equal(einfrieren(SP), vorher);
  assert.equal('tische' in setzeAufPlatz({ grid: { '0,0': 1 } }, '0,1', 1, { tausch: true }), false);   // auf freien Platz: alter Platz wird leer, kein Feld „tische“
  assert.equal('tische' in kompaktiere({ grid: { '0,0': 1 } }), false);
});
