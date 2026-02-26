package helm

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/release"
)

const historyMaxRevisions = 20

// History returns release history as HelmReleaseRevision; ValuesHash is sha256 of marshalled values.
func (c *helmClientImpl) History(ctx context.Context, releaseName, namespace string) ([]models.HelmReleaseRevision, error) {
	_ = ctx
	cfg, err := c.newActionConfig(namespace)
	if err != nil {
		return nil, err
	}
	hist := action.NewHistory(cfg)
	hist.Max = historyMaxRevisions
	releases, err := hist.Run(releaseName)
	if err != nil {
		return nil, fmt.Errorf("history: %w", err)
	}
	out := make([]models.HelmReleaseRevision, 0, len(releases))
	for _, r := range releases {
		out = append(out, releaseToRevision(r))
	}
	return out, nil
}

func releaseToRevision(rel *release.Release) models.HelmReleaseRevision {
	rev := models.HelmReleaseRevision{
		Revision:     rel.Version,
		Status:       "",
		ChartVersion: "",
		Description:  "",
		ValuesHash:   valuesHash(rel.Config),
	}
	if rel.Info != nil {
		rev.Status = rel.Info.Status.String()
		rev.Description = rel.Info.Description
		rev.DeployedAt = rel.Info.LastDeployed.Time
		if rev.DeployedAt.IsZero() {
			rev.DeployedAt = rel.Info.FirstDeployed.Time
		}
	}
	if rel.Chart != nil && rel.Chart.Metadata != nil {
		rev.ChartVersion = rel.Chart.Metadata.Version
	}
	return rev
}

// valuesHash returns a deterministic sha256 hex of the values map (sorted keys).
func valuesHash(vals map[string]interface{}) string {
	if len(vals) == 0 {
		return ""
	}
	// Marshal with sorted keys for determinism
	keys := make([]string, 0, len(vals))
	for k := range vals {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	m := make(map[string]interface{}, len(vals))
	for _, k := range keys {
		m[k] = vals[k]
	}
	data, err := json.Marshal(m)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
