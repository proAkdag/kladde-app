// kladde/logic/container · verschlüsselter Einzeldatei-Container (Sync Stufe 0 + 1)
// Format KLD1 v1 (Header im Klartext — Salt/IV sind nicht geheim, MAPPING/Plan G5):
//   Byte 0–3   Magic 'KLD1'
//   Byte 4     Format-Version (1)
//   Byte 5     KDF-Kennung (1 = PBKDF2-HMAC-SHA256)
//   Byte 6–9   Iterationen (u32 little-endian; Default 600 000 — OWASP 2026)
//   Byte 10–25 Salt (16 B, zufällig je Passwort-Setzung)
//   Byte 26–37 IV (12 B, bei JEDEM encode NEU — IV-Wiederverwendung bricht GCM)
//   Byte 38–   AES-256-GCM-Ciphertext (inkl. 16-B-Auth-Tag)
// Läuft in Browser UND Node ≥20 (globalThis.crypto.subtle).

const MAGIC = new Uint8Array([0x4b, 0x4c, 0x44, 0x31]); // 'KLD1'
const FORMAT_VERSION = 1;
const KDF_PBKDF2_SHA256 = 1;
const DEFAULT_ITERATIONEN = 600000;
const HEADER_LAENGE = 38;

async function ableiteSchluessel(passwort, salt, iterationen) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passwort), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iterationen },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function encodeContainer(obj, passwort, iterationen = DEFAULT_ITERATIONEN) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const schluessel = await ableiteSchluessel(passwort, salt, iterationen);
  const klartext = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, schluessel, klartext));

  const out = new Uint8Array(HEADER_LAENGE + ct.length);
  out.set(MAGIC, 0);
  out[4] = FORMAT_VERSION;
  out[5] = KDF_PBKDF2_SHA256;
  new DataView(out.buffer).setUint32(6, iterationen, true);
  out.set(salt, 10);
  out.set(iv, 26);
  out.set(ct, HEADER_LAENGE);
  return out;
}

function leseHeader(bytes) {
  if (bytes.length < HEADER_LAENGE + 16) throw new Error('Container zu kurz');
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== MAGIC[i]) throw new Error('kein Kladde-Container (Magic fehlt)');
  }
  const version = bytes[4];
  const kdf = bytes[5];
  if (version !== FORMAT_VERSION) throw new Error('unbekannte Container-Version ' + version);
  if (kdf !== KDF_PBKDF2_SHA256) throw new Error('unbekannte KDF-Kennung ' + kdf);
  const iterationen = new DataView(bytes.buffer, bytes.byteOffset).getUint32(6, true);
  return {
    version, kdf, iterationen,
    salt: bytes.slice(10, 26),
    iv: bytes.slice(26, 38),
    ciphertext: bytes.slice(38),
  };
}

async function decodeContainer(bytes, passwort) {
  const kopf = leseHeader(bytes);
  const schluessel = await ableiteSchluessel(passwort, kopf.salt, kopf.iterationen);
  let klartext;
  try {
    klartext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: kopf.iv }, schluessel, kopf.ciphertext);
  } catch {
    throw new Error('Entschlüsselung fehlgeschlagen — falsche PIN/Passwort oder Container beschädigt');
  }
  return JSON.parse(new TextDecoder().decode(klartext));
}

export { encodeContainer, decodeContainer, leseHeader, DEFAULT_ITERATIONEN, FORMAT_VERSION };
