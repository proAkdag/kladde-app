// kladde/test/container_v2 · KLD1 v2 (Key-Wrapping) — P1.2-Kern (Auflagen 1/4 des Qualitätsprüfers)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeContainer, encodeContainerV2, decodeContainer, decodeContainerAuto,
  wechslePassphrase, neueV2Identitaet, leseHeader,
} from '../logic/container.mjs';

const daten = { schema: 'kladde/v1', stamm: { rev: 3, kurse: [{ id: 'k' }] }, events: [{ id: 'e1', typ: '+' }], umlaut: 'Prüfung äöü' };

test('v2-Roundtrip: neueV2Identitaet → encode → decodeAuto', async () => {
  const { dek, kopf } = await neueV2Identitaet('Mathe-Kladde-2026!');
  const blob = await encodeContainerV2(daten, dek, kopf);
  assert.equal(blob[4], 2, 'Format-Version 2');
  const r = await decodeContainerAuto(blob, 'Mathe-Kladde-2026!');
  assert.equal(r.version, 2);
  assert.equal(JSON.stringify(r.daten), JSON.stringify(daten));
  assert.ok(r.dek, 'DEK kommt mit');
  assert.ok(r.kopf, 'Kopf kommt mit');
});

test('DEK ist non-extractable (kein Rohschlüssel-Export möglich)', async () => {
  const { dek } = await neueV2Identitaet('pw-1234567890');
  assert.equal(dek.extractable, false);
  await assert.rejects(() => crypto.subtle.exportKey('raw', dek));
});

test('v1-Container wird weiter gelesen (decodeAuto → version 1)', async () => {
  const v1 = await encodeContainer(daten, 'alte-pin-260708');
  const r = await decodeContainerAuto(v1, 'alte-pin-260708');
  assert.equal(r.version, 1);
  assert.equal(r.dek, null);
  assert.equal(JSON.stringify(r.daten), JSON.stringify(daten));
});

test('falsche Passphrase v2 → Fehler', async () => {
  const { dek, kopf } = await neueV2Identitaet('richtig-123456');
  const blob = await encodeContainerV2(daten, dek, kopf);
  await assert.rejects(() => decodeContainerAuto(blob, 'falsch-123456'));
});

test('manipulierter wrapped_DEK → Fehler', async () => {
  const { dek, kopf } = await neueV2Identitaet('pw-1234567890');
  const blob = await encodeContainerV2(daten, dek, kopf);
  const kaputt = Uint8Array.from(blob);
  kaputt[40] ^= 0xff; // im wrapped_DEK-Bereich (38–85)
  await assert.rejects(() => decodeContainerAuto(kaputt, 'pw-1234567890'));
});

test('manipulierter Daten-Ciphertext → Fehler', async () => {
  const { dek, kopf } = await neueV2Identitaet('pw-1234567890');
  const blob = await encodeContainerV2(daten, dek, kopf);
  const kaputt = Uint8Array.from(blob);
  kaputt[kaputt.length - 3] ^= 0xff;
  await assert.rejects(() => decodeContainerAuto(kaputt, 'pw-1234567890'));
});

test('Version 3 → klare "App aktualisieren"-Meldung (Import-Guard)', async () => {
  const { dek, kopf } = await neueV2Identitaet('pw-1234567890');
  const blob = await encodeContainerV2(daten, dek, kopf);
  const zukunft = Uint8Array.from(blob);
  zukunft[4] = 3;
  assert.throws(() => leseHeader(zukunft), /App aktualisieren/);
});

test('Passphrase-Wechsel v2: Daten-Segment byte-identisch, alte Passphrase tot, neue lebt', async () => {
  const { dek, kopf } = await neueV2Identitaet('alte-Passphrase-12');
  const blob = await encodeContainerV2(daten, dek, kopf);
  const g = await wechslePassphrase(blob, 'alte-Passphrase-12', 'neue-Passphrase-34');
  // Daten-Segment (ab Byte 86: IV_data + CT) unangetastet → Millisekunden-Wechsel bewiesen
  assert.equal(Buffer.compare(Buffer.from(blob.slice(86)), Buffer.from(g.bytes.slice(86))), 0);
  // Kopf neu gebunden
  assert.notEqual(Buffer.compare(Buffer.from(blob.slice(10, 86)), Buffer.from(g.bytes.slice(10, 86))), 0);
  await assert.rejects(() => decodeContainerAuto(g.bytes, 'alte-Passphrase-12'));
  const r = await decodeContainerAuto(g.bytes, 'neue-Passphrase-34');
  assert.equal(JSON.stringify(r.daten), JSON.stringify(daten));
});

