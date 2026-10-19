// kladde/test/pdfbild · Sitzplan als PDF (Zero 2026-10-02: „die Sitzuordnung soll abgebildet sein - nur in der Spalte mit namen
// brauche ich die sitzplatznummer usw. nicht“) — die PDF-Datei ist gültig gebaut, die Anordnung zeigt Plan und Liste ohne Reihe/Platz
import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfAusJpeg, jpegAusDataUrl, pdfText } from '../logic/pdfbild.mjs';
import { druckAnordnung } from '../logic/sitzplan.mjs';

const JPEG = Uint8Array.of(0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x0A, 0x0D, 0x25, 0x00, 0xFF, 0xD9);   // auch Bytes wie \n und %
const PDF = pdfAusJpeg(JPEG, 2339, 1654, { titel: 'Sitzplan 7b · Mathematik' });
const txt = new TextDecoder('latin1').decode(PDF);

test('PDF: Kopf, Ende, eine Seite A4 quer mit dem Bild', () => {
  assert.ok(txt.startsWith('%PDF-1.4\n'));
  assert.ok(txt.endsWith('%%EOF\n'));
  assert.match(txt, /\/MediaBox \[0 0 842 595\]/);
  assert.match(txt, /\/Width 2339 \/Height 1654 .*\/Filter \/DCTDecode \/Length 14 >>/);
  assert.match(txt, /q 842 0 0 595 0 0 cm \/Im0 Do Q/);
});
test('PDF: die Querverweistabelle zeigt auf jedes Objekt, startxref auf die Tabelle', () => {
  const start = Number(txt.match(/startxref\n(\d+)\n%%EOF\n$/)[1]);
  assert.equal(txt.slice(start, start + 5), 'xref\n');
  const eintraege = txt.slice(start).split('\n').slice(3, 9);
  assert.equal(eintraege.length, 6);
  eintraege.forEach((z, i) => {
    assert.match(z + '\n', /^\d{10} 00000 n \n$/);
    const o = Number(z.slice(0, 10));
    assert.equal(txt.slice(o, o + String(i + 1).length + 6), (i + 1) + ' 0 obj');
  });
});
test('PDF: der Bild-Strom trägt die JPEG-Bytes unverändert', () => {
  const i = txt.indexOf('/Length 14 >>\nstream\n') + '/Length 14 >>\nstream\n'.length;
  assert.deepEqual([...PDF.slice(i, i + JPEG.length)], [...JPEG]);
  assert.equal(txt.slice(i + JPEG.length, i + JPEG.length + 10), '\nendstream');
});
test('PDF: Titel als UTF-16BE, Umlaute und Mittelpunkt bleiben', () => {
  assert.equal(pdfText('Ö·ş'), '<FEFF00D600B7015F>');
  assert.match(txt, /\/Title <FEFF0053/);
});
test('jpegAusDataUrl: Base64 → Bytes', () => {
  assert.deepEqual([...jpegAusDataUrl('data:image/jpeg;base64,/9j/2Q==')], [0xFF, 0xD8, 0xFF, 0xD9]);
});

