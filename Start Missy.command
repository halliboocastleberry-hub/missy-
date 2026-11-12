#!/bin/bash
# Double-click to start Missy Central. She opens in Chrome. Keep this window open while you use her.
cd "$(dirname "$0")" || exit 1
clear
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed yet. Opening the download page — install the LTS version, then double-click this file again."
  open "https://nodejs.org/en/download"
  read -r -p "Press Return to close."
  exit 1
fi
node src/web/server.js --open
echo ""
read -r -p "Missy stopped. Press Return to close this window."
