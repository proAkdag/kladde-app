// kladde/test/identitaet · v2.2 Identität (Plan 19.10. Scheibe B·1, Prüfbedingungen 1–5) · erfundene Kinder
// Jede Prüfung trägt ihren roten Gegenfall: B1 gegen das eingefrorene v2.1.0-Modul (der alte Fehler muss dort sichtbar sein),
// die übrigen gegen die Gegen-Antwort bzw. einen Stand ohne die Zuordnung.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeContainerDaten } from '../logic/merge.mjs';
import { altSid, sidVonEvent, vergibSids, vereinigeZuordnung, wendeZuordnungAn, geraeteId } from '../logic/identitaet.mjs';

const kurs = { id: 'k1', name: '7z', fach: 'M', profil: 'sek1' };
const ev = (id, nr, typ, ts, extra = {}) => ({ id, kursId: 'k1', schuelerNr: nr, typ, datum: '2026-10-01', ts, ...extra });
const stamm = (rev, geraet, kinder, extra = {}) => ({ rev, ts: '2026-10-01T10:0' + rev + ':00Z', geraet, kurse: [{ ...kurs }], schueler: { k1: kinder },
  sitzplaene: {}, kursprofile: {}, wochenplan: [], ausnahmeSlots: [], stundenplanSlots: [], ...extra });
const zaehler = () => { let n = 0; return () => 'n:test-' + (++n); };
const kinder = r => r.daten.stamm.schueler.k1.map(k => k.vorname + ' ' + k.nr);
const vonKind = (r, vorname) => { const k = r.daten.stamm.schueler.k1.find(x => x.vorname === vorname); return r.daten.events.filter(e => e.sid === k.sid).map(e => e.id).sort(); };

// ── 1 · B1: gleiche Ausweis-Nr 2 auf zwei Geräten, verschiedene Kinder (Daten wie repro_2026-10-19.mjs) ──
const b1pc = () => ({ schema: 'kladde/v2', stamm: stamm(5, 'pc', [{ nr: 1, vorname: 'Ada', name: 'Test' }, { nr: 2, vorname: 'Anna', name: 'Probe' }]), events: [ev('e1', 1, '+', '2026-10-01T09:00:00Z')] });
const b1ipad = () => ({ schema: 'kladde/v2', stamm: stamm(3, 'ipad', [{ nr: 1, vorname: 'Ada', name: 'Test' }, { nr: 2, vorname: 'Ben', name: 'Muster' }]),
  events: [ev('e2', 2, '-', '2026-10-01T09:05:00Z'), ev('e3', 2, '-', '2026-10-01T09:06:00Z')] });

test('B1: Anna behält ihre Einträge, Ben bekommt seine — zwei Kinder, Frage gestellt', () => {
  const r = mergeContainerDaten(b1pc(), b1ipad());
  assert.deepEqual(kinder(r), ['Ada 1', 'Anna 2', 'Ben 3']);
  assert.deepEqual(vonKind(r, 'Anna'), []);
  assert.deepEqual(vonKind(r, 'Ben'), ['e2', 'e3']);
  assert.deepEqual(vonKind(r, 'Ada'), ['e1']);
  assert.equal(r.offen, 1);
  assert.equal(r.fragen[0].art, 'zwei');
  const ben = r.daten.stamm.schueler.k1.find(x => x.vorname === 'Ben');
  assert.equal(ben.liste, 2);                                     // sichtbare Zeile bleibt, die Ausweis-Nr ist neu
  assert.equal(r.daten.stamm.kurse[0].ausweisBis, 3);
});
// Nur im Werk: das Release-Repo hat kein _release/ (tools/tests_fuer_release, 20.10.) — dort sichtbar ausgelassen, nicht still grün
const ALT_DA = existsSync(fileURLToPath(new URL('../_release/v2.1.0/logic/merge.mjs', import.meta.url)));
test('B1 Gegenfall: das v2.1.0-Original gibt Anna Bens Minus (Vorschlag 5+)', { skip: !ALT_DA && 'v2.1.0-Original liegt nur im Werk' }, async () => {
  const alt = await import('../_release/v2.1.0/logic/merge.mjs');
  const altVerdichte = (await import('../_release/v2.1.0/logic/verdichtung.mjs')).verdichte;   // die alte Welt ganz alt: Bindung über die Nr
  const r = alt.mergeContainerDaten(b1pc(), b1ipad());
  const v = altVerdichte(r.daten.events.filter(e => e.kursId === 'k1'), 2, { profil: 'sek1' });
  assert.equal(r.daten.stamm.schueler.k1.find(x => x.nr === 2).vorname, 'Anna');
  assert.equal(r.daten.events.filter(e => e.schuelerNr === 2).length, 2);
  assert.match(JSON.stringify(v.vorschlag), /5\+/);
});
test('B1 Gegenrichtung: Antwort „dasselbe Kind“ legt die Einträge zusammen (die Prüfung unterscheidet)', () => {
  const r = mergeContainerDaten(b1pc(), b1ipad(), { antworten: { 'zwei|a:k1:2|ben|muster': false } });
  assert.deepEqual(kinder(r), ['Ada 1', 'Anna 2']);
  assert.deepEqual(vonKind(r, 'Anna'), ['e2', 'e3']);
  assert.equal(r.offen, 0);
});

