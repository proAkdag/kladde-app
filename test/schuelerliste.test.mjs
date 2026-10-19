// Zwei Nummern (Zero 04./05.10., design/schuelerliste_2026-10-05/WAHL.md): Ausweis-Nr `nr` bleibt, Listen-Nr `liste` folgt der Mappe.
// Erwartungen stehen als feste Tabellen im Test, nie aus der geprüften Funktion abgeleitet. Namen erfunden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lnr, nachListe, neueAusweisNr, nrnAuseinander, planeAbgleich, wendePlanAn, MAX_LISTE } from '../logic/teilnehmer.mjs';
import { encodeContainerV2, decodeContainerAuto, neueV2Identitaet } from '../logic/container.mjs';
import { mergeContainerDaten } from '../logic/merge.mjs';
import { pruefeKursDatei } from '../logic/mappe.mjs';

const kind = (nr, vorname, name, extra = {}) => ({ nr, vorname, name, ...extra });
// Bestand: 8 Kinder, Ausweis- = Listen-Nr (kein Feld `liste`), Nr 3 in Gruppe A
const ALT = [kind(1, 'Ronja', 'Ecker'), kind(2, 'Milan', 'Jäger'), kind(3, 'Defne', 'Rösler', { gruppe: 'A' }), kind(4, 'Ida', 'Neumann'),
  kind(5, 'Fiona', 'Neumann'), kind(6, 'Aylin', 'Weiß'), kind(7, 'Umut', 'Ulrich'), kind(8, 'Greta', 'Rösler')];
const allesMitEintraegen = () => true;
// Mappe: Nr 1 heißt jetzt „Kaya“ (Vorname gleich), Umut Ulrich ist gegangen, Ben Adler in Zeile 2, Mia Lorenz in Zeile 6
const MAPPE = [['Ronja', 'Kaya'], ['Ben', 'Adler'], ['Milan', 'Jäger'], ['Defne', 'Rösler'], ['Ida', 'Neumann'], ['Mia', 'Lorenz'],
  ['Fiona', 'Neumann'], ['Aylin', 'Weiß'], ['Greta', 'Rösler']].map(([vorname, name], i) => ({ nr: i + 1, vorname, name }));

test('lnr und nachListe: fehlt `liste`, gilt die Ausweis-Nr; null steht hinten', () => {
  assert.equal(lnr(kind(4, 'a', 'b')), 4);
  assert.equal(lnr(kind(4, 'a', 'b', { liste: 9 })), 9);
  assert.equal(lnr(kind(4, 'a', 'b', { liste: null })), null);
  const l = [kind(1, 'a', 'a', { liste: 3 }), kind(2, 'b', 'b', { liste: null }), kind(3, 'c', 'c', { liste: 1 }), kind(4, 'd', 'd')];
  assert.deepEqual(nachListe(l).map(s => s.nr), [3, 1, 4, 2]);
});

test('neueAusweisNr: höher als jede Nr in Stamm UND Einträgen, auch über 35', () => {
  assert.equal(neueAusweisNr(ALT, []), 9);
  assert.equal(neueAusweisNr(ALT, [{ schuelerNr: 12 }]), 13);        // gelöschtes Kind mit Einträgen: Nr 12 nie wieder
  assert.equal(neueAusweisNr([kind(40, 'a', 'b')], []), 41);
});

test('Anpassen: Rückfrage sperrt, bis sie beantwortet ist', () => {
  const p = planeAbgleich(ALT, MAPPE, 'anpassen', {});
  assert.equal(p.offen, 1);
  assert.equal(p.fragen[0].kind.nr, 1);
  assert.equal(p.fragen[0].zeile.name, 'Kaya'); assert.equal(p.fragen[0].id, 'k1z1'); assert.equal(p.fragen[0].art, 'teil');
  assert.equal(wendePlanAn(ALT, p, allesMitEintraegen), null);
});

