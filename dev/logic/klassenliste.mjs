// kladde/logic/klassenliste · Scheibe E „Klassenliste“ (Zero 20.10.: neue Klasse in der App anlegen, Kinder eingeben, alphabetisch und
// frei; Wahl B „Eingabezeile + Liste“). Rein, ohne DOM — Node-testbar (test/klassenliste.test.mjs).
// Grundsatz: Anlegen nummeriert lückenlos nach der sichtbaren Reihenfolge (Nr = Zeile in der Mappe). Nachträgliches Umordnen
// (E3) vertauscht nur die vorhandenen Listen-Nrn der aktiven Kinder — die Ausweis-Nr (Einträge, Sitzplatz, sid) bleibt, Lücken und die
// Zeilen inaktiver Kinder bleiben unberührt (zwei Nummern, logic/teilnehmer.mjs).
import { parseSchuelerListe } from './parser.mjs';
import { schreibform } from './teilnehmer.mjs';

// Eine Regel für „alphabetisch“: Nachname, dann Vorname, deutsch — dieselbe wie Kursseite, Sitzplan und Heute (kurse.mjs, heute.mjs)
const vergleicheAlpha = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'de') || String(a.vorname || '').localeCompare(String(b.vorname || ''), 'de');
const sortiereAlpha = kinder => (kinder || []).slice().sort(vergleicheAlpha);
const istAlphabetisch = kinder => (kinder || []).every((k, i, a) => i === 0 || vergleicheAlpha(a[i - 1], k) <= 0);

// Ein Feld „Vorname Nachname“ teilen (Lehrer: „Ich denke Elif Yilmaz“): Nachname = letztes Wort samt davorstehender Namenspartikel
// („Lena von der Heide“ → Vorname „Lena“, Nachname „von der Heide“); ein einzelnes Wort ist der Nachname (wie der Parser).
const PARTIKEL = new Set(['von', 'van', 'de', 'der', 'den', 'del', 'zu', 'zur', 'vom', 'al', 'el', 'di', 'da', 'dos', 'du', 'le', 'la', 'ten', 'ter', 'bin', 'ibn', 'zum', 'dem']);
function teileName(text) {
  const w = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (w.length < 2) return { vorname: '', name: w[0] || '' };
  let i = w.length - 1;
  while (i > 1 && PARTIKEL.has(w[i - 1].toLowerCase())) i--;
  return { vorname: w.slice(0, i).join(' '), name: w.slice(i).join(' ') };
}

// Vor dem Parser (Prüfer 20.10. 🟡 6): eine Kopfzeile mit „Vorname“ fällt weg und tauscht die Spalten, wenn „Vorname“ vor „Name“ bzw.
// „Nachname“ steht (der Parser liest die erste Namensspalte als Nachnamen); „1. Anna Müller“ oder „12 Anna Müller“ ohne Tab trägt die Nr
// vorn — sie wird zur Nr-Spalte, sonst stand „1. Anna“ im Vornamen.
function vorbereiten(text) {
  const zeilen = String(text ?? '').split(/\r?\n/);
  const i0 = zeilen.findIndex(z => z.trim());
  let tausch = null;
  if (i0 >= 0) {
    const kopf = zeilen[i0].split(/\t|;/).map(f => f.trim().toLowerCase());
    const v = kopf.indexOf('vorname'), n = kopf.findIndex(f => f === 'name' || f === 'nachname');
    if (v >= 0) { zeilen.splice(i0, 1); if (n > v) tausch = [v, n]; }
  }
  return zeilen.map(z => {
    if (/\t|;/.test(z)) { if (!tausch) return z; const f = z.split(/\t|;/); [f[tausch[0]], f[tausch[1]]] = [f[tausch[1]], f[tausch[0]]]; return f.join('\t'); }
    const m = z.trim().match(/^(\d{1,2})[.)]?\s+(\S.*)$/);
    return m ? m[1] + '\t' + m[2] : z;
  }).join('\n');
}

