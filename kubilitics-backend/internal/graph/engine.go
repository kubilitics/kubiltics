package graph

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/cache"
)

const debounceDelay = 2 * time.Second

// ClusterGraphEngine maintains a live dependency graph for a single cluster
// using K8s informers, debounced rebuilds, and atomic snapshot swap.
type ClusterGraphEngine struct {
	clusterID string
	clientset kubernetes.Interface
	log       *slog.Logger

	snapshot     atomic.Value // stores *GraphSnapshot
	rebuildCount atomic.Int64
	lastError    atomic.Value // stores string

	debounceMu sync.Mutex
	dirtyTimer *time.Timer

	factory informers.SharedInformerFactory
	cancel  context.CancelFunc

	// onRebuild is called after every successful graph rebuild with the clusterID.
	// Bug 2 fix: this allows active cache invalidation when K8s resources change,
	// rather than relying solely on TTL expiration.
	onRebuild func(clusterID string)
}

// NewClusterGraphEngine creates a new engine for the given cluster.
// The snapshot is initialized to an empty GraphSnapshot so that Snapshot() never returns nil.
func NewClusterGraphEngine(clusterID string, clientset kubernetes.Interface, log *slog.Logger) *ClusterGraphEngine {
	e := &ClusterGraphEngine{
		clusterID: clusterID,
		clientset: clientset,
		log:       log.With("component", "graph-engine", "cluster", clusterID),
	}
	// Store an empty snapshot so Load() never returns nil.
	// EnsureMaps() initializes ALL map fields to prevent nil-map panics.
	empty := &GraphSnapshot{}
	empty.EnsureMaps()
	e.snapshot.Store(empty)
	return e
}

// Start sets up informers for all resource types, registers event handlers,
// starts the factory, waits for cache sync, and triggers an initial rebuild.
func (e *ClusterGraphEngine) Start(ctx context.Context) {
	ctx, e.cancel = context.WithCancel(ctx)

	e.factory = informers.NewSharedInformerFactory(e.clientset, 5*time.Minute)

	handler := cache.ResourceEventHandlerFuncs{
		AddFunc:    func(_ interface{}) { e.markDirty() },
		UpdateFunc: func(_, _ interface{}) { e.markDirty() },
		DeleteFunc: func(_ interface{}) { e.markDirty() },
	}

	// Core
	_, _ = e.factory.Core().V1().Pods().Informer().AddEventHandler(handler)
	_, _ = e.factory.Core().V1().Services().Informer().AddEventHandler(handler)
	_, _ = e.factory.Core().V1().Endpoints().Informer().AddEventHandler(handler)
	_, _ = e.factory.Core().V1().ConfigMaps().Informer().AddEventHandler(handler)
	_, _ = e.factory.Core().V1().Secrets().Informer().AddEventHandler(handler)
	_, _ = e.factory.Core().V1().ServiceAccounts().Informer().AddEventHandler(handler)
	_, _ = e.factory.Core().V1().PersistentVolumeClaims().Informer().AddEventHandler(handler)

	// Apps
	_, _ = e.factory.Apps().V1().Deployments().Informer().AddEventHandler(handler)
	_, _ = e.factory.Apps().V1().ReplicaSets().Informer().AddEventHandler(handler)
	_, _ = e.factory.Apps().V1().StatefulSets().Informer().AddEventHandler(handler)
	_, _ = e.factory.Apps().V1().DaemonSets().Informer().AddEventHandler(handler)

	// Batch
	_, _ = e.factory.Batch().V1().Jobs().Informer().AddEventHandler(handler)
	_, _ = e.factory.Batch().V1().CronJobs().Informer().AddEventHandler(handler)

	// Networking
	_, _ = e.factory.Networking().V1().Ingresses().Informer().AddEventHandler(handler)
	_, _ = e.factory.Networking().V1().NetworkPolicies().Informer().AddEventHandler(handler)

	// Autoscaling
	_, _ = e.factory.Autoscaling().V1().HorizontalPodAutoscalers().Informer().AddEventHandler(handler)

	// Policy
	_, _ = e.factory.Policy().V1().PodDisruptionBudgets().Informer().AddEventHandler(handler)

	// Start factory and wait for sync in a goroutine.
	e.factory.Start(ctx.Done())

	go func() {
		e.log.Info("waiting for informer cache sync")
		e.factory.WaitForCacheSync(ctx.Done())

		select {
		case <-ctx.Done():
			return
		default:
		}

		e.log.Info("informer caches synced, triggering initial rebuild")
		e.rebuild()
	}()
}

