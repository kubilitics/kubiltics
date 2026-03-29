# Cluster-Wide Blast Radius Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace namespace-scoped, per-request blast radius with a cluster-wide dependency graph engine that uses K8s informers, debounced rebuilds, atomic snapshots, and delivers an Apple-grade frontend with animated failure cascade simulation.

**Architecture:** Backend `ClusterGraphEngine` (one per cluster) uses K8s informers to watch all resource types cluster-wide. On any change, a debounce timer (2s) batches events, then a full graph rebuild reads from informer cache (CPU-only, no API calls). The new immutable `GraphSnapshot` is swapped atomically. Frontend `BlastRadiusTab` is rewritten with critical banner, wave-by-wave cascade animation, risk indicators, and failure path traces.

**Tech Stack:** Go 1.25 (backend), client-go informers, atomic.Value, React 18 + TypeScript (frontend), React Flow + ELK layout, Tailwind CSS, Framer Motion, React Query

**Spec:** `docs/superpowers/specs/2026-03-29-cluster-wide-blast-radius-design.md`

---

## File Structure

### New Backend Files (`kubilitics-backend/`)
| File | Responsibility |
|------|---------------|
| `internal/graph/engine.go` | ClusterGraphEngine: informer setup, debounce loop, rebuild trigger, atomic snapshot swap, lifecycle (Start/Stop) |
| `internal/graph/snapshot.go` | Immutable GraphSnapshot: node map, edge list, forward/reverse adjacency, pre-computed per-node BFS results |
| `internal/graph/builder.go` | buildSnapshot(): reads informer caches, constructs full graph with all nodes and edges |
| `internal/graph/inference.go` | 8 dependency detection techniques: ownerRef, selector, envVar, volumeMount, ingress, networkPolicy, istioRoute, istioDestination |
| `internal/graph/scoring.go` | computeScores(): weighted PageRank + risk penalties, criticality levels |
| `internal/graph/risk.go` | detectRisks(): SPOF, no HPA, no PDB, ingress exposure, data store, cross-namespace |
| `internal/graph/engine_test.go` | Tests for engine lifecycle, debounce, snapshot swap |
| `internal/graph/builder_test.go` | Tests for graph construction and dependency inference |
| `internal/graph/scoring_test.go` | Tests for criticality scoring |

### New Frontend Files (`kubilitics-frontend/src/`)
| File | Responsibility |
|------|---------------|
| `components/blast-radius/CriticalityBanner.tsx` | Full-width gradient banner with verdict, score badge, blast radius % |
| `components/blast-radius/RiskIndicatorCards.tsx` | 4-card row: SPOF, blast radius, fan-in/out, cross-namespace |
| `components/blast-radius/WaveBreakdown.tsx` | Affected resources grouped by wave depth with failure paths |
| `components/blast-radius/RiskPanel.tsx` | Risk indicators + expandable failure path traces |
| `components/blast-radius/SimulationEngine.ts` | Wave animation controller: pre-computes wave groups, drives requestAnimationFrame loop |
| `components/blast-radius/SimulationControls.tsx` | Simulate button, progress bar, wave counter, clear button |
| `hooks/useBlastRadiusV2.ts` | React Query hook for enhanced API — waves, risks, graph status |
| `services/api/blastRadius.ts` | API client functions for all 3 blast radius endpoints |

### Modified Backend Files
| File | Change |
|------|--------|
| `internal/models/blast_radius.go` | Add BlastWave, AffectedResource, PathHop, RiskIndicator types; enhance BlastRadiusResult |
| `internal/api/rest/handler.go:114-155` | Add `graphEngines` field to Handler struct, update NewHandler signature |
| `internal/api/rest/blast_radius.go` | Rewrite GetBlastRadius to read from engine snapshot; add GetBlastRadiusSummary, GetGraphStatus handlers |
| `internal/api/rest/handler.go:260+` | Register new routes in SetupRoutes |
| `cmd/server/main.go:209+` | Initialize graph engine manager, pass to Handler |

### Modified Frontend Files
| File | Change |
|------|--------|
| `components/resources/BlastRadiusTab.tsx` | Complete rewrite using new sub-components |
| `services/api/types.ts` | Add TypeScript types matching enhanced response model |
| `topology/TopologyCanvas.tsx` | Enhanced simulation: wave-based coloring, edge glow animation, progress overlay |

### Deprecated
| File | Reason |
|------|--------|
| `internal/service/blast_radius.go` | Replaced by `internal/graph/*` |

---

## Task 1: Enhanced Models

**Files:**
- Modify: `kubilitics-backend/internal/models/blast_radius.go`

- [ ] **Step 1: Update blast radius models with new types**

Replace the entire file content:

```go
package models

// BlastRadiusResult contains the full cluster-wide blast radius analysis for a single resource.
type BlastRadiusResult struct {
	TargetResource     ResourceRef           `json:"target_resource"`
	CriticalityScore   float64               `json:"criticality_score"`    // 0-100
	CriticalityLevel   string                `json:"criticality_level"`    // low / medium / high / critical
	BlastRadiusPercent float64               `json:"blast_radius_percent"` // % of cluster workloads affected

	FanIn              int                   `json:"fan_in"`               // direct dependents
	FanOut             int                   `json:"fan_out"`              // direct dependencies
	TotalAffected      int                   `json:"total_affected"`       // transitive impact count
	AffectedNamespaces int                   `json:"affected_namespaces"`  // cross-namespace reach

	IsSPOF             bool                  `json:"is_spof"`
	HasHPA             bool                  `json:"has_hpa"`
	HasPDB             bool                  `json:"has_pdb"`
	IsIngressExposed   bool                  `json:"is_ingress_exposed"`
	IngressHosts       []string              `json:"ingress_hosts,omitempty"`
	ReplicaCount       int                   `json:"replica_count"`

	Waves              []BlastWave           `json:"waves"`
	DependencyChain    []BlastDependencyEdge `json:"dependency_chain"`
	RiskIndicators     []RiskIndicator       `json:"risk_indicators"`

	GraphNodeCount     int                   `json:"graph_node_count"`
	GraphEdgeCount     int                   `json:"graph_edge_count"`
	GraphStalenessMs   int64                 `json:"graph_staleness_ms"`
}

// BlastWave groups affected resources by their BFS depth from the target.
type BlastWave struct {
	Depth     int                `json:"depth"`
	Resources []AffectedResource `json:"resources"`
}

// AffectedResource is a resource impacted by the target's failure.
type AffectedResource struct {
	Kind        string    `json:"kind"`
	Name        string    `json:"name"`
	Namespace   string    `json:"namespace"`
	Impact      string    `json:"impact"`    // "direct" | "transitive"
	WaveDepth   int       `json:"wave_depth"`
	FailurePath []PathHop `json:"failure_path"`
}

// PathHop is one hop in the failure propagation chain.
type PathHop struct {
	From     ResourceRef `json:"from"`
	To       ResourceRef `json:"to"`
	EdgeType string      `json:"edge_type"` // selector, env_var, volume_mount, ingress_route, network_policy, istio_route, istio_destination, owner_ref
	Detail   string      `json:"detail"`    // human-readable: "env: PAYMENT_URL=svc.ns.svc"
}

// RiskIndicator is a human-readable risk flag for a resource.
type RiskIndicator struct {
	Severity string `json:"severity"` // critical, warning, info
	Title    string `json:"title"`
	Detail   string `json:"detail"`
}

// ResourceRef identifies a Kubernetes resource by kind, name, and namespace.
type ResourceRef struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

// BlastDependencyEdge represents a directed dependency between two resources.
type BlastDependencyEdge struct {
	Source ResourceRef `json:"source"`
	Target ResourceRef `json:"target"`
	Type   string      `json:"type"`
	Detail string      `json:"detail,omitempty"`
}

// GraphStatus reports the health of the cluster-wide dependency graph.
type GraphStatus struct {
	Ready          bool   `json:"ready"`
	NodeCount      int    `json:"node_count"`
	EdgeCount      int    `json:"edge_count"`
	NamespaceCount int    `json:"namespace_count"`
	LastRebuildMs  int64  `json:"last_rebuild_ms"`  // rebuild duration
	StalenessMs    int64  `json:"staleness_ms"`     // time since last rebuild
	RebuildCount   int64  `json:"rebuild_count"`
	Error          string `json:"error,omitempty"`
}

// BlastRadiusSummaryEntry is one resource in the cluster-wide criticality summary.
type BlastRadiusSummaryEntry struct {
	Resource         ResourceRef `json:"resource"`
	CriticalityScore float64     `json:"criticality_score"`
	CriticalityLevel string      `json:"criticality_level"`
	BlastRadiusPercent float64   `json:"blast_radius_percent"`
	FanIn            int         `json:"fan_in"`
	IsSPOF           bool        `json:"is_spof"`
	AffectedNamespaces int       `json:"affected_namespaces"`
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd kubilitics-backend && go build ./internal/models/...`
Expected: Clean compilation, no errors.

- [ ] **Step 3: Commit**

```bash
git add kubilitics-backend/internal/models/blast_radius.go
git commit -m "feat(blast-radius): enhance models with waves, paths, risk indicators, graph status"
```

---

## Task 2: GraphSnapshot (Immutable Data Structure)

**Files:**
- Create: `kubilitics-backend/internal/graph/snapshot.go`
- Create: `kubilitics-backend/internal/graph/snapshot_test.go`

- [ ] **Step 1: Write test for GraphSnapshot**

```go
package graph

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func TestRefKey(t *testing.T) {
	ref := models.ResourceRef{Kind: "Service", Name: "payments", Namespace: "default"}
	got := refKey(ref)
	if got != "Service/default/payments" {
		t.Errorf("refKey = %q, want %q", got, "Service/default/payments")
	}
}

func TestSnapshot_BFSWalk(t *testing.T) {
	// Build a simple graph: A -> B -> C, A -> D
	snap := &GraphSnapshot{
		Nodes: map[string]models.ResourceRef{
			"Deployment/ns/a": {Kind: "Deployment", Name: "a", Namespace: "ns"},
			"Service/ns/b":    {Kind: "Service", Name: "b", Namespace: "ns"},
			"Deployment/ns/c": {Kind: "Deployment", Name: "c", Namespace: "ns"},
			"Deployment/ns/d": {Kind: "Deployment", Name: "d", Namespace: "ns"},
		},
		Reverse: map[string]map[string]bool{
			"Service/ns/b":    {"Deployment/ns/a": true},
			"Deployment/ns/c": {"Service/ns/b": true},
			"Deployment/ns/d": {"Deployment/ns/a": true},
		},
	}

	// BFS from A on reverse graph should find nothing (nothing depends on A via reverse)
	reachable := snap.bfsWalk(snap.Reverse, "Deployment/ns/a")
	if len(reachable) != 1 { // only self
		t.Errorf("expected 1 (self), got %d", len(reachable))
	}

	// BFS from B on reverse graph: B has A depending on it
	reachable = snap.bfsWalk(snap.Reverse, "Service/ns/b")
	if len(reachable) != 2 { // self + A
		t.Errorf("expected 2, got %d", len(reachable))
	}
}

func TestSnapshot_ComputeBlastRadius_SimpleChain(t *testing.T) {
	// Service -> Deployment (selector), Deployment depends on Service
	svcRef := models.ResourceRef{Kind: "Service", Name: "api", Namespace: "default"}
	depRef := models.ResourceRef{Kind: "Deployment", Name: "web", Namespace: "default"}

	snap := &GraphSnapshot{
		Nodes: map[string]models.ResourceRef{
			refKey(svcRef): svcRef,
			refKey(depRef): depRef,
		},
		Forward: map[string]map[string]bool{
			refKey(depRef): {refKey(svcRef): true},
		},
		Reverse: map[string]map[string]bool{
			refKey(svcRef): {refKey(depRef): true},
		},
		Edges: []models.BlastDependencyEdge{
			{Source: depRef, Target: svcRef, Type: "selector"},
		},
		NodeScores: map[string]float64{
			refKey(svcRef): 60.0,
			refKey(depRef): 30.0,
		},
		TotalWorkloads: 2,
		BuiltAt:        0,
	}

	result, err := snap.ComputeBlastRadius(svcRef)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.TotalAffected != 1 {
		t.Errorf("TotalAffected = %d, want 1", result.TotalAffected)
	}
	if len(result.Waves) != 1 {
		t.Errorf("Waves = %d, want 1", len(result.Waves))
	}
	if result.Waves[0].Depth != 1 {
		t.Errorf("Wave depth = %d, want 1", result.Waves[0].Depth)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd kubilitics-backend && go test ./internal/graph/... -v -run TestRefKey`
