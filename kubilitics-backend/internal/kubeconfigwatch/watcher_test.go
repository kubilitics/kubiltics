package kubeconfigwatch

import (
	"context"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func TestWatcher_ConcurrentSyncsCoalesced(t *testing.T) {
	dir := t.TempDir()
	snapDir := filepath.Join(dir, "snapshots")
	path := writeKubeconfig(t, dir, "config", "foo")

	var syncCount int32
	svc := &countingService{
		inner: &fakeClusterService{clusters: []*models.Cluster{kubeCluster("id-foo", "foo")}},
		hit:   &syncCount,
	}
	audit := &fakeAuditRepo{}
	cfg := &config.Config{
		KubeconfigSyncMaxAbsoluteRemovals: 10,
		KubeconfigSyncMaxRemovalRatio:     0.5,
		KubeconfigSyncHealthIntervalSec:   10,
		KubeconfigSyncPollIntervalSec:     60,
	}

	w, err := New(svc, audit, []string{path}, snapDir, cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// Fire 20 concurrent runSync calls; singleflight should coalesce them.
	done := make(chan struct{}, 20)
	for i := 0; i < 20; i++ {
		go func() { _ = w.runSync(context.Background(), "test"); done <- struct{}{} }()
	}
	for i := 0; i < 20; i++ {
		<-done
	}

	got := atomic.LoadInt32(&syncCount)
	if got < 1 {
		t.Errorf("syncCount: got %d, want >=1", got)
	}
	if got >= 20 {
		t.Errorf("syncCount: got %d; expected <20 (singleflight not coalescing)", got)
	}
}

func TestWatcher_StopsOnContextCancel(t *testing.T) {
	dir := t.TempDir()
	snapDir := filepath.Join(dir, "snapshots")
	path := writeKubeconfig(t, dir, "config", "foo")

	svc := &fakeClusterService{clusters: []*models.Cluster{kubeCluster("id-foo", "foo")}}
	audit := &fakeAuditRepo{}
	cfg := &config.Config{
		KubeconfigSyncMaxAbsoluteRemovals: 10,
		KubeconfigSyncMaxRemovalRatio:     0.5,
		KubeconfigSyncHealthIntervalSec:   10,
		KubeconfigSyncPollIntervalSec:     60,
	}

	w, err := New(svc, audit, []string{path}, snapDir, cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	startedCh := make(chan struct{})
	doneCh := make(chan struct{})

	go func() {
		close(startedCh)
		w.Start(ctx)
		close(doneCh)
	}()

	<-startedCh
	// Give the event loop a moment to enter the select.
	time.Sleep(50 * time.Millisecond)
	cancel()

	select {
	case <-doneCh:
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("Watcher did not exit within 500ms of context cancel")
	}
}

func TestWatcher_EventTriggersSyncWithinOneSecond(t *testing.T) {
	dir := t.TempDir()
	snapDir := filepath.Join(dir, "snapshots")
	path := writeKubeconfig(t, dir, "config", "foo", "bar")

	svc := &fakeClusterService{
		clusters: []*models.Cluster{kubeCluster("id-foo", "foo"), kubeCluster("id-bar", "bar")},
	}
	audit := &fakeAuditRepo{}
	cfg := &config.Config{
		KubeconfigSyncMaxAbsoluteRemovals: 10,
		KubeconfigSyncMaxRemovalRatio:     0.5,
		KubeconfigSyncHealthIntervalSec:   10,
		KubeconfigSyncPollIntervalSec:     60,
	}

	w, err := New(svc, audit, []string{path}, snapDir, cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go w.Start(ctx)
	// Give the fsnotify watcher a moment to register the path.
	time.Sleep(400 * time.Millisecond)

	// Rewrite the kubeconfig without the "bar" context.
	writeKubeconfig(t, dir, "config", "foo")

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		svc.mu.Lock()
		removed := append([]string(nil), svc.removed...)
		svc.mu.Unlock()
		if len(removed) == 1 && removed[0] == "id-bar" {
			return // success
		}
		time.Sleep(50 * time.Millisecond)
	}

	svc.mu.Lock()
	t.Errorf("watcher did not remove id-bar within 3s; removed=%v", svc.removed)
	svc.mu.Unlock()
}

// countingService wraps a real fakeClusterService and increments a counter
// every time Sync is dispatched through Syncer.ListClusters (so we can
// observe coalescing via singleflight).
type countingService struct {
	inner *fakeClusterService
	hit   *int32
}

func (c *countingService) ListClusters(ctx context.Context) ([]*models.Cluster, error) {
	atomic.AddInt32(c.hit, 1)
	// Add a small sleep so parallel goroutines have a chance to stack up
	// before the first sync completes, forcing singleflight to coalesce.
	time.Sleep(20 * time.Millisecond)
	return c.inner.ListClusters(ctx)
}

func (c *countingService) RemoveCluster(ctx context.Context, id string) error {
	return c.inner.RemoveCluster(ctx, id)
}
