// kladde/logic/handschlag · Scheibe C „Abgleich über Direktverbindung“ (Zero 20.10.: „Weg 1: Direktverbindung im WLAN als Hauptweg (ein
// QR-Handschlag je Richtung), Rückfall Datei oder Heimnetz-Server“; Plan PLAN_2026-10-20_scheibe_C.md). Rein, ohne DOM — Node-testbar.
// Herkunft: packSDP/unpackSDP aus stundenverlauf/app/js/verbindung.mjs (am Gerät gemessen 30.09.: Handy ↔ iPad direkt, 62 ms), dort aus der
// Werft-Arena (guest.js). Die Verbindungsdaten werden auf etwa 300 Zeichen gepackt; der Rest der SDP ist Schablone, die beide Seiten kennen.
// Ein Kladde-Code trägt nur Adressen im eigenen Netz (packe und entpacke prüfen das) und Schlüssel des Kanals — keine Namen, keine Daten.

const PRAEFIX = 'KL1';
const MAX_ADRESSEN = 8;   // IPv4 und IPv6 beide (Stundenverlauf, Befund 30.09.)

// FNV-1a 32 bit: ein beim Einfügen verändertes Zeichen heißt „beschädigt“ statt 20 s später „keine Verbindung“
function pruefsumme(s) {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  return x.toString(16).padStart(8, '0');
}
// Nur das eigene Netz (Prüfer 20.10. 🟡 7: ein gebauter Code konnte öffentliche Adressen einschleusen): mDNS-Namen (*.local), private IPv4
// (10/8, 172.16/12 — auch der iPhone-Hotspot 172.20.10.x —, 192.168/16), Link-lokal (169.254/16, fe80::/10), ULA (fc00::/7)
function imEigenenNetz(adr) {
  const a = String(adr).toLowerCase();
  if (/^[0-9a-z-]+\.local$/.test(a)) return true;
  const v4 = a.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) { const x = +v4[1], y = +v4[2]; return x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254); }
  return /^f[cd][0-9a-f]{0,2}:[0-9a-f:]*$/.test(a) || /^fe[89ab][0-9a-f]:[0-9a-f:]*$/.test(a);
}
const ICE_ZEICHEN = /^[A-Za-z0-9+/]{4,256}$/;   // ice-char nach RFC 8839: nur so kommt keine eingeschleuste SDP-Zeile durch
const zuB64 = bytes => (typeof btoa === 'function' ? btoa(String.fromCharCode(...bytes)) : Buffer.from(bytes).toString('base64'));
const ausB64 = s => (typeof atob === 'function' ? [...atob(s)].map(c => c.charCodeAt(0)) : [...Buffer.from(s, 'base64')]);

// rolle 'o' = Einladung (offer), 'a' = Antwort (answer). Nur Adressen im eigenen Netz (host): Adress-Helfer gibt es in der Kladde nicht.
function packe(rolle, sdp) {
  const g = re => (sdp.match(re) || [])[1] || '';
  const ufrag = g(/a=ice-ufrag:([^\r\n]+)/), pwd = g(/a=ice-pwd:([^\r\n]+)/);
  const fphex = g(/a=fingerprint:sha-256 ([0-9A-F:]+)/i).replace(/:/g, '');
  const fp = zuB64((fphex.match(/../g) || []).map(x => parseInt(x, 16)));
  const kand = [], re = /a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ host/gi;   // Firefox schreibt UDP
  let m;
  while ((m = re.exec(sdp))) if (imEigenenNetz(m[1])) kand.push('h~' + m[1] + '~' + m[2]);
  const roh = [PRAEFIX, rolle, ufrag, pwd, fp, kand.slice(0, MAX_ADRESSEN).join(',')].join('|');
  return roh + '|' + pruefsumme(roh);
}

