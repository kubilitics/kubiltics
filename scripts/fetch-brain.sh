#!/usr/bin/env bash
# fetch-brain.sh — Build kubilitics-ai-server (the AI brain) from the
# in-tree source at brain/ and drop it into kubilitics-desktop/src-tauri/
# binaries/ with Tauri's target-triple naming. Required for `cargo check`
# / `tauri dev` locally because the Rust build-script verifies every
# externalBin entry exists.
#
# CI does the same build inline in .github/workflows/release.yml — this
# script is just for local development.
#
# Post-monorepo-migration: the brain lives at ./brain/ in this repo, so
# no clone / BRAIN_REPO / BRAIN_REF env vars are needed anymore.
#
# Usage:
#   ./scripts/fetch-brain.sh                  # auto-detect arch, build from brain/

set -euo pipefail

BRAIN_SRC="${BRAIN_SRC:-brain}"
BINARIES_DIR="kubilitics-desktop/src-tauri/binaries"

if [ ! -d "$BINARIES_DIR" ]; then
  echo "ERROR: run from repo root (expected $BINARIES_DIR to exist)" >&2
  exit 1
fi
if [ ! -d "$BRAIN_SRC/cmd/server" ]; then
  echo "ERROR: brain source not found at $BRAIN_SRC/cmd/server — run from repo root" >&2
  exit 1
fi

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  x86_64|amd64)  ARCH="x86_64" ;;
  arm64|aarch64) ARCH="aarch64" ;;
  *) echo "ERROR: Unsupported arch $arch" >&2; exit 1 ;;
esac
case "$os" in
  darwin)
    GOOS=darwin
    case "$ARCH" in
      x86_64)  GOARCH=amd64 ;;
      aarch64) GOARCH=arm64 ;;
    esac
    TRIPLE="$ARCH-apple-darwin"
    EXT=""
    ;;
  linux)
    GOOS=linux
    case "$ARCH" in
      x86_64)  GOARCH=amd64 ;;
      aarch64) GOARCH=arm64 ;;
    esac
    TRIPLE="$ARCH-unknown-linux-gnu"
    EXT=""
    ;;
  *)
    echo "ERROR: Unsupported OS $os" >&2; exit 1 ;;
esac

OUTPUT="$BINARIES_DIR/kubilitics-ai-server-${TRIPLE}${EXT}"

echo "Building kubilitics-ai-server for $GOOS/$GOARCH → $OUTPUT"
(cd "$BRAIN_SRC" && CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" \
  go build -ldflags="-s -w" -o "$OLDPWD/$OUTPUT" ./cmd/server)

chmod +x "$OUTPUT"
echo "✓ $OUTPUT"
