package helm

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/getter"
	"helm.sh/helm/v3/pkg/helmpath"
	"helm.sh/helm/v3/pkg/repo"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/tracing"
)

// AddOrUpdateRepo adds or updates a chart repository by name and URL.
// It fetches and caches the index via the Helm SDK. The entry is stored
// in the client's in-memory repo.File. Required before chart lookup;
// Install and DryRun call resolveChartRef which may pull from this repo.
func (c *helmClientImpl) AddOrUpdateRepo(ctx context.Context, repoName, repoURL string) error {
	ctx, span := tracing.StartSpanWithAttributes(ctx, "helm.add_repo",
		attribute.String("helm.repo_name", repoName),
		attribute.String("helm.repo_url", repoURL),
	)
	defer span.End()
	_ = ctx

	c.repoMu.Lock()
	defer c.repoMu.Unlock()

	entry := &repo.Entry{Name: repoName, URL: repoURL}
	if existing := c.repoFile.Get(repoName); existing != nil {
		c.repoFile.Update(entry)
	} else {
		c.repoFile.Add(entry)
	}

	// Helm's NewChartRepository uses helmpath.CachePath("repository").
	// Use per-client cache by setting HELM_CACHE_HOME for this call.
	oldCache := os.Getenv(helmpath.CacheHomeEnvVar)
	os.Setenv(helmpath.CacheHomeEnvVar, c.repoCachePath)
	defer os.Setenv(helmpath.CacheHomeEnvVar, oldCache)

	chartRepo, err := repo.NewChartRepository(entry, getter.All(c.envSettings))
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return fmt.Errorf("new chart repository %q: %w", repoName, err)
	}
	if _, err := chartRepo.DownloadIndexFile(); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return fmt.Errorf("download index for %q: %w", repoName, err)
	}
	return nil
}

// PullChart downloads a chart from repoURL at the given version into destDir.
// Uses the Helm SDK Pull action with RepoURL, Version, DestDir, Untar=false.
// Returns the path to the downloaded chart archive (.tgz).
func (c *helmClientImpl) PullChart(ctx context.Context, repoURL, chartName, version, destDir string) (string, error) {
	_ = ctx
	cfg, err := c.newActionConfig("default")
	if err != nil {
		return "", err
	}
	pull := action.NewPullWithOpts(action.WithConfig(cfg))
	pull.Settings = c.envSettings
	pull.RepoURL = repoURL
	pull.Version = version
	pull.DestDir = destDir
	pull.Untar = false

	_, err = pull.Run(chartName)
	if err != nil {
		return "", fmt.Errorf("helm pull %q: %w", chartName, err)
	}
	// Run returns (out string, err). When Untar is false, the chart is at destDir/chartName-version.tgz.
	// The downloader actually writes to destDir and returns the path in the first return value in some code paths.
	// Check Helm Run again: when Untar is false it returns out.String(), nil and saved path is in c.DownloadTo.
	// So we need to find the file. The downloader's DownloadTo returns (saved, version, err). So we don't get
	// the path from Run. We have to construct it: filepath.Join(destDir, chartName+"-"+version+".tgz") or
	// the version might have a 'v' prefix. Actually the chart name in the URL might be different. Let me check
	// the Pull Run code again - it calls c.DownloadTo(chartRef, p.Version, dest). DownloadTo returns the path.
	// So the first return value of Run when Untar is false - let me look at the code again.
	// return out.String(), nil at the end - so it returns the output string, not the path. So we need to
	// look for the file in destDir. The downloader writes to dest with a filename. So we'll list the dir
	// or use a known pattern. Actually in the Helm source, when Untar is false, saved is the path returned
	// from DownloadTo - but Run returns out.String(), nil. So we don't get the path. We have to glob
	// destDir for *.tgz or chartName*.tgz.
	entries, err := os.ReadDir(destDir)
	if err != nil {
		return "", fmt.Errorf("read dest dir: %w", err)
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if filepath.Ext(name) == ".tgz" {
			return filepath.Join(destDir, name), nil
		}
	}
	return "", fmt.Errorf("no chart archive found in %s after pull", destDir)
}

// resolveChartRef fetches the chart from repoURL (adding the repo if needed),
// pulls it to a temp directory, loads it, and returns a *chart.Chart ready for install.
// Combines repo fetch and local load; used by Install and DryRun before chart resolution.
// If repoURL is an OCI ref (oci://...), uses OCIClient.PullFromOCI instead of HTTP repo.
func (c *helmClientImpl) resolveChartRef(ctx context.Context, repoURL, chartName, version string) (*chart.Chart, error) {
	ctx, span := tracing.StartSpanWithAttributes(ctx, "helm.resolve_chart",
		attribute.String("helm.chart", chartName),
		attribute.String("helm.chart_version", version),
		attribute.String("helm.repo_url", repoURL),
	)
	defer span.End()

	destDir, err := os.MkdirTemp(c.repoCachePath, "chart-")
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, fmt.Errorf("create chart temp dir: %w", err)
	}
	defer os.RemoveAll(destDir)

	var chartPath string
	if IsOCIRef(repoURL) {
		if c.ociClient == nil {
			err := fmt.Errorf("OCI ref %q not supported: OCI client unavailable", repoURL)
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
			return nil, err
		}
		fullRef := strings.TrimSuffix(repoURL, "/") + "/" + chartName
		chartPath, err = c.ociClient.PullFromOCI(ctx, fullRef, version, destDir)
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
			return nil, err
		}
	} else {
		chartPath, err = c.PullChart(ctx, repoURL, chartName, version, destDir)
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
			return nil, err
		}
	}
	ch, err := loader.Load(chartPath)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, fmt.Errorf("load chart from %s: %w", chartPath, err)
	}
	return ch, nil
}
