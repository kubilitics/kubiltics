# Kubilitics Brain — Tool Coverage Dashboard

**Phase**: 3 (Test Harness)  
**Branch**: `tool-hardening`  
**Date**: 2026-05-24  
**Overall Statement Coverage**: 56.9% (up from 36.0% baseline)

---

## Test Tier Summary

| Tier | Location | Build Tag | Status |
|------|----------|-----------|--------|
| Unit (contract) | `tests/tools/unit/` | _(none)_ | ✅ 11/11 PASS |
| Chaos (resilience) | `tests/tools/chaos/` | `chaos` | ✅ 10 scenarios |
| Load (parallel) | `tests/tools/load/` | `load` | ✅ 4 tests + 1 bench |
| E2E (agent flows) | `tests/tools/e2e/` | `e2e` | ✅ 6 multi-step flows |
| Phase 2 (live cluster) | `internal/mcp/server/` | `phase2` | ✅ 148/148 tools PASS |

### How to run each tier

```bash
# Unit contracts (CI — no cluster needed)
go test ./tests/tools/unit/

# Chaos resilience
go test -tags chaos -timeout 2m ./tests/tools/chaos/

# Load + race detection
go test -tags load -race -timeout 3m ./tests/tools/load/

# E2E agent flows
go test -tags e2e -timeout 3m ./tests/tools/e2e/

# Phase 2 live cluster (requires running backend)
CLUSTER_ID=<uuid> go test -v -tags phase2 -run TestPhase2LiveToolValidation \
  -timeout 20m ./internal/mcp/server/
```

---

## Tool Taxonomy Contracts

All 11 contract tests enforce the following guarantees across all 157 tools:

| Contract | Status |
|----------|--------|
| Every tool has Name, Description, Category, InputSchema | ✅ |
| Tool names are unique | ✅ |
| Tool names are lowercase with no whitespace | ✅ |
| Destructive tools have RequiredAutonomyLevel ≥ 4 | ✅ |
| Execution category tools are all Destructive | ✅ |
| All 8 categories are represented | ✅ |
| Tool count in [100, 300] | ✅ 157 |
| Observation tools are not Destructive | ✅ |
| Analysis tools are not Destructive | ✅ |
| Every InputSchema has `cluster_id` property | ✅ |
| Every category has ≥ 1 tool | ✅ |

---

## Tool Category Distribution (157 tools)

| Category | Count | Destructive |
|----------|-------|-------------|
| observation | 49 | 0 |
| analysis | 41 | 0 |
| recommendation | 18 | 0 |
| troubleshooting | 17 | 0 |
| security | 15 | 0 |
| cost | 4 | 0 |
| automation | 4 | 0 |
| execution | 9 | 9 |
| **TOTAL** | **157** | **9** |

---

## Statement Coverage by File (internal/mcp/server)

| File | Functions | Covered | Avg Statement % |
|------|-----------|---------|-----------------|
| backend_http.go | 11 | 11 | 89.9% |
| handlers_analysis.go | 43 | 27 | 41.6% |
| handlers_composite.go | 1 | 1 | 83.3% |
| handlers_diagnose.go | 14 | 14 | 77.3% |
| handlers_gaps.go | 29 | 28 | 77.3% |
| handlers_inspect.go | 48 | 39 | 61.8% |
| handlers_narrate.go | 20 | 16 | 35.7% |
| handlers_observability.go | 13 | 13 | 84.4% |
| handlers_observation.go | 173 | 125 | 48.7% |
| handlers_plan.go | 2 | 2 | 72.1% |
| handlers_security_checks.go | 7 | 7 | 66.8% |
| list_summarize.go | 11 | 11 | 82.9% |
| server.go | 25 | 24 | 83.1% |
| validation.go | 3 | 3 | 94.4% |
| **TOTAL** | **400** | **321** | **56.9%** |

---

## Coverage Progress

| Milestone | Coverage |
|-----------|----------|
| Baseline (pre-Phase 3) | 36.0% |
| After Phase 3 test harness | 56.9% |
| Target | ≥ 90% |
| Remaining gap | 33.1 pp |

### Key highlights from Phase 3

- `routeObservationTool` — **99.3%** (was 10.9%) — all 120+ dispatch cases covered
- `extractContainerStatuses` — **96.9%**
- `extractPodSecurityContext` — **91.3%**
- `summarizeDependencies` — **92.3%**
- `handleExportTopologyToDrawio` — **83.9%** (Mermaid fallback path tested)
- `handlers_observability.go` — **84.4%** avg (all 13 functions covered)
- `handlers_diagnose.go` — **77.3%** avg (all 14 functions covered)

---

## Chaos Resilience Scenarios Covered

| Scenario | Result |
|----------|--------|
| Backend completely unreachable | Returns error, no panic |
| Backend returns HTTP 500 | Returns error |
| Backend returns invalid JSON | Returns error |
| Context cancelled before response | Returns context error |
| Empty response body | No panic |
| Backend hangs mid-response | Returns timeout error |
| Unknown tool name | Returns error |
| Nil args map | No panic |
| 20 concurrent goroutines | No race, no deadlock |
| Read-only tools never issue mutating HTTP calls | Verified |

---

## Phase 2 Live Validation Summary

Run against docker-desktop Kubernetes:
- **148/148** non-destructive tools: PASS
- **9/9** destructive tools: SKIPPED (safety gate)
- Average latency: 463ms/tool
- Rate limiting handled: 5-retry with exponential backoff
- Resource discovery: Pod, Node, Service, Deployment, DaemonSet, PV, StorageClass, ClusterRole, CRD

---

## Next Steps to Reach ≥ 90%

Priority targets for additional test coverage:

1. **handlers_analysis.go** (41.6%) — add tests for the 16 uncovered analysis helper functions
2. **handlers_observation.go** (48.7%) — add rich-response tests for the remaining 48 handler methods (statefulset, daemonset, job, cronjob, pvc, pv, rbac, config, limitrange, quota, hpa, pdb, vpa)
3. **handlers_narrate.go** (35.7%) — add tests for narrative generation with structured backend data
4. **handlers_inspect.go** (61.8%) — add tests for the 9 uncovered composite inspect handlers

Estimated coverage with these additions: ~82–88%.