// ── 2 · Determinismus: derselbe v2-Tresor, auf zwei Geräten getrennt migriert ──
const klasse = () => ({ schema: 'kladde/v2', stamm: stamm(4, 'pc', [{ nr: 1, vorname: 'Ada', name: 'Test' }, { nr: 2, vorname: 'Anna', name: 'Probe' }, { nr: 3, vorname: 'Cem', name: 'Kaya' }]),
  events: [ev('e1', 1, '+', '2026-10-01T09:00:00Z'), ev('e2', 3, 'o', '2026-10-01T09:01:00Z')] });
test('Determinismus: getrennt migriert → gleiche sids, Abgleich ohne neue Kinder und ohne Fragen', () => {
  const a = klasse(), b = klasse();
  b.stamm.geraet = 'ipad'; b.stamm.rev = 5;
  b.events.push(ev('e3', 2, '-', '2026-10-01T09:02:00Z'));
  vergibSids(a); vergibSids(b);
  assert.deepEqual(a.stamm.schueler.k1.map(k => k.sid), b.stamm.schueler.k1.map(k => k.sid));
  const r = mergeContainerDaten(a, b);
  assert.deepEqual(kinder(r), ['Ada 1', 'Anna 2', 'Cem 3']);
  assert.equal(r.fragen.length, 0);
  assert.deepEqual(vonKind(r, 'Anna'), ['e3']);
});
test('Determinismus Gegenfall: Zufalls-sid für den Altbestand → jedes Kind wird zur Frage, die Klasse verdoppelt sich', () => {
  const a = klasse(), b = klasse();
  b.stamm.geraet = 'ipad'; b.stamm.rev = 5;
  const z = zaehler();
  for (const k of b.stamm.schueler.k1) k.sid = z();
  const r = mergeContainerDaten(a, b);
  assert.equal(r.fragen.filter(f => f.art === 'dasselbe').length, 3);
  assert.equal(r.daten.stamm.schueler.k1.length, 6);
});

// ── 3 · Reihenfolge: merge(A,B) = merge(B,A) — zwei neue Kinder mit derselben Ausweis-Nr ──
test('Reihenfolge egal: gleiche Kinder, Nrn und Zuordnung der Einträge aus beiden Richtungen', () => {
  const pc = { schema: 'kladde/v3', stamm: stamm(6, 'pc', [{ nr: 1, sid: 'n:aaa', vorname: 'Ada', name: 'Test' }, { nr: 2, sid: 'n:pc2', vorname: 'Dana', name: 'Neu' }]),
    events: [ev('p1', 2, '+', '2026-10-01T09:00:00Z', { sid: 'n:pc2' })] };
  const ipad = { schema: 'kladde/v3', stamm: stamm(4, 'ipad', [{ nr: 1, sid: 'n:aaa', vorname: 'Ada', name: 'Test' }, { nr: 2, sid: 'n:ip2', vorname: 'Emil', name: 'Neu' }]),
    events: [ev('i1', 2, '-', '2026-10-01T09:03:00Z', { sid: 'n:ip2' })] };
  const ab = mergeContainerDaten(pc, ipad), ba = mergeContainerDaten(ipad, pc);
  const bild = r => JSON.stringify({ k: r.daten.stamm.schueler.k1.map(k => [k.sid, k.nr, k.liste ?? null, k.vorname]), e: r.daten.events.map(e => [e.id, e.sid]), bis: r.daten.stamm.kurse[0].ausweisBis });
  assert.equal(bild(ab), bild(ba));
  assert.deepEqual(kinder(ab), ['Ada 1', 'Dana 2', 'Emil 3']);
  assert.deepEqual(vonKind(ab, 'Emil'), ['i1']);
  assert.deepEqual(vonKind(ab, 'Dana'), ['p1']);
});

