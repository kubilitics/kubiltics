package service

import (
	"context"
	"errors"
	"fmt"
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
	"golang.org/x/time/rate"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/clientcmd"
)

const defaultMaxClusters = 100

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
	// HasMetalLB returns true if MetalLB CRDs (ipaddresspools, bgppeers) are installed in the cluster.
	HasMetalLB(ctx context.Context, id string) (bool, error)
	// DiscoverClusters scans the configured kubeconfig for contexts not yet in the repository.
	DiscoverClusters(ctx context.Context) ([]*models.Cluster, error)
	// GetOverview returns the cached overview for a cluster if available.
	GetOverview(clusterID string) (*models.ClusterOverview, bool)
	// Subscribe returns a channel and unsubscribe function for real-time overview updates.
	Subscribe(clusterID string) (chan *models.ClusterOverview, func())
	// ReconnectCluster resets the circuit breaker and forces a fresh K8s client connection.
	// Call this when the user explicitly requests reconnect or the cluster status page is opened.
	ReconnectCluster(ctx context.Context, id string) (*models.Cluster, error)
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
				c.ServerURL = info["server_url"].(string)
				c.Version = info["version"].(string)
				c.NodeCount = info["node_count"].(int)
				c.NamespaceCount = info["namespace_count"].(int)
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
							c.ServerURL = info["server_url"].(string)
							c.Version = info["version"].(string)
							c.NodeCount = info["node_count"].(int)
							c.NamespaceCount = info["namespace_count"].(int)
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
			c.ServerURL = info["server_url"].(string)
			c.Version = info["version"].(string)
			c.NodeCount = info["node_count"].(int)
			c.NamespaceCount = info["namespace_count"].(int)
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
					c.ServerURL = info["server_url"].(string)
					c.Version = info["version"].(string)
					c.NodeCount = info["node_count"].(int)
					c.NamespaceCount = info["namespace_count"].(int)
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

func (s *clusterService) AddCluster(ctx context.Context, kubeconfigPath, contextName string) (*models.Cluster, error) {
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
		return nil, fmt.Errorf("cluster limit reached (max %d); cannot add more clusters", s.maxClusters)
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
			serverURL = info["server_url"].(string)
			version = info["version"].(string)
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
	return s.AddCluster(ctx, kubeconfigPath, contextName)
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

	pods, _ := client.Clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	deployments, _ := client.Clientset.AppsV1().Deployments("").List(ctx, metav1.ListOptions{})
	services, _ := client.Clientset.CoreV1().Services("").List(ctx, metav1.ListOptions{})

	return &models.ClusterSummary{
		ID:              id,
		Name:            id,
		NodeCount:       info["node_count"].(int),
		NamespaceCount:  info["namespace_count"].(int),
		PodCount:        len(pods.Items),
		DeploymentCount: len(deployments.Items),
		ServiceCount:    len(services.Items),
		HealthStatus:    "healthy",
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
		if c.KubeconfigPath == "" {
			c.Status = "disconnected"
			_ = s.repo.Update(ctx, c)
			continue
		}
		// New client for each cluster
		var client *k8s.Client
		var clientErr error
		if s.clientFactory != nil {
			client, clientErr = s.clientFactory(c.KubeconfigPath, c.Context)
		} else {
			client, clientErr = k8s.NewClient(c.KubeconfigPath, c.Context)
		}

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
	if s.k8sTimeout > 0 {
		client.SetTimeout(s.k8sTimeout)
	}
	if s.k8sRateLimitPerSec > 0 && s.k8sRateLimitBurst > 0 {
		client.SetLimiter(rate.NewLimiter(rate.Limit(s.k8sRateLimitPerSec), s.k8sRateLimitBurst))
	}
	if err := client.TestConnection(ctx); err != nil {
		return false
	}
	s.clients[c.ID] = client
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
	if existing, ok := s.clients[id]; ok {
		existing.ResetCircuitBreaker()
	}

	// Build a fresh client (re-reads kubeconfig, fresh TLS handshake, new circuit breaker).
	path := c.KubeconfigPath
	if path != "" {
		if _, err := os.Stat(path); err != nil {
			path = ""
		}
	}
	if path == "" {
		home, _ := os.UserHomeDir()
		if home != "" {
			path = filepath.Join(home, ".kube", "config")
		}
	}
	if path == "" {
		c.Status = "disconnected"
		_ = s.repo.Update(ctx, c)
		return c, fmt.Errorf("no kubeconfig available for cluster %s", id)
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
	s.overviewCache.StopClusterCache(id)
	s.clients[id] = client
	_ = s.overviewCache.StartClusterCache(ctx, id, client)

	if info, err := client.GetClusterInfo(ctx); err == nil {
		c.ServerURL = info["server_url"].(string)
		c.Version = info["version"].(string)
		c.NodeCount = info["node_count"].(int)
		c.NamespaceCount = info["namespace_count"].(int)
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

func (s *clusterService) Subscribe(clusterID string) (chan *models.ClusterOverview, func()) {
	return s.overviewCache.Subscribe(clusterID)
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
