// kladde/logic/verdichtung · Bilanz + Tendenz + sichtbarer Notenvorschlag (Criterion 11)
// Regel v1 (Plan-Dok, im UI als Text zeigbar — kein Black-Box-Score):
//   score = (n⁺ − n⁻) / max(1, n⁺ + n° + n⁻)   ∈ [−1, +1]
//   SekI:  Ereignis-Note = 3 − 5/3·score, auf Drittel gerundet, geklemmt [1,6]
//   SekII: Ereignis-Punkte = 8 + 5·score, ganzzahlig, geklemmt [0,15]
//   Zero 2026-09-29: nur ＋ → 1− bzw. 13 P · nur o → 3 bzw. 8 P · nur − → 5+ bzw. 3 P. Die Ränder
//   1/15 P und 6/0 P gehören ⭐ (direkte Note) und ⊘ (Verweigerung). Beide Kurven sind dieselbe:
//   Punkte = 17 − 3·Note (NRW-Tabelle: 1− = 13, 3 = 8, 5+ = 3).
//   direkte note-Events: TERMINGEWICHTET — jede Note wiegt einen Termin (Zero-Entscheid 2026-07-10;
//   schwer gewichtete Einzelleistungen wie Referate leben in der Excel-Mappe, nicht hier)
//   Aktivitätsquote = beteiligte Termine / Kurstermine
//   Verlaufspfeil: score(2. Termin-Hälfte) − score(1. Hälfte) → ↑/→/↓ bei |Δ| > 0.15
//   LB-Schüler: Bilanz ja, Vorschlag null (kein m-Slot-Export).

import { noteAlsWert, rundeAufDrittel, wertZuLabel, klemmePunkte } from './skalen.mjs';

const SOMI_TYPEN = new Set(['+', 'o', '-']);
// fehlt_o (Anwesenheits-Stempel, Phase 3) zählt als Kurstermin — die Erfassung IST Evidenz,
// dass Unterricht war (Auflage 7). Aktiv-Quote korrigiert das über den e-Nenner.
const TERMIN_TYPEN = new Set(['+', 'o', '-', 'note', 'mat', 'ipad_fehlt', 'ipad_leer',
  'lernzeit', 'fehlt_e', 'fehlt_u', 'fehlt_o', 'versp', 'notiz', 'ha', 'verweigert']);
// EINE Antwort auf „macht dieser Eintrag den Tag zum Termin?“ — für Verdichtung, Termin-Matrix und den Anlass
// „seit N Terminen kein Eintrag“. Vorher zählte der Anlass Rücknahmen mit: ein versehentliches ∅, wieder entfernt,
// machte den Tag zum Kurstermin und das Kind zu einem „mit Eintrag“ (Prüfer 2026-09-29). Quartalsnoten sind kein Termin.
const istTerminEintrag = e => Boolean(e && e.datum && TERMIN_TYPEN.has(e.typ));

// Eine Rücknahme (typ 'storno') hebt auch die Wirkung auf, die das zurückgenommene Event selbst hatte:
// Wer eine Klärung (fehlt_e mit stornoVon → fehlt_o) rückgängig macht, bekommt die offene Fehlzeit zurück —
// vorher war sie danach ganz verschwunden (Prüfer 2026-09-29). Klärungs-Ketten (u → e) bleiben, wie sie sind.
// Gleiche Regel in export_mappe.py wirksame_events (Brücke) — beide ändern sich nur zusammen.
function wirksameEvents(events) {
  const zurueck = new Set(events.filter(e => e.typ === 'storno' && e.stornoVon).map(e => e.stornoVon));
  const storniert = new Set(events.filter(e => e.stornoVon && !zurueck.has(e.id)).map(e => e.stornoVon));
  return events.filter(e => !storniert.has(e.id));
}

