package service

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"

	corev1 "k8s.io/api/core/v1"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// maxListenersPerCluster is the upper bound on concurrent overview stream
// subscribers for a single cluster. Prevents unbounded memory growth from
// leaked or malicious connections.
const maxListenersPerCluster = 500

// OverviewCache manages real-time dashboard data for clusters using Informers.
type OverviewCache struct {
	mu        sync.RWMutex
	overviews map[string]*models.ClusterOverview
	informers map[string]*k8s.InformerManager
	stopChs   map[string]chan struct{}
	listeners map[string]map[chan *models.ClusterOverview]struct{}
	// podPhases tracks per-pod phase for O(1) incremental status updates.
	// Key: clusterID, Value: map[podUID]corev1.PodPhase
	podPhases map[string]map[string]corev1.PodPhase
}

func NewOverviewCache() *OverviewCache {
	return &OverviewCache{
		overviews: make(map[string]*models.ClusterOverview),
		informers: make(map[string]*k8s.InformerManager),
		stopChs:   make(map[string]chan struct{}),
		listeners: make(map[string]map[chan *models.ClusterOverview]struct{}),
		podPhases: make(map[string]map[string]corev1.PodPhase),
	}
}

// GetOverview returns the cached overview for a cluster.
func (c *OverviewCache) GetOverview(clusterID string) (*models.ClusterOverview, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	ov, ok := c.overviews[clusterID]
	return ov, ok
}

// StartClusterCache initializes and starts informers for a cluster.
func (c *OverviewCache) StartClusterCache(ctx context.Context, clusterID string, client *k8s.Client) error {
	c.mu.Lock()
	if _, exists := c.informers[clusterID]; exists {
		c.mu.Unlock()
		return nil // Already running
	}

	im := k8s.NewInformerManager(client)
	c.informers[clusterID] = im

	overview := &models.ClusterOverview{
		Health:    models.OverviewHealth{Score: 100, Grade: "A", Status: "excellent"},
		Counts:    models.OverviewCounts{},
		PodStatus: models.OverviewPodStatus{},
		Alerts:    models.OverviewAlerts{Top3: []models.OverviewAlert{}},
	}
	c.overviews[clusterID] = overview
	c.podPhases[clusterID] = make(map[string]corev1.PodPhase)
	c.mu.Unlock()

	// Register handlers for real-time updates
	im.RegisterHandler("Pod", func(eventType string, obj interface{}) {
		c.updatePodStatus(clusterID, eventType, obj)
		c.notifyStream(clusterID)
	})
	im.RegisterHandler("Node", func(eventType string, obj interface{}) {
		c.updateNodeCount(clusterID, eventType, obj)
		c.notifyStream(clusterID)
	})
	im.RegisterHandler("Namespace", func(eventType string, obj interface{}) {
		c.updateNamespaceCount(clusterID, eventType, obj)
		c.notifyStream(clusterID)
	})
	im.RegisterHandler("Deployment", func(eventType string, obj interface{}) {
		c.updateDeploymentCount(clusterID, eventType, obj)
		c.notifyStream(clusterID)
	})
	im.RegisterHandler("Event", func(eventType string, obj interface{}) {
		c.updateAlerts(clusterID, eventType, obj)
		c.notifyStream(clusterID)
	})

	// Start Informers in background
	go func() {
		if err := im.Start(ctx); err != nil {
			fmt.Printf("Error starting informers for cluster %s: %v\n", clusterID, err)
		}
	}()

	return nil
}

// StopClusterCache stops informers for a cluster.
func (c *OverviewCache) StopClusterCache(clusterID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if im, exists := c.informers[clusterID]; exists {
		im.Stop()
		delete(c.informers, clusterID)
		delete(c.overviews, clusterID)
		delete(c.podPhases, clusterID)
	}
}

func (c *OverviewCache) notifyStream(clusterID string) {
	c.mu.RLock()
	ov := c.overviews[clusterID]
	listeners := c.listeners[clusterID]
	if ov == nil || len(listeners) == 0 {
		c.mu.RUnlock()
		return
	}
	// Deep-copy the overview under the lock to avoid sending a shared pointer
	// that may be concurrently modified by another informer event handler.
	snapshot := &models.ClusterOverview{
		Health:    ov.Health,
		Counts:    ov.Counts,
		PodStatus: ov.PodStatus,
		Alerts: models.OverviewAlerts{
			Warnings: ov.Alerts.Warnings,
			Critical: ov.Alerts.Critical,
			Top3:     make([]models.OverviewAlert, len(ov.Alerts.Top3)),
		},
	}
	copy(snapshot.Alerts.Top3, ov.Alerts.Top3)
	if ov.Utilization != nil {
		u := *ov.Utilization
		snapshot.Utilization = &u
	}
	c.mu.RUnlock()

	for ch := range listeners {
		select {
		case ch <- snapshot:
		default:
			log.Printf("overview cache: dropped notification for cluster %s (listener channel full)", clusterID)
		}
	}
}

// ErrTooManyListeners is returned when a cluster has reached the max listener limit.
var ErrTooManyListeners = errors.New("too many overview stream listeners for this cluster")

