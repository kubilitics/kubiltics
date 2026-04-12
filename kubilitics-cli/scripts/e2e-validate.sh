#!/usr/bin/env bash
#
# kcli Comprehensive E2E Validation Script
# Runs every kcli command against a live cluster and validates output content.
# Usage: ./scripts/e2e-validate.sh [path-to-kcli-binary]
#
set -euo pipefail

KCLI="${1:-$(which kcli 2>/dev/null || echo /opt/homebrew/bin/kcli)}"
PASS=0
FAIL=0
SKIP=0
BUGS=()

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Use a temp dir for state so we don't corrupt real ~/.kcli
export KCLI_HOME_DIR="$(mktemp -d)"
trap "rm -rf $KCLI_HOME_DIR" EXIT

# ─── Test Helpers ──────────────────────────────────────────────────────────

# run_test: Run a command and check it succeeds (exit 0)
run_test() {
    local name="$1"; shift
    printf "  %-60s " "$name"
    local output
    if output=$("$@" 2>&1); then
        echo -e "${GREEN}PASS${NC}"
        PASS=$((PASS + 1))
        return 0
    else
        local ec=$?
        if echo "$output" | grep -qiE "connection refused|unable to connect|not found|forbidden|metrics.*not available"; then
            echo -e "${YELLOW}SKIP${NC}"
            SKIP=$((SKIP + 1))
        else
            echo -e "${RED}FAIL${NC} (exit=$ec)"
            echo "    $(echo "$output" | head -2)"
            FAIL=$((FAIL + 1))
            BUGS+=("$name: exit=$ec")
        fi
        return 1
    fi
}

# assert_contains: Run command, check output contains expected string
assert_contains() {
    local name="$1"; shift
    local expected="$1"; shift
    printf "  %-60s " "$name"
    local output
    if output=$("$@" 2>&1); then
        if echo "$output" | grep -qF "$expected"; then
            echo -e "${GREEN}PASS${NC}"
            PASS=$((PASS + 1))
        else
            echo -e "${RED}FAIL${NC} (missing: $expected)"
            FAIL=$((FAIL + 1))
            BUGS+=("$name: output missing '$expected'")
        fi
    else
        local ec=$?
        if echo "$output" | grep -qiE "connection refused|unable to connect|forbidden|metrics.*not available"; then
            echo -e "${YELLOW}SKIP${NC}"
            SKIP=$((SKIP + 1))
        else
            echo -e "${RED}FAIL${NC} (exit=$ec)"
            FAIL=$((FAIL + 1))
            BUGS+=("$name: exit=$ec")
        fi
    fi
}

# assert_regex: Run command, check output matches regex
assert_regex() {
    local name="$1"; shift
    local pattern="$1"; shift
    printf "  %-60s " "$name"
    local output
    if output=$("$@" 2>&1); then
        if echo "$output" | grep -qE "$pattern"; then
            echo -e "${GREEN}PASS${NC}"
            PASS=$((PASS + 1))
        else
            echo -e "${RED}FAIL${NC} (no match: $pattern)"
            FAIL=$((FAIL + 1))
            BUGS+=("$name: output didn't match /$pattern/")
        fi
    else
        local ec=$?
        if echo "$output" | grep -qiE "connection refused|unable to connect|forbidden"; then
            echo -e "${YELLOW}SKIP${NC}"
            SKIP=$((SKIP + 1))
        else
            echo -e "${RED}FAIL${NC} (exit=$ec)"
            FAIL=$((FAIL + 1))
            BUGS+=("$name: exit=$ec")
        fi
    fi
}

# assert_json: Run command, check output is valid JSON
assert_json() {
    local name="$1"; shift
    printf "  %-60s " "$name"
    local output
    if output=$("$@" 2>&1); then
        if echo "$output" | python3 -m json.tool > /dev/null 2>&1; then
            echo -e "${GREEN}PASS${NC}"
            PASS=$((PASS + 1))
        else
            echo -e "${RED}FAIL${NC} (invalid JSON)"
            FAIL=$((FAIL + 1))
            BUGS+=("$name: output is not valid JSON")
        fi
    else
        local ec=$?
        echo -e "${RED}FAIL${NC} (exit=$ec)"
        FAIL=$((FAIL + 1))
        BUGS+=("$name: exit=$ec")
    fi
}

