# Kubilitics 1.2.0 — Scope & Roadmap

**Status:** Draft for review.
**Target ship window:** **6–8 weeks from 2026-04-23** → mid-June 2026.
**Theme:** *"Enterprise-ready AI answers, distribution polish, root-cause introspection."*
**Last updated:** 2026-04-23 (post-v1.1.0 GA).

---

## TL;DR

Three anchor deliverables, in priority order:

1. **`inspect_<kind>` composite tool refactor** — promote bench pass rate from 70% → ≥85% on real-world incident scenarios. Branch already pushed at `vellankikoti/kotg.ai:feat/validation-bench` (16 commits). *This is the single highest-leverage change.*
2. **Root cause inference engine** — stitch events + insights + ownership into causal chains displayed on the topology canvas. 60% exists. Positioning shift: "topology viz tool" → "Kubernetes intelligence engine."
3. **Blast Radius v2 (partial — scoring + OTel coverage)** — closes 2 of 4 gaps flagged as enterprise blockers.

Three smaller but visible improvements:

4. **Automatic Homebrew + winget + Helm OCI distribution** — PRs #88 (tap Pattern E) and #90 (signed OCI charts) merge; first auto-bump validated on 1.2.0 tag.
5. **Pagination + perf for intelligence pages** — P95 page render < 500ms with 1000+ resources.
6. **Layout consistency pass** — SimulationPage, ReportSchedules, AutoPilot match HealthDashboard pattern.

Deferred to **1.3.0**: kagent v1.5 tool-metrics pivot, Security overlay on topology, real-time streaming, time-travel topology.

---

## Anchor 1 — `inspect_<kind>` composite refactor

**Owner context:** [`project_inspect_composite_refactor.md`](../../memory/project_inspect_composite_refactor.md)
**Branch:** `vellankikoti/kotg.ai:feat/validation-bench` (16 commits, pushed)
**Current bench:** 70% on `incident-scenarios-20.json` with qwen2.5:32b on g5.2xlarge

### What ships

Fold `observe_<kind>_detailed + observe_<kind>_events + observe_<kind>_ownership_chain` into one `inspect_<kind>` composite tool per kind. ~50 per-kind tools become ~20 composites. ~163 total tools → ~115.

**Kinds to fold (28):** pod, deployment, replicaset, statefulset, daemonset, job, cronjob, service, ingress, configmap, secret, namespace, node, pv, pvc, hpa, vpa, pdb, networkpolicy, serviceaccount, role, rolebinding, clusterrole, clusterrolebinding, crd, storageclass, resourcequota, limitrange.

### Acceptance gates

- [ ] Each `inspect_<kind>` returns `{summary, spec, status, recent_events, ownership_chain, dependents?}` JSON in one call
- [ ] Bench re-run: ≥ **85% pass** on `incident-scenarios-20.json` with qwen2.5:32b
- [ ] Validate same result on `gpt-4o` + `claude-opus-4-7` for frontier-model sanity
- [ ] Catalog regenerates to ~115 tools, zero breakage reported by smoke test suite
- [ ] 2000-prompt bench (the full validation suite) at ≥ 90%

### Timeline

**2.5 weeks.** Week 1 = design doc + first 5 composites + bench. Week 2 = fold remaining 23 kinds. Week 3 = bench cycle + frontier-model validation.

### Risk

Low. Handlers stay intact; the refactor is a dispatch-layer change. Rollback = git revert.

---

## Anchor 2 — Root cause inference engine

**Owner context:** [`project_root_cause_engine_kickoff.md`](../../memory/project_root_cause_engine_kickoff.md) + [`project_topology_gaps.md`](../../memory/project_topology_gaps.md)
**Prior art:** `internal/events/causality.go`, `internal/events/insights.go`, `health_propagation.go`, `rootCauseHeuristic.ts`

### What ships

Turn "what broke" into "why it broke." Example causal chain rendered on topology canvas:

> `ConfigMap updated` → `Deployment rollout triggered` → `New pods created` → `CrashLoopBackOff` → `Service degraded` → `Ingress 5xx spike`

### Scope

- **Backend:** promote existing `causality.go` from per-resource event correlation to cross-resource temporal stitching. Ownership walker + N-minute temporal window. Output: `/clusters/{id}/rca/{insight_id}` returning a DAG of events with "because" edges.
- **Frontend:** numbered overlay on topology canvas (1→2→3…N), plus timeline panel beside the canvas. Trigger: "Why?" button on every InsightsBanner entry. Auto-run for red-state insights.
- **AI integration:** new tool `rca_chain(insight_id)` calls the backend RCA endpoint, LLM annotates each hop in plain language. Tool is one of the T2 composites, not a new T3.

### Acceptance gates

- [ ] RCA endpoint resolves sub-second for 90th-percentile insight (≤ 500ms)
- [ ] UI renders numbered hop overlay on topology canvas without layout shift
- [ ] LLM narration passes bench: "why did X break?" → correctly-cited causal chain in ≥ 85% of 30-prompt RCA suite (to be authored)
- [ ] Works with zero OTel trace coverage (pure K8s events) AND with OTel (trace-anchored correlation)

### Timeline

**3 weeks.** Can run concurrent with Anchor 1 since the brain refactor and the backend RCA engine touch different codebases. Week 1 = backend DAG + endpoint. Week 2 = frontend overlay. Week 3 = AI tool + bench.

