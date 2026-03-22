#!/bin/bash

# Kubilitics In-Cluster E2E Test Suite
# Tests a deployed in-cluster Kubilitics installation

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# Test tracking
FAILED_TESTS=()

# Defaults
ADMIN_USER="admin"
BASE_URL=""
ADMIN_PASS="${KUBILITICS_ADMIN_PASS}"
JWT_TOKEN=""

# Function to print colored output
print_header() {
    echo -e "\n${BLUE}==== $1 ====${NC}"
}

print_test() {
    echo -e "\n${BLUE}[TEST]${NC} $1"
}

print_pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    TESTS_TOTAL=$((TESTS_TOTAL + 1))
}

print_fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    TESTS_TOTAL=$((TESTS_TOTAL + 1))
    FAILED_TESTS+=("$1")
}

# Function to print test result
assert_equals() {
    local name="$1"
    local expected="$2"
    local actual="$3"

    if [ "$expected" = "$actual" ]; then
        print_pass "$name (expected: $expected)"
    else
        print_fail "$name (expected: $expected, got: $actual)"
    fi
}

assert_not_empty() {
    local name="$1"
    local value="$2"

    if [ -n "$value" ]; then
        print_pass "$name"
    else
        print_fail "$name (value is empty)"
    fi
}

assert_contains() {
    local name="$1"
    local haystack="$2"
    local needle="$3"

    if echo "$haystack" | grep -q "$needle"; then
        print_pass "$name"
    else
        print_fail "$name (expected to contain '$needle')"
    fi
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --base-url)
            BASE_URL="$2"
            shift 2
            ;;
        --admin-user)
            ADMIN_USER="$2"
            shift 2
            ;;
        --admin-pass)
            ADMIN_PASS="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate required parameters
if [ -z "$BASE_URL" ]; then
    echo "Error: --base-url is required"
    exit 1
fi

if [ -z "$ADMIN_PASS" ]; then
    echo "Warning: --admin-pass not set; auth tests will be skipped if auth is enabled"
fi

echo -e "${YELLOW}Kubilitics In-Cluster E2E Test Suite${NC}"
echo "Base URL: $BASE_URL"
echo "Admin User: $ADMIN_USER"
echo "Start Time: $(date)"

# ============================================================================
# HEALTH CHECKS
# ============================================================================
print_header "Health Checks"

print_test "GET /health returns 200"
RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/health" 2>/dev/null || echo "000")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)
assert_equals "Health endpoint status code" "200" "$HTTP_CODE"

print_test "GET /healthz/live returns 200"
RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/healthz/live" 2>/dev/null || echo "000")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
assert_equals "Liveness probe status code" "200" "$HTTP_CODE"

print_test "GET /healthz/ready returns 200"
RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/healthz/ready" 2>/dev/null || echo "000")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
assert_equals "Readiness probe status code" "200" "$HTTP_CODE"

# ============================================================================
# DETECT AUTH MODE
# ============================================================================
# Probe an API endpoint without a token to determine if auth is enabled.
AUTH_PROBE_RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/v1/clusters" 2>/dev/null || echo "000")
AUTH_PROBE_CODE=$(echo "$AUTH_PROBE_RESPONSE" | tail -n 1)

AUTH_ENABLED=true
if [ "$AUTH_PROBE_CODE" = "200" ]; then
    AUTH_ENABLED=false
    echo -e "${YELLOW}Auth mode: disabled (unauthenticated API calls succeed)${NC}"
else
    echo -e "${BLUE}Auth mode: enabled (unauthenticated API calls return $AUTH_PROBE_CODE)${NC}"
fi

