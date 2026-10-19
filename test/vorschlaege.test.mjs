// kladde/test/vorschlaege · Clipboard-Format „Vorschläge kopieren" (P4.5)
import test from 'node:test';
import assert from 'node:assert/strict';
import { vorschlagsZeilen } from '../logic/verdichtung.mjs';

test('TSV: Nr TAB Vorschlag je Zeile', () => {
  assert.equal(vorschlagsZeilen([{ nr: 1, vorschlag: '2+' }, { nr: 2, vorschlag: '3' }]), '1\t2+\n2\t3');
});

test('optionale F-Summen als 3. Spalte', () => {
  assert.equal(vorschlagsZeilen([{ nr: 1, vorschlag: '2', fSummen: '1e/0u' }]), '1\t2\t1e/0u');
});

test('fehlender Vorschlag → leere Zelle (LB)', () => {
  assert.equal(vorschlagsZeilen([{ nr: 1, vorschlag: null }]), '1\t');
});

// Zwei Nummern (WAHL U2): eine Zeile je Listen-Nr von 1 bis zur höchsten, nach Nr sortiert — eine Lücke (gegangen, inaktiv)
// trägt nur ihre Nr, damit der Block in Excel Zeile für Zeile auf die Mappe passt. Ohne Listen-Nr steht ein Kind nicht im Block.
test('Lücken werden Zeilen, die Reihenfolge ist die Nr, nicht die Übergabe', () => {
  assert.equal(vorschlagsZeilen([{ nr: 3, vorschlag: '2' }, { nr: 1, vorschlag: '1-', fSummen: '0e/1u' }, { nr: 5, vorschlag: '4' }]),
    '1\t1-\t0e/1u\n2\t\n3\t2\n4\t\n5\t4');
  assert.equal(vorschlagsZeilen([{ nr: null, vorschlag: '3' }, { nr: 2, vorschlag: '3' }]), '1\t\n2\t3');
  assert.equal(vorschlagsZeilen([]), '');
});
