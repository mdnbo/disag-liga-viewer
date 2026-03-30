#!/bin/bash
# ============================================================
# prepare-offline-bundle.sh
#
# Dieses Skript auf einem Rechner MIT Internet ausführen.
# Es lädt alles herunter, was für den Offline-Betrieb der
# Schützen-Live App auf openSUSE benötigt wird, und packt
# alles in eine einzige ZIP-Datei.
#
# Nutzung:
#   chmod +x prepare-offline-bundle.sh
#   ./prepare-offline-bundle.sh
#
# Ergebnis:
#   schuetzen-live-offline.zip  (alles drin)
#
# Auf dem Zielrechner (openSUSE, offline):
#   unzip schuetzen-live-offline.zip
#   cd schuetzen-live-offline
#   ./install.sh
#   cd app
#   node server.js --demo
# ============================================================

set -e

BUNDLE_DIR="schuetzen-live-offline"
NODE_VERSION="v22.12.0"
NODE_ARCH="linux-x64"
NODE_TARBALL="node-${NODE_VERSION}-${NODE_ARCH}.tar.xz"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}"

echo "============================================"
echo "  Schützen-Live Offline-Bundle erstellen"
echo "============================================"
echo ""

# Aufräumen
rm -rf "$BUNDLE_DIR" "${BUNDLE_DIR}.zip"
mkdir -p "$BUNDLE_DIR/fonts" "$BUNDLE_DIR/nodejs" "$BUNDLE_DIR/app"

# -----------------------------------------------------------
# 1) Node.js herunterladen
# -----------------------------------------------------------
echo "[1/3] Node.js ${NODE_VERSION} herunterladen..."
if [ -f "$NODE_TARBALL" ]; then
    echo "       (bereits vorhanden, überspringe Download)"
else
    wget -q --show-progress "$NODE_URL" -O "$NODE_TARBALL"
fi
cp "$NODE_TARBALL" "$BUNDLE_DIR/nodejs/"
echo "       ✅ Node.js heruntergeladen"

# -----------------------------------------------------------
# 2) Google Fonts herunterladen
# -----------------------------------------------------------
echo "[2/3] Google Fonts herunterladen..."

# Outfit
if [ -f "Outfit.zip" ]; then
    echo "       Outfit.zip bereits vorhanden"
else
    wget -q --show-progress "https://fonts.google.com/download?family=Outfit" -O Outfit.zip
fi
unzip -qo Outfit.zip -d "$BUNDLE_DIR/fonts/Outfit" 2>/dev/null || true

# JetBrains Mono
if [ -f "JetBrainsMono.zip" ]; then
    echo "       JetBrainsMono.zip bereits vorhanden"
else
    wget -q --show-progress "https://fonts.google.com/download?family=JetBrains+Mono" -O JetBrainsMono.zip
fi
unzip -qo JetBrainsMono.zip -d "$BUNDLE_DIR/fonts/JetBrainsMono" 2>/dev/null || true

echo "       ✅ Fonts heruntergeladen"

# -----------------------------------------------------------
# 3) App-Dateien kopieren
# -----------------------------------------------------------
echo "[3/3] App-Dateien kopieren..."

# Prüfe ob die App-Dateien im aktuellen Verzeichnis liegen
if [ -f "server.js" ] && [ -f "index.html" ]; then
    cp server.js ws-server.js index.html package.json README.md "$BUNDLE_DIR/app/"
    [ -f "icon.svg" ] && cp icon.svg "$BUNDLE_DIR/app/"
elif [ -d "schuetzen-live" ]; then
    cp schuetzen-live/server.js schuetzen-live/ws-server.js schuetzen-live/index.html schuetzen-live/package.json schuetzen-live/README.md "$BUNDLE_DIR/app/"
    [ -f "schuetzen-live/icon.svg" ] && cp schuetzen-live/icon.svg "$BUNDLE_DIR/app/"
else
    echo "  ⚠️  App-Dateien nicht gefunden!"
    echo "     Bitte dieses Skript im Verzeichnis mit den App-Dateien ausführen,"
    echo "     oder die Dateien in einen Unterordner 'schuetzen-live' legen."
    exit 1
fi

# start-demo.sh für die App
cat > "$BUNDLE_DIR/app/start-demo.sh" << 'STARTDEMO_EOF'
#!/bin/bash
cd "$(dirname "$0")"
echo "🎯 Schützen-Live Demo (mit Auto-Neustart)"
while true; do
    node server.js --demo "$@"
    echo "🔄 Neustart..."
    sleep 0.5
done
STARTDEMO_EOF
chmod +x "$BUNDLE_DIR/app/start-demo.sh"

echo "       ✅ App-Dateien kopiert"

# -----------------------------------------------------------
# 4) Installationsskript erstellen
# -----------------------------------------------------------
cat > "$BUNDLE_DIR/install.sh" << 'INSTALL_EOF'
#!/bin/bash
# ============================================================
# install.sh — Auf dem Offline-Zielrechner (openSUSE) ausführen
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "============================================"
echo "  Schützen-Live Installation (Offline)"
echo "============================================"
echo ""

# -----------------------------------------------------------
# 1) Node.js installieren
# -----------------------------------------------------------
echo "[1/3] Node.js installieren..."

NODE_TARBALL=$(ls "$SCRIPT_DIR/nodejs/"node-*.tar.xz 2>/dev/null | head -1)
if [ -z "$NODE_TARBALL" ]; then
    echo "  ⚠️  Kein Node.js Archiv gefunden in nodejs/"
    exit 1
fi

