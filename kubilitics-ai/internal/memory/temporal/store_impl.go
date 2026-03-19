package temporal

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
)

// Snapshot records a point-in-time state of a subset of the cluster.
type Snapshot struct {
	Timestamp time.Time
	Resources map[string]*pb.Resource // key = "Kind/Namespace/Name"
}

// ChangeEvent records an incremental change to a resource.
type ChangeEvent struct {
	Timestamp  time.Time
	Kind       string
	Namespace  string
	Name       string
	UpdateType string // ADDED, MODIFIED, DELETED
	Before     *pb.Resource
	After      *pb.Resource
}

// temporalStoreImpl is the ring-buffer based TemporalStore implementation.
type temporalStoreImpl struct {
	mu sync.RWMutex

	// Ring buffer of snapshots (fixed capacity)
	snapshots []*Snapshot
	head      int // index of oldest snapshot
	size      int // current number of snapshots
	capacity  int // max snapshots to keep

	// Change events between snapshots
	changes []*ChangeEvent

	// Snapshot interval
	snapshotInterval time.Duration
	maxChanges       int

	// External snapshot source (set by Sync())
	getResources func(ctx context.Context) ([]*pb.Resource, error)

	// Background ticker
	tickerStop chan struct{}
}

// NewTemporalStore creates a new temporal store with ring buffer.
func NewTemporalStore() TemporalStore {
	ts := &temporalStoreImpl{
		capacity:         48, // 48 hourly snapshots = 2 days
		snapshotInterval: time.Hour,
		maxChanges:       10000,
		snapshots:        make([]*Snapshot, 48),
		changes:          make([]*ChangeEvent, 0, 10000),
		tickerStop:       make(chan struct{}),
	}
	return ts
}

// NewTemporalStoreWithSource creates a temporal store that auto-snapshots from a source.
func NewTemporalStoreWithSource(getResources func(ctx context.Context) ([]*pb.Resource, error)) *temporalStoreImpl {
	ts := NewTemporalStore().(*temporalStoreImpl)
	ts.getResources = getResources
	go ts.backgroundSnapshotter()
	return ts
}

// backgroundSnapshotter takes periodic snapshots.
func (ts *temporalStoreImpl) backgroundSnapshotter() {
	ticker := time.NewTicker(ts.snapshotInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			_ = ts.SnapshotNow(context.Background())
		case <-ts.tickerStop:
			return
		}
	}
}

// RecordChange records an incremental change event (called by synchronizer).
func (ts *temporalStoreImpl) RecordChange(updateType string, before, after *pb.Resource) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	var res *pb.Resource
	if after != nil {
		res = after
	} else {
		res = before
	}
	if res == nil {
		return
	}

	evt := &ChangeEvent{
		Timestamp:  time.Now(),
		Kind:       res.Kind,
		Namespace:  res.Namespace,
		Name:       res.Name,
		UpdateType: updateType,
		Before:     before,
		After:      after,
	}

	// Trim oldest if at capacity
	if len(ts.changes) >= ts.maxChanges {
		ts.changes = ts.changes[ts.maxChanges/10:]
	}
	ts.changes = append(ts.changes, evt)
}

// SnapshotNow creates a snapshot of current cluster state.
func (ts *temporalStoreImpl) SnapshotNow(ctx context.Context) error {
	if ts.getResources == nil {
		return nil // no source configured
	}
	resources, err := ts.getResources(ctx)
	if err != nil {
		return fmt.Errorf("snapshot: fetch resources: %w", err)
	}

	snap := &Snapshot{
		Timestamp: time.Now(),
		Resources: make(map[string]*pb.Resource, len(resources)),
	}
	for _, r := range resources {
		key := resourceKey(r.Kind, r.Namespace, r.Name)
		snap.Resources[key] = r
	}

	ts.mu.Lock()
	defer ts.mu.Unlock()
	ts.addSnapshotLocked(snap)
	return nil
}

// AddSnapshotDirect allows the synchronizer to inject snapshots directly.
func (ts *temporalStoreImpl) AddSnapshotDirect(resources []*pb.Resource) {
	snap := &Snapshot{
		Timestamp: time.Now(),
		Resources: make(map[string]*pb.Resource, len(resources)),
	}
	for _, r := range resources {
		snap.Resources[resourceKey(r.Kind, r.Namespace, r.Name)] = r
	}
	ts.mu.Lock()
	ts.addSnapshotLocked(snap)
	ts.mu.Unlock()
}

