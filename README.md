# 🎯 Schützen-Live — Ligawettkampf Ergebnisanzeige

Live-Ergebnisanzeige für **DISAG OpticScore** Ligawettkämpfe im Sportschießen (Luftgewehr Auflage 10m).

## Features

- **Live-Ergebnisse** per UDP von der DISAG JSON-Schnittstelle
- **Duell-Ansicht**: Schützen-Paarungen mit Echtzeit-Ringvergleich
- **Mannschaftspunkte**: Automatische Berechnung der Mannschaftswertung
- **Serien-Anzeige**: Zwischenergebnisse nach je 10 Schuss mit farbigem Vergleich
- **Stechen-Support**: Zweiphasig — erst ganze Ringe, dann Zehntelwertung
- **Responsive Design**: Funktioniert auf PC, Tablet und Smartphone
- **Vollbild-Modus**: Optimiert für Kiosk-Betrieb (Taste F)
- **Komplett offline-fähig**: Keine externen Abhängigkeiten, kein Internet nötig
- **Demo-Modus**: Simuliert einen kompletten Wettkampf mit 5 Duellen und Stechen

## Voraussetzungen

- **Node.js** ≥ 16
- **DISAG OpticScore-Server** im lokalen Netzwerk (für Echtbetrieb)

## Installation

### Variante A: Offline-Installation (empfohlen)

Wenn der Zielrechner (z.B. openSUSE am Schießstand) kein Internet hat,
wird alles auf einem Rechner **mit** Internet vorbereitet.

**Schritt 1 — Auf einem Rechner mit Internet (z.B. Ubuntu-Server):**

```bash
# Alle Dateien in ein Verzeichnis legen
cd ~/schuetzen-live

# Bundle-Skript ausführen — lädt Node.js + Fonts herunter
chmod +x prepare-offline-bundle.sh
./prepare-offline-bundle.sh
```

Das Skript erstellt eine Datei `schuetzen-live-offline.zip` die alles enthält:
- Node.js v22 für Linux x64 (~25 MB)
- Schriftarten Outfit und JetBrains Mono
- Alle App-Dateien

**Schritt 2 — ZIP auf den Zielrechner kopieren** (z.B. per USB-Stick):

```bash
# Auf dem Offline-Rechner (openSUSE):
unzip schuetzen-live-offline.zip
cd schuetzen-live-offline
./install.sh
```

Das Installationsskript:
- Entpackt Node.js nach `/opt/nodejs` und erstellt Symlinks (braucht einmal `sudo`)
- Installiert die Schriftarten nach `~/.local/share/fonts`
- Aktualisiert den Font-Cache

**Schritt 3 — App starten:**

```bash
cd app
node server.js --demo     # Zum Testen
node server.js            # Echtbetrieb
```

Browser öffnen: **http://localhost:3000**

### Variante A2: Offline-Installation (Windows)

Gleiche Vorgehensweise, aber für Windows-Zielrechner:

**Schritt 1 — Auf einem Rechner mit Internet:**

```bash
cd ~/schuetzen-live
chmod +x prepare-offline-bundle-windows.sh
./prepare-offline-bundle-windows.sh
```

Erstellt `schuetzen-live-windows.zip` mit Node.js für Windows x64 und allen App-Dateien.

**Schritt 2 — ZIP auf den Windows-Rechner kopieren** (z.B. per USB-Stick):

- ZIP entpacken
- `start.bat` doppelklicken → Demo-Modus (mit Auto-Neustart)
- `start-live.bat` doppelklicken → Echtbetrieb
- Optional: `install-fonts.bat` für Schriftarten

Browser öffnen: **http://localhost:3000**

### Variante B: Direkte Installation (mit Internet)

```bash
# Node.js installieren (openSUSE)
sudo zypper install nodejs20

# App starten — kein npm install nötig!
cd schuetzen-live
node server.js
```

## Nutzung

### Normalbetrieb (mit OpticScore)

```bash
node server.js
```

### Demo-Modus (ohne OpticScore)

```bash
node server.js --demo
```

Simuliert einen Ligawettkampf mit 5 Duellen (10 Schützen), realistischen
Ergebnissen (290–300 Ringe) und einem garantierten Stechen bei Duell 1.

### Vollbild-Modus

- Taste **F** drücken oder den ⛶-Button klicken
- Optimiert für 1920×1080 mit bis zu 5 Duellen
- Header wird ausgeblendet, abgeschlossene Duelle werden nach 10s kompakt

### Optionen