// Eingefügter Text (Excel-Spalten, Untis, getippt) → Kinder in Listenreihenfolge. Tab/Semikolon-Spalten und „Nachname, Vorname“
// liest der vorhandene Parser; ein einzelnes Feld mit Leerzeichen wird als „Vorname Nachname“ geteilt (sonst stand alles im Nachnamen).
// Ein Komma im einzigen Namensfeld heißt „Nachname, Vorname“ auch neben einer Nr- oder LB-Spalte (Prüfer 20.10. 🔴 1: der Parser teilt
// am Komma nur einzeilige Felder, „1⇥Yilmaz, Elif“ wurde still zu Vorname „Yilmaz,“).
// Rückgabe: { kinder:[{vorname,name,lb}], mitNr, luecken, hinweise } — mitNr: die Liste trug eine Nr-Spalte (ihre Reihenfolge gilt);
// luecken: diese Nrn waren nicht 1…n (die Kladde nummeriert lückenlos; für eine bestehende Mappe ist „Mappe laden“ der Weg).
function liesEinfuegen(text) {
  const { schueler, warnungen } = parseSchuelerListe(vorbereiten(text));
  const mitNr = schueler.length > 0 && !warnungen.some(w => /^Keine Nr-Spalte/.test(w));
  const geteilt = new Set();
  const kinder = schueler.map(s => {
    if (!s.vorname && s.name.includes(',')) { const [n, ...v] = s.name.split(','); geteilt.add(s.nr); return { vorname: v.join(',').trim(), name: n.trim(), lb: !!s.lb }; }
    if (!s.vorname && /\s/.test(s.name)) { geteilt.add(s.nr); return { ...teileName(s.name), lb: !!s.lb }; }
    return { vorname: s.vorname, name: s.name.replace(/,\s*$/, ''), lb: !!s.lb };
  });
  const hinweise = warnungen.filter(w => !/^Keine Nr-Spalte/.test(w)).filter(w => { const m = w.match(/^Nr (\d+): nur ein Namensfeld/); return !(m && geteilt.has(Number(m[1]))); });
  const luecken = mitNr && schueler.some((s, i) => s.nr !== i + 1);
  return { kinder, mitNr, luecken, hinweise };
}

// Doppelte Namen (Prüfer 20.10. 🟡 10): nur ein Hinweis, nie gesperrt — Namensgleiche gibt es wirklich. Schreibform wie „Liste aktualisieren“.
function doppelte(kinder) {
  const n = new Map();
  for (const k of kinder || []) { const s = schreibform(k.vorname) + '|' + schreibform(k.name); n.set(s, [...(n.get(s) || []), k]); }
  return [...n.values()].filter(g => g.length > 1).map(g => ((g[0].vorname ? g[0].vorname + ' ' : '') + (g[0].name || '')).trim());
}

// Ein Element verschieben (↑↓ und Ziehen): neue Liste, die alte bleibt unberührt
function verschiebe(liste, von, nach) {
  const a = (liste || []).slice();
  if (von < 0 || von >= a.length || nach < 0 || nach >= a.length || von === nach) return a;
  const [x] = a.splice(von, 1); a.splice(nach, 0, x);
  return a;
}

// Anlegen (E1): Nr = Zeile, lückenlos 1…n — ausdrücklich, damit die Mappe Zeile für Zeile passt
const nummeriere = kinder => (kinder || []).map((k, i) => ({ nr: i + 1, name: String(k.name || '').trim(), vorname: String(k.vorname || '').trim(), lb: !!k.lb }));

// Umordnen (E3): reihenfolge = Ausweis-Nrn der aktiven Kinder in der gewünschten Folge. Die Menge ihrer Listen-Nrn bleibt, nur die Zuordnung
// wechselt (aufsteigend vergeben). Gibt null zurück, wenn die Folge nicht genau die aktiven Kinder nennt (nie halb umordnen).
function ordneNeu(liste, reihenfolge) {
  const alle = (liste || []).map(s => ({ ...s }));
  const lnr = s => (s.liste !== undefined ? s.liste : s.nr);
  const aktive = alle.filter(s => !s.inaktiv && lnr(s) != null);
  const folge = reihenfolge || [];
  if (folge.length !== aktive.length || new Set(folge).size !== folge.length || !folge.every(nr => aktive.some(s => s.nr === nr))) return null;
  const nummern = aktive.map(lnr).sort((a, b) => a - b);
  folge.forEach((nr, i) => { const s = alle.find(x => x.nr === nr); if (nummern[i] === s.nr) delete s.liste; else s.liste = nummern[i]; });
  return alle;
}

export { vergleicheAlpha, sortiereAlpha, istAlphabetisch, teileName, liesEinfuegen, doppelte, verschiebe, nummeriere, ordneNeu };
