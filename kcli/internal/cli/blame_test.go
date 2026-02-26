package cli

import (
	"encoding/json"
	"testing"
)

func TestInferSource(t *testing.T) {
	tests := []struct {
		manager string
		want   string
	}{
		{"kubectl", "kubectl"},
		{"kubectl-client-side-apply", "kubectl"},
		{"helm", "Helm"},
		{"Helm", "Helm"},
		{"argo-cd", "ArgoCD"},
		{"argocd-application-controller", "ArgoCD"},
		{"flux", "Flux"},
		{"fluxcd", "Flux"},
		{"kube-controller-manager", "kube-controller-manager"},
		{"kubelet", "kubelet"},
		{"kube-scheduler", "kube-scheduler"},
		{"unknown-manager", "-"},
		{"", "-"},
	}
	for _, tt := range tests {
		t.Run(tt.manager, func(t *testing.T) {
			got := inferSource(tt.manager)
			if got != tt.want {
				t.Errorf("inferSource(%q) = %q, want %q", tt.manager, got, tt.want)
			}
		})
	}
}

func TestBlameResourceParsing(t *testing.T) {
	raw := `{
		"metadata": {
			"name": "payment-api",
			"namespace": "prod",
			"managedFields": [
				{"manager": "kubectl", "operation": "Update", "time": "2026-02-24T10:00:00Z"},
				{"manager": "helm", "operation": "Apply", "time": "2026-02-23T14:30:00Z"}
			]
		}
	}`
	var res blameResource
	if err := json.Unmarshal([]byte(raw), &res); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if res.Metadata.Name != "payment-api" {
		t.Errorf("name = %q, want payment-api", res.Metadata.Name)
	}
	if res.Metadata.Namespace != "prod" {
		t.Errorf("namespace = %q, want prod", res.Metadata.Namespace)
	}
	if len(res.Metadata.ManagedFields) != 2 {
		t.Fatalf("managedFields len = %d, want 2", len(res.Metadata.ManagedFields))
	}
	if res.Metadata.ManagedFields[0].Manager != "kubectl" || res.Metadata.ManagedFields[0].Operation != "Update" {
		t.Errorf("first entry = %+v", res.Metadata.ManagedFields[0])
	}
	if res.Metadata.ManagedFields[1].Manager != "helm" || res.Metadata.ManagedFields[1].Operation != "Apply" {
		t.Errorf("second entry = %+v", res.Metadata.ManagedFields[1])
	}
}
