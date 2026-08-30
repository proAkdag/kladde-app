// kladde/logic/xlsx · Minimal-Leser fuer XLSX im Browser — ohne jede Fremdbibliothek.
//
// Warum eigen: eine Kursmappe soll direkt in die Kladde gezogen werden koennen (Zero 2026-08-30),
// auch auf dem iPad ohne PC-Zwischenschritt. XLSX ist ein ZIP aus XML — beides kann die Plattform
// nativ: DecompressionStream('deflate-raw') + DOMParser. Kein CDN, kein Bundle, self-contained.
//
// Bewusst NICHT gebaut: Styles, Datumsformate, Zip64, verschluesselte Mappen. Gebraucht wird
// genau eine Sache — Zelltexte eines benannten Blatts.
//
// Gemessen an echten Mappen (2026-08-30): Excel schreibt die Kopffelder als FORMELN (t="str",
// 282 Stueck in der v15-Vorlage), Texte ueber sharedStrings (t="s") und Fehler als t="e".
// Eine mit openpyxl erzeugte Mappe schreibt stattdessen t="inlineStr" und KEINE sharedStrings.
// Beide Welten muessen gelesen werden — eine Testmappe allein haette das nie gezeigt.

const ZIP_EOCD = 0x06054b50;
const ZIP_CD = 0x02014b50;

/** Prueft, ob der Browser XLSX ueberhaupt entpacken kann (Safari < 16.4 kann es nicht). */
function xlsxLesbar() {
  try { new DecompressionStream('deflate-raw'); return true; } catch { return false; }
}

async function inflate(bytes, methode) {
  if (methode === 0) return bytes;                    // STORED — kommt bei kleinen Eintraegen vor
  if (methode !== 8) throw new Error('ZIP-Methode ' + methode + ' nicht unterstützt');
  const ds = new DecompressionStream('deflate-raw');
  const strom = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(strom).arrayBuffer());
}

/** ZIP-Verzeichnis lesen → Map<pfad, {offset, methode, groesse}>. */
function zipVerzeichnis(dv, bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
    if (dv.getUint32(i, true) === ZIP_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Kein ZIP — ist das wirklich eine .xlsx-Datei?');
  const anzahl = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  if (p === 0xffffffff) throw new Error('Zip64-Mappe wird nicht unterstützt');

  const eintraege = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < anzahl; n++) {
    if (dv.getUint32(p, true) !== ZIP_CD) break;
    const methode = dv.getUint16(p + 10, true);
    const groesse = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const kommLen = dv.getUint16(p + 32, true);
    const lokal = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    eintraege.set(name, { lokal, methode, groesse });
    p += 46 + nameLen + extraLen + kommLen;
  }
  return eintraege;
}

