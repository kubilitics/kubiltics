package helm

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestHelmClient_AddOrUpdateRepo_ErrorPaths(t *testing.T) {
	c, ok := newFakeHelmClient(t).(*helmClientImpl)
	assert.True(t, ok)
	ctx := context.Background()

	// Invalid URL
	err := c.AddOrUpdateRepo(ctx, "bad-repo", "not-a-url")
	assert.Error(t, err)
}

func TestHelmClient_PullChart_ErrorPaths(t *testing.T) {
	c, ok := newFakeHelmClient(t).(*helmClientImpl)
	assert.True(t, ok)
	ctx := context.Background()

	tmpDir, err := os.MkdirTemp("", "pull-test")
	assert.NoError(t, err)
	defer os.RemoveAll(tmpDir)

	// Pull from invalid repo
	_, err = c.PullChart(ctx, "https://invalid.example.com/charts", "non-existent", "1.0.0", tmpDir)
	assert.Error(t, err)
}

func TestHelmClient_ResolveChartRef_ErrorPaths(t *testing.T) {
	c, ok := newFakeHelmClient(t).(*helmClientImpl)
	assert.True(t, ok)
	ctx := context.Background()

	// Invalid chart name or repo
	_, err := c.resolveChartRef(ctx, "https://invalid.example.com", "fake-chart", "1.0.0")
	assert.Error(t, err)

	// OCI Ref without OCI client or invalid
	_, err = c.resolveChartRef(ctx, "oci://invalid.example.com", "fake-chart", "1.0.0")
	assert.Error(t, err)
}

func TestHelmClient_PullChart_EmptyDir(t *testing.T) {
	c, ok := newFakeHelmClient(t).(*helmClientImpl)
	assert.True(t, ok)
	ctx := context.Background()

	tmpDir, err := os.MkdirTemp("", "pull-empty")
	assert.NoError(t, err)
	defer os.RemoveAll(tmpDir)

	_, err = c.PullChart(ctx, "bad-repo", "chart", "1.0.0", tmpDir)
	assert.Error(t, err)
}