# assert_count: Run command, check output line count meets minimum
assert_count() {
    local name="$1"; shift
    local min_lines="$1"; shift
    printf "  %-60s " "$name"
    local output
    if output=$("$@" 2>&1); then
        local count
        count=$(echo "$output" | wc -l | tr -d ' ')
        if [[ $count -ge $min_lines ]]; then
            echo -e "${GREEN}PASS${NC} ($count lines)"
            PASS=$((PASS + 1))
        else
            echo -e "${RED}FAIL${NC} (got $count lines, expected >=$min_lines)"
            FAIL=$((FAIL + 1))
            BUGS+=("$name: only $count lines, expected >=$min_lines")
        fi
    else
        local ec=$?
        echo -e "${RED}FAIL${NC} (exit=$ec)"
        FAIL=$((FAIL + 1))
        BUGS+=("$name: exit=$ec")
    fi
}

# compare_kubectl: Compare kcli output with kubectl — same resource count
compare_kubectl() {
    local name="$1"; shift
    local kcli_args="$1"; shift
    local kubectl_args="$1"; shift
    printf "  %-60s " "$name"

    # shellcheck disable=SC2086
    local kcli_count kubectl_count
    kcli_count=$($KCLI $kcli_args --no-headers 2>&1 | grep -cv '^$' || echo 0)
    kubectl_count=$(kubectl $kubectl_args --no-headers 2>&1 | grep -cv '^$' || echo 0)

    if [[ "$kcli_count" == "$kubectl_count" ]]; then
        echo -e "${GREEN}PASS${NC} ($kcli_count resources)"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}FAIL${NC} (kcli=$kcli_count, kubectl=$kubectl_count)"
        FAIL=$((FAIL + 1))
        BUGS+=("$name: count mismatch kcli=$kcli_count vs kubectl=$kubectl_count")
    fi
}

# ─── Check Prerequisites ──────────────────────────────────────────────────

echo -e "${BOLD}${CYAN}=== kcli Comprehensive E2E Validation ===${NC}"
echo -e "Binary: $KCLI"
echo -e "State:  $KCLI_HOME_DIR"

if ! command -v kubectl &>/dev/null; then
    echo -e "${RED}kubectl not found — cannot compare outputs${NC}"
    exit 1
fi

CLUSTER_OK=false
if kubectl cluster-info &>/dev/null; then
    CLUSTER_OK=true
    CONTEXT=$(kubectl config current-context 2>/dev/null || echo "unknown")
    echo -e "Cluster: ${GREEN}connected${NC} ($CONTEXT)"
else
    echo -e "Cluster: ${YELLOW}not connected${NC} (cluster-dependent tests will skip)"
fi
echo ""

# =========================================================================
echo -e "${BOLD}[1/10] Meta & Version${NC}"
# =========================================================================
assert_regex  "version shows semver"            "kcli [0-9]+\.[0-9]+\.[0-9]+"  "$KCLI" version
assert_contains "help shows Usage"              "Usage:"                        "$KCLI" --help
assert_contains "help lists core commands"      "Core Kubernetes:"              "$KCLI" --help
assert_contains "help lists observability"      "Observability:"                "$KCLI" --help
assert_contains "help lists workflow"           "Workflow:"                     "$KCLI" --help

# =========================================================================
echo -e "\n${BOLD}[2/10] Doctor${NC}"
# =========================================================================
assert_contains "doctor finds kubectl"          "kubectl"                       "$KCLI" doctor
assert_regex    "doctor checks kubeconfig"      "(kubeconfig|config)"           "$KCLI" doctor
assert_regex    "doctor shows version"          "kcli v[0-9]"                   "$KCLI" doctor

# =========================================================================
echo -e "\n${BOLD}[3/10] Context & Namespace Management${NC}"
# =========================================================================
if $CLUSTER_OK; then
    assert_contains "ctx lists contexts"        "CONTEXT"                       "$KCLI" ctx
    assert_regex    "ctx --current returns name" "[a-z]"                        "$KCLI" ctx --current

    # Favorites lifecycle
    CURRENT_CTX=$("$KCLI" ctx --current 2>/dev/null || echo "")
    if [[ -n "$CURRENT_CTX" ]]; then
        run_test "ctx fav add"                                                  "$KCLI" ctx fav add "$CURRENT_CTX"
        assert_contains "ctx fav ls shows added"   "$CURRENT_CTX"               "$KCLI" ctx fav ls
        run_test "ctx fav rm"                                                   "$KCLI" ctx fav rm "$CURRENT_CTX"
    fi

    assert_contains "ns lists namespaces"       "NAMESPACE"                     "$KCLI" ns
    assert_regex    "ns --current returns name"  "[a-z]"                        "$KCLI" ns --current
fi

