package builder

import (
	"testing"

	v2 "github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

func TestAggregatePods_NoPodsUnchanged(t *testing.T) {
	nodes := []v2.TopologyNode{
		{ID: "Deployment/default/nginx", Kind: "Deployment", Name: "nginx", Namespace: "default"},
	}
	edges := []v2.TopologyEdge{
		{ID: "e1", Source: "Service/default/nginx", Target: "Deployment/default/nginx"},
	}
	gotNodes, gotEdges := AggregatePods(nodes, edges)
	if len(gotNodes) != 1 || len(gotEdges) != 1 {
		t.Fatalf("expected no change; got %d nodes, %d edges", len(gotNodes), len(gotEdges))
	}
}

func TestAggregatePods_BelowThreshold(t *testing.T) {
	nodes := []v2.TopologyNode{
		{ID: "ReplicaSet/default/nginx-abc", Kind: "ReplicaSet", Name: "nginx-abc", Namespace: "default"},
		{ID: "Pod/default/nginx-abc-1", Kind: "Pod", Name: "nginx-abc-1", Namespace: "default", Status: "Running"},
		{ID: "Pod/default/nginx-abc-2", Kind: "Pod", Name: "nginx-abc-2", Namespace: "default", Status: "Running"},
		{ID: "Pod/default/nginx-abc-3", Kind: "Pod", Name: "nginx-abc-3", Namespace: "default", Status: "Running"},
	}
	edges := []v2.TopologyEdge{
		{ID: "e1", Source: "ReplicaSet/default/nginx-abc", Target: "Pod/default/nginx-abc-1", RelationshipType: "owns"},
		{ID: "e2", Source: "ReplicaSet/default/nginx-abc", Target: "Pod/default/nginx-abc-2", RelationshipType: "owns"},
		{ID: "e3", Source: "ReplicaSet/default/nginx-abc", Target: "Pod/default/nginx-abc-3", RelationshipType: "owns"},
	}
	gotNodes, gotEdges := AggregatePods(nodes, edges)
	// 3 pods == threshold, should NOT aggregate
	if len(gotNodes) != 4 {
		t.Fatalf("expected 4 nodes (no aggregation), got %d", len(gotNodes))
	}
	if len(gotEdges) != 3 {
		t.Fatalf("expected 3 edges, got %d", len(gotEdges))
	}
}

func TestAggregatePods_AboveThreshold(t *testing.T) {
	nodes := []v2.TopologyNode{
		{ID: "ReplicaSet/default/nginx-abc", Kind: "ReplicaSet", Name: "nginx-abc", Namespace: "default"},
		{ID: "Pod/default/nginx-abc-1", Kind: "Pod", Name: "nginx-abc-1", Namespace: "default", Status: "Running"},
		{ID: "Pod/default/nginx-abc-2", Kind: "Pod", Name: "nginx-abc-2", Namespace: "default", Status: "Running"},
		{ID: "Pod/default/nginx-abc-3", Kind: "Pod", Name: "nginx-abc-3", Namespace: "default", Status: "Running"},
		{ID: "Pod/default/nginx-abc-4", Kind: "Pod", Name: "nginx-abc-4", Namespace: "default", Status: "Running"},
		{ID: "Pod/default/nginx-abc-5", Kind: "Pod", Name: "nginx-abc-5", Namespace: "default", Status: "Pending"},
	}
	edges := []v2.TopologyEdge{
		{ID: "e1", Source: "ReplicaSet/default/nginx-abc", Target: "Pod/default/nginx-abc-1", RelationshipType: "owns"},
		{ID: "e2", Source: "ReplicaSet/default/nginx-abc", Target: "Pod/default/nginx-abc-2", RelationshipType: "owns"},
		{ID: "e3", Source: "ReplicaSet/default/nginx-abc", Target: "Pod/default/nginx-abc-3", RelationshipType: "owns"},
		{ID: "e4", Source: "ReplicaSet/default/nginx-abc", Target: "Pod/default/nginx-abc-4", RelationshipType: "owns"},
		{ID: "e5", Source: "ReplicaSet/default/nginx-abc", Target: "Pod/default/nginx-abc-5", RelationshipType: "owns"},
	}
	gotNodes, gotEdges := AggregatePods(nodes, edges)

	// Should have 2 nodes: ReplicaSet + PodGroup
	if len(gotNodes) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(gotNodes))
	}

	// Find the PodGroup node
	var podGroup *v2.TopologyNode
	for i := range gotNodes {
		if gotNodes[i].Kind == "PodGroup" {
			podGroup = &gotNodes[i]
			break
		}
	}
	if podGroup == nil {
		t.Fatal("expected a PodGroup node")
	}
	if podGroup.Name != "nginx-abc-pods (5 replicas)" {
		t.Errorf("unexpected PodGroup name: %s", podGroup.Name)
	}
	if podGroup.Status != "Pending" {
		t.Errorf("expected worst status Pending, got %s", podGroup.Status)
	}
	if podGroup.Extra["podCount"] != 5 {
		t.Errorf("expected podCount=5, got %v", podGroup.Extra["podCount"])
	}
	if podGroup.Extra["readyCount"] != 4 {
		t.Errorf("expected readyCount=4, got %v", podGroup.Extra["readyCount"])
	}

	// Should have exactly 1 edge: ReplicaSet -> PodGroup
	if len(gotEdges) != 1 {
		t.Fatalf("expected 1 edge, got %d", len(gotEdges))
	}
	if gotEdges[0].Source != "ReplicaSet/default/nginx-abc" {
		t.Errorf("unexpected edge source: %s", gotEdges[0].Source)
	}
	if gotEdges[0].Target != "PodGroup/default/nginx-abc" {
		t.Errorf("unexpected edge target: %s", gotEdges[0].Target)
	}
}

