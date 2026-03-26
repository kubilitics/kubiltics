# Topology V2 Enhanced Engine — Design & Implementation Plan

**Date**: 2026-03-25
**Branch**: `feat/topology-v2-engine`
**Goal**: World-class K8s relationship visualization — Apple-grade UX at 1000+ node scale

---

## Problem Statement

Current topology captures **15-20% of real K8s relationships**. A production Pod connects to 50-100+ resources. We show 5-10. After 9+ months, the system has:

- **Shallow data model** — nodes carry name+kind+status, missing conditions, resource usage, security context
- **Incomplete matchers** — 12 matchers covering ~65 edge types. Production clusters have 500-1000
- **250-node hard cap** — frontend truncates 40-60% of real clusters silently
- **Synchronous ELK layout** — UI freezes at 400+ nodes
- **No bidirectional intelligence** — can't answer "what depends on this ConfigMap?"
- **1,404 lines of dead D3 code** — legacy baggage

---

## Architecture: Three-Layer System

### Layer 1: Relationship Engine (Backend)

**Current**: 12 matchers, ~65 edge types
**Target**: 20+ matchers, 300+ edge types

#### New Matchers to Build

| Matcher | Relationships | Priority |
|---------|--------------|----------|
| **AffinityMatcher** | Pod→Node (nodeAffinity), Pod→Pod (podAffinity/Anti) | P0 |
| **PriorityMatcher** | Pod→PriorityClass, Pod→RuntimeClass | P0 |
| **WorkloadRBACMatcher** | Deployment/STS/DS→ServiceAccount (via template.spec) | P0 |
| **ProjectedVolumeMatcher** | Pod→ConfigMap/Secret/SA (via projected volumes) | P0 |
| **NetworkPolicyRuleMatcher** | NP→Pod (ingress from), NP→Pod (egress to), with ports | P1 |
| **EventMatcher** | Event→involvedObject (any resource) | P1 |
| **ResourceQuotaMatcher** | ResourceQuota→Namespace, LimitRange→Namespace | P1 |
| **ReverseDependencyIndexer** | ConfigMap→consumers, Secret→consumers, SA→Pods | P0 |

#### Fix Existing Matchers

| Matcher | Fix | Impact |
|---------|-----|--------|
| **SelectorMatcher** | Use `labels.SelectorFromSet()` instead of hardcoded "app" key | Multi-key selectors work |
| **RBACMatcher** | Process User/Group subjects, not just ServiceAccount | Complete RBAC topology |
| **EnvRefMatcher** | Include init containers and ephemeral containers | 10% more ConfigMap/Secret edges |
| **NamespaceMatcher** | Add Roles, RoleBindings, HPAs, PDBs, NetworkPolicies | Complete namespace view |
| **SchedulingMatcher** | Add PriorityClass, RuntimeClass edges | Scheduling visibility |

#### Enrich Node Data Model

```go
// Current: name, kind, status, namespace
// V3: add operational fields
type TopologyNodeV3 struct {
    // ... existing fields ...
    Conditions      []Condition  // Pod/Node conditions
    ContainerStatus []Container  // Running/waiting/terminated per container
    ResourceUsage   Resources    // CPU/memory requests/limits + actual usage
    QoSClass        string       // Guaranteed/Burstable/BestEffort
    SecurityContext SecurityCtx  // RunAsUser, capabilities, etc.
    Ports           []Port       // Exposed ports (Pod, Service)
    Replicas        *ReplicaInfo // Desired/ready/available (workloads)
}
```

### Layer 2: Graph Intelligence (New)

**Purpose**: Deduplicate, rank, enable progressive disclosure

- **Reverse dependency index**: For any resource, instantly find all consumers
- **Impact analysis**: "If I delete this ConfigMap, what breaks?" — traverse reverse edges
- **Pod aggregation**: 10 identical nginx pods → 1 summary node "nginx (10 replicas)"
- **Health propagation**: Pod unhealthy → RS → Deployment gets error status BEFORE sending to canvas
- **Importance ranking**: Order nodes by connection count — high-connection nodes are more important

### Layer 3: Rendering Engine (Frontend)

**Strategy**: Keep React Flow for <1000 nodes, add Dagre as faster layout, feature-flag Sigma.js for scale.

#### Phase 1: Dagre Layout (Week 1-2)
- Swap ELK → Dagre for 300-1000 node range
- 40% faster layout, same visual quality
- Dagre already available via cytoscape-dagre in deps

