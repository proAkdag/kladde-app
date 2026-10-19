// kladde/test/csp_guard · CSP-Wächter (P1.7): jede neue innerHTML-Zuweisung oder ein
// style=""-Rückfall bricht die Suite — bewusste Entscheidung statt stiller Drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');

// Whitelist: Stand P1.7 (v0.8.0). Erhöhung NUR mit Begründung im Commit —
// Neubau gehört auf el() (js/app.mjs, Migrationsregel PLAN 1.7).
const INNERHTML_WHITELIST = { 'js/app.mjs': 16 }; // v1.23.0: Login-Text auf textContent (−1, Scheibe 10) · davor 17, v1.21.0: Kurs anlegen auf el(), „Schnell“ mit innerHTML-Vorschau entfällt (−1, Scheibe 8) · davor 18, v1.19.0: „Mehr“ auf el() (−1, Scheibe 7) · davor 19, v1.13.0: Datumsstreifen auf el() (−2, Zero 2026-10-01 Rahmen + „Stunde“) · davor 21: // v2 „Studio": Aktionsbar entfernt (−1); Neubau via el() (Rail, Detail-Aktionen); +1 S216 renderSchuelerSeite (Vollseite, durchgehend esc()-gesichert)

function alleMjs(d, akku = []) {
  for (const n of readdirSync(join(APP, d))) {
    const rel = d + '/' + n;
    if (statSync(join(APP, rel)).isDirectory()) alleMjs(rel, akku);
    else if (n.endsWith('.mjs')) akku.push(rel);
  }
  return akku;
}

test('kein style="" in JS-HTML-Strings (CSP style-src self)', () => {
  for (const f of [...alleMjs('js'), ...alleMjs('logic')]) {
    const treffer = (readFileSync(join(APP, f), 'utf-8').match(/style="/g) || []).length;
    assert.equal(treffer, 0, f + ' enthält style="');
  }
});

test('kein style="" in index.html', () => {
  const treffer = (readFileSync(join(APP, 'index.html'), 'utf-8').match(/style="/g) || []).length;
  assert.equal(treffer, 0);
});

test('CSP-Meta vorhanden, ohne unsafe-inline', () => {
  const idx = readFileSync(join(APP, 'index.html'), 'utf-8');
  const m = idx.match(/Content-Security-Policy" content="([^"]+)"/);
  assert.ok(m, 'CSP-Meta fehlt');
  assert.ok(!m[1].includes('unsafe-inline'), 'unsafe-inline verboten');
  assert.ok(m[1].includes("script-src 'self'"));
  assert.ok(m[1].includes("style-src 'self'"));
});

test('innerHTML-Zuweisungen exakt auf Whitelist-Stand', () => {
  for (const f of alleMjs('js')) {
    const ist = (readFileSync(join(APP, f), 'utf-8').match(/\.innerHTML\s*=/g) || []).length;
    const soll = INNERHTML_WHITELIST[f] ?? 0;
    assert.equal(ist, soll, f + ': ' + ist + ' innerHTML-Zuweisungen (Whitelist: ' + soll + ') — Neubau gehört auf el()');
  }
});
