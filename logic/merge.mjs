// kladde/logic/merge · Zwei-Geräte-Merge (kladde/v1)
// Events sind append-only mit Storno → Union nach id ist konfliktfrei by design.
// Stammdaten tragen einen Revisions-Zähler: höhere rev gewinnt; gleiche rev mit
// abweichendem Inhalt = ECHTER Konflikt → später ts gewinnt, Verlierer wird beigelegt
// und gemeldet (Prüfstein 3: Konflikt sichtbar, kein Datenverlust).

import { lnr, nachListe } from './teilnehmer.mjs';
import { felderMitKurs } from './vertrag.mjs';
import { istAltSid, kindGeloescht, sidVonEvent, namensSchluessel, namensHash, trennSid, vergibSids, vereinigeZuordnung, zuordnungVon, zielSidKind, wendeZuordnungAn } from './identitaet.mjs';
import { einheitPasst, notenEinheit } from './skalen.mjs';
import { wirksameEvents } from './verdichtung.mjs';

// Notenmodus nach dem Abgleich (v2.2, Prüfer v2.1 B2): die Sperre „kein Wechsel, solange Quartalsnoten existieren“ wirkt nur auf dem
// Gerät; über den Abgleich kann ein Kurs trotzdem den Modus wechseln. Dann melden — die Noten bleiben in ihrer Einheit (skalen einheitVon).
function einheitenMeldungen(stamm, events) {
  const out = [];
  const qn = wirksameEvents(events || []).filter(e => e.typ === 'quartalsnote');
  for (const k of (stamm && stamm.kurse) || []) {
    const fremd = qn.filter(e => e.kursId === k.id && !einheitPasst(e, k)).length;
    if (fremd) out.push(kursName(k) + ': Notenmodus ist jetzt ' + (notenEinheit(k) === 'punkte' ? 'Punkte' : 'Drittelnoten') + ', '
      + fremd + (fremd === 1 ? ' Quartalsnote steht' : ' Quartalsnoten stehen') + ' noch in ' + (notenEinheit(k) === 'punkte' ? 'Drittelnoten' : 'Punkten') + ' — bitte prüfen.');
  }
  return out;
}

