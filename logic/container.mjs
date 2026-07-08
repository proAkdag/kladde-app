// kladde/logic/container · verschlüsselter Einzeldatei-Container (Sync Stufe 0 + 1)
//
// Format KLD1 v1 (Legacy — wird GELESEN, nie mehr geschrieben):
//   Byte 0–3   Magic 'KLD1'
//   Byte 4     Format-Version (1)
//   Byte 5     KDF-Kennung (1 = PBKDF2-HMAC-SHA256)
//   Byte 6–9   Iterationen (u32 little-endian; Default 600 000 — OWASP 2026)
//   Byte 10–25 Salt (16 B)
//   Byte 26–37 IV (12 B)
//   Byte 38–   AES-256-GCM-Ciphertext(KEK direkt über die Daten)
//
// Format KLD1 v2 (P1.2 · Key-Wrapping — docs/container-format.md):
//   Byte 0–3   Magic 'KLD1'
//   Byte 4     Format-Version (2)
//   Byte 5     KDF-Kennung (1 = PBKDF2-HMAC-SHA256 · 2 = Argon2id RESERVIERT, nicht implementiert)
//   Byte 6–9   KDF-Iterationen (u32 LE)
//   Byte 10–25 KDF-Salt (16 B, je Passphrasen-Setzung)
//   Byte 26–37 IV_wrap (12 B, je Passphrasen-Setzung)
//   Byte 38–85 wrapped_DEK = AES-GCM(KEK, DEK-Rohbytes 32 B) → 32 + 16 B Tag
//   Byte 86–97 IV_data (12 B, bei JEDEM Speichern NEU)
//   Byte 98–   AES-256-GCM-Ciphertext(DEK, JSON(vault))
//
// Warum v2: KDF (600k Iterationen) läuft NUR bei Unlock/Passphrase-Wechsel — Speichern ist
// reines AES-GCM mit dem DEK (Millisekunden statt ~0,5–1 s pro Event-Tap auf A12).
// Passphrase-Wechsel = nur DEK neu wrappen; das Daten-Segment bleibt byte-identisch.
// DEK lebt im RAM als NON-EXTRACTABLE CryptoKey. NIE wrapKey/unwrapKey (verlangt
// extractable=true) — der Weg ist Rohbytes + encrypt/decrypt + importKey(extractable:false).
// Läuft in Browser UND Node ≥20 (globalThis.crypto.subtle).

const MAGIC = new Uint8Array([0x4b, 0x4c, 0x44, 0x31]); // 'KLD1'
const FORMAT_V1 = 1;
const FORMAT_V2 = 2;
const KDF_PBKDF2_SHA256 = 1;
const DEFAULT_ITERATIONEN = 600000;
const HEADER_V1 = 38;
const V2_OFF_SALT = 10, V2_OFF_IVWRAP = 26, V2_OFF_WDEK = 38, V2_OFF_IVDATA = 86, V2_OFF_CT = 98;
const WDEK_LAENGE = 48; // 32 B DEK + 16 B GCM-Tag

async function ableiteSchluessel(passwort, salt, iterationen) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passwort), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iterationen },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// DEK-Rohbytes als non-extractable CryptoKey importieren (RAM-Form des DEK)
function importDekKey(dekRoh) {
  return crypto.subtle.importKey('raw', dekRoh, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// Neue Passphrasen-Bindung: DEK-Rohbytes unter frischem Salt/IV_wrap wrappen.
// Liefert den wiederverwendbaren v2-Kopf (bleibt über alle Saves konstant).
async function wrapDek(dekRoh, passwort, iterationen = DEFAULT_ITERATIONEN) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ivWrap = crypto.getRandomValues(new Uint8Array(12));
  const kek = await ableiteSchluessel(passwort, salt, iterationen);
  const wrappedDek = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivWrap }, kek, dekRoh));
  return { iterationen, salt, ivWrap, wrappedDek };
}

