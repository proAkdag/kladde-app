// kladde/test/verdichtung · node --test Port der Alt-Suite (P1.0, verhaltensneutral)
import test from 'node:test';
import assert from 'node:assert/strict';
import { verdichte, wirksameEvents, ersetzungFuer, istTerminEintrag } from '../logic/verdichtung.mjs';

let seq = 0;
function ev(typ, schuelerNr, datum, extra = {}) {
  return { id: 'e' + (++seq), typ, schuelerNr, datum, ts: datum + 'T08:' + String(seq).padStart(2, '0') + ':00Z', geraet: 'test', ...extra };
}

// Gemeinsames Kurs-Szenario (identisch zur Alt-Suite)
const kurs = [];
const T = Array.from({ length: 10 }, (_, i) => '2026-09-' + String(i + 1).padStart(2, '0'));
for (const t of T) kurs.push(ev('o', 99, t));                       // Kurs-Termin-Anker: 10 Termine
for (let i = 0; i < 6; i++) kurs.push(ev('+', 1, T[i]));            // S1: 6× +  (T1–T6)
kurs.push(ev('o', 1, T[6]), ev('-', 1, T[6]));                      //     T7: o + −
kurs.push(ev('o', 1, T[7]), ev('-', 1, T[7]));                      //     T8: o + −  → 6/2/2 auf 8 Terminen

test('Bilanz S1: 6⁺ 2° 2⁻ · score 0.4', () => {
  const v1 = verdichte(kurs, 1, { profil: 'sek1' });
  assert.equal(v1.nPlus, 6); assert.equal(v1.nNull, 2); assert.equal(v1.nMinus, 2);
  assert.ok(Math.abs(v1.score - 0.4) < 1e-9);
});

test('Aktivitätsquote S1: 8/10', () => {
  const v1 = verdichte(kurs, 1, { profil: 'sek1' });
  assert.equal(v1.beteiligtTermine, 8);
  assert.equal(v1.kursTermine, 10);
  assert.ok(Math.abs(v1.aktivQuote - 0.8) < 1e-9);
});

test("Vorschlag S1: 3 − 5/3·0.4 ≈ 2.33 → 7/3 = '2-'", () => {
  const v1 = verdichte(kurs, 1, { profil: 'sek1' });
  assert.ok(v1.vorschlag);
  assert.ok(Math.abs(v1.vorschlag.wert - 7 / 3) < 1e-9);
  assert.equal(v1.vorschlag.label, '2-');
});

test("Verlaufspfeil S2: '↑'", () => {
  for (let i = 0; i < 3; i++) kurs.push(ev('-', 2, T[i]));          // S2 früh: − − −
  kurs.push(ev('o', 2, T[3]), ev('o', 2, T[4]));                    //          o o   → score −0.6
  for (let i = 5; i < 10; i++) kurs.push(ev('+', 2, T[i]));         // S2 spät: + + + + + → score 1
  const v2 = verdichte(kurs, 2, { profil: 'sek1' });
  assert.equal(v2.pfeil, '↑');
});

test('LB: Bilanz ja, Vorschlag null', () => {
  const vLb = verdichte(kurs, 1, { profil: 'sek1', lb: true });
  assert.equal(vLb.nPlus, 6);
  assert.equal(vLb.vorschlag, null);
});

test('SekII S3: score 1 → 13 P (15 P nur über ⭐)', () => {
  for (let i = 0; i < 4; i++) kurs.push(ev('+', 3, T[i]));          // S3: 4× + → score 1
  const v3 = verdichte(kurs, 3, { profil: 'sek2' });
  assert.ok(v3.vorschlag);
  assert.equal(v3.vorschlag.wert, 13);
});

// Zero 2026-09-29: „+ auf 13 bzw. 1- · o auf 8 bzw. 3 · - auf 3 bzw. 5+" — die Ränder 1/15 P und
// 6/0 P erreichen nur ⭐ (direkte Note) und ⊘ (Verweigerung).
test('Notenkurve: nur ＋ / nur o / nur − in Sek I und Sek II', () => {
  const nur = (typ) => T.slice(0, 3).map(t => ev(typ, 20, t));
  const faelle = [['+', '1-', 13], ['o', '3', 8], ['-', '5+', 3]];
  for (const [typ, sek1, sek2] of faelle) {
    assert.equal(verdichte(nur(typ), 20, { profil: 'sek1' }).vorschlag.label, sek1, 'Sek I nur ' + typ);
    assert.equal(verdichte(nur(typ), 20, { profil: 'sek2' }).vorschlag.wert, sek2, 'Sek II nur ' + typ);
  }
});

