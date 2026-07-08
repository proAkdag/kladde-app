// kladde/logic/auswahl · gewichtete Zufallswahl (P4.5 · faires „wer ist dran?")
// Wer heute/im Zeitraum weniger dran war, wird wahrscheinlicher gezogen: Gewicht ∝ 1/(1+Einträge).
// Der Zufall ist injizierbar (zufall=() => [0,1)) — dadurch ist die Ziehung Node-testbar,
// obwohl sie im Betrieb Math.random nutzt (Werks-Codex: gemessen, nicht geglaubt).

export function zufallsGewicht(anzahlEintraege) {
  return 1 / (1 + Math.max(0, anzahlEintraege || 0));
}

// items: beliebige Liste · gewichtVon(item) → Zahl ≥ 0 · zufall() → [0,1)
// Gibt das gezogene item zurück (null bei leerer Liste).
export function gewichteteWahl(items, gewichtVon, zufall = Math.random) {
  if (!items || !items.length) return null;
  const gew = items.map(gewichtVon);
  const summe = gew.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (summe <= 0) return items[Math.floor(zufall() * items.length)] ?? items[items.length - 1];
  let r = zufall() * summe;
  for (let i = 0; i < items.length; i++) {
    r -= (gew[i] > 0 ? gew[i] : 0);
    if (r < 0) return items[i];
  }
  return items[items.length - 1]; // Rundungs-Rest
}
