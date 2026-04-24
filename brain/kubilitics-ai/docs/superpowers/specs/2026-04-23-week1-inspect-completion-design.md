# Spec — Week 1: Completing the Inspect Surface

**Date:** 2026-04-23
**Status:** Design approved; ready for implementation plan.
**Scope:** `feat/week1-inspect-completion` on `vellankikoti/kotg.ai` (off main at `59cb7a7`).
**Reviewers:** @vellankikoti

---

## 1. Context

The 12-week new-tools plan at [`kubilitics/docs/strategy/2026-04-22-new-tools-plan.md`](../../../../kubilitics/docs/strategy/2026-04-22-new-tools-plan.md) has been re-scoped to **Option C — the 5 highest-leverage weeks**:

| Wk | Deliverable | Status |
|---|---|---|
| **1** | Finish inspect surface (3 new tools + retire 25 `observe_*`) | **this spec** |
| **2** | DAG planner (plan-then-execute) | next |
| **5** | Counterfactual scheduler simulator | later |
| **6** | OTel span store + trace tools | later |
| **9** | Incident memory / RAG | later |

Dropped from the plan (table-stakes work, will integrate-not-build or defer): `audit_rbac` matrix, Prometheus/KRR rightsize, Argo/Flux watcher, Trivy/Kubescape, PageRank, confidence scoring, GPU/OpenCost adapters.

### Current baseline on `main` (kotg.ai at `59cb7a7`)

- 183 tools in `internal/mcp/tools/taxonomy.go`
- **27 `inspect_*` composites already implemented** via `fanOut` + `buildInspectResult` in `internal/mcp/server/handlers_inspect.go`
- 42 `observe_*` tools still exposed — 25 are folded (`_detailed/_events/_ownership_chain` families) and cause the LLM loop-trap failures; 17 are specialty observers with unique signal that stay
- `incident-scenarios-20.json` bench: 14/20 pass on qwen2.5:32b (2026-04-22 baseline)
- `cmd/bench/aliases.json` maps old tool names to new composites for bench-scoring equivalence

### Goal

Ship the final 3 Week-1 tools (`triage_cluster`, `list_problems`, `search_logs`), atomically retire **25** of the 42 `observe_*` tools (the `_detailed/_events/_ownership_chain` families covered by `cmd/bench/aliases.json` — all their bench-scoring equivalence is already mapped), eliminate same-tool-15×-loop failures, and raise the bench by at least +1 (≥15/20 merge-gate; 16/20 stretch).

The remaining **17 specialty observers** (e.g., `observe_flapping_services`, `observe_ingresses_by_tls_expiry`, `observe_missing_probes`, `observe_zombie_finalizers`) stay — they expose unique signal not covered by any composite, and retiring them would lose functionality AND break any bench prompt that referenced them without alias coverage.

`describe_topology` is explicitly cut — its value was PageRank-ranking, which is deferred indefinitely under Option C.

---

## 2. Architecture

### 2.1 New packages

```
kubilitics-ai/internal/
  triage/
    ranking.go         # ScorePod, ScoreNode, ScoreEvent → heuristic 0.0-1.0
    ranking_test.go    # table tests + monotonicity property test
  logpattern/
    template.go        # Extract(line) → (template, fields)
    cluster.go         # Cluster(lines) → []ClusterResult{template, count, pods}
    template_test.go   # 30 canonical log fixtures
    cluster_test.go    # dedup + count aggregation
```

**Design intent:**
- `triage/` holds pure heuristics over structured K8s inputs. Zero client-go code. Reusable by Wk 2 planner for sub-task prioritization.
- `logpattern/` holds pure string transformation. No I/O. Reusable by Wk 9 RAG for incident-template normalization before embedding.
- Handlers stay thin; all non-trivial logic lives in these two packages.

### 2.2 Modified files