test('Ränder: nur ⭐ → 1 bzw. 15 P · nur ⊘ → 6 bzw. 0 P', () => {
  const stern1 = [ev('note', 21, T[0], { wert: '1', best: true })];
  const stern2 = [ev('note', 21, T[0], { wert: 15, best: true })];
  const verw = [ev('verweigert', 22, T[0], { notiz: '' })];
  assert.equal(verdichte(stern1, 21, { profil: 'sek1' }).vorschlag.label, '1');
  assert.equal(verdichte(stern2, 21, { profil: 'sek2' }).vorschlag.wert, 15);
  assert.equal(verdichte(verw, 22, { profil: 'sek1' }).vorschlag.label, '6');
  assert.equal(verdichte(verw, 22, { profil: 'sek2' }).vorschlag.wert, 0);
});

test('Unlesbare direkte Note (Modus gewechselt) wird übersprungen, statt zu werfen', () => {
  const k = [ev('+', 30, T[0]), ev('note', 30, T[1], { wert: '15', best: true })];   // Punkte-⭐ in einem Drittel-Kurs
  const v = verdichte(k, 30, { profil: 'sek1' });
  assert.equal(v.vorschlag.label, '1-');                            // nur das ＋ zählt
  const v2 = verdichte([ev('+', 31, T[0]), ev('note', 31, T[1], { wert: '2+' })], 31, { profil: 'sek2' });
  assert.equal(v2.vorschlag.wert, 13);
});

test("Noten-Mix S4 TERMINGEWICHTET: (2.33·8 + 2.0·1)/9 ≈ 2.30 → '2-'", () => {
  for (let i = 0; i < 6; i++) kurs.push(ev('+', 4, T[i]));          // S4 = S1-Verteilung …
  kurs.push(ev('o', 4, T[6]), ev('-', 4, T[6]), ev('o', 4, T[7]), ev('-', 4, T[7]));
  kurs.push(ev('note', 4, T[8], { wert: '2' }));                    // … + direkte Note 2 (wiegt EINEN Termin)
  const v4 = verdichte(kurs, 4, { profil: 'sek1' });
  assert.ok(v4.vorschlag);
  assert.equal(v4.vorschlag.label, '2-');                           // Zero 2026-07-10: kein 50:50-Kollektivgewicht mehr
});

test('Termingewichtung: EINE Bestnote dominiert 9 neutrale Termine NICHT', () => {
  // 9 Termine nur o (Note 3) + eine direkte 1 (⭐): 50:50 hätte (3+1)/2='2' ergeben —
  // termingewichtet (3·9 + 1·1)/10 = 2.8 → '3+'. Referate wiegen in der Excel-Mappe, nicht hier.
  const k2 = [];
  for (const t of T) k2.push(ev('o', 7, t));
  k2.push(ev('note', 7, T[9], { wert: '1', best: true }));
  const v7 = verdichte(k2.filter(e => e.datum !== T[9] || e.typ === 'note'), 7, { profil: 'sek1' }); // T10 nur die Note
  const v = verdichte(k2, 7, { profil: 'sek1' });
  assert.equal(v.vorschlag.label, '3+');                            // 10×o + Note 1 → (3·10+1)/11 ≈ 2.82 → 8/3
  assert.equal(v7.vorschlag.label, '3+');                           // 9×o + Note 1 → 2.8 → 8/3
});

test('Storniertes + zählt nicht', () => {
  const plus5 = ev('+', 5, T[0]);
  const storno5 = ev('storno', 5, T[1], { stornoVon: plus5.id });
  const v5 = verdichte([...kurs, plus5, storno5], 5, { profil: 'sek1' });
  assert.equal(v5.nPlus, 0);
  assert.equal(v5.vorschlag, null);
});