test('Anpassen: Listen-Nr = Mappenzeile, jedes Kind behält seine Ausweis-Nr (Einträge bleiben am Kind)', () => {
  const p = planeAbgleich(ALT, MAPPE, 'anpassen', { k1z1: true });
  const neu = wendePlanAn(ALT, p, allesMitEintraegen, []);
  const nachName = n => neu.find(s => s.vorname + ' ' + s.name === n);
  // Soll: Name → [Ausweis-Nr, Listen-Nr]
  const SOLL = { 'Ronja Kaya': [1, 1], 'Ben Adler': [9, 2], 'Milan Jäger': [2, 3], 'Defne Rösler': [3, 4], 'Ida Neumann': [4, 5],
    'Mia Lorenz': [10, 6], 'Fiona Neumann': [5, 7], 'Aylin Weiß': [6, 8], 'Greta Rösler': [8, 9] };
  for (const [n, [nr, li]] of Object.entries(SOLL)) {
    const s = nachName(n); assert.ok(s, n + ' fehlt');
    assert.equal(s.nr, nr, n + ' Ausweis-Nr'); assert.equal(lnr(s), li, n + ' Listen-Nr'); assert.ok(!s.inaktiv, n + ' aktiv');
  }
  assert.equal(nachName('Defne Rösler').gruppe, 'A');                 // Felder reisen mit dem Kind, nicht mit der Nr
  const umut = neu.find(s => s.nr === 7);
  assert.equal(umut.inaktiv, true); assert.equal(lnr(umut), null);     // gegangen: inaktiv, gibt seine Nr ab
  assert.equal(p.geaendert, 6);
  assert.equal(ALT[0].name, 'Ecker');                                  // rein
});

test('Behalten: bisherige Listen-Nrn bleiben, Neue unten an, Lücke bleibt', () => {
  const p = planeAbgleich(ALT, MAPPE, 'behalten', { k1z1: true });
  const neu = wendePlanAn(ALT, p, allesMitEintraegen, []);
  const SOLL = { 'Ronja Kaya': [1, 1], 'Ben Adler': [9, 9], 'Milan Jäger': [2, 2], 'Defne Rösler': [3, 3], 'Mia Lorenz': [10, 10], 'Greta Rösler': [8, 8] };
  for (const [n, [nr, li]] of Object.entries(SOLL)) {
    const s = neu.find(x => x.vorname + ' ' + x.name === n);
    assert.equal(s.nr, nr, n + ' Ausweis-Nr'); assert.equal(lnr(s), li, n + ' Listen-Nr');
  }
  const umut = neu.find(s => s.nr === 7);
  assert.equal(umut.inaktiv, true); assert.equal(lnr(umut), 7);        // Lücke 7 bleibt reserviert
  assert.equal(p.geaendert, 0);
});

test('Offene Rückfrage hat eine Stelle in der Liste: anpassen → Mappenzeile, behalten → bisherige Listen-Nr', () => {
  const alt = [kind(1, 'Ada', 'Aal'), kind(2, 'Bo', 'Berg', { liste: 5 })];
  const mappe = [{ nr: 1, vorname: 'Ada', name: 'Aal' }, { nr: 3, vorname: 'Bo', name: 'Brandt' }];
  assert.equal(planeAbgleich(alt, mappe, 'anpassen').fragen[0].stelle, 3);
  assert.equal(planeAbgleich(alt, mappe, 'behalten').fragen[0].stelle, 5);
});

test('Rückfrage „Nein, anderes Kind“: Kaya ist neu, Ecker geht', () => {
  const p = planeAbgleich(ALT, MAPPE, 'anpassen', { k1z1: false });
  const neu = wendePlanAn(ALT, p, allesMitEintraegen, []);
  assert.equal(neu.find(s => s.nr === 1).inaktiv, true);
  const kaya = neu.find(s => s.name === 'Kaya');
  assert.equal(kaya.nr, 9); assert.equal(lnr(kaya), 1);
});

