package resolver

import (
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func DetectDirectConflicts(g *DependencyGraph, catalog map[string]*models.AddOnDetail) ([]ResolutionError, error) {
	if g == nil {
		return nil, fmt.Errorf("dependency graph is required")
	}
	conflicts := make([]ResolutionError, 0)
	seen := make(map[string]struct{})

	for nodeID := range g.nodes {
		detail, ok := catalog[nodeID]
		if !ok || detail == nil {
			continue
		}
		for i := range detail.Conflicts {
			other := detail.Conflicts[i].ConflictsWithID
			if other == "" {
				continue
			}
			if _, inGraph := g.nodes[other]; !inGraph {
				continue
			}
			key := nodeID + "|" + other
			reverseKey := other + "|" + nodeID
			if _, exists := seen[key]; exists {
				continue
			}
			if _, exists := seen[reverseKey]; exists {
				continue
			}
			seen[key] = struct{}{}
			conflicts = append(conflicts, ResolutionError{
				Code:               ErrConflict,
				Message:            fmt.Sprintf("add-on %s conflicts with %s", nodeID, other),
				AddonID:            nodeID,
				ConflictingAddonID: other,
			})
		}
	}

	return conflicts, nil
}

func DetectCRDConflicts(planNodes []*GraphNode, installedAddons []models.AddOnInstallWithHealth, catalog map[string]*models.AddOnDetail) ([]ResolutionError, error) {
	installedByID := make(map[string]models.AddOnInstallWithHealth, len(installedAddons))
	for i := range installedAddons {
		installedByID[installedAddons[i].AddonID] = installedAddons[i]
	}

	planSet := make(map[string]struct{}, len(planNodes))
	for i := range planNodes {
		planSet[planNodes[i].AddonID] = struct{}{}
	}

	crdOwner := make(map[string]string)
	for addonID, install := range installedByID {
		if install.Status != string(models.StatusInstalled) && install.Status != string(models.StatusUpgrading) {
			continue
		}
		detail, ok := catalog[addonID]
		if !ok || detail == nil {
			continue
		}
		for i := range detail.CRDsOwned {
			name := crdResourceName(detail.CRDsOwned[i])
			if name == "" {
				continue
			}
			crdOwner[name] = addonID
		}
	}

	conflicts := make([]ResolutionError, 0)
	for i := range planNodes {
		node := planNodes[i]
		if node == nil || node.IsInstalled {
			continue
		}
		detail, ok := catalog[node.AddonID]
		if !ok || detail == nil {
			continue
		}
		for j := range detail.CRDsOwned {
			name := crdResourceName(detail.CRDsOwned[j])
			if name == "" {
				continue
			}
			owner, found := crdOwner[name]
			if !found {
				continue
			}
			if owner == node.AddonID {
				continue
			}
			if _, ownerInPlan := planSet[owner]; ownerInPlan {
				continue
			}
			conflicts = append(conflicts, ResolutionError{
				Code:               ErrConflict,
				Message:            fmt.Sprintf("CRD %s is currently owned by installed addon %s", name, owner),
				AddonID:            node.AddonID,
				ConflictingAddonID: owner,
			})
		}
	}

	return conflicts, nil
}

func crdResourceName(crd models.AddOnCRDOwnership) string {
	if crd.CRDResource == "" || crd.CRDGroup == "" {
		return ""
	}
	return crd.CRDResource + "." + crd.CRDGroup
}
