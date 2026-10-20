// kladde/test/anwesenheit · P3.6 Fehlzeiten-Wirkung auf Verdichtung (Plan-Testliste)
import test from 'node:test';
import assert from 'node:assert/strict';
import { verdichte } from '../logic/verdichtung.mjs';

let seq = 0;
function ev(typ, schuelerNr, datum, extra = {}) {
  return { id: 'e' + (++seq), typ, schuelerNr, sid: schuelerNr, datum, ts: datum + 'T08:' + String(seq % 60).padStart(2, '0') + ':00Z', geraet: 'test', ...extra };
}
const T = n => '2026-09-' + String(n).padStart(2, '0');

test('fehlt_o zählt als Kurstermin (Anwesenheitserfassung = Evidenz)', () => {
  const evs = [ev('fehlt_o', 1, T(1)), ev('fehlt_o', 2, T(1)), ev('+', 3, T(1))];
  const v = verdichte(evs, 3, { profil: 'sek1' });
  assert.equal(v.kursTermine, 1); // ein Termin, evidenzbasiert
});

test('Aktiv-Quote: entschuldigte Termine raus aus dem Nenner, u/o nicht', () => {
  const evs = [];
  for (let i = 1; i <= 10; i++) evs.push(ev('o', 99, T(i))); // 10 Kurstermine (Anker)
  for (let i = 1; i <= 6; i++) evs.push(ev('+', 1, T(i)));   // S1 beteiligt an 6
  evs.push(ev('fehlt_e', 1, T(7)), ev('fehlt_e', 1, T(8)));  // 2× entschuldigt
  evs.push(ev('fehlt_u', 1, T(9)));                          // 1× unentschuldigt
  evs.push(ev('fehlt_o', 1, T(10)));                         // 1× offen
  const v = verdichte(evs, 1, { profil: 'sek1' });
  assert.equal(v.kursTermine, 10);
  assert.equal(v.moeglicheTermine, 8);                       // 10 − 2 entschuldigte
  assert.equal(v.beteiligtTermine, 6);
  assert.ok(Math.abs(v.aktivQuote - 6 / 8) < 1e-9);          // 0.75, nicht 0.6
});

test('u = 6 termingewichtet (SekI): 10× Note 2,17 + 2 u → 2,81 → 3+', () => {
  const evs = [];
  // 10 Termine, score 0.5 → Note 3 − 5/3·0.5 ≈ 2.17: p=7 m=2 o=1 auf 10 Terminen
  const muster = ['+','+','+','+','+','+','+','-','-','o'];
  for (let i = 0; i < 10; i++) evs.push(ev(muster[i], 1, T(i + 1)));
  evs.push(ev('fehlt_u', 1, T(11)), ev('fehlt_u', 1, T(12)));
  const v = verdichte(evs, 1, { profil: 'sek1' });
  assert.ok(Math.abs(v.vorschlag.wert - 8 / 3) < 1e-9, 'wert=' + v.vorschlag.wert);
  assert.equal(v.vorschlag.label, '3+');
  assert.ok(v.regelText.includes('2 Stunden ohne bewertbare Leistung'));
  assert.ok(v.regelText.includes('als 6'));
});

test('u = 0 P termingewichtet (SekII): 4× 13 P + 1 u → 10 P', () => {
  const evs = [];
  for (let i = 1; i <= 4; i++) evs.push(ev('+', 1, T(i)));   // score 1 → 13 P, 4 Termine
  evs.push(ev('fehlt_u', 1, T(5)));
  const v = verdichte(evs, 1, { profil: 'sek2' });
  // (13*4 + 0*1)/5 = 10.4 → 10
  assert.equal(v.vorschlag.wert, 10);
});

test('einzelne u-Stunde verschiebt den Vorschlag nur proportional', () => {
  const evs = [];
  const muster = ['+','+','+','+','+','+','+','-','-','o']; // Note ≈ 2.17
  for (let i = 0; i < 10; i++) evs.push(ev(muster[i], 1, T(i + 1)));
  evs.push(ev('fehlt_u', 1, T(11)));
  const v = verdichte(evs, 1, { profil: 'sek1' });
  // (2.17*10 + 6*1)/11 ≈ 2.52 → rundeAufDrittel → 8/3 = 3+ (ohne die u-Stunde 7/3 = 2-: eine Drittelstufe)
  assert.ok(Math.abs(v.vorschlag.wert - 8 / 3) < 1e-9, 'wert=' + v.vorschlag.wert);
});

