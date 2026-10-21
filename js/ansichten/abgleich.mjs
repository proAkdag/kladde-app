// Kladde · js/ansichten/abgleich.mjs — „Mit anderem Gerät abgleichen“ (Scheibe C, Zero 20.10.: „Weg 1: Direktverbindung im WLAN als
// Hauptweg (ein QR-Handschlag je Richtung), Rückfall Datei oder Heimnetz-Server“ · Entscheide (a) keine Passphrase, (b) beide Richtungen,
// (c) nach den Entwürfen design/c_abgleich_2026-10-20/). Plan PLAN_2026-10-20_scheibe_C.md.
// Ein Gerät zeigt die Einladung, das andere scannt sie und zeigt eine Antwort, das erste scannt die Antwort → Kanal offen. Beide senden ihren
// Stand sofort; jedes Gerät führt den fremden Stand auf DEMSELBEN Weg zusammen wie den Datei-Import (Fragen zu Kindern → Vorschau →
// tresorUebernehmen), nie still. Wer den fremden Stand ganz hat, quittiert; erst dann geht der Kanal zu. So darf eine Person die Geräte
// nacheinander bedienen (Prüfer 20.10. 🔴 1). Schließen, Esc, ✕ und Sperren räumen auf: Kamera aus, Kanal zu.
import { hallo, zerlege, ende, erhalten, sha256, sammler } from '../../logic/handschlag.mjs?v=2.4.2';
import { mergeContainerDaten } from '../../logic/merge.mjs?v=2.4.2';
import { schemaBekannt } from '../../logic/migration.mjs?v=2.4.2';
import { dlgZeigenEl, dlgZu } from '../kern/dialog.mjs?v=2.4.2';
import { $, el, toast } from '../kern/dom.mjs?v=2.4.2';
import { iconEl } from '../kern/icons.mjs?v=2.4.2';
import { qrCanvas, scanne } from '../kern/qr.mjs?v=2.4.2';
import { nochOffen, speichern, sperrGen } from '../kern/tresor.mjs?v=2.4.2';
import { GERAET, PAGES_KONTEXT } from '../kern/umgebung.mjs?v=2.4.2';
import { neueVerbindung } from '../kern/verbindung.mjs?v=2.4.2';
import { vault } from '../kern/zustand.mjs?v=2.4.2';
import { kursAutowahl } from './kurswahl.mjs?v=2.4.2';
import { exportiereContainer, fragenKlaeren, syncPull, tresorUebernehmen, unterschiede } from './mehr.mjs?v=2.4.2';
import { renderAlles } from './navigation.mjs?v=2.4.2';

const NAME = { ipad: 'iPad', iphone: 'iPhone', handy: 'Handy', pc: 'PC' };
const ICH = /iPhone|iPod/.test(navigator.userAgent) ? 'iphone' : GERAET;
const nameVon = g => (Object.hasOwn(NAME, g) ? NAME[g] : '');   // ein gebautes „hallo“ bringt sonst Fremdes in den Text (C2 🟢 6)   // GERAET zählt das iPhone zu „ipad“ (Prüfer 🟡 9)
const ZEIT_EINLADEND = 20000, ZEIT_ANTWORTEND = 60000;   // das antwortende Gerät weiß nicht, wann das andere scannt
const ZEIT_STILLE = 20000;   // Kanal offen, aber 20 s keine Nachricht vor dem Ende → abgebrochen (Prüfer 🟡 1)
const NACHLAUF = 15000;      // nach dem Schließen: so lange OHNE Fortschritt im Sendepuffer wartet der Kanal auf die Quittung
const FEHLER = {
  fremd: 'Das ist kein Kladde-Code.',
  beschaedigt: 'Code beschädigt oder unvollständig – bitte neu scannen.',
  leer: 'Kein Code erkannt.',
};

