#!/usr/bin/env bash
# Setup script for new developers — installs deps, builds, verifies the environment.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Typst Serverless — setup"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "Error: Node.js is required but not found."
  echo "Install Node.js 24+ or run: devbox shell   (provides Node.js 24)"
  exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_VER" -lt 24 ]]; then
  echo "Error: Node.js 24+ is required; you have $(node -v)"
  exit 1
fi

# Optional: suggest Devbox
if ! command -v devbox &>/dev/null; then
  echo "Tip: Install Devbox for a reproducible dev env (typst, node, docker):"
  echo "  https://www.jetify.com/devbox/docs/getting-started/installation"
  echo ""
else
  echo "Devbox detected. Use 'devbox shell' for typst + node + docker."
  echo ""
fi

# npm install
echo "==> Installing dependencies..."
npm install
echo ""

# Build TypeScript
echo "==> Building TypeScript..."
npm run build
echo ""

# Run core tests (need typst in PATH — devbox provides it)
echo "==> Running core tests..."
if npm run test:core 2>/dev/null; then
  echo ""
  echo "==> Setup complete. Core tests passed."
else
  echo ""
  echo "Core tests failed. If you lack 'typst' in PATH:"
  echo "  devbox shell   # then run: npm run test:core"
  echo ""
  echo "Setup finished, but test run failed."
  exit 1
fi

echo ""
echo "Next steps:"
echo "  npm test              — full suite (core + integration; needs Docker)"
echo "  npm run test:watch    — watch mode"
echo "  docker build -t typst-serverless .   — build image"
echo "  docs/getting-started.md   — usage guide"
echo ""
