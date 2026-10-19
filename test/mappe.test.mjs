// kladde/test/mappe · Paritaet Browser-Mappenleser ↔ PC-Bruecke (import_klassenliste.py).
//
// Warum: seit 2026-08-30 kann eine Kursmappe DIREKT in die Kladde gezogen werden. Damit gibt es
// zwei Leser fuer dieselbe Datei — Python am PC, JS im Browser. Zwei Leser sind zwei Wahrheiten,
// sobald sie auseinanderlaufen. Dieser Test bindet sie: die Fixtures stammen aus Python
// (test/_fixtures_mappe.py, dort ist die Wahrheit), geprueft wird die JS-Deutung.
//
// Neu erzeugen nach jeder Aenderung an kladde_lib.py / import_klassenliste.py:
//   python test/_fixtures_mappe.py
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deuteZellen, pruefeKursDatei, MAX_SCHUELER, LISTE_DATEN_START, KOPF, BLATT_LISTE } from '../logic/mappe.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(readFileSync(join(HIER, 'fixtures_mappe.json'), 'utf-8'));
const alsMap = (o) => new Map(Object.entries(o));

test('Paritaet zu import_klassenliste.py ueber alle Faelle', () => {
  const faelle = Object.keys(FIXTURES);
  assert.ok(faelle.length >= 5, 'Fixtures fehlen — python test/_fixtures_mappe.py laufen lassen');
  for (const name of faelle) {
    const { zellen, erwartet } = FIXTURES[name];
    const ist = deuteZellen(alsMap(zellen));
    assert.deepEqual(ist, erwartet, 'Fall ' + name + ': JS weicht von der Python-Bruecke ab');
  }
});

test('Nr bleibt an die Mappenzeile gebunden — Luecken ruecken NICHT nach', () => {
  // Der Join-Schluessel zur Excel-Zeile (MAPPING.md §1). Ruecken die Nrn nach, landen
  // Bewertungen spaeter in fremden Zeilen — der teuerste denkbare stille Fehler.
  const { zellen } = FIXTURES.luecke;
  const ist = deuteZellen(alsMap(zellen));
  assert.deepEqual(ist.schueler.map((s) => s.nr), [1, 3, 5]);
  assert.equal(ist.schueler[1].nr, 3, 'zweiter Eintrag muss Nr 3 behalten, nicht auf 2 rutschen');
});

test('D5 schaltet das Profil: LB → sek1 · Notiz → sek2 · sonst Warnung', () => {
  assert.equal(deuteZellen(alsMap(FIXTURES.sek1_mit_lb.zellen)).kurs.profil, 'sek1');
  assert.equal(deuteZellen(alsMap(FIXTURES.sek2.zellen)).kurs.profil, 'sek2');
  const alt = deuteZellen(alsMap(FIXTURES.altliste.zellen));
  assert.equal(alt.warnungen.length, 1);
  assert.match(alt.warnungen[0], /weder 'LB' noch 'Notiz'/);
  // GEGENRICHTUNG: die sauberen Faelle duerfen NICHT warnen (sonst warnt der Leser immer)
  assert.equal(deuteZellen(alsMap(FIXTURES.sek1_mit_lb.zellen)).warnungen.length, 0);
  assert.equal(deuteZellen(alsMap(FIXTURES.sek2.zellen)).warnungen.length, 0);
});

test('LB nur bei sek1 — in der Oberstufe traegt D eine Notiz, kein Merkmal', () => {
  const s1 = deuteZellen(alsMap(FIXTURES.sek1_mit_lb.zellen));
  assert.equal(s1.schueler.filter((s) => s.lb).length, 1, 'genau ein LB-Kind erwartet');
  // ROTER GEGENFALL: dieselbe Liste als Oberstufe gedeutet darf KEIN LB tragen,
  // auch wenn in Spalte D etwas steht — sonst wandert eine Notiz als Merkmal in die Mappe.
  const alsSek2 = alsMap(FIXTURES.sek1_mit_lb.zellen);
  alsSek2.set('D5', 'Notiz');
  assert.equal(deuteZellen(alsSek2).schueler.filter((s) => s.lb).length, 0);
});

test('leere Vorlage meldet sich, statt einen leeren Kurs still anzulegen', () => {
  const leer = deuteZellen(alsMap(FIXTURES.leer.zellen));
  assert.equal(leer.schueler.length, 0);
  assert.match(leer.warnungen.join(' '), /Keine Schüler/);
});

