// kladde/logic/migration · Vault-Schema-Migration (P2.1 · kladde/v1 → kladde/v2)
// v2 ergänzt die Stundenplan-Welt: stamm.zeitmodelle[] · stamm.wochenplan[] · stamm.ausnahmeSlots[].
// (Phase 3 erweitert dieselbe Funktion additiv um schuljahre[] — Schema bleibt kladde/v2.)
// IDEMPOTENT: zweiter Lauf ändert nichts. Bewusst KEIN rev-Bump — beide Geräte migrieren
// lokal beim eigenen Update; ein künstlicher rev-Konflikt würde nur Merge-Lärm erzeugen
// (JSON-Roundtrip älterer Clients erhält unbekannte Felder).

const BEKANNTE_SCHEMAS = ['kladde/v1', 'kladde/v2'];

// → true, wenn etwas geändert wurde (Aufrufer speichert dann)
function migriereStamm(vault) {
  let geaendert = false;
  const s = vault.stamm;
  if (!Array.isArray(s.zeitmodelle)) { s.zeitmodelle = []; geaendert = true; }
  if (!Array.isArray(s.wochenplan)) { s.wochenplan = []; geaendert = true; }
  if (!Array.isArray(s.ausnahmeSlots)) { s.ausnahmeSlots = []; geaendert = true; }
  if (vault.schema !== 'kladde/v2') { vault.schema = 'kladde/v2'; geaendert = true; }
  return geaendert;
}

// Import-Guard (Schema-Ebene · Plan 0.3): fremde Container mit NEUEREM Schema ablehnen,
// niemals stumm Teilmengen verarbeiten. Fehlendes Schema = Alt-Container → ok.
function schemaBekannt(schema) {
  return !schema || BEKANNTE_SCHEMAS.includes(schema);
}

export { migriereStamm, schemaBekannt, BEKANNTE_SCHEMAS };
