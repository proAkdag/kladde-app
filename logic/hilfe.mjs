// kladde/logic/hilfe · Hilfe je Ansicht (Scheibe 9, Zero 05.10. Wahl 1 C · 2 B · 3 B, design/s9_hilfe_2026-10-05/WAHL.md)
// Zero 01.10.: „jede Ansicht hat darunter die Erklärung ihrer Funktionen (Legende gehört in die Hilfe zu ‚Heute‘)“.
// Zero 05.10. zu Prüfer-B1: „Kürzer + Zeichen oben“ — je Zeile ein kurzer Satz, das Feld passt ohne Scrollen.
// Reine Daten, kein DOM. Jede Zeile trägt ihr Ziel: entweder das Bedienelement selbst (CSS-Selektor, wort null) oder einen Container
// und das Wort auf einem Bedienelement darin (Regex-Quelle). Die App zeigt eine Zeile nur, wenn ihr Knopf sichtbar ist — so erklärt dieselbe
// Liste auch die Unterzustände (Kurs-Seite, Schülerseite, Reiter, Beamer, Deck-Ende, Sitzplan-Editor). Ihr eigenes Soll hat P31.
// Die Sätze sind am Code nachgelesen (app.mjs: Stempel-Leiste, deckSwipe, renderSchuelerTabelle, renderKursSeite, sitzplanEditor).

export const HILFE_ANSICHTEN = ['heute', 'deck', 'schueler', 'kurse', 'mehr'];

const KURS = { begriff: 'Kurs', text: 'Kurs dieser Ansicht. Antippen wechselt.', ziel: '#kurs-chip', wort: null };
const BEAMER_AN = { begriff: 'Beamer an', text: 'Bewertungen verborgen, „Beenden“ zeigt sie.', ziel: '#beamer-aus', wort: null };
const MENUE = { begriff: '⋯', text: 'Stundenplan, Beamer, Tag/Nacht, Sperren.', ziel: '#btn-menue', wort: null };

