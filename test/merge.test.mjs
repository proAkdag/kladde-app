// kladde/test/merge · node --test Port der Alt-Suite (P1.0, verhaltensneutral)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeContainerDaten, mergeEvents, mergeStammdaten, istGeloescht, hebeLoeschungAuf } from '../logic/merge.mjs';
import * as merge from '../logic/merge.mjs';
const entferneKursReferenzen = (...a) => merge.entferneKursReferenzen(...a);   // als Namensimport hätte das Fehlen die ganze Datei gekippt (roter Gegenfall je Test)
import { wirksameEvents } from '../logic/verdichtung.mjs';

let seq = 0;
function ev(typ, schuelerNr, datum, extra = {}) {
  return { id: 'e' + (++seq), typ, schuelerNr, datum, ts: datum + 'T08:' + String(seq).padStart(2, '0') + ':00Z', geraet: 'test', ...extra };
}

const eA = [ev('+', 1, '2026-09-01'), ev('o', 2, '2026-09-01'), ev('-', 3, '2026-09-02')];
const eB = [ev('+', 4, '2026-09-03'), ev('mat', 5, '2026-09-03')];

test('mergeEvents idempotent', () => {
  assert.equal(mergeEvents(eA, eA).length, 3);
});

test('mergeEvents disjunkt 3+2=5', () => {
  assert.equal(mergeEvents(eA, eB).length, 5);
});

test('Duplikat-id nur einmal', () => {
  assert.equal(mergeEvents(eA, [eA[0]]).length, 3);
});

test('sortiert nach ts', () => {
  const sortiert = mergeEvents(eB, eA);
  assert.ok(sortiert[0].ts <= sortiert[1].ts);
  assert.ok(sortiert[3].ts <= sortiert[4].ts);
});

test('Storno überlebt Merge und wirkt', () => {
  const u = ev('fehlt_u', 7, '2026-09-01');
  const nachtrag = ev('fehlt_e', 7, '2026-09-01', { stornoVon: u.id });
  const gemergt = mergeEvents([u], [u, nachtrag]);
  const wirksam = wirksameEvents(gemergt);
  assert.equal(gemergt.length, 2);
  assert.equal(wirksam.length, 1);
  assert.equal(wirksam[0].typ, 'fehlt_e');
});

test('Stammdaten: höhere rev gewinnt', () => {
  const stammAlt = { rev: 2, ts: '2026-09-01T10:00Z', geraet: 'pc', sitzplaene: { k1: ['A1'] } };
  const stammNeu = { rev: 3, ts: '2026-09-02T10:00Z', geraet: 'ipad', sitzplaene: { k1: ['B2'] } };
  assert.equal(mergeStammdaten(stammAlt, stammNeu).ergebnis.rev, 3);
});

const konfA = { rev: 5, ts: '2026-09-03T10:00Z', geraet: 'pc', sitzplaene: { k1: ['A1', 'A2'] } };
const konfB = { rev: 5, ts: '2026-09-03T14:00Z', geraet: 'ipad', sitzplaene: { k1: ['C4'] } };

test('Sitzplan-Konflikt (gleiche rev): gemeldet, später ts gewinnt, Verlierer liegt bei', () => {
  const konf = mergeStammdaten(konfA, konfB);
  assert.notEqual(konf.konflikt, null);
  assert.equal(konf.ergebnis.geraet, 'ipad');
  assert.equal(konf.verworfen.geraet, 'pc');
});

// Sicherer Import (Zero 2026-09-29) — Szenario des Prüfers: PC rev 8 (Farbe/Sitzplan), iPad rev 6 mit neuem Schüler Nr 29
const kursA = { id: '7b', name: '7b', fach: 'M' };
const basisSchueler = [{ nr: 1, vorname: 'Anna', name: 'A' }, { nr: 2, vorname: 'Ben', name: 'B' }];
const pc = { rev: 8, ts: '2026-09-05T10:00Z', geraet: 'pc', kurse: [{ ...kursA, farbHue: 200 }], schueler: { '7b': basisSchueler }, sitzplaene: { '7b': { grid: { '0,0': 1 } } }, wochenplan: [{ id: 'w1', wochentag: 1, blockNr: 1, kursId: '7b' }] };
const ipad = { rev: 6, ts: '2026-09-04T10:00Z', geraet: 'ipad', kurse: [kursA, { id: '9a', name: '9a', fach: 'Ph' }], schueler: { '7b': [...basisSchueler, { nr: 29, vorname: 'Cem', name: 'C' }], '9a': [{ nr: 1, vorname: 'Dora', name: 'D' }] }, sitzplaene: { '9a': { grid: { '0,0': 1 } } }, wochenplan: [] };

