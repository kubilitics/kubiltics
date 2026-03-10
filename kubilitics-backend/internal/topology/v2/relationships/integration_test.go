package relationships

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

func TestMatchAll_WithFixture(t *testing.T) {
	bundle := v2.NewTestFixtureBundle()
	reg := NewDefaultRegistry()
	ctx := context.Background()
	edges, err := reg.MatchAll(ctx, bundle)
	if err != nil {
		t.Fatalf("MatchAll: %v", err)
	}

	// Minimum edges from fixture: RS->Deployment (3), Pod->RS (9), Service->Pod (many), Pod->Node (9), Pod->SA (9),
	// Pod->ConfigMap (9), Pod->Secret (3), HPA->Deployment (1), PDB->Pod (3), NP->Pod (3), RBAC (multiple),
	// Ingress->Service (1), Ingress->IngressClass (1), Endpoints, EndpointSlice, Storage (PVC->SC, PV->SC, PVC->PV),
	// Webhook->Service (2). So we expect a good number.
	if len(edges) < 30 {
		t.Errorf("expected at least 30 edges from fixture, got %d", len(edges))
	}

	edgeByID := make(map[string]v2.TopologyEdge)
	for _, e := range edges {
		edgeByID[e.ID] = e
	}

	// Key edges that must exist given the fixture (source -> target)
	checks := []struct {
		id       string
		source   string
		target   string
		relType  string
		category string
	}{
		{"ReplicaSet/default/app-a-rs|Deployment/default/app-a|ownerRef", "ReplicaSet/default/app-a-rs", "Deployment/default/app-a", "ownerRef", "ownership"},
		{"Pod/default/app-a-rs-pod-0|ReplicaSet/default/app-a-rs|ownerRef", "Pod/default/app-a-rs-pod-0", "ReplicaSet/default/app-a-rs", "ownerRef", "ownership"},
		{"Service/default/svc-a|Pod/default/app-a-rs-pod-0|selector", "Service/default/svc-a", "Pod/default/app-a-rs-pod-0", "selector", "networking"},
		{"Pod/default/app-a-rs-pod-0|Node/node-1|scheduling", "Pod/default/app-a-rs-pod-0", "Node/node-1", "scheduling", "scheduling"},
		{"HorizontalPodAutoscaler/default/hpa-a|Deployment/default/app-a|scaling", "HorizontalPodAutoscaler/default/hpa-a", "Deployment/default/app-a", "scaling", "scaling"},
		{"Ingress/default/ing|Service/default/svc-a|ingress_backend", "Ingress/default/ing", "Service/default/svc-a", "ingress_backend", "networking"},
		{"PersistentVolumeClaim/default/data-pvc|StorageClass/gp3|storage_class", "PersistentVolumeClaim/default/data-pvc", "StorageClass/gp3", "storage_class", "storage"},
		{"PersistentVolumeClaim/default/data-pvc|PersistentVolume/pv-1|bound_to", "PersistentVolumeClaim/default/data-pvc", "PersistentVolume/pv-1", "bound_to", "storage"},
	}
	for _, c := range checks {
		e, ok := edgeByID[c.id]
		if !ok {
			// Try to find by source+target
			found := false
			for _, e2 := range edges {
				if e2.Source == c.source && e2.Target == c.target {
					t.Logf("found edge by source/target: %s -> %s (id %s)", e2.Source, e2.Target, e2.ID)
					found = true
					break
				}
			}
			if !found {
				t.Errorf("missing expected edge: %s -> %s (relationshipType %s)", c.source, c.target, c.relType)
			}
			continue
		}
		if e.Source != c.source || e.Target != c.target {
			t.Errorf("edge %s: want source=%s target=%s, got source=%s target=%s", c.id, c.source, c.target, e.Source, e.Target)
		}
		if string(e.RelationshipType) != c.relType {
			t.Errorf("edge %s: want relationshipType=%s, got %s", c.id, c.relType, e.RelationshipType)
		}
		if e.RelationshipCategory != c.category {
			t.Errorf("edge %s: want category=%s, got %s", c.id, c.category, e.RelationshipCategory)
		}
	}
}

func TestMatchAll_Deterministic(t *testing.T) {
	bundle := v2.NewTestFixtureBundle()
	reg := NewDefaultRegistry()
	ctx := context.Background()
	edges1, _ := reg.MatchAll(ctx, bundle)
	edges2, _ := reg.MatchAll(ctx, bundle)
	if len(edges1) != len(edges2) {
		t.Errorf("determinism: first run %d edges, second run %d", len(edges1), len(edges2))
	}
	ids1 := make(map[string]bool)
	for _, e := range edges1 {
		ids1[e.ID] = true
	}
	for _, e := range edges2 {
		if !ids1[e.ID] {
			t.Errorf("determinism: edge %s in second run not in first", e.ID)
		}
	}
}
