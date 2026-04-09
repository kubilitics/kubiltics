# Blast Radius Analysis Engine v2 — Design Spec

**Date:** 2026-04-09
**Scope:** Sub-project 1 of 3 — Backend Engine Overhaul + API Contract
**Status:** Approved for implementation

---

## Problem Statement

The current blast radius engine produces misleading scores. A single Pod backed by a 2-replica ReplicaSet shows 66.7% blast radius and a score of 44 MEDIUM — implying serious cluster risk when the real-world impact is zero. Kubernetes self-healing, controller hierarchies, and endpoint health are ignored. The system counts graph edges, not actual failure impact.

This overhaul replaces the graph-traversal approach with a **failure impact simulation engine** that answers: "If this resource fails under a specific failure mode, which workloads actually lose functionality, and to what degree?"

---

## Core Principles

1. **Failure mode awareness** — blast radius depends on HOW something fails (pod-crash vs workload-deletion vs namespace-deletion)
2. **Self-healing respect** — Kubernetes controllers fix problems; they are not victims
3. **Impact = loss of functionality** — measured through Service endpoint availability, not graph connectivity
4. **No fabricated dependencies** — only Kubernetes-native relationships and real OTel trace data
5. **Explainability** — every score must be traceable to specific, auditable inputs

---

## Dependency Model

### Tier 1 — Kubernetes-Native (always available)

| Relationship | Source of Truth |
|---|---|
| Pod → Controller | `ownerReferences` field |
| Service → Pods | `Endpoints` object (ready addresses only) |
| Ingress → Service | `spec.rules[].http.paths[].backend.service` |
| HPA → Workload | `spec.scaleTargetRef` |
| PDB → Pods | `spec.selector` matched against pod labels |

### Tier 2 — OTel Traces (available when instrumented)

| Relationship | Source of Truth |
|---|---|
| Service A → Service B | `GetServiceMap()` edges from span parent-child relationships |
| OTel service → K8s workload | `k8s_deployment` + `k8s_namespace` span attributes |

### Tier 3 — Declared (future, not in V2)

User labels like `kubilitics.io/depends-on: service-name`.

### Removed Inference Functions

| Function | Reason |
|---|---|
| `inferEnvVarDeps()` | DNS string heuristics — unreliable, produces false dependencies |
| `inferVolumeMountDeps()` | ConfigMap/Secret mounts are not failure dependencies (pod keeps running with old config) |
| `inferNetworkPolicyDeps()` | NetworkPolicy is access control, not dependency |
| `inferIstioDeps()` | Replaced by OTel trace data which captures actual Istio-routed traffic |

### Retained (modified)

| Function | Change |
|---|---|
| `inferOwnerRefDeps()` | Kept as-is — K8s-native owner references |
| `inferSelectorDeps()` | Rewritten to use actual Endpoints objects, not label matching |
| `inferIngressDeps()` | Kept as-is — K8s-native spec parsing |

### Coverage Levels

When OTel trace data is unavailable:
- Tier 1 impact is still computed (Service endpoint loss, Ingress backend loss, controller self-healing)
- Consumer dependencies are NOT fabricated
- API returns `"coverageLevel": "partial"` with a note: "Consumer dependencies unavailable — no trace data. Impact shown is Service/Ingress-level only."
- UI shows an info banner: "Enable distributed tracing to see full consumer impact."

When OTel trace data is available:
- API returns `"coverageLevel": "high"`
- Full consumer impact chain is reported

### External Dependencies (out of scope for V2)

External services (databases, cloud APIs) appearing in OTel traces are recorded as "external" edges but NOT scored in V2. They appear in the dependency chain for visibility only. Future versions may score these based on span error rates and latency patterns from OTel data.

---

## Impact Classification Engine

### Input

```
target:      ResourceRef (kind, namespace, name)
failureMode: "pod-crash" | "workload-deletion" | "namespace-deletion"
snapshot:    GraphSnapshot (current cluster state)
endpoints:   map[serviceName] → []EndpointAddress (ready only)
serviceMap:  ServiceMap from OTel (nullable)
```

### Step 1 — Compute Lost Pods

```
pod-crash:
  lostPods = [target]
  // Exactly 1 pod. Only if target is a Pod.
  // Source: actual Pod object in snapshot.

workload-deletion:
  lostPods = all pods owned by target workload
  // Resolved via ownerReferences chain (Pod → RS → Deployment).
  // Source: snapshot Pod objects with matching ownerReferences.

namespace-deletion:
  lostPods = all pods in target namespace
  // Source: snapshot Pod objects filtered by namespace.
```

