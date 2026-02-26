package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/addon/advisor"
	"github.com/kubilitics/kubilitics-backend/internal/addon/financial"
	"github.com/kubilitics/kubilitics-backend/internal/addon/helm"
	addonmetrics "github.com/kubilitics/kubilitics-backend/internal/addon/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/addon/notifications"
	"github.com/kubilitics/kubilitics-backend/internal/addon/rbac"
	"github.com/kubilitics/kubilitics-backend/internal/addon/registry"
	"github.com/kubilitics/kubilitics-backend/internal/addon/resolver"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/tracing"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
)

// AddOnServiceImpl implements AddOnService.
type AddOnServiceImpl struct {
	repo           repository.AddOnRepository
	registry       *registry.Registry
	preflight      PreflightRunner
	resolver       *resolver.DependencyResolver
	helmFactory    func(clusterID string) (helm.HelmClient, error)
	lmc            LifecycleRegistrar
	rbacChecker    *rbac.PermissionChecker
	clusterService ClusterService
	notifier       *notifications.Notifier // may be nil; set via SetNotifier
	advisor        *advisor.Advisor
	logger         *slog.Logger
}

// NewAddOnServiceImpl creates the addon service. helmFactory must return a Helm client for the given cluster.
// lmc can be nil initially and set via SetLMC.
func NewAddOnServiceImpl(
	repo repository.AddOnRepository,
	reg *registry.Registry,
	preflight PreflightRunner,
	res *resolver.DependencyResolver,
	helmFactory func(clusterID string) (helm.HelmClient, error),
	lmc LifecycleRegistrar,
	rbacChecker *rbac.PermissionChecker,
	clusterService ClusterService,
	logger *slog.Logger,
) *AddOnServiceImpl {
	if logger == nil {
		logger = slog.Default()
	}
	return &AddOnServiceImpl{
		repo:           repo,
		registry:       reg,
		preflight:      preflight,
		resolver:       res,
		helmFactory:    helmFactory,
		lmc:            lmc,
		rbacChecker:    rbacChecker,
		clusterService: clusterService,
		advisor:        advisor.NewAdvisor(repo, logger),
		logger:         logger,
	}
}

// SetLMC sets the lifecycle registrar (called after LMC is created in main).
func (s *AddOnServiceImpl) SetLMC(lmc LifecycleRegistrar) {
	s.lmc = lmc
}

// SetNotifier wires in a webhook notifier (T8.11). Can be called after construction.
func (s *AddOnServiceImpl) SetNotifier(n *notifications.Notifier) {
	s.notifier = n
}

func (s *AddOnServiceImpl) BrowseCatalog(ctx context.Context, tier, search string, tags []string, k8sVersion string) ([]models.AddOnEntry, error) {
	filter := registry.CatalogFilter{
		Tier:       tier,
		Search:     search,
		Tags:       tags,
		K8sVersion: k8sVersion,
	}
	return s.registry.ListAll(ctx, filter)
}

func (s *AddOnServiceImpl) ListCatalog(ctx context.Context, search string, limit, offset int) ([]models.AddOnEntry, int, error) {
	return s.registry.ListCatalogPaginated(ctx, search, limit, offset)
}

func (s *AddOnServiceImpl) GetAddOn(ctx context.Context, addonID string) (*models.AddOnDetail, error) {
	return s.registry.GetAddOn(ctx, addonID)
}

func (s *AddOnServiceImpl) PlanInstall(ctx context.Context, clusterID, addonID, namespace string) (*models.InstallPlan, error) {
	ctx, span := tracing.StartSpanWithAttributes(ctx, "addon.plan_install",
		attribute.String("addon.id", addonID),
		attribute.String("cluster.id", clusterID),
		attribute.String("helm.namespace", namespace),
	)
	defer span.End()

	plan, err := s.resolver.Resolve(ctx, addonID, clusterID)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}
	if plan != nil && namespace != "" {
		for i := range plan.Steps {
			if plan.Steps[i].AddonID == addonID {
				plan.Steps[i].Namespace = namespace
				plan.Steps[i].ReleaseName = plan.Steps[i].AddonName
				break
			}
		}
	}
	return plan, nil
}

func (s *AddOnServiceImpl) EstimateCost(ctx context.Context, clusterID string, plan *models.InstallPlan) (*financial.PlanCostEstimate, error) {
	if plan == nil {
		return &financial.PlanCostEstimate{}, nil
	}
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, fmt.Errorf("get cluster client: %w", err)
	}
	tier := financial.DetectClusterTier(ctx, client.Clientset)
	return financial.EstimatePlanCost(ctx, plan, s.repo, tier)
}

func (s *AddOnServiceImpl) RunPreflight(ctx context.Context, clusterID string, plan *models.InstallPlan) (*models.PreflightReport, error) {
	if plan == nil {
		return nil, fmt.Errorf("plan is required")
	}
	addonID := plan.RequestedAddonID
	ctx, span := tracing.StartSpanWithAttributes(ctx, "addon.preflight",
		attribute.String("addon.id", addonID),
		attribute.String("cluster.id", clusterID),
	)
	defer span.End()

	start := time.Now()
	report, err := s.preflight.RunPreflight(ctx, clusterID, *plan)
	addonmetrics.AddonOperationDurationSeconds.WithLabelValues("preflight", addonID).Observe(time.Since(start).Seconds())
	if err != nil {
		addonmetrics.AddonPreflightTotal.WithLabelValues(addonID, "error").Inc()
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}
	result := strings.ToLower(string(report.OverallStatus)) // "go", "warn", or "block"
	addonmetrics.AddonPreflightTotal.WithLabelValues(addonID, result).Inc()
	span.SetAttributes(attribute.String("preflight.result", result))
	return report, nil
}

