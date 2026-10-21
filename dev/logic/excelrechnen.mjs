// kladde/logic/excelrechnen · Rechnen wie Excel (Scheibe D „Mappe“, Plan 21.10.). Die Mappe rechnet auf die Stelle wie die
// Excel-Vorlage v15.2. Das Soll kommt aus Excel selbst (tools/soll_mappe_zufall_com.py, test/soll_mappe_*.json), nie aus diesem Code.
// Gemessen 21.10. (Soll-Befund S2): ROUND(2,5−2⁻⁴⁸;0) = 3 und ROUND(1,005;2) = 1,01 in Excel — Math.round gibt 2 bzw. 1,00.
// Excel rechnet hier mit 15 gültigen Stellen. Darum ist excelRunde die EINZIGE Rundung der Mappen-Logik (Wächter: test/mappe_soll.test.mjs).

// Zahl auf 15 gültige Stellen, als Dezimaltext (Mantisse, Exponent) — dort sind „2,4999999999999964“ und 2,5 dieselbe Zahl.
function zerlege15(x) {
  const t = Math.abs(x).toPrecision(15);
  const i = t.indexOf('e');
  return i < 0 ? { m: t, e: 0 } : { m: t.slice(0, i), e: Number(t.slice(i + 1)) };
}
// Verschiebt das Komma im Dezimaltext (kein Multiplizieren: 1,005·100 wäre 100,49999…).
const schiebe = (z, n) => Number(z.m + 'e' + (z.e + n));

// ROUND(x; n): halbe Werte von der Null weg, auf 15 gültigen Stellen.
function excelRunde(x, n = 0) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return x;
  if (x === 0) return 0;
  const r = Math.round(schiebe(zerlege15(x), n));   // positiv: Math.round rundet ,5 nach oben = von der Null weg
  const v = Number(r + 'e' + (-n));
  return x < 0 ? -v : v;
}
// CEILING(x; s) für positive x und s (Rückmeldebogen „ab Punkten“, Schritt 0,5): der Quotient zuerst auf 15 Stellen.
function excelObergrenze(x, s) {
  if (!Number.isFinite(x) || !(s > 0)) return x;
  const q = Number(Math.abs(x / s).toPrecision(15));
  return excelRunde(Math.sign(x) * Math.ceil(q) * s, 10);
}
// LOOKUP(wert; gitter; ergebnis): größter Gitterwert ≤ wert (Gitter aufsteigend). Kein Treffer → null.
function nachschlagen(wert, gitter, ergebnis) {
  let treffer = null;
  for (let i = 0; i < gitter.length; i++) if (gitter[i] <= wert) treffer = ergebnis[i];
  return treffer;
}
// AVERAGE über die Zahlen einer Liste (Text, leer und null zählen nicht, 0 zählt). Keine Zahl → null (Excel: #DIV/0! → IFERROR "").
function mittelwert(liste) {
  const z = liste.filter(x => typeof x === 'number' && Number.isFinite(x));
  if (!z.length) return null;
  let s = 0; for (const x of z) s += x;
  return s / z.length;
}
// SUM in Spaltenreihenfolge (Gleitkomma: die Reihenfolge zählt wie in Excel).
function summe(liste) { let s = 0; for (const x of liste) if (typeof x === 'number') s += x; return s; }
// Zahl wie Excels „&“-Verkettung in deutscher Einstellung: 86,3 · 85 · 0,5 (keine Nullen am Ende).
function zahlText(x) { return String(x).replace('.', ','); }

export { excelRunde, excelObergrenze, nachschlagen, mittelwert, summe, zahlText };