/** Oeffnet eine XLSX-Datei (File/Blob/ArrayBuffer) und liefert einen Zugriff auf ihre Blaetter. */
async function oeffneXlsx(quelle) {
  if (!xlsxLesbar()) throw new Error('Dieser Browser kann keine Mappen entpacken (DecompressionStream fehlt)');
  const puffer = quelle instanceof ArrayBuffer ? quelle : await quelle.arrayBuffer();
  const bytes = new Uint8Array(puffer);
  const dv = new DataView(puffer);
  const verzeichnis = zipVerzeichnis(dv, bytes);

  const roh = async (pfad) => {
    const e = verzeichnis.get(pfad);
    if (!e) return null;
    // Datenbeginn steht erst im Local Header — dessen Extra-Feld weicht vom Verzeichnis ab
    const nameLen = dv.getUint16(e.lokal + 26, true);
    const extraLen = dv.getUint16(e.lokal + 28, true);
    const start = e.lokal + 30 + nameLen + extraLen;
    return inflate(bytes.subarray(start, start + e.groesse), e.methode);
  };
  const text = async (pfad) => {
    const b = await roh(pfad);
    return b === null ? null : new TextDecoder('utf-8').decode(b);
  };
  const xml = async (pfad) => {
    const t = await text(pfad);
    if (t === null) return null;
    const doc = new DOMParser().parseFromString(t, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error(pfad + ': XML unlesbar');
    return doc;
  };

  // sharedStrings: Excel legt Texte zentral ab (t="s" verweist per Index hierher)
  let geteilt = null;
  const geteilteTexte = async () => {
    if (geteilt) return geteilt;
    const doc = await xml('xl/sharedStrings.xml');
    geteilt = doc ? [...doc.getElementsByTagName('si')].map(knotenText) : [];
    return geteilt;
  };

  /** Blattpfad zu einem Blattnamen (workbook.xml → r:id → rels → Target). */
  const blattPfad = async (blattName) => {
    const wb = await xml('xl/workbook.xml');
    if (!wb) throw new Error('xl/workbook.xml fehlt — keine Mappe');
    const blatt = [...wb.getElementsByTagName('sheet')].find(s => s.getAttribute('name') === blattName);
    if (!blatt) return null;
    // r:id — getAttribute mit Praefix ist zuverlaessiger als NS-Lookup ueber wechselnde Praefixe
    const rid = blatt.getAttribute('r:id') || blatt.getAttributeNS(
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rels = await xml('xl/_rels/workbook.xml.rels');
    const rel = rels && [...rels.getElementsByTagName('Relationship')].find(r => r.getAttribute('Id') === rid);
    if (!rel) return null;
    const ziel = rel.getAttribute('Target');
    // Target ist absolut ("/xl/worksheets/sheet2.xml") oder relativ ("worksheets/sheet2.xml")
    return ziel.startsWith('/') ? ziel.slice(1) : 'xl/' + ziel.replace(/^\.\//, '');
  };

  /** Liest ein Blatt als Map<Zelladresse, Text>. Leere und Fehlerzellen fehlen in der Map. */
  const blattZellen = async (blattName) => {
    const pfad = await blattPfad(blattName);
    if (!pfad) return null;
    const doc = await xml(pfad);
    if (!doc) return null;
    const ss = await geteilteTexte();
    const zellen = new Map();
    for (const c of doc.getElementsByTagName('c')) {
      const adr = c.getAttribute('r');
      if (!adr) continue;
      const wert = zellWert(c, ss);
      if (wert !== null && wert !== '') zellen.set(adr, wert);
    }
    return zellen;
  };

  const blattNamen = async () => {
    const wb = await xml('xl/workbook.xml');
    return wb ? [...wb.getElementsByTagName('sheet')].map(s => s.getAttribute('name')) : [];
  };

  return { blattZellen, blattNamen };
}

/** Text eines <si>/<is>-Knotens — Rich-Text besteht aus mehreren <t>-Stuecken. */
function knotenText(knoten) {
  return [...knoten.getElementsByTagName('t')].map(t => t.textContent).join('');
}

/**
 * Zellwert als Text. Deckt alle an echten Mappen gemessenen Formen ab:
 *   t="s"         → Index in sharedStrings
 *   t="inlineStr" → <is><t> (so schreibt openpyxl)
 *   t="str"       → Ergebnis einer Formel (so stehen die Kopffelder der v15-Vorlage da)
 *   t="e"         → Fehlerwert (#REF! …) → null, NICHT der Fehlertext
 *   t="b"         → Wahrheitswert
 *   ohne t        → Zahl in <v>
 * Formelzellen liefern immer das gespeicherte Ergebnis <v>, nie die Formel <f> —
 * das entspricht openpyxls data_only=True, mit dem die PC-Bruecke liest.
 */
function zellWert(c, geteilt) {
  const typ = c.getAttribute('t');
  if (typ === 'e') return null;
  if (typ === 'inlineStr') {
    const is = c.getElementsByTagName('is')[0];
    return is ? knotenText(is) : null;
  }
  const v = c.getElementsByTagName('v')[0];
  if (!v) return null;
  const roh = v.textContent;
  if (typ === 's') {
    const i = Number(roh);
    return Number.isInteger(i) && geteilt[i] !== undefined ? geteilt[i] : null;
  }
  if (typ === 'b') return roh === '1' ? 'WAHR' : 'FALSCH';
  return roh;   // "str" (Formel-Ergebnis) und Zahlen kommen beide als Text zurueck
}

export { oeffneXlsx, xlsxLesbar };