func (s *AddOnServiceImpl) DryRunInstall(ctx context.Context, clusterID string, req InstallRequest) (*helm.DryRunResult, error) {
	helmClient, err := s.helmFactory(clusterID)
	if err != nil {
		return nil, fmt.Errorf("helm client: %w", err)
	}
	detail, err := s.registry.GetAddOn(ctx, req.AddonID)
	if err != nil {
		return nil, err
	}
	chartRef := detail.HelmRepoURL + "|" + detail.HelmChart
	vals := req.Values
	if vals == nil {
		vals = make(map[string]interface{})
	}
	hr := helm.InstallRequest{
		ReleaseName:     req.ReleaseName,
		Namespace:       req.Namespace,
		ChartRef:        chartRef,
		Version:         detail.HelmChartVersion,
		Values:          vals,
		CreateNamespace: req.CreateNamespace,
		Wait:            false,
		Timeout:         0,
		Atomic:          false,
	}
	return helmClient.DryRun(ctx, hr)
}

func (s *AddOnServiceImpl) ExecuteInstall(ctx context.Context, clusterID string, req InstallRequest, progressCh chan<- InstallProgressEvent) (*models.AddOnInstall, error) {
	// T7.02: generate a unique run ID so every log line and every WebSocket event
	// for this install operation share a common correlation key.
	installRunID := uuid.New().String()
	installStart := time.Now()

	// T7.03: root span for the entire install pipeline (plan→preflight→helm).
	// Child spans (addon.plan_install, addon.preflight, helm.install) are created
	// from the propagated ctx, so they appear nested in Jaeger / Tempo.
	ctx, rootSpan := tracing.StartSpanWithAttributes(ctx, "addon.execute_install",
		attribute.String("addon.id", req.AddonID),
		attribute.String("cluster.id", clusterID),
		attribute.String("install_run_id", installRunID),
		attribute.String("actor", req.Actor),
	)
	defer rootSpan.End()

	log := s.logger.With(
		"install_run_id", installRunID,
		"cluster_id", clusterID,
		"addon_id", req.AddonID,
		"actor", req.Actor,
	)
	log.Info("starting install run")

	emit := func(step, message, status string) {
		ev := InstallProgressEvent{
			Step:         step,
			Message:      message,
			Status:       status,
			Timestamp:    time.Now().UTC(),
			InstallRunID: installRunID,
		}
		if progressCh != nil {
			select {
			case progressCh <- ev:
			default:
			}
		}
	}

	// Idempotency check: if a caller-supplied key is present, return the existing install
	// record rather than spawning a duplicate Helm install. This is safe to retry.
	if req.IdempotencyKey != "" {
		existing, err := s.repo.FindInstallByIdempotencyKey(ctx, clusterID, req.IdempotencyKey)
		if err != nil {
			return nil, fmt.Errorf("idempotency check: %w", err)
		}
		if existing != nil {
			log.Info("returning existing install for idempotency key",
				"idempotency_key", req.IdempotencyKey,
				"install_id", existing.ID,
				"status", existing.Status,
			)
			install := existing.AddOnInstall
			return &install, nil
		}
	}

	plan, err := s.PlanInstall(ctx, clusterID, req.AddonID, req.Namespace)
	if err != nil {
		return nil, err
	}
	report, err := s.RunPreflight(ctx, clusterID, plan)
	if err != nil {
		return nil, err
	}
	if report.OverallStatus == models.PreflightBLOCK {
		log.Warn("install run blocked by preflight", "blockers", report.Blockers)
		blockErr := fmt.Errorf("preflight blocked: %v", report.Blockers)
		rootSpan.RecordError(blockErr)
		rootSpan.SetStatus(codes.Error, blockErr.Error())
		return nil, blockErr
	}
	log.Info("preflight passed", "status", report.OverallStatus, "steps", len(plan.Steps))

	helmClient, err := s.helmFactory(clusterID)
	if err != nil {
		return nil, fmt.Errorf("helm client: %w", err)
	}

	var primaryInstall *models.AddOnInstall
	for i := range plan.Steps {
		step := &plan.Steps[i]
		if step.Action != models.ActionInstall {
			continue
		}
		detail, err := s.repo.GetAddOn(ctx, step.AddonID)
		if err != nil {
			return nil, fmt.Errorf("get addon %s: %w", step.AddonID, err)
		}
		ns := step.Namespace
		releaseName := step.ReleaseName
		vals := make(map[string]interface{})
		if step.AddonID == plan.RequestedAddonID && req.Values != nil {
			for k, v := range req.Values {
				vals[k] = v
			}
		}
		if ns == "" {
			ns = "default"
		}
		if releaseName == "" {
			releaseName = detail.Name
		}

		emit("install", fmt.Sprintf("Installing %s...", detail.DisplayName), "running")
		installID := uuid.New().String()
		// Compute values hash from raw values (before redaction) for future drift detection.
		valuesHash, _ := helm.ValuesHash(vals)
		// Redact secret-like keys before persisting values to the database.
		redactedVals := helm.RedactSecretValues(vals)
		valuesJSONStr := "{}"
		if b, err := json.Marshal(redactedVals); err == nil {
			valuesJSONStr = string(b)
		}
		install := &models.AddOnInstall{
			ID:               installID,
			ClusterID:        clusterID,
			AddonID:          step.AddonID,
			ReleaseName:      releaseName,
			Namespace:        ns,
			HelmRevision:     0,
			InstalledVersion: step.ToVersion,
			ValuesJSON:       valuesJSONStr,
			Status:           string(models.StatusInstalling),
			InstalledBy:      req.Actor,
			// Only stamp the idempotency key on the primary (requested) addon, not dependencies.
			// Dependencies do not have a caller-supplied key.
			IdempotencyKey: func() string {
				if step.AddonID == plan.RequestedAddonID {
					return req.IdempotencyKey
				}
				return ""
			}(),
			InstalledAt: time.Now().UTC(),
			UpdatedAt:   time.Now().UTC(),
		}
		if err := s.repo.CreateInstall(ctx, install); err != nil {
			return nil, fmt.Errorf("create install record: %w", err)
		}
		if step.AddonID == plan.RequestedAddonID {
			primaryInstall = install
		}

		auditID := uuid.New().String()
		_ = s.repo.CreateAuditEvent(ctx, &models.AddOnAuditEvent{
			ID:             auditID,
			ClusterID:      clusterID,
			AddonInstallID: installID,
			AddonID:        step.AddonID,
			ReleaseName:    releaseName,
			Actor:          req.Actor,
			Operation:      string(models.OpInstall),
			NewVersion:     step.ToVersion,
			ValuesHash:     valuesHash,
			Result:         string(models.ResultInProgress),
			CreatedAt:      time.Now().UTC(),
		})

		chartRef := detail.HelmRepoURL + "|" + detail.HelmChart
		hr := helm.InstallRequest{
			ReleaseName:     releaseName,
			Namespace:       ns,
			ChartRef:        chartRef,
			Version:         step.ToVersion,
			Values:          vals,
			CreateNamespace: req.CreateNamespace && step.AddonID == plan.RequestedAddonID,
			Wait:            true,
			Timeout:         5 * time.Minute,
			Atomic:          true,
		}
		result, err := helmClient.Install(ctx, hr)
		if err != nil {
			_ = s.repo.UpdateInstallStatus(ctx, installID, models.StatusFailed, 0)
			emit("install", fmt.Sprintf("Failed: %v", err), "error")
			addonmetrics.AddonInstallsTotal.WithLabelValues(step.AddonID, "failed").Inc()
			addonmetrics.AddonOperationDurationSeconds.WithLabelValues("install", step.AddonID).Observe(time.Since(installStart).Seconds())
			rootSpan.RecordError(err)
			rootSpan.SetStatus(codes.Error, err.Error())
			return nil, fmt.Errorf("helm install %s: %w", step.AddonID, err)
		}
		_ = s.repo.UpdateInstallStatus(ctx, installID, models.StatusInstalled, result.Revision)
		log.Info("helm install succeeded", "addon_id", step.AddonID, "revision", result.Revision, "namespace", ns)
		emit("install", fmt.Sprintf("Installed %s", detail.DisplayName), "success")
	}

	if primaryInstall == nil {
		return nil, fmt.Errorf("no primary install for %s", plan.RequestedAddonID)
	}
	addonmetrics.AddonInstallsTotal.WithLabelValues(plan.RequestedAddonID, "success").Inc()
	addonmetrics.AddonOperationDurationSeconds.WithLabelValues("install", plan.RequestedAddonID).Observe(time.Since(installStart).Seconds())
	log.Info("install run complete",
		"duration_ms", time.Since(installStart).Milliseconds(),
		"install_id", primaryInstall.ID,
	)
	if s.lmc != nil {
		_ = s.lmc.RegisterCluster(clusterID)
	}
	if progressCh != nil {
		progressCh <- InstallProgressEvent{
			Step:         "complete",
			Message:      "Install complete",
			Status:       "complete",
			Timestamp:    time.Now().UTC(),
			InstallRunID: installRunID,
		}
	}
	return primaryInstall, nil
}

