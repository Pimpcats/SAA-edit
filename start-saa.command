#!/bin/bash
# Double-clickable launcher for macOS (Finder) and Linux.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "[SAA] Node.js not found. Install the LTS version from https://nodejs.org and try again."
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[SAA] First launch - installing dependencies. This can take a few minutes..."
  if ! npm install; then
    echo "[SAA] npm install failed. See the messages above."
    read -r -p "Press Enter to close..."
    exit 1
  fi
fi

echo "[SAA] Launching the app..."
npm start
