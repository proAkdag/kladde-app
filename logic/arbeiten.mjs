// kladde/logic/arbeiten · Scheibe D1 „Arbeiten“ (Plan kladde/PLAN_2026-10-21_scheibe_D.md). Rein, Node-geprüft gegen das Excel-Soll
// (test/soll_mappe_fest.json, test/soll_mappe_zufall.json). Jede Rechnung bildet eine Formel der Vorlage v15.2 nach; der Zeiger nennt die
// Zeile in _build/build_klassenmappe_v15_2.py (G:…). Rundung nur über excelRunde (logic/excelrechnen).
// Zero 21.10.: Schlüssel je Arbeit (vorbelegt aus dem Kurs) · LB „—“ · leer ≠ 0 · eine Arbeit gehört einem Quartal (aus dem Datum) ·
// Test statt Arbeit möglich (zählt in D2 als Zusatznote der Mitarbeit).
// Alles in der Mappe ist ein Ereignis (Vor-Bedingung 3): Definition (arbeit), Punkte (punkte), Lob (lob). Eine Änderung nennt in
// `ersetzt` die id(s), die sie ablöst. Zwei lebende Köpfe für dieselbe Zelle = Konflikt (zwei Geräte zugleich) — gemeldet, nie über die Uhr entschieden.
import { excelRunde, excelObergrenze, nachschlagen, mittelwert, summe, zahlText } from './excelrechnen.mjs';
import { typenMit } from './vertrag.mjs';

const OB_AB = Object.freeze([0, .20, .27, .33, .39, .45, .50, .55, .60, .65, .70, .75, .80, .85, .90, .95]);   // G:244–247 (Zentralabitur NRW)
const OB_LABEL = Object.freeze(['6', '5-', '5', '5+', '4-', '4', '4+', '3-', '3', '3+', '2-', '2', '2+', '1-', '1', '1+']);
const MAX_AUFGABEN = 12;   // wie die Vorlage (G:436) — der Rückmeldebogen ist dafür gebaut

const istOb = schluessel => schluessel && schluessel.art === 'ob';
function standardSchluessel(profil) {
  return profil === 'sek2' ? { art: 'ob', ab: [...OB_AB] } : { art: 'sek1', vier: .45, fuenf: .18 };   // G:255–258
}
// Sek I: aus „4 ab“ und „5 ab“ zwölf Drittelschritte (G:260–280). grenzen = „Note 1 … 6 ab“ (F12:F17), gitter = Rechengitter M12:M17.
function sek1Gitter(s) {
  const g3 = (1 - s.vier) / 12;
  const n1 = excelRunde(1 - 3 * g3, 6), n2 = excelRunde(1 - 6 * g3, 6), n3 = excelRunde(1 - 9 * g3, 6);
  return { grenzen: [n1, n2, n3, s.vier, s.fuenf, 0], gitter: [0, s.fuenf, s.vier, n3, n2, n1], noten: [6, 5, 4, 3, 2, 1] };
}
// Note aus der Quote: LOOKUP(ROUND(Q;6);…) (G:465/467). Sek I → ganze Note 1–6, Oberstufe → Punkte 0–15.
function noteAusQuote(q, schluessel) {
  const q6 = excelRunde(q, 6);
  if (istOb(schluessel)) return nachschlagen(q6, schluessel.ab, schluessel.ab.map((_, i) => i));
  const g = sek1Gitter(schluessel);
  return nachschlagen(q6, g.gitter, g.noten);
}
const obLabel = p => (typeof p === 'number' ? OB_LABEL[p] : null);   // G:468