test('nur-u-nie-beteiligt → 6 (SekI) bzw. 0 P (SekII)', () => {
  const evs1 = [ev('fehlt_u', 1, T(1)), ev('fehlt_u', 1, T(2))];
  assert.equal(verdichte(evs1, 1, { profil: 'sek1' }).vorschlag.label, '6');
  const evs2 = [ev('fehlt_u', 1, T(1))];
  assert.equal(verdichte(evs2, 1, { profil: 'sek2' }).vorschlag.wert, 0);
});

test('OFFENE Fehlzeit (fehlt_o) zählt NIE in die Note — erst Klärung wirkt', () => {
  const evs = [ev('+', 1, T(1)), ev('+', 1, T(2)), ev('fehlt_o', 1, T(3)), ev('fehlt_o', 1, T(4))];
  const v = verdichte(evs, 1, { profil: 'sek1' });
  // 2× + → score 1 → Note 1−; fehlt_o darf nichts verschieben
  assert.ok(Math.abs(v.vorschlag.wert - 4 / 3) < 1e-9, 'wert=' + v.vorschlag.wert);
  assert.deepEqual(v.vorschlag, verdichte(evs.filter(e => e.typ !== 'fehlt_o'), 1, { profil: 'sek1' }).vorschlag);
  assert.equal(v.nFehltO, 2);
});

test('Klärung wirkt nach Storno (fehlt_o → fehlt_u), Doppel-Klärung idempotent', () => {
  const o = ev('fehlt_o', 1, T(3));
  const up = ev('+', 1, T(1)); const up2 = ev('+', 1, T(2));
  // Klärung: fehlt_o storniert + fehlt_u am Originaldatum
  const u = ev('fehlt_u', 1, T(3), { stornoVon: o.id });
  const v = verdichte([up, up2, o, u], 1, { profil: 'sek1' });
  assert.equal(v.nFehltO, 0);   // o storniert
  assert.equal(v.nFehltU, 1);   // u wirkt
  // Doppel-Klärung: zweites fehlt_u desselben Termins storniert erstes — nur 1 zählt
  const u2 = ev('fehlt_u', 1, T(3), { stornoVon: u.id });
  const v2 = verdichte([up, up2, o, u, u2], 1, { profil: 'sek1' });
  assert.equal(v2.nFehltU, 1);
});

test('uAls6:false → unentschuldigt bleibt reine Doku, keine Notenwirkung', () => {
  const evs = [];
  const muster = ['+','+','+','+','+','+','+','-','-','o'];
  for (let i = 0; i < 10; i++) evs.push(ev(muster[i], 1, T(i + 1)));
  evs.push(ev('fehlt_u', 1, T(11)), ev('fehlt_u', 1, T(12)));
  const v = verdichte(evs, 1, { profil: 'sek1', uAls6: false });
  assert.ok(Math.abs(v.vorschlag.wert - 7 / 3) < 1e-9, 'wert=' + v.vorschlag.wert); // 2.17 → 2-
  assert.deepEqual(v.vorschlag, verdichte(evs.filter(e => e.typ !== 'fehlt_u'), 1, { profil: 'sek1' }).vorschlag); // = ohne u
  assert.ok(!v.regelText.includes('unentschuldigt'));
});

test('Undo einer Klärung bringt die offene Fehlzeit zurück (Prüfer 2026-09-29)', () => {
  const o = ev('fehlt_o', 1, T(3));
  const e = ev('fehlt_e', 1, T(3), { stornoVon: o.id });
  const s = ev('storno', 1, T(3), { stornoVon: e.id });
  const v = verdichte([ev('+', 1, T(1)), o, e, s], 1, { profil: 'sek1' });
  assert.equal(v.nFehltO, 1);   // wieder offen — vorher 0 (Abwesenheit ganz verschwunden)
  assert.equal(v.nFehltE, 0);
  // Gegenrichtung: ohne Rücknahme bleibt die Klärung wirksam
  const v2 = verdichte([ev('+', 1, T(1)), o, e], 1, { profil: 'sek1' });
  assert.equal(v2.nFehltO, 0); assert.equal(v2.nFehltE, 1);
});

test('2-Geräte-Widerspruch desselben Termins: jüngste Klärung gewinnt, e/u disjunkt', () => {
  // Gerät A (früher) klärt „e", Gerät B (später) klärt „u" — denselben fehlt_o-Termin.
  const o = ev('fehlt_o', 1, T(3));
  const e = { id: 'kE', typ: 'fehlt_e', schuelerNr: 1, sid: 1, datum: T(3), ts: '2026-09-10T10:00:00Z', geraet: 'pc', stornoVon: o.id };
  const u = { id: 'kU', typ: 'fehlt_u', schuelerNr: 1, sid: 1, datum: T(3), ts: '2026-09-11T09:00:00Z', geraet: 'ipad', stornoVon: o.id };
  const v = verdichte([ev('+', 1, T(1)), o, e, u], 1, { profil: 'sek1' });
  assert.equal(v.nFehltU, 1);  // jüngste (u) gewinnt
  assert.equal(v.nFehltE, 0);  // e verliert — NICHT beide zählen
  assert.equal(v.nFehltO, 0);
});

