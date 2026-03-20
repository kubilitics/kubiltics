package helm

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNewOCIClient(t *testing.T) {
	client, err := NewOCIClient(nil)
	assert.NoError(t, err)
	assert.NotNil(t, client)
}

func TestOCIClient_PullFromOCI_ErrorPaths(t *testing.T) {
	ctx := context.Background()
	client, err := NewOCIClient(nil)
	assert.NoError(t, err)

	tmpDir, err := os.MkdirTemp("", "oci-pull")
	assert.NoError(t, err)
	defer os.RemoveAll(tmpDir)

	// Since we mock the environment and don't have a real docker daemon/registry listening,
	// this pull will fail. We are just ensuring it properly returns the error.
	_, err = client.PullFromOCI(ctx, "oci://invalid.example.com/mychart", "1.0.0", tmpDir)
	assert.Error(t, err)
}

func TestOCIClient_PushToOCI_ErrorPaths(t *testing.T) {
	ctx := context.Background()
	client, err := NewOCIClient(nil)
	assert.NoError(t, err)

	tmpDir, err := os.MkdirTemp("", "oci-push")
	assert.NoError(t, err)
	defer os.RemoveAll(tmpDir)

	chartArchive := filepath.Join(tmpDir, "fake-var")
	err = os.WriteFile(chartArchive, []byte("fake chart data"), 0644)
	assert.NoError(t, err)

	err = client.PushToOCI(ctx, chartArchive, "oci://invalid.example.com/mychart:1.0.0")
	assert.Error(t, err)

	// Test missing file
	err = client.PushToOCI(ctx, "non-existent-file.tgz", "oci://invalid.example.com/mychart:1.0.0")
	assert.Error(t, err)
}