Expected: FAIL — package doesn't exist yet.

- [ ] **Step 3: Implement GraphSnapshot**

```go
package graph

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// refKey builds a unique key for a resource: "Kind/Namespace/Name".
func refKey(r models.ResourceRef) string {
	return r.Kind + "/" + r.Namespace + "/" + r.Name
}

// GraphSnapshot is an immutable, point-in-time view of the cluster dependency graph.
// It is safe for concurrent reads without any locking.
type GraphSnapshot struct {
	Nodes          map[string]models.ResourceRef          // refKey -> ResourceRef
	Forward        map[string]map[string]bool             // source -> set of targets (what I depend on)
	Reverse        map[string]map[string]bool             // target -> set of sources (what depends on me)
	Edges          []models.BlastDependencyEdge
	NodeScores     map[string]float64                     // refKey -> criticality score (pre-computed)
	NodeRisks      map[string][]models.RiskIndicator      // refKey -> risk indicators
	NodeReplicas   map[string]int                         // refKey -> replica count
	NodeHasHPA     map[string]bool
	NodeHasPDB     map[string]bool
	NodeIngress    map[string][]string                    // refKey -> ingress hosts
	TotalWorkloads int
	BuiltAt        int64                                  // unix ms
	BuildDuration  time.Duration
	Namespaces     map[string]bool                        // all namespaces in the graph
}

// bfsWalk does breadth-first traversal on an adjacency map from startKey,
// returning the set of all reachable keys (including the start).
func (s *GraphSnapshot) bfsWalk(adj map[string]map[string]bool, startKey string) map[string]bool {
	visited := map[string]bool{startKey: true}
	queue := []string{startKey}
	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]
		for neighbor := range adj[curr] {
			if !visited[neighbor] {
				visited[neighbor] = true
				queue = append(queue, neighbor)
			}
		}
	}
	return visited
}

// bfsWalkWithDepth does BFS and records the depth of each node from start.
func (s *GraphSnapshot) bfsWalkWithDepth(adj map[string]map[string]bool, startKey string) map[string]int {
	depth := map[string]int{startKey: 0}
	queue := []string{startKey}
	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]
		for neighbor := range adj[curr] {
			if _, seen := depth[neighbor]; !seen {
				depth[neighbor] = depth[curr] + 1
				queue = append(queue, neighbor)
			}
		}
	}
	return depth
}

// shortestPath finds the shortest path from src to dst using BFS on the given adjacency map.
// Returns nil if no path exists.
func (s *GraphSnapshot) shortestPath(adj map[string]map[string]bool, src, dst string) []string {
	if src == dst {
		return []string{src}
	}
	parent := map[string]string{src: ""}
	queue := []string{src}
	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]
		for neighbor := range adj[curr] {
			if _, seen := parent[neighbor]; !seen {
				parent[neighbor] = curr
				if neighbor == dst {
					// Reconstruct path
					path := []string{dst}
					for n := dst; parent[n] != ""; n = parent[n] {
						path = append([]string{parent[n]}, path...)
					}
					return path
				}
				queue = append(queue, neighbor)
			}
		}
	}
	return nil
}

// buildFailurePath constructs PathHop entries for the path from target to an affected node.
func (s *GraphSnapshot) buildFailurePath(targetKey, affectedKey string) []models.PathHop {
	// We walk the reverse graph from affected back to target
	path := s.shortestPath(s.Reverse, affectedKey, targetKey)
	if len(path) < 2 {
		return nil
	}

	// Path is affected -> ... -> target. We want target -> ... -> affected for display.
	// Reverse it.
	for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
		path[i], path[j] = path[j], path[i]
	}

	hops := make([]models.PathHop, 0, len(path)-1)
	// Build edge index for quick lookup
	edgeIndex := make(map[string]models.BlastDependencyEdge)
	for _, e := range s.Edges {
		key := refKey(e.Source) + "|" + refKey(e.Target)
		edgeIndex[key] = e
		// Also check reverse direction
		rkey := refKey(e.Target) + "|" + refKey(e.Source)
		if _, exists := edgeIndex[rkey]; !exists {
			edgeIndex[rkey] = models.BlastDependencyEdge{
				Source: e.Target, Target: e.Source, Type: e.Type, Detail: e.Detail,
			}
		}
	}

	for i := 0; i < len(path)-1; i++ {
		fromRef := s.Nodes[path[i]]
		toRef := s.Nodes[path[i+1]]
		edgeKey := path[i] + "|" + path[i+1]
		edge, found := edgeIndex[edgeKey]
		edgeType := "unknown"
		detail := ""
		if found {
			edgeType = edge.Type
			detail = edge.Detail
		}
		hops = append(hops, models.PathHop{
			From:     fromRef,
			To:       toRef,
			EdgeType: edgeType,
			Detail:   detail,
		})
	}
	return hops
}

// ComputeBlastRadius computes the full blast radius analysis for a target resource.
func (s *GraphSnapshot) ComputeBlastRadius(target models.ResourceRef) (*models.BlastRadiusResult, error) {
	targetKey := refKey(target)
	if _, exists := s.Nodes[targetKey]; !exists {
		return nil, fmt.Errorf("resource %s/%s/%s not found in cluster dependency graph", target.Kind, target.Namespace, target.Name)
	}

	// BFS on reverse graph: what breaks if this goes down
	affectedDepths := s.bfsWalkWithDepth(s.Reverse, targetKey)

	// BFS on forward graph: what this depends on
	dependsOn := s.bfsWalk(s.Forward, targetKey)

	fanIn := len(s.Reverse[targetKey])
	fanOut := len(s.Forward[targetKey])

	// Group affected resources by wave depth (exclude self)
	waveMap := make(map[int][]models.AffectedResource)
	affectedNamespaces := make(map[string]bool)
	totalAffected := 0
	for key, depth := range affectedDepths {
		if key == targetKey {
			continue
		}
		ref, ok := s.Nodes[key]
		if !ok {
			continue
		}
		totalAffected++
		affectedNamespaces[ref.Namespace] = true

		impact := "direct"
		if depth > 1 {
			impact = "transitive"
		}
		failurePath := s.buildFailurePath(targetKey, key)
		waveMap[depth] = append(waveMap[depth], models.AffectedResource{
			Kind:        ref.Kind,
			Name:        ref.Name,
			Namespace:   ref.Namespace,
			Impact:      impact,
			WaveDepth:   depth,
			FailurePath: failurePath,
		})
	}

	// Sort waves by depth, resources within each wave by name
	depths := make([]int, 0, len(waveMap))
	for d := range waveMap {
		depths = append(depths, d)
	}
	sort.Ints(depths)

	waves := make([]models.BlastWave, 0, len(depths))
	for _, d := range depths {
		resources := waveMap[d]
		sort.Slice(resources, func(i, j int) bool {
			return resources[i].Namespace+"/"+resources[i].Name < resources[j].Namespace+"/"+resources[j].Name
		})
		waves = append(waves, models.BlastWave{Depth: d, Resources: resources})
	}

	// Blast radius percent (cluster-wide)
	blastRadiusPercent := 0.0
	if s.TotalWorkloads > 1 {
		blastRadiusPercent = float64(totalAffected) / float64(s.TotalWorkloads-1) * 100.0
		blastRadiusPercent = math.Round(blastRadiusPercent*100) / 100
	}

	// Collect relevant edges
	allRelevant := make(map[string]bool)
	for k := range affectedDepths {
		allRelevant[k] = true
	}
	for k := range dependsOn {
		allRelevant[k] = true
	}
	relevantEdges := make([]models.BlastDependencyEdge, 0)
	for _, edge := range s.Edges {
		sk := refKey(edge.Source)
		tk := refKey(edge.Target)
		if allRelevant[sk] && allRelevant[tk] {
			relevantEdges = append(relevantEdges, edge)
		}
	}

	// Gather pre-computed data for this node
	score := s.NodeScores[targetKey]
	risks := s.NodeRisks[targetKey]
	replicas := s.NodeReplicas[targetKey]
	hasHPA := s.NodeHasHPA[targetKey]
	hasPDB := s.NodeHasPDB[targetKey]
	ingressHosts := s.NodeIngress[targetKey]
	isSPOF := replicas == 1 && fanIn > 0
	isIngressExposed := len(ingressHosts) > 0

	level := criticalityLevel(score)

	staleness := time.Since(time.UnixMilli(s.BuiltAt)).Milliseconds()

	return &models.BlastRadiusResult{
		TargetResource:     target,
		CriticalityScore:   score,
		CriticalityLevel:   level,
		BlastRadiusPercent: blastRadiusPercent,
		FanIn:              fanIn,
		FanOut:             fanOut,
		TotalAffected:      totalAffected,
		AffectedNamespaces: len(affectedNamespaces),
		IsSPOF:             isSPOF,
		HasHPA:             hasHPA,
		HasPDB:             hasPDB,
		IsIngressExposed:   isIngressExposed,
		IngressHosts:       ingressHosts,
		ReplicaCount:       replicas,
		Waves:              waves,
		DependencyChain:    relevantEdges,
		RiskIndicators:     risks,
		GraphNodeCount:     len(s.Nodes),
		GraphEdgeCount:     len(s.Edges),
		GraphStalenessMs:   staleness,
	}, nil
}

// criticalityLevel maps a score to a human-readable level.
func criticalityLevel(score float64) string {
	switch {
	case score >= 75:
		return "critical"
	case score >= 50:
		return "high"
	case score >= 25:
		return "medium"
	default:
		return "low"
	}
}

// GetSummary returns the top N most critical resources in the cluster.
func (s *GraphSnapshot) GetSummary(limit int) []models.BlastRadiusSummaryEntry {
	type scored struct {
		key   string
		score float64
	}
	items := make([]scored, 0, len(s.NodeScores))
	for k, sc := range s.NodeScores {
		items = append(items, scored{key: k, score: sc})
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].score > items[j].score
	})
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}

	result := make([]models.BlastRadiusSummaryEntry, 0, len(items))
	for _, item := range items {
		ref := s.Nodes[item.key]
		affectedDepths := s.bfsWalkWithDepth(s.Reverse, item.key)
		affectedNs := make(map[string]bool)
		for k := range affectedDepths {
			if k != item.key {
				if r, ok := s.Nodes[k]; ok {
					affectedNs[r.Namespace] = true
				}
			}
		}
		totalAffected := len(affectedDepths) - 1
		brPercent := 0.0
		if s.TotalWorkloads > 1 {
			brPercent = float64(totalAffected) / float64(s.TotalWorkloads-1) * 100.0
		}
		replicas := s.NodeReplicas[item.key]
		fanIn := len(s.Reverse[item.key])
		result = append(result, models.BlastRadiusSummaryEntry{
			Resource:           ref,
			CriticalityScore:   item.score,
			CriticalityLevel:   criticalityLevel(item.score),
			BlastRadiusPercent: math.Round(brPercent*100) / 100,
			FanIn:              fanIn,
			IsSPOF:             replicas == 1 && fanIn > 0,
			AffectedNamespaces: len(affectedNs),
		})
	}
	return result
}

// Status returns the health of this graph snapshot.
func (s *GraphSnapshot) Status() models.GraphStatus {
	return models.GraphStatus{
		Ready:          len(s.Nodes) > 0,
		NodeCount:      len(s.Nodes),
		EdgeCount:      len(s.Edges),
		NamespaceCount: len(s.Namespaces),
		LastRebuildMs:  s.BuildDuration.Milliseconds(),
		StalenessMs:    time.Since(time.UnixMilli(s.BuiltAt)).Milliseconds(),
	}
}
```

