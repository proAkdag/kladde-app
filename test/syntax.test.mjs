// kladde/test/syntax · jede ausgelieferte JS-Datei muss parsen (2026-09-30).
// Anlass: ein Zeilenkommentar mitten in einer Einzeiler-Handler-Zeile legte app.mjs lahm — die übrige Suite
// blieb grün, weil sie app.mjs nie lädt (csp_guard liest sie nur als Text). Erst der Browser zeigte den SyntaxError.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const APP = fileURLToPath(new URL('../', import.meta.url));
// A2 (19.10., Prüfer 🔴 2): alle Module unter js/ (kern/, ansichten/) — vorher nur js/app.mjs, das jetzt 60 Zeilen Start ist
const dateien = ['service-worker.js', ...['js', 'logic'].flatMap(d => readdirSync(join(APP, d), { recursive: true }).map(f => d + '/' + String(f).replace(/\\/g, '/')).filter(f => f.endsWith('.mjs')))];

test('alle App-Dateien parsen (node --check)', () => {
  assert.ok(dateien.length > 10, 'zu wenige Dateien gefunden: ' + dateien.length);
  const fehler = [];
  for (const f of dateien) {
    const r = spawnSync(process.execPath, ['--check', join(APP, f)], { encoding: 'utf8' });
    if (r.status !== 0) fehler.push(f + ': ' + String(r.stderr).split('\n').slice(0, 4).join(' | '));
  }
  assert.deepEqual(fehler, []);
});
