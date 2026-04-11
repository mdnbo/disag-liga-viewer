#!/bin/bash
# start-demo.sh — Startet die Demo mit automatischem Neustart
#
# Der Neustart-Button in der Demo beendet den Server-Prozess.
# Dieses Skript startet ihn automatisch wieder.
#
# Beenden mit: Strg+C (zweimal)

echo "🎯 Schützen-Live Demo (mit Auto-Neustart)"
echo "   Beenden: Strg+C"
echo ""

while true; do
    node server.js --demo "$@"
    echo "🔄 Neustart..."
    sleep 0.5
done
