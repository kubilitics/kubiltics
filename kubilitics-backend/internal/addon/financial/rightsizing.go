package financial

import (
	"context"
	"fmt"
	"math"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// Rightsizer contains logic for generating resource adjustment recommendations.
// It combines real K8s pod resource requests with OpenCost allocation data to
// produce evidence-based rightsizing suggestions.
type Rightsizer struct {
	oc  *OpenCostClient
	k8s kubernetes.Interface
}

func NewRightsizer(oc *OpenCostClient, k8s kubernetes.Interface) *Rightsizer {
	return &Rightsizer{oc: oc, k8s: k8s}
}

// GetAddonRecommendations calculates rightsizing suggestions for an add-on.
//
// Data sources, in preference order:
//  1. K8s pod resource requests (actual values set in container specs) → currentCPU/currentMem.
//  2. OpenCost cpuCoreUsageAverage / ramByteUsageAverage → suggestedCPU/suggestedMem when available.
//  3. Cost-ratio heuristic (CPUCost vs expected at standard cloud pricing) as final fallback.
func (r *Rightsizer) GetAddonRecommendations(ctx context.Context, releaseName, namespace string) (*RightsizingRecommendation, error) {
	// 1. Fetch OpenCost allocation for the 7-day window.
	allocs, err := r.oc.QueryAllocation(ctx, "7d", "label:app.kubernetes.io/instance")
	if err != nil {
		return nil, err
	}
	if allocs == nil {
		return nil, nil // OpenCost unreachable
	}

	var match *OpenCostAllocation
	for i := range allocs {
		if allocs[i].Name == releaseName {
			match = &allocs[i]
			break
		}
	}
	if match == nil {
		return nil, nil // No allocation data for this release
	}

	// 2. Determine current resource requests from live K8s pod specs.
	//    We look up pods labelled app.kubernetes.io/instance=<releaseName> in the namespace.
	//    All containers' requests are summed — this represents what the addon actually
	//    asked for from the scheduler.
	currentCPU, currentMem, k8sOK := r.fetchPodRequests(ctx, releaseName, namespace)

	if !k8sOK {
		// Fall back to OpenCost request averages if the K8s lookup failed (e.g. RBAC).
		if match.CPUCoreRequestAvg > 0 || match.RAMByteRequestAvg > 0 {
			currentCPU = match.CPUCoreRequestAvg
			currentMem = match.RAMByteRequestAvg / (1024 * 1024) // bytes → MB
		} else {
			// Insufficient data to produce a useful recommendation.
			return nil, nil
		}
	}

	// 3. Determine suggested values.
	//    Priority: OpenCost usage averages (most accurate) → cost-ratio heuristic.
	var suggestedCPU, suggestedMem float64
	var confidence float64

	if match.CPUCoreUsageAvg > 0 {
		// OpenCost provides actual average CPU utilisation in cores: add 20% headroom.
		suggestedCPU = match.CPUCoreUsageAvg * 1.2
		confidence = 0.92
	} else {
		// Cost-ratio heuristic.
		// Standard on-demand approximate rate: $0.048 / vCPU-hour.
		// Over 7 days: expectedCPUCost = currentCPU × 0.048 × 24 × 7
		expectedCPUCost := currentCPU * 0.048 * 24 * 7
		if expectedCPUCost > 0 && match.CPUCost > 0 {
			utilRatio := match.CPUCost / expectedCPUCost
			suggestedCPU = currentCPU * utilRatio * 1.2
			confidence = 0.70
		} else {
			suggestedCPU = currentCPU
			confidence = 0.50
		}
	}
	// Clamp: at least 0.1 core, at most 2× current.
	suggestedCPU = math.Max(0.1, math.Min(suggestedCPU, currentCPU*2))

	if match.RAMByteUsageAvg > 0 {
		// OpenCost provides actual average RAM utilisation in bytes: add 20% headroom.
		suggestedMem = (match.RAMByteUsageAvg / (1024 * 1024)) * 1.2
	} else {
		// Cost-ratio heuristic.
		// Standard on-demand approximate rate: $0.006 / GB-hour.
		// Over 7 days: expectedMemCost = (currentMem / 1024) × 0.006 × 24 × 7
		expectedMemCost := (currentMem / 1024.0) * 0.006 * 24 * 7
		if expectedMemCost > 0 && match.MemoryCost > 0 {
			utilRatio := match.MemoryCost / expectedMemCost
			suggestedMem = currentMem * utilRatio * 1.2
		} else {
			suggestedMem = currentMem
		}
	}
	// Clamp: at least 64 MB, at most 2× current.
	suggestedMem = math.Max(64, math.Min(suggestedMem, currentMem*2))

	// 4. Estimate monthly savings / cost increase.
	savings := 0.0
	if suggestedCPU < currentCPU || suggestedMem < currentMem {
		savings = match.TotalCost * (1 - suggestedCPU/currentCPU) * 0.5
		if savings < 0 {
			savings = 0
		}
	}

	// 5. Build human-readable description.
	var description string
	switch {
	case suggestedCPU < currentCPU*0.9 && suggestedMem < currentMem*0.9:
		description = fmt.Sprintf(
			"Addon %s appears over-provisioned. Reducing CPU to %.2f cores and memory to %.0f MB could save an estimated $%.2f/mo.",
			releaseName, suggestedCPU, suggestedMem, savings)
	case suggestedCPU > currentCPU*1.1:
		description = fmt.Sprintf(
			"Addon %s is showing elevated CPU utilisation. Increasing the CPU request to %.2f cores is recommended for stability.",
			releaseName, suggestedCPU)
	case suggestedMem > currentMem*1.1:
		description = fmt.Sprintf(
			"Addon %s is showing elevated memory utilisation. Increasing the memory request to %.0f MB is recommended.",
			releaseName, suggestedMem)
	default:
		description = fmt.Sprintf(
			"Addon %s resource requests appear well-sized for the observed usage pattern (CPU: %.2f cores, Mem: %.0f MB).",
			releaseName, suggestedCPU, suggestedMem)
	}

	return &RightsizingRecommendation{
		ReleaseName:    releaseName,
		Namespace:      namespace,
		CurrentCPU:     currentCPU,
		CurrentMem:     currentMem,
		SuggestedCPU:   suggestedCPU,
		SuggestedMem:   suggestedMem,
		MonthlySavings: savings,
		Confidence:     confidence,
		Description:    description,
		GeneratedAt:    time.Now(),
	}, nil
}

// fetchPodRequests sums CPU (cores) and memory (MB) requests across all containers
// in pods labelled app.kubernetes.io/instance=releaseName within the given namespace.
// Returns (cpuCores, memMB, ok). ok is false when the K8s lookup fails or no pods are found.
func (r *Rightsizer) fetchPodRequests(ctx context.Context, releaseName, namespace string) (cpuCores float64, memMB float64, ok bool) {
	if r.k8s == nil {
		return 0, 0, false
	}
	pods, err := r.k8s.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: fmt.Sprintf("app.kubernetes.io/instance=%s", releaseName),
	})
	if err != nil || len(pods.Items) == 0 {
		return 0, 0, false
	}
	var totalMilliCPU int64
	var totalMemBytes int64
	for i := range pods.Items {
		for j := range pods.Items[i].Spec.Containers {
			totalMilliCPU += pods.Items[i].Spec.Containers[j].Resources.Requests.Cpu().MilliValue()
			totalMemBytes += pods.Items[i].Spec.Containers[j].Resources.Requests.Memory().Value()
		}
	}
	if totalMilliCPU == 0 && totalMemBytes == 0 {
		return 0, 0, false // No resource requests configured
	}
	return float64(totalMilliCPU) / 1000.0, float64(totalMemBytes) / (1024 * 1024), true
}