```
internal/mcp/tools/
  taxonomy.go                # +3 tool definitions; −25 observe_* entries (atomic diff)
internal/mcp/server/
  handlers_inspect.go        # +handleTriageCluster, +handleListProblems, +handleSearchLogs
  handlers_observation.go    # dispatch case-entries for the 3 new tool names
```

Existing sub-handlers (`handlePodDetailed`, `handleEvents`, `handlePodLogsFiltered`, `handleResourcesByQuery`, `handleNodeStatus`, `handleClusterOverview`, `handleWorkloadHealth`) are **not modified**. They stay as internal plumbing even though their taxonomy exposure (the `observe_*_detailed` / `_events` / `_ownership_chain` names) is retired.

### 2.3 Composition map

| New tool | Existing sub-handlers it fans out to | New logic called |
|---|---|---|
| `triage_cluster` | `handleClusterOverview`, `handleNodeStatus`, `handleWorkloadHealth`, `handleEvents(since=15m)` | `triage.RankCluster(...)` |
| `list_problems` | `handleResourcesByQuery` (filtered by enum) | `triage.RankProblems(...)` |
| `search_logs` | `handlePodLogsFiltered` fanned across N pods selected via `handleResourcesByQuery` | `logpattern.Cluster(...)` |

### 2.4 Output envelope

All three tools emit the same envelope shape as existing `inspect_*` composites (from `buildInspectResult`):

```json
{
  "kind": "TriageCluster" | "ProblemList" | "LogPatterns",
  "cluster_id": "...",
  "summary": "...one-sentence human narrative...",
  "data": { ...tool-specific structured payload... },
  "sources": [{ "tool": "observe_cluster_overview", "ms": 42 }],
  "partial": ["observe_events"]   // only present when a sub-handler failed
}
```

Output capped via existing `capToolOutput()` at the same budget as other `inspect_*` tools.

---

## 3. Tool specifications

### 3.1 `triage_cluster`

**Purpose:** One-turn narrative triage — "what's on fire, in rank order."

**Input:**
```json
{
  "cluster_id": "optional — defaults to session focus_cluster_id"
}
```

**Output `data` shape:**
```json
{
  "cluster_health": "healthy | degraded | critical",
  "top_problems": [
    {
      "kind": "Pod",
      "namespace": "payments",
      "name": "redis-primary-0",
      "severity": 0.93,
      "reason": "CrashLoopBackOff",
      "first_seen": "2026-04-23T14:05:12Z"
    }
    // up to 10 entries, ranked by severity descending
  ],
  "node_pressure": [
    {"node": "ip-10-0-1-4", "kind": "memory", "pct": 94, "severity": 0.80}
  ],
  "recent_critical_events": [
    // last 15 min, Warning-level only, capped at 10
  ]
}
```

**Cluster-health aggregation rule:**
- `critical` if any problem has severity ≥ 0.85 OR node pressure ≥ 0.80
- `degraded` if any problem has severity ≥ 0.50 OR node pressure ≥ 0.50
- `healthy` otherwise

**Edge cases:**
- No `cluster_id` and no `focus_cluster_id` in session → error: `"triage_cluster: no cluster selected; pass cluster_id"`
- Zero problems → `summary: "Cluster healthy, no active issues"`, `top_problems: []`
- One sub-handler fails → populate `data.partial: [...]`, still return success

### 3.2 `list_problems`

**Purpose:** Typed-filter "any pods crashlooping/oom/pending/evicted/etc."

**Input:**
```json
{
  "filter": "crashlooping | oom | pending | evicted | image_pull_error | unhealthy",
  "namespace": "optional",
  "since": "15m",
  "limit": 50
}
```

Defaults: `since` omitted → current "now" state only. `limit` 50, max 200. `since` accepts Go `time.Duration` syntax (`"15m"`, `"1h"`, `"2h30m"`).

**Filter enum semantics:**

