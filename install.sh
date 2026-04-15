#!/bin/bash
# AUTOINSTALL — open source dependencies only
# Run: chmod +x install.sh && ./install.sh

set -e

echo "╔════════════════════════════════════════╗"
echo "║  LEX FORENSICA — Autoinstall           ║"
echo "║  Open source deps only                 ║"
echo "╚════════════════════════════════════════╝"

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js >= 18 required. Install from https://nodejs.org"
  exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo "ERROR: Node.js >= 18 required. Found: $(node -v)"
  exit 1
fi

echo "✓ Node.js $(node -v)"

# Install engine deps
echo ""
echo "Installing engine dependencies..."
cd engine
npm install --production
echo "✓ Engine deps installed"

# Prisma generate (if schema exists)
if [ -f "prisma/schema.prisma" ]; then
  npx prisma generate
  echo "✓ Prisma client generated"
else
  echo "⚠ No prisma/schema.prisma — skip generate (add schema for DB)"
fi

cd ..

# Verify
echo ""
echo "══════ VERIFY ══════"
echo "Files: $(find . -not -path './.git/*' -not -path './engine/node_modules/*' -type f | wc -l)"
echo "HTML:  architecton/index.html (open with browser, file:// works)"
echo "API:   cd engine && npm start (requires .env with GEMINI_API_KEY)"
echo ""
echo "Dependencies (all open source):"
echo "  express            MIT"
echo "  cors               MIT"
echo "  helmet             MIT"
echo "  express-rate-limit MIT"
echo "  @prisma/client     Apache-2.0"
echo "  @google/generative-ai Apache-2.0"
echo "  dotenv             BSD-2-Clause"
echo ""
echo "Zero proprietary. Zero CDN. Zero external font calls."
echo "Done."
