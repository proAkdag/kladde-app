// kladde/logic/pdfbild · eine PDF-Seite aus einem JPEG-Bild (Sitzplan als PDF, Zero 2026-10-02: „ein Sitzplan Export als eine
// schöne PDF Datei wäre sehr hilfreich“; Technik (a): die Kladde schreibt die Datei selbst). Die App zeichnet den Plan auf eine
// Zeichenfläche und legt das Bild als einzige Seite in die PDF (PDF 1.4, /DCTDecode): offline, auf iPad und Handy dieselbe Datei,
// jeder Name so, wie der Browser ihn zeichnet (ş, ğ, ı). Rein: Bytes rein, Bytes raus.

const enc = new TextEncoder();

// Titel als UTF-16BE mit BOM (PDF-Textstring) — Umlaute und „·“ bleiben im Dokument-Titel erhalten
function pdfText(s) {
  let hex = 'FEFF';
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    const units = cp > 0xFFFF ? [0xD800 + ((cp - 0x10000) >> 10), 0xDC00 + ((cp - 0x10000) & 0x3FF)] : [cp];
    for (const u of units) hex += u.toString(16).toUpperCase().padStart(4, '0');
  }
  return '<' + hex + '>';
}

// pdfAusJpeg(jpeg: Uint8Array, breitePx, hoehePx, {breitePt, hoehePt, titel}) → Uint8Array
// Das Bild füllt die ganze Seite (Standard A4 quer, 842 × 595 pt); die Zeichenfläche hat dasselbe Seitenverhältnis.
function pdfAusJpeg(jpeg, breitePx, hoehePx, { breitePt = 842, hoehePt = 595, titel = '' } = {}) {
  const teile = [], offsets = [];
  let laenge = 0;
  const schreib = x => { const b = typeof x === 'string' ? enc.encode(x) : x; teile.push(b); laenge += b.length; };
  const obj = (n, kopf, strom) => {
    offsets[n] = laenge;
    schreib(n + ' 0 obj\n' + kopf);
    if (strom) { schreib('\nstream\n'); schreib(strom); schreib('\nendstream'); }
    schreib('\nendobj\n');
  };
  schreib('%PDF-1.4\n'); schreib(Uint8Array.of(0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A));   // Binär-Kennung nach der Spezifikation
  const inhalt = enc.encode('q ' + breitePt + ' 0 0 ' + hoehePt + ' 0 0 cm /Im0 Do Q');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + breitePt + ' ' + hoehePt + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
  obj(4, '<< /Type /XObject /Subtype /Image /Width ' + breitePx + ' /Height ' + hoehePx +
    ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>', jpeg);
  obj(5, '<< /Length ' + inhalt.length + ' >>', inhalt);
  obj(6, '<< /Title ' + pdfText(titel) + ' /Producer ' + pdfText('Kladde') + ' >>');
  const xref = laenge;
  schreib('xref\n0 7\n0000000000 65535 f \n' + offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
  schreib('trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  const aus = new Uint8Array(laenge);
  let p = 0; for (const b of teile) { aus.set(b, p); p += b.length; }
  return aus;
}

// jpegAusDataUrl(dataUrl) → Uint8Array (canvas.toDataURL('image/jpeg') ist synchron — die Teilen-Geste bleibt erhalten)
function jpegAusDataUrl(url) {
  const bin = atob(String(url).split(',')[1] || '');
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

export { pdfAusJpeg, jpegAusDataUrl, pdfText };
