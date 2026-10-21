// kladde/js/ansichten/mappe · Scheibe D1 „Arbeiten“ (Plan kladde/PLAN_2026-10-21_scheibe_D.md, Zero 21.10.).
// Die Mappe liegt oben auf der Kurs-Seite (F1), ein eigener Bildschirm in „Kurse“, nie im Beamer: renderKurse schließt sie, sobald der
// Beamer an ist, und ihr DOM wird ersetzt (Hard-Lock-Lehre v1.3.1). Alles, was sie schreibt, ist ein Ereignis (arbeit · punkte · lob,
// logic/arbeiten) — nie der Stamm. Gerechnet wird nur in logic/arbeiten (Soll aus Excel), hier wird nur gezeigt und gebucht.
// Importregel (kern.test (3)(4)): Ansichten importieren einander direkt; beim Laden liest dieses Modul nichts aus einer anderen Ansicht.
import { MAX_AUFGABEN, OB_LABEL, werteArbeitAus, mappenStand, lesePunkte, quartalVon, mappeSchalter, schluesselVorlage, schluesselFehler, sek1Gitter } from '../../logic/arbeiten.mjs?v=3.0.0';
import { excelRunde, zahlText } from '../../logic/excelrechnen.mjs?v=3.0.0';
import { lnr, nachListe } from '../../logic/teilnehmer.mjs?v=3.0.0';
import { dlgZeigenEl, dlgZu } from '../kern/dialog.mjs?v=3.0.0';
import { $, el, toast } from '../kern/dom.mjs?v=3.0.0';
import { iconEl } from '../kern/icons.mjs?v=3.0.0';
import { geraetId, speichern } from '../kern/tresor.mjs?v=3.0.0';
import { GERAET } from '../kern/umgebung.mjs?v=3.0.0';
import { beamerModus, heuteIso, vault } from '../kern/zustand.mjs?v=3.0.0';
import { mitUebergang } from './navigation.mjs?v=3.0.0';
import { renderKurse } from './kurse.mjs?v=3.0.0';
import { aktivesSchuljahr } from './schueler.mjs?v=3.0.0';

// Offene Mappe: { kursId, arbeitId|null } — null = zu. Nur im Speicher (ein Kaltstart beginnt auf der Kurs-Seite).
let mappeAuf = null;
function setzeMappe(w) { mappeAuf = w; }
function schliesseMappe() { mappeAuf = null; }
// Beamer an (Prüfer 21.10. 🔴, gemessen B0): die Ansicht „Kurse“ ist beim Wechsel nach „Heute“ nur versteckt — ihr DOM trug Raster, Namen
// und Punkte weiter. Darum beim Einschalten: Mappe zu, ihr DOM weg, ein geschlossener Dialog (Lob, Arbeit) geleert. Muster sperren().
function mappeLeeren() {
  mappeAuf = null;
  const v = document.getElementById('view-kurse');
  if (v && v.querySelector('.mp, .mp-panel')) v.replaceChildren();
  const d = document.getElementById('dlg');
  if (d && !d.open) d.replaceChildren();
}
const QLABEL = { q1: 'Q1', q2: 'Q2', q3: 'Q3', q4: 'Q4' };
const komma = (x, n) => (x == null ? '' : zahlText(n == null ? x : excelRunde(x, n)));
const prozent = q => (q == null ? '' : zahlText(excelRunde(q * 100, 1)) + ' %');
const istOb = k => k && k.profil === 'sek2';

// Kinder einer Arbeit: aktive in Listen-Reihenfolge (Zeile der Excel-Mappe), dazu Inaktive, die schon Punkte haben.
function kinderVon(k, punkteDerArbeit) {
  const alle = (vault.stamm.schueler[k.id] || []).filter(s => s.sid);
  const mitPunkten = s => punkteDerArbeit && punkteDerArbeit.has(s.sid);
  return [...nachListe(alle.filter(s => !s.inaktiv)), ...alle.filter(s => s.inaktiv && mitPunkten(s))];
}
// Schreiben: ein Ereignis an den Tresor hängen, nie den Stamm ändern (Vor-Bedingung 3). Archiv ist schreibgeschützt wie überall (P3.3).
function buche(typ, k, felder) {
  if (k.status === 'archiviert') { toast('Archivierter Kurs — schreibgeschützt'); return null; }
  const e = { id: crypto.randomUUID(), typ, kursId: k.id, ts: new Date().toISOString(), geraet: GERAET, geraetId, ...felder };
  vault.events.push(e); speichern();
  return e;
}

