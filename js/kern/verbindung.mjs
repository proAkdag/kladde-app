// Kladde · js/kern/verbindung.mjs — Direktverbindung zwischen zwei Geräten (Scheibe C, Zero 20.10.: „Weg 1: Direktverbindung im WLAN als
// Hauptweg (ein QR-Handschlag je Richtung)“). Eine PeerConnection OHNE Server (iceServers leer: kein Adress-Helfer, kein Relay — nur das
// eigene Netz, Datenschutz-Eisengesetz), ein Kanal. Der Kanal ist Ende-zu-Ende verschlüsselt (DTLS); sein Schlüssel-Fingerabdruck reist im
// QR, den nur die beiden Geräte sehen (Zero (a): keine zusätzliche Passphrase). Muster: stundenverlauf/app/js/verbindung.mjs.
// Ablauf: A einladen() → Code · B annehmen(Code) → Antwort-Code · A abschliessen(Antwort) → Kanal offen auf beiden Seiten.
import { packe, entpacke } from '../../logic/handschlag.mjs?v=3.0.0';

const ICE_SERVER = [];   // bewusst leer (Plan C, P3) — eine Probe liest diese Konfiguration
const warteICE = pc => new Promise(fertig => {
  if (pc.iceGatheringState === 'complete') return fertig();
  pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') fertig(); });
  setTimeout(fertig, 3000);   // ohne Adress-Helfer sind die eigenen Adressen in Millisekunden da; danach mit dem, was da ist
});

function neueVerbindung({ beiOffen, beiNachricht, beiZu } = {}) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVER });
  let dc = null, zu = false;
  const kanal = d => {
    dc = d;
    d.onopen = () => { if (!zu) beiOffen?.(); };
    d.onmessage = e => { if (!zu && typeof e.data === 'string') beiNachricht?.(e.data); };
    d.onclose = () => { if (!zu) beiZu?.('zu'); };
  };
  pc.addEventListener('connectionstatechange', () => { if (!zu && pc.connectionState === 'failed') beiZu?.('gescheitert'); });
  const fehler = art => ({ fehler: art });
  return {
    pc,
    async einladen() {
      kanal(pc.createDataChannel('kladde'));
      await pc.setLocalDescription(await pc.createOffer());
      await warteICE(pc);
      return packe('o', pc.localDescription.sdp);
    },
    // → { code } oder { fehler: 'fremd'|'beschaedigt'|'leer'|'rolle' }
    async annehmen(text) {
      const u = entpacke(text);
      if (u.fehler) return u;
      if (u.type !== 'offer') return fehler('rolle');
      pc.ondatachannel = e => kanal(e.channel);
      try { await pc.setRemoteDescription({ type: 'offer', sdp: u.sdp }); await pc.setLocalDescription(await pc.createAnswer()); }
      catch { return fehler('beschaedigt'); }
      await warteICE(pc);
      return { code: packe('a', pc.localDescription.sdp) };
    },
    async abschliessen(text) {
      const u = entpacke(text);
      if (u.fehler) return u;
      if (u.type !== 'answer') return fehler('rolle');
      try { await pc.setRemoteDescription({ type: 'answer', sdp: u.sdp }); } catch { return fehler('beschaedigt'); }
      return {};
    },
    offen: () => !!dc && dc.readyState === 'open',
    puffer: () => (dc ? dc.bufferedAmount : 0),   // was noch nicht hinaus ist (der Nachlauf misst daran den Fortschritt)
    sende(text) { if (dc && dc.readyState === 'open') dc.send(text); },
    // Flusskontrolle: vor dem nächsten Stück warten, bis der Puffer unter die Grenze fällt (ob es drüben ankam, sagt erst die Quittung)
    async platz(grenze = 1 << 20) {
      while (dc && dc.readyState === 'open' && dc.bufferedAmount > grenze) await new Promise(r => setTimeout(r, 30));
    },
    schliessen() { if (zu) return; zu = true; try { dc?.close(); } catch {} try { pc.close(); } catch {} },
    get geschlossen() { return zu; },
  };
}

export { neueVerbindung, ICE_SERVER };
