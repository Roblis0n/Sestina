<div align="center">
  <img src="../../apps/research-room/client/public/sestina-logo.png" width="120" height="120" alt="Sestina-Logo">
  <h1>Sestina</h1>
  <p><strong>Ein lokaler Forschungsraum, der KI-gestützte Arbeit fokussiert, prüfbar und unter Ihrer Kontrolle hält.</strong></p>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · **Deutsch**
</div>

---

Sestina ist eine lokale, interaktive Forschungsanwendung für Vorhaben, die
länger als einen Chat dauern. Der Research Room hält die aktive Frage,
Evidenz, Entscheidungen, offene Probleme, Korrekturen, Herkunft und die nächste
sichere Aktion in einem fortlaufenden Arbeitsbereich zusammen. Modelle dürfen
Vorschläge machen; nur der Benutzer darf sie annehmen, ablehnen, Probleme
auflösen, Ausnahmen gewähren oder die Forschungsrichtung ändern.

## Was Sestina leistet

- Eine dauerhafte Forschungslinie und ein versionierter Research Brief schützen
  vor einem unbemerkten Austausch der eigentlichen Frage.
- Das Authority Gate trennt Vorschläge von formalen Entscheidungen, verlangt
  eine direkte Benutzeraktion und erzeugt unveränderlich angefügte Receipts.
- Vor einem optionalen Provider-Aufruf zeigt ein exaktes Context Manifest alle
  ein- und ausgeschlossenen Inhalte, Zweck, Grenzen und Hash-Bindungen.
- Bewertungen lassen sich mit Correction Appeals und einer getrennt
  konfigurierten zweiten Meinung anfechten.
- Ein begrenzter Deliberation Room vergleicht zwei gegenseitig blinde
  Teilnehmer, ohne Abstimmung, Gewinner oder autoritative automatische Synthese.
- Projektgebundener kontrollierter Speicher, Backups, Wiederherstellung und
  Migrationen ermöglichen Kontinuität, ohne Kontext zu erfinden.

## Autorität und Datenschutz

Der Research Deliberation Kernel besitzt die Regeln; der Research Room ist die
primäre Oberfläche. CLI, Skills, MCP und Host-Adapter bleiben schmale
Zugriffsschichten. Die öffentliche MCP-Schnittstelle ist schreibgeschützt.

Der Benutzer ist die einzige Forschungsautorität. Provider-Ausgaben,
Modellkonsens, Signaturen, Hashes oder erfolgreiche Werkzeuge dürfen Briefs,
Decisions, Issues, Reviews, Appeals oder Deliberations nicht verändern. Fehlt
ein Nachweis, bleibt der Zustand unknown oder unproven.

Daten verbleiben standardmäßig im `.sestina`-Verzeichnis des gewählten
Projekts. Es gibt kein verpflichtendes Cloud-Konto, keine
Hintergrundsynchronisierung, Telemetrie, automatische Absturzübertragung oder
automatischen Upload. Kontext wird nur dann an einen externen Provider gesendet,
wenn der Benutzer die Verbindung einrichtet, das exakte Manifest prüft und
diese konkrete Anfrage bestätigt.

## Public Preview 0.2.0 starten

Erforderlich sind Node.js 24.x und ein lokaler Browser.

1. Laden Sie `SHA256SUMS` und genau das zu Ihrem System passende Archiv aus dem
   [`v0.2.0` Release](https://github.com/Roblis0n/Sestina/releases/tag/v0.2.0).
2. Prüfen Sie SHA-256 und entpacken Sie das Archiv in einen neuen, leeren Ordner.
3. Führen Sie im entpackten Verzeichnis Folgendes aus:

```text
node start.mjs --version --json
node start.mjs
```

Öffnen Sie ausschließlich die ausgegebene Adresse `http://127.0.0.1:...`.
Unterstützt werden Windows x64, macOS arm64 und Ubuntu x64. Einzelheiten stehen
im [Release-Leitfaden](../release/README.md).

Version 0.2.0 ist eine archivbasierte Vorschau ohne Installer, automatische
Updates, Signatur, Beglaubigung, Hintergrunddienst, npm-Veröffentlichung oder
Cloud-Synchronisierung. Tests belegen Softwareverhalten und Artefaktintegrität,
nicht die semantische Qualität eines Providers oder die Richtigkeit eines
Forschungsergebnisses.

Der Quellcode steht unter der [Apache License 2.0](../../LICENSE). Lesen Sie
[CONTRIBUTING.md](../../CONTRIBUTING.md) und verwenden Sie in Berichten und
Beiträgen ausschließlich synthetische Daten.
