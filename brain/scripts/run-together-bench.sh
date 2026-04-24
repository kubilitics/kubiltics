#!/usr/bin/env bash
# API-only bench driver — no VM boot, no model pull. Points the brain at
# Together.ai via the OpenAI-compatible endpoint and runs
# incident-scenarios-20 with the topic-aware tool router ON.
#
# Expected runtime: ~5-10 min end to end (20 prompts × avg ~15s each on
# Llama 3.3 70B Turbo, plus cold-start + report gen).
#
# This script is for iteration. No pass-rate gate, no cost tag. Use
# run-investor-bench.sh for gated validation runs.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${TOGETHER_API_KEY:?TOGETHER_API_KEY must be set}"

STAMP=$(date +%F-%H%M)
REPORT_DIR="docs/reports/${STAMP}-together-bench"
mkdir -p "$REPORT_DIR/traces"

echo "=== 1/7 kill any stale brain ==="
lsof -tiTCP:50051 -sTCP:LISTEN 2>/dev/null | xargs -r kill -9 2>/dev/null || true
lsof -tiTCP:28081 -sTCP:LISTEN 2>/dev/null | xargs -r kill -9 2>/dev/null || true
sleep 1

echo "=== 2/7 build server + bench binaries ==="
go build -o server ./cmd/server
go build -o bin/chat-quality-bench ./cmd/chat-quality-bench
go build -o bin/bench-report ./cmd/bench-report
go build -o bin/tool-catalog ./cmd/tool-catalog

echo "=== 3/7 launch brain with Together.ai config (tool router ON) ==="
nohup ./server -config config-bench-together.yaml > /tmp/brain-together.log 2>&1 &
BRAIN_PID=$!
trap 'echo "=== shutting down brain (pid=$BRAIN_PID) ==="; kill "$BRAIN_PID" 2>/dev/null || true' EXIT

ready=0
for i in $(seq 1 90); do
  if nc -z 127.0.0.1 50051 2>/dev/null; then
    echo "brain ready on :50051 (after ${i}s)"
    ready=1
    break
  fi
  sleep 1
done
tail -5 /tmp/brain-together.log || true
if [ "$ready" != "1" ]; then
  echo "FATAL: brain did not bind :50051 within 90s"
  tail -40 /tmp/brain-together.log || true
  exit 1
fi

echo "=== 4/7 find connected cluster id ==="
CID=$(curl -sS http://localhost:8190/api/v1/clusters | python3 -c "import sys,json; ids=[c['id'] for c in json.load(sys.stdin) if c['status']=='connected']; print(ids[0] if ids else '')")
test -n "$CID" || { echo "no connected cluster on backend :8190"; exit 1; }
echo "cluster: $CID"

echo "=== 5/7 arm trace capture ==="
rm -rf /tmp/traces-together && mkdir -p /tmp/traces-together
curl -sf -XPOST http://localhost:28081/admin/trace-dir \
  -H 'Content-Type: application/json' \
  -d '{"trace_dir":"/tmp/traces-together"}'

echo "=== 6/7 run incident-scenarios-20 ==="
SUITE="${SUITE:-cmd/chat-quality-bench/suites/incident-scenarios-20.json}"
./bin/chat-quality-bench --cluster "$CID" \
  --prompts "$SUITE" \
  --concurrency 1 --timeout 300s \
  --trace-dir /tmp/traces-together \
  --out /tmp/bench-together-junit.xml \
  2>&1 | tee /tmp/bench-together.log

pass=$(grep -c '^PASS' /tmp/bench-together.log || true)
total=$(grep -cE '^(PASS|FAIL)' /tmp/bench-together.log || true)
if [ "${total:-0}" -gt 0 ]; then
  pct=$((100*pass/total))
  echo "incident-scenarios-20 pass rate: $pct% ($pass/$total)"
else
  echo "no PASS/FAIL lines parsed from bench log — check $(pwd)/bench-together.log"
fi

echo "=== 7/7 generate report ==="
./bin/tool-catalog --plain-english docs/reports/plain-english.json --out "$REPORT_DIR/tool-catalog.json" || true
cp /tmp/traces-together/*.jsonl "$REPORT_DIR/traces/" 2>/dev/null || true
cp /tmp/bench-together-junit.xml "$REPORT_DIR/junit.xml" || true
./bin/bench-report --v2 \
  --junit "$REPORT_DIR/junit.xml" \
  --traces /tmp/traces-together \
  --catalog "$REPORT_DIR/tool-catalog.json" \
  --suite-file "$SUITE" \
  --suite "incident-scenarios-20 on Together.ai Llama 3.3 70B Turbo (tool router ON)" \
  --out "$REPORT_DIR/report.html" || true

echo "=== done — report at $REPORT_DIR/report.html ==="
