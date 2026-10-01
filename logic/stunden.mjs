// kladde/logic/stunden · „Stunde“ = Kurs + Datum (Zero 2026-10-01, Untermenü-Runde Scheibe 1)
// ‹ › springt zur vorigen/nächsten Stunde DIESES Kurses laut Plan: Wochenplan + A/B-Woche + Ausnahmen
// (Vertretung zählt, Entfall nicht) + Ferien + Kurztage. Ein Termin hängt am Datum — zwei Stunden
// desselben Kurses an einem Tag sind EIN Ziel. Pure Funktionen, kein DOM.
// INVARIANTE (wie autowahl.mjs): Der Plan steuert nur die Navigation — Termine entstehen aus Events.

import { resolveBloecke, istFerien } from './zeitmodell.mjs';
import { slotFuerBlock } from './autowahl.mjs';

const MAX_TAGE = 120;   // reicht über Sommerferien (≤ 6,5 Wochen) hinweg

function wochentagVon(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;   // Mo=1 … So=7
}
function tagPlus(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// stundenAm(datum, {zeitmodell, wochenplan, ausnahmen}) → [{blockNr, startSek, endeSek, kursId, teilgruppe, quelle[, art]}]
// Alle Stunden des Tages in Block-Reihenfolge; Entfall fällt heraus, Klassen-/Reservestunde (kursId null, art) bleibt.
function stundenAm(datumIso, kontext) {
  const zm = kontext && kontext.zeitmodell;
  if (!zm) return [];
  const wt = wochentagVon(datumIso);
  if (wt > 5 || istFerien(zm, datumIso)) return [];
  return resolveBloecke(zm, wt, datumIso)
    .map(b => { const s = slotFuerBlock(datumIso, wt, b.blockNr, kontext); return s && !s.entfall ? { ...b, ...s } : null; })
    .filter(Boolean);
}

// stundeDesKurses(kursId, datum, kontext) → erste Stunde des Kurses an diesem Tag oder null
function stundeDesKurses(kursId, datumIso, kontext) {
  return stundenAm(datumIso, kontext).find(s => s.kursId === kursId) || null;
}

// naechsteStunde(kursId, datum, richtung ±1, kontext, bis?) → {datum, blockNr, teilgruppe} | null
// Sucht ab dem Nachbartag; `bis` (heute) wird nie überschritten — Nachtrag geht nur in die Vergangenheit.
// teilgruppe: Halbgruppe der Zielstunde (null = ganzer Kurs) — sonst zeigte ‹ › die Gruppe des Ausgangstags (Prüfer 2026-10-01)
function naechsteStunde(kursId, datumIso, richtung, kontext, bis = null) {
  for (let i = 1; i <= MAX_TAGE; i++) {
    const d = tagPlus(datumIso, richtung * i);
    if (bis && d > bis) return null;
    const st = stundeDesKurses(kursId, d, kontext);
    if (st) return { datum: d, blockNr: st.blockNr, teilgruppe: st.teilgruppe || null };
  }
  return null;
}

export { stundenAm, stundeDesKurses, naechsteStunde, tagPlus, wochentagVon };
