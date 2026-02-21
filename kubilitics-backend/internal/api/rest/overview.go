package rest

import (
	"math"
	"net/http"

	"github.com/gorilla/mux"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// GetClusterOverview handles GET /clusters/{clusterId}/overview
// Returns health, counts, pod_status, alerts, and utilization for the dashboard.
func (h *Handler) GetClusterOverview(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}

	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	// Attempt to get from Hot Cache first (blazing fast)
	if overview, ok := h.clusterService.GetOverview(clusterID); ok {
		respondJSON(w, http.StatusOK, overview)
		return
	}

	// Fallback to manual API calls if cache not yet ready or cluster not registered
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	// getClientFromRequest returns client (from kubeconfig or stored cluster); build summary from it
	info, infoErr := client.GetClusterInfo(r.Context())
	if infoErr != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError, infoErr.Error(), requestID)
		return
	}
	pods, _ := client.Clientset.CoreV1().Pods("").List(r.Context(), metav1.ListOptions{})
	deployments, _ := client.Clientset.AppsV1().Deployments("").List(r.Context(), metav1.ListOptions{})
	services, _ := client.Clientset.CoreV1().Services("").List(r.Context(), metav1.ListOptions{})
	summary := &models.ClusterSummary{
		ID:              clusterID,
		Name:            clusterID,
		NodeCount:       info["node_count"].(int),
		NamespaceCount:  info["namespace_count"].(int),
		PodCount:        len(pods.Items),
		DeploymentCount: len(deployments.Items),
		ServiceCount:    len(services.Items),
		HealthStatus:    "healthy",
	}

	// Pod status
	pods, podErr := client.Clientset.CoreV1().Pods("").List(r.Context(), metav1.ListOptions{})
	if podErr != nil {
		pods = &corev1.PodList{}
	}
	ps := models.OverviewPodStatus{}
	for _, p := range pods.Items {
		phase := string(p.Status.Phase)
		switch phase {
		case "Running":
			ps.Running++
		case "Pending":
			ps.Pending++
		case "Succeeded":
			ps.Succeeded++
		case "Failed", "Unknown":
			ps.Failed++
		}
	}

	// Events: warnings and top 3
	// Note: Events service still uses resolvedID, but for Headlamp/Lens we'd need to update events service too
	// For now, we'll use clusterID as identifier (events service will need updating separately)
	events, _ := h.eventsService.ListEventsAllNamespaces(r.Context(), clusterID, 200)
	warnings := 0
	critical := 0
	var top3 []models.OverviewAlert
	for _, e := range events {
		if e.Type == "Warning" {
			warnings++
			if len(top3) < 3 {
				resource := e.ResourceName
				if e.ResourceKind != "" {
					resource = e.ResourceKind + "/" + e.ResourceName
				}
				top3 = append(top3, models.OverviewAlert{
					Reason:    e.Reason,
					Resource:  resource,
					Namespace: e.Namespace,
				})
			}
		} else if e.Type == "Error" || e.Type != "Normal" {
			critical++
		}
	}

	// Utilization (optional - Metrics Server may be unavailable)
	var util *models.OverviewUtilization
	if h.metricsService != nil {
		agg, err := h.metricsService.GetClusterUtilizationWithClient(r.Context(), client)
		if err == nil && (agg.CPUCapacityCores > 0 || agg.MemoryCapacityGiB > 0) {
			cpuPct := 0
			memPct := 0
			if agg.CPUCapacityCores > 0 {
				cpuPct = int((agg.CPUUsedCores / agg.CPUCapacityCores) * 100)
				if cpuPct > 100 {
					cpuPct = 100
				}
			}
			if agg.MemoryCapacityGiB > 0 {
				memPct = int((agg.MemoryUsedGiB / agg.MemoryCapacityGiB) * 100)
				if memPct > 100 {
					memPct = 100
				}
			}
			util = &models.OverviewUtilization{
				CPUPercent:    cpuPct,
				MemoryPercent: memPct,
				CPUCores:      round2(agg.CPUUsedCores),
				MemoryGiB:     round2(agg.MemoryUsedGiB),
			}
		}
	}

	// Health score (mirror frontend logic)
	health := computeHealth(summary, ps, warnings, critical, pods)

	overview := models.ClusterOverview{
		Health: health,
		Counts: models.OverviewCounts{
			Nodes:       summary.NodeCount,
			Pods:        summary.PodCount,
			Namespaces:  summary.NamespaceCount,
			Deployments: summary.DeploymentCount,
		},
		PodStatus: ps,
		Alerts: models.OverviewAlerts{
			Warnings: warnings,
			Critical: critical,
			Top3:     top3,
		},
		Utilization: util,
	}

	respondJSON(w, http.StatusOK, overview)
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func computeHealth(summary *models.ClusterSummary, ps models.OverviewPodStatus, warnings, critical int, pods *corev1.PodList) models.OverviewHealth {
	totalPods := ps.Running + ps.Pending + ps.Failed + ps.Succeeded
	if totalPods == 0 && summary.PodCount > 0 {
		totalPods = summary.PodCount
	}

	// Restart count
	restartCount := 0
	for _, p := range pods.Items {
		for _, cs := range p.Status.ContainerStatuses {
			restartCount += int(cs.RestartCount)
		}
	}

	// Pod health (40%)
	podsHealthy := ps.Running + ps.Succeeded
	podHealthRatio := 100.0
	if totalPods > 0 {
		podHealthRatio = float64(podsHealthy) / float64(totalPods) * 100
	}
	pendingPenalty := 0.0
	if totalPods > 0 && ps.Pending > 0 {
		pendingPenalty = float64(ps.Pending) / float64(totalPods) * 20
	}
	failedPenalty := 0.0
	if totalPods > 0 && ps.Failed > 0 {
		failedPenalty = float64(ps.Failed) / float64(totalPods) * 50
	}
	podHealth := math.Max(0, math.Min(100, podHealthRatio-pendingPenalty-failedPenalty))

	// Node health (30%) - assume 100% if we have nodes
	nodeHealth := 100.0
	if summary.NodeCount > 0 {
		nodeHealth = 100
	}

	// Stability (20%)
	stability := 100.0
	if restartCount > 0 {
		stability = math.Max(0, 100-float64(restartCount)*10)
	}

	// Event health (10%)
	eventHealth := 100.0
	eventHealth -= float64(warnings) * 2
	eventHealth -= float64(critical) * 10
	eventHealth = math.Max(0, eventHealth)

	score := int(math.Round(podHealth*0.4 + nodeHealth*0.3 + stability*0.2 + eventHealth*0.1))
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}

	var grade string
	var status string
	switch {
	case score >= 90:
		grade, status = "A", "excellent"
	case score >= 80:
		grade, status = "B", "good"
	case score >= 70:
		grade, status = "C", "fair"
	case score >= 60:
		grade, status = "D", "poor"
	default:
		grade, status = "F", "critical"
	}

	return models.OverviewHealth{Score: score, Grade: grade, Status: status}
}
