// kladde/test/mappe_ereignisse · Scheibe D1: die Mappe lebt aus Ereignissen (Vor-Bedingung 3), nie aus dem Stamm.
// Prüft: Ersetzungskette und Konflikt zweier Geräte · Aufgaben über ids (Löschen/Tauschen verschiebt keine Punkte) · Abgleich
// verlustfrei und unabhängig von der Reihenfolge · Mappen-Einträge erscheinen nicht im Unterricht · Eingabe · Quartal aus dem Datum.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mappenStand, mappenKonflikte, mappenVerwaist, werteArbeitAus, standardSchluessel, lesePunkte, quartalVon } from '../logic/arbeiten.mjs';
import { mergeContainerDaten } from '../logic/merge.mjs';
import { wirksameEvents, verdichte } from '../logic/verdichtung.mjs';
import { typenMit } from '../logic/vertrag.mjs';

const K = 'k7c';
let n = 0;
const ev = (typ, f, ts = '2026-10-15T10:00:00.000Z') => ({ id: f.id || typ + (++n), typ, kursId: K, ts, geraet: f.geraet || 'pc', ...f });
const arbeit = (f = {}, ts) => ev('arbeit', { arbeitId: 'A1', titel: 'KA 1', am: '2026-10-15', art: 'arbeit', schluessel: standardSchluessel('sek1'),
  aufgaben: [{ id: 'x1', name: 'A1', max: 10 }, { id: 'x2', name: 'A2', max: 10 }, { id: 'x3', name: 'A3', max: 20 }], ...f }, ts);
const stamm = (geraet, rev) => ({ rev, ts: '2026-10-15T09:00:00.000Z', geraet, kurse: [{ id: K, name: '7c', fach: 'Mathematik' }],
  schueler: { [K]: [{ nr: 1, sid: 'n:ada', vorname: 'Ada', name: 'Probe' }, { nr: 2, sid: 'n:bo', vorname: 'Bo', name: 'Probe' }] },
  sitzplaene: {}, kursprofile: {}, wochenplan: [], ausnahmeSlots: [], stundenplanSlots: [], zeitmodelle: [], schuljahre: [], einstellungen: {} });

