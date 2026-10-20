// kladde/test/vertrag · Wächter Kladde-Vertrag (A2 Modul-Umbau): der Code gegen app/logic/vertrag.mjs.
// Prüft: jedes stamm.<feld> steht im Vertrag (und jedes Vertragsfeld kommt im Code vor) · jeder gebuchte Typ, jede
// Beschriftung (TYP_LABEL), jede Bewertung (BEWERTUNGS_TYPEN), jeder Termin-/SoMi-Typ (verdichtung), jeder Kachel-Fall
// (reduziereStand) und das Beamer-Verbergen (sichtLabel) stimmen mit dem Vertrag. Die Prüfungen sind reine Funktionen
// über den Quelltext; je Prüfung ein Gegenfall mit verändertem Quelltext, der rot werden muss.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { STAMM_FELDER, EINTRAGSTYPEN, WERKZEUGE, felderMitKurs, typenMit } from '../logic/vertrag.mjs';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const lies = p => readFileSync(join(APP, p), 'utf-8').replace(/\r\n/g, '\n');
const alle = (d, akku = []) => { for (const n of readdirSync(join(APP, d), { withFileTypes: true })) { const r = d + '/' + n.name;
  if (n.isDirectory()) alle(r, akku); else if (n.name.endsWith('.mjs')) akku.push(r); } return akku; };
const QUELLEN = Object.fromEntries([...alle('js'), ...alle('logic')].map(p => [p, lies(p)]));   // A2: js/kern/ gehört dazu
const TRESOR = 'js/kern/tresor.mjs';   // leererVault und stammMutiert (A2 Schnitt 3)
// Eigene `typ`-Felder, die keine Eintragstypen sind: Zelltyp der Excel-Datei, Wochentyp A/B des Zeitmodells
const ANDERER_TYP = { 'logic/xlsx.mjs': 'Zelltyp', 'logic/zeitmodell.mjs': 'Wochentyp A/B' };
// In merge.mjs heißt das Ergebnis von mergeStammdaten lokal `stamm` — das sind keine Stammfelder
const MERGE_ERGEBNIS = new Set(['ergebnis', 'konflikt', 'konflikte', 'verworfen', 'hinweise', 'fragen']);
const zeichenketten = s => [...s.matchAll(/'([^']*)'/g)].map(m => m[1]);
const jsText = q => Object.entries(q).filter(([p]) => p.startsWith('js/')).map(([, t]) => t).join('\n');   // alle Module unter js/
const gleich = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());