test('Zuordnung über den Namen, nicht über die Nr: Schreibvarianten still, gleiche Namen gefragt (Vorschlag in bisheriger Reihenfolge)', () => {
  const alt = [kind(1, 'Ayse', 'Celik'), kind(2, 'Lukas', 'Müller'), kind(3, 'Lukas', 'Müller'), kind(4, 'Anna-Lena', 'Weber')];
  const mappe = [{ nr: 1, vorname: 'Lukas', name: 'Mueller' }, { nr: 2, vorname: 'Ayşe', name: 'Çelik' }, { nr: 3, vorname: 'Anna Lena', name: 'Weber' }, { nr: 4, vorname: 'Lukas', name: 'Müller' }];
  const offen = planeAbgleich(alt, mappe, 'anpassen', {});
  assert.deepEqual(offen.fragen.map(f => [f.id, f.art]), [['k2z1', 'gleich'], ['k3z4', 'gleich']]);   // Ayşe und Anna Lena still
  assert.equal(offen.offen, 2); assert.equal(offen.weg.length, 0); assert.equal(wendePlanAn(alt, offen, allesMitEintraegen), null);
  const p = planeAbgleich(alt, mappe, 'anpassen', { k2z1: true, k3z4: true });
  const neu = wendePlanAn(alt, p, allesMitEintraegen, []);
  assert.deepEqual(neu.map(s => [s.nr, lnr(s)]), [[1, 2], [2, 1], [3, 4], [4, 3]]);
  assert.equal(neu[0].vorname, 'Ayşe');                                // Schreibung der Mappe wird übernommen
});

test('Abgang taucht wieder auf → wird gefragt (Prüfer Y2); eine Lücke bleibt, bis ein anderes Kind ihre Zeile trägt (Prüfer Y4)', () => {
  const alt = [kind(1, 'Ada', 'Aal'), kind(2, 'Bo', 'Berg', { inaktiv: true }), kind(3, 'Cem', 'Cetin', { inaktiv: true })];
  const mappe = [{ nr: 1, vorname: 'Bo', name: 'Berg' }, { nr: 2, vorname: 'Ada', name: 'Aal' }];
  const offen = planeAbgleich(alt, mappe, 'anpassen', {});
  assert.deepEqual(offen.fragen.map(f => [f.id, f.art]), [['k2z1', 'wieder']]); assert.equal(offen.offen, 1);
  const neu = wendePlanAn(alt, planeAbgleich(alt, mappe, 'anpassen', { k2z1: true }), allesMitEintraegen, []);
  assert.equal(neu.find(s => s.nr === 2).inaktiv, undefined); assert.equal(lnr(neu.find(s => s.nr === 2)), 1);
  assert.equal(lnr(neu.find(s => s.nr === 3)), 3);                     // Cems Zeile 3 bleibt in der Mappe leer → Lücke bleibt
  const nein = wendePlanAn(alt, planeAbgleich(alt, mappe, 'anpassen', { k2z1: false }), allesMitEintraegen, []);
  assert.equal(nein.find(s => s.nr === 2).inaktiv, true); assert.deepEqual([nein.find(s => s.nr === 4).name, lnr(nein.find(s => s.nr === 4))], ['Berg', 1]);
  const mitDan = [...mappe, { nr: 3, vorname: 'Dan', name: 'Dorn' }];   // jetzt trägt ein anderes Kind Zeile 3
  const p3 = planeAbgleich(alt, mitDan, 'anpassen', { k2z1: true });
  assert.deepEqual(p3.sonstige.map(o => [o.kind.nr, o.neu]), [[3, null]]);
  assert.equal(lnr(wendePlanAn(alt, p3, allesMitEintraegen, []).find(s => s.nr === 3)), null);
});

