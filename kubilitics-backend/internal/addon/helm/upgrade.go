package helm

import (
	"context"
	"fmt"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chartutil"
	"helm.sh/helm/v3/pkg/release"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/tracing"
)

// Upgrade runs a Helm upgrade using the SDK. ChartRef must be "repoURL|chartName".
// If ReuseValues is true, current release values are fetched and merged with req.Values.
// Previous revision is recorded from history before upgrade.
func (c *helmClientImpl) Upgrade(ctx context.Context, req UpgradeRequest) (*UpgradeResult, error) {
	ctx, span := tracing.StartSpanWithAttributes(ctx, "helm.upgrade",
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

	vals := req.Values
	if vals == nil {
		vals = make(map[string]interface{})
	}
	if req.ReuseValues {
		getValues := action.NewGetValues(cfg)
		currentVals, err := getValues.Run(req.ReleaseName)
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
			return nil, fmt.Errorf("get current values: %w", err)
		}
		for k, v := range req.Values {
			currentVals[k] = v
		}
		vals, err = chartutil.CoalesceValues(chart, currentVals)
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
			return nil, fmt.Errorf("coalesce values: %w", err)
		}
	} else {
		var coalesceErr error
		vals, coalesceErr = chartutil.CoalesceValues(chart, vals)
		if coalesceErr != nil {
			span.RecordError(coalesceErr)
			span.SetStatus(codes.Error, coalesceErr.Error())
			return nil, fmt.Errorf("coalesce values: %w", coalesceErr)
		}
	}

	hist := action.NewHistory(cfg)
	hist.Max = 1
	prevReleases, err := hist.Run(req.ReleaseName)
	if err == nil && len(prevReleases) > 0 {
		_ = prevReleases // previous revision is in rel.Version after upgrade
	}

	upgradeAction := action.NewUpgrade(cfg)
	upgradeAction.Namespace = req.Namespace
	upgradeAction.Wait = req.Wait
	upgradeAction.Timeout = req.Timeout
	upgradeAction.Atomic = req.Atomic
	upgradeAction.ReuseValues = false // we already merged above

	rel, err := upgradeAction.RunWithContext(ctx, req.ReleaseName, chart, vals)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, fmt.Errorf("upgrade: %w", err)
	}
	span.SetAttributes(attribute.Int("helm.revision", rel.Version))
	return releaseToUpgradeResult(rel, prevReleases), nil
}

func releaseToUpgradeResult(rel *release.Release, prevReleases []*release.Release) *UpgradeResult {
	if rel == nil {
		return nil
	}
	out := &UpgradeResult{
		ReleaseName:      rel.Name,
		Namespace:        rel.Namespace,
		Manifest:         rel.Manifest,
		Revision:         rel.Version,
		PreviousRevision: rel.Version - 1,
	}
	if rel.Info != nil {
		out.Status = rel.Info.Status.String()
		out.DeployedAt = rel.Info.LastDeployed.Time
		if out.DeployedAt.IsZero() {
			out.DeployedAt = rel.Info.FirstDeployed.Time
		}
	}
	if len(prevReleases) > 0 {
		out.PreviousRevision = prevReleases[0].Version
	}
	return out
}
