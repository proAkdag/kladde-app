// kladde/logic/fachfarben · Fach → Farbe, Schreibweisen-Normalisierung, Vorschlagsliste.
//
// VERGABE-REGEL (Zero 2026-08-30): nicht nach Fach-Verwandtschaft, sondern nach
// KOMBINATIONS-ABSTAND. Lehrer unterrichten typischerweise VERWANDTE Faecher zusammen
// (Mathe+Physik+Info, Bio+Chemie, Deutsch+Englisch, Geschichte+Philosophie) — eine Palette
// nach Familien haette ausgerechnet den nebeneinander sichtbaren Faechern aehnliche Toene
// gegeben. Darum liegen haeufige Paare hier weit auseinander:
//   Mathe/Physik 144°  ·  Mathe/Info 108°  ·  Physik/Info 108°
//   Deutsch/Englisch 84°  ·  Deutsch/Paeda 144°  ·  Geschichte/Philo 120°
//   Bio/Chemie 84°  ·  Geschichte/SoWi 120°  ·  Kunst/Musik 84°
//
// Die Toene sind nicht von Hand gewaehlt, sondern geloest (Constraint-Suche ueber 67 haeufige
// Kombinationen): von Hand entstanden vier Verstoesse gegen die eigene Regel, u.a. lagen
// Englisch und Franzoesisch 20° auseinander. Ergebnis: haeufige Paare >= 60°, ALLE Paare >= 12°.
// Mehr ist nicht moeglich — 30 Faecher auf 360° lassen im Mittel genau 12°. Fuer die seltenen
// engen Faelle gibt es die Farbauswahl je Kurs (Zeros Vorschlag).
//
// Nur der FARBTON wechselt je Fach; Helligkeit (--L, Nacht/Tag) und Buntheit sind konstant.
// In OKLCH heisst das: alle Faecher wirken gleich stark — kein Gelb, das sticht, kein Blau,
// das versinkt. `oklch()` ist seit Safari 15.4 verfuegbar, also breiter als das bereits
// eingesetzte `color-mix()` (16.2) — kein neues Kompatibilitaetsrisiko.

const CHROMA = 0.145;          // Buntheit fuer alle Faecher gleich
const CHROMA_GRAU = 0.02;      // unbekanntes Fach: fast neutral, sagt „ich kenne dich nicht"
const STUFE_DUNKEL = 0.15;     // zweite Achse: um so viel dunkler als die Theme-Helligkeit

// Jedes Fach traegt [Farbton, Helligkeitsstufe]. Die zweite Achse kam auf Zeros Frage nach
// Weiss und Schwarz dazu — reines Weiss/Schwarz waere falsch (es kippt zwischen Nacht- und
// Tag-Ansicht, und Grau ist schon fuer „unbekanntes Fach" vergeben), aber der Gedanke dahinter
// traegt: mit Helligkeit als zweiter Achse steigt der Abstand der haeufigen Fachpaare
// von 60 auf 108 Grad-Aequivalent (gemessen, hue_solver2). Beide Stufen haben in beiden
// Themes vollen Kontrast zum Grund.

/** Fach (Normalform) → Farbton. Reihenfolge = Reihenfolge im Dropdown. */
const FAECHER = {
  'Mathematik': [252, 0],
  'Physik': [36, 0],
  'Informatik': [144, 0],
  'Chemie': [168, 1],
  'Biologie': [108, 0],
  'NW': [312, 1],
  'Technik': [336, 1],
  'Deutsch': [84, 1],
  'Englisch': [300, 0],
  'Spanisch': [12, 1],
  'Französisch': [132, 0],
  'Latein': [324, 0],
  'Geschichte': [156, 0],
  'Philosophie': [276, 0],
  'Praktische Philosophie': [96, 1],
  'Pädagogik': [240, 1],
  'Sozialwissenschaften': [348, 0],
  'Gesellschaftslehre': [60, 1],
  'Politik': [252, 1],
  'Erdkunde': [0, 0],
  'Wirtschaft': [264, 1],
  'Kunst': [204, 1],
  'Musik': [264, 0],
  'Sport': [192, 1],
  'Hauswirtschaft': [12, 0],
  'Religion': [216, 1],
  'Katholische Religion': [120, 0],
  'Evangelische Religion': [324, 1],
  'Arbeitslehre': [180, 1],
  'Darstellen und Gestalten': [72, 1],
};

