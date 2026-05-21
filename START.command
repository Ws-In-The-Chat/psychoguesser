#!/bin/bash
# Double-click this file to start PsychoGuesser

cd "$(dirname "$0")"

# Check for Node.js
if ! command -v node &> /dev/null; then
  osascript -e 'display dialog "Node.js is not installed.\n\nPlease install it from:\nhttps://nodejs.org\n\nDownload the LTS version, install it, then double-click START.command again." with title "PsychoGuesser — Setup Required" buttons {"Open nodejs.org", "Cancel"} default button 1'
  if [ $? -eq 0 ]; then
    open "https://nodejs.org"
  fi
  exit 1
fi

echo "🧠 PsychoGuesser"
echo "================"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies (first run only)..."
  npm install
fi

echo ""
echo "✅ Starting server..."
echo ""

# Open browser after 2 seconds
(sleep 2 && open "http://localhost:3000") &

node server.js
