#!/usr/bin/env bash

set -euo pipefail

# Restart full Kubilitics dev stack:
# - Kill any existing dev servers on common ports
# - Start backend-dev, kubilitics-ai, and frontend-dev

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "▶ Restarting Kubilitics dev stack from: ${ROOT_DIR}"

kill_port() {
  local port="$1"
  if lsof -ti tcp:"${port}" >/dev/null 2>&1; then
    echo "  - Killing process on port ${port}"
    # shellcheck disable=SC2046
    kill -9 $(lsof -ti tcp:"${port}") || true
  fi
}

echo "▶ Killing existing dev processes on common ports (819 backend, 8081 legacy, 5173 frontend, 8190 AI)..."
kill_port 819
kill_port 8081
kill_port 5173
kill_port 8190

echo "▶ Starting backend-dev (Go API)..."
(
  cd "${ROOT_DIR}"
  make backend-dev &
)

echo "▶ Starting kubilitics-ai..."
(
  cd "${ROOT_DIR}/kubilitics-ai"
  make run &
)

echo "▶ Starting frontend-dev (Vite) ..."
(
  cd "${ROOT_DIR}/kubilitics-frontend"
  if [ ! -d node_modules ]; then
    echo "  - Installing frontend dependencies (npm install)..."
    npm install
  fi
  npm run dev &
)

echo "✅ Kubilitics backend, AI, and frontend have been started in the background."
echo "   - Backend:  http://localhost:${KUBILITICS_PORT:-819}"
echo "   - Frontend: http://localhost:5173"

#!/usr/bin/env bash

set -euo pipefail

# Restart full Kubilitics dev stack:
# - Kill any existing dev servers on common ports
# - Build backend + kubilitics-ai
# - Start backend, AI service, and frontend dev server

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "▶ Restarting Kubilitics dev stack from: ${ROOT_DIR}"

kill_port() {
  local port="$1"
  if lsof -ti tcp:"${port}" >/dev/null 2>&1; then
    echo "  - Killing process on port ${port}"
    # shellcheck disable=SC2046
    kill -9 $(lsof -ti tcp:"${port}") || true
  fi
}

echo "▶ Killing existing dev processes on common ports (8081 backend, 5173 frontend, 8190 AI)..."
kill_port 8081
kill_port 5173
kill_port 8190

echo "▶ Building backend binary..."
(
  cd "${ROOT_DIR}/kubilitics-backend"
  mkdir -p bin
  go build -o bin/kubilitics-backend ./cmd/server
)

echo "▶ Building kubilitics-ai binary..."
(
  cd "${ROOT_DIR}/kubilitics-ai"
  make build
)

echo "▶ Starting backend on :8081..."
(
  cd "${ROOT_DIR}/kubilitics-backend"
  ./bin/kubilitics-backend &
)

echo "▶ Starting kubilitics-ai on :8190..."
(
  cd "${ROOT_DIR}/kubilitics-ai"
  ./bin/kubilitics-ai &
)

echo "▶ Starting frontend dev server on :5173..."
(
  cd "${ROOT_DIR}/kubilitics-frontend"
  # Install dependencies on first run; subsequent runs will be fast
  if [ ! -d node_modules ]; then
    echo "  - Installing frontend dependencies (npm install)..."
    npm install
  fi
  npm run dev &
)

echo "✅ Kubilitics backend, AI, and frontend have been started in the background."
echo "   - Backend:     http://localhost:8081"
echo "   - Frontend:    http://localhost:5173"
echo "   - AI service:  http://localhost:8190"

#!/usr/bin/env bash
# Kill anything on backend/frontend/AI ports, build backend + AI, then start backend + kubilitics-ai + frontend.
# Backend and AI are always rebuilt so the running processes include latest Go code.
# If you see "resource topology not implemented for kind Node" (500), do a clean rebuild first: make clean && make backend, then run this script.
# If you see ECONNREFUSED 127.0.0.1:819, the backend is not listening — run this script from repo root (./scripts/restart.sh or make restart). Do not run two copies at once.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BACKEND_PORT=819
AI_PORT=8081
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
# Timeout is 60s: LoadClustersFromRepo (8s per cluster) + ListClusters enrichment (10s per cluster)
# can exceed 30s when clusters are unreachable. Migrations and addon seed add more delay.
wait_for_port() {
  local port=$1
  local max=60
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

echo "Stopping existing processes on $BACKEND_PORT, $AI_PORT and $FRONTEND_PORT..."
for port in $BACKEND_PORT $AI_PORT $FRONTEND_PORT; do kill_port $port; done
sleep 2
for port in $BACKEND_PORT $AI_PORT $FRONTEND_PORT; do kill_port $port; done
sleep 1
kill_port $BACKEND_PORT || true
kill_port $AI_PORT || true
sleep 1

echo "Building backend (kubilitics-backend/bin/kubilitics-backend)..."
make -C "$ROOT" backend || { echo "Backend build failed."; exit 1; }

echo "Building kubilitics-ai (kubilitics-ai/bin/kubilitics-ai)..."
make -C "$ROOT/kubilitics-ai" build || { echo "kubilitics-ai build failed."; exit 1; }

BACKEND_BIN="$ROOT/kubilitics-backend/bin/kubilitics-backend"
if [ ! -x "$BACKEND_BIN" ]; then
  echo "Backend binary missing after build. Run: make backend"
  exit 1
fi

AI_BIN="$ROOT/kubilitics-ai/bin/kubilitics-ai"
if [ ! -x "$AI_BIN" ]; then
  echo "kubilitics-ai binary missing after build. Run: make -C kubilitics-ai build"
  exit 1
fi

echo "Starting backend on :$BACKEND_PORT..."
# Include Tauri origins so desktop app works when it finds port already in use (e.g. make restart then open desktop).
export KUBILITICS_ALLOWED_ORIGINS="tauri://localhost,tauri://,http://localhost:5173,http://localhost:$BACKEND_PORT"
(cd "$ROOT/kubilitics-backend" && export KUBILITICS_PORT=$BACKEND_PORT && export KUBILITICS_ALLOWED_ORIGINS && exec ./bin/kubilitics-backend) &
BACKEND_PID=$!
AI_PID=""
trap 'kill $BACKEND_PID 2>/dev/null || true; [ -n "$AI_PID" ] && kill $AI_PID 2>/dev/null || true' EXIT

echo "Waiting for backend to listen..."
if ! wait_for_port $BACKEND_PORT; then
  kill $BACKEND_PID 2>/dev/null || true
  exit 1
fi
echo "Backend is ready."

mkdir -p "$ROOT/kubilitics-ai/data"
export KUBILITICS_DATABASE_PATH="$ROOT/kubilitics-ai/data/kubilitics-ai.db"
echo "Starting kubilitics-ai on :$AI_PORT..."
(cd "$ROOT/kubilitics-ai" && export KUBILITICS_DATABASE_PATH && exec ./bin/kubilitics-ai) &
AI_PID=$!
sleep 2

kill_port $FRONTEND_PORT || true
sleep 1
echo "Starting frontend on :$FRONTEND_PORT..."
cd kubilitics-frontend && npm run dev