### Step 2 — Classify Service Impact

For every Service in the cluster:

```
totalReady    = len(endpoints[service])         // ready addresses only
lostEndpoints = count of endpoints whose targetRef.name is in lostPods
remaining     = totalReady - lostEndpoints

if lostEndpoints == 0:
  skip (not affected)

// Determine health threshold
// PDB resolution chain: PDB.spec.selector → match pod labels → pods → endpoints → Service
if PDB exists for this service's backing pods:
  if PDB.spec.minAvailable is absolute (e.g., 2):
    threshold = minAvailable / totalReady
  if PDB.spec.minAvailable is percentage (e.g., "50%"):
    threshold = parse percentage as ratio
  if PDB.spec.maxUnavailable is set:
    threshold = 1 - (maxUnavailable / totalReady)
else:
  threshold = 0.5  // default: 50%

if remaining == 0:
  classification = "broken"
  note = "No endpoints available — service unreachable"

else if (remaining / totalReady) < threshold:
  classification = "degraded"
  note = "Service {name}: {remaining}/{totalReady} endpoints — below minimum threshold"

else:
  classification = "self-healing"
  note = "Service {name}: {remaining}/{totalReady} endpoints — above threshold"
```

### Step 3 — Classify Ingress Impact

```
for each ingress:
  worstBackend = "self-healing"

  for each backend service in ingress.spec.rules:
    svcClassification = lookup from Step 2
    worstBackend = max(worstBackend, svcClassification)
    // ordering: broken > degraded > self-healing

  ingress.classification = worstBackend
  if broken: note = "Ingress {host}: backend {svc} has no endpoints"
  if degraded: note = "Ingress {host}: backend {svc} at reduced capacity"
```

### Step 4 — Classify Consumer Workloads (OTel only)

```
if serviceMap == nil:
  coverageLevel = "partial"
  skip consumer classification

for each edge in serviceMap.Edges:
  targetService = edge.TargetService
  targetClassification = lookup from Step 2

  if targetClassification == "self-healing":
    continue

  sourceWorkload = resolveOTelServiceToK8sWorkload(edge.SourceService)
  // Resolution: match OTel service_name against K8s Deployment name + namespace
  // using k8s_deployment and k8s_namespace span attributes

  if sourceWorkload == nil:
    continue  // can't map to K8s resource

  sourceWorkload.classification = targetClassification
  sourceWorkload.note = "Depends on {targetService} which is {classification}"

coverageLevel = "high"
```

### Step 5 — Classify Controllers

```
for each controller of target (RS, Deployment, STS, DS):
  controller.classification = "self-healing"
  controller.note = "Controller — will reconcile state"
```

Controllers are NEVER counted in the blast radius numerator.

### Step 6 — DaemonSet Node-Scoped Handling

```
if target.Kind == "Pod" && ownerKind == "DaemonSet":
  // DaemonSet pod loss is node-scoped, not cluster-wide
  totalDSPods = count of ready pods in this DaemonSet
  // Endpoint loss for backing Services is 1/N where N = node count
  // Almost always self-healing in clusters with >2 nodes

  classification = "self-healing"
  note = "DaemonSet pod loss on node {nodeName} — {totalDSPods-1}/{totalDSPods} nodes still served"

  // Exception: critical system DaemonSets (see Infrastructure section)
```

For workload-deletion of a DaemonSet: ALL pods on ALL nodes are lost. Uses normal Service endpoint classification.

### Step 7 — Compute Blast Radius %

```
workloads = all Deployments + StatefulSets + DaemonSets + Services + Jobs in cluster
denominator = len(workloads)

numerator = 0
for each classified resource:
  if resource.kind not in [Deployment, StatefulSet, DaemonSet, Service, Job]:
    continue
  switch resource.classification:
    broken:       numerator += 1.0
    degraded:     numerator += 0.5
    self-healing: numerator += 0.0

blastRadiusPercent = (numerator / denominator) * 100
```

---

## Infrastructure-Critical Components

### Hardcoded System Components

```go
var criticalSystemComponents = map[string]struct {
    ImpactScope string  // "cluster-wide" | "node-level" | "control-plane"
    Description string
}{
    "coredns":                 {"cluster-wide", "DNS resolution for all services"},
    "kube-proxy":              {"node-level", "Service networking and iptables rules"},
    "kube-apiserver":          {"control-plane", "All K8s API operations"},
    "etcd":                    {"control-plane", "Cluster state store"},
    "kube-controller-manager": {"control-plane", "Controller reconciliation loops"},
    "kube-scheduler":          {"control-plane", "Pod scheduling"},
    "metrics-server":          {"cluster-wide", "HPA and resource metrics"},
}
```

