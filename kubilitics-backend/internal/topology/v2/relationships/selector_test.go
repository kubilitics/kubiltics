package relationships

import (
	"context"
	"testing"

	v2 "github.com/kubilitics/kubilitics-backend/internal/topology/v2"
	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestSelectorMatcher_Name(t *testing.T) {
	m := SelectorMatcher{}
	if m.Name() != "selector" {
		t.Errorf("expected name 'selector', got %q", m.Name())
	}
}

func TestSelectorMatcher_NilBundle(t *testing.T) {
	m := &SelectorMatcher{}
	edges, err := m.Match(context.Background(), nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if edges != nil {
		t.Errorf("expected nil edges for nil bundle, got %v", edges)
	}
}

func TestSelectorMatcher_EmptyBundle(t *testing.T) {
	m := &SelectorMatcher{}
	edges, err := m.Match(context.Background(), &v2.ResourceBundle{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(edges) != 0 {
		t.Errorf("expected 0 edges for empty bundle, got %d", len(edges))
	}
}

func TestSelectorMatcher_ServicePodMatch(t *testing.T) {
	svc := corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-svc",
			Namespace: "default",
		},
		Spec: corev1.ServiceSpec{
			Selector: map[string]string{
				"app": "myapp",
			},
		},
	}
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "myapp-pod-1",
			Namespace: "default",
			Labels: map[string]string{
				"app": "myapp",
			},
		},
	}

	bundle := &v2.ResourceBundle{
		Services: []corev1.Service{svc},
		Pods:     []corev1.Pod{pod},
	}

	m := &SelectorMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var found bool
	for _, e := range edges {
		if e.Source == v2.NodeID("Service", "default", "my-svc") &&
			e.Target == v2.NodeID("Pod", "default", "myapp-pod-1") &&
			e.RelationshipType == "selector" {
			found = true
		}
	}
	if !found {
		t.Error("expected Service→Pod selector edge")
	}
}

func TestSelectorMatcher_ServicePodNoMatch(t *testing.T) {
	svc := corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-svc",
			Namespace: "default",
		},
		Spec: corev1.ServiceSpec{
			Selector: map[string]string{
				"app": "myapp",
			},
		},
	}
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "other-pod",
			Namespace: "default",
			Labels: map[string]string{
				"app": "other",
			},
		},
	}

	bundle := &v2.ResourceBundle{
		Services: []corev1.Service{svc},
		Pods:     []corev1.Pod{pod},
	}

	m := &SelectorMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(edges) != 0 {
		t.Errorf("expected 0 edges for non-matching labels, got %d", len(edges))
	}
}

func TestSelectorMatcher_ServicePodDifferentNamespace(t *testing.T) {
	svc := corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-svc",
			Namespace: "ns-a",
		},
		Spec: corev1.ServiceSpec{
			Selector: map[string]string{"app": "myapp"},
		},
	}
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "myapp-pod",
			Namespace: "ns-b",
			Labels:    map[string]string{"app": "myapp"},
		},
	}

	bundle := &v2.ResourceBundle{
		Services: []corev1.Service{svc},
		Pods:     []corev1.Pod{pod},
	}

	m := &SelectorMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(edges) != 0 {
		t.Errorf("expected 0 edges for cross-namespace service selector, got %d", len(edges))
	}
}

func TestSelectorMatcher_PDBNilSelector_Skipped(t *testing.T) {
	// PDB with nil selector must be skipped (previously caused nil pointer dereference)
	pdb := policyv1.PodDisruptionBudget{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-pdb",
			Namespace: "default",
		},
		Spec: policyv1.PodDisruptionBudgetSpec{
			Selector: nil, // explicitly nil
		},
	}
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-pod",
			Namespace: "default",
			Labels:    map[string]string{"app": "myapp"},
		},
	}

	bundle := &v2.ResourceBundle{
		PDBs: []policyv1.PodDisruptionBudget{pdb},
		Pods: []corev1.Pod{pod},
	}

	m := &SelectorMatcher{}
	// Must not panic
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// No PDB→Pod edges expected since selector is nil
	for _, e := range edges {
		if e.Source == v2.NodeID("PodDisruptionBudget", "default", "my-pdb") {
			t.Errorf("expected no PDB edges with nil selector, got: %v", e)
		}
	}
}

func TestSelectorMatcher_PDBValidSelector(t *testing.T) {
	pdb := policyv1.PodDisruptionBudget{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-pdb",
			Namespace: "default",
		},
		Spec: policyv1.PodDisruptionBudgetSpec{
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{"app": "myapp"},
			},
		},
	}
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-pod",
			Namespace: "default",
			Labels:    map[string]string{"app": "myapp"},
		},
	}

	bundle := &v2.ResourceBundle{
		PDBs: []policyv1.PodDisruptionBudget{pdb},
		Pods: []corev1.Pod{pod},
	}

	m := &SelectorMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var found bool
	for _, e := range edges {
		if e.Source == v2.NodeID("PodDisruptionBudget", "default", "my-pdb") &&
			e.Target == v2.NodeID("Pod", "default", "my-pod") {
			found = true
		}
	}
	if !found {
		t.Error("expected PDB→Pod selector edge")
	}
}
