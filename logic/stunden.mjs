// kladde/logic/stunden · „Stunde“ = Kurs + Datum (Zero 2026-10-01, Untermenü-Runde Scheibe 1)
// ‹ › springt zur vorigen/nächsten Stunde DIESES Kurses laut Plan: Wochenplan + A/B-Woche + Ausnahmen
// (Vertretung zählt, Entfall nicht) + Ferien + Kurztage. Ein Termin hängt am Datum — zwei Stunden
// desselben Kurses an einem Tag sind EIN Ziel. Pure Funktionen, kein DOM.
// INVARIANTE (wie autowahl.mjs): Der Plan steuert nur die Navigation — Termine entstehen aus Events.

import { resolveBloecke, istFerien } from './zeitmodell.mjs';
import { slotFuerBlock, KOMMEND_FENSTER_SEK } from './autowahl.mjs';

const MAX_TAGE = 120;   // reicht über Sommerferien (≤ 6,5 Wochen) hinweg

function wochentagVon(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;   // Mo=1 … So=7
}
function tagPlus(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// tagesStunden(datum, {zeitmodell, wochenplan, ausnahmen}) → [{blockNr, startSek, endeSek, kursId, teilgruppe, quelle[, art]}]
// Alle Stunden des Tages in Block-Reihenfolge, AUCH die ausgefallenen: quelle 'entfall' mit Kurs und Gruppe des Plans —
// der Stundenplan zeigt sie durchgestrichen und nimmt sie zurück (Scheibe 2, Zero 02.10.). Ein Entfall auf einer laut
// Plan freien Stunde fällt weg (dort fällt nichts aus). Klassen-/Reservestunde (kursId null, art) bleibt.
function tagesStunden(datumIso, kontext) {
  const zm = kontext && kontext.zeitmodell;
  if (!zm) return [];
  const wt = wochentagVon(datumIso);
  if (wt > 5 || istFerien(zm, datumIso)) return [];
  const ohneAusnahmen = { ...kontext, ausnahmen: [] };
  return resolveBloecke(zm, wt, datumIso).map(b => {
    const s = slotFuerBlock(datumIso, wt, b.blockNr, kontext);
    if (!s) return null;
    if (!s.entfall) return { ...b, ...s };
    const p = slotFuerBlock(datumIso, wt, b.blockNr, ohneAusnahmen);
    return p ? { ...b, ...p, quelle: 'entfall' } : null;
  }).filter(Boolean);
}

// stundenAm(datum, kontext) → die Stunden, die stattfinden (Entfall fällt heraus) — Grundlage von ‹ › und „Stunde wählen“
function stundenAm(datumIso, kontext) {
  return tagesStunden(datumIso, kontext).filter(s => s.quelle !== 'entfall');
}

// stundeDesKurses(kursId, datum, kontext) → erste Stunde des Kurses an diesem Tag oder null
function stundeDesKurses(kursId, datumIso, kontext) {
  return stundenAm(datumIso, kontext).find(s => s.kursId === kursId) || null;
}

// kursTag(kursId, datum, kontext) → Stunde des Kurses laut Plan; sonst an einem Tag mit Einträgen (kontext.eintragsTage: Set der
// Daten) {blockNr: null, teilgruppe: null, quelle: 'eintraege'}; sonst null. Planwechsel (Zero 02.10.): Der Assistent ersetzt den
// Plan ohne „gilt ab“ — ‹ › rechnete rückwärts mit dem neuen Plan und übersprang Tage, an denen unterrichtet wurde.
function kursTag(kursId, datumIso, kontext) {
  const st = stundeDesKurses(kursId, datumIso, kontext);
  if (st) return st;
  return kontext && kontext.eintragsTage && kontext.eintragsTage.has(datumIso) ? { blockNr: null, teilgruppe: null, quelle: 'eintraege' } : null;
}

// naechsteStunde(kursId, datum, richtung ±1, kontext, bis?) → {datum, blockNr, teilgruppe} | null
// Sucht ab dem Nachbartag; `bis` (heute) wird nie überschritten — Nachtrag geht nur in die Vergangenheit.
// teilgruppe: Halbgruppe der Zielstunde (null = ganzer Kurs) — sonst zeigte ‹ › die Gruppe des Ausgangstags (Prüfer 2026-10-01)
// Hält auch an Tagen mit Einträgen (kursTag), dort ohne Block.
function naechsteStunde(kursId, datumIso, richtung, kontext, bis = null) {
  for (let i = 1; i <= MAX_TAGE; i++) {
    const d = tagPlus(datumIso, richtung * i);
    if (bis && d > bis) return null;
    const st = kursTag(kursId, d, kontext);
    if (st) return { datum: d, blockNr: st.blockNr, teilgruppe: st.teilgruppe || null };
  }
  return null;
}

// ── Welche Stunde betrifft eine Buchung? (v1.17.1 Blockmodell, Zero 03.10.: „Alles zusammen nach dem Blockmodell“)
// Ein Termin bleibt der Tag; die Stunde ist nur für Verspätung und ∅ eine eigene Größe (Doppelstunde: „Dazuzählen, wenn es ein späterer
// Block ist“). Eine Buchung gehört zu einer EIGENEN Stunde des Kurses (Plan, Vertretung) oder zu dem Block, für den der Kurs jetzt von Hand
// gewählt wurde (Zero 03.10. ~16:3x: „Nur wenn jetzt gewählt“). Ein fremder laufender Block zählt nie: vorher buchte ⏰ nach einer Freistunde,
// im Deck über das Stundenende hinaus oder nach einer abgelaufenen Wahl Minuten eines fremden Blocks dazu (Prüfer 03.10., zweite Runde 🔴 1).
function ortszeit(jetzt) {
  const iso = jetzt.getFullYear() + '-' + String(jetzt.getMonth() + 1).padStart(2, '0') + '-' + String(jetzt.getDate()).padStart(2, '0');
  return { iso, sek: jetzt.getHours() * 3600 + jetzt.getMinutes() * 60 + jetzt.getSeconds() };
}
function schulBloecke(datumIso, kontext) {
  const zm = kontext && kontext.zeitmodell;
  if (!zm) return [];
  const wt = wochentagVon(datumIso);
  return wt > 5 || istFerien(zm, datumIso) ? [] : resolveBloecke(zm, wt, datumIso);
}
// stundeFuerBuchung(kontext, {jetzt, termin, kursId, gewaehlt, handBlock}) → {blockNr, startSek, endeSek, laeuft} | null
//   gewaehlt  = Block der in „Stunde wählen“ gewählten Stunde. Sie hält bis zur nächsten Wahl, „Heute“/‹ › oder einem Kurswechsel (Zero: „Wahl hält“).
//   handBlock = Block, für den der Kurs heute über „Alle Kurse“ oder die Kurskarte von Hand gewählt wurde — zählt wie eine eigene Stunde.
//   1. gewählte Stunde → sie · 2. Nachtrag ohne Wahl → null (Tagesregel, wie Prod)
//   3. heute: die laufende oder gerade beendete eigene Stunde (Doppelstunde: die Korrektur in der Pause bleibt in Block 2); sonst die eigene,
//      die in ≤ 10 min beginnt (Anwesenheit vor dem Gong); sonst die zuletzt begonnene eigene; sonst die erste eigene des Tages; sonst null
// laeuft = der Block läuft jetzt (nur dann gibt es einen Minutenvorschlag).
function stundeFuerBuchung(kontext, { jetzt, termin, kursId, gewaehlt = null, handBlock = null }) {
  const { iso, sek } = ortszeit(jetzt);
  const heute = termin === iso;
  const mit = b => ({ blockNr: b.blockNr, startSek: b.startSek ?? null, endeSek: b.endeSek ?? null,
    laeuft: heute && b.startSek != null && b.startSek <= sek && sek <= b.endeSek });
  if (gewaehlt != null) return mit(schulBloecke(termin, kontext).find(b => b.blockNr === gewaehlt) || { blockNr: gewaehlt });
  if (!heute) return null;
  const bl = schulBloecke(iso, kontext), wt = wochentagVon(iso);
  const eigen = b => { if (b.blockNr === handBlock) return true; const s = slotFuerBlock(iso, wt, b.blockNr, kontext); return !!s && !s.entfall && s.kursId === kursId; };
  const eigene = bl.filter(eigen);
  const begonnen = bl.filter(b => b.startSek <= sek).pop();   // der laufende oder gerade beendete Block
  const b = (begonnen && eigene.includes(begonnen) && begonnen) ||
    eigene.find(x => x.startSek > sek && x.startSek - sek <= KOMMEND_FENSTER_SEK) ||
    eigene.filter(x => x.startSek <= sek).pop() || eigene[0];
  return b ? mit(b) : null;
}

// kalenderwoche(datum) → ISO-Kalenderwoche (der Donnerstag der Woche entscheidet das Jahr) — Kopf des Reiters „Woche“
function kalenderwoche(datumIso) {
  const [y, m, d] = datumIso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
  const j = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - j) / 86400000 - 3 + ((j.getUTCDay() + 6) % 7)) / 7);
}

export { tagesStunden, stundenAm, stundeDesKurses, kursTag, naechsteStunde, kalenderwoche, tagPlus, wochentagVon, stundeFuerBuchung };
