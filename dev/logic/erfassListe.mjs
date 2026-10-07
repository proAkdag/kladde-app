// kladde/logic/erfassListe · „Liste statt Sitzplan“ am Handy (Zero 2026-10-01: „B mit der option nach vornamen zu sortieren“)
// Reihenfolge nach Nachname oder Vorname und eine Kurzbeschriftung „Vorname N.“ — so viele Buchstaben des Nachnamens,
// bis keine zweite Zeile gleich heißt (zwei „Lena M.“ werden „Lena Mü.“ und „Lena Me.“). Bei völlig gleichem Namen
// hängt die Nr an. Rein, ohne DOM — Node-testbar (test/erfassListe.test.mjs).
// Zwei Nummern (Zero 04.10.): `nr` ist die Ausweis-Nr und bleibt der Schlüssel; gezeigt und sortiert wird die Listen-Nr (`liste`).

import { lnr } from './teilnehmer.mjs';

export const SORTIERUNGEN = ['nachname', 'vorname'];

const vergleich = (a, b) => String(a || '').localeCompare(String(b || ''), 'de', { sensitivity: 'base' });
const klein = t => String(t || '').toLocaleLowerCase('de');

// schueler: [{nr, liste?, vorname, nachname}] (Anzeige-Namen) → [{nr, vorname, kurz}] in Listen-Reihenfolge
export function listenEintraege(schueler, sortierung = 'nachname') {
  const nachVorname = sortierung === 'vorname';
  const sortiert = [...schueler].sort((a, b) => (nachVorname
    ? vergleich(a.vorname, b.vorname) || vergleich(a.nachname, b.nachname)
    : vergleich(a.nachname, b.nachname) || vergleich(a.vorname, b.vorname)) || (lnr(a) ?? Infinity) - (lnr(b) ?? Infinity) || a.nr - b.nr);
  return sortiert.map(s => {
    const nn = String(s.nachname || '');
    const gleicheVornamen = schueler.filter(x => x.nr !== s.nr && klein(x.vorname) === klein(s.vorname));
    let n = 1;
    while (n < nn.length && gleicheVornamen.some(x => klein(String(x.nachname || '').slice(0, n)) === klein(nn.slice(0, n)))) n++;
    let kurz = !nn ? '' : n >= nn.length ? nn : nn.slice(0, n) + '.';
    if (gleicheVornamen.some(x => klein(x.nachname) === klein(nn))) kurz = (kurz ? kurz + ' ' : '') + '(' + (lnr(s) ?? '–') + ')';
    return { nr: s.nr, vorname: s.vorname, kurz };
  });
}