let sitzung = null;
// räumt genau EINE Sitzung ab — ein verspäteter Aufruf einer alten Sitzung trifft nie die neue (P46 P4c). Kamera sofort aus.
// Nachlauf nur nach dem eigenen Zusammenführen: dann soll der eigene Stand noch drüben ankommen, also bleibt der Kanal bis zur Quittung offen,
// solange sich im Sendepuffer etwas bewegt (Prüfer C2 🟡 1: eine feste Grenze schnitt eine langsame Übertragung ab). Wer abbricht, schließt
// sofort — das andere Gerät meldet dann gleich „Abgebrochen“ (C2 🟡 2). Beim Sperren immer sofort zu (P5b, P5c).
function schliesse(s) {
  if (!s || s.zu) return;
  s.zu = true; s.loesen?.();
  clearTimeout(s.timer); s.scanNr++; s.scan?.stopp();
  if (sitzung === s) sitzung = null;
  const v = s.v;
  if (!v) return;
  if (!s.uebernommen || s.quittiert || !v.offen() || !nochOffen(s.gen)) { v.schliessen(); return; }
  let puffer = v.puffer(), zuletzt = Date.now();
  const w = setInterval(() => {
    const p = v.puffer(); if (p !== puffer || s.sendetNoch) { puffer = p; zuletzt = Date.now(); }
    if (s.quittiert || !v.offen() || !nochOffen(s.gen) || Date.now() - zuletzt > NACHLAUF) { clearInterval(w); v.schliessen(); }
  }, 200);
}
const aufraeumen = () => schliesse(sitzung);

// ── Bausteine des Blatts (Entwurf c1–c5) ──
const satz = t => el('p', { class: 'ab-satz' }, t);
const schritt = (n, t) => el('div', { class: 'ab-schritt' }, el('b', {}, n), t);
const status = (t, gut) => el('p', { class: 'ab-status' + (gut ? ' gut' : ''), role: 'status', id: 'ab-status' }, el('span', { class: 'punkt' }), el('span', {}, t));
const zeile = (a, b) => el('div', { class: 'zeile' }, el('span', {}, a), el('span', { class: 'wert' }, b));
const knopf = (text, onclick, extra = {}, ico) => el('button', { type: 'button', class: 'btn' + (extra.still ? ' still' : ''), dataset: extra.data || {}, onclick }, ...(ico ? [iconEl(ico), ' '] : []), text);
const fortschritt = (wert, max) => el('progress', { class: 'ab-fort', id: 'ab-fortschritt', max: String(max), value: String(wert), 'aria-label': 'Übertragung' });
const qrKasten = bild => el('div', { class: 'ab-qr' }, bild || el('p', { class: 'u-hinweis' }, 'QR ließ sich nicht zeichnen – den Code unten als Text weitergeben.'));
const alsText = code => {
  const ta = el('textarea', { id: 'ab-code', rows: '3', readonly: '', class: 'u-textarea', 'aria-label': 'Code als Text' }, code);
  return el('details', { class: 'ab-text' }, el('summary', {}, 'Code als Text'), ta,
    knopf('Kopieren', async () => { try { await navigator.clipboard.writeText(code); toast('Code kopiert'); } catch { ta.select(); } }, { still: true }));
};
const einfuegen = beiCode => {
  const ta = el('textarea', { id: 'ab-einfuegen', rows: '3', class: 'u-textarea', 'aria-label': 'Code einfügen', placeholder: 'KL1|…', autocomplete: 'off', spellcheck: 'false' });
  return el('details', { class: 'ab-text' }, el('summary', {}, 'Ohne Kamera: Code einfügen'), ta, knopf('Übernehmen', () => beiCode(ta.value), { still: true, data: { abNehmen: '' } }));
};
const rueckfall = () => el('div', { class: 'ab-rueck' }, 'Kein gemeinsames WLAN? Hotspot am Handy einschalten und das andere Gerät damit verbinden — oder:',
  el('div', { class: 'ab-leiste' }, knopf('Als Datei sichern', () => { aufraeumen(); dlgZu(); exportiereContainer(); }, { still: true, data: { abDatei: '' } }, 'datei'),
    ...(PAGES_KONTEXT ? [] : [knopf('Vom PC holen', () => { aufraeumen(); dlgZu(); syncPull(); }, { still: true, data: { abPc: '' } }, 'pc')])));