// Ein Zeichen je Stunde (Zero 2026-09-29: „ich vergebe nicht 2 mal +“): ＋/o/−, direkte Note (📊, ⭐) und ⊘
// schließen sich an einem Termin aus. Die neue Bewertung trägt stornoVon auf die bisherige — die Rücknahme-Regel
// oben bringt sie beim Rückgängig zurück, die Brücke rechnet ohne Änderung mit. Notiz, Fehlzeit, Material usw. bleiben.
const BEWERTUNG_TYPEN = new Set(['+', 'o', '-', 'note', 'verweigert']);
// Was beim Einbuchen von `neu` mit den bisherigen Bewertungen desselben Termins geschieht (null = nichts):
//   ersetzt → die jüngste, auf sie zeigt neu.stornoVon (↶ bringt sie zurück)
//   still   → ältere Doppelte (frühere Versionen, zwei Geräte), bekommen je einen Storno
//   notiz   → Notizen an ersetzten Zeichen reisen mit; die Begründung eines ⊘ NICHT — sie geht mit dem ⊘ und kommt mit ↶
//             zurück (Zero 2026-09-30: sonst stand „＋ · Mitarbeit verweigert“ im Verlauf und im Kurzbericht). Notiz-Einträge bleiben unberührt.
// Eine Verspätung je Termin (Scheibe 5, Zero 03.10.: „die zeit anzupassen wenn nötig“): eine neue ersetzt die bisherigen nach derselben
// Regel — so addieren weder ein ↷ Wiederherstellen noch zwei Geräte noch Altbestand die Minuten (Prüfer 03.10., 🔴 1/🟡 2). Die Brücke
// braucht keine eigene Regel: sie liest die gebuchten Stornos (export_mappe.py wirksame_events).
// Doppelstunde (Zero 03.10.: „Dazuzählen, wenn es ein späterer Block ist“): Verspätungen verschiedener Blöcke desselben Tages stehen
// nebeneinander. Fehlt einer Seite der Block (Altbestand, Nachtrag), gilt die Tagesregel — so bleibt der Schutz gegen ↶ + ↷.
// Anwesenheit je Stunde (v1.17.1, Zero 03.10.: „⏰ nimmt ∅ zurück“): ∅ und ⏰ schließen sich in EINER Stunde aus — ⏰ auf ein ∅ ersetzt es
// („kommt doch“), ∅ auf ein ⏰ ebenso, ↶ bringt das Vorige zurück. Ein ∅ einer anderen Stunde bleibt offen (Prüfer ❓ 5, eigene Festlegung).
// Vorher klärte addEvent das ∅ mit eigenen Stornos: ↶ verlor dabei die ältere Verspätung, ∅ ⏰ ∅ ⏰ ließ ∅ offen (Prüfer 🟡 4).
const ANWESEND_TYPEN = new Set(['versp', 'fehlt_o']);
// Eine Quartalsnote je Quartal (Scheibe 6, Festlegung des Bauers, Zero 03.10. bestätigt: „Ja, ersetzt“): die neue ersetzt die bisherige desselben Quartals
// (hj + quartal, nicht der Termin) — so gewinnt sie auch, wenn die Uhr eines Geräts nachgeht; vorher entschied allein der Zeitstempel. ↶ bringt
// die alte zurück. Die Brücke braucht nichts Eigenes (export_mappe.py quartalsnoten liest wirksame_events).
const QN_TYPEN = new Set(['quartalsnote']);
const gleicherBlock = (a, b) => a.blockNr == null || b.blockNr == null || a.blockNr === b.blockNr;
function ersetzungFuer(events, neu) {
  const art = BEWERTUNG_TYPEN.has(neu.typ) ? BEWERTUNG_TYPEN : ANWESEND_TYPEN.has(neu.typ) ? ANWESEND_TYPEN : QN_TYPEN.has(neu.typ) ? QN_TYPEN : null;
  if (!art || neu.stornoVon) return null;
  const gleich = e => art.has(e.typ) && e.kursId === neu.kursId && e.schuelerNr === neu.schuelerNr &&
    (art === QN_TYPEN ? e.hj === neu.hj && e.quartal === neu.quartal : terminVon(e) === terminVon(neu) && (art !== ANWESEND_TYPEN || gleicherBlock(e, neu)));
  // Ältere Doppelte so lange stornieren, bis nur das Ersetzte bleibt: ein Storno hebt auch die Wirkung des Stornierten auf und brächte
  // sonst dessen eigenes Ersetztes zurück (zwei Geräte: 5 → 7 neben ∅, ⏰ 8 ergab 13). Ein Wiederkehrer ist immer älter als das Ersetzte.
  let evs = events, alt = [], ersetzt = null;
  for (;;) {
    const jetzt = wirksameEvents(evs).filter(gleich).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    if (jetzt.length <= 1) { ersetzt = jetzt[0] || null; break; }
    const weg = jetzt.slice(0, -1);
    alt = [...alt, ...weg]; evs = [...evs, ...weg.map(a => ({ id: '~' + a.id, typ: 'storno', stornoVon: a.id }))];
  }
  if (!ersetzt) return null;
  let notiz = neu.notiz ? String(neu.notiz).trim() : '';   // „includes“: ein ↷ Wiederherstellen bringt den Text schon mit
  for (const a of [ersetzt, ...alt]) {
    const t = a.typ !== 'verweigert' && a.notiz ? String(a.notiz).trim() : '';
    if (t && !notiz.includes(t)) notiz = notiz ? notiz + ' · ' + t : t;
  }
  return { ersetzt, still: alt, notiz };
}

