package service

import (
	"context"
	"fmt"
	"sync"

	corev1 "k8s.io/api/core/v1"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// OverviewCache manages real-time dashboard data for clusters using Informers.
type OverviewCache struct {
	mu        sync.RWMutex
	overviews map[string]*models.ClusterOverview
	informers map[string]*k8s.InformerManager
	stopChs   map[string]chan struct{}
	listeners map[string][]chan *models.ClusterOverview
}

func NewOverviewCache() *OverviewCache {
	return &OverviewCache{
		overviews: make(map[string]*models.ClusterOverview),
		informers: make(map[string]*k8s.InformerManager),
		stopChs:   make(map[string]chan struct{}),
		listeners: make(map[string][]chan *models.ClusterOverview),
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
	}
}

func (c *OverviewCache) notifyStream(clusterID string) {
	c.mu.RLock()
	ov := c.overviews[clusterID]
	listeners := c.listeners[clusterID]
	c.mu.RUnlock()

	if ov == nil || len(listeners) == 0 {
		return
	}

	for _, ch := range listeners {
		select {
		case ch <- ov:
		default:
		}
	}
}

// Subscribe returns a channel that receives overview updates for a cluster.
func (c *OverviewCache) Subscribe(clusterID string) (chan *models.ClusterOverview, func()) {
	ch := make(chan *models.ClusterOverview, 10)

	c.mu.Lock()
	c.listeners[clusterID] = append(c.listeners[clusterID], ch)
	c.mu.Unlock()

	// Initial push
	if ov, ok := c.GetOverview(clusterID); ok {
		ch <- ov
	}

	unsubscribe := func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		listeners := c.listeners[clusterID]
		for i, l := range listeners {
			if l == ch {
				c.listeners[clusterID] = append(listeners[:i], listeners[i+1:]...)
				close(ch)
				break
			}
		}
	}

	return ch, unsubscribe
}

func (c *OverviewCache) updatePodStatus(clusterID string, _ string, _ interface{}) {
	c.mu.Lock()
	defer c.mu.Unlock()

	ov, ok := c.overviews[clusterID]
	if !ok {
		return
	}

	// For simple implementation, we'll re-calculate from the store to ensure consistency
	// In a high-traffic production system, we'd do incremental updates.
	// But since we want "Blazing Fast" reads, we'll keep the overview object updated.

	im := c.informers[clusterID]
	pods := im.GetStore("Pod").List()

	newStatus := models.OverviewPodStatus{}
	for _, pObj := range pods {
		p := pObj.(*corev1.Pod)
		switch p.Status.Phase {
		case corev1.PodRunning:
			newStatus.Running++
		case corev1.PodPending:
			newStatus.Pending++
		case corev1.PodSucceeded:
			newStatus.Succeeded++
		case corev1.PodFailed, corev1.PodUnknown:
			newStatus.Failed++
		}
	}
	ov.PodStatus = newStatus
	ov.Counts.Pods = len(pods)

	// Re-calculate health score locally
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

	// Stability (20%) - Defaulting to 100 for now as Informers don't easily track restart count without deep inspection
	stability := 100.0

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
