package lifecycle

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"

	addonmetrics "github.com/kubilitics/kubilitics-backend/internal/addon/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

const (
	// DegradeThreshold is how long ready<total must hold before marking add-on DEGRADED.
	DegradeThreshold = 5 * time.Minute
)

// HealthMonitor watches pods for a single Helm release and reports health changes.
type HealthMonitor struct {
	k8sClient   kubernetes.Interface
	repo        repository.AddOnRepository
	installID   string
	clusterID   string
	namespace   string
	releaseName string
	logger      *slog.Logger

	mu             sync.Mutex
	factory        informers.SharedInformerFactory
	podStore       cache.Store
	stopCh         chan struct{}
	stateStartedAt time.Time
	lastReady      int
	lastTotal      int
	lastStatus     models.AddOnStatus
	lastHealth     models.HealthStatus
}

// NewHealthMonitor creates a monitor for the given install. Call Start to begin watching.
func NewHealthMonitor(
	k8sClient kubernetes.Interface,
	repo repository.AddOnRepository,
	installID, clusterID, namespace, releaseName string,
	logger *slog.Logger,
) *HealthMonitor {
	if logger == nil {
		logger = slog.Default()
	}
	return &HealthMonitor{
		k8sClient:   k8sClient,
		repo:        repo,
		installID:   installID,
		clusterID:   clusterID,
		namespace:   namespace,
		releaseName: releaseName,
		logger:      logger,
	}
}

// Start starts the pod informer and invokes handler on health changes. Blocks until ctx is done or Stop is called.
func (m *HealthMonitor) Start(ctx context.Context, handler LifecycleEventHandler) error {
	selector := labels.Set{"app.kubernetes.io/instance": m.releaseName}.String()
	m.factory = informers.NewSharedInformerFactoryWithOptions(m.k8sClient, 5*time.Minute,
		informers.WithNamespace(m.namespace),
		informers.WithTweakListOptions(func(opts *metav1.ListOptions) {
			opts.LabelSelector = selector
		}),
	)
	podInformer := m.factory.Core().V1().Pods().Informer()
	m.stopCh = make(chan struct{})
	// defer Stop ensures the informer factory is shut down on every return path,
	// including early return when WaitForCacheSync fails due to context cancellation.
	defer m.Stop()

	m.podStore = podInformer.GetStore()
	podInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			select {
			case <-ctx.Done():
				return
			default:
				m.evaluate(ctx, handler)
			}
		},
		UpdateFunc: func(_, _ interface{}) {
			select {
			case <-ctx.Done():
				return
			default:
				m.evaluate(ctx, handler)
			}
		},
		DeleteFunc: func(obj interface{}) {
			select {
			case <-ctx.Done():
				return
			default:
				m.evaluate(ctx, handler)
			}
		},
	})

	m.factory.Start(m.stopCh)
	if !cache.WaitForCacheSync(ctx.Done(), podInformer.HasSynced) {
		return ctx.Err()
	}
	// Initial evaluation
	m.evaluateFromLister(ctx, handler)
	<-ctx.Done()
	// defer m.Stop() handles informer cleanup above.
	return nil
}

// Stop stops the informer factory.
func (m *HealthMonitor) Stop() {
	if m.stopCh != nil {
		close(m.stopCh)
		m.stopCh = nil
	}
}

func (m *HealthMonitor) evaluate(ctx context.Context, handler LifecycleEventHandler) {
	m.evaluateFromLister(ctx, handler)
}

func (m *HealthMonitor) evaluateFromLister(ctx context.Context, handler LifecycleEventHandler) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var ready, total int
	if m.podStore != nil {
		for _, obj := range m.podStore.List() {
			pod, ok := obj.(*corev1.Pod)
			if !ok {
				continue
			}
			total++
			if pod.DeletionTimestamp == nil && isPodReady(pod) {
				ready++
			}
		}
	}
	// If we haven't synced yet, podStore may be empty; skip until we have data
	if m.podStore != nil && total == 0 && m.lastTotal == 0 && m.lastStatus == "" {
		return
	}

	now := time.Now()
	if ready != m.lastReady || total != m.lastTotal {
		m.stateStartedAt = now
		m.lastReady = ready
		m.lastTotal = total
	}
	newStatus, newHealth := computeHealthStatus(ready, total, m.stateStartedAt)

	install, err := m.repo.GetInstall(ctx, m.installID)
	if err != nil {
		m.logger.Debug("health monitor get install", "installID", m.installID, "err", err)
		return
	}
	currentStatus := models.AddOnStatus(install.Status)
	statusChanged := newStatus != currentStatus
	healthOrCountChanged := newHealth != m.lastHealth || ready != m.lastReady || total != m.lastTotal
	if !statusChanged && !healthOrCountChanged {
		return
	}
	m.lastStatus = newStatus
	m.lastHealth = newHealth

	// Prometheus: count every health evaluation tick with its result label.
	healthLabel := strings.ToLower(string(newHealth)) // "healthy", "degraded", "unknown"
	addonmetrics.LMCHealthChecksTotal.WithLabelValues(m.clusterID, healthLabel).Inc()

	healthRec := &models.AddOnHealth{
		AddonInstallID: m.installID,
		LastCheckedAt:  now,
		HealthStatus:   string(newHealth),
		ReadyPods:      ready,
		TotalPods:      total,
	}
	if err := m.repo.UpsertHealth(ctx, healthRec); err != nil {
		m.logger.Debug("health monitor upsert health", "installID", m.installID, "err", err)
		return
	}
	if statusChanged {
		if err := Transition(ctx, m.repo, m.installID, currentStatus, newStatus, install.HelmRevision); err != nil {
			m.logger.Debug("health monitor transition", "installID", m.installID, "err", err)
			return
		}
		event := HealthEvent{
			AddonInstallID: m.installID,
			ClusterID:      m.clusterID,
			OldStatus:      currentStatus,
			NewStatus:      newStatus,
			ReadyPods:      ready,
			TotalPods:      total,
			OccurredAt:     now,
		}
		handler.OnHealthChange(event)
	}
}

func isPodReady(pod *corev1.Pod) bool {
	for _, c := range pod.Status.Conditions {
		if c.Type == corev1.PodReady && c.Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}

// computeHealthStatus returns (addon status, health status) from pod counts and when the current state started.
// If ready<total for longer than DegradeThreshold, status becomes DEGRADED.
func computeHealthStatus(readyPods, totalPods int, lastTransitionTime time.Time) (models.AddOnStatus, models.HealthStatus) {
	if totalPods == 0 {
		return models.StatusDegraded, models.HealthUnknown
	}
	if readyPods == totalPods {
		return models.StatusInstalled, models.HealthHealthy
	}
	if time.Since(lastTransitionTime) > DegradeThreshold {
		return models.StatusDegraded, models.HealthDegraded
	}
	return models.StatusInstalled, models.HealthHealthy
}
