// kladde/logic/biometrie · Zweite Hülle um den Datenschlüssel (DEK) für Fingerabdruck/Face ID (Zero 2026-09-02).
//
// Der DEK bleibt der eine Schlüssel über den Daten (container.mjs v2). Er ist heute EINMAL eingewickelt:
// mit dem KEK aus der Passphrase (PBKDF2). Hier kommt eine ZWEITE, gerätelokale Hülle dazu:
//   WebAuthn-Passkey (Plattform-Authenticator, Touch/Face ID) + PRF-Erweiterung → 32 B Geheimwert
//   → HKDF-SHA256 → AES-256-GCM-Schlüssel → wrappt dieselben DEK-Rohbytes.
// Das Paket {salt, iv, wrappedDek, prfSalt} liegt in IndexedDB neben dem Container. Der Container
// selbst bleibt byte-identisch — Sync, Export, Import und Passphrase-Wechsel merken nichts davon;
// ein Passphrase-Wechsel lässt die Hülle gültig (der DEK ändert sich nicht).
//
// Trennung: HIER nur die reine Kryptografie (Node-testbar). WebAuthn-Aufrufe (credentials.create/get)
// leben in der App, weil sie eine Nutzergeste und ein echtes Gerät brauchen.
// Rückweg bleibt immer die Passphrase: Passkey weg oder Gerät neu → Passphrase öffnet wie bisher.

const INFO = new TextEncoder().encode('kladde-bio-v1');

// PRF-Geheimwert (32 B) + Salt → AES-GCM-Schlüssel (non-extractable). HKDF trennt den WebAuthn-Wert
// sauber vom Wickelschlüssel; salt ist je Einrichtung frisch.
async function bioSchluessel(prfSecret, salt) {
  const material = await crypto.subtle.importKey('raw', prfSecret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: INFO },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// DEK-Rohbytes unter dem PRF-Geheimwert einwickeln → Paket für IndexedDB (ohne credId/prfSalt — die App ergänzt sie)
async function bioWrap(dekRoh, prfSecret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await bioSchluessel(prfSecret, salt);
  const wrappedDek = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, dekRoh));
  return { salt, iv, wrappedDek };
}

// Paket + PRF-Geheimwert → DEK-Rohbytes (Aufrufer importiert non-extractable und nullt die Rohbytes)
async function bioUnwrap(paket, prfSecret) {
  const key = await bioSchluessel(prfSecret, paket.salt);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: paket.iv }, key, paket.wrappedDek));
  } catch {
    throw new Error('Fingerabdruck-Hülle passt nicht — bitte mit Passphrase öffnen und neu einrichten');
  }
}

export { bioWrap, bioUnwrap, bioSchluessel };
