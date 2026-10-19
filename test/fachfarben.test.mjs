// kladde/test/fachfarben · Normalisierung + die Vergabe-Regel selbst.
//
// Der interessante Teil ist der letzte Test: er prueft nicht Code, sondern die REGEL —
// haeufige Fachkombinationen muessen im Farbkreis weit auseinander liegen. Verschiebt
// jemand spaeter einen Farbton, faellt genau das auf, was sonst niemandem auffiele:
// zwei Faecher desselben Lehrers werden ununterscheidbar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalisiereFach, fachHue, fachFarbe, fachKuerzel, KUERZEL, FACH_LISTE, WAEHLER_HUES, FAECHER }
  from '../logic/fachfarben.mjs';

/** Abstand zweier Farbtoene auf dem Kreis (0–180). */
const hueAbstand = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
/**
 * Effektiver Abstand zweier Faecher: Farbton PLUS Bonus, wenn die Helligkeitsstufe
 * verschieden ist. Die zweite Achse kam auf Zeros Frage nach Weiss/Schwarz dazu —
 * gemessen hebt sie die haeufigen Paare von 60 auf 108 Grad-Aequivalent.
 */
const STUFEN_BONUS = 55;
const abstand = (fa, fb) => {
  const [ha, sa] = FAECHER[fa], [hb, sb] = FAECHER[fb];
  return hueAbstand(ha, hb) + (sa !== sb ? STUFEN_BONUS : 0);
};

test('Schreibweisen landen auf demselben Fach', () => {
  for (const schreibweise of ['Mathematik', 'Mathe', 'mathe', 'MA', 'm', ' Mathematik '])
    assert.equal(normalisiereFach(schreibweise), 'Mathematik', schreibweise);
  assert.equal(normalisiereFach('Info'), 'Informatik');
  assert.equal(normalisiereFach('SoWi'), 'Sozialwissenschaften');
  assert.equal(normalisiereFach('GL'), 'Gesellschaftslehre');
  assert.equal(normalisiereFach('Päda'), 'Pädagogik');
  assert.equal(normalisiereFach('Erziehungswissenschaft'), 'Pädagogik');
  assert.equal(normalisiereFach('prakt. Philosophie'), 'Praktische Philosophie');
  assert.equal(normalisiereFach('Franzoesisch'), 'Französisch');
});

test('Unbekanntes bleibt unbekannt und bekommt Grau — kein Raten', () => {
  // GEGENRICHTUNG zur Normalisierung: sie darf nicht alles irgendwie zuordnen
  assert.equal(normalisiereFach('Schulgarten'), null);
  assert.equal(normalisiereFach('Chor'), null);
  assert.equal(normalisiereFach(''), null);
  assert.equal(normalisiereFach(null), null);
  assert.equal(fachHue('Schulgarten'), null);
  assert.match(fachFarbe('Schulgarten'), /0\.02|\.02/, 'unbekannt muss fast neutral sein');
  assert.ok(!fachFarbe('Schulgarten').includes('0.145'), 'unbekannt darf nicht bunt sein');
});

test('REGEL: haeufige Fachkombinationen liegen weit auseinander', () => {
  // Zusage der Palette. Mit der Helligkeitsachse liegt das geloeste Optimum bei 108°;
  // geprueft wird gegen 100° — faellt jemand darunter, ist die Vergabe kaputt.
  const paare = [
    ['Mathematik', 'Physik'], ['Mathematik', 'Informatik'], ['Physik', 'Informatik'],
    ['Physik', 'Chemie'], ['Biologie', 'Chemie'], ['Biologie', 'NW'],
    ['Deutsch', 'Englisch'], ['Deutsch', 'Pädagogik'], ['Deutsch', 'Geschichte'],
    ['Englisch', 'Spanisch'], ['Englisch', 'Französisch'],
    ['Geschichte', 'Philosophie'], ['Geschichte', 'Sozialwissenschaften'],
    ['Sozialwissenschaften', 'Pädagogik'], ['Kunst', 'Musik'],
    ['Mathematik', 'Technik'], ['Informatik', 'Technik'],
  ];
  const eng = paare
    .map(([a, b]) => [a, b, abstand(a, b)])
    .filter(([, , d]) => d < 100);
  assert.deepEqual(eng, [], 'zu nah beieinander: ' + JSON.stringify(eng));
});

test('Zeros drei Faecher sind maximal getrennt', () => {
  assert.ok(abstand('Mathematik', 'Physik') >= 100, 'Mathe/Physik');
  assert.ok(abstand('Mathematik', 'Informatik') >= 100, 'Mathe/Info');
  assert.ok(abstand('Physik', 'Informatik') >= 100, 'Physik/Info');
});