### Risk

Medium. Correlation heuristics can misfire and show wrong chains. Mitigate with: confidence score per hop (displayed in UI), user feedback ✓/✗ on each chain (fed back to tuning), ≥ 85% pass gate before ship.

---

## Anchor 3 — Blast Radius v2 (partial)

**Owner context:** [`project_blast_radius_v2_gaps.md`](../../memory/project_blast_radius_v2_gaps.md)

### What ships (2 of 4 gaps)

- **Scoring rigidity fix** — replace hardcoded weights with a configurable scoring policy. Admins tune `severity_weights.yaml`: network disruption, data-loss-risk, replica-count, downstream-fanout. Policy loaded via ConfigMap, reloadable without restart.
- **OTel coverage visibility** — topology node decoration (✓ has OTel / ✗ no OTel) with tooltip showing % trace coverage last 24h. Users see exactly which services are observable vs dark-matter before running a simulation.

### Deferred to 1.3

- Infra-component validation (cloud-provider visibility — user already flagged as `user_architect_persona`)
- Test coverage expansion from 2/7 scenarios to 7/7

### Timeline

**1.5 weeks.**

---

## Smaller but visible (#4–#6)

### 4. Automatic distribution polish

- [ ] Merge PR #88 (Homebrew tap Pattern E) — `brew install --cask kubilitics` stays current automatically
- [ ] Merge PR #90 (signed OCI Helm charts) — `helm install oci://ghcr.io/vellankikoti/charts/kubilitics` on every GA tag
- [ ] Run `Publish Helm charts` workflow with `tag=v1.1.0` to backfill ghcr.io
- [ ] Next GA tag (v1.2.0) exercises all four paths end-to-end: desktop artifacts, brew auto-bump via 30-min poll, winget submission, OCI chart publish with cosign signatures
- [ ] Mint optional `HOMEBREW_TAP_DISPATCH` fine-grained PAT for instant tap updates (stretch — poll is sufficient)

### 5. Intelligence pages pagination + perf

Current: intelligence pages load all rows client-side. Breaks at 1000+ resources.

- [ ] Server-side pagination via existing REST (`?page=N&size=M`) — backend already supports it per earlier work
- [ ] Virtualized tables (react-window) for lists > 100 rows
- [ ] Target: P95 page-render < 500ms with 1000 resources on a mid-range laptop

### 6. Layout consistency pass

Per [`project_layout_fixes_needed.md`](../../memory/project_layout_fixes_needed.md):

- [ ] SimulationPage → HealthDashboard pattern (`page-container` / `page-inner` / `SectionOverviewHeader`)
- [ ] ReportSchedules → same
- [ ] AutoPilot → same
- [ ] Reports 404 fix (likely a routing config gap, not a data issue)

---

## What we are NOT doing in 1.2

| Item | Deferred to | Reason |
|---|---|---|
| kagent v1.5 CompleteWithTools pivot | 1.3 | E2E blocked twice by infra. Code is on `feat/kagent-v1.5` but not merged. 1.2 is already loaded. |
| Security overlay on topology | 1.3 | Needs compliance-pack work upstream. Not a blocker for current enterprise conversations. |
| Real-time streaming (WebSocket-driven topology) | 1.3 | Isolated gain. Users haven't asked; "refresh on demand" is tolerable. |
| Time-travel topology / snapshot replay | 1.4+ | Big engineering lift; differentiates but isn't a 1.2 must-have. |
| Pricing page + Team tier launch | 1.3 | Premature before license vendor + MSA + first paid pilot. |

---

## Dependency map

```
1.2.0 release
  ├── Anchor 1: inspect_<kind> refactor  ──┐
  │                                         ├── 2000-prompt validation bench
  ├── Anchor 2: Root cause engine       ──┘
  │     └── UI overlay depends on: layout consistency pass (#6)
  │
  ├── Anchor 3: Blast Radius v2 (partial)
  │
  ├── #4: Distribution polish  ──→ gates on PRs #88 + #90 merging
  ├── #5: Pagination + perf
  └── #6: Layout consistency
```

---

## Quality gates before tagging v1.2.0

- [ ] All three anchors shipped and bench targets met
- [ ] Full regression on 2000-prompt validation bench ≥ 90%
- [ ] Desktop app builds green on all three OSes, signed + notarized
- [ ] Helm charts push + sign cleanly on v1.2.0-rc.1 (not just GA)
- [ ] Homebrew tap auto-bumps from v1.2.0 within 30 min of tag
- [ ] No regressions vs v1.1.0 on in-cluster smoke tests (kind, Docker Desktop, at least one cloud cluster)
- [ ] CHANGELOG auto-regenerates on tag (PR #89 pattern proven)
- [ ] Release notes drafted + blog post scheduled

---

## Next actions (this week)

1. Merge PRs #88 + #90 once green
2. Run the 1.1.0 chart backfill via `workflow_dispatch`
3. Kick off Anchor 1 — open `kubilitics-ai/docs/superpowers/specs/inspect-composite.md` via brainstorming skill
4. Kick off Anchor 2 design — re-read `internal/events/causality.go` + write RCA spec
5. Circulate `OPEN-CORE-TIERS.md` draft to 2–3 trusted advisors
