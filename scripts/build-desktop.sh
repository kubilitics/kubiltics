#!/bin/bash
# End-to-end desktop build: Go backend → kcli → frontend (Tauri mode) → Tauri bundle
#
# Usage:
#   ./scripts/build-desktop.sh           # Full build (all components)
#   ./scripts/build-desktop.sh --skip-ai # Skip AI binary (faster, AI disabled)
#   ./scripts/build-desktop.sh --dev     # Tauri dev mode (hot reload)

set -euo pipefail

SKIP_AI=false
DEV_MODE=false
for arg in "$@"; do
  [[ "$arg" == "--skip-ai" ]] && SKIP_AI=true
  [[ "$arg" == "--dev" ]]     && DEV_MODE=true
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "========================================"
echo "  Kubilitics Desktop Build"
echo "========================================"
echo ""

# Step 1: Build Go backend
echo "[1/5] Building Go backend..."
cd "$ROOT/kubilitics-backend"
go build -ldflags="-s -w" -o bin/kubilitics-backend ./cmd/server
echo "      ✓ kubilitics-backend built ($(du -sh bin/kubilitics-backend | cut -f1))"

# Step 2: Build kcli
echo "[2/5] Building kcli..."
cd "$ROOT/kcli"
go build -ldflags="-s -w" -o bin/kcli ./cmd/kcli
echo "      ✓ kcli built ($(du -sh bin/kcli | cut -f1))"

# Step 3: Build AI backend (optional)
if [ "$SKIP_AI" = "false" ] && [ -d "$ROOT/kubilitics-ai" ]; then
  echo "[3/5] Building AI backend..."
  cd "$ROOT/kubilitics-ai"
  if go build -ldflags="-s -w" -o bin/kubilitics-ai ./cmd/server 2>/dev/null; then
    echo "      ✓ kubilitics-ai built"
  else
    echo "      ⚠ AI build failed — AI features will be disabled (not fatal)"
  fi
else
  echo "[3/5] Skipping AI backend build (--skip-ai or not found)"
fi

# Step 4: Copy binaries to Tauri bundle directory
echo "[4/5] Preparing binaries for Tauri..."
cd "$ROOT"
chmod +x scripts/prepare-desktop-binaries.sh
if [ "$SKIP_AI" = "true" ]; then
  ./scripts/prepare-desktop-binaries.sh --skip-ai
else
  ./scripts/prepare-desktop-binaries.sh
fi

# Step 5: Build frontend in Tauri mode (relative paths, no crossorigin, no chunk splitting)
echo "[5/5] Building frontend (Tauri mode)..."
cd "$ROOT/kubilitics-frontend"
TAURI_BUILD=true npm run build:tauri
mkdir -p "$ROOT/kubilitics-desktop/dist"
# Clear old dist first to prevent stale assets
rm -rf "$ROOT/kubilitics-desktop/dist"
cp -r dist "$ROOT/kubilitics-desktop/dist"
echo "      ✓ Frontend built and copied to kubilitics-desktop/dist"

# Install desktop npm dependencies if needed
cd "$ROOT/kubilitics-desktop"
if [ ! -d "node_modules" ]; then
  echo ""
  echo "      Installing desktop npm dependencies..."
  npm install --silent
fi

# Build or run in dev mode
echo ""
if [ "$DEV_MODE" = "true" ]; then
  echo "Starting Tauri dev mode (hot reload)..."
  echo "NOTE: Backend runs as a real sidecar inside Tauri — changes to Go code require"
  echo "      stopping and re-running this script."
  echo ""
  CI=false npm run tauri -- dev
else
  echo "Building Tauri desktop app..."
  CI=false npm run tauri -- build
  echo ""
  echo "========================================"
  echo "  Build Complete!"
  echo "========================================"
  echo ""
  BUNDLE_DIR="$ROOT/kubilitics-desktop/src-tauri/target/release/bundle"
  if [ -d "$BUNDLE_DIR" ]; then
    echo "Output:"
    ls "$BUNDLE_DIR/" 2>/dev/null | sed 's/^/  /'
    echo ""
    # Show the .app or .dmg
    find "$BUNDLE_DIR" -name "*.app" -o -name "*.dmg" -o -name "*.deb" -o -name "*.AppImage" 2>/dev/null | \
      head -5 | sed 's/^/  /'
  fi
fi
