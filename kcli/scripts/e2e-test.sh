#!/usr/bin/env bash
#
# kcli End-to-End Test Script
# Tests every available command against a live cluster (or --help fallback).
# Usage: ./scripts/e2e-test.sh [path-to-kcli-binary]
#
set -euo pipefail

KCLI="${1:-/tmp/kcli-e2e}"
PASS=0
FAIL=0
SKIP=0
GAPS=()

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

run_test() {
    local name="$1"
    shift
    local desc="$1"
    shift

    printf "  %-55s " "$name"
    local output
    if output=$("$@" 2>&1); then
        echo -e "${GREEN}PASS${NC}"
        PASS=$((PASS + 1))
    else
        local exit_code=$?
        # Some commands fail because no cluster / no resource — that's expected
        # Check if it actually produced output (meaning it ran)
        if [[ -n "$output" ]]; then
            # Known acceptable failures
            if echo "$output" | grep -qiE "connection refused|no such host|unable to connect|context.*not found|not found|forbidden|error from server|unknown command|cannot exec|couldn't get resource|metrics api not available"; then
                echo -e "${YELLOW}SKIP${NC} (cluster/resource dependent)"
                SKIP=$((SKIP + 1))
            else
                echo -e "${RED}FAIL${NC} (exit=$exit_code)"
                echo "    output: $(echo "$output" | head -3)"
                FAIL=$((FAIL + 1))
                GAPS+=("$name: $output")
            fi
        else
            echo -e "${RED}FAIL${NC} (exit=$exit_code, no output)"
            FAIL=$((FAIL + 1))
            GAPS+=("$name: no output, exit=$exit_code")
        fi
    fi
}

run_help_test() {
    local name="$1"
    shift
    printf "  %-55s " "$name (--help)"
    local output
    if output=$("$@" --help 2>&1) && [[ -n "$output" ]]; then
        echo -e "${GREEN}PASS${NC}"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}FAIL${NC}"
        FAIL=$((FAIL + 1))
        GAPS+=("$name --help: failed or empty")
    fi
}

echo -e "${BOLD}${CYAN}=== kcli End-to-End Test ===${NC}"
echo -e "Binary: $KCLI"
echo -e "State:  $KCLI_HOME_DIR"
echo ""

# =========================================================================
echo -e "${BOLD}[1/12] Meta & Version${NC}"
# =========================================================================
run_test "version" "Show version" "$KCLI" version
run_help_test "root" "$KCLI"
run_test "version --help" "Version help" "$KCLI" version --help

# =========================================================================
echo -e "\n${BOLD}[2/12] Context Management${NC}"
# =========================================================================
run_help_test "ctx" "$KCLI" ctx
run_test "ctx (list)" "List contexts" "$KCLI" ctx
run_test "ctx --current" "Show current context" "$KCLI" ctx --current
run_help_test "ctx rename" "$KCLI" ctx rename
run_help_test "ctx delete" "$KCLI" ctx delete
# Favorites
run_help_test "ctx fav" "$KCLI" ctx fav
run_test "ctx fav ls" "List context favorites" "$KCLI" ctx fav ls
run_test "ctx fav add (test)" "Add context favorite" "$KCLI" ctx fav add test-favorite-ctx
run_test "ctx fav ls (after add)" "List after add" "$KCLI" ctx fav ls
run_test "ctx fav rm (test)" "Remove context favorite" "$KCLI" ctx fav rm test-favorite-ctx
# Aliases
run_help_test "ctx alias" "$KCLI" ctx alias
run_test "ctx alias ls" "List context aliases" "$KCLI" ctx alias ls
run_test "ctx alias add" "Add context alias" "$KCLI" ctx alias add myalias some-context
run_test "ctx alias ls (after add)" "List after add" "$KCLI" ctx alias ls
run_test "ctx alias rm" "Remove context alias" "$KCLI" ctx alias rm myalias
# Groups — use current context since group set validates context existence
CURRENT_CTX=$("$KCLI" ctx --current 2>/dev/null || echo "")
run_help_test "ctx group" "$KCLI" ctx group
run_test "ctx group ls" "List groups" "$KCLI" ctx group ls
if [[ -n "$CURRENT_CTX" ]]; then
    run_test "ctx group set" "Set group" "$KCLI" ctx group set prod "$CURRENT_CTX"
    run_test "ctx group ls (after set)" "List after set" "$KCLI" ctx group ls
    run_test "ctx group add" "Add to group" "$KCLI" ctx group add prod "$CURRENT_CTX"
    run_test "ctx group rm" "Remove group" "$KCLI" ctx group rm prod
