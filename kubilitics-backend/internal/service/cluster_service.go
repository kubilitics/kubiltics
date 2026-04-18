package service

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	"golang.org/x/sync/singleflight"
	"golang.org/x/time/rate"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/clientcmd"
)

const defaultMaxClusters = 100

// ErrClusterLimitReached is returned when a cluster registration would exceed the configured maxClusters limit.
// Carries the current count and limit for structured error responses.
type ErrClusterLimitReached struct {
	Current int
	Max     int
}

func (e *ErrClusterLimitReached) Error() string {
	return fmt.Sprintf("cluster limit reached (%d/%d); cannot add more clusters", e.Current, e.Max)
}

// ClusterService manages Kubernetes clusters
type ClusterService interface {
	ListClusters(ctx context.Context) ([]*models.Cluster, error)
	GetCluster(ctx context.Context, id string) (*models.Cluster, error)
	AddCluster(ctx context.Context, kubeconfigPath, contextName string) (*models.Cluster, error)
	// AddClusterFromBytes adds a cluster from raw kubeconfig content (e.g., uploaded via browser).
	// It writes the content to ~/.kubilitics/kubeconfigs/<context>.yaml and delegates to AddCluster.
	// The cluster is fully persisted and provider-detected, same as AddCluster.
	AddClusterFromBytes(ctx context.Context, kubeconfigBytes []byte, contextName string) (*models.Cluster, error)
	RemoveCluster(ctx context.Context, id string) error
	TestConnection(ctx context.Context, id string) error
	GetClusterSummary(ctx context.Context, id string) (*models.ClusterSummary, error)
	// LoadClustersFromRepo restores K8s clients from persisted clusters (call on startup).
	LoadClustersFromRepo(ctx context.Context) error
	// GetClient returns the K8s client for a cluster (for internal use by topology, resources, etc.).
	GetClient(id string) (*k8s.Client, error)
	// GetOrReconnectClient is like GetClient, but if the pool is cold for this
	// cluster it will lazily call ReconnectCluster (coalesced via singleflight,
	// bounded by a short timeout, with a negative cache for recent failures).
	// This is the client lookup that HTTP handlers should use on the fallback path.
	GetOrReconnectClient(ctx context.Context, id string) (*k8s.Client, error)
	// HasMetalLB returns true if MetalLB CRDs (ipaddresspools, bgppeers) are installed in the cluster.
	HasMetalLB(ctx context.Context, id string) (bool, error)
	// DiscoverClusters scans the configured kubeconfig for contexts not yet in the repository.
	DiscoverClusters(ctx context.Context) ([]*models.Cluster, error)
	// GetOverview returns the cached overview for a cluster if available.
	GetOverview(clusterID string) (*models.ClusterOverview, bool)
	// Subscribe returns a channel and unsubscribe function for real-time overview updates.
	// Returns ErrTooManyListeners if the per-cluster listener limit is reached.
	Subscribe(clusterID string) (chan *models.ClusterOverview, func(), error)
	// ReconnectCluster resets the circuit breaker and forces a fresh K8s client connection.
	// Call this when the user explicitly requests reconnect or the cluster status page is opened.
	ReconnectCluster(ctx context.Context, id string) (*models.Cluster, error)
	// GetInformerManager returns the InformerManager for a cluster if available.
	// Used by the REST handler to serve resource lists from in-memory cache (<1ms)
	// instead of making direct K8s API calls (~200-2000ms). Returns nil if not started.
	GetInformerManager(clusterID string) *k8s.InformerManager
}

// K8sClientFactory creates a k8s client from kubeconfig path and context. Used in tests to inject a fake client.
// When nil, AddCluster uses k8s.NewClient.
type K8sClientFactory func(kubeconfigPath, contextName string) (*k8s.Client, error)

type clusterService struct {
	mu                 sync.RWMutex
	repo               repository.ClusterRepository
	clients            map[string]*k8s.Client // id -> live K8s client
	overviewCache      *OverviewCache
	maxClusters        int
	k8sTimeout         time.Duration // timeout for outbound K8s API calls; 0 = use request context only
	k8sRateLimitPerSec float64
	k8sRateLimitBurst  int
	clientFactory      K8sClientFactory // optional; tests only

	// reconnectSF coalesces parallel lazy-reconnect attempts for the same cluster id.
	// Without it, a single page load (which fires ~10 parallel API requests) would
	// start ~10 parallel ReconnectCluster calls — each runs TestConnection, creates
	// a client, and starts informers. The losers of the map-write race leak their
	// client handles and informer watches against the apiserver.
	reconnectSF singleflight.Group
	// reconnectFailCache remembers recent failures so we don't retry a known-broken
	// cluster on every request; keys are cluster ids, values are failure timestamps.
	reconnectFailCache sync.Map
}

// reconnectNegativeCacheTTL is how long a failed lazy-reconnect is remembered
// before we're willing to try again. Keeps offline clusters from hanging every
// request for 8 seconds each.
const reconnectNegativeCacheTTL = 10 * time.Second

