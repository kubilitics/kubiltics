package helm

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/release"
	helmtime "helm.sh/helm/v3/pkg/time"
)

func TestReleaseToStatus(t *testing.T) {
	rel := &release.Release{
		Name:      "test-release",
		Namespace: "default",
		Version:   5,
		Info: &release.Info{
			Status:        release.StatusDeployed,
			Description:   "Install complete",
			FirstDeployed: helmtime.Now(),
			LastDeployed:  helmtime.Now(),
		},
		Manifest: "kind: Pod",
		Chart: &chart.Chart{
			Metadata: &chart.Metadata{
				Version:    "1.2.3",
				AppVersion: "2.0.0",
			},
		},
	}

	status := releaseToStatus(rel)
	assert.NotNil(t, status)
	assert.Equal(t, "test-release", status.ReleaseName)
	assert.Equal(t, "deployed", status.Status)
	assert.Equal(t, "1.2.3", status.ChartVersion)
	assert.Equal(t, "2.0.0", status.AppVersion)

	assert.Nil(t, releaseToStatus(nil))
}

func TestReleaseToHelmReleaseInfo(t *testing.T) {
	rel := &release.Release{
		Name:      "test-release",
		Namespace: "default",
		Version:   5,
		Info: &release.Info{
			Status:        release.StatusDeployed,
			Description:   "Install complete",
			FirstDeployed: helmtime.Now(),
		},
		Chart: &chart.Chart{
			Metadata: &chart.Metadata{
				Name:    "my-chart",
				Version: "1.2.3",
			},
		},
	}

	info := releaseToHelmReleaseInfo(rel)
	assert.NotNil(t, info)
	assert.Equal(t, "test-release", info.Name)
	assert.Equal(t, "my-chart", info.ChartName)
	assert.Equal(t, "1.2.3", info.ChartVersion)
	assert.Equal(t, "deployed", info.Status)
	assert.NotEmpty(t, info.DeployedAt)

	assert.Nil(t, releaseToHelmReleaseInfo(nil))
}
