package resolver

import (
	"fmt"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func BuildInstallPlan(
	g *DependencyGraph,
	sortedIDs []string,
	installedMap map[string]*models.AddOnInstallWithHealth,
	catalog map[string]*models.AddOnDetail,
) *models.InstallPlan {
	plan := &models.InstallPlan{
		Steps:           make([]models.InstallStep, 0, len(sortedIDs)),
		ConflictReasons: []string{},
		GeneratedAt:     time.Now().UTC(),
	}

	for _, id := range sortedIDs {
		node, ok := g.GetNode(id)
		if !ok {
			continue
		}
		detail, ok := catalog[id]
		if !ok || detail == nil {
			continue
		}

		step := models.InstallStep{
			AddonID:         id,
			AddonName:       detail.Name,
			Namespace:       "default",
			ReleaseName:     detail.Name,
			ToVersion:       detail.Version,
			IsRequired:      node.IsRequired,
			DependencyDepth: node.Depth,
		}

		if existing, isInstalled := installedMap[id]; isInstalled && existing != nil {
			step.FromVersion = existing.InstalledVersion
			okConstraint, err := evaluateNodeConstraint(g, id, existing.InstalledVersion)
			if err == nil && okConstraint && CompareVersions(existing.InstalledVersion, detail.Version) >= 0 {
				step.Action = models.ActionSkip
				step.Reason = fmt.Sprintf("already installed at compatible version %s", existing.InstalledVersion)
			} else {
				step.Action = models.ActionUpgrade
				step.Reason = fmt.Sprintf("installed version %s requires upgrade to %s", existing.InstalledVersion, detail.Version)
				step.EstimatedDurationSec = 120
			}
		} else {
			step.Action = models.ActionInstall
			step.Reason = fmt.Sprintf("dependency/install target for %s", id)
			step.EstimatedDurationSec = 60
			if cost, ok := devCost(detail); ok {
				step.EstimatedCostDeltaUSD = cost.MonthlyCostUSDEstimate
			}
		}

		plan.TotalEstimatedDurationSec += step.EstimatedDurationSec
		plan.TotalEstimatedCostDeltaUSD += step.EstimatedCostDeltaUSD
		plan.Steps = append(plan.Steps, step)
	}

	conflicts, _ := DetectDirectConflicts(g, catalog)
	if len(conflicts) > 0 {
		plan.HasConflicts = true
		for i := range conflicts {
			plan.ConflictReasons = append(plan.ConflictReasons, conflicts[i].Message)
		}
	}

	return plan
}

func evaluateNodeConstraint(g *DependencyGraph, nodeID, version string) (bool, error) {
	for i := range g.edges {
		if g.edges[i].ToID != nodeID || g.edges[i].VersionConstraint == "" {
			continue
		}
		ok, err := VersionSatisfies(version, g.edges[i].VersionConstraint)
		if err != nil {
			return false, err
		}
		if !ok {
			return false, nil
		}
	}
	return true, nil
}

func devCost(detail *models.AddOnDetail) (models.AddOnCostModel, bool) {
	for i := range detail.CostModels {
		if detail.CostModels[i].ClusterTier == string(models.TierDev) {
			return detail.CostModels[i], true
		}
	}
	if len(detail.CostModels) > 0 {
		return detail.CostModels[0], true
	}
	return models.AddOnCostModel{}, false
}