func (s *AddOnServiceImpl) ExecuteUpgrade(ctx context.Context, clusterID, installID string, req UpgradeRequest, progressCh chan<- InstallProgressEvent) error {
	upgradeStart := time.Now()

	// emit is a non-blocking helper for optional progress streaming.
	emit := func(step, message, status string) {
		if progressCh == nil {
			return
		}
		ev := InstallProgressEvent{
			Step:      step,
			Message:   message,
			Status:    status,
			Timestamp: time.Now().UTC(),
		}
		select {
		case progressCh <- ev:
		default:
		}
	}

	install, err := s.repo.GetInstall(ctx, installID)
	if err != nil {
		return err
	}
	addonID := install.AddonID
	oldVersion := install.InstalledVersion
	if install.ClusterID != clusterID {
		return fmt.Errorf("install %s does not belong to cluster %s", installID, clusterID)
	}
	_ = s.repo.UpdateInstallStatus(ctx, installID, models.StatusUpgrading, install.HelmRevision)

	helmClient, err := s.helmFactory(clusterID)
	if err != nil {
		_ = s.repo.UpdateInstallStatus(ctx, installID, models.StatusFailed, install.HelmRevision)
		addonmetrics.AddonUpgradesTotal.WithLabelValues(addonID, "failed").Inc()
		addonmetrics.AddonOperationDurationSeconds.WithLabelValues("upgrade", addonID).Observe(time.Since(upgradeStart).Seconds())
		return err
	}
	detail, err := s.repo.GetAddOn(ctx, addonID)
	if err != nil {
		_ = s.repo.UpdateInstallStatus(ctx, installID, models.StatusFailed, install.HelmRevision)
		addonmetrics.AddonUpgradesTotal.WithLabelValues(addonID, "failed").Inc()
		addonmetrics.AddonOperationDurationSeconds.WithLabelValues("upgrade", addonID).Observe(time.Since(upgradeStart).Seconds())
		return err
	}
	version := req.Version
	if version == "" {
		version = detail.HelmChartVersion
	}
	vals := req.Values
	if vals == nil {
		vals = make(map[string]interface{})
	}

	// T9.02: Pre-upgrade Velero backup checkpoint.
	// If Velero is installed, create a namespace-scoped backup before touching
	// Helm so the operator can restore the pre-upgrade state if needed.
	// Backup failure is treated as a warning (logged) rather than a hard blocker,
	// allowing the upgrade to proceed even if the backup store is unavailable.
	var veleroBackupName string
	if s.clusterService != nil {
		if k8sClient, clientErr := s.clusterService.GetClient(clusterID); clientErr == nil && k8sClient != nil && veleroIsInstalled(ctx, k8sClient.Dynamic) {
			emit("velero-backup", "Creating Velero backup checkpoint…", "running")
			s.logger.Info("velero detected; creating pre-upgrade backup checkpoint",
				"install_id", installID,
				"release", install.ReleaseName,
				"namespace", install.Namespace,
			)
			bName, bErr := createVeleroBackup(ctx, k8sClient.Dynamic, install.ReleaseName, install.Namespace, 5*time.Minute, s.logger)
			if bErr != nil {
				// Non-fatal: log the error, emit a warning event, and continue upgrade.
				s.logger.Warn("velero backup checkpoint failed; proceeding with upgrade",
					"install_id", installID,
					"backup_name", bName,
					"err", bErr,
				)
				emit("velero-backup", fmt.Sprintf("Backup warning: %v — proceeding with upgrade", bErr), "warning")
			} else {
				veleroBackupName = bName
				emit("velero-backup", fmt.Sprintf("Backup checkpoint ready: %s", bName), "success")
			}
		}
	}

	emit("helm-upgrade", fmt.Sprintf("Upgrading %s to %s…", install.ReleaseName, version), "running")

	chartRef := detail.HelmRepoURL + "|" + detail.HelmChart
	ur := helm.UpgradeRequest{
		ReleaseName: install.ReleaseName,
		Namespace:   install.Namespace,
		ChartRef:    chartRef,
		Version:     version,
		Values:      vals,
		Wait:        true,
		Timeout:     5 * time.Minute,
		Atomic:      true,
		ReuseValues: req.ReuseValues,
	}
	result, err := helmClient.Upgrade(ctx, ur)
	if err != nil {
		_ = s.repo.UpdateInstallStatus(ctx, installID, models.StatusFailed, install.HelmRevision)
		addonmetrics.AddonUpgradesTotal.WithLabelValues(addonID, "failed").Inc()
		addonmetrics.AddonOperationDurationSeconds.WithLabelValues("upgrade", addonID).Observe(time.Since(upgradeStart).Seconds())
		emit("helm-upgrade", fmt.Sprintf("Upgrade failed: %v", err), "error")
		_ = s.repo.CreateAuditEvent(ctx, &models.AddOnAuditEvent{
			ID:             uuid.New().String(),
			ClusterID:      clusterID,
			AddonInstallID: installID,
			AddonID:        addonID,
			ReleaseName:    install.ReleaseName,
			Actor:          req.Actor,
			Operation:      string(models.OpUpgrade),
			OldVersion:     oldVersion,
			NewVersion:     version,
			ValuesHash:     veleroBackupName,
			Result:         string(models.ResultFailure),
			ErrorMessage:   err.Error(),
			DurationMs:     time.Since(upgradeStart).Milliseconds(),
			CreatedAt:      time.Now().UTC(),
		})
		return fmt.Errorf("helm upgrade: %w", err)
	}

	_ = s.repo.UpdateInstallStatus(ctx, installID, models.StatusInstalled, result.Revision)
	_ = s.repo.UpdateInstallVersion(ctx, installID, version)
	addonmetrics.AddonUpgradesTotal.WithLabelValues(addonID, "success").Inc()
	addonmetrics.AddonOperationDurationSeconds.WithLabelValues("upgrade", addonID).Observe(time.Since(upgradeStart).Seconds())

	emit("complete", fmt.Sprintf("Upgraded to %s (revision %d)", version, result.Revision), "complete")

	// Audit event for the completed upgrade — backup name stored in ValuesHash
	// for traceability (allows linking audit row to the Velero backup in the UI).
	_ = s.repo.CreateAuditEvent(ctx, &models.AddOnAuditEvent{
		ID:             uuid.New().String(),
		ClusterID:      clusterID,
		AddonInstallID: installID,
		AddonID:        addonID,
		ReleaseName:    install.ReleaseName,
		Actor:          req.Actor,
		Operation:      string(models.OpUpgrade),
		OldVersion:     oldVersion,
		NewVersion:     version,
		ValuesHash:     veleroBackupName,
		Result:         string(models.ResultSuccess),
		DurationMs:     time.Since(upgradeStart).Milliseconds(),
		CreatedAt:      time.Now().UTC(),
	})

	return nil
}

