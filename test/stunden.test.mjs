// kladde/test/stunden · ‹ › = vorige/nächste Stunde des Kurses laut Plan (Zero 2026-10-01, Untermenü-Runde Scheibe 1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { tagesStunden, stundenAm, stundeDesKurses, kursTag, naechsteStunde, kalenderwoche, stundeFuerBuchung, stundeFaelltAus } from '../logic/stunden.mjs';

// Mo 28.09.2026 = B-Woche (Anker) · Herbstferien 05.–16.10.
const ZM = { bloeckeProTag: 7, dauerSekunden: 4050, startSekunden: 27900, pausenNachBlock: {},
  abWochenAnker: { datum: '2026-09-28', typ: 'B' }, ferien: [{ von: '2026-10-05', bis: '2026-10-16', name: 'Herbstferien' }] };
const PLAN = [
  { wochentag: 1, blockNr: 2, kursId: '7b', rhythmus: 'jede' },
  { wochentag: 2, blockNr: 2, kursId: '8c', rhythmus: 'jede' },
  { wochentag: 3, blockNr: 2, kursId: '7b', rhythmus: 'B' },
  { wochentag: 4, blockNr: 1, kursId: '7b', rhythmus: 'jede' },
  { wochentag: 4, blockNr: 7, kursId: '7b', rhythmus: 'jede' },
  { wochentag: 5, blockNr: 3, kursId: null, art: 'klasse', rhythmus: 'jede' },
];
const AUSNAHMEN = [
  { datum: '2026-09-24', blockNr: 1, kursId: null },          // Do 24.09.: beide 7b-Stunden fallen aus
  { datum: '2026-09-24', blockNr: 7, kursId: null },
  { datum: '2026-09-29', blockNr: 3, kursId: '7b' },          // Di 29.09.: Vertretung in der 7b
];
const K = { zeitmodell: ZM, wochenplan: PLAN, ausnahmen: AUSNAHMEN };
const HEUTE = '2026-10-01';