func TestAggregatePods_FailedStatusWins(t *testing.T) {
	nodes := []v2.TopologyNode{
		{ID: "ReplicaSet/default/app-rs", Kind: "ReplicaSet", Name: "app-rs", Namespace: "default"},
		{ID: "Pod/default/app-1", Kind: "Pod", Name: "app-1", Namespace: "default", Status: "Running"},
		{ID: "Pod/default/app-2", Kind: "Pod", Name: "app-2", Namespace: "default", Status: "Failed"},
		{ID: "Pod/default/app-3", Kind: "Pod", Name: "app-3", Namespace: "default", Status: "Pending"},
		{ID: "Pod/default/app-4", Kind: "Pod", Name: "app-4", Namespace: "default", Status: "Running"},
	}
	edges := []v2.TopologyEdge{
		{ID: "e1", Source: "ReplicaSet/default/app-rs", Target: "Pod/default/app-1", RelationshipType: "owns"},
		{ID: "e2", Source: "ReplicaSet/default/app-rs", Target: "Pod/default/app-2", RelationshipType: "owns"},
		{ID: "e3", Source: "ReplicaSet/default/app-rs", Target: "Pod/default/app-3", RelationshipType: "owns"},
		{ID: "e4", Source: "ReplicaSet/default/app-rs", Target: "Pod/default/app-4", RelationshipType: "owns"},
	}
	gotNodes, _ := AggregatePods(nodes, edges)

	var podGroup *v2.TopologyNode
	for i := range gotNodes {
		if gotNodes[i].Kind == "PodGroup" {
			podGroup = &gotNodes[i]
			break
		}
	}
	if podGroup == nil {
		t.Fatal("expected a PodGroup node")
	}
	if podGroup.Status != "Failed" {
		t.Errorf("expected worst status Failed, got %s", podGroup.Status)
	}
}

func TestAggregatePods_EdgeRedirection(t *testing.T) {
	// A Service targets individual pods via edges; after aggregation those
	// edges should be redirected to the PodGroup node and deduplicated.
	nodes := []v2.TopologyNode{
		{ID: "Service/default/web", Kind: "Service", Name: "web", Namespace: "default"},
		{ID: "ReplicaSet/default/web-rs", Kind: "ReplicaSet", Name: "web-rs", Namespace: "default"},
		{ID: "Pod/default/web-1", Kind: "Pod", Name: "web-1", Namespace: "default", Status: "Running"},
		{ID: "Pod/default/web-2", Kind: "Pod", Name: "web-2", Namespace: "default", Status: "Running"},
		{ID: "Pod/default/web-3", Kind: "Pod", Name: "web-3", Namespace: "default", Status: "Running"},
		{ID: "Pod/default/web-4", Kind: "Pod", Name: "web-4", Namespace: "default", Status: "Running"},
	}
	edges := []v2.TopologyEdge{
		{ID: "e1", Source: "ReplicaSet/default/web-rs", Target: "Pod/default/web-1", RelationshipType: "owns"},
		{ID: "e2", Source: "ReplicaSet/default/web-rs", Target: "Pod/default/web-2", RelationshipType: "owns"},
		{ID: "e3", Source: "ReplicaSet/default/web-rs", Target: "Pod/default/web-3", RelationshipType: "owns"},
		{ID: "e4", Source: "ReplicaSet/default/web-rs", Target: "Pod/default/web-4", RelationshipType: "owns"},
		// Service -> Pod edges (e.g., label-match)
		{ID: "s1", Source: "Service/default/web", Target: "Pod/default/web-1", RelationshipType: "routes"},
		{ID: "s2", Source: "Service/default/web", Target: "Pod/default/web-2", RelationshipType: "routes"},
		{ID: "s3", Source: "Service/default/web", Target: "Pod/default/web-3", RelationshipType: "routes"},
		{ID: "s4", Source: "Service/default/web", Target: "Pod/default/web-4", RelationshipType: "routes"},
	}
	_, gotEdges := AggregatePods(nodes, edges)

	// Should have exactly 2 edges: ReplicaSet->PodGroup and Service->PodGroup
	if len(gotEdges) != 2 {
		t.Fatalf("expected 2 edges after dedup, got %d", len(gotEdges))
	}

	edgeMap := make(map[string]bool)
	for _, e := range gotEdges {
		edgeMap[e.Source+"|"+e.Target] = true
	}
	if !edgeMap["ReplicaSet/default/web-rs|PodGroup/default/web-rs"] {
		t.Error("missing ReplicaSet -> PodGroup edge")
	}
	if !edgeMap["Service/default/web|PodGroup/default/web-rs"] {
		t.Error("missing Service -> PodGroup edge")
	}
}