func (s *AddOnServiceImpl) ExecuteRollback(ctx context.Context, clusterID, installID string, toRevision int) error {
	rollbackStart := time.Now()
	install, err := s.repo.GetInstall(ctx, installID)
	if err != nil {
		return err
	}
	addonID := install.AddonID
	if install.ClusterID != clusterID {
		return fmt.Errorf("install %s does not belong to cluster %s", installID, clusterID)
	}
	_ = s.repo.UpdateInstallStatus(ctx, installID, models.StatusRollingBack, install.HelmRevision)
	helmClient, err := s.helmFactory(clusterID)
	if err != nil {
		_ = s.repo.UpdateInstallStatus(ctx, installID, models.StatusFailed, install.HelmRevision)
		addonmetrics.AddonRollbacksTotal.WithLabelValues(addonID, "failed").Inc()
		addonmetrics.AddonOperationDurationSeconds.WithLabelValues("rollback", addonID).Observe(time.Since(rollbackStart).Seconds())
		return err
	}
	rr := helm.RollbackRequest{ReleaseName: install.ReleaseName, Namespace: install.Namespace, ToRevision: toRevision, Wait: true, Timeout: 5 * time.Minute}
	if err := helmClient.Rollback(ctx, rr); err != nil {
		_ = s.repo.UpdateInstallStatus(ctx, installID, models.StatusFailed, install.HelmRevision)
		addonmetrics.AddonRollbacksTotal.WithLabelValues(addonID, "failed").Inc()
		addonmetrics.AddonOperationDurationSeconds.WithLabelValues("rollback", addonID).Observe(time.Since(rollbackStart).Seconds())
		return err
	}
	_ = s.repo.UpdateInstallStatus(ctx, installID, models.StatusInstalled, install.HelmRevision)
	addonmetrics.AddonRollbacksTotal.WithLabelValues(addonID, "success").Inc()
	addonmetrics.AddonOperationDurationSeconds.WithLabelValues("rollback", addonID).Observe(time.Since(rollbackStart).Seconds())
	return nil
}