test('Sicherer Import: Schüler und Kurs nur im unterlegenen Stand werden ergänzt und gemeldet', () => {
  const m = mergeStammdaten(pc, ipad);
  assert.equal(m.ergebnis.rev, 8);                                    // Basis bleibt der höhere Stand
  assert.equal(m.ergebnis.kurse.find(k => k.id === '7b').farbHue, 200);
  assert.deepEqual(m.ergebnis.schueler['7b'].map(s => s.nr), [1, 2, 29]);   // vorher: [1, 2] — Nr 29 weg
  assert.ok(m.ergebnis.kurse.some(k => k.id === '9a'));
  assert.deepEqual(m.ergebnis.sitzplaene['9a'], { grid: { '0,0': 1 } });
  assert.equal(m.ergebnis.wochenplan.length, 1);                      // Stundenplan NICHT vereinigt (Basis)
  assert.equal(m.hinweise.length, 2);
  assert.equal(m.konflikte.length, 0);
  assert.deepEqual(mergeStammdaten(ipad, pc).ergebnis.schueler['7b'].map(s => s.nr), [1, 2, 29]);   // symmetrisch
});

// v2.2 (Identität): gleiche Ausweis-Nr aus v2, anderer Name = Frage „zwei Kinder?“. Offen oder „ja“: beide bleiben, das andere Kind
// bekommt eine neue Ausweis-Nr (seine Listen-Nr bleibt → doppelt gemeldet); „nein“ (dasselbe Kind): Basis behält, Meldung.
test('Sicherer Import: gleiche Nr, anderer Name → Frage; offen trennt, „dasselbe Kind“ behält die Basis', () => {
  const ipad2 = { ...ipad, schueler: { '7b': [{ nr: 1, vorname: 'Anja', name: 'X' }, basisSchueler[1]] } };
  const c = mergeContainerDaten({ stamm: pc, events: [] }, { stamm: ipad2, events: [] });
  assert.equal(c.daten.stamm.schueler['7b'].find(s => s.nr === 1).vorname, 'Anna');
  assert.deepEqual(c.fragen.map(f => [f.art, f.id]), [['zwei', 'zwei|a:7b:1|anja|x']]);
  assert.equal(c.offen, 1);
  assert.deepEqual(c.daten.stamm.schueler['7b'].map(s => [s.vorname, s.nr]), [['Anna', 1], ['Ben', 2], ['Anja', 3]]);
  assert.match(c.konflikte[0], /^7b · M: Listen-Nr 1 doppelt \(Anna A und Anja X\)/);
  const gleich = mergeContainerDaten({ stamm: pc, events: [] }, { stamm: ipad2, events: [] }, { antworten: { 'zwei|a:7b:1|anja|x': false } });
  assert.equal(gleich.offen, 0);
  assert.deepEqual(gleich.daten.stamm.schueler['7b'].map(s => s.vorname), ['Anna', 'Ben']);
  assert.match(gleich.konflikte[0], /^7b · M: Nr 1 „Anna A" \(pc\) ≠ „Anja X" \(ipad\) — pc behalten\./);
});