// ── 4 · B2: am PC entferntes Kind kehrt nicht mit dem älteren iPad-Stand zurück ──
const b2 = (mitMarke, ipadEvents = []) => [
  { schema: 'kladde/v3', stamm: stamm(5, 'pc', [{ nr: 1, sid: 'a:k1:1', vorname: 'Ada', name: 'Test' }], mitMarke ? { geloeschteKinder: { 'a:k1:2': { am: '2026-10-02T08:00:00Z' } } } : {}), events: [] },
  { schema: 'kladde/v2', stamm: stamm(2, 'ipad', [{ nr: 1, vorname: 'Ada', name: 'Test' }, { nr: 2, vorname: 'Cem', name: 'Probe' }]), events: ipadEvents }];
test('B2: Löschmarke hält das Kind draußen, auch aus der Gegenrichtung', () => {
  const [pc, ipad] = b2(true);
  assert.deepEqual(kinder(mergeContainerDaten(pc, ipad)), ['Ada 1']);
  assert.deepEqual(kinder(mergeContainerDaten(ipad, pc)), ['Ada 1']);
  assert.ok(mergeContainerDaten(pc, ipad).daten.stamm.geloeschteKinder['a:k1:2']);
});
test('B2 Gegenfall: ohne Löschmarke kommt das Kind zurück (der alte Fehler)', () => {
  const [pc, ipad] = b2(false);
  assert.deepEqual(kinder(mergeContainerDaten(pc, ipad)), ['Ada 1', 'Cem 2']);
});
// Prüfer 20.10. R2: entfernt werden kann nur ein Kind ohne Einträge — jeder Eintrag stammt also vom anderen Gerät, auch einer von VOR
// der Löschung, der noch nicht abgeglichen war. Er holt das Kind zurück, gemeldet wird einmal (K2), ohne Einträge bleibt es weg.
test('B2: Einträge vom anderen Gerät (vor oder nach der Löschung) holen das Kind zurück, einmal gemeldet', () => {
  for (const ts of ['2026-10-03T09:00:00Z', '2026-10-01T09:00:00Z']) {
    const [pc, ipad] = b2(true, [ev('c1', 2, '+', ts)]);
    const r = mergeContainerDaten(pc, ipad);
    assert.deepEqual(kinder(r), ['Ada 1', 'Cem 2'], ts);
    assert.ok(r.hinweise.some(h => /Cem Probe war entfernt, hat aber Einträge vom anderen Gerät/.test(h)), ts);
    const nochmal = mergeContainerDaten({ ...r.daten, stamm: { ...r.daten.stamm, rev: 9 } }, ipad);   // K2: kein zweites Mal
    assert.deepEqual(kinder(nochmal), ['Ada 1', 'Cem 2']);
    assert.equal(nochmal.hinweise.filter(h => /war entfernt/.test(h)).length, 0);
  }
});
test('B2 Gegenrichtung: ohne Einträge bleibt das entfernte Kind weg; neu angelegt hebt die Marke auf (G4)', async () => {
  const { hebeKindLoeschungAuf } = await import('../logic/identitaet.mjs');
  const [pc, ipad] = b2(true);
  assert.deepEqual(kinder(mergeContainerDaten(pc, ipad)), ['Ada 1']);
  const wieder = JSON.parse(JSON.stringify(pc)); wieder.stamm.schueler.k1.push({ nr: 2, sid: 'a:k1:2', vorname: 'Dilan', name: 'Neu' });
  hebeKindLoeschungAuf(wieder.stamm, '2026-10-05T08:00:00Z');                     // stammMutiert nach „Mappe neu laden“
  assert.equal(wieder.stamm.geloeschteKinder['a:k1:2'].wieder, '2026-10-05T08:00:00Z');
  const r = mergeContainerDaten(wieder, { ...pc, stamm: { ...pc.stamm, rev: 1, geraet: 'ipad' } });
  assert.deepEqual(kinder(r), ['Ada 1', 'Dilan 2']);
});
test('G4: Kurs endgültig gelöscht → seine Löschmarken, Trennungen und Aliase gehen mit', async () => {
  const { entferneKursReferenzen } = await import('../logic/merge.mjs');
  const s = { kurse: [{ id: 'k1' }, { id: 'k2' }], schueler: {}, geloeschteKinder: { 'a:k1:2': { am: 'x' }, 'a:k2:2': { am: 'x' } },
    trennungen: { 'a:k1:3': { gleich: true } }, sidAlias: { 'n:z': 't:a:k1:4:abc', 'n:y': 'n:a' } };
  const r = entferneKursReferenzen(s, ['k1']);
  assert.deepEqual(Object.keys(r.geloeschteKinder), ['a:k2:2']);
  assert.deepEqual(r.trennungen, {});
  assert.deepEqual(r.sidAlias, { 'n:y': 'n:a' });
});

