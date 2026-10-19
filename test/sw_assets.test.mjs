// kladde/test/sw_assets · Konsistenz-Wächter (Plan P1.7: „Maschine statt Merkzettel")
// Prüft: (1) jede App-Datei existiert für jeden ASSETS-Eintrag, (2) APP_VERSION ==
// CACHE_NAME-Version == ?v=-Queries in index.html UND ASSETS, (3) index.html-Referenzen
// (css/js) stehen exakt so in ASSETS, (4) alle js/logic/css-Dateien im Baum sind precached.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, relative } from 'node:path';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const sw = readFileSync(join(APP, 'service-worker.js'), 'utf-8');
const idx = readFileSync(join(APP, 'index.html'), 'utf-8');
const appMjs = readFileSync(join(APP, 'js', 'app.mjs'), 'utf-8');

const cacheName = sw.match(/CACHE_NAME = '([^']+)'/)[1];
const swVersion = cacheName.match(/-v(.+)$/)[1];
const appVersion = appMjs.match(/APP_VERSION = '([^']+)'/)[1];
const assets = [...sw.matchAll(/'(\.\/[^']*)'/g)].map(m => m[1]);

test('Version konsistent: APP_VERSION == CACHE_NAME', () => {
  assert.equal(appVersion, swVersion);
});

test('jeder ASSETS-Eintrag existiert als Datei', () => {
  for (const a of assets) {
    const pfad = a === './' ? './index.html' : a.split('?')[0];
    assert.ok(existsSync(join(APP, pfad)), 'fehlt: ' + a);
  }
});

test('?v=-Queries in ASSETS tragen die aktuelle Version', () => {
  for (const a of assets.filter(x => x.includes('?v='))) {
    assert.ok(a.endsWith('?v=' + appVersion), 'veraltete Query: ' + a);
  }
});

test('index.html-Referenzen (css/js) exakt in ASSETS', () => {
  const refs = [...idx.matchAll(/(?:href|src)="(\.\/(?:css|js)\/[^"]+)"/g)].map(m => m[1]);
  assert.ok(refs.length >= 2, 'css+js-Referenzen erwartet');
  for (const r of refs) {
    assert.ok(assets.includes(r), 'index-Referenz nicht precached: ' + r);
    assert.ok(r.endsWith('?v=' + appVersion), 'index-Referenz ohne aktuelle Version: ' + r);
  }
});

test('alle js/logic/css-Dateien im Baum sind precached (nichts vergessen)', () => {
  const dateien = [];
  const sammle = (d) => {
    for (const n of readdirSync(join(APP, d))) {
      const rel = d + '/' + n;
      if (statSync(join(APP, rel)).isDirectory()) sammle(rel);
      else if (/\.(mjs|css)$/.test(n)) dateien.push('./' + rel.replace(/\\/g, '/'));
    }
  };
  for (const d of ['js', 'logic', 'css']) if (existsSync(join(APP, d))) sammle(d);
  const assetPfade = assets.map(a => a.split('?')[0]);
  for (const f of dateien) {
    assert.ok(assetPfade.includes(f), 'Datei nicht in ASSETS: ' + f);
  }
});
