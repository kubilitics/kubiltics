#!/usr/bin/env bash
# dev-preflight.sh — clear stale dev processes before `cargo tauri dev`.
#
# Why: Kubilitics binds fixed ports (Headlamp-style fail-loud — see
# kubilitics-desktop/src-tauri/src/sidecar.rs). If a previous `cargo tauri dev`
# crashed, its kubilitics-backend, kubilitics-ai-server, or vite child can be
# left holding 8190 / 8081 / 5173 / 50061. The next `cargo tauri dev` would
# then refuse to start the sidecar with a port-conflict error. This script
# kills any listener on those ports so a fresh dev session always launches
# clean.
#
# Only runs on macOS/Linux (lsof). Windows dev users: handle manually with
# `Get-NetTCPConnection -LocalPort 8190 | Select OwningProcess` + `taskkill`.
#
# Wired into tauri.conf.json's beforeDevCommand. Skipped from production
# build (beforeBuildCommand) — never kill processes during `cargo tauri build`.

set -euo pipefail

if ! command -v lsof >/dev/null 2>&1; then
  # Windows / minimal container — skip silently. Fail-loud port check in the
  # Rust sidecar will still produce a clear error if a port is held.
  exit 0
fi

# 8190 — kubilitics-backend (HTTP)
# 8081 — kubilitics-ai-server (HTTP)
# 50061 — kubilitics-ai-server (gRPC)
# 5173 — Vite dev server (frontend)
PORTS=(8190 8081 50061 5173)

for port in "${PORTS[@]}"; do
  pids="$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "${pids}" ]; then
    echo "dev-preflight: freeing :${port} (PIDs: ${pids//$'\n'/ })" >&2
    # shellcheck disable=SC2086
    kill -9 ${pids} 2>/dev/null || true
  fi
done

# Brief pause so the kernel actually releases the sockets before the sidecar
# tries to bind. Without this, cargo tauri dev sometimes still sees TIME_WAIT.
sleep 0.3