### Classification Override Rules

After normal classification:

1. Match workload name against `criticalSystemComponents` (workloads in `kube-system` namespace).
2. If matched:
   - `cluster-wide` scope + classification >= degraded: add note "Critical system component, cluster-wide impact"
   - `control-plane` scope + broken: override `blastRadiusPercent = 100%` (entire cluster is non-functional)
   - `control-plane` scope + degraded: flag as critical regardless of endpoint math, note = "Control plane component — cluster operations impaired"
3. If NOT a known component but in `kube-system`: apply 1.5x weight multiplier to the classification weight in the blast radius calculation.

---

## Composite Scoring Model

Four transparent sub-scores replace the single opaque score.

### Resilience Score (0-100)

"How well-protected is this resource against failure?"

```
resilience = 100

// Replica factor — continuous curve (diminishing returns)
if kind in [Deployment, StatefulSet]:
  replicaPenalty = 40 * (1 / max(replicas, 1))
  // replicas=1 → -40, replicas=2 → -20, replicas=3 → -13.3, replicas=5 → -8
  resilience -= replicaPenalty

// HPA
if !hasHPA && kind in [Deployment, StatefulSet]:
  resilience -= 15

// PDB
if !hasPDB && replicas > 1:
  resilience -= 15

// Naked pod (no controller)
if kind == "Pod" && noOwningController:
  resilience -= 20

// DaemonSet: inherently distributed, use node count as effective replicas
if kind == "DaemonSet":
  resilience = max(resilience, 70)

clamp(resilience, 0, 100)
```

Resource-type normalization:
- **Service**: resilience derived from backing workload aggregate, not the Service object itself
- **DaemonSet**: node count used as effective replicas
- **Job/CronJob**: resilience based on completion status, not replicas

### Exposure Score (0-100)

"How much of the cluster and business depends on this?"

```
exposure = 0

// Ingress (internet-facing)
if isIngressExposed:
  exposure += 35

// Consumer count
if traceDataAvailable:
  consumerCount = len(serviceMap.incomingEdges[thisService])
  exposure += min(consumerCount * 8, 30)
  confidence = "high"
else:
  exposure += min(k8sFanIn * 5, 20)
  confidence = "low"

// Cross-namespace consumers
if crossNsCount > 1:
  exposure += min((crossNsCount - 1) * 5, 15)

// Critical system component floor
if isCriticalSystemComponent:
  exposure = max(exposure, 80)

clamp(exposure, 0, 100)
```

Output includes `source` ("otel" | "k8s-native") and `confidence` ("high" | "low") fields.

### Recovery Score (0-100)

"How fast and reliably does this recover from failure?"

```
recovery = 100

// Controller type
if kind == "Pod" && noController:
  recovery -= 50  // manual intervention required
if kind == "StatefulSet":
  recovery -= 20  // ordered restart, data reattach
if kind == "DaemonSet":
  recovery -= 5   // node-scoped, fast

// Replica headroom — continuous
headroomPenalty = 20 * (1 / max(replicas, 1))
recovery -= headroomPenalty

// PVC attached (data reattachment delay)
if hasPVC:
  recovery -= 10

// Control plane component
if isControlPlane:
  recovery -= 30

clamp(recovery, 0, 100)
```

### Impact Score (0-100)

Direct output from the classification engine:

```
impact = blastRadiusPercent  // already 0-100
```

### Overall Criticality

Uses max-of to prevent double-penalization between structural vulnerability and observed damage:

```
failureDimension = max(
  (100 - resilience) * 0.25,
  impact * 0.30
)

criticality = (
  failureDimension +
  exposure * 0.30 +
  (100 - recovery) * 0.15
)

// Normalize to 0-100
criticality = min(criticality / 0.75, 100)
```

### Criticality Levels

| Level | Score Range |
|---|---|
| Critical | > 70 |
| High | 45-70 |
| Medium | 20-45 |
| Low | < 20 |

### Worked Example

Pod `trace-demo-app` (2 replicas, no HPA, no PDB, not ingress-exposed, pod-crash mode):

