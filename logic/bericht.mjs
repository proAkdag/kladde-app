// kladde/logic/bericht · Schüler-Kurzbericht als Text (Zero 2026-09-02, Punkt 8).
// Für Elternsprechtag und Zeugnisbemerkung: Bilanz, Fehlzeiten, gesetzte Quartalsnoten,
// datierte Notizen — in die Zwischenablage, der Mensch fügt ein. Rein, kein DOM.
//
// Eingabe: { name, kurs, fach, zeitraum, profil, v (verdichte-Ergebnis), quartalsnoten:[{label,wert}],
//            notizen:[{datum,text,typ}], verspMinuten, datumLabel:fn }

function schuelerBericht(b) {
  const z = [];
  const dl = b.datumLabel || (d => d);
  z.push(`${b.name} · ${b.kurs}${b.fach ? ' · ' + b.fach : ''}${b.zeitraum ? ' · ' + b.zeitraum : ''}`);
  const v = b.v || {};
  const n = (v.nPlus || 0) + (v.nNull || 0) + (v.nMinus || 0);
  z.push(`Mitarbeit: ${v.nPlus || 0}× ＋ · ${v.nNull || 0}× o · ${v.nMinus || 0}× − (${n} Meldungen) · beteiligt an ${v.beteiligtTermine || 0} von ${v.kursTermine || 0} Terminen · Verlauf ${v.pfeil || '→'}`);
  z.push(`Vorschlag: ${v.vorschlag ? v.vorschlag.label : '—'}`);
  const f = [];
  if (v.nFehltE) f.push(`${v.nFehltE}× entschuldigt`);
  if (v.nFehltU) f.push(`${v.nFehltU}× unentschuldigt`);
  if (v.nFehltO) f.push(`${v.nFehltO}× ungeklärt`);
  if (b.verspMinuten) f.push(`${b.verspMinuten} min verspätet`);
  if (v.nVerweigert) f.push(`${v.nVerweigert}× Leistung verweigert`);
  z.push(`Fehlzeiten: ${f.length ? f.join(' · ') : 'keine'}`);
  if (b.quartalsnoten && b.quartalsnoten.length)
    z.push('Quartalsnoten: ' + b.quartalsnoten.map(q => `${q.label} ${q.wert}`).join(' · '));
  if (b.notizen && b.notizen.length) {
    z.push('Notizen:');
    for (const nz of b.notizen) z.push(`  ${dl(nz.datum)} ${nz.typ === 'verweigert' ? '⊘ ' : ''}${nz.text}`);
  }
  return z.join('\n');
}

export { schuelerBericht };