// ── Ein Zeichen je Stunde (Zero 2026-09-29): dieselbe Verklebung wie addEvent in app.mjs ──
function buche(log, e) {
  const ers = ersetzungFuer(log, e);
  if (ers) {
    for (const a of ers.still) log.push(ev('storno', a.schuelerNr, a.datum, { kursId: a.kursId, stornoVon: a.id }));
    e.stornoVon = ers.ersetzt.id;
    if (ers.notiz) e.notiz = ers.notiz;
  }
  log.push(e);
  return ers;
}
const rueck = (log, e) => log.push(ev('storno', e.schuelerNr, e.datum, { kursId: e.kursId, stornoVon: e.id }));
const D = '2026-09-21', K = 'k1';
const typen = log => wirksameEvents(log).filter(e => e.typ !== 'storno').map(e => e.typ).sort();

test('Ein Zeichen je Stunde: o ersetzt ＋, Rückgängig bringt ＋ zurück', () => {
  const log = [ev('+', 1, D, { kursId: K })];
  const o = ev('o', 1, D, { kursId: K });
  assert.equal(buche(log, o).ersetzt.typ, '+');
  let v = verdichte(log, 1, { profil: 'sek1' });
  assert.equal(v.nPlus, 0); assert.equal(v.nNull, 1);
  rueck(log, o);
  v = verdichte(log, 1, { profil: 'sek1' });
  assert.equal(v.nPlus, 1); assert.equal(v.nNull, 0);
});

test('Ersetzt wird nur dieselbe Stunde, derselbe Kurs, dasselbe Kind — Notiz und Fehlzeit bleiben', () => {
  const log = [ev('+', 1, D, { kursId: K }), ev('notiz', 1, D, { kursId: K, notiz: 'x' }), ev('fehlt_o', 1, D, { kursId: K }),
    ev('+', 2, D, { kursId: K }), ev('+', 1, '2026-09-22', { kursId: K }), ev('+', 1, D, { kursId: 'k2' })];
  const minus = ev('-', 1, D, { kursId: K });
  const ers = buche(log, minus);
  assert.equal(ers.still.length, 0);
  assert.deepEqual(typen(log), ['+', '+', '+', '-', 'fehlt_o', 'notiz']);   // nur das eine ＋ von Kind 1 in k1 am 21.09. ist weg
  assert.equal(buche(log, ev('notiz', 1, D, { kursId: K, notiz: 'y' })), null);   // Notiz ersetzt nichts
  assert.equal(buche(log, ev('fehlt_e', 1, D, { kursId: K })), null);              // Fehlzeit ersetzt nichts
});

test('Direkte Note, ⭐ und ⊘ zählen als Zeichen', () => {
  const log = [ev('note', 1, D, { kursId: K, wert: '1', best: true })];
  buche(log, ev('verweigert', 1, D, { kursId: K }));
  buche(log, ev('note', 1, D, { kursId: K, wert: '2-' }));
  assert.deepEqual(typen(log), ['note']);
  assert.equal(wirksameEvents(log).find(e => e.typ === 'note').wert, '2-');
});

test('Altlast: zwei Zeichen in einer Stunde → − ersetzt beide, Rückgängig bringt nur das jüngste', () => {
  const log = [ev('o', 1, D, { kursId: K, ts: D + 'T08:10:00Z' }), ev('+', 1, D, { kursId: K, ts: D + 'T08:00:00Z' })];  // Reihenfolge im Log ≠ Zeit
  const minus = ev('-', 1, D, { kursId: K });
  assert.equal(buche(log, minus).still.length, 1);
  assert.deepEqual(typen(log), ['-']);
  rueck(log, minus);
  assert.deepEqual(typen(log), ['o']);
});

test('Begründung von ⊘ geht mit dem ⊘ (Zero 2026-09-30) und kommt mit Rückgängig zurück', () => {
  const log = [ev('verweigert', 1, D, { kursId: K, notiz: 'Aufgabe verweigert' })];
  const plus = ev('+', 1, D, { kursId: K });
  buche(log, plus);
  const texte = () => wirksameEvents(log).filter(e => e.notiz).map(e => e.typ + ':' + e.notiz);
  assert.deepEqual(texte(), []);                                 // kein „＋ · Aufgabe verweigert“
  rueck(log, plus);                                              // ⊘ kommt mit seiner Notiz zurück, ＋ ist weg
  assert.deepEqual(texte(), ['verweigert:Aufgabe verweigert']);
  const wieder = ev('+', 1, D, { kursId: K, notiz: plus.notiz }); // ↷ Wiederherstellen: Sachfelder reisen mit
  buche(log, wieder);
  assert.deepEqual(texte(), []);
});

