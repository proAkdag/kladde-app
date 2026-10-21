// Scheibe E „Klassenliste“ (Zero 20.10., Wahl B): Namen teilen, Einfügen lesen, alphabetisch, verschieben, Anlegen lückenlos,
// Umordnen nur über die Listen-Nr. Erwartungen stehen als feste Tabellen im Test, nie aus der geprüften Funktion abgeleitet. Namen erfunden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sortiereAlpha, istAlphabetisch, teileName, liesEinfuegen, doppelte, verschiebe, nummeriere, ordneNeu } from '../logic/klassenliste.mjs';
import { lnr, nachListe } from '../logic/teilnehmer.mjs';

const namen = kinder => kinder.map(k => k.vorname + ' ' + k.name);

test('teileName: Vorname Nachname, Partikel bleiben beim Nachnamen, ein Wort ist der Nachname', () => {
  assert.deepEqual(teileName('Elif Yilmaz'), { vorname: 'Elif', name: 'Yilmaz' });
  assert.deepEqual(teileName('  Anna Maria   Schmidt '), { vorname: 'Anna Maria', name: 'Schmidt' });
  assert.deepEqual(teileName('Lena von der Heide'), { vorname: 'Lena', name: 'von der Heide' });
  assert.deepEqual(teileName('Mohammed bin Salah'), { vorname: 'Mohammed', name: 'bin Salah' });
  assert.deepEqual(teileName('Becker'), { vorname: '', name: 'Becker' });
  assert.deepEqual(teileName(''), { vorname: '', name: '' });
});

test('sortiereAlpha: Nachname, dann Vorname, deutsch (Ö bei O), Eingabe unverändert', () => {
  const ein = [{ vorname: 'Elif', name: 'Yilmaz' }, { vorname: 'Sofia', name: 'Öztürk' }, { vorname: 'Ben', name: 'Adler' }, { vorname: 'Paul', name: 'Otto' }, { vorname: 'Anna', name: 'Adler' }];
  assert.deepEqual(namen(sortiereAlpha(ein)), ['Anna Adler', 'Ben Adler', 'Paul Otto', 'Sofia Öztürk', 'Elif Yilmaz']);
  assert.equal(ein[0].name, 'Yilmaz');
  assert.equal(istAlphabetisch(sortiereAlpha(ein)), true);
  assert.equal(istAlphabetisch(ein), false);
});

test('liesEinfuegen: Excel-Spalten mit Nr, LB, Reihenfolge der Nr-Spalte', () => {
  const r = liesEinfuegen('2\tBecker\tJonas\n1\tAdler\tBen\tLB\n3\tYilmaz\tElif');
  assert.deepEqual(r.kinder, [{ vorname: 'Ben', name: 'Adler', lb: true }, { vorname: 'Jonas', name: 'Becker', lb: false }, { vorname: 'Elif', name: 'Yilmaz', lb: false }]);
  assert.equal(r.mitNr, true); assert.equal(r.luecken, false); assert.deepEqual(r.hinweise, []);
});

test('liesEinfuegen: „Nachname, Vorname“ und „Vorname Nachname“ ohne Nr — ohne Warnwand', () => {
  const a = liesEinfuegen('Yilmaz, Elif\nBecker, Jonas');
  assert.deepEqual(namen(a.kinder), ['Elif Yilmaz', 'Jonas Becker']); assert.equal(a.mitNr, false); assert.deepEqual(a.hinweise, []);
  const b = liesEinfuegen('Elif Yilmaz\nJonas Becker\nMert Aydin');
  assert.deepEqual(namen(b.kinder), ['Elif Yilmaz', 'Jonas Becker', 'Mert Aydin']); assert.deepEqual(b.hinweise, []);
});

test('liesEinfuegen: Lücken in der Nr-Spalte werden gemeldet, echte Probleme bleiben Hinweise', () => {
  const r = liesEinfuegen('1\tAdler\tBen\n4\tBecker\tJonas\n4\tDoppelt\tDora\n40\tWeit\tWeg\n5\tNurname');
  assert.equal(r.mitNr, true); assert.equal(r.luecken, true);
  assert.deepEqual(namen(r.kinder), ['Ben Adler', 'Jonas Becker', ' Nurname']);
  assert.deepEqual(r.hinweise, ['Nr 4 doppelt — zweite Zeile übersprungen', 'Nr 40 außerhalb 1–35 — übersprungen (Grenze der Excel-Mappe)', 'Nr 5: nur ein Namensfeld — als Nachname übernommen']);
});