| Value | Matches |
|---|---|
| `crashlooping` | `status.phase == Running` with `waiting.reason == CrashLoopBackOff`, OR pod restart count > 5 in last hour |
| `oom` | Any container `lastState.terminated.exitCode == 137`, OR recent `OOMKilled` event in last hour |
| `pending` | `status.phase == Pending` with a `FailedScheduling` event, or no node matched selectors |
| `evicted` | `status.phase == Failed` with `reason == Evicted` |
| `image_pull_error` | Any container `waiting.reason in (ImagePullBackOff, ErrImagePull)` |
| `unhealthy` | `conditions.Ready == false` for longer than 5 minutes |

**Output `data` shape:**
```json
{
  "filter": "crashlooping",
  "count": 3,
  "problems": [
    {
      "kind": "Pod",
      "namespace": "payments",
      "name": "redis-primary-0",
      "severity": 0.93,
      "restart_count": 47,
      "last_exit_code": 137,
      "reason": "CrashLoopBackOff",
      "first_seen": "2026-04-23T14:05:12Z",
      "owner": "StatefulSet/redis-primary"
    }
  ],
  "truncated": false
}
```

**Edge cases:**
- Unknown filter value → error listing accepted values
- Zero results → success with `count: 0` and descriptive summary
- `problems.length == limit` → set `truncated: true`

### 3.3 `search_logs`

**Purpose:** Pattern-aware log aggregation. Returns grouped templates, not raw line dumps.

**Input:**
```json
{
  "namespace": "required",
  "workload": "optional — pod / deployment / statefulset name",
  "regex": "required — case-insensitive by default",
  "since": "15m",
  "max_pods": 10,
  "max_lines_per_pod": 1000
}
```

**Output `data` shape:**
```json
{
  "query": { "...echo of input..." },
  "patterns": [
    {
      "template": "connection refused to {IP}:{PORT}",
      "count": 47,
      "pods": ["worker-7f-abc", "worker-7f-xyz", "worker-7f-mn2"],
      "first_seen": "2026-04-23T14:01:03Z",
      "last_seen": "2026-04-23T14:14:58Z",
      "sample_line": "2026-04-23T14:01:03Z ERROR connection refused to 10.0.2.14:6379"
    }
  ],
  "unmatched_error_line_count": 3,
  "pods_searched": 5,
  "pods_skipped_due_to_cap": 0
}
```

**`logpattern.Extract(line)` ordered strip rules:**

1. ISO timestamp `\d{4}-\d{2}-\d{2}T...` → `{TS}`
2. IPv4 `\d+\.\d+\.\d+\.\d+` → `{IP}`
3. `:<PORT>` (2–5 digits) → `:{PORT}`
4. UUID v4 `[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}` → `{UUID}`
5. Hex > 8 chars → `{HEX}`
6. Long decimal (> 4 digits, not HTTP status) → `{NUM}`
7. Pod suffix `-[a-f0-9]{8}-[a-f0-9]{5,10}` → `-{POD}`
8. HTTP 4xx/5xx status code: kept literal (valuable signal)

Rules run in order; each consumes and replaces before the next runs. Output is `(template: string, fields: map[string]string)`. Lines that fail all extraction rules join a single `unmatched` bucket.

**Edge cases:**
- No `workload` → fan out across ALL pods in namespace, capped at `max_pods` (most-recently-restarted first)
- Regex too permissive (matches every line) → still cap at `max_lines_per_pod`; no flag
- Zero matches → success with `patterns: []` and descriptive summary
- Pod count > `max_pods` → set `pods_skipped_due_to_cap: N`

---

## 4. Retirement of 25 `observe_*` tools

**Atomic diff** in `internal/mcp/tools/taxonomy.go`:

**The 25 names to retire** (all present in `cmd/bench/aliases.json`, so bench scoring already maps them to their surviving composites):

