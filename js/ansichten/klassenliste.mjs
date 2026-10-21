// Kladde · js/ansichten/klassenliste.mjs — Scheibe E „Klassenliste“ (Zero 20.10.: neue Klasse in der App anlegen, Kinder eingeben,
// alphabetisch und frei; Wahl B „Eingabezeile + Liste“, design/e_klasse_2026-10-20/WAHL.md). Drei Bausteine für drei Türen:
// Kurs anlegen (E1), Kinder ergänzen (E2), Reihenfolge ändern (E3). Die reine Logik steht in logic/klassenliste.mjs.
// Fokus-Lehre (Stundenplan v1.3.0): die Eingabezeile wird einmal gebaut und nie neu gezeichnet — neu gezeichnet wird nur die Liste,
// darum bleibt die Tastatur am iPad offen. Ränder der Pfeile tragen aria-disabled statt disabled (Safari 26: ein fokussierter Knopf,
// der disabled wird, wirft den Fokus an den Seitenanfang).
import { teileName } from '../../logic/klassenliste.mjs?v=3.0.0';
import { el, toast } from '../kern/dom.mjs?v=3.0.0';
import { iconEl } from '../kern/icons.mjs?v=3.0.0';

// Schalter Alphabetisch | Eigene Reihenfolge — dasselbe Segment wie „Stufe“ im Blatt (aktiv = btn, sonst btn still). Die Knöpfe werden
// einmal gebaut, umgeschaltet werden nur Klasse und aria-pressed: sonst fiel der Fokus nach der Wahl auf <body> (Prüfer 20.10. 🟢 1)
function reihenfolgeSchalter(modus, beiWahl) {
  let jetzt = modus;
  // kurz beschriftet (Zero 20.10. abends: „wenn man es geschickt abkürzt“), der volle Name steht im Label
  const knoepfe = [['alpha', ['A–Z'], 'Alphabetisch'], ['eigen', [iconEl('ziehen'), 'Eigene'], 'Eigene Reihenfolge']].map(([v, inhalt, lang]) =>
    el('button', { type: 'button', class: 'btn', 'aria-label': lang, title: lang, dataset: { keModus: v }, onclick: () => { if (jetzt !== v) { setze(v); beiWahl(v); } } }, ...inhalt));
  const setze = m => { jetzt = m; for (const k of knoepfe) { const an = k.dataset.keModus === m; k.classList.toggle('still', !an); k.setAttribute('aria-pressed', String(an)); } };
  const box = el('div', { class: 'seg kn-seg ke-seg', role: 'group', 'aria-label': 'Reihenfolge' }, ...knoepfe);
  setze(modus);
  box.setze = setze;
  return box;
}

// Eingabezeile: Vorname ⏎ → Nachname ⏎ → übernehmen, Felder leeren, zurück zum Vornamen. ⏎ im Vornamen geht immer in den Nachnamen
// (Prüfer 20.10. 🔴 2: vorher teilte schon dieses ⏎ — „Anna Lena“ wurde Vorname „Anna“, Nachname „Lena“). Bleibt der Nachname leer und
// steht im Vornamen „Elif Yilmaz“, teilt das ⏎ dort. beiNeu({vorname,name,lb,gruppe}) → true = übernommen. beiListe(text): eingefügter
// Text mit Zeilen oder Tabs (eine ganze Liste) — ohne beiListe sagt eine Meldung, wo Listen hingehören (sonst wurde alles EIN Kind).
const NAMENSFELD = { type: 'text', autocomplete: 'off', autocapitalize: 'words', autocorrect: 'off', spellcheck: 'false' };   // iOS korrigiert sonst „Yilmaz“ beim ⏎ (Prüfer 🟡 9)
function eingabeZeile({ beiNeu, beiListe, gruppen = [], ids = {} }) {
  const vor = el('input', { ...NAMENSFELD, placeholder: 'Vorname', 'aria-label': 'Vorname', enterkeyhint: 'next', ...(ids.vor ? { id: ids.vor } : {}) });
  const nach = el('input', { ...NAMENSFELD, placeholder: 'Nachname', 'aria-label': 'Nachname', enterkeyhint: 'done', ...(ids.nach ? { id: ids.nach } : {}) });
  for (const f of [vor, nach]) f.addEventListener('paste', e => {
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (!/[\n\t]/.test(text.trim())) return;
    e.preventDefault();
    if (beiListe) beiListe(text); else toast('Das ist eine ganze Liste — bitte über „Kurs anlegen“ mit demselben Kurs oder „Excel-Mappe laden“ einfügen, dort wird abgeglichen', 7000);
  });
  let lb = false;
  const lbB = el('button', { type: 'button', class: 'ke-lb', 'aria-pressed': 'false', title: 'LB (zieldifferent)', dataset: { keLb: '' },
    onclick: () => { lb = !lb; lbB.classList.toggle('an', lb); lbB.setAttribute('aria-pressed', String(lb)); } }, 'LB');
  const gr = gruppen.length ? el('select', { dataset: { ksGruppe: '' }, 'aria-label': 'Halbgruppe' }, el('option', { value: '' }, 'ohne'), ...gruppen.map(g => el('option', { value: g }, g))) : null;
  const plus = el('button', { type: 'button', class: 'btn ke-plus', 'aria-label': 'Hinzufügen', title: 'Hinzufügen', dataset: { ksHinzu: '' }, ...(ids.plus ? { id: ids.plus } : {}) }, iconEl('plus'));
  const uebernimm = () => {
    let vorname = vor.value.trim(), name = nach.value.trim();
    if (!name && /\s/.test(vorname)) ({ vorname, name } = teileName(vorname));
    if (!vorname && !name) { toast('Name fehlt'); vor.focus(); return; }
    if (beiNeu({ vorname, name, lb, gruppe: gr && gr.value ? gr.value : undefined })) {
      vor.value = ''; nach.value = ''; if (lb) lbB.click();
      vor.focus();   // Fokus bleibt im Feld: die Tastatur klappt nicht zu
    }
  };
  vor.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); nach.focus(); } });
  nach.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); uebernimm(); } });
  plus.onclick = uebernimm;
  const box = el('div', { class: 'ke-eingabe' }, vor, nach, lbB, gr, plus);
  box.fokus = () => vor.focus();
  return box;
}

