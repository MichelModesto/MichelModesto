#!/bin/zsh
# Compila, instala e configura início automático no login (LaunchAgent).
set -e
cd "$(dirname "$0")"
./build.sh
PLIST=~/Library/LaunchAgents/com.michelmodesto.cotacao.plist
mkdir -p ~/Library/LaunchAgents
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.michelmodesto.cotacao</string>
  <key>ProgramArguments</key><array><string>$HOME/Applications/Cotacao.app/Contents/MacOS/Cotacao</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/com.michelmodesto.cotacao" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "pronto: o app está na barra de menus e abre sozinho no login"
echo "para remover: launchctl bootout gui/$(id -u)/com.michelmodesto.cotacao && rm $PLIST"
