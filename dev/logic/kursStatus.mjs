// kladde/logic/kursStatus · Kurs-Zustand für die Kurskarten-Badges (P4.2 · „Klasse auf einen Blick")
// Rein: nimmt WIRKSAME Events EINES Kurses + Kontext, gibt einen Ton + Code zurück.
// Formatierung (Datum, Text) bleibt in der UI — hier keine DOM-/Locale-Abhängigkeit (Node-getestet).
//
// Präzedenz: archiviert > läuft gerade > offene Fehlzeiten > leer > aktiv.
// „läuft gerade" und „N offen" sind zwei unabhängige Fakten (Codex-Audit 2026-07-10):
// der Live-Zustand bleibt primär, offene Fehlzeiten reisen als `offen`-Zähler mit,
// statt ihn zu verdrängen — die Karte zeigt dann beides.

export function kursStatus(kurs, { events = [], jetztLaeuft = false } = {}) {
  if (kurs && kurs.status === 'archiviert') return { ton: 'archiv', code: 'archiviert' };
  const offen = events.filter(e => e.typ === 'fehlt_o').length;
  if (jetztLaeuft) return { ton: 'jetzt', code: 'jetzt', offen };
  if (offen) return { ton: 'warn', code: 'offen', n: offen };
  if (!events.length) return { ton: 'leise', code: 'leer' };
  const letzterDatum = events.reduce((a, e) => (e.datum && e.datum > a) ? e.datum : a, '');
  return { ton: 'ok', code: 'aktiv', letzterDatum };
}
