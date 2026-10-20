// kladde/test/kern · Wächter Modul-Aufbau (A2): (1) jeder relative Import unter js/ trägt ?v=<APP_VERSION> — ohne ihn lädt
// der Browser dasselbe Modul ein zweites Mal unter anderer URL (zweite Instanz, eigener Zustand) und der Precache kennt die
// URL nicht; (2) der Kern (js/kern/) importiert weder app.mjs noch eine Ansicht, aus app.mjs kommt nur APP_VERSION;
// (3) ein `let` eines Kern- oder Ansichten-Moduls schreibt nur dieses Modul (sonst TypeError im Browser); (4) keine Ansicht
// braucht beim Laden etwas aus einer anderen (Ringe sind erlaubt, Zero 19.10.: „Direkt, Kern ringfrei“).
// Reine Prüffunktionen über Quelltexte, ohne Parser (Grenzen je Abschnitt genannt), jede mit Gegenfall. Prüfer 19.10.: A2 #5–#7.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = readFileSync(join(APP, 'js', 'app.mjs'), 'utf-8').match(/APP_VERSION = '([^']+)'/)[1];
const alle = (d, akku = []) => { for (const n of readdirSync(join(APP, d))) { const r = d + '/' + n;
  if (statSync(join(APP, r)).isDirectory()) alle(r, akku); else if (n.endsWith('.mjs')) akku.push(r); } return akku; };
const QUELLEN = Object.fromEntries(alle('js').map(p => [p, readFileSync(join(APP, p), 'utf-8')]));

