// kladde/logic/mappe · Kursmappe (XLSX) → Kurs-JSON (Schema kladde/v1), direkt im Browser.
//
// SPIEGEL von import_klassenliste.importiere() (PC-Bruecke). Beide Seiten muessen dieselbe
// Mappe gleich lesen — sonst entstehen zwei Wahrheiten ueber dieselbe Datei. Die Paritaet
// sichert test/mappe.test.mjs gegen dieselben Fixtures; die Konstanten unten sind die
// JS-Fassung von kladde_lib.py. Aendert sich dort eine Zelladresse, MUSS sie hier mit.
//
// Vertrag (MAPPING.md §1/§2): Die Nr aus Spalte A ist der Join-Schluessel zur Mappenzeile —
// Schueler Nr n steht in Zeile n+5. Namen werden nie zum Matchen benutzt.

import { oeffneXlsx, xlsxLesbar } from './xlsx.mjs';

const SCHEMA = 'kladde/v1';
const BLATT_LISTE = 'Klassenliste';   // SekI wie Oberstufe: das Blatt heisst gleich
const LISTE_DATEN_START = 6;          // Schueler Nr n → Zeile n+5
const MAX_SCHUELER = 35;
const KOPF = { schuljahr: 'C2', klasse: 'E2', lehrkraft: 'H2', fach: 'J2' };

function slug(text) {
  const s = String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'kurs';
}

/**
 * Liest eine Kursmappe und liefert dasselbe Objekt wie die PC-Bruecke:
 *   { schema, kurs:{id,name,fach,schuljahr,lehrkraft,profil}, schueler:[{nr,name,vorname,lb}], warnungen:[] }
 * @param datei  File/Blob/ArrayBuffer der .xlsx
 * @param dateiName  Fallback fuer den Klassennamen, wenn E2 leer ist (= pfad.stem in Python)
 */
async function lieseMappe(datei, dateiName = '') {
  const mappe = await oeffneXlsx(datei);
  const zellen = await mappe.blattZellen(BLATT_LISTE);
  if (!zellen) {
    const da = (await mappe.blattNamen()).slice(0, 6).join(', ');
    throw new Error(`Blatt '${BLATT_LISTE}' fehlt — keine Mappen-Struktur (gefunden: ${da || 'nichts'})`);
  }
  return deuteZellen(zellen, dateiName);
}

/**
 * Die Deutung der Zellen — hier sitzt die Paritaet zu import_klassenliste.py.
 * Bewusst vom Transport (ZIP/XML) getrennt: DOMParser gibt es in Node nicht, ein Test des
 * Lesers waere dort nur ein Test des Shims. So laeuft die pruefpflichtige Haelfte unter
 * node --test gegen dieselben Faelle wie die Python-Seite; das ZIP-Lesen wird im Browser belegt.
 * @param zellen Map<Zelladresse, Text> — leere und Fehlerzellen fehlen darin
 */
function deuteZellen(zellen, dateiName = '') {
  const z = (adr) => (zellen.get(adr) ?? '').toString().trim();

  const schuljahr = z(KOPF.schuljahr);
  const lehrkraft = z(KOPF.lehrkraft);
  const stamm = dateiName.replace(/\.[^.]+$/, '');
  const klasse = z(KOPF.klasse) || stamm;
  const fach = z(KOPF.fach);

  // Profil-Diskriminator (v15): SekI-Kopf D5 = „LB" · Oberstufen-Kursliste D5 = „Notiz"
  const d5 = zellen.get('D5') ?? null;
  const warnungen = [];
  let profil, lbSpalte;
  if (d5 === 'LB') { profil = 'sek1'; lbSpalte = 'D'; }
  else if (d5 === 'Notiz') { profil = 'sek2'; lbSpalte = null; }
  else {
    profil = 'sek1'; lbSpalte = null;
    warnungen.push(
      `Kopf D5 = ${d5 === null ? 'None' : "'" + d5 + "'"} (weder 'LB' noch 'Notiz') — Alt-Liste? ` +
      'Nehme Nr/Name/Vorname aus A/B/C, LB-Flags leer. Für volle Treue in die v15-Vorlage übertragen.');
  }

  const schueler = [];
  for (let nr = 1; nr <= MAX_SCHUELER; nr++) {
    const zeile = nr + LISTE_DATEN_START - 1;
    const name = zellen.get(`B${zeile}`) ?? null;
    const vorname = zellen.get(`C${zeile}`) ?? null;
    if (leer(name) && leer(vorname)) continue;   // Luecken in der Liste ueberspringen, Nr bleibt gebunden
    const lb = !!lbSpalte && String(zellen.get(`${lbSpalte}${zeile}`) ?? '').trim().toUpperCase() === 'LB';
    schueler.push({
      nr,
      name: String(name ?? '').trim(),
      vorname: String(vorname ?? '').trim(),
      lb,
    });
  }
  if (!schueler.length) warnungen.push('Keine Schüler in B6:C40 gefunden — leere Vorlage?');

  return {
    schema: SCHEMA,
    kurs: {
      id: slug(`${klasse}-${fach}-${schuljahr}`),
      name: String(klasse),
      fach: String(fach),
      schuljahr: String(schuljahr),
      lehrkraft: String(lehrkraft),
      profil,
    },
    schueler,
    warnungen,
  };
}

// Python prueft `in (None, "", 0)` — die 0 faengt eine als Zahl formatierte Leerzelle
function leer(w) {
  return w === null || w === undefined || w === '' || w === '0' || w === 0;
}

export { lieseMappe, deuteZellen, xlsxLesbar, SCHEMA, BLATT_LISTE, MAX_SCHUELER, LISTE_DATEN_START, KOPF };
