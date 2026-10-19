// kladde/test/ausnahmen · Tages-Entfall nur für geplante Blöcke + Slot-Arten (Zero 2026-09-02)
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBloecke } from '../logic/zeitmodell.mjs';
import { kursZurZeit, slotFuerBlock, geplanteBlockNrn, bereinigeAusnahmen, tagesAusfall, entfallZurueck, ausnahmeEntfernen, setzeSlot, SLOT_ARTEN } from '../logic/autowahl.mjs';

const ZM = { id: 'std', startSekunden: 27900, dauerSekunden: 4050, bloeckeProTag: 6,
  pausenNachBlock: { 1: 300, 2: 1200, 3: 300, 4: 2700 }, tagesAusnahmen: {}, abWochenAnker: { datum: '2026-08-24', typ: 'A' } };
const PLAN = [
  { wochentag: 1, blockNr: 1, kursId: '7b', teilgruppe: null, rhythmus: 'jede' },
  { wochentag: 1, blockNr: 3, kursId: 'q1', teilgruppe: null, rhythmus: 'A' },       // nur A-Woche
  { wochentag: 1, blockNr: 5, kursId: null, art: 'klasse', teilgruppe: null, rhythmus: 'jede' },
  { wochentag: 2, blockNr: 2, kursId: null, art: 'reserve', teilgruppe: null, rhythmus: 'jede' },
];
const ctx = (ausnahmen = []) => ({ zeitmodell: ZM, wochenplan: PLAN, ausnahmen });
const MO_A = '2026-08-24', MO_B = '2026-08-31';

test('geplante Blöcke: nur belegte Stunden, A/B-Woche berücksichtigt', () => {
  const bl = resolveBloecke(ZM, 1);
  assert.deepEqual(geplanteBlockNrn(MO_A, 1, bl, ctx()), [1, 3, 5]);   // Block 2/4/6 sind frei
  assert.deepEqual(geplanteBlockNrn(MO_B, 1, bl, ctx()), [1, 5]);      // q1 fällt in der B-Woche weg
});

test('geplante Blöcke ignorieren vorhandene Ausnahmen (Entfall ändert den Plan nicht)', () => {
  const bl = resolveBloecke(ZM, 1);
  assert.deepEqual(geplanteBlockNrn(MO_A, 1, bl, ctx([{ datum: MO_A, blockNr: 1, kursId: null }])), [1, 3, 5]);
});

test('Slot-Art: Klassenstunde liefert kursId null + art, kein Kurswechsel-Ziel', () => {
  const s = slotFuerBlock(MO_A, 1, 5, ctx());
  assert.deepEqual(s, { kursId: null, art: 'klasse', teilgruppe: null, quelle: 'plan' });
  const t = kursZurZeit(new Date(2026, 7, 24, 13, 50, 0), ctx());   // Block 5 läuft (13:47–14:54)
  assert.equal(t.art, 'klasse'); assert.equal(t.kursId, null); assert.equal(t.blockNr, 5);
  assert.ok(SLOT_ARTEN[t.art].label);
});

test('Slot ohne Art bleibt strukturell wie bisher (kein art-Feld)', () => {
  const s = slotFuerBlock(MO_A, 1, 1, ctx());
  assert.deepEqual(s, { kursId: '7b', teilgruppe: null, quelle: 'plan' });
  assert.equal('art' in kursZurZeit(new Date(2026, 7, 24, 8, 0, 0), ctx()), false);
});

test('Bereinigung: Entfall auf freiem Block fliegt raus, geplanter Entfall + Vertretung bleiben', () => {
  const stamm = { zeitmodelle: [ZM], wochenplan: PLAN, ausnahmeSlots: [
    { datum: MO_A, blockNr: 1, kursId: null, grund: 'entfall' },      // geplant → bleibt
    { datum: MO_A, blockNr: 2, kursId: null, grund: 'entfall' },      // frei → weg
    { datum: MO_B, blockNr: 3, kursId: null, grund: 'entfall' },      // B-Woche, q1 nicht dran → weg
    { datum: MO_A, blockNr: 4, kursId: '8a', grund: 'vertretung' },   // Vertretung in freier Stunde → bleibt
    { datum: MO_A, blockNr: 5, kursId: null, grund: 'entfall' },      // Klassenstunde geplant → bleibt
  ] };
  assert.equal(bereinigeAusnahmen(stamm), true);
  assert.deepEqual(stamm.ausnahmeSlots.map(a => a.datum + '/' + a.blockNr), [MO_A + '/1', MO_A + '/4', MO_A + '/5']);
  assert.equal(bereinigeAusnahmen(stamm), false);   // idempotent
});