// reconnectTimeout bounds the per-attempt wall clock when lazy-reconnecting a
// cluster from the request hot path. Shorter than the startup load budget on
// purpose: a user is waiting on the other end of this call.
const reconnectTimeout = 3 * time.Second

// GetOrReconnectClient returns a live k8s client for id, building one on demand
// if the cluster has no client in the pool (e.g. it was persisted but offline
// when the backend started, or became reachable after startup).
//
// Safe to call from many request goroutines concurrently — singleflight ensures
// only one reconnect runs at a time per cluster, and a short negative cache
// prevents hammering a known-broken cluster.
func (s *clusterService) GetOrReconnectClient(ctx context.Context, id string) (*k8s.Client, error) {
	if client, err := s.GetClient(id); err == nil {
		return client, nil
	}

	// Honor the negative cache: if a recent reconnect failed, fail fast with the
	// cached error instead of paying the timeout cost again.
	if v, ok := s.reconnectFailCache.Load(id); ok {
		if entry, ok := v.(reconnectFailure); ok {
			if time.Since(entry.at) < reconnectNegativeCacheTTL {
				return nil, entry.err
			}
			s.reconnectFailCache.Delete(id)
		}
	}

	// Coalesce parallel callers so the expensive reconnect only runs once per id.
	_, err, _ := s.reconnectSF.Do(id, func() (interface{}, error) {
		// Double-check under singleflight: another caller may have populated the
		// pool while we were queued. Avoid re-reconnecting.
		if client, err := s.GetClient(id); err == nil {
			return client, nil
		}
		rctx, cancel := context.WithTimeout(ctx, reconnectTimeout)
		defer cancel()
		if _, rerr := s.ReconnectCluster(rctx, id); rerr != nil {
			s.reconnectFailCache.Store(id, reconnectFailure{at: time.Now(), err: rerr})
			return nil, rerr
		}
		return s.GetClient(id)
	})
	if err != nil {
		return nil, err
	}
	return s.GetClient(id)
}

type reconnectFailure struct {
	at  time.Time
	err error
}

// clusterInfoString safely extracts a string value from a GetClusterInfo result map.
// Returns "" if the key is absent or the value is not a string.
func clusterInfoString(info map[string]interface{}, key string) string {
	v, _ := info[key].(string)
	return v
}

// clusterInfoInt safely extracts an int value from a GetClusterInfo result map.
// Returns 0 if the key is absent or the value is not an int.
func clusterInfoInt(info map[string]interface{}, key string) int {
	v, _ := info[key].(int)
	return v
}

func NewClusterService(repo repository.ClusterRepository, cfg *config.Config) ClusterService {
	return newClusterService(repo, cfg, nil)
}

// NewClusterServiceWithClientFactory is for tests: injects a client factory so AddCluster does not call real k8s.NewClient.
func NewClusterServiceWithClientFactory(repo repository.ClusterRepository, cfg *config.Config, factory K8sClientFactory) ClusterService {
	return newClusterService(repo, cfg, factory)
}

func newClusterService(repo repository.ClusterRepository, cfg *config.Config, factory K8sClientFactory) ClusterService {
	maxClusters := defaultMaxClusters
	var k8sTimeout time.Duration
	var k8sRatePerSec float64
	var k8sRateBurst int
	if cfg != nil {
		if cfg.MaxClusters > 0 {
			maxClusters = cfg.MaxClusters
		}
		if cfg.K8sTimeoutSec > 0 {
			k8sTimeout = time.Duration(cfg.K8sTimeoutSec) * time.Second
		}
		if cfg.K8sRateLimitPerSec > 0 && cfg.K8sRateLimitBurst > 0 {
			k8sRatePerSec = cfg.K8sRateLimitPerSec
			k8sRateBurst = cfg.K8sRateLimitBurst
		}
	}
	return &clusterService{
		repo:               repo,
		clients:            make(map[string]*k8s.Client),
		overviewCache:      NewOverviewCache(),
		maxClusters:        maxClusters,
		k8sTimeout:         k8sTimeout,
		k8sRateLimitPerSec: k8sRatePerSec,
		k8sRateLimitBurst:  k8sRateBurst,
		clientFactory:      factory,
	}
}

