#!/bin/sh
# Container entrypoint. Runs Node CLI (or fallback to typst directly).
set -e
WORKSPACE="${TYPST_WORKSPACE:-/workspace}"
MAIN="${TYPST_MAIN:-main.typ}"
INPUT="${WORKSPACE}/${MAIN}"

if [ -f "$INPUT" ]; then
  # Use our Node CLI when main.typ exists and node is available
  if command -v node >/dev/null 2>&1; then
    exec node /app/dist/adapters/container/cli.js
  fi
  # Fallback: run typst directly
  OUTPUT="${TYPST_OUTPUT:-output.pdf}"
  exec typst compile --root="$WORKSPACE" "$INPUT" "${WORKSPACE}/${OUTPUT}"
else
  echo "error: input file not found at $INPUT" >&2
  exit 1
fi
