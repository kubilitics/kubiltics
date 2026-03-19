package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
	"github.com/kubilitics/kubilitics-ai/internal/audit"
	"github.com/kubilitics/kubilitics-ai/internal/config"
	grpcClient "github.com/kubilitics/kubilitics-ai/internal/integration/grpc"
	"github.com/kubilitics/kubilitics-ai/internal/memory/worldmodel"
)

// QueryMode determines how queries are executed
type QueryMode string

const (
	QueryModeLocal  QueryMode = "LOCAL"  // Query from World Model only
	QueryModeRemote QueryMode = "REMOTE" // Query from backend only
	QueryModeAuto   QueryMode = "AUTO"   // Smart routing based on freshness
)

// CacheStats holds statistics about cache usage
type CacheStats struct {
	LocalHits    int64
	RemoteHits   int64
	CacheHits    int64
	Misses       int64
	TotalQueries int64
}

// cacheEntry holds a cached value with its expiry time.
type cacheEntry struct {
	value     interface{}
	expiresAt time.Time
}

// resourceCache is a simple TTL-based in-memory cache.
type resourceCache struct {
	mu      sync.RWMutex
	entries map[string]cacheEntry
	ttl     time.Duration
}

func newResourceCache(ttl time.Duration) *resourceCache {
	c := &resourceCache{
		entries: make(map[string]cacheEntry),
		ttl:     ttl,
	}
	// Background GC to evict expired entries every 2×TTL
	go func() {
		ticker := time.NewTicker(2 * ttl)
		defer ticker.Stop()
		for range ticker.C {
			c.evict()
		}
	}()
	return c
}

func (c *resourceCache) get(key string) (interface{}, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	e, ok := c.entries[key]
	if !ok || time.Now().After(e.expiresAt) {
		return nil, false
	}
	return e.value, true
}

func (c *resourceCache) set(key string, value interface{}) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[key] = cacheEntry{value: value, expiresAt: time.Now().Add(c.ttl)}
}

func (c *resourceCache) invalidate(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, key)
}

func (c *resourceCache) evict() {
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()
	for k, e := range c.entries {
		if now.After(e.expiresAt) {
			delete(c.entries, k)
		}
	}
}

func (c *resourceCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = make(map[string]cacheEntry)
}

// Proxy provides a unified interface to backend operations
type Proxy struct {
	config     *config.Config
	grpcClient *grpcClient.Client
	worldModel *worldmodel.WorldModel
	auditLog   audit.Logger

	// State management
	mu            sync.RWMutex
	initialized   bool
	bootstrapTime time.Time

	// Cache configuration
	queryMode   QueryMode
	cacheMaxAge time.Duration
	cache       *resourceCache

	// Statistics
	stats CacheStats

	// Update handling
	updateHandler func(*pb.StateUpdate) error
	stopChan      chan struct{}
}

// NewProxy creates a new Backend Proxy
func NewProxy(cfg *config.Config, auditLog audit.Logger) (*Proxy, error) {
	if cfg == nil {
		return nil, fmt.Errorf("config is required")
	}
	if auditLog == nil {
		return nil, fmt.Errorf("audit logger is required")
	}

	// Create gRPC client
	grpcCli, err := grpcClient.NewClient(cfg, auditLog)
	if err != nil {
		return nil, fmt.Errorf("failed to create grpc client: %w", err)
	}

	// Create World Model
	wm := worldmodel.NewWorldModel()

	cacheTTL := 30 * time.Second
	return &Proxy{
		config:      cfg,
		grpcClient:  grpcCli,
		worldModel:  wm,
		auditLog:    auditLog,
		queryMode:   QueryModeAuto,
		cacheMaxAge: 5 * time.Minute,
		cache:       newResourceCache(cacheTTL),
		stopChan:    make(chan struct{}),
	}, nil
}