// Zwei Nummern (U10, Zero 05.10.): PC hat die Liste aktualisiert (Dana neu auf Zeile 2, Ben rückt auf 3), das iPad hat
// vorher Cem unten angehängt (Ausweis 4, Zeile 3). Nach dem Ergänzen stehen Ben und Cem auf Zeile 3 → melden, nicht raten.
test('Zwei Nummern: ergänztes Kind auf einer belegten Listen-Nr → Konflikt; Meldungen nennen die Listen-Nr', () => {
  const pcL = { ...pc, schueler: { '7b': [{ nr: 1, vorname: 'Anna', name: 'A' }, { nr: 2, liste: 3, vorname: 'Ben', name: 'B' }, { nr: 3, liste: 2, vorname: 'Dana', name: 'D' }] } };
  const mit = liste => ({ ...ipad, kurse: [kursA], schueler: { '7b': [...basisSchueler, { nr: 4, liste, vorname: 'Cem', name: 'C' }] } });
  const m = mergeStammdaten(pcL, mit(3));
  assert.deepEqual(m.ergebnis.schueler['7b'].map(s => s.nr), [1, 2, 3, 4]);   // Cem bleibt erhalten
  const doppelt = m.konflikte.filter(k => /doppelt/.test(k));
  assert.equal(doppelt.length, 1);
  assert.match(doppelt[0], /Listen-Nr 3 doppelt/); assert.match(doppelt[0], /Ben B/); assert.match(doppelt[0], /Cem C/);
  assert.ok(m.konflikte.some(k => /^7b · M: 1 Kind steht in den beiden Ständen verschieden \(Nr 3 Ben B: Listen-Nr 3 \(pc\) ≠ 2 \(ipad\)\)/.test(k)));   // das iPad kennt Ben noch auf Zeile 2 (Prüfer Y7)
  assert.deepEqual(m.hinweise, ['7b · M: Nr 3 Cem C ergänzt']);                      // Listen-Nr 3, nicht Ausweis-Nr 4
  const ok = mergeStammdaten(pcL, mit(4));                                         // Gegenrichtung: freie Zeile
  assert.equal(ok.konflikte.filter(k => /doppelt/.test(k)).length, 0);
});

// Prüfer 05.10. Y7: Die Umnummerierung liegt im unterlegenen Stand (das iPad hat mehr Stamm-Änderungen) — sie darf nicht still verloren gehen
test('Zwei Nummern: gleiche Ausweis-Nr mit anderer Listen-Nr oder anderem Inaktiv-Stand → Konflikt, Basis behält', () => {
  const ipadAlt = { ...pc, rev: 9, geraet: 'ipad', schueler: { '7b': [{ nr: 1, vorname: 'Anna', name: 'A' }, { nr: 2, vorname: 'Ben', name: 'B' }] } };
  const pcNeu = { ...pc, rev: 8, schueler: { '7b': [{ nr: 1, vorname: 'Anna', name: 'A', liste: 2 }, { nr: 2, vorname: 'Ben', name: 'B', inaktiv: true, liste: null }] } };
  const m = mergeStammdaten(ipadAlt, pcNeu);
  assert.equal(m.ergebnis.geraet, 'ipad');
  assert.equal(m.konflikte.length, 1);                                               // eine Meldung je Kurs (Nachprüfung N1)
  assert.match(m.konflikte[0], /Nr 1 Anna A: Listen-Nr 1 \(ipad\) ≠ 2 \(pc\)/); assert.match(m.konflikte[0], /Nr 2 Ben B: Listen-Nr 2 \(ipad\) ≠ keine \(pc\), aktiv \(ipad\), inaktiv \(pc\)\)/);
  assert.equal(mergeStammdaten(ipadAlt, { ...ipadAlt, rev: 3 }).konflikte.length, 0);   // Gegenrichtung: gleicher Stand
});

// Nachprüfung N1: der Normalfall — der PC hat die Mappe geladen (höhere rev), das iPad trägt nur den älteren Stand. Ohne
// gemeinsamen Vorgänger ist nicht entscheidbar, wer recht hat: also eine Meldung je Kurs, neutral, kein Rat je Kind.
test('Zwei Nummern: abweichende Listen-Nrn eines Kurses → eine neutrale Meldung je Kurs (Nachprüfung N1)', () => {
  const namen = [['Anna', 'A'], ['Ben', 'B'], ['Cem', 'C'], ['Dana', 'D'], ['Eli', 'E']];
  const ipadAlt = { ...pc, rev: 3, geraet: 'ipad', schueler: { '7b': namen.map(([vorname, name], i) => ({ nr: i + 1, vorname, name })) } };
  const pcNeu = { ...pc, rev: 4, schueler: { '7b': [{ nr: 6, vorname: 'Finn', name: 'F', liste: 1 },   // neue Zeile 1, alle rücken weiter
    ...namen.map(([vorname, name], i) => ({ nr: i + 1, vorname, name, liste: i + 2 }))] } };
  const m = mergeStammdaten(ipadAlt, pcNeu);
  assert.equal(m.ergebnis.geraet, 'pc');
  assert.equal(m.konflikte.length, 1);
  assert.match(m.konflikte[0], /^7b · M: 5 Kinder stehen in den beiden Ständen verschieden \(Nr 2 Anna A: Listen-Nr 2 \(pc\) ≠ 1 \(ipad\) · /);
  assert.match(m.konflikte[0], / · … und 2 weitere\) — übernommen: Stand pc, verworfen: Stand ipad\. /);
  assert.doesNotMatch(m.konflikte[0], /behalten|Dana|Eli/);                           // nur die ersten drei beim Namen
  assert.equal(mergeStammdaten(pcNeu, ipadAlt).konflikte.length, 1);                 // gleich, aus welcher Richtung importiert wird
});