test('verschiebe: ↑↓ und Ziehen, Ränder ohne Wirkung, Original unberührt', () => {
  const a = ['A', 'B', 'C', 'D'];
  assert.deepEqual(verschiebe(a, 2, 1), ['A', 'C', 'B', 'D']);
  assert.deepEqual(verschiebe(a, 0, 3), ['B', 'C', 'D', 'A']);
  assert.deepEqual(verschiebe(a, 0, -1), ['A', 'B', 'C', 'D']);
  assert.deepEqual(verschiebe(a, 3, 4), ['A', 'B', 'C', 'D']);
  assert.deepEqual(a, ['A', 'B', 'C', 'D']);
});

test('nummeriere: Nr = Zeile 1…n, Namen getrimmt, LB als Wahrheitswert', () => {
  assert.deepEqual(nummeriere([{ vorname: ' Elif ', name: 'Yilmaz' }, { vorname: 'Ben', name: 'Adler', lb: 1 }]),
    [{ nr: 1, name: 'Yilmaz', vorname: 'Elif', lb: false }, { nr: 2, name: 'Adler', vorname: 'Ben', lb: true }]);
});

test('ordneNeu: vertauscht nur die Listen-Nrn der aktiven Kinder; Lücken, Inaktive, Ausweis-Nr, Gruppe und sid bleiben', () => {
  // Ausweis 1–5; Nr 3 ist inaktiv und hält Zeile 3; Ausweis 5 steht in Zeile 6 (Lücke bei 5)
  const alt = [{ nr: 1, vorname: 'Ben', name: 'Adler', sid: 'a:k:1' }, { nr: 2, vorname: 'Jonas', name: 'Becker', sid: 'a:k:2', gruppe: 'A' },
    { nr: 3, vorname: 'Ida', name: 'Inaktiv', sid: 'a:k:3', inaktiv: true }, { nr: 4, vorname: 'Elif', name: 'Yilmaz', sid: 'a:k:4' },
    { nr: 5, vorname: 'Mert', name: 'Aydin', sid: 'n:x', liste: 6 }];
  const neu = ordneNeu(alt, [4, 2, 5, 1]);   // Yilmaz, Becker, Aydin, Adler
  assert.deepEqual(nachListe(neu).filter(s => !s.inaktiv).map(s => [s.nr, lnr(s)]), [[4, 1], [2, 2], [5, 4], [1, 6]]);
  assert.equal(lnr(neu.find(s => s.nr === 3)), 3);
  assert.deepEqual(neu.map(s => s.sid), ['a:k:1', 'a:k:2', 'a:k:3', 'a:k:4', 'n:x']);
  assert.equal(neu.find(s => s.nr === 2).gruppe, 'A');
  assert.equal('liste' in neu.find(s => s.nr === 2), false);   // Listen- = Ausweis-Nr: kein Feld (Bestandsform)
  assert.equal(alt[4].liste, 6);                               // Eingabe unberührt
});

test('ordneNeu Gegenfälle: unvollständige, doppelte oder fremde Folge → null (nie halb umordnen)', () => {
  const alt = [{ nr: 1, vorname: 'A', name: 'A' }, { nr: 2, vorname: 'B', name: 'B' }];
  assert.equal(ordneNeu(alt, [1]), null);
  assert.equal(ordneNeu(alt, [1, 1]), null);
  assert.equal(ordneNeu(alt, [1, 9]), null);
  assert.deepEqual(ordneNeu(alt, [2, 1]).map(s => lnr(s)), [2, 1]);
});