func (s *clusterService) ListClusters(ctx context.Context) ([]*models.Cluster, error) {
	clusters, err := s.repo.List(ctx)
	if err != nil {
		return nil, err
	}

	// Identify active context from local kubeconfig to highlight in UI
	home, _ := os.UserHomeDir()
	currentContext := ""
	if home != "" {
		_, currentContext, _ = k8s.GetKubeconfigContexts(filepath.Join(home, ".kube", "config"))
	}

	// Enrich with live client status where available; try reconnect when client missing
	// P0-B: Parallelize enrichment to avoid sequential delays from hanging EKS clusters.
	var wg sync.WaitGroup
	for _, c := range clusters {
		wg.Add(1)
		go func(c *models.Cluster) {
			defer func() {
				if r := recover(); r != nil {
					fmt.Printf("[ListClusters] Panic in enrichment goroutine for cluster %s: %v\n", c.ID, r)
				}
				wg.Done()
			}()

			// Per-cluster timeout for background enrichment to ensure responsiveness.
			clusterCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			defer cancel()

			c.IsCurrent = (c.Context == currentContext)

			s.mu.RLock()
			client, hasClient := s.clients[c.ID]
			s.mu.RUnlock()

			if hasClient {
				info, err := client.GetClusterInfo(clusterCtx)
				if err != nil {
					c.Status = clusterStatusFromError(err)
					_ = s.repo.Update(ctx, c)
					return
				}
				c.ServerURL = clusterInfoString(info, "server_url")
				c.Version = clusterInfoString(info, "version")
				c.NodeCount = clusterInfoInt(info, "node_count")
				c.NamespaceCount = clusterInfoInt(info, "namespace_count")
				c.Status = "connected"
				c.LastConnected = time.Now()
				if p, err := client.DetectProvider(clusterCtx); err == nil && p != "" {
					c.Provider = p
				}
				_ = s.repo.Update(ctx, c)

				// Start/Ensure cache (internal lockers handle concurrency)
				_ = s.overviewCache.StartClusterCache(clusterCtx, c.ID, client)
			} else {
				// No client in map, try to reconnect
				if s.tryReconnectCluster(clusterCtx, c) {
					// tryReconnect successfully updated s.clients (with internal lock)
					s.mu.RLock()
					client = s.clients[c.ID]
					s.mu.RUnlock()

					if client != nil {
						info, _ := client.GetClusterInfo(clusterCtx)
						if info != nil {
							c.ServerURL = clusterInfoString(info, "server_url")
							c.Version = clusterInfoString(info, "version")
							c.NodeCount = clusterInfoInt(info, "node_count")
							c.NamespaceCount = clusterInfoInt(info, "namespace_count")
						}
						c.Status = "connected"
						c.LastConnected = time.Now()
						if p, err := client.DetectProvider(clusterCtx); err == nil && p != "" {
							c.Provider = p
						}
						_ = s.repo.Update(ctx, c)
						_ = s.overviewCache.StartClusterCache(clusterCtx, c.ID, client)
					}
				} else {
					c.Status = "disconnected"
				}
			}
		}(c)
	}
	wg.Wait()
	return clusters, nil
}

func (s *clusterService) GetCluster(ctx context.Context, id string) (*models.Cluster, error) {
	c, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, nil
	}

	s.mu.RLock()
	client, ok := s.clients[id]
	s.mu.RUnlock()

	if ok {
		ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		if info, err := client.GetClusterInfo(ctx); err == nil {
			c.ServerURL = clusterInfoString(info, "server_url")
			c.Version = clusterInfoString(info, "version")
			c.NodeCount = clusterInfoInt(info, "node_count")
			c.NamespaceCount = clusterInfoInt(info, "namespace_count")
			c.Status = "connected"
			c.LastConnected = time.Now()
			if p, err := client.DetectProvider(ctx); err == nil && p != "" {
				c.Provider = p
			}
			_ = s.repo.Update(ctx, c)
		} else {
			c.Status = clusterStatusFromError(err)
			_ = s.repo.Update(ctx, c)
		}
	} else {
		if s.tryReconnectCluster(ctx, c) {
			s.mu.RLock()
			client, ok = s.clients[id]
			s.mu.RUnlock()
			if ok {
				info, _ := client.GetClusterInfo(ctx)
				if info != nil {
					c.ServerURL = clusterInfoString(info, "server_url")
					c.Version = clusterInfoString(info, "version")
					c.NodeCount = clusterInfoInt(info, "node_count")
					c.NamespaceCount = clusterInfoInt(info, "namespace_count")
				}
				c.Status = "connected"
				c.LastConnected = time.Now()
				if p, err := client.DetectProvider(ctx); err == nil && p != "" {
					c.Provider = p
				}
				_ = s.repo.Update(ctx, c)
			}
		} else {
			c.Status = "disconnected"
		}
	}
	return c, nil
}

// AddCluster registers a cluster loaded from the user's kubeconfig at the
// given path and context. Convenience wrapper around addClusterWithSource
// that forces source="kubeconfig" — the right value for every code path
// that reaches here (picker, API, auto-connect). For the upload flow,
// AddClusterFromBytes calls addClusterWithSource directly with source="upload".
func (s *clusterService) AddCluster(ctx context.Context, kubeconfigPath, contextName string) (*models.Cluster, error) {
	return s.addClusterWithSource(ctx, kubeconfigPath, contextName, "kubeconfig")
}