test('Inaktives Kind wird nur über seinen Namen zurückgeholt: ein anderer Name auf seiner Zeile ist ein neues Kind (Prüfer 2026-09-29)', () => {
  const alt = [kind(1, 'Ada', 'Aal'), kind(2, 'Bo', 'Berg', { inaktiv: true })];
  const p = planeAbgleich(alt, [{ nr: 1, vorname: 'Ada', name: 'Aal' }, { nr: 2, vorname: 'Cem', name: 'Cetin' }], 'anpassen', {});
  assert.equal(p.fragen.length, 0);                                    // Inaktive werden nicht erfragt
  const neu = wendePlanAn(alt, p, allesMitEintraegen, []);
  assert.equal(neu.find(s => s.nr === 2).inaktiv, true); assert.equal(lnr(neu.find(s => s.nr === 2)), null);
  assert.deepEqual([neu.find(s => s.name === 'Cetin').nr, lnr(neu.find(s => s.name === 'Cetin'))], [3, 2]);
});

test('Unveränderte Liste → unveraendert; Gegenrichtung: LB-Wechsel ist eine Änderung', () => {
  assert.equal(planeAbgleich(ALT, ALT.map(s => ({ nr: s.nr, vorname: s.vorname, name: s.name })), 'anpassen').unveraendert, true);
  const mitLb = ALT.map(s => ({ nr: s.nr, vorname: s.vorname, name: s.name, lb: s.nr === 2 }));
  assert.equal(planeAbgleich(ALT, mitLb, 'anpassen').unveraendert, false);
});

test('Behalten über die letzte Mappenzeile hinaus → Fehler, nicht anwendbar', () => {
  const alt = Array.from({ length: MAX_LISTE }, (_, i) => kind(i + 1, 'V' + i, 'N' + i));
  const p = planeAbgleich(alt, [...alt.map(s => ({ nr: s.nr, vorname: s.vorname, name: s.name })), { nr: 36, vorname: 'Neu', name: 'Kind' }], 'behalten');
  assert.ok(p.fehler.length);
  assert.equal(wendePlanAn(alt, p, allesMitEintraegen), null);
});

test('Weg ohne Einträge wird entfernt, mit Einträgen inaktiv (wie bisher)', () => {
  const p = planeAbgleich(ALT, MAPPE, 'anpassen', { k1z1: true });
  const neu = wendePlanAn(ALT, p, nr => nr !== 7, []);
  assert.equal(neu.find(s => s.nr === 7), undefined);
});

test('Rückfrage auch bei gleichem Nachnamen (Vorname anders geschrieben)', () => {
  const alt = [kind(1, 'Aleksandr', 'Petrov'), kind(2, 'Ben', 'Berg')];
  const p = planeAbgleich(alt, [{ nr: 1, vorname: 'Alexander', name: 'Petrov' }, { nr: 2, vorname: 'Ben', name: 'Berg' }], 'anpassen', {});
  assert.equal(p.fragen.length, 1); assert.equal(p.fragen[0].kind.nr, 1); assert.equal(p.offen, 1);
});

test('Gleicher Name zweimal, einer gegangen: gefragt wird zuerst das Kind auf derselben Zeile; „Nein“ fragt das andere (Prüfer R2)', () => {
  const alt = [kind(1, 'Ada', 'Aal'), kind(2, 'Lukas', 'Müller'), kind(3, 'Lukas', 'Müller')];
  const mappe = [{ nr: 1, vorname: 'Ada', name: 'Aal' }, { nr: 2, vorname: 'Ben', name: 'Berg' }, { nr: 3, vorname: 'Lukas', name: 'Müller' }];
  const offen = planeAbgleich(alt, mappe, 'anpassen', {});
  assert.deepEqual(offen.fragen.map(f => f.id), ['k3z3']); assert.equal(offen.offen, 1);
  const anders = planeAbgleich(alt, mappe, 'anpassen', { k3z3: false });
  assert.deepEqual(anders.fragen.map(f => [f.id, f.antwort]), [['k3z3', false], ['k2z3', undefined]]); assert.equal(anders.offen, 1);
  assert.deepEqual(planeAbgleich(alt, mappe, 'anpassen', { k3z3: false, k2z3: true }).weg.map(w => w.kind.nr), [3]);
  const p = planeAbgleich(alt, mappe, 'anpassen', { k3z3: true });
  assert.deepEqual(p.weg.map(w => w.kind.nr), [2]);
  assert.deepEqual(p.zeilen.map(z => [z.kind ? z.kind.nr : null, z.neu]), [[1, 1], [null, 2], [3, 3]]);
});

