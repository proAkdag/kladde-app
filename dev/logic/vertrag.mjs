// kladde/logic/vertrag · Kladde-Vertrag (A2 Modul-Umbau, Zero 19.10.: „bau die Kladde auch Modular auf … wie im Rohwerk“)
// EINE Liste dessen, was im Tresor steht: Stammfelder und Eintragstypen. Der Code liest daraus (merge: Kursbezug),
// test/vertrag.test.mjs prüft den Rest des Codes dagegen (jedes stamm.<feld>, jeder gebuchte Typ, Beschriftung,
// Bewertung, Termin, Kachel). Ein neues Feld oder ein neuer Typ wird ZUERST hier eingetragen, sonst wird der Wächter rot.

// Stammfelder (vault.stamm). kurs: woran ein Kurs hängt, wenn er endgültig gelöscht wird —
//   'schluessel' = { [kursId]: … } · 'liste' = [{ kursId, … }] (Einträge ohne kursId, z. B. Entfall des ganzen Tages, bleiben) · null = kein Kursbezug.
// art: 'daten' = Inhalt des Lehrers · 'meta' = Verwaltung des Merge (rev/ts/geraet) bzw. Löschmarkierungen.
// Merge: der Stamm gewinnt als Ganzes über rev (logic/merge.mjs); allein `geloescht` wird beider Geräte vereinigt.
const STAMM_FELDER = Object.freeze({
  rev:                { art: 'meta',  kurs: null },
  ts:                 { art: 'meta',  kurs: null },
  geraet:             { art: 'meta',  kurs: null },
  geloescht:          { art: 'meta',  kurs: null, merge: 'vereinigen' },   // { [kursId]: { am, wieder? } }
  kurse:              { art: 'daten', kurs: 'eigen' },                     // [{ id, … }] — der Kurs selbst
  schueler:           { art: 'daten', kurs: 'schluessel' },
  sitzplaene:         { art: 'daten', kurs: 'schluessel' },
  kursprofile:        { art: 'daten', kurs: 'schluessel' },
  wochenplan:         { art: 'daten', kurs: 'liste' },
  ausnahmeSlots:      { art: 'daten', kurs: 'liste' },
  stundenplanSlots:   { art: 'daten', kurs: 'liste' },
  zeitmodelle:        { art: 'daten', kurs: null },
  schuljahre:         { art: 'daten', kurs: null },
  aktivesSchuljahrId: { art: 'daten', kurs: null },
  einstellungen:      { art: 'daten', kurs: null },
});

// Eintragstypen (vault.events[].typ). label = Beschriftung in Verlauf, Chips, Wiederherstellen (TYP_LABEL in js/ansichten/eintraege.mjs) ·
// bewertung = zählt als Bewertung des Termins (BEWERTUNGS_TYPEN in js/ansichten/heute.mjs; im Beamer „Bewertung“ statt Wert) ·
// termin = macht den Tag zum Kurstermin (TERMIN_TYPEN in verdichtung.mjs) · somi = ＋/o/− der Sonstigen Mitarbeit (SOMI_TYPEN) ·
// kachel = der Tages-Stand der Kachel zählt ihn (reduziereStand in js/ansichten/eintraege.mjs) · beamer = im Beamer verborgen.
const T = (label, f = {}) => Object.freeze({ label, bewertung: false, termin: false, somi: false, kachel: false, beamer: false, ...f });
const BEW = { bewertung: true, termin: true, kachel: true, beamer: true };
const TERMIN = { termin: true, kachel: true };
const EINTRAGSTYPEN = Object.freeze({
  '+':          T('＋', { ...BEW, somi: true }),
  'o':          T('o', { ...BEW, somi: true }),
  '-':          T('−', { ...BEW, somi: true }),
  note:         T('Note', BEW),                        // ⭐ besondere Leistung = note mit best:true
  verweigert:   T('verweigert (6)', BEW),
  mat:          T('Material', TERMIN),
  ha:           T('HA', TERMIN),
  ipad_fehlt:   T('iPad fehlt', TERMIN),
  ipad_leer:    T('iPad leer', TERMIN),
  lernzeit:     T('Lernzeit/HA', TERMIN),
  notiz:        T('Notiz', TERMIN),
  fehlt_o:      T('abwesend', TERMIN),
  fehlt_e:      T('fehlt (e)', TERMIN),
  fehlt_u:      T('fehlt (u)', TERMIN),
  versp:        T('zu spät', TERMIN),
  quartalsnote: T('Quartalsnote', { beamer: true }),   // trägt einheit 'drittel' | 'punkte' (v2.1)
  storno:       T(null),                               // nimmt einen Eintrag zurück (stornoVon); nie angezeigt
});

// Werkzeuge der Stempel-Leiste, die selbst kein Eintragstyp sind: was sie buchen (null = nichts Eigenes).
const WERKZEUGE = Object.freeze({ bestleistung: { bucht: 'note' }, entfernen: { bucht: null } });

const felderMitKurs = art => Object.keys(STAMM_FELDER).filter(f => STAMM_FELDER[f].kurs === art);
const typenMit = flag => Object.keys(EINTRAGSTYPEN).filter(t => EINTRAGSTYPEN[t][flag]);

export { STAMM_FELDER, EINTRAGSTYPEN, WERKZEUGE, felderMitKurs, typenMit };
