// Kladde · js/kern/dom.mjs — sichere DOM-Erzeugung, Escape, Toast, Werkzeug-Knopf (A2 Schnitt 2: wörtlich aus js/app.mjs, verhaltensneutral; der Kern kennt keine Ansicht)
import { iconEl } from './icons.mjs?v=2.3.1.1792523037';

const $=id=>document.getElementById(id);

/* ═══ SICHERE DOM-ERZEUGUNG (P1.7 · Migrationsregel: neue Views nutzen el(), Bestand esc()) ═══ */
// el('div', {class:'zeile', onclick:fn}, 'Text', kindEl, …) — Kinder IMMER via textContent/append,
// nie HTML-Parsing: Schülernamen/Notizen können strukturell kein Markup einschleusen.
function el(tag, props, ...kinder){
  const e=document.createElement(tag);
  for(const [k,v] of Object.entries(props||{})){
    if(k==='class') e.className=v;
    else if(k==='dataset') Object.assign(e.dataset,v);
    else if(k.startsWith('on')&&typeof v==='function') e[k]=v;
    else if(v!==undefined&&v!==null) e.setAttribute(k,v);
  }
  for(const kind of kinder){
    if(kind===null||kind===undefined) continue;
    e.append(kind.nodeType?kind:document.createTextNode(String(kind)));
  }
  return e;
}

function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function toast(text,ms=2600){ const t=$('toast'); t.textContent=text; t.classList.add('hidden'); void t.offsetWidth; t.classList.remove('hidden'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.add('hidden'),ms); }
// Werkzeug unten links: Symbol + Beschriftung (die Leiste hat dort Platz, Zero 2026-10-01)
function werkzeug(b,icon,text){ b.replaceChildren(iconEl(icon),el('span',{class:'nav-label'},text)); }

export { $, el, esc, toast, werkzeug };
