// kladde/logic/merge · Zwei-Geräte-Merge (kladde/v1)
// Events sind append-only mit Storno → Union nach id ist konfliktfrei by design.
// Stammdaten tragen einen Revisions-Zähler: höhere rev gewinnt; gleiche rev mit
// abweichendem Inhalt = ECHTER Konflikt → später ts gewinnt, Verlierer wird beigelegt
// und gemeldet (Prüfstein 3: Konflikt sichtbar, kein Datenverlust).

function mergeEvents(eventsA, eventsB) {
  const nachId = new Map();
  for (const e of [...eventsA, ...eventsB]) {
    const vorhanden = nachId.get(e.id);
    if (!vorhanden || String(e.ts) > String(vorhanden.ts)) nachId.set(e.id, e);
  }
  return [...nachId.values()].sort((a, b) =>
    String(a.ts) < String(b.ts) ? -1 : String(a.ts) > String(b.ts) ? 1 :
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function inhaltGleich(a, b) {
  const { rev: _ra, ts: _ta, geraet: _ga, ...restA } = a;
  const { rev: _rb, ts: _tb, geraet: _gb, ...restB } = b;
  return JSON.stringify(restA) === JSON.stringify(restB);
}

function mergeStammdaten(a, b) {
  if (!a) return { ergebnis: b, konflikt: null, verworfen: null };
  if (!b) return { ergebnis: a, konflikt: null, verworfen: null };
  if (a.rev !== b.rev) {
    const [sieger, verlierer] = a.rev > b.rev ? [a, b] : [b, a];
    return { ergebnis: sieger, konflikt: null, verworfen: verlierer };
  }
  if (inhaltGleich(a, b)) return { ergebnis: a, konflikt: null, verworfen: null };
  const [sieger, verlierer] = String(a.ts) >= String(b.ts) ? [a, b] : [b, a];
  return {
    ergebnis: sieger,
    verworfen: verlierer,
    konflikt: 'Stammdaten-Konflikt bei rev ' + a.rev + ': ' +
      verlierer.geraet + ' (' + verlierer.ts + ') unterlag ' +
      sieger.geraet + ' (' + sieger.ts + ') — verworfener Stand liegt bei.',
  };
}

function mergeContainerDaten(a, b) {
  const konflikte = [];
  const stamm = mergeStammdaten(a.stamm, b.stamm);
  if (stamm.konflikt) konflikte.push(stamm.konflikt);
  return {
    daten: {
      schema: a.schema || b.schema || 'kladde/v1',
      stamm: stamm.ergebnis,
      events: mergeEvents(a.events || [], b.events || []),
    },
    verworfen: stamm.verworfen,
    konflikte,
  };
}

export { mergeEvents, mergeStammdaten, mergeContainerDaten };