// Kinderliste. zeige(kinder, opt): kinder = sichtbare Reihenfolge. opt.ordnen → Griff ≡ und ↑↓ (opt.beiVerschiebe(von, nach)),
// opt.bearbeite → ✎ öffnet die Zeile zum Ändern/Entfernen (opt.beiAendern(i, {vorname,name,lb}), opt.beiEntfernen(i)), auch neben ↑↓
// (Prüfer 20.10. 🟡 2: im Modus „eigen“ fehlte ✎, der Umweg über „Alphabetisch“ zerstörte die Folge); opt.nachBearbeiten() danach,
// opt.neu(i) → Marke „neu“. Der Container wird ersetzt, nie die Eingabezeile.
function kinderListe() {
  const box = el('div', { class: 'ke-liste', role: 'list' });
  let stand = { kinder: [], opt: {} };
  const name = k => (k.vorname ? k.vorname + ' ' : '') + (k.name || '');
  const fokusNach = (i, wo) => {
    const z = box.children[i]; if (!z) return;
    const b = z.querySelector(`[data-ke-${wo}]`), anders = z.querySelector(`[data-ke-${wo === 'hoch' ? 'runter' : 'hoch'}]`);
    (b && b.getAttribute('aria-disabled') !== 'true' ? b : anders || b)?.focus();
  };
  let zug = false;   // ein Zug zur Zeit: ein zweiter Finger auf einem anderen Griff startet keinen zweiten (Prüfer 🟢 6)
  const zieheAn = (griff, zeile) => {
    griff.addEventListener('pointerdown', e => {
      if (zug || (e.button !== undefined && e.button > 0)) return;
      e.preventDefault(); zug = true;
      const id = e.pointerId, von = [...box.children].indexOf(zeile), scroller = box.closest('.dlg-inhalt');
      let basis = e.clientY, y = e.clientY, lauf = 0;
      const scroll0 = scroller ? scroller.scrollTop : 0;
      try { griff.setPointerCapture(id); } catch {}
      zeile.classList.add('zieht');
      // Umgehängt wird immer nur der NACHBAR: wer die gezogene Zeile selbst umhängt, verliert das Pointer-Capture (Probe P2b, 20.10.:
      // die Zeile kam nur einen Platz weit). Zugehört wird am Fenster, damit kein Ende verloren geht — aber nur dem Finger des Starts
      // (Prüfer 20.10. 🟡 3). Scrollt der Dialog, gleicht der Versatz das aus: die Zeile bleibt unter dem Finger (🟡 4, vorher −334 px).
      const lage = () => `translateY(${y - basis + (scroller ? scroller.scrollTop - scroll0 : 0)}px)`;
      const ordne = () => {
        zeile.style.transform = lage();
        const vor = zeile.previousElementSibling, nach = zeile.nextElementSibling, r = zeile.getBoundingClientRect();
        if (nach && r.top + r.height / 2 > nach.getBoundingClientRect().top + nach.offsetHeight / 2) { box.insertBefore(nach, zeile); basis += nach.offsetHeight; }
        else if (vor && r.top + r.height / 2 < vor.getBoundingClientRect().top + vor.offsetHeight / 2) { box.insertBefore(vor, zeile.nextSibling); basis -= vor.offsetHeight; }
        zeile.style.transform = lage();
      };
      // Am Rand scrollt der Dialog weiter, solange der Finger dort steht — auch ohne Bewegung
      const kante = () => {
        lauf = 0; if (!scroller) return;
        const s = scroller.getBoundingClientRect(), dy = y < s.top + 40 ? -8 : y > s.bottom - 40 ? 8 : 0, alt = scroller.scrollTop;
        if (!dy) return;
        scroller.scrollTop += dy; if (scroller.scrollTop === alt) return;
        ordne(); lauf = requestAnimationFrame(kante);
      };
      const bewege = ev => { if (ev.pointerId !== id) return; y = ev.clientY; ordne(); if (!lauf) kante(); };
      const ende = ev => {
        if (ev.pointerId !== id) return;   // fremder Finger
        removeEventListener('pointermove', bewege); removeEventListener('pointerup', ende); removeEventListener('pointercancel', ende);
        if (lauf) cancelAnimationFrame(lauf);
        zug = false; zeile.style.transform = ''; zeile.classList.remove('zieht');
        const nach = [...box.children].indexOf(zeile);
        // Abbruch (Systemgeste, Mitteilung, Handballen) übernimmt nichts: die Liste kehrt zurück (Prüfer 🟡 3)
        if (ev.type === 'pointerup' && nach !== von) stand.opt.beiVerschiebe(von, nach); else zeige(stand.kinder, stand.opt);
      };
      addEventListener('pointermove', bewege); addEventListener('pointerup', ende); addEventListener('pointercancel', ende);
    });
  };
  const bearbeitZeile = (i, k) => {
    const vor = el('input', { ...NAMENSFELD, value: k.vorname || '', placeholder: 'Vorname', 'aria-label': 'Vorname' });
    const nach = el('input', { ...NAMENSFELD, value: k.name || '', placeholder: 'Nachname', 'aria-label': 'Nachname' });
    let lb = !!k.lb;
    const lbB = el('button', { type: 'button', class: 'ke-lb' + (lb ? ' an' : ''), 'aria-pressed': String(lb), title: 'LB (zieldifferent)',
      onclick: () => { lb = !lb; lbB.classList.toggle('an', lb); lbB.setAttribute('aria-pressed', String(lb)); } }, 'LB');
    const ok = () => { const vorname = vor.value.trim(), n = nach.value.trim(); if (!vorname && !n) { toast('Name fehlt'); return; } const o = stand.opt; o.beiAendern(i, { vorname, name: n, lb }); o.nachBearbeiten?.(); };
    for (const f of [vor, nach]) f.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ok(); } });
    const z = el('div', { class: 'ke-zeile bearbeiten', role: 'listitem', dataset: { i: String(i) } }, el('span', { class: 'ke-nr' }, String(i + 1)), vor, nach,
      el('span', { class: 'ke-steuer' }, lbB,
        el('button', { type: 'button', class: 'ke-stift', 'aria-label': 'Übernehmen', dataset: { keOk: '' }, onclick: ok }, '✓'),
        el('button', { type: 'button', class: 'ke-stift gefahr', 'aria-label': 'Entfernen · ' + name(k), dataset: { keWeg: '' }, onclick: () => { const o = stand.opt; o.beiEntfernen(i); o.nachBearbeiten?.(); } }, '✕')));
    box.children[i].replaceWith(z); vor.focus();
  };
  function zeige(kinder, opt = {}) {
    stand = { kinder, opt };
    const n = kinder.length;
    box.replaceChildren(...kinder.map((k, i) => {
      const z = el('div', { class: 'ke-zeile' + (opt.neu && opt.neu(i) ? ' neu' : ''), role: 'listitem', dataset: { i: String(i) } });
      // Griff und Nummer in einer Zelle, der Name tippbar statt ✎ (Zero 20.10. abends: links vom Namen war zu viel Platz, am Handy
      // kürzte ✎ neben ↑↓ den Namen auf „Abdurrahm…“)
      const nr = el('span', { class: 'ke-nr' }, String(opt.nummer ? opt.nummer(i) : i + 1));
      if (opt.ordnen) { const g = el('span', { class: 'ke-griff', title: 'Ziehen' }, iconEl('griff'), nr); zieheAn(g, z); z.append(g); } else z.append(nr);
      const inhalt = [name(k), k.lb ? el('small', {}, 'LB') : null];
      z.append(opt.bearbeite ? el('button', { type: 'button', class: 'ke-name', 'aria-label': 'Bearbeiten · ' + name(k), title: 'Antippen zum Ändern', dataset: { keStift: '' }, onclick: () => bearbeitZeile(i, k) }, ...inhalt)
        : el('span', { class: 'ke-name' }, ...inhalt));
      if (opt.ordnen) z.append(
        el('button', { type: 'button', class: 'ke-pfeil', 'aria-label': 'nach oben · ' + name(k), dataset: { keHoch: '' }, ...(i === 0 ? { 'aria-disabled': 'true' } : {}),
          onclick: () => { if (i > 0) { opt.beiVerschiebe(i, i - 1); fokusNach(i - 1, 'hoch'); } } }, '↑'),
        el('button', { type: 'button', class: 'ke-pfeil', 'aria-label': 'nach unten · ' + name(k), dataset: { keRunter: '' }, ...(i === n - 1 ? { 'aria-disabled': 'true' } : {}),
          onclick: () => { if (i < n - 1) { opt.beiVerschiebe(i, i + 1); fokusNach(i + 1, 'runter'); } } }, '↓'));
      return z;
    }));
  }
  return { el: box, zeige };
}

export { reihenfolgeSchalter, eingabeZeile, kinderListe };
