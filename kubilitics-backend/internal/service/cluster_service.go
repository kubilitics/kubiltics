package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	"golang.org/x/time/rate"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const defaultMaxClusters = 100

// ClusterService manages Kubernetes clusters
type ClusterService interface {
	ListClusters(ctx context.Context) ([]*models.Cluster, error)
	GetCluster(ctx context.Context, id string) (*models.Cluster, error)
	AddCluster(ctx context.Context, kubeconfigPath, contextName string) (*models.Cluster, error)
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
}

// K8sClientFactory creates a k8s client from kubeconfig path and context. Used in tests to inject a fake client.
// When nil, AddCluster uses k8s.NewClient.
type K8sClientFactory func(kubeconfigPath, contextName string) (*k8s.Client, error)

type clusterService struct {
	repo               repository.ClusterRepository
	clients            map[string]*k8s.Client // id -> live K8s client
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
	for _, c := range clusters {
		c.IsCurrent = (c.Context == currentContext)
		if client, ok := s.clients[c.ID]; ok {
			info, err := client.GetClusterInfo(ctx)
			if err != nil {
				c.Status = clusterStatusFromError(err)
				_ = s.repo.Update(ctx, c)
				continue
			}
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
			// No in-memory client (e.g. after restart or temp kubeconfig gone); try reconnect with stored or default kubeconfig
			if s.tryReconnectCluster(ctx, c) {
				if client, ok := s.clients[c.ID]; ok {
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
	}
	return clusters, nil
}

func (s *clusterService) GetCluster(ctx context.Context, id string) (*models.Cluster, error) {
	c, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if client, ok := s.clients[id]; ok {
		info, err := client.GetClusterInfo(ctx)
		if err == nil {
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
			if client, ok := s.clients[id]; ok {
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
	list, err := s.repo.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list clusters: %w", err)
	}
	if len(list) >= s.maxClusters {
		return nil, fmt.Errorf("cluster limit reached (max %d); cannot add more clusters", s.maxClusters)
	}

	var client *k8s.Client
	if s.clientFactory != nil {
		var err error
		client, err = s.clientFactory(kubeconfigPath, contextName)
		if err != nil {
			return nil, fmt.Errorf("failed to create client: %w", err)
		}
	} else {
		var err error
		client, err = k8s.NewClient(kubeconfigPath, contextName)
		if err != nil {
			return nil, fmt.Errorf("failed to create client: %w", err)
		}
	}
	if s.k8sTimeout > 0 {
		client.SetTimeout(s.k8sTimeout)
	}
	if s.k8sRateLimitPerSec > 0 && s.k8sRateLimitBurst > 0 {
		client.SetLimiter(rate.NewLimiter(rate.Limit(s.k8sRateLimitPerSec), s.k8sRateLimitBurst))
	}

	if err := client.TestConnection(ctx); err != nil {
		return nil, fmt.Errorf("connection test failed: %w", err)
	}

	info, err := client.GetClusterInfo(ctx)
	if err != nil {
		return nil, err
	}
	serverURL := info["server_url"].(string)
	version := info["version"].(string)
	provider := k8s.ProviderOnPrem
	if p, err := client.DetectProvider(ctx); err == nil && p != "" {
		provider = p
	}

	// P2-10: Idempotent add — return existing cluster (same ID) when (context, kubeconfig_path) or (context, server_url) matches.
	normPath := filepath.Clean(kubeconfigPath)
	for _, c := range list {
		if c.Context != contextName {
			continue
		}
		if filepath.Clean(c.KubeconfigPath) == normPath || c.ServerURL == serverURL {
			c.Status = "connected"
			c.LastConnected = time.Now()
			c.ServerURL = serverURL
			c.Version = version
			c.Provider = provider
			c.UpdatedAt = time.Now()
			_ = s.repo.Update(ctx, c)
			s.clients[c.ID] = client
			return c, nil
		}
	}

	cluster := &models.Cluster{
		ID:             uuid.New().String(),
		Name:           contextName,
		Context:        contextName,
		KubeconfigPath: kubeconfigPath,
		ServerURL:      serverURL,
		Version:        version,
		Status:         "connected",
		Provider:       provider,
		LastConnected:  time.Now(),
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}
	if err := s.repo.Create(ctx, cluster); err != nil {
		return nil, fmt.Errorf("failed to persist cluster: %w", err)
	}
	s.clients[cluster.ID] = client
	return cluster, nil
}

func (s *clusterService) RemoveCluster(ctx context.Context, id string) error {
	if _, err := s.repo.Get(ctx, id); err != nil {
		return fmt.Errorf("cluster not found: %s", id)
	}
	if err := s.repo.Delete(ctx, id); err != nil {
		return err
	}
	delete(s.clients, id)
	return nil
}

func (s *clusterService) TestConnection(ctx context.Context, id string) error {
	client, exists := s.clients[id]
	if !exists {
		return fmt.Errorf("cluster not found: %s", id)
	}
	return client.TestConnection(ctx)
}

func (s *clusterService) GetClusterSummary(ctx context.Context, id string) (*models.ClusterSummary, error) {
	client, exists := s.clients[id]
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
	client, exists := s.clients[id]
	if !exists {
		return nil, fmt.Errorf("cluster not found: %s", id)
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

// LoadClustersFromRepo restores K8s clients from persisted clusters (call on startup).
// Per-cluster failures do not abort the process; each cluster gets status disconnected/error.
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
		client, err := k8s.NewClient(c.KubeconfigPath, c.Context)
		if err != nil {
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
		if err := client.TestConnection(ctx); err != nil {
			c.Status = clusterStatusFromError(err)
			_ = s.repo.Update(ctx, c)
			continue
		}
		s.clients[c.ID] = client
		c.Status = "connected"
		c.LastConnected = time.Now()
		if p, err := client.DetectProvider(ctx); err == nil && p != "" {
			c.Provider = p
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
	return true
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
