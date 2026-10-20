// Kladde · js/kern/zustand.mjs — geteilter Zustand der Ansichten (A2 Schnitt 3: Deklarationen wörtlich aus js/app.mjs).
// Gelesen wird über die Live-Bindings des Imports, geschrieben NUR über die Setter hier (ein Import ist schreibgeschützt).
// Was eine einzelne Ansicht allein braucht (deck*, schueler*, editor*), bleibt in ihr.

let vault=null;                            // entschlüsselter Zustand im RAM
let aktiverKursId=null, terminDatum=heuteIso();
// Nachtrag (bewusst gewählter Termin) ≠ veraltetes „heute": ohne diesen Merker gingen nach einer Nacht im Speicher
// alle Stempel auf gestern, und ein Nachtrag überlebte den automatischen Kurswechsel (Prüfer 2026-09-29)
let terminNachtrag=false;
// Die in „Stunde wählen“ gewählte Stunde: Kopf und — für ⏰ und ∅ — die Stunde der Buchung (buchungsStunde). Zwei Stunden desselben Kurses
// an einem Tag bleiben EIN Termin. Die Wahl hält bis zur nächsten Wahl, „Heute“/‹ › (setzeTermin) oder einem Kurswechsel (Zero 03.10.: „Wahl hält“);
// Blättern wählt keine Stunde — im Nachtrag gilt dann die Tagesregel wie in Prod (Prüfer 03.10., zweite Runde 🟡 2)
let anzeigeBlock=null;
function terminAufHeute(){ if(!terminNachtrag) terminDatum=heuteIso(); }
function heuteIso(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
// Beamer-Modus: UI-Präferenz (localStorage, nicht im verschlüsselten Vault)
let beamerModus=localStorage.getItem('kladde_beamer')==='1';
let aktiveTeilgruppe=null;
let aktView='heute';
let editorAktiv=false; // Sitzplan-Editor-Modus (State-Flag statt Klassen-Sniffing)
let stempelTyp=null;               // P4.5: scharfer Serien-Stempel (+/o/-/fehlt_o) oder null
function setzeTermin(datum){ terminDatum=datum; terminNachtrag=datum!==heuteIso(); anzeigeBlock=null; }

// ── Setter (die einzigen Schreibstellen) ──
function setzeVault(v){ vault=v; }
function setzeKursId(id){ aktiverKursId=id; }
function setzeTeilgruppe(g){ aktiveTeilgruppe=g; }
function setzeAnzeigeBlock(b){ anzeigeBlock=b; }
function setzeAktView(v){ aktView=v; }
function setzeBeamerModus(an){ beamerModus=an; }
function setzeEditorAktiv(an){ editorAktiv=an; }
function setzeStempelTyp(t){ stempelTyp=t; }
// Kurswechsel (kursAutowahl): zurück auf heute, Nachtrag und gewählte Stunde enden — dieselben drei Schritte wie vorher dort
function terminZuruecksetzen(){ terminDatum=heuteIso(); terminNachtrag=false; anzeigeBlock=null; }

export { vault, aktiverKursId, terminDatum, terminNachtrag, anzeigeBlock, aktiveTeilgruppe, aktView, beamerModus, editorAktiv, stempelTyp, heuteIso, terminAufHeute, setzeTermin, terminZuruecksetzen, setzeVault, setzeKursId, setzeTeilgruppe, setzeAnzeigeBlock, setzeAktView, setzeBeamerModus, setzeEditorAktiv, setzeStempelTyp };
