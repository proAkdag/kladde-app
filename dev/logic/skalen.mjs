// kladde/logic/skalen · Noten-Skalen (JS-Port von kladde_lib.py — Parität via fixtures/skalen_vektoren.json)
// Pure Funktionen, kein DOM/Storage. Beim App-Bau wird die export-Zeile gestrippt und inline eingebettet.

// LOOKUP-Schwellen der Mappe (Notentabelle!M12:N27) als exakte Brüche [zaehler, nenner, label]
const DRITTELNOTEN_SCHWELLEN = [
  [0, 1, '1+'], [1, 1, '1'], [4, 3, '1-'],
  [5, 3, '2+'], [2, 1, '2'], [7, 3, '2-'],
  [8, 3, '3+'], [3, 1, '3'], [10, 3, '3-'],
  [11, 3, '4+'], [4, 1, '4'], [13, 3, '4-'],
  [14, 3, '5+'], [5, 1, '5'], [16, 3, '5-'],
  [17, 3, '6'],
];

// Eingabe-Palette: Label → [zaehler, nenner] (n+ = n−1/3 · n− = n+1/3)
const DRITTELNOTEN = (() => {
  const m = {};
  for (let n = 1; n <= 5; n++) {
    m[n + '+'] = [3 * n - 1, 3];
    m[String(n)] = [n, 1];
    m[n + '-'] = [3 * n + 1, 3];
  }
  m['6'] = [6, 1];
  return m;
})();

const EPS = 1e-7; // Mappen-LOOKUP nutzt wert − 0.0000001

// Anzeige-Label für KONTINUIERLICHE Werte (Durchschnitte) — repliziert das Mappen-LOOKUP
// inkl. Grenzfall-Wohlwollen (exakt 2.0 → '2+', wie die Mappe).
function drittelnoteLabel(wert) {
  const x = wert - EPS;
  let label = '1+';
  for (const [z, n, lab] of DRITTELNOTEN_SCHWELLEN) {
    if (x >= z / n) label = lab;
    else break;
  }
  return label;
}

// Label für einen DISKRETEN kanonischen Drittelwert (Vorschlag) — exakter Bruch-Match,
// KEIN LOOKUP-Wohlwollen (der Vorschlag '2-' soll '2-' heißen, nicht '2').
function wertZuLabel(wert) {
  for (const [label, [z, n]] of Object.entries(DRITTELNOTEN)) {
    if (Math.abs(wert - z / n) < 1e-6) return label;
  }
  return null;
}

// Auf das Drittelnoten-Raster runden und in den Noten-Bereich [1, 6] klemmen
function rundeAufDrittel(wert) {
  const w = Math.round(wert * 3) / 3;
  return Math.min(6, Math.max(1, w));
}

const PUNKTE_MIN = 0, PUNKTE_MAX = 15; // Oberstufe

function punkteValid(p) {
  return Number.isInteger(p) && p >= PUNKTE_MIN && p <= PUNKTE_MAX;
}

function klemmePunkte(p) {
  return Math.min(PUNKTE_MAX, Math.max(PUNKTE_MIN, Math.round(p)));
}

// Eingabewert (Label oder Zahl) → kanonischer Zellwert je Profil (Spiegel von export_mappe.note_als_zellwert)
function noteAlsWert(eingabe, profil) {
  if (profil === 'sek2') {
    const p = Math.round(Number(eingabe));
    if (!punkteValid(p)) throw new Error('Punkte ' + eingabe + ' außerhalb 0–15');
    return p;
  }
  if (typeof eingabe === 'string') {
    const label = eingabe.replace('−', '-').trim();
    if (!(label in DRITTELNOTEN)) throw new Error('unbekannte Drittelnote ' + eingabe);
    const [z, n] = DRITTELNOTEN[label];
    return z / n;
  }
  const w = Number(eingabe);
  if (!(w >= 0.6 && w <= 6.0)) throw new Error('Drittelnoten-Wert ' + eingabe + ' außerhalb 0,67–6,00');
  return w;
}

export { DRITTELNOTEN_SCHWELLEN, DRITTELNOTEN, EPS, drittelnoteLabel, wertZuLabel, rundeAufDrittel, PUNKTE_MIN, PUNKTE_MAX, punkteValid, klemmePunkte, noteAlsWert };