// ── 5 · Antworten wirken auf dem anderen Gerät: keine neue Frage, neue Einträge folgen dem richtigen Kind ──
// Prüfer 20.10. R1: nach „zwei Kinder“ trug Anna weiter die Alt-sid; jede spätere iPad-Buchung für sie fiel über die Geräte-Regel an Ben.
// Jetzt bekommen BEIDE eine neue sid. Ablauf mit echten v3-Einträgen (geraetId), ohne Handarbeit am Stamm:
const b1v3 = (geraet, gid, kinderListe, events) => ({ schema: 'kladde/v3', stamm: stamm(geraet === 'pc' ? 5 : 3, geraet, kinderListe), events: events.map(e => ({ ...e, sid: 'a:k1:' + e.schuelerNr, geraetId: gid })) });
test('„zwei Kinder“ (R1): Annas spätere iPad-Buchung bleibt bei Anna, Bens Buchung vom alten iPad-Stand bei Ben, keine neue Frage', () => {
  const pc = b1v3('pc', 'g:pc', [{ nr: 1, sid: 'a:k1:1', vorname: 'Ada', name: 'Test' }, { nr: 2, sid: 'a:k1:2', vorname: 'Anna', name: 'Probe' }], [ev('p1', 2, '+', '2026-10-01T09:00:00Z')]);
  const ipadAlt = b1v3('ipad', 'g:ipad', [{ nr: 1, sid: 'a:k1:1', vorname: 'Ada', name: 'Test' }, { nr: 2, sid: 'a:k1:2', vorname: 'Ben', name: 'Muster' }], [ev('e2', 2, '-', '2026-10-01T09:05:00Z')]);
  const r1 = mergeContainerDaten(pc, ipadAlt, { antworten: { 'zwei|a:k1:2|ben|muster': true } });   // der PC holt und antwortet
  assert.equal(r1.offen, 0);
  assert.deepEqual(vonKind(r1, 'Anna'), ['p1']); assert.deepEqual(vonKind(r1, 'Ben'), ['e2']);
  assert.ok(r1.daten.stamm.schueler.k1.every(k => !/^a:k1:2$/.test(k.sid)));                     // beide neu, keiner trägt die Alt-sid
  // Das iPad übernimmt den PC-Stand und bucht für Anna (über ihre neue sid, wie addEvent → sidVonNr)
  const annaSid = r1.daten.stamm.schueler.k1.find(k => k.vorname === 'Anna').sid;
  const ipadNeu = { schema: 'kladde/v3', stamm: { ...r1.daten.stamm, rev: 7, geraet: 'ipad' }, events: [...r1.daten.events, { ...ev('iA', 2, '+', '2026-10-02T09:00:00Z'), sid: annaSid, geraetId: 'g:ipad' }] };
  // Ein zweites, noch altes iPad-Profil bucht weiter für Ben unter der Alt-sid
  const ipadNochAlt = { ...ipadAlt, events: [...ipadAlt.events, { ...ev('iB', 2, '-', '2026-10-02T09:05:00Z'), sid: 'a:k1:2', geraetId: 'g:ipad' }] };
  for (const [x, y] of [[ipadNeu, pc], [pc, ipadNeu], [ipadNeu, ipadNochAlt], [ipadNochAlt, ipadNeu]]) {
    const r = mergeContainerDaten(x, y);
    assert.equal(r.fragen.length, 0);
    assert.deepEqual(vonKind(r, 'Anna').filter(id => id !== 'iB'), vonKind(r, 'Anna'));          // nie Bens Buchung bei Anna
    if (r.daten.events.some(e => e.id === 'iA')) assert.ok(vonKind(r, 'Anna').includes('iA'));
    if (r.daten.events.some(e => e.id === 'iB')) assert.ok(vonKind(r, 'Ben').includes('iB'));
  }
});
test('„zwei Kinder“ (G1): beide Geräte antworten unabhängig → dieselben sids, beim nächsten Abgleich keine Frage', () => {
  const pc = b1pc(), ipad = b1ipad();
  const amPc = mergeContainerDaten(pc, ipad, { antworten: { 'zwei|a:k1:2|ben|muster': true } });
  const amIpad = mergeContainerDaten(ipad, { ...pc, stamm: { ...pc.stamm, rev: 1 } }, { antworten: { 'zwei|a:k1:2|anna|probe': true } });   // dort ist Ben die Basis
  const sids = r => r.daten.stamm.schueler.k1.map(k => k.vorname + '=' + k.sid).sort();
  assert.deepEqual(sids(amPc), sids(amIpad));
  const r = mergeContainerDaten({ ...amPc.daten, stamm: { ...amPc.daten.stamm, rev: 8 } }, { ...amIpad.daten, stamm: { ...amIpad.daten.stamm, rev: 4 } });
  assert.equal(r.fragen.length, 0);
  assert.deepEqual(kinder(r).map(k => k.split(' ')[0]).sort(), ['Ada', 'Anna', 'Ben']);
});
test('„umbenannt“ (G2): die Antwort reist mit, das andere Gerät fragt nicht erneut', () => {
  const pc = { schema: 'kladde/v3', stamm: stamm(5, 'pc', [{ nr: 1, sid: 'a:k1:1', vorname: 'Anna', name: 'Probe' }]), events: [] };
  const ipad = { schema: 'kladde/v3', stamm: stamm(3, 'ipad', [{ nr: 1, sid: 'a:k1:1', vorname: 'Ana', name: 'Probe' }]), events: [] };
  const r1 = mergeContainerDaten(pc, ipad, { antworten: { 'zwei|a:k1:1|ana|probe': false } });
  assert.deepEqual(r1.daten.stamm.trennungen, { 'a:k1:1': { gleich: true } });
  const r2 = mergeContainerDaten({ ...r1.daten, stamm: { ...r1.daten.stamm, rev: 6 } }, ipad);
  assert.equal(r2.fragen.length, 0);
  assert.deepEqual(kinder(r2), ['Anna 1']);
});
test('„dasselbe Kind“ (G1): beide Geräte antworten mit verschiedener Basis → ein Alias, kein Zyklus, eine Clara', () => {
  const mk = (rev, geraet, sid, id) => ({ schema: 'kladde/v3', stamm: stamm(rev, geraet, [{ nr: 2, sid, vorname: 'Clara', name: 'Neu' }]), events: [ev(id, 2, '+', '2026-10-01T09:0' + rev + ':00Z', { sid })] });
  const pc = mk(5, 'pc', 'n:clara-pc', 'p1'), ipad = mk(3, 'ipad', 'n:clara-ipad', 'i1');
  const a = mergeContainerDaten(pc, ipad, { antworten: { 'dasselbe|n:clara-ipad|n:clara-pc': true } });
  const b = mergeContainerDaten({ ...ipad, stamm: { ...ipad.stamm, rev: 9 } }, pc, { antworten: { 'dasselbe|n:clara-pc|n:clara-ipad': true } });
  assert.deepEqual(a.daten.stamm.sidAlias, b.daten.stamm.sidAlias);
  const r = mergeContainerDaten({ ...a.daten, stamm: { ...a.daten.stamm, rev: 10 } }, { ...b.daten, stamm: { ...b.daten.stamm, rev: 2 } });
  assert.equal(r.fragen.length, 0);
  assert.equal(r.daten.stamm.schueler.k1.length, 1);
  assert.deepEqual(vonKind(r, 'Clara'), ['i1', 'p1']);
});
test('G5: Rücklese-Sicherung wirft bei einem gekippten Byte, sonst nicht', async () => {
  const { sichereRoh } = await import('../logic/identitaet.mjs');
  const roh = new Uint8Array([1, 2, 3, 4]);
  let ablage = null;
  await sichereRoh(roh, async v => { ablage = new Uint8Array(v); }, async () => ablage);
  await assert.rejects(sichereRoh(roh, async v => { ablage = new Uint8Array(v); ablage[2] ^= 1; }, async () => ablage), /v2-Sicherung fehlgeschlagen/);
  await assert.rejects(sichereRoh(roh, async () => {}, async () => null), /v2-Sicherung fehlgeschlagen/);
});
test('K1: gleiche rev und gleicher ts — das Ergebnis hängt nicht an der Reihenfolge', () => {
  const s = (geraet, farbe) => ({ ...stamm(4, geraet, [{ nr: 1, sid: 'a:k1:1', vorname: 'Ada', name: 'Test' }]), ts: '2026-10-01T10:00:00Z', kurse: [{ ...kurs, farbHue: farbe }] });
  const a = { schema: 'kladde/v3', stamm: s('pc', 10), events: [] }, b = { schema: 'kladde/v3', stamm: s('ipad', 200), events: [] };
  assert.deepEqual(mergeContainerDaten(a, b).daten.stamm, mergeContainerDaten(b, a).daten.stamm);
});
test('„zwei Kinder“ Gegenfall: ohne Trennung im Stamm fragt das zweite Gerät erneut', () => {
  const r1 = mergeContainerDaten(b1pc(), b1ipad(), { antworten: { 'zwei|a:k1:2|ben|muster': true } });
  const ohne = { ...r1.daten.stamm, rev: 6 }; delete ohne.trennungen;
  const r2 = mergeContainerDaten({ schema: 'kladde/v3', stamm: ohne, events: r1.daten.events.map(e => ({ ...e, sid: sidVonEvent({ ...e, sid: null }) })) }, b1ipad());
  assert.equal(r2.fragen.length, 1);
});
test('„dasselbe Kind“: zwei Geräte legten Clara getrennt an — ein Kind, Einträge beider, Alias wirkt auch beim zweiten Abgleich', () => {
  const pc = { schema: 'kladde/v3', stamm: stamm(5, 'pc', [{ nr: 1, sid: 'n:ada', vorname: 'Ada', name: 'Test' }, { nr: 2, sid: 'n:clara-pc', vorname: 'Clara', name: 'Neu' }]),
    events: [ev('p1', 2, '+', '2026-10-01T09:00:00Z', { sid: 'n:clara-pc' })] };
  const ipad = { schema: 'kladde/v3', stamm: stamm(3, 'ipad', [{ nr: 1, sid: 'n:ada', vorname: 'Ada', name: 'Test' }, { nr: 2, sid: 'n:clara-ipad', vorname: 'Clara', name: 'Neu' }]),
    events: [ev('i1', 2, 'o', '2026-10-01T09:05:00Z', { sid: 'n:clara-ipad' })] };
  const offen = mergeContainerDaten(pc, ipad);
  assert.deepEqual(offen.fragen.map(f => f.id), ['dasselbe|n:clara-ipad|n:clara-pc']);
  assert.deepEqual(kinder(offen), ['Ada 1', 'Clara 2', 'Clara 3']);           // offen: getrennt (Gegenrichtung zur Antwort)
  const ja = mergeContainerDaten(pc, ipad, { antworten: { 'dasselbe|n:clara-ipad|n:clara-pc': true } });
  assert.deepEqual(kinder(ja), ['Ada 1', 'Clara 2']);
  assert.deepEqual(vonKind(ja, 'Clara'), ['i1', 'p1']);
  const nochmal = mergeContainerDaten({ ...ja.daten, stamm: { ...ja.daten.stamm, rev: 6 } }, ipad);
  assert.equal(nochmal.fragen.length, 0);
  assert.deepEqual(kinder(nochmal), ['Ada 1', 'Clara 2']);
  assert.deepEqual(vonKind(nochmal, 'Clara'), ['i1', 'p1']);
});

