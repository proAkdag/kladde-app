// kladde/test/erfassListe · Liste statt Sitzplan am Handy — Reihenfolge und eindeutige Kurzbeschriftung (Zero 2026-10-01)
import test from 'node:test';
import assert from 'node:assert/strict';
import { listenEintraege } from '../logic/erfassListe.mjs';

const KLASSE = [
  { nr: 1, vorname: 'Nora', nachname: 'Arslan' },
  { nr: 2, vorname: 'Lena', nachname: 'Müller' },
  { nr: 3, vorname: 'Ömer', nachname: 'Hoffmann' },
  { nr: 4, vorname: 'Lena', nachname: 'Meyer' },
  { nr: 5, vorname: 'Ada', nachname: 'Vogt' },
  { nr: 6, vorname: 'Milan', nachname: 'Jäger' },
];
const beschriftung = e => e.vorname + ' ' + e.kurz;

test('nach Nachname: Reihenfolge der Klassenliste (Umlaut wie Grundbuchstabe)', () => {
  assert.deepEqual(listenEintraege(KLASSE, 'nachname').map(e => e.nr), [1, 3, 6, 4, 2, 5]);
});

test('nach Vorname: Ada vor Lena vor Milan vor Nora vor Ömer, gleiche Vornamen nach Nachname', () => {
  assert.deepEqual(listenEintraege(KLASSE, 'vorname').map(e => e.nr), [5, 4, 2, 6, 1, 3]);
});

test('Vorname + Initial; bei Gleichstand so viele Buchstaben, bis eindeutig', () => {
  const b = Object.fromEntries(listenEintraege(KLASSE).map(e => [e.nr, beschriftung(e)]));
  assert.equal(b[1], 'Nora A.');
  assert.equal(b[2], 'Lena Mü.');
  assert.equal(b[4], 'Lena Me.');
});

test('keine zwei Zeilen gleich beschriftet — auch nicht bei völlig gleichem Namen', () => {
  const doppelt = [...KLASSE, { nr: 7, vorname: 'Lena', nachname: 'Müller' }, { nr: 8, vorname: 'lena', nachname: 'Mueller' }];
  const texte = listenEintraege(doppelt).map(beschriftung);
  assert.equal(new Set(texte).size, texte.length, texte.join(' | '));
  assert.ok(texte.includes('Lena Müller (2)') && texte.includes('Lena Müller (7)'), texte.join(' | '));
});

test('Zwei Nummern: bei völlig gleichem Namen steht die Listen-Nr dran und entscheidet die Reihenfolge; der Schlüssel bleibt die Ausweis-Nr', () => {
  const zwei = [{ nr: 7, liste: 2, vorname: 'Lena', nachname: 'Müller' }, { nr: 2, liste: 9, vorname: 'Lena', nachname: 'Müller' }];
  assert.deepEqual(listenEintraege(zwei).map(e => [e.nr, beschriftung(e)]), [[7, 'Lena Müller (2)'], [2, 'Lena Müller (9)']]);
});

test('Grenzfall: leerer Nachname, einzelner Schüler, leere Liste', () => {
  assert.deepEqual(listenEintraege([{ nr: 1, vorname: 'Kim', nachname: '' }]), [{ nr: 1, vorname: 'Kim', kurz: '' }]);
  assert.deepEqual(listenEintraege([]), []);
});
