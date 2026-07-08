# KLD1 · Container-Format (Stand v0.8.0)

Alle Mehrbyte-Werte Little-Endian. Eine Krypto-Wahrheit für IndexedDB-Vault UND Export-Datei.

## v2 (aktiv — wird geschrieben und gelesen)

| Offset | Länge | Inhalt |
|---|---|---|
| 0 | 4 | Magic `KLD1` |
| 4 | 1 | Format-Version = 2 |
| 5 | 1 | KDF-Kennung (1 = PBKDF2-HMAC-SHA256 · 2 = Argon2id, reserviert/nicht implementiert) |
| 6 | 4 | KDF-Iterationen (u32 LE, Default 600 000) |
| 10 | 16 | KDF-Salt (je Passphrasen-Setzung) |
| 26 | 12 | IV_wrap (je Passphrasen-Setzung) |
| 38 | 48 | wrapped_DEK = AES-GCM(KEK, DEK 32 B) → 32 B + 16 B Tag |
| 86 | 12 | IV_data (bei JEDEM Speichern neu) |
| 98 | … | AES-256-GCM(DEK, JSON(vault)) inkl. 16-B-Tag |

- **DEK** = 256-bit-Zufallsschlüssel, verschlüsselt die Daten; lebt im RAM ausschließlich als non-extractable CryptoKey.
- **KEK** = PBKDF2(Passphrase); wrappt nur den DEK. KDF läuft NUR bei Unlock/Passphrase-Wechsel — Speichern ist reines AES-GCM (gemessen 0,79 ms/Save bei 2000 Events).
- **Passphrase-Wechsel** bindet nur Bytes 6–85 neu; das Daten-Segment bleibt byte-identisch (Test: `test/container_v2.test.mjs`).
- Implementierungsweg: Rohbytes + `encrypt`/`decrypt` + `importKey(extractable:false)` — bewusst NICHT `wrapKey`/`unwrapKey` (verlangt extractable=true).

## v1 (Legacy — wird gelesen, nie mehr geschrieben)

| Offset | Länge | Inhalt |
|---|---|---|
| 0–3 / 4 / 5 | | Magic / Version=1 / KDF=1 |
| 6 | 4 | Iterationen |
| 10 | 16 | Salt |
| 26 | 12 | IV |
| 38 | … | AES-256-GCM(KEK direkt, JSON) |

**Migration v1→v2** beim ersten Unlock: Original wird als `vault_v1_backup` in IndexedDB gesichert und per Read-back (Byte-Vergleich) verifiziert, ERST DANN wird v2 geschrieben. Alte Export-Dateien bleiben mit ihrer damaligen Passphrase lesbar.

**Import-Guard:** Container-Versionen > 2 werden mit „App aktualisieren" abgelehnt — nie stumm Teilmengen verarbeiten.

**Rollback-Warnung (verbotener Pfad 12):** App-Versionen < 0.8 können v2-Vaults nicht öffnen. Ab dem ersten v2-Write gilt Fix-Forward — kein Code-Rollback.
