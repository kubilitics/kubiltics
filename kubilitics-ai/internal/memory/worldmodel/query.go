package worldmodel

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
)

// QueryAPI wraps WorldModel with higher-level query methods.
type QueryAPI struct {
	wm      *WorldModel
	changes []changeRecord // recent changes tracked by synchronizer
}

// changeRecord records a resource change with timestamp.
type changeRecord struct {
	Timestamp  time.Time
	UpdateType string
	Resource   *pb.Resource
}

// NewQueryAPI creates a QueryAPI backed by the given WorldModel.
func NewQueryAPI(wm *WorldModel) *QueryAPI {
	return &QueryAPI{
		wm:      wm,
		changes: make([]changeRecord, 0, 1000),
	}
}

// RecordChange records a resource change (called by Synchronizer).
func (q *QueryAPI) RecordChange(updateType string, resource *pb.Resource) {
	if resource == nil {
		return
	}
	rec := changeRecord{
		Timestamp:  time.Now(),
		UpdateType: updateType,
		Resource:   resource,
	}
	// Keep max 1000 recent changes
	if len(q.changes) >= 1000 {
		q.changes = q.changes[100:]
	}
	q.changes = append(q.changes, rec)
}

// GetChangedSince returns resources that changed in the last duration.
// Answers: "what changed in the last 10 minutes?"
func (q *QueryAPI) GetChangedSince(ctx context.Context, since time.Duration) ([]map[string]interface{}, error) {
	threshold := time.Now().Add(-since)
	var results []map[string]interface{}
	for _, rec := range q.changes {
		if rec.Timestamp.Before(threshold) {
			continue
		}
		r := rec.Resource
		results = append(results, map[string]interface{}{
			"timestamp":   rec.Timestamp,
			"update_type": rec.UpdateType,
			"kind":        r.Kind,
			"namespace":   r.Namespace,
			"name":        r.Name,
			"uid":         r.Uid,
		})
	}
	return results, nil
}

// FindResourcesMatchingText finds resources whose labels/name/namespace contain the query string.
// This is a simple text-match query for "find pods similar to this one".
func (q *QueryAPI) FindResourcesMatchingText(ctx context.Context, query string, limit int) ([]*pb.Resource, error) {
	queryLower := strings.ToLower(query)
	terms := strings.Fields(queryLower)
	if len(terms) == 0 {
		return nil, nil
	}

	allResources, err := q.wm.ListResources(ctx, "", "")
	if err != nil {
		return nil, err
	}

	if limit <= 0 {
		limit = 20
	}

	type scored struct {
		r     *pb.Resource
		score int
	}
	var matches []scored

	for _, r := range allResources {
		score := 0
		searchStr := strings.ToLower(r.Kind + " " + r.Namespace + " " + r.Name)
		for k, v := range r.Labels {
			searchStr += " " + strings.ToLower(k) + "=" + strings.ToLower(v)
		}
		for _, term := range terms {
			if strings.Contains(searchStr, term) {
				score++
			}
		}
		if score > 0 {
			matches = append(matches, scored{r: r, score: score})
		}
	}

	// Sort descending by score
	for i := 1; i < len(matches); i++ {
		for j := i; j > 0 && matches[j].score > matches[j-1].score; j-- {
			matches[j], matches[j-1] = matches[j-1], matches[j]
		}
	}

	if len(matches) > limit {
		matches = matches[:limit]
	}

	result := make([]*pb.Resource, 0, len(matches))
	for _, m := range matches {
		result = append(result, m.r)
	}
	return result, nil
}

// GetResourceSummary returns a human-readable summary of a resource.
func (q *QueryAPI) GetResourceSummary(ctx context.Context, kind, namespace, name string) (map[string]interface{}, error) {
	r, err := q.wm.GetResource(ctx, kind, namespace, name)
	if err != nil {
		return nil, err
	}

	summary := map[string]interface{}{
		"kind":             r.Kind,
		"namespace":        r.Namespace,
		"name":             r.Name,
		"uid":              r.Uid,
		"resource_version": r.ResourceVersion,
		"labels":           r.Labels,
		"owner_refs":       ownerRefSummary(r.OwnerRefs),
	}

	// Extract status from Data
	if len(r.Data) > 0 {
		var parsed map[string]interface{}
		if err := json.Unmarshal(r.Data, &parsed); err == nil {
			if status, ok := parsed["status"].(map[string]interface{}); ok {
				summary["status"] = status
			}
		}
	}
	return summary, nil
}

// GetClusterOverview returns a high-level overview of the cluster.
func (q *QueryAPI) GetClusterOverview(ctx context.Context) (map[string]interface{}, error) {
	stats := q.wm.GetStats()

	// Recent changes in last 5 minutes
	recentChanges, _ := q.GetChangedSince(ctx, 5*time.Minute)

	return map[string]interface{}{
		"cluster_stats":   stats,
		"recent_changes":  recentChanges,
		"change_count_5m": len(recentChanges),
	}, nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func ownerRefSummary(refs []*pb.OwnerReference) []map[string]string {
	if len(refs) == 0 {
		return nil
	}
	result := make([]map[string]string, 0, len(refs))
	for _, ref := range refs {
		result = append(result, map[string]string{
			"kind": ref.Kind,
			"name": ref.Name,
			"uid":  ref.Uid,
		})
	}
	return result
}
