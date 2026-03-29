# Cluster-Wide Blast Radius — Design Spec

**Date:** 2026-03-29
**Status:** Approved
**Scope:** Backend graph engine + frontend redesign + enhanced API

## Purpose

When a production incident hits at 3am and logs aren't helping, Kubilitics' blast radius tells you instantly: "this resource is critical, here are its 23 dependencies across 4 namespaces, and here's exactly what breaks if it goes down." Visual clarity, cascading simulation, zero guesswork. This is Kubilitics' core USP alongside Topology.

## Current Limitations

1. **Namespace-scoped only** — graph built per-request from a single namespace. Cross-namespace dependencies (Service in ns-A used by Deployments in ns-B, ns-C) are invisible.
2. **Not all resource kinds supported** — only Deployments, StatefulSets, DaemonSets, Services registered as graph nodes. Pods, ConfigMaps, Secrets, Ingresses, PVCs cause "not found in namespace dependency graph" errors.
3. **Per-request computation** — every blast radius query fetches all namespace resources and rebuilds the graph from scratch. Slow on large namespaces.
4. **Limited dependency detection** — no cross-namespace DNS references, no NetworkPolicy namespaceSelector analysis, no service mesh integration.
5. **Basic UI** — score cards + flat affected list. No wave grouping, no failure paths, no risk indicators, no animated cascade simulation.

## Architecture

### Backend: ClusterGraphEngine

One `ClusterGraphEngine` per connected cluster, initialized on cluster connect.

**Data flow:**
```
K8s Informers (all namespaces) → Event → Mark Dirty → Debounce (2s quiet) → Full Rebuild (from informer cache, CPU-only) → Atomic Pointer Swap → GraphSnapshot (immutable)
```

**Key properties:**
- Informers watch cluster-wide: Pod, Deployment, ReplicaSet, StatefulSet, DaemonSet, Job, CronJob, Service, Ingress, NetworkPolicy, ConfigMap, Secret, ServiceAccount, PVC, HPA. Istio CRDs (VirtualService, DestinationRule) added when detected.
- Debounce timer: 2 seconds of quiet after last event. A deploy rollout producing 50 events triggers 1 rebuild.
- Rebuild reads from informer's local cache — zero network I/O, zero API rate limit concerns.
- New snapshot swapped via `atomic.Value` — lock-free reads, zero contention.
- During rebuild, queries read the old (still valid) snapshot.

**Performance targets (up to 5,000 resources):**
- Query response: <100ms (BFS on in-memory snapshot)
- Read path: zero locks (atomic.Value pointer swap)
- Graph rebuild: <5s in background
- Max staleness: 2-5s (debounce + rebuild time)
- Memory: ~200-500MB per cluster graph

**Package structure:** `internal/graph/`
- `engine.go` — ClusterGraphEngine lifecycle, informer setup, debounce loop, rebuild trigger, atomic snapshot swap
- `snapshot.go` — Immutable GraphSnapshot: nodes, edges, forward/reverse adjacency maps, pre-computed per-node metrics
- `builder.go` — Full graph construction from informer cache data
- `inference.go` — All 8 dependency detection techniques (see below)
- `scoring.go` — Enhanced criticality scoring with weighted PageRank + risk penalties
- `risk.go` — Risk indicator detection (SPOF, no HPA, no PDB, ingress exposure, data store, cross-namespace reach)

### Dependency Detection (8 Techniques)

| # | Technique | Scope | Edge Type |
|---|-----------|-------|-----------|
| 1 | OwnerRef chain | Within namespace | `owner_ref` |
| 2 | Service label selectors → Pods → owner workloads | Within namespace | `selector` |
| 3 | Env var / DNS refs (`svc.namespace.svc.cluster.local`) | **Cross-namespace** | `env_var` |
| 4 | Volume mounts (shared ConfigMaps/Secrets) | Within namespace | `volume_mount` |
| 5 | Ingress backend → Service | **Cross-namespace** (via annotations) | `ingress_route` |
| 6 | NetworkPolicy namespaceSelector + podSelector | **Cross-namespace** | `network_policy` |
| 7 | Istio VirtualService route destinations | **Cross-namespace** | `istio_route` |
| 8 | Istio DestinationRule host references | **Cross-namespace** | `istio_destination` |

Techniques 7-8 are opt-in — informers added only if Istio CRDs are detected in the cluster's API groups at startup.

### API Endpoints

**Enhanced (existing route, new behavior):**
```
GET /clusters/{id}/blast-radius/{namespace}/{kind}/{name}
```
Now reads from ClusterGraphEngine snapshot. Returns enhanced BlastRadiusResult with waves, failure paths, risk indicators, cross-namespace metrics.

