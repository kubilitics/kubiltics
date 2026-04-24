#!/usr/bin/env bash
# build-sidecars.sh — Rebuild every Go/Rust sidecar the desktop app needs,
# before `cargo tauri dev` / `cargo tauri build` runs.
#
# Ordering: backend → brain → kcli. All three are independent so order
# only matters for predictable log output.
#
# Called from tauri.conf.json's beforeDevCommand and beforeBuildCommand.
# Must be cheap on the no-change path (incremental go build ≈ 1-2s per
# sidecar when nothing changed). Must be loud on failure — if any sidecar
# build breaks, `tauri dev` should fail before the webview opens, not
# spawn a stale binary and mask the problem.

set -euo pipefail

# Resolve repo root relative to this script so it runs correctly regardless
# of caller CWD (Tauri runs beforeDevCommand from src-tauri/).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "━━━ building sidecars ━━━"

bash scripts/fetch-backend.sh
bash scripts/fetch-brain.sh

# kcli is optional for local dev — fetch-kcli.sh downloads a release
# binary. If GitHub is unreachable or a release asset is missing, keep
# going: the backend falls back to PATH / common install locations.
if ! bash scripts/fetch-kcli.sh; then
  echo "⚠ kcli build/download failed — continuing (backend will use PATH kcli)." >&2
fi

echo "━━━ sidecars ready ━━━"
