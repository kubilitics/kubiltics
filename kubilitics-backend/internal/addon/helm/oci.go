package helm

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"helm.sh/helm/v3/pkg/registry"
)

// OCIClient wraps the Helm registry client for OCI chart pull/push.
// Used for oci:// refs in resolveChartRef and for packaging CORE add-ons into air-gapped bundles.
type OCIClient struct {
	registry *registry.Client
	logger   *slog.Logger
}

// NewOCIClient creates an OCI registry client with default options
// (credentials from helm config, cache enabled). Logger may be nil.
func NewOCIClient(logger *slog.Logger) (*OCIClient, error) {
	if logger == nil {
		logger = slog.Default()
	}
	reg, err := registry.NewClient()
	if err != nil {
		return nil, fmt.Errorf("helm registry client: %w", err)
	}
	return &OCIClient{registry: reg, logger: logger}, nil
}

// IsOCIRef reports whether ref is an OCI chart reference (oci://...).
func IsOCIRef(ref string) bool {
	return strings.HasPrefix(ref, "oci://")
}

// PullFromOCI pulls a chart from an OCI registry into destDir.
// ref is the full OCI ref without tag (e.g. oci://registry.example.com/repo/chart);
// version is the tag (e.g. 1.0.0). Returns the path to the downloaded .tgz file.
func (o *OCIClient) PullFromOCI(ctx context.Context, ref, version, destDir string) (string, error) {
	_ = ctx // registry.Client.Pull does not accept context; use for future opts
	chartRef := ref
	if version != "" && !strings.Contains(ref, ":") {
		chartRef = ref + ":" + version
	}
	result, err := o.registry.Pull(chartRef)
	if err != nil {
		return "", fmt.Errorf("oci pull %s: %w", chartRef, err)
	}
	if result.Chart == nil || len(result.Chart.Data) == 0 {
		return "", fmt.Errorf("oci pull %s: no chart data", chartRef)
	}
	name := "chart"
	if result.Chart.Meta != nil {
		name = result.Chart.Meta.Name
		if result.Chart.Meta.Version != "" {
			name = name + "-" + result.Chart.Meta.Version
		}
	}
	if !strings.HasSuffix(name, ".tgz") {
		name = name + ".tgz"
	}
	path := filepath.Join(destDir, name)
	if err := os.WriteFile(path, result.Chart.Data, 0644); err != nil {
		return "", fmt.Errorf("write oci chart to %s: %w", path, err)
	}
	return path, nil
}

// PushToOCI pushes a chart archive (chartPath) to an OCI ref (e.g. oci://registry.example.com/repo/chart:1.0.0).
// Used for packaging CORE add-ons into air-gapped bundles.
func (o *OCIClient) PushToOCI(ctx context.Context, chartPath, ref string) error {
	_ = ctx
	data, err := os.ReadFile(chartPath)
	if err != nil {
		return fmt.Errorf("read chart %s: %w", chartPath, err)
	}
	_, err = o.registry.Push(data, ref)
	if err != nil {
		return fmt.Errorf("oci push %s: %w", ref, err)
	}
	return nil
}