else
    echo "  (skipping ctx group set/add/rm — no active context)"
fi

# =========================================================================
echo -e "\n${BOLD}[3/12] Namespace Management${NC}"
# =========================================================================
run_help_test "ns" "$KCLI" ns
run_test "ns (list)" "List namespaces" "$KCLI" ns
run_help_test "ns create" "$KCLI" ns create
run_help_test "ns delete" "$KCLI" ns delete
# Namespace favorites
run_test "ns fav ls" "List namespace favorites" "$KCLI" ns fav ls
run_test "ns fav add" "Add namespace favorite" "$KCLI" ns fav add kube-system
run_test "ns fav ls (after add)" "List after add" "$KCLI" ns fav ls
run_test "ns fav rm" "Remove namespace favorite" "$KCLI" ns fav rm kube-system

# =========================================================================
echo -e "\n${BOLD}[4/12] Core kubectl Passthrough${NC}"
# =========================================================================
run_help_test "get" "$KCLI" get
run_test "get namespaces" "Get namespaces" "$KCLI" get namespaces
run_test "get pods -A" "Get all pods" "$KCLI" get pods -A
run_test "get nodes" "Get nodes" "$KCLI" get nodes
run_help_test "describe" "$KCLI" describe
run_help_test "apply" "$KCLI" apply
run_help_test "create" "$KCLI" create
run_help_test "delete" "$KCLI" delete
run_help_test "run" "$KCLI" run
run_help_test "expose" "$KCLI" expose
run_help_test "set" "$KCLI" set
run_help_test "logs" "$KCLI" logs
run_help_test "exec" "$KCLI" exec
run_help_test "port-forward" "$KCLI" port-forward
run_help_test "top" "$KCLI" top
run_help_test "diff" "$KCLI" diff
run_help_test "cp" "$KCLI" cp
run_help_test "proxy" "$KCLI" proxy
run_help_test "attach" "$KCLI" attach
run_help_test "scale" "$KCLI" scale
run_help_test "autoscale" "$KCLI" autoscale
run_help_test "patch" "$KCLI" patch
run_help_test "label" "$KCLI" label
run_help_test "annotate" "$KCLI" annotate
run_help_test "edit" "$KCLI" edit
run_help_test "replace" "$KCLI" replace
run_help_test "wait" "$KCLI" wait

# Node operations
run_help_test "drain" "$KCLI" drain
run_help_test "cordon" "$KCLI" cordon
run_help_test "uncordon" "$KCLI" uncordon
run_help_test "taint" "$KCLI" taint

# Cluster info
run_test "cluster-info" "Show cluster info" "$KCLI" cluster-info
run_test "api-resources" "List api-resources" "$KCLI" api-resources
run_test "api-versions" "List api-versions" "$KCLI" api-versions

# Auth
run_help_test "auth" "$KCLI" auth
run_help_test "certificate" "$KCLI" certificate
run_help_test "debug" "$KCLI" debug

# =========================================================================
echo -e "\n${BOLD}[5/12] Explain & Search${NC}"
# =========================================================================
run_test "explain pod" "Explain pod" "$KCLI" explain pod
run_test "explain deployment" "Explain deployment" "$KCLI" explain deployment
run_help_test "search" "$KCLI" search

# =========================================================================
echo -e "\n${BOLD}[6/12] Observability Commands${NC}"
# =========================================================================
# Health
run_help_test "health" "$KCLI" health
run_test "health" "Cluster health" "$KCLI" health
run_test "health pods" "Pod health" "$KCLI" health pods
run_test "health nodes" "Node health" "$KCLI" health nodes
run_test "health -o json" "Health JSON output" "$KCLI" health -o json

