# Kladde · App-Hülle

Persönliches SoMi-Erfassungs-Instrument einer Lehrkraft (PWA).

**Dieses Repository enthält ausschließlich die datenfreie App-Hülle** — HTML, Manifest,
Service Worker, Icons. Es enthält und empfängt **keinerlei personenbezogene Daten**:
alle Inhalte entstehen erst lokal auf dem Endgerät (IndexedDB, verschlüsselt) und
verlassen es nur als AES-GCM-verschlüsselte Container über selbstgewählte Kanäle.
Kein Tracking, keine externen Requests, kein CDN.
