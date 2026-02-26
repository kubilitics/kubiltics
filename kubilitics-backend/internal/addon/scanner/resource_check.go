package scanner

import (
	"context"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type ResourceChecker struct{}

func (c *ResourceChecker) Run(ctx context.Context, input CheckInput) ([]models.PreflightCheck, error) {
	checks, _, _, err := c.RunWithArtifacts(ctx, input)
	return checks, err
}

func (c *ResourceChecker) RunWithArtifacts(ctx context.Context, input CheckInput) ([]models.PreflightCheck, *models.RBACDiff, []models.ResourceEstimate, error) {
	nodes, err := input.K8sClient.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, nil, nil, fmt.Errorf("list nodes: %w", err)
	}
	pods, err := input.K8sClient.CoreV1().Pods("").List(ctx, metav1.ListOptions{FieldSelector: "status.phase=Running"})
	if err != nil {
		return nil, nil, nil, fmt.Errorf("list running pods: %w", err)
	}

	var allocCPU, allocMem int64
	for i := range nodes.Items {
		if !isNodeReady(nodes.Items[i]) {
			continue
		}
		allocCPU += nodes.Items[i].Status.Allocatable.Cpu().MilliValue()
		allocMem += nodes.Items[i].Status.Allocatable.Memory().Value()
	}

	var reqCPU, reqMem int64
	for i := range pods.Items {
		for j := range pods.Items[i].Spec.Containers {
			reqCPU += pods.Items[i].Spec.Containers[j].Resources.Requests.Cpu().MilliValue()
			reqMem += pods.Items[i].Spec.Containers[j].Resources.Requests.Memory().Value()
		}
	}
	availCPU := allocCPU - reqCPU
	availMem := allocMem - reqMem

	cost := selectDevCostModel(input.AddonDetail.CostModels)
	if cost == nil {
		return []models.PreflightCheck{{
			Type:   models.CheckResourceHeadroom,
			Status: models.PreflightWARN,
			Title:  "Resource estimate unavailable",
			Detail: "No dev-tier resource estimate found for this add-on; capacity check is approximate.",
		}}, nil, nil, nil
	}

	warns := []models.PreflightCheck{}
	if availCPU < int64(cost.CPUMillicores*2) {
		warns = append(warns, models.PreflightCheck{
			Type:   models.CheckResourceHeadroom,
			Status: models.PreflightWARN,
			Title:  "Low CPU headroom",
			Detail: fmt.Sprintf("Cluster has %dm CPU available; add-on baseline needs ~%dm.", availCPU, cost.CPUMillicores),
		})
	}
	memNeedBytes := int64(cost.MemoryMB*2) * 1024 * 1024
	if availMem < memNeedBytes {
		warns = append(warns, models.PreflightCheck{
			Type:   models.CheckResourceHeadroom,
			Status: models.PreflightWARN,
			Title:  "Low memory headroom",
			Detail: fmt.Sprintf("Cluster has %dMi memory available; add-on baseline needs ~%dMi.", availMem/(1024*1024), cost.MemoryMB),
		})
	}

	estimate := models.ResourceEstimate{
		AddonID:        input.AddonDetail.ID,
		ReleaseName:    input.AddonDetail.Name,
		CPUMillicores:  cost.CPUMillicores,
		MemoryMB:       cost.MemoryMB,
		StorageGB:      cost.StorageGB,
		MonthlyCostUSD: cost.MonthlyCostUSDEstimate,
	}

	if len(warns) == 0 {
		return []models.PreflightCheck{{
			Type:   models.CheckResourceHeadroom,
			Status: models.PreflightGO,
			Title:  "Cluster headroom sufficient",
			Detail: fmt.Sprintf("Available capacity is sufficient for baseline add-on resources (%dm CPU, %dMi memory).", cost.CPUMillicores, cost.MemoryMB),
		}}, nil, []models.ResourceEstimate{estimate}, nil
	}
	return warns, nil, []models.ResourceEstimate{estimate}, nil
}

func isNodeReady(node corev1.Node) bool {
	for i := range node.Status.Conditions {
		if node.Status.Conditions[i].Type == corev1.NodeReady && node.Status.Conditions[i].Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}

func selectDevCostModel(modelsIn []models.AddOnCostModel) *models.AddOnCostModel {
	for i := range modelsIn {
		if modelsIn[i].ClusterTier == string(models.TierDev) {
			return &modelsIn[i]
		}
	}
	if len(modelsIn) > 0 {
		return &modelsIn[0]
	}
	return nil
}