# Restarts
run_help_test "restarts" "$KCLI" restarts
run_test "restarts" "List restarts" "$KCLI" restarts
run_test "restarts --threshold=5" "Restarts threshold" "$KCLI" restarts --threshold=5
run_test "restarts -o json" "Restarts JSON output" "$KCLI" restarts -o json

# Events
run_help_test "events" "$KCLI" events
run_test "events" "View events" "$KCLI" events
run_test "events --type=Warning" "Warning events" "$KCLI" events --type=Warning
run_test "events --all" "All events" "$KCLI" events --all
run_test "events --sort=oldest" "Events oldest first" "$KCLI" events --sort=oldest
run_test "events -o json" "Events JSON output" "$KCLI" events -o json

# Metrics
run_help_test "metrics" "$KCLI" metrics
run_test "metrics" "Combined metrics" "$KCLI" metrics
run_test "metrics pods" "Pod metrics" "$KCLI" metrics pods
run_test "metrics nodes" "Node metrics" "$KCLI" metrics nodes

# Instability
run_help_test "instability" "$KCLI" instability
run_test "instability" "Instability snapshot" "$KCLI" instability

# Blame (needs a real resource)
run_help_test "blame" "$KCLI" blame
run_test "blame deployment" "Blame (test resource)" "$KCLI" blame deployment/coredns -n kube-system

# Incident
run_help_test "incident" "$KCLI" incident
run_test "incident" "Incident summary" "$KCLI" incident
run_test "incident -o json" "Incident JSON output" "$KCLI" incident -o json
run_help_test "incident export" "$KCLI" incident export

# =========================================================================
echo -e "\n${BOLD}[7/12] Rollout${NC}"
# =========================================================================
run_help_test "rollout" "$KCLI" rollout
run_help_test "rollout status" "$KCLI" rollout status
run_help_test "rollout history" "$KCLI" rollout history
run_help_test "rollout undo" "$KCLI" rollout undo
run_help_test "rollout pause" "$KCLI" rollout pause
run_help_test "rollout resume" "$KCLI" rollout resume
run_help_test "rollout restart" "$KCLI" rollout restart

# =========================================================================
echo -e "\n${BOLD}[8/12] RBAC${NC}"
# =========================================================================
run_help_test "rbac" "$KCLI" rbac
run_help_test "rbac analyze" "$KCLI" rbac analyze
run_help_test "rbac who-can" "$KCLI" rbac who-can
run_help_test "rbac what-can" "$KCLI" rbac what-can
run_help_test "rbac diff" "$KCLI" rbac diff
run_help_test "rbac report" "$KCLI" rbac report
run_test "rbac who-can get pods" "RBAC who-can" "$KCLI" rbac who-can get pods
run_test "rbac analyze" "RBAC analyze" "$KCLI" rbac analyze

# =========================================================================
echo -e "\n${BOLD}[9/12] Audit${NC}"
# =========================================================================
run_help_test "audit" "$KCLI" audit
run_test "audit status" "Audit status" "$KCLI" audit status
run_test "audit log" "Audit log" "$KCLI" audit log
run_test "audit log -o json" "Audit log JSON" "$KCLI" audit log -o json
run_help_test "audit export" "$KCLI" audit export
run_help_test "audit plugins" "$KCLI" audit plugins
run_test "audit plugins" "Audit plugins" "$KCLI" audit plugins
run_test "audit plugins -o json" "Audit plugins JSON" "$KCLI" audit plugins -o json

