// Kladde · js/kern/theme.mjs — Tag/Nacht/System, wirkt beim Laden (A2 Schnitt 2: wörtlich aus js/app.mjs, verhaltensneutral; der Kern kennt keine Ansicht)
import { $, werkzeug } from './dom.mjs?v=2.3.1';

/* ═══ THEME · Tag/Nacht/System · Default Nacht (Zero-Entscheid E1) ═══ */
const THEME_KEY='kladde_theme';
const themePref=()=>{ const t=localStorage.getItem(THEME_KEY); return (t==='tag'||t==='nacht'||t==='system')?t:'nacht'; };
const themeHell=()=>matchMedia('(prefers-color-scheme: light)').matches;
const themeEff=()=>{ const p=themePref(); return p==='system'?(themeHell()?'tag':'nacht'):p; };
function themeAnwenden(){
  const eff=themeEff();
  document.documentElement.dataset.theme=eff;
  const mc=document.querySelector('meta[name="theme-color"]'); if(mc) mc.content=eff==='tag'?'#F4F0E7':'#17150F';
  const b=$('btn-theme'); if(b){ werkzeug(b,eff==='tag'?'sonne':'mond',eff==='tag'?'Tag':'Nacht'); b.title='Ansicht: '+(themePref()==='system'?'System (folgt Gerät)':eff==='tag'?'Tag':'Nacht'); }
}
$('btn-theme')?.addEventListener('click',()=>{ localStorage.setItem(THEME_KEY, themeEff()==='tag'?'nacht':'tag'); themeAnwenden(); });
matchMedia('(prefers-color-scheme: light)').addEventListener('change',()=>{ if(themePref()==='system') themeAnwenden(); });
themeAnwenden();

export { THEME_KEY, themePref, themeEff, themeAnwenden };