| Sub-score | Calculation | Value |
|---|---|---|
| Resilience | 100 - 20 (2 replicas) - 15 (no HPA) - 15 (no PDB) = 50 | 50 |
| Exposure | 0 (no ingress) + ~5 (1 K8s fan-in) = 5 | 5 |
| Recovery | 100 - 10 (2 replica headroom) = 90 | 90 |
| Impact | 0% (self-healing, endpoints above threshold) | 0 |

```
failureDimension = max((100-50)*0.25, 0*0.30) = max(12.5, 0) = 12.5
criticality = (12.5 + 5*0.30 + (100-90)*0.15) / 0.75 = (12.5 + 1.5 + 1.5) / 0.75 = 20.7
```

**Score: 20.7 MEDIUM** — borderline low/medium for a modestly-protected, low-exposure workload with zero actual impact. The structural vulnerability (no HPA, no PDB) keeps it from being LOW despite zero observed impact. Compare to old score of 44 MEDIUM which implied real cluster risk.

Note: if HPA and PDB were added, resilience would rise to ~80, making criticality drop to ~8 LOW — which is the correct signal that this workload is well-protected.

---

## Explainability — Three Layers

### Layer 1: Score Breakdown Tooltip

Structured data rendered as tooltip. Shows each sub-score with contributing factors.

```go
type ScoreBreakdown struct {
    Resilience  SubScoreDetail `json:"resilience"`
    Exposure    SubScoreDetail `json:"exposure"`
    Recovery    SubScoreDetail `json:"recovery"`
    Impact      SubScoreDetail `json:"impact"`
    Overall     float64        `json:"overall"`
    Level       string         `json:"level"`
}

type SubScoreDetail struct {
    Score      int             `json:"score"`
    Factors    []ScoringFactor `json:"factors"`
    Source     string          `json:"source,omitempty"`     // "otel" | "k8s-native"
    Confidence string          `json:"confidence,omitempty"` // "high" | "low"
}

type ScoringFactor struct {
    Name   string  `json:"name"`
    Value  string  `json:"value"`
    Effect float64 `json:"effect"`
    Note   string  `json:"note"`
}
```

### Layer 2: Full Audit Panel

Complete calculation trace — every step, every input, every decision. Returned when `?audit=true` query param is set. Exportable as JSON for compliance.

```go
type AuditTrail struct {
    Timestamp        string                `json:"timestamp"`
    TargetResource   ResourceRef           `json:"targetResource"`
    FailureMode      string                `json:"failureMode"`
    GraphStalenessMs int64                 `json:"graphStalenessMs"`
    TraceDataAgeMs   *int64                `json:"traceDataAgeMs,omitempty"`
    LostPods         []ResourceRef         `json:"lostPods"`
    ServiceImpacts   []ServiceImpactAudit  `json:"serviceImpacts"`
    IngressImpacts   []IngressImpactAudit  `json:"ingressImpacts"`
    ConsumerImpacts  []ConsumerImpactAudit `json:"consumerImpacts,omitempty"`
    ScoreBreakdown   ScoreBreakdown        `json:"scoreBreakdown"`
    ClusterWorkloadCount int               `json:"clusterWorkloadCount"`
    CoverageLevel    string                `json:"coverageLevel"`
}

type ServiceImpactAudit struct {
    Service         string  `json:"service"`
    TotalEndpoints  int     `json:"totalEndpoints"`
    LostEndpoints   int     `json:"lostEndpoints"`
    RemainingPct    float64 `json:"remainingPercent"`
    Threshold       float64 `json:"threshold"`
    ThresholdSource string  `json:"thresholdSource"` // "pdb:my-pdb" | "default:50%"
    Classification  string  `json:"classification"`
}
```

### Layer 3: Natural Language Verdict

Template-based, deterministic, auditable. NOT LLM-generated.

Built from facts: criticality level, top contributing factors, impact classification results, coverage caveats.

Example output:
> "This Pod has LOW criticality (score: 17). It has moderate resilience (2 replicas, no HPA, no PDB). Under this failure mode, no services lose functionality. Service trace-demo-app operates at 1/2 endpoints — above minimum threshold."

---

## API Response Structure

### Updated BlastRadiusResult

