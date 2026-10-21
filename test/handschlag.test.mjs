// Scheibe C (Zero 20.10. Weg 1): Handschlag-Code packen/entpacken, Stand in Stücken mit Prüfsumme. Erwartungen fest im Test, Adressen erfunden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { packe, entpacke, pruefsumme, imEigenenNetz, hallo, zerlege, ende, erhalten, sha256, sammler, STUECK } from '../logic/handschlag.mjs';

const FP = 'A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:01:12:23:34:45:56:67:78:89:9A:AB:BC:CD:DE:EF:F0';
const SDP = 'v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\n'
  + 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\n'
  + 'a=candidate:1 1 udp 2122260223 192.168.178.34 54021 typ host generation 0\r\n'
  + 'a=candidate:2 1 udp 2122262783 fd00::1a2b:3c4d:5e6f:7a8b 54023 typ host generation 0\r\n'
  + 'a=candidate:3 1 udp 2122194687 4f1c2d3e-aaaa-bbbb-cccc-1234567890ab.local 61877 typ host generation 0\r\n'
  + 'a=candidate:4 1 udp 1686052607 93.184.216.34 54021 typ srflx raddr 192.168.178.34 rport 54021 generation 0\r\n'
  + 'a=ice-ufrag:Xh7k\r\na=ice-pwd:t2Vq9mZr8LwP3nYc5bAe6dFg\r\na=ice-options:trickle\r\n'
  + `a=fingerprint:sha-256 ${FP}\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\n`;

test('packe/entpacke: Rundlauf behält Schlüssel, Fingerabdruck und nur Adressen im eigenen Netz', () => {
  const code = packe('o', SDP);
  assert.match(code, /^KL1\|o\|Xh7k\|t2Vq9mZr8LwP3nYc5bAe6dFg\|/);
  assert.ok(code.length < 400, 'kurz genug für einen kleinen QR: ' + code.length);
  assert.ok(!code.includes('93.184.216.34'), 'Adresse vom Adress-Helfer (srflx) fällt weg');
  const u = entpacke(code);
  assert.equal(u.type, 'offer');
  assert.equal(u.adressen, 3);
  assert.match(u.sdp, /a=ice-ufrag:Xh7k\r\n/);
  assert.match(u.sdp, /a=ice-pwd:t2Vq9mZr8LwP3nYc5bAe6dFg\r\n/);
  assert.ok(u.sdp.includes('a=fingerprint:sha-256 ' + FP + '\r\n'));
  assert.match(u.sdp, / 192\.168\.178\.34 54021 typ host /);
  assert.match(u.sdp, / fd00::1a2b:3c4d:5e6f:7a8b 54023 typ host /);
  assert.match(u.sdp, /a=setup:actpass/);
  assert.equal(entpacke(packe('a', SDP)).type, 'answer');
  assert.match(entpacke(packe('a', SDP)).sdp, /a=setup:active/);
});

test('entpacke: beschädigt, fremd, leer — nie raten', () => {
  const code = packe('o', SDP);
  const kaputt = code.replace('Xh7k', 'Xh7K');
  assert.deepEqual(entpacke(kaputt), { fehler: 'beschaedigt' });
  assert.deepEqual(entpacke(code.slice(0, -3)), { fehler: 'beschaedigt' });
  const sv = 'SV1|o|Xh7k|pw|fp|h~1.2.3.4~5|' + pruefsumme('SV1|o|Xh7k|pw|fp|h~1.2.3.4~5');
  assert.deepEqual(entpacke(sv), { fehler: 'fremd' });
  assert.deepEqual(entpacke('   '), { fehler: 'leer' });
  const falscheRolle = 'KL1|x|Xh7k|pw|qg==|h~1.2.3.4~5';
  assert.deepEqual(entpacke(falscheRolle + '|' + pruefsumme(falscheRolle)), { fehler: 'beschaedigt' });
});