test('Passphrase-Wechsel auf v1-Container: migriert zu v2, Daten erhalten', async () => {
  const v1 = await encodeContainer(daten, 'alte-pin-260708');
  const g = await wechslePassphrase(v1, 'alte-pin-260708', 'neue-Passphrase-34');
  assert.equal(g.bytes[4], 2);
  const r = await decodeContainerAuto(g.bytes, 'neue-Passphrase-34');
  assert.equal(r.version, 2);
  assert.equal(JSON.stringify(r.daten), JSON.stringify(daten));
});

test('Wechsel mit falscher alter Passphrase → Fehler, Original unangetastet', async () => {
  const { dek, kopf } = await neueV2Identitaet('alte-Passphrase-12');
  const blob = await encodeContainerV2(daten, dek, kopf);
  await assert.rejects(() => wechslePassphrase(blob, 'voellig-falsch-99', 'neue-Passphrase-34'), /Alte Passphrase falsch/);
  const r = await decodeContainerAuto(blob, 'alte-Passphrase-12');
  assert.equal(r.version, 2);
});

test('BENCHMARK (Auflage 4): 100 v2-Saves < 1 s Kryptozeit — KDF nur beim Unlock', async () => {
  // realistischer Vault: ~2000 Events
  const gross = {
    schema: 'kladde/v1',
    stamm: { rev: 42, kurse: [{ id: 'k1' }, { id: 'k2' }], schueler: {}, sitzplaene: {} },
    events: Array.from({ length: 2000 }, (_, i) => ({
      id: 'ev-' + i, typ: ['+', 'o', '-', 'mat', 'versp'][i % 5], schuelerNr: (i % 28) + 1,
      kursId: 'k1', datum: '2026-09-' + String((i % 28) + 1).padStart(2, '0'),
      ts: '2026-09-01T08:00:00.000Z', geraet: 'test',
    })),
  };
  const { dek, kopf } = await neueV2Identitaet('Benchmark-Pass-12');
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) await encodeContainerV2(gross, dek, kopf);
  const dauer = performance.now() - t0;
  console.log(`    → 100 Saves (2000 Events) in ${Math.round(dauer)} ms (${(dauer / 100).toFixed(2)} ms/Save)`);
  assert.ok(dauer < 1000, `100 Saves brauchten ${Math.round(dauer)} ms (Soll < 1000 ms)`);
});

// Review 19.10. §9: Die Iterationszahl kam ungeprüft aus dem fremden Kopf — eine präparierte Datei konnte das Gerät beliebig lange
// rechnen lassen (repro 2026-10-19: 2³²−1 und 0 angenommen). Grenzen 100 000 … 2 000 000; jede veröffentlichte Version schrieb 600 000.
test('leseHeader: Iterationen außerhalb 100 000 … 2 000 000 werden abgelehnt, Grenzwerte gehen', async () => {
  const { dek, kopf } = await neueV2Identitaet('Mathe-Kladde-2026!');
  const blob = await encodeContainerV2(daten, dek, kopf);
  const mit = n => { const b = blob.slice(); new DataView(b.buffer).setUint32(6, n, true); return b; };
  assert.equal(leseHeader(blob).iterationen, 600000);
  for (const n of [100000, 2000000]) assert.equal(leseHeader(mit(n)).iterationen, n);
  for (const n of [0, 1, 99999, 2000001, 0xFFFFFFFF]) assert.throws(() => leseHeader(mit(n)), /Schlüsselaufwand/, 'Iterationen ' + n);
  await assert.rejects(decodeContainerAuto(mit(0xFFFFFFFF), 'Mathe-Kladde-2026!'), /Schlüsselaufwand/);   // vor jeder Ableitung
});