// ── Tür auf der Kurs-Seite ──
function mappePanel(k, oeffnen) {
  if (beamerModus) return null;   // nie im Beamer (Vor-Bedingung 5)
  const sch = mappeSchalter(k);
  if (!sch.arbeiten) return null;  // D1 hat nur die Tür „Arbeiten“; Noten (D2) und Kasse (D4) folgen
  const st = mappenStand(vault.events, k.id), n = st.arbeiten.length, letzte = st.arbeiten[n - 1];
  const unter = n ? n + (n === 1 ? ' Arbeit' : ' Arbeiten') + ' · zuletzt ' + (letzte.titel || '') + (letzte.am ? ' am ' + datumKurz(letzte.am) : '') : 'Noch keine Arbeit';
  return el('section', { class: 'panel ks-panel mp-panel' }, el('h2', {}, 'Mappe'),
    el('div', { class: 'mp-tueren' },
      el('button', { type: 'button', class: 'mp-tuer', dataset: { mpTuer: 'arbeiten' }, onclick: () => oeffnen() },
        el('b', {}, iconEl('datei'), 'Arbeiten'), el('small', {}, unter))));
}
const datumKurz = iso => { const [, m, d] = String(iso).split('-'); return d && m ? d + '.' + m + '.' : iso; };

// ── Bildschirm der Mappe (renderKurse ruft ihn, solange mappeAuf zum offenen Kurs gehört) ──
function renderMappe(wrap, k) {
  if (mappeAuf.arbeitId) { const st = mappenStand(vault.events, k.id), a = st.arbeiten.find(x => x.arbeitId === mappeAuf.arbeitId);
    if (a) return renderArbeit(wrap, k, a, st); mappeAuf = { kursId: k.id, arbeitId: null }; }
  renderArbeiten(wrap, k);
}
const zurueck = (text, fn) => el('button', { type: 'button', class: 'btn still ks-zurueck', dataset: { mpZurueck: '' }, onclick: () => mitUebergang(fn) }, text);

function renderArbeiten(wrap, k) {
  const st = mappenStand(vault.events, k.id), sj = aktivesSchuljahr();
  const zeile = a => {
    const pk = st.punkte.get(a.arbeitId), e = werteArbeitAus(a, kinderVon(k, pk).map(s => ({ sid: s.sid, lb: s.lb })), pk);
    const n = e.zeilen.filter(z => z.summe != null).length, q = quartalVon(a.am, sj);
    const meta = [datumKurz(a.am), q ? QLABEL[q] : 'kein Quartal', a.aufgaben.length + (a.aufgaben.length === 1 ? ' Aufgabe' : ' Aufgaben') + ', ' + komma(e.gesamt) + ' P',
      n + ' von ' + e.zeilen.length + ' eingetragen', e.schnitt != null ? 'Ø ' + komma(e.schnitt) : ''].filter(Boolean).join(' · ');
    return el('div', { class: 'mp-arbeit', dataset: { mpArbeit: a.arbeitId } },
      el('b', {}, (a.art === 'test' ? 'Test · ' : '') + (a.titel || 'ohne Titel')),
      // Konflikt sichtbar als Text, nicht nur als Tooltip (iPad hat keinen) — Prüfer 21.10.
      a.konflikt ? el('p', { class: 'mp-warn', dataset: { mpKonflikt: a.arbeitId } }, a.loeschKonflikt
        ? '⚠ Auf einem Gerät gelöscht, auf einem anderen geändert — „Bearbeiten → Speichern“ behält sie, „Löschen“ entfernt sie.'
        : '⚠ Auf zwei Geräten verschieden geändert — „Bearbeiten → Speichern“ legt die gezeigte Fassung fest.') : null,
      el('p', { class: 'mp-meta' }, meta),
      el('span', { class: 'btn-reihe' },
        el('button', { type: 'button', class: 'btn still', dataset: { mpBearbeiten: a.arbeitId }, onclick: () => arbeitDialog(k, a) }, 'Bearbeiten'),
        el('button', { type: 'button', class: 'btn', dataset: { mpOeffnen: a.arbeitId }, onclick: () => { mappeAuf = { kursId: k.id, arbeitId: a.arbeitId }; mitUebergang(renderKurse); } }, 'Öffnen')));
  };
  wrap.replaceChildren(el('div', { class: 'ks mp' },
    zurueck('‹ ' + k.name + ' · ' + k.fach, () => { mappeAuf = null; renderKurse(); }),
    el('h2', { class: 'ks-titel' }, 'Arbeiten · ' + k.name + ' · ' + k.fach),
    el('section', { class: 'panel ks-panel' },
      ...(st.arbeiten.length ? st.arbeiten.map(zeile) : [el('p', { class: 'u-leise' }, 'Noch keine Arbeit. Klassenarbeit, Klausur oder Test anlegen — das Quartal folgt aus dem Datum.')]),
      el('div', { class: 'btn-reihe mp-neu' }, el('button', { type: 'button', class: 'btn', dataset: { mpNeu: '' }, onclick: () => arbeitDialog(k, null) }, iconEl('plus'), ' Arbeit oder Test anlegen'))),
    el('p', { class: 'u-hinweis' }, 'Gerechnet wird wie in der Excel-Mappe v15.2: ' + (istOb(k) ? 'Punkte 0–15 nach der NRW-Tabelle.' : 'ganze Noten, Grenzen aus „4 ab“ und „5 ab“.') + ' Nie im Beamer.')));
}

