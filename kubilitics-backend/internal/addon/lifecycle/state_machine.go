package lifecycle

import (
	"context"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// validTransitions defines allowed (from → to) state transitions.
var validTransitions = map[models.AddOnStatus][]models.AddOnStatus{
	models.StatusInstalling:   {models.StatusInstalled, models.StatusFailed},
	models.StatusInstalled:    {models.StatusUpgrading, models.StatusUninstalling, models.StatusDegraded, models.StatusDrifted, models.StatusSuspended},
	models.StatusDegraded:     {models.StatusInstalled, models.StatusRollingBack, models.StatusFailed, models.StatusUninstalling},
	models.StatusUpgrading:    {models.StatusInstalled, models.StatusRollingBack, models.StatusFailed},
	models.StatusRollingBack:  {models.StatusInstalled, models.StatusFailed},
	models.StatusFailed:       {models.StatusInstalling, models.StatusUninstalling},
	models.StatusDrifted:      {models.StatusInstalled, models.StatusUninstalling},
	models.StatusSuspended:    {models.StatusInstalled, models.StatusUpgrading, models.StatusUninstalling},
	models.StatusDeprecated:   {models.StatusUpgrading, models.StatusUninstalling},
	models.StatusUninstalling: nil, // terminal
}

// CanTransition reports whether transitioning from `from` to `to` is allowed.
func CanTransition(from, to models.AddOnStatus) bool {
	if from == to {
		return true
	}
	allowed, ok := validTransitions[from]
	if !ok {
		return false
	}
	for _, s := range allowed {
		if s == to {
			return true
		}
	}
	return false
}

// Transition updates the install status in the repository after validating the transition.
// helmRevision is stored with the status (e.g. for INSTALLED after install/upgrade).
func Transition(ctx context.Context, repo repository.AddOnRepository, installID string, from, to models.AddOnStatus, helmRevision int) error {
	if !CanTransition(from, to) {
		return fmt.Errorf("invalid transition %s → %s for install %s", from, to, installID)
	}
	return repo.UpdateInstallStatus(ctx, installID, to, helmRevision)
}
