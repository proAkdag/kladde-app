// kladde/logic/identitaet · Schüler- und Geräte-Identität (v2.2 · Schema kladde/v3 · Plan 19.10. Scheibe B)
// Bis v2.1 hing ein Eintrag über kursId + schuelerNr (Ausweis-Nr) am Kind. Zwei Geräte konnten dieselbe Nr an verschiedene Kinder
// vergeben, der Abgleich gab dann Anna die Minus von Ben (Befund H1/B1). Jetzt trägt jedes Kind und jeder Eintrag eine `sid`.
// Zero 19.10. (Frage-Dialog): „W2 · alle Lesestellen umstellen“ — gelesen wird die sid, die Nr ist nur noch Anzeige/Sitzplatz.
// Rein, ohne DOM — Node-testbar (test/identitaet.test.mjs).
//
// sid-Regel (Expertenrunde 19.10. Vor-Bedingung 2):
//   Altbestand  'a:' + kursId + ':' + nr       — deterministisch: zwei Geräte rechnen für dasselbe Kind dieselbe sid aus
//   neues Kind  'n:' + Zufall                  — nie zweimal vergeben
//   getrennt    't:' + Alt-sid + ':' + Prüfsumme des Namens — nach „zwei Kinder“ bekommen BEIDE Kinder eine neue sid, auf jedem Gerät
//               dieselbe (Prüfer 20.10. R1/G1). Die Prüfsumme (FNV-1a, 32 bit) ist nicht der Name; gegen eine Namensliste abgleichbar,
//               verrät sie nichts, was nicht im selben verschlüsselten Container ohnehin steht.
// Keine Klarnamen in der sid (verbotener Pfad): sie steht in jedem Eintrag und in jeder Sicherung.
//
// Zuordnung im Stamm (synchronisiert, beider Geräte vereinigt — sonst stellte das andere Gerät dieselbe Frage neu):
//   sidAlias         { [sid]: zielSid }   „dasselbe Kind“ — Richtung fest: größere sid → kleinere (keine Zyklen, Prüfer 20.10. G1)
//   trennungen       { [Alt-sid]: { gleich: true } }  „umbenannt, dasselbe Kind“ (Prüfer 20.10. G2) — oder
//                    { [Alt-sid]: { kinder: {[prüfsumme]: sid}, ereignisse: {[id]: prüfsumme}, geraete: {[geraetId]: prüfsumme}, standard } }
//                    „zwei Kinder“: welches Kind ein Eintrag mit der Alt-sid meint — nach Eintrags-id, sonst nach Gerät, sonst standard.
//                    Nach der Übernahme trägt kein neuer Eintrag mehr die Alt-sid; die Regel betrifft nur Einträge von davor.
//   geloeschteKinder { [sid]: { am, wieder? } }  ganz entfernt (nur ohne Einträge möglich). Gilt, solange nicht wieder > am — wie die
//                    Kurs-Löschung (merge.mjs istGeloescht). Hat das andere Gerät Einträge für das Kind, kommt es zurück (Prüfer 20.10. R2).

import { schreibform } from './teilnehmer.mjs';