```go
type BlastRadiusResult struct {
    // Target
    TargetResource     ResourceRef `json:"targetResource"`
    FailureMode        string      `json:"failureMode"`

    // Core metrics
    BlastRadiusPercent float64     `json:"blastRadiusPercent"`
    CriticalityScore   float64     `json:"criticalityScore"`
    CriticalityLevel   string      `json:"criticalityLevel"`

    // Sub-scores
    SubScores          SubScores   `json:"subScores"`

    // Impact classification
    ImpactSummary      ImpactSummary       `json:"impactSummary"`
    AffectedServices   []ServiceImpact     `json:"affectedServices"`
    AffectedIngresses  []IngressImpact     `json:"affectedIngresses,omitempty"`
    AffectedConsumers  []ConsumerImpact    `json:"affectedConsumers,omitempty"`

    // Explainability
    ScoreBreakdown     ScoreBreakdown      `json:"scoreBreakdown"`
    Verdict            string              `json:"verdict"`
    AuditTrail         *AuditTrail         `json:"auditTrail,omitempty"`

    // Coverage
    CoverageLevel      string              `json:"coverageLevel"`
    CoverageNote       string              `json:"coverageNote,omitempty"`

    // Resource characteristics
    ReplicaCount       int                 `json:"replicaCount"`
    IsSPOF             bool                `json:"isSPOF"`
    HasHPA             bool                `json:"hasHPA"`
    HasPDB             bool                `json:"hasPDB"`
    IsIngressExposed   bool                `json:"isIngressExposed"`
    Remediations       []Remediation       `json:"remediations"`

    // Graph metadata
    DependencyChain    []BlastDependencyEdge `json:"dependencyChain"`
    GraphNodeCount     int                   `json:"graphNodeCount"`
    GraphEdgeCount     int                   `json:"graphEdgeCount"`
    GraphStalenessMs   int64                 `json:"graphStalenessMs"`
}

type SubScores struct {
    Resilience SubScoreDetail `json:"resilience"`
    Exposure   SubScoreDetail `json:"exposure"`
    Recovery   SubScoreDetail `json:"recovery"`
    Impact     SubScoreDetail `json:"impact"`
}

type ImpactSummary struct {
    BrokenCount      int      `json:"brokenCount"`
    DegradedCount    int      `json:"degradedCount"`
    SelfHealingCount int      `json:"selfHealingCount"`
    TotalWorkloads   int      `json:"totalWorkloads"`
    CapacityNotes    []string `json:"capacityNotes"`
}

type ServiceImpact struct {
    Service            ResourceRef `json:"service"`
    Classification     string      `json:"classification"`
    TotalEndpoints     int         `json:"totalEndpoints"`
    RemainingEndpoints int         `json:"remainingEndpoints"`
    Threshold          float64     `json:"threshold"`
    ThresholdSource    string      `json:"thresholdSource"`
    Note               string      `json:"note"`
}

type IngressImpact struct {
    Ingress        ResourceRef `json:"ingress"`
    Classification string      `json:"classification"`
    Host           string      `json:"host"`
    BackendService string      `json:"backendService"`
    Note           string      `json:"note"`
}

type ConsumerImpact struct {
    Workload       ResourceRef `json:"workload"`
    Classification string      `json:"classification"`
    DependsOn      string      `json:"dependsOn"`
    Note           string      `json:"note"`
}
```

### API Endpoints (unchanged URLs, updated responses)

| Endpoint | Change |
|---|---|
| `GET /clusters/{id}/blast-radius/{ns}/{kind}/{name}` | Returns new `BlastRadiusResult`. Accepts `?failure_mode=` (auto-detected default) and `?audit=true` |
| `GET /clusters/{id}/blast-radius/summary` | Returns updated summary with sub-scores |
| `GET /clusters/{id}/blast-radius/graph-status` | Unchanged |

### Failure Mode Auto-Detection

| Resource Kind | Default Failure Mode |
|---|---|
| Pod | `pod-crash` |
| Deployment, StatefulSet, DaemonSet, ReplicaSet | `workload-deletion` |
| Namespace | `namespace-deletion` |
| Service, Ingress, Job, CronJob | `workload-deletion` |

---

## Frontend Header Cards

Replace current 4 cards (SPOF, Blast Radius %, Fan-In/Out, Cross-Namespace):

| Card | Data Source | Display |
|---|---|---|
| **Resilience** | `subScores.resilience.score` | 0-100 gauge, green (>=70) / yellow (40-69) / red (<40). Shows replica count + HPA/PDB presence icons |
| **Cluster Impact** | `blastRadiusPercent` + `impactSummary` | Percentage with broken/degraded breakdown. Capacity notes underneath |
| **Exposure** | `subScores.exposure.score` | 0-100 with confidence badge (high/low). Consumer count + ingress status |
| **Recovery** | `subScores.recovery.score` | 0-100 gauge, green/yellow/red. Controller type label |