// Erkannt: import {…} from · nackter Ladeimport `import './x.mjs?v=…'` · export {…} from · import('…'), je mit ' oder ", auch ohne
// Leerraum. Namensraum- und Default-Importe sind im Wächter-Modell nicht vorgesehen (sie würden die Prüfungen 3/4 umgehen) → Befund.
const IMPORT_RE = /(?:^|[;\n])[ \t]*(?:import\s*(?:([^;'"]*?)\s*from\s*)?|export\s*([^;'"]*?)\s*from\s*)(['"])(\.[^'"]+)\3/g;
const DYNAMISCH_RE = /\bimport\(\s*(['"`])(\.[^'"`]+)\1/g;
function pruefeImporte(quellen, version) {
  const befunde = [];
  for (const [p, t] of Object.entries(quellen)) {
    for (const m of t.matchAll(DYNAMISCH_RE)) if (!m[2].endsWith('?v=' + version)) befunde.push(`${p}: Import ${m[2]} ohne ?v=${version} (dynamisch)`);
    for (const m of t.matchAll(IMPORT_RE)) {
      const namen = (m[1] ?? m[2] ?? '').trim(), spez = m[4];
      if (namen && !namen.startsWith('{')) befunde.push(`${p}: Import „${namen}“ aus ${spez} nicht unterstützt (nur {…} oder nackt)`);
      if (!spez.endsWith('?v=' + version)) befunde.push(`${p}: Import ${spez} ohne ?v=${version}`);
      if (p.startsWith('js/kern/') && /(^|\/)(app\.mjs|ansichten\/)/.test(spez.replace(/^\.\.?\//, ''))) befunde.push(`${p}: Kern importiert ${spez}`);
      // (2b) app.mjs ist der Start: aus ihm kommt nur APP_VERSION (Versionsanzeige in „Mehr“), sonst wäre es wieder Drehscheibe
      if (/(^|\/)app\.mjs\?/.test(spez) && (namen || '').replace(/[{}\s]/g, '') !== 'APP_VERSION') befunde.push(`${p}: importiert aus app.mjs mehr als APP_VERSION (${(namen || 'nackt').trim()})`);
    }
  }
  return befunde;
}

// (3) Zustand aus kern/zustand.mjs ist außerhalb schreibgeschützt (Import-Binding): eine Zuweisung würfe erst, wenn die Zeile
// im Browser läuft (TypeError) — darum hier statisch. Geschrieben wird nur über die Setter.
// Gilt für jedes Kern-Modul: seine `let`s (oberste Ebene) schreibt nur es selbst (zustand, tresor, dialog …).
// Seit Schnitt 4 ebenso jedes Ansichten-Modul (fremd beschriebene lets haben Setter beim Eigentümer, z. B. setzeAktiverSchueler).
const lets = t => [...t.matchAll(/^let ([^;\n]+)/gm)].flatMap(m => m[1].split(',').map(x => x.trim().split('=')[0].trim())).filter(n => /^[\w$]+$/.test(n));
const EIGNER = Object.fromEntries(Object.entries(QUELLEN).filter(([p]) => /^js\/(kern|ansichten)\//.test(p)).flatMap(([p, t]) => lets(t).map(v => [v, p])));
const ZUSTANDS_VARIABLEN = Object.keys(EIGNER);
function pruefeZustandsSchreiben(quellen) {
  const befunde = [];
  for (const [p, t] of Object.entries(quellen)) {
    const ohneKommentar = t.split(/\r?\n/).map(z => z.replace(/(^|[^:'"\\])\/\/.*$/, '$1')).join('\n');
    // Zuweisungsformen: x= · x++/x-- · ++x/--x · x op= (auch **= <<= >>= >>>= &&= ||= ??=) · for (x of/in …) ohne Deklaration.
    // Nicht erkannt (kein Parser): Destrukturierung `[x]=…` / `({x}=…)` — im Code nicht verwendet, hier bewusst offen.
    for (const v of ZUSTANDS_VARIABLEN.filter(v => EIGNER[v] !== p)) {
      const formen = [new RegExp(`(?<![.\\w$=!<>])${v}\\s*(=(?![=>])|\\+\\+|--|(?:\\*\\*|<<|>>>?|&&|\\|\\||\\?\\?|[-+*/%&|^])=)`, 'g'),
        new RegExp(`(?:\\+\\+|--)\\s*${v}(?![\\w$])`, 'g'), new RegExp(`for\\s*\\(\\s*${v}\\s+(?:of|in)\\b`, 'g')];
      for (const re of formen) for (const m of ohneKommentar.matchAll(re)) befunde.push(`${p}: schreibt ${v} direkt (${m[0]})`);
    }
  }
  return befunde;
}
test('Zustand nur über Setter geschrieben', () => {
  for (const v of ['vault', 'terminDatum', 'dekKey', 'sperrGen', 'dlgKurs']) assert.ok(EIGNER[v], 'Kern-Variable nicht gelesen: ' + v + ' · ' + ZUSTANDS_VARIABLEN);
  assert.deepEqual(pruefeZustandsSchreiben(QUELLEN), []);
});
test('Gegenfall rot: direkte Zuweisung an den Zustand', () => {
  const t = { 'js/app.mjs': 'function x(){ aktiverKursId=null; vault = {}; sperrGen++; ++sperrGen; aktView ||= "heute"; vault ??= {}; for (aktView of ["a"]) {} }\n', 'js/kern/dialog.mjs': 'dekKey=null;\n' };
  assert.equal(pruefeZustandsSchreiben(t).length, 8);
  assert.deepEqual(pruefeZustandsSchreiben({ 'js/app.mjs': 'if(vault===null||aktView=="x"||sperrGen>=2){ const v=vault; }\n' }), []);   // Vergleiche sind kein Schreiben
});

// (4) Ladewirkung (Zero 19.10.: „Direkt, Kern ringfrei“): Ansichten importieren einander im Ring. Sicher ist das nur, solange ein
// Modul BEIM LADEN kein const/let eines anderen Ansichten-Moduls (oder des Startmoduls app.mjs) liest und keine seiner Funktionen
// aufruft — das andere ist dann vielleicht noch nicht ausgewertet (TDZ-Fehler, App startet nicht). Eine Funktion nur als Wert
// übergeben (Listener) ist sicher. Ohne Parser: ein kleiner Tokenizer überspringt Funktionsrümpfe, sie laufen erst später.
function tokens(src) {
  const out = []; let i = 0;
  const regexDavor = () => { const p = out[out.length - 1]; return !p || (p.t === 'p' && !/^[)\]}]$/.test(p.v)) || (p.t === 'id' && /^(return|typeof|in|of|new|delete|void|throw|case|do|else)$/.test(p.v)); };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; if (i < 2) i = src.length; continue; }
    if (c === "'" || c === '"') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; out.push({ t: 's' }); continue; }
    if (c === '`') {   // Vorlage: ${…} enthält Code — als eigene Klammerebene
      i++; out.push({ t: 'p', v: '(' });
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') { let tiefe = 1, j = i + 2; while (j < src.length && tiefe) { if (src[j] === '{') tiefe++; else if (src[j] === '}') tiefe--; j++; }
          out.push(...tokens(src.slice(i + 2, j - 1))); i = j; continue; }
        i++;
      }
      i++; out.push({ t: 'p', v: ')' }); continue;
    }
    if (c === '/' && regexDavor()) { i++; let klasse = false; while (i < src.length && (src[i] !== '/' || klasse)) { if (src[i] === '\\') i++; else if (src[i] === '[') klasse = true; else if (src[i] === ']') klasse = false; i++; } i++; while (/[a-z]/i.test(src[i] || '')) i++; out.push({ t: 's' }); continue; }
    const id = src.slice(i).match(/^[A-Za-z_$][\w$]*/); if (id) { out.push({ t: 'id', v: id[0], i }); i += id[0].length; continue; }
    const num = src.slice(i).match(/^\d[\d._a-zA-Z]*/); if (num) { out.push({ t: 's' }); i += num[0].length; continue; }
    const op = src.slice(i).match(/^(=>|\?\.|\.\.\.|[=!]==?|&&|\|\||\?\?|[-+*/%&|^<>]=?|[()[\]{};,.:?~!])/);
    out.push({ t: 'p', v: op ? op[0] : c, i }); i += op ? op[0].length : 1;
  }
  return out;
}
function hinter(ts, k) { const auf = ts[k].v, zu = { '(': ')', '[': ']', '{': '}' }[auf]; let t = 0;
  for (let j = k; j < ts.length; j++) { if (ts[j].t !== 'p') continue; if (ts[j].v === auf) t++; else if (ts[j].v === zu && !--t) return j + 1; } return ts.length; }
// Namen, die ein Quelltext beim Laden auswertet: 'liest' oder 'ruft'. Sofort aufgerufene Funktionen (IIFE `(function(){…})()`,
// `(()=>{…})()`) laufen beim Laden, ihr Rumpf zählt mit. Ein Bezeichner als Rückruf eines synchronen Array-Aufrufs
// (`xs.forEach(fn)`, map/filter/some/every/find/reduce/sort/flatMap) zählt als Aufruf.
const SYNCHRON = new Set(['forEach', 'map', 'filter', 'some', 'every', 'find', 'findIndex', 'reduce', 'sort', 'flatMap']);
const sofortGerufen = (ts, ende) => ts[ende] && ts[ende].v === ')' && ts[ende + 1] && ts[ende + 1].v === '(' || ts[ende] && ts[ende].v === '(';
function ladeNamen(src) {
  const ts = tokens(src), out = new Map();
  for (let k = 0; k < ts.length; k++) {
    const x = ts[k];
    if (x.t === 'id' && x.v === 'function') { let j = k + 1; while (j < ts.length && !(ts[j].t === 'p' && ts[j].v === '(')) j++; j = hinter(ts, j);
      const ende = ts[j] && ts[j].v === '{' ? hinter(ts, j) : j;
      if (!(ts[k - 1] && ts[k - 1].v === '(' && sofortGerufen(ts, ende))) k = ende - 1;   // IIFE: weiterlesen, sonst Rumpf überspringen
      continue; }
    if (x.t === 'p' && x.v === '=>') {
      if (ts[k + 1] && ts[k + 1].v === '{') { const ende = hinter(ts, k + 1); if (!sofortGerufen(ts, ende)) k = ende - 1; continue; }
      let j = k + 1, t = 0; for (; j < ts.length; j++) { const v = ts[j].t === 'p' ? ts[j].v : ''; if (v && '([{'.includes(v)) t++; else if (v && ')]}'.includes(v)) { if (!t) break; t--; } else if (!t && (v === ',' || v === ';')) break; }
      if (!sofortGerufen(ts, j)) k = j - 1; continue;
    }
    if (x.t === 'id' && ts[k - 1] && ts[k - 1].v === '(' && ts[k - 2] && ts[k - 2].t === 'id' && SYNCHRON.has(ts[k - 2].v) && ts[k - 3] && (ts[k - 3].v === '.' || ts[k - 3].v === '?.')
      && ts[k + 1] && (ts[k + 1].v === ')' || ts[k + 1].v === ',')) { out.set(x.v, 'ruft'); continue; }
    if (x.t === 'id' && ts[k + 1] && ts[k + 1].v === '(' && ts[k - 1] && ts[k - 1].t === 'p' && (ts[k - 1].v === '{' || ts[k - 1].v === ',')) {   // Methode im Objekt-Literal
      const j = hinter(ts, k + 1); if (ts[j] && ts[j].v === '{') { k = hinter(ts, j) - 1; continue; } }
    if (x.t !== 'id') continue;
    if (ts[k - 1] && ts[k - 1].t === 'p' && (ts[k - 1].v === '.' || ts[k - 1].v === '?.')) continue;   // Eigenschaft
    if (ts[k + 1] && ts[k + 1].v === ':' && ts[k - 1] && (ts[k - 1].v === '{' || ts[k - 1].v === ',')) continue;   // Schlüssel
    const ruft = ts[k + 1] && ts[k + 1].t === 'p' && (ts[k + 1].v === '(' || ts[k + 1].v === '?.');
    if (out.get(x.v) !== 'ruft') out.set(x.v, ruft ? 'ruft' : 'liest');
  }
  return out;
}
// Rumpf der Top-Level-Funktion `name` (Text zwischen { und }), null wenn nicht gefunden
function funktionsRumpf(src, name) {
  const m = new RegExp(`^(?:async\\s+)?function\\s*\\*?\\s*${name.replace(/\$/g, '\\$')}\\s*\\(`, 'm').exec(src); if (!m) return null;
  const teil = src.slice(m.index), ts = tokens(teil);
  let k = ts.findIndex(x => x.v === '('); k = hinter(ts, k); if (!ts[k] || ts[k].v !== '{') return null;
  const ende = hinter(ts, k) - 1;
  return teil.slice(ts[k].i + 1, ts[ende].i);
}
// Befunde: Name aus einem anderen Ansichten-Modul oder aus app.mjs, beim Laden gelesen (const/let) oder aufgerufen
function pruefeLadewirkung(quellen) {
  const befunde = [], art = new Map();   // pfad → Map(name → 'function'|'wert')
  for (const [p, t] of Object.entries(quellen)) art.set(p, new Map([...t.matchAll(/^(?:(?:async\s+)?function\s*\*?\s*([\w$]+)|(?:const|let)\s+([\w$]+))/gm)].map(m => [m[1] || m[2], m[1] ? 'function' : 'wert'])));
  for (const [p, t] of Object.entries(quellen)) {
    if (!p.startsWith('js/ansichten/')) continue;
    const herkunft = new Map();
    for (const m of t.matchAll(/^import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/gm)) {
      const ziel = new URL(m[3], 'http://x/' + p).pathname.slice(1);
      if (!ziel.startsWith('js/ansichten/') && ziel !== 'js/app.mjs') continue;
      for (const teil of m[1].split(',')) { const [orig, als] = teil.trim().split(/\s+as\s+/); if (orig) herkunft.set((als || orig).trim(), { ziel, orig: orig.trim() }); }
    }
    const rumpf = t.replace(/^import[^\n]*\n/gm, '');
    // Eigene Funktionen, die beim Laden laufen (aufgerufen oder synchroner Rückruf): ihr Rumpf läuft mit — transitiv
    const eigeneFn = art.get(p), laden = ladeNamen(rumpf), gesehen = new Set();
    for (let neu = [...laden].filter(([n, w]) => w === 'ruft' && eigeneFn.get(n) === 'function').map(([n]) => n); neu.length;) {
      const n = neu.pop(); if (gesehen.has(n)) continue; gesehen.add(n);
      const r = funktionsRumpf(rumpf, n); if (r === null) continue;
      for (const [m, w] of ladeNamen(r)) { if (laden.get(m) !== 'ruft') laden.set(m, w); if (w === 'ruft' && eigeneFn.get(m) === 'function') neu.push(m); }
    }
    for (const [n, wie] of laden) {
      const h = herkunft.get(n); if (!h) continue;
      const a = (art.get(h.ziel) || new Map()).get(h.orig) || 'wert';
      if (a === 'wert' || wie === 'ruft') befunde.push(`${p}: ${wie === 'ruft' ? 'ruft' : 'liest'} beim Laden ${n} aus ${h.ziel}`);
    }
  }
  return befunde;
}
test('Ansichten brauchen beim Laden nichts aus anderen Ansichten', () => {
  assert.ok(Object.keys(QUELLEN).some(p => p.startsWith('js/ansichten/')), 'js/ansichten/ fehlt');
  assert.deepEqual(pruefeLadewirkung(QUELLEN), []);
});
test('Gegenfall rot: Ladewirkung über die Modulgrenze (echter Ring: b importiert a, a wird zuerst geladen)', () => {
  const q = {
    'js/ansichten/a.mjs': "import { B_WERT, bFn, bListener, B_IIFE, B_LOKAL, bSync } from './b.mjs?v=1';\nconst X = B_WERT + 1;\nbFn();\n"
      + "$('k').addEventListener('click', bListener);\nfunction spaeter(){ return B_WERT + bFn(); }\nconst Y = () => bFn();\nconst Z = { m(){ return B_WERT; } };\n"
      + "(function(){ return B_IIFE; })();\nfunction lokal(){ return B_LOKAL; }\nlokal();\n[1, 2].forEach(bSync);\n",
    'js/ansichten/b.mjs': "import { X } from './a.mjs?v=1';\nconst B_WERT = 2, B_IIFE = 3, B_LOKAL = 4;\nfunction bFn(){ return X; }\nfunction bListener(){}\nfunction bSync(){}\n",
  };
  const b = pruefeLadewirkung(q).map(x => x.replace('js/ansichten/a.mjs: ', '').replace(' aus js/ansichten/b.mjs', ''));
  assert.deepEqual(b.sort(), ['liest beim Laden B_WERT', 'ruft beim Laden bFn', 'liest beim Laden B_IIFE', 'liest beim Laden B_LOKAL', 'ruft beim Laden bSync'].sort());
});

test('Importe unter js/ tragen ?v, der Kern kennt keine Ansicht', () => {
  assert.ok(Object.keys(QUELLEN).some(p => p.startsWith('js/kern/')), 'js/kern/ fehlt');
  assert.deepEqual(pruefeImporte(QUELLEN, VERSION), []);
});
test('Gegenfall rot: Import ohne ?v', () => {
  const t = { 'js/kern/x.mjs': "import { $ } from './dom.mjs';\n" };
  assert.match(pruefeImporte(t, VERSION).join(), /ohne \?v/);
});
test('Gegenfall rot: nackter Ladeimport ohne ?v · app.mjs als Drehscheibe', () => {
  const t = { 'js/app.mjs': "import './ansichten/heute.mjs';\n", 'js/ansichten/x.mjs': `import { kurs, APP_VERSION } from '../app.mjs?v=${VERSION}';\n` };
  const b = pruefeImporte(t, VERSION).join(' | ');
  assert.match(b, /heute\.mjs ohne \?v/); assert.match(b, /mehr als APP_VERSION/);
  assert.deepEqual(pruefeImporte({ 'js/ansichten/mehr.mjs': `import { APP_VERSION } from '../app.mjs?v=${VERSION}';\n` }, VERSION), []);
});
test('Gegenfall rot: Importformen ohne ?v (doppelte Anführungszeichen, ohne Leerraum, Re-Export, dynamisch) und Default/Namensraum', () => {
  const t = { 'js/ansichten/x.mjs': 'import { a } from "./a.mjs";\nimport{b}from\'./b.mjs\';\nexport { c } from \'./c.mjs\';\nconst d = () => import(\'./d.mjs\');\n'
    + `import e from './e.mjs?v=${VERSION}';\nimport * as f from './f.mjs?v=${VERSION}';\n` };
  const b = pruefeImporte(t, VERSION).join(' | ');
  for (const m of ['a.mjs ohne', 'b.mjs ohne', 'c.mjs ohne', 'd.mjs ohne', '„e“ aus', '„* as f“ aus']) assert.ok(b.includes(m), m + ' fehlt: ' + b);
});
test('Gegenfall rot: alte Version', () => {
  const t = { 'js/app.mjs': "import { el } from './kern/dom.mjs?v=0.0.1';\n" };
  assert.match(pruefeImporte(t, VERSION).join(), /ohne \?v/);
});
test('Gegenfall rot: Kern importiert app.mjs bzw. eine Ansicht', () => {
  const t = { 'js/kern/x.mjs': `import { vault } from '../app.mjs?v=${VERSION}';\nimport { a } from '../ansichten/heute.mjs?v=${VERSION}';\n` };
  assert.equal(pruefeImporte(t, VERSION).filter(b => /Kern importiert/.test(b)).length, 2);
});