test('Bestand bleibt unverändert: kein Feld `liste`, solange Listen-Nr = Ausweis-Nr', () => {
  const neu = wendePlanAn(ALT, planeAbgleich(ALT, MAPPE, 'anpassen', { k1z1: true }), allesMitEintraegen, []);
  assert.equal('liste' in neu.find(s => s.nr === 1), false);           // Ronja: 1 = 1
  assert.equal(neu.find(s => s.nr === 2).liste, 3);                    // Milan: Ausweis 2, Zeile 3
});

test('Neue Ausweis-Nr nie wiederverwendet: weder aus Einträgen noch von einem gerade entfernten Kind', () => {
  const p = planeAbgleich(ALT, MAPPE, 'anpassen', { k1z1: true });
  const neu = wendePlanAn(ALT, p, nr => nr !== 7, [{ schuelerNr: 20 }]);
  assert.equal(neu.find(s => s.name === 'Adler').nr, 21); assert.equal(neu.find(s => s.name === 'Lorenz').nr, 22);
  const alt = [kind(1, 'Ada', 'Aal'), kind(2, 'Bo', 'Berg')];
  const q = planeAbgleich(alt, [{ nr: 1, vorname: 'Ada', name: 'Aal' }, { nr: 2, vorname: 'Cem', name: 'Cetin' }], 'anpassen', {});
  const neu2 = wendePlanAn(alt, q, () => false, []);
  assert.equal(neu2.find(s => s.nr === 2), undefined);                 // Bo ohne Einträge entfernt
  assert.equal(neu2.find(s => s.name === 'Cetin').nr, 3);              // Cem bekommt NICHT Bos Nr 2
});

test('Rückfrage je Paar (Prüfer R1): „Nein“ an einer Zeile beantwortet keine andere, „Ja“ gilt nur für seine Zeile', () => {
  const alt = [kind(1, 'Anna', 'Schmidt'), kind(2, 'Ben', 'Weber'), kind(3, 'Carl', 'Ott')];
  const mappe = [{ nr: 1, vorname: 'Anna', name: 'Becker' }, { nr: 2, vorname: 'Ben', name: 'Weber' }, { nr: 3, vorname: 'Carl', name: 'Ott' }, { nr: 4, vorname: 'Anna', name: 'Krause' }];
  assert.deepEqual(planeAbgleich(alt, mappe, 'anpassen', {}).fragen.map(f => f.id), ['k1z1']);   // die nähere Stelle zuerst
  const nein = planeAbgleich(alt, mappe, 'anpassen', { k1z1: false });
  assert.deepEqual(nein.fragen.map(f => [f.id, f.antwort]), [['k1z1', false], ['k1z4', undefined]]);
  assert.equal(nein.offen, 1); assert.equal(wendePlanAn(alt, nein, allesMitEintraegen), null);   // gesperrt, bis auch Zeile 4 beantwortet ist
  const nurJa4 = planeAbgleich(alt, mappe, 'anpassen', { k1z4: true });   // ein „Ja“ bindet vor allen offenen Paaren (N2): Zeile 1 ist dann neu
  assert.equal(nurJa4.offen, 0); assert.deepEqual(nurJa4.fragen.map(f => [f.id, f.antwort]), [['k1z4', true]]);
  assert.deepEqual(nurJa4.zeilen.map(z => [z.neu, z.kind ? z.kind.nr : 'neu']), [[1, 'neu'], [2, 2], [3, 3], [4, 1]]);
  const neu = wendePlanAn(alt, planeAbgleich(alt, mappe, 'anpassen', { k1z1: false, k1z4: true }), allesMitEintraegen, []);
  assert.deepEqual([neu.find(s => s.nr === 1).name, lnr(neu.find(s => s.nr === 1))], ['Krause', 4]);   // Einträge bleiben bei Anna Schmidt/Krause
  assert.deepEqual([neu.find(s => s.name === 'Becker').nr, lnr(neu.find(s => s.name === 'Becker'))], [4, 1]);
});