- [ ] **Step 4: Run tests**

Run: `cd kubilitics-backend && go test ./internal/graph/... -v -run TestRefKey`
Expected: PASS

Run: `cd kubilitics-backend && go test ./internal/graph/... -v -run TestSnapshot`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/graph/
git commit -m "feat(blast-radius): add GraphSnapshot with BFS, wave grouping, failure paths"
```

---

## Task 3: Dependency Inference

**Files:**
- Create: `kubilitics-backend/internal/graph/inference.go`
- Create: `kubilitics-backend/internal/graph/inference_test.go`

- [ ] **Step 1: Write test for env var cross-namespace detection**

```go
package graph

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestInferEnvVarCrossNamespace(t *testing.T) {
	nodes := make(map[string]models.ResourceRef)
	forward := make(map[string]map[string]bool)
	reverse := make(map[string]map[string]bool)
	var edges []models.BlastDependencyEdge

	// Pod in "orders" namespace references "payments-svc.payments.svc.cluster.local"
	pods := []corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "order-pod", Namespace: "orders"},
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{
					{
						Name: "app",
						Env: []corev1.EnvVar{
							{Name: "PAYMENT_URL", Value: "http://payments-svc.payments.svc.cluster.local:8080"},
						},
					},
				},
			},
		},
	}

	services := []corev1.Service{
		{ObjectMeta: metav1.ObjectMeta{Name: "payments-svc", Namespace: "payments"}},
	}

	podOwners := map[string]models.ResourceRef{
		"orders/order-pod": {Kind: "Deployment", Name: "order-deploy", Namespace: "orders"},
	}

	inferEnvVarDeps(nodes, forward, reverse, &edges, pods, services, podOwners)

	// Should have created a cross-namespace edge: order-deploy -> payments-svc
	ownerKey := "Deployment/orders/order-deploy"
	svcKey := "Service/payments/payments-svc"
	if !forward[ownerKey][svcKey] {
		t.Errorf("expected edge %s -> %s, got forward map: %v", ownerKey, svcKey, forward)
	}
}
```

- [ ] **Step 2: Run test — expect fail**

Run: `cd kubilitics-backend && go test ./internal/graph/... -v -run TestInferEnvVar`
Expected: FAIL — function not defined.

- [ ] **Step 3: Implement all 8 inference functions**

Create `kubilitics-backend/internal/graph/inference.go` with the full implementation. This file contains all dependency detection techniques. The functions are:

```go
package graph

