# Notizbuch

Privates Journal fürs iPhone mit einer ruhigen Analyse-Ebene darüber.
Du schreibst auf, was passiert – die App hilft, Fakten von Vermutungen zu trennen,
andere Erklärungen zu sehen und Zusammenhänge zwischen Einträgen zu erkennen.

## Was die App kann

- **Heute**: großes Eingabefeld („Was ist passiert?“), optional Person(en), Ort, Zeitpunkt, Stimmung, Kategorie. „Analysieren“ oder „Nur speichern“. Darunter die heutigen Einträge.
- **Analyse** eines Eintrags: Was passiert ist · Was dir aufgefallen ist · Mögliche Erklärungen (naheliegend/möglich/spekulativ) · Was offen bleibt · Verbindung zu früher · 0–3 Rückfragen (beantwortbar, dann neu analysieren) · Andere Perspektive · Was du vielleicht übersiehst · Zum Nachdenken.
- **Selbstprüfung**: Jede Analyse läuft in zwei Durchgängen (Entwurf → Prüfung anhand von sechs Fragen). Danach prüft die App auf dem Gerät nach: Verweise auf nicht mitgeschickte Einträge und Namen, die nicht im Text stehen, werden entfernt. Das Ergebnis steht eingeklappt unter jeder Analyse.
- **Journal**: alle Einträge nach Tagen. Bearbeiten und Löschen über „⋯“.
- **Insights**: Zählungen auf dem Gerät (Einträge, Stimmungen, Personen, Themen) und auf Wunsch „Muster suchen“ für 7/14/30 Tage. Personen-Seiten mit eigenem Verlauf.
- **Suche**: Stichwortsuche (ohne Internet) und „Journal fragen“, z. B. „Was ist mir in den letzten zwei Wochen über meine Motivation aufgefallen?“.
- **Einstellungen**: API-Schlüssel, Modell, Verbrauch, Code ändern, automatisches Sperren, Hell/Dunkel, Backup (verschlüsselt), lesbarer Export, Import, alles löschen, Datenschutz-Erklärung.

## Wo der API-Schlüssel hingehört

**In die App selbst, nicht in den Code.** Einstellungen (Regler-Symbol oben rechts) → „Analyse“ → Schlüssel einfügen → „Speichern und prüfen“.

So bekommst du einen Schlüssel:
1. Auf https://console.anthropic.com anmelden bzw. Konto anlegen.
2. Unter „Billing“ Guthaben aufladen (z. B. 5–10 $).
3. Unter „Limits“ ein monatliches Ausgabenlimit setzen.
4. Unter „API Keys“ → „Create Key“ → Schlüssel kopieren (beginnt mit `sk-ant-`).

Der Schlüssel wird verschlüsselt auf dem iPhone gespeichert und nur an `api.anthropic.com` geschickt.

## Aufs iPhone bringen

Die App muss einmal über eine https-Adresse erreichbar sein (z. B. GitHub Pages). Dann:
1. Adresse in **Safari** öffnen.
2. Unten auf „Teilen“ → „Zum Home-Bildschirm“.
3. Die App **vom Home-Bildschirm aus** öffnen und dort den Code festlegen.
   Safari und die Home-Bildschirm-App haben getrennte Speicher – was du in Safari einrichtest, ist in der Home-Bildschirm-App nicht da.

## Datenschutz – ehrlich

- Einträge liegen nur auf dem Gerät, verschlüsselt mit AES-256-GCM. Der Schlüssel wird mit PBKDF2 (600.000 Runden) aus deinem Code abgeleitet; der Code wird nicht gespeichert.
- Kein Konto, kein eigener Server, keine Werbung, keine Tracker, kein Teilen.
- Nur bei „Analysieren“, „Journal fragen“ und „Muster suchen“ gehen Daten direkt an Anthropic: der Eintrag bzw. die Frage, die dafür ausgewählten früheren Einträge und Zählungen. Welche Einträge das waren, steht unter jeder Antwort bei „Grundlage“.
- **Keine Ende-zu-Ende-Verschlüsselung gegenüber der KI**: Anthropic muss die Texte lesen können, um sie zu analysieren. Laut Anthropic werden API-Daten standardmäßig nicht zum Training genutzt, aber eine begrenzte Zeit gespeichert.
- Die einzige Datei, die etwas ins Internet schickt, ist `js/ai/api.js`. Die Sicherheitsregel in `index.html` erlaubt nur Verbindungen zu `api.anthropic.com`.
- Grenzen: Solange die App entsperrt ist, sind die Daten im Arbeitsspeicher lesbar. Kurze Codes lassen sich mit Zugriff auf die Gerätedaten durchprobieren. App vom Home-Bildschirm löschen = Daten weg → ab und zu Backup sichern.

## Kosten (grob)

Standardmodell ist Claude Opus 5 (5 $ / 25 $ pro Million Tokens). Eine Analyse (zwei Durchgänge) kostet grob 10–25 Cent. In den Einstellungen lässt sich Sonnet 5 (grob 4–10 Cent) oder Haiku 4.5 (grob 1–3 Cent) wählen. Der Verbrauch des Monats wird in den Einstellungen geschätzt; maßgeblich ist die Abrechnung bei Anthropic.

## Aufbau

Reines HTML/CSS/JavaScript ohne Bibliotheken und ohne Build-Schritt.

```
index.html              Seite + Sicherheitsregel (CSP)
manifest.webmanifest    Name/Symbol für den Home-Bildschirm
sw.js                   Offline-Start (nur App-Dateien, nie Einträge)
css/app.css             Aussehen, Hell/Dunkel, iPhone-Ränder
js/main.js              Start, Sperre, Tab-Leiste, automatisches Sperren
js/core/                Verschlüsselung, Speicher, Datum, Text, Navigation, Backup
js/ai/api.js            EINZIGER Weg nach außen (Anthropic)
js/ai/prompts.js        Anweisungen an das Modell (Ton, Regeln, Selbstprüfung)
js/ai/schemas.js        Antwortformate
js/ai/context.js        Auswahl früherer Einträge + Zählungen (auf dem Gerät)
js/ai/tasks.js          Ablauf: Entwurf → Selbstprüfung → Prüfung auf dem Gerät
js/ui/                  Bausteine (Eingabe, Analyse-Anzeige, Muster)
js/views/               Seiten (Heute, Journal, Insights, Suche, Eintrag, Person, Einstellungen, Sperre)
```

**Nach jeder Änderung** in `sw.js` die Zeile `VERSION` erhöhen (z. B. `v1.0.1`), sonst laden iPhones die alte Fassung.

Lokal testen: `python -m http.server 8765 --directory notizbuch` und `http://localhost:8765` öffnen.
