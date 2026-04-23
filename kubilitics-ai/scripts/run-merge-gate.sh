#!/usr/bin/env bash
# run-merge-gate.sh — benches two git refs against a single shared bench VM
# and emits a merge-gate verdict for incident-scenarios-20.
#
# Usage:
#   ./scripts/run-merge-gate.sh [base-ref] [head-ref]
#
# Defaults:
#   base-ref = main
#   head-ref = current HEAD
#
# Prereqs:
#   - AWS CLI authenticated (./deploy/bench-vm/preflight.sh will check)
#   - kotg-backend running locally on :8190 with a connected cluster
#   - Clean-ish working tree (script stashes uncommitted work and restores on exit)
#
# What it does:
#   1. Preflight + launch ONE g5.2xlarge w/ qwen2.5:32b (~15 min cold boot).
#   2. Rebuild brain at base-ref, run bench against remote Ollama, record.
#   3. Rebuild brain at head-ref, run bench against same VM, record.
#   4. Diff pass counts, count loop-traps, emit verdict.
#   5. Terminate VM (ALWAYS, even on failure).
#   6. Restore original git ref + stashed work.
#
# Hard merge gate:
#   pass(head) >= pass(base) + 1  AND  loop_traps == 0
#
# Exit codes:
#   0  gate passed
#   1  infrastructure / setup failure
#   2  gate failed (regression or loop traps)
#   3  partial run (one of the two bench runs never completed)
set -euo pipefail
cd "$(dirname "$0")/.."

BASE_REF="${1:-main}"
HEAD_REF="${2:-HEAD}"
SUITE="${SUITE:-cmd/chat-quality-bench/suites/incident-scenarios-20.json}"
STAMP="$(date +%Y%m%dT%H%M%S)"
REPORT_DIR="/tmp/merge-gate-$STAMP"
mkdir -p "$REPORT_DIR"

# Record the original ref so we can restore after switching refs.
ORIG_REF="$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse HEAD)"
STASHED=0

cleanup() {
  echo ""
  echo "=== cleanup: terminating bench VM + restoring working tree ==="
  ./deploy/bench-vm/terminate.sh || true
  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    git checkout "$ORIG_REF" 2>/dev/null || true
  fi
  if [ "$STASHED" = "1" ]; then
    git stash pop 2>/dev/null || echo "(stash pop failed — check 'git stash list')"
  fi
}
trap cleanup ERR EXIT

echo "=== step 1/5: preflight ==="
./deploy/bench-vm/preflight.sh

# Stash any uncommitted work so git checkout can move cleanly.
if ! git diff-index --quiet HEAD 2>/dev/null || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  git stash push --include-untracked -m "run-merge-gate-$STAMP" && STASHED=1
fi

echo ""
echo "=== step 2/5: launch g5.2xlarge + pull model (one-time) ==="
./deploy/bench-vm/launch-big.sh
. /tmp/bench-big.env
echo "VM ready: $OLLAMA_URL ($MODEL)"

run_bench_at_ref() {
  local ref="$1"
  local out_prefix="$2"

  echo ""
  echo "--- benching ref: $ref → $out_prefix ---"
  git checkout "$ref"

  echo "rebuild brain binary at $ref"
  go build -o server ./cmd/server

  # Write a bench-specific brain config pointing at the remote Ollama.
  cat > /tmp/config-merge-gate.yaml <<EOF
server:
  port: 28081
backend:
  address: localhost:50061
  http_base_url: http://localhost:8190
  timeout: 120
llm:
  provider: ollama
  ollama:
    base_url: $OLLAMA_URL
    model: $MODEL
database:
  type: sqlite
  sqlite_path: /tmp/merge-gate-ai.db
logging:
  level: info
  format: json
EOF

  # Kill any lingering brain process from a prior run.
  lsof -tiTCP:50051 -sTCP:LISTEN 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  lsof -tiTCP:28081 -sTCP:LISTEN 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  sleep 2

  rm -f /tmp/merge-gate-ai.db
  nohup ./server -config /tmp/config-merge-gate.yaml \
    > "$REPORT_DIR/$out_prefix-brain.log" 2>&1 &
  # Wait up to 90s for brain's gRPC to bind.
  for _ in $(seq 1 90); do
    if nc -z 127.0.0.1 50051 2>/dev/null; then break; fi
    sleep 1
  done
  if ! nc -z 127.0.0.1 50051 2>/dev/null; then
    echo "FATAL: brain did not bind :50051 within 90s at ref $ref"
    tail -30 "$REPORT_DIR/$out_prefix-brain.log"
    exit 1
  fi

  # Fetch a connected cluster id from the backend.
  local cid
  cid="$(curl -sS http://localhost:8190/api/v1/clusters | python3 -c "import sys,json; ids=[c['id'] for c in json.load(sys.stdin) if c['status']=='connected']; print(ids[0] if ids else '')")"
  if [ -z "$cid" ]; then
    echo "FATAL: no connected cluster on http://localhost:8190"
    exit 1
  fi

  rm -rf "$REPORT_DIR/$out_prefix-traces" && mkdir -p "$REPORT_DIR/$out_prefix-traces"
  curl -sf -XPOST http://localhost:28081/admin/trace-dir \
    -H 'Content-Type: application/json' \
    -d "{\"trace_dir\":\"$REPORT_DIR/$out_prefix-traces\"}" || true

  ./bin/chat-quality-bench \
    --cluster "$cid" \
    --prompts "$SUITE" \
    --concurrency 1 \
    --timeout 300s \
    --trace-dir "$REPORT_DIR/$out_prefix-traces" \
    --out "$REPORT_DIR/$out_prefix-junit.xml" \
    2>&1 | tee "$REPORT_DIR/$out_prefix-bench.log"
}

