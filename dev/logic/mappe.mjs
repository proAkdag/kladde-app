// kladde/logic/mappe · Kursmappe (XLSX) → Kurs-JSON (Schema kladde/v1), direkt im Browser.
//
// SPIEGEL von import_klassenliste.importiere() (PC-Bruecke). Beide Seiten muessen dieselbe
// Mappe gleich lesen — sonst entstehen zwei Wahrheiten ueber dieselbe Datei. Die Paritaet
// sichert test/mappe.test.mjs gegen dieselben Fixtures; die Konstanten unten sind die
// JS-Fassung von kladde_lib.py. Aendert sich dort eine Zelladresse, MUSS sie hier mit.
//
// Vertrag (MAPPING.md §1/§2): Die Nr ist die Mappenzeile — Schueler Nr n steht in Zeile n+5 (Spalte A wird nicht gelesen).
// Seit den zwei Nummern (MAPPING §2a) ist sie beim Abgleich eines bestehenden Kurses nur die Zeile; zugeordnet wird dort ueber
// den Namen (logic/teilnehmer.mjs planeAbgleich), die Ausweis-Nr vergibt die Kladde.

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
      'Nehme Name/Vorname aus B/C (Nr = Zeile), LB-Flags leer. Für volle Treue in die v15-Vorlage übertragen.');
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

/**
 * Prüft eine kurs.json (PC-Werkzeug oder Hand-Edit), bevor sie in den Stamm geht (Prüfer 2026-09-29: bisher
 * nur schema + kurs geprüft — eine doppelte Nr hätte Einträge zweier Kinder vermischt, eine fehlende id den
 * Kurs unauffindbar gemacht). Wirft bei allem, was Zuordnungen verfälscht; glättet und meldet den Rest.
 * Liefert dieselbe Form wie lieseMappe: { schema, kurs, schueler, warnungen }.
 */
