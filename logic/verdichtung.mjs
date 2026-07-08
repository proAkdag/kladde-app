// kladde/logic/verdichtung · Bilanz + Tendenz + sichtbarer Notenvorschlag (Criterion 11)
// Regel v1 (Plan-Dok, im UI als Text zeigbar — kein Black-Box-Score):
//   score = (n⁺ − n⁻) / max(1, n⁺ + n° + n⁻)   ∈ [−1, +1]
//   SekI:  Ereignis-Note = 3 − 2·score, auf Drittel gerundet, geklemmt [1,6]
//   SekII: Ereignis-Punkte = 9 + 6·score, ganzzahlig, geklemmt [0,15]
//   direkte note-Events (falls vorhanden): Mittel, dann 50:50 mit Ereignis-Note gemischt
//   Aktivitätsquote = beteiligte Termine / Kurstermine
//   Verlaufspfeil: score(2. Termin-Hälfte) − score(1. Hälfte) → ↑/→/↓ bei |Δ| > 0.15
//   LB-Schüler: Bilanz ja, Vorschlag null (kein m-Slot-Export).

import { noteAlsWert, rundeAufDrittel, wertZuLabel, klemmePunkte } from './skalen.mjs';

const SOMI_TYPEN = new Set(['+', 'o', '-']);
// fehlt_o (Anwesenheits-Stempel, Phase 3) zählt als Kurstermin — die Erfassung IST Evidenz,
// dass Unterricht war (Auflage 7). Aktiv-Quote korrigiert das über den e-Nenner.
const TERMIN_TYPEN = new Set(['+', 'o', '-', 'note', 'mat', 'ipad_fehlt', 'ipad_leer',
  'lernzeit', 'fehlt_e', 'fehlt_u', 'fehlt_o', 'versp', 'notiz', 'ha']);

function wirksameEvents(events) {
  const storniert = new Set(events.filter(e => e.stornoVon).map(e => e.stornoVon));
  return events.filter(e => !storniert.has(e.id));
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
  const direkte = meine.filter(e => e.typ === 'note');
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

  // uWirkt = geklärte unentschuldigte Termine fließen als 6/0 P ein (termingewichtet, nicht als
  // direkte Note — die hätte 50 % Kollektivgewicht und würde eine Fehlstunde massiv überbewerten).
  const uWirkt = uAls6 && nFehltU > 0;

  // Vorschlag (LB: keiner; ohne jede Grundlage: keiner)
  let vorschlag = null;
  if (!lb && (somi.length > 0 || direkte.length > 0 || uWirkt)) {
    if (profil === 'sek2') {
      // SomiPunkte termingewichtet mit 0 P je geklärter u-Stunde
      let punkte = somi.length ? 9 + 6 * bilanz.score : null;
      if (uWirkt) punkte = punkte === null ? 0 : (punkte * nSomi + 0 * nFehltU) / (nSomi + nFehltU);
      if (direkte.length) {
        const mittel = direkte.reduce((s, e) => s + noteAlsWert(e.wert, 'sek2'), 0) / direkte.length;
        punkte = punkte === null ? mittel : (punkte + mittel) / 2;
      }
      const p = klemmePunkte(punkte);
      vorschlag = { wert: p, label: String(p) + ' P' };
    } else {
      let note = somi.length ? 3 - 2 * bilanz.score : null;
      if (uWirkt) note = note === null ? 6 : (note * nSomi + 6 * nFehltU) / (nSomi + nFehltU);
      if (direkte.length) {
        const mittel = direkte.reduce((s, e) => s + noteAlsWert(e.wert, 'sek1'), 0) / direkte.length;
        note = note === null ? mittel : (note + mittel) / 2;
      }
      const w = rundeAufDrittel(note);
      vorschlag = { wert: w, label: wertZuLabel(w) };
    }
  }

  return {
    ...bilanz,
    beteiligtTermine: beteiligt.size,
    kursTermine: kursTermine.size,
    moeglicheTermine: moeglich,
    nFehltE, nFehltU, nFehltO,
    aktivQuote,
    pfeil,
    vorschlag,
    regelText: regelText(profil, uWirkt ? nFehltU : 0),
  };
}

function regelText(profil, nU = 0) {
  const basis = 'score = (n⁺ − n⁻) / (n⁺ + n° + n⁻) · Verlauf = 2. Hälfte − 1. Hälfte · direkte Noten zählen 50:50';
  const kopf = profil === 'sek2'
    ? 'Punkte-Vorschlag = 9 + 6·score (0–15) · '
    : 'Noten-Vorschlag = 3 − 2·score (Drittelnoten) · ';
  const uHinweis = nU > 0
    ? ' · ' + nU + ' unentschuldigte Stunde' + (nU > 1 ? 'n' : '') + ' als ' + (profil === 'sek2' ? '0 P' : '6') + ' termingewichtet'
    : '';
  return kopf + basis + uHinweis;
}

export { verdichte, wirksameEvents, regelText };
