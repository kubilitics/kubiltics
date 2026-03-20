package helm

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"helm.sh/helm/v3/pkg/release"
	helmtime "helm.sh/helm/v3/pkg/time"
)

func TestReleaseToUpgradeResult(t *testing.T) {
	// Nil release
	res := releaseToUpgradeResult(nil, nil)
	assert.Nil(t, res)

	now := time.Now()
	// Real release without previous
	rel := &release.Release{
		Name:      "myrel",
		Namespace: "default",
		Manifest:  "kind: Pod",
		Version:   2,
		Info: &release.Info{
			Status:       release.StatusDeployed,
			LastDeployed: helmtime.Time{Time: now},
		},
	}
	res = releaseToUpgradeResult(rel, nil)
	assert.NotNil(t, res)
	assert.Equal(t, "myrel", res.ReleaseName)
	assert.Equal(t, 2, res.Revision)
	assert.Equal(t, 1, res.PreviousRevision) // fallback to Version-1
	assert.Equal(t, now, res.DeployedAt)

	// With previous releases
	prev := []*release.Release{
		{Version: 1},
	}
	res = releaseToUpgradeResult(rel, prev)
	assert.NotNil(t, res)
	assert.Equal(t, 1, res.PreviousRevision)
}
