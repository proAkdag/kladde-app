// kladde/logic/autowahl · Kurs zur aktuellen Zeit (P2.2 · Plan Phase 2, Regeln präzisiert ggü. §25)
// 1. Ausnahme für heute+Block schlägt Wochenplan (kursId null = Entfall ⇒ frei).
// 2. Läuft ein Block → dessen Kurs. 3. Nächster Block in ≤ 10 min → dessen Kurs („kommend" —
//    in der 5-min-Pause will die Lehrkraft den kommenden Kurs sehen, nicht „frei").
// 4. Sonst null (UI zeigt Kurs-Schnellwahl). 5. A/B-Slots nur in passender Woche.
// INVARIANTE (verbotener Pfad 3): Diese Logik steuert NUR die Autowahl —
// Kurstermine entstehen ausschließlich aus Events, nie aus dem Plan.
//
// Slot-ARTEN (Zero 2026-09-02): Klassenstunde und Reservestunde stehen im Wochenplan ohne Kurs
// (kursId null, art gesetzt). Sie tragen KEINE Bewertung — die Autowahl liefert sie mit `art`,
// die App wechselt dann keinen Kurs, zeigt aber, was laut Plan läuft.

import { resolveBloecke, istAWoche } from './zeitmodell.mjs';

const KOMMEND_FENSTER_SEK = 600;

const SLOT_ARTEN = {
  klasse:  { label: 'Klassenstunde', kurz: 'Klassenstd.' },
  reserve: { label: 'Reservestunde', kurz: 'Reserve' },
};

function slotFuerBlock(datumIso, wochentag, blockNr, { wochenplan, ausnahmen, zeitmodell }) {
  const ausnahme = (ausnahmen || []).find(a => a.datum === datumIso && a.blockNr === blockNr);
  if (ausnahme) {
    if (!ausnahme.kursId) return { entfall: true };            // Entfall
    return { kursId: ausnahme.kursId, teilgruppe: ausnahme.teilgruppe ?? null, quelle: 'ausnahme' };
  }
  const woche = istAWoche(datumIso, zeitmodell.abWochenAnker);
  const slot = (wochenplan || []).find(w =>
    w.wochentag === wochentag && w.blockNr === blockNr &&
    (w.rhythmus === 'jede' || !w.rhythmus || w.rhythmus === woche));
  if (!slot) return null;
  // `art` nur mitgeben, wenn gesetzt — Aufrufer vergleichen das Ergebnis strukturell (deepEqual)
  return { kursId: slot.kursId ?? null, ...(slot.art ? { art: slot.art } : {}), teilgruppe: slot.teilgruppe ?? null, quelle: 'plan' };
}

// kursZurZeit(jetztDate, {zeitmodell, wochenplan, ausnahmen})
// → { kursId, blockNr, teilgruppe, quelle:'laufend'|'kommend'|'ausnahme' [, art] } | null
function kursZurZeit(jetzt, kontext) {
  const { zeitmodell } = kontext;
  if (!zeitmodell) return null;
  const wochentag = ((jetzt.getDay() + 6) % 7) + 1;            // Mo=1 … So=7
  if (wochentag > 5) return null;
  const datumIso = jetzt.getFullYear() + '-' + String(jetzt.getMonth() + 1).padStart(2, '0') + '-' + String(jetzt.getDate()).padStart(2, '0');
  const sek = jetzt.getHours() * 3600 + jetzt.getMinutes() * 60 + jetzt.getSeconds();
  const bloecke = resolveBloecke(zeitmodell, wochentag, datumIso); // Kurztag-Daten liefern das Zweitraster (S256b)

  const treffer = (slot, blockNr, sonst) => ({
    kursId: slot.kursId, blockNr, teilgruppe: slot.teilgruppe,
    quelle: slot.quelle === 'ausnahme' ? 'ausnahme' : sonst,
    ...(slot.art ? { art: slot.art } : {}),
  });
  const laufend = bloecke.find(b => b.startSek <= sek && sek <= b.endeSek);
  if (laufend) {
    const slot = slotFuerBlock(datumIso, wochentag, laufend.blockNr, kontext);
    if (slot && !slot.entfall) return treffer(slot, laufend.blockNr, 'laufend');
    // laufender Block ohne Slot/Entfall: NICHT ins Kommend-Fenster springen — frei
    return null;
  }
  const kommend = bloecke.find(b => b.startSek > sek && b.startSek - sek <= KOMMEND_FENSTER_SEK);
  if (kommend) {
    const slot = slotFuerBlock(datumIso, wochentag, kommend.blockNr, kontext);
    if (slot && !slot.entfall) return treffer(slot, kommend.blockNr, 'kommend');
  }
  return null;
}

// Blöcke eines Tages, an denen laut WOCHENPLAN etwas stattfindet (Ausnahmen bewusst ignoriert).
// Der Tages-Entfall schreibt nur für diese — eine freie Stunde kann nicht ausfallen
// (Zero 2026-09-02: „bei Tagesausfall werden auch freie Stunden als ausfallend eingetragen").
function geplanteBlockNrn(datumIso, wochentag, bloecke, kontext) {
  const ohneAusnahmen = { ...kontext, ausnahmen: [] };
  return bloecke.filter(b => slotFuerBlock(datumIso, wochentag, b.blockNr, ohneAusnahmen)).map(b => b.blockNr);
}

function wochentagVon(datumIso) {
  const [y, m, d] = String(datumIso).split('-').map(Number);
  return ((new Date(y, m - 1, d).getDay() + 6) % 7) + 1;
}

// Alt-Bestand heilen: Entfall-Einträge (kursId null) auf Blöcken OHNE Plan sind folgenlos
// (die Autowahl hätte dort ohnehin „frei" gesagt), standen aber als „entfällt" im Tagesblick.
// Vertretungen (kursId gesetzt) bleiben immer. IDEMPOTENT, kein rev-Bump (wie migriereStamm:
// beide Geräte heilen lokal, ein künstlicher Konflikt wäre nur Merge-Lärm). → true = geändert.
function bereinigeAusnahmen(stamm) {
  const zm = (stamm.zeitmodelle || [])[0];
  const alt = stamm.ausnahmeSlots || [];
  if (!zm || !alt.length) return false;
  const kontext = { wochenplan: stamm.wochenplan || [], ausnahmen: [], zeitmodell: zm };
  const neu = alt.filter(a => a.kursId || !!slotFuerBlock(a.datum, wochentagVon(a.datum), a.blockNr, kontext));
  if (neu.length === alt.length) return false;
  stamm.ausnahmeSlots = neu;
  return true;
}

export { kursZurZeit, slotFuerBlock, geplanteBlockNrn, bereinigeAusnahmen, SLOT_ARTEN, KOMMEND_FENSTER_SEK };
