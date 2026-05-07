package rest

import (
	"context"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	corev1 "k8s.io/api/core/v1"

	"github.com/kubilitics/kubilitics-backend/internal/api/resilient"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// fromUnstructured converts an unstructured map into a typed K8s object.
func fromUnstructured(obj map[string]interface{}, out interface{}) error {
	return runtime.DefaultUnstructuredConverter.FromUnstructured(obj, out)
}

// GetWorkloadsOverview handles GET /clusters/{clusterId}/workloads
// Returns workload pulse, workload list, and alerts for the Workloads page.
//
// Perf: uses the informer cache (Headlamp/Lens model) for all list operations so
// the response is sub-millisecond on a warm cache. Falls back to live K8s API only
// when the informer hasn't synced yet (first few seconds after cluster connect).
func (h *Handler) GetWorkloadsOverview(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	cacheKey := func(r *http.Request) string { return clusterID }
	resilient.WrapClusterHandler(h.workloadsLRU, cacheKey, h.buildWorkloads)(w, r)
}

func (h *Handler) buildWorkloads(ctx context.Context, r *http.Request) (models.WorkloadsOverview, error) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]

	client, err := h.getClientFromRequest(ctx, r, clusterID, h.cfg)
	if err != nil {
		return models.WorkloadsOverview{}, err
	}

	opts := metav1.ListOptions{Limit: 5000}

	// Prefer informer cache — avoids 6 round-trips to the K8s API server.
	// On a healthy cluster this cuts latency from ~1.3s to <50ms.
	var (
		deployments  *unstructured.UnstructuredList
		statefulsets *unstructured.UnstructuredList
		daemonsets   *unstructured.UnstructuredList
		jobs         *unstructured.UnstructuredList
		cronjobs     *unstructured.UnstructuredList
	)
	if im := h.clusterService.GetInformerManager(clusterID); im != nil && im.HasSynced() {
		deployments, _ = im.ListFromCache("deployments", "", opts)
		statefulsets, _ = im.ListFromCache("statefulsets", "", opts)
		daemonsets, _ = im.ListFromCache("daemonsets", "", opts)
		jobs, _ = im.ListFromCache("jobs", "", opts)
		cronjobs, _ = im.ListFromCache("cronjobs", "", opts)
	}
	// Fall back to live API for any kind the informer didn't cover.
	if deployments == nil {
		if d, err := client.ListResources(r.Context(), "deployments", "", opts); err == nil {
			deployments = d
		}
	}
	if statefulsets == nil {
		if s, err := client.ListResources(r.Context(), "statefulsets", "", opts); err == nil {
			statefulsets = s
		}
	}
	if daemonsets == nil {
		if d, err := client.ListResources(r.Context(), "daemonsets", "", opts); err == nil {
			daemonsets = d
		}
	}
	if jobs == nil {
		if j, err := client.ListResources(r.Context(), "jobs", "", opts); err == nil {
			jobs = j
		}
	}
	if cronjobs == nil {
		if c, err := client.ListResources(r.Context(), "cronjobs", "", opts); err == nil {
			cronjobs = c
		}
	}

	// Pods: informer cache first, then live API.
	var pods *corev1.PodList
	if im := h.clusterService.GetInformerManager(clusterID); im != nil && im.HasSynced() {
		if cached, ok := im.ListFromCache("pods", "", opts); ok && cached != nil {
			pods = &corev1.PodList{}
			for _, u := range cached.Items {
				var p corev1.Pod
				if err2 := fromUnstructured(u.Object, &p); err2 == nil {
					pods.Items = append(pods.Items, p)
				}
			}
		}
	}
	if pods == nil {
		if podsList, podErr := client.Clientset.CoreV1().Pods("").List(r.Context(), metav1.ListOptions{}); podErr == nil {
			pods = podsList
		}
	}

	// Events for alerts — informer cache first (avoids 6 live API calls per request),
	// fall back to live service only when cache unavailable.
	dataPartial := false
	var events []*models.Event
	usedCache := false
	if im := h.clusterService.GetInformerManager(clusterID); im != nil && im.HasSynced() {
		if cached, ok := im.ListFromCache("events", "", metav1.ListOptions{Limit: 200}); ok {
			usedCache = true
			if cached != nil {
				for _, u := range cached.Items {
					var ev corev1.Event
					if err2 := fromUnstructured(u.Object, &ev); err2 == nil {
						events = append(events, k8sEventToWorkloadModel(&ev))
					}
				}
			}
		}
	}
	if !usedCache {
		var eventsErr error
		events, eventsErr = h.eventsService.ListEventsAllNamespaces(r.Context(), clusterID, 200)
		if eventsErr != nil {
			dataPartial = true
		}
	}
	eventWarnings := 0
	critical := 0
	var top3 []models.WorkloadAlert
	for _, e := range events {
		if e.Type == "Warning" {
			eventWarnings++
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

	// Build workload items and compute pod-level restart signals.
	restartsByController := buildRestartIndex(pods)

	var workloads []models.WorkloadItem
	workloads = append(workloads, parseDeployments(deployments)...)
	workloads = append(workloads, parseStatefulSets(statefulsets)...)
	workloads = append(workloads, parseDaemonSets(daemonsets)...)
	workloads = append(workloads, parseJobs(jobs)...)
	workloads = append(workloads, parseCronJobs(cronjobs)...)

	// Annotate workload items with restart pressure from pods.
	for i := range workloads {
		key := workloads[i].Namespace + "/" + workloads[i].Name
		if maxRestarts, ok := restartsByController[key]; ok && maxRestarts > 0 {
			if workloads[i].Pressure == "Low" && maxRestarts >= 5 {
				workloads[i].Pressure = "Medium"
			}
			workloads[i].MaxPodRestarts = maxRestarts
		}
	}

	// Compute pulse. Event warnings are surfaced separately from controller
	// warnings so callers can distinguish "K8s events fired" from
	// "replicas below desired". Previously both were summed into Warning,
	// producing misleading counts (e.g. Warning=8 despite all controllers
	// healthy). See pulse.event_warnings for the event-level signal.
	pulse := computeWorkloadPulse(workloads, pods, eventWarnings, critical)

	return models.WorkloadsOverview{
		Pulse:       pulse,
		Workloads:   workloads,
		DataPartial: dataPartial,
		Alerts: models.WorkloadAlerts{
			Warnings: eventWarnings,
			Critical: critical,
			Top3:     top3,
		},
	}, nil
}

// buildRestartIndex returns a map of "namespace/name" → max restart count for
// the pods owned by each Deployment/StatefulSet/DaemonSet controller. Only the
// first ownerReference is followed (direct owner, not grandparent deployment).
func buildRestartIndex(pods *corev1.PodList) map[string]int {
	out := make(map[string]int)
	if pods == nil {
		return out
	}
	for _, p := range pods.Items {
		restarts := 0
		for _, cs := range p.Status.ContainerStatuses {
			restarts += int(cs.RestartCount)
		}
		if restarts == 0 {
			continue
		}
		for _, ref := range p.OwnerReferences {
			key := p.Namespace + "/" + ref.Name
			if out[key] < restarts {
				out[key] = restarts
			}
		}
	}
	return out
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

// computeWorkloadPulse builds the health summary for the workloads page.
// eventWarnings is kept separate from controller-level warnings so callers
// can distinguish "K8s warning events fired" from "replicas below desired".
func computeWorkloadPulse(workloads []models.WorkloadItem, pods *corev1.PodList, eventWarnings, critical int) models.WorkloadPulse {
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
	// Controller + pod-level warnings only — event warnings excluded from this
	// count so the field truthfully represents workload degradation, not event noise.
	controllerWarning := wWarning + pPending
	crit := wCrit + pFailed + critical

	optimalPct := float64(healthy) / float64(total) * 100
	if optimalPct > 100 {
		optimalPct = 100
	}

	return models.WorkloadPulse{
		Total:          total,
		Healthy:        healthy,
		Warning:        controllerWarning,
		EventWarnings:  eventWarnings,
		Critical:       crit,
		OptimalPercent: optimalPct,
	}
}

// k8sEventToWorkloadModel converts a typed corev1.Event to models.Event for
// use in GetWorkloadsOverview. Mirrors the private k8sEventToModel in events_service.go.
func k8sEventToWorkloadModel(ev *corev1.Event) *models.Event {
	firstTS := ev.FirstTimestamp.Time
	lastTS := ev.LastTimestamp.Time
	if firstTS.IsZero() && !ev.EventTime.IsZero() {
		firstTS = ev.EventTime.Time
	}
	if firstTS.IsZero() && !ev.CreationTimestamp.IsZero() {
		firstTS = ev.CreationTimestamp.Time
	}
	if lastTS.IsZero() {
		lastTS = firstTS
	}
	if lastTS.IsZero() {
		lastTS = time.Now()
	}
	return &models.Event{
		ID:              string(ev.UID),
		Name:            ev.Name,
		EventNamespace:  ev.Namespace,
		Type:            ev.Type,
		Reason:          ev.Reason,
		Message:         ev.Message,
		ResourceKind:    ev.InvolvedObject.Kind,
		ResourceName:    ev.InvolvedObject.Name,
		Namespace:       ev.InvolvedObject.Namespace,
		FirstTimestamp:  firstTS,
		LastTimestamp:   lastTS,
		Count:           ev.Count,
		SourceComponent: ev.Source.Component,
	}
}