// Rückmeldebogen „Note 1 … 6 ab Punkten“: CEILING(Grenze·Gesamt; 0,5) (G:1008–1013). Oberstufe: 13/10/7/4/1 P und 0 (G:955–957).
function abPunkten(schluessel, gesamt) {
  const grenzen = istOb(schluessel) ? [13, 10, 7, 4, 1].map(p => schluessel.ab[p]).concat(0) : sek1Gitter(schluessel).grenzen;
  return grenzen.map(g => excelObergrenze(g * gesamt, .5));
}
// „Ergebnis: 86,3 %“ (G:1001): ROUND(Q·100; 1), deutsches Komma.
const ergebnisText = q => (q == null ? 'Ergebnis: –' : 'Ergebnis: ' + zahlText(excelRunde(q * 100, 1)) + ' %');

// Auswertung einer Arbeit. arbeit: { aufgaben:[{id,max}], schluessel } · kinder: [{ sid, lb }] in Anzeige-Reihenfolge ·
// punkte: Map sid → Map aufgabeId → Zahl (fehlt = nicht eingetragen; 0 ist ein Eintrag).
function werteArbeitAus(arbeit, kinder, punkte) {
  const auf = arbeit.aufgaben || [], s = arbeit.schluessel, ob = istOb(s);
  const gesamt = auf.length ? summe(auf.map(a => a.max)) : null;   // P4 (G:445)
  const zeilen = kinder.map(k => {
    const werte = auf.map(a => { const w = punkte && punkte.get(k.sid) && punkte.get(k.sid).get(a.id); return typeof w === 'number' ? w : null; });
    const hat = werte.some(w => w != null);
    const sum = hat ? summe(werte) : null;                           // P8: nur mit mindestens einem Eintrag (G:461)
    const quote = sum == null || !gesamt ? null : sum / gesamt;      // Q8 (G:462)
    const note = quote == null ? null : (k.lb && !ob ? '—' : noteAusQuote(quote, s));   // R8, LB „—“ (G:464–465, Zero F5)
    return { sid: k.sid, werte, summe: sum, quote, note, label: ob ? obLabel(note) : null };
  });
  const noten = zeilen.map(z => z.note).filter(n => typeof n === 'number');
  const spalten = auf.map((a, j) => zeilen.map(z => z.werte[j]));
  const aufgabenSchnitt = spalten.map(c => { const m = mittelwert(c); return m == null ? null : excelRunde(m, 2); });   // D5 (G:441)
  const summenSchnitt = (() => { const m = mittelwert(zeilen.map(z => z.summe)); return m == null ? null : excelRunde(m, 2); })();   // P5
  const erg = {
    gesamt, zeilen, aufgabenSchnitt,
    aufgabenProzent: aufgabenSchnitt.map((m, j) => (m == null ? null : m / auf[j].max)),   // D6 = D5/D4 (gerundeter Schnitt!)
    summenSchnitt, summenProzent: summenSchnitt == null || !gesamt ? null : summenSchnitt / gesamt,
    abPunkten: gesamt ? abPunkten(s, gesamt) : null,
  };
  const schnitt = mittelwert(noten);
  if (ob) {
    erg.spiegel = Array.from({ length: 16 }, (_, i) => noten.filter(n => n === 15 - i).length);   // D46:S46 (G:492–496)
    erg.defizite = noten.filter(n => n < 5).length;                                                  // G47
    erg.schnitt = schnitt == null ? null : excelRunde(schnitt, 1);                                   // K47
    const im = (lo, hi) => noten.filter(n => n >= lo && n <= hi).length;
    erg.gruppen = [im(13, 15), im(10, 12), im(7, 9), im(4, 6), im(1, 3), im(0, 0)];                   // D49:I49 (G:502–513)
  } else {
    erg.spiegel = [1, 2, 3, 4, 5, 6].map(n => noten.filter(x => x === n).length);                     // D46:I46 (G:484–488)
    erg.schnitt = schnitt == null ? null : excelRunde(schnitt, 2);                                   // K46
  }
  return erg;
}