# Ensure the bench binary is present before we switch refs.
go build -o bin/chat-quality-bench ./cmd/chat-quality-bench

echo ""
echo "=== step 3/5: bench BASE ref ($BASE_REF) ==="
run_bench_at_ref "$BASE_REF" "base"

echo ""
echo "=== step 4/5: bench HEAD ref ($HEAD_REF) ==="
# Rebuild bench binary at head too — it may have changed.
git checkout "$HEAD_REF"
go build -o bin/chat-quality-bench ./cmd/chat-quality-bench
git checkout "$BASE_REF"  # run_bench_at_ref will switch back to HEAD
run_bench_at_ref "$HEAD_REF" "head"

echo ""
echo "=== step 5/5: compute verdict ==="

count_pass() { grep -c '^PASS' "$1" 2>/dev/null || echo 0; }
count_fail() { grep -c '^FAIL' "$1" 2>/dev/null || echo 0; }

BASE_PASS="$(count_pass "$REPORT_DIR/base-bench.log")"
HEAD_PASS="$(count_pass "$REPORT_DIR/head-bench.log")"
BASE_FAIL="$(count_fail "$REPORT_DIR/base-bench.log")"
HEAD_FAIL="$(count_fail "$REPORT_DIR/head-bench.log")"
BASE_TOTAL=$((BASE_PASS + BASE_FAIL))
HEAD_TOTAL=$((HEAD_PASS + HEAD_FAIL))

if [ "$BASE_TOTAL" -eq 0 ] || [ "$HEAD_TOTAL" -eq 0 ]; then
  echo "VERDICT: PARTIAL — one or both runs produced no PASS/FAIL lines"
  echo "  base: $BASE_PASS/$BASE_TOTAL, head: $HEAD_PASS/$HEAD_TOTAL"
  exit 3
fi

# Count same-tool-15×-loops on the head traces.
LOOP_TRAPS=0
if ls "$REPORT_DIR"/head-traces/*.jsonl >/dev/null 2>&1; then
  LOOP_TRAPS="$(
    for f in "$REPORT_DIR"/head-traces/*.jsonl; do
      jq -s '[
        .[]
        | select(.tool_name != null)
        | .tool_name
      ] | group_by(.) | map({name: .[0], count: length}) | map(select(.count >= 15)) | length' "$f" 2>/dev/null || echo 0
    done | awk '{s+=$1} END {print s+0}'
  )"
fi

DELTA=$((HEAD_PASS - BASE_PASS))

echo ""
echo "========================================================"
echo " MERGE GATE — incident-scenarios-20"
echo "========================================================"
echo "  BASE  ($BASE_REF):   $BASE_PASS/$BASE_TOTAL pass"
echo "  HEAD  ($HEAD_REF):   $HEAD_PASS/$HEAD_TOTAL pass"
echo "  DELTA:               $DELTA"
echo "  Same-tool-15× loops: $LOOP_TRAPS (head traces)"
echo "  Artifacts:           $REPORT_DIR/"
echo "========================================================"

PASS=1
if [ "$DELTA" -lt 1 ]; then
  echo "  ✗ Delta < +1 (gate requires ≥ +1)"
  PASS=0
fi
if [ "$LOOP_TRAPS" -ne 0 ]; then
  echo "  ✗ Loop traps present (gate requires 0)"
  PASS=0
fi

if [ "$PASS" -eq 1 ]; then
  echo "  ✓ VERDICT: PASS"
  exit 0
else
  echo "  ✗ VERDICT: FAIL — do not merge"
  exit 2
fi
