package helm

import (
	"context"
	"fmt"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chartutil"
	"helm.sh/helm/v3/pkg/release"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/tracing"
)

// ChartRefFormat is the convention for InstallRequest.ChartRef and UpgradeRequest.ChartRef:
// "repoURL|chartName" so the caller can pass addon HelmRepoURL + "|" + addon HelmChart.
const ChartRefFormat = "repoURL|chartName"

func parseChartRef(chartRef string) (repoURL, chartName string, err error) {
	idx := strings.Index(chartRef, "|")
	if idx == -1 {
		return "", "", fmt.Errorf("chart ref must be %q (got %q)", ChartRefFormat, chartRef)
	}
	return strings.TrimSpace(chartRef[:idx]), strings.TrimSpace(chartRef[idx+1:]), nil
}

// Install runs a Helm install using the SDK. ChartRef must be "repoURL|chartName".
// Values are merged with chart defaults via chartutil.CoalesceValues. On success
// the release is deployed; if Atomic is true and install fails, Helm rolls back.
func (c *helmClientImpl) Install(ctx context.Context, req InstallRequest) (*InstallResult, error) {
	ctx, span := tracing.StartSpanWithAttributes(ctx, "helm.install",
		attribute.String("helm.release_name", req.ReleaseName),
		attribute.String("helm.namespace", req.Namespace),
		attribute.String("helm.chart_version", req.Version),
		attribute.String("helm.chart_ref", req.ChartRef),
	)
	defer span.End()

	repoURL, chartName, err := parseChartRef(req.ChartRef)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}
	chart, err := c.resolveChartRef(ctx, repoURL, chartName, req.Version)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, fmt.Errorf("resolve chart: %w", err)
	}

	cfg, err := c.newActionConfig(req.Namespace)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}
	installAction := action.NewInstall(cfg)
	installAction.ReleaseName = req.ReleaseName
	installAction.Namespace = req.Namespace
	installAction.CreateNamespace = req.CreateNamespace
	installAction.Wait = req.Wait
	installAction.Timeout = req.Timeout
	installAction.Atomic = req.Atomic

	vals := req.Values
	if vals == nil {
		vals = make(map[string]interface{})
	}
	coalesced, err := chartutil.CoalesceValues(chart, vals)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, fmt.Errorf("coalesce values: %w", err)
	}

	rel, err := installAction.RunWithContext(ctx, chart, coalesced)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		if req.Atomic {
			return nil, fmt.Errorf("install failed (atomic rollback performed): %w", err)
		}
		return nil, fmt.Errorf("install: %w", err)
	}
	span.SetAttributes(attribute.Int("helm.revision", rel.Version))
	return releaseToInstallResult(rel), nil
}

func releaseToInstallResult(rel *release.Release) *InstallResult {
	if rel == nil {
		return nil
	}
	out := &InstallResult{
		ReleaseName: rel.Name,
		Namespace:   rel.Namespace,
		Manifest:    rel.Manifest,
		Revision:    rel.Version,
	}
	if rel.Info != nil {
		out.Status = rel.Info.Status.String()
		out.DeployedAt = rel.Info.LastDeployed.Time
		if out.DeployedAt.IsZero() {
			out.DeployedAt = rel.Info.FirstDeployed.Time
		}
	}
	// Notes are not stored on release; leave empty or could render from chart.
	return out
}