test('‹ von Do 01.10. → Mi 30.09. (B-Woche-Slot)', () => {
  assert.deepEqual(naechsteStunde('7b', '2026-10-01', -1, K), { datum: '2026-09-30', blockNr: 2, teilgruppe: null });
});
test('‹ von Mi 30.09. → Di 29.09. (Vertretung zählt als Stunde)', () => {
  assert.deepEqual(naechsteStunde('7b', '2026-09-30', -1, K), { datum: '2026-09-29', blockNr: 3, teilgruppe: null });
});
test('‹ von Mo 28.09. überspringt Entfall-Tag, A-Woche-Mittwoch und Tag ohne 7b → Mo 21.09.', () => {
  // Fr 25.09. nur Klassenstunde, Do 24.09. Entfall, Mi 23.09. A-Woche, Di 22.09. nur 8c
  assert.deepEqual(naechsteStunde('7b', '2026-09-28', -1, K), { datum: '2026-09-21', blockNr: 2, teilgruppe: null });
});
test('› nie über heute hinaus', () => {
  assert.equal(naechsteStunde('7b', HEUTE, 1, K, HEUTE), null);
  assert.deepEqual(naechsteStunde('7b', '2026-09-28', 1, K, HEUTE), { datum: '2026-09-29', blockNr: 3, teilgruppe: null });
});
test('› springt über die Ferien (ohne Grenze) → Mo 19.10.', () => {
  assert.deepEqual(naechsteStunde('7b', '2026-10-02', 1, K), { datum: '2026-10-19', blockNr: 2, teilgruppe: null });
});
test('zwei Stunden am selben Tag sind EIN Ziel: ‹ von Fr 02.10. → Do 01.10. Std. 1', () => {
  assert.deepEqual(naechsteStunde('7b', '2026-10-02', -1, K), { datum: '2026-10-01', blockNr: 1, teilgruppe: null });
});
test('stundenAm: Di 29.09. = 8c Std. 2 + 7b Std. 3 (Vertretung), in Block-Reihenfolge', () => {
  assert.deepEqual(stundenAm('2026-09-29', K).map(s => [s.blockNr, s.kursId, s.quelle]), [[2, '8c', 'plan'], [3, '7b', 'ausnahme']]);
});
test('stundenAm: Entfall-Tag leer, Ferientag leer, Wochenende leer, Klassenstunde bleibt (ohne Kurs)', () => {
  assert.deepEqual(stundenAm('2026-09-24', K), []);
  assert.deepEqual(stundenAm('2026-10-08', K), []);
  assert.deepEqual(stundenAm('2026-10-03', K), []);
  assert.deepEqual(stundenAm('2026-09-25', K).map(s => [s.blockNr, s.kursId, s.art]), [[3, null, 'klasse']]);
});
test('stundeDesKurses: Tag ohne den Kurs → null (dann Auswahl der Stunden des Tages, Zero 01.10.)', () => {
  assert.equal(stundeDesKurses('7b', '2026-09-22', K), null);
  assert.equal(stundeDesKurses('7b', '2026-10-01', K).blockNr, 1);
});
test('‹ › liefert die Halbgruppe der Zielstunde (Mo Gr. A, Mi Gr. B, Fr ganzer Kurs) — Prüfer 2026-10-01', () => {
  const PLAN_G = [
    { wochentag: 1, blockNr: 4, kursId: '5a', teilgruppe: 'A', rhythmus: 'jede' },
    { wochentag: 3, blockNr: 4, kursId: '5a', teilgruppe: 'B', rhythmus: 'jede' },
    { wochentag: 5, blockNr: 2, kursId: '5a', rhythmus: 'jede' },
  ];
  const KG = { zeitmodell: ZM, wochenplan: PLAN_G, ausnahmen: [] };
  assert.deepEqual(naechsteStunde('5a', '2026-10-01', -1, KG), { datum: '2026-09-30', blockNr: 4, teilgruppe: 'B' });
  assert.deepEqual(naechsteStunde('5a', '2026-09-30', -1, KG), { datum: '2026-09-28', blockNr: 4, teilgruppe: 'A' });
  assert.deepEqual(naechsteStunde('5a', '2026-09-28', -1, KG), { datum: '2026-09-25', blockNr: 2, teilgruppe: null });
});

// ── Scheibe 2 · Stundenplan „Ein Ort“ (Zero 2026-10-02): der Plan zeigt auch die ausgefallenen Stunden ──
test('tagesStunden: Entfall bleibt stehen, mit Kurs des Plans und quelle „entfall“ (Do 24.09. beide 7b-Stunden)', () => {
  assert.deepEqual(tagesStunden('2026-09-24', K).map(s => [s.blockNr, s.kursId, s.quelle]), [[1, '7b', 'entfall'], [7, '7b', 'entfall']]);
});
test('tagesStunden: alte Vertretung trägt den Kurs der Ausnahme (Di 29.09.)', () => {
  assert.deepEqual(tagesStunden('2026-09-29', K).map(s => [s.blockNr, s.kursId, s.quelle]), [[2, '8c', 'plan'], [3, '7b', 'ausnahme']]);
});
test('tagesStunden: Entfall auf laut Plan freier Stunde fällt weg, ausgefallene Klassenstunde bleibt mit art', () => {
  const KX = { ...K, ausnahmen: [...AUSNAHMEN, { datum: '2026-09-28', blockNr: 5, kursId: null }, { datum: '2026-09-25', blockNr: 3, kursId: null }] };
  assert.deepEqual(tagesStunden('2026-09-28', KX).map(s => [s.blockNr, s.kursId, s.quelle]), [[2, '7b', 'plan']]);
  assert.deepEqual(tagesStunden('2026-09-25', KX).map(s => [s.blockNr, s.kursId, s.art, s.quelle]), [[3, null, 'klasse', 'entfall']]);
});
test('tagesStunden: A/B-Woche, Ferien und Wochenende', () => {
  assert.deepEqual(tagesStunden('2026-09-23', K), []);                                  // Mi A-Woche: 7b nur in B
  assert.deepEqual(tagesStunden('2026-09-30', K).map(s => [s.blockNr, s.kursId]), [[2, '7b']]);
  assert.deepEqual(tagesStunden('2026-10-08', K), []);
  assert.deepEqual(tagesStunden('2026-10-04', K), []);
});
test('kalenderwoche: ISO-Woche, auch über den Jahreswechsel (2026 hat 53 Wochen)', () => {
  assert.equal(kalenderwoche('2026-09-28'), 40);
  assert.equal(kalenderwoche('2026-10-04'), 40);   // Sonntag gehört zur Woche davor
  assert.equal(kalenderwoche('2026-12-31'), 53);
  assert.equal(kalenderwoche('2027-01-03'), 53);
  assert.equal(kalenderwoche('2027-01-04'), 1);
  assert.equal(kalenderwoche('2025-12-29'), 1);    // Montag im alten Jahr, Woche 1 des neuen
});
test('stundenAm = tagesStunden ohne Entfall (eine Definition für ‹ › und Stundenplan)', () => {
  for (const d of ['2026-09-24', '2026-09-25', '2026-09-29', '2026-10-01'])
    assert.deepEqual(stundenAm(d, K), tagesStunden(d, K).filter(s => s.quelle !== 'entfall'));
});

