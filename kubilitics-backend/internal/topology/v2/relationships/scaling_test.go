package relationships

import (
	"context"
	"testing"

	v2 "github.com/kubilitics/kubilitics-backend/internal/topology/v2"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestScalingMatcher_Name(t *testing.T) {
	m := ScalingMatcher{}
	if m.Name() != "scaling" {
		t.Errorf("expected name 'scaling', got %q", m.Name())
	}
}

func TestScalingMatcher_NilBundle(t *testing.T) {
	m := &ScalingMatcher{}
	edges, err := m.Match(context.Background(), nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if edges != nil {
		t.Errorf("expected nil edges for nil bundle, got %v", edges)
	}
}

func TestScalingMatcher_EmptyBundle(t *testing.T) {
	m := &ScalingMatcher{}
	edges, err := m.Match(context.Background(), &v2.ResourceBundle{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(edges) != 0 {
		t.Errorf("expected 0 edges for empty bundle, got %d", len(edges))
	}
}

func TestScalingMatcher_ValidHPATargetingDeployment(t *testing.T) {
	hpa := autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-hpa",
			Namespace: "default",
		},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{
				Kind: "Deployment",
				Name: "my-deployment",
			},
		},
	}

	bundle := &v2.ResourceBundle{
		HPAs: []autoscalingv2.HorizontalPodAutoscaler{hpa},
	}

	m := &ScalingMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(edges) != 1 {
		t.Fatalf("expected 1 edge, got %d", len(edges))
	}
	e := edges[0]
	if e.RelationshipType != "scaling" {
		t.Errorf("expected relationship type 'scaling', got %q", e.RelationshipType)
	}
	if e.Source != v2.NodeID("HorizontalPodAutoscaler", "default", "my-hpa") {
		t.Errorf("unexpected source: %q", e.Source)
	}
	if e.Target != v2.NodeID("Deployment", "default", "my-deployment") {
		t.Errorf("unexpected target: %q", e.Target)
	}
}

func TestScalingMatcher_ValidHPATargetingStatefulSet(t *testing.T) {
	hpa := autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "ss-hpa",
			Namespace: "prod",
		},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{
				Kind: "StatefulSet",
				Name: "my-statefulset",
			},
		},
	}

	bundle := &v2.ResourceBundle{
		HPAs: []autoscalingv2.HorizontalPodAutoscaler{hpa},
	}

	m := &ScalingMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(edges) != 1 {
		t.Fatalf("expected 1 edge, got %d", len(edges))
	}
	if edges[0].Target != v2.NodeID("StatefulSet", "prod", "my-statefulset") {
		t.Errorf("unexpected target: %q", edges[0].Target)
	}
}

func TestScalingMatcher_EmptyKindAndName_Skipped(t *testing.T) {
	// HPA with empty Kind and Name should be skipped (no panic)
	hpa := autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "bad-hpa",
			Namespace: "default",
		},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{
				Kind: "", // empty
				Name: "", // empty
			},
		},
	}

	bundle := &v2.ResourceBundle{
		HPAs: []autoscalingv2.HorizontalPodAutoscaler{hpa},
	}

	m := &ScalingMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(edges) != 0 {
		t.Errorf("expected 0 edges for empty Kind+Name, got %d", len(edges))
	}
}

func TestScalingMatcher_UnknownKind_Skipped(t *testing.T) {
	// HPA targeting an unsupported kind should produce no edge
	hpa := autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "unknown-hpa",
			Namespace: "default",
		},
		Spec: autoscalingv2.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{
				Kind: "CustomWorkload",
				Name: "my-custom",
			},
		},
	}

	bundle := &v2.ResourceBundle{
		HPAs: []autoscalingv2.HorizontalPodAutoscaler{hpa},
	}

	m := &ScalingMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(edges) != 0 {
		t.Errorf("expected 0 edges for unknown Kind, got %d", len(edges))
	}
}