// Nachprüfung 2 P1: „Vom PC holen“ und die Toasts zeigen nur die erste Meldung. Echte Konflikte (anderer Name, doppelte Listen-Nr)
// stehen darum vor der neutralen Sammelmeldung — über alle Kurse.
test('Zwei Nummern: echte Konflikte vor der Sammelmeldung, über alle Kurse (Nachprüfung 2 P1)', () => {
  const k9 = { id: '9a', name: '9a', fach: 'Ph' };
  const pcL = { ...pc, rev: 5, kurse: [kursA, k9], schueler: { '7b': [{ nr: 1, vorname: 'Anna', name: 'A', liste: 2 }, { nr: 2, vorname: 'Ben', name: 'B', liste: 3 },
    { nr: 4, vorname: 'Dana', name: 'D', liste: 1 }], '9a': [{ nr: 1, vorname: 'Dora', name: 'D' }] } };
  const ipadL = { ...ipad, rev: 4, kurse: [kursA, k9], schueler: { '7b': [...basisSchueler, { nr: 3, vorname: 'Cem', name: 'C' }], '9a': [{ nr: 1, vorname: 'Dirk', name: 'K' }] } };
  const m = mergeContainerDaten({ stamm: pcL, events: [] }, { stamm: ipadL, events: [] });
  // v2.2: Dora/Dirk (gleiche Ausweis-Nr, anderer Name) ist eine Frage; offen = zwei Kinder → Listen-Nr 1 in 9a doppelt
  assert.equal(m.konflikte.length, 3);
  // Kurs mit Fach in jeder Meldung (Prüfer P2, Zero 06.10. „Text klarer, Abfrage bleibt“): zwei Kurse „7b“ sind sonst nicht zu unterscheiden
  assert.match(m.konflikte[0], /^7b · M: Listen-Nr 3 doppelt \(Ben B und Cem C\)/);
  assert.match(m.konflikte[1], /^9a · Ph: Listen-Nr 1 doppelt \(Dora D und Dirk K\)/);
  assert.match(m.konflikte[2], /^7b · M: 2 Kinder stehen in den beiden Ständen verschieden/);
  assert.deepEqual(m.fragen.map(f => f.kurs + ' ' + f.art), ['9a · Ph zwei']);
  // „dasselbe Kind“: die alte Meldung „Kurs: Nr …“ steht wieder vor der Sammelmeldung (Prüfer 06.10. B13)
  const g = mergeContainerDaten({ stamm: pcL, events: [] }, { stamm: ipadL, events: [] }, { antworten: { 'zwei|a:9a:1|dirk|k': false } });
  assert.match(g.konflikte[0], /^9a · Ph: Nr 1 „Dora D" \(pc\) ≠ „Dirk K" \(ipad\)/);
  assert.match(g.konflikte[1], /^7b · M: Listen-Nr 3 doppelt \(Ben B und Cem C\)/);
  assert.match(g.konflikte[2], /^7b · M: 2 Kinder stehen in den beiden Ständen verschieden/);
});