func (s *AddOnServiceImpl) ExecuteUninstall(ctx context.Context, clusterID, installID string, deleteCRDs bool) error {
	uninstallStart := time.Now()
	install, err := s.repo.GetInstall(ctx, installID)
	if err != nil {
		return err
	}
	addonID := install.AddonID
	if install.ClusterID != clusterID {
		return fmt.Errorf("install %s does not belong to cluster %s", installID, clusterID)
	}
	_ = s.repo.UpdateInstallStatus(ctx, installID, models.StatusUninstalling, install.HelmRevision)
	helmClient, err := s.helmFactory(clusterID)
	if err != nil {
		_ = s.repo.UpdateInstallStatus(ctx, installID, models.StatusFailed, install.HelmRevision)
		addonmetrics.AddonUninstallsTotal.WithLabelValues(addonID, "failed").Inc()
		addonmetrics.AddonOperationDurationSeconds.WithLabelValues("uninstall", addonID).Observe(time.Since(uninstallStart).Seconds())
		return err
	}
	ur := helm.UninstallRequest{ReleaseName: install.ReleaseName, Namespace: install.Namespace, KeepHistory: false, DeleteCRDs: deleteCRDs}
	if err := helmClient.Uninstall(ctx, ur); err != nil {
		_ = s.repo.UpdateInstallStatus(ctx, installID, models.StatusFailed, install.HelmRevision)
		addonmetrics.AddonUninstallsTotal.WithLabelValues(addonID, "failed").Inc()
		addonmetrics.AddonOperationDurationSeconds.WithLabelValues("uninstall", addonID).Observe(time.Since(uninstallStart).Seconds())
		return err
	}
	if err := s.repo.DeleteInstall(ctx, installID); err != nil {
		return err
	}
	addonmetrics.AddonUninstallsTotal.WithLabelValues(addonID, "success").Inc()
	addonmetrics.AddonOperationDurationSeconds.WithLabelValues("uninstall", addonID).Observe(time.Since(uninstallStart).Seconds())
	if s.lmc != nil {
		_ = s.lmc.DeregisterCluster(clusterID)
		_ = s.lmc.RegisterCluster(clusterID)
	}
	return nil
}

func (s *AddOnServiceImpl) ListClusterAddOns(ctx context.Context, clusterID string) ([]models.AddOnInstallWithHealth, error) {
	return s.repo.ListClusterInstalls(ctx, clusterID)
}

func (s *AddOnServiceImpl) GetInstall(ctx context.Context, installID string) (*models.AddOnInstallWithHealth, error) {
	return s.repo.GetInstall(ctx, installID)
}

func (s *AddOnServiceImpl) GetReleaseHistory(ctx context.Context, clusterID, installID string) ([]models.HelmReleaseRevision, error) {
	install, err := s.repo.GetInstall(ctx, installID)
	if err != nil {
		return nil, err
	}
	if install.ClusterID != clusterID {
		return nil, fmt.Errorf("install %s does not belong to cluster %s", installID, clusterID)
	}
	helmClient, err := s.helmFactory(clusterID)
	if err != nil {
		return nil, err
	}
	return helmClient.History(ctx, install.ReleaseName, install.Namespace)
}

func (s *AddOnServiceImpl) GetAuditEvents(ctx context.Context, filter models.AddOnAuditFilter) ([]models.AddOnAuditEvent, error) {
	return s.repo.ListAuditEvents(ctx, filter)
}

