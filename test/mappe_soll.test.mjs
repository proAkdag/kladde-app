// kladde/test/mappe_soll · Scheibe D1: die Mappe rechnet auf die Stelle wie die Excel-Vorlage v15.2.
// Das Soll hat EXCEL berechnet (per COM auf Kopien der Vorlagen, erfundene Kinder), nie dieser Code:
//   soll_mappe_fest.json   ← design/d_mappe_2026-10-21/soll_v152_com.py (feste Grenzfälle, Befunde S1–S9)
//   soll_mappe_zufall.json ← tools/soll_mappe_zufall_com.py (Zufallssatz, Seed je Fall aus seiner Kennung)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { excelRunde, excelObergrenze } from '../logic/excelrechnen.mjs';
import { werteArbeitAus, standardSchluessel, ergebnisText, noteAusQuote, sek1Gitter } from '../logic/arbeiten.mjs';

const FEST = JSON.parse(readFileSync(new URL('./soll_mappe_fest.json', import.meta.url), 'utf-8'));
const ZUFALL = JSON.parse(readFileSync(new URL('./soll_mappe_zufall.json', import.meta.url), 'utf-8'));
const nahe = (a, b, eps = 1e-9) => (a === '' || a == null ? b == null : typeof b === 'number' && Math.abs(a - b) <= eps);
const leer = x => (x === '' ? null : x);

// Eingaben einer Arbeit (wie im Soll-Skript) → Kladde-Form
function arbeitAus(maxima, zeilen, schluessel, lb = []) {
  const aufgaben = maxima.map((max, j) => ({ id: 'a' + j, max }));
  const kinder = zeilen.map((_, i) => ({ sid: 's' + i, lb: !!lb[i] }));
  const punkte = new Map(zeilen.map((z, i) => [kinder[i].sid, new Map(z.map((w, j) => [aufgaben[j].id, w]).filter(([, w]) => typeof w === 'number'))]));
  return werteArbeitAus({ aufgaben, schluessel }, kinder, punkte);
}

test('excelRunde und CEILING = Excel an den gemessenen Kanten (S2)', () => {
  const k = FEST.sek1.excel_round_kante;
  assert.equal(excelRunde(2.5, 0), k['2.5']);
  assert.equal(excelRunde(2.5 - 2 ** -51, 0), k['2.5-2^-51']);
  assert.equal(excelRunde(2.5 - 2 ** -48, 0), k['2.5-2^-48']);   // Math.round gäbe 2
  assert.equal(excelRunde(2.5 - 1e-13, 0), k['2.5-1E-13']);
  assert.equal(excelRunde(4.45, 1), k['4.45 auf 1']);
  assert.equal(excelRunde(1.005, 2), k['1.005 auf 2']);          // Math.round(1.005*100)/100 gäbe 1
  assert.equal(excelObergrenze(0.18 * 37, 0.5), k['CEILING(0.18*37,0.5)']);
  assert.equal(excelObergrenze(0.45 * 40, 0.5), k['CEILING(0.45*40,0.5)']);
  assert.equal(excelRunde(-2.5, 0), -3);                            // von der Null weg
});

test('Sek I Notenschlüssel 45 % / 18 % = Excel-Notentabelle', () => {
  const s = standardSchluessel('sek1');
  const g = sek1Gitter(s);
  assert.deepEqual(g.gitter, FEST.sek1.notentabelle.M12_N17.map(z => z[0]), 'Rechengitter M12:M17');
  assert.deepEqual(g.noten, FEST.sek1.notentabelle.M12_N17.map(z => z[1]), 'Noten N12:N17');
  assert.deepEqual(g.grenzen, FEST.sek1.notentabelle.F12_F17, '„Note n ab“ F12:F17');
  const raster = FEST.sek1.notentabelle.F12_F17;
  for (let i = 0; i < 6; i++) assert.equal(noteAusQuote(raster[i], s), i + 1, 'genau an der Grenze „Note ' + (i + 1) + ' ab“');
});