test('Farbwert traegt var(--L), damit Nacht und Tag dieselbe Zuweisung nutzen', () => {
  const hell = fachFarbe('Mathematik');            // Stufe hell
  assert.match(hell, /^oklch\(var\(--L\)/);
  assert.match(hell, /252\)$/);
  const dunkel = fachFarbe('Deutsch');             // Stufe dunkel
  assert.match(dunkel, /^oklch\(calc\(var\(--L\) - 0?\.15\)/, 'dunkle Stufe fehlt: ' + dunkel);
  // Beide Stufen haengen an --L: eine Variable schaltet Nacht/Tag fuer die ganze Palette
  assert.ok(hell.includes('var(--L)') && dunkel.includes('var(--L)'));
  // Nutzerfarbe schlaegt den Fach-Standard und ist immer die helle Stufe
  assert.match(fachFarbe('Mathematik', 68), /68\)$/);
  assert.match(fachFarbe('Mathematik', null), /252\)$/);
  assert.match(fachFarbe('Mathematik', undefined), /252\)$/);
});

test('Dropdown-Liste und Waehler sind brauchbar', () => {
  assert.ok(FACH_LISTE.length >= 25, 'zu wenige Faecher: ' + FACH_LISTE.length);
  assert.ok(FACH_LISTE.includes('Mathematik') && FACH_LISTE.includes('Gesellschaftslehre'));
  assert.equal(new Set(FACH_LISTE).size, FACH_LISTE.length, 'Dubletten in der Liste');
  assert.equal(WAEHLER_HUES.length, 12);
  // Die Waehler-Toene muessen untereinander unterscheidbar sein, sonst waehlt man blind
  for (let i = 1; i < WAEHLER_HUES.length; i++)
    assert.ok(hueAbstand(WAEHLER_HUES[i - 1], WAEHLER_HUES[i]) >= 12,
      'Waehler-Toene zu nah: ' + WAEHLER_HUES[i - 1] + '/' + WAEHLER_HUES[i]);
});

test('Fach-Liste ist alphabetisch — sonst sucht man sich im Dropdown dumm', () => {
  const sortiert = [...FACH_LISTE].sort((a, b) => a.localeCompare(b, 'de'));
  assert.deepEqual(FACH_LISTE, sortiert);
});

test('Kuerzel: kurz, eindeutig, und fuer jedes Fach vorhanden', () => {
  for (const fach of Object.keys(FAECHER)) {
    const k = fachKuerzel(fach);
    assert.ok(k && k.length <= 3, fach + ': Kuerzel „' + k + '"');
  }
  const alle = Object.values(KUERZEL);
  assert.equal(new Set(alle).size, alle.length, 'doppeltes Kuerzel: ' +
    alle.filter((k, i) => alle.indexOf(k) !== i));
  assert.equal(fachKuerzel('Mathematik'), 'Ma');
  assert.equal(fachKuerzel('Mathe'), 'Ma', 'Kuerzel muss auch aus Kurzschreibweisen kommen');
  assert.equal(fachKuerzel('Informatik'), 'If');
  assert.equal(fachKuerzel('Sport'), 'Sp');
});

test('Unbekanntes Fach bekommt eine Notform, keine Luege', () => {
  assert.equal(fachKuerzel('Schulgarten'), 'Sc');
  assert.equal(fachKuerzel(''), '');
  assert.equal(fachKuerzel(null), '');
});

test('SP gehoert Sport, nicht Spanisch (NRW-Konvention)', () => {
  // Vorher zeigte 'sp' auf Spanisch — wer „Sp" tippte, bekam still das falsche Fach
  // samt falscher Farbe. Der Gegenfall sichert beide Richtungen.
  assert.equal(normalisiereFach('SP'), 'Sport');
  assert.equal(normalisiereFach('sp'), 'Sport');
  assert.equal(normalisiereFach('S'), 'Spanisch');
  assert.equal(normalisiereFach('SN'), 'Spanisch');
  assert.equal(normalisiereFach('Span'), 'Spanisch');
  assert.notEqual(fachHue('SP'), fachHue('S'), 'Sport und Spanisch duerfen nie dieselbe Farbe tragen');
});

test('jede Fach-Kombination aus Ton und Stufe ist einmalig', () => {
  const paare = Object.values(FAECHER).map(([h, s]) => h + '/' + s);
  assert.equal(new Set(paare).size, paare.length, 'doppelt vergebene Ton/Stufe-Kombination');
  for (const [fach, wert] of Object.entries(FAECHER)) {
    assert.ok(Array.isArray(wert) && wert.length === 2, fach + ': kein [Ton, Stufe]');
    assert.ok(Number.isFinite(wert[0]) && wert[0] >= 0 && wert[0] < 360, fach + ': Ton ' + wert[0]);
    assert.ok(wert[1] === 0 || wert[1] === 1, fach + ': Stufe ' + wert[1]);
  }
});

test('beide Helligkeitsstufen sind wirklich in Gebrauch', () => {
  // GEGENFALL: faellt die Vergabe auf eine Stufe zurueck, ist die zweite Achse wirkungslos —
  // der Abstandstest wuerde das erst indirekt merken.
  const stufen = Object.values(FAECHER).map(([, s]) => s);
  assert.ok(stufen.filter((s) => s === 0).length >= 8, 'zu wenige helle Faecher');
  assert.ok(stufen.filter((s) => s === 1).length >= 8, 'zu wenige dunkle Faecher');
});
