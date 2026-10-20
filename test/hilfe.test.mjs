// Hilfe je Ansicht (Scheibe 9, Zero 05.10. Wahl 1 C · 2 B · 3 B): Daten und Zielsuche. Ob die Ziele im Browser sichtbar sind und das
// Wort tragen, prüft P31 (_proben/handy/kladde_hilfe.cjs) je Ansicht und Gerät; hier nur, was ohne Browser feststeht.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HILFE, HILFE_ANSICHTEN, findeZiel } from '../logic/hilfe.mjs';

// A2 (Modul-Umbau): die Ids stehen in index.html und in allen Modulen unter js/
const JS = new URL('../js/', import.meta.url);
const QUELLE = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  + fs.readdirSync(JS, { recursive: true }).filter(f => String(f).endsWith('.mjs')).map(f => fs.readFileSync(new URL(String(f).replace(/\\/g, '/'), JS), 'utf8')).join('\n');

test('Hilfe: jede der fünf Ansichten hat Titel und Zeilen, nur „Heute“ führt zu den Zeichen', () => {
  assert.deepEqual(HILFE_ANSICHTEN, ['heute', 'deck', 'schueler', 'kurse', 'mehr']);
  assert.deepEqual(Object.keys(HILFE).sort(), [...HILFE_ANSICHTEN].sort());
  for (const a of HILFE_ANSICHTEN) {
    const h = HILFE[a];
    // die Daten tragen auch die Zeilen der Unterzustände (Kurs-Seite, Schülerseite, Reiter, Beamer, Editor); je Zustand und Gerät
    // erscheinen höchstens 10 (P31 H2), weil nur Zeilen mit sichtbarem Knopf erscheinen
    assert.ok(h.titel && h.zeilen.length >= 4 && h.zeilen.length <= 20, a + ': Titel und 4–20 Zeilen');
    assert.equal(!!h.zeichen, a === 'heute', a + ': Zeichen nur in Heute');
    assert.equal(new Set(h.zeilen.map(z => z.begriff)).size, h.zeilen.length, a + ': Begriffe eindeutig');
    for (const z of h.zeilen) {
      assert.ok(z.begriff && z.text && z.text.length >= 10 && z.ziel, a + ': ' + z.begriff + ' vollständig');
      if (z.wort) assert.doesNotThrow(() => new RegExp(z.wort), a + ': ' + z.begriff + ' Wort ist ein Muster');
    }
  }
});

test('Hilfe: jede Id, auf die eine Zeile zeigt, gibt es in index.html oder app.mjs', () => {
  for (const a of HILFE_ANSICHTEN) for (const z of HILFE[a].zeilen)
    for (const id of z.ziel.match(/#[\w-]+/g) || []) assert.ok(QUELLE.includes(`id="${id.slice(1)}"`) || QUELLE.includes(`id:'${id.slice(1)}'`) || QUELLE.includes(`'${id.slice(1)}'`), `${a} · ${z.begriff}: ${id}`);
});

// Attrappe: Elemente mit aria-label/Text und Sichtbarkeit
const knopf = (label, text, sicht = true) => ({ label, textContent: text, sicht, getAttribute: k => (k === 'aria-label' ? label : null) });
const behaelter = (kinder, sicht = true, text = '') => ({ sicht, textContent: text, getAttribute: () => null, querySelectorAll: () => kinder });
const sichtbar = e => e.sicht;

test('findeZiel: Container ohne Wort, Knopf über aria-label oder Text, unsichtbare übersprungen, sonst null', () => {
  // nie der Container selbst: sein Text enthält auch versteckte Kinder (Prüfer S9 B8: „klären“ machte die ganze Ansicht zum Ziel)
  assert.equal(findeZiel({ ziel: '#x', wort: 'klären' }, () => [behaelter([knopf('', 'Unentsch.')], true, 'Unentsch. 11 offene Fehlzeiten klären ›')], sichtbar), null);
  const c = behaelter([]);
  assert.equal(findeZiel({ ziel: '#x', wort: null }, () => [behaelter([], false), c], sichtbar), c);
  const zufall = knopf('', 'Zufall'), liste = knopf('Liste', '');
  assert.equal(findeZiel({ ziel: '#x', wort: '^Zufall$' }, () => [behaelter([liste, zufall])], sichtbar), zufall);
  assert.equal(findeZiel({ ziel: '#x', wort: '^Liste$' }, () => [behaelter([zufall, liste])], sichtbar), liste);
  assert.equal(findeZiel({ ziel: '#x', wort: '^Liste$' }, () => [behaelter([knopf('Liste', '', false)])], sichtbar), null);
  assert.equal(findeZiel({ ziel: '#x', wort: '^Liste$' }, () => [behaelter([liste], false)], sichtbar), null);
  assert.equal(findeZiel({ ziel: '#x', wort: 'Beamer' }, () => [behaelter([zufall, liste])], sichtbar), null);
});
