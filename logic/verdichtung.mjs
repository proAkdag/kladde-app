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
const TERMIN_TYPEN = new Set(['+', 'o', '-', 'note', 'mat', 'ipad_fehlt', 'ipad_leer',
  'lernzeit', 'fehlt_e', 'fehlt_u', 'versp', 'notiz', 'ha']);

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

  const wirksam = wirksameEvents(kursEvents)
    .filter(e => { const t = terminVon(e); return t >= von && t <= bis; });

  const kursTermine = new Set(
    wirksam.filter(e => TERMIN_TYPEN.has(e.typ)).map(terminVon));
  const meine = wirksam.filter(e => e.schuelerNr === schuelerNr);
  const somi = meine.filter(e => SOMI_TYPEN.has(e.typ));
  const direkte = meine.filter(e => e.typ === 'note');
  const beteiligt = new Set(
    meine.filter(e => SOMI_TYPEN.has(e.typ) || e.typ === 'note').map(terminVon));

  const bilanz = scoreVon(somi);
  const aktivQuote = kursTermine.size ? beteiligt.size / kursTermine.size : 0;

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

  // Vorschlag (LB: keiner; ohne jede Grundlage: keiner)
  let vorschlag = null;
  if (!lb && (somi.length > 0 || direkte.length > 0)) {
    if (profil === 'sek2') {
      let punkte = somi.length ? 9 + 6 * bilanz.score : null;
      if (direkte.length) {
        const mittel = direkte.reduce((s, e) => s + noteAlsWert(e.wert, 'sek2'), 0) / direkte.length;
        punkte = punkte === null ? mittel : (punkte + mittel) / 2;
      }
      const p = klemmePunkte(punkte);
      vorschlag = { wert: p, label: String(p) + ' P' };
    } else {
      let note = somi.length ? 3 - 2 * bilanz.score : null;
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
    aktivQuote,
    pfeil,
    vorschlag,
    regelText: regelText(profil),
  };
}

function regelText(profil) {
  const basis = 'score = (n⁺ − n⁻) / (n⁺ + n° + n⁻) · Verlauf = 2. Hälfte − 1. Hälfte · direkte Noten zählen 50:50';
  return profil === 'sek2'
    ? 'Punkte-Vorschlag = 9 + 6·score (0–15) · ' + basis
    : 'Noten-Vorschlag = 3 − 2·score (Drittelnoten) · ' + basis;
}

export { verdichte, wirksameEvents, regelText };
