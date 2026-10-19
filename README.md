# Kladde · App-Hülle

Persönliches SoMi-Erfassungs-Instrument einer Lehrkraft (PWA).

**Dieses Repository enthält ausschließlich die datenfreie App-Hülle** — HTML, Manifest,
Service Worker, Icons. Es enthält und empfängt **keinerlei personenbezogene Daten**:
alle Inhalte entstehen erst lokal auf dem Endgerät (IndexedDB, verschlüsselt) und
verlassen es nur als AES-GCM-verschlüsselte Container über selbstgewählte Kanäle.
Kein Tracking, keine externen Requests, kein CDN.

## Autor

Abdurrahman Akdag ([@proAkdag](https://github.com/proAkdag)), Lehrer.

## Mit Hilfe von KI gebaut

Kladde ist mit Hilfe von KI entstanden: Code, Tests und Dokumentation wurden im Dialog mit
Claude (Anthropic, über Claude Code) geschrieben; unabhängige Code-Prüfungen kamen zusätzlich von
Codex (OpenAI). Was die App können soll, wie sie sich verhält und was veröffentlicht wird, entscheidet der Autor.

## Tests

`npm test` (Node ≥ 22, keine Abhängigkeiten) prüft die Fachlogik in `logic/`, die Verschlüsselung,
den Service Worker und die Content-Security-Policy. Die App selbst braucht kein Build.

## Excel-Vorlagen

Unter „Mehr → Excel-Vorlage“ und in `vorlagen/` liegen leere Klassen- und Kursmappen für Excel
(ohne Schülerdaten) für alle, die lieber dort arbeiten.

## Lizenz

Frei für Lehrkräfte, Schulen und alle nicht-kommerziellen Zwecke. Kommerzielle Nutzung ist nicht erlaubt.
Siehe [LICENSE](LICENSE) (PolyForm Noncommercial 1.0.0).