// ── A/B-Paar im Wochenplan-Assistenten (Prüfer 2026-09-29: der Dialog ersetzte immer DEN Slot des Blocks)
const slotIn = (plan, datum, block) => slotFuerBlock(datum, 1, block, { wochenplan: plan, ausnahmen: [], zeitmodell: ZM });
const physik = { kursId: 'ph9', teilgruppe: null }, chemie = { kursId: 'ch9', teilgruppe: null };

test('setzeSlot: A und B nacheinander ergeben ein Paar, die Autowahl liest je Woche den richtigen Kurs', () => {
  let plan = setzeSlot([], 1, 2, 'A', physik);
  plan = setzeSlot(plan, 1, 2, 'B', chemie);
  assert.equal(plan.length, 2);
  assert.equal(slotIn(plan, MO_A, 2).kursId, 'ph9');
  assert.equal(slotIn(plan, MO_B, 2).kursId, 'ch9');
  assert.deepEqual(plan.map(p => p.id).sort(), ['wp-1-2-A', 'wp-1-2-B']);   // eindeutige ids
  plan = setzeSlot(plan, 1, 2, 'A', { kursId: 'bio9' });                   // A neu belegen lässt B stehen
  assert.deepEqual([slotIn(plan, MO_A, 2).kursId, slotIn(plan, MO_B, 2).kursId], ['bio9', 'ch9']);
});

test('setzeSlot: „jede Woche“ ersetzt ein Paar ganz, frei räumt je nach Woche', () => {
  const paar = setzeSlot(setzeSlot([], 1, 2, 'A', physik), 1, 2, 'B', chemie);
  const jede = setzeSlot(paar, 1, 2, 'jede', { kursId: '7b' });
  assert.deepEqual(jede.map(p => p.kursId), ['7b']);
  assert.equal(setzeSlot(paar, 1, 2, 'jede', null).length, 0);
  const nurB = setzeSlot(paar, 1, 2, 'A', null);
  assert.equal(slotIn(nurB, MO_A, 2), null);
  assert.equal(slotIn(nurB, MO_B, 2).kursId, 'ch9');
});

test('setzeSlot: ein „jede Woche“-Kurs bleibt für die andere Woche stehen, wenn nur eine Woche neu belegt wird', () => {
  const plan = setzeSlot(setzeSlot([], 1, 2, 'jede', physik), 1, 2, 'B', chemie);
  assert.equal(slotIn(plan, MO_A, 2).kursId, 'ph9');
  assert.equal(slotIn(plan, MO_B, 2).kursId, 'ch9');
  assert.equal(plan.length, 2);
  const frei = setzeSlot(setzeSlot([], 1, 2, 'jede', physik), 1, 2, 'A', null);   // A-Woche frei, B behält den Kurs
  assert.equal(slotIn(frei, MO_A, 2), null);
  assert.equal(slotIn(frei, MO_B, 2).kursId, 'ph9');
  // andere Blöcke bleiben unberührt, der alte Plan auch
  const alt = [{ wochentag: 1, blockNr: 1, kursId: '7b', rhythmus: 'jede' }];
  const n = setzeSlot(alt, 1, 2, 'A', physik);
  assert.equal(alt.length, 1);
  assert.equal(n.find(p => p.blockNr === 1).kursId, '7b');
});