// Initialize connects to backend and bootstraps the World Model
func (p *Proxy) Initialize(ctx context.Context) error {
	p.mu.Lock()
	if p.initialized {
		p.mu.Unlock()
		return fmt.Errorf("proxy already initialized")
	}
	p.mu.Unlock()

	correlationID := audit.GenerateCorrelationID()
	ctx = audit.WithCorrelationID(ctx, correlationID)

	p.auditLog.Log(ctx, audit.NewEvent(audit.EventServerStarted).
		WithCorrelationID(correlationID).
		WithDescription("Initializing Backend Proxy").
		WithResult(audit.ResultPending))

	// Connect to backend
	if err := p.grpcClient.Connect(ctx); err != nil {
		p.auditLog.Log(ctx, audit.NewEvent(audit.EventServerStarted).
			WithCorrelationID(correlationID).
			WithDescription("Failed to connect to backend").
			WithError(err, "connection_failed").
			WithResult(audit.ResultFailure))
		return fmt.Errorf("failed to connect to backend: %w", err)
	}

	// Bootstrap World Model with initial cluster state
	if err := p.bootstrapWorldModel(ctx); err != nil {
		p.auditLog.Log(ctx, audit.NewEvent(audit.EventServerStarted).
			WithCorrelationID(correlationID).
			WithDescription("Failed to bootstrap World Model").
			WithError(err, "bootstrap_failed").
			WithResult(audit.ResultFailure))
		return fmt.Errorf("failed to bootstrap world model: %w", err)
	}

	// Start streaming updates
	if err := p.startUpdateStream(ctx); err != nil {
		p.auditLog.Log(ctx, audit.NewEvent(audit.EventServerStarted).
			WithCorrelationID(correlationID).
			WithDescription("Failed to start update stream").
			WithError(err, "stream_failed").
			WithResult(audit.ResultFailure))
		return fmt.Errorf("failed to start update stream: %w", err)
	}

	p.mu.Lock()
	p.initialized = true
	p.bootstrapTime = time.Now()
	p.mu.Unlock()

	p.auditLog.Log(ctx, audit.NewEvent(audit.EventServerStarted).
		WithCorrelationID(correlationID).
		WithDescription("Backend Proxy initialized successfully").
		WithResult(audit.ResultSuccess))

	return nil
}

// Shutdown gracefully shuts down the proxy
func (p *Proxy) Shutdown(ctx context.Context) error {
	p.mu.Lock()
	if !p.initialized {
		p.mu.Unlock()
		return nil
	}
	p.initialized = false
	p.mu.Unlock()

	close(p.stopChan)

	// Disconnect from backend
	if err := p.grpcClient.Disconnect(ctx); err != nil {
		return fmt.Errorf("failed to disconnect from backend: %w", err)
	}

	// Clear caches
	p.cache.clear()
	p.worldModel.Clear()

	p.auditLog.Log(ctx, audit.NewEvent(audit.EventServerShutdown).
		WithDescription("Backend Proxy shutdown complete").
		WithResult(audit.ResultSuccess))

	return nil
}

// GetResource retrieves a specific resource with smart caching
func (p *Proxy) GetResource(ctx context.Context, kind, namespace, name string) (*pb.Resource, error) {
	p.mu.RLock()
	if !p.initialized {
		p.mu.RUnlock()
		return nil, fmt.Errorf("proxy not initialized")
	}
	mode := p.queryMode
	p.mu.RUnlock()

	p.mu.Lock()
	p.stats.TotalQueries++
	p.mu.Unlock()

	cacheKey := fmt.Sprintf("res:%s:%s:%s", kind, namespace, name)

	// Try TTL cache first (fastest)
	if v, ok := p.cache.get(cacheKey); ok {
		p.mu.Lock()
		p.stats.CacheHits++
		p.mu.Unlock()
		return v.(*pb.Resource), nil
	}

	// Try world model
	if mode == QueryModeLocal || mode == QueryModeAuto {
		resource, err := p.worldModel.GetResource(ctx, kind, namespace, name)
		if err == nil {
			p.mu.Lock()
			p.stats.LocalHits++
			p.mu.Unlock()
			p.cache.set(cacheKey, resource)
			return resource, nil
		}
	}

	// Fallback to remote
	if mode == QueryModeRemote || mode == QueryModeAuto {
		resource, err := p.grpcClient.GetResource(ctx, kind, namespace, name)
		if err != nil {
			p.mu.Lock()
			p.stats.Misses++
			p.mu.Unlock()
			return nil, fmt.Errorf("failed to get resource from backend: %w", err)
		}

		p.mu.Lock()
		p.stats.RemoteHits++
		p.mu.Unlock()

		p.cache.set(cacheKey, resource)
		return resource, nil
	}

	return nil, fmt.Errorf("resource not found: %s/%s/%s", kind, namespace, name)
}

