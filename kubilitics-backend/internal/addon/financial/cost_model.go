package financial

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// EstimateInstallCost returns a cost estimate for installing the addon at the given tier.
// Uses catalog.CostModels; if tier not found, falls back to dev.
func EstimateInstallCost(catalog *models.AddOnDetail, tier models.ClusterTier) CostEstimate {
	out := CostEstimate{
		AddonID:     catalog.ID,
		ReleaseName: catalog.Name,
		ClusterTier: string(tier),
	}
	tierStr := string(tier)
	for _, cm := range catalog.CostModels {
		if cm.ClusterTier == tierStr {
			out.MonthlyCostUSD = cm.MonthlyCostUSDEstimate
			out.CPUMillicores = cm.CPUMillicores
			out.MemoryMB = cm.MemoryMB
			out.StorageGB = cm.StorageGB
			return out
		}
	}
	for _, cm := range catalog.CostModels {
		if cm.ClusterTier == string(models.TierDev) {
			out.MonthlyCostUSD = cm.MonthlyCostUSDEstimate
			out.CPUMillicores = cm.CPUMillicores
			out.MemoryMB = cm.MemoryMB
			out.StorageGB = cm.StorageGB
			return out
		}
	}
	return out
}

// EstimatePlanCost computes cost for each INSTALL step and the total delta.
// Skips steps with ActionSkip. Fetches catalog via repo for each step.
func EstimatePlanCost(ctx context.Context, plan *models.InstallPlan, repo repository.AddOnRepository, tier models.ClusterTier) (*PlanCostEstimate, error) {
	if plan == nil {
		return &PlanCostEstimate{}, nil
	}
	out := &PlanCostEstimate{Steps: make([]CostEstimate, 0, len(plan.Steps))}
	var total float64
	for _, step := range plan.Steps {
		if step.Action == models.ActionSkip {
			continue
		}
		if step.Action != models.ActionInstall {
			continue
		}
		catalog, err := repo.GetAddOn(ctx, step.AddonID)
		if err != nil {
			continue
		}
		est := EstimateInstallCost(catalog, tier)
		est.ReleaseName = step.ReleaseName
		out.Steps = append(out.Steps, est)
		total += est.MonthlyCostUSD
	}
	out.TotalMonthlyCostDeltaUSD = total
	return out, nil
}

// DetectClusterTier infers tier from node count: 1 = dev, 2–5 = staging, 6+ = production.
func DetectClusterTier(ctx context.Context, k8sClient kubernetes.Interface) models.ClusterTier {
	nodeList, err := k8sClient.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return models.TierDev
	}
	var ready int
	for _, n := range nodeList.Items {
		for _, c := range n.Status.Conditions {
			if c.Type == corev1.NodeReady && c.Status == corev1.ConditionTrue {
				ready++
				break
			}
		}
	}
	switch {
	case ready >= 6:
		return models.TierProduction
	case ready >= 2:
		return models.TierStaging
	default:
		return models.TierDev
	}
}