import (
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// addEdge adds a directed edge to the graph data structures.
func addEdge(
	nodes map[string]models.ResourceRef,
	forward, reverse map[string]map[string]bool,
	edges *[]models.BlastDependencyEdge,
	source, target models.ResourceRef,
	edgeType, detail string,
) {
	sk := refKey(source)
	tk := refKey(target)
	nodes[sk] = source
	nodes[tk] = target

	if forward[sk] == nil {
		forward[sk] = make(map[string]bool)
	}
	if forward[sk][tk] {
		return // dedupe
	}
	forward[sk][tk] = true

	if reverse[tk] == nil {
		reverse[tk] = make(map[string]bool)
	}
	reverse[tk][sk] = true

	*edges = append(*edges, models.BlastDependencyEdge{
		Source: source, Target: target, Type: edgeType, Detail: detail,
	})
}

// --- 1. OwnerRef Chain ---

// inferOwnerRefDeps maps Pods to their owning workloads via OwnerReferences.
// Returns podOwners: "namespace/podName" -> owner ResourceRef.
func inferOwnerRefDeps(
	nodes map[string]models.ResourceRef,
	forward, reverse map[string]map[string]bool,
	edges *[]models.BlastDependencyEdge,
	pods []corev1.Pod,
	deployments []appsv1.Deployment,
	statefulSets []appsv1.StatefulSet,
	daemonSets []appsv1.DaemonSet,
) map[string]models.ResourceRef {
	podOwners := make(map[string]models.ResourceRef)

	for i := range pods {
		pod := &pods[i]
		for _, owner := range pod.OwnerReferences {
			switch owner.Kind {
			case "ReplicaSet":
				for j := range deployments {
					dep := &deployments[j]
					if dep.Namespace != pod.Namespace {
						continue
					}
					sel, err := metav1.LabelSelectorAsSelector(dep.Spec.Selector)
					if err != nil {
						continue
					}
					if sel.Matches(labels.Set(pod.Labels)) {
						ownerRef := models.ResourceRef{Kind: "Deployment", Name: dep.Name, Namespace: pod.Namespace}
						podOwners[pod.Namespace+"/"+pod.Name] = ownerRef
						podRef := models.ResourceRef{Kind: "Pod", Name: pod.Name, Namespace: pod.Namespace}
						addEdge(nodes, forward, reverse, edges, ownerRef, podRef, "owner_ref", "Deployment owns Pod via ReplicaSet")
						break
					}
				}
			case "StatefulSet":
				ownerRef := models.ResourceRef{Kind: "StatefulSet", Name: owner.Name, Namespace: pod.Namespace}
				podOwners[pod.Namespace+"/"+pod.Name] = ownerRef
				podRef := models.ResourceRef{Kind: "Pod", Name: pod.Name, Namespace: pod.Namespace}
				addEdge(nodes, forward, reverse, edges, ownerRef, podRef, "owner_ref", "StatefulSet owns Pod")
			case "DaemonSet":
				ownerRef := models.ResourceRef{Kind: "DaemonSet", Name: owner.Name, Namespace: pod.Namespace}
				podOwners[pod.Namespace+"/"+pod.Name] = ownerRef
				podRef := models.ResourceRef{Kind: "Pod", Name: pod.Name, Namespace: pod.Namespace}
				addEdge(nodes, forward, reverse, edges, ownerRef, podRef, "owner_ref", "DaemonSet owns Pod")
			case "Job":
				ownerRef := models.ResourceRef{Kind: "Job", Name: owner.Name, Namespace: pod.Namespace}
				podOwners[pod.Namespace+"/"+pod.Name] = ownerRef
				podRef := models.ResourceRef{Kind: "Pod", Name: pod.Name, Namespace: pod.Namespace}
				addEdge(nodes, forward, reverse, edges, ownerRef, podRef, "owner_ref", "Job owns Pod")
			}
		}
	}
	return podOwners
}

// --- 2. Service Selectors ---

func inferSelectorDeps(
	nodes map[string]models.ResourceRef,
	forward, reverse map[string]map[string]bool,
	edges *[]models.BlastDependencyEdge,
	services []corev1.Service,
	pods []corev1.Pod,
	podOwners map[string]models.ResourceRef,
) {
	for i := range services {
		svc := &services[i]
		if len(svc.Spec.Selector) == 0 {
			continue
		}
		sel := labels.SelectorFromSet(svc.Spec.Selector)
		svcRef := models.ResourceRef{Kind: "Service", Name: svc.Name, Namespace: svc.Namespace}
		seen := make(map[string]bool)

		for j := range pods {
			pod := &pods[j]
			if pod.Namespace != svc.Namespace {
				continue
			}
			if !sel.Matches(labels.Set(pod.Labels)) {
				continue
			}
			owner, ok := podOwners[pod.Namespace+"/"+pod.Name]
			if !ok {
				continue
			}
			ownerKey := refKey(owner)
			if seen[ownerKey] {
				continue
			}
			seen[ownerKey] = true
			addEdge(nodes, forward, reverse, edges, svcRef, owner, "selector",
				"Service selects Pods owned by "+owner.Kind+"/"+owner.Name)
		}
	}
}

// --- 3. Env Var / DNS References (cross-namespace) ---

func inferEnvVarDeps(
	nodes map[string]models.ResourceRef,
	forward, reverse map[string]map[string]bool,
	edges *[]models.BlastDependencyEdge,
	pods []corev1.Pod,
	services []corev1.Service,
	podOwners map[string]models.ResourceRef,
) {
	// Build service lookup: "name.namespace" -> ServiceRef
	type svcEntry struct {
		ref  models.ResourceRef
		name string
		ns   string
	}
	allServices := make([]svcEntry, 0, len(services))
	for i := range services {
		s := &services[i]
		allServices = append(allServices, svcEntry{
			ref:  models.ResourceRef{Kind: "Service", Name: s.Name, Namespace: s.Namespace},
			name: s.Name,
			ns:   s.Namespace,
		})
	}

	// Also build normalized name lookup for auto-injected env vars
	normalizedSvc := make(map[string]svcEntry) // "MY_SVC" -> svcEntry
	for _, s := range allServices {
		normalized := strings.ToUpper(strings.ReplaceAll(s.name, "-", "_"))
		normalizedSvc[normalized] = s
	}

	for i := range pods {
		pod := &pods[i]
		owner, hasOwner := podOwners[pod.Namespace+"/"+pod.Name]
		if !hasOwner {
			continue
		}

		for _, container := range pod.Spec.Containers {
			for _, env := range container.Env {
				// Pattern 1: {SVCNAME}_SERVICE_HOST / _SERVICE_PORT (same namespace)
				if strings.HasSuffix(env.Name, "_SERVICE_HOST") || strings.HasSuffix(env.Name, "_SERVICE_PORT") {
					prefix := strings.TrimSuffix(strings.TrimSuffix(env.Name, "_SERVICE_HOST"), "_SERVICE_PORT")
					if s, ok := normalizedSvc[prefix]; ok && s.ns == pod.Namespace {
						addEdge(nodes, forward, reverse, edges, owner, s.ref, "env_var",
							"env: "+env.Name+"="+env.Value)
					}
				}

				// Pattern 2: DNS name in env value (cross-namespace!)
				if env.Value != "" {
					for _, s := range allServices {
						// Check for svc.namespace.svc.cluster.local or svc.namespace.svc or svc.namespace
						dnsPatterns := []string{
							s.name + "." + s.ns + ".svc.cluster.local",
							s.name + "." + s.ns + ".svc",
							s.name + "." + s.ns,
						}
						for _, pattern := range dnsPatterns {
							if strings.Contains(env.Value, pattern) {
								addEdge(nodes, forward, reverse, edges, owner, s.ref, "env_var",
									"env: "+env.Name+" references "+pattern)
								break
							}
						}
					}
				}
			}
		}
	}
}

// --- 4. Volume Mount Dependencies ---

func inferVolumeMountDeps(
	nodes map[string]models.ResourceRef,
	forward, reverse map[string]map[string]bool,
	edges *[]models.BlastDependencyEdge,
	deployments []appsv1.Deployment,
	statefulSets []appsv1.StatefulSet,
	daemonSets []appsv1.DaemonSet,
) {
	processVolumes := func(volumes []corev1.Volume, ownerKind, ownerName, ns string) {
		ownerRef := models.ResourceRef{Kind: ownerKind, Name: ownerName, Namespace: ns}
		for _, vol := range volumes {
			if vol.ConfigMap != nil {
				cmRef := models.ResourceRef{Kind: "ConfigMap", Name: vol.ConfigMap.Name, Namespace: ns}
				addEdge(nodes, forward, reverse, edges, ownerRef, cmRef, "volume_mount",
					"mounts ConfigMap/"+vol.ConfigMap.Name)
			}
			if vol.Secret != nil {
				secRef := models.ResourceRef{Kind: "Secret", Name: vol.Secret.SecretName, Namespace: ns}
				addEdge(nodes, forward, reverse, edges, ownerRef, secRef, "volume_mount",
					"mounts Secret/"+vol.Secret.SecretName)
			}
			if vol.PersistentVolumeClaim != nil {
				pvcRef := models.ResourceRef{Kind: "PersistentVolumeClaim", Name: vol.PersistentVolumeClaim.ClaimName, Namespace: ns}
				addEdge(nodes, forward, reverse, edges, ownerRef, pvcRef, "volume_mount",
					"mounts PVC/"+vol.PersistentVolumeClaim.ClaimName)
			}
		}
	}

	for i := range deployments {
		d := &deployments[i]
		processVolumes(d.Spec.Template.Spec.Volumes, "Deployment", d.Name, d.Namespace)
	}
	for i := range statefulSets {
		s := &statefulSets[i]
		processVolumes(s.Spec.Template.Spec.Volumes, "StatefulSet", s.Name, s.Namespace)
	}
	for i := range daemonSets {
		d := &daemonSets[i]
		processVolumes(d.Spec.Template.Spec.Volumes, "DaemonSet", d.Name, d.Namespace)
	}
}

// --- 5. Ingress Dependencies ---

func inferIngressDeps(
	nodes map[string]models.ResourceRef,
	forward, reverse map[string]map[string]bool,
	edges *[]models.BlastDependencyEdge,
	ingresses []networkingv1.Ingress,
) {
	for i := range ingresses {
		ing := &ingresses[i]
		ingRef := models.ResourceRef{Kind: "Ingress", Name: ing.Name, Namespace: ing.Namespace}

		if ing.Spec.DefaultBackend != nil && ing.Spec.DefaultBackend.Service != nil {
			svcRef := models.ResourceRef{Kind: "Service", Name: ing.Spec.DefaultBackend.Service.Name, Namespace: ing.Namespace}
			addEdge(nodes, forward, reverse, edges, ingRef, svcRef, "ingress_route",
				"default backend -> "+svcRef.Name)
		}

		for _, rule := range ing.Spec.Rules {
			if rule.HTTP == nil {
				continue
			}
			host := rule.Host
			if host == "" {
				host = "*"
			}
			for _, path := range rule.HTTP.Paths {
				if path.Backend.Service == nil {
					continue
				}
				svcRef := models.ResourceRef{Kind: "Service", Name: path.Backend.Service.Name, Namespace: ing.Namespace}
				addEdge(nodes, forward, reverse, edges, ingRef, svcRef, "ingress_route",
					host+path.Path+" -> "+svcRef.Name)
			}
		}
	}
}

// --- 6. NetworkPolicy Dependencies (cross-namespace) ---

func inferNetworkPolicyDeps(
	nodes map[string]models.ResourceRef,
	forward, reverse map[string]map[string]bool,
	edges *[]models.BlastDependencyEdge,
	netPolicies []networkingv1.NetworkPolicy,
	pods []corev1.Pod,
	podOwners map[string]models.ResourceRef,
) {
	for i := range netPolicies {
		np := &netPolicies[i]
		npRef := models.ResourceRef{Kind: "NetworkPolicy", Name: np.Name, Namespace: np.Namespace}

		// Find pods selected by this policy's podSelector
		polSel, err := metav1.LabelSelectorAsSelector(&np.Spec.PodSelector)
		if err != nil {
			continue
		}

		targetOwners := make(map[string]models.ResourceRef)
		for j := range pods {
			pod := &pods[j]
			if pod.Namespace != np.Namespace {
				continue
			}
			if polSel.Matches(labels.Set(pod.Labels)) {
				if owner, ok := podOwners[pod.Namespace+"/"+pod.Name]; ok {
					targetOwners[refKey(owner)] = owner
				}
			}
		}

		// Link network policy to target workloads
		for _, owner := range targetOwners {
			addEdge(nodes, forward, reverse, edges, npRef, owner, "network_policy",
				"NetworkPolicy selects "+owner.Kind+"/"+owner.Name)
		}

		// Process ingress rules for cross-namespace peers
		for _, ingRule := range np.Spec.Ingress {
			for _, from := range ingRule.From {
				if from.NamespaceSelector == nil {
					continue
				}
				nsSel, err := metav1.LabelSelectorAsSelector(from.NamespaceSelector)
				if err != nil {
					continue
				}
				var peerPodSel labels.Selector
				if from.PodSelector != nil {
					peerPodSel, err = metav1.LabelSelectorAsSelector(from.PodSelector)
					if err != nil {
						continue
					}
				}
				// Find pods in other namespaces matching the selectors
				for j := range pods {
					pod := &pods[j]
					// Check namespace labels (simplified: we check if pod's namespace matches selector)
					// In a full implementation, we'd fetch Namespace objects and check their labels
					if peerPodSel != nil && !peerPodSel.Matches(labels.Set(pod.Labels)) {
						continue
					}
					if owner, ok := podOwners[pod.Namespace+"/"+pod.Name]; ok {
						for _, targetOwner := range targetOwners {
							addEdge(nodes, forward, reverse, edges, owner, targetOwner, "network_policy",
								"NetworkPolicy allows ingress from "+owner.Namespace+"/"+owner.Name)
						}
					}
				}
				_ = nsSel // used for namespace label matching in full implementation
			}
		}
	}
}

// --- 7 & 8. Istio Dependencies (placeholder interface) ---
// These are added when Istio CRDs are detected. For now, we define the interface.
// The actual implementation will use dynamic client to list VirtualServices and DestinationRules.

// InferIstioDeps analyzes Istio VirtualService and DestinationRule CRDs for cross-namespace routing.
// This is a no-op if Istio is not installed.
func inferIstioDeps(
	nodes map[string]models.ResourceRef,
	forward, reverse map[string]map[string]bool,
	edges *[]models.BlastDependencyEdge,
	services []corev1.Service,
	hasIstio bool,
	virtualServices []map[string]interface{},
	destinationRules []map[string]interface{},
) {
	if !hasIstio || len(virtualServices) == 0 {
		return
	}

	// Build service lookup
	svcByFQDN := make(map[string]models.ResourceRef)
	for i := range services {
		s := &services[i]
		ref := models.ResourceRef{Kind: "Service", Name: s.Name, Namespace: s.Namespace}
		svcByFQDN[s.Name+"."+s.Namespace+".svc.cluster.local"] = ref
		svcByFQDN[s.Name+"."+s.Namespace] = ref
		svcByFQDN[s.Name] = ref // short name (same namespace)
	}

	for _, vs := range virtualServices {
		meta, ok := vs["metadata"].(map[string]interface{})
		if !ok {
			continue
		}
		vsName, _ := meta["name"].(string)
		vsNs, _ := meta["namespace"].(string)
		vsRef := models.ResourceRef{Kind: "VirtualService", Name: vsName, Namespace: vsNs}

		spec, ok := vs["spec"].(map[string]interface{})
		if !ok {
			continue
		}
		httpRoutes, ok := spec["http"].([]interface{})
		if !ok {
			continue
		}
		for _, route := range httpRoutes {
			routeMap, ok := route.(map[string]interface{})
			if !ok {
				continue
			}
			routeDests, ok := routeMap["route"].([]interface{})
			if !ok {
				continue
			}
			for _, rd := range routeDests {
				rdMap, ok := rd.(map[string]interface{})
				if !ok {
					continue
				}
				dest, ok := rdMap["destination"].(map[string]interface{})
				if !ok {
					continue
				}
				host, _ := dest["host"].(string)
				if svcRef, found := svcByFQDN[host]; found {
					addEdge(nodes, forward, reverse, edges, vsRef, svcRef, "istio_route",
						"VirtualService routes to "+host)
				}
			}
		}
	}

	for _, dr := range destinationRules {
		meta, ok := dr["metadata"].(map[string]interface{})
		if !ok {
			continue
		}
		drName, _ := meta["name"].(string)
		drNs, _ := meta["namespace"].(string)
		drRef := models.ResourceRef{Kind: "DestinationRule", Name: drName, Namespace: drNs}

		spec, ok := dr["spec"].(map[string]interface{})
		if !ok {
			continue
		}
		host, _ := spec["host"].(string)
		if svcRef, found := svcByFQDN[host]; found {
			addEdge(nodes, forward, reverse, edges, drRef, svcRef, "istio_destination",
				"DestinationRule targets "+host)
		}
	}
}

// --- HPA Detection ---

func buildHPATargets(hpas []autoscalingv1.HorizontalPodAutoscaler) map[string]bool {
	targets := make(map[string]bool)
	for i := range hpas {
		h := &hpas[i]
		key := h.Spec.ScaleTargetRef.Kind + "/" + h.Namespace + "/" + h.Spec.ScaleTargetRef.Name
		targets[key] = true
	}
	return targets
}

// --- PDB Detection ---

func buildPDBTargets(pdbs []policyv1.PodDisruptionBudget, pods []corev1.Pod, podOwners map[string]models.ResourceRef) map[string]bool {
	targets := make(map[string]bool)
	for i := range pdbs {
		pdb := &pdbs[i]
		if pdb.Spec.Selector == nil {
			continue
		}
		sel, err := metav1.LabelSelectorAsSelector(pdb.Spec.Selector)
		if err != nil {
			continue
		}
		for j := range pods {
			pod := &pods[j]
			if pod.Namespace != pdb.Namespace {
				continue
			}
			if sel.Matches(labels.Set(pod.Labels)) {
				if owner, ok := podOwners[pod.Namespace+"/"+pod.Name]; ok {
					targets[refKey(owner)] = true
				}
			}
		}
	}
	return targets
}

// --- Ingress Host Mapping ---

func buildIngressHostMap(ingresses []networkingv1.Ingress) map[string][]string {
	// serviceKey -> list of hosts
	hostMap := make(map[string][]string)
	for i := range ingresses {
		ing := &ingresses[i]
		for _, rule := range ing.Spec.Rules {
			if rule.HTTP == nil {
				continue
			}
			host := rule.Host
			if host == "" {
				host = "*"
			}
			for _, path := range rule.HTTP.Paths {
				if path.Backend.Service == nil {
					continue
				}
				key := "Service/" + ing.Namespace + "/" + path.Backend.Service.Name
				hostMap[key] = append(hostMap[key], host+path.Path)
			}
		}
	}
	return hostMap
}
```

- [ ] **Step 4: Run tests**

Run: `cd kubilitics-backend && go test ./internal/graph/... -v -run TestInferEnvVar`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/graph/inference.go kubilitics-backend/internal/graph/inference_test.go
git commit -m "feat(blast-radius): add 8 dependency inference techniques with cross-namespace support"
```

---

## Task 4: Scoring and Risk Detection

**Files:**
- Create: `kubilitics-backend/internal/graph/scoring.go`
- Create: `kubilitics-backend/internal/graph/risk.go`
- Create: `kubilitics-backend/internal/graph/scoring_test.go`

- [ ] **Step 1: Write scoring test**

```go
package graph

import "testing"

func TestComputeCriticalityScore(t *testing.T) {
	tests := []struct {
		name     string
		params   scoringParams
		wantMin  float64
		wantMax  float64
	}{
		{
			name:    "low score — isolated leaf",
			params:  scoringParams{pageRank: 0.01, fanIn: 0, crossNsCount: 0},
			wantMin: 0, wantMax: 10,
		},
		{
			name:    "critical — high fanIn + SPOF + ingress",
			params:  scoringParams{pageRank: 0.8, fanIn: 12, crossNsCount: 4, isDataStore: false, isIngressExposed: true, isSPOF: true, hasHPA: false, hasPDB: false},
			wantMin: 75, wantMax: 100,
		},
		{
			name:    "medium — moderate fanIn",
			params:  scoringParams{pageRank: 0.3, fanIn: 3, crossNsCount: 1, hasHPA: true, hasPDB: true},
			wantMin: 25, wantMax: 50,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			score := computeCriticalityScore(tt.params)
			if score < tt.wantMin || score > tt.wantMax {
				t.Errorf("score = %.1f, want [%.1f, %.1f]", score, tt.wantMin, tt.wantMax)
			}
		})
	}
}
```

- [ ] **Step 2: Run test — expect fail**

Run: `cd kubilitics-backend && go test ./internal/graph/... -v -run TestComputeCriticality`
Expected: FAIL

- [ ] **Step 3: Implement scoring**

```go
package graph

import "math"

type scoringParams struct {
	pageRank         float64
	fanIn            int
	crossNsCount     int
	isDataStore      bool
	isIngressExposed bool
	isSPOF           bool
	hasHPA           bool
	hasPDB           bool
}

// computeCriticalityScore calculates a 0-100 criticality score using
// weighted PageRank + risk penalties.
func computeCriticalityScore(p scoringParams) float64 {
	score := 0.0

	// PageRank component: 0-30 points (normalize raw pageRank 0-1 to 0-30)
	score += math.Min(p.pageRank*30.0, 30.0)

	// Fan-in component: 0-20 points
	score += math.Min(float64(p.fanIn)*3.0, 20.0)

	// Cross-namespace reach: 0-10 points
	if p.crossNsCount > 1 {
		score += math.Min(float64(p.crossNsCount)*2.5, 10.0)
	}

	// Data store penalty
	if p.isDataStore {
		score += 15.0
	}

	// Ingress exposure penalty
	if p.isIngressExposed {
		score += 10.0
	}

	// SPOF penalty
	if p.isSPOF {
		score += 10.0
	}

	// Missing safety nets
	if !p.hasHPA {
		score += 5.0
	}
	if !p.hasPDB {
		score += 5.0
	}

	return math.Min(score, 100.0)
}

// simplePageRank computes PageRank scores for all nodes in the graph.
// Uses iterative power method with damping factor 0.85.
func simplePageRank(nodes map[string]bool, forward map[string]map[string]bool, reverse map[string]map[string]bool) map[string]float64 {
	n := float64(len(nodes))
	if n == 0 {
		return nil
	}

	const damping = 0.85
	const maxIter = 50
	const convergence = 0.0001

	ranks := make(map[string]float64, len(nodes))
	initial := 1.0 / n
	for node := range nodes {
		ranks[node] = initial
	}

	for iter := 0; iter < maxIter; iter++ {
		newRanks := make(map[string]float64, len(nodes))
		diff := 0.0

		for node := range nodes {
			sum := 0.0
			for source := range reverse[node] {
				outDeg := float64(len(forward[source]))
				if outDeg > 0 {
					sum += ranks[source] / outDeg
				}
			}
			newRanks[node] = (1-damping)/n + damping*sum
			diff += math.Abs(newRanks[node] - ranks[node])
		}

		ranks = newRanks
		if diff < convergence {
			break
		}
	}

	// Normalize to 0-1 range
	maxRank := 0.0
	for _, r := range ranks {
		if r > maxRank {
			maxRank = r
		}
	}
	if maxRank > 0 {
		for k, r := range ranks {
			ranks[k] = r / maxRank
		}
	}

	return ranks
}
```

- [ ] **Step 4: Implement risk detection**

```go
package graph

import "github.com/kubilitics/kubilitics-backend/internal/models"

// detectRisks generates human-readable risk indicators for a resource.
func detectRisks(
	nodeKey string,
	replicas int,
	fanIn int,
	hasHPA bool,
	hasPDB bool,
	isIngressExposed bool,
	ingressHosts []string,
	isDataStore bool,
	crossNsCount int,
) []models.RiskIndicator {
	var risks []models.RiskIndicator

	if replicas == 1 && fanIn > 0 {
		risks = append(risks, models.RiskIndicator{
			Severity: "critical",
			Title:    "Single Point of Failure",
			Detail:   "Only 1 replica and sole provider for downstream resources",
		})
	}

	if !hasPDB && replicas > 0 {
		risks = append(risks, models.RiskIndicator{
			Severity: "critical",
			Title:    "No PodDisruptionBudget",
			Detail:   "Vulnerable to node drain and cluster upgrades",
		})
	}

	if !hasHPA && replicas > 0 {
		risks = append(risks, models.RiskIndicator{
			Severity: "warning",
			Title:    "No HorizontalPodAutoscaler",
			Detail:   "Cannot auto-scale under load pressure",
		})
	}

	if crossNsCount > 1 {
		risks = append(risks, models.RiskIndicator{
			Severity: "warning",
			Title:    "Cross-Namespace Dependencies",
			Detail:   "Failure cascades beyond namespace boundary to " + string(rune('0'+crossNsCount)) + " namespaces",
		})
	}

	if isIngressExposed {
		detail := "User-facing — outage visible to customers"
		if len(ingressHosts) > 0 {
			detail = "Exposed via: " + ingressHosts[0]
			if len(ingressHosts) > 1 {
				detail += " (+" + string(rune('0'+len(ingressHosts)-1)) + " more)"
			}
		}
		risks = append(risks, models.RiskIndicator{
			Severity: "info",
			Title:    "Ingress Exposed",
			Detail:   detail,
		})
	}

	if isDataStore {
		risks = append(risks, models.RiskIndicator{
			Severity: "info",
			Title:    "Data Store",
			Detail:   "Stateful workload — potential data loss on failure",
		})
	}

	return risks
}
```

- [ ] **Step 5: Run tests**

Run: `cd kubilitics-backend && go test ./internal/graph/... -v -run TestComputeCriticality`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add kubilitics-backend/internal/graph/scoring.go kubilitics-backend/internal/graph/risk.go kubilitics-backend/internal/graph/scoring_test.go
git commit -m "feat(blast-radius): add criticality scoring with PageRank and risk detection"
```

---

## Task 5: Graph Builder

**Files:**
- Create: `kubilitics-backend/internal/graph/builder.go`
- Create: `kubilitics-backend/internal/graph/builder_test.go`

- [ ] **Step 1: Write builder test**

```go
package graph

import (
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestBuildSnapshot_RegistersAllResourceKinds(t *testing.T) {
	resources := &ClusterResources{
		Pods: []corev1.Pod{
			{ObjectMeta: metav1.ObjectMeta{Name: "pod-1", Namespace: "default"}},
		},
		Deployments: []appsv1.Deployment{
			{ObjectMeta: metav1.ObjectMeta{Name: "deploy-1", Namespace: "default"},
				Spec: appsv1.DeploymentSpec{
					Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "test"}},
					Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{}},
				}},
		},
		Services: []corev1.Service{
			{ObjectMeta: metav1.ObjectMeta{Name: "svc-1", Namespace: "default"}},
		},
		ConfigMaps: []corev1.ConfigMap{
			{ObjectMeta: metav1.ObjectMeta{Name: "cm-1", Namespace: "default"}},
		},
	}

	snap := BuildSnapshot(resources, false, nil, nil)

	// All resource types should be registered as nodes
	if _, ok := snap.Nodes["Pod/default/pod-1"]; !ok {
		t.Error("Pod not registered as node")
	}
	if _, ok := snap.Nodes["Deployment/default/deploy-1"]; !ok {
		t.Error("Deployment not registered as node")
	}
	if _, ok := snap.Nodes["Service/default/svc-1"]; !ok {
		t.Error("Service not registered as node")
	}
	if _, ok := snap.Nodes["ConfigMap/default/cm-1"]; !ok {
		t.Error("ConfigMap not registered as node")
	}
}
```

- [ ] **Step 2: Run test — expect fail**

Run: `cd kubilitics-backend && go test ./internal/graph/... -v -run TestBuildSnapshot`
Expected: FAIL

- [ ] **Step 3: Implement builder**

```go
package graph

