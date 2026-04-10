package relationships

import (
	"context"
	"testing"

	v2 "github.com/kubilitics/kubilitics-backend/internal/topology/v2"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestCrossNamespaceDNSMatcher_Name(t *testing.T) {
	m := CrossNamespaceDNSMatcher{}
	if m.Name() != "cross_ns_dns" {
		t.Errorf("expected name 'cross_ns_dns', got %q", m.Name())
	}
}

func TestCrossNamespaceDNSMatcher_NilBundle(t *testing.T) {
	m := &CrossNamespaceDNSMatcher{}
	edges, err := m.Match(context.Background(), nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if edges != nil {
		t.Errorf("expected nil for nil bundle, got %v", edges)
	}
}

func TestCrossNamespaceDNSMatcher_EmptyBundle(t *testing.T) {
	m := &CrossNamespaceDNSMatcher{}
	edges, err := m.Match(context.Background(), &v2.ResourceBundle{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(edges) != 0 {
		t.Errorf("expected 0 edges for empty bundle, got %d", len(edges))
	}
}

func TestCrossNamespaceDNSMatcher_CrossNamespaceEnvVar(t *testing.T) {
	// Pod in "frontend" namespace references a service in "backend" namespace via FQDN
	svc := corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "db",
			Namespace: "backend",
		},
	}
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-pod",
			Namespace: "frontend",
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Name: "web",
					Env: []corev1.EnvVar{
						{
							Name:  "DB_HOST",
							Value: "db.backend.svc.cluster.local",
						},
					},
				},
			},
		},
	}

	bundle := &v2.ResourceBundle{
		Services: []corev1.Service{svc},
		Pods:     []corev1.Pod{pod},
	}

	m := &CrossNamespaceDNSMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(edges) != 1 {
		t.Fatalf("expected 1 cross-namespace DNS edge, got %d", len(edges))
	}
	e := edges[0]
	if e.RelationshipType != "cross_ns_dns" {
		t.Errorf("expected cross_ns_dns relationship, got %q", e.RelationshipType)
	}
	if e.Source != v2.NodeID("Pod", "frontend", "web-pod") {
		t.Errorf("unexpected source: %q", e.Source)
	}
	if e.Target != v2.NodeID("Service", "backend", "db") {
		t.Errorf("unexpected target: %q", e.Target)
	}
}

func TestCrossNamespaceDNSMatcher_SameNamespaceRef_NoEdge(t *testing.T) {
	// Pod and service in same namespace — should NOT create an edge
	svc := corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "db",
			Namespace: "default",
		},
	}
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-pod",
			Namespace: "default",
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Name: "web",
					Env: []corev1.EnvVar{
						{
							Name:  "DB_HOST",
							Value: "db.default.svc.cluster.local",
						},
					},
				},
			},
		},
	}

	bundle := &v2.ResourceBundle{
		Services: []corev1.Service{svc},
		Pods:     []corev1.Pod{pod},
	}

	m := &CrossNamespaceDNSMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(edges) != 0 {
		t.Errorf("expected 0 edges for same-namespace reference, got %d", len(edges))
	}
}

func TestCrossNamespaceDNSMatcher_WordBoundary_ShortNameNoFalseMatch(t *testing.T) {
	// Service named "db" in "backend" namespace.
	// Pod's env var contains "db-prod.backend.svc.cluster.local" — "db" is a prefix, NOT a match.
	svc := corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "db",
			Namespace: "backend",
		},
	}
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-pod",
			Namespace: "frontend",
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Name: "web",
					Env: []corev1.EnvVar{
						{
							Name:  "DB_HOST",
							Value: "db-prod.backend.svc.cluster.local",
						},
					},
				},
			},
		},
	}

	bundle := &v2.ResourceBundle{
		Services: []corev1.Service{svc},
		Pods:     []corev1.Pod{pod},
	}

	m := &CrossNamespaceDNSMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// "db" should NOT match "db-prod.backend..." because of word-boundary check
	if len(edges) != 0 {
		t.Errorf("expected 0 edges (word boundary: 'db' should not match 'db-prod'), got %d", len(edges))
	}
}

func TestCrossNamespaceDNSMatcher_ShortDNSForm(t *testing.T) {
	// Service can also be referenced with the shorter "svc-name.namespace" form
	svc := corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "cache",
			Namespace: "infra",
		},
	}
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "app-pod",
			Namespace: "frontend",
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Name: "app",
					Env: []corev1.EnvVar{
						{
							Name:  "CACHE_HOST",
							Value: "cache.infra",
						},
					},
				},
			},
		},
	}

	bundle := &v2.ResourceBundle{
		Services: []corev1.Service{svc},
		Pods:     []corev1.Pod{pod},
	}

	m := &CrossNamespaceDNSMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(edges) != 1 {
		t.Fatalf("expected 1 cross-namespace DNS edge for short form, got %d", len(edges))
	}
	if edges[0].Source != v2.NodeID("Pod", "frontend", "app-pod") {
		t.Errorf("unexpected source: %q", edges[0].Source)
	}
}

func TestCrossNamespaceDNSMatcher_NoDuplicateEdges(t *testing.T) {
	// Same DNS reference in multiple env vars should produce only 1 edge
	svc := corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "db",
			Namespace: "backend",
		},
	}
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-pod",
			Namespace: "frontend",
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Name: "web",
					Env: []corev1.EnvVar{
						{Name: "DB_HOST", Value: "db.backend.svc.cluster.local"},
						{Name: "DB_URL", Value: "postgres://db.backend.svc.cluster.local:5432/mydb"},
					},
				},
			},
		},
	}

	bundle := &v2.ResourceBundle{
		Services: []corev1.Service{svc},
		Pods:     []corev1.Pod{pod},
	}

	m := &CrossNamespaceDNSMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(edges) != 1 {
		t.Errorf("expected 1 deduplicated edge, got %d", len(edges))
	}
}