// ── Arbeit anlegen / bearbeiten ──
function arbeitDialog(k, a) {
  const st = mappenStand(vault.events, k.id), profil = istOb(k) ? 'sek2' : 'sek1';
  const w = a ? JSON.parse(JSON.stringify(a)) : { arbeitId: null, art: 'arbeit', titel: '', am: heuteIso(), aufgaben: [{ id: neueId(), name: 'A1', max: '' }],
    schluessel: schluesselVorlage(st.arbeiten, profil), gewicht: 1 };
  const fehler = el('p', { class: 'u-warn13 mp-fehlertext', role: 'alert' });
  const quartal = el('small', { class: 'u-leise' });
  const zeigeQuartal = () => { const q = quartalVon(w.am, aktivesSchuljahr()); quartal.textContent = q ? '→ ' + QLABEL[q] : '→ liegt in keinem Quartal (Kurse → Quartale…)'; };
  const art = el('div', { class: 'seg' });
  const zeichneArt = () => art.replaceChildren(...[['arbeit', istOb(k) ? 'Klausur' : 'Klassenarbeit'], ['test', 'Test']].map(([v, t]) =>
    el('button', { type: 'button', class: 'btn' + (w.art === v ? '' : ' still'), 'aria-pressed': String(w.art === v), dataset: { mpArt: v }, onclick: () => { w.art = v; zeichneArt(); } }, t)));
  zeichneArt();
  const titel = el('input', { type: 'text', id: 'mp-titel', value: w.titel, placeholder: 'z. B. KA 1 · Lineare Funktionen', class: 'mp-titel', 'aria-label': 'Titel', oninput: e => { w.titel = e.target.value; } });
  const datum = el('input', { type: 'date', id: 'mp-datum', value: w.am, 'aria-label': 'Datum', oninput: e => { w.am = e.target.value; zeigeQuartal(); } });
  zeigeQuartal();
  const liste = el('div', { class: 'mp-aufgaben' });
  const zeichneAufgaben = () => {
    liste.replaceChildren(...w.aufgaben.map((x, i) => el('div', { class: 'mp-aufgabe' },
      el('input', { type: 'text', value: x.name, 'aria-label': 'Aufgabe ' + (i + 1), class: 'mp-aname', dataset: { mpAname: String(i) }, oninput: e => { x.name = e.target.value; } }),
      el('input', { type: 'text', inputmode: 'decimal', value: x.max === '' ? '' : zahlText(x.max), placeholder: 'max', 'aria-label': 'Höchstpunkte Aufgabe ' + (i + 1), class: 'mp-amax', dataset: { mpAmax: String(i) },
        oninput: e => { x.max = e.target.value; } }),
      el('button', { type: 'button', class: 'btn still u-btn-klein', 'aria-label': 'Aufgabe ' + (i + 1) + ' entfernen', disabled: w.aufgaben.length < 2 ? '' : null,
        onclick: () => {
          // Aufgabe mit Punkten nicht ohne Rückfrage entfernen (Prüfer 21.10.): die Punkte verschwinden aus Summe und Note
          const pk = w.arbeitId && st.punkte.get(w.arbeitId), mit = pk ? [...pk.values()].filter(m => m.get(x.id) != null).length : 0;
          if (mit && !confirm((x.name || 'Aufgabe ' + (i + 1)) + ': ' + mit + (mit === 1 ? ' Kind hat' : ' Kinder haben') + ' hier schon Punkte. Entfernen? Sie zählen dann nicht mehr.')) return;
          w.aufgaben.splice(i, 1); zeichneAufgaben(); } }, iconEl('schliessen')))));
    plus.disabled = w.aufgaben.length >= MAX_AUFGABEN;
  };
  const plus = el('button', { type: 'button', class: 'btn still', dataset: { mpAufgabePlus: '' }, onclick: () => { w.aufgaben.push({ id: neueId(), name: 'A' + (w.aufgaben.length + 1), max: '' }); zeichneAufgaben(); liste.querySelector('.mp-aufgabe:last-child .mp-amax')?.focus(); } }, iconEl('plus'), ' Aufgabe');
  zeichneAufgaben();
  // Schlüssel: Sek I zwei Felder („4 ab“, „5 ab“ in %), Oberstufe die Tabelle (aufklappbar, Vorbelegung NRW)
  const pf = v => zahlText(excelRunde(v * 100, 4));
  let schluesselEl;
  if (w.schluessel.art === 'ob') {
    const zellen = w.schluessel.ab.map((v, i) => el('label', { class: 'mp-ob-stufe' }, el('span', {}, i + ' P (' + OB_LABEL[i] + ')'),
      el('input', { type: 'text', inputmode: 'decimal', value: pf(v), disabled: i === 0 ? '' : null, dataset: { mpOb: String(i) }, 'aria-label': i + ' Punkte ab Prozent',
        oninput: e => { w.schluessel.ab[i] = prozentWert(e.target.value); } })));
    schluesselEl = el('details', { class: 'mp-schluessel' }, el('summary', {}, 'Notenschlüssel: NRW-Tabelle (5 P ab ' + pf(w.schluessel.ab[5]) + ' %) — ändern'), el('div', { class: 'mp-ob-gitter' }, ...zellen));
  } else {
    const feld = (schl, label) => el('label', { class: 'mp-sek1' }, el('span', {}, label),
      el('input', { type: 'text', inputmode: 'decimal', value: pf(w.schluessel[schl]), class: 'u-w72', dataset: { mpSchluessel: schl }, 'aria-label': label + ' Prozent',
        oninput: e => { w.schluessel[schl] = prozentWert(e.target.value); zeigeGrenzen(); } }), ' %');
    const grenzen = el('small', { class: 'u-leise' });
    const zeigeGrenzen = () => { const f = schluesselFehler(w.schluessel); grenzen.textContent = f || ('Note 1 ab ' + sek1Gitter(w.schluessel).grenzen.slice(0, 5).map((g, i) => (i ? (i + 1) + ' ab ' : '') + pf(g) + ' %').join(' · ')); };
    schluesselEl = el('div', { class: 'mp-schluessel' }, el('span', {}, 'Notenschlüssel'), feld('vier', '4 ab'), feld('fuenf', '5 ab'), grenzen);
    zeigeGrenzen();
  }
  const speichernKnopf = el('button', { type: 'button', class: 'btn', id: 'mp-speichern', onclick: () => {
    const r = pruefeArbeit(w, st, k);
    if (r.fehler) { fehler.textContent = r.fehler; return; }
    const felder = { arbeitId: w.arbeitId || crypto.randomUUID(), art: w.art, titel: w.titel.trim() || (w.art === 'test' ? 'Test' : 'Arbeit'), am: w.am, aufgaben: r.aufgaben,
      schluessel: w.schluessel, gewicht: w.gewicht ?? 1 };
    // Speichern ohne Änderung bucht nichts (Prüfer 21.10. 🟢 17: sonst Scheinkonflikt mit dem anderen Gerät) — außer zum Auflösen eines Konflikts
    const inhalt = f => JSON.stringify([f.art, f.titel, f.am, f.aufgaben, f.schluessel, f.gewicht ?? 1]);
    if (a && !a.konflikt && inhalt(felder) === inhalt(a)) { dlgZu(); return; }
    if (w.arbeitId) felder.ersetzt = st.kopf('arbeit', w.arbeitId);
    if (!buche('arbeit', k, felder)) return;
    dlgZu(); toast((a ? 'Gespeichert: ' : 'Angelegt: ') + felder.titel);
    mappeAuf = { kursId: k.id, arbeitId: felder.arbeitId }; mitUebergang(renderKurse);
  } }, a ? 'Speichern' : 'Anlegen');
  const loeschen = a ? el('button', { type: 'button', class: 'btn gefahr', dataset: { mpLoeschen: '' }, onclick: () => {
    if (!confirm('„' + (a.titel || 'Arbeit') + '“ löschen? Die Punkte verschwinden aus der Mappe.')) return;
    if (!buche('arbeit', k, { arbeitId: a.arbeitId, art: a.art, titel: a.titel, am: a.am, aufgaben: a.aufgaben, schluessel: a.schluessel, gewicht: a.gewicht,
      geloescht: true, ersetzt: st.kopf('arbeit', a.arbeitId) })) return;
    dlgZu(); mappeAuf = { kursId: k.id, arbeitId: null }; toast('Gelöscht: ' + (a.titel || 'Arbeit')); mitUebergang(renderKurse);
  } }, 'Löschen') : null;
  dlgZeigenEl(el('h3', {}, a ? 'Arbeit bearbeiten' : 'Arbeit oder Test anlegen'),
    art, el('div', { class: 'zeile' }, el('span', {}, 'Titel'), titel),
    el('div', { class: 'zeile' }, el('span', {}, 'Datum'), el('span', {}, datum, ' ', quartal)),
    el('h4', {}, 'Aufgaben und Höchstpunkte'), liste, el('div', { class: 'btn-reihe' }, plus),
    schluesselEl, fehler,
    el('div', { class: 'btn-reihe' }, speichernKnopf, el('button', { type: 'button', class: 'btn still', onclick: dlgZu }, 'Abbrechen'), loeschen));
  if (!a) setTimeout(() => titel.focus(), 60);
}
const neueId = () => 'x' + crypto.randomUUID().slice(0, 8);
const prozentWert = t => { const v = Number(String(t).trim().replace(',', '.')); return Number.isFinite(v) ? excelRunde(v / 100, 6) : NaN; };
// Höchstpunkte lesen; eine Aufgabe unter ihren schon eingetragenen Punkten wird nicht still gekürzt (D1·10)
function pruefeArbeit(w, st, k) {
  if (!w.am) return { fehler: 'Bitte ein Datum wählen.' };
  if (!w.aufgaben.length) return { fehler: 'Mindestens eine Aufgabe.' };
  const aufgaben = [];
  for (const [i, x] of w.aufgaben.entries()) {
    const m = lesePunkte(String(x.max), 999);
    if (!m.ok || m.wert == null || m.wert <= 0) return { fehler: 'Aufgabe ' + (i + 1) + ': Höchstpunkte fehlen oder sind keine Zahl über 0.' };
    aufgaben.push({ id: x.id, name: String(x.name || '').trim() || 'A' + (i + 1), max: m.wert });
  }
  const sf = schluesselFehler(w.schluessel); if (sf) return { fehler: sf };
  const pk = w.arbeitId && st.punkte.get(w.arbeitId);
  if (pk) for (const x of aufgaben) for (const [, proKind] of pk) { const v = proKind.get(x.id); if (v != null && v > x.max) return { fehler: x.name + ': schon ' + zahlText(v) + ' Punkte eingetragen — höher als ' + zahlText(x.max) + '.' }; }
  return { aufgaben };
}