test('Kurs-Id wird aus Klasse+Fach+Schuljahr geschlagen und ist stabil', () => {
  const a = deuteZellen(alsMap(FIXTURES.sek1_mit_lb.zellen));
  const b = deuteZellen(alsMap(FIXTURES.sek1_mit_lb.zellen));
  assert.equal(a.kurs.id, b.kurs.id, 'gleiche Mappe muss dieselbe Id ergeben (sonst Kurs-Dubletten)');
  assert.match(a.kurs.id, /^[a-z0-9-]+$/, 'Id muss slug-rein sein');
});

test('Dateiname springt nur ein, wenn die Kopfzelle leer ist', () => {
  const ohneKlasse = alsMap(FIXTURES.sek1_mit_lb.zellen);
  ohneKlasse.delete(KOPF.klasse);
  assert.equal(deuteZellen(ohneKlasse, 'Klasse_7b.xlsx').kurs.name, 'Klasse_7b');
  // GEGENRICHTUNG: steht E2, gewinnt E2 — nie der Dateiname
  assert.equal(deuteZellen(alsMap(FIXTURES.sek1_mit_lb.zellen), 'Ganz_Anders.xlsx').kurs.name, '7b');
});

test('Konstanten stimmen mit kladde_lib.py ueberein (Drift-Wache)', () => {
  assert.equal(MAX_SCHUELER, 35);
  assert.equal(LISTE_DATEN_START, 6);
  assert.equal(BLATT_LISTE, 'Klassenliste');
  assert.deepEqual(KOPF, { schuljahr: 'C2', klasse: 'E2', lehrkraft: 'H2', fach: 'J2' });
  // Zeile = Nr + 5 ist der Vertrag, an dem die Excel-Bruecke haengt
  assert.equal(1 + LISTE_DATEN_START - 1, 6);
  assert.equal(35 + LISTE_DATEN_START - 1, 40);
});

// ── kurs.json-Prüfung (Prüfer 2026-09-29): was das PC-Werkzeug liefert, geht glatt durch; was Zuordnungen
//    verfälscht, wird abgewiesen; der Rest wird geglättet und gemeldet.
test('pruefeKursDatei: jede Ausgabe von import_klassenliste.py geht unverändert durch', () => {
  for (const name of Object.keys(FIXTURES)) {
    const { erwartet } = FIXTURES[name];
    const p = pruefeKursDatei(erwartet);
    assert.deepEqual(p.schueler, erwartet.schueler, name);
    assert.deepEqual({ ...p.kurs, slot: undefined }, { ...erwartet.kurs, slot: undefined }, name);
    assert.equal(p.kurs.slot, 'm1', name);
    assert.deepEqual(p.warnungen, erwartet.warnungen, name);
  }
});

const basis = () => ({ schema: 'kladde/v1', kurs: { id: '7b-mathe-2026-27', name: '7b', fach: 'Mathe', schuljahr: '2026/27', lehrkraft: 'Z', profil: 'sek1' },
  schueler: [{ nr: 1, name: 'A', vorname: 'a', lb: false }, { nr: 2, name: 'B', vorname: 'b', lb: true }] });

