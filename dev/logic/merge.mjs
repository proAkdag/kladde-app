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

// Sicherer Import (Zero 2026-09-29: „den sicheren Weg fürs Importieren implementieren"): Der Stand mit höherer rev
// bleibt die Basis — auch für Stundenplan, Zeitmodelle, Einstellungen (dort brächte eine Vereinigung gelöschte Slots
// zurück). Aber Kurse und Schüler, die NUR im anderen Stand stehen, gingen bisher still verloren, und ihre Events
// hingen verwaist im Log (Prüfer 2026-09-29: neuer Schüler Nr 29 auf dem iPad, drei Sitzplan-Züge am PC → weg).
// Sie werden jetzt ergänzt und gemeldet. Gleiche Nr mit anderem Namen = Konflikt (Basis behält, Meldung sichtbar).
function ergaenzeAusVerlierer(sieger, verlierer) {
  const hinweise = [], konflikte = [];
  if (!verlierer) return { stamm: sieger, hinweise, konflikte };
  const s = JSON.parse(JSON.stringify(sieger));
  s.kurse = s.kurse || []; s.schueler = s.schueler || {};
  const basisKurse = new Map(s.kurse.map(k => [k.id, k]));
  for (const k of verlierer.kurse || []) {
    if (basisKurse.has(k.id)) continue;
    s.kurse.push(k);
    s.schueler[k.id] = (verlierer.schueler || {})[k.id] || [];
    for (const feld of ['sitzplaene', 'kursprofile']) {
      if (verlierer[feld] && verlierer[feld][k.id]) s[feld] = { ...(s[feld] || {}), [k.id]: verlierer[feld][k.id] };
    }
    hinweise.push('Kurs ' + k.name + (k.fach ? ' · ' + k.fach : '') + ' aus dem anderen Stand ergänzt');
  }
  for (const [kid, liste] of Object.entries(verlierer.schueler || {})) {
    const kurs = basisKurse.get(kid); if (!kurs) continue;   // Kurs nur im Verlierer: oben vollständig übernommen
    const eigen = s.schueler[kid] || [];
    const nachNr = new Map(eigen.map(x => [x.nr, x]));
    const neu = [...eigen];
    for (const x of liste || []) {
      const da = nachNr.get(x.nr);
      const wer = (x.vorname || '') + ' ' + (x.name || '');
      if (!da) { neu.push(x); hinweise.push(kurs.name + ': Nr ' + x.nr + ' ' + wer.trim() + ' ergänzt'); }
      else if ((da.vorname || '') !== (x.vorname || '') || (da.name || '') !== (x.name || '')) {
        konflikte.push(kurs.name + ' Nr ' + x.nr + ': „' + ((da.vorname || '') + ' ' + (da.name || '')).trim() + '" (' + sieger.geraet + ') ≠ „' + wer.trim() + '" (' + verlierer.geraet + ') — ' + sieger.geraet + ' behalten, bitte prüfen.');
      }
    }
    neu.sort((a, b) => a.nr - b.nr);
    s.schueler[kid] = neu;
  }
  return { stamm: s, hinweise, konflikte };
}

function mergeStammdaten(a, b) {
  if (!a) return { ergebnis: b, konflikt: null, verworfen: null, hinweise: [], konflikte: [] };
  if (!b) return { ergebnis: a, konflikt: null, verworfen: null, hinweise: [], konflikte: [] };
  if (a.rev !== b.rev) {
    const [sieger, verlierer] = a.rev > b.rev ? [a, b] : [b, a];
    const erg = ergaenzeAusVerlierer(sieger, verlierer);
    return { ergebnis: erg.stamm, konflikt: null, verworfen: verlierer, hinweise: erg.hinweise, konflikte: erg.konflikte };
  }
  if (inhaltGleich(a, b)) return { ergebnis: a, konflikt: null, verworfen: null, hinweise: [], konflikte: [] };
  const [sieger, verlierer] = String(a.ts) >= String(b.ts) ? [a, b] : [b, a];
  const erg = ergaenzeAusVerlierer(sieger, verlierer);
  return {
    ergebnis: erg.stamm,
    verworfen: verlierer,
    hinweise: erg.hinweise,
    konflikte: erg.konflikte,
    konflikt: 'Stammdaten-Konflikt bei rev ' + a.rev + ': ' +
      verlierer.geraet + ' (' + verlierer.ts + ') unterlag ' +
      sieger.geraet + ' (' + sieger.ts + ') — verworfener Stand liegt bei.',
  };
}

function mergeContainerDaten(a, b) {
  const konflikte = [];
  const stamm = mergeStammdaten(a.stamm, b.stamm);
  konflikte.push(...(stamm.konflikte || []));   // Namens-Konflikte zuerst — die Vorschau zeigt den ersten
  if (stamm.konflikt) konflikte.push(stamm.konflikt);
  return {
    daten: {
      schema: a.schema || b.schema || 'kladde/v1',
      stamm: stamm.ergebnis,
      events: mergeEvents(a.events || [], b.events || []),
    },
    verworfen: stamm.verworfen,
    konflikte,
    hinweise: stamm.hinweise || [],
  };
}

export { mergeEvents, mergeStammdaten, mergeContainerDaten };
