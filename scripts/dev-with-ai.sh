#!/usr/bin/env bash
# Full local stack with AI: backend (HTTP 819 + gRPC 50051), kubilitics-ai (8081), frontend dev (5173).
# Use this to test the AI Assistant (Kubilitics AI) before release.
# Prerequisites: LLM configured (e.g. Settings → AI: OpenAI/Anthropic/Ollama URL + API key if needed).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Building backend ==="
make -C "$ROOT" backend || { echo "Backend build failed."; exit 1; }

echo "=== Building kubilitics-ai ==="
make -C "$ROOT/kubilitics-ai" build || { echo "kubilitics-ai build failed."; exit 1; }

echo "=== Starting Kubilitics backend (HTTP :819, gRPC :50051) ==="
(cd kubilitics-backend && ./bin/kubilitics-backend) &
BACKEND_PID=$!
AI_PID=""
trap 'kill $BACKEND_PID 2>/dev/null || true; [ -n "$AI_PID" ] && kill $AI_PID 2>/dev/null || true' EXIT

sleep 3
# Use local SQLite so AI starts without /var/lib/kubilitics (e.g. in dev).
mkdir -p "$ROOT/kubilitics-ai/data"
export KUBILITICS_DATABASE_PATH="$ROOT/kubilitics-ai/data/kubilitics-ai.db"
echo "=== Starting Kubilitics AI (HTTP :8081, connects to backend gRPC :50051) ==="
(cd kubilitics-ai && ./bin/kubilitics-ai) &
AI_PID=$!

sleep 2
echo "=== Starting Kubilitics frontend (dev server :5173) ==="
echo ""
echo "  Backend:    http://localhost:819"
echo "  AI backend: http://localhost:8081  (WebSocket: ws://localhost:8081)"
echo "  Frontend:   http://localhost:5173"
echo ""
echo "  Open http://localhost:5173 and use the AI Assistant to test."
echo "  Configure AI in Settings if needed (API key, provider, WebSocket URL)."
echo ""
cd kubilitics-frontend && npm run dev