// ── Ausfall-Griffe des Stundenplans (Scheibe 2, Prüfer 2026-10-02) ──
const VERTR = { datum: MO_A, blockNr: 3, kursId: '7b', teilgruppe: null, grund: 'vertretung' };
const TAUSCH = [{ datum: MO_B, blockNr: 1, kursId: 'q1', teilgruppe: null, grund: 'tausch' }, { datum: MO_B, blockNr: 3, kursId: '7b', teilgruppe: null, grund: 'tausch' }];
const sortiert = l => [...l].sort((a, b) => a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.blockNr - b.blockNr);
test('Ganzer Tag: Entfall für die Blöcke, eine alte Vertretung wandert in „ersetzt“ und kommt bei der Rücknahme zurück', () => {
  const vor = [VERTR, { datum: MO_B, blockNr: 1, kursId: null }];
  const aus = tagesAusfall(vor, MO_A, [1, 3, 5], true);
  assert.deepEqual(sortiert(aus).map(a => [a.datum, a.blockNr, a.kursId, a.ersetzt?.kursId ?? null]),
    [[MO_A, 1, null, null], [MO_A, 3, null, '7b'], [MO_A, 5, null, null], [MO_B, 1, null, null]]);
  const zurueck = tagesAusfall(aus, MO_A, [1, 3, 5], false);
  assert.deepEqual(sortiert(zurueck), sortiert(vor));
});
test('Ganzer Tag über ein altes Tauschpaar: Rücknahme stellt beide Hälften wieder her', () => {
  const aus = tagesAusfall(TAUSCH, MO_B, [1, 3, 5], true);
  assert.equal(aus.filter(a => a.kursId === null).length, 3);
  assert.deepEqual(sortiert(tagesAusfall(aus, MO_B, [1, 3, 5], false)), sortiert(TAUSCH));
});
test('Ganzer Tag, wenn eine Stunde schon ausfällt: danach nimmt die Rücknahme alle Ausfälle des Tages zurück, keiner bleibt hängen', () => {
  const aus = tagesAusfall([{ datum: MO_A, blockNr: 3, kursId: null, teilgruppe: null, grund: 'entfall' }], MO_A, [1, 3, 5], true);
  assert.equal(aus.filter(a => a.datum === MO_A && a.kursId === null).length, 3);
  assert.deepEqual(tagesAusfall(aus, MO_A, [1, 3, 5], false), []);
});
test('Ganzer Tag ohne geplante Stunde und Rücknahme ohne Entfall ändern nichts (dasselbe Array, kein Speichern)', () => {
  const l = [VERTR];
  assert.equal(tagesAusfall(l, MO_A, [], true), l);
  assert.equal(tagesAusfall(l, MO_A, [1, 3], false), l);
});
test('Einzelner Entfall zurück: trägt er eine alte Vertretung, steht sie wieder da; sonst ist er weg', () => {
  const aus = tagesAusfall([VERTR], MO_A, [1, 3], true);
  assert.deepEqual(sortiert(entfallZurueck(aus, MO_A, 3)).map(a => [a.blockNr, a.kursId, a.grund]), [[1, null, 'entfall'], [3, '7b', 'vertretung']]);
  assert.deepEqual(entfallZurueck(aus, MO_A, 1).map(a => a.blockNr), [3]);
  assert.equal(entfallZurueck(aus, MO_A, 6), aus);
});
test('Alte Ausnahme entfernen: ein Tausch geht als Paar, eine Vertretung allein, andere Tage bleiben', () => {
  const l = [...TAUSCH, VERTR, { datum: '2026-09-07', blockNr: 2, kursId: 'q1', grund: 'tausch' }];
  assert.deepEqual(ausnahmeEntfernen(l, MO_B, 3).map(a => [a.datum, a.blockNr]), [[MO_A, 3], ['2026-09-07', 2]]);
  assert.deepEqual(ausnahmeEntfernen(l, MO_A, 3).map(a => [a.datum, a.blockNr]), [[MO_B, 1], [MO_B, 3], ['2026-09-07', 2]]);
});
test('Bereinigung behält einen Entfall, der eine alte Vertretung trägt — auch auf inzwischen freiem Block', () => {
  const stamm = { zeitmodelle: [ZM], wochenplan: PLAN, ausnahmeSlots: [{ datum: MO_A, blockNr: 2, kursId: null, ersetzt: { kursId: '7b', teilgruppe: null, grund: 'vertretung' } }] };
  assert.equal(bereinigeAusnahmen(stamm), false);
  assert.equal(stamm.ausnahmeSlots.length, 1);
});
test('Bereinigung ohne Zeitmodell oder ohne Ausnahmen: nichts geändert', () => {
  assert.equal(bereinigeAusnahmen({ zeitmodelle: [], wochenplan: PLAN, ausnahmeSlots: [{ datum: MO_A, blockNr: 2, kursId: null }] }), false);
  assert.equal(bereinigeAusnahmen({ zeitmodelle: [ZM], wochenplan: PLAN, ausnahmeSlots: [] }), false);
});