test('Ein gegebenes „Ja“ bleibt, wenn ein „Nein“ ein früher sortiertes Paar freigibt (Nachprüfung N2)', () => {
  const alt = [kind(1, 'Mia', 'Ott'), kind(2, 'Mia', 'Kaya')];
  const mappe = [{ nr: 1, vorname: 'Mia', name: 'Berg' }, { nr: 4, vorname: 'Mia', name: 'Kayan' }];
  const p = planeAbgleich(alt, mappe, 'anpassen', { k2z4: true, k1z1: false });
  assert.deepEqual(p.fragen.map(f => [f.id, f.antwort]), [['k2z4', true], ['k1z1', false]]);   // Mia Kaya wird nicht noch einmal gefragt
  assert.equal(p.offen, 0);
  assert.deepEqual(p.zeilen.map(z => [z.neu, z.kind ? z.kind.nr : 'neu']), [[1, 'neu'], [4, 2]]);
  assert.deepEqual(p.weg.map(w => w.kind.nr), [1]);
  // Zwei „Ja“ für dasselbe Kind: es gilt das nähere Paar (Zeile 1, Abstand 1 statt 2), das andere ruht — nie beide
  const zwei = planeAbgleich(alt, mappe, 'anpassen', { k2z4: true, k2z1: true });
  assert.deepEqual(zwei.zeilen.filter(z => z.kind).map(z => [z.neu, z.kind.nr]), [[1, 2]]);
});

// Prüfer 05.10. R3 (Rest): Ein Gerät mit älterem Stand kennt nur die Ausweis-Nr. Gewarnt wird überall, wo ein Schritt Ausweis- und
// Listen-Nr eines aktiven Kindes NEU auseinanderlaufen lässt — Dialog in beiden Modi, „+ Schüler“, Aktivieren.
test('nrnAuseinander: nur neue Abweichungen aktiver Kinder zählen (Prüfer R3)', () => {
  const drei = [kind(1, 'a', 'a'), kind(2, 'b', 'b'), kind(3, 'c', 'c')];
  const FAELLE = [   // [vorher, nachher, Soll]
    [drei, drei, false],
    [drei, [...drei, kind(5, 'e', 'e', { liste: 4 })], true],                 // „+ Schüler“ nach einem ohne Einträge entfernten Kind
    [drei, [...drei, kind(4, 'd', 'd')], false],                              // „+ Schüler“ im Normalfall
    [[kind(2, 'b', 'b', { liste: 1 })], [kind(2, 'b', 'b', { liste: 1 })], false],   // schon vorher so: nichts Neues
    [[kind(2, 'b', 'b', { liste: 1 })], [kind(2, 'b', 'b', { liste: 3 })], true],
    [[kind(2, 'b', 'b', { liste: 1 })], [kind(2, 'b', 'b')], false],         // zurück auf gleich
    [drei, [kind(1, 'a', 'a'), kind(2, 'b', 'b', { liste: null, inaktiv: true })], false],   // Abgang: ein altes Gerät zeigt ihn nicht
    [[kind(1, 'a', 'a', { liste: null, inaktiv: true })], [kind(1, 'a', 'a', { liste: 28 })], true],   // Aktivieren ohne Nr
    [[kind(1, 'a', 'a', { liste: 3, inaktiv: true })], [kind(1, 'a', 'a', { liste: 3 })], true],
  ];
  FAELLE.forEach(([v, n, soll], i) => assert.equal(nrnAuseinander(v, n), soll, 'Fall ' + i));
  // „Bisherige behalten“: Neue unten an, die Ausweis-Nr liegt wegen der Höchstmarke höher als die Zeile
  const alt = [kind(1, 'Ada', 'Aal'), kind(2, 'Bo', 'Berg')], mappe = [...alt, { nr: 3, vorname: 'Zoe', name: 'Zorn' }];
  const nach = bis => wendePlanAn(alt, planeAbgleich(alt, mappe, 'behalten', {}), allesMitEintraegen, [], bis);
  assert.equal(nrnAuseinander(alt, nach(0)), false); assert.equal(nrnAuseinander(alt, nach(3)), true);
});

