package rest

import (
	"net/http"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	corev1 "k8s.io/api/core/v1"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// GetWorkloadsOverview handles GET /clusters/{clusterId}/workloads
// Returns workload pulse, workload list, and alerts for the Workloads page.
func (h *Handler) GetWorkloadsOverview(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}

	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	opts := metav1.ListOptions{Limit: 5000}

	// List workload controllers
	deployments, _ := client.ListResources(r.Context(), "deployments", "", opts)
	statefulsets, _ := client.ListResources(r.Context(), "statefulsets", "", opts)
	daemonsets, _ := client.ListResources(r.Context(), "daemonsets", "", opts)
	jobs, _ := client.ListResources(r.Context(), "jobs", "", opts)
	cronjobs, _ := client.ListResources(r.Context(), "cronjobs", "", opts)
	podsList, podErr := client.Clientset.CoreV1().Pods("").List(r.Context(), metav1.ListOptions{})
	var pods *corev1.PodList
	if podErr == nil {
		pods = podsList
	}

	// Events for alerts
	// Note: Events service still uses clusterID, but for Headlamp/Lens we'd need to update events service too
	events, _ := h.eventsService.ListEventsAllNamespaces(r.Context(), clusterID, 200)
	warnings := 0
	critical := 0
	var top3 []models.WorkloadAlert
	for _, e := range events {
		if e.Type == "Warning" {
			warnings++
			if len(top3) < 3 {
				resource := e.ResourceName
				if e.ResourceKind != "" {
					resource = e.ResourceKind + "/" + e.ResourceName
				}
				top3 = append(top3, models.WorkloadAlert{
					Reason:    e.Reason,
					Resource:  resource,
					Namespace: e.Namespace,
				})
			}
		} else if e.Type == "Error" || (e.Type != "Normal" && e.Type != "Warning") {
			critical++
		}
	}

	// Build workload items
	var workloads []models.WorkloadItem
	workloads = append(workloads, parseDeployments(deployments)...)
	workloads = append(workloads, parseStatefulSets(statefulsets)...)
	workloads = append(workloads, parseDaemonSets(daemonsets)...)
	workloads = append(workloads, parseJobs(jobs)...)
	workloads = append(workloads, parseCronJobs(cronjobs)...)

	// Compute pulse (include pod counts for richer total)
	pulse := computeWorkloadPulse(workloads, pods, warnings, critical)

	overview := models.WorkloadsOverview{
		Pulse:     pulse,
		Workloads: workloads,
		Alerts: models.WorkloadAlerts{
			Warnings: warnings,
			Critical: critical,
			Top3:     top3,
		},
	}

	respondJSON(w, http.StatusOK, overview)
}

func parseDeployments(list *unstructured.UnstructuredList) []models.WorkloadItem {
	if list == nil {
		return nil
	}
	var out []models.WorkloadItem
	for _, u := range list.Items {
		obj := u.Object
		status, _ := obj["status"].(map[string]interface{})
		meta, _ := obj["metadata"].(map[string]interface{})
		spec, _ := obj["spec"].(map[string]interface{})

		ready := int64(0)
		if r, ok := status["readyReplicas"].(int64); ok {
			ready = r
		}
		desired := int64(1)
		if r, ok := spec["replicas"].(int64); ok {
			desired = r
		}
		if r, ok := spec["replicas"].(int); ok {
			desired = int64(r)
		}

		statusStr := "Running"
		if ready < desired && desired > 0 {
			statusStr = "Pending"
		} else if desired == 0 {
			statusStr = "Scaled to Zero"
		}

		pressure := "Low"
		if ready < desired && desired > 0 {
			pressure = "Medium"
		}

		out = append(out, models.WorkloadItem{
			Kind:      "Deployment",
			Name:      getStr(meta, "name"),
			Namespace: getStr(meta, "namespace"),
			Status:    statusStr,
			Ready:     int(ready),
			Desired:   int(desired),
			Pressure:  pressure,
		})
	}
	return out
}

func parseStatefulSets(list *unstructured.UnstructuredList) []models.WorkloadItem {
	if list == nil {
		return nil
	}
	var out []models.WorkloadItem
	for _, u := range list.Items {
		obj := u.Object
		status, _ := obj["status"].(map[string]interface{})
		meta, _ := obj["metadata"].(map[string]interface{})
		spec, _ := obj["spec"].(map[string]interface{})

		ready := int64(0)
		if r, ok := status["readyReplicas"].(int64); ok {
			ready = r
		}
		desired := int64(1)
		if r, ok := spec["replicas"].(int64); ok {
			desired = r
		}
		if r, ok := spec["replicas"].(int); ok {
			desired = int64(r)
		}

		statusStr := "Healthy"
		if ready < desired && desired > 0 {
			statusStr = "Pending"
		}

		pressure := "Low"
		if ready < desired && desired > 0 {
			pressure = "Medium"
		}

		out = append(out, models.WorkloadItem{
			Kind:      "StatefulSet",
			Name:      getStr(meta, "name"),
			Namespace: getStr(meta, "namespace"),
			Status:    statusStr,
			Ready:     int(ready),
			Desired:   int(desired),
			Pressure:  pressure,
		})
	}
	return out
}