test('Klärung nach Merge zweier Geräte (Erfassung iPad, Klärung PC) konvergiert', () => {
  // iPad stempelte fehlt_o; PC klärt zu fehlt_e — Reihenfolge im Array egal (Merge-unabhängig)
  const o = ev('fehlt_o', 1, T(3));
  const e = ev('fehlt_e', 1, T(3), { stornoVon: o.id });
  const teil = [ev('+', 1, T(1))];
  const vA = verdichte([...teil, o, e], 1, { profil: 'sek1' });
  const vB = verdichte([e, o, ...teil], 1, { profil: 'sek1' }); // andere Reihenfolge
  assert.equal(vA.nFehltE, 1); assert.equal(vA.nFehltO, 0);
  assert.deepEqual(vA.vorschlag, vB.vorschlag);
});

// ── Verweigerung (v1.1.0): anwesend, keine/verweigerte Leistung → 6 / 0 P termingewichtet, IMMER ──
test('verweigert = 6 termingewichtet (SekI), unabhängig von uAls6', () => {
  const evs = [];
  const muster = ['+','+','+','+','+','+','+','-','-','o']; // Note ≈ 2.17 auf 10 Terminen
  for (let i = 0; i < 10; i++) evs.push(ev(muster[i], 1, T(i + 1)));
  evs.push(ev('verweigert', 1, T(11)), ev('verweigert', 1, T(12)));
  // (2.17*10 + 6*2)/12 ≈ 2.81 → 3+  — auch mit uAls6:false, weil Verweigerung immer zählt
  const v = verdichte(evs, 1, { profil: 'sek1', uAls6: false });
  assert.ok(Math.abs(v.vorschlag.wert - 8 / 3) < 1e-9, 'wert=' + v.vorschlag.wert);
  assert.equal(v.vorschlag.label, '3+');
  assert.equal(v.nVerweigert, 2);
  assert.ok(v.regelText.includes('verweigert'));
});

test('verweigert = 0 P termingewichtet (SekII): 4× 13 P + 1 verweigert → 10 P', () => {
  const evs = [];
  for (let i = 1; i <= 4; i++) evs.push(ev('+', 1, T(i)));
  evs.push(ev('verweigert', 1, T(5)));
  assert.equal(verdichte(evs, 1, { profil: 'sek2' }).vorschlag.wert, 10); // (13*4 + 0)/5 = 10.4
});

test('nur verweigert, nie beteiligt → 6 (SekI) / 0 P (SekII)', () => {
  assert.equal(verdichte([ev('verweigert', 1, T(1)), ev('verweigert', 1, T(2))], 1, { profil: 'sek1' }).vorschlag.label, '6');
  assert.equal(verdichte([ev('verweigert', 1, T(1))], 1, { profil: 'sek2' }).vorschlag.wert, 0);
});

test('verweigert zählt als Kurstermin, aber nicht als Beteiligung', () => {
  const evs = [ev('+', 1, T(1)), ev('verweigert', 1, T(2)), ev('+', 2, T(2))];
  const v = verdichte(evs, 1, { profil: 'sek1' });
  assert.equal(v.kursTermine, 2);       // beide Tage sind Kurstermine (Evidenz)
  assert.equal(v.beteiligtTermine, 1);  // nur T1 (Verweigerung ≠ Beteiligung)
  assert.equal(v.nVerweigert, 1);
});

test('u + verweigert kombiniert termingewichtet (SekI)', () => {
  const evs = [];
  const muster = ['+','+','+','+','+','+','+','-','-','o']; // Note 2.0
  for (let i = 0; i < 10; i++) evs.push(ev(muster[i], 1, T(i + 1)));
  evs.push(ev('fehlt_u', 1, T(11)), ev('verweigert', 1, T(12)));
  // 1 u + 1 verweigert = 2 Sechs-Stunden → (2.0*10 + 6*2)/12 = 2.6667 → 3+
  const v = verdichte(evs, 1, { profil: 'sek1' });
  assert.ok(Math.abs(v.vorschlag.wert - 8 / 3) < 1e-9, 'wert=' + v.vorschlag.wert);
});
