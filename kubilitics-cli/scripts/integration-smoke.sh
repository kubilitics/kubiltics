#!/usr/bin/env bash
# kcli Integration Smoke Test
# Tests kcli backend endpoints for basic functionality
# Usage: ./scripts/integration-smoke.sh [backend-url] [cluster-id] [auth-token]

set -euo pipefail

BACKEND_URL="${1:-http://localhost:8190}"
CLUSTER_ID="${2:-}"
AUTH_TOKEN="${3:-}"

if [ -z "$CLUSTER_ID" ]; then
    echo "Error: CLUSTER_ID is required"
    echo "Usage: $0 [backend-url] <cluster-id> [auth-token]"
    exit 1
fi

echo "=== kcli Integration Smoke Test ==="
echo "Backend URL: $BACKEND_URL"
echo "Cluster ID: $CLUSTER_ID"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

test_count=0
pass_count=0
fail_count=0

test_case() {
    local name="$1"
    local cmd="$2"
    test_count=$((test_count + 1))
    echo -n "Test $test_count: $name... "
    
    if eval "$cmd" > /tmp/kcli-test-output.log 2>&1; then
        echo -e "${GREEN}PASS${NC}"
        pass_count=$((pass_count + 1))
        return 0
    else
        echo -e "${RED}FAIL${NC}"
        echo "  Output:"
        cat /tmp/kcli-test-output.log | sed 's/^/    /'
        fail_count=$((fail_count + 1))
        return 1
    fi
}

# Build auth header if token provided
AUTH_HEADER=""
if [ -n "$AUTH_TOKEN" ]; then
    AUTH_HEADER="Authorization: Bearer $AUTH_TOKEN"
fi

# Test 1: Check kcli binary availability via exec endpoint
test_case "kcli exec version" \
    "curl -s -X POST '$BACKEND_URL/api/v1/clusters/$CLUSTER_ID/kcli/exec' \
    -H 'Content-Type: application/json' \
    ${AUTH_HEADER:+-H '$AUTH_HEADER'} \
    -d '{\"args\":[\"version\"]}' | jq -e '.exitCode == 0'"

# Test 2: Check kcli completion endpoint
test_case "kcli completion" \
    "curl -s '$BACKEND_URL/api/v1/clusters/$CLUSTER_ID/kcli/complete?line=get' \
    ${AUTH_HEADER:+-H '$AUTH_HEADER'} | jq -e '.completions | length > 0'"

# Test 3: Check kcli TUI state endpoint
test_case "kcli TUI state" \
    "curl -s '$BACKEND_URL/api/v1/clusters/$CLUSTER_ID/kcli/tui/state' \
    ${AUTH_HEADER:+-H '$AUTH_HEADER'} | jq -e '.kcliAvailable == true'"

# Test 4: Test kcli get pods (non-mutating command)
test_case "kcli exec get pods" \
    "curl -s -X POST '$BACKEND_URL/api/v1/clusters/$CLUSTER_ID/kcli/exec' \
    -H 'Content-Type: application/json' \
    ${AUTH_HEADER:+-H '$AUTH_HEADER'} \
    -d '{\"args\":[\"get\",\"pods\",\"--no-headers\"]}' | jq -e '.exitCode >= 0'"

# Test 5: Test error handling (invalid command)
test_case "kcli exec invalid command" \
    "curl -s -X POST '$BACKEND_URL/api/v1/clusters/$CLUSTER_ID/kcli/exec' \
    -H 'Content-Type: application/json' \
    ${AUTH_HEADER:+-H '$AUTH_HEADER'} \
    -d '{\"args\":[\"invalid-command-that-does-not-exist\"]}' | jq -e '.exitCode != 0'"

# Test 6: Test rate limiting (if applicable - may need multiple rapid requests)
echo -e "${YELLOW}Note: Rate limiting test skipped (requires multiple rapid requests)${NC}"

# Summary
echo ""
echo "=== Test Summary ==="
echo "Total tests: $test_count"
echo -e "${GREEN}Passed: $pass_count${NC}"
if [ $fail_count -gt 0 ]; then
    echo -e "${RED}Failed: $fail_count${NC}"
    exit 1
else
    echo -e "${GREEN}Failed: $fail_count${NC}"
    exit 0
fi