test('feste Fälle Sek I KA1 (Gesamt 40) und KA2 (Gesamt 37, Grenzfall 16,65 → 4) = Excel', () => {
  const s = standardSchluessel('sek1'), lb = Array(14).fill(false); lb[11] = true;   // Lia Nr 12 LB
  const teile = (maxima, t) => maxima.map(m => { const a = Math.min(m, t); t -= a; return a; });
  const t1 = { 1: 34.5, 2: 34, 3: 29, 4: 28.5, 5: 23.5, 6: 18, 7: 17.5, 8: 7.5, 9: 7, 12: 30, 14: 40 };
  const m1 = [10, 12.5, 8, 9.5];
  const z1 = Array.from({ length: 14 }, (_, i) => (t1[i + 1] != null ? teile(m1, t1[i + 1]) : [null, null, null, null]));
  z1[9] = [0, null, null, null]; z1[12] = [10, null, null, null];   // Jan „0“ · Mo nur A1
  const e1 = arbeitAus(m1, z1, s, lb), soll1 = FEST.sek1.KA1;
  assert.equal(e1.gesamt, soll1.P4);
  e1.zeilen.forEach((z, i) => {
    const r = soll1.rows[i + 1];
    assert.ok(nahe(r.P, z.summe) && nahe(r.Q, z.quote, 1e-12), 'KA1 Nr ' + (i + 1) + ' Summe/Quote');
    assert.equal(z.note, leer(r.R), 'KA1 Nr ' + (i + 1) + ' Note');
  });
  assert.deepEqual(e1.spiegel, soll1.spiegel); assert.equal(e1.schnitt, soll1.schnitt_K46);
  assert.deepEqual(e1.aufgabenSchnitt, soll1.aufgaben_schnitt_D5);
  e1.aufgabenProzent.forEach((p, j) => assert.ok(nahe(soll1.aufgaben_prozent_D6[j], p, 1e-12)));
  const m2 = [9, 9.5, 10, 8.5], t2 = [31.9, 32, 26.8, 16.65, 6.6];
  const e2 = arbeitAus(m2, t2.map(t => teile(m2, t)), s), soll2 = FEST.sek1.KA2;
  e2.zeilen.forEach((z, i) => { const r = soll2.rows[i + 1]; assert.ok(nahe(r.P, z.summe) && nahe(r.Q, z.quote, 1e-12)); assert.equal(z.note, r.R, 'KA2 Nr ' + (i + 1)); });
  assert.equal(e2.zeilen[3].note, 4, 'S1: 16,65/37 = 0,44999… → Note 4 (ein Vergleich ohne ROUND(·;6) gäbe 5)');
  assert.deepEqual(e2.spiegel, soll2.spiegel); assert.equal(e2.schnitt, soll2.schnitt_K46);
  // Rückmeldebogen: „Note 1 … 6 ab“ und „Ergebnis: 86,3 %“ (S5)
  assert.deepEqual(e1.abPunkten, FEST.sek1.rb_ka1['1'].schluessel_ab);
  assert.deepEqual(e2.abPunkten, FEST.sek1.rb_ka2['1'].schluessel_ab);
  assert.equal(ergebnisText(e1.zeilen[0].quote), FEST.sek1.rb_ka1['1'].ergebnis);
  assert.equal(ergebnisText(e2.zeilen[0].quote), FEST.sek1.rb_ka2['1'].ergebnis);
  assert.equal(ergebnisText(e1.zeilen[10].quote), FEST.sek1.rb_ka1['11'].ergebnis, 'Kim ohne Punkte');
});

test('feste Fälle Oberstufe KA1 (Gesamt 60) = Excel', () => {
  const s = standardSchluessel('sek2'), m = [15, 15, 15, 15];
  const teile = t => m.map(x => { const a = Math.min(x, t); t -= a; return a; });
  const t = { 1: 57, 2: 56.5, 3: 27, 4: 26.5, 5: 23.5, 6: 23, 7: 12, 8: 11.5, 9: 60, 10: 42, 11: 41.5, 12: 33, 14: 51 };
  const z = Array.from({ length: 14 }, (_, i) => (t[i + 1] != null ? teile(t[i + 1]) : [null, null, null, null])); z[12] = [0, null, null, null];
  const e = arbeitAus(m, z, s), soll = FEST.ob.KA1;
  e.zeilen.forEach((x, i) => { const r = soll.rows[i + 1]; assert.equal(x.note, r.R, 'OB Nr ' + (i + 1)); assert.equal(x.label, r.S); });
  assert.deepEqual(e.spiegel, soll.spiegel_15_0); assert.equal(e.defizite, soll.defizite_G47);
  assert.equal(e.schnitt, soll.schnitt_K47); assert.deepEqual(e.gruppen, soll.gruppen_D49_I49);
  assert.deepEqual(e.abPunkten, FEST.ob.rb_ka1['1'].schluessel_ab);
  assert.equal(ergebnisText(e.zeilen[3].quote), FEST.ob.rb_ka1['4'].ergebnis);
});