function mergeEvents(eventsA, eventsB) {
  const nachId = new Map();
  for (const e of [...eventsA, ...eventsB]) {
    const vorhanden = nachId.get(e.id);
    // gleicher Zeitstempel (dieselbe Buchung, auf einem Gerät schon zugeordnet): der Inhalt entscheidet, nicht die Reihenfolge (Prüfer 20.10. K1)
    if (!vorhanden || String(e.ts) > String(vorhanden.ts) || (String(e.ts) === String(vorhanden.ts) && JSON.stringify(e) > JSON.stringify(vorhanden))) nachId.set(e.id, e);
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
// Jede Stelle des Stamms, die an einer Kurs-id hängt — EINE Liste für Endgültig-Löschen, Lösch-Markierung und verworfene Stände
// (Review 19.10. §4: Ausnahmen und Alt-Slots fehlten, die Autowahl wählte danach den gelöschten Kurs). Ein neues Feld mit kursId
// wird im Kladde-Vertrag (logic/vertrag.mjs) eingetragen, die Listen hier folgen daraus (A2).
const KURS_SCHLUESSEL = felderMitKurs('schluessel');   // { [kursId]: … }
const KURS_LISTEN = felderMitKurs('liste');            // [{ kursId, … }] — Entfall (kursId null) bleibt
function entferneKursReferenzen(stamm, ids) {
  const weg = ids instanceof Set ? ids : new Set(ids || []);
  if (!stamm || !weg.size) return stamm;
  const s = { ...stamm };
  if (Array.isArray(stamm.kurse)) s.kurse = stamm.kurse.filter(k => !weg.has(k.id));
  for (const feld of KURS_SCHLUESSEL) {
    if (!stamm[feld]) continue;
    s[feld] = { ...stamm[feld] };
    for (const id of weg) delete s[feld][id];
  }
  for (const feld of KURS_LISTEN) if (Array.isArray(stamm[feld])) s[feld] = stamm[feld].filter(x => !weg.has(x.kursId)).map(ohneErsetztWeg);
  // Identität (v2.2, Prüfer 20.10. G4): Löschmarken, Trennungen und Aliase der Kinder dieses Kurses gehen mit — ein mit derselben id neu
  // angelegter Kurs (dieselbe Mappe) vergibt dieselben Alt-sids, eine alte Marke ließe sonst ein neues Kind still verschwinden
  const kursSid = sid => [...weg].some(id => String(sid).startsWith('a:' + id + ':') || String(sid).startsWith('t:a:' + id + ':'));
  for (const feld of ['sidAlias', 'trennungen', 'geloeschteKinder']) {
    if (stamm[feld]) s[feld] = Object.fromEntries(Object.entries(stamm[feld]).filter(([k, v]) => !kursSid(k) && !(feld === 'sidAlias' && kursSid(v))));
  }
  return s;
  // Ein Entfall merkt sich die überschriebene Vertretung (autowahl tagesAusfall `ersetzt`), „Zurücknehmen“ holt sie zurück —
  // zeigt sie auf einen gelöschten Kurs, bleibt der Entfall, der Verweis geht (Prüfer 19.10. A1)
  function ohneErsetztWeg(x) {
    if (!x.ersetzt || !weg.has(x.ersetzt.kursId)) return x;
    const { ersetzt: _weg, ...rest } = x;
    return rest;
  }
}
// Entfernt gelöschte Kurse samt aller Referenzen und Einträge — auf Kopien, nie in place
// (die Import-Vorschau rechnet auf dem lebenden Tresor). Einträge eines neu angelegten Kurses bleiben, sofern sie
// jünger sind als die Löschung.
function wendeLoeschungenAn(stamm, events, loesch) {
  const ids = Object.keys(loesch || {});
  if (!ids.length) return { stamm, events, hinweise: [] };
  const weg = new Set(ids.filter(id => istGeloescht(loesch[id])));
  const s = { ...entferneKursReferenzen(stamm, weg), geloescht: loesch };
  const hinweise = [];
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
// Sie werden jetzt ergänzt und gemeldet.
// v2.2 (Identität, Zero 19.10. „W2“): Kinder werden über die sid abgeglichen, nicht über die Ausweis-Nr. Zwei Fragen, je mit sicherer
// Vorgabe (offen = nichts wird vermischt), „Übernehmen“ sperrt der Dialog bis zur Antwort:
//  · 'zwei'     gleiche Alt-sid (gleiche Ausweis-Nr aus v2), anderer Name — Antwort true/offen: zwei Kinder, das andere bekommt eine neue
//               sid und die Einträge, die nur sein Gerät hat (Trennung); false: dasselbe Kind, anders geschrieben (Basis behält, Meldung).
//  · 'dasselbe' verschiedene sid, gleicher Name (Zero 19.10.: „Fragen: dasselbe Kind?“) — true: Alias, Einträge beider beim Kind der
//               Basis; false/offen: zwei Kinder.
// Ein Kind vom anderen Gerät, dessen Ausweis-Nr hier schon ein anderes Kind trägt, bekommt eine neue (über der Höchstmarke); seine
// sichtbare Listen-Nr bleibt (doppelte Listen-Nrn meldet doppelteListenNrn). Antworten wirken über die Zuordnung im Stamm auch auf
// dem anderen Gerät (identitaet.mjs).
function ergaenzeAusVerlierer(sieger, verlierer, loesch, ctx = {}) {
  const hinweise = [], konflikte = [], sammel = [];
  const fragen = ctx.fragen || [];
  if (!verlierer) return { stamm: sieger, hinweise, konflikte, fragen };
  const zuord = ctx.zuord || vereinigeZuordnung(zuordnungVon(sieger), zuordnungVon(verlierer));
  const antworten = ctx.antworten || {};
  const evSieger = ctx.evSieger || [], evVerlierer = ctx.evVerlierer || [];
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
    const sidHier = new Map(eigen.map(x => [zielSidKind(x, kid, zuord), x]));
    const sidsDort = new Set((liste || []).map(x => zielSidKind(x, kid, zuord)));
    const neu = [...eigen], abweichend = [];
    // Ein Kind vom anderen Gerät aufnehmen; trägt seine Ausweis-Nr hier schon ein anderes Kind, eine neue über der Höchstmarke
    const aufnehmen = x => {
      if (!neu.some(z => z.nr === x.nr)) { neu.push(x); return x; }
      const nr = Math.max(kurs.ausweisBis || 0, ...neu.map(z => z.nr), ...(liste || []).map(z => z.nr)) + 1;
      const y = { ...x, nr, liste: lnr(x) };
      kurs.ausweisBis = nr;
      neu.push(y); return y;
    };
    for (const x0 of liste || []) {
      const sidX = zielSidKind(x0, kid, zuord);
      const x = sidX === x0.sid ? x0 : { ...x0, sid: sidX };
      const da = sidHier.get(sidX);   // Abgleich über die sid; gemeldet wird die Listen-Nr
      const wer = (x.vorname || '') + ' ' + (x.name || '');
      const werDa = da ? ((da.vorname || '') + ' ' + (da.name || '')).trim() : '';
      if (!da) {
        // gelöscht: still aufnehmen — wendeZuordnungAn entscheidet (zurück nur mit jüngeren Einträgen)
        if (kindGeloescht(zuord.geloeschteKinder[sidX])) { aufnehmen(x); continue; }
        const gleich = eigen.find(y => !y.inaktiv && namensSchluessel(y) === namensSchluessel(x) && !sidsDort.has(zielSidKind(y, kid, zuord)));
        if (gleich) {
          const ziel = zielSidKind(gleich, kid, zuord), id = 'dasselbe|' + sidX + '|' + ziel, a = antworten[id];
          fragen.push({ id, art: 'dasselbe', kursId: kid, kurs: kursName(kurs), hier: gleich, dort: x, geraetHier: sieger.geraet, geraetDort: verlierer.geraet, antwort: a });
          // dasselbe Kind: seine Einträge folgen über den Alias. Richtung fest (größere sid → kleinere), damit zwei Geräte, die beide
          // antworten, denselben Alias setzen und kein Zyklus entsteht (Prüfer 20.10. G1)
          if (a === true) { const [von, nach] = String(sidX) > String(ziel) ? [sidX, ziel] : [ziel, sidX]; zuord.sidAlias[von] = nach; continue; }
        }
        const y = aufnehmen(x);
        hinweise.push(kursName(kurs) + ': ' + nrText(y) + ' ' + wer.trim() + ' ergänzt');
      }
      else if (namensSchluessel(da) !== namensSchluessel(x) && istAltSid(sidX)) {
        // schon einmal als „umbenannt“ beantwortet (auf diesem oder dem anderen Gerät, Prüfer 20.10. G2): Basis behält, still
        if (zuord.trennungen[sidX] && zuord.trennungen[sidX].gleich) continue;
        const id = 'zwei|' + sidX + '|' + namensSchluessel(x), a = antworten[id];
        fragen.push({ id, art: 'zwei', kursId: kid, kurs: kursName(kurs), hier: da, dort: x, geraetHier: sieger.geraet, geraetDort: verlierer.geraet, antwort: a });
        if (a === false) {
          // dasselbe Kind, anders geschrieben — „Kurs: Nr …“ wie die übrigen Meldungen (Prüfer 06.10. B13); die Antwort reist mit
          konflikte.push(kursName(kurs) + ': ' + nrText(da) + ' „' + werDa + '" (' + sieger.geraet + ') ≠ „' + wer.trim() + '" (' + verlierer.geraet + ') — ' + sieger.geraet + ' behalten.');
          zuord.trennungen[sidX] = { gleich: true };
          continue;
        }
        // zwei Kinder (oder noch offen): BEIDE bekommen eine neue sid, auf jedem Gerät dieselbe (Prüfer 20.10. R1/G1) — sonst trüge Anna
        // weiter die Alt-sid und jede spätere iPad-Buchung für sie fiele über die Geräte-Regel an Ben. Einträge mit der Alt-sid: die nur
        // drüben stehen und die Geräte, die nur drüben buchten, gehören dem anderen Kind; alles übrige dem Kind hier.
        const hHier = namensHash(da), hDort = namensHash(x);
        const evHier = evSieger.filter(e => sidVonEvent(e) === sidX), hierIds = new Set(evHier.map(e => e.id));
        const geraeteHier = new Set(evHier.map(e => e.geraetId).filter(Boolean));
        const nurDort = evVerlierer.filter(e => sidVonEvent(e) === sidX && !hierIds.has(e.id));
        const t = zuord.trennungen[sidX] && zuord.trennungen[sidX].kinder ? zuord.trennungen[sidX] : { kinder: {}, ereignisse: {}, geraete: {}, standard: hHier };
        t.kinder[hHier] = trennSid(sidX, hHier); t.kinder[hDort] = trennSid(sidX, hDort);
        for (const e of nurDort) t.ereignisse[e.id] = hDort;
        for (const e of nurDort) if (e.geraetId && !geraeteHier.has(e.geraetId)) t.geraete[e.geraetId] = hDort;
        for (const g of geraeteHier) if (!(g in t.geraete)) t.geraete[g] = hHier;
        zuord.trennungen[sidX] = t;
        const y = aufnehmen({ ...x, sid: t.kinder[hDort] });
        hinweise.push(kursName(kurs) + ': ' + nrText(y) + ' ' + wer.trim() + ' ergänzt (andere Person als ' + werDa + ')');
      }
      else if (namensSchluessel(da) !== namensSchluessel(x)) {
        // gleiche neue sid, anderer Name: auf einem Gerät umbenannt — der übernommene Stand gilt (Sammelmeldung)
        abweichend.push(nrText(da) + ' ' + werDa + ': Name „' + wer.trim() + '" (' + verlierer.geraet + ')');
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
    if (abweichend.length) sammel.push(kursName(kurs) + ': ' + abweichend.length + (abweichend.length === 1 ? ' Kind steht' : ' Kinder stehen')
      + ' in den beiden Ständen verschieden (' + abweichend.slice(0, 3).join(' · ') + (abweichend.length > 3 ? ' · … und ' + (abweichend.length - 3) + ' weitere' : '')
      + ') — übernommen: Stand ' + sieger.geraet + ', verworfen: Stand ' + verlierer.geraet + '. Passt das nicht zur Mappe, die Mappe neu laden (Kurse → Kurs anlegen → Mappe laden).');
    neu.sort((a, b) => a.nr - b.nr);
    s.schueler[kid] = neu;
  }
  // Reihenfolge (Nachprüfung 2 P1): „Vom PC holen“ und die Toasts zeigen nur die erste Meldung — echte Konflikte (anderer Name,
  // doppelte Listen-Nr) über alle Kurse zuerst, die neutralen Sammelmeldungen danach
  konflikte.push(...doppelteListenNrn(s.kurse, s.schueler), ...sammel);
  return { stamm: s, hinweise, konflikte, fragen };
}
const nrText = x => (lnr(x) == null ? 'ohne Nr' : 'Nr ' + lnr(x)), kursName = k => k.name + (k.fach ? ' · ' + k.fach : '');   // mit Fach: zwei Kurse „7b“ (Prüfer P2)
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
      out.push(kursName(k) + ': Listen-Nr ' + n + ' doppelt (' + namen.join(' und ') + ') — nichts geraten, bitte die Mappe neu laden (Kurse → Kurs anlegen → Mappe laden).');
  }
  return out;
}

// ctx (optional, aus mergeContainerDaten): zuord · antworten · evA/evB (Einträge der Seiten a/b) · fragen (Sammelliste)
function mergeStammdaten(a, b, loesch, ctx = {}) {
  const fragen = ctx.fragen || [];
  if (!a) return { ergebnis: b, konflikt: null, verworfen: null, hinweise: [], konflikte: [], fragen };
  if (!b) return { ergebnis: a, konflikt: null, verworfen: null, hinweise: [], konflikte: [], fragen };
  const seiten = (sieger) => ({ ...ctx, fragen, evSieger: sieger === a ? ctx.evA : ctx.evB, evVerlierer: sieger === a ? ctx.evB : ctx.evA });
  if (a.rev !== b.rev) {
    const [sieger, verlierer] = a.rev > b.rev ? [a, b] : [b, a];
    const erg = ergaenzeAusVerlierer(sieger, verlierer, loesch, seiten(sieger));
    return { ergebnis: erg.stamm, konflikt: null, verworfen: verlierer, hinweise: erg.hinweise, konflikte: erg.konflikte, fragen };
  }
  if (inhaltGleich(a, b)) return { ergebnis: a, konflikt: null, verworfen: null, hinweise: [], konflikte: [], fragen };
  // gleiche rev und gleicher ts: der Inhalt entscheidet, nicht die Reihenfolge der Argumente (Prüfer 20.10. K1)
  const vorn = String(a.ts) > String(b.ts) || (String(a.ts) === String(b.ts) && JSON.stringify(a) >= JSON.stringify(b));
  const [sieger, verlierer] = vorn ? [a, b] : [b, a];
  const erg = ergaenzeAusVerlierer(sieger, verlierer, loesch, seiten(sieger));
  return {
    ergebnis: erg.stamm,
    verworfen: verlierer,
    hinweise: erg.hinweise,
    konflikte: erg.konflikte,
    fragen,
    konflikt: 'Stammdaten-Konflikt bei rev ' + a.rev + ': ' +
      verlierer.geraet + ' (' + verlierer.ts + ') unterlag ' +
      sieger.geraet + ' (' + sieger.ts + ') — verworfener Stand liegt bei.',
  };
}

// opt: antworten { [frageId]: true|false } (aus dem Abgleich-Dialog). Keine Zufalls-sid: der Abgleich ist deterministisch (Prüfer 20.10. G1).
// Beide Seiten werden auf Kopien zu v3 ergänzt (sid an Kindern und Einträgen) — die Vorschau rechnet auf dem lebenden Tresor.
// → fragen (alle, mit antwort) · offen (Anzahl unbeantwortet; der Dialog sperrt „Übernehmen“, solange offen > 0).
function mergeContainerDaten(a0, b0, opt = {}) {
  const a = JSON.parse(JSON.stringify(a0)), b = JSON.parse(JSON.stringify(b0));
  vergibSids(a); vergibSids(b);
  const konflikte = [];
  const loesch = vereinigeLoeschungen(a.stamm && a.stamm.geloescht, b.stamm && b.stamm.geloescht);
  const zuord = vereinigeZuordnung(zuordnungVon(a.stamm), zuordnungVon(b.stamm));
  const stamm = mergeStammdaten(a.stamm, b.stamm, loesch, { zuord, antworten: opt.antworten, evA: a.events || [], evB: b.events || [], fragen: [] });
  konflikte.push(...(stamm.konflikte || []));   // echte Konflikte zuerst, Sammelmeldungen danach — die Vorschau zeigt den ersten
  if (stamm.konflikt) konflikte.push(stamm.konflikt);
  const events = mergeEvents(a.events || [], b.events || []);
  const rein = stamm.ergebnis ? wendeLoeschungenAn(stamm.ergebnis, events, loesch) : { stamm: stamm.ergebnis, events, hinweise: [] };
  const ident = wendeZuordnungAn(rein.stamm, rein.events, zuord);
  konflikte.push(...einheitenMeldungen(ident.stamm, ident.events));
  return {
    daten: {
      schema: 'kladde/v3',
      stamm: ident.stamm,
      events: ident.events,
    },
    verworfen: stamm.verworfen,
    konflikte,
    hinweise: [...(stamm.hinweise || []), ...rein.hinweise, ...ident.hinweise],
    fragen: stamm.fragen,
    offen: stamm.fragen.filter(f => f.antwort === undefined).length,
  };
}

// Übernimmt ein Merge-Ergebnis als neuen Tresor — EIN Weg für Dateiimport und Heimnetz-Pull (Review 19.10. §5: der Pull legte den
// unterlegenen Stand nicht bei). Der Verlierer liegt bei (höchstens drei, der älteste fällt), gerätelokal informativ. Ein beigelegter
// Stand trägt keinen gelöschten Kurs (sonst stünden Namen und Liste eines endgültig gelöschten Kurses weiter im Tresor).
const MAX_VERWORFEN = 3;
function uebernehmeMerge(vault, dry) {
  const loesch = (dry.daten.stamm && dry.daten.stamm.geloescht) || {};
  const weg = new Set(Object.keys(loesch).filter(id => istGeloescht(loesch[id])));
  // Der Verlierer als eigene Kopie: Kurse nur in ihm stehen sonst als dasselbe Objekt auch im neuen Stamm (Prüfer 19.10. B9)
  const verlierer = dry.verworfen ? [JSON.parse(JSON.stringify(dry.verworfen))] : [];
  const liste = [...(vault.verworfeneStaende || []), ...verlierer].map(st => entferneKursReferenzen(st, weg));
  while (liste.length > MAX_VERWORFEN) liste.shift();
  return liste.length ? { ...dry.daten, verworfeneStaende: liste } : { ...dry.daten };
}

export { mergeEvents, mergeStammdaten, mergeContainerDaten, istGeloescht, hebeLoeschungAuf, entferneKursReferenzen, uebernehmeMerge };