test('nur das eigene Netz: öffentliche Adressen und eingeschleuste SDP-Zeilen gelten als beschädigt (Prüfer 20.10. 🟡 7)', () => {
  for (const a of ['192.168.178.34', '10.0.0.7', '172.20.10.2', '169.254.3.4', 'fd00::1a2b', 'fe80::1', '4f1c2d3e-aaaa-bbbb-cccc-1234567890ab.local'])
    assert.ok(imEigenenNetz(a), 'eigenes Netz: ' + a);
  for (const a of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2001:db8::1', 'stun.example.com', '192.169.1.1'])
    assert.ok(!imEigenenNetz(a), 'außer Haus: ' + a);
  const mitV6 = SDP.replace('a=ice-ufrag', 'a=candidate:5 1 UDP 2122262783 2001:db8::7 54030 typ host generation 0\r\na=ice-ufrag');
  assert.ok(!packe('o', mitV6).includes('2001:db8::7'), 'packe lässt eine globale Adresse weg');
  const mitGross = SDP.replace(' udp 2122260223 192.168.178.34', ' UDP 2122260223 192.168.178.34');
  assert.equal(entpacke(packe('o', mitGross)).adressen, 3, 'Firefox schreibt UDP');
  const bau = (ufrag, adr) => { const roh = ['KL1', 'o', ufrag, 't2Vq9mZr8LwP3nYc5bAe6dFg', 'obLD1OX2BxgpOktcbX6PkAESIzRFVmd4iZqrvM3e7/A=', adr].join('|'); return roh + '|' + pruefsumme(roh); };
  assert.equal(entpacke(bau('Xh7k', 'h~192.168.1.5~5000')).type, 'offer', 'Gegenprobe: gültig gebauter Code');
  assert.deepEqual(entpacke(bau('Xh7k', 'h~8.8.4.4~3478')), { fehler: 'beschaedigt' });
  assert.deepEqual(entpacke(bau('abcd\r\na=candidate:9 1 udp 1 8.8.8.8 3478 typ host', 'h~192.168.1.5~5000')), { fehler: 'beschaedigt' });
  assert.deepEqual(entpacke(bau('Xh7k', 'h~192.168.1.5~50a0')), { fehler: 'beschaedigt' });
});

test('Quittung: „erhalten“ kommt beim Sammler an', () => {
  assert.deepEqual(sammler().nimm(erhalten()), { erhalten: true });
});

test('zerlege/sammler: Stand über mehrere Stücke, Prüfsumme über das Ganze', async () => {
  const text = JSON.stringify({ stamm: { kurse: [] }, events: Array.from({ length: 900 }, (_, i) => ({ id: 'e' + i, typ: 'plus', notiz: 'Ä'.repeat(i % 7) })) });
  const teile = zerlege(text);
  assert.ok(teile.length >= 3 && text.length > 2 * STUECK, 'mehr als zwei Stücke: ' + teile.length);
  const s = sammler();
  assert.deepEqual(s.nimm(hallo({ app: '2.4.0', schema: 'kladde/v3', geraet: 'ipad' })), { hallo: { app: '2.4.0', schema: 'kladde/v3', geraet: 'ipad' } });
  for (const t of [...teile].reverse()) s.nimm(t);   // Reihenfolge egal
  const soll = await sha256(text);
  assert.deepEqual(s.nimm(ende(soll)), { ende: soll });
  assert.deepEqual(await s.fertig(soll), { text });
  // ein Stück fehlt → unvollständig, nichts übernommen
  const s2 = sammler(); teile.slice(1).forEach(t => s2.nimm(t));
  assert.deepEqual(await s2.fertig(soll), { fehler: 'unvollstaendig' });
  // ein Zeichen anders → Prüfsumme
  const s3 = sammler(); teile.forEach((t, i) => s3.nimm(i === 1 ? t.replace('plus', 'plux') : t));   // im Stück stehen die " maskiert
  assert.notEqual(teile[1].replace('plus', 'plux'), teile[1]);
  assert.deepEqual(await s3.fertig(soll), { fehler: 'pruefsumme' });
  assert.equal(sammler().nimm('kein json'), null);
});