func (ts *temporalStoreImpl) addSnapshotLocked(snap *Snapshot) {
	idx := (ts.head + ts.size) % ts.capacity
	ts.snapshots[idx] = snap
	if ts.size < ts.capacity {
		ts.size++
	} else {
		// Overwrite oldest: advance head
		ts.head = (ts.head + 1) % ts.capacity
	}
}

// GetResourceAt returns resource state at a specific point in time.
func (ts *temporalStoreImpl) GetResourceAt(ctx context.Context, namespace, kind, name string, timestamp interface{}) (interface{}, error) {
	t, err := toTime(timestamp)
	if err != nil {
		return nil, err
	}

	ts.mu.RLock()
	defer ts.mu.RUnlock()

	// Find the snapshot closest to (but not after) the requested time
	snap := ts.snapshotAtOrBeforeLocked(t)
	if snap == nil {
		return nil, fmt.Errorf("no snapshot available at %v (outside retention window)", t)
	}

	key := resourceKey(kind, namespace, name)
	r, ok := snap.Resources[key]
	if !ok {
		return nil, fmt.Errorf("resource %s not found in snapshot at %v", key, snap.Timestamp)
	}
	return r, nil
}

// GetChangesInRange returns all changes to a resource in a time range.
func (ts *temporalStoreImpl) GetChangesInRange(ctx context.Context, namespace, kind, name string, startTime, endTime interface{}) ([]interface{}, error) {
	start, err := toTime(startTime)
	if err != nil {
		return nil, err
	}
	end, err := toTime(endTime)
	if err != nil {
		return nil, err
	}

	ts.mu.RLock()
	defer ts.mu.RUnlock()

	var results []interface{}
	for _, evt := range ts.changes {
		if evt.Kind != kind || evt.Namespace != namespace || evt.Name != name {
			continue
		}
		if evt.Timestamp.Before(start) || evt.Timestamp.After(end) {
			continue
		}
		results = append(results, map[string]interface{}{
			"timestamp":   evt.Timestamp,
			"update_type": evt.UpdateType,
			"kind":        evt.Kind,
			"namespace":   evt.Namespace,
			"name":        evt.Name,
			"before":      resourceSummary(evt.Before),
			"after":       resourceSummary(evt.After),
		})
	}
	return results, nil
}

// CompareResourceStates compares resource state at two points in time.
func (ts *temporalStoreImpl) CompareResourceStates(ctx context.Context, namespace, kind, name string, beforeTime, afterTime interface{}) (interface{}, error) {
	beforeR, err := ts.GetResourceAt(ctx, namespace, kind, name, beforeTime)
	if err != nil {
		return nil, fmt.Errorf("before state: %w", err)
	}
	afterR, err := ts.GetResourceAt(ctx, namespace, kind, name, afterTime)
	if err != nil {
		return nil, fmt.Errorf("after state: %w", err)
	}

	beforeJSON, _ := json.Marshal(beforeR)
	afterJSON, _ := json.Marshal(afterR)

	changed := string(beforeJSON) != string(afterJSON)
	return map[string]interface{}{
		"changed":    changed,
		"before":     beforeR,
		"after":      afterR,
		"before_raw": string(beforeJSON),
		"after_raw":  string(afterJSON),
	}, nil
}

// GetClusterSnapshotAt returns full cluster state snapshot at a time.
func (ts *temporalStoreImpl) GetClusterSnapshotAt(ctx context.Context, timestamp interface{}) (interface{}, error) {
	t, err := toTime(timestamp)
	if err != nil {
		return nil, err
	}

	ts.mu.RLock()
	defer ts.mu.RUnlock()

	snap := ts.snapshotAtOrBeforeLocked(t)
	if snap == nil {
		return nil, fmt.Errorf("no snapshot available at %v", t)
	}

	resources := make([]map[string]interface{}, 0, len(snap.Resources))
	for _, r := range snap.Resources {
		resources = append(resources, resourceSummary(r))
	}
	return map[string]interface{}{
		"timestamp":      snap.Timestamp,
		"resource_count": len(snap.Resources),
		"resources":      resources,
	}, nil
}

