package v2

import "testing"

func newTestResponse() *TopologyResponse {
	return &TopologyResponse{
		Metadata: TopologyMetadata{ClusterID: "test", Mode: ViewModeNamespace},
		Nodes: []TopologyNode{
			{ID: "Namespace/default", Kind: "Namespace", Name: "default"},
			{ID: "Namespace/kube-system", Kind: "Namespace", Name: "kube-system"},
			{ID: "Node/worker-1", Kind: "Node", Name: "worker-1"},
			{ID: "Deployment/default/app-a", Kind: "Deployment", Name: "app-a", Namespace: "default"},
			{ID: "Pod/default/app-a-pod-0", Kind: "Pod", Name: "app-a-pod-0", Namespace: "default"},
			{ID: "Service/default/svc-a", Kind: "Service", Name: "svc-a", Namespace: "default"},
			{ID: "ConfigMap/default/cm-a", Kind: "ConfigMap", Name: "cm-a", Namespace: "default"},
			{ID: "ServiceAccount/default/sa-a", Kind: "ServiceAccount", Name: "sa-a", Namespace: "default"},
			{ID: "Role/default/role-a", Kind: "Role", Name: "role-a", Namespace: "default"},
			{ID: "RoleBinding/default/rb-a", Kind: "RoleBinding", Name: "rb-a", Namespace: "default"},
			{ID: "Deployment/kube-system/coredns", Kind: "Deployment", Name: "coredns", Namespace: "kube-system"},
		},
		Edges: []TopologyEdge{
			{ID: "e1", Source: "Deployment/default/app-a", Target: "Pod/default/app-a-pod-0", RelationshipType: "ownerRef"},
			{ID: "e2", Source: "Service/default/svc-a", Target: "Pod/default/app-a-pod-0", RelationshipType: "selector"},
			{ID: "e3", Source: "Pod/default/app-a-pod-0", Target: "ConfigMap/default/cm-a", RelationshipType: "volume_mount"},
			{ID: "e4", Source: "Pod/default/app-a-pod-0", Target: "Node/worker-1", RelationshipType: "scheduling"},
			{ID: "e5", Source: "RoleBinding/default/rb-a", Target: "Role/default/role-a", RelationshipType: "role_binding"},
			{ID: "e6", Source: "ServiceAccount/default/sa-a", Target: "RoleBinding/default/rb-a", RelationshipType: "role_binding"},
		},
		Groups: []TopologyGroup{
			{ID: "group-ns-default", Label: "default", Type: "namespace", Members: []string{"Deployment/default/app-a", "Pod/default/app-a-pod-0"}},
		},
	}
}

func TestViewFilter_Cluster(t *testing.T) {
	resp := newTestResponse()
	filter := &ViewFilter{}
	result := filter.Filter(resp, Options{Mode: ViewModeCluster})
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	// Cluster mode shows: Namespace, Node, Deployment, StatefulSet, DaemonSet
	for _, n := range result.Nodes {
		switch n.Kind {
		case "Namespace", "Node", "Deployment", "StatefulSet", "DaemonSet":
			// OK
		default:
			t.Errorf("unexpected kind in cluster view: %s", n.Kind)
		}
	}
}

func TestViewFilter_Namespace(t *testing.T) {
	resp := newTestResponse()
	filter := &ViewFilter{}
	result := filter.Filter(resp, Options{Mode: ViewModeNamespace, Namespace: "default"})
	for _, n := range result.Nodes {
		if n.Namespace != "default" && n.Namespace != "" {
			t.Errorf("expected namespace default or cluster-scoped, got %s for %s", n.Namespace, n.ID)
		}
	}
}

func TestViewFilter_Resource(t *testing.T) {
	resp := newTestResponse()
	filter := &ViewFilter{}
	result := filter.Filter(resp, Options{
		Mode:     ViewModeResource,
		Resource: "Pod/default/app-a-pod-0",
		Depth:    1,
	})
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	// Should include the pod and its direct connections
	nodeIDs := make(map[string]bool)
	for _, n := range result.Nodes {
		nodeIDs[n.ID] = true
	}
	if !nodeIDs["Pod/default/app-a-pod-0"] {
		t.Error("missing focus node")
	}
	// At depth 1, should include direct neighbors
	if !nodeIDs["Deployment/default/app-a"] {
		t.Error("missing deployment connected to pod")
	}
	if !nodeIDs["Service/default/svc-a"] {
		t.Error("missing service connected to pod")
	}
}

func TestViewFilter_Resource_Depth2(t *testing.T) {
	resp := newTestResponse()
	filter := &ViewFilter{}
	result := filter.Filter(resp, Options{
		Mode:     ViewModeResource,
		Resource: "Pod/default/app-a-pod-0",
		Depth:    2,
	})
	nodeIDs := make(map[string]bool)
	for _, n := range result.Nodes {
		nodeIDs[n.ID] = true
	}
	// All directly and 2-hop connected resources
	if !nodeIDs["Pod/default/app-a-pod-0"] {
		t.Error("missing focus node")
	}
	if !nodeIDs["ConfigMap/default/cm-a"] {
		t.Error("missing configmap at depth 1")
	}
	if !nodeIDs["Node/worker-1"] {
		t.Error("missing node at depth 1")
	}
}

func TestViewFilter_RBAC(t *testing.T) {
	resp := newTestResponse()
	filter := &ViewFilter{}
	result := filter.Filter(resp, Options{Mode: ViewModeRBAC})
	for _, n := range result.Nodes {
		switch n.Kind {
		case "ServiceAccount", "Role", "RoleBinding", "ClusterRole", "ClusterRoleBinding":
			// OK
		default:
			t.Errorf("unexpected kind in RBAC view: %s", n.Kind)
		}
	}
}

func TestViewFilter_NilResponse(t *testing.T) {
	filter := &ViewFilter{}
	result := filter.Filter(nil, Options{Mode: ViewModeCluster})
	if result != nil {
		t.Error("expected nil result for nil input")
	}
}