// ── 6 · Noteneinheit (Prüfer v2.1 B2): eine Quartalsnote bleibt in ihrer Einheit, ein Moduswechsel per Abgleich wird gemeldet ──
import { einheitPasst, einheitVon, notenEinheit } from '../logic/skalen.mjs';
test('Einheit: Q1 = 13 P, Kurs per Abgleich auf Drittel → Meldung; gleicher Modus → keine', () => {
  const k2 = (rev, geraet, notenmodus) => ({ rev, ts: '2026-10-01T10:0' + rev + ':00Z', geraet, kurse: [{ id: 'q1k', name: 'Q1', fach: 'M', profil: 'sek2', notenmodus }],
    schueler: { q1k: [{ nr: 1, sid: 'a:q1k:1', vorname: 'Ada', name: 'Test' }] }, sitzplaene: {}, kursprofile: {}, wochenplan: [], ausnahmeSlots: [], stundenplanSlots: [] });
  const qn = { id: 'qn1', typ: 'quartalsnote', kursId: 'q1k', sid: 'a:q1k:1', hj: 1, quartal: 1, wert: 13, einheit: 'punkte', datum: '2026-10-01', ts: '2026-10-01T09:00:00Z' };
  const pc = { schema: 'kladde/v3', stamm: k2(3, 'pc', 'punkte'), events: [qn] };
  const ipad = { schema: 'kladde/v3', stamm: k2(5, 'ipad', 'drittel'), events: [] };
  const r = mergeContainerDaten(pc, ipad);
  assert.ok(r.konflikte.some(m => m === 'Q1 · M: Notenmodus ist jetzt Drittelnoten, 1 Quartalsnote steht noch in Punkten — bitte prüfen.'), JSON.stringify(r.konflikte));
  const gleich = mergeContainerDaten(pc, { ...ipad, stamm: k2(5, 'ipad', 'punkte') });
  assert.equal(gleich.konflikte.filter(m => /Notenmodus/.test(m)).length, 0);
});
test('Einheit: Note trägt ihre Einheit; ohne Einheit (vor v2.1) gilt die des Kurses', () => {
  const punkteKurs = { profil: 'sek2' }, drittelSek2 = { profil: 'sek2', notenmodus: 'drittel' }, sek1 = { profil: 'sek1' };
  assert.deepEqual([notenEinheit(punkteKurs), notenEinheit(drittelSek2), notenEinheit(sek1)], ['punkte', 'drittel', 'drittel']);
  assert.equal(einheitVon({ wert: 13, einheit: 'punkte' }, drittelSek2), 'punkte');
  assert.equal(einheitPasst({ wert: 13, einheit: 'punkte' }, drittelSek2), false);
  assert.equal(einheitPasst({ wert: 13 }, drittelSek2), true);                        // Gegenrichtung: alte Note ohne Einheit
  assert.equal(einheitPasst({ wert: 13, einheit: 'punkte' }, punkteKurs), true);
});

