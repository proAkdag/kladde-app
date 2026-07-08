// kladde/logic/autowahl · Kurs zur aktuellen Zeit (P2.2 · Plan Phase 2, Regeln präzisiert ggü. §25)
// 1. Ausnahme für heute+Block schlägt Wochenplan (kursId null = Entfall ⇒ frei).
// 2. Läuft ein Block → dessen Kurs. 3. Nächster Block in ≤ 10 min → dessen Kurs („kommend" —
//    in der 5-min-Pause will die Lehrkraft den kommenden Kurs sehen, nicht „frei").
// 4. Sonst null (UI zeigt Kurs-Schnellwahl). 5. A/B-Slots nur in passender Woche.
// INVARIANTE (verbotener Pfad 3): Diese Logik steuert NUR die Autowahl —
// Kurstermine entstehen ausschließlich aus Events, nie aus dem Plan.

import { resolveBloecke, istAWoche } from './zeitmodell.mjs';

const KOMMEND_FENSTER_SEK = 600;

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
  return { kursId: slot.kursId, teilgruppe: slot.teilgruppe ?? null, quelle: 'plan' };
}

// kursZurZeit(jetztDate, {zeitmodell, wochenplan, ausnahmen})
// → { kursId, blockNr, teilgruppe, quelle:'laufend'|'kommend'|'ausnahme' } | null
function kursZurZeit(jetzt, kontext) {
  const { zeitmodell } = kontext;
  if (!zeitmodell) return null;
  const wochentag = ((jetzt.getDay() + 6) % 7) + 1;            // Mo=1 … So=7
  if (wochentag > 5) return null;
  const datumIso = jetzt.getFullYear() + '-' + String(jetzt.getMonth() + 1).padStart(2, '0') + '-' + String(jetzt.getDate()).padStart(2, '0');
  const sek = jetzt.getHours() * 3600 + jetzt.getMinutes() * 60 + jetzt.getSeconds();
  const bloecke = resolveBloecke(zeitmodell, wochentag);

  const laufend = bloecke.find(b => b.startSek <= sek && sek <= b.endeSek);
  if (laufend) {
    const slot = slotFuerBlock(datumIso, wochentag, laufend.blockNr, kontext);
    if (slot && !slot.entfall) {
      return { kursId: slot.kursId, blockNr: laufend.blockNr, teilgruppe: slot.teilgruppe,
        quelle: slot.quelle === 'ausnahme' ? 'ausnahme' : 'laufend' };
    }
    // laufender Block ohne Slot/Entfall: NICHT ins Kommend-Fenster springen — frei
    return null;
  }
  const kommend = bloecke.find(b => b.startSek > sek && b.startSek - sek <= KOMMEND_FENSTER_SEK);
  if (kommend) {
    const slot = slotFuerBlock(datumIso, wochentag, kommend.blockNr, kontext);
    if (slot && !slot.entfall) {
      return { kursId: slot.kursId, blockNr: kommend.blockNr, teilgruppe: slot.teilgruppe,
        quelle: slot.quelle === 'ausnahme' ? 'ausnahme' : 'kommend' };
    }
  }
  return null;
}

export { kursZurZeit, slotFuerBlock, KOMMEND_FENSTER_SEK };