test('Notiz an einem anderen ersetzten Zeichen reist weiter mit', () => {
  const log = [ev('o', 1, D, { kursId: K, notiz: 'an der Tafel' })];
  buche(log, ev('+', 1, D, { kursId: K }));
  assert.deepEqual(wirksameEvents(log).filter(e => e.notiz).map(e => e.typ + ':' + e.notiz), ['+:an der Tafel']);
});

test('istTerminEintrag: Rücknahme und Quartalsnote machen keinen Termin, alles andere schon', () => {
  const D0 = '2026-09-21';
  assert.equal(istTerminEintrag({ typ: 'storno', datum: D0 }), false);
  assert.equal(istTerminEintrag({ typ: 'quartalsnote', datum: D0 }), false);
  assert.equal(istTerminEintrag({ typ: '+' }), false);                    // ohne Datum kein Termin
  for (const t of ['+', 'o', '-', 'note', 'verweigert', 'fehlt_o', 'fehlt_e', 'fehlt_u', 'versp', 'notiz', 'mat', 'ha', 'ipad_fehlt', 'ipad_leer', 'lernzeit'])
    assert.equal(istTerminEintrag({ typ: t, datum: D0 }), true, t);
  // gleiche Definition wie verdichte: ein zurückgenommenes ∅ macht den Tag nicht zum Kurstermin
  const o = ev('fehlt_o', 3, D0);
  const v = verdichte([o, ev('storno', 3, D0, { stornoVon: o.id })], 3, { profil: 'sek1' });
  assert.equal(v.kursTermine, 0);
});

test('regelText nennt die Formel', () => {
  const v1 = verdichte(kurs, 1, { profil: 'sek1' });
  assert.ok(v1.regelText.includes('score'));
  assert.ok(v1.regelText.includes('3 − 5/3·score'));
  assert.ok(verdichte(kurs, 1, { profil: 'sek2' }).regelText.includes('8 + 5·score'));
});

// ── Eine Verspätung je Termin (Scheibe 5, Prüfer 03.10. 🔴 1/🟡 2): ersetzen statt addieren, auch nach ↶ + ↷ ──
const minutenAm = (log, nr = 1, kursId = K) => wirksameEvents(log).filter(e => e.typ === 'versp' && e.schuelerNr === nr && e.kursId === kursId && e.datum === D).reduce((s, e) => s + e.minuten, 0);
test('Verspätung: 20 ersetzt 14, ↶ bringt 14, ↷ (neu gebucht, ohne stornoVon) ersetzt wieder → 20, nie 34', () => {
  const log = [];
  buche(log, ev('versp', 1, D, { kursId: K, minuten: 14 }));
  const b = ev('versp', 1, D, { kursId: K, minuten: 20 });
  assert.equal(buche(log, b).ersetzt.minuten, 14);
  assert.equal(minutenAm(log), 20);
  rueck(log, b); assert.equal(minutenAm(log), 14);
  buche(log, ev('versp', 1, D, { kursId: K, minuten: 20 }));
  assert.equal(minutenAm(log), 20);
});
test('Verspätung: Doppelte (zwei Geräte, Altbestand) — eine neue ersetzt die jüngste, die älteren still', () => {
  const log = [ev('versp', 1, D, { kursId: K, minuten: 5 }), ev('versp', 1, D, { kursId: K, minuten: 10 })];
  assert.equal(minutenAm(log), 15);
  const ers = buche(log, ev('versp', 1, D, { kursId: K, minuten: 20 }));
  assert.equal(ers.ersetzt.minuten, 10); assert.equal(ers.still.length, 1);
  assert.equal(minutenAm(log), 20);
});
test('Verspätung und Bewertung ersetzen sich nicht; anderer Tag, Schüler oder Kurs bleibt', () => {
  const log = [ev('+', 1, D, { kursId: K }), ev('versp', 1, '2026-09-22', { kursId: K, minuten: 7 }), ev('versp', 2, D, { kursId: K, minuten: 9 }), ev('versp', 1, D, { kursId: 'k2', minuten: 3 })];
  assert.equal(buche(log, ev('versp', 1, D, { kursId: K, minuten: 12 })), null);
  assert.equal(buche(log, ev('o', 1, D, { kursId: K })).ersetzt.typ, '+');
  assert.deepEqual([minutenAm(log), minutenAm(log, 2), minutenAm(log, 1, 'k2')], [12, 9, 3]);
  assert.equal(wirksameEvents(log).filter(e => e.typ === 'versp' && e.datum === '2026-09-22').length, 1);
});
test('Verspätung, Doppelstunde (Zero 03.10.): Block 1 und Block 6 zählen zusammen; im selben Block ersetzt; ohne Block ersetzt wie bisher', () => {
  const log = [];
  assert.equal(buche(log, ev('versp', 1, D, { kursId: K, minuten: 10, blockNr: 1 })), null);
  assert.equal(buche(log, ev('versp', 1, D, { kursId: K, minuten: 7, blockNr: 6 })), null);
  assert.equal(minutenAm(log), 17);
  assert.equal(buche(log, ev('versp', 1, D, { kursId: K, minuten: 9, blockNr: 6 })).ersetzt.minuten, 7);
  assert.equal(minutenAm(log), 19);
  buche(log, ev('versp', 1, D, { kursId: K, minuten: 5 }));   // ohne Block (Nachtrag): Tagesregel, ersetzt die jüngste, die ältere still
  assert.equal(minutenAm(log), 5);
});