#### Phase 2: Remove 250-Node Cap (Week 2-3)
- Raise to 1000 nodes with Dagre
- Add progress indicator during layout
- Implement pod aggregation to reduce node count

#### Phase 3: Sigma.js for 1000+ (Week 4-6)
- Feature flag: `TOPOLOGY_LARGE_GRAPH=sigma`
- WebGL rendering, 10k nodes at 60fps
- Namespace clustering built-in
- Seamless switch: React Flow <1000, Sigma ≥1000

---

## Implementation Phases

### Phase 1: Relationship Completeness (Week 1-2)

**Backend changes only. No frontend risk.**

1. Fix SelectorMatcher — proper label selector matching
2. Add PriorityMatcher — Pod→PriorityClass, Pod→RuntimeClass
3. Add WorkloadRBACMatcher — Deployment→ServiceAccount via template
4. Add AffinityMatcher — nodeAffinity, podAffinity/AntiAffinity
5. Fix RBACMatcher — process User/Group subjects
6. Fix EnvRefMatcher — include init containers
7. Fix NamespaceMatcher — add missing resource types
8. Build ReverseDependencyIndexer — "what uses this ConfigMap?"
9. Enrich node data model — conditions, containers, resources

**Expected impact**: Edge count increases 3-5x. Users see REAL topology.

### Phase 2: Graph Intelligence (Week 2-3)

1. Pod aggregation — collapse identical pods into summary nodes
2. Health propagation — compute health before sending to canvas (no flicker)
3. Impact analysis API — `GET /topology/v2/impact/{kind}/{ns}/{name}`
4. Importance ranking — sort nodes by connection density

### Phase 3: Frontend Performance (Week 3-5)

1. Replace ELK with Dagre for 300-1000 node range
2. Remove 250-node hard cap → raise to 1000
3. Add layout progress indicator
4. Delete legacy D3TopologyCanvas.tsx (1,404 lines)
5. Implement edge type filtering (show/hide by category)
6. Implement kind filtering (show/hide resource types)

### Phase 4: Scale (Week 5-8)

1. Feature-flag Sigma.js for 1000+ nodes
2. Web Worker for layout computation (non-blocking)
3. Server-side WebSocket push (real-time graph updates)
4. Pagination in collector for 1000+ resources per namespace

---

## Success Criteria

- **Relationship coverage**: 80%+ of real K8s edges (from current 15-20%)
- **Scale**: 1000 nodes at 60fps, no UI freeze
- **Bidirectional**: Click any resource → see all dependents AND dependencies
- **Impact analysis**: "What breaks if I delete X?" in <200ms
- **Pod aggregation**: 100 identical pods → 1 node with badge
- **No regression**: Existing topology features continue working
- **Apple-grade UX**: Smooth animations, instant response, zero clutter

---

## Files to Change

### Backend (kubilitics-backend/internal/topology/v2/)
- `relationships/selector.go` — fix label selector
- `relationships/rbac.go` — add User/Group subjects
- `relationships/env_ref.go` — include init containers
- `relationships/namespace.go` — add missing resource types
- `relationships/scheduling.go` — add PriorityClass/RuntimeClass
- `relationships/affinity.go` — **NEW** — node/pod affinity
- `relationships/priority.go` — **NEW** — PriorityClass/RuntimeClass
- `relationships/workload_rbac.go` — **NEW** — Workload→ServiceAccount
- `relationships/network_policy_rules.go` — **NEW** — NP ingress/egress details
- `relationships/reverse_index.go` — **NEW** — reverse dependency lookup
- `builder/graph_builder.go` — enrich node data model
- `builder/health_propagation.go` — **NEW** — compute health before send
- `builder/pod_aggregation.go` — **NEW** — collapse identical pods
- `collector_k8s.go` — add pagination for large namespaces

### Frontend (kubilitics-frontend/src/topology/)
- `hooks/useElkLayout.ts` — add Dagre branch
- `hooks/useTopologyData.ts` — remove 250-node cap
- `TopologyToolbar.tsx` — add kind filter, edge type filter
- `TopologyCanvas.tsx` — layout progress indicator
- **DELETE**: `topology-engine/renderer/D3TopologyCanvas.tsx` (1,404 lines dead code)

---

## Risk Mitigation

1. **All work on `feat/topology-v2-engine` branch** — main untouched
2. **Backend matchers are additive** — new matchers don't break existing ones
3. **Frontend changes behind feature flags** — Dagre/Sigma toggled via config
4. **Phase 1 is backend-only** — zero frontend risk
5. **Tests for every new matcher** — matcher interface enforces testability
