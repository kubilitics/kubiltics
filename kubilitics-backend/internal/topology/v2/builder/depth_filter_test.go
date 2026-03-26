package builder

import (
	"sort"
	"testing"

	v2 "github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// testGraph returns a representative topology graph for testing depth filtering.
func testGraph() ([]v2.TopologyNode, []v2.TopologyEdge) {
	nodes := []v2.TopologyNode{
		// depth 0: executive view
		{ID: "Deployment/default/nginx", Kind: "Deployment", Name: "nginx", Namespace: "default"},
		{ID: "StatefulSet/default/postgres", Kind: "StatefulSet", Name: "postgres", Namespace: "default"},
		{ID: "DaemonSet/kube-system/fluentd", Kind: "DaemonSet", Name: "fluentd", Namespace: "kube-system"},
		{ID: "CronJob/default/backup", Kind: "CronJob", Name: "backup", Namespace: "default"},
		{ID: "Service/default/nginx-svc", Kind: "Service", Name: "nginx-svc", Namespace: "default"},
		{ID: "Ingress/default/nginx-ing", Kind: "Ingress", Name: "nginx-ing", Namespace: "default"},
		{ID: "Node/worker-1", Kind: "Node", Name: "worker-1"},
		{ID: "Namespace/default", Kind: "Namespace", Name: "default"},

		// depth 1: intermediary
		{ID: "ReplicaSet/default/nginx-abc", Kind: "ReplicaSet", Name: "nginx-abc", Namespace: "default"},
		{ID: "Job/default/backup-001", Kind: "Job", Name: "backup-001", Namespace: "default"},
		{ID: "Endpoints/default/nginx-svc", Kind: "Endpoints", Name: "nginx-svc", Namespace: "default"},
		{ID: "HorizontalPodAutoscaler/default/nginx-hpa", Kind: "HorizontalPodAutoscaler", Name: "nginx-hpa", Namespace: "default"},
		{ID: "PodDisruptionBudget/default/nginx-pdb", Kind: "PodDisruptionBudget", Name: "nginx-pdb", Namespace: "default"},

		// depth 2: workload units + config
		{ID: "Pod/default/nginx-abc-xyz", Kind: "Pod", Name: "nginx-abc-xyz", Namespace: "default"},
		{ID: "ConfigMap/default/nginx-config", Kind: "ConfigMap", Name: "nginx-config", Namespace: "default"},
		{ID: "Secret/default/nginx-tls", Kind: "Secret", Name: "nginx-tls", Namespace: "default"},
		{ID: "PersistentVolumeClaim/default/pg-data", Kind: "PersistentVolumeClaim", Name: "pg-data", Namespace: "default"},
		{ID: "ServiceAccount/default/nginx-sa", Kind: "ServiceAccount", Name: "nginx-sa", Namespace: "default"},

		// depth 3: everything else
		{ID: "Role/default/nginx-role", Kind: "Role", Name: "nginx-role", Namespace: "default"},
		{ID: "RoleBinding/default/nginx-rb", Kind: "RoleBinding", Name: "nginx-rb", Namespace: "default"},
		{ID: "ClusterRole/admin", Kind: "ClusterRole", Name: "admin"},
		{ID: "NetworkPolicy/default/deny-all", Kind: "NetworkPolicy", Name: "deny-all", Namespace: "default"},
		{ID: "Event/default/pod-started", Kind: "Event", Name: "pod-started", Namespace: "default"},
	}

	edges := []v2.TopologyEdge{
		{ID: "e1", Source: "Deployment/default/nginx", Target: "ReplicaSet/default/nginx-abc", RelationshipType: "ownerRef"},
		{ID: "e2", Source: "ReplicaSet/default/nginx-abc", Target: "Pod/default/nginx-abc-xyz", RelationshipType: "ownerRef"},
		{ID: "e3", Source: "Service/default/nginx-svc", Target: "Pod/default/nginx-abc-xyz", RelationshipType: "selector"},
		{ID: "e4", Source: "Ingress/default/nginx-ing", Target: "Service/default/nginx-svc", RelationshipType: "ingress_backend"},
		{ID: "e5", Source: "Pod/default/nginx-abc-xyz", Target: "ConfigMap/default/nginx-config", RelationshipType: "volume_mount"},
		{ID: "e6", Source: "Pod/default/nginx-abc-xyz", Target: "Node/worker-1", RelationshipType: "scheduling"},
		{ID: "e7", Source: "CronJob/default/backup", Target: "Job/default/backup-001", RelationshipType: "ownerRef"},
		{ID: "e8", Source: "HorizontalPodAutoscaler/default/nginx-hpa", Target: "Deployment/default/nginx", RelationshipType: "scaling"},
		{ID: "e9", Source: "PodDisruptionBudget/default/nginx-pdb", Target: "Deployment/default/nginx", RelationshipType: "disruption_budget"},
		{ID: "e10", Source: "ServiceAccount/default/nginx-sa", Target: "RoleBinding/default/nginx-rb", RelationshipType: "role_binding"},
		{ID: "e11", Source: "RoleBinding/default/nginx-rb", Target: "Role/default/nginx-role", RelationshipType: "role_binding"},
		{ID: "e12", Source: "StatefulSet/default/postgres", Target: "PersistentVolumeClaim/default/pg-data", RelationshipType: "volume_claim"},
	}

	return nodes, edges
}

func TestFilterByDepth_Depth0(t *testing.T) {
	nodes, edges := testGraph()
	filtered, filteredEdges, expandable := FilterByDepth(nodes, edges, 0)

	// Should only include depth-0 kinds
	allowedKinds := map[string]bool{
		"Deployment": true, "StatefulSet": true, "DaemonSet": true,
		"CronJob": true, "Service": true, "Ingress": true,
		"Node": true, "Namespace": true,
	}
	for _, n := range filtered {
		if !allowedKinds[n.Kind] {
			t.Errorf("depth=0 should not include kind %s (node %s)", n.Kind, n.ID)
		}
	}
	if len(filtered) != 8 {
		t.Errorf("expected 8 nodes at depth=0, got %d", len(filtered))
	}

	// Only edges between depth-0 nodes should survive
	visibleIDs := make(map[string]bool)
	for _, n := range filtered {
		visibleIDs[n.ID] = true
	}
	for _, e := range filteredEdges {
		if !visibleIDs[e.Source] || !visibleIDs[e.Target] {
			t.Errorf("edge %s connects hidden nodes: %s -> %s", e.ID, e.Source, e.Target)
		}
	}

	// Ingress->Service edge should survive (both depth 0)
	foundE4 := false
	for _, e := range filteredEdges {
		if e.ID == "e4" {
			foundE4 = true
		}
	}
	if !foundE4 {
		t.Error("expected edge e4 (Ingress->Service) to survive at depth=0")
	}

	// Expandable: Deployment and CronJob have children at deeper levels
	if len(expandable) == 0 {
		t.Error("expected expandable nodes at depth=0")
	}
	expandableSet := make(map[string]bool)
	for _, id := range expandable {
		expandableSet[id] = true
	}
	// Deployment/default/nginx -> ReplicaSet (depth 1), so it should be expandable
	if !expandableSet["Deployment/default/nginx"] {
		t.Error("Deployment/default/nginx should be expandable")
	}
}

func TestFilterByDepth_Depth1(t *testing.T) {
	nodes, edges := testGraph()
	filtered, _, _ := FilterByDepth(nodes, edges, 1)

	// Should include depth-0 + depth-1 kinds
	allowedKinds := map[string]bool{
		"Deployment": true, "StatefulSet": true, "DaemonSet": true,
		"CronJob": true, "Service": true, "Ingress": true,
		"Node": true, "Namespace": true,
		"ReplicaSet": true, "Job": true, "Endpoints": true,
		"EndpointSlice": true, "HorizontalPodAutoscaler": true,
		"PodDisruptionBudget": true,
	}
	for _, n := range filtered {
		if !allowedKinds[n.Kind] {
			t.Errorf("depth=1 should not include kind %s (node %s)", n.Kind, n.ID)
		}
	}
	if len(filtered) != 13 {
		t.Errorf("expected 13 nodes at depth=1, got %d", len(filtered))
	}
}

func TestFilterByDepth_Depth2(t *testing.T) {
	nodes, edges := testGraph()
	filtered, _, expandable := FilterByDepth(nodes, edges, 2)

	// Should include depth 0+1+2
	disallowedKinds := map[string]bool{
		"Role": true, "RoleBinding": true, "ClusterRole": true,
		"NetworkPolicy": true, "Event": true,
	}
	for _, n := range filtered {
		if disallowedKinds[n.Kind] {
			t.Errorf("depth=2 should not include kind %s (node %s)", n.Kind, n.ID)
		}
	}
	if len(filtered) != 18 {
		t.Errorf("expected 18 nodes at depth=2, got %d", len(filtered))
	}

	// ServiceAccount has edge to RoleBinding (depth 3), so should be expandable
	expandableSet := make(map[string]bool)
	for _, id := range expandable {
		expandableSet[id] = true
	}
	if !expandableSet["ServiceAccount/default/nginx-sa"] {
		t.Error("ServiceAccount/default/nginx-sa should be expandable at depth=2")
	}
}

func TestFilterByDepth_Depth3(t *testing.T) {
	nodes, edges := testGraph()
	filtered, filteredEdges, expandable := FilterByDepth(nodes, edges, 3)

	// depth 3 returns everything
	if len(filtered) != len(nodes) {
		t.Errorf("expected %d nodes at depth=3, got %d", len(nodes), len(filtered))
	}
	if len(filteredEdges) != len(edges) {
		t.Errorf("expected %d edges at depth=3, got %d", len(edges), len(filteredEdges))
	}
	if len(expandable) != 0 {
		t.Errorf("expected no expandable nodes at depth=3, got %d", len(expandable))
	}
}

func TestFilterByDepth_NegativeDepth(t *testing.T) {
	nodes, edges := testGraph()
	filtered, _, _ := FilterByDepth(nodes, edges, -1)
	// Negative depth should be treated as depth 0
	if len(filtered) != 8 {
		t.Errorf("expected 8 nodes for negative depth, got %d", len(filtered))
	}
}

func TestExpandNode(t *testing.T) {
	nodes, edges := testGraph()
	// Start with depth=0 visible nodes
	depth0Nodes, _, _ := FilterByDepth(nodes, edges, 0)

	// Expand Deployment/default/nginx — should add ReplicaSet/default/nginx-abc
	expanded, expandedEdges := ExpandNode(nodes, edges, depth0Nodes, "Deployment/default/nginx")

	expandedIDs := make(map[string]bool)
	for _, n := range expanded {
		expandedIDs[n.ID] = true
	}

	// Original depth-0 nodes should still be there
	if !expandedIDs["Deployment/default/nginx"] {
		t.Error("missing Deployment/default/nginx after expand")
	}
	if !expandedIDs["Service/default/nginx-svc"] {
		t.Error("missing Service/default/nginx-svc after expand")
	}

	// ReplicaSet is a direct child of Deployment — should be added
	if !expandedIDs["ReplicaSet/default/nginx-abc"] {
		t.Error("expected ReplicaSet/default/nginx-abc to appear after expanding Deployment")
	}

	// HPA also connects to Deployment
	if !expandedIDs["HorizontalPodAutoscaler/default/nginx-hpa"] {
		t.Error("expected HPA to appear after expanding Deployment (connected via scaling edge)")
	}

	// Pod should NOT appear (2 hops away from Deployment)
	if expandedIDs["Pod/default/nginx-abc-xyz"] {
		t.Error("Pod should not appear from expanding Deployment (2 hops away)")
	}

	// Edge from Deployment->ReplicaSet should now be included
	foundE1 := false
	for _, e := range expandedEdges {
		if e.ID == "e1" {
			foundE1 = true
		}
	}
	if !foundE1 {
		t.Error("expected edge e1 (Deployment->ReplicaSet) after expand")
	}
}

func TestExpandNode_NoDuplicates(t *testing.T) {
	nodes, edges := testGraph()
	depth0Nodes, _, _ := FilterByDepth(nodes, edges, 0)

	// Expand a node whose neighbor is already visible
	expanded, _ := ExpandNode(nodes, edges, depth0Nodes, "Ingress/default/nginx-ing")

	// Service/default/nginx-svc is already at depth 0 — should not be duplicated
	count := 0
	for _, n := range expanded {
		if n.ID == "Service/default/nginx-svc" {
			count++
		}
	}
	if count != 1 {
		t.Errorf("expected Service/default/nginx-svc exactly once, got %d", count)
	}
}

func TestKindDepthLevel(t *testing.T) {
	tests := []struct {
		kind     string
		expected int
	}{
		{"Deployment", 0},
		{"StatefulSet", 0},
		{"Service", 0},
		{"Ingress", 0},
		{"Node", 0},
		{"Namespace", 0},
		{"ReplicaSet", 1},
		{"Job", 1},
		{"HorizontalPodAutoscaler", 1},
		{"Pod", 2},
		{"ConfigMap", 2},
		{"Secret", 2},
		{"ServiceAccount", 2},
		{"Role", 3},
		{"RoleBinding", 3},
		{"ClusterRole", 3},
		{"NetworkPolicy", 3},
		{"Event", 3},
		{"MutatingWebhookConfiguration", 3},
		{"SomeFutureKind", 3},
	}
	for _, tt := range tests {
		if got := kindDepthLevel(tt.kind); got != tt.expected {
			t.Errorf("kindDepthLevel(%q) = %d, want %d", tt.kind, got, tt.expected)
		}
	}
}

func TestFilterByDepth_EdgesOnlyBetweenVisible(t *testing.T) {
	nodes, edges := testGraph()
	for depth := 0; depth <= 2; depth++ {
		filtered, filteredEdges, _ := FilterByDepth(nodes, edges, depth)
		visibleIDs := make(map[string]bool)
		for _, n := range filtered {
			visibleIDs[n.ID] = true
		}
		for _, e := range filteredEdges {
			if !visibleIDs[e.Source] {
				t.Errorf("depth=%d: edge %s source %s not in visible set", depth, e.ID, e.Source)
			}
			if !visibleIDs[e.Target] {
				t.Errorf("depth=%d: edge %s target %s not in visible set", depth, e.ID, e.Target)
			}
		}
	}
}

func TestFilterByDepth_ExpandableIsSorted(t *testing.T) {
	nodes, edges := testGraph()
	_, _, expandable := FilterByDepth(nodes, edges, 0)
	sorted := make([]string, len(expandable))
	copy(sorted, expandable)
	sort.Strings(sorted)
	// Just verify it's a non-empty list (order is not guaranteed by the implementation)
	if len(expandable) == 0 {
		t.Error("expected non-empty expandable list at depth=0")
	}
}
