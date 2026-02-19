#!/usr/bin/env bash
# Kill anything on backend/frontend ports, build backend, then start backend + frontend.
# Backend is always rebuilt so the running process includes latest Go code (e.g. topology for Jobs/CronJobs).
# If you see "resource topology not implemented for kind Node" (500), do a clean rebuild first: make clean && make backend, then run this script.
# If you see ECONNREFUSED 127.0.0.1:819, the backend is not listening — run this script from repo root (./scripts/restart.sh or make restart). Do not run two copies at once.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BACKEND_PORT=819
FRONTEND_PORT=5173

kill_port() {
  local port=$1
  local pids
  pids=$(lsof -ti:$port 2>/dev/null) || true
  if [ -n "$pids" ]; then
    echo "Port $port -> killing $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
  return 0
}

# Wait for a TCP port to accept connections (backend ready). Uses nc (macOS/Linux).
wait_for_port() {
  local port=$1
  local max=30
  local n=0
  while [ $n -lt $max ]; do
    if command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 "$port" 2>/dev/null; then
      return 0
    fi
    n=$((n + 1))
    sleep 1
  done
  echo "Backend did not become ready on :$port within ${max}s"
  return 1
}

echo "Stopping existing processes on $BACKEND_PORT and $FRONTEND_PORT..."
for port in $BACKEND_PORT $FRONTEND_PORT; do kill_port $port; done
sleep 2
for port in $BACKEND_PORT $FRONTEND_PORT; do kill_port $port; done
sleep 1
kill_port $BACKEND_PORT || true
sleep 1

echo "Building backend (kubilitics-backend/bin/kubilitics-backend)..."
make -C "$ROOT" backend || { echo "Backend build failed."; exit 1; }

BACKEND_BIN="$ROOT/kubilitics-backend/bin/kubilitics-backend"
if [ ! -x "$BACKEND_BIN" ]; then
  echo "Backend binary missing after build. Run: make backend"
  exit 1
fi

echo "Starting backend on :$BACKEND_PORT..."
# Include Tauri origins so desktop app works when it finds port already in use (e.g. make restart then open desktop).
export KUBILITICS_ALLOWED_ORIGINS="tauri://localhost,tauri://,http://localhost:5173,http://localhost:$BACKEND_PORT"
(cd "$ROOT/kubilitics-backend" && export KUBILITICS_PORT=$BACKEND_PORT && export KUBILITICS_ALLOWED_ORIGINS && exec ./bin/kubilitics-backend) &
BACKEND_PID=$!
trap "kill $BACKEND_PID 2>/dev/null || true" EXIT

echo "Waiting for backend to listen..."
if ! wait_for_port $BACKEND_PORT; then
  kill $BACKEND_PID 2>/dev/null || true
  exit 1
fi
echo "Backend is ready."

kill_port $FRONTEND_PORT || true
sleep 1
echo "Starting frontend on :$FRONTEND_PORT..."
cd kubilitics-frontend && npm run dev