// Grenzfälle Oberstufe (soll_mappe_grenzen.json, Excel per COM): mathematisch auf der Schwelle, im Rechner knapp darunter
test('Oberstufe an der Schwelle (9,45/21 = 0,44999… → 5 P) = Excel', () => {
  const G = JSON.parse(readFileSync(new URL('./soll_mappe_grenzen.json', import.meta.url), 'utf-8'));
  let n = 0;
  for (const [k, f] of Object.entries(G.ka)) {
    const e = arbeitAus([f.gesamt], f.punkte.map(p => [p]), standardSchluessel('sek2'));
    e.zeilen.forEach((z, i) => { const [P, Q, R, S] = f.aus[i]; n++;
      assert.ok(nahe(P, z.summe) && nahe(Q, z.quote, 1e-15), `KA${k} ${f.punkte[i]}/${f.gesamt}`);
      assert.equal(z.note, R, `KA${k} ${f.punkte[i]}/${f.gesamt} Punkte`); assert.equal(z.label, S); });
  }
  assert.ok(n >= 13, n + ' Fälle');
});

test('Zufallssatz: 18 Arbeiten (3 Mappen × 6) Zeile für Zeile = Excel', () => {
  let noten = 0, leerZ = 0, lbZ = 0;
  for (const [name, m] of Object.entries(ZUFALL.mappen)) {
    const s = m.stufe === 'ob' ? standardSchluessel('sek2') : { art: 'sek1', vier: m.schluessel[0], fuenf: m.schluessel[1] };
    for (const [k, ka] of Object.entries(m.ka)) {
      const { maxima, punkte } = ka.eingabe, aus = ka.aus, e = arbeitAus(maxima, punkte, s, m.lb), wo = name + ' KA' + k;
      assert.equal(e.gesamt, aus.P4, wo + ' Gesamt');
      e.zeilen.forEach((z, i) => {
        const [P, Q, R, S] = aus.zeilen[i];
        assert.ok(nahe(P, z.summe), `${wo} Nr ${i + 1} Summe ${P} ≠ ${z.summe}`);
        assert.ok(nahe(Q, z.quote, 1e-12), `${wo} Nr ${i + 1} Quote`);
        assert.equal(z.note, leer(R), `${wo} Nr ${i + 1} Note`);
        if (m.stufe === 'ob') assert.equal(z.label, leer(S), `${wo} Nr ${i + 1} Label`);
        if (typeof z.note === 'number') noten++; else if (z.note === '—') lbZ++; else leerZ++;
      });
      if (m.stufe === 'ob') { assert.deepEqual(e.spiegel, aus.spiegel_15_0, wo); assert.equal(e.defizite, aus.defizite); assert.deepEqual(e.gruppen, aus.gruppen); }
      else assert.deepEqual(e.spiegel, aus.spiegel, wo + ' Spiegel');
      assert.equal(e.schnitt, leer(aus.schnitt), wo + ' Ø');
      assert.deepEqual(e.aufgabenSchnitt, aus.aufgaben_schnitt.slice(0, maxima.length), wo + ' Aufgaben-Ø');
      e.aufgabenProzent.forEach((p, j) => assert.ok(nahe(aus.aufgaben_prozent[j], p, 1e-12), wo + ' Aufgaben-%'));
      assert.equal(e.summenSchnitt, leer(aus.P5), wo + ' Gesamt-Ø');
      assert.deepEqual(e.abPunkten, aus.rb_schluessel, wo + ' Rückmeldebogen ab Punkten');
      assert.equal(ergebnisText(e.zeilen[0].quote), aus.rb_ergebnis_kind1, wo + ' Ergebnis Kind 1');
    }
  }
  // Stückzahl: ein grüner Test ohne Fälle ist kein Beweis (KERN M5)
  assert.ok(noten >= 500 && leerZ >= 50 && lbZ >= 15, `verglichen: ${noten} Noten · ${leerZ} leer · ${lbZ} LB`);
});

test('Wächter: keine Rundung neben excelRunde in der Mappen-Logik (Math.round, toFixed)', () => {
  for (const f of ['arbeiten.mjs']) {
    const t = readFileSync(new URL('../logic/' + f, import.meta.url), 'utf-8').replace(/\/\/.*$/gm, '');
    assert.ok(!/Math\.round|toFixed|Math\.floor|Math\.ceil/.test(t), f + ' rundet an excelRunde vorbei');
  }
});
