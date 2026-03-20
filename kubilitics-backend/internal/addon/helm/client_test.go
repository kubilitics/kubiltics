package helm

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func newFakeHelmClient(t *testing.T) HelmClient {
	kubeconfig := createFakeKubeconfig()
	client, err := NewHelmClient(kubeconfig, "local", slog.Default())
	assert.NoError(t, err)
	return client
}

func TestHelmClient_Install_ErrorPaths(t *testing.T) {
	c := newFakeHelmClient(t)
	ctx := context.Background()

	// Invalid chart ref
	reqInvalidRef := InstallRequest{
		ReleaseName: "myrel",
		Namespace:   "default",
		ChartRef:    "invalid-ref",
	}
	_, err := c.Install(ctx, reqInvalidRef)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "chart ref must be")

	// Missing chart ref (resolution failure)
	reqMissingChart := InstallRequest{
		ReleaseName: "myrel",
		Namespace:   "default",
		ChartRef:    "fake-repo|fake-chart",
		Version:     "1.0.0",
	}
	// This will fail because resolveChartRef will fail to find the chart
	_, err = c.Install(ctx, reqMissingChart)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "resolve chart")
}

func TestHelmClient_Upgrade_ErrorPaths(t *testing.T) {
	c := newFakeHelmClient(t)
	ctx := context.Background()

	reqInvalidRef := UpgradeRequest{
		ReleaseName: "myrel",
		Namespace:   "default",
		ChartRef:    "invalid-ref",
	}
	_, err := c.Upgrade(ctx, reqInvalidRef)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "chart ref must be")

	reqMissingChart := UpgradeRequest{
		ReleaseName: "myrel",
		Namespace:   "default",
		ChartRef:    "fake-repo|fake-chart",
	}
	_, err = c.Upgrade(ctx, reqMissingChart)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "resolve chart")
}

func TestHelmClient_Uninstall_ErrorPaths(t *testing.T) {
	c := newFakeHelmClient(t)
	ctx := context.Background()

	// Missing release - should return an error
	err := c.Uninstall(ctx, UninstallRequest{
		ReleaseName: "non-existent",
		Namespace:   "default",
		DeleteCRDs:  true,
	})
	assert.Error(t, err)
}

func TestHelmClient_Rollback_ErrorPaths(t *testing.T) {
	c := newFakeHelmClient(t)
	ctx := context.Background()

	reqNoRelease := RollbackRequest{
		ReleaseName: "non-existent",
		Namespace:   "default",
		ToRevision:  1,
	}
	err := c.Rollback(ctx, reqNoRelease)
	assert.Error(t, err)
	// it should err out because there is no history
}

func TestHelmClient_Test_ErrorPaths(t *testing.T) {
	c := newFakeHelmClient(t)
	ctx := context.Background()

	// Test non-existent release
	_, err := c.Test(ctx, "non-existent", "default", 1*time.Minute)
	assert.Error(t, err)
}

func TestHelmClient_Status_ErrorPaths(t *testing.T) {
	c := newFakeHelmClient(t)
	ctx := context.Background()

	_, err := c.Status(ctx, "non-existent", "default")
	assert.Error(t, err)
}

func TestHelmClient_History_ErrorPaths(t *testing.T) {
	c := newFakeHelmClient(t)
	ctx := context.Background()

	_, err := c.History(ctx, "non-existent", "default")
	assert.Error(t, err)
}