```
observe_api_resources                observe_cluster_overview
observe_configmap_consumers          observe_custom_resources
observe_deployment_rollout_history   observe_events
observe_metrics                      observe_namespace_overview
observe_network_policies             observe_node_status
observe_pod_dependencies             observe_pod_logs
observe_pod_logs_filtered            observe_pvc_consumers
observe_resource                     observe_resource_history
observe_resource_links               observe_resource_topology
observe_resources_by_query           observe_secret_consumers
observe_service_endpoints            observe_serviceaccount_detailed
observe_serviceaccount_permissions   observe_storage_status
observe_workload_health
```

Generation rule: `grep -oE 'Name: *"observe_[a-z_]+' internal/mcp/tools/taxonomy.go | awk -F'"' '{print $2}' | sort > /tmp/current-observe.txt; grep -oE 'observe_[a-z_]+' cmd/bench/aliases.json | sort -u > /tmp/aliased.txt; comm -12 /tmp/current-observe.txt /tmp/aliased.txt`. This produces exactly the 25 above.

**The 17 specialty observers that STAY** (no alias coverage, unique signal):

```
observe_flapping_services              observe_high_cardinality_labels
observe_ingresses_by_tls_expiry        observe_missing_probes
observe_node_metrics                   observe_noisy_neighbors
observe_orphaned_pods                  observe_pending_scheduler_events
observe_pod_metrics                    observe_recent_changes
observe_restart_storms                 observe_secrets_usage
observe_services_by_filter             observe_stuck_rollouts
observe_top_pods_by_metric             observe_unhealthy_probes
observe_zombie_finalizers
```

These may eventually be folded into `list_problems` filter enum extensions or Wk-4 Prometheus adapter output, but that's explicitly out of Week-1 scope.

**Important:** retiring from the **taxonomy** only hides the tools from the LLM's surface. The underlying internal methods (`handlePodDetailed`, `handleEvents`, etc.) stay — they're still the engine behind `inspect_*` + the 3 new composites, and the dispatch switch in `handlers_observation.go` stays wired so direct-call compatibility is preserved.

`cmd/bench/aliases.json` already maps old tool names to new composites for bench-scoring equivalence, so historical bench prompts that reference retired names still score correctly.

---

## 5. Testing strategy

### 5.1 Unit tests

- `internal/triage/ranking_test.go` — 15 pod fixtures × (CrashLoopBackOff, OOMKilled, Pending, healthy, unhealthy) → severity ∈ [0, 1]. Plus monotonicity property test: more broken state must score higher.
- `internal/logpattern/template_test.go` — 30 canonical log lines from Redis, Postgres, nginx, Node.js, Python tracebacks, Go panics, Java SLF4J, etc. → expected templates. Breaks if strip rules regress.
- `internal/logpattern/cluster_test.go` — three scenarios: same template + different IPs → 1 cluster; two templates → 2 clusters count-ordered; all-unmatched → single `unmatched` bucket.

### 5.2 Handler tests

- `internal/mcp/server/handlers_inspect_test.go` adds three cases:
  - `TestHandleTriageCluster` — mocks the 4 sub-handlers; asserts `top_problems` respects severity ordering and envelope matches existing `inspect_*` contract.
  - `TestHandleListProblems` — one subtest per filter enum × (matches-present, zero-matches, unknown-filter).
  - `TestHandleSearchLogs` — mocks `handlePodLogsFiltered` with fixture lines; asserts cluster output + `unmatched_error_line_count`.
- **Partial-failure test:** one sub-handler errors → rest succeed, `data.partial: ["observe_events"]` populated, overall tool returns success.

### 5.3 Retirement regression

- `taxonomy_test.go` (existing) must pass with the new count (183 → 161 tools: 183 − 25 retired + 3 new).
- For every retired name, there must be an entry in `cmd/bench/aliases.json` mapping it to the surviving tool. Table test enforces this.

### 5.4 Bench gate

Run locally before merge:

```bash
# Baseline (on main, before branch work)
chat-quality-bench --suite incident-scenarios-20 --model qwen2.5:32b > /tmp/bench-before.json

# After Week-1 work on branch
chat-quality-bench --suite incident-scenarios-20 --model qwen2.5:32b > /tmp/bench-after.json

chat-quality-bench --suite smoke-20 --model qwen2.5:32b > /tmp/smoke-after.json
chat-quality-bench --suite prompts-100 --model qwen2.5:32b > /tmp/prompts100-after.json
```

**Merge gates (all required):**

| Gate | Threshold | Why |
|---|---|---|
| `incident-scenarios-20` pass rate | **≥ baseline + 1** (≥15/20 if baseline is 14) | Hard floor on flagship suite |
| Zero same-tool-15×-loops in any trace | bench-report loop-trap detector | THE Week-1 moat |
| `smoke-20` regression | ≥ prior pass rate − 2% tolerance | Catches upstream breakage |
| `prompts-100` regression | ≥ prior pass rate − 2% | Held bench |
| `go build ./...` | clean | — |
| `go vet ./...` | clean | — |
| `go test ./internal/triage/... ./internal/logpattern/... ./internal/mcp/server/...` | 100% pass | — |

**Stretch target (not merge-blocking):** 16/20 pass on `incident-scenarios-20`. Hit it → celebrate in PR description.

### 5.5 CI integration

Automated bench-in-CI is Wk 6/7 work (when OTel + planner land). For Week 1:

- PR description must include the before/after bench JSON + pass-count diff.
- A reviewer verifies the diff in ~30 seconds without needing GPU infra.

---

## 6. Non-goals (YAGNI fence)

- **No UI changes.** Tools are backend-only. Desktop frontend unaffected.
- **No LLM provider / client changes.** OpenAI, Ollama, Anthropic paths untouched.
- **No taxonomy metadata churn.** New tools use `CategoryObservation`, `RequiredAutonomyLevel: 1`, `Destructive: false`.
- **No DAG planner integration.** Wk 2 work. Week 1 tools are one-shot calls from the existing linear agent loop.
- **No performance tuning.** If p95 latency regresses <5%, ship. Optimization is post-bench.
- **No bench-in-CI wiring.** Wk 6 work.
- **No edit-distance log clustering.** Regex-template only. `drain3`-style clustering is a 1.3.x upgrade if bench signal warrants it.

---

## 7. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `logpattern.Extract` rules over-match on some real-world apps (e.g., Go stack traces with hex addresses) → weird templates | Medium | 30-fixture test suite covers common cases; first-look at bench results will surface any new shapes. Easy to add a strip rule. |
| Retiring `observe_cluster_overview` breaks a bench prompt that expects it by name | Low | `cmd/bench/aliases.json` maps old names → new composites for scoring. Verify via alias regression test (§5.3). |
| `triage.RankCluster` heuristic ranks trivial issues above real incidents | Medium | Table tests pin expected ordering for 15 fixtures; monotonicity invariant. If bench shows bad ranking, tune constants — not a redesign. |
| Sub-handler fanout causes a latency regression | Low | Parallelism via existing `fanOut` helper; per-source latency captured in `sources`. Alert threshold: p95 >5% regression. |
| Bench gate of +1/20 is too loose (can ship a mediocre refactor) | Low | Secondary gate — zero loop-traps — is the real moat. If loop-traps are gone, +1 is an acceptable floor for a single week. |

---

## 8. Delivery shape

- **Branch:** `feat/week1-inspect-completion` off `main@59cb7a7`
- **PR title:** `feat(tools): Week 1 — complete inspect surface + retire 25 observe_*`
- **PR description template:** summary, retirement list, bench before/after diff, loop-trap-count before/after, test coverage, non-goals
- **Estimated size:** ~800 LOC new code (triage + logpattern + 3 handlers + tests), ~400 LOC taxonomy deletion
- **Estimated calendar time:** 3–5 focused days

---

## 9. Next step

Once approved, invoke the `superpowers:writing-plans` skill to produce the ordered implementation plan with per-task acceptance criteria.