test('Ersetzungskette: die jüngste Änderung gilt, leer löscht den Eintrag', () => {
  const a = arbeit({ id: 'a' });
  const p1 = ev('punkte', { id: 'p1', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x1', wert: 7 });
  const p2 = ev('punkte', { id: 'p2', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x1', wert: 8, ersetzt: 'p1' }, '2026-10-15T10:01:00.000Z');
  let s = mappenStand([a, p1, p2], K);
  assert.equal(s.punkte.get('A1').get('n:ada').get('x1'), 8);
  assert.equal(s.kopf('punkte', 'A1', 'n:ada', 'x1'), 'p2');
  const p3 = ev('punkte', { id: 'p3', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x1', wert: null, ersetzt: 'p2' }, '2026-10-15T10:02:00.000Z');
  s = mappenStand([a, p1, p2, p3], K);
  assert.equal(s.punkte.get('A1')?.get('n:ada')?.get('x1'), undefined, 'gelöscht = nicht eingetragen');
  assert.equal(s.konflikte.length, 0);
});

test('Konflikt: dieselbe Zelle auf zwei Geräten verschieden → gemeldet, nicht über die Uhr entschieden; Auflösen ersetzt beide', () => {
  const a = arbeit({ id: 'a' });
  const p1 = ev('punkte', { id: 'p1', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x1', wert: 7 });
  const pc = ev('punkte', { id: 'pc', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x1', wert: 8, ersetzt: 'p1', geraet: 'pc' }, '2026-10-15T10:05:00.000Z');
  const ip = ev('punkte', { id: 'ip', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x1', wert: 9, ersetzt: 'p1', geraet: 'ipad' }, '2026-10-15T10:03:00.000Z');
  const s = mappenStand([a, p1, pc, ip], K);
  assert.equal(s.konflikte.length, 1);
  assert.deepEqual(s.konflikte[0].werte.sort(), [8, 9]);
  assert.deepEqual(s.kopf('punkte', 'A1', 'n:ada', 'x1').sort(), ['ip', 'pc'], 'die nächste Änderung ersetzt beide Köpfe');
  const wahl = ev('punkte', { id: 'w', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x1', wert: 9, ersetzt: ['ip', 'pc'] }, '2026-10-15T10:06:00.000Z');
  const s2 = mappenStand([a, p1, pc, ip, wahl], K);
  assert.equal(s2.konflikte.length, 0); assert.equal(s2.punkte.get('A1').get('n:ada').get('x1'), 9);
  // gleiche Werte auf beiden Geräten sind kein Konflikt
  const gleich = { ...ip, wert: 8 };
  assert.equal(mappenStand([a, p1, pc, gleich], K).konflikte.length, 0);
});

test('Aufgaben über ids: A2 löschen und A1/A3 tauschen verschiebt keine Punkte', () => {
  const a = arbeit({ id: 'a' });
  const pts = [['x1', 5], ['x2', 6], ['x3', 17]].map(([x, w], i) => ev('punkte', { id: 'q' + i, arbeitId: 'A1', sid: 'n:ada', aufgabeId: x, wert: w }));
  const neu = arbeit({ id: 'a2', ersetzt: 'a', aufgaben: [{ id: 'x3', name: 'A3', max: 20 }, { id: 'x1', name: 'A1', max: 10 }] }, '2026-10-15T11:00:00.000Z');
  const s = mappenStand([a, ...pts, neu], K);
  const arb = s.arbeiten[0];
  const e = werteArbeitAus(arb, [{ sid: 'n:ada' }], s.punkte.get('A1'));
  assert.deepEqual(e.zeilen[0].werte, [17, 5], 'A3 = 17 bleibt bei A3, A1 = 5 bei A1');
  assert.equal(e.zeilen[0].summe, 22); assert.equal(e.gesamt, 30);
});

test('Abgleich: Punkte zweier Geräte vereinigt, Reihenfolge egal, Definition übersteht einen Stammwechsel', () => {
  const a = arbeit({ id: 'a' });
  const pcEv = [a, ev('punkte', { id: 'pa', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x1', wert: 7 })];
  const ipEv = [a, ev('punkte', { id: 'pb', arbeitId: 'A1', sid: 'n:bo', aufgabeId: 'x1', wert: 4, geraet: 'ipad' })];
  const sPc = stamm('pc', 9), sIp = { ...stamm('ipad', 4), kurse: [{ id: K, name: '7c', fach: 'Mathematik', farbHue: 120 }] };
  const r1 = mergeContainerDaten({ schema: 'kladde/v4', stamm: sPc, events: pcEv }, { schema: 'kladde/v4', stamm: sIp, events: ipEv });
  const r2 = mergeContainerDaten({ schema: 'kladde/v4', stamm: sIp, events: ipEv }, { schema: 'kladde/v4', stamm: sPc, events: pcEv });
  for (const r of [r1, r2]) {
    const s = mappenStand(r.daten.events, K);
    assert.equal(s.arbeiten.length, 1, 'die Arbeit überlebt, obwohl der Stamm des einen Geräts verloren hat');
    assert.equal(s.punkte.get('A1').get('n:ada').get('x1'), 7);
    assert.equal(s.punkte.get('A1').get('n:bo').get('x1'), 4);
    assert.equal(r.daten.schema, 'kladde/v4');
  }
  assert.deepEqual(r1.daten.events.map(e => e.id), r2.daten.events.map(e => e.id));
});

test('Abgleich meldet eine verschieden belegte Zelle (nicht still)', () => {
  const a = arbeit({ id: 'a' }), p1 = ev('punkte', { id: 'p1', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x1', wert: 7 });
  const pc = [a, p1, ev('punkte', { id: 'pc', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x1', wert: 8, ersetzt: 'p1' })];
  const ip = [a, p1, ev('punkte', { id: 'ip', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x1', wert: 9, ersetzt: 'p1', geraet: 'ipad' })];
  const r = mergeContainerDaten({ schema: 'kladde/v4', stamm: stamm('pc', 5), events: pc }, { schema: 'kladde/v4', stamm: stamm('ipad', 5), events: ip });
  assert.ok(r.konflikte.some(k => /Mappe.*verschieden/.test(k)), JSON.stringify(r.konflikte));
});

test('Mappen-Einträge erscheinen nicht im Unterricht (wirksameEvents, Verdichtung)', () => {
  assert.deepEqual(typenMit('mappe').sort(), ['arbeit', 'lob', 'punkte']);
  const plus = { id: 'u1', typ: '+', kursId: K, sid: 'n:ada', datum: '2026-10-15', ts: '2026-10-15T08:00:00.000Z' };
  const mappe = [arbeit({ id: 'a' }), ev('punkte', { id: 'p', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x1', wert: 7, datum: '2026-10-15' })];
  assert.deepEqual(wirksameEvents([plus, ...mappe]).map(e => e.id), ['u1']);
  const v1 = verdichte([plus], 'n:ada', {}), v2 = verdichte([plus, ...mappe], 'n:ada', {});
  assert.deepEqual(v2, v1, 'Verdichtung unverändert durch Mappen-Einträge');
});

test('Eingabe: Komma und Punkt, 0 … max, leer löscht; nie still gekürzt', () => {
  assert.deepEqual(lesePunkte('7,5', 10), { ok: true, wert: 7.5 });
  assert.deepEqual(lesePunkte(' 8.25 ', 10), { ok: true, wert: 8.25 });
  assert.deepEqual(lesePunkte('0', 10), { ok: true, wert: 0 });
  assert.deepEqual(lesePunkte('', 10), { ok: true, wert: null });
  assert.equal(lesePunkte('13', 12.5).ok, false);
  assert.match(lesePunkte('13', 12.5).fehler, /höchstens 12,5/);
  assert.equal(lesePunkte('-1', 10).ok, false);
  assert.equal(lesePunkte('acht', 10).ok, false);
  // Prüfer 21.10.: „,5“ ist ein halber Punkt, kein Fehler; ein Komma allein bleibt einer
  assert.deepEqual(lesePunkte(',5', 10), { ok: true, wert: 0.5 });
  assert.deepEqual(lesePunkte('.5', 10), { ok: true, wert: 0.5 });
  assert.equal(lesePunkte(',', 10).ok, false);
  assert.equal(lesePunkte('5,', 10).ok, false);
});

// ── Prüfer 21.10.: Löschen gegen Bearbeiten, verwaiste Punkte, Konflikte an Unsichtbarem ──
const loeschPaar = () => {
  const a = arbeit({ id: 'a' });
  const del = arbeit({ id: 'del', ersetzt: 'a', geloescht: true, geraet: 'pc' }, '2026-10-15T10:05:00.000Z');
  const edit = arbeit({ id: 'ed', ersetzt: 'a', titel: 'KA 1 neu', geraet: 'ipad' }, '2026-10-15T10:03:00.000Z');
  return { a, del, edit };
};
test('Löschen gegen Bearbeiten: die Arbeit bleibt sichtbar mit Löschkonflikt, egal welche Uhr später ist; Auflösen ersetzt beide', () => {
  const { a, del, edit } = loeschPaar();
  for (const evs of [[a, del, edit], [a, edit, del]]) {
    const s = mappenStand(evs, K);
    assert.equal(s.arbeiten.length, 1, 'nicht über die Uhr gelöscht');
    assert.equal(s.arbeiten[0].titel, 'KA 1 neu', 'die lebende Fassung');
    assert.equal(s.arbeiten[0].loeschKonflikt, true);
    assert.equal(s.konflikte.filter(k => k.art === 'arbeit' && k.loeschKonflikt).length, 1);
    assert.deepEqual([s.kopf('arbeit', 'A1')].flat().sort(), ['del', 'ed']);
  }
  // Gegenrichtung: von Hand gelöscht (ersetzt beide Köpfe) → weg, kein Konflikt mehr
  const weg = arbeit({ id: 'w', ersetzt: ['del', 'ed'], geloescht: true }, '2026-10-15T10:09:00.000Z');
  const s2 = mappenStand([a, del, edit, weg], K);
  assert.equal(s2.arbeiten.length, 0); assert.equal(s2.konflikte.length, 0);
  // Gegenrichtung: zwei Löschungen sind kein Konflikt
  const del2 = { ...del, id: 'del2', geraet: 'ipad' };
  const s3 = mappenStand([a, del, del2], K);
  assert.equal(s3.arbeiten.length, 0); assert.equal(s3.konflikte.length, 0);
});

test('Verwaiste Punkte: nach dem Löschen eingetragen → gemeldet; vorher eingetragen → nicht', () => {
  const a = arbeit({ id: 'a' });
  const del = arbeit({ id: 'del', ersetzt: 'a', geloescht: true }, '2026-10-15T10:05:00.000Z');
  const vorher = ev('punkte', { id: 'pv', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x1', wert: 7 }, '2026-10-15T10:01:00.000Z');
  const danach = ev('punkte', { id: 'pd', arbeitId: 'A1', sid: 'n:bo', aufgabeId: 'x1', wert: 4, geraet: 'ipad' }, '2026-10-15T10:07:00.000Z');
  const s = mappenStand([a, del, vorher, danach], K);
  assert.deepEqual(s.verwaist.map(v => v.sid), ['n:bo']);
  assert.equal(s.punkte.size, 0, 'unsichtbar, nicht in der Rechnung');
  assert.deepEqual(mappenVerwaist([a, del, vorher, danach]).map(v => v.kursId), [K]);
  // Aufgabe entfernt (Arbeit lebt): Punkte danach auf der Aufgabe → verwaist
  const ohneX3 = arbeit({ id: 'a2', ersetzt: 'a', aufgaben: [{ id: 'x1', name: 'A1', max: 10 }, { id: 'x2', name: 'A2', max: 10 }] }, '2026-10-15T10:05:00.000Z');
  const aufX3 = ev('punkte', { id: 'p3', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x3', wert: 12 }, '2026-10-15T10:08:00.000Z');
  assert.deepEqual(mappenStand([a, ohneX3, aufX3], K).verwaist.map(v => v.aufgabeId), ['x3']);
  // Gegenfall: Arbeit lebt, Aufgabe da → nichts verwaist
  assert.equal(mappenStand([a, vorher, danach], K).verwaist.length, 0);
});

test('Konflikte an Unsichtbarem zählen nicht (niemand könnte sie lösen); an Sichtbarem schon', () => {
  const a = arbeit({ id: 'a' });
  const p1 = ev('punkte', { id: 'p1', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x3', wert: 7 });
  const pc = ev('punkte', { id: 'pc', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x3', wert: 8, ersetzt: 'p1' }, '2026-10-15T10:02:00.000Z');
  const ip = ev('punkte', { id: 'ip', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x3', wert: 9, ersetzt: 'p1', geraet: 'ipad' }, '2026-10-15T10:02:00.000Z');
  assert.equal(mappenKonflikte([a, p1, pc, ip]).length, 1, 'sichtbar → gemeldet');
  const ohneX3 = arbeit({ id: 'a2', ersetzt: 'a', aufgaben: [{ id: 'x1', name: 'A1', max: 10 }] }, '2026-10-15T10:05:00.000Z');
  assert.equal(mappenKonflikte([a, ohneX3, p1, pc, ip]).length, 0, 'Aufgabe entfernt → kein offener Konflikt');
  const del = arbeit({ id: 'del', ersetzt: 'a', geloescht: true }, '2026-10-15T10:05:00.000Z');
  assert.equal(mappenKonflikte([a, del, p1, pc, ip]).length, 0, 'Arbeit gelöscht → kein offener Konflikt');
});

test('Ersetzungs-Zyklus (beschädigter Container): kein Absturz, verschiedene Werte als Konflikt', () => {
  const a = arbeit({ id: 'a' });
  const z1 = ev('punkte', { id: 'z1', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x1', wert: 3, ersetzt: 'z2' });
  const z2 = ev('punkte', { id: 'z2', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x1', wert: 4, ersetzt: 'z1' }, '2026-10-15T10:01:00.000Z');
  const s = mappenStand([a, z1, z2], K);
  assert.equal(s.punkte.get('A1').get('n:ada').get('x1'), 4);
  assert.equal(s.konflikte.length, 1);
  const r = mergeContainerDaten({ schema: 'kladde/v4', stamm: stamm('pc', 5), events: [a, z1] }, { schema: 'kladde/v4', stamm: stamm('ipad', 5), events: [a, z2] });
  assert.ok(r.konflikte.some(k => /verschieden/.test(k)));
});

test('Abgleich meldet verwaiste Punkte vor den Sammelmeldungen', () => {
  const a = arbeit({ id: 'a' });
  const pc = [a, arbeit({ id: 'del', ersetzt: 'a', geloescht: true }, '2026-10-15T10:05:00.000Z')];
  const ip = [a, ev('punkte', { id: 'pd', arbeitId: 'A1', sid: 'n:bo', aufgabeId: 'x1', wert: 4, geraet: 'ipad' }, '2026-10-15T10:07:00.000Z')];
  const r = mergeContainerDaten({ schema: 'kladde/v4', stamm: stamm('pc', 5), events: pc }, { schema: 'kladde/v4', stamm: stamm('ipad', 5), events: ip });
  const i = r.konflikte.findIndex(k => /gelöscht wurde/.test(k));
  assert.ok(i >= 0, JSON.stringify(r.konflikte));
  assert.match(r.konflikte[i], /^7c · Mathematik: 1 Punkteintrag gehört|1 Punkteintrag gehört/);
  // Gegenfall: ohne späteren Eintrag keine Meldung
  const r2 = mergeContainerDaten({ schema: 'kladde/v4', stamm: stamm('pc', 5), events: pc }, { schema: 'kladde/v4', stamm: stamm('ipad', 5), events: [a] });
  assert.ok(!r2.konflikte.some(k => /gelöscht wurde/.test(k)));
});

test('Quartal aus dem Datum: eine Arbeit gehört genau einem Quartal', () => {
  const sj = { zeitraeume: [{ id: 'q1', von: '2026-08-01', bis: '2026-11-06' }, { id: 'q2', von: '2026-11-07', bis: '2027-01-31' },
    { id: 'hj1', von: '2026-08-01', bis: '2027-01-31' }] };
  assert.equal(quartalVon('2026-10-15', sj), 'q1');
  assert.equal(quartalVon('2026-11-05', sj), 'q1');
  assert.equal(quartalVon('2026-11-07', sj), 'q2', 'S4: eine Arbeit vom November zählt nicht auch in Q1');
  assert.equal(quartalVon('2027-03-01', sj), null);
});

test('Schlüssel je Arbeit: die Arbeit trägt ihren eigenen Schlüssel (eine spätere Vorgabe ändert sie nicht)', () => {
  const streng = arbeit({ id: 'a', schluessel: { art: 'sek1', vier: .5, fuenf: .2 }, aufgaben: [{ id: 'x1', max: 40 }] });
  const p = ev('punkte', { id: 'p', arbeitId: 'A1', sid: 'n:ada', aufgabeId: 'x1', wert: 19 });
  const s = mappenStand([streng, p], K), arb = s.arbeiten[0];
  assert.deepEqual(arb.schluessel, { art: 'sek1', vier: .5, fuenf: .2 });
  assert.equal(werteArbeitAus(arb, [{ sid: 'n:ada' }], s.punkte.get('A1')).zeilen[0].note, 5, '19/40 = 47,5 % unter „4 ab 50 %“');
});