import (
	"fmt"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// ClusterResources holds all fetched resources from informer caches.
type ClusterResources struct {
	Pods             []corev1.Pod
	Deployments      []appsv1.Deployment
	ReplicaSets      []appsv1.ReplicaSet
	StatefulSets     []appsv1.StatefulSet
	DaemonSets       []appsv1.DaemonSet
	Jobs             []batchv1.Job
	CronJobs         []batchv1.CronJob
	Services         []corev1.Service
	ConfigMaps       []corev1.ConfigMap
	Secrets          []corev1.Secret
	ServiceAccounts  []corev1.ServiceAccount
	Ingresses        []networkingv1.Ingress
	NetworkPolicies  []networkingv1.NetworkPolicy
	PVCs             []corev1.PersistentVolumeClaim
	HPAs             []autoscalingv1.HorizontalPodAutoscaler
	PDBs             []policyv1.PodDisruptionBudget
}

// BuildSnapshot constructs an immutable GraphSnapshot from cluster resources.
func BuildSnapshot(
	res *ClusterResources,
	hasIstio bool,
	virtualServices []map[string]interface{},
	destinationRules []map[string]interface{},
) *GraphSnapshot {
	start := time.Now()

	nodes := make(map[string]models.ResourceRef)
	forward := make(map[string]map[string]bool)
	reverse := make(map[string]map[string]bool)
	var edges []models.BlastDependencyEdge

	// 1. OwnerRef chain (also builds podOwners map)
	podOwners := inferOwnerRefDeps(nodes, forward, reverse, &edges,
		res.Pods, res.Deployments, res.StatefulSets, res.DaemonSets)

	// 2. Service selectors
	inferSelectorDeps(nodes, forward, reverse, &edges,
		res.Services, res.Pods, podOwners)

	// 3. Env var / DNS references (cross-namespace)
	inferEnvVarDeps(nodes, forward, reverse, &edges,
		res.Pods, res.Services, podOwners)

	// 4. Volume mounts
	inferVolumeMountDeps(nodes, forward, reverse, &edges,
		res.Deployments, res.StatefulSets, res.DaemonSets)

	// 5. Ingress dependencies
	inferIngressDeps(nodes, forward, reverse, &edges, res.Ingresses)

	// 6. NetworkPolicy dependencies
	inferNetworkPolicyDeps(nodes, forward, reverse, &edges,
		res.NetworkPolicies, res.Pods, podOwners)

	// 7 & 8. Istio dependencies
	inferIstioDeps(nodes, forward, reverse, &edges,
		res.Services, hasIstio, virtualServices, destinationRules)

	// Register ALL resources as first-class nodes (even without edges)
	registerAll := func(kind string, items []struct{ name, ns string }) {
		for _, item := range items {
			ref := models.ResourceRef{Kind: kind, Name: item.name, Namespace: item.ns}
			nodes[refKey(ref)] = ref
		}
	}

	podItems := make([]struct{ name, ns string }, len(res.Pods))
	for i, p := range res.Pods { podItems[i] = struct{ name, ns string }{p.Name, p.Namespace} }
	registerAll("Pod", podItems)

	deployItems := make([]struct{ name, ns string }, len(res.Deployments))
	for i, d := range res.Deployments { deployItems[i] = struct{ name, ns string }{d.Name, d.Namespace} }
	registerAll("Deployment", deployItems)

	stsItems := make([]struct{ name, ns string }, len(res.StatefulSets))
	for i, s := range res.StatefulSets { stsItems[i] = struct{ name, ns string }{s.Name, s.Namespace} }
	registerAll("StatefulSet", stsItems)

	dsItems := make([]struct{ name, ns string }, len(res.DaemonSets))
	for i, d := range res.DaemonSets { dsItems[i] = struct{ name, ns string }{d.Name, d.Namespace} }
	registerAll("DaemonSet", dsItems)

	svcItems := make([]struct{ name, ns string }, len(res.Services))
	for i, s := range res.Services { svcItems[i] = struct{ name, ns string }{s.Name, s.Namespace} }
	registerAll("Service", svcItems)

	cmItems := make([]struct{ name, ns string }, len(res.ConfigMaps))
	for i, c := range res.ConfigMaps { cmItems[i] = struct{ name, ns string }{c.Name, c.Namespace} }
	registerAll("ConfigMap", cmItems)

	secItems := make([]struct{ name, ns string }, len(res.Secrets))
	for i, s := range res.Secrets { secItems[i] = struct{ name, ns string }{s.Name, s.Namespace} }
	registerAll("Secret", secItems)

	ingItems := make([]struct{ name, ns string }, len(res.Ingresses))
	for i, ig := range res.Ingresses { ingItems[i] = struct{ name, ns string }{ig.Name, ig.Namespace} }
	registerAll("Ingress", ingItems)

	npItems := make([]struct{ name, ns string }, len(res.NetworkPolicies))
	for i, n := range res.NetworkPolicies { npItems[i] = struct{ name, ns string }{n.Name, n.Namespace} }
	registerAll("NetworkPolicy", npItems)

	pvcItems := make([]struct{ name, ns string }, len(res.PVCs))
	for i, p := range res.PVCs { pvcItems[i] = struct{ name, ns string }{p.Name, p.Namespace} }
	registerAll("PersistentVolumeClaim", pvcItems)

	jobItems := make([]struct{ name, ns string }, len(res.Jobs))
	for i, j := range res.Jobs { jobItems[i] = struct{ name, ns string }{j.Name, j.Namespace} }
	registerAll("Job", jobItems)

	cronItems := make([]struct{ name, ns string }, len(res.CronJobs))
	for i, c := range res.CronJobs { cronItems[i] = struct{ name, ns string }{c.Name, c.Namespace} }
	registerAll("CronJob", cronItems)

	saItems := make([]struct{ name, ns string }, len(res.ServiceAccounts))
	for i, s := range res.ServiceAccounts { saItems[i] = struct{ name, ns string }{s.Name, s.Namespace} }
	registerAll("ServiceAccount", saItems)

	// Count total workloads for blast radius %
	totalWorkloads := len(res.Deployments) + len(res.StatefulSets) + len(res.DaemonSets) + len(res.Services) + len(res.Jobs) + len(res.CronJobs)

	// Compute PageRank
	nodeSet := make(map[string]bool, len(nodes))
	for k := range nodes {
		nodeSet[k] = true
	}
	pageRanks := simplePageRank(nodeSet, forward, reverse)

	// Build HPA and PDB target maps
	hpaTargets := buildHPATargets(res.HPAs)
	pdbTargets := buildPDBTargets(res.PDBs, res.Pods, podOwners)
	ingressHostMap := buildIngressHostMap(res.Ingresses)

	// Compute per-node metrics
	nodeScores := make(map[string]float64, len(nodes))
	nodeRisks := make(map[string][]models.RiskIndicator, len(nodes))
	nodeReplicas := make(map[string]int, len(nodes))
	nodeHasHPA := make(map[string]bool, len(nodes))
	nodeHasPDB := make(map[string]bool, len(nodes))
	nodeIngress := make(map[string][]string, len(nodes))
	namespaces := make(map[string]bool)

	for key, ref := range nodes {
		namespaces[ref.Namespace] = true

		replicas := getReplicaCountFromResources(res, ref.Kind, ref.Name, ref.Namespace)
		nodeReplicas[key] = replicas
		nodeHasHPA[key] = hpaTargets[key]
		nodeHasPDB[key] = pdbTargets[key]
		nodeIngress[key] = ingressHostMap[key]

		fanIn := len(reverse[key])
		isDataStore := ref.Kind == "StatefulSet"
		isIngressExposed := len(ingressHostMap[key]) > 0

		// Count affected namespaces for this node
		affected := (&GraphSnapshot{Reverse: reverse}).bfsWalk(reverse, key)
		affectedNs := make(map[string]bool)
		for ak := range affected {
			if ak != key {
				if ar, ok := nodes[ak]; ok {
					affectedNs[ar.Namespace] = true
				}
			}
		}

		score := computeCriticalityScore(scoringParams{
			pageRank:         pageRanks[key],
			fanIn:            fanIn,
			crossNsCount:     len(affectedNs),
			isDataStore:      isDataStore,
			isIngressExposed: isIngressExposed,
			isSPOF:           replicas == 1 && fanIn > 0,
			hasHPA:           hpaTargets[key],
			hasPDB:           pdbTargets[key],
		})
		nodeScores[key] = score

		risks := detectRisks(key, replicas, fanIn, hpaTargets[key], pdbTargets[key],
			isIngressExposed, ingressHostMap[key], isDataStore, len(affectedNs))
		nodeRisks[key] = risks
	}

	return &GraphSnapshot{
		Nodes:          nodes,
		Forward:        forward,
		Reverse:        reverse,
		Edges:          edges,
		NodeScores:     nodeScores,
		NodeRisks:      nodeRisks,
		NodeReplicas:   nodeReplicas,
		NodeHasHPA:     nodeHasHPA,
		NodeHasPDB:     nodeHasPDB,
		NodeIngress:    nodeIngress,
		TotalWorkloads: totalWorkloads,
		BuiltAt:        time.Now().UnixMilli(),
		BuildDuration:  time.Since(start),
		Namespaces:     namespaces,
	}
}

// getReplicaCountFromResources returns the replica count for a workload.
func getReplicaCountFromResources(res *ClusterResources, kind, name, namespace string) int {
	switch kind {
	case "Deployment":
		for i := range res.Deployments {
			d := &res.Deployments[i]
			if d.Name == name && d.Namespace == namespace {
				if d.Spec.Replicas != nil {
					return int(*d.Spec.Replicas)
				}
				return 1
			}
		}
	case "StatefulSet":
		for i := range res.StatefulSets {
			s := &res.StatefulSets[i]
			if s.Name == name && s.Namespace == namespace {
				if s.Spec.Replicas != nil {
					return int(*s.Spec.Replicas)
				}
				return 1
			}
		}
	case "DaemonSet":
		for i := range res.DaemonSets {
			d := &res.DaemonSets[i]
			if d.Name == name && d.Namespace == namespace {
				return int(d.Status.DesiredNumberScheduled)
			}
		}
	}
	return 0
}

func init() {
	// Ensure the package compiles with all dependencies.
	_ = fmt.Sprintf
}
```

- [ ] **Step 4: Run tests**

Run: `cd kubilitics-backend && go test ./internal/graph/... -v -run TestBuildSnapshot`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/graph/builder.go kubilitics-backend/internal/graph/builder_test.go
git commit -m "feat(blast-radius): add graph builder with all resource types as first-class nodes"
```

---

## Task 6: ClusterGraphEngine (Informer + Debounce + Atomic Swap)

**Files:**
- Create: `kubilitics-backend/internal/graph/engine.go`
- Create: `kubilitics-backend/internal/graph/engine_test.go`

- [ ] **Step 1: Write engine test**

```go
package graph

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestEngine_AtomicSnapshot(t *testing.T) {
	// Verify atomic.Value swap works correctly for concurrent reads
	var holder atomic.Value

	snap1 := &GraphSnapshot{
		Nodes:   map[string]models.ResourceRef{"a": {Kind: "Pod", Name: "a", Namespace: "ns"}},
		BuiltAt: time.Now().UnixMilli(),
	}
	holder.Store(snap1)

	// Concurrent read
	got := holder.Load().(*GraphSnapshot)
	if len(got.Nodes) != 1 {
		t.Errorf("expected 1 node, got %d", len(got.Nodes))
	}

	// Swap
	snap2 := &GraphSnapshot{
		Nodes:   map[string]models.ResourceRef{"a": {}, "b": {}},
		BuiltAt: time.Now().UnixMilli(),
	}
	holder.Store(snap2)

	got = holder.Load().(*GraphSnapshot)
	if len(got.Nodes) != 2 {
		t.Errorf("expected 2 nodes after swap, got %d", len(got.Nodes))
	}
}
```

- [ ] **Step 2: Run test — expect fail**

Run: `cd kubilitics-backend && go test ./internal/graph/... -v -run TestEngine_Atomic`
Expected: FAIL (needs models import fix).

- [ ] **Step 3: Implement ClusterGraphEngine**

```go
package graph

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

const (
	debounceDelay    = 2 * time.Second
	emptyGraphStatus = "graph not yet built"
)

// ClusterGraphEngine maintains a live dependency graph for a single cluster.
// It uses K8s informers to watch resources, debounces changes, and rebuilds
// the graph atomically.
type ClusterGraphEngine struct {
	clusterID string
	clientset kubernetes.Interface
	log       *slog.Logger

	snapshot     atomic.Value // *GraphSnapshot
	rebuildCount atomic.Int64
	lastError    atomic.Value // string

	debounceMu sync.Mutex
	dirtyTimer *time.Timer

	factory informers.SharedInformerFactory
	cancel  context.CancelFunc
}

// NewClusterGraphEngine creates a new engine for the given cluster.
func NewClusterGraphEngine(clusterID string, clientset kubernetes.Interface, log *slog.Logger) *ClusterGraphEngine {
	e := &ClusterGraphEngine{
		clusterID: clusterID,
		clientset: clientset,
		log:       log.With("component", "graph-engine", "cluster", clusterID),
	}
	// Store an empty snapshot so Load() never returns nil
	e.snapshot.Store(&GraphSnapshot{
		Nodes:      make(map[string]models.ResourceRef),
		Forward:    make(map[string]map[string]bool),
		Reverse:    make(map[string]map[string]bool),
		Namespaces: make(map[string]bool),
		BuiltAt:    time.Now().UnixMilli(),
	})
	e.lastError.Store("")
	return e
}

// Start begins watching cluster resources and building the graph.
func (e *ClusterGraphEngine) Start(ctx context.Context) {
	ctx, e.cancel = context.WithCancel(ctx)

	e.factory = informers.NewSharedInformerFactory(e.clientset, 0)

	// Register informers for all resource types
	e.factory.Core().V1().Pods().Informer()
	e.factory.Apps().V1().Deployments().Informer()
	e.factory.Apps().V1().ReplicaSets().Informer()
	e.factory.Apps().V1().StatefulSets().Informer()
	e.factory.Apps().V1().DaemonSets().Informer()
	e.factory.Batch().V1().Jobs().Informer()
	e.factory.Batch().V1().CronJobs().Informer()
	e.factory.Core().V1().Services().Informer()
	e.factory.Core().V1().ConfigMaps().Informer()
	e.factory.Core().V1().Secrets().Informer()
	e.factory.Core().V1().ServiceAccounts().Informer()
	e.factory.Networking().V1().Ingresses().Informer()
	e.factory.Networking().V1().NetworkPolicies().Informer()
	e.factory.Core().V1().PersistentVolumeClaims().Informer()
	e.factory.Autoscaling().V1().HorizontalPodAutoscalers().Informer()
	e.factory.Policy().V1().PodDisruptionBudgets().Informer()

	// Add event handler to all informers to trigger debounced rebuild
	handler := cache.ResourceEventHandlerFuncs{
		AddFunc:    func(_ interface{}) { e.markDirty() },
		UpdateFunc: func(_, _ interface{}) { e.markDirty() },
		DeleteFunc: func(_ interface{}) { e.markDirty() },
	}

	e.factory.Core().V1().Pods().Informer().AddEventHandler(handler)
	e.factory.Apps().V1().Deployments().Informer().AddEventHandler(handler)
	e.factory.Apps().V1().ReplicaSets().Informer().AddEventHandler(handler)
	e.factory.Apps().V1().StatefulSets().Informer().AddEventHandler(handler)
	e.factory.Apps().V1().DaemonSets().Informer().AddEventHandler(handler)
	e.factory.Batch().V1().Jobs().Informer().AddEventHandler(handler)
	e.factory.Batch().V1().CronJobs().Informer().AddEventHandler(handler)
	e.factory.Core().V1().Services().Informer().AddEventHandler(handler)
	e.factory.Core().V1().ConfigMaps().Informer().AddEventHandler(handler)
	e.factory.Core().V1().Secrets().Informer().AddEventHandler(handler)
	e.factory.Core().V1().ServiceAccounts().Informer().AddEventHandler(handler)
	e.factory.Networking().V1().Ingresses().Informer().AddEventHandler(handler)
	e.factory.Networking().V1().NetworkPolicies().Informer().AddEventHandler(handler)
	e.factory.Core().V1().PersistentVolumeClaims().Informer().AddEventHandler(handler)
	e.factory.Autoscaling().V1().HorizontalPodAutoscalers().Informer().AddEventHandler(handler)
	e.factory.Policy().V1().PodDisruptionBudgets().Informer().AddEventHandler(handler)

	e.factory.Start(ctx.Done())

	// Wait for initial cache sync
	go func() {
		e.log.Info("Waiting for informer cache sync...")
		e.factory.WaitForCacheSync(ctx.Done())
		e.log.Info("Informer caches synced, triggering initial build")
		e.rebuild()
	}()
}

// Stop shuts down the engine.
func (e *ClusterGraphEngine) Stop() {
	if e.cancel != nil {
		e.cancel()
	}
	e.debounceMu.Lock()
	if e.dirtyTimer != nil {
		e.dirtyTimer.Stop()
	}
	e.debounceMu.Unlock()
}

// markDirty signals that a resource changed. Debounce timer resets.
func (e *ClusterGraphEngine) markDirty() {
	e.debounceMu.Lock()
	defer e.debounceMu.Unlock()

	if e.dirtyTimer != nil {
		e.dirtyTimer.Stop()
	}
	e.dirtyTimer = time.AfterFunc(debounceDelay, func() {
		e.rebuild()
	})
}

// rebuild reads all resources from informer caches and builds a new snapshot.
func (e *ClusterGraphEngine) rebuild() {
	e.log.Debug("Starting graph rebuild")

	resources := e.collectResources()
	if resources == nil {
		e.lastError.Store("failed to collect resources from informer caches")
		return
	}

	// TODO: detect Istio CRDs and fetch VirtualServices/DestinationRules via dynamic client
	snap := BuildSnapshot(resources, false, nil, nil)

	e.snapshot.Store(snap)
	e.rebuildCount.Add(1)
	e.lastError.Store("")
	e.log.Info("Graph rebuilt",
		"nodes", len(snap.Nodes),
		"edges", len(snap.Edges),
		"namespaces", len(snap.Namespaces),
		"duration", snap.BuildDuration,
		"rebuild_count", e.rebuildCount.Load(),
	)
}

// collectResources reads all resources from the informer caches.
func (e *ClusterGraphEngine) collectResources() *ClusterResources {
	res := &ClusterResources{}

	// Pods
	podLister := e.factory.Core().V1().Pods().Lister()
	pods, err := podLister.List(nil) // nil selector = all
	if err != nil {
		e.log.Error("Failed to list pods from cache", "error", err)
		return nil
	}
	for _, p := range pods {
		res.Pods = append(res.Pods, *p)
	}

	// Deployments
	depLister := e.factory.Apps().V1().Deployments().Lister()
	deps, err := depLister.List(nil)
	if err != nil {
		e.log.Error("Failed to list deployments from cache", "error", err)
		return nil
	}
	for _, d := range deps {
		res.Deployments = append(res.Deployments, *d)
	}

	// ReplicaSets
	rsLister := e.factory.Apps().V1().ReplicaSets().Lister()
	rss, err := rsLister.List(nil)
	if err != nil {
		e.log.Error("Failed to list replicasets from cache", "error", err)
		return nil
	}
	for _, r := range rss {
		res.ReplicaSets = append(res.ReplicaSets, *r)
	}

	// StatefulSets
	stsLister := e.factory.Apps().V1().StatefulSets().Lister()
	stss, err := stsLister.List(nil)
	if err != nil {
		e.log.Error("Failed to list statefulsets from cache", "error", err)
		return nil
	}
	for _, s := range stss {
		res.StatefulSets = append(res.StatefulSets, *s)
	}

	// DaemonSets
	dsLister := e.factory.Apps().V1().DaemonSets().Lister()
	dss, err := dsLister.List(nil)
	if err != nil {
		e.log.Error("Failed to list daemonsets from cache", "error", err)
		return nil
	}
	for _, d := range dss {
		res.DaemonSets = append(res.DaemonSets, *d)
	}

	// Jobs
	jobLister := e.factory.Batch().V1().Jobs().Lister()
	jobs, err := jobLister.List(nil)
	if err != nil {
		e.log.Error("Failed to list jobs from cache", "error", err)
		return nil
	}
	for _, j := range jobs {
		res.Jobs = append(res.Jobs, *j)
	}

	// CronJobs
	cjLister := e.factory.Batch().V1().CronJobs().Lister()
	cjs, err := cjLister.List(nil)
	if err != nil {
		e.log.Error("Failed to list cronjobs from cache", "error", err)
		return nil
	}
	for _, c := range cjs {
		res.CronJobs = append(res.CronJobs, *c)
	}

	// Services
	svcLister := e.factory.Core().V1().Services().Lister()
	svcs, err := svcLister.List(nil)
	if err != nil {
		e.log.Error("Failed to list services from cache", "error", err)
		return nil
	}
	for _, s := range svcs {
		res.Services = append(res.Services, *s)
	}

	// ConfigMaps
	cmLister := e.factory.Core().V1().ConfigMaps().Lister()
	cms, err := cmLister.List(nil)
	if err != nil {
		e.log.Error("Failed to list configmaps from cache", "error", err)
		return nil
	}
	for _, c := range cms {
		res.ConfigMaps = append(res.ConfigMaps, *c)
	}

	// Secrets
	secLister := e.factory.Core().V1().Secrets().Lister()
	secs, err := secLister.List(nil)
	if err != nil {
		e.log.Error("Failed to list secrets from cache", "error", err)
		return nil
	}
	for _, s := range secs {
		res.Secrets = append(res.Secrets, *s)
	}

	// ServiceAccounts
	saLister := e.factory.Core().V1().ServiceAccounts().Lister()
	sas, err := saLister.List(nil)
	if err != nil {
		e.log.Error("Failed to list serviceaccounts from cache", "error", err)
		return nil
	}
	for _, s := range sas {
		res.ServiceAccounts = append(res.ServiceAccounts, *s)
	}

	// Ingresses
	ingLister := e.factory.Networking().V1().Ingresses().Lister()
	ings, err := ingLister.List(nil)
	if err != nil {
		e.log.Error("Failed to list ingresses from cache", "error", err)
		return nil
	}
	for _, i := range ings {
		res.Ingresses = append(res.Ingresses, *i)
	}

	// NetworkPolicies
	npLister := e.factory.Networking().V1().NetworkPolicies().Lister()
	nps, err := npLister.List(nil)
	if err != nil {
		e.log.Error("Failed to list networkpolicies from cache", "error", err)
		return nil
	}
	for _, n := range nps {
		res.NetworkPolicies = append(res.NetworkPolicies, *n)
	}

	// PVCs
	pvcLister := e.factory.Core().V1().PersistentVolumeClaims().Lister()
	pvcs, err := pvcLister.List(nil)
	if err != nil {
		e.log.Error("Failed to list pvcs from cache", "error", err)
		return nil
	}
	for _, p := range pvcs {
		res.PVCs = append(res.PVCs, *p)
	}

	// HPAs
	hpaLister := e.factory.Autoscaling().V1().HorizontalPodAutoscalers().Lister()
	hpas, err := hpaLister.List(nil)
	if err != nil {
		e.log.Error("Failed to list hpas from cache", "error", err)
		return nil
	}
	for _, h := range hpas {
		res.HPAs = append(res.HPAs, *h)
	}

	// PDBs
	pdbLister := e.factory.Policy().V1().PodDisruptionBudgets().Lister()
	pdbs, err := pdbLister.List(nil)
	if err != nil {
		e.log.Error("Failed to list pdbs from cache", "error", err)
		return nil
	}
	for _, p := range pdbs {
		res.PDBs = append(res.PDBs, *p)
	}

	return res
}

// Snapshot returns the current graph snapshot (lock-free read).
func (e *ClusterGraphEngine) Snapshot() *GraphSnapshot {
	return e.snapshot.Load().(*GraphSnapshot)
}

// Status returns the current graph status.
func (e *ClusterGraphEngine) Status() models.GraphStatus {
	snap := e.Snapshot()
	status := snap.Status()
	status.RebuildCount = e.rebuildCount.Load()
	if errStr, ok := e.lastError.Load().(string); ok && errStr != "" {
		status.Error = errStr
	}
	return status
}
```

- [ ] **Step 4: Fix test import and run**

Run: `cd kubilitics-backend && go test ./internal/graph/... -v -run TestEngine_Atomic`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add kubilitics-backend/internal/graph/engine.go kubilitics-backend/internal/graph/engine_test.go
git commit -m "feat(blast-radius): add ClusterGraphEngine with informers, debounce, atomic snapshot"
```

---

## Task 7: Wire Engine into Backend (Handler + Routes + Startup)

**Files:**
- Modify: `kubilitics-backend/internal/api/rest/handler.go`
- Modify: `kubilitics-backend/internal/api/rest/blast_radius.go`
- Modify: `kubilitics-backend/cmd/server/main.go`

- [ ] **Step 1: Add graphEngines field to Handler struct**

In `handler.go`, add the field to the Handler struct and update NewHandler:

Add field after line 132 (`wsConns`):
```go
graphEngines map[string]*graph.ClusterGraphEngine // clusterId -> engine
```

Add import for graph package. Update NewHandler to accept and store graph engines.

- [ ] **Step 2: Rewrite blast_radius.go handler**

Replace the entire `blast_radius.go` with the new handler that reads from the engine snapshot:

```go
package rest

import (
	"net/http"

	"github.com/gorilla/mux"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// GetBlastRadius handles GET /clusters/{clusterId}/blast-radius/{namespace}/{kind}/{name}.
func (h *Handler) GetBlastRadius(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}

	namespace := vars["namespace"]
	kind := normalizeKind(vars["kind"])
	name := vars["name"]

	if namespace == "" || kind == "" || name == "" {
		respondError(w, http.StatusBadRequest, "namespace, kind, and name are required")
		return
	}
	if kind == "" {
		respondError(w, http.StatusBadRequest, "Unsupported resource kind")
		return
	}

	engine := h.getGraphEngine(clusterID)
	if engine == nil {
		respondError(w, http.StatusServiceUnavailable, "Blast radius graph not available for this cluster")
		return
	}

	snap := engine.Snapshot()
	if !snap.Status().Ready {
		respondError(w, http.StatusServiceUnavailable, "Dependency graph is still building")
		return
	}

	target := models.ResourceRef{Kind: kind, Name: name, Namespace: namespace}
	result, err := snap.ComputeBlastRadius(target)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	respondJSON(w, http.StatusOK, result)
}

// GetBlastRadiusSummary handles GET /clusters/{clusterId}/blast-radius/summary.
func (h *Handler) GetBlastRadiusSummary(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}

	engine := h.getGraphEngine(clusterID)
	if engine == nil {
		respondError(w, http.StatusServiceUnavailable, "Blast radius graph not available for this cluster")
		return
	}

	snap := engine.Snapshot()
	summary := snap.GetSummary(20)
	respondJSON(w, http.StatusOK, summary)
}

