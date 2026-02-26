package resolver

import (
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func TestDetectDirectConflicts(t *testing.T) {
	g := NewDependencyGraph()
	g.AddNode(&GraphNode{AddonID: "a"})
	g.AddNode(&GraphNode{AddonID: "b"})

	catalog := map[string]*models.AddOnDetail{
		"a": {AddOnEntry: models.AddOnEntry{ID: "a"}, Conflicts: []models.AddOnConflict{{AddonID: "a", ConflictsWithID: "b"}}},
		"b": {AddOnEntry: models.AddOnEntry{ID: "b"}},
	}
	conflicts, err := DetectDirectConflicts(g, catalog)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(conflicts) != 1 {
		t.Fatalf("expected 1 conflict, got %d", len(conflicts))
	}
	if conflicts[0].Code != ErrConflict {
		t.Fatalf("expected conflict code, got %s", conflicts[0].Code)
	}
}

func TestDetectCRDConflicts(t *testing.T) {
	planNodes := []*GraphNode{{AddonID: "new-addon", IsInstalled: false}}
	installed := []models.AddOnInstallWithHealth{
		{AddOnInstall: models.AddOnInstall{AddonID: "installed-addon", Status: string(models.StatusInstalled)}},
	}
	catalog := map[string]*models.AddOnDetail{
		"installed-addon": {CRDsOwned: []models.AddOnCRDOwnership{{CRDGroup: "example.io", CRDResource: "widgets"}}},
		"new-addon":       {CRDsOwned: []models.AddOnCRDOwnership{{CRDGroup: "example.io", CRDResource: "widgets"}}},
	}

	conflicts, err := DetectCRDConflicts(planNodes, installed, catalog)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(conflicts) != 1 {
		t.Fatalf("expected 1 CRD conflict, got %d", len(conflicts))
	}
}