// ── ∅ und ⏰ schließen sich in einer Stunde aus (v1.17.1 Blockmodell, Zero 03.10.: „⏰ nimmt ∅ zurück“; Prüfer 🟡 4, ❓ 5) ──
// Eigene Uhr: die Reihenfolge hängt an ts, und der Zähler von ev() läuft über 99 hinaus (dann stimmte der Stringvergleich nicht mehr)
let tk = 0;
const zt = () => D + 'T10:' + String(Math.floor(tk / 60)).padStart(2, '0') + ':' + String(tk++ % 60).padStart(2, '0') + 'Z';
const evA = (typ, extra = {}) => ev(typ, 1, D, { kursId: K, ts: zt(), ...extra });
const offenO = log => wirksameEvents(log).filter(e => e.typ === 'fehlt_o').length;
test('Anwesenheit: ⏰ auf ∅ derselben Stunde ersetzt es („kommt doch“), ↶ bringt ∅', () => {
  const log = [evA('fehlt_o', { blockNr: 6 })];
  const v = evA('versp', { minuten: 7, blockNr: 6 });
  assert.equal(buche(log, v).ersetzt.typ, 'fehlt_o');
  assert.deepEqual([offenO(log), minutenAm(log)], [0, 7]);
  rueck(log, v);
  assert.deepEqual([offenO(log), minutenAm(log)], [1, 0]);
});
test('Anwesenheit B1: ⏰ 7 → ∅ → ⏰ 10 → ↶ ergibt den Stand davor (∅, keine Minuten)', () => {
  const log = [];
  buche(log, evA('versp', { minuten: 7, blockNr: 6 }));
  assert.equal(buche(log, evA('fehlt_o', { blockNr: 6 })).ersetzt.typ, 'versp');   // ∅ ersetzt die Verspätung derselben Stunde
  assert.deepEqual([offenO(log), minutenAm(log)], [1, 0]);
  const v10 = evA('versp', { minuten: 10, blockNr: 6 });
  buche(log, v10);
  assert.deepEqual([offenO(log), minutenAm(log)], [0, 10]);
  rueck(log, v10);
  assert.deepEqual([offenO(log), minutenAm(log)], [1, 0]);
});
test('Anwesenheit B4: ∅ → ⏰ 7 → ∅ → ⏰ 10 → kein ∅ bleibt offen', () => {
  const log = [];
  for (const e of [evA('fehlt_o', { blockNr: 6 }), evA('versp', { minuten: 7, blockNr: 6 }), evA('fehlt_o', { blockNr: 6 }), evA('versp', { minuten: 10, blockNr: 6 })]) buche(log, e);
  assert.deepEqual([offenO(log), minutenAm(log)], [0, 10]);
});
test('Anwesenheit, zwei Geräte: ∅ und eine angepasste Verspätung nebeneinander → ⏰ 8 = 8, nichts lebt wieder auf', () => {
  const v5 = evA('versp', { minuten: 5, blockNr: 6 });
  const log = [v5, evA('versp', { minuten: 7, blockNr: 6, stornoVon: v5.id }), evA('fehlt_o', { blockNr: 6 })];   // Handy: 5 → 7 · iPad: ∅
  assert.deepEqual([offenO(log), minutenAm(log)], [1, 7]);
  const ers = buche(log, evA('versp', { minuten: 8, blockNr: 6 }));
  assert.equal(ers.ersetzt.typ, 'fehlt_o');
  assert.deepEqual([offenO(log), minutenAm(log)], [0, 8]);   // vorher: der Storno auf die 7 brachte die 5 zurück → 13
});
test('Anwesenheit ❓ 5: ⏰ in Block 6 klärt das ∅ aus Block 1 nicht; ein ∅ ohne Block (Altbestand) schon', () => {
  const log = [evA('fehlt_o', { blockNr: 1 })];
  assert.equal(buche(log, evA('versp', { minuten: 7, blockNr: 6 })), null);
  assert.deepEqual([offenO(log), minutenAm(log)], [1, 7]);
  const alt = [evA('fehlt_o')];
  assert.equal(buche(alt, evA('versp', { minuten: 7, blockNr: 6 })).ersetzt.typ, 'fehlt_o');
});
// ── Eine Quartalsnote je Quartal (Scheibe 6, Zero 03.10.: „A · Notengitter“): die neue ersetzt die bisherige über stornoVon, auch wenn ihr
// Zeitstempel älter ist (Uhr eines Geräts geht nach; Sim mit Daten bis November) — vorher entschied allein der Zeitstempel ──
const qnAm = (log, hj, q) => wirksameEvents(log).filter(e => e.typ === 'quartalsnote' && e.hj === hj && e.quartal === q).map(e => e.wert);
test('Quartalsnote: die neue ersetzt die alte desselben Quartals trotz älterem Zeitstempel, ↶ bringt die alte', () => {
  const alt = ev('quartalsnote', 1, '2026-11-06', { kursId: K, hj: 1, quartal: 1, wert: '1', ts: '2026-11-06T11:07:06.000Z' });
  const log = [alt];
  const neu = ev('quartalsnote', 1, '2026-10-01', { kursId: K, hj: 1, quartal: 1, wert: '2', ts: '2026-10-01T08:40:00.000Z' });
  assert.equal(buche(log, neu).ersetzt.wert, '1');
  assert.deepEqual(qnAm(log, 1, 1), ['2']);
  rueck(log, neu);
  assert.deepEqual(qnAm(log, 1, 1), ['1']);
});
test('Quartalsnote: anderes Quartal, anderer Schüler oder Kurs bleibt; eine Bewertung am selben Tag auch', () => {
  const log = [ev('quartalsnote', 1, D, { kursId: K, hj: 1, quartal: 1, wert: '2' }), ev('quartalsnote', 2, D, { kursId: K, hj: 1, quartal: 2, wert: '3' }),
    ev('quartalsnote', 1, D, { kursId: 'k2', hj: 1, quartal: 2, wert: '4' }), ev('+', 1, D, { kursId: K })];
  assert.equal(buche(log, ev('quartalsnote', 1, D, { kursId: K, hj: 1, quartal: 2, wert: '1' })), null);
  assert.deepEqual([qnAm(log, 1, 1), typen(log).filter(t => t === '+').length], [['2'], 1]);
});
test('Bewertungs-Doppelte (zwei Geräte): der Storno auf ein älteres Zeichen lässt dessen Ersetztes nicht wieder aufleben', () => {
  const o = evA('o');
  const log = [o, evA('+', { stornoVon: o.id }), evA('-')];   // iPad: o → ＋ · Handy: −
  const ers = buche(log, evA('note', { wert: '2' }));
  assert.equal(ers.ersetzt.typ, '-');
  assert.deepEqual(typen(log), ['note']);                      // vorher: ['note', 'o']
});