func (s *clusterService) addClusterWithSource(ctx context.Context, kubeconfigPath, contextName, source string) (*models.Cluster, error) {
	fmt.Printf("[AddCluster] Starting for context: %s, path: %s\n", contextName, kubeconfigPath)

	if kubeconfigPath == "" {
		kubeconfigPath = os.Getenv("KUBECONFIG")
		if kubeconfigPath == "" {
			home, _ := os.UserHomeDir()
			if home != "" {
				kubeconfigPath = filepath.Join(home, ".kube", "config")
			}
		}
	}

	if kubeconfigPath == "" {
		return nil, fmt.Errorf("could not determine kubeconfig path")
	}

	list, err := s.repo.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to check existing clusters: %w", err)
	}

	if len(list) >= s.maxClusters {
		return nil, &ErrClusterLimitReached{Current: len(list), Max: s.maxClusters}
	}

	if _, err := os.Stat(kubeconfigPath); err != nil {
		return nil, fmt.Errorf("kubeconfig not found: %w", err)
	}

	fmt.Printf("[AddCluster] Initializing K8s client for %s\n", contextName)
	var client *k8s.Client
	if s.clientFactory != nil {
		client, err = s.clientFactory(kubeconfigPath, contextName)
	} else {
		client, err = k8s.NewClient(kubeconfigPath, contextName)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to initialize k8s client: %w", err)
	}
	if s.k8sTimeout > 0 {
		client.SetTimeout(s.k8sTimeout)
	}
	if s.k8sRateLimitPerSec > 0 && s.k8sRateLimitBurst > 0 {
		client.SetLimiter(rate.NewLimiter(rate.Limit(s.k8sRateLimitPerSec), s.k8sRateLimitBurst))
	}

	// P0-B: For new registrations, cap connection test to 5s to avoid blocking the UI forever.
	fmt.Printf("[AddCluster] Testing connection for %s (5s timeout)\n", contextName)
	regCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	status := "connected"
	serverURL := ""
	version := ""
	provider := k8s.ProviderOnPrem

	if err := client.TestConnection(regCtx); err != nil {
		fmt.Printf("[AddCluster] Connection test failed for %s: %v\n", contextName, err)
		status = clusterStatusFromError(err)
	} else {
		fmt.Printf("[AddCluster] Connection test successful for %s\n", contextName)
		if info, err := client.GetClusterInfo(regCtx); err == nil {
			serverURL = clusterInfoString(info, "server_url")
			version = clusterInfoString(info, "version")
			if p, err := client.DetectProvider(regCtx); err == nil && p != "" {
				provider = p
			}
		} else {
			status = "error"
		}
	}

	// P2-10: Idempotent add — return existing cluster (same ID) when (context, kubeconfig_path) or (context, server_url) matches.
	normPath := filepath.Clean(kubeconfigPath)
	for _, c := range list {
		if c.Context != contextName {
			continue
		}
		// Match by path or server URL (if we were able to get it)
		pathMatch := filepath.Clean(c.KubeconfigPath) == normPath
		urlMatch := serverURL != "" && c.ServerURL == serverURL

		if pathMatch || urlMatch {
			c.Status = status
			c.LastConnected = time.Now()
			if serverURL != "" {
				c.ServerURL = serverURL
			}
			if version != "" {
				c.Version = version
			}
			if provider != k8s.ProviderOnPrem {
				c.Provider = provider
			}
			c.UpdatedAt = time.Now()
			fmt.Printf("[AddCluster] Idempotent match found, updating cluster %s\n", c.ID)
			if err := s.repo.Update(ctx, c); err != nil {
				return nil, fmt.Errorf("failed to update existing cluster: %w", err)
			}
			if status == "connected" {
				s.mu.Lock()
				s.clients[c.ID] = client
				s.mu.Unlock()
				_ = s.overviewCache.StartClusterCache(ctx, c.ID, client)
			}
			return c, nil
		}
	}

	cluster := &models.Cluster{
		ID:             uuid.New().String(),
		Name:           contextName, // Default name to context
		Context:        contextName,
		KubeconfigPath: normPath,
		ServerURL:      serverURL,
		Version:        version,
		Status:         status,
		Provider:       provider,
		Source:         source,
		LastConnected:  time.Now(),
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}

	fmt.Printf("[AddCluster] Persisting new cluster %s in repo\n", cluster.ID)
	if err := s.repo.Create(ctx, cluster); err != nil {
		return nil, fmt.Errorf("failed to persist cluster: %w", err)
	}

	if status == "connected" {
		s.mu.Lock()
		s.clients[cluster.ID] = client
		s.mu.Unlock()
		_ = s.overviewCache.StartClusterCache(ctx, cluster.ID, client)
	}

	fmt.Printf("[AddCluster] Successfully registered %s\n", cluster.ID)
	return cluster, nil
}