// SetOnRebuild registers a callback that fires after every successful graph rebuild.
// Use this to actively invalidate caches when K8s resources change (Bug 2 fix).
func (e *ClusterGraphEngine) SetOnRebuild(fn func(clusterID string)) {
	e.onRebuild = fn
}

// Stop cancels the context and stops the debounce timer.
func (e *ClusterGraphEngine) Stop() {
	if e.cancel != nil {
		e.cancel()
	}
	e.debounceMu.Lock()
	defer e.debounceMu.Unlock()
	if e.dirtyTimer != nil {
		e.dirtyTimer.Stop()
		e.dirtyTimer = nil
	}
}

// markDirty resets the debounce timer. Each call resets the 2s countdown.
// When the timer fires it calls rebuild().
func (e *ClusterGraphEngine) markDirty() {
	e.debounceMu.Lock()
	defer e.debounceMu.Unlock()

	if e.dirtyTimer != nil {
		e.dirtyTimer.Stop()
	}
	e.dirtyTimer = time.AfterFunc(debounceDelay, e.rebuild)
}

// rebuild collects resources from informer caches, builds a new snapshot,
// and atomically swaps it in.
func (e *ClusterGraphEngine) rebuild() {
	start := time.Now()

	res := e.collectResources()
	if res == nil {
		e.log.Error("failed to collect resources from informer caches")
		e.lastError.Store("failed to collect resources")
		return
	}

	snap := BuildSnapshot(res, false, nil, nil)
	e.snapshot.Store(snap)
	e.rebuildCount.Add(1)
	e.lastError.Store("")

	e.log.Info("graph rebuilt",
		"nodes", len(snap.Nodes),
		"edges", len(snap.Edges),
		"duration", time.Since(start),
		"rebuild_count", e.rebuildCount.Load(),
	)

	// Bug 2 fix: actively invalidate caches when resources change.
	if e.onRebuild != nil {
		e.onRebuild(e.clusterID)
	}
}

