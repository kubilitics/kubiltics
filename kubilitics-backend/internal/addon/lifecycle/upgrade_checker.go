package lifecycle

import (
	"context"
	"log/slog"
	"time"

	"github.com/Masterminds/semver/v3"
	"github.com/kubilitics/kubilitics-backend/internal/addon/registry"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// UpgradeChecker checks the catalog for newer versions and applies upgrade policy.
type UpgradeChecker struct {
	registry *registry.Registry
	repo     repository.AddOnRepository
	logger   *slog.Logger
}

// NewUpgradeChecker creates an upgrade checker.
func NewUpgradeChecker(reg *registry.Registry, repo repository.AddOnRepository, logger *slog.Logger) *UpgradeChecker {
	if logger == nil {
		logger = slog.Default()
	}
	return &UpgradeChecker{
		registry: reg,
		repo:     repo,
		logger:   logger,
	}
}

// CheckForUpgrades returns an UpgradeAvailableEvent if a newer version is available and policy allows.
// Updates repo with NextAvailableVersion and LastCheckAt. Returns nil if policy is MANUAL, already current, or policy does not allow.
func (c *UpgradeChecker) CheckForUpgrades(ctx context.Context, install models.AddOnInstallWithHealth) (*UpgradeAvailableEvent, error) {
	policy := install.Policy
	if policy == nil {
		return nil, nil
	}
	if policy.Policy == string(models.PolicyManual) {
		return nil, nil
	}
	catalog, err := c.registry.GetAddOn(ctx, install.AddonID)
	if err != nil {
		return nil, err
	}
	if catalog == nil {
		return nil, nil
	}
	installedV, err := semver.NewVersion(install.InstalledVersion)
	if err != nil {
		return nil, nil
	}
	availableV, err := semver.NewVersion(catalog.Version)
	if err != nil {
		return nil, nil
	}
	if !availableV.GreaterThan(installedV) {
		return nil, nil
	}
	// Policy check: PolicyPatchOnly = only patch segment change; PolicyMinor = patch or minor; PolicyConservative = return event for UI but never auto
	allowed := false
	switch policy.Policy {
	case string(models.PolicyPatchOnly):
		allowed = allowedPatchOnly(installedV, availableV)
	case string(models.PolicyMinor):
		allowed = allowedMinor(installedV, availableV)
	case string(models.PolicyConservative):
		allowed = false
	default:
		allowed = availableV.GreaterThan(installedV)
	}
	now := time.Now()
	policyRec := &models.AddOnUpgradePolicy{
		AddonInstallID:       install.ID,
		Policy:               policy.Policy,
		PinnedVersion:        policy.PinnedVersion,
		LastCheckAt:          &now,
		NextAvailableVersion: catalog.Version,
		AutoUpgradeEnabled:   policy.AutoUpgradeEnabled,
	}
	if err := c.repo.UpsertUpgradePolicy(ctx, policyRec); err != nil {
		c.logger.Debug("upgrade checker upsert policy", "installID", install.ID, "err", err)
	}
	event := &UpgradeAvailableEvent{
		AddonInstallID:   install.ID,
		ClusterID:        install.ClusterID,
		CurrentVersion:   install.InstalledVersion,
		AvailableVersion: catalog.Version,
		DetectedAt:       now,
	}
	if policy.AutoUpgradeEnabled && allowed {
		return event, nil
	}
	if allowed || policy.Policy == string(models.PolicyConservative) {
		return event, nil
	}
	return event, nil
}

func allowedPatchOnly(installed, available *semver.Version) bool {
	return installed.Major() == available.Major() && installed.Minor() == available.Minor() && available.Patch() > installed.Patch()
}

func allowedMinor(installed, available *semver.Version) bool {
	if available.Major() != installed.Major() {
		return false
	}
	return available.Minor() > installed.Minor() || (available.Minor() == installed.Minor() && available.Patch() > installed.Patch())
}
