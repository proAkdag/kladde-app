# Kladde · Datenschutz (technisch)

- Kladde lädt keine externen Skripte. Kein CDN, keine externen Schriftarten, kein Tracking, keine Analytics.
- Alle Daten entstehen und bleiben lokal auf dem Gerät (IndexedDB, AES-256-GCM-verschlüsselter Container, Schlüssel nur im RAM als non-extractable CryptoKey).
- Exporte sind verschlüsselte KLD1-Container (siehe `container-format.md`); ohne Passphrase sind sie nicht lesbar.
- Content-Security-Policy: `default-src 'none'` — kein Inline-Script, kein Inline-Style, keine fremden Quellen; XSS über Schülerdaten ist strukturell wirkungslos. Wächter-Tests: `test/csp_guard.test.mjs`.
- Permissions-Policy sperrt Kamera, Mikrofon, Geolocation, Sensoren, Payment, USB.
- Heimnetz-Sync (optional, nur lokales Netz): Der PC-Server erhält ausschließlich verschlüsselte Container, kennt keine Passphrase, entschlüsselt nichts, loggt keine Schülerdaten, keine personenbezogenen Daten in URL-Pfaden.
- Soft-Lock deckt die App beim Verlassen sofort ab (iOS-App-Switcher-Screenshot); Hard-Lock (konfigurierbar 5/10/15/30 min) wipet den RAM-Zustand.
- Beamer-Modus verbirgt Bewertungen und LB-Hinweise bei Projektion.