// ── Wächter B·2: keine Ansicht bindet einen Eintrag über die Nr an ein Kind (Zero 19.10. „W2 · alle Lesestellen umstellen“) ──
// Erlaubt: Kommentare und das Wegwerfen des Altfelds in bucheErneut (`schuelerNr:_nr`). Verboten: jedes `.schuelerNr` im Code und
// jeder Aufruf von verdichte/quartalsVerlauf/quartalsnotenVon mit einer Nr statt einer sid.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const JS = fileURLToPath(new URL('../js/', import.meta.url));   // nicht .pathname: ein Leerzeichen im Pfad bliebe „%20“
function alleModule(dir = JS) {
  return readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? alleModule(p) : n.endsWith('.mjs') ? [p] : []; });
}
const ohneKommentare = t => t.split(/\r?\n/).map(z => z.replace(/(^|[^:'"\\])\/\/.*$/, '$1')).join('\n');   // CRLF: „.“ passt nicht auf \r
function nrBindungen(quellen) {
  const befunde = [];
  for (const [p, t] of Object.entries(quellen)) {
    const code = ohneKommentare(t);
    for (const m of code.matchAll(/\.schuelerNr\b/g)) befunde.push(p + ': .schuelerNr bei ' + m.index);
    for (const m of code.matchAll(/\b(verdichte|quartalsVerlauf|quartalsnotenVon)\(([^,()]|\([^()]*\))+,\s*([\w.]*\.nr|nr)\s*[,)]/g)) befunde.push(p + ': ' + m[1] + ' mit Nr');
  }
  return befunde;
}
const QUELLEN = Object.fromEntries(alleModule().map(p => [p.slice(JS.length).replace(/\\/g, '/'), readFileSync(p, 'utf8')]));   // relativ zu JS: im Release-Repo heißt der Ordner js/, nicht app/js/
test('Wächter: keine Bindung Eintrag → Kind über die Nr in app/js', () => {
  assert.ok(Object.keys(QUELLEN).length >= 20);                           // alle Module gelesen (Kern + Ansichten + Start)
  assert.deepEqual(nrBindungen(QUELLEN), []);
});
test('Wächter Gegenfall: eine eingeschleuste Nr-Bindung und ein verdichte mit s.nr werden gemeldet', () => {
  const p = 'ansichten/heute.mjs';
  const kaputt = { ...QUELLEN, [p]: QUELLEN[p] + '\nconst x=vault.events.filter(e=>e.schuelerNr===nr);\nconst v=verdichte(kursEvents,s.nr,{});\n' };
  assert.deepEqual(nrBindungen(kaputt).map(b => b.replace(/ bei \d+$/, '')), [p + ': .schuelerNr', p + ': verdichte mit Nr']);
});

// ── Bausteine ──
test('altSid ohne Namen; sidVonEvent für v2-Einträge; kursweite Einträge ohne sid', () => {
  assert.equal(altSid('k1', 7), 'a:k1:7');
  assert.equal(sidVonEvent({ kursId: 'k1', schuelerNr: 7 }), 'a:k1:7');
  assert.equal(sidVonEvent({ kursId: 'k1', typ: 'termin' }), null);
  assert.equal(sidVonEvent({ sid: 'n:x', kursId: 'k1', schuelerNr: 7 }), 'n:x');
});
test('vergibSids idempotent', () => {
  const v = klasse();
  assert.equal(vergibSids(v), true);
  const snap = JSON.stringify(v);
  assert.equal(vergibSids(v), false);
  assert.equal(JSON.stringify(v), snap);
});
test('vereinigeZuordnung reihenfolgefrei', () => {
  const a = { sidAlias: { 'n:x': 'n:b' }, geloeschteKinder: { 'a:k1:2': { am: '2026-10-02' } }, trennungen: { 's|n': { neu: 'n:2', ereignisse: ['e2'], geraete: [] } } };
  const b = { sidAlias: { 'n:x': 'n:a' }, geloeschteKinder: { 'a:k1:2': { am: '2026-10-05' } }, trennungen: { 's|n': { neu: 'n:1', ereignisse: ['e3'], geraete: ['g:1'] } } };
  assert.deepEqual(vereinigeZuordnung(a, b), vereinigeZuordnung(b, a));
  assert.equal(vereinigeZuordnung(a, b).sidAlias['n:x'], 'n:a');
  assert.equal(vereinigeZuordnung(a, b).geloeschteKinder['a:k1:2'].am, '2026-10-05');
});
test('wendeZuordnungAn: leere Zuordnung lässt den Stamm ohne neue Felder', () => {
  const s = stamm(1, 'pc', [{ nr: 1, sid: 'a:k1:1', vorname: 'Ada', name: 'Test' }]);
  const r = wendeZuordnungAn(s, []);
  assert.deepEqual(Object.keys(r.stamm).sort(), Object.keys(s).sort());
});
test('geraeteId: einmal vergeben, danach gelesen', async () => {
  let ablage = null;
  const id1 = await geraeteId(async () => ablage, async v => { ablage = v; });
  const id2 = await geraeteId(async () => ablage, async v => { ablage = v; });
  assert.match(id1, /^g:[0-9a-f-]{36}$/);
  assert.equal(id1, id2);
});