export const HILFE = {
  heute: { titel: 'Heute', zeichen: true, zeilen: [
    { begriff: 'Stunde', text: 'Tag und Stunde wählen. ‹ › blättert.', ziel: '[data-stunde]', wort: null },
    { begriff: '« »', text: 'Eine Woche zurück oder vor.', ziel: '#datum-streifen [aria-label="eine Woche zurück"]', wort: null },
    { begriff: 'Alle · A · B', text: 'Nur eine Halbgruppe zeigen.', ziel: '.tg-chip[data-tg="A"]', wort: null },
    { begriff: 'Stempel', text: 'Stempel wählen, dann Kinder antippen.', ziel: '#rail .rail-btn.plus', wort: null },
    { begriff: '⌫', text: 'Dann ein Kind antippen: Eintrag zurück.', ziel: '#rail .rail-btn.breit', wort: null },
    { begriff: 'Erfasst', text: 'Wie viele Anwesende heute bewertet sind.', ziel: '.erfasst-karte', wort: null },
    { begriff: 'Zufall', text: 'Zieht ein anwesendes Kind, wer weniger hat, eher.', ziel: '[data-zufall]', wort: null },
    { begriff: 'Liste', text: 'Namensliste statt Sitzplan.', ziel: '[data-erfassung="liste"]', wort: null },
    { begriff: 'Sitzplan bearbeiten', text: 'Namen auf Plätze ziehen, Tische setzen.', ziel: '#datum-streifen [data-sitzplan]', wort: null },
    { begriff: 'Beamer', text: 'Blendet Bewertungen aus, bis du beendest.', ziel: '#btn-beamer:not(.aktiv)', wort: null },
    BEAMER_AN,
    { begriff: 'Tisch', text: 'Plätze antippen setzt leere Tische.', ziel: '#sp-editor-bar .sp-tisch', wort: null },
    { begriff: '＋ Reihe', text: 'Fügt hier eine leere Reihe ein.', ziel: '.reihe-plus', wort: null },
    { begriff: 'Fertig', text: 'Sitzplan bearbeiten beenden.', ziel: '#sp-editor-bar', wort: '^Fertig$' },
    { ...MENUE, text: 'Sitzplan, Stundenplan, Beamer, Tag/Nacht, Sperren.' },
  ] },
  deck: { titel: 'Deck', zeilen: [
    { begriff: 'Karte', text: 'Wischen: rechts ＋, links −, unten weiter, oben mehr.', ziel: '#view-deck:not(.deck-ende) #deck-karte', wort: null },
    { begriff: '− o +', text: 'Bewerten, dann kommt das nächste Kind.', ziel: '[data-deck="+"]', wort: null },
    { begriff: 'mehr ↑', text: 'Schülerblatt: Notiz, zu spät, Lernzeit …', ziel: '[data-deck="notiz"]', wort: null },
    { begriff: 'weiter ↓', text: 'Ohne Eintrag zum nächsten Kind.', ziel: '[data-deck="skip"]', wort: null },
    { begriff: 'nur ohne Eintrag', text: 'Nur Kinder ohne Bewertung heute.', ziel: '#deck-optionen', wort: 'nur ohne Eintrag$' },
    { begriff: 'mischen', text: 'Neue Reihenfolge.', ziel: '#deck-optionen', wort: '^mischen$' },
    { begriff: 'Diese Runde', text: 'Buchungen der Runde. Antippen korrigiert.', ziel: '#deck-verlauf', wort: null },
    { begriff: 'Nochmal durchgehen', text: 'Die Kinder ohne Eintrag noch einmal.', ziel: '[data-fehlende]', wort: null },
    KURS, BEAMER_AN, MENUE,
  ] },
  schueler: { titel: 'Schüler', zeilen: [
    { begriff: 'Liste · Noten · Termine · Fehlzeiten', text: 'Vier Blicke auf denselben Kurs.', ziel: '[data-sm="noten"]', wort: null },
    { begriff: 'Suche, Zeitraum, Filter', text: 'Liste eingrenzen und sortieren.', ziel: '#s-suche', wort: null },
    { begriff: 'Zeitraum', text: 'Für welchen Zeitraum die Tabelle gilt.', ziel: '.ut-aktionen select', wort: null },
    { begriff: 'Drucken', text: 'Die Tabelle drucken oder als PDF sichern.', ziel: '.ut-aktionen', wort: 'Drucken$' },
    { begriff: 'Vorschlag', text: 'Note aus den Einträgen, mit der Rechnung.', ziel: '#view-schueler', wort: '^Wie entsteht der Vorschlag' },
    { begriff: 'Für Excel kopieren', text: 'Eine Zeile je Listen-Nr für die Mappe.', ziel: '#view-schueler', wort: 'für Excel kopieren$' },
    { begriff: 'Offene Fehlzeiten', text: 'Entschuldigt, unentschuldigt oder Irrtum.', ziel: '[data-klaer="u"], .s-klaer-leiste', wort: null },
    { begriff: 'Kind antippen', text: 'Klappt auf, „ganze Seite ›“ zeigt mehr.', ziel: '#view-schueler .s-item', wort: null },
    { begriff: 'LB', text: 'Förderschwerpunkt Lernen: ohne Vorschlag.', ziel: '#view-schueler .s-item:has(.lb-badge), #view-schueler .ut-name:has(.lb-badge)', wort: null },
    { begriff: '‹ Alle Schüler', text: 'Zurück zur Liste.', ziel: '#s-zurueck', wort: null },
    { begriff: 'Quartalsnote', text: 'Antippen setzt oder ändert die Note.', ziel: '#view-schueler .nt-zelle, #view-schueler .qn-zelle[data-qz]', wort: null },
    { begriff: 'Name', text: 'Öffnet die Seite des Kindes.', ziel: '#view-schueler .ut-name', wort: null },
    { begriff: 'Warnschwelle', text: 'Ab so vielen Unentschuldigten: Warnung.', ziel: '#view-schueler input[type="number"]', wort: null },
    { begriff: 'Zeitstrahl', text: 'Einen Tag antippen zeigt seine Einträge.', ziel: '#view-schueler .zs-tag', wort: null },
    { begriff: 'Kurzbericht', text: 'Bilanz, Noten und Notizen als Text.', ziel: '#s-bericht', wort: null },
    KURS, BEAMER_AN, MENUE,
  ] },
  kurse: { titel: 'Kurse', zeilen: [
    { begriff: 'Kurskarte', text: 'Antippen: mit dem Kurs in „Heute“ arbeiten.', ziel: '#view-kurse .kurs-karte[data-kurs]', wort: null },
    { begriff: '⋯ an der Karte', text: 'Kurs-Seite: Schüler, Sitzplan, Farbe …', ziel: '#view-kurse [data-verwalten]', wort: null },
    { begriff: 'Stundenplan', text: 'Danach wählt die Kladde den Kurs selbst.', ziel: '#btn-stundenplan', wort: null },
    { begriff: 'Quartale…', text: 'Datumsgrenzen der Quartale.', ziel: '#btn-zeitraeume', wort: null },
    { begriff: '＋ Kurs anlegen', text: 'Mappe oder Liste laden, auch zum Abgleich.', ziel: '#btn-kurs-anlegen', wort: null },
    { begriff: 'Neues Schuljahr…', text: 'Altes Jahr ins Archiv, neues anlegen.', ziel: '#btn-schuljahr', wort: null },
    { begriff: '‹ Kurse', text: 'Zurück zu allen Kursen.', ziel: '[data-ks-zurueck]', wort: null },
    { begriff: 'Halbgruppe', text: 'Ordnet das Kind einer Halbgruppe zu.', ziel: '#view-kurse .gr-b', wort: null },
    { begriff: '✎', text: 'Name, LB, „Aus dem Kurs nehmen“.', ziel: '[data-ks-bearbeiten]', wort: null },
    { begriff: '＋ Schüler', text: 'Kind mit nächster Listen-Nr anfügen.', ziel: '[data-ks-neu]', wort: null },
    { begriff: 'Sitzplan', text: 'Sitzplan bearbeiten oder als PDF.', ziel: '[data-ks-sitzplan]', wort: null },
    { begriff: 'Einstellungen', text: 'Farbe, Noten-Spalte, Sek-II-Noten.', ziel: '#view-kurse .farbtupf.auto', wort: null },
    { begriff: 'Selten', text: 'Duplizieren, alte Slots, Kurs archivieren.', ziel: '[data-ks-archiv]', wort: null },
    KURS, BEAMER_AN, MENUE,
  ] },
  mehr: { titel: 'Mehr', zeilen: [
    { begriff: 'Sicherung', text: 'Verschlüsselt speichern oder einlesen.', ziel: '#btn-export', wort: null },
    { begriff: 'PC', text: 'Abgleich mit dem PC im Heimnetz.', ziel: '#btn-push', wort: null },
    { begriff: 'Darstellung', text: 'Tag, Nacht oder wie das Gerät.', ziel: '#view-mehr', wort: '^System$' },
    { begriff: 'Sicherheit', text: 'Sperre, Fingerabdruck, Passphrase.', ziel: '#sec-pass', wort: null },
    { begriff: 'Technik', text: 'Version, Speicher, Notenregel des Kurses.', ziel: '#view-mehr', wort: '^Technik' },
    KURS, BEAMER_AN, MENUE,
  ] },
};

// Ziel einer Zeile finden: erster sichtbarer Treffer des Selektors; mit Wort darin das erste sichtbare Bedienelement, dessen aria-label oder
// Text das Wort trägt — nie der Container selbst (Prüfer B8: er trug den Text versteckter Kinder und machte die ganze Ansicht zum Ziel).
// `alle(sel)` und `sichtbar(el)` kommen von außen (DOM in der App, Attrappe im Test).
export function findeZiel(zeile, alle, sichtbar) {
  const muster = zeile.wort ? new RegExp(zeile.wort) : null;
  for (const c of alle(zeile.ziel)) {
    if (!sichtbar(c)) continue;
    if (!muster) return c;
    const t = [...(c.querySelectorAll ? c.querySelectorAll('button,input,select,summary,[role=switch]') : [])]
      .find(b => sichtbar(b) && [b.getAttribute?.('aria-label') || '', (b.textContent || '').trim()].some(s => muster.test(s)));
    if (t) return t;
  }
  return null;
}