test('Gleichnamige mit Einschub (Prüfer R2): gefragt, Vorschlag hält die Reihenfolge, Gruppe bleibt am Kind', () => {
  const alt = [kind(1, 'Ada', 'Aal'), kind(2, 'Lena', 'Müller', { gruppe: 'A' }), kind(3, 'Lena', 'Müller', { gruppe: 'B' })];
  const mappe = [{ nr: 1, vorname: 'Ben', name: 'Berg' }, { nr: 2, vorname: 'Ada', name: 'Aal' }, { nr: 3, vorname: 'Lena', name: 'Müller' }, { nr: 4, vorname: 'Lena', name: 'Müller' }];
  const offen = planeAbgleich(alt, mappe, 'anpassen', {});
  assert.deepEqual(offen.fragen.map(f => f.id), ['k2z3', 'k3z4']); assert.equal(offen.offen, 2);
  const neu = wendePlanAn(alt, planeAbgleich(alt, mappe, 'anpassen', { k2z3: true, k3z4: true }), allesMitEintraegen, []);
  assert.deepEqual([2, 3].map(nr => [lnr(neu.find(s => s.nr === nr)), neu.find(s => s.nr === nr).gruppe]), [[3, 'A'], [4, 'B']]);
});

test('Höchstmarke (Prüfer R4): ein früher ohne Einträge entferntes Kind gibt seine Ausweis-Nr nie wieder her', () => {
  assert.equal(neueAusweisNr([kind(1, 'a', 'b')], [], 7), 8);
  assert.equal(neueAusweisNr([kind(9, 'a', 'b')], [], 7), 10);
  const alt = [kind(1, 'Ada', 'Aal')];   // Bo (Ausweis 2) wurde in einer früheren Aktualisierung ohne Einträge entfernt
  const neu = wendePlanAn(alt, planeAbgleich(alt, [{ nr: 1, vorname: 'Ada', name: 'Aal' }, { nr: 2, vorname: 'Zoe', name: 'Zorn' }], 'anpassen', {}), allesMitEintraegen, [], 2);
  assert.equal(neu.find(s => s.name === 'Zorn').nr, 3);
});

test('kurs.json der Kladde mit Abgängen (Prüfer Y3): inaktive Zeilen und Zeilen ohne Listen-Nr zählen nicht als Mappenzeilen', () => {
  const alt = [kind(1, 'Ada', 'Aal'), kind(2, 'Bo', 'Berg', { inaktiv: true, liste: null }), kind(3, 'Tim', 'Tal', { inaktiv: true })];
  const json = [{ nr: 1, vorname: 'Ada', name: 'Aal' }, { nr: 2, liste: null, vorname: 'Bo', name: 'Berg', inaktiv: true }, { nr: 3, vorname: 'Tim', name: 'Tal', inaktiv: true }];
  const p = planeAbgleich(alt, json, 'anpassen', {});
  assert.deepEqual([p.fehler, p.fragen.length, p.unveraendert], [[], 0, true]);
});

