// kladde/logic/teilnehmer · die Schülerliste eines Kurses: zwei Nummern und „Liste aktualisieren“ (Zero 04./05.10.2026).
// Rein, ohne DOM — Node-testbar (test/schuelerliste.test.mjs, Gegenfälle _proben/handy/liste_node_mutanten.cjs).
// Bis v1.19.0 stand hier der Abgleich über die Nr samt Sofort-Schutz (fremdeKinder) und das Nachrücken beim Entfernen;
// beides ist mit den zwei Nummern entfallen (Zuordnung über den Namen; umnummeriert wird nur im Dialog, WAHL 3A).

// Schreibform (Prüfer 04.10. K2-b): ohne Groß/Klein, Umlaut/ß als ae/oe/ue/ss, Akzente weg (ş→s, ç→c), Bindestrich und
// Apostroph als Leerraum — „Ayse Celik“ = „Ayşe Çelik“, „Mueller“ = „Müller“, „Anna-Lena“ = „Anna Lena“.
const schreibform = t => String(t ?? '').normalize('NFC').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/\p{M}/gu, '').replace(/[-‐‑'’]/g, ' ').split(/\s+/).filter(Boolean).join(' ');

// ══ ZWEI NUMMERN (Zero 04.10. Grundsatz, 05.10. Wahl 1A/2A/3A · design/schuelerliste_2026-10-05/WAHL.md) ══
// `nr`    = Ausweis-Nr: intern, bleibt für immer, trägt Einträge (schuelerNr), Sitzplatz (grid), Halbgruppe, Merge.
// `liste` = Listen-Nr: sichtbar, Mappenzeile (MAPPING §1), darf sich ändern. Fehlt sie, gilt die Ausweis-Nr
//           (Bestand bleibt unverändert); `null` = keine (abgegeben, nur bei inaktiven Kindern).
const MAX_LISTE = 35;   // Mappenzeilen 1–35 (MAPPING §1); die Ausweis-Nr hat keine Grenze
const lnr = s => (s && s.liste !== undefined ? s.liste : s?.nr);
// Jede Anzeige sortiert hiermit (NR_STELLEN U12): nach Listen-Nr, ohne Listen-Nr ans Ende, bei Gleichstand Ausweis-Nr
const nachListe = arr => (arr || []).slice().sort((a, b) => (lnr(a) ?? Infinity) - (lnr(b) ?? Infinity) || a.nr - b.nr);
// Neue Ausweis-Nr: höher als jede je im Kurs gesehene — im Stamm, in den Einträgen UND in der Höchstmarke des Kurses
// (`kurs.ausweisBis`, Prüfer 05.10. R4: ein ohne Einträge entferntes Kind steht in keinem von beiden mehr). Nie wiederverwendet (C1).
function neueAusweisNr(schueler, events = [], bis = 0) {
  let max = Number.isInteger(bis) && bis > 0 ? bis : 0;
  for (const s of schueler || []) if (s.nr > max) max = s.nr;
  for (const e of events || []) if (e.schuelerNr > max) max = e.schuelerNr;
  return max + 1;
}

// Laufen Ausweis- und Listen-Nr eines aktiven Kindes durch diesen Schritt NEU auseinander? Ein Gerät mit älterem Stand (bis v1.19.0)
// kennt nur die Ausweis-Nr und zeigt, druckt und kopiert dann eine andere Zeile. Dafür warnte die App (Prüfer R3); die Warnung ist seit
// v1.24.0 entfallen (Zero 06.10. „Ganz weg“), die App ruft die Funktion nicht mehr — sie bleibt getestet für einen Rückweg
const nrnAuseinander = (vorher, nachher) => (nachher || []).some(s => !s.inaktiv && lnr(s) !== s.nr
  && !(vorher || []).some(a => a.nr === s.nr && !a.inaktiv && lnr(a) === lnr(s)));

// ── „Liste aktualisieren“ planen (rein) ──
// alt: Stamm-Liste des Kurses (aktive UND inaktive) · neu: Zeilen aus Mappe/Einfügen, `nr` = Mappenzeile (eine kurs.json der Kladde
// trägt die Zeile in `liste`; ihre Abgänge sind keine Zeilen) · modus: 'anpassen' (Listen-Nr = Mappenzeile) | 'behalten' (bisherige
// Listen-Nr, Neue unten an) · antworten: { [frageId]: true (dasselbe Kind) | false }.
// Zugeordnet wird über den NAMEN in der Schreibform, nie über die Nr, und nie still bei Mehrdeutigkeit (Plan, verbotene Pfade):
//  1 · still nur, wenn der Name genau einmal unter den Kindern und genau einmal in der Mappe steht und das Kind aktiv ist;
//  2 · alles andere wird gefragt, je PAAR aus Kind und Mappenzeile eine Frage (Prüfer 05.10. R1): gleicher Name mehrfach (R2), ein Abgang
//      kommt wieder (Y2), gleicher Vor- ODER Nachname (A→K, Zero 03.10.). Vorschlag zuerst: gleicher Name vor Teiltreffer; bei gleich
//      vielen Gleichnamigen das k-te Kind zur k-ten Zeile (die Reihenfolge bleibt), sonst die nächste Stelle. Ein „Nein“ schließt nur
//      dieses Paar aus — Kind und Zeile werden für das nächste Paar frei und neu gefragt; „Übernehmen“ bleibt bis dahin gesperrt.
function planeAbgleich(alt, neu, modus = 'anpassen', antworten = {}) {
  const wer = s => schreibform(s.vorname) + '|' + schreibform(s.name);
  const zeileVon = r => (r.liste !== undefined ? r.liste : r.nr);
  const kinder = nachListe(alt);
  const zeilen = (neu || []).filter(r => !r.inaktiv && zeileVon(r) != null).sort((a, b) => zeileVon(a) - zeileVon(b));   // Prüfer Y3
  const zaehle = arr => { const m = new Map(); for (const x of arr) m.set(wer(x), (m.get(wer(x)) || 0) + 1); return m; };
  const nKinder = zaehle(kinder), nZeilen = zaehle(zeilen);
  const gebunden = new Set(), belegt = new Set(), paare = [];   // gebunden/belegt: zugeordnet ODER in einer offenen Frage
  // 1 · eindeutig gleicher Name
  for (const r of zeilen) {
    const k = kinder.find(x => wer(x) === wer(r));
    if (k && !k.inaktiv && nKinder.get(wer(r)) === 1 && nZeilen.get(wer(r)) === 1) { paare.push({ kind: k, zeile: r, art: 'name' }); gebunden.add(k); belegt.add(r); }
  }
  // 2 · Rückfragen je Paar
  const freiK = kinder.filter(k => !gebunden.has(k)), freiZ = zeilen.filter(r => !belegt.has(r));
  const kandidaten = [];
  for (const k of freiK) for (const r of freiZ) {
    const gleich = wer(k) === wer(r);
    if (!gleich && (k.inaktiv || (schreibform(k.vorname) !== schreibform(r.vorname) && schreibform(k.name) !== schreibform(r.name)))) continue;
    let abstand = Math.abs((lnr(k) ?? 999) - zeileVon(r));
    if (gleich) {
      const gK = freiK.filter(x => wer(x) === wer(k)), gZ = freiZ.filter(x => wer(x) === wer(r));
      if (gK.length === gZ.length) abstand = Math.abs(gK.indexOf(k) - gZ.indexOf(r));   // k-tes Kind ↔ k-te Zeile
    }
    kandidaten.push({ k, r, gleich, abstand });
  }
  kandidaten.sort((a, b) => (a.gleich ? 0 : 1) - (b.gleich ? 0 : 1) || a.abstand - b.abstand || zeileVon(a.r) - zeileVon(b.r) || a.k.nr - b.k.nr);
  const fragen = [];
  // Ein „Ja“ bindet vor allen offenen Paaren (Nachprüfung N2): sonst gibt ein späteres „Nein“ ein früher sortiertes Paar frei,
  // das bestätigte Kind wird erneut gefragt und das „Ja“ ruht. Zwei „Ja“ für dasselbe Kind: das erste in der Sortierung gilt.
  for (const nurJa of [true, false]) for (const { k, r, gleich } of kandidaten) {
    if (gebunden.has(k) || belegt.has(r)) continue;
    const id = 'k' + k.nr + 'z' + zeileVon(r), a = antworten[id];
    if (nurJa && a !== true) continue;
    fragen.push({ id, kind: k, zeile: r, antwort: a, art: !gleich ? 'teil' : k.inaktiv ? 'wieder' : 'gleich',
      stelle: modus === 'anpassen' ? zeileVon(r) : (lnr(k) ?? null) });   // wo der Dialog die offene Frage zeigt
    if (a === false) continue;   // nur dieses Paar ist ausgeschlossen
    gebunden.add(k); belegt.add(r);
    if (a === true) paare.push({ kind: k, zeile: r, art: k.inaktiv ? 'reaktiviert' : gleich ? 'name' : 'umbenannt' });
  }
  const offen = fragen.filter(f => f.antwort === undefined).length;
  const weg = kinder.filter(k => !gebunden.has(k) && !k.inaktiv);
  // 3 · Nummern nach Modus
  let naechste = Math.max(0, ...kinder.filter(k => lnr(k) != null).map(lnr));
  const zeilenPlan = paare.map(p => ({ ...p, alt: lnr(p.kind), neu: modus === 'anpassen' ? zeileVon(p.zeile) : (lnr(p.kind) ?? null) }));
  if (modus !== 'anpassen') for (const z of zeilenPlan) if (z.neu == null) z.neu = ++naechste;   // reaktiviert ohne Nr
  for (const r of zeilen.filter(x => !belegt.has(x)))
    zeilenPlan.push({ kind: null, zeile: r, art: 'neu', alt: null, neu: modus === 'anpassen' ? zeileVon(r) : ++naechste });
  // Wer nicht (mehr) in der Mappe steht, behält seine Zeile als Lücke. Nur beim Anpassen gibt er sie ab, wenn sie jetzt ein anderes Kind
  // trägt — die Mappe ist die Wahrheit; eine geleerte Zeile bleibt leer (Prüfer 05.10. Y4: dieselbe Mappe noch einmal = unverändert)
  const genommen = new Set(zeilenPlan.map(z => z.neu));
  const abgabe = k => (modus === 'anpassen' && lnr(k) != null && genommen.has(lnr(k)) ? null : lnr(k));
  const wegPlan = weg.map(k => ({ kind: k, alt: lnr(k), neu: abgabe(k) }));
  const sonstige = kinder.filter(k => k.inaktiv && !gebunden.has(k) && lnr(k) != null && abgabe(k) === null)
    .map(k => ({ kind: k, alt: lnr(k), neu: null }));
  const fehler = [];
  const vergeben = new Map();
  for (const z of zeilenPlan) {
    if (z.neu > MAX_LISTE) fehler.push('Nr ' + z.neu + ' liegt hinter der letzten Mappenzeile (' + MAX_LISTE + ')');
    if (vergeben.has(z.neu)) fehler.push('Nr ' + z.neu + ' doppelt');
    vergeben.set(z.neu, z);
  }
  for (const w of wegPlan) if (w.neu != null && vergeben.has(w.neu)) fehler.push('Nr ' + w.neu + ' doppelt');
  zeilenPlan.sort((a, b) => a.neu - b.neu);
  const geaendert = zeilenPlan.filter(z => z.kind && z.alt !== z.neu).length;
  const unveraendert = !fehler.length && !fragen.length && !wegPlan.length && !sonstige.length && zeilenPlan.every(z => z.kind && z.art === 'name' && z.alt === z.neu
    && z.kind.name === z.zeile.name && z.kind.vorname === z.zeile.vorname && !!z.kind.lb === !!z.zeile.lb);
  return { modus, zeilen: zeilenPlan, fragen, offen, weg: wegPlan, sonstige, geaendert, fehler, unveraendert };
}

// ── Plan anwenden (rein): neue Stamm-Liste. Gesperrt, solange Fragen offen sind oder Fehler bestehen. ──
// Zugeordnete Kinder behalten Ausweis-Nr, Gruppe und alle Felder; Name/Vorname/LB kommen aus der Mappe (deren Schreibung).
// Neue bekommen eine neue Ausweis-Nr (neueAusweisNr, mit der Höchstmarke `bis`). Weg MIT Einträgen → inaktiv, ohne → entfernt.
function wendePlanAn(alt, plan, hatEvents, events = [], bis = 0) {
  if (plan.offen || plan.fehler.length) return null;
  const list = (alt || []).map(s => ({ ...s }));
  const von = k => list.find(x => x.nr === k.nr);
  const setzeListe = (s, n) => { if (n === s.nr) delete s.liste; else s.liste = n; };
  for (const z of plan.zeilen) {
    if (!z.kind) continue;
    const s = von(z.kind);
    s.name = z.zeile.name; s.vorname = z.zeile.vorname; s.lb = !!z.zeile.lb; delete s.inaktiv;
    setzeListe(s, z.neu);
  }
  for (const w of plan.weg) {
    const i = list.findIndex(x => x.nr === w.kind.nr);
    if (!hatEvents(w.kind.nr)) { list.splice(i, 1); continue; }
    list[i].inaktiv = true; setzeListe(list[i], w.neu);
  }
  for (const o of plan.sonstige) setzeListe(von(o.kind), o.neu);
  let ausweis = neueAusweisNr(alt, events, bis) - 1;   // aus dem Stand VOR dem Entfernen: Nr eines gerade gegangenen Kindes nie neu
  for (const z of plan.zeilen) if (!z.kind) {
    const s = { nr: ++ausweis, name: z.zeile.name, vorname: z.zeile.vorname, lb: !!z.zeile.lb };
    setzeListe(s, z.neu); list.push(s);
  }
  return list.sort((a, b) => a.nr - b.nr);
}

export { MAX_LISTE, lnr, nachListe, neueAusweisNr, nrnAuseinander, planeAbgleich, wendePlanAn, schreibform };