# =========================================================================
echo -e "\n${BOLD}[4/10] kubectl Passthrough — Output Parity${NC}"
# =========================================================================
if $CLUSTER_OK; then
    compare_kubectl "get pods -A matches kubectl"       "get pods -A"           "get pods -A"
    compare_kubectl "get nodes matches kubectl"         "get nodes"             "get nodes"
    compare_kubectl "get ns matches kubectl"            "get namespaces"        "get namespaces"
    compare_kubectl "get deploy -A matches kubectl"     "get deploy -A"         "get deploy -A"
    compare_kubectl "get svc -A matches kubectl"        "get svc -A"            "get svc -A"
    compare_kubectl "get ds -A matches kubectl"         "get ds -A"             "get ds -A"

    assert_contains "describe pod has metadata"  "Name:"                        "$KCLI" describe pod -n kube-system -l k8s-app=kube-dns
    assert_contains "explain pod has KIND"        "KIND:"                        "$KCLI" explain pod
    assert_contains "top nodes has CPU"           "CPU"                          "$KCLI" top nodes
    assert_contains "cluster-info shows endpoint" "Kubernetes"                   "$KCLI" cluster-info
    assert_count    "api-resources lists types"   10                             "$KCLI" api-resources
fi

# =========================================================================
echo -e "\n${BOLD}[5/10] Enhanced Commands (show, find, search)${NC}"
# =========================================================================
if $CLUSTER_OK; then
    assert_contains "show pods has STATUS column"         "STATUS"               "$KCLI" show pods -n kube-system
    assert_contains "show pods has READY column"          "READY"                "$KCLI" show pods -n kube-system
    assert_contains "show pods with ip has IP column"     "IP"                   "$KCLI" show pods with ip -n kube-system
    assert_contains "show deploy -A has table"            "NAME"                 "$KCLI" show deploy -A

    assert_contains "find pods by pattern"                "Pod"                  "$KCLI" find pods core
    assert_regex    "find counts matches"                 "Found [0-9]+ match"   "$KCLI" find pods core

    assert_regex    "search across contexts"              "Total matches: [0-9]+" "$KCLI" search coredns
fi

# =========================================================================
echo -e "\n${BOLD}[6/10] Observability Commands${NC}"
# =========================================================================
if $CLUSTER_OK; then
    # Health
    assert_contains "health shows score"          "Health Score"                  "$KCLI" health
    assert_contains "health shows pod metrics"    "POD METRIC"                   "$KCLI" health
    assert_contains "health shows node metrics"   "NODE METRIC"                  "$KCLI" health
    assert_contains "health pods shows Total"     "Total"                        "$KCLI" health pods
    assert_contains "health nodes shows Ready"    "Ready"                        "$KCLI" health nodes
    assert_json     "health -o json is valid"                                    "$KCLI" health -o json

    # Count
    assert_contains "count pods shows STATUS"     "STATUS"                       "$KCLI" count pods
    assert_contains "count pods shows Total"      "Total"                        "$KCLI" count pods
    assert_contains "count deploy shows Total"    "Total"                        "$KCLI" count deploy
    assert_contains "count all shows types"       "RESOURCE TYPE"                "$KCLI" count all

    # Status
    assert_contains "status shows RESOURCE"       "RESOURCE"                     "$KCLI" status
    assert_contains "status shows Ready"          "Ready"                        "$KCLI" status
    assert_contains "status deploy shows detail"  "Name"                         "$KCLI" status deployment/coredns -n kube-system

    # Age
    assert_contains "age pods has AGE column"     "AGE"                          "$KCLI" age pods
    assert_regex    "age pods shows ago"          "[0-9]+(h|d|m|s) ago"          "$KCLI" age pods
    assert_regex    "age deploy shows Ready"      "Ready"                        "$KCLI" age deploy

    # Where
    assert_contains "where pods has NODE"         "NODE"                         "$KCLI" where pods -n kube-system
    assert_contains "where pods has ZONE"         "ZONE"                         "$KCLI" where pods -n kube-system
    assert_contains "where deploy shows zone"     "ZONE"                         "$KCLI" where deployment/coredns -n kube-system

    # Who
    assert_contains "who deploy shows chain"      "Ownership Chain"              "$KCLI" who deployment/coredns -n kube-system
    assert_contains "who deploy shows pods"       "Related Pods"                 "$KCLI" who deployment/coredns -n kube-system

    # Blame
    assert_contains "blame shows resource"        "Blame:"                       "$KCLI" blame deployment/coredns -n kube-system

    # Restarts
    run_test        "restarts runs"                                               "$KCLI" restarts
    assert_json     "restarts -o json is valid"                                   "$KCLI" restarts -o json

    # Events
    run_test        "events runs"                                                 "$KCLI" events
    assert_json     "events -o json is valid"                                     "$KCLI" events -o json

    # Metrics
    assert_contains "metrics shows CPU"           "CPU"                           "$KCLI" metrics
    assert_contains "metrics nodes shows Memory"  "MEMORY"                        "$KCLI" metrics nodes

    # Instability
    run_test        "instability runs"                                            "$KCLI" instability

    # Incident
    assert_contains "incident has CrashLoop section" "CrashLoopBackOff"          "$KCLI" incident
    assert_contains "incident has OOMKilled section" "OOMKilled"                  "$KCLI" incident
    assert_json     "incident -o json is valid"                                   "$KCLI" incident -o json
