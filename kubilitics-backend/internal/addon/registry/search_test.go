package registry

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func TestFilterByTags(t *testing.T) {
	entries := []models.AddOnEntry{
		{Name: "a", Tags: []string{"security"}},
		{Name: "b", Tags: []string{"observability"}},
	}
	out := FilterByTags(entries, []string{"security"})
	if len(out) != 1 || out[0].Name != "a" {
		t.Fatalf("unexpected tag filter result: %+v", out)
	}
}

func TestFilterByK8sVersion(t *testing.T) {
	entries := []models.AddOnEntry{
		{Name: "a", K8sCompatMin: "1.24", K8sCompatMax: "1.29"},
		{Name: "b", K8sCompatMin: "1.30"},
	}
	out := FilterByK8sVersion(entries, "1.27.1")
	if len(out) != 1 || out[0].Name != "a" {
		t.Fatalf("unexpected k8s filter result: %+v", out)
	}
}

func TestRankAndFilter(t *testing.T) {
	entries := []models.AddOnEntry{
		{Name: "cert-manager", DisplayName: "Cert Manager", Description: "certificates"},
		{Name: "opencost", DisplayName: "OpenCost", Description: "cost"},
	}
	out := RankAndFilter(entries, "cert")
	if len(out) != 1 || out[0].Name != "cert-manager" {
		t.Fatalf("unexpected search rank result: %+v", out)
	}
}
