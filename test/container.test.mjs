// kladde/test/container · node --test Port der Alt-Suite (P1.0, verhaltensneutral)
// WebCrypto-Roundtrip in Node (globalThis.crypto.subtle, Node ≥20)
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeContainer, encodeContainer, leseHeader } from '../logic/container.mjs';

let seq = 0;
function ev(typ, schuelerNr, datum, extra = {}) {
  return { id: 'e' + (++seq), typ, schuelerNr, datum, ts: datum + 'T08:' + String(seq).padStart(2, '0') + ':00Z', geraet: 'test', ...extra };
}

const geheim = { schema: 'kladde/v1', stamm: { rev: 1 }, events: [ev('+', 1, '2026-09-01')], umlaut: 'Prüfung äöü' };

test('Container beginnt mit KLD1', async () => {
  const blob = await encodeContainer(geheim, 'test-pin-2026');
  assert.equal(blob[0], 0x4b); assert.equal(blob[1], 0x4c);
  assert.equal(blob[2], 0x44); assert.equal(blob[3], 0x31);
});

test('Header: 600k Iterationen · Salt 16 B · IV 12 B', async () => {
  const blob = await encodeContainer(geheim, 'test-pin-2026');
  const kopf = leseHeader(blob);
  assert.equal(kopf.iterationen, 600000);
  assert.equal(kopf.salt.length, 16);
  assert.equal(kopf.iv.length, 12);
});

test('Roundtrip identisch (inkl. Umlaute)', async () => {
  const blob = await encodeContainer(geheim, 'test-pin-2026');
  const zurueck = await decodeContainer(blob, 'test-pin-2026');
  assert.equal(JSON.stringify(zurueck), JSON.stringify(geheim));
});

test('falsche PIN → Fehler', async () => {
  const blob = await encodeContainer(geheim, 'test-pin-2026');
  await assert.rejects(() => decodeContainer(blob, 'falsche-pin'));
});

test('zwei encodes ≠ (frisches Salt/IV)', async () => {
  const blob = await encodeContainer(geheim, 'test-pin-2026');
  const blob2 = await encodeContainer(geheim, 'test-pin-2026');
  assert.notEqual(Buffer.compare(Buffer.from(blob), Buffer.from(blob2)), 0);
});

test('manipulierter Ciphertext → GCM-Auth-Fehler', async () => {
  const blob = await encodeContainer(geheim, 'test-pin-2026');
  const manipuliert = Uint8Array.from(blob);
  manipuliert[manipuliert.length - 5] ^= 0xff;
  await assert.rejects(() => decodeContainer(manipuliert, 'test-pin-2026'));
});

test('fremdes Format → Magic-Fehler', () => {
  assert.throws(() => leseHeader(new TextEncoder().encode('MUELL' + 'x'.repeat(60))));
});
