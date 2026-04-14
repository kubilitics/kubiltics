package kubeconfigwatch

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"golang.org/x/sync/singleflight"
)

// Watcher owns an fsnotify watcher on one or more kubeconfig paths and runs
// Syncer in response to file events, a watch-health check ticker, and a
// polling fallback ticker. All sync invocations are coalesced via a
// singleflight.Group so rapid successive events only trigger one real sync.
type Watcher struct {
	syncer *Syncer
	paths  []string
	cfg    *config.Config

	fs         *fsnotify.Watcher
	syncSF     singleflight.Group
	lastSyncMu sync.Mutex
	lastSyncAt time.Time

	log *slog.Logger
}

// New constructs a Watcher and creates its fsnotify watcher. It does NOT
// add paths to the watcher — that happens inside Start so missing paths
// don't cause a constructor error (they're logged and skipped at runtime).
func New(svc ClusterSyncService, audit AuditLogRepository, paths []string, snapshotDir string, cfg *config.Config) (*Watcher, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	return &Watcher{
		syncer: NewSyncer(svc, audit, paths, snapshotDir, cfg),
		paths:  paths,
		cfg:    cfg,
		fs:     fsw,
		log:    slog.Default(),
	}, nil
}

// Start runs the event loop. It blocks until ctx is cancelled.
func (w *Watcher) Start(ctx context.Context) {
	defer func() { _ = w.fs.Close() }()

	w.addPaths()
	// Run one initial sync so startup converges on whatever the current
	// kubeconfig state is.
	_ = w.runSync(ctx, "startup")

	healthInterval := time.Duration(w.cfg.KubeconfigSyncHealthIntervalSec) * time.Second
	pollInterval := time.Duration(w.cfg.KubeconfigSyncPollIntervalSec) * time.Second
	if healthInterval <= 0 {
		healthInterval = 10 * time.Second
	}
	if pollInterval <= 0 {
		pollInterval = 60 * time.Second
	}
	healthTicker := time.NewTicker(healthInterval)
	defer healthTicker.Stop()

	w.log.Info("kubeconfig watcher started",
		"paths", w.paths,
		"health_interval", healthInterval,
		"poll_interval", pollInterval)

	for {
		select {
		case <-ctx.Done():
			w.log.Info("kubeconfig watcher stopping", "reason", "context cancelled")
			return

		case event, ok := <-w.fs.Events:
			if !ok {
				w.log.Info("kubeconfig watcher stopping", "reason", "events channel closed")
				return
			}
			if event.Op&(fsnotify.Create|fsnotify.Write|fsnotify.Remove|fsnotify.Rename) != 0 {
				w.log.Debug("kubeconfig file event", "name", event.Name, "op", event.Op.String())
				_ = w.runSync(ctx, "fsnotify_event")
			}

		case err, ok := <-w.fs.Errors:
			if !ok {
				return
			}
			w.log.Warn("kubeconfig watcher error", "err", err)

		case <-healthTicker.C:
			// (a) Re-add watches that broke due to rename/replace.
			if len(w.fs.WatchList()) != len(w.paths) {
				w.addPaths()
				_ = w.runSync(ctx, "health_ticker")
				continue
			}
			// (b) Poll fallback for filesystems where fsnotify doesn't fire
			// events (NFS, some overlayfs, WSL2 across the Windows/Linux
			// boundary). Run a full sync every KubeconfigSyncPollIntervalSec
			// seconds regardless of watch health.
			w.lastSyncMu.Lock()
			last := w.lastSyncAt
			w.lastSyncMu.Unlock()
			if time.Since(last) >= pollInterval {
				_ = w.runSync(ctx, "poll_fallback")
			}
		}
	}
}

// runSync wraps Syncer.Sync in a singleflight.Group so concurrent invocations
// coalesce into a single underlying call. Also updates lastSyncAt so the
// health-ticker's poll fallback knows when the last successful sync ran.
func (w *Watcher) runSync(ctx context.Context, trigger string) error {
	_, err, _ := w.syncSF.Do("kubeconfig-sync", func() (interface{}, error) {
		syncErr := w.syncer.Sync(ctx, trigger)
		w.lastSyncMu.Lock()
		w.lastSyncAt = time.Now()
		w.lastSyncMu.Unlock()
		return nil, syncErr
	})
	return err
}

// addPaths adds every configured path to the fsnotify watcher. Failures are
// logged per-path and do not prevent other paths from being added.
func (w *Watcher) addPaths() {
	watched := make(map[string]struct{})
	for _, p := range w.fs.WatchList() {
		watched[p] = struct{}{}
	}
	for _, p := range w.paths {
		if _, ok := watched[p]; ok {
			continue
		}
		if err := w.fs.Add(p); err != nil {
			w.log.Warn("kubeconfig watcher: add path failed",
				"path", p, "err", err)
		}
	}
}
