#!/usr/bin/env bash
# fetch-backend.sh — Build kubilitics-backend (the Go API server) from the
# in-tree source at kubilitics-backend/ and drop it into
# kubilitics-desktop/src-tauri/binaries/ with Tauri's target-triple naming.
#
# Why this exists:
#   `cargo tauri dev` does NOT rebuild Go sidecars. It just copies whatever
#   is already in binaries/ into the dev bundle. If the source changes but
#   the binary is stale, you ship (or dev-test) yesterday's backend without
#   knowing it — which is exactly the "fixed 1000 times, keeps regressing"
#   bug class we've hit repeatedly. CI does the right thing inside
#   release.yml because it rebuilds from scratch; local dev used to silently
#   use stale bits.
#
#   tauri.conf.json's beforeDevCommand calls build-sidecars.sh which calls
#   this, so every `tauri dev` and `tauri build` now starts with a fresh
#   Go build. Idempotent, incremental (go build's cache), ~2–4s when nothing
#   changed, ~30s on a cold rebuild.
#
# Usage:
#   ./scripts/fetch-backend.sh                  # auto-detect arch, build from kubilitics-backend/

set -euo pipefail

BACKEND_SRC="${BACKEND_SRC:-kubilitics-backend}"
BINARIES_DIR="kubilitics-desktop/src-tauri/binaries"

if [ ! -d "$BINARIES_DIR" ]; then
  echo "ERROR: run from repo root (expected $BINARIES_DIR to exist)" >&2
  exit 1
fi
if [ ! -d "$BACKEND_SRC/cmd/server" ]; then
  echo "ERROR: backend source not found at $BACKEND_SRC/cmd/server — run from repo root" >&2
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

OUTPUT="$BINARIES_DIR/kubilitics-backend-${TRIPLE}${EXT}"

# Derive a VERSION for -ldflags from VERSION file / env / dev fallback.
if [ -n "${VERSION:-}" ]; then
  :
elif [ -f VERSION ]; then
  VERSION="$(head -n1 VERSION)"
else
  VERSION="dev"
fi

BACKEND_LDFLAGS="-s -w -X github.com/kubilitics/kubilitics-backend/internal/version.Version=${VERSION}"

echo "Building kubilitics-backend for $GOOS/$GOARCH (v${VERSION}) → $OUTPUT"
# GOWORK=off so this module builds self-contained from its own go.sum —
# mirrors exactly what CI does inside the Docker image and what the
# release workflow does on each runner. If this succeeds, the CI build
# will succeed; if it fails, fix the module before cutting a release.
(cd "$BACKEND_SRC" && GOWORK=off CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" \
  go build -ldflags="$BACKEND_LDFLAGS" -o "$OLDPWD/$OUTPUT" ./cmd/server)

chmod +x "$OUTPUT"
echo "✓ $OUTPUT"