// GetGraphStatus handles GET /clusters/{clusterId}/blast-radius/graph-status.
func (h *Handler) GetGraphStatus(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}

	engine := h.getGraphEngine(clusterID)
	if engine == nil {
		respondJSON(w, http.StatusOK, models.GraphStatus{Error: "graph engine not initialized"})
		return
	}

	respondJSON(w, http.StatusOK, engine.Status())
}

// getGraphEngine returns the graph engine for a cluster, or nil.
func (h *Handler) getGraphEngine(clusterID string) *graph.ClusterGraphEngine {
	if h.graphEngines == nil {
		return nil
	}
	return h.graphEngines[clusterID]
}

// normalizeKind converts plural/lowercase resource kind strings to canonical form.
func normalizeKind(kind string) string {
	// ... (keep existing normalizeKind function unchanged)
}
```

- [ ] **Step 3: Register new routes in SetupRoutes**

In `handler.go`, add after the existing blast-radius route:
```go
router.Handle("/clusters/{clusterId}/blast-radius/summary",
	h.wrapWithRBAC(h.GetBlastRadiusSummary, auth.RoleViewer)).Methods("GET")
router.Handle("/clusters/{clusterId}/blast-radius/graph-status",
	h.wrapWithRBAC(h.GetGraphStatus, auth.RoleViewer)).Methods("GET")