// GetEventHistory returns all events affecting a resource in a range.
func (ts *temporalStoreImpl) GetEventHistory(ctx context.Context, namespace, kind, name string, startTime, endTime interface{}) ([]interface{}, error) {
	return ts.GetChangesInRange(ctx, namespace, kind, name, startTime, endTime)
}

// FindStateChange finds when a specific state change occurred.
func (ts *temporalStoreImpl) FindStateChange(ctx context.Context, namespace, kind, name, field string, oldValue, newValue interface{}) (interface{}, error) {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	for _, evt := range ts.changes {
		if evt.Kind != kind || evt.Namespace != namespace || evt.Name != name {
			continue
		}
		if evt.UpdateType != "MODIFIED" && evt.UpdateType != "ADDED" {
			continue
		}
		// Simple check: see if after state's field matches newValue
		if evt.After != nil {
			afterMap := resourceSummary(evt.After)
			if afterMap[field] == newValue {
				return map[string]interface{}{
					"found":      true,
					"timestamp":  evt.Timestamp,
					"field":      field,
					"old_value":  oldValue,
					"new_value":  newValue,
					"event_type": evt.UpdateType,
				}, nil
			}
		}
	}
	return map[string]interface{}{
		"found": false,
		"field": field,
	}, nil
}

// GetRetentionWindow returns the current retention time window.
func (ts *temporalStoreImpl) GetRetentionWindow(ctx context.Context) (interface{}, interface{}, error) {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	if ts.size == 0 {
		return nil, nil, fmt.Errorf("no snapshots available")
	}

	oldest := ts.snapshots[ts.head]
	newest := ts.snapshots[(ts.head+ts.size-1)%ts.capacity]
	return oldest.Timestamp, newest.Timestamp, nil
}

// Prune removes change events older than the oldest snapshot.
func (ts *temporalStoreImpl) Prune(ctx context.Context) error {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	if ts.size == 0 {
		ts.changes = ts.changes[:0]
		return nil
	}

	oldest := ts.snapshots[ts.head].Timestamp
	keep := ts.changes[:0]
	for _, evt := range ts.changes {
		if !evt.Timestamp.Before(oldest) {
			keep = append(keep, evt)
		}
	}
	ts.changes = keep
	return nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func (ts *temporalStoreImpl) snapshotAtOrBeforeLocked(t time.Time) *Snapshot {
	var best *Snapshot
	for i := 0; i < ts.size; i++ {
		idx := (ts.head + i) % ts.capacity
		snap := ts.snapshots[idx]
		if snap == nil {
			continue
		}
		if !snap.Timestamp.After(t) {
			best = snap
		}
	}
	return best
}

func resourceKey(kind, namespace, name string) string {
	if namespace == "" {
		return kind + "/" + name
	}
	return kind + "/" + namespace + "/" + name
}

func resourceSummary(r *pb.Resource) map[string]interface{} {
	if r == nil {
		return nil
	}
	m := map[string]interface{}{
		"kind":             r.Kind,
		"namespace":        r.Namespace,
		"name":             r.Name,
		"uid":              r.Uid,
		"resource_version": r.ResourceVersion,
		"labels":           r.Labels,
	}
	// Parse status.phase from Data if available
	if len(r.Data) > 0 {
		var parsed map[string]interface{}
		if err := json.Unmarshal(r.Data, &parsed); err == nil {
			if status, ok := parsed["status"].(map[string]interface{}); ok {
				if phase, ok := status["phase"].(string); ok {
					m["phase"] = phase
				}
			}
		}
	}
	return m
}

func toTime(v interface{}) (time.Time, error) {
	switch t := v.(type) {
	case time.Time:
		return t, nil
	case string:
		parsed, err := time.Parse(time.RFC3339, t)
		if err != nil {
			return time.Time{}, fmt.Errorf("invalid time %q: %w", t, err)
		}
		return parsed, nil
	case int64:
		return time.Unix(t, 0), nil
	case float64:
		return time.Unix(int64(t), 0), nil
	default:
		return time.Time{}, fmt.Errorf("unsupported time type %T", v)
	}
}
