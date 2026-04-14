package kubeconfigwatch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// fakeClusterService implements ClusterSyncService for tests.
type fakeClusterService struct {
	mu        sync.Mutex
	clusters  []*models.Cluster
	removed   []string
	removeErr map[string]error // optional per-id failure
}

func (f *fakeClusterService) ListClusters(_ context.Context) ([]*models.Cluster, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]*models.Cluster, len(f.clusters))
	copy(out, f.clusters)
	return out, nil
}

func (f *fakeClusterService) RemoveCluster(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.removeErr != nil {
		if err, ok := f.removeErr[id]; ok {
			return err
		}
	}
	out := f.clusters[:0]
	for _, c := range f.clusters {
		if c.ID != id {
			out = append(out, c)
		}
	}
	f.clusters = out
	f.removed = append(f.removed, id)
	return nil
}

// fakeAuditRepo implements AuditLogRepository for tests.
type fakeAuditRepo struct {
	mu      sync.Mutex
	entries []*models.AuditLogEntry
}

func (f *fakeAuditRepo) CreateAuditLog(_ context.Context, e *models.AuditLogEntry) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	// Copy so the test can inspect it later without racing with producer.
	cp := *e
	f.entries = append(f.entries, &cp)
	return nil
}

func writeKubeconfig(t *testing.T, dir, name string, contexts ...string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	body := "apiVersion: v1\nkind: Config\ncurrent-context: " + firstOrEmpty(contexts) + "\ncontexts:\n"
	for _, c := range contexts {
		body += "  - name: " + c + "\n    context:\n      cluster: " + c + "\n      user: " + c + "\n"
	}
	body += "clusters:\n"
	for _, c := range contexts {
		body += "  - name: " + c + "\n    cluster:\n      server: https://localhost:6443\n"
	}
	body += "users:\n"
	for _, c := range contexts {
		body += "  - name: " + c + "\n    user:\n      token: REDACTED\n"
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	return path
}

func firstOrEmpty(s []string) string {
	if len(s) > 0 {
		return s[0]
	}
	return ""
}

func newSyncFixture(t *testing.T, clusters []*models.Cluster, kubeconfigContexts []string) (*Syncer, *fakeClusterService, *fakeAuditRepo, string) {
	t.Helper()
	dir := t.TempDir()
	snapDir := filepath.Join(dir, "snapshots")
	kubePath := writeKubeconfig(t, dir, "config", kubeconfigContexts...)

	svc := &fakeClusterService{clusters: clusters}
	audit := &fakeAuditRepo{}

	cfg := &config.Config{
		KubeconfigSyncMaxAbsoluteRemovals: 10,
		KubeconfigSyncMaxRemovalRatio:     0.5,
	}

	s := NewSyncer(svc, audit, []string{kubePath}, snapDir, cfg)
	return s, svc, audit, kubePath
}

func kubeCluster(id, contextName string) *models.Cluster {
	return &models.Cluster{
		ID: id, Name: contextName, Context: contextName,
		KubeconfigPath: "/home/user/.kube/config",
		Source:         "kubeconfig",
	}
}

func uploadCluster(id, contextName string) *models.Cluster {
	return &models.Cluster{
		ID: id, Name: contextName, Context: contextName,
		KubeconfigPath: "/home/user/.kubilitics/kubeconfigs/" + contextName + ".yaml",
		Source:         "upload",
	}
}

func TestSync_RemovesOrphanedKubeconfigClusters(t *testing.T) {
	s, svc, _, _ := newSyncFixture(t,
		[]*models.Cluster{kubeCluster("id-foo", "foo"), kubeCluster("id-bar", "bar")},
		[]string{"foo"},
	)

	if err := s.Sync(context.Background(), "test"); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	if len(svc.removed) != 1 || svc.removed[0] != "id-bar" {
		t.Errorf("removed: got %v, want [id-bar]", svc.removed)
	}
}

func TestSync_PreservesUploadedClusters(t *testing.T) {
	s, svc, _, _ := newSyncFixture(t,
		[]*models.Cluster{uploadCluster("id-uploaded", "uploaded-ctx")},
		[]string{"foo"},
	)

	if err := s.Sync(context.Background(), "test"); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	if len(svc.removed) != 0 {
		t.Errorf("removed: got %v, want []", svc.removed)
	}
}

func TestSync_FailsSafeOnMissingKubeconfig(t *testing.T) {
	dir := t.TempDir()
	snapDir := filepath.Join(dir, "snapshots")
	svc := &fakeClusterService{clusters: []*models.Cluster{kubeCluster("id-a", "a"), kubeCluster("id-b", "b")}}
	audit := &fakeAuditRepo{}
	cfg := &config.Config{KubeconfigSyncMaxAbsoluteRemovals: 10, KubeconfigSyncMaxRemovalRatio: 0.5}

	s := NewSyncer(svc, audit, []string{filepath.Join(dir, "nope.yaml")}, snapDir, cfg)

	err := s.Sync(context.Background(), "test")
	if !errors.Is(err, ErrReadFailed) {
		t.Errorf("err: got %v, want ErrReadFailed", err)
	}
	if len(svc.removed) != 0 {
		t.Errorf("removed: got %v, want []", svc.removed)
	}
}

func TestSync_FailsSafeOnMalformedKubeconfig(t *testing.T) {
	dir := t.TempDir()
	snapDir := filepath.Join(dir, "snapshots")
	bad := filepath.Join(dir, "bad.yaml")
	if err := os.WriteFile(bad, []byte("this is not valid: yaml: [[[ garbage"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	svc := &fakeClusterService{clusters: []*models.Cluster{kubeCluster("id-a", "a")}}
	audit := &fakeAuditRepo{}
	cfg := &config.Config{KubeconfigSyncMaxAbsoluteRemovals: 10, KubeconfigSyncMaxRemovalRatio: 0.5}

	s := NewSyncer(svc, audit, []string{bad}, snapDir, cfg)
	err := s.Sync(context.Background(), "test")
	if !errors.Is(err, ErrReadFailed) {
		t.Errorf("err: got %v, want ErrReadFailed", err)
	}
	if len(svc.removed) != 0 {
		t.Errorf("removed: got %v", svc.removed)
	}
}

func TestSync_HandlesMultipleKubeconfigPaths(t *testing.T) {
	dir := t.TempDir()
	snapDir := filepath.Join(dir, "snapshots")
	pathA := writeKubeconfig(t, dir, "a.yaml", "foo")
	pathB := writeKubeconfig(t, dir, "b.yaml", "bar")

	svc := &fakeClusterService{
		clusters: []*models.Cluster{
			kubeCluster("id-foo", "foo"),
			kubeCluster("id-bar", "bar"),
			kubeCluster("id-baz", "baz"),
		},
	}
	audit := &fakeAuditRepo{}
	cfg := &config.Config{KubeconfigSyncMaxAbsoluteRemovals: 10, KubeconfigSyncMaxRemovalRatio: 0.5}

	s := NewSyncer(svc, audit, []string{pathA, pathB}, snapDir, cfg)
	if err := s.Sync(context.Background(), "test"); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	if len(svc.removed) != 1 || svc.removed[0] != "id-baz" {
		t.Errorf("removed: got %v, want [id-baz]", svc.removed)
	}
}

func TestSync_WritesAuditLogOnRemoval(t *testing.T) {
	s, _, audit, _ := newSyncFixture(t,
		[]*models.Cluster{kubeCluster("id-foo", "foo"), kubeCluster("id-bar", "bar")},
		[]string{"foo"},
	)

	if err := s.Sync(context.Background(), "fsnotify_event"); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	if len(audit.entries) != 1 {
		t.Fatalf("audit entries: got %d, want 1", len(audit.entries))
	}
	e := audit.entries[0]
	if e.Action != "cluster_auto_removed" {
		t.Errorf("Action: got %q, want %q", e.Action, "cluster_auto_removed")
	}
	if e.ClusterID == nil || *e.ClusterID != "id-bar" {
		t.Errorf("ClusterID: got %v, want id-bar", e.ClusterID)
	}
	// Details is a JSON-encoded string. Parse it and check the trigger.
	var d map[string]string
	if err := json.Unmarshal([]byte(e.Details), &d); err != nil {
		t.Fatalf("unmarshal details: %v (raw=%q)", err, e.Details)
	}
	if d["trigger"] != "fsnotify_event" {
		t.Errorf("trigger in details: got %v", d)
	}
}

func TestSync_SafetyCapAborts50Percent(t *testing.T) {
	clusters := make([]*models.Cluster, 10)
	for i := 0; i < 10; i++ {
		id := fmt.Sprintf("id-%d", i)
		ctx := fmt.Sprintf("ctx-%d", i)
		clusters[i] = kubeCluster(id, ctx)
	}
	// Kubeconfig has only 4 of the 10 — ratio 0.6 ≥ 0.5 cap.
	s, svc, audit, _ := newSyncFixture(t, clusters, []string{"ctx-0", "ctx-1", "ctx-2", "ctx-3"})

	err := s.Sync(context.Background(), "test")
	if !errors.Is(err, ErrSafetyCapTriggered) {
		t.Errorf("err: got %v, want ErrSafetyCapTriggered", err)
	}
	if len(svc.removed) != 0 {
		t.Errorf("removed despite cap: got %v", svc.removed)
	}
	if len(audit.entries) != 1 || audit.entries[0].Action != "cluster_sync_safety_cap_triggered" {
		t.Errorf("audit entries: got %+v, want one safety_cap entry", audit.entries)
	}
}

func TestSync_SafetyCapAbsoluteThreshold(t *testing.T) {
	clusters := make([]*models.Cluster, 20)
	for i := 0; i < 20; i++ {
		clusters[i] = kubeCluster(fmt.Sprintf("id-%d", i), fmt.Sprintf("ctx-%d", i))
	}
	// Kubeconfig has 9 contexts — 11 orphans ≥ 10 absolute cap.
	s, svc, _, _ := newSyncFixture(t, clusters, []string{
		"ctx-0", "ctx-1", "ctx-2", "ctx-3", "ctx-4", "ctx-5", "ctx-6", "ctx-7", "ctx-8",
	})

	err := s.Sync(context.Background(), "test")
	if !errors.Is(err, ErrSafetyCapTriggered) {
		t.Errorf("err: got %v, want ErrSafetyCapTriggered", err)
	}
	if len(svc.removed) != 0 {
		t.Errorf("removed despite cap: got %d", len(svc.removed))
	}
}

func TestSync_WritesSnapshotBeforeRemoval(t *testing.T) {
	s, _, _, _ := newSyncFixture(t,
		[]*models.Cluster{kubeCluster("id-foo", "foo"), kubeCluster("id-bar", "bar")},
		[]string{"foo"},
	)

	if err := s.Sync(context.Background(), "test"); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	entries, _ := os.ReadDir(s.snapshotDir)
	if len(entries) != 1 {
		t.Errorf("snapshot files: got %d, want 1", len(entries))
	}
}

func TestSync_DoesNotWriteSnapshotWhenNothingToRemove(t *testing.T) {
	s, _, _, _ := newSyncFixture(t,
		[]*models.Cluster{kubeCluster("id-foo", "foo")},
		[]string{"foo"},
	)

	if err := s.Sync(context.Background(), "test"); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	_, err := os.Stat(s.snapshotDir)
	if err == nil {
		// Dir exists — it shouldn't have any snapshot files.
		entries, _ := os.ReadDir(s.snapshotDir)
		var snapCount int
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), "clusters-pre-sync-") {
				snapCount++
			}
		}
		if snapCount != 0 {
			t.Errorf("snapshot files: got %d, want 0", snapCount)
		}
	}
}

