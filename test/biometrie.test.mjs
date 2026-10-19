// kladde/test/biometrie · zweite DEK-Hülle (PRF→HKDF→AES-GCM) + Container-Öffnung mit fertigem DEK
import test from 'node:test';
import assert from 'node:assert/strict';
import { bioWrap, bioUnwrap } from '../logic/biometrie.mjs';
import { neueV2Identitaet, encodeContainerV2, decodeContainerMitDek, dekRohMitPassphrase, importDekKey, leseHeader } from '../logic/container.mjs';

const secret = () => crypto.getRandomValues(new Uint8Array(32));

test('Roundtrip: wrap → unwrap liefert dieselben DEK-Rohbytes', async () => {
  const dek = crypto.getRandomValues(new Uint8Array(32)), s = secret();
  const paket = await bioWrap(dek, s);
  assert.equal(paket.wrappedDek.length, 48);
  assert.deepEqual(await bioUnwrap(paket, s), dek);
});

test('Gegenrichtung: falscher PRF-Wert oder manipuliertes Paket öffnet NICHT', async () => {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const paket = await bioWrap(dek, secret());
  await assert.rejects(bioUnwrap(paket, secret()), /passt nicht/);
  const kaputt = { ...paket, wrappedDek: Uint8Array.from(paket.wrappedDek, (b, i) => i === 5 ? b ^ 1 : b) };
  await assert.rejects(bioUnwrap(kaputt, secret()), /passt nicht/);
});

test('Ende-zu-Ende: Passphrase-Container → DEK-Rohbytes → Bio-Hülle → Öffnen ohne Passphrase', async () => {
  const id = await neueV2Identitaet('korrekte-passphrase-12', 100000);   // Untergrenze der Lesegrenzen (container.mjs, Review §9)
  const bytes = await encodeContainerV2({ schema: 'kladde/v2', stamm: { rev: 1 }, events: [{ id: 'e1' }] }, id.dek, id.kopf);
  const dekRoh = await dekRohMitPassphrase(bytes, 'korrekte-passphrase-12');   // nur beim Einrichten, mit Passphrase
  assert.equal(dekRoh.length, 32);
  const s = secret();
  const paket = await bioWrap(dekRoh, s);
  // Entsperren: PRF → unwrap → non-extractable Key → Daten OHNE Passphrase
  const dekKey = await importDekKey(await bioUnwrap(paket, s));
  const r = await decodeContainerMitDek(bytes, dekKey);
  assert.equal(r.daten.events[0].id, 'e1');
  assert.deepEqual(r.kopf.wrappedDek, leseHeader(bytes).wrappedDek);   // Kopf bleibt der Passphrasen-Kopf → Speichern funktioniert weiter
  await assert.rejects(dekRohMitPassphrase(bytes, 'falsch-falsch-falsch'), /falsche Passphrase/);
});
