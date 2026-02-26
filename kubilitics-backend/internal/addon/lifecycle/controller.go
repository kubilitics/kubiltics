package lifecycle

import (
	"context"
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/addon/helm"
	"github.com/kubilitics/kubilitics-backend/internal/addon/registry"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	"github.com/kubilitics/kubilitics-backend/internal/service"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/restmapper"
)

const tickIntervalDefault = 60 * time.Second

// clusterMonitor holds per-cluster monitors and cancel.
type clusterMonitor struct {
	healthMonitors map[string]*HealthMonitor
	driftDetector  *DriftDetector
	upgradeChecker *UpgradeChecker
	wg             sync.WaitGroup
	cancelFunc     context.CancelFunc
}

// LifecycleController implements Controller and LifecycleEventHandler.
type LifecycleController struct {
	clusterService     service.ClusterService
	repo               repository.AddOnRepository
	helmClientFactory  func(kubeconfig []byte, namespace string, logger *slog.Logger) (helm.HelmClient, error)
	reg                *registry.Registry
	clusterMonitors    sync.Map
	tickInterval       time.Duration
	logger             *slog.Logger
	onRollbackRequest  func(ctx context.Context, installID string)
	onUpgradeRequest    func(ctx context.Context, installID string)
	runCtx             context.Context
	runCancel          context.CancelFunc
	startOnce          sync.Once
}

// NewLifecycleController creates the LMC controller. tickInterval defaults to 60s.
func NewLifecycleController(
	clusterService service.ClusterService,
	repo repository.AddOnRepository,
	helmClientFactory func(kubeconfig []byte, namespace string, logger *slog.Logger) (helm.HelmClient, error),
	reg *registry.Registry,
	logger *slog.Logger,
) *LifecycleController {
	if logger == nil {
		logger = slog.Default()
	}
	ti := tickIntervalDefault
	return &LifecycleController{
		clusterService:    clusterService,
		repo:              repo,
		helmClientFactory: helmClientFactory,
		reg:               reg,
		tickInterval:      ti,
		logger:            logger,
	}
}

// SetRollbackRequest sets the callback for auto-rollback when DEGRADED > 10min.
func (c *LifecycleController) SetRollbackRequest(fn func(ctx context.Context, installID string)) {
	c.onRollbackRequest = fn
}

// SetUpgradeRequest sets the callback for auto-upgrade when upgrade available and enabled.
func (c *LifecycleController) SetUpgradeRequest(fn func(ctx context.Context, installID string)) {
	c.onUpgradeRequest = fn
}

// Start loads clusters, registers each, and starts the background ticker for drift/upgrade checks.
func (c *LifecycleController) Start(ctx context.Context) error {
	var err error
	c.startOnce.Do(func() {
		c.runCtx, c.runCancel = context.WithCancel(ctx)
		clusters, listErr := c.clusterService.ListClusters(c.runCtx)
		if listErr != nil {
			err = listErr
			return
		}
		for _, cluster := range clusters {
			_ = c.RegisterCluster(cluster.ID)
		}
		go c.tickerLoop()
	})
	return err
}

// Stop stops all cluster monitors and the ticker.
func (c *LifecycleController) Stop() {
	if c.runCancel != nil {
		c.runCancel()
	}
	c.clusterMonitors.Range(func(key, value any) bool {
		if mon, ok := value.(*clusterMonitor); ok {
			if mon.cancelFunc != nil {
				mon.cancelFunc()
			}
			mon.wg.Wait()
		}
		return true
	})
}