function terminVon(e) {
  return e.datum || String(e.ts).slice(0, 10);
}

function scoreVon(somi) {
  let p = 0, o = 0, m = 0;
  for (const e of somi) {
    if (e.typ === '+') p++;
    else if (e.typ === 'o') o++;
    else m++;
  }
  return { nPlus: p, nNull: o, nMinus: m, score: (p - m) / Math.max(1, p + o + m) };
}

function verdichte(kursEvents, schuelerNr, opt) {
  const profil = opt?.profil || 'sek1';
  const lb = Boolean(opt?.lb);
  const von = opt?.von || '';
  const bis = opt?.bis || '9999-12-31';
  const uAls6 = opt?.uAls6 !== false; // Kursprofil-Option, Default AN (Auflage: u = 6/0 P)

  const wirksam = wirksameEvents(kursEvents)
    .filter(e => { const t = terminVon(e); return t >= von && t <= bis; });

  const kursTermine = new Set(
    wirksam.filter(e => TERMIN_TYPEN.has(e.typ)).map(terminVon));
  const meine = wirksam.filter(e => e.schuelerNr === schuelerNr);
  const somi = meine.filter(e => SOMI_TYPEN.has(e.typ));
  // Direkte Noten, die im Notenmodus des Kurses nicht lesbar sind (Punkte ↔ Drittel nach einem Wechsel, Importe),
  // werden übersprungen statt die ganze Auswertung abzubrechen (Prüfer 2026-09-29: Liste und Vollseite warfen).
  const lesbar = e => { try { noteAlsWert(e.wert, profil); return true; } catch { return false; } };
  const direkte = meine.filter(e => e.typ === 'note' && lesbar(e));
  const beteiligt = new Set(
    meine.filter(e => SOMI_TYPEN.has(e.typ) || e.typ === 'note').map(terminVon));

  // Fehlzeiten (geklärt): fehlt_e = entschuldigt, fehlt_u = unentschuldigt.
  // fehlt_o (offen) zählt NIE in die Note — erst die Klärung wirkt.
  // Pro Termin gewinnt die JÜNGSTE Klärung: 2-Geräte-Widerspruch (e vs. u) wird
  // deterministisch aufgelöst, e und u bleiben disjunkt (Systemmanager-Auflage).
  const klaerung = new Map(); // termin → {typ, ts}
  for (const e of meine) {
    if (e.typ === 'fehlt_e' || e.typ === 'fehlt_u') {
      const t = terminVon(e), cur = klaerung.get(t);
      if (!cur || String(e.ts) > String(cur.ts)) klaerung.set(t, { typ: e.typ, ts: e.ts });
    }
  }
  let nFehltE = 0, nFehltU = 0;
  for (const c of klaerung.values()) { if (c.typ === 'fehlt_e') nFehltE++; else nFehltU++; }
  const nFehltO = new Set(meine.filter(e => e.typ === 'fehlt_o').map(terminVon)).size;
  const nSomi = new Set(somi.map(terminVon)).size;

  const bilanz = scoreVon(somi);
  // Aktiv-Quote-Nenner: persönlich mögliche Termine = Kurstermine − entschuldigte Fehltermine.
  // Entschuldigtes Fehlen ist keine Passivität; fehlt_u/fehlt_o reduzieren den Nenner NICHT.
  const moeglich = Math.max(0, kursTermine.size - nFehltE);
  const aktivQuote = moeglich ? beteiligt.size / moeglich : 0;

  // Verlaufspfeil über die Termin-Hälften des Schülers
  let pfeil = '→';
  const termine = [...new Set(somi.map(terminVon))].sort();
  if (termine.length >= 4) {
    const mitte = Math.ceil(termine.length / 2);
    const fruehe = new Set(termine.slice(0, mitte));
    const s1 = scoreVon(somi.filter(e => fruehe.has(terminVon(e)))).score;
    const s2 = scoreVon(somi.filter(e => !fruehe.has(terminVon(e)))).score;
    const delta = s2 - s1;
    pfeil = delta > 0.15 ? '↑' : delta < -0.15 ? '↓' : '→';
  }

  // Termine, die als 6 / 0 P termingewichtet einfließen (nicht als direkte Note — die hätte 50 %
  // Kollektivgewicht und würde eine Einzelstunde massiv überbewerten):
  //  · geklärte unentschuldigte Fehlstunden (nur wenn Kursoption uAls6 an), UND
  //  · explizite Verweigerungen (anwesend, keine/verweigerte Leistung) — bewusster Lehrer-Akt,
  //    zählt IMMER (unabhängig von uAls6). NRW §48 SchulG: nicht erbrachte Leistung = 6, keine Strafe.
  const nVerweigert = new Set(meine.filter(e => e.typ === 'verweigert').map(terminVon)).size;
  const nSechs = (uAls6 ? nFehltU : 0) + nVerweigert;
  const sechsWirkt = nSechs > 0;

  // Vorschlag (LB: keiner; ohne jede Grundlage: keiner)
  // Termingewichtete Mischung DREIER Quellen: Stempel-Note über nSomi Termine · 6/0-P-Stunden über
  // nSechs Termine · direkte Noten über ihre Termine (jede Note = EIN Termin-Gewicht — kein
  // 50:50-Kollektivgewicht mehr; Referate & Co. gewichtet die Excel-Mappe · Zero 2026-07-10).
  const nDirekt = new Set(direkte.map(terminVon)).size;
  const misch = (ereignis, sechsWert, mittelDirekt) => {
    let summe = 0, gewicht = 0;
    if (ereignis !== null) { summe += ereignis * nSomi; gewicht += nSomi; }
    if (nSechs) { summe += sechsWert * nSechs; gewicht += nSechs; }
    if (mittelDirekt !== null) { summe += mittelDirekt * nDirekt; gewicht += nDirekt; }
    return gewicht ? summe / gewicht : null;
  };
  let vorschlag = null;
  if (!lb && (somi.length > 0 || direkte.length > 0 || sechsWirkt)) {
    if (profil === 'sek2') {
      const ereignis = somi.length ? 8 + 5 * bilanz.score : null;
      const mittel = direkte.length ? direkte.reduce((s, e) => s + noteAlsWert(e.wert, 'sek2'), 0) / direkte.length : null;
      const p = klemmePunkte(misch(ereignis, 0, mittel));
      vorschlag = { wert: p, label: String(p) + ' P' };
    } else {
      const ereignis = somi.length ? 3 - 5 / 3 * bilanz.score : null;
      const mittel = direkte.length ? direkte.reduce((s, e) => s + noteAlsWert(e.wert, 'sek1'), 0) / direkte.length : null;
      const w = rundeAufDrittel(misch(ereignis, 6, mittel));
      vorschlag = { wert: w, label: wertZuLabel(w) };
    }
  }

  return {
    ...bilanz,
    beteiligtTermine: beteiligt.size,
    kursTermine: kursTermine.size,
    moeglicheTermine: moeglich,
    nFehltE, nFehltU, nFehltO, nVerweigert,
    aktivQuote,
    pfeil,
    vorschlag,
    regelText: regelText(profil, sechsWirkt ? nSechs : 0),
  };
}

