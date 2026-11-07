#!/bin/bash
# Double-click to launch Missy Central on your Mac.
cd "$(dirname "$0")" || exit 1
if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js isn't installed yet. Opening the download page — install the LTS version, then double-click this file again."
  open "https://nodejs.org/en/download"
  read -r -p "Press Return to close."
  exit 1
fi
if [ ! -d node_modules/electron ]; then
  echo "First launch: installing Missy's app shell (one time, about a minute)…"
  npm install || { read -r -p "Install failed — press Return to close."; exit 1; }
fi
npm start