func TestSync_NoopOnEmptyOrphanSet(t *testing.T) {
	s, svc, audit, _ := newSyncFixture(t,
		[]*models.Cluster{kubeCluster("id-foo", "foo")},
		[]string{"foo", "extra-in-kubeconfig-but-not-tracked"},
	)

	if err := s.Sync(context.Background(), "test"); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if len(svc.removed) != 0 {
		t.Errorf("removed: got %v", svc.removed)
	}
	if len(audit.entries) != 0 {
		t.Errorf("audit entries: got %v", audit.entries)
	}
}

func TestSync_ContinuesOnIndividualRemoveFailure(t *testing.T) {
	s, svc, _, _ := newSyncFixture(t,
		[]*models.Cluster{
			kubeCluster("id-a", "a"),
			kubeCluster("id-b", "b"),
			kubeCluster("id-c", "c"),
		},
		[]string{},
	)
	// All three would be orphans. Need to relax the cap to test this.
	s.cfg.KubeconfigSyncMaxRemovalRatio = 1.0
	s.cfg.KubeconfigSyncMaxAbsoluteRemovals = 100
	svc.removeErr = map[string]error{"id-b": errors.New("boom")}

	_ = s.Sync(context.Background(), "test")

	// 2 successful removes (a and c), 1 failure (b)
	if len(svc.removed) != 2 {
		t.Errorf("removed: got %v, want 2 successful", svc.removed)
	}
}