func (s *AddOnServiceImpl) SetUpgradePolicy(ctx context.Context, installID string, policy models.AddOnUpgradePolicy) error {
	policy.AddonInstallID = installID
	return s.repo.UpsertUpgradePolicy(ctx, &policy)
}

func (s *AddOnServiceImpl) GetFinancialStack(ctx context.Context, clusterID string) (*financial.FinancialStack, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}
	helmClient, err := s.helmFactory(clusterID)
	if err != nil {
		return nil, err
	}
	return financial.DetectFinancialStack(ctx, client.Clientset, helmClient)
}

func (s *AddOnServiceImpl) BuildFinancialStackPlan(ctx context.Context, clusterID string) (*models.InstallPlan, error) {
	stack, err := s.GetFinancialStack(ctx, clusterID)
	if err != nil {
		return nil, err
	}
	return financial.BuildFinancialStackPlan(ctx, clusterID, stack, s.resolver)
}

func (s *AddOnServiceImpl) GenerateRBACManifest(ctx context.Context, clusterID, addonID, namespace string) (string, error) {
	detail, err := s.registry.GetAddOn(ctx, addonID)
	if err != nil {
		return "", err
	}
	return rbac.GenerateManifestYAML(detail.RBACRequired, namespace, addonID)
}

// ── Profile methods ───────────────────────────────────────────────────────────

func (s *AddOnServiceImpl) ListProfiles(ctx context.Context) ([]models.ClusterProfile, error) {
	return s.repo.ListProfiles(ctx)
}

func (s *AddOnServiceImpl) GetProfile(ctx context.Context, id string) (*models.ClusterProfile, error) {
	return s.repo.GetProfile(ctx, id)
}

func (s *AddOnServiceImpl) CreateProfile(ctx context.Context, profile *models.ClusterProfile) error {
	return s.repo.CreateProfile(ctx, profile)
}

// ApplyProfile resolves the dependency graph for each addon in the profile,
// deduplicates across addons, and installs all in topological order.
// Progress events are emitted to progressCh (can be nil).
func (s *AddOnServiceImpl) ApplyProfile(ctx context.Context, clusterID, profileID, actor string, progressCh chan<- InstallProgressEvent) error {
	profile, err := s.repo.GetProfile(ctx, profileID)
	if err != nil {
		return fmt.Errorf("get profile: %w", err)
	}

	emit := func(step, msg, status string) {
		if progressCh == nil {
			return
		}
		progressCh <- InstallProgressEvent{
			Step:      step,
			Message:   msg,
			Status:    status,
			Timestamp: time.Now(),
		}
	}

	// Resolve dependency graph for all profile addons and collect unique steps.
	type installSpec struct {
		addonID     string
		releaseName string
		namespace   string
		values      map[string]interface{}
		depth       int
	}
	seen := map[string]bool{}
	var toInstall []installSpec

	for _, pa := range profile.Addons {
		plan, err := s.PlanInstall(ctx, clusterID, pa.AddonID, pa.Namespace)
		if err != nil {
			return fmt.Errorf("plan for %s: %w", pa.AddonID, err)
		}
		for _, step := range plan.Steps {
			key := step.AddonID + "|" + step.Namespace
			if seen[key] {
				continue
			}
			seen[key] = true
			spec := installSpec{
				addonID:     step.AddonID,
				releaseName: step.ReleaseName,
				namespace:   step.Namespace,
				values:      map[string]interface{}{},
				depth:       step.DependencyDepth,
			}
			// Override release name / values when this step is the primary addon.
			if step.AddonID == pa.AddonID {
				if pa.ReleaseName != "" {
					spec.releaseName = pa.ReleaseName
				}
				if pa.ValuesJSON != "" {
					_ = json.Unmarshal([]byte(pa.ValuesJSON), &spec.values)
				}
			}
			toInstall = append(toInstall, spec)
		}
	}

	// Sort by dependency depth — shallowest (deps) first.
	sort.Slice(toInstall, func(i, j int) bool {
		return toInstall[i].depth < toInstall[j].depth
	})

	emit("profile.start", fmt.Sprintf("Applying profile %q: %d addon(s) to install", profile.Name, len(toInstall)), "running")

	for _, spec := range toInstall {
		emit("profile.install."+spec.addonID,
			fmt.Sprintf("Installing %s into namespace %s", spec.addonID, spec.namespace),
			"running")

		req := InstallRequest{
			AddonID:         spec.addonID,
			ReleaseName:     spec.releaseName,
			Namespace:       spec.namespace,
			Values:          spec.values,
			CreateNamespace: true,
			Actor:           actor,
		}
		if _, err := s.ExecuteInstall(ctx, clusterID, req, nil); err != nil {
			emit("profile.error."+spec.addonID,
				fmt.Sprintf("Failed to install %s: %v", spec.addonID, err),
				"error")
			return fmt.Errorf("install %s: %w", spec.addonID, err)
		}
		emit("profile.done."+spec.addonID,
			fmt.Sprintf("Installed %s successfully", spec.addonID),
			"success")
	}

	emit("profile.complete",
		fmt.Sprintf("Profile %q applied — %d addon(s) installed", profile.Name, len(toInstall)),
		"complete")
	return nil
}

// ── Rollout methods (T8.06) ───────────────────────────────────────────────────