function regelText(profil, nSechs = 0) {
  const basis = 'score = (n⁺ − n⁻) / (n⁺ + n° + n⁻) · Verlauf = 2. Hälfte − 1. Hälfte · direkte Noten zählen wie ein Termin';
  const kopf = profil === 'sek2'
    ? 'Punkte-Vorschlag = 8 + 5·score (＋ bis 13 P, − bis 3 P) · '
    : 'Noten-Vorschlag = 3 − 5/3·score (＋ bis 1−, − bis 5+) · ';
  const sechsHinweis = nSechs > 0
    ? ' · ' + nSechs + ' Stunde' + (nSechs > 1 ? 'n' : '') + ' ohne bewertbare Leistung (unentsch./verweigert) als ' + (profil === 'sek2' ? '0 P' : '6') + ' termingewichtet'
    : '';
  return kopf + basis + sechsHinweis;
}

// „Vorschläge kopieren" (P4.5): Zeilen fürs Einfügen in die Excel-Klassenmappe.
// TAB-getrennt (Excel-Paste = eine Spalte je TAB), eine Zeile je Schüler. Reihenfolge = wie übergeben.
// KEIN Datei-Export, kein Schreiben in die Mappe — nur Zwischenablage, der Mensch fügt ein (User-Entscheid „Beides").
function vorschlagsZeilen(rows) {
  return rows.map(r => {
    const felder = [r.nr, r.vorschlag ?? ''];
    if (r.fSummen != null && r.fSummen !== '') felder.push(r.fSummen);
    return felder.join('\t');
  }).join('\n');
}