```

**Important:** These routes MUST be registered BEFORE the `{namespace}/{kind}/{name}` route to avoid mux conflicts.

- [ ] **Step 4: Initialize engines in main.go**

After line 209 in `cmd/server/main.go`, add engine initialization:

```go
// Initialize blast radius graph engines for all registered clusters
graphEngines := make(map[string]*graph.ClusterGraphEngine)
for _, cluster := range clusterService.ListClusters(ctx) {
	client, err := clusterService.GetK8sClient(ctx, cluster.ID)
	if err != nil {
		log.Warn("Failed to get client for graph engine", "cluster", cluster.ID, "error", err)
		continue
	}
	engine := graph.NewClusterGraphEngine(cluster.ID, client.Clientset, log)
	engine.Start(ctx)
	graphEngines[cluster.ID] = engine
	log.Info("Started graph engine", "cluster", cluster.ID)
}
```

Pass `graphEngines` to `NewHandler`.

- [ ] **Step 5: Build and verify**

Run: `cd kubilitics-backend && go build ./...`
Expected: Clean compilation.

- [ ] **Step 6: Commit**

```bash
git add kubilitics-backend/internal/api/rest/handler.go kubilitics-backend/internal/api/rest/blast_radius.go kubilitics-backend/cmd/server/main.go
git commit -m "feat(blast-radius): wire ClusterGraphEngine into handler, routes, and startup"
```

---

## Task 8: Frontend TypeScript Types

**Files:**
- Modify: `kubilitics-frontend/src/services/api/types.ts`

- [ ] **Step 1: Add enhanced blast radius types**

Add after the existing BlastRadiusResult type (or replace it):

```typescript
// --- Cluster-Wide Blast Radius (V2) ---

