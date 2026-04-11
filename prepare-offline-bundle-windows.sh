#!/bin/bash
# ============================================================
# prepare-offline-bundle-windows.sh
#
# Dieses Skript auf einem Rechner MIT Internet ausführen.
# Es lädt alles herunter, was für den Offline-Betrieb der
# Schützen-Live App auf Windows benötigt wird.
#
# Nutzung:
#   chmod +x prepare-offline-bundle-windows.sh
#   ./prepare-offline-bundle-windows.sh
#
# Ergebnis:
#   schuetzen-live-windows.zip
#
# Auf dem Windows-Rechner (offline):
#   ZIP entpacken
#   start.bat doppelklicken (Demo)
#   oder: start-live.bat doppelklicken (Echtbetrieb)
# ============================================================

set -e

BUNDLE_DIR="schuetzen-live-windows"
NODE_VERSION="v22.12.0"
NODE_ZIP="node-${NODE_VERSION}-win-x64.zip"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_ZIP}"

echo "============================================"
echo "  Schützen-Live Windows-Bundle erstellen"
echo "============================================"
echo ""

# Aufräumen
rm -rf "$BUNDLE_DIR" "${BUNDLE_DIR}.zip"
mkdir -p "$BUNDLE_DIR"

# -----------------------------------------------------------
# 1) Node.js für Windows herunterladen
# -----------------------------------------------------------
echo "[1/3] Node.js ${NODE_VERSION} (Windows x64) herunterladen..."
if [ -f "$NODE_ZIP" ]; then
    echo "       (bereits vorhanden, überspringe Download)"
else
    wget -q --show-progress "$NODE_URL" -O "$NODE_ZIP"
fi

# Node.js entpacken (enthält node-vXX-win-x64/ Ordner)
echo "       Entpacke Node.js..."
unzip -qo "$NODE_ZIP" -d "$BUNDLE_DIR/"
# Umbenennen zu "nodejs" für einfacheren Pfad
mv "$BUNDLE_DIR/node-${NODE_VERSION}-win-x64" "$BUNDLE_DIR/nodejs"
echo "       ✅ Node.js heruntergeladen"

# -----------------------------------------------------------
# 2) Google Fonts herunterladen
# -----------------------------------------------------------
echo "[2/3] Google Fonts herunterladen..."

FONTS_DIR="$BUNDLE_DIR/fonts"
mkdir -p "$FONTS_DIR"

# Outfit
if [ -f "Outfit.zip" ]; then
    echo "       Outfit.zip bereits vorhanden"
else
    wget -q --show-progress "https://fonts.google.com/download?family=Outfit" -O Outfit.zip
fi
unzip -qo Outfit.zip -d "$FONTS_DIR/Outfit" 2>/dev/null || true

# JetBrains Mono
if [ -f "JetBrainsMono.zip" ]; then
    echo "       JetBrainsMono.zip bereits vorhanden"
else
    wget -q --show-progress "https://fonts.google.com/download?family=JetBrains+Mono" -O JetBrainsMono.zip
fi
unzip -qo JetBrainsMono.zip -d "$FONTS_DIR/JetBrainsMono" 2>/dev/null || true

echo "       ✅ Fonts heruntergeladen"

# -----------------------------------------------------------
# 3) App-Dateien kopieren
# -----------------------------------------------------------
echo "[3/3] App-Dateien kopieren..."

if [ -f "server.js" ] && [ -f "index.html" ]; then
    cp server.js ws-server.js index.html package.json README.md "$BUNDLE_DIR/"
    [ -f "icon.svg" ] && cp icon.svg "$BUNDLE_DIR/"
    [ -f "icon.ico" ] && cp icon.ico "$BUNDLE_DIR/"
elif [ -d "schuetzen-live" ]; then
    cp schuetzen-live/server.js schuetzen-live/ws-server.js schuetzen-live/index.html schuetzen-live/package.json schuetzen-live/README.md "$BUNDLE_DIR/"
    [ -f "schuetzen-live/icon.svg" ] && cp schuetzen-live/icon.svg "$BUNDLE_DIR/"
    [ -f "schuetzen-live/icon.ico" ] && cp schuetzen-live/icon.ico "$BUNDLE_DIR/"
else
    echo "  ⚠️  App-Dateien nicht gefunden!"
    exit 1
fi
echo "       ✅ App-Dateien kopiert"

# -----------------------------------------------------------
# 4) Batch-Dateien erstellen
# -----------------------------------------------------------

# start.bat — Demo-Modus
cat > "$BUNDLE_DIR/start.bat" << 'BAT_EOF'
@echo off
chcp 65001 >nul
title Schützen-Live Demo
echo.
echo ============================================
echo   Schützen-Live — Demo-Modus
echo ============================================
echo.

:loop
"%~dp0nodejs\node.exe" "%~dp0server.js" --demo
echo.
echo Neustart...
timeout /t 1 /nobreak >nul
goto loop
BAT_EOF

# start-live.bat — Echtbetrieb
cat > "$BUNDLE_DIR/start-live.bat" << 'BAT_EOF'
@echo off
chcp 65001 >nul
title Schützen-Live Echtbetrieb
echo.
echo ============================================
echo   Schützen-Live — Echtbetrieb
echo ============================================
echo.
echo   Starte OpticScore-Listener...
echo   Browser oeffnen: http://localhost:3000
echo.
echo   Zum Beenden: Strg+C oder Fenster schliessen
echo.

"%~dp0nodejs\node.exe" "%~dp0server.js"
pause
BAT_EOF