// v2-Container schreiben: Kopf unverändert, IV_data frisch, Daten mit DEK verschlüsselt.
// KEIN KDF — das ist der schnelle Save-Pfad.
async function encodeContainerV2(obj, dekKey, kopf) {
  const ivData = crypto.getRandomValues(new Uint8Array(12));
  const klartext = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivData }, dekKey, klartext));

  const out = new Uint8Array(V2_OFF_CT + ct.length);
  out.set(MAGIC, 0);
  out[4] = FORMAT_V2;
  out[5] = KDF_PBKDF2_SHA256;
  new DataView(out.buffer).setUint32(6, kopf.iterationen, true);
  out.set(kopf.salt, V2_OFF_SALT);
  out.set(kopf.ivWrap, V2_OFF_IVWRAP);
  out.set(kopf.wrappedDek, V2_OFF_WDEK);
  out.set(ivData, V2_OFF_IVDATA);
  out.set(ct, V2_OFF_CT);
  return out;
}

// v1-Encode bleibt NUR für Fixtures/Lese-Tests — der App-Schreibpfad nutzt ihn nicht mehr.
async function encodeContainer(obj, passwort, iterationen = DEFAULT_ITERATIONEN) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const schluessel = await ableiteSchluessel(passwort, salt, iterationen);
  const klartext = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, schluessel, klartext));

  const out = new Uint8Array(HEADER_V1 + ct.length);
  out.set(MAGIC, 0);
  out[4] = FORMAT_V1;
  out[5] = KDF_PBKDF2_SHA256;
  new DataView(out.buffer).setUint32(6, iterationen, true);
  out.set(salt, 10);
  out.set(iv, 26);
  out.set(ct, HEADER_V1);
  return out;
}

function leseHeader(bytes) {
  if (bytes.length < HEADER_V1 + 16) throw new Error('Container zu kurz');
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== MAGIC[i]) throw new Error('kein Kladde-Container (Magic fehlt)');
  }
  const version = bytes[4];
  const kdf = bytes[5];
  if (version !== FORMAT_V1 && version !== FORMAT_V2) {
    throw new Error('Container-Version ' + version + ' ist neuer als diese App — bitte App aktualisieren');
  }
  if (kdf !== KDF_PBKDF2_SHA256) throw new Error('unbekannte KDF-Kennung ' + kdf);
  const iterationen = new DataView(bytes.buffer, bytes.byteOffset).getUint32(6, true);
  if (version === FORMAT_V1) {
    return {
      version, kdf, iterationen,
      salt: bytes.slice(10, 26),
      iv: bytes.slice(26, 38),
      ciphertext: bytes.slice(38),
    };
  }
  if (bytes.length < V2_OFF_CT + 16) throw new Error('Container zu kurz (v2)');
  return {
    version, kdf, iterationen,
    salt: bytes.slice(V2_OFF_SALT, V2_OFF_SALT + 16),
    ivWrap: bytes.slice(V2_OFF_IVWRAP, V2_OFF_IVWRAP + 12),
    wrappedDek: bytes.slice(V2_OFF_WDEK, V2_OFF_WDEK + WDEK_LAENGE),
    ivData: bytes.slice(V2_OFF_IVDATA, V2_OFF_IVDATA + 12),
    ciphertext: bytes.slice(V2_OFF_CT),
  };
}

