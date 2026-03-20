package v2

// MockTopologyResponse returns a static TopologyResponse for the v2 API (Phase 0).
// Matches PRD section 11.2: 5 nodes, 4 edges, 1 group. Used until GraphBuilder is implemented.
func MockTopologyResponse(clusterID, clusterName string, mode ViewMode) *TopologyResponse {
	nodes := []TopologyNode{
		{ID: "Namespace/default", Kind: "Namespace", Name: "default", Namespace: "", APIVersion: "v1", Category: "cluster", Label: "default", Status: "healthy", StatusReason: "Active", Layer: 0, Labels: map[string]string{}, Annotations: map[string]string{}, CreatedAt: "2024-01-01T00:00:00Z"},
		{ID: "Deployment/default/nginx", Kind: "Deployment", Name: "nginx", Namespace: "default", APIVersion: "apps/v1", Category: "workload", Label: "nginx", Status: "healthy", StatusReason: "Active", Layer: 2, Group: "group-ns-default", Labels: map[string]string{"app": "nginx"}, Annotations: map[string]string{}, CreatedAt: "2024-01-01T00:00:00Z"},
		{ID: "Pod/default/nginx-abc", Kind: "Pod", Name: "nginx-abc", Namespace: "default", APIVersion: "v1", Category: "workload", Label: "nginx-abc", Status: "healthy", StatusReason: "Running", Layer: 4, Group: "group-ns-default", Labels: map[string]string{"app": "nginx"}, Annotations: map[string]string{}, CreatedAt: "2024-01-01T00:00:00Z"},
		{ID: "Service/default/nginx-svc", Kind: "Service", Name: "nginx-svc", Namespace: "default", APIVersion: "v1", Category: "networking", Label: "nginx-svc", Status: "healthy", StatusReason: "ClusterIP", Layer: 1, Group: "group-ns-default", Labels: map[string]string{}, Annotations: map[string]string{}, CreatedAt: "2024-01-01T00:00:00Z"},
		{ID: "Node/worker-1", Kind: "Node", Name: "worker-1", Namespace: "", APIVersion: "v1", Category: "cluster", Label: "worker-1", Status: "healthy", StatusReason: "Ready", Layer: 5, Labels: map[string]string{}, Annotations: map[string]string{}, CreatedAt: "2024-01-01T00:00:00Z"},
	}
	edges := []TopologyEdge{
		{ID: "e1", Source: "Deployment/default/nginx", Target: "Pod/default/nginx-abc", RelationshipType: "ownerRef", RelationshipCategory: "ownership", Label: "owned by", Detail: "Pod owned by ReplicaSet", Style: "solid", Healthy: true},
		{ID: "e2", Source: "Service/default/nginx-svc", Target: "Pod/default/nginx-abc", RelationshipType: "selector", RelationshipCategory: "networking", Label: "selects (app=nginx)", Detail: "Service selector matches Pod labels", Style: "dashed", Healthy: true},
		{ID: "e3", Source: "Pod/default/nginx-abc", Target: "Node/worker-1", RelationshipType: "scheduling", RelationshipCategory: "scheduling", Label: "runs on", Detail: "Pod scheduled on Node", Style: "dotted", Healthy: true},
		{ID: "e4", Source: "Pod/default/nginx-abc", Target: "Namespace/default", RelationshipType: "namespace", RelationshipCategory: "containment", Label: "belongs to", Detail: "Resource in namespace default", Style: "solid", Healthy: true},
	}
	groups := []TopologyGroup{
		{ID: "group-ns-default", Label: "default", Type: "namespace", Members: []string{"Deployment/default/nginx", "Pod/default/nginx-abc", "Service/default/nginx-svc"}, Collapsed: false, Style: GroupStyle{BackgroundColor: "#f1f5f9", BorderColor: "#94a3b8"}},
	}
	return &TopologyResponse{
		Metadata: TopologyMetadata{ClusterID: clusterID, ClusterName: clusterName, Mode: mode, ResourceCount: len(nodes), EdgeCount: len(edges), BuildTimeMs: 0},
		Nodes:    nodes,
		Edges:    edges,
		Groups:   groups,
	}
}