export interface BlastRadiusResult {
  target_resource: ResourceRef;
  criticality_score: number;
  criticality_level: 'critical' | 'high' | 'medium' | 'low';
  blast_radius_percent: number;

  fan_in: number;
  fan_out: number;
  total_affected: number;
  affected_namespaces: number;

  is_spof: boolean;
  has_hpa: boolean;
  has_pdb: boolean;
  is_ingress_exposed: boolean;
  ingress_hosts?: string[];
  replica_count: number;

  waves: BlastWave[];
  dependency_chain: BlastDependencyEdge[];
  risk_indicators: RiskIndicator[];

  graph_node_count: number;
  graph_edge_count: number;
  graph_staleness_ms: number;
}

export interface BlastWave {
  depth: number;
  resources: AffectedResource[];
}

export interface AffectedResource {
  kind: string;
  name: string;
  namespace: string;
  impact: 'direct' | 'transitive';
  wave_depth: number;
  failure_path: PathHop[];
}

export interface PathHop {
  from: ResourceRef;
  to: ResourceRef;
  edge_type: string;
  detail: string;
}

export interface RiskIndicator {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
}

export interface ResourceRef {
  kind: string;
  name: string;
  namespace: string;
}

export interface BlastDependencyEdge {
  source: ResourceRef;
  target: ResourceRef;
  type: string;
  detail?: string;
}

export interface GraphStatus {
  ready: boolean;
  node_count: number;
  edge_count: number;
  namespace_count: number;
  last_rebuild_ms: number;
  staleness_ms: number;
  rebuild_count: number;
  error?: string;
}

export interface BlastRadiusSummaryEntry {
  resource: ResourceRef;
  criticality_score: number;
  criticality_level: string;
  blast_radius_percent: number;
  fan_in: number;
  is_spof: boolean;
  affected_namespaces: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd kubilitics-frontend && npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add kubilitics-frontend/src/services/api/types.ts
git commit -m "feat(blast-radius): add enhanced TypeScript types for cluster-wide API"
```

---

## Task 9: Frontend API Client + Hook

**Files:**
- Create: `kubilitics-frontend/src/services/api/blastRadius.ts`
- Create: `kubilitics-frontend/src/hooks/useBlastRadiusV2.ts`

- [ ] **Step 1: Create API client functions**

```typescript
import { backendRequest } from './client';
import type { BlastRadiusResult, GraphStatus, BlastRadiusSummaryEntry } from './types';

export async function getBlastRadius(
  baseUrl: string,
  clusterId: string,
  namespace: string,
  kind: string,
  name: string,
): Promise<BlastRadiusResult> {
  const ns = namespace || '-';
  return backendRequest<BlastRadiusResult>(
    `${baseUrl}/clusters/${clusterId}/blast-radius/${ns}/${kind}/${name}`,
  );
}

export async function getBlastRadiusSummary(
  baseUrl: string,
  clusterId: string,
): Promise<BlastRadiusSummaryEntry[]> {
  return backendRequest<BlastRadiusSummaryEntry[]>(
    `${baseUrl}/clusters/${clusterId}/blast-radius/summary`,
  );
}

export async function getGraphStatus(
  baseUrl: string,
  clusterId: string,
): Promise<GraphStatus> {
  return backendRequest<GraphStatus>(
    `${baseUrl}/clusters/${clusterId}/blast-radius/graph-status`,
  );
}
```

- [ ] **Step 2: Create useBlastRadiusV2 hook**

```typescript
import { useQuery } from '@tanstack/react-query';
import { useClusterStore } from '@/stores/clusterStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getBlastRadius, getGraphStatus } from '@/services/api/blastRadius';
import type { BlastRadiusResult, GraphStatus } from '@/services/api/types';

interface UseBlastRadiusV2Props {
  kind: string;
  namespace?: string;
  name?: string;
}

interface UseBlastRadiusV2Return {
  data: BlastRadiusResult | undefined;
  graphStatus: GraphStatus | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  isGraphBuilding: boolean;
}

export function useBlastRadiusV2({ kind, namespace, name }: UseBlastRadiusV2Props): UseBlastRadiusV2Return {
  const clusterId = useClusterStore((s) => s.activeClusterId);
  const backendUrl = useSettingsStore((s) => s.backendUrl);

  const enabled = !!(clusterId && backendUrl && kind && name);

  const statusQuery = useQuery({
    queryKey: ['blast-radius-status', clusterId],
    queryFn: () => getGraphStatus(backendUrl!, clusterId!),
    enabled: !!(clusterId && backendUrl),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.ready ? false : 2000; // Poll every 2s while building
    },
    staleTime: 5_000,
  });

  const blastQuery = useQuery({
    queryKey: ['blast-radius', clusterId, kind, namespace, name],
    queryFn: () => getBlastRadius(backendUrl!, clusterId!, namespace || '-', kind, name!),
    enabled: enabled && statusQuery.data?.ready === true,
    staleTime: 30_000,
    retry: 2,
    retryDelay: 1000,
  });

  return {
    data: blastQuery.data,
    graphStatus: statusQuery.data,
    isLoading: blastQuery.isLoading || statusQuery.isLoading,
    isFetching: blastQuery.isFetching,
    error: blastQuery.error,
    isGraphBuilding: statusQuery.data?.ready === false,
  };
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd kubilitics-frontend && npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add kubilitics-frontend/src/services/api/blastRadius.ts kubilitics-frontend/src/hooks/useBlastRadiusV2.ts
git commit -m "feat(blast-radius): add API client and React Query hook for cluster-wide blast radius"
```

---

## Task 10: Frontend — BlastRadiusTab Rewrite (Sub-Components)

**Files:**
- Create: `kubilitics-frontend/src/components/blast-radius/CriticalityBanner.tsx`
- Create: `kubilitics-frontend/src/components/blast-radius/RiskIndicatorCards.tsx`
- Create: `kubilitics-frontend/src/components/blast-radius/WaveBreakdown.tsx`
- Create: `kubilitics-frontend/src/components/blast-radius/RiskPanel.tsx`
- Create: `kubilitics-frontend/src/components/blast-radius/SimulationControls.tsx`
- Create: `kubilitics-frontend/src/components/blast-radius/SimulationEngine.ts`
- Modify: `kubilitics-frontend/src/components/resources/BlastRadiusTab.tsx`

This is a large task. Each sub-component should be built and committed individually. The implementing agent should:

1. Build `CriticalityBanner.tsx` first — the full-width gradient banner with criticality level colors, human verdict, score badge. Must support dark/light mode using `dark:` prefix Tailwind classes.

2. Build `RiskIndicatorCards.tsx` — 4-card grid: SPOF, Blast Radius %, Fan-in/Fan-out, Cross-namespace. Use Framer Motion for subtle entry animation.

3. Build `SimulationEngine.ts` — pure TypeScript class (no React). Takes wave data, provides `start()`, `stop()`, `reset()`, `onWave(callback)` interface. Uses `requestAnimationFrame` with 800ms intervals.

4. Build `SimulationControls.tsx` — Simulate Failure button, progress bar, wave counter, Clear button.

5. Build `WaveBreakdown.tsx` — affected resources grouped by wave depth. Clickable resources navigate to detail page.

6. Build `RiskPanel.tsx` — risk indicators with severity colors, expandable failure paths.

7. Rewrite `BlastRadiusTab.tsx` — compose all sub-components, wire `useBlastRadiusV2`, handle graph-building state.

**Design requirements:**
- Apple-grade clarity in dark and light mode
- Follow existing Tailwind patterns: `bg-white dark:bg-slate-900`, semantic tokens from `src/tokens/`
- Reference Metrics tab for card spacing and layout consistency
- Use `cn()` from `src/lib/utils.ts` for conditional classes
- Use Framer Motion `motion.div` for enter animations (consistent with existing tabs)
- Banner gradient colors: critical=red-600→red-900, high=orange-500→orange-800, medium=yellow-500→yellow-700, low=blue-500→blue-700

Each sub-component commit follows the pattern:
```bash
git add kubilitics-frontend/src/components/blast-radius/<Component>.tsx
git commit -m "feat(blast-radius): add <Component> with dark/light mode support"
```

---

## Task 11: Frontend — Enhanced TopologyCanvas Simulation

**Files:**
- Modify: `kubilitics-frontend/src/topology/TopologyCanvas.tsx`

- [ ] **Step 1: Enhance simulation rendering**

Update TopologyCanvas to support wave-based coloring during simulation:

- Add `simulationWaveDepths` prop: `Map<string, number>` (nodeId -> wave depth)
- Wave 1 nodes: `ring-red-600 dark:ring-red-500` with glow shadow
- Wave 2+ nodes: `ring-orange-500 dark:ring-orange-400` with softer glow
- Origin node: thick red ring + pulsing animation
- Unaffected nodes during simulation: `opacity-[0.15] saturate-[0.2]`
- Edges between affected nodes: red/orange glow using CSS `filter: drop-shadow()`
- Add progress bar overlay during animation

- [ ] **Step 2: Verify it compiles**

Run: `cd kubilitics-frontend && npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add kubilitics-frontend/src/topology/TopologyCanvas.tsx
git commit -m "feat(blast-radius): enhance TopologyCanvas with wave-based simulation rendering"
```

---

## Task 12: Integration Testing + Cleanup

**Files:**
- Deprecated: `kubilitics-backend/internal/service/blast_radius.go`

- [ ] **Step 1: Run all backend tests**

Run: `cd kubilitics-backend && go test ./... -v -count=1 2>&1 | tail -50`
Expected: All tests pass, including new graph/ tests.

- [ ] **Step 2: Run frontend build**

Run: `cd kubilitics-frontend && npm run build`
Expected: Clean build, no errors.

- [ ] **Step 3: Remove deprecated service file**

Delete `kubilitics-backend/internal/service/blast_radius.go` and remove any remaining imports.

Run: `cd kubilitics-backend && go build ./...`
Expected: Clean compilation.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(blast-radius): cluster-wide blast radius with animated cascade simulation

Replaces namespace-scoped per-request blast radius with cluster-wide
dependency graph engine. Uses K8s informers, debounced rebuilds, and
atomic snapshots for <100ms queries. Frontend redesigned with critical
banner, wave-by-wave cascade animation, risk indicators, and failure
path traces. Supports cross-namespace dependencies and Istio integration."
```