// ── Quartals-Verlauf (Zero 2026-09-02, Punkt 7): Bilanz-Score je Zeitraum + Pfeil zum vorigen
// Zeitraum MIT Daten (leere Quartale werden übersprungen, nicht als Absturz gewertet).
// Dieselbe Schwelle wie der Verlaufspfeil innerhalb eines Zeitraums (|Δ| > 0.15).
function quartalsVerlauf(kursEvents, schuelerNr, zeitraeume, opt) {
  const out = []; let vorher = null;
  for (const z of zeitraeume || []) {
    const v = verdichte(kursEvents, schuelerNr, { ...opt, von: z.von, bis: z.bis });
    const n = v.nPlus + v.nNull + v.nMinus;
    const e = { id: z.id, label: z.label, score: n ? v.score : null, n, vorschlag: v.vorschlag, pfeil: null };
    if (e.score !== null && vorher !== null) { const d = e.score - vorher; e.pfeil = d > 0.15 ? '↑' : d < -0.15 ? '↓' : '→'; }
    if (e.score !== null) vorher = e.score;
    out.push(e);
  }
  return out;
}

// ── Einordnung im Kurs (Punkt 10): Median der Vorschlagswerte + Anteil des Kurses, der
// SCHLECHTER steht. Sek I: kleiner = besser · Sek II: größer = besser. Zahl gehört der App,
// Deutung dem Lehrer (Entscheid E3) — darum Prozent, kein Rang und kein Wort.
function kursEinordnung(werte, wert, profil) {
  const w = (werte || []).filter(x => x !== null && x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
  if (!w.length || wert === null || wert === undefined) return null;
  const m = w.length % 2 ? w[(w.length - 1) / 2] : (w[w.length / 2 - 1] + w[w.length / 2]) / 2;
  const schlechter = w.filter(x => profil === 'sek2' ? x < wert : x > wert).length;
  return { median: m, n: w.length, anteilDahinter: schlechter / w.length };
}

// ── Abstand gesetzte Note ↔ Vorschlag in NOTENSTUFEN (Punkt 4): Sek I direkt (1 = eine ganze
// Note), Sek II 3 Punkte = eine Note. Unbekannte Eingaben (Tippfehler) → null, kein Wurf.
function notenAbstand(gesetzt, vorschlagWert, profil) {
  if (vorschlagWert === null || vorschlagWert === undefined) return null;
  let g;
  try { g = noteAlsWert(gesetzt, profil); } catch { return null; }
  return profil === 'sek2' ? Math.abs(g - vorschlagWert) / 3 : Math.abs(g - vorschlagWert);
}

export { verdichte, wirksameEvents, ersetzungFuer, istTerminEintrag, regelText, vorschlagsZeilen, quartalsVerlauf, kursEinordnung, notenAbstand };