// ── Prüfer 20.10. (kladde/_pruefberichte/2026-10-20_scheibe_E/PRUEFER_E.md) ──
const kurz = r => r.kinder.map(k => [k.vorname, k.name, k.lb]);
test('liesEinfuegen 🔴 1: „Nachname, Vorname“ neben Nr- oder LB-Spalte wird getrennt, ohne Komma im Namen', () => {
  assert.deepEqual(kurz(liesEinfuegen('1\tYilmaz, Elif\n2\tBecker, Jonas')), [['Elif', 'Yilmaz', false], ['Jonas', 'Becker', false]]);
  assert.deepEqual(kurz(liesEinfuegen('Yilmaz, Elif\tLB')), [['Elif', 'Yilmaz', true]]);
  assert.deepEqual(kurz(liesEinfuegen('1\tYilmaz,\tElif')), [['Elif', 'Yilmaz', false]]);
  assert.deepEqual(liesEinfuegen('1\tYilmaz, Elif').hinweise, []);
});

test('liesEinfuegen 🟡 6: Nr vorn ohne Tab, Kopfzeile „Vorname“ tauscht die Spalten', () => {
  const r = liesEinfuegen('1. Anna Müller\n2. Ben Adler');
  assert.deepEqual(kurz(r), [['Anna', 'Müller', false], ['Ben', 'Adler', false]]);
  assert.equal(r.mitNr, true);
  assert.deepEqual(kurz(liesEinfuegen('1. Müller, Anna')), [['Anna', 'Müller', false]]);
  assert.deepEqual(kurz(liesEinfuegen('Vorname\tNachname\nElif\tYilmaz\nBen\tAdler')), [['Elif', 'Yilmaz', false], ['Ben', 'Adler', false]]);
  assert.deepEqual(kurz(liesEinfuegen('Nr\tVorname\tName\tLB\n1\tElif\tYilmaz\n2\tBen\tAdler\tLB')), [['Elif', 'Yilmaz', false], ['Ben', 'Adler', true]]);
  assert.deepEqual(kurz(liesEinfuegen('Name\tVorname\nYilmaz\tElif')), [['Elif', 'Yilmaz', false]]);   // Kopf in Parser-Reihenfolge: nichts getauscht
});

test('liesEinfuegen 🟡 11: LB beim geteilten Namen bleibt; gemischte Liste ohne Nr-Spalte hat keine Lücken', () => {
  assert.deepEqual(kurz(liesEinfuegen('Elif Yilmaz\tLB')), [['Elif', 'Yilmaz', true]]);
  const r = liesEinfuegen('3\tAdler\tBen\nBecker Jonas');
  assert.equal(r.mitNr, false);
  assert.equal(r.luecken, false);
});

test('teileName 🟡 11/🟢 3: Partikel groß geschrieben und „zum“', () => {
  assert.deepEqual(teileName('Lena Van Dyk'), { vorname: 'Lena', name: 'Van Dyk' });
  assert.deepEqual(teileName('Kevin De Bruyne'), { vorname: 'Kevin', name: 'De Bruyne' });
  assert.deepEqual(teileName('Anna zum Felde'), { vorname: 'Anna', name: 'zum Felde' });
});

test('doppelte 🟡 10: gleiche Schreibform zählt, verschiedene nicht', () => {
  assert.deepEqual(doppelte([{ vorname: 'Elif', name: 'Yilmaz' }, { vorname: 'elif', name: 'YILMAZ' }, { vorname: 'Ben', name: 'Adler' }]), ['Elif Yilmaz']);
  assert.deepEqual(doppelte([{ vorname: 'Elif', name: 'Yilmaz' }, { vorname: 'Ela', name: 'Yilmaz' }]), []);
});

test('ordneNeu 🟡 11: zwölf Kinder — Nrn numerisch, nicht als Text sortiert; ein aktives Kind ohne Listen-Nr bleibt draußen', () => {
  const alt = Array.from({ length: 12 }, (_, i) => ({ nr: i + 1, vorname: 'K' + (i + 1), name: 'X' }));
  const folge = alt.map(s => s.nr).reverse();
  const neu = ordneNeu(alt, folge);
  assert.deepEqual(folge.map(nr => lnr(neu.find(s => s.nr === nr))), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const mitNull = [{ nr: 1, vorname: 'A', name: 'A' }, { nr: 2, vorname: 'B', name: 'B', liste: null }, { nr: 3, vorname: 'C', name: 'C' }];
  assert.deepEqual(ordneNeu(mitNull, [3, 1]).map(s => lnr(s)), [3, null, 1]);
});
