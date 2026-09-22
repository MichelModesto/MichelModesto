#!/bin/zsh
# Compila o app de barra de menus e instala em ~/Applications/Cotacao.app
set -e
cd "$(dirname "$0")"
APP=build/Cotacao.app
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS"
swiftc -O -parse-as-library Cotacao.swift -o "$APP/Contents/MacOS/Cotacao"
cp Info.plist "$APP/Contents/"
codesign -s - --force "$APP" >/dev/null 2>&1 || true
mkdir -p ~/Applications
rm -rf ~/Applications/Cotacao.app && cp -R "$APP" ~/Applications/
echo "instalado: ~/Applications/Cotacao.app"