// Prüfer 06.10. B6 (N1): ein Kurs ohne Fach heißt nur „9a“ — kein „9a · “ und kein „· undefined“
test('Meldungen: Kurs ohne Fach nur mit Namen', () => {
  const k9 = { id: '9a', name: '9a' };
  const a = { ...pc, rev: 5, kurse: [kursA, k9], schueler: { '7b': basisSchueler, '9a': [{ nr: 1, vorname: 'Dora', name: 'D' }] } };
  const b = { ...ipad, rev: 4, kurse: [kursA, k9], schueler: { '7b': basisSchueler, '9a': [{ nr: 1, vorname: 'Dirk', name: 'K' }, { nr: 2, vorname: 'Eva', name: 'E' }] } };
  const m = mergeStammdaten(a, b, undefined, { antworten: { 'zwei|a:9a:1|dirk|k': false } });   // „dasselbe Kind“ (v2.2)
  assert.deepEqual(m.konflikte, ['9a: Nr 1 „Dora D" (pc) ≠ „Dirk K" (ipad) — pc behalten.']);
  assert.deepEqual(m.hinweise, ['9a: Nr 2 Eva E ergänzt']);
  const offen = mergeStammdaten(a, b);   // offen = zwei Kinder
  assert.deepEqual(offen.konflikte, ['9a: Listen-Nr 1 doppelt (Dora D und Dirk K) — nichts geraten, bitte die Excel-Mappe neu laden (Kurse → Kurs anlegen → Excel-Mappe laden).']);
  assert.deepEqual(offen.hinweise, ['9a: Nr 1 Dirk K ergänzt (andere Person als Dora D)', '9a: Nr 2 Eva E ergänzt']);
});

// Prüfer 05.10. R4: Die Höchstmarke der Ausweis-Nr (kurs.ausweisBis) gilt nach dem Zusammenführen als die höhere beider Stände
test('Zwei Nummern: Höchstmarke ausweisBis übersteht den Merge als Maximum', () => {
  const a = { ...pc, rev: 9, kurse: [{ ...kursA, ausweisBis: 3 }] }, b = { ...pc, rev: 8, kurse: [{ ...kursA, ausweisBis: 31 }] };
  assert.equal(mergeStammdaten(a, b).ergebnis.kurse.find(k => k.id === '7b').ausweisBis, 31);
  assert.equal(mergeStammdaten(b, a).ergebnis.kurse.find(k => k.id === '7b').ausweisBis, 31);
  assert.equal('ausweisBis' in mergeStammdaten(pc, { ...pc, rev: 7 }).ergebnis.kurse[0], false);   // ohne Marke bleibt der Kurs, wie er war
});

test('Sicherer Import: gleicher Bestand → keine Hinweise, keine Konflikte', () => {
  const m = mergeStammdaten(pc, { ...pc, rev: 7, kurse: [kursA] });
  assert.equal(m.hinweise.length, 0);
  assert.equal(m.konflikte.length, 0);
});

// ── Lösch-Markierung (Prüfer 2026-09-29: „Endgültig löschen“ war nicht endgültig; der sichere Import holte den Kurs sogar zurück)
const T_DEL = '2026-09-06T10:00:00Z';
const alt9a = [ev('+', 1, '2026-09-02', { kursId: '9a' }), ev('mat', 1, '2026-09-03', { kursId: '9a' })];
const pcMit9a = { ...pc, kurse: [...pc.kurse, { id: '9a', name: '9a', fach: 'Ph' }], schueler: { ...pc.schueler, '9a': [{ nr: 1, vorname: 'Dora', name: 'D' }] },
  sitzplaene: { ...pc.sitzplaene, '9a': { grid: {} } }, wochenplan: [...pc.wochenplan, { id: 'w2', wochentag: 2, blockNr: 1, kursId: '9a' }] };
const ipadOhne9a = { ...ipad, rev: 9, ts: T_DEL, kurse: [kursA], schueler: { '7b': basisSchueler }, sitzplaene: {}, geloescht: { '9a': { am: T_DEL } } };

test('Gelöscht bleibt gelöscht: der ältere Stand des anderen Geräts holt Kurs, Liste, Slot und Einträge nicht zurück', () => {
  for (const [a, b] of [[{ stamm: ipadOhne9a, events: [] }, { stamm: pcMit9a, events: alt9a }], [{ stamm: pcMit9a, events: alt9a }, { stamm: ipadOhne9a, events: [] }]]) {
    const c = mergeContainerDaten(a, b);
    assert.ok(!c.daten.stamm.kurse.some(k => k.id === '9a'));
    assert.equal(c.daten.stamm.schueler['9a'], undefined);
    assert.equal(c.daten.stamm.sitzplaene['9a'], undefined);
    assert.ok(!c.daten.stamm.wochenplan.some(w => w.kursId === '9a'));
    assert.equal(c.daten.events.filter(e => e.kursId === '9a').length, 0);
    assert.ok(!c.hinweise.some(h => /9a.*ergänzt/.test(h)));
    assert.ok(c.hinweise.some(h => /2 Einträge gelöschter Kurse/.test(h)));
    assert.ok(c.daten.stamm.geloescht['9a']);                           // Markierung reist weiter
  }
});

