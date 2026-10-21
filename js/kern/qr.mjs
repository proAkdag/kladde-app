// Kladde · js/kern/qr.mjs — QR zeichnen und scannen (Scheibe C „Abgleich über Direktverbindung“, Zero 20.10.). Der Kern kennt keine Ansicht.
// Bibliotheken erst nachgeladen, wenn gebraucht: js/vendor/qrcode.js (Kazuhiko Arase, MIT), js/vendor/jsqr.js (Apache-2.0) — beide mit Kopf,
// aus stundenverlauf/app/js/vendor. Gezeichnet wird auf ein Canvas (kein innerHTML, CSP-Wächter); gescannt mit BarcodeDetector, sonst jsQR.
// Muster: Werft-Arena guest.js (QR auf Canvas) und Stundenverlauf verbindung.mjs (Scanner).
import { el } from './dom.mjs?v=2.4.1';

const geladen = {};
function laden(datei, name) {
  if (window[name]) return Promise.resolve(true);
  if (!geladen[datei]) geladen[datei] = new Promise(fertig => {
    const s = document.createElement('script'); s.src = './js/vendor/' + datei + '?v=2.4.1';
    s.onload = () => fertig(!!window[name]); s.onerror = () => { delete geladen[datei]; fertig(false); };
    document.head.append(s);
  });
  return geladen[datei];
}

// QR als Canvas (Fehlerstufe M, weißer Rand vier Module) — null, wenn die Bibliothek nicht lädt
async function qrCanvas(text) {
  if (!(await laden('qrcode.js', 'qrcode'))) return null;
  const q = window.qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), s = 8, rand = 4 * s;
  const c = el('canvas', { class: 'ab-qr-bild', role: 'img', 'aria-label': 'QR-Code' });
  c.width = c.height = n * s + 2 * rand;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) g.fillRect(rand + k * s, rand + r * s, s, s);
  return c;
}

// Scanner: Rückkamera in video, etwa 4 Versuche je Sekunde; beiText(text) → true beendet. Liefert { stopp, fehler }.
// Die Kamera läuft nur hier und wird bei stopp() sofort freigegeben (Plan C, P3).
async function scanne(video, beiText) {
  let aus = false, strom = null;
  const stopp = () => { aus = true; strom?.getTracks().forEach(t => t.stop()); strom = null; video.srcObject = null; };
  if (!navigator.mediaDevices?.getUserMedia) return { stopp, fehler: 'keine-kamera' };
  let det = null;
  if ('BarcodeDetector' in window) try { det = new BarcodeDetector({ formats: ['qr_code'] }); } catch { det = null; }
  if (!det && !(await laden('jsqr.js', 'jsQR'))) return { stopp, fehler: 'kein-scanner' };
  try { strom = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); }
  catch (e) { return { stopp, fehler: 'kamera-zu', grund: e && e.name }; }
  if (aus) { stopp(); return { stopp, fehler: 'abgebrochen' }; }
  video.srcObject = strom;
  try { await video.play(); } catch { /* Safari spielt erst nach Geste — der Dialog-Klick war die Geste */ }
  const cv = document.createElement('canvas'), g = cv.getContext('2d', { willReadFrequently: true });
  let zuletzt = 0;
  const takt = async () => {
    if (aus) return;
    if (video.readyState >= 2 && performance.now() - zuletzt > 250) {
      zuletzt = performance.now();
      const f = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
      cv.width = Math.round(video.videoWidth * f); cv.height = Math.round(video.videoHeight * f);
      g.drawImage(video, 0, 0, cv.width, cv.height);
      let t = null;
      if (det) try { t = (await det.detect(cv))[0]?.rawValue || null; } catch { det = null; laden('jsqr.js', 'jsQR'); }
      if (!t && !det && window.jsQR) t = window.jsQR(g.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, { inversionAttempts: 'dontInvert' })?.data || null;
      if (aus) return;
      if (t && beiText(t)) { stopp(); return; }
    }
    requestAnimationFrame(takt);
  };
  requestAnimationFrame(takt);
  return { stopp, fehler: null };
}

export { qrCanvas, scanne };
