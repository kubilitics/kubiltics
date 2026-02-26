package resolver

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func TestBuildInstallPlanActions(t *testing.T) {
	g := NewDependencyGraph()
	g.AddNode(&GraphNode{AddonID: "dep", Version: "1.0.0", Depth: 1, IsRequired: true})
	g.AddNode(&GraphNode{AddonID: "root", Version: "2.0.0", Depth: 0, IsRequired: true})
	g.AddEdge(GraphEdge{FromID: "root", ToID: "dep", VersionConstraint: ">=1.0.0"})

	catalog := map[string]*models.AddOnDetail{
		"dep": {
			AddOnEntry: models.AddOnEntry{
				ID:      "dep",
				Name:    "dep",
				Version: "1.0.0",
			},
			CostModels: []models.AddOnCostModel{{ClusterTier: string(models.TierDev), MonthlyCostUSDEstimate: 2}},
		},
		"root": {
			AddOnEntry: models.AddOnEntry{
				ID:      "root",
				Name:    "root",
				Version: "2.0.0",
			},
		},
	}
	installed := map[string]*models.AddOnInstallWithHealth{
		"root": {AddOnInstall: models.AddOnInstall{InstalledVersion: "1.0.0"}},
	}

	plan := BuildInstallPlan(g, []string{"dep", "root"}, installed, catalog)
	if len(plan.Steps) != 2 {
		t.Fatalf("expected 2 steps, got %d", len(plan.Steps))
	}
	if plan.Steps[0].Action != models.ActionInstall {
		t.Fatalf("expected dep install, got %s", plan.Steps[0].Action)
	}
	if plan.Steps[1].Action != models.ActionUpgrade {
		t.Fatalf("expected root upgrade, got %s", plan.Steps[1].Action)
	}
	if plan.TotalEstimatedDurationSec != 180 {
		t.Fatalf("unexpected total duration: %d", plan.TotalEstimatedDurationSec)
	}
}