/** Schreibweisen, die im Alltag getippt oder aus Mappen gelesen werden. */
const ALIASE = {
  'mathe': 'Mathematik', 'mathematik': 'Mathematik', 'ma': 'Mathematik', 'm': 'Mathematik',
  'physik': 'Physik', 'phy': 'Physik', 'ph': 'Physik',
  'informatik': 'Informatik', 'info': 'Informatik', 'if': 'Informatik', 'in': 'Informatik',
  'chemie': 'Chemie', 'ch': 'Chemie',
  'biologie': 'Biologie', 'bio': 'Biologie', 'bi': 'Biologie',
  'nw': 'NW', 'naturwissenschaften': 'NW', 'naturwissenschaft': 'NW',
  'technik': 'Technik', 'tc': 'Technik',
  'deutsch': 'Deutsch', 'de': 'Deutsch', 'd': 'Deutsch',
  'englisch': 'Englisch', 'engl': 'Englisch', 'e': 'Englisch', 'en': 'Englisch',
  'spanisch': 'Spanisch', 'sp': 'Spanisch', 'span': 'Spanisch',
  'französisch': 'Französisch', 'franzoesisch': 'Französisch', 'franz': 'Französisch', 'fr': 'Französisch',
  'latein': 'Latein', 'la': 'Latein',
  'geschichte': 'Geschichte', 'ge': 'Geschichte', 'gesch': 'Geschichte',
  'philosophie': 'Philosophie', 'phil': 'Philosophie', 'pl': 'Philosophie',
  'praktische philosophie': 'Praktische Philosophie', 'prakt. philosophie': 'Praktische Philosophie',
  'pp': 'Praktische Philosophie',
  'pädagogik': 'Pädagogik', 'paedagogik': 'Pädagogik', 'päda': 'Pädagogik', 'paeda': 'Pädagogik',
  'erziehungswissenschaft': 'Pädagogik', 'ew': 'Pädagogik',
  'sozialwissenschaften': 'Sozialwissenschaften', 'sowi': 'Sozialwissenschaften',
  'sozialwissenschaft': 'Sozialwissenschaften', 'sw': 'Sozialwissenschaften',
  'gesellschaftslehre': 'Gesellschaftslehre', 'gl': 'Gesellschaftslehre',
  'politik': 'Politik', 'po': 'Politik',
  'erdkunde': 'Erdkunde', 'ek': 'Erdkunde', 'geographie': 'Erdkunde', 'geografie': 'Erdkunde',
  'wirtschaft': 'Wirtschaft', 'wi': 'Wirtschaft',
  'kunst': 'Kunst', 'ku': 'Kunst',
  'musik': 'Musik', 'mu': 'Musik',
  'sport': 'Sport', 'sp o': 'Sport',
  'hauswirtschaft': 'Hauswirtschaft', 'hw': 'Hauswirtschaft',
  'religion': 'Religion', 'rel': 'Religion', 're': 'Religion',
  'katholische religion': 'Katholische Religion', 'kath. religion': 'Katholische Religion', 'kr': 'Katholische Religion',
  'evangelische religion': 'Evangelische Religion', 'ev. religion': 'Evangelische Religion', 'er': 'Evangelische Religion',
  'arbeitslehre': 'Arbeitslehre', 'al': 'Arbeitslehre',
  'darstellen und gestalten': 'Darstellen und Gestalten', 'dug': 'Darstellen und Gestalten',
};

/**
 * Freitext → bekannte Normalform, oder null wenn unbekannt.
 * Bewusst NICHT ratend: was nicht in der Liste steht, bleibt unbekannt und bekommt Grau —
 * eine geratene Farbe waere eine Behauptung ueber ein Fach, das wir nicht kennen.
 */
function normalisiereFach(text) {
  const roh = String(text ?? '').trim();
  if (!roh) return null;
  if (FAECHER[roh] !== undefined) return roh;                     // exakter Treffer zuerst
  const schl = roh.toLowerCase().replace(/\s+/g, ' ').replace(/[.\-_]/g, '');
  if (ALIASE[schl]) return ALIASE[schl];
  const mitPunkt = roh.toLowerCase().replace(/\s+/g, ' ');
  if (ALIASE[mitPunkt]) return ALIASE[mitPunkt];
  const treffer = Object.keys(FAECHER).find((f) => f.toLowerCase() === schl);
  return treffer ?? null;
}

/** [Farbton, Stufe] eines Fachs oder null. */
function fachTon(text) {
  const norm = normalisiereFach(text);
  return norm ? FAECHER[norm] : null;
}

/** Farbton eines Fachs (0–360) oder null. */
function fachHue(text) {
  const t = fachTon(text);
  return t ? t[0] : null;
}

/**
 * CSS-Farbwert fuer Kurs-Band und Stundenplan-Block.
 * `var(--L)` bleibt im Wert stehen: die Helligkeit kommt aus dem Theme, dieselbe Zuweisung
 * traegt Nacht und Tag. Wird per CSSOM gesetzt — inline style-Attribute sind per CSP gesperrt.
 * @param eigenerHue optionaler Nutzer-Farbton (kurs.farbHue) — schlaegt den Fach-Standard
 */
function fachFarbe(text, eigenerHue = null) {
  if (Number.isFinite(eigenerHue)) return helligkeit(0) + ` ${CHROMA} ${eigenerHue})`;
  const t = fachTon(text);
  if (t === null) return `oklch(calc(var(--L) - .05) ${CHROMA_GRAU} 250)`;
  return helligkeit(t[1]) + ` ${CHROMA} ${t[0]})`;
}

/** Oeffnender Teil des Farbwerts je Stufe — `var(--L)` kommt aus dem Theme. */
function helligkeit(stufe) {
  return stufe ? `oklch(calc(var(--L) - ${STUFE_DUNKEL})` : 'oklch(var(--L)';
}

/** Zwoelf gut getrennte Toene fuer die Farbauswahl je Kurs (30°-Schritte). */
const WAEHLER_HUES = [0, 36, 72, 108, 144, 180, 216, 252, 264, 288, 312, 336];

/** Namen fuer das <datalist> beim Kurs-Anlegen. */
const FACH_LISTE = Object.keys(FAECHER);

export { normalisiereFach, fachHue, fachTon, fachFarbe, FACH_LISTE, WAEHLER_HUES, FAECHER, CHROMA };
