// kladde/logic/kursSort · Kurslisten in Schul-Reihenfolge (Zero 2026-09-02: „automatisch
// alphabetisch bzw. nach Klassenstufen sortieren").
// Reihenfolge: 5a · 5b · 6a · … · 10c · EF · Q1 · Q2 · alles andere alphabetisch — je Stufe nach
// Fach. Reine Funktion, kein DOM; App und Tests importieren DIESELBE Datei.
//
// Warum nicht localeCompare(numeric): „10a" käme damit zwar hinter „9b", aber EF/Q1/Q2 lägen
// alphabetisch VOR den Ziffern-Klassen — die Oberstufe gehört ans Ende, wie auf dem Aushang.

// → [Gruppe, Stufe, Zug, Rest]  · Gruppe 0 = Ziffern-Klasse · 1 = Oberstufe · 2 = Sonstiges
function kursSchluessel(name) {
  const s = String(name ?? '').trim();
  const m = s.match(/^(\d{1,2})\s*([a-zA-Z]?)(.*)$/);
  if (m) return [0, Number(m[1]), m[2].toLowerCase(), m[3].trim()];
  const o = s.match(/^(EF|Q[1-4])\b(.*)$/i);
  if (o) { const t = o[1].toUpperCase(); return [1, t === 'EF' ? 0 : Number(t[1]), '', o[2].trim()]; }
  return [2, 0, '', s];
}

function vergleicheKurse(a, b) {
  const ka = kursSchluessel(a.name), kb = kursSchluessel(b.name);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] === kb[i]) continue;
    if (typeof ka[i] === 'number') return ka[i] - kb[i];
    return String(ka[i]).localeCompare(String(kb[i]), 'de', { numeric: true });
  }
  return String(a.fach ?? '').localeCompare(String(b.fach ?? ''), 'de');
}

// Kopie, sortiert — das Original (vault.stamm.kurse) bleibt in Anlage-Reihenfolge.
function sortiereKurse(kurse) {
  return (kurse || []).slice().sort(vergleicheKurse);
}

export { kursSchluessel, vergleicheKurse, sortiereKurse };