fi

# =========================================================================
echo -e "\n${BOLD}[7/10] RBAC Analysis${NC}"
# =========================================================================
if $CLUSTER_OK; then
    assert_regex    "rbac analyze finds subjects"   "[0-9]+ subjects found"       "$KCLI" rbac analyze
    assert_contains "rbac who-can shows results"    "Total:"                      "$KCLI" rbac who-can get pods
    assert_contains "rbac what-can shows verbs"     "Verbs"                       "$KCLI" rbac what-can system:serviceaccount:kube-system:coredns
    assert_regex    "rbac diff shows differences"   "Role Diff"                   "$KCLI" rbac diff system:coredns cluster-autoscaler
fi

# =========================================================================
echo -e "\n${BOLD}[8/10] Audit System${NC}"
# =========================================================================
run_test        "audit enable"                                                    "$KCLI" audit enable
assert_contains "audit status shows enabled"     "enabled"                        "$KCLI" audit status
run_test        "audit disable"                                                   "$KCLI" audit disable
assert_contains "audit status shows disabled"    "disabled"                        "$KCLI" audit status
run_test        "audit re-enable"                                                 "$KCLI" audit enable
run_test        "audit log runs"                                                  "$KCLI" audit log
assert_json     "audit log -o json valid"                                         "$KCLI" audit log -o json
assert_json     "audit export -o json valid"                                      "$KCLI" audit export -o json
assert_regex    "audit export -o csv has header" "timestamp,user"                 "$KCLI" audit export -o csv

# =========================================================================
echo -e "\n${BOLD}[9/10] Plugin, Config, Completion${NC}"
# =========================================================================
run_test        "plugin list"                                                     "$KCLI" plugin list
run_test        "plugin verify"                                                   "$KCLI" plugin verify
assert_contains "plugin allowlist shows state"  "Enforcement"                     "$KCLI" plugin allowlist show
assert_contains "config view shows YAML"        "general:"                        "$KCLI" config view
assert_contains "config profile list"           "default"                         "$KCLI" config profile list
assert_count    "completion bash generates code" 20                               "$KCLI" completion bash
assert_count    "completion zsh generates code"  20                               "$KCLI" completion zsh
assert_contains "prompt outputs PS1"            "PS1"                             "$KCLI" prompt

# =========================================================================
echo -e "\n${BOLD}[10/10] Help Flags for All Commands${NC}"
# =========================================================================
HELP_CMDS=(
    get describe apply create delete run expose set logs exec
    port-forward top rollout diff cp proxy attach scale autoscale
    patch label annotate edit replace wait drain cordon uncordon taint
    debug certificate
    ctx ns search find show
    health restarts events metrics instability blame incident
    age count status where who
    rbac audit plugin config kubeconfig
    completion version doctor prompt ui
)
for cmd in "${HELP_CMDS[@]}"; do
    printf "  %-60s " "$cmd --help"
    if $KCLI "$cmd" --help &>/dev/null; then
        echo -e "${GREEN}PASS${NC}"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}FAIL${NC}"
        FAIL=$((FAIL + 1))
        BUGS+=("$cmd --help failed")
    fi
done

# =========================================================================
# Summary
# =========================================================================
echo ""
echo -e "${BOLD}${CYAN}=== Validation Summary ===${NC}"
echo -e "  ${GREEN}PASS: $PASS${NC}"
echo -e "  ${YELLOW}SKIP: $SKIP${NC}"
echo -e "  ${RED}FAIL: $FAIL${NC}"
TOTAL=$((PASS + SKIP + FAIL))
echo -e "  TOTAL: $TOTAL"

if [[ ${#BUGS[@]} -gt 0 ]]; then
    echo ""
    echo -e "${BOLD}${RED}=== Bugs Found ===${NC}"
    for bug in "${BUGS[@]}"; do
        echo -e "  ${RED}✗${NC} $bug"
    done
fi

echo ""
if [[ $FAIL -eq 0 ]]; then
    echo -e "${BOLD}${GREEN}All validations passed!${NC}"
else
    echo -e "${BOLD}${RED}$FAIL validation(s) failed.${NC}"
    exit 1
fi