// AddClusterFromBytes adds a cluster from raw kubeconfig bytes (browser upload / paste).
// It resolves the context name, writes the kubeconfig to ~/.kubilitics/kubeconfigs/<context>.yaml
// with 0600 permissions, then delegates fully to AddCluster for persistence and provider detection.
func (s *clusterService) AddClusterFromBytes(ctx context.Context, kubeconfigBytes []byte, contextName string) (*models.Cluster, error) {
	// Parse kubeconfig to resolve context name and validate structure.
	rawConfig, err := clientcmd.Load(kubeconfigBytes)
	if err != nil {
		return nil, fmt.Errorf("invalid kubeconfig: %w", err)
	}

	if contextName == "" {
		contextName = rawConfig.CurrentContext
	}
	if contextName == "" {
		// Pick first available context when current-context is not set.
		for name := range rawConfig.Contexts {
			contextName = name
			break
		}
	}
	if contextName == "" {
		return nil, fmt.Errorf("kubeconfig contains no contexts")
	}
	if _, exists := rawConfig.Contexts[contextName]; !exists {
		available := make([]string, 0, len(rawConfig.Contexts))
		for n := range rawConfig.Contexts {
			available = append(available, n)
		}
		return nil, fmt.Errorf("context %q not found in kubeconfig (available: %s)", contextName, strings.Join(available, ", "))
	}

	// Persist to ~/.kubilitics/kubeconfigs/<sanitized-context>.yaml
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("cannot determine home directory: %w", err)
	}
	kubeDir := filepath.Join(home, ".kubilitics", "kubeconfigs")
	if err := os.MkdirAll(kubeDir, 0700); err != nil {
		return nil, fmt.Errorf("failed to create kubeconfigs directory: %w", err)
	}

	safeName := sanitizeContextForFilename(contextName)
	kubeconfigPath := filepath.Join(kubeDir, safeName+".yaml")

	if err := os.WriteFile(kubeconfigPath, kubeconfigBytes, 0600); err != nil {
		return nil, fmt.Errorf("failed to write kubeconfig: %w", err)
	}

	fmt.Printf("[AddClusterFromBytes] Written kubeconfig to %s for context %s\n", kubeconfigPath, contextName)
	return s.addClusterWithSource(ctx, kubeconfigPath, contextName, "upload")
}

// sanitizeContextForFilename maps a Kubernetes context name to a safe filesystem name.
// Characters outside [a-zA-Z0-9._-] are replaced with '-'. Max length 200.
func sanitizeContextForFilename(name string) string {
	safe := strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_' || r == '.' {
			return r
		}
		return '-'
	}, name)
	if len(safe) > 200 {
		safe = safe[:200]
	}
	if safe == "" {
		safe = "default"
	}
	return safe
}

func (s *clusterService) RemoveCluster(ctx context.Context, id string) error {
	if _, err := s.repo.Get(ctx, id); err != nil {
		return fmt.Errorf("cluster not found: %s", id)
	}
	if err := s.repo.Delete(ctx, id); err != nil {
		return err
	}
	s.mu.Lock()
	delete(s.clients, id)
	s.mu.Unlock()
	s.overviewCache.StopClusterCache(id)
	return nil
}

func (s *clusterService) TestConnection(ctx context.Context, id string) error {
	s.mu.RLock()
	client, exists := s.clients[id]
	s.mu.RUnlock()
	if !exists {
		return fmt.Errorf("cluster not found: %s", id)
	}
	return client.TestConnection(ctx)
}

func (s *clusterService) GetClusterSummary(ctx context.Context, id string) (*models.ClusterSummary, error) {
	s.mu.RLock()
	client, exists := s.clients[id]
	s.mu.RUnlock()
	if !exists {
		return nil, fmt.Errorf("cluster not found: %s", id)
	}

	info, err := client.GetClusterInfo(ctx)
	if err != nil {
		return nil, err
	}

	nodes, _ := client.Clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	pods, _ := client.Clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	deployments, _ := client.Clientset.AppsV1().Deployments("").List(ctx, metav1.ListOptions{})
	services, _ := client.Clientset.CoreV1().Services("").List(ctx, metav1.ListOptions{})

	// Compute health from actual resource state
	healthStatus := computeClusterHealthStatus(nodes, pods, deployments)

	return &models.ClusterSummary{
		ID:              id,
		Name:            id,
		NodeCount:       clusterInfoInt(info, "node_count"),
		NamespaceCount:  clusterInfoInt(info, "namespace_count"),
		PodCount:        len(pods.Items),
		DeploymentCount: len(deployments.Items),
		ServiceCount:    len(services.Items),
		HealthStatus:    healthStatus,
	}, nil
}

// GetClient returns K8s client for internal use
func (s *clusterService) GetClient(id string) (*k8s.Client, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	client, ok := s.clients[id]
	if !ok {
		return nil, fmt.Errorf("client not found for cluster %s", id)
	}
	return client, nil
}