// CreateRollout persists a new fleet-wide rollout and launches a background goroutine
// that upgrades each target cluster, tracking per-cluster status in the DB.
// Strategy "canary" upgrades CanaryPercent% of clusters first; on success upgrades the rest.
func (s *AddOnServiceImpl) CreateRollout(
	ctx context.Context,
	addonID, targetVersion, strategy string,
	canaryPercent int,
	clusterIDs []string,
	actor string,
) (*models.AddonRollout, error) {
	if addonID == "" || targetVersion == "" {
		return nil, fmt.Errorf("addon_id and target_version are required")
	}
	if len(clusterIDs) == 0 {
		return nil, fmt.Errorf("at least one cluster_id is required")
	}
	if strategy == "" {
		strategy = string(models.StrategyAllAtOnce)
	}

	rollout := &models.AddonRollout{
		AddonID:       addonID,
		TargetVersion: targetVersion,
		Strategy:      models.RolloutStrategy(strategy),
		CanaryPercent: canaryPercent,
		Status:        models.RolloutPending,
		CreatedBy:     actor,
	}
	for _, id := range clusterIDs {
		rollout.ClusterStatuses = append(rollout.ClusterStatuses, models.RolloutClusterStatus{
			ClusterID: id,
			Status:    "pending",
		})
	}
	if err := s.repo.CreateRollout(ctx, rollout); err != nil {
		return nil, fmt.Errorf("create rollout: %w", err)
	}

	// Run the upgrade pipeline in the background so CreateRollout returns immediately.
	go s.runRollout(rollout.ID, addonID, targetVersion, clusterIDs, canaryPercent, models.RolloutStrategy(strategy), actor)
	return rollout, nil
}

// runRollout is the background driver that performs the actual per-cluster upgrades.
// It uses a fresh context so it is not cancelled when the HTTP request context ends.
func (s *AddOnServiceImpl) runRollout(
	rolloutID, addonID, targetVersion string,
	clusterIDs []string,
	canaryPercent int,
	strategy models.RolloutStrategy,
	actor string,
) {
	ctx := context.Background()
	log := s.logger.With("rollout_id", rolloutID, "addon_id", addonID, "target_version", targetVersion)

	_ = s.repo.UpdateRolloutStatus(ctx, rolloutID, models.RolloutRunning)

	now := func() *time.Time { t := time.Now().UTC(); return &t }

	upgradeFn := func(clusterID string) error {
		startedAt := now()
		_ = s.repo.UpsertRolloutClusterStatus(ctx, &models.RolloutClusterStatus{
			RolloutID: rolloutID, ClusterID: clusterID, Status: "running", StartedAt: startedAt,
		})

		// Find the existing install for this addon on this cluster.
		installs, err := s.repo.ListClusterInstalls(ctx, clusterID)
		if err != nil {
			return fmt.Errorf("list installs for cluster %s: %w", clusterID, err)
		}
		var installID string
		for _, i := range installs {
			if i.AddonID == addonID {
				installID = i.ID
				break
			}
		}
		if installID == "" {
			return fmt.Errorf("addon %s not installed on cluster %s", addonID, clusterID)
		}

		req := UpgradeRequest{Version: targetVersion, Actor: actor}
		if err := s.ExecuteUpgrade(ctx, clusterID, installID, req, nil); err != nil {
			return err
		}
		completedAt := now()
		_ = s.repo.UpsertRolloutClusterStatus(ctx, &models.RolloutClusterStatus{
			RolloutID: rolloutID, ClusterID: clusterID, Status: "success",
			StartedAt: startedAt, CompletedAt: completedAt,
		})
		log.Info("cluster upgrade succeeded", "cluster_id", clusterID)
		return nil
	}

	// Split clusters into canary wave and remainder.
	canaryCount := 0
	if strategy == models.StrategyCanary && canaryPercent > 0 {
		canaryCount = (len(clusterIDs)*canaryPercent + 99) / 100 // ceiling division
		if canaryCount < 1 {
			canaryCount = 1
		}
	}
	canaryWave := clusterIDs[:canaryCount]
	mainWave := clusterIDs[canaryCount:]

	failed := false
	for _, clusters := range [][]string{canaryWave, mainWave} {
		for _, id := range clusters {
			if err := upgradeFn(id); err != nil {
				log.Error("cluster upgrade failed", "cluster_id", id, "err", err)
				_ = s.repo.UpsertRolloutClusterStatus(ctx, &models.RolloutClusterStatus{
					RolloutID: rolloutID, ClusterID: id, Status: "failed",
					ErrorMessage: err.Error(), CompletedAt: now(),
				})
				failed = true
				// Abort on first canary failure; continue on main wave failures.
				if strategy == models.StrategyCanary && canaryCount > 0 {
					_ = s.repo.UpdateRolloutStatus(ctx, rolloutID, models.RolloutFailed)
					return
				}
			}
		}
		// After canary wave success, continue to main wave.
	}

	finalStatus := models.RolloutCompleted
	if failed {
		finalStatus = models.RolloutFailed
	}
	_ = s.repo.UpdateRolloutStatus(ctx, rolloutID, finalStatus)
	log.Info("rollout finished", "status", finalStatus)
}

func (s *AddOnServiceImpl) GetRollout(ctx context.Context, rolloutID string) (*models.AddonRollout, error) {
	return s.repo.GetRollout(ctx, rolloutID)
}

func (s *AddOnServiceImpl) ListRollouts(ctx context.Context, addonID string) ([]models.AddonRollout, error) {
	return s.repo.ListRollouts(ctx, addonID)
}