test('Gelöscht gilt auch, wenn der Stand mit dem Kurs die höhere rev hat', () => {
  const c = mergeContainerDaten({ stamm: { ...pcMit9a, rev: 12 }, events: alt9a }, { stamm: ipadOhne9a, events: [] });
  assert.ok(!c.daten.stamm.kurse.some(k => k.id === '9a'));
  assert.equal(c.daten.events.length, 0);
  assert.deepEqual(c.daten.stamm.wochenplan.map(w => w.kursId), ['7b']);   // der 9a-Slot des Siegers ist weg
  assert.equal(c.daten.stamm.sitzplaene['9a'], undefined);
});

test('Aufhebung reist mit: ein Gerät kennt nur die Löschung, das andere auch das Neu-Anlegen', () => {
  const nurLoeschung = { ...ipadOhne9a, rev: 11, geloescht: { '9a': { am: T_DEL } } };
  const neuAngelegt = { ...pcMit9a, rev: 10, geloescht: { '9a': { am: T_DEL, wieder: '2026-09-07T08:00:00Z' } } };
  const c = mergeContainerDaten({ stamm: nurLoeschung, events: [] }, { stamm: neuAngelegt, events: [] });
  assert.equal(istGeloescht(c.daten.stamm.geloescht['9a']), false);
  assert.ok(c.daten.stamm.kurse.some(k => k.id === '9a'));                 // der sichere Import ergänzt ihn wieder
});

test('Neu angelegt nach der Löschung: Kurs und neue Einträge bleiben, alte nicht', () => {
  const s = { ...ipadOhne9a, rev: 10, kurse: [kursA, { id: '9a', name: '9a', fach: 'Ph' }], schueler: { '7b': basisSchueler, '9a': [{ nr: 1, vorname: 'Emil', name: 'E' }] },
    geloescht: { '9a': { am: T_DEL } } };
  hebeLoeschungAuf(s, '2026-09-07T08:00:00Z');                          // stammMutiert nach dem Neu-Anlegen
  assert.equal(istGeloescht(s.geloescht['9a']), false);
  const neu = ev('+', 1, '2026-09-08', { kursId: '9a' });
  const c = mergeContainerDaten({ stamm: s, events: [neu] }, { stamm: pcMit9a, events: alt9a });
  assert.ok(c.daten.stamm.kurse.some(k => k.id === '9a'));
  assert.deepEqual(c.daten.events.filter(e => e.kursId === '9a').map(e => e.id), [neu.id]);
});

test('Import-Vorschau verändert den lebenden Stand nicht', () => {
  const lebend = JSON.parse(JSON.stringify({ stamm: pcMit9a, events: alt9a }));
  const vorher = JSON.stringify(lebend);
  mergeContainerDaten(lebend, { stamm: ipadOhne9a, events: [] });
  assert.equal(JSON.stringify(lebend), vorher);
  // Grenzfall: der lebende Stand ist selbst das Ergebnis (fremder Stand ohne Stammdaten) und trägt eine Markierung
  const selbst = { stamm: { ...JSON.parse(JSON.stringify(pcMit9a)), geloescht: { '9a': { am: T_DEL } } }, events: [...alt9a] };
  const vorher2 = JSON.stringify(selbst);
  const c = mergeContainerDaten(selbst, { stamm: null, events: [] });
  assert.equal(JSON.stringify(selbst), vorher2);
  assert.ok(!c.daten.stamm.kurse.some(k => k.id === '9a'));
});

test('mergeContainerDaten: Union + Konflikt propagiert', () => {
  const cont = mergeContainerDaten(
    { schema: 'kladde/v1', stamm: konfA, events: eA },
    { schema: 'kladde/v1', stamm: konfB, events: eB });
  assert.equal(cont.daten.events.length, 5);
  assert.equal(cont.konflikte.length, 1);
  assert.notEqual(cont.verworfen, null);
});