// ── Planwechsel (Zero 02.10.: „setze deine empfehlungen um“): ‹ › hält zusätzlich an Tagen mit Einträgen ──
// Vorher 7b Mo + Mi, der neue Plan kennt nur Di + Do; Einträge stehen an Mo 28.09., Mi 30.09. und Do 01.10.
const PLAN_NEU = [
  { wochentag: 2, blockNr: 2, kursId: '7b', rhythmus: 'jede' },
  { wochentag: 4, blockNr: 3, kursId: '7b', rhythmus: 'jede' },
];
const KN = { zeitmodell: ZM, wochenplan: PLAN_NEU, ausnahmen: [], eintragsTage: new Set(['2026-09-28', '2026-09-30', '2026-10-01']) };
test('Planwechsel: ‹ von Do 01.10. hält an Eintragstagen (ohne Std.) und an Plan-Tagen', () => {
  assert.deepEqual(naechsteStunde('7b', '2026-10-01', -1, KN, HEUTE), { datum: '2026-09-30', blockNr: null, teilgruppe: null });
  assert.deepEqual(naechsteStunde('7b', '2026-09-30', -1, KN, HEUTE), { datum: '2026-09-29', blockNr: 2, teilgruppe: null });
  assert.deepEqual(naechsteStunde('7b', '2026-09-29', -1, KN, HEUTE), { datum: '2026-09-28', blockNr: null, teilgruppe: null });
  assert.deepEqual(naechsteStunde('7b', '2026-09-28', -1, KN, HEUTE), { datum: '2026-09-24', blockNr: 3, teilgruppe: null });
});
test('Planwechsel: ohne Eintragstage wie bisher — ‹ von Do 01.10. → Di 29.09.', () => {
  const ohne = { ...KN, eintragsTage: undefined };
  assert.deepEqual(naechsteStunde('7b', '2026-10-01', -1, ohne, HEUTE), { datum: '2026-09-29', blockNr: 2, teilgruppe: null });
});
test('kursTag: Plan-Tag mit Einträgen behält seine Stunde, Eintragstag ohne Plan-Stunde trägt keinen Block', () => {
  const st = kursTag('7b', '2026-10-01', KN);
  assert.equal(st.blockNr, 3); assert.equal(st.quelle, 'plan');
  assert.deepEqual(kursTag('7b', '2026-09-30', KN), { blockNr: null, teilgruppe: null, quelle: 'eintraege' });
  assert.equal(kursTag('7b', '2026-09-25', KN), null);   // Fr: weder Plan noch Einträge
});
test('Planwechsel: ausgefallene Stunde mit Einträgen hält, ohne Einträge nicht', () => {
  const aus = [{ datum: '2026-09-29', blockNr: 2, kursId: null }];
  assert.deepEqual(naechsteStunde('7b', '2026-09-30', -1, { ...KN, ausnahmen: aus, eintragsTage: new Set(['2026-09-29']) }, HEUTE),
    { datum: '2026-09-29', blockNr: null, teilgruppe: null });
  assert.deepEqual(naechsteStunde('7b', '2026-09-30', -1, { ...KN, ausnahmen: aus, eintragsTage: new Set() }, HEUTE),
    { datum: '2026-09-24', blockNr: 3, teilgruppe: null });
});
test('Planwechsel: ein Eintragstag nach heute wird nie angesprungen', () => {
  assert.equal(naechsteStunde('7b', HEUTE, 1, { ...KN, eintragsTage: new Set(['2026-10-02']) }, HEUTE), null);
});