# start-debug.bat — Echtbetrieb mit Debug
cat > "$BUNDLE_DIR/start-debug.bat" << 'BAT_EOF'
@echo off
chcp 65001 >nul
title DISAG Liga Viewer — Debug
echo.
echo ============================================
echo   DISAG Liga Viewer — Debug-Modus
echo ============================================
echo.
echo   Debug-Log wird geschrieben in:
echo   %~dp0debug-*.log
echo.
echo   Browser oeffnen: http://localhost:3000
echo   Debug-Panel am Ende der Seite aufklappen!
echo.
echo   Zum Beenden: Strg+C oder Fenster schliessen
echo.

"%~dp0nodejs\node.exe" "%~dp0server.js" --debug
pause
BAT_EOF

# install-fonts.bat — Fonts installieren (optional)
cat > "$BUNDLE_DIR/install-fonts.bat" << 'BAT_EOF'
@echo off
chcp 65001 >nul
echo.
echo Schriftarten installieren...
echo.
echo Bitte die folgenden Schritte manuell ausfuehren:
echo.
echo 1. Oeffne den Ordner "fonts" in diesem Verzeichnis
echo 2. Waehle alle .ttf Dateien aus (Strg+A)
echo 3. Rechtsklick → "Fuer alle Benutzer installieren"
echo.
echo Alternativ: Die App funktioniert auch ohne
echo die Schriftarten (System-Fonts werden genutzt).
echo.

explorer "%~dp0fonts"
pause
BAT_EOF

# create-shortcuts.bat — Desktop- und Startmenü-Verknüpfungen
cat > "$BUNDLE_DIR/create-shortcuts.bat" << 'BAT_EOF'
@echo off
chcp 65001 >nul
echo.
echo ============================================
echo   Desktop-Verknuepfungen erstellen
echo ============================================
echo.

set "APP_DIR=%~dp0"
set "DESKTOP=%USERPROFILE%\Desktop"
set "STARTMENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs"

echo Erstelle VBS-Hilfsskript...
set "VBS=%TEMP%\create_shortcut.vbs"

REM --- Echtbetrieb ---
> "%VBS%" echo Set ws = CreateObject("WScript.Shell")
>> "%VBS%" echo Set sc = ws.CreateShortcut("%DESKTOP%\Schuetzen-Live.lnk")
>> "%VBS%" echo sc.TargetPath = "%APP_DIR%start-live.bat"
>> "%VBS%" echo sc.WorkingDirectory = "%APP_DIR%"
>> "%VBS%" echo sc.IconLocation = "%APP_DIR%icon.ico, 0"
>> "%VBS%" echo sc.Description = "Schuetzen-Live Echtbetrieb"
>> "%VBS%" echo sc.Save
>> "%VBS%" echo Set sc = ws.CreateShortcut("%STARTMENU%\Schuetzen-Live.lnk")
>> "%VBS%" echo sc.TargetPath = "%APP_DIR%start-live.bat"
>> "%VBS%" echo sc.WorkingDirectory = "%APP_DIR%"
>> "%VBS%" echo sc.IconLocation = "%APP_DIR%icon.ico, 0"
>> "%VBS%" echo sc.Description = "Schuetzen-Live Echtbetrieb"
>> "%VBS%" echo sc.Save

REM --- Demo ---
>> "%VBS%" echo Set sc = ws.CreateShortcut("%DESKTOP%\Schuetzen-Live Demo.lnk")
>> "%VBS%" echo sc.TargetPath = "%APP_DIR%start.bat"
>> "%VBS%" echo sc.WorkingDirectory = "%APP_DIR%"
>> "%VBS%" echo sc.IconLocation = "%APP_DIR%icon.ico, 0"
>> "%VBS%" echo sc.Description = "Schuetzen-Live Demo"
>> "%VBS%" echo sc.Save
>> "%VBS%" echo Set sc = ws.CreateShortcut("%STARTMENU%\Schuetzen-Live Demo.lnk")
>> "%VBS%" echo sc.TargetPath = "%APP_DIR%start.bat"
>> "%VBS%" echo sc.WorkingDirectory = "%APP_DIR%"
>> "%VBS%" echo sc.IconLocation = "%APP_DIR%icon.ico, 0"
>> "%VBS%" echo sc.Description = "Schuetzen-Live Demo"
>> "%VBS%" echo sc.Save

cscript //nologo "%VBS%"
del "%VBS%"

echo.
echo   Verknuepfungen erstellt:
echo     Desktop: Schuetzen-Live, Schuetzen-Live Demo
echo     Startmenue: Schuetzen-Live, Schuetzen-Live Demo
echo.
pause
BAT_EOF

echo "       ✅ Batch-Dateien erstellt"

# -----------------------------------------------------------
# 5) ZIP erstellen
# -----------------------------------------------------------
echo ""
echo "ZIP-Datei erstellen..."
zip -r "${BUNDLE_DIR}.zip" "$BUNDLE_DIR/"
echo ""

ZIP_SIZE=$(du -h "${BUNDLE_DIR}.zip" | cut -f1)
echo "============================================"
echo "  ✅ Fertig!"
echo ""
echo "  Datei:  ${BUNDLE_DIR}.zip ($ZIP_SIZE)"
echo ""
echo "  Auf den Windows-Rechner kopieren und:"
echo "    1. ZIP entpacken"
echo "    2. start.bat doppelklicken (Demo)"
echo "       oder start-live.bat (Echtbetrieb)"
echo "    3. Browser: http://localhost:3000"
echo ""
echo "  Optional: install-fonts.bat fuer"
echo "  die Schriftarten ausfuehren."
echo "============================================"