// Review 19.10. §4: die Lösch-Markierung räumte nur kurse/schueler/sitzplaene/kursprofile/wochenplan. Eine Ausnahme auf den gelöschten
// Kurs blieb stehen, und die Autowahl wählte an dem Tag einen Kurs, den es nicht mehr gibt (repro 2026-10-19).
test('Lösch-Markierung räumt auch Ausnahmen und Alt-Slots des Kurses', () => {
  const ausn = [{ datum: '2026-10-20', blockNr: 1, kursId: '9a', teilgruppe: null }, { datum: '2026-10-20', blockNr: 2, kursId: '7b', teilgruppe: null },
    { datum: '2026-10-21', blockNr: 1, kursId: null, teilgruppe: null }];
  const alt = [{ wochentag: 2, von: '08:00', bis: '09:00', kursId: '9a' }, { wochentag: 2, von: '09:00', bis: '10:00', kursId: '7b' }];
  const geloeschtStand = { ...ipadOhne9a, rev: 12, geloescht: { '9a': { am: T_DEL } }, ausnahmeSlots: ausn, stundenplanSlots: alt };
  const c = mergeContainerDaten({ stamm: geloeschtStand, events: [] }, { stamm: { ...pcMit9a, ausnahmeSlots: ausn, stundenplanSlots: alt }, events: alt9a });
  assert.deepEqual(c.daten.stamm.ausnahmeSlots.map(a => a.kursId), ['7b', null]);   // Entfall (kursId null) und fremder Kurs bleiben
  assert.deepEqual(c.daten.stamm.stundenplanSlots.map(a => a.kursId), ['7b']);
});

test('entferneKursReferenzen: jede Kurs-Stelle weg, alles andere unberührt, Eingabe unverändert', () => {
  const s = { rev: 3, kurse: [{ id: '9a' }, { id: '7b' }], schueler: { '9a': [1], '7b': [2] }, sitzplaene: { '9a': {}, '7b': {} }, kursprofile: { '9a': {}, '7b': {} },
    wochenplan: [{ kursId: '9a' }, { kursId: '7b' }], ausnahmeSlots: [{ kursId: '9a' }, { kursId: null }], stundenplanSlots: [{ kursId: '9a' }],
    zeitmodelle: [{ id: 'z' }], geloescht: { '9a': { am: T_DEL } } };
  const vorher = JSON.stringify(s);
  const r = entferneKursReferenzen(s, ['9a']);
  assert.equal(JSON.stringify(s), vorher);
  assert.equal(JSON.stringify(r).includes('"9a"'), true);   // nur noch in der Lösch-Markierung
  const ohneMarke = { ...r, geloescht: undefined };
  assert.equal(JSON.stringify(ohneMarke).includes('9a'), false);
  assert.deepEqual(r.zeitmodelle, [{ id: 'z' }]);
  assert.equal(entferneKursReferenzen(s, []), s);          // nichts zu tun: dasselbe Objekt
});

// Prüfer 19.10. A1: ein Entfall merkt sich die überschriebene Vertretung in `ersetzt` (autowahl tagesAusfall); „Zurücknehmen“
// stellte danach den gelöschten Kurs wieder her. Der Entfall bleibt, nur der Verweis auf den gelöschten Kurs geht.
test('entferneKursReferenzen: Entfall vergisst eine ersetzte Vertretung des gelöschten Kurses, andere bleiben', async () => {
  const { entfallZurueck } = await import('../logic/autowahl.mjs');
  const s = { ausnahmeSlots: [
    { datum: '2026-10-20', blockNr: 1, kursId: null, teilgruppe: null, grund: 'entfall', ersetzt: { kursId: '9a', teilgruppe: null, grund: null } },
    { datum: '2026-10-20', blockNr: 2, kursId: null, teilgruppe: null, grund: 'entfall', ersetzt: { kursId: '7b', teilgruppe: null, grund: null } }] };
  const r = entferneKursReferenzen(s, ['9a']);
  assert.equal(r.ausnahmeSlots.length, 2);                                   // beide Entfälle bleiben
  assert.equal('ersetzt' in r.ausnahmeSlots[0], false);
  assert.deepEqual(r.ausnahmeSlots[1].ersetzt, { kursId: '7b', teilgruppe: null, grund: null });
  assert.equal(entfallZurueck(r.ausnahmeSlots, '2026-10-20', 1).some(a => a.kursId === '9a'), false);
  assert.equal('ersetzt' in s.ausnahmeSlots[0], true);                       // Eingabe unverändert
});

