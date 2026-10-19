// Kurs anlegen (Scheibe 8, Zero 05.10.): ein neuer Kurs hat überall dieselbe Form — aus „Liste einfügen“ wie aus „Mappe laden“.
// Vorher legte „Schnell“ Kurse ohne Schuljahr, Status und Noten-Eingabe an, der Mappen-Import ohne Schuljahr und Status (den Slot
// setzt pruefeKursDatei). Die Verdrahtung beider Wege prüft P30 K7 an der gespeicherten Sicherung.
// Erwartungen stehen als feste Werte im Test, nie aus der geprüften Funktion abgeleitet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuerKurs, ergaenzeNeuenKurs } from '../logic/mappe.mjs';

test('neuerKurs: Form aus „Liste einfügen“ (Sek I)', () => {
  assert.deepEqual(neuerKurs({ name: '6c', fach: 'Mathematik', schuljahr: '2026/27', profil: 'sek1' }, 'sj-2026'),
    { id: '6c-mathematik-2026-27', name: '6c', fach: 'Mathematik', schuljahr: '2026/27', lehrkraft: '', profil: 'sek1', slot: 'm1', status: 'aktiv', schuljahrId: 'sj-2026' });
});

test('neuerKurs: Oberstufe trägt die Noten-Eingabe, Sek I nie', () => {
  assert.equal(neuerKurs({ name: 'Q1', fach: 'Physik', schuljahr: '2026/27', profil: 'sek2', notenmodus: 'drittel' }, 'sj').notenmodus, 'drittel');
  assert.equal(neuerKurs({ name: 'Q1', fach: 'Physik', schuljahr: '2026/27', profil: 'sek2' }, 'sj').notenmodus, 'punkte');
  assert.equal('notenmodus' in neuerKurs({ name: '7b', fach: 'Physik', schuljahr: '2026/27', profil: 'sek1', notenmodus: 'drittel' }, 'sj'), false);
});

test('neuerKurs: ohne aktives Schuljahr kein leeres Feld', () => {
  assert.equal('schuljahrId' in neuerKurs({ name: '7b', fach: 'M', schuljahr: '', profil: 'sek1' }, undefined), false);
});

test('ergaenzeNeuenKurs: Kurs aus der Mappe behält id und Felder, bekommt Schuljahr und Status (Slot nur als Rückfall)', () => {
  const ausMappe = { id: '5b-nw-2026-27', name: '5b', fach: 'NW', schuljahr: '2026/27', lehrkraft: 'Ak', profil: 'sek1' };
  assert.deepEqual(ergaenzeNeuenKurs(ausMappe, 'sj-2026'),
    { id: '5b-nw-2026-27', name: '5b', fach: 'NW', schuljahr: '2026/27', lehrkraft: 'Ak', profil: 'sek1', slot: 'm1', status: 'aktiv', schuljahrId: 'sj-2026' });
  // Was der Kurs schon trägt, bleibt (Slot m3, archiviert, anderes Schuljahr). Reine Funktionsgarantie: über den Import nicht
  // erreichbar, pruefeKursDatei übernimmt weder status noch schuljahrId (Prüfer 05.10. G2)
  const voll = { ...ausMappe, slot: 'm3', status: 'archiviert', schuljahrId: 'sj-alt' };
  assert.deepEqual(ergaenzeNeuenKurs(voll, 'sj-2026'), voll);
  assert.equal(ergaenzeNeuenKurs({ ...ausMappe, profil: 'sek2' }, 'sj').notenmodus, 'punkte');
  assert.equal(ausMappe.slot, undefined);   // die Eingabe wird nicht verändert
});
