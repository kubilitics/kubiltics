#!/usr/bin/env bash
# Tauri's beforeBuildCommand entrypoint.
#
# Local dev needs sidecars + frontend rebuilt before each `cargo tauri build`
# so the resulting bundle reflects current Go + TS source. CI does both
# in dedicated jobs and copies dist into place before invoking tauri, so
# rerunning here would (a) be wasteful and (b) fail on the Desktop matrix
# because `npm ci` is only run in the Frontend Dist job.
#
# Gate on $CI: GitHub Actions sets it; local shells don't.
set -euo pipefail

if [ -n "${CI:-}" ]; then
  echo "[tauri-before-build] CI detected — skipping (workflow handles sidecars + frontend)"
  exit 0
fi

cd "$(dirname "$0")/.."
bash scripts/build-sidecars.sh
cd kubilitics-frontend
TAURI_BUILD=true npm run build