func TestSync_RespectsContextCancellation(t *testing.T) {
	s, _, _, _ := newSyncFixture(t,
		[]*models.Cluster{kubeCluster("id-foo", "foo"), kubeCluster("id-bar", "bar")},
		[]string{"foo"},
	)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_ = s.Sync(ctx, "test")
	// Just asserting no panic.
}

func TestSync_ReadErrorNoAuditSpam(t *testing.T) {
	dir := t.TempDir()
	snapDir := filepath.Join(dir, "snapshots")
	svc := &fakeClusterService{clusters: []*models.Cluster{kubeCluster("id-a", "a")}}
	audit := &fakeAuditRepo{}
	cfg := &config.Config{KubeconfigSyncMaxAbsoluteRemovals: 10, KubeconfigSyncMaxRemovalRatio: 0.5}

	s := NewSyncer(svc, audit, []string{filepath.Join(dir, "nope.yaml")}, snapDir, cfg)
	_ = s.Sync(context.Background(), "test")

	if len(audit.entries) != 0 {
		t.Errorf("audit entries on read error: got %v, want 0", audit.entries)
	}
}

func TestSync_SafetyCapAuditIncludesOrphanList(t *testing.T) {
	clusters := make([]*models.Cluster, 5)
	for i := 0; i < 5; i++ {
		clusters[i] = kubeCluster(fmt.Sprintf("id-%d", i), fmt.Sprintf("ctx-%d", i))
	}
	// 4 orphans out of 5 → 0.8 ratio ≥ 0.5 cap.
	s, _, audit, _ := newSyncFixture(t, clusters, []string{"ctx-0"})

	_ = s.Sync(context.Background(), "test")

	if len(audit.entries) != 1 {
		t.Fatalf("audit entries: got %d, want 1", len(audit.entries))
	}
	e := audit.entries[0]
	var d map[string]string
	if err := json.Unmarshal([]byte(e.Details), &d); err != nil {
		t.Fatalf("unmarshal details: %v (raw=%q)", err, e.Details)
	}
	if d["orphans_detected"] != "4" {
		t.Errorf("orphans_detected: got %q, want %q", d["orphans_detected"], "4")
	}
	_ = time.Now()
}