**New:**
```
GET /clusters/{id}/blast-radius/summary
```
Top N most critical resources in the cluster. Pre-computed from graph snapshot.

```
GET /clusters/{id}/blast-radius/graph-status
```
Graph health: node count, edge count, last rebuild time, rebuild duration, staleness. Frontend uses this to show "building dependency graph..." on first load.

### Response Model

```go
type BlastRadiusResult struct {
    TargetResource     ResourceRef
    CriticalityScore   float64              // 0-100 (weighted PageRank + penalties)
    CriticalityLevel   string               // "critical|high|medium|low"
    BlastRadiusPercent float64              // % of cluster workloads affected

    FanIn              int                  // direct dependents
    FanOut             int                  // direct dependencies
    TotalAffected      int                  // transitive impact count
    AffectedNamespaces int                  // cross-namespace reach

    IsSPOF             bool
    HasHPA             bool
    HasPDB             bool
    IsIngressExposed   bool
    IngressHosts       []string
    ReplicaCount       int

    Waves              []BlastWave          // grouped by BFS depth
    DependencyChain    []BlastDependencyEdge
    RiskIndicators     []RiskIndicator

    GraphNodeCount     int
    GraphEdgeCount     int
    GraphStalenessMs   int64
}

type BlastWave struct {
    Depth     int
    Resources []AffectedResource
}

type AffectedResource struct {
    ResourceRef
    Impact    string     // "direct" | "transitive"
    WaveDepth int
    FailurePath []PathHop
}

type PathHop struct {
    From     ResourceRef
    To       ResourceRef
    EdgeType string      // "selector|env_var|volume_mount|ingress_route|..."
    Detail   string      // human-readable: "env: PAYMENT_URL=svc.ns.svc"
}

type RiskIndicator struct {
    Severity string      // "critical|warning|info"
    Title    string      // "No HPA configured"
    Detail   string      // "Cannot auto-scale under pressure"
}
```

### Criticality Scoring

Enhanced formula using weighted PageRank (reusing algorithm from `topology/v2/builder/criticality_scorer.go`) plus risk penalties:

| Component | Points | Description |
|-----------|--------|-------------|
| Weighted PageRank | 0-30 | Graph centrality from topology's PageRank algorithm |
| Fan-in score (fanIn × 3.0, capped) | 0-20 | More dependents = more critical |
| Cross-namespace reach | 0-10 | Spans > 1 namespace = wider blast |
| Data store penalty | +15 | StatefulSet or has PVCs |
| Ingress exposure penalty | +10 | Externally reachable, user-facing |
| SPOF penalty | +10 | Single replica, sole provider |
| No HPA penalty | +5 | Cannot auto-scale |
| No PDB penalty | +5 | Vulnerable to node drain |
| **Total** | **max 100** | |

Levels: critical >= 75, high >= 50, medium >= 25, low < 25.

### Risk Indicators (Auto-Detected)

| Risk | Severity | Detection |
|------|----------|-----------|
| Single Point of Failure | critical | 1 replica AND sole provider for a downstream target |
| No PodDisruptionBudget | critical | No PDB matching this workload's labels |
| No HPA | warning | No HPA targeting this workload |
| Cross-namespace dependencies | warning | Affected resources span > 1 namespace |
| Ingress exposed | info | Service referenced by Ingress backend |
| Data store | info | StatefulSet or workload with PVC owner refs |

## Frontend

### Design Principles

- **Apple-grade clarity** in both dark and light mode
- Follow existing Kubilitics design system: Tailwind CSS, `dark:` prefix theming, CSS custom properties from `src/tokens/`, Framer Motion for animations
- Reference Metrics and Topology tabs for consistency in layout, spacing, card patterns
- Use `getCanvasColors(isDark)` pattern for canvas-specific colors
- Use existing `cn()` utility for conditional class composition

### BlastRadiusTab Layout (Top to Bottom)

1. **Critical Banner** — full-width gradient banner. Color matches criticality level (red=critical, orange=high, yellow=medium, blue=low). Shows: human-readable verdict ("23 resources at risk across 4 namespaces"), criticality score badge, blast radius %.

2. **Risk Indicator Cards Row** — 4 compact cards: SPOF status, Blast Radius %, Fan-in/Fan-out, Cross-namespace count. Colored borders matching severity.

3. **Action Bar** — "Simulate Failure" button (red, prominent), "Fit View", "Export PNG". During simulation: progress bar with wave counter ("Wave 2 of 3"), "Clear Simulation" button.