// ListResources lists resources with smart caching
func (p *Proxy) ListResources(ctx context.Context, kind, namespace string) ([]*pb.Resource, error) {
	p.mu.RLock()
	if !p.initialized {
		p.mu.RUnlock()
		return nil, fmt.Errorf("proxy not initialized")
	}
	mode := p.queryMode
	p.mu.RUnlock()

	p.mu.Lock()
	p.stats.TotalQueries++
	p.mu.Unlock()

	cacheKey := fmt.Sprintf("list:%s:%s", kind, namespace)

	// Try TTL cache first
	if v, ok := p.cache.get(cacheKey); ok {
		p.mu.Lock()
		p.stats.CacheHits++
		p.mu.Unlock()
		return v.([]*pb.Resource), nil
	}

	// Try world model
	if mode == QueryModeLocal || mode == QueryModeAuto {
		resources, err := p.worldModel.ListResources(ctx, kind, namespace)
		if err == nil && len(resources) > 0 {
			p.mu.Lock()
			p.stats.LocalHits++
			p.mu.Unlock()
			p.cache.set(cacheKey, resources)
			return resources, nil
		}
	}

	// Fallback to remote
	if mode == QueryModeRemote || mode == QueryModeAuto {
		result, err := p.grpcClient.ListResources(ctx, kind, namespace, nil)
		if err != nil {
			p.mu.Lock()
			p.stats.Misses++
			p.mu.Unlock()
			return nil, fmt.Errorf("failed to list resources from backend: %w", err)
		}

		p.mu.Lock()
		p.stats.RemoteHits++
		p.mu.Unlock()

		p.cache.set(cacheKey, result.Items)
		return result.Items, nil
	}

	return []*pb.Resource{}, nil
}

// ListResourcesByLabels lists resources matching label selectors
func (p *Proxy) ListResourcesByLabels(ctx context.Context, kind, namespace string, labels map[string]string) ([]*pb.Resource, error) {
	p.mu.RLock()
	if !p.initialized {
		p.mu.RUnlock()
		return nil, fmt.Errorf("proxy not initialized")
	}
	mode := p.queryMode
	p.mu.RUnlock()

	// Increment total queries
	p.mu.Lock()
	p.stats.TotalQueries++
	p.mu.Unlock()

	// Try local cache first if mode allows
	if mode == QueryModeLocal || mode == QueryModeAuto {
		resources, err := p.worldModel.ListResourcesByLabels(ctx, kind, namespace, labels)
		if err == nil && len(resources) > 0 {
			// Cache hit
			p.mu.Lock()
			p.stats.LocalHits++
			p.mu.Unlock()
			return resources, nil
		}
	}

	// Fallback to remote if AUTO mode or REMOTE mode
	if mode == QueryModeRemote || mode == QueryModeAuto {
		result, err := p.grpcClient.ListResources(ctx, kind, namespace, labels)
		if err != nil {
			p.mu.Lock()
			p.stats.Misses++
			p.mu.Unlock()
			return nil, fmt.Errorf("failed to list resources from backend: %w", err)
		}

		p.mu.Lock()
		p.stats.RemoteHits++
		p.mu.Unlock()

		return result.Items, nil
	}

	return []*pb.Resource{}, nil
}

