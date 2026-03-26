#!/usr/bin/env bash
# embed-winres.sh — Generate Windows resource (.syso) files for Go binaries.
#
# Embeds version info, application manifest, and icon into .syso files that
# `go build` automatically links. This gives Windows Defender / SmartScreen
# proper metadata (publisher, product name, version, icon) which significantly
# reduces false-positive malware detections for unsigned Go binaries.
#
# Usage:  ./scripts/embed-winres.sh <version>
#         e.g. ./scripts/embed-winres.sh v0.2.1
#
# Requires: go-winres (installed automatically if missing)

set -euo pipefail

VERSION="${1:?Usage: embed-winres.sh <version>}"
# Strip leading 'v' for version fields
SEMVER="${VERSION#v}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Icon to embed (shared with Tauri desktop)
ICON="$ROOT_DIR/kubilitics-desktop/src-tauri/icons/icon.ico"

# ── Install go-winres if not available ────────────────────────────────────
if ! command -v go-winres &>/dev/null; then
  echo "📦 Installing go-winres..."
  go install github.com/tc-hib/go-winres@latest
fi

# ── Parse semver into 4-part version ──────────────────────────────────────
IFS='.-' read -r MAJOR MINOR PATCH _ <<< "$SEMVER"
MAJOR="${MAJOR:-0}"
MINOR="${MINOR:-0}"
PATCH="${PATCH:-0}"
WIN_VER="$MAJOR.$MINOR.$PATCH.0"

echo "🪟 Embedding Windows resources: version=$SEMVER win_ver=$WIN_VER"

# ── Helper: generate .syso for a Go package directory ─────────────────────
generate_syso() {
  local winres_json="$1"   # path to winres.json template
  local target_dir="$2"    # Go package dir where .syso should land
  local product_name="$3"
  local label="$4"

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap "rm -rf '$tmp_dir'" RETURN

  # Copy and patch the winres.json with real version numbers
  local patched="$tmp_dir/winres.json"
  sed -e "s/0\\.0\\.0\\.0/$WIN_VER/g" \
      -e "s/\"0\\.0\\.0\"/\"$SEMVER\"/g" \
      "$winres_json" > "$patched"

  # Copy icon next to the manifest (go-winres expects it there)
  cp "$ICON" "$tmp_dir/icon.ico"

  echo "  → $label ($target_dir)"
  (cd "$tmp_dir" && go-winres make --arch amd64 --out "$target_dir/rsrc_windows_amd64.syso")
}

# ── Backend ───────────────────────────────────────────────────────────────
generate_syso \
  "$ROOT_DIR/kubilitics-backend/winres/winres.json" \
  "$ROOT_DIR/kubilitics-backend/cmd/server" \
  "Kubilitics" \
  "kubilitics-backend"

# ── kcli (cloned into ROOT/kcli during release builds) ────────────────────
if [ -d "$ROOT_DIR/kcli/cmd/kcli" ]; then
  generate_syso \
    "$ROOT_DIR/scripts/winres.json.kcli" \
    "$ROOT_DIR/kcli/cmd/kcli" \
    "Kubilitics kcli" \
    "kcli"
else
  echo "  ⚠ kcli directory not found — skipping (expected during local dev)"
fi

echo "✅ Windows resources embedded successfully"