// ── Punkte-Raster einer Arbeit ──
function renderArbeit(wrap, k, a, st0) {
  const ob = a.schluessel && a.schluessel.art === 'ob';
  const kinder = kinderVon(k, st0.punkte.get(a.arbeitId));
  const zeilen = new Map();   // sid → { summe, quote, note, lob }-Zellen
  // Sichtbare Leiste statt nur Tooltip (am iPad gibt es keinen): Konflikte zweier Geräte und Werte über den Höchstpunkten (Prüfer 21.10.)
  const hinweisLeiste = el('div', { class: 'mp-hinweise', role: 'status', dataset: { mpHinweise: '' } });
  const fuss = { schnitt: [], spiegel: el('div', { class: 'mp-spiegel', 'aria-label': 'Notenspiegel' }), text: el('div', { class: 'mp-spiegel-text' }) };
  const stand = () => mappenStand(vault.events, k.id);
  const werte = st => werteArbeitAus(a, kinder.map(s => ({ sid: s.sid, lb: s.lb })), st.punkte.get(a.arbeitId));
  const kopf = el('tr', {}, el('th', { class: 'nr' }, 'Nr'), el('th', { class: 'l mp-kind' }, 'Kind'), ...a.aufgaben.map(x => el('th', {}, x.name)),
    el('th', { class: 'ab' }, 'Ges.'), el('th', {}, '%'), el('th', {}, ob ? 'Punkte' : 'Note'), el('th', { class: 'mp-lobkopf' }, 'Lob'));
  const maxZeile = el('tr', { class: 'max' }, el('th', {}), el('th', { class: 'l mp-kind' }, 'max. Punkte'), ...a.aufgaben.map(x => el('th', {}, zahlText(x.max))),
    el('th', { class: 'ab' }, ''), el('th', {}), el('th', {}), el('th', {}));
  const body = el('tbody', {});
  for (const s of kinder) {
    const z = { summe: el('td', { class: 'ab' }), quote: el('td', {}), note: el('td', { class: 'note' }), lob: el('button', { type: 'button', class: 'btn still u-btn-klein mp-lob', dataset: { mpLob: s.sid }, 'aria-label': 'Lob für ' + s.vorname }, iconEl('notiz')) };
    zeilen.set(s.sid, z);
    z.lob.onclick = () => lobDialog(k, a, s);
    const zellen = a.aufgaben.map(x => {
      const inp = el('input', { type: 'text', inputmode: 'decimal', enterkeyhint: 'next', autocomplete: 'off', class: 'mp-ein', dataset: { mpSid: s.sid, mpAufgabe: x.id },
        'aria-label': s.vorname + ' ' + s.name + ' · ' + x.name + ' (max ' + zahlText(x.max) + ')' });
      inp.addEventListener('change', () => trageEin(inp, s, x));
      // Enter in einer Konflikt-Zelle bestätigt auch den gezeigten Wert (ohne Änderung feuert kein change — P48 K1c, 21.10.)
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (inp.classList.contains('mp-konflikt')) trageEin(inp, s, x); naechstes(inp); } });
      return el('td', { class: 'ein' }, inp);
    });
    body.append(el('tr', { class: s.lb && !ob ? 'lb' : '', dataset: { mpZeile: s.sid } }, el('td', { class: 'nr' }, String(lnr(s) ?? '')),
      el('td', { class: 'l mp-kind' }, s.vorname + ' ' + s.name, s.lb ? el('span', { class: 'lb-badge' }, 'LB') : null),
      ...zellen, z.summe, z.quote, z.note, el('td', {}, z.lob)));
  }
  const schnittZeile = el('tr', { class: 'mp-schnitt' }, el('td', {}), el('td', { class: 'l mp-kind' }, 'Ø'), ...a.aufgaben.map(() => { const td = el('td', {}); fuss.schnitt.push(td); return td; }),
    el('td', { class: 'ab' }), el('td', {}), el('td', {}), el('td', {}));
  const naechstes = inp => { const alle = [...body.querySelectorAll('.mp-ein')], i = alle.indexOf(inp); inp.blur(); (alle[i + 1] || inp).focus(); };
  // Eintragen: nur bei geänderter Zahl ein Ereignis; ungültig = rot und Meldung, nichts gespeichert (nie still gekürzt)
  function trageEin(inp, s, x) {
    const r = lesePunkte(inp.value, x.max), st = stand();
    if (!r.ok) { inp.classList.add('mp-fehler'); toast(s.vorname + ' · ' + x.name + ': ' + r.fehler + ' — nicht gespeichert', 4000); return; }
    inp.classList.remove('mp-fehler');
    const alt = st.punkte.get(a.arbeitId)?.get(s.sid)?.get(x.id) ?? null;
    const konflikt = st.konflikte.some(c => c.art === 'punkte' && c.arbeitId === a.arbeitId && c.sid === s.sid && c.aufgabeId === x.id);
    if (alt === r.wert && !konflikt) { inp.value = r.wert == null ? '' : zahlText(r.wert); return; }
    if (!buche('punkte', k, { arbeitId: a.arbeitId, sid: s.sid, aufgabeId: x.id, wert: r.wert, ersetzt: st.kopf('punkte', a.arbeitId, s.sid, x.id) })) return;
    inp.value = r.wert == null ? '' : zahlText(r.wert);
    zeichneWerte();
  }
  function zeichneWerte() {
    const st = stand(), e = werte(st), pk = st.punkte.get(a.arbeitId), hinweise = [];
    for (const [i, s] of kinder.entries()) {
      const z = zeilen.get(s.sid), r = e.zeilen[i];
      z.summe.textContent = komma(r.summe); z.quote.textContent = prozent(r.quote);
      z.note.textContent = r.note == null ? '' : ob ? r.note + ' (' + r.label + ')' : String(r.note);
      z.note.classList.toggle('w', typeof r.note === 'number' && (ob ? r.note < 5 : r.note >= 5));
      const lob = st.lob.get(a.arbeitId)?.get(s.sid); z.lob.classList.toggle('an', !!lob); z.lob.title = lob || 'Lob / Hinweis';
      for (const inp of body.querySelectorAll(`.mp-ein[data-mp-sid="${s.sid}"]`)) {
        const x = a.aufgaben.find(y => y.id === inp.dataset.mpAufgabe);
        const c = st.konflikte.find(c => c.art === 'punkte' && c.arbeitId === a.arbeitId && c.sid === s.sid && c.aufgabeId === inp.dataset.mpAufgabe);
        inp.classList.toggle('mp-konflikt', !!c);
        inp.title = c ? 'Auf zwei Geräten verschieden: ' + c.werte.map(v => (v == null ? 'leer' : zahlText(v))).join(' / ') + ' — gültigen Wert eintragen' : '';
        const v = pk?.get(s.sid)?.get(inp.dataset.mpAufgabe);
        if (c) hinweise.push(s.vorname + ' · ' + x.name + ': ' + c.werte.map(w => (w == null ? 'leer' : zahlText(w))).join(' / ') + ' (zwei Geräte) — gültigen Wert tippen, Enter');
        // über den Höchstpunkten (das andere Gerät hat sie gesenkt): rot und genannt, nie still eine Quote über 100 % (Prüfer 21.10.)
        if (v != null && v > x.max) hinweise.push(s.vorname + ' · ' + x.name + ': ' + zahlText(v) + ' über max ' + zahlText(x.max));
        inp.classList.toggle('mp-ueber', v != null && v > x.max);
        if (document.activeElement === inp || inp.classList.contains('mp-fehler')) continue;
        inp.value = v == null ? '' : zahlText(v);
      }
      const lk = st.konflikte.find(c => c.art === 'lob' && c.arbeitId === a.arbeitId && c.sid === s.sid);
      if (lk) hinweise.push(s.vorname + ' · Lob: zwei Fassungen (zwei Geräte) — über ✎ eine wählen');
    }
    hinweisLeiste.replaceChildren(...(hinweise.length ? [el('b', {}, '⚠ Bitte prüfen'), ...hinweise.map(h => el('div', {}, h))] : []));
    hinweisLeiste.hidden = !hinweise.length;
    e.aufgabenSchnitt.forEach((m, j) => { fuss.schnitt[j].textContent = komma(m); });
    const labels = ob ? Array.from({ length: 16 }, (_, i) => String(15 - i)) : ['1', '2', '3', '4', '5', '6'];
    const hoechst = Math.max(1, ...e.spiegel);
    fuss.spiegel.replaceChildren(...e.spiegel.map((c, i) => { const bar = el('i', {}); bar.style.setProperty('--h', String(c / hoechst));
      return el('span', { class: 'mp-saeule' }, el('em', {}, String(c)), bar, labels[i]); }));
    const n = e.zeilen.filter(z => typeof z.note === 'number').length;
    fuss.text.replaceChildren(el('b', {}, e.schnitt == null ? 'Ø –' : 'Ø ' + komma(e.schnitt)), ' · ' + n + (ob ? ' Bewertungen · ' + e.defizite + ' unter 5 P' : ' Noten (LB zählt nicht)'),
      el('br'), el('span', { class: 'u-leise' }, e.abPunkten ? (ob ? 'Note 1 ab ' : 'Note 1 ab ') + e.abPunkten.slice(0, 5).map((p, i) => (i ? (i + 1) + ' ab ' : '') + zahlText(p)).join(' · ') + ' Punkten' : ''));
  }
  const q = quartalVon(a.am, aktivesSchuljahr());
  wrap.replaceChildren(el('div', { class: 'ks mp mp-weit' },
    el('div', { class: 'mp-kopf' }, zurueck('‹ Arbeiten', () => { mappeAuf = { kursId: k.id, arbeitId: null }; renderKurse(); }), el('span', { class: 'spacer' }),
      el('button', { type: 'button', class: 'btn still', dataset: { mpBearbeiten: a.arbeitId }, onclick: () => arbeitDialog(k, a) }, 'Aufgaben bearbeiten')),
    el('h2', { class: 'ks-titel' }, (a.art === 'test' ? 'Test · ' : '') + (a.titel || 'Arbeit')),
    el('p', { class: 'u-hinweis ks-unter' }, k.name + ' · ' + k.fach + ' · ' + datumKurz(a.am) + (q ? ' · ' + QLABEL[q] : ' · kein Quartal')),
    hinweisLeiste,
    el('section', { class: 'panel ks-panel mp-scroll' }, el('table', { class: 'mp-tab' }, el('thead', {}, kopf, maxZeile), body, el('tfoot', {}, schnittZeile)),
      el('p', { class: 'u-hinweis' }, 'Kind für Kind: Zahl tippen, Enter → nächste Aufgabe, am Zeilenende → nächstes Kind. Leer = nicht eingetragen; 0 ist ein Eintrag.')),
    el('section', { class: 'panel ks-panel' }, el('h2', {}, 'Notenspiegel'), el('div', { class: 'mp-fuss' }, fuss.spiegel, fuss.text))));
  zeichneWerte();
}

