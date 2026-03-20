package helm

import (
	"context"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/release"
)

// Status returns the current status of a release.
func (c *helmClientImpl) Status(ctx context.Context, releaseName, namespace string) (*ReleaseStatus, error) {
	_ = ctx
	cfg, err := c.newActionConfig(namespace)
	if err != nil {
		return nil, err
	}
	statusAction := action.NewStatus(cfg)
	rel, err := statusAction.Run(releaseName)
	if err != nil {
		return nil, fmt.Errorf("status: %w", err)
	}
	return releaseToStatus(rel), nil
}

// ListReleases lists Helm releases in the namespace (empty = all namespaces).
func (c *helmClientImpl) ListReleases(ctx context.Context, namespace string) ([]*models.HelmReleaseInfo, error) {
	_ = ctx
	cfg, err := c.newActionConfig(namespace)
	if err != nil {
		return nil, err
	}
	listAction := action.NewList(cfg)
	listAction.AllNamespaces = namespace == ""
	listAction.All = true
	releases, err := listAction.Run()
	if err != nil {
		return nil, fmt.Errorf("list releases: %w", err)
	}
	if namespace != "" {
		filtered := make([]*release.Release, 0, len(releases))
		for _, r := range releases {
			if r.Namespace == namespace {
				filtered = append(filtered, r)
			}
		}
		releases = filtered
	}
	out := make([]*models.HelmReleaseInfo, 0, len(releases))
	for _, r := range releases {
		out = append(out, releaseToHelmReleaseInfo(r))
	}
	return out, nil
}

func releaseToStatus(rel *release.Release) *ReleaseStatus {
	if rel == nil {
		return nil
	}
	out := &ReleaseStatus{
		ReleaseName:  rel.Name,
		Namespace:    rel.Namespace,
		Revision:     rel.Version,
		ChartVersion: "",
		AppVersion:   "",
		Description:  "",
	}
	if rel.Info != nil {
		out.Status = rel.Info.Status.String()
		out.Description = rel.Info.Description
		out.DeployedAt = rel.Info.LastDeployed.Time
		if out.DeployedAt.IsZero() {
			out.DeployedAt = rel.Info.FirstDeployed.Time
		}
	}
	if rel.Chart != nil && rel.Chart.Metadata != nil {
		out.ChartVersion = rel.Chart.Metadata.Version
		out.AppVersion = rel.Chart.Metadata.AppVersion
	}
	out.Manifest = rel.Manifest
	return out
}

func releaseToHelmReleaseInfo(rel *release.Release) *models.HelmReleaseInfo {
	if rel == nil {
		return nil
	}
	info := &models.HelmReleaseInfo{
		Name:         rel.Name,
		Namespace:    rel.Namespace,
		Revision:     rel.Version,
		Status:       "",
		ChartName:    "",
		ChartVersion: "",
		Description:  "",
	}
	if rel.Info != nil {
		info.Status = rel.Info.Status.String()
		info.Description = rel.Info.Description
		info.DeployedAt = rel.Info.LastDeployed.Time
		if info.DeployedAt.IsZero() {
			info.DeployedAt = rel.Info.FirstDeployed.Time
		}
	}
	if rel.Chart != nil && rel.Chart.Metadata != nil {
		info.ChartName = rel.Chart.Metadata.Name
		info.ChartVersion = rel.Chart.Metadata.Version
	}
	return info
}
