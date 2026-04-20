package rest

import (
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// summaryCache stores the last successful GetClusterSummary response per
// (clusterID, project-filter) so a transient apiserver blip never flashes
// every counter back to zero. The cache is process-lifetime — entries are
// only ever replaced on the next successful fetch, never expired — because
// a slightly stale count is always more useful to an operator than a wall
// of zeros.
//
// Key format: clusterID + "|" + projectID (projectID empty for whole-cluster
// view). Mirrors the topology cache pattern already used in this package.
var summaryCache sync.Map

type summaryCacheEntry struct {
	summary *models.ClusterSummary
	savedAt time.Time
}

func summaryCacheKey(clusterID, projectID string) string {
	return clusterID + "|" + projectID
}

// summaryCacheGet returns the cached summary for this key (or nil if missing).
// The returned value is a shallow copy with Stale=true and StaleAsOf set.
func summaryCacheGet(clusterID, projectID string) *models.ClusterSummary {
	v, ok := summaryCache.Load(summaryCacheKey(clusterID, projectID))
	if !ok {
		return nil
	}
	e, ok := v.(summaryCacheEntry)
	if !ok || e.summary == nil {
		return nil
	}
	out := *e.summary // copy
	out.Stale = true
	savedAt := e.savedAt
	out.StaleAsOf = &savedAt
	out.Reachable = false
	return &out
}

// unreachableSummary is the zero-filled fallback returned when the cluster
// is unreachable AND no cached snapshot exists yet. Reachable=false tells
// the frontend to render an "unreachable" indicator rather than treat the
// zeros as "empty but healthy".
func unreachableSummary(clusterID string, cause error) *models.ClusterSummary {
	msg := ""
	if cause != nil {
		msg = cause.Error()
	}
	return &models.ClusterSummary{
		ID:           clusterID,
		Name:         clusterID,
		Reachable:    false,
		ErrorMessage: msg,
		HealthStatus: "unreachable",
	}
}

// summaryCachePut stores a successful summary for later reuse on failure.
func summaryCachePut(clusterID, projectID string, s *models.ClusterSummary) {
	if s == nil {
		return
	}
	// Defensive copy so later mutation in the handler can't race against readers.
	cp := *s
	cp.Stale = false
	cp.StaleAsOf = nil
	cp.Reachable = true
	cp.ErrorMessage = ""
	summaryCache.Store(summaryCacheKey(clusterID, projectID), summaryCacheEntry{
		summary: &cp,
		savedAt: time.Now(),
	})
}