test('Bestand mit einem Abgang, dieselbe Mappe noch einmal (Prüfer Y4): unverändert, der Abgang behält seine Lücke', () => {
  const alt = [kind(1, 'Ada', 'Aal'), kind(2, 'Bo', 'Berg'), kind(3, 'Cem', 'Cetin', { inaktiv: true }), kind(4, 'Dan', 'Dorn')];
  const mappe = [{ nr: 1, vorname: 'Ada', name: 'Aal' }, { nr: 2, vorname: 'Bo', name: 'Berg' }, { nr: 4, vorname: 'Dan', name: 'Dorn' }];
  const p = planeAbgleich(alt, mappe, 'anpassen', {});
  assert.deepEqual([p.unveraendert, p.sonstige.length], [true, 0]);
});

test('Zeilen aus einer kurs.json der Kladde: die Zeile steht in `liste`, die fremde Ausweis-Nr zählt nicht', () => {
  const alt = [kind(1, 'Ada', 'Aal'), kind(2, 'Bo', 'Berg')];
  const json = [{ nr: 5, liste: 1, vorname: 'Cem', name: 'Cetin' }, { nr: 1, liste: 2, vorname: 'Ada', name: 'Aal' }, { nr: 2, liste: 3, vorname: 'Bo', name: 'Berg' }];
  const neu = wendePlanAn(alt, planeAbgleich(alt, json, 'anpassen', {}), allesMitEintraegen, []);
  assert.deepEqual(nachListe(neu).map(s => [s.vorname, s.nr, lnr(s)]), [['Cem', 3, 1], ['Ada', 1, 2], ['Bo', 2, 3]]);
});

test('Roundtrip: `liste` übersteht Container, Merge (auch als ergänztes Kind) und kurs.json', async () => {
  const KURS = [kind(1, 'Ronja', 'Kaya'), kind(2, 'Milan', 'Jäger', { liste: 3 }), kind(7, 'Umut', 'Ulrich', { liste: null, inaktiv: true }),
    kind(8, 'Greta', 'Rösler', { liste: null, inaktiv: true }), kind(9, 'Ben', 'Adler', { liste: 2 })];
  const SOLL = [[1, 1], [2, 3], [7, null], [8, null], [9, 2]];        // [Ausweis-Nr, Listen-Nr]; zweimal „keine“ ist kein Konflikt
  const nrn = l => l.map(s => [s.nr, lnr(s)]);
  const stamm = schueler => ({ rev: 2, ts: '2026-10-05T08:00Z', geraet: 'pc', kurse: [{ id: '7b', name: '7b' }], schueler: { '7b': schueler } });
  // 1 · Container verschlüsselt und zurück
  const { dek, kopf } = await neueV2Identitaet('roundtrip-123456');
  const r = await decodeContainerAuto(await encodeContainerV2({ schema: 'kladde/v2', stamm: stamm(KURS), events: [] }, dek, kopf), 'roundtrip-123456');
  assert.deepEqual(nrn(r.daten.stamm.schueler['7b']), SOLL);
  // 2 · Merge: Ben steht nur im unterlegenen Stand und wird ergänzt — mit seiner Listen-Nr, ohne Konflikt
  const sieger = { ...stamm(KURS.filter(s => s.nr !== 9)), rev: 3 };
  const m = mergeContainerDaten({ stamm: sieger, events: [] }, { stamm: r.daten.stamm, events: [] });
  assert.deepEqual(nrn(m.daten.stamm.schueler['7b']), SOLL);
  assert.equal(m.konflikte.length, 0);
  // 3 · als kurs.json exportiert und wieder geprüft
  const p = pruefeKursDatei(JSON.parse(JSON.stringify({ schema: 'kladde/v1', kurs: { id: '7b', name: '7b' }, schueler: m.daten.stamm.schueler['7b'] })));
  assert.deepEqual(nrn(p.schueler), SOLL);
});