// HasMetalLB returns true if MetalLB CRDs (ipaddresspools.metallb.io, bgppeers.metallb.io) are installed.
// Tries to list ipaddresspools with limit=1; 404 means MetalLB is not installed.
func (s *clusterService) HasMetalLB(ctx context.Context, id string) (bool, error) {
	client, err := s.GetClient(id)
	if err != nil {
		return false, err
	}
	opts := metav1.ListOptions{Limit: 1}
	_, err = client.ListResources(ctx, "ipaddresspools", "", opts)
	if err != nil {
		if apierrors.IsNotFound(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// buildClientForCluster returns a fresh K8s client for the given cluster row.
// Three modes:
//   - Source == "in-cluster": use rest.InClusterConfig (k8s.NewClient with empty path).
//     This handles the seamless `helm install kubilitics` flow where the hub auto-
//     registers itself with no kubeconfig.
//   - KubeconfigPath != "": load that kubeconfig file with the stored Context.
//   - KubeconfigPath == "" (legacy): caller decides fallback (e.g. ~/.kube/config).
//
// Single source of truth so all three connect/reconnect/load paths stay in lockstep.
func (s *clusterService) buildClientForCluster(c *models.Cluster) (*k8s.Client, error) {
	if c.Source == "in-cluster" {
		if s.clientFactory != nil {
			return s.clientFactory("", "")
		}
		return k8s.NewClient("", "")
	}
	if c.KubeconfigPath == "" {
		return nil, fmt.Errorf("cluster %s has no stored kubeconfig path — reconnect or remove it", c.ID)
	}
	if s.clientFactory != nil {
		return s.clientFactory(c.KubeconfigPath, c.Context)
	}
	return k8s.NewClient(c.KubeconfigPath, c.Context)
}

// loadStartupTimeout is the per-cluster timeout for connection tests during startup.
// Keep it short so the backend starts promptly even when clusters are offline or require
// slow exec-based auth (aws eks get-token, gke-gcloud-auth-plugin, etc.).
const loadStartupTimeout = 8 * time.Second

// LoadClustersFromRepo restores K8s clients from persisted clusters (call on startup).
// Per-cluster failures do not abort the process; each cluster gets status disconnected/error.
// Connection tests run with a hard per-cluster timeout so unreachable or exec-auth clusters
// (EKS, GKE, AKS) never block the server from starting.
func (s *clusterService) LoadClustersFromRepo(ctx context.Context) error {
	clusters, err := s.repo.List(ctx)
	if err != nil {
		return err
	}
	for _, c := range clusters {
		// in-cluster rows have empty KubeconfigPath but build a client via
		// rest.InClusterConfig — handled inside buildClientForCluster.
		if c.KubeconfigPath == "" && c.Source != "in-cluster" {
			c.Status = "disconnected"
			_ = s.repo.Update(ctx, c)
			continue
		}
		client, clientErr := s.buildClientForCluster(c)

		if clientErr != nil {
			fmt.Printf("[LoadClustersFromRepo] Skipping cluster %s (%s): failed to create client: %v\n", c.ID, c.Context, clientErr)
			c.Status = "error"
			_ = s.repo.Update(ctx, c)
			continue
		}

		if s.k8sTimeout > 0 {
			client.SetTimeout(s.k8sTimeout)
		}
		if s.k8sRateLimitPerSec > 0 && s.k8sRateLimitBurst > 0 {
			client.SetLimiter(rate.NewLimiter(rate.Limit(s.k8sRateLimitPerSec), s.k8sRateLimitBurst))
		}

		// Test connection with a hard per-cluster deadline so exec-based auth plugins
		// (aws eks get-token, gke-gcloud-auth-plugin) and offline clusters don't block startup.
		testCtx, testCancel := context.WithTimeout(ctx, loadStartupTimeout)
		connErr := client.TestConnection(testCtx)
		testCancel()
		if connErr != nil {
			fmt.Printf("[LoadClustersFromRepo] Cluster %s (%s): connection test failed (%v) — marking %s\n",
				c.ID, c.Context, connErr, clusterStatusFromError(connErr))
			c.Status = clusterStatusFromError(connErr)
		} else {
			c.Status = "connected"
		}

		if connErr == nil {
			// Only register the live client and start the informer cache when the cluster
			// is reachable. Starting informers for offline/disconnected clusters causes
			// continuous reflector log spam as they hammer unreachable API servers.
			s.mu.Lock()
			s.clients[c.ID] = client
			s.mu.Unlock()

			c.LastConnected = time.Now()
			_ = s.overviewCache.StartClusterCache(ctx, c.ID, client)

			// Detect provider with the same short timeout so it never blocks startup.
			provCtx, provCancel := context.WithTimeout(ctx, loadStartupTimeout)
			if p, err := client.DetectProvider(provCtx); err == nil && p != "" {
				c.Provider = p
			}
			provCancel()
		} else {
			fmt.Printf("[LoadClustersFromRepo] Cluster %s (%s): skipping informer cache (cluster is %s)\n",
				c.ID, c.Context, c.Status)
		}

		_ = s.repo.Update(ctx, c)
	}
	return nil
}

// tryReconnectCluster builds a K8s client for a cluster when none is in memory (e.g. after restart).
// Uses stored KubeconfigPath if the file exists; otherwise falls back to default kubeconfig (~/.kube/config)
// so clusters like docker-desktop work when kubectl works on the same machine.
// Returns true if a client was created and stored.
func (s *clusterService) tryReconnectCluster(ctx context.Context, c *models.Cluster) bool {
	// In-cluster rows take the dedicated InClusterConfig path; no kubeconfig file ever.
	if c.Source == "in-cluster" {
		client, err := s.buildClientForCluster(c)
		if err != nil { return false }
		return s.applyAndStoreClient(ctx, c, client)
	}
	path := c.KubeconfigPath
	if path != "" {
		if _, err := os.Stat(path); err != nil {
			path = "" // stored path missing (e.g. temp upload file gone); try default
		}
	}
	if path == "" {
		home, _ := os.UserHomeDir()
		if home != "" {
			path = filepath.Join(home, ".kube", "config")
		}
		if path == "" {
			return false
		}
	}
	client, err := k8s.NewClient(path, c.Context)
	if err != nil {
		return false
	}
	return s.applyAndStoreClient(ctx, c, client)
}

// applyAndStoreClient applies the configured timeout + rate limiter to a freshly
// built client, runs a connection test, and stores it in the in-memory client map.
// Returns false if the connection test fails — the cluster row is left unchanged.
func (s *clusterService) applyAndStoreClient(ctx context.Context, c *models.Cluster, client *k8s.Client) bool {
	if s.k8sTimeout > 0 {
		client.SetTimeout(s.k8sTimeout)
	}
	if s.k8sRateLimitPerSec > 0 && s.k8sRateLimitBurst > 0 {
		client.SetLimiter(rate.NewLimiter(rate.Limit(s.k8sRateLimitPerSec), s.k8sRateLimitBurst))
	}
	if err := client.TestConnection(ctx); err != nil {
		return false
	}
	// Map write must hold the lock — GetClient reads under RLock concurrently.
	s.mu.Lock()
	s.clients[c.ID] = client
	s.mu.Unlock()
	_ = s.overviewCache.StartClusterCache(ctx, c.ID, client)
	return true
}

// ReconnectCluster resets the circuit breaker for an existing client (if any) and builds a fresh
// K8s client from the stored kubeconfig. Updates the cluster status in the DB.
func (s *clusterService) ReconnectCluster(ctx context.Context, id string) (*models.Cluster, error) {
	c, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("cluster not found: %s", id)
	}

	// Reset the circuit breaker on any existing client so it doesn't block the TestConnection below.
	s.mu.RLock()
	existing, existed := s.clients[id]
	s.mu.RUnlock()
	if existed {
		existing.ResetCircuitBreaker()
	}

	// In-cluster rows go through buildClientForCluster (rest.InClusterConfig).
	// They have no kubeconfig file by design and must skip path validation entirely.
	if c.Source == "in-cluster" {
		client, err := s.buildClientForCluster(c)
		if err != nil {
			c.Status = "error"
			_ = s.repo.Update(ctx, c)
			return c, fmt.Errorf("in-cluster reconnect failed: %w", err)
		}
		if !s.applyAndStoreClient(ctx, c, client) {
			c.Status = "error"
			_ = s.repo.Update(ctx, c)
			return c, fmt.Errorf("in-cluster connection test failed for %s", id)
		}
		c.Status = "connected"
		c.LastConnected = time.Now()
		_ = s.repo.Update(ctx, c)
		return c, nil
	}

	// Build a fresh client (re-reads kubeconfig, fresh TLS handshake, new circuit breaker).
	//
	// Strict path validation: a missing or unreadable stored kubeconfig means
	// the cluster is gone. We must NEVER fall back to the user's system
	// ~/.kube/config — that would silently build a client against whatever
	// context is currently active (e.g. docker-desktop) while the DB row and
	// the frontend still identify this cluster as the original (e.g. AWS).
	// Silent identity substitution is a P0 data-integrity bug.
	path := c.KubeconfigPath
	if path == "" {
		c.Status = "disconnected"
		_ = s.repo.Update(ctx, c)
		return c, fmt.Errorf("cluster %s has no stored kubeconfig path — reconnect or remove it", id)
	}
	info, statErr := os.Stat(path)
	if statErr != nil {
		if errors.Is(statErr, fs.ErrNotExist) {
			c.Status = "disconnected"
			_ = s.repo.Update(ctx, c)
			return c, fmt.Errorf("cluster %s kubeconfig file no longer exists at %s — reconnect or remove it", id, path)
		}
		// Transient I/O error (permission, network-mount unreachable). Report but do
		// not mark disconnected — the next retry may succeed.
		return c, fmt.Errorf("cluster %s kubeconfig file unreadable at %s: %w", id, path, statErr)
	}
	if info.IsDir() {
		c.Status = "disconnected"
		_ = s.repo.Update(ctx, c)
		return c, fmt.Errorf("cluster %s kubeconfig path is a directory, not a file: %s", id, path)
	}

	client, err := k8s.NewClient(path, c.Context)
	if err != nil {
		c.Status = "error"
		_ = s.repo.Update(ctx, c)
		return c, fmt.Errorf("failed to create client: %w", err)
	}
	if s.k8sTimeout > 0 {
		client.SetTimeout(s.k8sTimeout)
	}
	if s.k8sRateLimitPerSec > 0 && s.k8sRateLimitBurst > 0 {
		client.SetLimiter(rate.NewLimiter(rate.Limit(s.k8sRateLimitPerSec), s.k8sRateLimitBurst))
	}
	client.SetClusterID(id)

	if err := client.TestConnection(ctx); err != nil {
		c.Status = clusterStatusFromError(err)
		_ = s.repo.Update(ctx, c)
		return c, fmt.Errorf("connection test failed: %w", err)
	}

	// Success: replace client and restart overview cache.
	// Map write must hold the lock — GetClient reads it under RLock from other
	// goroutines; unlocked writes race the runtime map rehash and can segfault.
	s.overviewCache.StopClusterCache(id)
	s.mu.Lock()
	s.clients[id] = client
	s.mu.Unlock()
	_ = s.overviewCache.StartClusterCache(ctx, id, client)
	// Clear any negative-cache entry now that we have a live client again.
	s.reconnectFailCache.Delete(id)

	if info, err := client.GetClusterInfo(ctx); err == nil {
		c.ServerURL = clusterInfoString(info, "server_url")
		c.Version = clusterInfoString(info, "version")
		c.NodeCount = clusterInfoInt(info, "node_count")
		c.NamespaceCount = clusterInfoInt(info, "namespace_count")
	}
	if p, err := client.DetectProvider(ctx); err == nil && p != "" {
		c.Provider = p
	}
	c.Status = "connected"
	c.LastConnected = time.Now()
	_ = s.repo.Update(ctx, c)
	return c, nil
}

func (s *clusterService) GetOverview(clusterID string) (*models.ClusterOverview, bool) {
	return s.overviewCache.GetOverview(clusterID)
}

func (s *clusterService) Subscribe(clusterID string) (chan *models.ClusterOverview, func(), error) {
	return s.overviewCache.Subscribe(clusterID)
}

func (s *clusterService) GetInformerManager(clusterID string) *k8s.InformerManager {
	return s.overviewCache.GetInformerManager(clusterID)
}

// DiscoverClusters scans the configured kubeconfig (or default ~/.kube/config) for contexts not yet in the repository.
func (s *clusterService) DiscoverClusters(ctx context.Context) ([]*models.Cluster, error) {
	kubeconfigPath := ""
	// Try to get path from environment or default
	kubeconfigPath = os.Getenv("KUBECONFIG")
	if kubeconfigPath == "" {
		home, _ := os.UserHomeDir()
		if home != "" {
			kubeconfigPath = filepath.Join(home, ".kube", "config")
		}
	}

	if kubeconfigPath == "" {
		return nil, fmt.Errorf("could not determine kubeconfig path")
	}

	if _, err := os.Stat(kubeconfigPath); err != nil {
		return nil, fmt.Errorf("kubeconfig not found at %s", kubeconfigPath)
	}

	contexts, currentContext, err := k8s.GetKubeconfigContexts(kubeconfigPath)
	if err != nil {
		return nil, fmt.Errorf("failed to list kubeconfig contexts: %w", err)
	}

	existingClusters, err := s.repo.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list existing clusters: %w", err)
	}

	existingContexts := make(map[string]bool)
	for _, c := range existingClusters {
		existingContexts[c.Context] = true
	}

	var discovered []*models.Cluster
	for _, contextName := range contexts {
		if !existingContexts[contextName] {
			// BA-1: Ephemeral UUID so frontend has a stable handle before registration (Connect works; no clusters// in URLs).
			discovered = append(discovered, &models.Cluster{
				ID:             uuid.New().String(),
				Name:           contextName,
				Context:        contextName,
				KubeconfigPath: kubeconfigPath,
				Status:         "detected",
				IsCurrent:      contextName == currentContext,
			})
		}
	}

	return discovered, nil
}

// computeClusterHealthStatus derives an overall cluster health status from live
// node, pod, and deployment state. Returns "healthy", "degraded", or "unhealthy".
func computeClusterHealthStatus(nodes *corev1.NodeList, pods *corev1.PodList, deployments *appsv1.DeploymentList) string {
	health := "healthy"

	// Any node not Ready → degraded
	if nodes != nil {
		for i := range nodes.Items {
			ready := false
			for _, cond := range nodes.Items[i].Status.Conditions {
				if cond.Type == corev1.NodeReady && cond.Status == corev1.ConditionTrue {
					ready = true
					break
				}
			}
			if !ready {
				health = "degraded"
				break
			}
		}
	}

	// Pod failure ratio >30% → unhealthy, >10% → degraded
	if pods != nil && len(pods.Items) > 0 {
		total := len(pods.Items)
		failing := 0
		for i := range pods.Items {
			phase := pods.Items[i].Status.Phase
			if phase == corev1.PodFailed || phase == corev1.PodPending {
				failing++
			}
		}
		ratio := float64(failing) / float64(total)
		if ratio > 0.3 {
			return "unhealthy"
		}
		if ratio > 0.1 {
			health = "degraded"
		}
	}

	// Any deployment with unavailable replicas → degraded
	if deployments != nil && health == "healthy" {
		for i := range deployments.Items {
			if deployments.Items[i].Status.UnavailableReplicas > 0 {
				health = "degraded"
				break
			}
		}
	}

	return health
}

// clusterStatusFromError maps K8s/context errors to status: "disconnected" for connection/context errors, "error" for 403/5xx etc.
func clusterStatusFromError(err error) string {
	if err == nil {
		return "connected"
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return "disconnected"
	}
	return "error"
}
