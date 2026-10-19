// kladde/test/kursStatus · Kurskarten-Badge-Logik (P4.2)
import test from 'node:test';
import assert from 'node:assert/strict';
import { kursStatus } from '../logic/kursStatus.mjs';

const kAktiv = { id: 'k', status: 'aktiv' };
const kArchiv = { id: 'k', status: 'archiviert' };
const ev = (typ, datum) => ({ id: typ + datum, typ, datum });

test('archiviert schlägt alles', () => {
  const s = kursStatus(kArchiv, { events: [ev('fehlt_o', '2026-09-01')], jetztLaeuft: true });
  assert.equal(s.code, 'archiviert'); assert.equal(s.ton, 'archiv');
});

test('läuft gerade bleibt primär, offene Fehlzeit reist als Zähler mit', () => {
  const s = kursStatus(kAktiv, { events: [ev('fehlt_o', '2026-09-01'), ev('+', '2026-09-02')], jetztLaeuft: true });
  assert.equal(s.code, 'jetzt'); assert.equal(s.offen, 1); assert.equal(s.ton, 'jetzt');
});

test('offene Fehlzeit warnt, wenn der Kurs nicht gerade läuft', () => {
  const s = kursStatus(kAktiv, { events: [ev('fehlt_o', '2026-09-01'), ev('+', '2026-09-02')], jetztLaeuft: false });
  assert.equal(s.code, 'offen'); assert.equal(s.n, 1); assert.equal(s.ton, 'warn');
});

test('läuft gerade, wenn keine offene Fehlzeit', () => {
  assert.equal(kursStatus(kAktiv, { events: [ev('+', '2026-09-02')], jetztLaeuft: true }).code, 'jetzt');
});

test('leer, wenn keine Events', () => {
  assert.equal(kursStatus(kAktiv, { events: [] }).code, 'leer');
});

test('aktiv nennt jüngstes Datum', () => {
  const s = kursStatus(kAktiv, { events: [ev('+', '2026-09-02'), ev('o', '2026-09-10'), ev('-', '2026-09-05')] });
  assert.equal(s.code, 'aktiv'); assert.equal(s.letzterDatum, '2026-09-10');
});