const altSid = (kursId, nr) => 'a:' + kursId + ':' + nr;
const neueSid = () => 'n:' + crypto.randomUUID();
const istAltSid = sid => typeof sid === 'string' && sid.startsWith('a:');
const sidVonKind = (kind, kursId) => (kind && kind.sid) || (kind && kind.nr != null ? altSid(kursId, kind.nr) : null);
// Ein Eintrag ohne sid stammt aus v2: dieselbe Regel wie für das Kind. Kursweite Einträge (ohne Schüler) haben keine.
const sidVonEvent = e => (e && e.sid) || (e && e.kursId != null && e.schuelerNr != null ? altSid(e.kursId, e.schuelerNr) : null);
const namensSchluessel = k => schreibform(k && k.vorname) + '|' + schreibform(k && k.name);
// Prüfsumme des Namens in Schreibform (FNV-1a 32 bit, hex) — für die getrennte sid und als Schlüssel der Trennung
function namensHash(k) {
  let h = 0x811c9dc5;
  for (const c of namensSchluessel(k)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const trennSid = (alt, hash) => 't:' + alt + ':' + hash;

// Migration v2 → v3 für Kinder und Einträge: setzt fehlende sids, sonst nichts. IDEMPOTENT. → true, wenn etwas gesetzt wurde.
function vergibSids(vault) {
  let geaendert = false;
  for (const [kursId, liste] of Object.entries((vault.stamm && vault.stamm.schueler) || {})) {
    for (const k of liste || []) if (!k.sid && k.nr != null) { k.sid = altSid(kursId, k.nr); geaendert = true; }
  }
  for (const e of vault.events || []) {
    if (e.sid) continue;
    const sid = sidVonEvent(e);
    if (sid) { e.sid = sid; geaendert = true; }
  }
  return geaendert;
}

// Rücklese-Sicherung vor der ersten v3-Schreibung (Prüfer 20.10. G5: rein, damit testbar). put/get: Speicher des Aufrufers.
// Wirft, wenn der zurückgelesene Inhalt nicht Byte für Byte gleich ist — dann wird nichts migriert gespeichert.
async function sichereRoh(roh, put, get) {
  await put(roh);
  const rb = await get();
  let identisch = Boolean(rb) && rb.length === roh.length;
  if (identisch) { for (let i = 0; i < roh.length; i++) { if (rb[i] !== roh[i]) { identisch = false; break; } } }
  if (!identisch) throw new Error('v2-Sicherung fehlgeschlagen — Umstellung abgebrochen, Daten unverändert.');
}

// Kurs kopieren: die Kopie bekommt eigene sids (vergibSids, aus der neuen kursId) — sonst träfe eine Löschmarke oder Trennung im
// neuen Kurs dasselbe Kind im alten (die Zuordnung ist nach sid geschlüsselt, nicht nach Kurs).
const ohneSid = liste => JSON.parse(JSON.stringify(liste || [])).map(({ sid: _s, ...k }) => k);
// Ganz entfernt (nur ohne Einträge möglich, UI): Löschmarke, damit der Abgleich das Kind nicht mit dem älteren Stand zurückholt (B2).
function markiereEntfernt(stamm, kinder, kursId, am) {
  if (!kinder || !kinder.length) return;
  stamm.geloeschteKinder = stamm.geloeschteKinder || {};
  for (const k of kinder) stamm.geloeschteKinder[sidVonKind(k, kursId)] = { am };
}
const kindGeloescht = l => Boolean(l && l.am && !(l.wieder && String(l.wieder) > String(l.am)));
// Steht ein Kind mit wirksamer Löschmarke (wieder) im eigenen Stamm, wurde es neu angelegt (Mappe neu geladen, Kurs neu angelegt):
// Marke aufheben, wie hebeLoeschungAuf für Kurse (Prüfer 20.10. G4). Aufgerufen aus stammMutiert.
function hebeKindLoeschungAuf(stamm, jetzt) {
  const m = stamm && stamm.geloeschteKinder;
  if (!m) return;
  for (const [kursId, liste] of Object.entries(stamm.schueler || {})) {
    for (const k of liste || []) { const l = m[sidVonKind(k, kursId)]; if (kindGeloescht(l)) l.wieder = jetzt; }
  }
}

// Geräte-Kennung: zufällig je Installation, gerätelokal (nie im Stamm — sonst hielten beide Geräte nach dem Abgleich dieselbe).
// lies/schreib: Speicherzugriff des Aufrufers (IndexedDB der Instanz; DEV und PROD teilen sich die Origin, nicht die DB).
async function geraeteId(lies, schreib) {
  const da = await lies();
  if (typeof da === 'string' && da.startsWith('g:')) return da;
  const neu = 'g:' + crypto.randomUUID();
  await schreib(neu);
  return neu;
}

// ── Zuordnung vereinigen (beide Geräte) — reihenfolgefrei: bei gleichem Schlüssel gewinnt der kleinere Wert ──
const kleiner = (a, b) => (String(a) <= String(b) ? a : b);
const groesser = (a, b) => (a == null ? b : b == null ? a : String(a) >= String(b) ? a : b);
function vereinigeMap(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? kleiner(out[k], v) : v;
  return out;
}
function vereinigeZuordnung(a = {}, b = {}) {
  const sidAlias = vereinigeMap(a.sidAlias, b.sidAlias);
  const trennungen = {};
  for (const [s, t] of [...Object.entries(a.trennungen || {}), ...Object.entries(b.trennungen || {})]) {
    const c = trennungen[s];
    if (!c) { trennungen[s] = t.kinder ? { kinder: { ...t.kinder }, ereignisse: { ...t.ereignisse }, geraete: { ...t.geraete }, standard: t.standard } : { gleich: true }; continue; }
    if (!t.kinder) continue;                                  // „gleich“ trifft auf „zwei Kinder“: die Trennung gilt (nichts wird vermischt)
    if (!c.kinder) { trennungen[s] = { kinder: { ...t.kinder }, ereignisse: { ...t.ereignisse }, geraete: { ...t.geraete }, standard: t.standard }; continue; }
    c.kinder = vereinigeMap(c.kinder, t.kinder);
    c.ereignisse = vereinigeMap(c.ereignisse, t.ereignisse);
    c.geraete = vereinigeMap(c.geraete, t.geraete);
    c.standard = kleiner(c.standard, t.standard);
  }
  const geloeschteKinder = {};
  for (const [s, l] of [...Object.entries(a.geloeschteKinder || {}), ...Object.entries(b.geloeschteKinder || {})]) {
    const c = geloeschteKinder[s];
    const am = c ? groesser(c.am, l.am) : l.am, wieder = c ? groesser(c.wieder, l.wieder) : l.wieder;
    geloeschteKinder[s] = wieder ? { am, wieder } : { am };
  }
  return { sidAlias, trennungen, geloeschteKinder };
}
const zuordnungVon = stamm => ({ sidAlias: (stamm && stamm.sidAlias) || {}, trennungen: (stamm && stamm.trennungen) || {}, geloeschteKinder: (stamm && stamm.geloeschteKinder) || {} });

// Alias auflösen (Ketten; die Richtung größer → kleiner schließt Zyklen aus, der Schutz bleibt für Altbestand)
function aufgeloest(sid, alias) {
  const gesehen = new Set();
  while (sid && alias[sid] && !gesehen.has(sid)) { gesehen.add(sid); sid = alias[sid]; }
  return sid;
}
// Welche sid trägt ein Eintrag nach der Zuordnung? Trennung zuerst (Eintrags-id, dann Gerät, dann standard), dann Alias.
function zielSidEvent(e, zuord) {
  let sid = sidVonEvent(e);
  if (!sid) return null;
  const t = zuord.trennungen[sid];
  if (t && t.kinder) {
    const h = t.ereignisse[e.id] || (e.geraetId && t.geraete[e.geraetId]) || t.standard;
    if (h && t.kinder[h]) sid = t.kinder[h];
  }
  return aufgeloest(sid, zuord.sidAlias);
}
function zielSidKind(k, kursId, zuord) {
  let sid = sidVonKind(k, kursId);
  const t = zuord.trennungen[sid];
  if (t && t.kinder && t.kinder[namensHash(k)]) sid = t.kinder[namensHash(k)];
  return aufgeloest(sid, zuord.sidAlias);
}

// Zuordnung auf Stamm und Einträge anwenden — auf Kopien, nie in place. IDEMPOTENT.
// Kinder: sid nach Trennung/Alias; zwei Kinder mit derselben Ziel-sid → es bleibt das, das diese sid schon selbst trägt (das Ziel
// des Alias, nicht die zweite Anlage), sonst das erste. Leere Zuordnungsfelder kommen nicht in den Stamm (sonst Scheinkonflikte).
// Gelöschte Kinder fallen weg — außer es gibt Einträge für sie (Prüfer 20.10. R2: entfernt werden konnte nur ein Kind ohne Einträge, jeder
// Eintrag stammt also vom anderen Gerät, auch einer von VOR der Löschung, der noch nicht abgeglichen war). Dann wieder aufgenommen, einmal
// gemeldet, und die Marke trägt `wieder` (K2: sonst käme die Meldung bei jedem Abgleich).
function wendeZuordnungAn(stamm, events, zuord = zuordnungVon(stamm)) {
  const hinweise = [];
  const ev = (events || []).map(e => {
    const z = zielSidEvent(e, zuord);
    return z && z !== e.sid ? { ...e, sid: z } : e;
  });
  if (!stamm) return { stamm, events: ev, hinweise };
  const mitEintrag = new Set(ev.filter(e => e.sid && e.typ !== 'storno').map(e => e.sid));
  const loesch = { ...zuord.geloeschteKinder };
  const schueler = {};
  for (const [kursId, liste] of Object.entries(stamm.schueler || {})) {
    const mitZiel = (liste || []).map(k => ({ k, sid: zielSidKind(k, kursId, zuord) }));
    const traeger = new Map();
    for (const x of mitZiel) {
      const da = traeger.get(x.sid);
      if (!da || (da.k.sid !== x.sid && x.k.sid === x.sid)) traeger.set(x.sid, x);
    }
    const out = [];
    for (const x of mitZiel) {
      if (traeger.get(x.sid) !== x) continue;
      const l = loesch[x.sid];
      if (kindGeloescht(l)) {
        if (!mitEintrag.has(x.sid)) continue;
        loesch[x.sid] = { am: l.am, wieder: String(l.am) + '+' };   // aufgehoben unmittelbar nach der Löschung — beide Geräte gleich
        hinweise.push(((x.k.vorname || '') + ' ' + (x.k.name || '')).trim() + ' war entfernt, hat aber Einträge vom anderen Gerät — wieder aufgenommen');
      }
      out.push(x.sid === x.k.sid ? x.k : { ...x.k, sid: x.sid });
    }
    schueler[kursId] = out;
  }
  const s = { ...stamm, schueler };
  const felder = { sidAlias: zuord.sidAlias, trennungen: zuord.trennungen, geloeschteKinder: loesch };
  for (const [f, w] of Object.entries(felder)) {
    if (Object.keys(w).length) s[f] = w; else delete s[f];
  }
  return { stamm: s, events: ev, hinweise };
}

export { altSid, neueSid, istAltSid, sidVonKind, sidVonEvent, namensSchluessel, namensHash, trennSid, vergibSids, sichereRoh, ohneSid,
  markiereEntfernt, kindGeloescht, hebeKindLoeschungAuf, geraeteId, vereinigeZuordnung, zuordnungVon, aufgeloest, zielSidEvent, zielSidKind,
  wendeZuordnungAn };