// collectResources reads all resources from informer Lister caches.
// Returns nil if any lister fails.
func (e *ClusterGraphEngine) collectResources() *ClusterResources {
	sel := labels.Everything()
	res := &ClusterResources{}

	// Core
	pods, err := e.factory.Core().V1().Pods().Lister().List(sel)
	if err != nil {
		e.log.Error("failed to list pods", "error", err)
		return nil
	}
	for _, p := range pods {
		res.Pods = append(res.Pods, *p)
	}

	services, err := e.factory.Core().V1().Services().Lister().List(sel)
	if err != nil {
		e.log.Error("failed to list services", "error", err)
		return nil
	}
	for _, s := range services {
		res.Services = append(res.Services, *s)
	}

	endpointsList, err := e.factory.Core().V1().Endpoints().Lister().List(sel)
	if err != nil {
		e.log.Error("failed to list endpoints", "error", err)
		return nil
	}
	for _, ep := range endpointsList {
		res.Endpoints = append(res.Endpoints, *ep)
	}

	configMaps, err := e.factory.Core().V1().ConfigMaps().Lister().List(sel)
	if err != nil {
		e.log.Error("failed to list configmaps", "error", err)
		return nil
	}
	for _, cm := range configMaps {
		res.ConfigMaps = append(res.ConfigMaps, corev1.ConfigMap{ObjectMeta: cm.ObjectMeta})
	}

	secrets, err := e.factory.Core().V1().Secrets().Lister().List(sel)
	if err != nil {
		e.log.Error("failed to list secrets", "error", err)
		return nil
	}
	for _, s := range secrets {
		res.Secrets = append(res.Secrets, corev1.Secret{ObjectMeta: s.ObjectMeta})
	}

	serviceAccounts, err := e.factory.Core().V1().ServiceAccounts().Lister().List(sel)
	if err != nil {
		e.log.Error("failed to list service accounts", "error", err)
		return nil
	}
	for _, sa := range serviceAccounts {
		res.ServiceAccounts = append(res.ServiceAccounts, *sa)
	}

	pvcs, err := e.factory.Core().V1().PersistentVolumeClaims().Lister().List(sel)
	if err != nil {
		e.log.Error("failed to list pvcs", "error", err)
		return nil
	}
	for _, pvc := range pvcs {
		res.PVCs = append(res.PVCs, *pvc)
	}

	// Apps
	deployments, err := e.factory.Apps().V1().Deployments().Lister().List(sel)
	if err != nil {
		e.log.Error("failed to list deployments", "error", err)
		return nil
	}
	for _, d := range deployments {
		res.Deployments = append(res.Deployments, *d)
	}

	replicaSets, err := e.factory.Apps().V1().ReplicaSets().Lister().List(sel)
	if err != nil {
		e.log.Error("failed to list replicasets", "error", err)
		return nil
	}
	for _, rs := range replicaSets {
		res.ReplicaSets = append(res.ReplicaSets, *rs)
	}

	statefulSets, err := e.factory.Apps().V1().StatefulSets().Lister().List(sel)
	if err != nil {
		e.log.Error("failed to list statefulsets", "error", err)
		return nil
	}
	for _, ss := range statefulSets {
		res.StatefulSets = append(res.StatefulSets, *ss)
	}

	daemonSets, err := e.factory.Apps().V1().DaemonSets().Lister().List(sel)
	if err != nil {
		e.log.Error("failed to list daemonsets", "error", err)
		return nil
	}
	for _, ds := range daemonSets {
		res.DaemonSets = append(res.DaemonSets, *ds)
	}

	// Batch
	jobs, err := e.factory.Batch().V1().Jobs().Lister().List(sel)
	if err != nil {
		e.log.Error("failed to list jobs", "error", err)
		return nil
	}
	for _, j := range jobs {
		res.Jobs = append(res.Jobs, *j)
	}

	cronJobs, err := e.factory.Batch().V1().CronJobs().Lister().List(sel)
	if err != nil {
		e.log.Error("failed to list cronjobs", "error", err)
		return nil
	}
	for _, cj := range cronJobs {
		res.CronJobs = append(res.CronJobs, *cj)
	}

	// Networking
	ingresses, err := e.factory.Networking().V1().Ingresses().Lister().List(sel)
	if err != nil {
		e.log.Error("failed to list ingresses", "error", err)
		return nil
	}
	for _, ing := range ingresses {
		res.Ingresses = append(res.Ingresses, *ing)
	}

	networkPolicies, err := e.factory.Networking().V1().NetworkPolicies().Lister().List(sel)
	if err != nil {
		e.log.Error("failed to list network policies", "error", err)
		return nil
	}
	for _, np := range networkPolicies {
		res.NetworkPolicies = append(res.NetworkPolicies, *np)
	}

	// Autoscaling
	hpas, err := e.factory.Autoscaling().V1().HorizontalPodAutoscalers().Lister().List(sel)
	if err != nil {
		e.log.Error("failed to list hpas", "error", err)
		return nil
	}
	for _, hpa := range hpas {
		res.HPAs = append(res.HPAs, *hpa)
	}

	// Policy
	pdbs, err := e.factory.Policy().V1().PodDisruptionBudgets().Lister().List(sel)
	if err != nil {
		e.log.Error("failed to list pdbs", "error", err)
		return nil
	}
	for _, pdb := range pdbs {
		res.PDBs = append(res.PDBs, *pdb)
	}

	return res
}

// Snapshot returns the current graph snapshot via a lock-free atomic load.
func (e *ClusterGraphEngine) Snapshot() *GraphSnapshot {
	return e.snapshot.Load().(*GraphSnapshot)
}

// Status returns the current graph status including rebuild count and any error.
func (e *ClusterGraphEngine) Status() models.GraphStatus {
	snap := e.Snapshot()
	status := snap.Status()
	status.RebuildCount = e.rebuildCount.Load()
	if errVal := e.lastError.Load(); errVal != nil {
		if errStr, ok := errVal.(string); ok && errStr != "" {
			status.Error = errStr
		}
	}
	return status
}