// ExecuteCommand executes a command against a resource (always goes to backend)
func (p *Proxy) ExecuteCommand(ctx context.Context, operation string, target *pb.Resource, params []byte, dryRun bool) (*pb.CommandResult, error) {
	p.mu.RLock()
	if !p.initialized {
		p.mu.RUnlock()
		return nil, fmt.Errorf("proxy not initialized")
	}
	p.mu.RUnlock()

	correlationID := audit.GenerateCorrelationID()
	ctx = audit.WithCorrelationID(ctx, correlationID)

	p.auditLog.Log(ctx, audit.NewEvent(audit.EventActionProposed).
		WithCorrelationID(correlationID).
		WithDescription(fmt.Sprintf("Executing command: %s on %s/%s/%s", operation, target.Kind, target.Namespace, target.Name)).
		WithResult(audit.ResultPending))

	result, err := p.grpcClient.ExecuteCommand(ctx, operation, target, params, dryRun)
	if err != nil {
		p.auditLog.Log(ctx, audit.NewEvent(audit.EventActionProposed).
			WithCorrelationID(correlationID).
			WithDescription("Command execution failed").
			WithError(err, "command_failed").
			WithResult(audit.ResultFailure))
		return nil, fmt.Errorf("failed to execute command: %w", err)
	}

	p.auditLog.Log(ctx, audit.NewEvent(audit.EventActionProposed).
		WithCorrelationID(correlationID).
		WithDescription("Command executed successfully").
		WithResult(audit.ResultSuccess))

	return result, nil
}

// GetTopologyGraph retrieves the topology graph (delegated to backend)
func (p *Proxy) GetTopologyGraph(ctx context.Context, namespace string, maxDepth int32) (*pb.TopologyGraph, error) {
	p.mu.RLock()
	if !p.initialized {
		p.mu.RUnlock()
		return nil, fmt.Errorf("proxy not initialized")
	}
	p.mu.RUnlock()

	return p.grpcClient.GetTopologyGraph(ctx, namespace, maxDepth)
}

// GetClusterHealth retrieves cluster health metrics (delegated to backend)
func (p *Proxy) GetClusterHealth(ctx context.Context) (*pb.ClusterHealth, error) {
	p.mu.RLock()
	if !p.initialized {
		p.mu.RUnlock()
		return nil, fmt.Errorf("proxy not initialized")
	}
	p.mu.RUnlock()

	return p.grpcClient.GetClusterHealth(ctx)
}

// SetQueryMode sets the query mode for the proxy
func (p *Proxy) SetQueryMode(mode QueryMode) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.queryMode = mode
}

// GetQueryMode returns the current query mode
func (p *Proxy) GetQueryMode() QueryMode {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.queryMode
}

// SetUpdateHandler sets a custom handler for state updates
func (p *Proxy) SetUpdateHandler(handler func(*pb.StateUpdate) error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.updateHandler = handler
}

// GetStats returns statistics about cache usage and proxy operations
func (p *Proxy) GetStats() map[string]interface{} {
	p.mu.RLock()
	defer p.mu.RUnlock()

	var hitRate float64
	if p.stats.TotalQueries > 0 {
		hitRate = float64(p.stats.LocalHits) / float64(p.stats.TotalQueries) * 100
	}

	return map[string]interface{}{
		"initialized":       p.initialized,
		"bootstrap_time":    p.bootstrapTime,
		"query_mode":        p.queryMode,
		"total_queries":     p.stats.TotalQueries,
		"local_hits":        p.stats.LocalHits,
		"ttl_cache_hits":    p.stats.CacheHits,
		"remote_hits":       p.stats.RemoteHits,
		"misses":            p.stats.Misses,
		"cache_hit_rate":    fmt.Sprintf("%.2f%%", hitRate),
		"world_model_stats": p.worldModel.GetStats(),
		"grpc_stats":        p.grpcClient.GetStats(),
	}
}

// IsInitialized returns whether the proxy is initialized
func (p *Proxy) IsInitialized() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.initialized
}

// GetWorldModel returns the underlying World Model (for testing/debugging)
func (p *Proxy) GetWorldModel() *worldmodel.WorldModel {
	return p.worldModel
}

// bootstrapWorldModel performs initial bootstrap of the World Model
func (p *Proxy) bootstrapWorldModel(ctx context.Context) error {
	// List all resources from backend
	result, err := p.grpcClient.ListResources(ctx, "", "", nil)
	if err != nil {
		return fmt.Errorf("failed to list resources for bootstrap: %w", err)
	}

	// Bootstrap World Model with initial state
	if err := p.worldModel.Bootstrap(ctx, result.Items); err != nil {
		return fmt.Errorf("failed to bootstrap world model: %w", err)
	}

	p.auditLog.Log(ctx, audit.NewEvent(audit.EventServerStarted).
		WithDescription(fmt.Sprintf("Bootstrapped World Model with %d resources", len(result.Items))).
		WithResult(audit.ResultSuccess))

	return nil
}