// → { type: 'offer'|'answer', sdp, adressen } oder { fehler: 'fremd'|'beschaedigt'|'leer' } — nie werfen, nie raten
function entpacke(text) {
  const t = String(text || '').trim();
  if (!t) return { fehler: 'leer' };
  const alle = t.split('|');
  if (alle[0] !== PRAEFIX) return { fehler: 'fremd' };   // z. B. ein Code des Stundenverlaufs (SV1) oder der Arena (W1)
  if (alle.length !== 7 || pruefsumme(alle.slice(0, 6).join('|')) !== alle[6]) return { fehler: 'beschaedigt' };
  const p = alle.slice(0, 6);
  if (!['o', 'a'].includes(p[1]) || !ICE_ZEICHEN.test(p[2]) || !ICE_ZEICHEN.test(p[3]) || !/^[\w+/=:.~,-]*$/.test(p[5])) return { fehler: 'beschaedigt' };
  let fp = '';
  try { fp = (ausB64(p[4]).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase().match(/../g) || []).join(':'); }
  catch { return { fehler: 'beschaedigt' }; }
  if (!fp) return { fehler: 'beschaedigt' };
  let zeilen = '', n = 0;
  for (const c of p[5].split(',').filter(Boolean)) {
    const s = c.split('~');
    if (s.length !== 3 || s[0] !== 'h' || !imEigenenNetz(s[1]) || !/^\d{1,5}$/.test(s[2])) return { fehler: 'beschaedigt' };
    zeilen += `a=candidate:${n + 1} 1 udp ${2130706431 - n} ${s[1]} ${s[2]} typ host generation 0\r\n`; n++;
  }
  const sdp = `v=0\r\no=- ${Date.now()} 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\n`
    + `m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\n${zeilen}`
    + `a=ice-ufrag:${p[2]}\r\na=ice-pwd:${p[3]}\r\na=ice-options:trickle\r\na=fingerprint:sha-256 ${fp}\r\n`
    + `a=setup:${p[1] === 'o' ? 'actpass' : 'active'}\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n`;
  return { type: p[1] === 'o' ? 'offer' : 'answer', sdp, adressen: n };
}

// ── Nachrichten im Kanal ── hallo → stand (in Stücken) → ende (mit SHA-256 über das Ganze) → erhalten (Quittung der Gegenseite).
// Beide Seiten senden, beide empfangen.
const STUECK = 16000;   // Zeichen je Stück; mit maskierten Anführungszeichen und UTF-8 bis etwa 20 KB je Nachricht (die SDP erlaubt 256 KiB)
const hallo = ({ app, schema, geraet }) => JSON.stringify({ t: 'hallo', app, schema, geraet });
function zerlege(text) {
  const n = Math.max(1, Math.ceil(text.length / STUECK)), out = [];
  for (let i = 0; i < n; i++) out.push(JSON.stringify({ t: 'stand', i, n, d: text.slice(i * STUECK, (i + 1) * STUECK) }));
  return out;
}
const ende = sha => JSON.stringify({ t: 'ende', sha });
const erhalten = () => JSON.stringify({ t: 'erhalten' });   // „dein Stand ist ganz hier“ — erst danach darf der Absender den Kanal schließen
async function sha256(text) {
  const h = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Empfänger: sammelt Stücke; liefert beim „ende“ { text } oder { fehler: 'unvollstaendig'|'pruefsumme' }. Unbekanntes wird ignoriert.
function sammler() {
  let stuecke = [], n = 0;
  return {
    nimm(roh) {
      let m; try { m = JSON.parse(roh); } catch { return null; }
      if (!m || typeof m !== 'object') return null;
      if (m.t === 'hallo') return { hallo: { app: String(m.app || ''), schema: String(m.schema || ''), geraet: String(m.geraet || '') } };
      if (m.t === 'stand' && Number.isInteger(m.i) && Number.isInteger(m.n) && m.n > 0 && m.i >= 0 && m.i < m.n && typeof m.d === 'string') {
        if (!n) { n = m.n; stuecke = Array(n).fill(null); }   // gefüllt: Array.some überspringt Löcher, ein fehlendes Stück fiele nicht auf
        if (m.n === n) stuecke[m.i] = m.d;
        return { stueck: m.i + 1, von: n };
      }
      if (m.t === 'ende') return { ende: String(m.sha || '') };
      if (m.t === 'erhalten') return { erhalten: true };
      return null;
    },
    async fertig(shaSoll) {
      if (!n || stuecke.length !== n || stuecke.some(s => typeof s !== 'string')) return { fehler: 'unvollstaendig' };
      const text = stuecke.join('');
      return (await sha256(text)) === shaSoll ? { text } : { fehler: 'pruefsumme' };
    },
  };
}

export { PRAEFIX, pruefsumme, imEigenenNetz, packe, entpacke, hallo, zerlege, ende, erhalten, sha256, sammler, STUECK };
