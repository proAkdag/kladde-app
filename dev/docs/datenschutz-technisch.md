# Kladde · Datenschutz (technisch)

- Kladde lädt keine externen Skripte. Kein CDN, keine externen Schriftarten, kein Tracking, keine Analytics.
- Alle Daten entstehen und bleiben lokal auf dem Gerät (IndexedDB, AES-256-GCM-verschlüsselter Container, Schlüssel nur im RAM als non-extractable CryptoKey). Die Passphrase selbst wird nach dem Entsperren nicht behalten; Import, Pull und die Fingerabdruck-Einrichtung fragen sie einmal ab.
- **Ausnahme Zwischenablage:** „Kurzbericht kopieren“ legt Name, Vorschlag, Fehlzeiten und Notizen eines Kindes als Klartext in die System-Zwischenablage. Dort bleibt der Text auch nach dem Sperren, jede App kann ihn einfügen, und die geteilte Apple-Zwischenablage (Handoff) reicht ihn an Mac und iPhone weiter. Die Kladde sagt das beim Kopieren; nach dem Einfügen etwas anderes kopieren. „Vorschläge kopieren“ enthält nur Nr und Note.
- Passphrase-Wechsel erneuert nur die äußere Hülle, nicht den inneren Datenschlüssel (bewusst, Zero 2026-09-29): Wer eine alte Sicherung und die alte Passphrase hat, kann auch künftige Sicherungen öffnen. Der Dialog sagt das.
- Exporte sind verschlüsselte KLD1-Container (siehe `container-format.md`); ohne Passphrase sind sie nicht lesbar.
- Content-Security-Policy: `default-src 'none'` — kein Inline-Script, kein Inline-Style, keine fremden Quellen; XSS über Schülerdaten ist strukturell wirkungslos. Wächter-Tests: `test/csp_guard.test.mjs`.
- Permissions-Policy sperrt Kamera, Mikrofon, Geolocation, Sensoren, Payment, USB.
- Heimnetz-Sync (optional, nur lokales Netz): Der PC-Server erhält ausschließlich verschlüsselte Container, kennt keine Passphrase, entschlüsselt nichts, loggt keine Schülerdaten, keine personenbezogenen Daten in URL-Pfaden.
- Soft-Lock deckt die App beim Verlassen sofort ab (iOS-App-Switcher-Screenshot); Hard-Lock (konfigurierbar 5/10/15/30 min) wipet den RAM-Zustand.
- Beamer-Modus verbirgt Bewertungen und LB-Hinweise bei Projektion.