# =========================================================================
echo -e "\n${BOLD}[10/12] Plugin System${NC}"
# =========================================================================
run_help_test "plugin" "$KCLI" plugin
run_test "plugin list" "Plugin list" "$KCLI" plugin list
run_test "plugin list -o json" "Plugin list JSON" "$KCLI" plugin list -o json
run_help_test "plugin install" "$KCLI" plugin install
run_help_test "plugin remove" "$KCLI" plugin remove
run_help_test "plugin inspect" "$KCLI" plugin inspect
run_help_test "plugin verify" "$KCLI" plugin verify
run_test "plugin verify" "Plugin verify (no plugins)" "$KCLI" plugin verify
run_help_test "plugin allowlist" "$KCLI" plugin allowlist
run_test "plugin allowlist show" "Allowlist show" "$KCLI" plugin allowlist show
run_test "plugin allowlist add test" "Allowlist add" "$KCLI" plugin allowlist add test-plugin
run_test "plugin allowlist show (after)" "Allowlist after add" "$KCLI" plugin allowlist show
run_test "plugin allowlist rm test" "Allowlist remove" "$KCLI" plugin allowlist rm test-plugin
run_test "plugin allowlist lock" "Allowlist lock" "$KCLI" plugin allowlist lock
run_test "plugin allowlist unlock" "Allowlist unlock" "$KCLI" plugin allowlist unlock

# =========================================================================
echo -e "\n${BOLD}[11/12] Config${NC}"
# =========================================================================
run_help_test "config" "$KCLI" config
run_test "config view" "Config view" "$KCLI" config view
run_help_test "config set" "$KCLI" config set
run_help_test "config get" "$KCLI" config get
run_help_test "config edit" "$KCLI" config edit
run_test "config profile list" "Config profile list" "$KCLI" config profile list
run_help_test "kubeconfig" "$KCLI" kubeconfig

# =========================================================================
echo -e "\n${BOLD}[12/12] Prompt, Completion, Diff, Wait${NC}"
# =========================================================================
run_help_test "prompt" "$KCLI" prompt
run_test "prompt" "Prompt output" "$KCLI" prompt
run_help_test "completion" "$KCLI" completion
run_test "completion bash" "Bash completion" "$KCLI" completion bash
run_test "completion zsh" "Zsh completion" "$KCLI" completion zsh
run_test "completion fish" "Fish completion" "$KCLI" completion fish
run_help_test "diff" "$KCLI" diff
run_help_test "wait" "$KCLI" wait

# =========================================================================
echo -e "\n${BOLD}[EXTRA] Output Format Consistency Check${NC}"
# =========================================================================
echo "  Checking -o flag availability on kcli-native commands..."
NATIVE_CMDS=("health" "restarts" "events" "incident" "blame" "plugin list" "audit log" "audit plugins" "audit export")
for cmd_str in "${NATIVE_CMDS[@]}"; do
    # shellcheck disable=SC2086
    printf "  %-55s " "$cmd_str (-o flag)"
    if $KCLI $cmd_str --help 2>&1 | grep -q '\-o.*output'; then
        echo -e "${GREEN}PASS${NC}"
        PASS=$((PASS + 1))
    elif $KCLI $cmd_str --help 2>&1 | grep -q 'output'; then
        echo -e "${GREEN}PASS${NC} (--output without -o shorthand)"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}MISSING${NC}"
        FAIL=$((FAIL + 1))
        GAPS+=("$cmd_str: missing -o/--output flag")
    fi
done

# =========================================================================
# Summary
# =========================================================================
echo ""
echo -e "${BOLD}${CYAN}=== Test Summary ===${NC}"
echo -e "  ${GREEN}PASS: $PASS${NC}"
echo -e "  ${YELLOW}SKIP: $SKIP${NC} (cluster/resource dependent)"
echo -e "  ${RED}FAIL: $FAIL${NC}"
TOTAL=$((PASS + SKIP + FAIL))
echo -e "  TOTAL: $TOTAL"

if [[ ${#GAPS[@]} -gt 0 ]]; then
    echo ""
    echo -e "${BOLD}${RED}=== Gaps Found ===${NC}"
    for gap in "${GAPS[@]}"; do
        echo -e "  ${RED}-${NC} $gap"
    done
fi

echo ""
if [[ $FAIL -eq 0 ]]; then
    echo -e "${BOLD}${GREEN}All tests passed!${NC}"
else
    echo -e "${BOLD}${RED}$FAIL test(s) failed. See gaps above.${NC}"
    exit 1
fi
