// kladde/test/migration · P2.1 (Auflage 8: Schema-Bump MIT Phase 2, Guard beidseitig)
import test from 'node:test';
import assert from 'node:assert/strict';
import { migriereStamm, schemaBekannt, schuljahrLabelAusDatum, standardZeitraeume, findeOderSchaetzeSchuljahr } from '../logic/migration.mjs';

function v1Vault() {
  return {
    schema: 'kladde/v1',
    stamm: {
      rev: 7, ts: '2026-07-01T10:00Z', geraet: 'pc',
      kurse: [{ id: '7b-mathe', name: '7b', fach: 'Mathematik', profil: 'sek1', slot: 'm1' }],
      schueler: { '7b-mathe': [{ nr: 1, name: 'S01', vorname: 'Pseudo', lb: false }] },
      sitzplaene: {}, kursprofile: {}, stundenplanSlots: [{ wochentag: 1, von: '08:00', bis: '09:07', kursId: '7b-mathe' }],
      einstellungen: { slot: 'm1' },
    },
    events: [{ id: 'e1', typ: '+', schuelerNr: 1 }],
  };
}

test('v1→v2: ergänzt zeitmodelle/wochenplan/ausnahmeSlots + Schema-String', () => {
  const v = v1Vault();
  const geaendert = migriereStamm(v);
  assert.equal(geaendert, true);
  assert.equal(v.schema, 'kladde/v2');
  assert.deepEqual(v.stamm.zeitmodelle, []);
  assert.deepEqual(v.stamm.wochenplan, []);
  assert.deepEqual(v.stamm.ausnahmeSlots, []);
});

test('idempotent: zweiter Lauf ändert nichts', () => {
  const v = v1Vault();
  migriereStamm(v);
  const snapshot = JSON.stringify(v);
  const geaendert2 = migriereStamm(v);
  assert.equal(geaendert2, false);
  assert.equal(JSON.stringify(v), snapshot);
});

test('Bestandsdaten bleiben unangetastet (rev, Kurse, Alt-Slots, Events)', () => {
  const v = v1Vault();
  migriereStamm(v);
  assert.equal(v.stamm.rev, 7);                       // kein künstlicher rev-Bump
  assert.equal(v.stamm.kurse[0].name, '7b');
  assert.equal(v.stamm.stundenplanSlots.length, 1);   // Alt-Slots = Expertenmodus-Fallback
  assert.equal(v.events.length, 1);
});

test('gefüllte v2-Felder werden nie überschrieben', () => {
  const v = v1Vault();
  v.stamm.zeitmodelle = [{ id: 'zm1' }];
  v.stamm.wochenplan = [{ wochentag: 1, blockNr: 1, kursId: '7b-mathe' }];
  migriereStamm(v);
  assert.equal(v.stamm.zeitmodelle.length, 1);
  assert.equal(v.stamm.wochenplan.length, 1);
});

test('Schema-Guard: v1/v2/fehlend bekannt, v3 abgelehnt', () => {
  assert.equal(schemaBekannt('kladde/v1'), true);
  assert.equal(schemaBekannt('kladde/v2'), true);
  assert.equal(schemaBekannt(undefined), true);
  assert.equal(schemaBekannt('kladde/v3'), false);
});

// ── P3.1 Schuljahr-Migration ──
test('Schuljahr-Label aus Datum (Aug–Jul-Grenze)', () => {
  assert.equal(schuljahrLabelAusDatum(new Date(2026, 7, 20)), '2026/27'); // August
  assert.equal(schuljahrLabelAusDatum(new Date(2026, 6, 30)), '2025/26'); // Juli → Vorjahr
  assert.equal(schuljahrLabelAusDatum(new Date(2027, 0, 15)), '2026/27'); // Januar
});

test('migriereStamm legt aktives Schuljahr + Zeiträume an; Kurse erhalten schuljahrId/status', () => {
  const v = v1Vault();
  migriereStamm(v, new Date(2026, 8, 1)); // 01.09.2026 → 2026/27
  assert.equal(v.stamm.aktivesSchuljahrId, '2026-27');
  assert.equal(v.stamm.schuljahre.length, 1);
  assert.equal(v.stamm.schuljahre[0].status, 'aktiv');
  assert.equal(v.stamm.schuljahre[0].zeitraeume.length, 6); // Q1/Q2/HJ1/Q3/Q4/HJ2
  assert.equal(v.stamm.kurse[0].schuljahrId, '2026-27');
  assert.equal(v.stamm.kurse[0].status, 'aktiv');
});

test('Schuljahr aus vorhandenem Kurs-Feld bevorzugt (nicht geschätzt)', () => {
  const v = v1Vault();
  v.stamm.kurse[0].schuljahr = '2025/26';
  migriereStamm(v, new Date(2026, 8, 1));
  assert.equal(v.stamm.aktivesSchuljahrId, '2025-26');
  assert.equal(findeOderSchaetzeSchuljahr(v.stamm.kurse, new Date(2026, 8, 1)), '2025/26');
});

test('Standard-Zeiträume: Q1 ab Aug, HJ1 endet Ende Jan', () => {
  const z = standardZeitraeume('2026/27');
  assert.equal(z.find(x => x.id === 'q1').von, '2026-08-01');
  assert.equal(z.find(x => x.id === 'hj1').bis, '2027-01-31');
  assert.equal(z.find(x => x.id === 'q4').bis, '2027-07-31');
});

test('Schuljahr-Migration idempotent (zweiter Lauf ändert nichts)', () => {
  const v = v1Vault();
  migriereStamm(v, new Date(2026, 8, 1));
  const snap = JSON.stringify(v);
  assert.equal(migriereStamm(v, new Date(2027, 0, 1)), false);
  assert.equal(JSON.stringify(v), snap);
});