| Parameter      | Standard | Beschreibung                           |
|---------------|----------|----------------------------------------|
| `--udp-port`  | 30169    | UDP-Port für DISAG JSON Live           |
| `--web-port`  | 3000     | HTTP-Port für die Web-Oberfläche       |
| `--demo`      | —        | Demo-Modus mit simulierten Schüssen    |

Beispiel:
```bash
node server.js --web-port 8080 --udp-port 30169
```

## OpticScore Einrichtung

Im DISAG OpticScore-Server:

1. **Extras → Optionen → JSON Live**
2. Haken setzen bei **„Ausgabe per UDP Broadcast aktivieren"**
3. UDP-Port: **30169** (Standard)
4. Optional: „Ausgabe in Logfile aktivieren" für Debugging

Wichtig: Der Rechner mit der Schützen-Live App muss im **selben Netzwerk/Subnetz**
wie der OpticScore-Server sein, damit die UDP-Broadcasts ankommen.

## Wettkampf-Regeln (implementiert)

- **30 Wertungsschüsse** pro Schütze (ganze Ringe, max. 10)
- Ergebnisse werden nach **10 Schuss** (1. Serie) und danach **live** angezeigt
- Einzelschüsse: nur die aktuelle Serie (max. 10 Balken) sichtbar
- **Serien-Vergleich**: Farbig markiert (grün = vorne, gelb = gleich, rot = hinten)
- **Vergleichsbalken**: Zeigt bei unterschiedlichem Schussstand den fairen Vergleich
- **Duellwertung**: Wer nach 30 Schuss mehr Ringe hat, holt 1 Mannschaftspunkt
- **Stechen Phase 1**: Bei Ringgleichheit 3 weitere Schüsse (ganze Ringe)
- **Stechen Phase 2**: Bei erneutem Gleichstand je 1 Schuss mit Zehntelwertung
- Mannschaftspunkte zählen live hoch, sobald ein Duell entschieden ist

## Architektur

```
DISAG OpticScore Server
        │
        │ UDP Broadcast (Port 30169)
        │ JSON-Nachrichten pro Schuss/Serie/Ergebnis
        ▼
┌───────────────────┐
│  Node.js Server   │
│  (server.js)      │
│                   │
│  UDP-Listener ──→ State-Management ──→ WebSocket
│                                         │
└───────────────────┘                     │
        │ HTTP                            │
        ▼                                 ▼
┌───────────────────────────────────────────┐
│  Browser (index.html)                     │
│  WebSocket-Client → Live-Rendering        │
│  (Fallback: HTTP-Polling alle 2s)         │
└───────────────────────────────────────────┘
```

## Dateien

| Datei | Beschreibung |
|-------|-------------|
| `server.js` | Node.js Backend — UDP-Listener, HTTP-Server, WebSocket |
| `ws-server.js` | Eigene WebSocket-Implementierung (keine npm-Abhängigkeit) |
| `index.html` | Frontend — komplettes UI in einer Datei |
| `package.json` | Projekt-Metadaten |
| `prepare-offline-bundle.sh` | Skript zum Erstellen des Offline-Bundles (Linux) |
| `prepare-offline-bundle-windows.sh` | Skript zum Erstellen des Offline-Bundles (Windows) |

## Troubleshooting

### „Warte auf Daten..." bleibt stehen
- Ist der OpticScore-Server im gleichen Netzwerk?
- Ist JSON Live → UDP Broadcast aktiviert?
- Firewall: UDP Port 30169 muss offen sein
- Test: `sudo tcpdump -i any udp port 30169` zeigt eingehende Pakete

### „Verbinde..." im Browser
- Server läuft? Konsole zeigt `✅ UDP-Listener aktiv`?
- Firewall: TCP Port 3000 muss offen sein
- Bei Zugriff von anderem Rechner: `http://IP-DES-SERVERS:3000`
- Fallback auf HTTP-Polling startet nach 5 Sekunden automatisch

### Port-Fehler EACCES
- Ports unter 1024 brauchen root-Rechte
- Port 30169 und 3000 sollten ohne sudo funktionieren

### Kein Mannschafts-Score
- Schützen müssen im OpticScore einer Mannschaft zugeordnet sein
- Die Mannschaftszuordnung kommt aus dem `Team`-Objekt der JSON-Daten

### Schriftarten sehen anders aus
- Fonts über `install.sh` installiert? → `fc-cache -fv` ausführen
- Oder Fonts manuell nach `~/.local/share/fonts/` kopieren
- Die App funktioniert auch ohne die Fonts (System-Fallbacks greifen)

## Lizenz

MIT