test('pruefeKursDatei weist ab, was Einträge falsch zuordnen würde', () => {
  const mit = f => { const o = basis(); f(o); return () => pruefeKursDatei(o); };
  assert.throws(mit(o => { o.schueler[1].nr = 1; }), /doppelt/);
  assert.throws(mit(o => { o.schueler[1].nr = '1'; }), /doppelt/);          // "1" und 1 sind dieselbe Nr
  assert.throws(mit(o => { o.schueler[1].nr = 0; }), /ungültig/);
  assert.throws(mit(o => { o.schueler[1].nr = 36; }), /ohne Listen-Nr/);    // Ausweis-Nr über 35 nur mit Listen-Nr
  assert.throws(mit(o => { o.schueler[1].nr = 'x'; }), /ungültig/);
  // Listen-Nr (zwei Nummern): 1–35, eindeutig über die WIRKSAME Nr (fehlt `liste`, gilt die Ausweis-Nr)
  assert.throws(mit(o => { o.schueler[1].liste = 36; }), /Listen-Nr '36'/);
  assert.throws(mit(o => { o.schueler[1].liste = 0; }), /Listen-Nr '0'/);
  assert.throws(mit(o => { o.schueler[1].liste = 'x'; }), /Listen-Nr 'x'/);
  assert.throws(mit(o => { o.schueler[1].liste = 1; }), /Listen-Nr 1 doppelt/);                    // Nr 1 hält Zeile 1 ohne Feld
  assert.throws(mit(o => { o.schueler.push({ nr: 40, liste: 2, name: 'C', vorname: 'c' }); }), /Listen-Nr 2 doppelt/);
  assert.doesNotThrow(mit(o => { o.schueler.push({ nr: 40, liste: 3, name: 'C', vorname: 'c' }, { nr: 41, liste: null, name: 'D', vorname: 'd', inaktiv: true }); }));
  assert.throws(mit(o => { o.schueler[1].liste = null; }), /ohne Listen-Nr/);   // keine Zeile gibt es nur für Abgänge (MAPPING §2a, Prüfer G3)
  assert.throws(mit(o => { delete o.kurs.id; }), /id/);
  assert.throws(mit(o => { o.kurs.id = 'Kurs 7b'; }), /id/);
  assert.throws(mit(o => { o.kurs.name = ' '; }), /Kursname/);
  assert.throws(mit(o => { o.schueler = {}; }), /Schülerliste/);
  assert.throws(mit(o => { o.schema = 'kladde/v2'; }), /kladde\/v1/);
  assert.doesNotThrow(mit(() => {}));
});

test('pruefeKursDatei glättet und meldet den Rest', () => {
  const o = basis();
  Object.assign(o.kurs, { status: 'archiviert', farbHue: 40, profil: 'sek3', slot: 'm9', notenmodus: 'drittel' });
  o.schueler.push({ nr: 3, name: '  ', vorname: '' }, { nr: 4, name: ' Cem ', vorname: 'c', lb: 'LB', gruppe: 'A', extra: 1 });
  const p = pruefeKursDatei(o);
  assert.deepEqual(Object.keys(p.kurs).sort(), ['fach', 'id', 'lehrkraft', 'name', 'profil', 'schuljahr', 'slot']);   // Status/Farbe/Notenmodus nicht übernommen
  assert.equal(p.kurs.profil, 'sek1');
  assert.equal(p.kurs.slot, 'm1');
  assert.deepEqual(p.schueler.map(s => s.nr), [1, 2, 4]);                  // Nr 3 ohne Namen übersprungen
  assert.deepEqual(p.schueler[2], { nr: 4, name: 'Cem', vorname: 'c', lb: false, gruppe: 'A' });
  assert.equal(p.warnungen.length, 4);                                     // Profil, Slot, Nr 3 ohne Namen, Nr 4 LB-Text
  assert.ok(p.warnungen.some(w => w.includes('Nr 4') && w.includes('LB')));
  const s2 = basis(); Object.assign(s2.kurs, { profil: 'sek2', notenmodus: 'drittel', slot: 'm3' });
  assert.deepEqual([pruefeKursDatei(s2).kurs.notenmodus, pruefeKursDatei(s2).kurs.slot], ['drittel', 'm3']);
});

test('pruefeKursDatei: Listen-Nr übersteht den Weg, gleich der Ausweis-Nr fällt das Feld weg', () => {
  const o = basis();
  o.schueler = [{ nr: 1, liste: 2, name: 'A', vorname: 'a' }, { nr: 2, liste: 1, name: 'B', vorname: 'b' }, { nr: 3, liste: 3, name: 'C', vorname: 'c' },
    { nr: 9, liste: '4', name: 'D', vorname: 'd' }, { nr: 10, liste: null, name: 'E', vorname: 'e', inaktiv: true }];
  const p = pruefeKursDatei(o);
  // Soll: [Ausweis-Nr, Feld liste] — 'fehlt' heißt: kein Feld
  assert.deepEqual(p.schueler.map(s => [s.nr, 'liste' in s ? s.liste : 'fehlt']), [[1, 2], [2, 1], [3, 'fehlt'], [9, 4], [10, null]]);
  const w = basis(); w.schueler = [{ nr: 9, liste: 4, name: '', vorname: '' }, { nr: 12, liste: 5, name: 'E', vorname: 'e', lb: 'ja' }];
  assert.deepEqual(pruefeKursDatei(w).warnungen.map(t => t.slice(0, 6)), ['Nr 4 o', 'Nr 5: ']);   // Warnungen nennen die Listen-Nr (Prüfer G3)
});