// RegisterCluster starts health monitors for all INSTALLED installs on the cluster and stores the cluster monitor.
func (c *LifecycleController) RegisterCluster(clusterID string) error {
	ctx := c.runCtx
	if ctx == nil {
		ctx = context.Background()
	}
	cluster, err := c.clusterService.GetCluster(ctx, clusterID)
	if err != nil {
		return err
	}
	client, err := c.clusterService.GetClient(clusterID)
	if err != nil {
		return err
	}
	kubeconfigBytes, err := os.ReadFile(cluster.KubeconfigPath)
	if err != nil {
		return err
	}
	helmClient, err := c.helmClientFactory(kubeconfigBytes, "", c.logger)
	if err != nil {
		return err
	}
	installs, err := c.repo.ListClusterInstalls(ctx, clusterID)
	if err != nil {
		return err
	}
	clusterCtx, cancel := context.WithCancel(c.runCtx)
	mon := &clusterMonitor{
		healthMonitors: make(map[string]*HealthMonitor),
		cancelFunc:     cancel,
	}
	dc := client.Clientset.Discovery()
	mapper := restmapper.NewDeferredDiscoveryRESTMapper(memory.NewMemCacheClient(dc))
	mon.driftDetector = NewDriftDetector(helmClient, client.Dynamic, mapper, c.logger)
	mon.upgradeChecker = NewUpgradeChecker(c.reg, c.repo, c.logger)
	for _, inst := range installs {
		if inst.Status != string(models.StatusInstalled) && inst.Status != string(models.StatusDegraded) {
			continue
		}
		hm := NewHealthMonitor(client.Clientset, c.repo, inst.ID, clusterID, inst.Namespace, inst.ReleaseName, c.logger)
		mon.healthMonitors[inst.ID] = hm
		// wg.Add must be called before the goroutine starts to avoid a race with
		// DeregisterCluster calling wg.Wait() before Add() executes.
		mon.wg.Add(1)
		go func(h *HealthMonitor, m *clusterMonitor) {
			defer m.wg.Done()
			_ = h.Start(clusterCtx, c)
		}(hm, mon)
	}
	c.clusterMonitors.Store(clusterID, mon)
	return nil
}

// DeregisterCluster stops the cluster monitor and removes it.
func (c *LifecycleController) DeregisterCluster(clusterID string) error {
	if v, ok := c.clusterMonitors.Load(clusterID); ok {
		if mon, ok := v.(*clusterMonitor); ok {
			if mon.cancelFunc != nil {
				mon.cancelFunc()
			}
			mon.wg.Wait()
		}
		c.clusterMonitors.Delete(clusterID)
	}
	return nil
}

func (c *LifecycleController) tickerLoop() {
	ticker := time.NewTicker(c.tickInterval)
	defer ticker.Stop()
	for {
		select {
		case <-c.runCtx.Done():
			return
		case <-ticker.C:
			c.clusterMonitors.Range(func(key, value any) bool {
				clusterID, _ := key.(string)
				c.runDriftCheck(c.runCtx, clusterID)
				c.runUpgradeCheck(c.runCtx, clusterID)
				return true
			})
		}
	}
}

func (c *LifecycleController) runDriftCheck(ctx context.Context, clusterID string) {
	v, ok := c.clusterMonitors.Load(clusterID)
	if !ok {
		return
	}
	mon, ok := v.(*clusterMonitor)
	if !ok || mon.driftDetector == nil {
		return
	}
	installs, err := c.repo.ListClusterInstalls(ctx, clusterID)
	if err != nil {
		return
	}
	for _, inst := range installs {
		if inst.Status != string(models.StatusInstalled) {
			continue
		}
		event, err := mon.driftDetector.DetectDrift(ctx, inst)
		if err != nil {
			continue
		}
		if event == nil {
			continue
		}
		_ = Transition(ctx, c.repo, inst.ID, models.StatusInstalled, models.StatusDrifted, inst.HelmRevision)
		_ = c.repo.CreateAuditEvent(ctx, &models.AddOnAuditEvent{
			ID:             uuid.New().String(),
			ClusterID:      clusterID,
			AddonInstallID: inst.ID,
			AddonID:        inst.AddonID,
			ReleaseName:    inst.ReleaseName,
			Actor:          "lifecycle-controller",
			Operation:      string(models.OpDriftDetected),
			Result:         string(models.ResultSuccess),
			CreatedAt:      time.Now(),
		})
		c.OnDrift(*event)
	}
}