Failure mode dropdown in the banner next to the resource name. Auto-selects based on resource kind; user can override.

---

## Real-World Scenario Validation

| Scenario | Expected Result |
|---|---|
| Pod crash, replicas > 1, endpoints above threshold | Impact: 0%. Score: low. Note: "1/3 endpoints, above threshold" |
| Single-replica Pod crash | Service broken (0 endpoints). Impact: high. Score: high |
| Service losing all endpoints | Classification: broken. Consumer workloads (if OTel): broken. Score: critical |
| Ingress losing backend | Classification: broken (worst-case backend). Score: high-critical |
| Namespace deletion | All workloads in namespace scored. Blast radius = sum of weighted impacts. Score: high-critical |
| StatefulSet failure | Recovery score penalized (-20 ordered restart). Score reflects slow recovery |
| CoreDNS degraded | Classification override: cluster-wide impact. Exposure floor: 80. Score: critical |
| kube-apiserver broken | Blast radius override: 100%. Score: critical |
| Pod crash, no OTel data | Service impact computed. Consumer impact: unknown. Coverage: partial |

---

## Files to Modify

### Backend (Go)

| File | Action |
|---|---|
| `internal/graph/snapshot.go` | Rewrite `computeSingleResourceBlast()` with new classification engine |
| `internal/graph/scoring.go` | Replace `computeBaseScore()` with composite 4-sub-score model |
| `internal/graph/builder.go` | Remove `inferEnvVarDeps`, `inferVolumeMountDeps`, `inferNetworkPolicyDeps`, `inferIstioDeps`. Add Endpoints collection. Add OTel service map integration |
| `internal/graph/engine.go` | Add Endpoints informer. Add OTel service map fetch on rebuild |
| `internal/graph/risk.go` | Update risk indicators for new scoring model |
| `internal/graph/remediation.go` | Update remediation logic for new sub-scores |
| `internal/graph/infrastructure.go` | New file: critical system component definitions and override logic |
| `internal/graph/classify.go` | New file: impact classification engine (Steps 1-7) |
| `internal/graph/verdict.go` | New file: natural language verdict generator |
| `internal/models/blast_radius.go` | Add SubScores, ImpactSummary, ServiceImpact, IngressImpact, ConsumerImpact, AuditTrail, ScoreBreakdown structs |
| `internal/api/rest/blast_radius.go` | Add `?audit=true` support, auto-detect failure mode |

### Frontend (TypeScript/React)

| File | Action |
|---|---|
| `src/components/blast-radius/RiskIndicatorCards.tsx` | Replace 4 cards with Resilience, Cluster Impact, Exposure, Recovery |
| `src/components/blast-radius/CriticalityBanner.tsx` | Add failure mode dropdown, coverage indicator |
| `src/components/blast-radius/ScoreBreakdown.tsx` | New: tooltip component showing sub-score factors |
| `src/components/blast-radius/AuditPanel.tsx` | New: expandable audit trail panel |
| `src/components/blast-radius/VerdictCard.tsx` | New: natural language verdict display |
| `src/hooks/useBlastRadius.ts` | Update types for new API response |
| `src/services/api/blastRadius.ts` | Update API client |
| `src/services/api/types.ts` | Add new TypeScript interfaces |

### Tests

| File | Action |
|---|---|
| `internal/graph/snapshot_test.go` | Rewrite for new classification engine |
| `internal/graph/scoring_test.go` | New: composite scoring tests |
| `internal/graph/classify_test.go` | New: impact classification tests covering all 7 scenarios |
| `internal/graph/infrastructure_test.go` | New: critical component override tests |
| `internal/graph/verdict_test.go` | New: verdict generation tests |

---

## Decomposition

This spec covers Sub-project 1 (Backend Engine) and Sub-project 2 (API Contract). Sub-project 3 (Frontend Overhaul) will be a separate spec consuming the API defined here.

Implementation order:
1. New data models (`models/blast_radius.go`)
2. Infrastructure component definitions (`graph/infrastructure.go`)
3. Impact classification engine (`graph/classify.go`)
4. Composite scoring model (`graph/scoring.go` rewrite)
5. Verdict generator (`graph/verdict.go`)
6. Graph builder updates (`graph/builder.go` — remove old inference, add Endpoints + OTel)
7. Snapshot integration (`graph/snapshot.go` — wire new classification into blast radius computation)
8. API handler updates (`api/rest/blast_radius.go`)
9. Tests for each component
10. Frontend updates (separate spec)
