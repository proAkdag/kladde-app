// kladde/test/container_nonce · Nonce-Frische (Prüfung 28.10. B3): AES-GCM bricht, sobald unter einem Schlüssel eine IV zweimal läuft.
// Mutant M4 (IV_data = IV_wrap bei jedem Speichern) bestand alle übrigen Krypto-Tests. Diese Datei wird rot, wenn eine IV
// wiederverwendet, fest verdrahtet oder aus dem Kopf übernommen wird: beim Speichern (DEK), beim Einwickeln (KEK) und in der Bio-Hülle.
// Gegenfall-Lauf: kladde/_proben/b3_nonce_gegenfall.mjs (Mutanten aus den echten Modulen, jeder muss hier rot werden).
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeContainerV2, neueV2Identitaet, wechslePassphrase } from '../logic/container.mjs';
import { bioWrap } from '../logic/biometrie.mjs';

const ITER = 100000;   // Untergrenze der Lesegrenzen (container.mjs) — schnell, Verfahren unverändert
const IV_WRAP = [26, 38], SALT = [10, 26], IV_DATA = [86, 98];
const hex = (b, [a, z]) => Buffer.from(b.slice(a, z)).toString('hex');
const NULL_IV = '0'.repeat(24);
const daten = { schema: 'kladde/v2', stamm: { rev: 1 }, events: [{ id: 'e1', typ: '+' }] };

test('Speichern: jede IV_data ist frisch, nie IV_wrap, nie Null', async () => {
  const { dek, kopf } = await neueV2Identitaet('nonce-probe-1234', ITER);
  const gesehen = new Set();
  for (let i = 0; i < 64; i++) {
    const blob = await encodeContainerV2(daten, dek, kopf);   // gleicher Klartext, gleicher Kopf: nur die IV darf sich ändern
    const iv = hex(blob, IV_DATA);
    assert.notEqual(iv, NULL_IV, 'IV_data ist Null');
    assert.notEqual(iv, hex(blob, IV_WRAP), 'IV_data = IV_wrap (Mutant M4)');
    assert.ok(!gesehen.has(iv), 'IV_data wiederverwendet nach ' + i + ' Speichern');
    gesehen.add(iv);
  }
});

test('Neue Identität: Salt und IV_wrap je Passphrasen-Setzung frisch', async () => {
  const a = await neueV2Identitaet('gleiche-passphrase-12', ITER);
  const b = await neueV2Identitaet('gleiche-passphrase-12', ITER);
  const ba = await encodeContainerV2(daten, a.dek, a.kopf), bb = await encodeContainerV2(daten, b.dek, b.kopf);
  assert.notEqual(hex(ba, SALT), hex(bb, SALT), 'Salt fest');
  assert.notEqual(hex(ba, IV_WRAP), hex(bb, IV_WRAP), 'IV_wrap fest');
  assert.notEqual(hex(ba, IV_WRAP), NULL_IV, 'IV_wrap ist Null');
});

test('Passphrase-Wechsel: Salt und IV_wrap einzeln neu', async () => {
  const { dek, kopf } = await neueV2Identitaet('alte-passphrase-12', ITER);
  const vorher = await encodeContainerV2(daten, dek, kopf);
  const g = await wechslePassphrase(vorher, 'alte-passphrase-12', 'neue-passphrase-34', ITER);
  assert.notEqual(hex(g.bytes, SALT), hex(vorher, SALT), 'Salt beim Wechsel behalten');
  assert.notEqual(hex(g.bytes, IV_WRAP), hex(vorher, IV_WRAP), 'IV_wrap beim Wechsel behalten');
  assert.notEqual(hex(g.bytes, IV_WRAP), NULL_IV, 'IV_wrap ist Null');
});

test('Fingerabdruck-Hülle: IV und Salt je Einwicklung frisch', async () => {
  const dek = crypto.getRandomValues(new Uint8Array(32)), prf = crypto.getRandomValues(new Uint8Array(32));
  const p1 = await bioWrap(dek, prf), p2 = await bioWrap(dek, prf);   // gleicher DEK, gleicher PRF-Wert
  const h = b => Buffer.from(b).toString('hex');
  assert.notEqual(h(p1.iv), h(p2.iv), 'Bio-IV wiederverwendet');
  assert.notEqual(h(p1.iv), NULL_IV, 'Bio-IV ist Null');
  assert.notEqual(h(p1.salt), h(p2.salt), 'HKDF-Salt fest');
});
