#!/usr/bin/env bash
# desktop.sh — start | stop | restart the full Kubilitics desktop dev stack
#
# Usage:
#   ./scripts/desktop.sh start    — kill stale processes, build sidecars, launch Tauri dev
#   ./scripts/desktop.sh stop     — kill all kubilitics processes and dev-server ports
#   ./scripts/desktop.sh restart  — stop then start

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="/tmp/tauri-dev.log"

# --- helpers ---

kill_port() {
  local port=$1
  local pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null) || true
  if [ -n "$pids" ]; then
    printf "  port %-6s → killing %s\n" "$port" "$pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
}

kill_by_name() {
  local pattern=$1
  local pids
  pids=$(pgrep -f "$pattern" 2>/dev/null) || true
  if [ -n "$pids" ]; then
    printf "  %-30s → killing %s\n" "$pattern" "$pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
}

do_stop() {
  echo "▶ Stopping Kubilitics desktop stack..."

  # Kill sidecar binaries by name
  kill_by_name "kubilitics-backend"
  kill_by_name "kubilitics-ai-server"
  # Kill Tauri app and its runner
  kill_by_name "Kubilitics"
  kill_by_name "tauri dev"
  # Kill the Vite dev server
  kill_by_name "vite"
  # Belt-and-suspenders: also wipe by port
  for port in 8190 8081 50051 50061 5173; do
    kill_port "$port"
  done

  sleep 1
  echo "✅ Stopped."
}

do_start() {
  echo "▶ Starting Kubilitics desktop dev stack..."
  echo "   Logs also written to $LOG"

  cd "$ROOT/kubilitics-desktop"

  if [ ! -d node_modules ]; then
    echo "  Installing kubilitics-desktop npm deps..."
    npm install
  fi

  # beforeDevCommand (tauri.conf.json) handles:
  #   1. dev-preflight.mjs  — port cleanup
  #   2. build-sidecars.sh  — go build backend + brain + kcli into src-tauri/binaries/
  #   3. npm run dev        — Vite hot-reload frontend
  # Then Tauri opens the native window.
  # We tee to a log file so you can tail it in another terminal if needed.
  npm run tauri:dev 2>&1 | tee "$LOG"
}

do_restart() {
  do_stop
  do_start
}

# --- main ---

CMD="${1:-help}"
case "$CMD" in
  start)   do_start ;;
  stop)    do_stop ;;
  restart) do_restart ;;
  *)
    echo "Usage: $(basename "$0") {start|stop|restart}"
    echo ""
    echo "  start    Kill stale processes, build sidecars, launch Tauri dev window"
    echo "  stop     Kill all kubilitics processes and dev-server ports"
    echo "  restart  stop + start (clean relaunch)"
    exit 1
    ;;
esac
