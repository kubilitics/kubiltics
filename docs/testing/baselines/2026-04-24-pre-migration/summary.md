# UI Smoke Baseline — 2026-04-24 pre-migration

**Captured:** 2026-04-24T08:17–08:30 IST
**Target:** `http://localhost:5173` (Vite dev server)
**Backend:** `http://localhost:8190` (kubilitics-backend desktop debug build, PID 91327)
**Active cluster:** `kind-kubilitics-test` (Kind, 3 nodes)
**Viewport:** 1600×1000 (Chrome MCP automation)

This is the **reference baseline** every subsequent migration-phase smoke gate diffs against. Per the harness §5 contract: a flow failing post-phase that passed here = regression, halt migration, rollback.

---

## Results table

| # | Flow | Result | Notes |
|---|---|---|---|
| 1 | Sidebar + dashboard | ✅ **PASS** | Sidebar renders cluster, all resource categories visible, "AI Ready" indicator, Cluster Health grade 94/A, Resources cards (Pods 19, Deployments 5, Services 4, DaemonSets 2, Namespaces 9) |
| 2 | Pods list | ✅ **PASS** | 19 pods render, Total/Running/Succeeded/Pending/Failed breakdown, pagination working, filter/column pickers present. Real data: CrashLoopBackOff pods in `app-welcome-to-docker-653c` (642 restarts) surface correctly |
| 3 | Pod detail | ✅ **PASS** | 12 tabs (Overview/Containers/Logs/Terminal/Metrics/Events/Traces/YAML/Compare/Topology/Blast Radius/Actions), auto-detected diagnostic section "BROKEN — Container keeps crashing" with actionable kubectl commands + exit-code explanations |
| 4 | Deployments + rollout | ✅ **PASS** | 5 deployments, status breakdown (Available 4, Degraded 1), strategy/max-surge/max-unavailable columns populated |
| 5 | Services + endpoints | ✅ **PASS** | 4 services (app, kube-dns, kubernetes, web), ClusterIP types, selectors populated. **Observation:** endpoints column shows "—" for some rows even when backend confirms endpoints exist — mild rendering gap, not a regression |
| 6 | Topology graph | ✅ **PASS** | React Flow + elkjs render 2 nodes with "contains" edge in `default` namespace, filter controls functional, "Ask AI" entry point present, `22 resources hidden` hint at depth |
| 7 | Terminal (kubectl exec) | ⚠️ **PARTIAL** | Terminal tab present in pod-detail tab bar, click registered but view didn't visually switch to terminal. Possible deeper-click needed or modal pattern. Full exec-connection NOT verified in baseline |
| 8 | Metrics charts | ✅ **PASS** | Metrics tab renders with graceful empty state: "Metrics unavailable / No data because pod metrics: the server could not find the requested resource" + actionable resolution hint (install metrics-server). **Correct UI behavior**, not a failure — the kind cluster has no metrics-server |
| 9 | AI chat end-to-end | ❌ **FAIL (baseline)** | Prompt sent, chat shows `0 → 0 tokens · 1521ms` with no assistant response. No console errors. Top bar toggles between "AI Ready" and "AI Unreachable" — brain intermittently disconnected. **Pre-migration state** — captured as known-bad baseline |
| 10 | Settings / AI provider | ✅ **PASS** | Settings page renders, Clusters section shows connected cluster, Projects section empty (new install), Connection Endpoints present. Confirms "AI Unreachable" status from Flow 9. Note: AI provider config may live at separate `/ai` route (not explored) |

**Counts:** 8 PASS · 1 PARTIAL · 1 FAIL (known-bad) · 0 unexpected-FAIL

---

## Known-baseline findings that are NOT migration blockers

These failed or degraded in baseline. Post-migration gate should match or improve — NOT regress.

1. **Flow 9 FAIL — AI chat 0-token response.** Pre-migration brain has intermittent connectivity issue. Either LLM provider not configured, API key missing, or WebSocket flakiness. Gate treats this as "expected fail" in baseline; if post-migration fails identically, the gate is green. If post-migration produces actual AI responses (delta improvement), that's a WIN, not a regression alarm.

2. **Flow 7 PARTIAL — Terminal tab interaction.** Click registered but view didn't switch. Could be a baseline bug, or a UX requiring a specific button inside the tab. Gate: if post-migration Terminal tab also doesn't switch on first click, that's baseline behavior. Only flag if the tab VANISHES or errors.

3. **Flow 5 observation — Services endpoints render "—".** Backend has endpoints; UI doesn't show them. Pre-existing UI bug. Gate: same observation allowed post-migration.

---

## Pre-existing console noise (NOT regressions)

Recorded so post-migration runs can filter them out:

- **React Router v6→v7 future-flag warnings** (2 per page load) — harmless, forward-compat notices
- **i18next `en-IN` translation file missing** — app falls back to `en`, no user impact
- **`validateDOMNesting(<tr> inside <div>)`** in `ListPageLoadingShell` — pre-existing DOM-nesting bug in the loading-skeleton component. Fires on every list page (Pods, Deployments, Services). Not a blocker.
- **Tauri `UpdateBanner` warnings** — `TypeError: Cannot read properties of undefined (reading 'invoke')` on every route change. Expected: we're running in BROWSER mode, not TAURI — the Tauri plugin API doesn't exist. Not a blocker.

---

## Ground-truth signal for post-migration phase gates

For a post-Phase-X smoke run to be **GREEN**, the diff against this baseline must be:

- Flows 1–6, 8, 10: **PASS** (same as baseline) — any change to FAIL = regression, halt migration
- Flow 7: **PARTIAL or better** — if post-phase gets full terminal exec working, that's a WIN
- Flow 9: **FAIL (0-token) or improvement** — if post-phase still shows 0 tokens, baseline-match (green). If post-phase produces real AI responses, huge WIN.

---

## Screenshots captured (session)

Screenshots captured via `mcp__Claude_in_Chrome__computer save_to_disk=true` tool. IDs preserved by Chrome extension:

| Flow | Screenshot ID |
|---|---|
| Connect gate | `ss_9474f51b3` |
| 1 — Dashboard | `ss_0611vxjn9` |
| 2 — Pods list | `ss_86358sxw4` |
| 3 — Pod detail | `ss_57761rzos` |
| 4 — Deployments | `ss_9995mycyx` |
| 5 — Services | `ss_72784eice` |
| 6 — Topology | `ss_70974ec25` |
| 7 — Pod Overview (Terminal click no-op) | `ss_6875i2inq` |
| 8 — Metrics empty state | `ss_09665i0ow` |
| 9a — AI panel open | `ss_46063kptu` |
| 9b — AI 0→0 tokens | `ss_89244z104`, `ss_4340z11pa` |
| 10 — Settings | `ss_77912rhyb` |

(Screenshots saved to `~/Library/Caches/…/ClaudeInChrome/` or similar by the extension; copy into this directory before publishing the baseline publicly.)

---

## Next step

This baseline is now the reference for the monorepo migration [`docs/strategy/2026-04-24-monorepo-migration.md`](../../strategy/2026-04-24-monorepo-migration.md). Before Phase A starts, re-run this suite if more than 72 hours have elapsed — main moves, baseline drifts.

After every phase (A through F), re-run all 10 flows, diff against this table, emit verdict per the harness §5 format. Any flow regressing (PASS → FAIL) blocks phase advancement.
