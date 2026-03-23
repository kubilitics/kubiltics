#!/usr/bin/env bash
# pre-release-check.sh — Run ALL release-gate checks locally before tagging.
# Exits 1 on ANY failure.  Run from the repo root.
#
# Usage:
#   ./scripts/pre-release-check.sh [expected-version]
#
# If expected-version is provided, all version files are checked against it.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0

pass() { echo -e "${GREEN}PASS${NC}: $1"; }
fail() { echo -e "${RED}FAIL${NC}: $1"; ERRORS=$((ERRORS + 1)); }
info() { echo -e "${YELLOW}----${NC} $1"; }

# ── Ensure we're at repo root ────────────────────────────────────────────
if [ ! -f "kubilitics-frontend/package.json" ]; then
  echo "ERROR: Run this script from the repository root."
  exit 1
fi

EXPECTED_VERSION="${1:-}"

echo "=============================================="
echo "  Kubilitics Pre-Release Check"
echo "=============================================="
echo ""

# ── 1. Version consistency ───────────────────────────────────────────────
info "1/6  Version consistency check"

FRONTEND_VERSION=$(jq -r '.version' kubilitics-frontend/package.json)
TAURI_VERSION=$(jq -r '.version' kubilitics-desktop/src-tauri/tauri.conf.json)
CARGO_VERSION=$(grep '^version' kubilitics-desktop/src-tauri/Cargo.toml | head -1 | sed 's/.*"\(.*\)".*/\1/')
CHART_VERSION=$(grep '^version:' deploy/helm/kubilitics/Chart.yaml | awk '{print $2}')
APP_VERSION=$(grep '^appVersion:' deploy/helm/kubilitics/Chart.yaml | sed 's/appVersion: *"\(.*\)"/\1/')

echo "  frontend/package.json:  $FRONTEND_VERSION"
echo "  tauri.conf.json:        $TAURI_VERSION"
echo "  Cargo.toml:             $CARGO_VERSION"
echo "  Chart.yaml version:     $CHART_VERSION"
echo "  Chart.yaml appVersion:  $APP_VERSION"

if [ -n "$EXPECTED_VERSION" ]; then
  REF_VERSION="$EXPECTED_VERSION"
  echo "  Expected (from arg):    $REF_VERSION"
else
  REF_VERSION="$FRONTEND_VERSION"
fi

ALL_MATCH=true
for V in "$FRONTEND_VERSION" "$TAURI_VERSION" "$CARGO_VERSION" "$CHART_VERSION" "$APP_VERSION"; do
  if [ "$V" != "$REF_VERSION" ]; then
    ALL_MATCH=false
  fi
done

if $ALL_MATCH; then
  pass "All version files match ($REF_VERSION)"
else
  fail "Version files are out of sync — bump all together before tagging"
fi
echo ""

# ── 2. Backend build + tests + govulncheck ───────────────────────────────
info "2/6  Backend build + tests + govulncheck"

if (cd kubilitics-backend && go build ./cmd/server 2>&1); then
  pass "Backend builds"
else
  fail "Backend build failed"
fi

if (cd kubilitics-backend && go test -count=1 ./... 2>&1); then
  pass "Backend tests pass"
else
  fail "Backend tests failed"
fi

if command -v govulncheck &> /dev/null; then
  if (cd kubilitics-backend && govulncheck ./... 2>&1); then
    pass "Backend govulncheck clean"
  else
    fail "Backend govulncheck found vulnerabilities"
  fi
else
  info "govulncheck not installed — skipping (install with: go install golang.org/x/vuln/cmd/govulncheck@latest)"
fi
echo ""

# ── 3. Frontend build + checks ──────────────────────────────────────────
info "3/6  Frontend circular dependency check"

if (cd kubilitics-frontend && npx madge --circular --extensions ts,tsx src/ 2>&1); then
  pass "No circular dependencies"
else
  fail "Circular imports detected — these cause TDZ crashes in production builds"
fi
echo ""

info "4/6  Frontend build + Rollup warning check"

BUILD_LOG=$(mktemp)
if (cd kubilitics-frontend && npm run build 2>&1 | tee "$BUILD_LOG"); then
  pass "Frontend builds"
else
  fail "Frontend build failed"
fi

if grep -q "dynamically imported but also statically imported" "$BUILD_LOG"; then
  fail "Mixed dynamic/static imports detected — causes TDZ crashes in production"
elif grep -q "Circular dependency" "$BUILD_LOG"; then
  fail "Rollup detected circular dependency during bundling"
else
  pass "No dangerous Rollup warnings"
fi
rm -f "$BUILD_LOG"
echo ""

# ── 5. Production build smoke test ──────────────────────────────────────
info "5/6  Production build smoke test"

if [ -d "kubilitics-frontend/dist" ]; then
  (cd kubilitics-frontend && npx serve dist -l 4173 &)
  SERVE_PID=$!
  sleep 3

  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/ 2>/dev/null || echo "000")
  if [ "$HTTP_STATUS" = "200" ]; then
    PAGE=$(curl -s http://localhost:4173/)
    if echo "$PAGE" | grep -q 'id="root"' && echo "$PAGE" | grep -q '<script'; then
      pass "Build smoke test — page loads with root element and scripts"
    else
      fail "Build smoke test — page loads but missing root element or scripts"
    fi
  else
    fail "Build smoke test — HTTP status $HTTP_STATUS (expected 200)"
  fi

  kill $SERVE_PID 2>/dev/null || true
else
  fail "Frontend dist/ directory missing — build step may have failed"
fi
echo ""

# ── 6. Frontend tests ───────────────────────────────────────────────────
info "6/6  Frontend tests"

if (cd kubilitics-frontend && npm run test 2>&1); then
  pass "Frontend tests pass"
else
  fail "Frontend tests failed"
fi
echo ""

# ── Summary ──────────────────────────────────────────────────────────────
echo "=============================================="
if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}ALL CHECKS PASSED${NC} — safe to tag and release"
  exit 0
else
  echo -e "${RED}$ERRORS CHECK(S) FAILED${NC} — fix before tagging"
  exit 1
fi
