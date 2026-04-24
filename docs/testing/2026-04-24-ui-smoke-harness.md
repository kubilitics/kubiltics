# UI smoke harness — migration-phase gate

**Date:** 2026-04-24
**Purpose:** runnable checklist that verifies the 10 critical user journeys between every phase of the [monorepo migration](../strategy/2026-04-24-monorepo-migration.md), plus as a general regression gate.
**How it runs:** via Claude's Chrome automation MCP tools (or any human, by following the checklist steps).
**Target:** Vite dev server at `http://localhost:5173` + kubilitics-backend at `http://localhost:8190`. Not the native Tauri shell (WKWebView on macOS isn't reachable to Chrome automation).

---

## 0. Why this exists

The [monorepo migration plan](../strategy/2026-04-24-monorepo-migration.md) defines six phases (A–F). Each phase edits git subtrees, module paths, workflows, or publish targets. **Any one of them can silently break UI flows** — a stale module path in brain's dispatch, a Docker image tag miss, a Helm chart reference that now points into the void.

Unit tests don't catch UI regressions. Bench runs validate the LLM reasoning, not the UI wiring. This doc defines the gate: **after every migration phase, all 10 flows below must pass before the next phase starts. Any failure = rollback that phase.**

The same harness doubles as a pre-release smoke for v1.2.0 and every future release.

---

## 1. Pre-requisites (one-time setup, before any run)

### 1.1 Services that must be up

| Service | Port | How to start |
|---|---|---|
| kubilitics-backend | `:8190` | Already running on your dev box (desktop debug build PID varies) |
| Vite dev server | `:5173` | `cd kubilitics-frontend && npm run dev` |
| brain (kubilitics-ai) | `:50051` | Started by the desktop backend as a subprocess; verify with `lsof -iTCP:50051` |
| Local cluster | — | docker-desktop Kubernetes context (from your memory) |

### 1.2 Known-good fixture data

- **At least one connected cluster** in the backend (verify via `curl -s http://localhost:8190/api/v1/clusters \| jq '.[] \| select(.status=="connected")'`)
- **Workloads in `kube-system`** namespace (always present on docker-desktop)
- **Optional but useful:** `kubectl apply` a known-bad pod (e.g. a CrashLoopBackOff image) into a test namespace. Makes the Pods-page smoke case more representative.

### 1.3 Chrome automation tools loaded

Claude's MCP tools under `mcp__Claude_in_Chrome__*` are deferred. They load on first invocation. No manual setup.

---

## 2. Baseline capture (run ONCE before migration Phase A)

Before any migration work, run the full 10-flow suite **on pre-migration main** and save the output:

```bash
mkdir -p docs/testing/baselines/2026-04-24-pre-migration
# Run §4 flows, save per-flow screenshots to this dir.
# Record: pass/fail status, screenshot filenames, console-error log, network-error log.
```

The baseline is the reference. Every subsequent run (post-phase) gets diffed against it.

**Critical:** the baseline is timestamped. Re-run it BEFORE starting migration if more than 72 hours pass between baseline capture and Phase A — mainline moves, and stale baselines produce false-positive regressions.

---

## 3. Run cadence

```
Baseline (pre-migration)               ← run once, save as reference
      ↓
Phase A (git subtree add)              ← run smoke, diff vs baseline
      ↓ (if pass)
Phase B (go module path rename)        ← run smoke, diff vs baseline
      ↓ (if pass)
Phase C (CI workflow relocation)       ← run smoke, diff vs baseline
      ↓ (if pass)
Phase D (release tagging strategy)     ← run smoke, diff vs baseline
      ↓ (if pass)
Phase E (merge + archive)              ← run smoke, diff vs baseline
      ↓ (if pass)
Phase F (downstream fixups)            ← run smoke, diff vs baseline
      ↓ (if pass)
DONE — all gates green
```

**Any diff that includes a regression halts the migration.** Rollback that phase, investigate, fix, re-run smoke, then retry the phase.

---

## 4. The 10 critical flows

Each flow has: **goal**, **exact steps**, **pass criteria**, **fail signal**, **screenshot name**. Structured so either Claude (via Chrome automation) or a human can run it reproducibly.

### Flow 1 — App loads, sidebar renders

**Goal:** verify the frontend boots against the backend and shows cluster state.

**Steps:**
1. `navigate` to `http://localhost:5173`
2. Wait for page `networkIdle` (≤5s)
3. `read_page` — capture DOM

**Pass criteria:**
- Top of page shows a kubilitics logo / header
- Sidebar shows at least one cluster name with a green "connected" indicator
- Sidebar shows resource category headers: Workloads, Networking, Storage, Cluster, Security, Config
- Zero console errors of severity `error` (warnings OK)

**Fail signal:**
- Blank page / React error boundary
- Console has `TypeError`, `NetworkError`, or `Failed to fetch` to `/api/v1/clusters`
- Sidebar collapsed or missing cluster

**Screenshot:** `01-sidebar-loaded.png`

---

### Flow 2 — Pods page renders with real data

**Goal:** verify resource listing path: frontend → `GET /api/v1/clusters/:id/pods` → render table.

**Steps:**
1. Click sidebar "Workloads" → "Pods"
2. Wait for table to populate (≤10s)
3. Capture network tab — verify `GET /api/v1/clusters/:id/pods` returned 200
4. `read_page` — count table rows

**Pass criteria:**
- Table shows ≥ 1 pod (kube-system pods on docker-desktop always produce ≥3)
- Each row has: Name, Namespace, Status, Restarts, Age
- Pagination/filter controls present
- Zero console errors

**Fail signal:**
- Empty table when backend confirms pods exist (via `kubectl get pods -A`)
- 500 response from `/api/v1/clusters/:id/pods`
- Table stuck in "Loading…" for >10s

**Screenshot:** `02-pods-list.png`

---

### Flow 3 — Pod detail view renders

**Goal:** verify detail-panel path including events + logs lazy-loading.

**Steps:**
1. From the Pods page, click on first pod row (any `kube-system` pod)
2. Wait for detail panel to open (≤3s)
3. Verify tabs: Overview / Spec / Status / Events / Logs
4. Click "Events" tab → events list renders
5. Click "Logs" tab → log viewer renders with ≥ 1 line

**Pass criteria:**
- Detail panel opens via animation / route change
- Spec shows container image, resource requests, volumes
- Events tab shows ≥ 0 events (some pods have none; verify no error instead)
- Logs tab shows streaming log lines or a "no logs" message (not an error)
- Zero console errors during tab switches

**Fail signal:**
- Detail panel doesn't open
- Spec/Status show placeholder values ("—", "unknown") when backend has real data
- Events tab shows an error
- Logs tab shows WebSocket disconnect / 500

**Screenshot:** `03-pod-detail.png` (showing Logs tab populated)

---

### Flow 4 — Deployments page + rollout history

**Goal:** verify deployment-specific composite rendering (rollout history is unique to deployments).

**Steps:**
1. Click sidebar "Workloads" → "Deployments"
2. Table renders
3. Click a deployment (e.g., `coredns` in kube-system)
4. Switch to "Rollout History" tab
5. Verify revisions list

**Pass criteria:**
- Deployments table shows columns: Name, Namespace, Ready, Up-to-date, Available
- Rollout History shows at least Revision 1
- Replica-set children are listed or linked

**Fail signal:**
- Rollout history empty or erroring
- Children panel missing
- Deployments table confuses rows with pods

**Screenshot:** `04-deployment-rollout.png`

---

### Flow 5 — Services page + endpoints

**Goal:** verify service → endpoints resolution.

**Steps:**
1. Click sidebar "Networking" → "Services"
2. Table renders
3. Click the `kubernetes` service (always present)
4. Verify endpoints panel shows an IP:port

**Pass criteria:**
- Services table shows at least the `kubernetes` service
- Detail view shows ClusterIP, ports, selector
- Endpoints panel shows ≥1 endpoint (the API server IP)

**Fail signal:**
- Endpoints panel empty when backend confirms they exist
- Service detail shows wrong cluster IP

**Screenshot:** `05-service-endpoints.png`

---

### Flow 6 — Topology graph renders

**Goal:** verify the graph-visualization path (React Flow + elkjs layout). This is the Kubilitics flagship feature.

**Steps:**
1. Click sidebar "Topology"
2. Wait for layout engine (≤15s on first render)
3. Verify ≥ 1 node rendered
4. Try clicking a node — detail popover opens

**Pass criteria:**
- Canvas renders nodes + edges (not blank)
- Nodes are labeled (Pod/Service/Deployment icons visible)
- Zoom + pan controls work
- Node click opens a detail popover with resource spec
- Zero WebGL errors or `Uncaught` exceptions

**Fail signal:**
- Canvas blank for >15s
- `elkjs` or `@xyflow/react` console errors
- Pan/zoom non-functional

**Screenshot:** `06-topology-graph.png`

---

### Flow 7 — Terminal / kubectl exec

**Goal:** verify WebSocket terminal path (streaming bidirectional).

**Steps:**
1. From a pod detail view, click "Terminal" or "Exec"
2. Wait for xterm.js to initialize
3. Type `ls /` + Enter
4. Verify output appears within 3s

**Pass criteria:**
- Terminal prompt appears
- Input echoes
- `ls /` returns directory listing
- WebSocket stays connected for ≥30s

**Fail signal:**
- Terminal frame loads but no prompt
- WebSocket 1006 abnormal closure
- Input doesn't echo

**Screenshot:** `07-terminal-exec.png`

---

### Flow 8 — Metrics page + charts

**Goal:** verify Prometheus-style metrics rendering (Recharts).

**Steps:**
1. Click sidebar "Cluster" → "Metrics" (or Dashboard, depending on IA)
2. Wait for charts (≤10s)
3. Verify at least CPU + Memory charts render

**Pass criteria:**
- ≥ 2 charts render with ≥ 1 data point
- X-axis shows time, Y-axis shows values with units
- Legend visible
- Data refreshes on navigation back (optional but flagged if not)

**Fail signal:**
- Empty chart canvases
- `Cannot read property 'length' of undefined` on chart data
- Metrics API returns 404 or 503

**Screenshot:** `08-metrics-charts.png`

---

### Flow 9 — AI assistant chat, end-to-end

**Goal:** verify the AI flow (the Week-1 work's primary surface).

**Steps:**
1. Click "Ask AI" button (or `Cmd+I` shortcut)
2. Chat panel opens from right
3. Type: `What pods are in the kube-system namespace?`
4. Send (Enter or click send icon)
5. Watch for: `ToolBlock` renders (shows tool name + args) → `text_delta` stream (assistant narrates results)
6. Wait for completion (≤60s on gpt-4o; ≤90s on qwen2.5:32b)

**Pass criteria:**
- Panel opens without layout shift
- Prompt echoes in the history
- At least one `ToolBlock` component appears (likely `inspect_pod` or `list_problems` after PR #7)
- A non-empty `assistant` bubble renders the final answer
- Answer mentions real pod names from kube-system (coredns, etcd, etc.)
- Zero WebSocket disconnects during the turn

**Fail signal:**
- Panel doesn't open / is behind other elements
- No tool block (LLM hallucinated without tools)
- `text_delta` stream stops mid-response
- WebSocket 1006 or 4000-series close codes
- Assistant returns "I cannot access your cluster" when cluster is connected

**Screenshot:** `09-ai-chat-triage.png` (showing completed response)

**IMPORTANT:** This flow's pass criteria changes based on which PRs are live:
- **Pre PR #7:** expects one of `observe_pod_detailed`, `observe_resources_by_query`, or any `inspect_*` tool to be called.
- **Post PR #7:** expects `list_problems` (with `filter:pending` or similar) OR `inspect_pod`. Tool-name assertion tightens.

### Flow 10 — Settings / AI provider config

**Goal:** verify the AI configuration page (where users set LLM provider + keys).

**Steps:**
1. Click Settings (gear icon) or `/settings` route
2. Navigate to "AI Provider" tab
3. Verify current provider displays (Ollama / OpenAI / Anthropic)
4. Click "Validate connection" button
5. Wait for response

**Pass criteria:**
- Settings page renders without 404
- AI provider tab shows current config + "Validate connection" button
- Validate returns success toast OR a diagnostic error (not a silent failure)
- Config values match what's in `~/.config/kubilitics/ai-config.yaml` (or wherever it's stored)

**Fail signal:**
- Settings route 404s
- Validate button does nothing / spins forever
- Provider tab shows stale config after edit + save

**Screenshot:** `10-settings-ai.png`

---

## 5. Pass/fail gate (the contract)

**All 10 flows must pass for a phase to be considered safe.** Each flow evaluates to `PASS` or `FAIL`; partial credit doesn't count.

**Regression vs intended change:**
- If a flow fails post-phase AND passed in baseline → **regression**, halt migration
- If a flow fails post-phase AND also failed in baseline → **pre-existing bug**, not a migration blocker (file a separate issue and move on)
- If a flow's pass criteria TIGHTENS post-phase (e.g., Flow 9 tool-name assertion after PR #7 merges) → explicitly document the tightening in the phase commit message

**Gate output format:**
```
=== smoke gate — phase B (go module path rename) ===
date: 2026-05-08T14:32:10Z
commit: a1b2c3d (post Phase B)
baseline: 2026-04-24-pre-migration/

Flow  1 (sidebar):          PASS (was PASS)
Flow  2 (pods):             PASS (was PASS)
Flow  3 (pod detail):       PASS (was PASS)
Flow  4 (deployments):      PASS (was PASS)
Flow  5 (services):         PASS (was PASS)
Flow  6 (topology):         PASS (was PASS)
Flow  7 (terminal):         PASS (was PASS)
Flow  8 (metrics):          PASS (was PASS)
Flow  9 (AI chat):          PASS (was PASS; tool_name=list_problems — Week-1 tightening)
Flow 10 (settings):         PASS (was PASS)

VERDICT: GREEN — proceed to Phase C
```

Or, if a regression:
```
Flow  6 (topology):         FAIL (was PASS) — console error: elkjs not found
VERDICT: RED — halt migration, rollback Phase B
```

---

## 6. Where results land

After each run:
```
docs/testing/
├── baselines/
│   └── 2026-04-24-pre-migration/
│       ├── 01-sidebar-loaded.png
│       ├── 02-pods-list.png
│       ├── ... (all 10)
│       ├── console-log.json
│       ├── network-log.json
│       └── summary.md
└── runs/
    ├── 2026-05-05-phase-A/
    ├── 2026-05-07-phase-B/
    └── ... (one dir per phase)
```

Per-run `summary.md` captures the output format from §5. Screenshots get diffed manually (visual-diff tooling is out of scope for this harness; eyeball is fast enough at 10 flows).

---

## 7. Integration with migration plan

Add this to [`2026-04-24-monorepo-migration.md`](../strategy/2026-04-24-monorepo-migration.md) between every phase:

> ### Smoke gate — Phase X
> Run [UI smoke harness](../testing/2026-04-24-ui-smoke-harness.md) against `http://localhost:5173`. All 10 flows must pass against `docs/testing/baselines/2026-04-24-pre-migration/`.
>
> If RED: `git reset --hard <pre-phase-sha>` on the migration branch, investigate, re-attempt.
> If GREEN: proceed to Phase X+1.

---

## 8. Who runs the gate

**Claude via Chrome automation** — during interactive sessions. I can execute §4 sequentially, emit the §5 report format as my response.

**You (manually)** — if Claude isn't available during migration day. Each flow's steps are human-readable.

**CI (future work)** — port the §4 flows to a Playwright spec once the migration is done. Spec lives at `scripts/ui-smoke/migration-smoke.spec.ts`. Triggered via GitHub Actions. Not needed for this migration but useful for v1.3.x onward.

---

## 9. Adding more flows

Current 10 cover the user-identified critical paths. Add a flow when:
- A bug escapes to production on a path not covered
- A new feature ships that's critical enough to justify a permanent gate (e.g., blast-radius simulator in Week 5)

Don't add flows for every minor feature — gate size matters. 10 flows = ~15–20 min to run by hand. 30 flows = never-run.

---

## 10. Open questions

1. **Visual regression tool?** Right now diffs are eyeball. If the migration reveals multiple near-miss visual changes, pulling in [`reg-suit`](https://github.com/reg-viz/reg-suit) or Percy's free tier is ~1 hour of setup. Defer until needed.

2. **Auth state** — does the desktop app require login? Current memory says "Auth disabled by default" (desktop default). If a migration phase changes auth defaults, Flow 1 breaks silently. Flag in §5 if login page appears where it shouldn't.

3. **Keyboard-shortcut smoke?** `Cmd+I` for AI, `Cmd+K` for command palette, etc. Not in §4 current 10. Add as Flow 11 if shortcut regressions become a pattern.

4. **Multi-cluster switch** — if the dev box has multiple connected clusters, Flow 1 verifies one is "active" but not that switching works. Add as Flow 11 if multi-cluster is in the critical path for v1.2.0.