// ── Ereignisse ──
const MAPPEN_TYPEN = Object.freeze(typenMit('mappe'));   // arbeit · punkte · lob (Vertrag)
const ersetzteIds = e => (Array.isArray(e.ersetzt) ? e.ersetzt : e.ersetzt ? [e.ersetzt] : []);
const nachZeit = (a, b) => (String(a.ts) < String(b.ts) ? -1 : String(a.ts) > String(b.ts) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// Köpfe einer Kette: Ereignisse, die kein anderes ersetzt. Gilt: der jüngste Kopf. Konflikt: mehrere Köpfe mit verschiedenem Wert.
function koepfe(liste, wertVon) {
  const abgeloest = new Set(liste.flatMap(ersetzteIds));
  // Ein Ersetzungs-Zyklus (beschädigter Container) hätte keinen Kopf und brachte Abgleich und Kurs-Seite zum Absturz (Prüfer 21.10. 🟢 15):
  // dann zählen alle Glieder als Köpfe — verschiedene Werte erscheinen als Konflikt, nichts geht still verloren.
  const frei = liste.filter(e => !abgeloest.has(e.id));
  const k = (frei.length ? frei : [...liste]).sort(nachZeit);
  const gilt = k[k.length - 1] || null;
  const werte = [...new Set(k.map(e => JSON.stringify(wertVon(e))))];
  return { gilt, koepfe: k, konflikt: werte.length > 1 };
}
const gruppiere = (liste, schluessel) => { const m = new Map(); for (const e of liste) { const s = schluessel(e); m.set(s, [...(m.get(s) || []), e]); } return m; };

// Stand der Mappe eines Kurses aus den (wirksamen) Ereignissen.
// → { arbeiten:[{ arbeitId, art, titel, am, aufgaben, schluessel, gewicht, evId, konflikt }] (ohne gelöschte, nach Datum),
//     punkte: Map arbeitId → Map sid → Map aufgabeId → Zahl, konflikte: [{ art, arbeitId, sid, aufgabeId, werte, koepfe }],
//     lob: Map arbeitId → Map sid → Text, kopf: (art, …schlüssel) → evId des geltenden Kopfs (für `ersetzt`) }
function mappenStand(events, kursId) {
  const eigene = (events || []).filter(e => e.kursId === kursId && MAPPEN_TYPEN.includes(e.typ));
  const konflikte = [], koepfeNach = new Map();
  const arbeiten = [], definition = new Map();   // definition: arbeitId → geltender Kopf (auch gelöscht), für verwaiste Punkte
  for (const [arbeitId, liste] of gruppiere(eigene.filter(e => e.typ === 'arbeit'), e => e.arbeitId)) {
    const k = koepfe(liste, e => ({ ...e, id: 0, ts: 0, ersetzt: 0, geraet: 0, geraetId: 0 }));
    koepfeNach.set('arbeit|' + arbeitId, k.koepfe.map(e => e.id));
    // Löschen gegen Bearbeiten auf zwei Geräten (Prüfer 21.10. 🟡): nie über die Uhr — die Arbeit bleibt sichtbar mit ⚠, bis jemand
    // „Bearbeiten → Speichern“ oder „Löschen“ wählt (beides ersetzt alle Köpfe). Sonst kam sie zurück oder blieb unlösbar gemeldet.
    const lebend = k.koepfe.filter(e => !e.geloescht);
    const loeschKonflikt = k.konflikt && lebend.length > 0 && lebend.length < k.koepfe.length;
    const g = loeschKonflikt ? lebend[lebend.length - 1] : k.gilt;
    if (g) definition.set(arbeitId, { kopf: g, geloescht: !!g.geloescht, ts: String(g.ts) });
    if (!g || g.geloescht) continue;
    if (k.konflikt) konflikte.push({ art: 'arbeit', arbeitId, loeschKonflikt, koepfe: k.koepfe.map(e => e.id) });
    arbeiten.push({ arbeitId, art: g.art === 'test' ? 'test' : 'arbeit', titel: g.titel || '', am: g.am || '', aufgaben: g.aufgaben || [],
      schluessel: g.schluessel, gewicht: g.gewicht ?? 1, evId: g.id, konflikt: k.konflikt, loeschKonflikt });
  }
  // Sichtbar heißt: die Arbeit lebt und trägt die Aufgabe noch. Konflikte an Unsichtbarem kann niemand lösen — sie zählen nicht als offen.
  const sichtbar = (arbeitId, aufgabeId) => { const d = definition.get(arbeitId);
    return !!d && !d.geloescht && (aufgabeId == null || (d.kopf.aufgaben || []).some(x => x.id === aufgabeId)); };
  const verwaist = [];   // Punkte, die NACH dem Löschen ihrer Arbeit/Aufgabe eingetragen wurden (zwei Geräte) — gemeldet, nie still verloren
  arbeiten.sort((a, b) => String(a.am).localeCompare(String(b.am)) || a.arbeitId.localeCompare(b.arbeitId));
  const punkte = new Map();
  for (const [s, liste] of gruppiere(eigene.filter(e => e.typ === 'punkte'), e => e.arbeitId + '|' + e.sid + '|' + e.aufgabeId)) {
    const k = koepfe(liste, e => (typeof e.wert === 'number' ? e.wert : null));
    koepfeNach.set('punkte|' + s, k.koepfe.map(e => e.id));
    const { arbeitId, sid, aufgabeId } = k.gilt;
    if (!sichtbar(arbeitId, aufgabeId)) {
      const d = definition.get(arbeitId);
      if (typeof k.gilt.wert === 'number' && d && String(k.gilt.ts) > d.ts) verwaist.push({ arbeitId, sid, aufgabeId, wert: k.gilt.wert });
      continue;
    }
    if (k.konflikt) konflikte.push({ art: 'punkte', arbeitId, sid, aufgabeId, werte: k.koepfe.map(e => e.wert), koepfe: k.koepfe.map(e => e.id) });
    if (typeof k.gilt.wert !== 'number') continue;
    if (!punkte.has(arbeitId)) punkte.set(arbeitId, new Map());
    const proKind = punkte.get(arbeitId);
    if (!proKind.has(sid)) proKind.set(sid, new Map());
    proKind.get(sid).set(aufgabeId, k.gilt.wert);
  }
  const lob = new Map();
  for (const [s, liste] of gruppiere(eigene.filter(e => e.typ === 'lob'), e => e.arbeitId + '|' + e.sid)) {
    const k = koepfe(liste, e => e.text || '');
    koepfeNach.set('lob|' + s, k.koepfe.map(e => e.id));
    const { arbeitId, sid } = k.gilt;
    if (!sichtbar(arbeitId)) continue;
    if (k.konflikt) konflikte.push({ art: 'lob', arbeitId, sid, werte: k.koepfe.map(e => e.text || ''), koepfe: k.koepfe.map(e => e.id) });
    if (!k.gilt.text) continue;
    if (!lob.has(arbeitId)) lob.set(arbeitId, new Map());
    lob.get(arbeitId).set(sid, k.gilt.text);
  }
  // ersetzt für die nächste Änderung: alle Köpfe (löst einen Konflikt mit auf)
  const kopf = (art, ...teile) => { const k = koepfeNach.get(art + '|' + teile.join('|')) || []; return k.length > 1 ? k : k[0] || null; };
  return { arbeiten, punkte, lob, konflikte, verwaist, kopf };
}
// Konflikte und verwaiste Punkte des ganzen Tresors (für die Abgleich-Meldung).
function mappenKonflikte(events) {
  const kurse = [...new Set((events || []).filter(e => MAPPEN_TYPEN.includes(e.typ)).map(e => e.kursId))];
  return kurse.flatMap(k => mappenStand(events, k).konflikte.map(x => ({ ...x, kursId: k })));
}
function mappenVerwaist(events) {
  const kurse = [...new Set((events || []).filter(e => MAPPEN_TYPEN.includes(e.typ)).map(e => e.kursId))];
  return kurse.flatMap(k => mappenStand(events, k).verwaist.map(x => ({ ...x, kursId: k })));
}

// Eingabe einer Punktzahl: '' = Eintrag löschen (null), Komma oder Punkt, 0 … max. Nie still kürzen (Prüfbedingung D1·10).
function lesePunkte(text, max) {
  const t = String(text ?? '').trim().replace(',', '.');
  if (t === '') return { ok: true, wert: null };
  if (!/^(\d+(\.\d+)?|\.\d+)$/.test(t)) return { ok: false, fehler: 'keine Zahl' };   // „,5“ ist eine Zahl (Prüfer 21.10.)
  const w = Number(t);
  if (w > max) return { ok: false, fehler: 'höchstens ' + zahlText(max) };
  return { ok: true, wert: w };
}
// Türen der Mappe je Kurs (Zero 21.10.: „nicht jeder Kurs braucht die Klassenkasse oder den Reiter für Klassenarbeiten/Klausuren“,
// Vorbelegung „Arbeiten an, Kasse aus“). Ein Kurs von vor v3.0 hat kein Feld: Arbeiten an, Kasse aus. Aus heißt nur ausgeblendet.
function mappeSchalter(k) {
  const m = (k && k.mappe) || {};
  return { arbeiten: m.arbeiten !== false, kasse: m.kasse === true };
}
// Vorbelegung des Schlüssels einer neuen Arbeit (Zero F3 „je Arbeit, vorbelegt“): der Schlüssel der jüngsten Arbeit des Kurses mit
// derselben Stufe, sonst der Standard. Die Arbeit trägt ihn danach selbst — spätere Arbeiten ändern ihn nicht.
function schluesselVorlage(arbeiten, profil) {
  const art = profil === 'sek2' ? 'ob' : 'sek1';
  const letzte = [...(arbeiten || [])].reverse().find(a => a.schluessel && a.schluessel.art === art);
  return letzte ? JSON.parse(JSON.stringify(letzte.schluessel)) : standardSchluessel(profil);
}
// Prüft einen Schlüssel aus dem Dialog. → Fehlertext oder null.
function schluesselFehler(s) {
  if (!s) return 'kein Schlüssel';
  if (istOb(s)) {
    if (!Array.isArray(s.ab) || s.ab.length !== 16 || s.ab[0] !== 0) return 'Die Tabelle braucht 16 Stufen ab 0 %.';
    for (let i = 1; i < 16; i++) if (!(s.ab[i] > s.ab[i - 1] && s.ab[i] < 1)) return 'Die Schwellen müssen von 0 bis unter 100 % steigen.';
    return null;
  }
  if (!(s.fuenf > 0 && s.vier > s.fuenf && s.vier < 1)) return '„5 ab“ muss über 0 und unter „4 ab“ liegen, „4 ab“ unter 100 %.';
  return null;
}

// Quartal einer Arbeit aus ihrem Datum (Zero F8-Vorschlag: aus dem Datum): erster Zeitraum q1…q4, der das Datum enthält.
function quartalVon(am, schuljahr) {
  const z = ((schuljahr && schuljahr.zeitraeume) || []).filter(x => /^q[1-4]$/.test(x.id));
  const t = z.find(x => am >= x.von && am <= x.bis);
  return t ? t.id : null;
}

export { OB_AB, OB_LABEL, MAX_AUFGABEN, MAPPEN_TYPEN, standardSchluessel, sek1Gitter, noteAusQuote, obLabel, abPunkten, ergebnisText,
  werteArbeitAus, mappenStand, mappenKonflikte, mappenVerwaist, lesePunkte, quartalVon, mappeSchalter, schluesselVorlage, schluesselFehler };