function pruefeKursDatei(obj) {
  if (!obj || obj.schema !== SCHEMA || !obj.kurs || typeof obj.kurs !== 'object') throw new Error('kein kladde/v1-Kurs');
  const warnungen = Array.isArray(obj.warnungen) ? obj.warnungen.map(String) : [];
  const q = obj.kurs, txt = w => String(w ?? '').trim();
  const id = txt(q.id);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new Error('Kurs-id fehlt oder ist ungültig (' + (id || 'leer') + ')');
  if (!txt(q.name)) throw new Error('Kursname fehlt');
  const kurs = { id, name: txt(q.name), fach: txt(q.fach), schuljahr: txt(q.schuljahr), lehrkraft: txt(q.lehrkraft), profil: 'sek1' };
  if (q.profil === 'sek2') kurs.profil = 'sek2';
  else if (q.profil !== undefined && q.profil !== 'sek1') warnungen.push(`Profil '${q.profil}' unbekannt — Sek I angenommen`);
  if (kurs.profil === 'sek2' && (q.notenmodus === 'punkte' || q.notenmodus === 'drittel')) kurs.notenmodus = q.notenmodus;
  kurs.slot = /^m[1-6]$/.test(q.slot) ? q.slot : 'm1';
  if (q.slot !== undefined && kurs.slot !== q.slot) warnungen.push(`Slot '${q.slot}' unbekannt — m1 angenommen`);

  // Zwei Nummern (MAPPING §1, Zero 04.10.): `nr` = Ausweis-Nr (ganze Zahl ab 1, ohne Grenze — trägt die Einträge),
  // `liste` = Listen-Nr (Mappenzeile 1–35, fehlt = gleich nr, null = keine). Beide müssen eindeutig sein: eine doppelte
  // Ausweis-Nr vermischt Einträge, eine doppelte Listen-Nr schreibt zwei Kinder in dieselbe Mappenzeile.
  if (!Array.isArray(obj.schueler)) throw new Error('Schülerliste fehlt');
  const schueler = [], nrn = new Set(), zeilen = new Map();
  for (const r of obj.schueler) {
    const nr = Number(r?.nr);
    if (!Number.isSafeInteger(nr) || nr < 1) throw new Error(`Schüler-Nr '${r?.nr}' ungültig (ganze Zahl ab 1)`);
    if (nrn.has(nr)) throw new Error(`Nr ${nr} doppelt — die Einträge wären nicht mehr eindeutig zuzuordnen`);
    nrn.add(nr);
    let liste = nr;
    if (r.liste === null) {   // keine Zeile gibt es nur für Abgänge (MAPPING §2a, Prüfer 05.10. G3)
      if (r.inaktiv !== true) throw new Error(`Nr ${nr}: aktives Kind ohne Listen-Nr — nur ein Abgang (inaktiv) hat keine Mappenzeile`);
      liste = null;
    }
    else if (r.liste !== undefined) {
      liste = Number(r.liste);
      if (!Number.isInteger(liste) || liste < 1 || liste > MAX_SCHUELER) throw new Error(`Listen-Nr '${r.liste}' bei Nr ${nr} ungültig (1–${MAX_SCHUELER})`);
    } else if (nr > MAX_SCHUELER) throw new Error(`Nr ${nr} ohne Listen-Nr — hinter der letzten Mappenzeile (${MAX_SCHUELER})`);
    const s = { nr, name: txt(r.name), vorname: txt(r.vorname), lb: r.lb === true };
    const zeig = liste === null ? 'ohne Nr' : 'Nr ' + liste;   // gemeldet wird die Listen-Nr — sie steht in der Mappe
    if (!s.name && !s.vorname) { warnungen.push(`${zeig} ohne Namen — übersprungen`); continue; }
    if (liste !== null && zeilen.has(liste)) throw new Error(`Listen-Nr ${liste} doppelt (${zeilen.get(liste)} und ${s.vorname} ${s.name}) — zwei Kinder in derselben Mappenzeile`);
    if (liste !== null) zeilen.set(liste, `${s.vorname} ${s.name}`);
    if (liste !== nr) s.liste = liste;   // gleich der Ausweis-Nr → Feld weglassen (Bestand bleibt, wie er war)
    if (r.lb !== undefined && typeof r.lb !== 'boolean') warnungen.push(`${zeig}: LB-Wert '${r.lb}' ist kein ja/nein — nicht als LB übernommen, bitte prüfen`);
    if (txt(r.gruppe)) s.gruppe = txt(r.gruppe);
    if (r.inaktiv === true) s.inaktiv = true;
    schueler.push(s);
  }
  return { schema: SCHEMA, kurs, schueler, warnungen };
}

// Ein neuer Kurs hat überall dieselbe Form (Scheibe 8, Zero 05.10.): aus „Liste einfügen“ wie aus „Mappe laden“ mit Schuljahr,
// Status und Slot, bei der Oberstufe mit Noten-Eingabe. Vorher fehlten sie beim „Schnell“-Weg (Schuljahr, Status, Noten-Eingabe)
// und beim Mappen-Import (Schuljahr, Status; den Slot setzt dort schon pruefeKursDatei). Was der Kurs trägt, bleibt; die Eingabe bleibt unverändert.
function ergaenzeNeuenKurs(kurs, schuljahrId) {
  const k = { ...kurs };
  if (!k.slot) k.slot = 'm1';
  if (!k.status) k.status = 'aktiv';
  if (!k.schuljahrId && schuljahrId) k.schuljahrId = schuljahrId;
  if (k.profil === 'sek2' && !k.notenmodus) k.notenmodus = 'punkte';
  return k;
}
function neuerKurs({ name, fach, schuljahr, profil = 'sek1', notenmodus }, schuljahrId) {
  const k = { id: slug(`${name}-${fach}-${schuljahr}`), name, fach, schuljahr, lehrkraft: '', profil };
  if (profil === 'sek2' && notenmodus) k.notenmodus = notenmodus;
  return ergaenzeNeuenKurs(k, schuljahrId);
}

// Python prueft `in (None, "", 0)` — die 0 faengt eine als Zahl formatierte Leerzelle
function leer(w) {
  return w === null || w === undefined || w === '' || w === '0' || w === 0;
}

export { lieseMappe, deuteZellen, pruefeKursDatei, xlsxLesbar, neuerKurs, ergaenzeNeuenKurs, SCHEMA, BLATT_LISTE, MAX_SCHUELER, LISTE_DATEN_START, KOPF };
