package helm

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestHelmClient_DryRun_ErrorPaths(t *testing.T) {
	c := newFakeHelmClient(t)
	ctx := context.Background()

	// Invalid chart ref
	reqInvalidRef := InstallRequest{
		ReleaseName: "myrel",
		Namespace:   "default",
		ChartRef:    "invalid-ref",
	}
	_, err := c.DryRun(ctx, reqInvalidRef)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "chart ref must be")

	// Missing chart ref (resolution failure)
	reqMissingChart := InstallRequest{
		ReleaseName: "myrel",
		Namespace:   "default",
		ChartRef:    "fake-repo|fake-chart",
		Version:     "1.0.0",
	}
	_, err = c.DryRun(ctx, reqMissingChart)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "resolve chart")
}