// Review 19.10. §5: Dateiimport legte den unterlegenen Stand bei, der Heimnetz-Pull nicht. Beide übernehmen jetzt über uebernehmeMerge.
const uebernehmeMerge = (...a) => merge.uebernehmeMerge(...a);
test('uebernehmeMerge: Verlierer liegt bei, höchstens drei, der älteste fällt', () => {
  const vault = { schema: 'kladde/v2', stamm: konfA, events: eA, verworfeneStaende: [{ ts: 'v1' }, { ts: 'v2' }, { ts: 'v3' }] };
  const dry = mergeContainerDaten(vault, { schema: 'kladde/v2', stamm: konfB, events: eB });
  assert.notEqual(dry.verworfen, null);
  const neu = uebernehmeMerge(vault, dry);
  assert.deepEqual(neu.verworfeneStaende.map(v => v.ts), ['v2', 'v3', dry.verworfen.ts]);
  assert.equal(vault.verworfeneStaende.length, 3);           // der lebende Tresor bleibt unberührt, bis die App zuweist
  assert.equal(neu.events.length, dry.daten.events.length);
});

test('uebernehmeMerge: ohne Verlierer bleiben die bisherigen Stände; ohne beide kein leeres Feld', () => {
  const alt = [{ ts: 'v1' }];
  const dry = mergeContainerDaten({ stamm: konfA, events: [] }, { stamm: konfA, events: eB });
  assert.equal(dry.verworfen, null);
  assert.deepEqual(uebernehmeMerge({ stamm: konfA, events: [], verworfeneStaende: alt }, dry).verworfeneStaende, alt);
  assert.equal('verworfeneStaende' in uebernehmeMerge({ stamm: konfA, events: [] }, dry), false);
});

// Prüfer 19.10. B9: Kurse nur im Verlierer kamen als dasselbe Objekt in den neuen Stamm und in den beigelegten Stand —
// eine Bearbeitung am Ort änderte den beigelegten Stand mit
test('uebernehmeMerge: beigelegter Stand teilt keine Objekte mit dem neuen Tresor', () => {
  const sieger = { ...konfA, rev: 9, kurse: [{ id: 'k1', name: '7b' }], schueler: { k1: [] } };
  const verlierer = { ...konfA, rev: 3, kurse: [{ id: 'k2', name: '8c', notenmodus: 'punkte' }], schueler: { k2: [{ nr: 1, vorname: 'Ada', name: 'P' }] } };
  const dry = mergeContainerDaten({ stamm: sieger, events: [] }, { stamm: verlierer, events: [] });
  const neu = uebernehmeMerge({ stamm: sieger, events: [] }, dry);
  neu.stamm.kurse.find(k => k.id === 'k2').notenmodus = 'drittel';
  neu.stamm.schueler.k2[0].vorname = 'Bea';
  const beigelegt = neu.verworfeneStaende.at(-1);
  assert.equal(beigelegt.kurse.find(k => k.id === 'k2').notenmodus, 'punkte');
  assert.equal(beigelegt.schueler.k2[0].vorname, 'Ada');
});

test('uebernehmeMerge: ein beigelegter Stand trägt keinen gelöschten Kurs', () => {
  const lebend = { stamm: { ...ipadOhne9a, rev: 12, geloescht: { '9a': { am: T_DEL } } }, events: [], verworfeneStaende: [{ ...pcMit9a }] };
  const dry = mergeContainerDaten(lebend, { stamm: { ...pcMit9a, rev: 4 }, events: alt9a });
  const neu = uebernehmeMerge(lebend, dry);
  assert.equal(neu.verworfeneStaende.length, 2);
  for (const st of neu.verworfeneStaende) {
    assert.equal((st.kurse || []).some(k => k.id === '9a'), false);
    assert.equal((st.schueler || {})['9a'], undefined);
  }
});