// ── Welche Stunde betrifft eine Buchung? (v1.17.1 Blockmodell, Prüfer 03.10. 🔴 1 · 🟡 2/3 · ❓ 6) ──
// Raster wie die Sim: B1 07:45 · B2 09:13–10:20:30 · B3 10:26–11:33:30 · B4 11:53:30 · B5 13:46–14:53:30 · B6 14:59–16:06:30
const ZB = { bloeckeProTag: 6, dauerSekunden: 4050, startSekunden: 27900, pausenNachBlock: { 1: 1230, 2: 330, 3: 1200, 4: 2700, 5: 330 },
  abWochenAnker: { datum: '2026-09-28', typ: 'B' }, ferien: [{ von: '2026-10-05', bis: '2026-10-16', name: 'Herbstferien' }] };
const PLAN_B = [
  { wochentag: 4, blockNr: 1, kursId: '7b', rhythmus: 'jede' }, { wochentag: 4, blockNr: 3, kursId: '5a', rhythmus: 'jede' },
  { wochentag: 4, blockNr: 6, kursId: '7b', rhythmus: 'jede' },
  { wochentag: 5, blockNr: 2, kursId: '5a', rhythmus: 'jede' }, { wochentag: 5, blockNr: 3, kursId: '5a', rhythmus: 'jede' },   // Doppelstunde
  { wochentag: 5, blockNr: 5, kursId: '8c', rhythmus: 'jede' },
];
const KB = { zeitmodell: ZB, wochenplan: PLAN_B, ausnahmen: [] };
const DO = '2026-10-01', FR = '2026-10-02';
const um = (tag, h, m, s = 0) => new Date(2026, 9, tag, h, m, s);   // Ortszeit, wie die App
const stunde = (jetzt, termin, kursId, gewaehlt = null, handBlock = null) => {
  const st = stundeFuerBuchung(KB, { jetzt, termin, kursId, gewaehlt, handBlock });
  return st && [st.blockNr, st.laeuft];
};
test('Buchungsstunde: laufende eigene Stunde → sie, mit laeuft und Startzeit', () => {
  assert.deepEqual(stunde(um(2, 10, 40), FR, '5a'), [3, true]);
  assert.equal(stundeFuerBuchung(KB, { jetzt: um(2, 10, 40), termin: FR, kursId: '5a' }).startSek, 37560);
});
test('Buchungsstunde: Pause der Doppelstunde → der Block davor, nie der kommende (Prüfer 🔴 1)', () => {
  assert.deepEqual(stunde(um(2, 10, 23), FR, '5a'), [2, false]);
});
test('Buchungsstunde: eigene Stunde beginnt in ≤ 10 min → sie (Anwesenheit vor dem Gong)', () => {
  assert.deepEqual(stunde(um(2, 9, 5), FR, '5a'), [2, false]);
  assert.deepEqual(stunde(um(1, 14, 55), DO, '7b'), [6, false]);   // B1 war 7b, gleich beginnt B6 — die Anwesenheit gehört zu B6
});
test('Buchungsstunde: vor der ersten eigenen Stunde → sie, auch früh am Morgen (Prüfer zweite Runde 🟢 4)', () => {
  assert.deepEqual(stunde(um(1, 7, 30), DO, '7b'), [1, false]);
  assert.deepEqual(stunde(um(2, 7, 20), FR, '5a'), [2, false]);
  assert.deepEqual(stunde(um(2, 9, 0), FR, '8c'), [5, false]);     // 8c hat erst um 13:46
});
test('Buchungsstunde: Pause fern der eigenen Stunden → die zuletzt begonnene eigene (Korrektur danach)', () => {
  assert.deepEqual(stunde(um(1, 13, 20), DO, '7b'), [1, false]);
  assert.deepEqual(stunde(um(1, 16, 30), DO, '7b'), [6, false]);   // nach Schulschluss
});
test('Buchungsstunde: ein fremder laufender Block zählt nie — der Kurs ist nur noch offen (Prüfer zweite Runde 🔴 1)', () => {
  assert.deepEqual(stunde(um(1, 10, 40), DO, '7b'), [1, false]);   // 5a läuft in B3, 7b noch offen → seine Std. 1, kein Vorschlag
  assert.deepEqual(stunde(um(1, 9, 20), DO, '7b'), [1, false]);    // Freistunde B2
  const ausfall = { ...KB, ausnahmen: [{ datum: DO, blockNr: 3, kursId: null }] };
  assert.equal(stundeFuerBuchung(ausfall, { jetzt: um(1, 10, 40), termin: DO, kursId: '7b' }).blockNr, 1);
});
test('Buchungsstunde: Handwahl für den laufenden Block → er, mit laeuft (Zero 03.10.: „Nur wenn jetzt gewählt“)', () => {
  assert.deepEqual(stunde(um(1, 10, 40), DO, '7b', null, 3), [3, true]);
  assert.deepEqual(stunde(um(2, 9, 5), FR, '8c', null, 2), [2, false]);   // in der Pause für den kommenden Block gewählt
  assert.deepEqual(stunde(um(1, 15, 10), DO, '7b', null, 3), [6, true]);  // die Handwahl von B3 macht B6 nicht fremd
});
test('Buchungsstunde: gewählte Std. 1 → 1, ohne laeuft; die Wahl hält über den Blockwechsel (Zero: „Wahl hält“)', () => {
  assert.deepEqual(stunde(um(1, 15, 10), DO, '7b', 1), [1, false]);
  assert.deepEqual(stunde(um(1, 16, 30), DO, '7b', 1), [1, false]);
  assert.deepEqual(stunde(um(2, 10, 30), FR, '5a', 2), [2, false]);       // Std. 2 in der Pause gewählt, Block 3 läuft schon
  assert.deepEqual(stunde(um(1, 15, 10), DO, '7b', 6), [6, true]);        // die laufende gewählt
});
test('Buchungsstunde: Nachtrag → nur die gewählte Stunde, sonst null (Tagesregel)', () => {
  assert.equal(stunde(um(2, 10, 40), DO, '7b'), null);
  assert.deepEqual(stunde(um(2, 10, 40), DO, '7b', 6), [6, false]);
  assert.equal(stundeFuerBuchung(KB, { jetzt: um(2, 10, 40), termin: DO, kursId: '7b', gewaehlt: 6 }).startSek, 53940);
});
// Zero 06.10. „Ausfall löst die Wahl“ (Nachlauf v1240, P15 T2: seit v1.17.1 hielt die Wahl auch über den Ausfall, der Kopf nannte die
// ausgefallene Stunde und eine Buchung ging dorthin)
test('Buchungsstunde: Ausfall löst die Wahl — gewählte Stunde und Hand-Block; fällt ein anderer Kurs aus, hält sie (Zero 06.10.)', () => {
  const aus = nr => ({ ...KB, ausnahmen: [{ datum: DO, blockNr: nr, kursId: null }] });
  const st = (k, jetzt, termin, kursId, gewaehlt = null, handBlock = null) => { const s = stundeFuerBuchung(k, { jetzt, termin, kursId, gewaehlt, handBlock }); return s && [s.blockNr, s.laeuft]; };
  assert.deepEqual(st(KB, um(1, 10, 40), DO, '5a', 3), [3, true]);            // ohne Ausfall gilt die Wahl
  assert.equal(st(aus(3), um(1, 10, 40), DO, '5a', 3), null);                 // 5a hat Do nur Std. 3 — sie fällt aus: keine Stunde
  assert.deepEqual(st(aus(6), um(1, 15, 10), DO, '7b', 6), [1, false]);       // 7b Std. 6 gewählt, fällt aus: Tagesregel (Std. 1)
  assert.equal(st(aus(6), um(2, 10, 40), DO, '7b', 6), null);                 // im Nachtrag ebenso: wie ohne Wahl
  assert.equal(st(aus(3), um(1, 10, 40), DO, '5a', null, 3), null);           // Hand-Block auf der eigenen ausgefallenen Stunde zählt nicht
  assert.deepEqual(st(aus(3), um(1, 10, 40), DO, '7b', null, 3), [3, true]);  // Gegenrichtung: 5a fällt aus, 7b dort von Hand — gilt
  assert.deepEqual(st(aus(3), um(1, 10, 40), DO, '7b', 3), [3, true]);        // … und gewählt ebenso
});
// Prüfer 06.10. (BEFUND ausfall_wahl B2, B5): ohne Zeitraster gilt die Wahl wie vorher (kein Absturz, die Buchung geht nicht verloren);
// A/B-Woche: es verliert nur der Kurs die Wahl, dessen Stunde in DIESER Woche ausfällt
test('Buchungsstunde: Ausfall ohne Zeitraster und in der A/B-Woche (Prüfer 06.10. B2, B5)', () => {
  const ohne = { zeitmodell: null, wochenplan: PLAN_B, ausnahmen: [{ datum: DO, blockNr: 2, kursId: null }] };
  const ruhig = f => { try { return f(); } catch (e) { return 'Abbruch'; } };   // ein Abbruch ist hier der Fehler selbst (die Buchung ginge verloren)
  assert.deepEqual(ruhig(() => stundeFuerBuchung(ohne, { jetzt: um(1, 10, 40), termin: DO, kursId: '7b', gewaehlt: 2 })), { blockNr: 2, startSek: null, endeSek: null, laeuft: false });
  assert.equal(ruhig(() => stundeFaelltAus(ohne, DO, 2, '7b')), false);
  // Do 01.10. ist B-Woche (Anker Mo 28.09. = B): Block 4 gehört 7b (B), nicht 8c (A)
  const ab = { ...KB, wochenplan: [...PLAN_B, { wochentag: 4, blockNr: 4, kursId: '8c', rhythmus: 'A' }, { wochentag: 4, blockNr: 4, kursId: '7b', rhythmus: 'B' }],
    ausnahmen: [{ datum: DO, blockNr: 4, kursId: null }] };
  assert.equal(stundeFaelltAus(ab, DO, 4, '7b'), true);
  assert.equal(stundeFaelltAus(ab, DO, 4, '8c'), false);
  assert.deepEqual(stundeFuerBuchung(ab, { jetzt: um(1, 15, 10), termin: DO, kursId: '7b', gewaehlt: 4 }).blockNr, 6);   // gelöst: Tagesregel
  assert.equal(stundeFuerBuchung(ab, { jetzt: um(1, 15, 10), termin: DO, kursId: '8c', gewaehlt: 4 }).blockNr, 4);         // 8c hat diese Woche dort nichts: hält
});
test('Buchungsstunde: Wochenende, Ferien, ohne Zeitraster → null; Entfall zählt nicht als Stunde des Kurses', () => {
  assert.equal(stunde(um(3, 10, 0), '2026-10-03', '7b'), null);
  assert.equal(stunde(um(8, 10, 40), '2026-10-08', '5a'), null);
  assert.equal(stundeFuerBuchung({ zeitmodell: null }, { jetzt: um(2, 10, 40), termin: FR, kursId: '5a' }), null);
  const ohneB6 = { ...KB, ausnahmen: [{ datum: DO, blockNr: 6, kursId: null }] };
  assert.equal(stundeFuerBuchung(ohneB6, { jetzt: um(1, 16, 30), termin: DO, kursId: '7b' }).blockNr, 1);
});
