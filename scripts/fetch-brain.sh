#!/usr/bin/env bash
# fetch-brain.sh — Build kubilitics-ai-server (the AI brain) from source and
# drop it into kubilitics-desktop/src-tauri/binaries/ with Tauri's target-triple
# naming. Required for `cargo check` / `tauri dev` locally because the Rust
# build-script verifies every externalBin entry exists.
#
# CI does the same build inline in .github/workflows/release.yml — this script
# is just for local development.
#
# Usage:
#   ./scripts/fetch-brain.sh                  # auto-detect arch, build from source
#   BRAIN_REF=main ./scripts/fetch-brain.sh   # pin a specific brain ref
#   BRAIN_SRC=/path/to/kubilitics-ai ./scripts/fetch-brain.sh  # use existing clone
#
# Env vars:
#   BRAIN_REPO  — GitHub repo (default: vellankikoti/kotg.ai)
#   BRAIN_REF   — git ref to check out (default: main)
#   BRAIN_SRC   — path to existing kubilitics-ai clone (skips clone if set)

set -euo pipefail

BRAIN_REPO="${BRAIN_REPO:-vellankikoti/kotg.ai}"
BRAIN_REF="${BRAIN_REF:-main}"
BRAIN_SRC="${BRAIN_SRC:-}"
BINARIES_DIR="kubilitics-desktop/src-tauri/binaries"

if [ ! -d "$BINARIES_DIR" ]; then
  echo "ERROR: run from repo root (expected $BINARIES_DIR to exist)" >&2
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

# Clone if no source path given.
CLEANUP_CLONE=0
if [ -z "$BRAIN_SRC" ]; then
  BRAIN_SRC="$(mktemp -d)/kubilitics-ai-src"
  echo "Cloning $BRAIN_REPO@$BRAIN_REF into $BRAIN_SRC"
  git clone --depth 1 --branch "$BRAIN_REF" "https://github.com/$BRAIN_REPO.git" "$BRAIN_SRC" 2>/dev/null \
    || { git clone "https://github.com/$BRAIN_REPO.git" "$BRAIN_SRC" && git -C "$BRAIN_SRC" checkout "$BRAIN_REF"; }
  CLEANUP_CLONE=1
fi

MODULE_DIR="$BRAIN_SRC/kubilitics-ai"
[ -d "$MODULE_DIR" ] || MODULE_DIR="$BRAIN_SRC"

echo "Building kubilitics-ai-server for $GOOS/$GOARCH → $OUTPUT"
(cd "$MODULE_DIR" && CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" \
  go build -ldflags="-s -w" -o "$OLDPWD/$OUTPUT" ./cmd/server)

chmod +x "$OUTPUT"
echo "✓ $OUTPUT"

if [ "$CLEANUP_CLONE" = "1" ]; then
  rm -rf "$(dirname "$BRAIN_SRC")"
fi