// Subscribe returns a channel that receives overview updates for a cluster.
// Returns ErrTooManyListeners if the per-cluster listener limit is reached.
func (c *OverviewCache) Subscribe(clusterID string) (chan *models.ClusterOverview, func(), error) {
	ch := make(chan *models.ClusterOverview, 10)

	c.mu.Lock()
	if c.listeners[clusterID] == nil {
		c.listeners[clusterID] = make(map[chan *models.ClusterOverview]struct{})
	}
	if len(c.listeners[clusterID]) >= maxListenersPerCluster {
		c.mu.Unlock()
		log.Printf("overview cache: listener limit reached for cluster %s (%d)", clusterID, maxListenersPerCluster)
		return nil, nil, ErrTooManyListeners
	}
	c.listeners[clusterID][ch] = struct{}{}
	c.mu.Unlock()

	// Initial push
	if ov, ok := c.GetOverview(clusterID); ok {
		ch <- ov
	}

	unsubscribe := func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		if _, exists := c.listeners[clusterID][ch]; exists {
			delete(c.listeners[clusterID], ch)
			close(ch)
		}
	}

	return ch, unsubscribe, nil
}

// decrementPhaseCounter decrements the counter for the given phase.
func decrementPhaseCounter(ps *models.OverviewPodStatus, phase corev1.PodPhase) {
	switch phase {
	case corev1.PodRunning:
		if ps.Running > 0 {
			ps.Running--
		}
	case corev1.PodPending:
		if ps.Pending > 0 {
			ps.Pending--
		}
	case corev1.PodSucceeded:
		if ps.Succeeded > 0 {
			ps.Succeeded--
		}
	case corev1.PodFailed, corev1.PodUnknown:
		if ps.Failed > 0 {
			ps.Failed--
		}
	}
}

// incrementPhaseCounter increments the counter for the given phase.
func incrementPhaseCounter(ps *models.OverviewPodStatus, phase corev1.PodPhase) {
	switch phase {
	case corev1.PodRunning:
		ps.Running++
	case corev1.PodPending:
		ps.Pending++
	case corev1.PodSucceeded:
		ps.Succeeded++
	case corev1.PodFailed, corev1.PodUnknown:
		ps.Failed++
	}
}

// updatePodStatus performs O(1) incremental pod status updates using per-pod phase tracking.
// Instead of re-listing all pods on every event, it tracks each pod's last known phase
// and adjusts counters incrementally.
func (c *OverviewCache) updatePodStatus(clusterID string, eventType string, obj interface{}) {
	c.mu.Lock()
	defer c.mu.Unlock()

	ov, ok := c.overviews[clusterID]
	if !ok {
		return
	}

	pod, ok := obj.(*corev1.Pod)
	if !ok {
		return
	}

	phases := c.podPhases[clusterID]
	if phases == nil {
		phases = make(map[string]corev1.PodPhase)
		c.podPhases[clusterID] = phases
	}

	uid := string(pod.UID)
	newPhase := pod.Status.Phase

	// Track total restart count from container statuses
	podRestarts := 0
	for _, cs := range pod.Status.ContainerStatuses {
		podRestarts += int(cs.RestartCount)
	}
	for _, cs := range pod.Status.InitContainerStatuses {
		podRestarts += int(cs.RestartCount)
	}

	switch eventType {
	case "ADDED":
		if _, exists := phases[uid]; !exists {
			incrementPhaseCounter(&ov.PodStatus, newPhase)
			phases[uid] = newPhase
			ov.Counts.Pods++
			ov.PodStatus.TotalRestarts += podRestarts
		}
	case "MODIFIED":
		if oldPhase, exists := phases[uid]; exists {
			if oldPhase != newPhase {
				decrementPhaseCounter(&ov.PodStatus, oldPhase)
				incrementPhaseCounter(&ov.PodStatus, newPhase)
				phases[uid] = newPhase
			}
		} else {
			// Pod not tracked yet (missed ADDED event); treat as add
			incrementPhaseCounter(&ov.PodStatus, newPhase)
			phases[uid] = newPhase
			ov.Counts.Pods++
		}
		// Recalculate total restarts from all tracked pods would be expensive;
		// instead, on MODIFIED we re-list total from store for accuracy.
		c.recalculateTotalRestarts(clusterID, ov)
	case "DELETED":
		if oldPhase, exists := phases[uid]; exists {
			decrementPhaseCounter(&ov.PodStatus, oldPhase)
			delete(phases, uid)
			ov.Counts.Pods--
			if ov.Counts.Pods < 0 {
				ov.Counts.Pods = 0
			}
			ov.PodStatus.TotalRestarts -= podRestarts
			if ov.PodStatus.TotalRestarts < 0 {
				ov.PodStatus.TotalRestarts = 0
			}
		}
		_ = newPhase // suppress unused warning for deleted pods
	}

	c.recalculateHealthRLocked(ov)
}