func parseDaemonSets(list *unstructured.UnstructuredList) []models.WorkloadItem {
	if list == nil {
		return nil
	}
	var out []models.WorkloadItem
	for _, u := range list.Items {
		obj := u.Object
		status, _ := obj["status"].(map[string]interface{})
		meta, _ := obj["metadata"].(map[string]interface{})

		ready := int64(0)
		if r, ok := status["numberReady"].(int64); ok {
			ready = r
		}
		desired := int64(0)
		if r, ok := status["desiredNumberScheduled"].(int64); ok {
			desired = r
		}

		statusStr := "Optimal"
		if ready < desired && desired > 0 {
			statusStr = "Pending"
		}

		pressure := "Low"
		if ready < desired && desired > 0 {
			pressure = "Medium"
		}

		out = append(out, models.WorkloadItem{
			Kind:      "DaemonSet",
			Name:      getStr(meta, "name"),
			Namespace: getStr(meta, "namespace"),
			Status:    statusStr,
			Ready:     int(ready),
			Desired:   int(desired),
			Pressure:  pressure,
		})
	}
	return out
}

func parseJobs(list *unstructured.UnstructuredList) []models.WorkloadItem {
	if list == nil {
		return nil
	}
	var out []models.WorkloadItem
	for _, u := range list.Items {
		obj := u.Object
		status, _ := obj["status"].(map[string]interface{})
		meta, _ := obj["metadata"].(map[string]interface{})
		spec, _ := obj["spec"].(map[string]interface{})

		succeeded := int64(0)
		if s, ok := status["succeeded"].(int64); ok {
			succeeded = s
		}
		failed := int64(0)
		if f, ok := status["failed"].(int64); ok {
			failed = f
		}
		active := int64(0)
		if a, ok := status["active"].(int64); ok {
			active = a
		}

		completions := int64(1)
		if c, ok := spec["completions"].(int64); ok {
			completions = c
		}
		if c, ok := spec["completions"].(int); ok {
			completions = int64(c)
		}

		statusStr := "Running"
		if succeeded >= completions {
			statusStr = "Completed"
		} else if failed > 0 {
			statusStr = "Failed"
		} else if active > 0 {
			statusStr = "Running"
		}

		pressure := "Zero"
		if active > 0 {
			pressure = "Low"
		}
		if failed > 0 {
			pressure = "High"
		}

		out = append(out, models.WorkloadItem{
			Kind:      "Job",
			Name:      getStr(meta, "name"),
			Namespace: getStr(meta, "namespace"),
			Status:    statusStr,
			Ready:     int(succeeded),
			Desired:   int(completions),
			Pressure:  pressure,
		})
	}
	return out
}

func parseCronJobs(list *unstructured.UnstructuredList) []models.WorkloadItem {
	if list == nil {
		return nil
	}
	var out []models.WorkloadItem
	for _, u := range list.Items {
		obj := u.Object
		status, _ := obj["status"].(map[string]interface{})
		meta, _ := obj["metadata"].(map[string]interface{})

		active := int64(0)
		if a, ok := status["active"].(int); ok {
			active = int64(a)
		}
		if a, ok := status["active"].(int64); ok {
			active = a
		}

		statusStr := "Scheduled"
		if active > 0 {
			statusStr = "Running"
		}

		pressure := "Zero"
		if active > 0 {
			pressure = "Low"
		}

		out = append(out, models.WorkloadItem{
			Kind:      "CronJob",
			Name:      getStr(meta, "name"),
			Namespace: getStr(meta, "namespace"),
			Status:    statusStr,
			Ready:     int(active),
			Desired:   0,
			Pressure:  pressure,
		})
	}
	return out
}

func getStr(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	v, ok := m[key].(string)
	if !ok {
		return ""
	}
	return v
}

func computeWorkloadPulse(workloads []models.WorkloadItem, pods *corev1.PodList, warnings, critical int) models.WorkloadPulse {
	// Workload controller counts
	wHealthy, wWarning, wCrit := 0, 0, 0
	for _, w := range workloads {
		switch w.Status {
		case "Running", "Healthy", "Optimal", "Completed", "Scheduled", "Scaled to Zero":
			wHealthy++
		case "Pending":
			wWarning++
		case "Failed":
			wCrit++
		default:
			wHealthy++
		}
	}

	// Pod counts
	pRunning, pPending, pFailed, pSucceeded := 0, 0, 0, 0
	if pods != nil {
		for _, p := range pods.Items {
			switch p.Status.Phase {
			case corev1.PodRunning:
				pRunning++
			case corev1.PodPending:
				pPending++
			case corev1.PodFailed, corev1.PodUnknown:
				pFailed++
			case corev1.PodSucceeded:
				pSucceeded++
			}
		}
	}

	total := len(workloads) + pRunning + pPending + pFailed + pSucceeded
	if total == 0 {
		total = 1
	}
	healthy := wHealthy + pRunning + pSucceeded
	warning := wWarning + pPending + warnings
	crit := wCrit + pFailed + critical

	optimalPct := float64(healthy) / float64(total) * 100
	if optimalPct > 100 {
		optimalPct = 100
	}

	return models.WorkloadPulse{
		Total:          total,
		Healthy:        healthy,
		Warning:        warning,
		Critical:       crit,
		OptimalPercent: optimalPct,
	}
}
