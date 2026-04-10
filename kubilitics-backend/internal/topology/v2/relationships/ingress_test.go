package relationships

import (
	"context"
	"testing"

	v2 "github.com/kubilitics/kubilitics-backend/internal/topology/v2"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestIngressMatcher_Name(t *testing.T) {
	m := IngressMatcher{}
	if m.Name() != "ingress" {
		t.Errorf("expected name 'ingress', got %q", m.Name())
	}
}

func TestIngressMatcher_EmptyBundle(t *testing.T) {
	m := &IngressMatcher{}
	edges, err := m.Match(context.Background(), &v2.ResourceBundle{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(edges) != 0 {
		t.Errorf("expected 0 edges for empty bundle, got %d", len(edges))
	}
}

func TestIngressMatcher_NilBundle(t *testing.T) {
	m := &IngressMatcher{}
	edges, err := m.Match(context.Background(), nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if edges != nil {
		t.Errorf("expected nil edges for nil bundle, got %v", edges)
	}
}

func TestIngressMatcher_ValidIngressWithPortName(t *testing.T) {
	className := "nginx"
	pathType := networkingv1.PathTypePrefix
	portName := "http"
	ing := networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-ingress",
			Namespace: "default",
		},
		Spec: networkingv1.IngressSpec{
			IngressClassName: &className,
			Rules: []networkingv1.IngressRule{
				{
					Host: "example.com",
					IngressRuleValue: networkingv1.IngressRuleValue{
						HTTP: &networkingv1.HTTPIngressRuleValue{
							Paths: []networkingv1.HTTPIngressPath{
								{
									Path:     "/api",
									PathType: &pathType,
									Backend: networkingv1.IngressBackend{
										Service: &networkingv1.IngressServiceBackend{
											Name: "my-service",
											Port: networkingv1.ServiceBackendPort{
												Name: portName,
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}

	bundle := &v2.ResourceBundle{
		Ingresses: []networkingv1.Ingress{ing},
	}

	m := &IngressMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Expect: ingress_class edge + ingress_backend edge
	if len(edges) < 2 {
		t.Errorf("expected at least 2 edges (class + backend), got %d", len(edges))
	}

	var hasBackendEdge, hasClassEdge bool
	for _, e := range edges {
		if e.RelationshipType == "ingress_backend" {
			hasBackendEdge = true
		}
		if e.RelationshipType == "ingress_class" {
			hasClassEdge = true
		}
	}
	if !hasBackendEdge {
		t.Error("expected ingress_backend edge")
	}
	if !hasClassEdge {
		t.Error("expected ingress_class edge")
	}
}

func TestIngressMatcher_NilPortName_DoesNotPanic(t *testing.T) {
	// Port.Name is "" and Port.Number is 0 — should fall through to plain label
	pathType := networkingv1.PathTypePrefix
	ing := networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "nil-port-ingress",
			Namespace: "default",
		},
		Spec: networkingv1.IngressSpec{
			Rules: []networkingv1.IngressRule{
				{
					IngressRuleValue: networkingv1.IngressRuleValue{
						HTTP: &networkingv1.HTTPIngressRuleValue{
							Paths: []networkingv1.HTTPIngressPath{
								{
									Path:     "/",
									PathType: &pathType,
									Backend: networkingv1.IngressBackend{
										Service: &networkingv1.IngressServiceBackend{
											Name: "fallback-service",
											Port: networkingv1.ServiceBackendPort{
												// Both Name and Number are zero values
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}

	bundle := &v2.ResourceBundle{Ingresses: []networkingv1.Ingress{ing}}
	m := &IngressMatcher{}

	// Should not panic
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(edges) != 1 {
		t.Errorf("expected 1 edge (backend), got %d", len(edges))
	}
	if edges[0].RelationshipType != "ingress_backend" {
		t.Errorf("expected ingress_backend, got %q", edges[0].RelationshipType)
	}
}

func TestIngressMatcher_TLSSecret(t *testing.T) {
	ing := networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "tls-ingress",
			Namespace: "default",
		},
		Spec: networkingv1.IngressSpec{
			TLS: []networkingv1.IngressTLS{
				{
					Hosts:      []string{"example.com"},
					SecretName: "tls-secret",
				},
			},
		},
	}

	bundle := &v2.ResourceBundle{Ingresses: []networkingv1.Ingress{ing}}
	m := &IngressMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var hasTLSEdge bool
	for _, e := range edges {
		if e.RelationshipType == "ingress_tls" {
			hasTLSEdge = true
		}
	}
	if !hasTLSEdge {
		t.Error("expected ingress_tls edge for TLS secret")
	}
}
