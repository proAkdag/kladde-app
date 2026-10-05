// kladde/logic/merge · Zwei-Geräte-Merge (kladde/v1)
// Events sind append-only mit Storno → Union nach id ist konfliktfrei by design.
// Stammdaten tragen einen Revisions-Zähler: höhere rev gewinnt; gleiche rev mit
// abweichendem Inhalt = ECHTER Konflikt → später ts gewinnt, Verlierer wird beigelegt
// und gemeldet (Prüfstein 3: Konflikt sichtbar, kein Datenverlust).

import { lnr, nachListe } from './teilnehmer.mjs';

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

// ── Lösch-Markierungen (Prüfer 2026-09-29: „Endgültig löschen“ war nicht endgültig) ──
// stamm.geloescht = { [kursId]: { am, wieder? } }. „Endgültig löschen“ setzt `am`; legt man später einen Kurs mit derselben
// id neu an (dieselbe Mappe noch einmal), setzt stammMutiert → hebeLoeschungAuf `wieder`. Beim Merge gilt je Feld der
// jüngste Zeitpunkt beider Geräte. Ohne Markierung holte der sichere Import (ergaenzeAusVerlierer) einen gelöschten Kurs
// aus dem älteren Stand des zweiten Geräts zurück, und die Event-Union brachte alle seine Einträge mit.
function istGeloescht(l) {
  return Boolean(l && l.am && !(l.wieder && String(l.wieder) > String(l.am)));
}
function vereinigeLoeschungen(a, b) {
  const out = {};
  for (const [id, x] of [...Object.entries(a || {}), ...Object.entries(b || {})]) {
    const c = out[id];
    if (!c) { out[id] = { ...x }; continue; }
    if (String(x.am || '') > String(c.am || '')) c.am = x.am;
    if (x.wieder && String(x.wieder) > String(c.wieder || '')) c.wieder = x.wieder;
  }
  return out;
}
// Ein Kurs, der (wieder) im Stamm steht, obwohl er als gelöscht markiert ist, wurde neu angelegt → Markierung aufheben.
function hebeLoeschungAuf(stamm, jetzt) {
  for (const k of stamm.kurse || []) {
    const l = stamm.geloescht && stamm.geloescht[k.id];
    if (istGeloescht(l)) l.wieder = jetzt;
  }
}
// Entfernt gelöschte Kurse samt Liste, Sitzplan, Profil, Stundenplan-Slots und Einträgen — auf Kopien, nie in place
// (die Import-Vorschau rechnet auf dem lebenden Tresor). Einträge eines neu angelegten Kurses bleiben, sofern sie
// jünger sind als die Löschung.
function wendeLoeschungenAn(stamm, events, loesch) {
  const ids = Object.keys(loesch || {});
  if (!ids.length) return { stamm, events, hinweise: [] };
  const s = { ...stamm, geloescht: loesch };
  const weg = new Set(ids.filter(id => istGeloescht(loesch[id])));
  const hinweise = [];
  if (weg.size) {
    s.kurse = (stamm.kurse || []).filter(k => !weg.has(k.id));
    for (const feld of ['schueler', 'sitzplaene', 'kursprofile']) {
      if (!stamm[feld]) continue;
      s[feld] = { ...stamm[feld] };
      for (const id of weg) delete s[feld][id];
    }
    if (Array.isArray(stamm.wochenplan)) s.wochenplan = stamm.wochenplan.filter(w => !weg.has(w.kursId));
  }
  const vorher = events.length;
  const ev = events.filter(e => {
    const l = loesch[e.kursId];
    if (!l) return true;
    return !weg.has(e.kursId) && String(e.ts) > String(l.am);
  });
  if (ev.length < vorher) hinweise.push((vorher - ev.length) + ' Einträge gelöschter Kurse nicht zurückgeholt');
  return { stamm: s, events: ev, hinweise };
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
function ergaenzeAusVerlierer(sieger, verlierer, loesch) {
  const hinweise = [], konflikte = [], sammel = [];
  if (!verlierer) return { stamm: sieger, hinweise, konflikte };
  const s = JSON.parse(JSON.stringify(sieger));
  s.kurse = s.kurse || []; s.schueler = s.schueler || {};
  const basisKurse = new Map(s.kurse.map(k => [k.id, k]));
  for (const k of verlierer.kurse || []) {
    // Höchstmarke der Ausweis-Nr (Prüfer 05.10. R4): die höhere beider Stände gilt — eine schon vergebene Nr kommt nie zurück
    const b = basisKurse.get(k.id);
    if (b && (k.ausweisBis || 0) > (b.ausweisBis || 0)) b.ausweisBis = k.ausweisBis;
    if (basisKurse.has(k.id) || istGeloescht((loesch || {})[k.id])) continue;   // gelöscht bleibt gelöscht
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
    const neu = [...eigen], abweichend = [];
    for (const x of liste || []) {
      const da = nachNr.get(x.nr);   // Abgleich über die Ausweis-Nr (sie trägt die Einträge); gemeldet wird die Listen-Nr
      const wer = (x.vorname || '') + ' ' + (x.name || '');
      if (!da) { neu.push(x); hinweise.push(kurs.name + ': ' + nrText(x) + ' ' + wer.trim() + ' ergänzt'); }
      else if ((da.vorname || '') !== (x.vorname || '') || (da.name || '') !== (x.name || '')) {
        konflikte.push(kurs.name + ' ' + nrText(da) + ': „' + ((da.vorname || '') + ' ' + (da.name || '')).trim() + '" (' + sieger.geraet + ') ≠ „' + wer.trim() + '" (' + verlierer.geraet + ') — ' + sieger.geraet + ' behalten, bitte prüfen.');
      }
      // Zwei Nummern (Prüfer 05.10. Y7): eine Umnummerierung oder ein Abgang im unterlegenen Stand ginge sonst still verloren
      else if (lnr(da) !== lnr(x) || !!da.inaktiv !== !!x.inaktiv) {
        const anders = [lnr(da) !== lnr(x) ? 'Listen-Nr ' + (lnr(da) ?? 'keine') + ' (' + sieger.geraet + ') ≠ ' + (lnr(x) ?? 'keine') + ' (' + verlierer.geraet + ')' : null,
          !!da.inaktiv !== !!x.inaktiv ? (da.inaktiv ? 'inaktiv' : 'aktiv') + ' (' + sieger.geraet + '), ' + (x.inaktiv ? 'inaktiv' : 'aktiv') + ' (' + verlierer.geraet + ')' : null].filter(Boolean);
        abweichend.push(nrText(da) + ' ' + wer.trim() + ': ' + anders.join(', '));
      }
    }
    // Eine Meldung je Kurs, neutral (Nachprüfung N1): ohne gemeinsamen Vorgänger ist nicht entscheidbar, welcher Stand die Mappe
    // trägt — im Normalfall ist der übernommene der neuere, dann stimmt alles; sonst klärt „Mappe laden“ es
    if (abweichend.length) sammel.push(kurs.name + ': ' + abweichend.length + (abweichend.length === 1 ? ' Kind steht' : ' Kinder stehen')
      + ' in den beiden Ständen verschieden (' + abweichend.slice(0, 3).join(' · ') + (abweichend.length > 3 ? ' · … und ' + (abweichend.length - 3) + ' weitere' : '')
      + ') — übernommen: Stand ' + sieger.geraet + ', verworfen: Stand ' + verlierer.geraet + '. Passt das nicht zur Mappe, die Mappe neu laden (Kurse → Kurs anlegen → Mappe laden).');
    neu.sort((a, b) => a.nr - b.nr);
    s.schueler[kid] = neu;
  }
  // Reihenfolge (Nachprüfung 2 P1): „Vom PC holen“ und die Toasts zeigen nur die erste Meldung — echte Konflikte (anderer Name,
  // doppelte Listen-Nr) über alle Kurse zuerst, die neutralen Sammelmeldungen danach
  konflikte.push(...doppelteListenNrn(s.kurse, s.schueler), ...sammel);
  return { stamm: s, hinweise, konflikte };
}
const nrText = x => (lnr(x) == null ? 'ohne Nr' : 'Nr ' + lnr(x));
// Zwei Nummern (U10, Zero 05.10.): Nach dem Ergänzen muss jede Listen-Nr eines Kurses eindeutig sein. Ein Kind aus dem
// anderen Stand kann eine Zeile tragen, die hier inzwischen ein anderes Kind hat (Liste auf einem Gerät aktualisiert,
// auf dem anderen unten angehängt). Gemeldet, nicht geraten — geklärt wird über „Liste aktualisieren“.
function doppelteListenNrn(kurse, schueler) {
  const out = [];
  for (const k of kurse || []) {
    const belegt = new Map();
    for (const x of nachListe((schueler || {})[k.id])) {
      const n = lnr(x); if (n == null) continue;
      belegt.set(n, [...(belegt.get(n) || []), ((x.vorname || '') + ' ' + (x.name || '')).trim()]);
    }
    for (const [n, namen] of belegt) if (namen.length > 1)
      out.push(k.name + ': Listen-Nr ' + n + ' doppelt (' + namen.join(' und ') + ') — nichts geraten, bitte die Mappe neu laden (Kurse → Kurs anlegen → Mappe laden).');
  }
  return out;
}

function mergeStammdaten(a, b, loesch) {
  if (!a) return { ergebnis: b, konflikt: null, verworfen: null, hinweise: [], konflikte: [] };
  if (!b) return { ergebnis: a, konflikt: null, verworfen: null, hinweise: [], konflikte: [] };
  if (a.rev !== b.rev) {
    const [sieger, verlierer] = a.rev > b.rev ? [a, b] : [b, a];
    const erg = ergaenzeAusVerlierer(sieger, verlierer, loesch);
    return { ergebnis: erg.stamm, konflikt: null, verworfen: verlierer, hinweise: erg.hinweise, konflikte: erg.konflikte };
  }
  if (inhaltGleich(a, b)) return { ergebnis: a, konflikt: null, verworfen: null, hinweise: [], konflikte: [] };
  const [sieger, verlierer] = String(a.ts) >= String(b.ts) ? [a, b] : [b, a];
  const erg = ergaenzeAusVerlierer(sieger, verlierer, loesch);
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
  const loesch = vereinigeLoeschungen(a.stamm && a.stamm.geloescht, b.stamm && b.stamm.geloescht);
  const stamm = mergeStammdaten(a.stamm, b.stamm, loesch);
  konflikte.push(...(stamm.konflikte || []));   // echte Konflikte zuerst, Sammelmeldungen danach — die Vorschau zeigt den ersten
  if (stamm.konflikt) konflikte.push(stamm.konflikt);
  const events = mergeEvents(a.events || [], b.events || []);
  const rein = stamm.ergebnis ? wendeLoeschungenAn(stamm.ergebnis, events, loesch) : { stamm: stamm.ergebnis, events, hinweise: [] };
  return {
    daten: {
      schema: a.schema || b.schema || 'kladde/v1',
      stamm: rein.stamm,
      events: rein.events,
    },
    verworfen: stamm.verworfen,
    konflikte,
    hinweise: [...(stamm.hinweise || []), ...rein.hinweise],
  };
}

export { mergeEvents, mergeStammdaten, mergeContainerDaten, istGeloescht, hebeLoeschungAuf };