// startUpdateStream starts the gRPC stream and processes updates
func (p *Proxy) startUpdateStream(ctx context.Context) error {
	// Start streaming all namespaces and resource kinds
	if err := p.grpcClient.StreamClusterState(ctx, nil, nil); err != nil {
		return fmt.Errorf("failed to start cluster state stream: %w", err)
	}

	// Start goroutine to process updates
	go p.processUpdates(ctx)

	return nil
}

// processUpdates processes incoming state updates from the gRPC stream
func (p *Proxy) processUpdates(ctx context.Context) {
	updatesChan := p.grpcClient.ReceiveUpdates()

	for {
		select {
		case <-ctx.Done():
			return
		case <-p.stopChan:
			return
		case update := <-updatesChan:
			// Type assertion to StateUpdate
			stateUpdate, ok := update.(*pb.StateUpdate)
			if !ok {
				p.auditLog.Log(ctx, audit.NewEvent(audit.EventInvestigationFailed).
					WithDescription("Received invalid update type").
					WithResult(audit.ResultFailure))
				continue
			}

			// Apply to World Model
			if err := p.worldModel.ApplyUpdate(ctx, stateUpdate); err != nil {
				p.auditLog.Log(ctx, audit.NewEvent(audit.EventInvestigationFailed).
					WithDescription("Failed to apply update to World Model").
					WithError(err, "update_failed"))
				continue
			}

			// Call custom handler if set
			p.mu.RLock()
			handler := p.updateHandler
			p.mu.RUnlock()

			if handler != nil {
				if err := handler(stateUpdate); err != nil {
					p.auditLog.Log(ctx, audit.NewEvent(audit.EventInvestigationFailed).
						WithDescription("Update handler failed").
						WithError(err, "handler_failed"))
				}
			}
		}
	}
}

// GetWorldModelStats returns statistics specifically about the World Model state.
// This is used by the backend status endpoint (A-CORE-008).
func (p *Proxy) GetWorldModelStats() map[string]interface{} {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.worldModel.GetStats()
}

// GetResourceMetrics returns a map of metric-name → float64 for a resource.
// It extracts numeric values from the resource's Data JSON (status fields).
// If the backend is unavailable or the resource has no metrics, it returns an empty map.
func (p *Proxy) GetResourceMetrics(ctx context.Context, kind, namespace, name string) (map[string]float64, error) {
	res, err := p.GetResource(ctx, kind, namespace, name)
	if err != nil || res == nil {
		return map[string]float64{}, nil
	}

	metrics := map[string]float64{}
	if len(res.Data) == 0 {
		return metrics, nil
	}

	var parsed map[string]interface{}
	if err2 := json.Unmarshal(res.Data, &parsed); err2 != nil {
		return metrics, nil
	}

	// Extract numeric values from top-level "metrics" key if present.
	if m, ok := parsed["metrics"].(map[string]interface{}); ok {
		for k, v := range m {
			if f, ok2 := proxyToFloat64(v); ok2 {
				metrics[k] = f
			}
		}
	}

	// Extract restart counts and availability from status.
	if status, ok := parsed["status"].(map[string]interface{}); ok {
		if cs, ok2 := status["containerStatuses"].([]interface{}); ok2 {
			restarts := 0.0
			for _, c := range cs {
				if cm, ok3 := c.(map[string]interface{}); ok3 {
					if rc, ok4 := proxyToFloat64(cm["restartCount"]); ok4 {
						restarts += rc
					}
				}
			}
			metrics["restart_count"] = restarts
		}
		if phase, ok2 := status["phase"].(string); ok2 {
			if phase == "Running" {
				metrics["availability"] = 1.0
			} else {
				metrics["availability"] = 0.0
			}
		}
	}

	return metrics, nil
}

// proxyToFloat64 safely converts an interface{} value to float64.
func proxyToFloat64(v interface{}) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case int32:
		return float64(n), true
	}
	return 0, false
}
