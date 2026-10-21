// kladde/test/mappe_texte · Zero 21.10. (F2): der neue Bereich heißt „Mappe“; jeder sichtbare Text, der die Excel-Datei meint, heißt
// „Excel-Mappe“. Wächter über die String-Literale (Kommentare und Bezeichner zählen nicht); erlaubt sind nur die Texte des neuen Bereichs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const alle = (d, akku = []) => { for (const n of readdirSync(join(APP, d), { withFileTypes: true })) { const r = d + '/' + n.name;
  if (n.isDirectory()) alle(r, akku); else if (n.name.endsWith('.mjs')) akku.push(r); } return akku; };
// Texte des neuen Bereichs (meinen die Mappe der Kladde, nicht die Excel-Datei)
const NEUER_BEREICH = ['Mappe · Arbeiten', 'Mappe · Kasse', 'Eintrag der Mappe ist', 'Einträge der Mappe sind'];
const EIGENES_MODUL = 'js/ansichten/mappe.mjs';   // der Bereich selbst

function pruefe(quellen) {
  const befunde = [];
  for (const [p, t] of Object.entries(quellen)) {
    if (p === EIGENES_MODUL) continue;
    t.split('\n').forEach((zeile, i) => {
      const code = zeile.replace(/\/\/.*$/, '');
      for (const m of code.matchAll(/(['"`])((?:(?!\1).)*)\1/g)) {
        const s = m[2];
        // auch Zusammensetzungen („Mappenzeile“, Prüfer 21.10.): jedes Wort, das mit „Mappe“ beginnt und nicht „Excel-Mappe…“ ist
        if (!/(?<![\w-])Mappe/.test(s.replace(/Excel-Mappe\w*/g, '')) || s === 'Mappe' || NEUER_BEREICH.some(b => s.includes(b))) continue;   // 'Mappe' allein = Hilfe-Begriff des Bereichs
        if (/^\.\.?\//.test(s)) continue;   // Importpfad
        befunde.push(`${p}:${i + 1}: „${s.slice(0, 80)}“`);
      }
    });
  }
  return befunde;
}
const QUELLEN = Object.fromEntries([...alle('js'), ...alle('logic')].map(p => [p, readFileSync(join(APP, p), 'utf-8')]));

test('jeder sichtbare Text zur Excel-Datei sagt „Excel-Mappe“', () => assert.deepEqual(pruefe(QUELLEN), []));
test('Gegenfall rot: ein zurückgesetzter Text „in der Mappe nachziehen“', () => {
  const p = 'js/ansichten/kurse.mjs', alt = 'in der Excel-Mappe nachziehen';
  assert.equal(QUELLEN[p].split(alt).length, 2, 'Anker');
  const b = pruefe({ ...QUELLEN, [p]: QUELLEN[p].replace(alt, 'in der Mappe nachziehen') });
  assert.ok(b.some(x => /in der Mappe nachziehen/.test(x)), JSON.stringify(b));
});
test('Gegenfall rot: Zusammensetzung „Mappenzeile“ im Text', () => {
  const p = 'logic/mappe.mjs', alt = 'Zeile der Excel-Mappe';
  assert.ok(QUELLEN[p].includes(alt), 'Anker');
  const b = pruefe({ ...QUELLEN, [p]: QUELLEN[p].replace(alt, 'Mappenzeile') });
  assert.ok(b.some(x => /Mappenzeile/.test(x)), JSON.stringify(b));
});