// Universal-Unlock: liest v1 UND v2. Liefert { daten, version, dek, kopf } —
// dek (non-extractable CryptoKey) + kopf nur bei v2; v1-Aufrufer migrieren danach.
async function decodeContainerAuto(bytes, passwort) {
  const kopf = leseHeader(bytes);
  if (kopf.version === FORMAT_V1) {
    const schluessel = await ableiteSchluessel(passwort, kopf.salt, kopf.iterationen);
    let klartext;
    try {
      klartext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: kopf.iv }, schluessel, kopf.ciphertext);
    } catch {
      throw new Error('Entschlüsselung fehlgeschlagen — falsche PIN/Passphrase oder Container beschädigt');
    }
    return { daten: JSON.parse(new TextDecoder().decode(klartext)), version: 1, dek: null, kopf: null };
  }
  // v2: KEK → DEK entwrappen → Daten mit DEK
  const kek = await ableiteSchluessel(passwort, kopf.salt, kopf.iterationen);
  let dekRoh;
  try {
    dekRoh = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: kopf.ivWrap }, kek, kopf.wrappedDek));
  } catch {
    throw new Error('Entschlüsselung fehlgeschlagen — falsche Passphrase oder Container beschädigt');
  }
  const dek = await importDekKey(dekRoh);
  dekRoh.fill(0); // Rohbytes sofort nullen — im RAM lebt nur der non-extractable Key
  let klartext;
  try {
    klartext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: kopf.ivData }, dek, kopf.ciphertext);
  } catch {
    throw new Error('Daten-Entschlüsselung fehlgeschlagen — Container beschädigt');
  }
  return {
    daten: JSON.parse(new TextDecoder().decode(klartext)),
    version: 2,
    dek,
    kopf: { iterationen: kopf.iterationen, salt: kopf.salt, ivWrap: kopf.ivWrap, wrappedDek: kopf.wrappedDek },
  };
}

// Abwärtskompatibler Alias (Alt-Tests + Import-Pfad): liefert nur die Daten.
async function decodeContainer(bytes, passwort) {
  return (await decodeContainerAuto(bytes, passwort)).daten;
}

// Passphrase-Wechsel auf einem v2-Container: NUR der Kopf wird neu gebunden,
// das Daten-Segment (IV_data + Ciphertext) bleibt byte-identisch → Millisekunden.
// v1-Container: Voll-Migration (einmalig teuer, danach v2).
async function wechslePassphrase(bytes, passwortAlt, passwortNeu, iterationen = DEFAULT_ITERATIONEN) {
  const kopf = leseHeader(bytes);
  if (kopf.version === FORMAT_V1) {
    const alt = await decodeContainerAuto(bytes, passwortAlt);
    const dekRoh = crypto.getRandomValues(new Uint8Array(32));
    const neuKopf = await wrapDek(dekRoh, passwortNeu, iterationen);
    const dek = await importDekKey(dekRoh);
    dekRoh.fill(0);
    const neu = await encodeContainerV2(alt.daten, dek, neuKopf);
    return { bytes: neu, dek, kopf: neuKopf };
  }
  const kekAlt = await ableiteSchluessel(passwortAlt, kopf.salt, kopf.iterationen);
  let dekRoh;
  try {
    dekRoh = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: kopf.ivWrap }, kekAlt, kopf.wrappedDek));
  } catch {
    throw new Error('Alte Passphrase falsch');
  }
  const neuKopf = await wrapDek(dekRoh, passwortNeu, iterationen);
  const dek = await importDekKey(dekRoh);
  dekRoh.fill(0);
  const out = Uint8Array.from(bytes); // Daten-Segment unangetastet
  new DataView(out.buffer).setUint32(6, neuKopf.iterationen, true);
  out.set(neuKopf.salt, V2_OFF_SALT);
  out.set(neuKopf.ivWrap, V2_OFF_IVWRAP);
  out.set(neuKopf.wrappedDek, V2_OFF_WDEK);
  return { bytes: out, dek, kopf: neuKopf };
}

// Frische v2-Identität für eine NEUE Kladde (Neuanlage)
async function neueV2Identitaet(passwort, iterationen = DEFAULT_ITERATIONEN) {
  const dekRoh = crypto.getRandomValues(new Uint8Array(32));
  const kopf = await wrapDek(dekRoh, passwort, iterationen);
  const dek = await importDekKey(dekRoh);
  dekRoh.fill(0);
  return { dek, kopf };
}

export {
  encodeContainer, encodeContainerV2, decodeContainer, decodeContainerAuto,
  wechslePassphrase, neueV2Identitaet, wrapDek, importDekKey, leseHeader,
  DEFAULT_ITERATIONEN, FORMAT_V1, FORMAT_V2,
};
