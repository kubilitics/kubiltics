package lifecycle

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/stretchr/testify/assert"
)

func TestCanTransition(t *testing.T) {
	// Legal
	assert.True(t, CanTransition(models.StatusInstalling, models.StatusInstalled))
	assert.True(t, CanTransition(models.StatusInstalled, models.StatusUpgrading))
	assert.True(t, CanTransition(models.StatusDegraded, models.StatusRollingBack))

	// Illegal
	assert.False(t, CanTransition(models.StatusInstalling, models.StatusUninstalling))
	assert.False(t, CanTransition(models.StatusUninstalling, models.StatusInstalled))

	// Same
	assert.True(t, CanTransition(models.StatusInstalled, models.StatusInstalled))
}

func TestTransition(t *testing.T) {
	repo := newFakeAddOnRepository()
	ctx := context.Background()
	installID := "inst-1"
	repo.installs[installID] = models.AddOnInstallWithHealth{
		AddOnInstall: models.AddOnInstall{ID: installID, Status: string(models.StatusInstalling)},
	}

	// OK
	err := Transition(ctx, repo, installID, models.StatusInstalling, models.StatusInstalled, 2)
	assert.NoError(t, err)
	inst, _ := repo.GetInstall(ctx, installID)
	assert.Equal(t, string(models.StatusInstalled), inst.Status)
	assert.Equal(t, 2, inst.HelmRevision)

	// Error
	err = Transition(ctx, repo, installID, models.StatusInstalled, models.StatusFailed, 3)
	assert.Error(t, err)
}
