// kladde/logic/kursStatus · Kurs-Zustand für die Kurskarten-Badges (P4.2 · „Klasse auf einen Blick")
// Rein: nimmt WIRKSAME Events EINES Kurses + Kontext, gibt einen Ton + Code zurück.
// Formatierung (Datum, Text) bleibt in der UI — hier keine DOM-/Locale-Abhängigkeit (Node-getestet).
//
// Präzedenz (was Aufmerksamkeit braucht, gewinnt): archiviert > offene Fehlzeiten > läuft gerade > leer > aktiv.
// Begründung: die Kurse-Ansicht ist Verwaltung — das offene To-do (Fehlzeit klären) schlägt die
// bloße Info „läuft gerade" (die sieht man ohnehin in „Heute").

export function kursStatus(kurs, { events = [], jetztLaeuft = false } = {}) {
  if (kurs && kurs.status === 'archiviert') return { ton: 'archiv', code: 'archiviert' };
  const offen = events.filter(e => e.typ === 'fehlt_o').length;
  if (offen) return { ton: 'warn', code: 'offen', n: offen };
  if (jetztLaeuft) return { ton: 'jetzt', code: 'jetzt' };
  if (!events.length) return { ton: 'leise', code: 'leer' };
  const letzterDatum = events.reduce((a, e) => (e.datum && e.datum > a) ? e.datum : a, '');
  return { ton: 'ok', code: 'aktiv', letzterDatum };
}