func (c *OverviewCache) updateNodeCount(clusterID string, _ string, _ interface{}) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ov, ok := c.overviews[clusterID]
	if !ok {
		return
	}
	ov.Counts.Nodes = len(c.informers[clusterID].GetStore("Node").List())
	c.recalculateHealthRLocked(ov)
}

func (c *OverviewCache) updateNamespaceCount(clusterID string, _ string, _ interface{}) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ov, ok := c.overviews[clusterID]
	if !ok {
		return
	}
	ov.Counts.Namespaces = len(c.informers[clusterID].GetStore("Namespace").List())
}

func (c *OverviewCache) updateDeploymentCount(clusterID string, _ string, _ interface{}) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ov, ok := c.overviews[clusterID]
	if !ok {
		return
	}
	ov.Counts.Deployments = len(c.informers[clusterID].GetStore("Deployment").List())
}

func (c *OverviewCache) updateAlerts(clusterID string, _ string, _ interface{}) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ov, ok := c.overviews[clusterID]
	if !ok {
		return
	}

	events := c.informers[clusterID].GetStore("Event").List()
	warnings := 0
	critical := 0
	var top3 []models.OverviewAlert

	for _, eObj := range events {
		e := eObj.(*corev1.Event)
		if e.Type == corev1.EventTypeWarning {
			warnings++
			if len(top3) < 3 {
				top3 = append(top3, models.OverviewAlert{
					Reason:    e.Reason,
					Resource:  fmt.Sprintf("%s/%s", e.InvolvedObject.Kind, e.InvolvedObject.Name),
					Namespace: e.Namespace,
				})
			}
		} else if e.Type != corev1.EventTypeNormal {
			critical++
		}
	}

	ov.Alerts.Warnings = warnings
	ov.Alerts.Critical = critical
	ov.Alerts.Top3 = top3
	c.recalculateHealthRLocked(ov)
}

// recalculateTotalRestarts recomputes the total restart count from the Pod informer store.
// Called under write lock from updatePodStatus on MODIFIED events for accuracy.
func (c *OverviewCache) recalculateTotalRestarts(clusterID string, ov *models.ClusterOverview) {
	im, ok := c.informers[clusterID]
	if !ok {
		return
	}
	store := im.GetStore("Pod")
	if store == nil {
		return
	}
	total := 0
	for _, obj := range store.List() {
		pod, ok := obj.(*corev1.Pod)
		if !ok {
			continue
		}
		for _, cs := range pod.Status.ContainerStatuses {
			total += int(cs.RestartCount)
		}
		for _, cs := range pod.Status.InitContainerStatuses {
			total += int(cs.RestartCount)
		}
	}
	ov.PodStatus.TotalRestarts = total
}

// recalculateHealthRLocked contains the mirroring of rest.computeHealth but for cached data
func (c *OverviewCache) recalculateHealthRLocked(ov *models.ClusterOverview) {
	totalPods := ov.PodStatus.Running + ov.PodStatus.Pending + ov.PodStatus.Failed + ov.PodStatus.Succeeded

	// Pod health (40%)
	podHealthRatio := 100.0
	if totalPods > 0 {
		podHealthRatio = float64(ov.PodStatus.Running+ov.PodStatus.Succeeded) / float64(totalPods) * 100
	}

	pendingPenalty := 0.0
	if totalPods > 0 && ov.PodStatus.Pending > 0 {
		pendingPenalty = float64(ov.PodStatus.Pending) / float64(totalPods) * 20
	}

	failedPenalty := 0.0
	if totalPods > 0 && ov.PodStatus.Failed > 0 {
		failedPenalty = float64(ov.PodStatus.Failed) / float64(totalPods) * 50
	}

	podHealth := podHealthRatio - pendingPenalty - failedPenalty
	if podHealth < 0 {
		podHealth = 0
	}

	// Event health (10%)
	eventHealth := 100.0 - float64(ov.Alerts.Warnings)*2 - float64(ov.Alerts.Critical)*10
	if eventHealth < 0 {
		eventHealth = 0
	}

	// Node health (30%)
	nodeHealth := 0.0
	if ov.Counts.Nodes > 0 {
		nodeHealth = 100.0
	}

	// Stability (20%) — derived from pod restart counts. Each restart decreases stability
	// by 2 points (capped at 0). A cluster with 50+ total restarts scores 0% stability.
	stability := 100.0
	if ov.PodStatus.TotalRestarts > 0 {
		stability = 100.0 - float64(ov.PodStatus.TotalRestarts)*2
		if stability < 0 {
			stability = 0
		}
	}

	score := int(podHealth*0.4 + nodeHealth*0.3 + stability*0.2 + eventHealth*0.1)
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}

	ov.Health.Score = score
	switch {
	case score >= 90:
		ov.Health.Grade, ov.Health.Status = "A", "excellent"
	case score >= 80:
		ov.Health.Grade, ov.Health.Status = "B", "good"
	case score >= 70:
		ov.Health.Grade, ov.Health.Status = "C", "fair"
	case score >= 60:
		ov.Health.Grade, ov.Health.Status = "D", "poor"
	default:
		ov.Health.Grade, ov.Health.Status = "F", "critical"
	}
}
