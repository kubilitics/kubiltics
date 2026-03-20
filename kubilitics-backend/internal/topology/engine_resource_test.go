package topology

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
)

// TestNormalizeResourceKind ensures API kinds (e.g. plural lowercase from frontend)
// map to canonical Kind so BuildResourceSubgraph supports all workload resource topologies.
func TestNormalizeResourceKind(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		// Workload kinds (frontend sends plural lowercase)
		{"pods", "Pod"},
		{"pod", "Pod"},
		{"deployments", "Deployment"},
		{"deployment", "Deployment"},
		{"replicasets", "ReplicaSet"},
		{"replicaset", "ReplicaSet"},
		{"statefulsets", "StatefulSet"},
		{"statefulset", "StatefulSet"},
		{"daemonsets", "DaemonSet"},
		{"daemonset", "DaemonSet"},
		{"jobs", "Job"},
		{"job", "Job"},
		{"cronjobs", "CronJob"},
		{"cronjob", "CronJob"},
		// Other common kinds
		{"services", "Service"},
		{"nodes", "Node"},
		{"configmaps", "ConfigMap"},
		{"secrets", "Secret"},
		{"ingresses", "Ingress"},
		// Passthrough for unknown
		{"unknown", "unknown"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := NormalizeResourceKind(tt.input)
			assert.Equal(t, tt.expected, got, "NormalizeResourceKind(%q)", tt.input)
		})
	}
}

// TestBuildResourceSubgraph_Service_NotImplemented ensures that requesting topology for kind "Service"
// never returns "not implemented". This regression test locks in Service (and networking) topology support.
func TestBuildResourceSubgraph_Service_NotImplemented(t *testing.T) {
	ctx := context.Background()
	ns, name := "default", "my-svc"
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns},
		Spec:       corev1.ServiceSpec{Selector: map[string]string{"app": "foo"}},
	}
	cs := fake.NewSimpleClientset(svc)
	client := k8s.NewClientForTest(cs)
	engine := NewEngine(client)

	_, err := engine.BuildResourceSubgraph(ctx, "Service", ns, name)
	if err != nil {
		require.NotContains(t, err.Error(), "not implemented", "Service topology must be implemented; got: %v", err)
	}
}

// TestBuildResourceSubgraph_NetworkingKinds_NotImplemented ensures that all networking kinds from
// design doc 3.1–3.6 are handled by BuildResourceSubgraph and never return "not implemented".
func TestBuildResourceSubgraph_NetworkingKinds_NotImplemented(t *testing.T) {
	ctx := context.Background()
	ns, name := "default", "res-name"
	cs := fake.NewSimpleClientset()
	client := k8s.NewClientForTest(cs)
	engine := NewEngine(client)

	kinds := []string{"Service", "Ingress", "IngressClass", "Endpoints", "EndpointSlice", "NetworkPolicy"}
	for _, kind := range kinds {
		t.Run(kind, func(t *testing.T) {
			_, err := engine.BuildResourceSubgraph(ctx, kind, ns, name)
			if err != nil {
				require.NotContains(t, err.Error(), "not implemented",
					"resource topology for %q must be implemented (design 3.1–3.6); got: %v", kind, err)
			}
		})
	}
}

// TestBuildResourceSubgraph_Node_NotImplemented ensures Node resource topology is implemented
// and never returns "resource topology not implemented for kind Node". Regression test for cluster-scoped topology.
func TestBuildResourceSubgraph_Node_NotImplemented(t *testing.T) {
	ctx := context.Background()
	nodeName := "test-node"
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: nodeName},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{Type: corev1.NodeReady, Status: corev1.ConditionTrue},
			},
		},
	}
	cs := fake.NewSimpleClientset(node)
	client := k8s.NewClientForTest(cs)
	engine := NewEngine(client)

	// Cluster-scoped: namespace is empty
	g, err := engine.BuildResourceSubgraph(ctx, "Node", "", nodeName)
	require.NoError(t, err)
	require.NotNil(t, g)
	require.NotEmpty(t, g.Nodes, "Node subgraph should contain at least the node")
}

// TestBuildResourceSubgraph_Node_NormalizedKind ensures "nodes" and "node" normalize to Node and are accepted.
func TestBuildResourceSubgraph_Node_NormalizedKind(t *testing.T) {
	ctx := context.Background()
	nodeName := "my-node"
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: nodeName},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{Type: corev1.NodeReady, Status: corev1.ConditionTrue},
			},
		},
	}
	cs := fake.NewSimpleClientset(node)
	client := k8s.NewClientForTest(cs)
	engine := NewEngine(client)

	for _, kind := range []string{"Node", "nodes", "node"} {
		t.Run(kind, func(t *testing.T) {
			_, err := engine.BuildResourceSubgraph(ctx, kind, "", nodeName)
			if err != nil {
				require.NotContains(t, err.Error(), "not implemented",
					"Node topology must be implemented for kind %q; got: %v", kind, err)
			}
		})
	}
}
