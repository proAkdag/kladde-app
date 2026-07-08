// kladde/logic/migration · Vault-Schema-Migration (P2.1 · kladde/v1 → kladde/v2)
// v2 ergänzt die Stundenplan-Welt: stamm.zeitmodelle[] · stamm.wochenplan[] · stamm.ausnahmeSlots[].
// (Phase 3 erweitert dieselbe Funktion additiv um schuljahre[] — Schema bleibt kladde/v2.)
// IDEMPOTENT: zweiter Lauf ändert nichts. Bewusst KEIN rev-Bump — beide Geräte migrieren
// lokal beim eigenen Update; ein künstlicher rev-Konflikt würde nur Merge-Lärm erzeugen
// (JSON-Roundtrip älterer Clients erhält unbekannte Felder).

const BEKANNTE_SCHEMAS = ['kladde/v1', 'kladde/v2'];

// Schuljahr-Label aus einem Datum (Aug–Jul → „2026/27"). Monate 0-basiert.
function schuljahrLabelAusDatum(d) {
  const jahr = d.getFullYear(), monat = d.getMonth();
  const start = monat >= 7 ? jahr : jahr - 1; // ab August neues Schuljahr
  return start + '/' + String((start + 1) % 100).padStart(2, '0');
}
function slugSchuljahr(label) { return String(label).replace(/[^0-9]/g, '-').replace(/^-+|-+$/g, ''); }

// Schuljahr aus vorhandenen Kursdaten schätzen, sonst aus jetzt-Datum (Plan §33).
function findeOderSchaetzeSchuljahr(kurse, jetzt) {
  const ausKurs = (kurse || []).map(k => k.schuljahr).find(Boolean);
  if (ausKurs) return ausKurs;
  return schuljahrLabelAusDatum(jetzt);
}

// Standard-Zeiträume eines Schuljahres (Q1/Q2/HJ1 · Q3/Q4/HJ2) — Grenzen editierbar,
// aber ein Tap auf „Q2" muss reichen (NRW bewertet quartals-/halbjahresweise).
function standardZeitraeume(label) {
  const j = parseInt(label, 10);
  const d = (y, m, t) => y + '-' + String(m).padStart(2, '0') + '-' + String(t).padStart(2, '0');
  return [
    { id: 'q1', label: '1. Quartal', von: d(j, 8, 1), bis: d(j, 11, 6) },
    { id: 'q2', label: '2. Quartal', von: d(j, 11, 7), bis: d(j + 1, 1, 31) },
    { id: 'hj1', label: '1. Halbjahr', von: d(j, 8, 1), bis: d(j + 1, 1, 31) },
    { id: 'q3', label: '3. Quartal', von: d(j + 1, 2, 1), bis: d(j + 1, 4, 15) },
    { id: 'q4', label: '4. Quartal', von: d(j + 1, 4, 16), bis: d(j + 1, 7, 31) },
    { id: 'hj2', label: '2. Halbjahr', von: d(j + 1, 2, 1), bis: d(j + 1, 7, 31) },
  ];
}

// → true, wenn etwas geändert wurde (Aufrufer speichert dann). IDEMPOTENT.
// jetzt: optionale Referenzzeit (Tests reichen sie durch; App nutzt new Date()).
function migriereStamm(vault, jetzt = new Date()) {
  let geaendert = false;
  const s = vault.stamm;
  // P2: Stundenplan-Welt
  if (!Array.isArray(s.zeitmodelle)) { s.zeitmodelle = []; geaendert = true; }
  if (!Array.isArray(s.wochenplan)) { s.wochenplan = []; geaendert = true; }
  if (!Array.isArray(s.ausnahmeSlots)) { s.ausnahmeSlots = []; geaendert = true; }
  // P3: Schuljahr-Welt
  if (!Array.isArray(s.schuljahre) || !s.schuljahre.length) {
    const label = findeOderSchaetzeSchuljahr(s.kurse, jetzt);
    const id = slugSchuljahr(label);
    s.schuljahre = [{ id, label, status: 'aktiv', angelegtAm: jetzt.toISOString(), abgeschlossenAm: null, zeitraeume: standardZeitraeume(label) }];
    s.aktivesSchuljahrId = id;
    for (const k of (s.kurse || [])) { k.schuljahrId = k.schuljahrId || id; k.status = k.status || 'aktiv'; }
    geaendert = true;
  }
  if (vault.schema !== 'kladde/v2') { vault.schema = 'kladde/v2'; geaendert = true; }
  return geaendert;
}

// Import-Guard (Schema-Ebene · Plan 0.3): fremde Container mit NEUEREM Schema ablehnen,
// niemals stumm Teilmengen verarbeiten. Fehlendes Schema = Alt-Container → ok.
function schemaBekannt(schema) {
  return !schema || BEKANNTE_SCHEMAS.includes(schema);
}

export { migriereStamm, schemaBekannt, BEKANNTE_SCHEMAS,
  schuljahrLabelAusDatum, slugSchuljahr, findeOderSchaetzeSchuljahr, standardZeitraeume };