const SCHUELER = [
  { nr: 3, vorname: 'Ömer', name: 'Öztürk' }, { nr: 1, vorname: 'Clara', name: 'Albers', gruppe: 'A' },
  { nr: 2, vorname: 'Zoé', name: 'Böhm' }, { nr: 4, vorname: 'Kira', name: 'Celik' },
];
const SP = { grid: { '0,1': 1, '0,2': 2, '2,3': 3, '2,4': 99 }, tische: ['0,5', '3,0'], luecken: [1] };
test('druckAnordnung: Schülerliste nach Schülernummer, ohne Reihe und Platz (Zero 02.10.; Nr-Reihenfolge Zero 03.10.)', () => {
  const a = druckAnordnung(SP, SCHUELER);
  assert.deepEqual(a.liste.map(x => x.nr), [1, 2, 3, 4]);   // nach Nr, nicht nach Namen (Öztürk Nr 3 vor Celik Nr 4)
  for (const x of a.liste) assert.deepEqual(Object.keys(x).sort(), ['gruppe', 'lb', 'name', 'nr', 'vorname']);
  assert.equal(a.liste[0].gruppe, 'A');
});
test('druckAnordnung: die Nr entscheidet, auch wenn der Name nicht mehr dazu passt (Zero 03.10.: Namensänderung A → K, Nr 1 bleibt)', () => {
  const a = druckAnordnung({ grid: {} }, [{ nr: 2, vorname: 'Bea', name: 'Adler' }, { nr: 1, vorname: 'Kai', name: 'Krüger' }, { nr: 10, vorname: 'Ali', name: 'Aksoy' }]);
  assert.deepEqual(a.liste.map(x => x.nr), [1, 2, 10]);   // numerisch, nicht 1, 10, 2
});
test('druckAnordnung zeigt die Listen-Nr (zwei Nummern, WAHL U3): Liste danach sortiert, Kachel trägt sie, Platz bleibt an der Ausweis-Nr', () => {
  // Ausweis-Nr 1..3 sitzen auf 0,0 / 0,1 / 0,2 · Listen-Nr (Mappenzeile) 3 / 1 / 2 · Nr 4 ohne Feld → Listen-Nr 4
  const a = druckAnordnung({ grid: { '0,0': 1, '0,1': 2, '0,2': 3 } },
    [{ nr: 1, liste: 3, vorname: 'Ada', name: 'Aal' }, { nr: 2, liste: 1, vorname: 'Bo', name: 'Berg' }, { nr: 3, liste: 2, vorname: 'Cem', name: 'Cetin' }, { nr: 4, vorname: 'Dan', name: 'Dorn' }]);
  assert.deepEqual(a.liste.map(x => [x.vorname, x.nr]), [['Bo', 1], ['Cem', 2], ['Ada', 3], ['Dan', 4]]);
  assert.deepEqual(a.plaetze.map(p => [p.c, p.vorname, p.nr]), [[0, 'Ada', 3], [1, 'Bo', 1], [2, 'Cem', 2]]);
});
test('druckAnordnung: LB steht als Merkmal an Platz und Liste, sonst false (Zero 02.10. abends: „◆“ im PDF)', () => {
  const a = druckAnordnung(SP, SCHUELER.map(x => x.nr === 2 ? { ...x, lb: true } : x));
  assert.deepEqual(a.liste.filter(x => x.lb).map(x => x.nr), [2]);
  assert.deepEqual(a.plaetze.filter(p => p.lb).map(p => p.nr), [2]);
  assert.ok(a.plaetze.filter(p => p.art === 'schueler').every(p => typeof p.lb === 'boolean'));
});
test('druckAnordnung: Sitzordnung wie im Unterricht — Lücke, leere Tische, Spalten bis zum Tisch, Unbekannte fehlen', () => {
  const a = druckAnordnung(SP, SCHUELER);
  assert.deepEqual(a.reihen, [0, 1, 2, 3]);
  assert.equal(a.vonC, 0); assert.equal(a.bisC, 5);
  assert.deepEqual(a.plaetze.map(p => [p.r, p.c, p.art, p.nr ?? null]),
    [[0, 1, 'schueler', 1], [0, 2, 'schueler', 2], [0, 5, 'tisch', null], [2, 3, 'schueler', 3], [3, 0, 'tisch', null]]);
});
test('druckAnordnung: ein Tisch unter einem Schüler wird nicht gezeichnet (Mischbetrieb mit v1.13.0, Prüfer 02.10.)', () => {
  const a = druckAnordnung({ grid: { '0,0': 1 }, tische: ['0,0', '0,1'] }, SCHUELER);
  assert.deepEqual(a.plaetze.map(p => [p.r, p.c, p.art]), [[0, 0, 'schueler'], [0, 1, 'tisch']]);
});
test('druckAnordnung: Schüler ohne Platz stehen in der Liste, nicht im Plan', () => {
  const a = druckAnordnung(SP, SCHUELER);
  assert.ok(a.liste.some(x => x.nr === 4));
  assert.ok(!a.plaetze.some(p => p.nr === 4));
});