func (c *LifecycleController) runUpgradeCheck(ctx context.Context, clusterID string) {
	v, ok := c.clusterMonitors.Load(clusterID)
	if !ok {
		return
	}
	mon, ok := v.(*clusterMonitor)
	if !ok || mon.upgradeChecker == nil {
		return
	}
	installs, err := c.repo.ListClusterInstalls(ctx, clusterID)
	if err != nil {
		return
	}

	// T9.03: Load maintenance windows once per cluster tick.
	// A failed load is non-fatal — we proceed without window enforcement.
	maintenanceWindows, _ := c.repo.ListMaintenanceWindows(ctx, clusterID)
	now := time.Now()

	for _, inst := range installs {
		if inst.Status != string(models.StatusInstalled) {
			continue
		}
		event, err := mon.upgradeChecker.CheckForUpgrades(ctx, inst)
		if err != nil || event == nil {
			continue
		}
		if inst.Policy != nil && inst.Policy.AutoUpgradeEnabled {
			// T9.03: Only trigger auto-upgrade when inside a maintenance window.
			// If no windows are defined for the cluster, upgrades are unrestricted.
			if len(maintenanceWindows) > 0 && !IsWithinMaintenanceWindow(maintenanceWindows, inst.AddonID, now) {
				// Defer: record next eligible window start for the operator.
				var nextStart time.Time
				for _, w := range maintenanceWindows {
					if !windowAppliesTo(w, inst.AddonID) {
						continue
					}
					ns := NextWindowStart(w, now)
					if nextStart.IsZero() || ns.Before(nextStart) {
						nextStart = ns
					}
				}
				if !nextStart.IsZero() {
					_ = c.repo.SetPolicyNextEligibleAt(ctx, inst.ID, nextStart)
				}
				c.logger.Debug("auto-upgrade deferred: outside maintenance window",
					"install_id", inst.ID,
					"addon_id", inst.AddonID,
					"next_eligible_at", nextStart,
				)
				c.OnUpgradeAvailable(*event)
				continue
			}
			if c.onUpgradeRequest != nil {
				c.onUpgradeRequest(ctx, inst.ID)
			}
		} else {
			_ = c.repo.CreateAuditEvent(ctx, &models.AddOnAuditEvent{
				ID:             uuid.New().String(),
				ClusterID:      clusterID,
				AddonInstallID: inst.ID,
				AddonID:        inst.AddonID,
				ReleaseName:    inst.ReleaseName,
				Actor:          "lifecycle-controller",
				Operation:      string(models.OpUpgrade),
				OldVersion:     event.CurrentVersion,
				NewVersion:     event.AvailableVersion,
				Result:         string(models.ResultInProgress),
				CreatedAt:      time.Now(),
			})
		}
		c.OnUpgradeAvailable(*event)
	}
}

// OnHealthChange implements LifecycleEventHandler.
func (c *LifecycleController) OnHealthChange(event HealthEvent) {
	if event.NewStatus == models.StatusDegraded {
		if c.repo != nil {
			_ = c.repo.CreateAuditEvent(c.runCtx, &models.AddOnAuditEvent{
				ID:             uuid.New().String(),
				ClusterID:      event.ClusterID,
				AddonInstallID: event.AddonInstallID,
				Actor:          "lifecycle-controller",
				Operation:      string(models.OpHealthChange),
				Result:         string(models.ResultSuccess),
				CreatedAt:      event.OccurredAt,
			})
		}
		if c.onRollbackRequest != nil {
			c.onRollbackRequest(c.runCtx, event.AddonInstallID)
		}
	}
}

// OnDrift implements LifecycleEventHandler.
func (c *LifecycleController) OnDrift(event DriftEvent) {}

// OnUpgradeAvailable implements LifecycleEventHandler.
func (c *LifecycleController) OnUpgradeAvailable(event UpgradeAvailableEvent) {}

var _ Controller = (*LifecycleController)(nil)
var _ LifecycleEventHandler = (*LifecycleController)(nil)
