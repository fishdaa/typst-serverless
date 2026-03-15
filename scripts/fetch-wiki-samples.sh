#!/usr/bin/env bash
# Fetch sample images from Wikimedia Commons for integration tests.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES="${SCRIPT_DIR}/../test/fixtures"
IMAGES="${FIXTURES}/images"
mkdir -p "$IMAGES"
cd "$IMAGES"

curl -sL "https://upload.wikimedia.org/wikipedia/commons/2/2c/CC-0.png" -o cc0-icon.png
curl -sL "https://upload.wikimedia.org/wikipedia/commons/a/a2/Icon_pdf_file_%28smaller%29.png" -o pdf-icon.png

echo "Fetched sample images to $IMAGES"
