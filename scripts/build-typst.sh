#!/usr/bin/env bash
# Builds the typst CLI binary from the fishdaa/typst fork (branch: optimize-large-png)
# instead of relying on the upstream release. Prefers a local sibling checkout at
# ../typst (so in-progress fork changes are picked up immediately); falls back to
# cloning the public repo into .typst-src/ otherwise.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$ROOT_DIR/.bin"
OUT_BIN="$BIN_DIR/typst"
STAMP_FILE="$BIN_DIR/.typst-rev"

TYPST_SRC_DIR="${TYPST_SRC_DIR:-$ROOT_DIR/../typst}"
TYPST_REPO="${TYPST_REPO:-https://github.com/fishdaa/typst.git}"
TYPST_REF="${TYPST_REF:-optimize-large-png}"

mkdir -p "$BIN_DIR"

if [[ -d "$TYPST_SRC_DIR/.git" ]]; then
  SRC_DIR="$TYPST_SRC_DIR"
  echo "==> Using local typst checkout: $SRC_DIR"
else
  SRC_DIR="$ROOT_DIR/.typst-src"
  if [[ ! -d "$SRC_DIR/.git" ]]; then
    # Use init+fetch rather than `git clone` so this tolerates a directory
    # that already contains files (e.g. a CI cache restoring .typst-src/target
    # ahead of time) — clone requires an empty destination, fetch does not.
    echo "==> Fetching $TYPST_REPO ($TYPST_REF) into $SRC_DIR"
    mkdir -p "$SRC_DIR"
    git -C "$SRC_DIR" init -q
    git -C "$SRC_DIR" remote add origin "$TYPST_REPO"
    git -C "$SRC_DIR" fetch --depth 1 origin "$TYPST_REF"
    git -C "$SRC_DIR" checkout -q --detach FETCH_HEAD
  else
    echo "==> Updating $SRC_DIR to latest $TYPST_REF"
    git -C "$SRC_DIR" fetch --depth 1 origin "$TYPST_REF"
    git -C "$SRC_DIR" checkout -q --detach FETCH_HEAD
  fi
fi

CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$SRC_DIR/target}"
REV="$(git -C "$SRC_DIR" rev-parse HEAD)$(git -C "$SRC_DIR" diff --quiet 2>/dev/null || echo '-dirty')"

if [[ -x "$OUT_BIN" && -f "$STAMP_FILE" && "$(cat "$STAMP_FILE")" == "$REV" ]]; then
  echo "==> typst binary already up to date ($REV)"
  exit 0
fi

echo "==> Building typst-cli (release) from $SRC_DIR @ $REV"
(cd "$SRC_DIR" && CARGO_TARGET_DIR="$CARGO_TARGET_DIR" cargo build --release --locked -p typst-cli)

cp "$CARGO_TARGET_DIR/release/typst" "$OUT_BIN"
chmod +x "$OUT_BIN"
echo "$REV" > "$STAMP_FILE"
echo "==> Built $OUT_BIN"