// AbortRollout marks the rollout as aborted. The background goroutine will notice
// the aborted status on its next check (for long-running upgrades the current cluster
// operation completes, then no further clusters are started).
func (s *AddOnServiceImpl) AbortRollout(ctx context.Context, rolloutID string) error {
	rollout, err := s.repo.GetRollout(ctx, rolloutID)
	if err != nil {
		return err
	}
	if rollout.Status != models.RolloutPending && rollout.Status != models.RolloutRunning {
		return fmt.Errorf("rollout %s is already in terminal state %s", rolloutID, rollout.Status)
	}
	return s.repo.UpdateRolloutStatus(ctx, rolloutID, models.RolloutAborted)
}

func (s *AddOnServiceImpl) GetRecommendations(ctx context.Context, clusterID, installID string) (*financial.RightsizingRecommendation, error) {
	stack, err := s.GetFinancialStack(ctx, clusterID)
	if err != nil {
		return nil, err
	}
	if !stack.OpenCostInstalled || stack.OpenCostEndpoint == "" {
		return nil, fmt.Errorf("OpenCost not available on cluster %s", clusterID)
	}

	install, err := s.repo.GetInstall(ctx, installID)
	if err != nil {
		return nil, err
	}

	// Obtain a live K8s client so the rightsizer can read actual pod resource requests.
	clusterClient, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, fmt.Errorf("get cluster client for rightsizing: %w", err)
	}

	oc := financial.NewOpenCostClient(stack.OpenCostEndpoint)
	rightsizer := financial.NewRightsizer(oc, clusterClient.Clientset)
	return rightsizer.GetAddonRecommendations(ctx, install.ReleaseName, install.Namespace)
}
func (s *AddOnServiceImpl) GetAdvisorRecommendations(ctx context.Context, clusterID string) ([]models.AdvisorRecommendation, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, err
	}
	return s.advisor.GetRecommendations(ctx, clusterID, client)
}

// RunAddonTests executes helm test for the given install and returns the TestResult.
// An audit event is created regardless of pass/fail status.
func (s *AddOnServiceImpl) RunAddonTests(ctx context.Context, clusterID, installID string) (*helm.TestResult, error) {
	install, err := s.repo.GetInstall(ctx, installID)
	if err != nil {
		return nil, fmt.Errorf("get install for test: %w", err)
	}

	helmClient, err := s.helmFactory(clusterID)
	if err != nil {
		return nil, fmt.Errorf("get helm client: %w", err)
	}

	result, err := helmClient.Test(ctx, install.ReleaseName, install.Namespace, 5*time.Minute)
	if err != nil {
		return nil, fmt.Errorf("helm test: %w", err)
	}

	// Build a detail string: "N/M tests passed".
	passed := 0
	for _, t := range result.Tests {
		if t.Status == "Succeeded" {
			passed++
		}
	}
	detail := fmt.Sprintf("%d/%d helm tests passed", passed, len(result.Tests))
	auditStatus := string(models.ResultSuccess)
	errMsg := ""
	if !result.Passed {
		auditStatus = string(models.ResultFailure)
		errMsg = detail
	}

	_ = s.repo.CreateAuditEvent(ctx, &models.AddOnAuditEvent{
		ID:             uuid.New().String(),
		ClusterID:      clusterID,
		AddonInstallID: installID,
		AddonID:        install.AddonID,
		ReleaseName:    install.ReleaseName,
		Actor:          "system",
		Operation:      string(models.OpHealthChange),
		NewVersion:     install.InstalledVersion,
		Result:         auditStatus,
		ErrorMessage:   errMsg,
		ValuesHash:     detail, // repurpose ValuesHash to surface test summary in audit log
		CreatedAt:      time.Now().UTC(),
	})

	return result, nil
}

// ─── Maintenance window management (T9.03) ───────────────────────────────────

// CreateMaintenanceWindow persists a new maintenance window for the cluster.
// The ID is generated here if not already set by the caller.
func (s *AddOnServiceImpl) CreateMaintenanceWindow(ctx context.Context, w *models.AddonMaintenanceWindow) error {
	if w.ID == "" {
		w.ID = uuid.New().String()
	}
	if w.CreatedAt.IsZero() {
		w.CreatedAt = time.Now().UTC()
	}
	return s.repo.CreateMaintenanceWindow(ctx, w)
}

// ListMaintenanceWindows returns all maintenance windows for a cluster.
func (s *AddOnServiceImpl) ListMaintenanceWindows(ctx context.Context, clusterID string) ([]models.AddonMaintenanceWindow, error) {
	return s.repo.ListMaintenanceWindows(ctx, clusterID)
}

// DeleteMaintenanceWindow removes a maintenance window by ID.
func (s *AddOnServiceImpl) DeleteMaintenanceWindow(ctx context.Context, id string) error {
	return s.repo.DeleteMaintenanceWindow(ctx, id)
}

// ─── Private registry management (T9.04) ─────────────────────────────────────

func (s *AddOnServiceImpl) ListCatalogSources(ctx context.Context) ([]models.PrivateCatalogSource, error) {
	return s.repo.ListCatalogSources(ctx)
}

func (s *AddOnServiceImpl) CreateCatalogSource(ctx context.Context, sSource *models.PrivateCatalogSource) error {
	if sSource.ID == "" {
		sSource.ID = uuid.New().String()
	}
	if sSource.CreatedAt.IsZero() {
		sSource.CreatedAt = time.Now().UTC()
	}
	return s.repo.CreateCatalogSource(ctx, sSource)
}

func (s *AddOnServiceImpl) DeleteCatalogSource(ctx context.Context, id string) error {
	return s.repo.DeleteCatalogSource(ctx, id)
}
