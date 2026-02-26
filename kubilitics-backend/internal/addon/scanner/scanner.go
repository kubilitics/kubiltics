package scanner

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	"github.com/kubilitics/kubilitics-backend/internal/service"
	"golang.org/x/sync/errgroup"
)

type ClusterScanner struct {
	clusterService service.ClusterService
	repo           repository.AddOnRepository
	checks         []CheckRunner
	logger         *slog.Logger
}

type artifactCheckRunner interface {
	RunWithArtifacts(ctx context.Context, input CheckInput) ([]models.PreflightCheck, *models.RBACDiff, []models.ResourceEstimate, error)
}

func NewClusterScanner(cs service.ClusterService, repo repository.AddOnRepository, logger *slog.Logger) *ClusterScanner {
	if logger == nil {
		logger = slog.Default()
	}
	checks := []CheckRunner{
		&RBACChecker{},
		&APIGroupChecker{},
		&CRDChecker{},
		&ResourceChecker{},
		&StorageChecker{},
		&ExistingInstallChecker{},
		&NetworkPolicyChecker{},
		&ImageSecurityChecker{},
		&ChartSignatureChecker{repo: repo},
	}
	return &ClusterScanner{
		clusterService: cs,
		repo:           repo,
		checks:         checks,
		logger:         logger,
	}
}

func (s *ClusterScanner) RunPreflight(ctx context.Context, clusterID string, plan models.InstallPlan) (*models.PreflightReport, error) {
	client, err := s.clusterService.GetClient(clusterID)
	if err != nil {
		return nil, fmt.Errorf("get cluster client %s: %w", clusterID, err)
	}
	installed, err := s.repo.ListClusterInstalls(ctx, clusterID)
	if err != nil {
		return nil, fmt.Errorf("list existing installs for cluster %s: %w", clusterID, err)
	}

	steps := make([]models.InstallStep, 0, len(plan.Steps))
	for i := range plan.Steps {
		if plan.Steps[i].Action != models.ActionSkip && plan.Steps[i].Action != models.ActionBlock {
			steps = append(steps, plan.Steps[i])
		}
	}

	report := &models.PreflightReport{
		ClusterID:         clusterID,
		AddonID:           plan.RequestedAddonID,
		OverallStatus:     models.PreflightGO,
		Checks:            make([]models.PreflightCheck, 0, len(steps)*len(s.checks)),
		Blockers:          []string{},
		Warnings:          []string{},
		ResourceEstimates: []models.ResourceEstimate{},
		GeneratedAt:       time.Now().UTC(),
	}

	for i := range steps {
		detail, err := s.repo.GetAddOn(ctx, steps[i].AddonID)
		if err != nil {
			return nil, fmt.Errorf("get addon detail %s: %w", steps[i].AddonID, err)
		}

		input := CheckInput{
			ClusterID:        clusterID,
			K8sClient:        client.Clientset,
			DiscoveryClient:  client.Clientset.Discovery(),
			DynamicClient:    client.Dynamic,
			RestConfig:       client.Config,
			AddonDetail:      detail,
			TargetNamespace:  steps[i].Namespace,
			RequestedVersion: steps[i].ToVersion,
			ExistingInstalls: installed,
		}

		stepCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		stepChecks := make([][]models.PreflightCheck, len(s.checks))
		rbacDiffs := make([]*models.RBACDiff, len(s.checks))
		stepEstimates := make([][]models.ResourceEstimate, len(s.checks))
		group, groupCtx := errgroup.WithContext(stepCtx)

		for idx := range s.checks {
			idx := idx
			group.Go(func() error {
				runner := s.checks[idx]
				if ar, ok := runner.(artifactCheckRunner); ok {
					checks, diff, estimates, runErr := ar.RunWithArtifacts(groupCtx, input)
					if runErr != nil {
						return fmt.Errorf("run check %T: %w", runner, runErr)
					}
					stepChecks[idx] = checks
					rbacDiffs[idx] = diff
					stepEstimates[idx] = estimates
					return nil
				}
				checks, runErr := runner.Run(groupCtx, input)
				if runErr != nil {
					return fmt.Errorf("run check %T: %w", runner, runErr)
				}
				stepChecks[idx] = checks
				return nil
			})
		}
		if err := group.Wait(); err != nil {
			cancel()
			return nil, err
		}
		cancel()

		for idx := range stepChecks {
			report.Checks = append(report.Checks, stepChecks[idx]...)
			if len(stepEstimates[idx]) > 0 {
				report.ResourceEstimates = append(report.ResourceEstimates, stepEstimates[idx]...)
			}
			if rbacDiffs[idx] != nil && len(rbacDiffs[idx].Missing) > 0 {
				report.RBACDiff = rbacDiffs[idx]
			}
		}
	}

	for i := range report.Checks {
		switch report.Checks[i].Status {
		case models.PreflightBLOCK:
			report.Blockers = append(report.Blockers, report.Checks[i].Detail)
		case models.PreflightWARN:
			report.Warnings = append(report.Warnings, report.Checks[i].Detail)
		}
	}
	if len(report.Blockers) > 0 {
		report.OverallStatus = models.PreflightBLOCK
	} else if len(report.Warnings) > 0 {
		report.OverallStatus = models.PreflightWARN
	}

	s.logger.Info("preflight checks completed", "cluster_id", clusterID, "addon_id", report.AddonID, "checks", len(report.Checks), "status", report.OverallStatus)
	return report, nil
}