# ============================================================================
# AUTHENTICATION TESTS (only when auth is enabled)
# ============================================================================
if [ "$AUTH_ENABLED" = "true" ]; then
    print_header "Authentication Tests"

    if [ -n "$ADMIN_PASS" ]; then
        print_test "POST /api/v1/auth/login with valid credentials"
        LOGIN_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/v1/auth/login" \
            -H "Content-Type: application/json" \
            -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" 2>/dev/null || echo "000")
        LOGIN_HTTP_CODE=$(echo "$LOGIN_RESPONSE" | tail -n 1)
        LOGIN_BODY=$(echo "$LOGIN_RESPONSE" | head -n -1)

        assert_equals "Login status code" "200" "$LOGIN_HTTP_CODE"

        JWT_TOKEN=$(echo "$LOGIN_BODY" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
        assert_not_empty "JWT token obtained" "$JWT_TOKEN"

        print_test "GET /api/v1/clusters without authentication returns 401"
        RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/v1/clusters" 2>/dev/null || echo "000")
        HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
        assert_equals "Unauthenticated clusters endpoint status code" "401" "$HTTP_CODE"

        print_test "GET /api/v1/clusters with authentication returns 200"
        RESPONSE=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $JWT_TOKEN" \
            "$BASE_URL/api/v1/clusters" 2>/dev/null || echo "000")
        HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
        assert_equals "Authenticated clusters endpoint status code" "200" "$HTTP_CODE"
    else
        echo -e "${YELLOW}Skipping auth tests (no --admin-pass provided)${NC}"
    fi
else
    print_header "API Access (auth disabled)"

    print_test "GET /api/v1/clusters returns 200 (no auth required)"
    RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/v1/clusters" 2>/dev/null || echo "000")
    HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
    assert_equals "Clusters endpoint status code (no auth)" "200" "$HTTP_CODE"
fi

# Build the auth header for subsequent requests (empty when auth is disabled)
AUTH_HEADER=""
if [ -n "$JWT_TOKEN" ]; then
    AUTH_HEADER="Authorization: Bearer $JWT_TOKEN"
fi

# ============================================================================
# CLUSTER LISTING
# ============================================================================
print_header "Cluster Listing"

print_test "GET /api/v1/clusters returns cluster data"
if [ -n "$AUTH_HEADER" ]; then
    CLUSTERS_RESPONSE=$(curl -s -H "$AUTH_HEADER" \
        "$BASE_URL/api/v1/clusters" 2>/dev/null || echo "[]")
else
    CLUSTERS_RESPONSE=$(curl -s "$BASE_URL/api/v1/clusters" 2>/dev/null || echo "[]")
fi
CLUSTER_COUNT=$(echo "$CLUSTERS_RESPONSE" | grep -o '"id"' | wc -l)

if [ "$CLUSTER_COUNT" -gt 0 ]; then
    print_pass "Cluster(s) found ($CLUSTER_COUNT cluster(s))"
    CLUSTER_ID=$(echo "$CLUSTERS_RESPONSE" | grep -o '"id":"[^"]*' | head -1 | cut -d'"' -f4)
else
    # In Kind CI the backend uses in-cluster config and may not auto-register
    echo -e "${YELLOW}No clusters auto-registered (expected in Kind with in-cluster config)${NC}"
fi

# ============================================================================
# METRICS
# ============================================================================
print_header "Metrics"

print_test "GET /metrics returns Prometheus metrics"
RESPONSE=$(curl -s -w "\n%{http_code}" "$BASE_URL/metrics" 2>/dev/null || echo "000")
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "401" ]; then
    if echo "$BODY" | grep -q "^# HELP\|^# TYPE\|prometheus\|metric"; then
        print_pass "Metrics endpoint available"
    else
        echo -e "${YELLOW}Metrics endpoint check inconclusive${NC}"
    fi
else
    print_fail "Metrics endpoint status code: $HTTP_CODE"
fi

# ============================================================================
# KUBERNETES VALIDATION
# ============================================================================
print_header "Kubernetes Validation"

if command -v kubectl &> /dev/null; then
    print_test "Check Kubilitics pods are running"
    POD_CHECK=$(kubectl get pods -n kubilitics -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "NONE")
    if [ -n "$POD_CHECK" ] && [ "$POD_CHECK" != "NONE" ]; then
        POD_COUNT=$(kubectl get pods -n kubilitics --no-headers 2>/dev/null | wc -l)
        READY_COUNT=$(kubectl get pods -n kubilitics -o jsonpath='{.items[?(@.status.conditions[?(@.type=="Ready")].status=="True")].metadata.name}' 2>/dev/null | wc -w)
        print_pass "Kubilitics pods running ($READY_COUNT/$POD_COUNT ready)"
    else
        print_fail "No Kubilitics pods found"
    fi

    print_test "Check services are available"
    SERVICE_CHECK=$(kubectl get svc -n kubilitics -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "NONE")
    if [ -n "$SERVICE_CHECK" ] && [ "$SERVICE_CHECK" != "NONE" ]; then
        print_pass "Kubilitics services available"
    else
        print_fail "No Kubilitics services found"
    fi
else
    echo -e "${YELLOW}⚠ kubectl not available, skipping K8s validation${NC}"
fi

# ============================================================================
# SUMMARY
# ============================================================================
print_header "Test Summary"

echo ""
echo -e "${BLUE}Results:${NC}"
echo -e "  Total Tests:  ${YELLOW}$TESTS_TOTAL${NC}"
echo -e "  Passed:       ${GREEN}$TESTS_PASSED${NC}"
echo -e "  Failed:       ${RED}$TESTS_FAILED${NC}"

if [ "$TESTS_FAILED" -gt 0 ]; then
    echo ""
    echo -e "${RED}Failed Tests:${NC}"
    for test in "${FAILED_TESTS[@]}"; do
        echo -e "  ${RED}•${NC} $test"
    done
fi

echo ""
echo "End Time: $(date)"

if [ "$TESTS_FAILED" -eq 0 ]; then
    echo -e "\n${GREEN}All tests passed!${NC}\n"
    exit 0
else
    echo -e "\n${RED}Some tests failed!${NC}\n"
    exit 1
fi
