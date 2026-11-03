#!/bin/sh
# Encaminha um evento do Codex ao Michel Code House.
# Falhar aqui nunca pode interromper o trabalho do Codex.
payload=$(cat)

if [ -n "$payload" ]; then
  /usr/bin/curl \
    --silent \
    --connect-timeout 0.2 \
    --max-time 0.8 \
    --header 'Content-Type: application/json' \
    --header 'X-Code-House-Provider: Codex' \
    --data-binary "$payload" \
    http://127.0.0.1:4777/hook \
    >/dev/null 2>&1 || :
fi

printf '{}\n'