function abgleichBlatt() {
  aufraeumen();
  const s = { gen: sperrGen, empf: sammler(), fremdGeraet: '', scanNr: 0 };
  sitzung = s;
  const lebt = () => sitzung === s && nochOffen(s.gen);
  const zeige = (titel, ...k) => { if (lebt()) dlgZeigenEl(el('h3', {}, titel), ...k); };
  const setzeStatus = (t, gut) => { const st = $('ab-status'); if (st) { st.classList.toggle('gut', !!gut); st.lastChild.textContent = t; } };
  const meldeFehler = r => { const t = r.fehler === 'rolle' ? (s.rolle === 'o' ? 'Das ist eine Einladung – die scannt das andere Gerät mit „Code scannen“.' : 'Das ist ein Antwort-Code – den scannt das Gerät, das den Code zeigt.') : FEHLER[r.fehler] || 'Code nicht lesbar.'; toast(t, 4000); setzeStatus(t); };
  const nochmal = () => el('div', { class: 'ab-leiste' }, knopf('Noch einmal', abgleichBlatt, { data: { abNeu: '' } }));

  // Kanal nie offen gewesen. Gemessene Zeit seit dem Erfassen des Codes — die Verbindung kann vor der Zeitgrenze von selbst scheitern
  // (Chromium nach ~15 s). Das antwortende Gerät weiß nicht, ob das andere die Antwort schon erfasst hat (Prüfer 🟡 8).
  const keineVerbindung = () => {
    if (!lebt() || s.offen || s.v?.offen()) return;
    s.scan?.stopp(); s.v?.schliessen();
    const sek = Math.max(1, Math.round((Date.now() - (s.seit || Date.now())) / 1000));
    zeige('Abgleichen · Keine Verbindung',
      status('Nach ' + sek + ' s keine Verbindung zum anderen Gerät.'),
      ...(s.rolle === 'j' ? [satz('Hat das andere Gerät die Antwort schon erfasst? Wenn ja:')] : []),
      satz('Meist sind die Geräte nicht im selben WLAN, oder das WLAN lässt Geräte nicht miteinander sprechen (in Schulen häufig).'),
      nochmal(), rueckfall());
  };
  // Kanal war offen, der fremde Stand kam aber nicht ganz an (Prüfer 🟡 1): ehrlich sagen, nichts übernehmen
  const abgebrochen = (grund = 'Das andere Gerät hat den Abgleich beendet, bevor alles da war.') => {
    if (s.empfangen || !lebt()) return;   // der fremde Stand ist hier: ein Abbruch drüben ändert nichts mehr
    s.scan?.stopp(); s.v?.schliessen();
    zeige('Abgleichen · Abgebrochen', status(grund + ' Nichts übernommen.'), nochmal(), rueckfall());
  };
  const ankunft = () => s.quittiert ? 'Dein Stand ist auf dem anderen Gerät angekommen.' : 'Dein Stand wird noch zum anderen Gerät übertragen …';
  const stille = () => { if (s.empfangen) return; clearTimeout(s.timer); s.timer = setTimeout(() => abgebrochen('Vom anderen Gerät kam 20 s lang nichts mehr.'), ZEIT_STILLE); };

  // ── Kanal: beide Seiten senden sofort, beide empfangen ──
  const senden = async () => {
    s.sendetNoch = true;
    const text = JSON.stringify({ schema: vault.schema || 'kladde/v3', stamm: vault.stamm, events: vault.events });
    s.v.sende(hallo({ app: document.querySelector('script[type=module]')?.src.split('?v=')[1] || '', schema: vault.schema || 'kladde/v3', geraet: ICH }));
    for (const t of zerlege(text)) { await s.v.platz(); s.v.sende(t); }   // Flusskontrolle: Chromium wirft ab ~16 MB im Puffer (Prüfer 🟡 3)
    s.v.sende(ende(await sha256(text)));
    s.sendetNoch = false;
  };
  const beiOffen = () => {
    if (!lebt()) return;
    s.offen = true; s.scan?.stopp(); stille();
    zeige('Abgleichen · Verbunden', status('Verbunden · tausche Stände …', true), fortschritt(0, 1));
    senden().catch(() => { s.sendetNoch = false; if (s.empfangen) toast('Der eigene Stand ließ sich nicht senden – das andere Gerät bekommt ihn nicht.', 6000); else abgebrochen('Der eigene Stand ließ sich nicht senden.'); });
  };
  const verarbeite = async fremd => {
    if (!schemaBekannt(fremd.schema)) { zeige('Abgleichen · Bitte erst aktualisieren', satz('Das andere Gerät hat eine neuere Kladde (' + fremd.schema + '). Aktualisiere dieses Gerät (Mehr → Update) und gleiche dann ab.')); schliesse(s); return; }
    const antworten = await fragenKlaeren(fremd, s.gen);   // dieselben Fragen wie beim Import (v2.2) — nie still
    if (!antworten || !lebt()) return;   // Abbrechen/✕ in „Bitte klären“ hat die Sitzung schon beendet
    const dry = mergeContainerDaten(vault, fremd, { antworten });
    const eigene = new Set(vault.events.map(e => e.id)), neue = (fremd.events || []).filter(e => !eigene.has(e.id)).length;
    const wer = nameVon(s.fremdGeraet) || 'anderem Gerät';
    zeige('Abgleichen · Verbunden',
      status('Verbunden mit ' + wer + ' · Stände getauscht', true), fortschritt(1, 1),
      zeile('Vom ' + (nameVon(s.fremdGeraet) || 'anderen Gerät'), String(fremd.stamm?.ts || '?').slice(0, 16).replace('T', ' ')),
      zeile('Kurse', String(fremd.stamm?.kurse?.length || 0)),
      zeile('Einträge', (fremd.events?.length || 0) + ' · davon ' + neue + ' neu'),
      ...(dry.konflikte.length ? dry.konflikte.slice(0, 5).map(t => el('p', { class: 'u-warn13' }, iconEl('warnung'), ' ' + t)) : [el('p', { class: 'u-hinweis' }, 'Keine Unterschiede in der Schülerliste.')]),
      ...(dry.hinweise?.length ? [el('p', { class: 'u-hinweis' }, 'Ergänzt aus dem anderen Stand: ' + dry.hinweise.slice(0, 4).join('; ') + (dry.hinweise.length > 4 ? '; … (' + dry.hinweise.length + ')' : ''))] : []),
      el('div', { class: 'btn-reihe' },
        knopf('Zusammenführen', async e => {
          if (s.uebernommen || !nochOffen(s.gen)) return;
          s.uebernommen = true; e.currentTarget.disabled = true;   // ein Doppelklick übernähme zweimal (Prüfer 🟡 5)
          tresorUebernehmen(dry); await speichern();
          if (!nochOffen(s.gen)) return;   // während des Speicherns gesperrt
          kursAutowahl(); renderAlles();
          if (s.zu) return;   // während des Speicherns geschlossen (✕/Esc): zusammengeführt ist, das Blatt bleibt zu (C2 🟢 1)
          dlgZeigenEl(el('h3', {}, 'Abgleichen · Fertig'), status('Zusammengeführt: ' + vault.events.length + ' Einträge' + (dry.konflikte.length ? ' · ' + unterschiede(dry.konflikte.length) : ''), true),
            el('p', { class: 'ab-satz', id: 'ab-ankunft' }, ankunft()),
            satz('Sobald das andere Gerät auch zusammengeführt hat, sind beide gleich.'), el('div', { class: 'btn-reihe' }, knopf('Fertig', dlgZu, { data: { abFertig: '' } })));
        }, { data: { abOk: '' } }),
        knopf('Abbrechen', dlgZu, { still: true })),
      satz('Führt das andere Gerät auch zusammen, sind danach beide gleich.'));   // versprach vorher zu viel (C2 🟡 2)
  };
  const beiNachricht = async roh => {
    const r = s.empf.nimm(roh);
    if (!r) return;
    if (r.erhalten) { s.quittiert = true; const a = $('ab-ankunft'); if (a && sitzung === s) a.textContent = ankunft(); return; }   // auch nach dem Schließen: der Nachlauf wartet darauf
    if (!lebt() || s.empfangen) return;
    stille();
    if (r.hallo) { s.fremdGeraet = r.hallo.geraet; return; }
    if (r.stueck) { const b = $('ab-fortschritt'); if (b) { b.max = r.von; b.value = r.stueck; } setzeStatus('Verbunden · empfange ' + r.stueck + ' von ' + r.von + ' …', true); return; }
    if (r.ende !== undefined) {
      clearTimeout(s.timer);
      const f = await s.empf.fertig(r.ende);
      if (!lebt()) return;
      if (f.fehler) { s.v.schliessen(); zeige('Abgleichen · Unvollständig', status('Die Übertragung kam nicht vollständig an. Nichts übernommen.'), nochmal()); return; }
      let fremd; try { fremd = JSON.parse(f.text); } catch { s.v.schliessen(); zeige('Abgleichen · Unvollständig', status('Der Stand ließ sich nicht lesen. Nichts übernommen.'), nochmal()); return; }
      s.empfangen = true; s.v.sende(erhalten());   // ab hier stört ein Abbruch drüben nicht mehr: der Stand ist hier
      verarbeite(fremd);
    }
  };
  const beiZu = grund => { if (!lebt() || s.empfangen) return; if (s.offen) abgebrochen(); else if (grund === 'gescheitert') keineVerbindung(); };
  const neu = () => { s.v?.schliessen(); s.v = neueVerbindung({ beiOffen, beiNachricht, beiZu }); };

  // ── Kamera-Ansicht (Scannen der Einladung bzw. der Antwort) ──
  // Je Ansicht eine Scan-Nummer: ein Kamerastart, der erst nach dem Einfügen des Codes fertig wird, schaltet sich selbst ab (Prüfer 🟡 6).
  // Ein falscher Code wird einmal gemeldet; die Kamera läuft weiter, bis nimm() einen Code annimmt (Prüfer 🟢 5).
  const scanAnsicht = (titel, oben, nimm) => {
    const nr = ++s.scanNr;
    const video = el('video', { class: 'ab-video', playsinline: '', muted: '', autoplay: '' });
    const ein = einfuegen(nimm);
    zeige(titel, ...oben, el('div', { class: 'ab-kamera' }, video), status('Kamera startet …'), ein);
    s.scan?.stopp();
    scanne(video, t => { if (!/^[A-Z]{1,3}\d\|/.test(t) || t === s.zuletzt) return false; s.zuletzt = t; nimm(t); return false; }).then(r => {
      if (!lebt() || s.scanNr !== nr) { r.stopp(); return; }
      s.scan = r;
      if (r.fehler) { setzeStatus(r.grund === 'NotAllowedError' ? 'Kamera nicht erlaubt – in den Einstellungen erlauben oder Code einfügen.' : 'Kamera nicht verfügbar – Code einfügen.'); ein.open = true; }
      else setzeStatus('Code ins Bild halten …');
    });
  };
  const angenommen = () => { s.scanNr++; s.scan?.stopp(); };

  // A · Code zeigen (einladen)
  const zeigen = async () => {
    s.rolle = 'o'; neu();
    zeige('Abgleichen · Code zeigen', status('Bereite den Code vor …'));
    const code = await s.v.einladen();
    if (!lebt()) return;
    const bild = await qrCanvas(code);
    const nimmAntwort = async text => {
      if (s.nimmt) return true;
      s.nimmt = true;
      const r = await s.v.abschliessen(text);
      if (!lebt()) return true;
      if (r.fehler) { s.nimmt = false; meldeFehler(r); return false; }
      angenommen();
      zeige('Abgleichen · Verbinde …', status('Verbinde mit dem anderen Gerät …'));
      clearTimeout(s.timer); s.seit = Date.now(); s.timer = setTimeout(keineVerbindung, ZEIT_EINLADEND);
      return true;
    };
    zeige('Abgleichen · Code zeigen',
      schritt('1', 'Am anderen Gerät „Code scannen“ und diesen Code erfassen.'), qrKasten(bild), alsText(code),
      schritt('2', 'Dann zeigt es einen Antwort-Code:'),
      el('div', { class: 'ab-leiste' }, knopf('Antwort scannen', () => scanAnsicht('Abgleichen · Antwort scannen', [schritt('2', 'Den Antwort-Code des anderen Geräts erfassen.')], nimmAntwort), { data: { ab: 'antwort-scannen' } }, 'kamera')),
      einfuegen(nimmAntwort),
      status('Wartet auf die Antwort …'));
  };
  // B · Code scannen (annehmen)
  const scannen = () => {
    s.rolle = 'j'; neu();
    const nimmEinladung = async text => {
      if (s.nimmt) return true;
      s.nimmt = true;
      const r = await s.v.annehmen(text);
      if (!lebt()) return true;
      if (r.fehler) { s.nimmt = false; meldeFehler(r); return false; }
      angenommen();
      const bild = await qrCanvas(r.code);
      zeige('Abgleichen · Antwort zeigen',
        schritt('✓', 'Einladung erfasst.'), schritt('2', 'Jetzt am anderen Gerät „Antwort scannen“ und diesen Code erfassen.'),
        qrKasten(bild), alsText(r.code), status('Wartet auf das andere Gerät …'));
      clearTimeout(s.timer); s.seit = Date.now(); s.timer = setTimeout(keineVerbindung, ZEIT_ANTWORTEND);
      return true;
    };
    scanAnsicht('Abgleichen · Code scannen', [schritt('1', 'Den Code des anderen Geräts erfassen.')], nimmEinladung);
  };

  dlgZeigenEl(el('h3', {}, 'Mit anderem Gerät abgleichen'),
    satz('Beide Geräte im selben WLAN. Ein Gerät zeigt einen Code, das andere scannt ihn.'),
    el('div', { class: 'ab-wahl' },
      el('button', { type: 'button', class: 'btn', dataset: { ab: 'zeigen' }, onclick: zeigen }, iconEl('qr'), 'Code zeigen', el('small', {}, 'dieses Gerät lädt ein')),
      el('button', { type: 'button', class: 'btn', dataset: { ab: 'scannen' }, onclick: scannen }, iconEl('kamera'), 'Code scannen', el('small', {}, 'Code des anderen Geräts'))),
    rueckfall());
  // Schließen (✕, Esc, Abbrechen, Sperren — sperren() schließt den Dialog) räumt auf (Plan C, P3/P5). Ist der Dialog beim close-Ereignis
  // schon wieder offen, gilt es nicht: (1) Blattwechsel „Bitte klären“ → Vorschau (Prüfer 🔴 1); (2) das verspätete close des VORIGEN Blatts,
  // wenn gleich danach ein neuer Abgleich öffnet — eine gezielte Marke statt dieser Prüfung (Vorschlag C2 🟢 1) beendete dabei die neue
  // Sitzung (gemessen 21.10., P46 P11: verwaiste Verbindung, Blatt hing)
  const dlg = $('dlg'), beimZu = () => { if (!dlg.open) schliesse(s); };
  dlg.addEventListener('close', beimZu); s.loesen = () => dlg.removeEventListener('close', beimZu);
}

export { abgleichBlatt, aufraeumen };
