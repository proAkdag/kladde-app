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
const dateien = ['js/app.mjs', 'service-worker.js', ...readdirSync(join(APP, 'logic')).filter(f => f.endsWith('.mjs')).map(f => 'logic/' + f)];

test('alle App-Dateien parsen (node --check)', () => {
  assert.ok(dateien.length > 10, 'zu wenige Dateien gefunden: ' + dateien.length);
  const fehler = [];
  for (const f of dateien) {
    const r = spawnSync(process.execPath, ['--check', join(APP, f)], { encoding: 'utf8' });
    if (r.status !== 0) fehler.push(f + ': ' + String(r.stderr).split('\n').slice(0, 4).join(' | '));
  }
  assert.deepEqual(fehler, []);
});