4. **Interactive Cascade Graph** — React Flow canvas (reusing TopologyCanvas with enhanced simulation props). Focus resource highlighted with category color + glow. Legend overlay: direct impact (red), transitive (orange), unaffected (green), focus (blue).

5. **Bottom Split Panel:**
   - **Left: Affected Resources** — grouped by wave depth. Wave 1 (direct, red), Wave 2+ (transitive, orange). Each resource clickable → navigates to its detail page. Shows kind, name, namespace.
   - **Right: Risk Indicators + Failure Paths** — risk indicator cards with severity colors. Expandable failure path for each affected resource showing the exact hop chain.

6. **First-Load Skeleton** — when graph is building: spinner with "Building dependency graph... Analyzing X resources across Y namespaces" + progress bar. Query `/graph-status` to get counts.

### Simulation Animation

BFS wave groups pre-computed from API response (already grouped by wave depth). Animation is purely client-side:

1. **Origin** (t=0): Focus node pulses red with expanding shockwave ring. Counter: "0 affected"
2. **Wave 1** (t=800ms): Edges from origin glow red (animated CSS gradient). Direct dependent nodes turn red with subtle scale-up. Counter ticks.
3. **Wave 2+** (t=800ms each): Edges glow, nodes turn orange. Unaffected nodes fade to 15% opacity + desaturate.
4. **Complete**: Progress bar fills. Impact panel updates with final counts. All affected nodes remain highlighted.

Animation driven by `requestAnimationFrame` with 800ms intervals between waves. Cancelable via "Clear Simulation" button at any point.

### Dark/Light Mode

All blast radius UI components use Tailwind `dark:` prefix classes, consistent with existing patterns:
- Banner: gradient colors with dark/light variants
- Cards: `bg-white dark:bg-slate-800`, `border-slate-200 dark:border-slate-700`
- Graph canvas: `getCanvasColors(isDark)` for background, grid, node colors
- Risk indicators: semantic status colors from CSS custom properties (`--color-error`, `--color-warning`, `--color-info`)
- Text: `text-slate-900 dark:text-slate-100` for primary, `text-slate-500 dark:text-slate-400` for secondary

## File Changes

### New Files (Backend)
| File | Purpose |
|------|---------|
| `internal/graph/engine.go` | ClusterGraphEngine — informer setup, debounce, rebuild loop, atomic snapshot |
| `internal/graph/snapshot.go` | Immutable GraphSnapshot — nodes, edges, adjacency, metrics |
| `internal/graph/builder.go` | Full graph construction from informer cache |
| `internal/graph/inference.go` | All 8 dependency detection techniques |
| `internal/graph/scoring.go` | Criticality scoring with PageRank + penalties |
| `internal/graph/risk.go` | Risk indicator detection |

### New Files (Frontend)
| File | Purpose |
|------|---------|
| `src/hooks/useBlastRadiusV2.ts` | New hook for enhanced API — waves, risks, graph status |
| `src/components/blast-radius/SimulationEngine.ts` | Wave animation engine — pre-computes groups, drives animation loop |

### Modified Files (Backend)
| File | Change |
|------|--------|
| `internal/api/rest/handler.go` | Register new endpoints, inject ClusterGraphEngine |
| `internal/api/rest/blast_radius.go` | Rewrite to read from graph engine snapshot |
| `internal/models/blast_radius.go` | Enhanced types: BlastWave, AffectedResource, PathHop, RiskIndicator |
| `cmd/server/main.go` (or startup) | Initialize ClusterGraphEngine per cluster |

### Modified Files (Frontend)
| File | Change |
|------|--------|
| `src/components/resources/BlastRadiusTab.tsx` | Major rewrite — banner, waves, risk panel, simulation |
| `src/services/api/types.ts` | TypeScript types matching new response model |
| `src/services/api/topology.ts` | New API functions for enhanced endpoints |
| `src/topology/TopologyCanvas.tsx` | Enhanced simulation rendering — wave colors, edge glow, progress |

### Deprecated
| File | Reason |
|------|--------|
| `internal/service/blast_radius.go` | Replaced entirely by `internal/graph/*` |

## What Stays Unchanged

- **Topology system** — untouched, blast radius has its own graph engine
- **React Flow / ELK layout** — same rendering stack, enhanced not replaced
- **RBAC / Auth** — same `wrapWithRBAC` pattern for new endpoints
- **API route patterns** — same Gorilla mux, same URL structure
- **Theme system** — same Tailwind + CSS custom properties + Zustand store