function lobDialog(k, a, s) {
  const st = mappenStand(vault.events, k.id), alt = st.lob.get(a.arbeitId)?.get(s.sid) || '';
  const ta = el('textarea', { rows: '4', class: 'u-textarea u-fs16', id: 'mp-lobtext', 'aria-label': 'Lob oder Hinweis', placeholder: 'z. B. Sehr sorgfältig gerechnet.' });
  ta.value = alt;
  dlgZeigenEl(el('h3', {}, 'Lob / Hinweis · ' + s.vorname),
    el('p', { class: 'u-hinweis' }, (a.titel || 'Arbeit') + ' — steht später auf dem Rückmeldebogen. Leer lassen = frei für Handschrift.'), ta,
    el('div', { class: 'btn-reihe' }, el('button', { type: 'button', class: 'btn', id: 'mp-lob-ok', onclick: () => {
      const text = ta.value.trim();
      if (text !== alt && !buche('lob', k, { arbeitId: a.arbeitId, sid: s.sid, text, ersetzt: st.kopf('lob', a.arbeitId, s.sid) })) return;
      dlgZu(); renderKurse(); } }, 'Speichern'), el('button', { type: 'button', class: 'btn still', onclick: dlgZu }, 'Abbrechen')));
  setTimeout(() => ta.focus(), 60);
}

export { mappeAuf, setzeMappe, schliesseMappe, mappeLeeren, mappePanel, renderMappe };