NODE_DIR="/opt/nodejs"
if [ -d "$NODE_DIR" ]; then
    echo "       Node.js bereits installiert in $NODE_DIR"
else
    echo "       Entpacke nach $NODE_DIR ..."
    sudo mkdir -p "$NODE_DIR"
    sudo tar -xf "$NODE_TARBALL" -C "$NODE_DIR" --strip-components=1
fi

# Symlinks anlegen
if ! command -v node &>/dev/null || [ "$(readlink -f "$(which node)")" != "$NODE_DIR/bin/node" ]; then
    echo "       Symlinks erstellen..."
    sudo ln -sf "$NODE_DIR/bin/node" /usr/local/bin/node
    sudo ln -sf "$NODE_DIR/bin/npm" /usr/local/bin/npm
fi

echo "       Node.js Version: $(node --version)"
echo "       ✅ Node.js installiert"

# -----------------------------------------------------------
# 2) Fonts installieren
# -----------------------------------------------------------
echo "[2/3] Schriftarten installieren..."

FONT_DIR="$HOME/.local/share/fonts"
mkdir -p "$FONT_DIR"

# Outfit
find "$SCRIPT_DIR/fonts/Outfit" -name "*.ttf" -exec cp {} "$FONT_DIR/" \; 2>/dev/null
# JetBrains Mono
find "$SCRIPT_DIR/fonts/JetBrainsMono" -name "*.ttf" -exec cp {} "$FONT_DIR/" \; 2>/dev/null

# Font-Cache aktualisieren
if command -v fc-cache &>/dev/null; then
    fc-cache -f "$FONT_DIR" 2>/dev/null
    echo "       ✅ Fonts installiert und Cache aktualisiert"
else
    echo "       ✅ Fonts kopiert (fc-cache nicht verfügbar, Neustart des Browsers nötig)"
fi

# -----------------------------------------------------------
# 3) Desktop-Verknüpfungen erstellen
# -----------------------------------------------------------
echo "[3/4] Desktop-Verknüpfungen erstellen..."

APP_DIR="$SCRIPT_DIR/app"
ICON_PATH="$APP_DIR/icon.svg"
DESKTOP_DIR="$HOME/.local/share/applications"
DESKTOP_ICON_DIR="$HOME/Desktop"

mkdir -p "$DESKTOP_DIR"

# .desktop Datei für Echtbetrieb
cat > "$DESKTOP_DIR/schuetzen-live.desktop" << DESK_EOF
[Desktop Entry]
Name=Schützen-Live
Comment=Ligawettkampf Live-Ergebnisanzeige
Exec=bash -c 'cd "$APP_DIR" && node server.js & sleep 1 && xdg-open http://localhost:3000; wait'
Icon=$ICON_PATH
Terminal=true
Type=Application
Categories=Utility;Sports;
StartupNotify=false
DESK_EOF

# .desktop Datei für Demo
cat > "$DESKTOP_DIR/schuetzen-live-demo.desktop" << DESK_EOF
[Desktop Entry]
Name=Schützen-Live Demo
Comment=Ligawettkampf Demo-Modus
Exec=bash -c 'cd "$APP_DIR" && bash start-demo.sh & sleep 1 && xdg-open http://localhost:3000; wait'
Icon=$ICON_PATH
Terminal=true
Type=Application
Categories=Utility;Sports;
StartupNotify=false
DESK_EOF

# Auf den Desktop kopieren (falls vorhanden)
if [ -d "$DESKTOP_ICON_DIR" ]; then
    cp "$DESKTOP_DIR/schuetzen-live.desktop" "$DESKTOP_ICON_DIR/"
    cp "$DESKTOP_DIR/schuetzen-live-demo.desktop" "$DESKTOP_ICON_DIR/"
    # Ausführbar machen (manche DEs brauchen das)
    chmod +x "$DESKTOP_ICON_DIR/schuetzen-live.desktop" 2>/dev/null || true
    chmod +x "$DESKTOP_ICON_DIR/schuetzen-live-demo.desktop" 2>/dev/null || true
    echo "       ✅ Desktop-Icons und Startmenü-Einträge erstellt"
else
    echo "       ✅ Startmenü-Einträge erstellt (kein Desktop-Ordner gefunden)"
fi

# -----------------------------------------------------------
# 4) Fertig
# -----------------------------------------------------------
echo "[4/4] App vorbereiten..."
echo "       ✅ Alles installiert!"
echo ""
echo "============================================"
echo "  Starten mit:"
echo ""
echo "    cd $SCRIPT_DIR/app"
echo "    node server.js --demo     # Zum Testen"
echo "    node server.js            # Echtbetrieb"
echo ""
echo "  Browser öffnen:"
echo "    http://localhost:3000"
echo "============================================"
echo ""
INSTALL_EOF

chmod +x "$BUNDLE_DIR/install.sh"

# -----------------------------------------------------------
# 5) Alles in eine ZIP-Datei packen
# -----------------------------------------------------------
echo ""
echo "ZIP-Datei erstellen..."
zip -r "${BUNDLE_DIR}.zip" "$BUNDLE_DIR/"
echo ""

# Statistik
ZIP_SIZE=$(du -h "${BUNDLE_DIR}.zip" | cut -f1)
echo "============================================"
echo "  ✅ Fertig!"
echo ""
echo "  Datei:  ${BUNDLE_DIR}.zip ($ZIP_SIZE)"
echo ""
echo "  Auf den Offline-Rechner kopieren und:"
echo "    unzip ${BUNDLE_DIR}.zip"
echo "    cd ${BUNDLE_DIR}"
echo "    ./install.sh"
echo "============================================"