// ── Prüfungen (Quelltexte → Befunde, leer = in Ordnung) ──
function pruefeStammfelder(quellen) {
  const befunde = [], gesehen = new Set();
  for (const [p, t] of Object.entries(quellen)) {
    for (const m of t.matchAll(/(?<![\w])stamm\??\.([A-Za-z_]\w*)/g)) {
      if (p === 'logic/merge.mjs' && MERGE_ERGEBNIS.has(m[1])) continue;
      gesehen.add(m[1]);
      if (!STAMM_FELDER[m[1]]) befunde.push(`${p}: stamm.${m[1]} steht nicht im Vertrag`);
    }
  }
  const neu = (quellen[TRESOR] || '').match(/function leererVault\(\)\{[\s\S]*?stamm:\{([^\n]*)\},\n/);
  if (!neu) befunde.push('leererVault: Stamm-Literal nicht gefunden');
  else for (const f of Object.keys(new Function('GERAET', `return {${neu[1]}};`)('probe'))) {   // nur die oberste Ebene
    gesehen.add(f);
    if (!STAMM_FELDER[f]) befunde.push(`leererVault: Feld ${f} steht nicht im Vertrag`);
  }
  for (const f of Object.keys(STAMM_FELDER)) if (!gesehen.has(f)) befunde.push(`Vertragsfeld ${f} kommt im Code nicht vor`);
  return befunde;
}
function pruefeGebuchteTypen(quellen) {
  const befunde = [], bekannt = t => EINTRAGSTYPEN[t] || WERKZEUGE[t];
  for (const [p, t] of Object.entries(quellen)) {
    if (ANDERER_TYP[p]) continue;
    for (const m of t.matchAll(/typ\s*(?:===|!==|:)\s*'([^']+)'/g)) if (!bekannt(m[1])) befunde.push(`${p}: Typ '${m[1]}' steht nicht im Vertrag`);
    for (const m of t.matchAll(/addEvent\('([^']+)'/g)) if (!EINTRAGSTYPEN[m[1]]) befunde.push(`${p}: addEvent('${m[1]}') ohne Vertragstyp`);
  }
  const app = jsText(quellen);
  const rail = app.match(/const RAIL_TITEL=\{([^\n]*)\};/), tag = app.match(/const TAG_BEWERTUNGEN=\[([^\n]*)\];/);
  if (!rail || !tag) befunde.push('RAIL_TITEL oder TAG_BEWERTUNGEN nicht gefunden');
  else {
    for (const m of rail[1].matchAll(/'([^']+)':'/g)) if (!bekannt(m[1])) befunde.push(`RAIL_TITEL: '${m[1]}' steht nicht im Vertrag`);
    for (const m of tag[1].matchAll(/\['([^']+)'/g)) if (!bekannt(m[1])) befunde.push(`TAG_BEWERTUNGEN: '${m[1]}' steht nicht im Vertrag`);
  }
  return befunde;
}
function pruefeBeschriftung(quellen) {
  const m = jsText(quellen).match(/const TYP_LABEL=(\{[^\n]*\});/);
  if (!m) return ['TYP_LABEL nicht gefunden'];
  const ist = new Function('return ' + m[1])();
  const soll = Object.fromEntries(Object.entries(EINTRAGSTYPEN).filter(([, v]) => v.label !== null).map(([k, v]) => [k, v.label]));
  const befunde = [];
  for (const k of new Set([...Object.keys(ist), ...Object.keys(soll)])) if (ist[k] !== soll[k]) befunde.push(`TYP_LABEL['${k}'] = ${JSON.stringify(ist[k])}, Vertrag ${JSON.stringify(soll[k])}`);
  return befunde;
}
function pruefeMengen(quellen) {
  const befunde = [], app = jsText(quellen), v = quellen['logic/verdichtung.mjs'];
  const menge = (t, name) => { const m = t.match(new RegExp(`const ${name}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`)); return m ? zeichenketten(m[1]) : null; };
  const vergleiche = (name, ist, soll) => { if (!ist) befunde.push(`${name} nicht gefunden`); else if (!gleich(ist, soll)) befunde.push(`${name} = [${ist}], Vertrag [${soll}]`); };
  const bew = typenMit('bewertung');
  vergleiche('BEWERTUNGS_TYPEN (app)', menge(app, 'BEWERTUNGS_TYPEN'), [...bew, ...Object.keys(WERKZEUGE).filter(w => bew.includes(WERKZEUGE[w].bucht))]);
  vergleiche('TERMIN_TYPEN (verdichtung)', menge(v, 'TERMIN_TYPEN'), typenMit('termin'));
  vergleiche('SOMI_TYPEN (verdichtung)', menge(v, 'SOMI_TYPEN'), typenMit('somi'));
  const red = app.match(/function reduziereStand\(evs\)\{([\s\S]*?)\n\}/);
  vergleiche('reduziereStand (Kachel)', red ? [...red[1].matchAll(/e\.typ==='([^']+)'/g)].map(x => x[1]) : null, typenMit('kachel'));
  const sicht = app.match(/function sichtLabel\(e\)\{([^\n]*)\}/);
  const verborgen = sicht && /BEWERTUNGS_TYPEN\.has\(e\.typ\)/.test(sicht[1]) ? [...bew, ...[...sicht[1].matchAll(/e\.typ==='([^']+)'/g)].map(x => x[1])] : null;
  vergleiche('sichtLabel (Beamer)', verborgen, typenMit('beamer'));
  return befunde;
}
const PRUEFUNGEN = { pruefeStammfelder, pruefeGebuchteTypen, pruefeBeschriftung, pruefeMengen };

// ── Der Code hält den Vertrag ──
for (const [name, f] of Object.entries(PRUEFUNGEN)) test(`Vertrag: ${name}`, () => assert.deepEqual(f(QUELLEN), []));

test('Vertrag: Kursbezug in merge folgt dem Vertrag', () => {
  assert.deepEqual(felderMitKurs('schluessel'), ['schueler', 'sitzplaene', 'kursprofile']);
  assert.deepEqual(felderMitKurs('liste'), ['wochenplan', 'ausnahmeSlots', 'stundenplanSlots']);
  assert.match(QUELLEN['logic/merge.mjs'], /const KURS_SCHLUESSEL = felderMitKurs\('schluessel'\);/);
  assert.match(QUELLEN['logic/merge.mjs'], /const KURS_LISTEN = felderMitKurs\('liste'\);/);
});

// ── Gegenfälle: je Prüfung ein veränderter Quelltext, der rot werden muss ──
const mit = (p, vorher, nachher) => {
  if (p === '*') {   // die eine Datei unter js/, die den Anker trägt (A2: Abschnitte wandern zwischen Modulen)
    const treffer = Object.keys(QUELLEN).filter(q => q.startsWith('js/') && QUELLEN[q].includes(vorher));
    assert.equal(treffer.length, 1, `Anker für Gegenfall in ${treffer.length} Dateien: ${vorher}`); p = treffer[0];
  }
  assert.equal(QUELLEN[p].split(vorher).length, 2, `Anker für Gegenfall fehlt oder ist mehrdeutig: ${vorher}`);
  return { ...QUELLEN, [p]: QUELLEN[p].replace(vorher, nachher) };
};
const GEGENFAELLE = [
  ['neues Stammfeld ohne Vertrag', pruefeStammfelder, mit(TRESOR, 'function stammMutiert(){ vault.stamm.rev++;', 'function stammMutiert(){ vault.stamm.revision++; vault.stamm.rev++;'), /stamm\.revision/],
  ['Feld in leererVault ohne Vertrag', pruefeStammfelder, mit(TRESOR, "einstellungen:{slot:'m1'}}", "einstellungen:{slot:'m1'},farben:{}}"), /leererVault: Feld farben/],
  ['Vertragsfeld ohne Code', pruefeStammfelder, mit(TRESOR, "einstellungen:{slot:'m1'}}", '}'), /einstellungen kommt im Code nicht vor/],
  ['gebuchter Typ ohne Vertrag', pruefeGebuchteTypen, mit('*',"addEvent('verweigert'", "addEvent('verweigerung'"), /addEvent\('verweigerung'\)/],
  ['Typvergleich ohne Vertrag', pruefeGebuchteTypen, mit('logic/kursStatus.mjs', "'fehlt_o'", "'fehlt_x'"), /'fehlt_x'/],
  ['Stempel ohne Vertrag', pruefeGebuchteTypen, mit('*',"'lernzeit':'Lernzeit/HA nicht erledigt'", "'hausaufgabe':'Lernzeit/HA nicht erledigt'"), /RAIL_TITEL: 'hausaufgabe'/],
  ['Beschriftung fehlt', pruefeBeschriftung, mit('*',",verweigert:'verweigert (6)'};", '};'), /TYP_LABEL\['verweigert'\]/],
  ['Bewertung fehlt in app', pruefeMengen, mit('*',"'bestleistung','verweigert']);", "'bestleistung']);"), /BEWERTUNGS_TYPEN/],
  ['Termin-Typ fehlt in verdichtung', pruefeMengen, mit('logic/verdichtung.mjs', "'notiz', 'ha', 'verweigert']);", "'notiz', 'verweigert']);"), /TERMIN_TYPEN/],
  ['Kachel-Fall fehlt', pruefeMengen, mit('*',"    else if(e.typ==='verweigert') st.verweigert++;\n", ''), /reduziereStand/],
  ['Beamer zeigt Quartalsnote', pruefeMengen, mit('*',"(BEWERTUNGS_TYPEN.has(e.typ)||e.typ==='quartalsnote')", '(BEWERTUNGS_TYPEN.has(e.typ))'), /sichtLabel/],
];
for (const [name, f, quellen, erwartet] of GEGENFAELLE) {
  test(`Gegenfall rot: ${name}`, () => {
    const befunde = f(quellen);
    assert.ok(befunde.some(b => erwartet.test(b)), 'Wächter blieb grün oder meldete etwas anderes: ' + JSON.stringify(befunde));
  });
}
