package grpc

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/connectivity"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"

	pb "github.com/kubilitics/kubilitics-ai/api/proto/v1"
	"github.com/kubilitics/kubilitics-ai/internal/audit"
	"github.com/kubilitics/kubilitics-ai/internal/config"
)

// ConnectionState represents the state of the gRPC connection
type ConnectionState string

const (
	StateDisconnected ConnectionState = "DISCONNECTED"
	StateConnecting   ConnectionState = "CONNECTING"
	StateConnected    ConnectionState = "CONNECTED"
	StateReconnecting ConnectionState = "RECONNECTING"
)

// reconnectPolicy defines reconnect backoff parameters.
type reconnectPolicy struct {
	initialDelay time.Duration
	maxDelay     time.Duration
	multiplier   float64
	maxAttempts  int // 0 = unlimited
}

var defaultReconnectPolicy = reconnectPolicy{
	initialDelay: 1 * time.Second,
	maxDelay:     60 * time.Second,
	multiplier:   2.0,
	maxAttempts:  0,
}

// Client is the gRPC client for kubilitics-backend
type Client struct {
	config   *config.Config
	conn     *grpc.ClientConn
	client   pb.ClusterDataServiceClient
	auditLog audit.Logger

	// Connection state
	mu             sync.RWMutex
	state          ConnectionState
	lastUpdate     time.Time
	connectedAt    time.Time
	reconnectCount int
	totalUpdates   int64

	// Reconnect policy
	reconnect reconnectPolicy

	// Channels
	updatesChan chan interface{}
	stateChan   chan ConnectionState
	stopChan    chan struct{}

	// Backpressure
	backlogLimit        int
	droppedUpdates      int64
	backpressureHandler func(queueSize int, droppedCount int)
}

// NewClient creates a new gRPC client for kubilitics-backend
func NewClient(cfg *config.Config, auditLog audit.Logger) (*Client, error) {
	if cfg == nil {
		return nil, fmt.Errorf("config is required")
	}
	if auditLog == nil {
		return nil, fmt.Errorf("audit logger is required")
	}

	return &Client{
		config:       cfg,
		auditLog:     auditLog,
		state:        StateDisconnected,
		reconnect:    defaultReconnectPolicy,
		updatesChan:  make(chan interface{}, 1000),
		stateChan:    make(chan ConnectionState, 10),
		stopChan:     make(chan struct{}),
		backlogLimit: 1000,
	}, nil
}

// Connect establishes connection to kubilitics-backend
func (c *Client) Connect(ctx context.Context) error {
	c.mu.Lock()
	if c.state == StateConnected || c.state == StateConnecting {
		c.mu.Unlock()
		return fmt.Errorf("already connected or connecting")
	}
	c.setState(StateConnecting)
	c.mu.Unlock()

	// Log connection attempt
	correlationID := audit.GenerateCorrelationID()
	ctx = audit.WithCorrelationID(ctx, correlationID)

	c.auditLog.Log(ctx, audit.NewEvent(audit.EventServerStarted).
		WithCorrelationID(correlationID).
		WithDescription(fmt.Sprintf("Connecting to backend at %s", c.config.Backend.Address)).
		WithResult(audit.ResultPending))

	// Set up transport credentials (TLS or insecure)
	transportCreds, err := c.buildTransportCredentials()
	if err != nil {
		c.setState(StateDisconnected)
		return fmt.Errorf("failed to build transport credentials: %w", err)
	}

	// Set up connection options
	opts := []grpc.DialOption{
		grpc.WithTransportCredentials(transportCreds),
		grpc.WithKeepaliveParams(keepalive.ClientParameters{
			Time:                60 * time.Second,
			Timeout:             20 * time.Second,
			PermitWithoutStream: true,
		}),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(100*1024*1024), // 100MB max message size
			grpc.MaxCallSendMsgSize(100*1024*1024),
		),
	}

	// Dial with timeout
	dialCtx, cancel := context.WithTimeout(ctx, time.Duration(c.config.Backend.Timeout)*time.Second)
	defer cancel()

	conn, err := grpc.DialContext(dialCtx, c.config.Backend.Address, opts...)
	if err != nil {
		c.setState(StateDisconnected)
		c.auditLog.Log(ctx, audit.NewEvent(audit.EventServerStarted).
			WithCorrelationID(correlationID).
			WithDescription(fmt.Sprintf("Failed to connect to backend at %s", c.config.Backend.Address)).
			WithError(err, "connection_failed").
			WithResult(audit.ResultFailure))
		return fmt.Errorf("failed to dial backend: %w", err)
	}

	c.mu.Lock()
	c.conn = conn
	c.client = pb.NewClusterDataServiceClient(conn)
	c.connectedAt = time.Now()
	c.setState(StateConnected)
	c.mu.Unlock()

	// Log successful connection
	c.auditLog.Log(ctx, audit.NewEvent(audit.EventServerStarted).
		WithCorrelationID(correlationID).
		WithDescription(fmt.Sprintf("Connected to backend at %s", c.config.Backend.Address)).
		WithResult(audit.ResultSuccess))

	// Start connection monitoring
	go c.monitorConnection(ctx)

	return nil
}

// Disconnect closes the connection gracefully
func (c *Client) Disconnect(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.state == StateDisconnected {
		return nil
	}

	close(c.stopChan)

	c.setState(StateDisconnected)

	if c.conn != nil {
		if err := c.conn.Close(); err != nil {
			return fmt.Errorf("failed to close connection: %w", err)
		}
		c.conn = nil
		c.client = nil
	}

	// Log disconnection
	c.auditLog.Log(ctx, audit.NewEvent(audit.EventServerShutdown).
		WithDescription("Disconnected from backend").
		WithResult(audit.ResultSuccess))

	return nil
}

// StreamClusterState subscribes to cluster state updates
func (c *Client) StreamClusterState(ctx context.Context, namespaces []string, resourceKinds []string) error {
	c.mu.RLock()
	if c.state != StateConnected {
		c.mu.RUnlock()
		return fmt.Errorf("not connected")
	}
	client := c.client
	c.mu.RUnlock()

	req := &pb.StateStreamRequest{
		Namespaces:      namespaces,
		ResourceKinds:   resourceKinds,
		IncludeSnapshot: true,
	}

	stream, err := client.StreamClusterState(ctx, req)
	if err != nil {
		return fmt.Errorf("failed to start stream: %w", err)
	}

	// Read from stream in background
	go c.consumeStream(ctx, stream)

	return nil
}

// consumeStream reads updates from the stream and pushes to channel
func (c *Client) consumeStream(ctx context.Context, stream pb.ClusterDataService_StreamClusterStateClient) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.stopChan:
			return
		default:
			update, err := stream.Recv()
			if err != nil {
				// Stream error - trigger reconnection
				c.auditLog.Log(ctx, audit.NewEvent(audit.EventInvestigationFailed).
					WithDescription("Stream error, will reconnect").
					WithError(err, "stream_error"))
				return
			}

			// Update stats
			c.mu.Lock()
			c.lastUpdate = time.Now()
			c.totalUpdates++
			c.mu.Unlock()

			// Push to channel (non-blocking)
			select {
			case c.updatesChan <- update:
				// Successfully queued
			default:
				// Channel full - backpressure
				c.mu.Lock()
				c.droppedUpdates++
				dropped := c.droppedUpdates
				c.mu.Unlock()

				if c.backpressureHandler != nil {
					c.backpressureHandler(len(c.updatesChan), int(dropped))
				}
			}
		}
	}
}

// GetResource retrieves a specific resource
func (c *Client) GetResource(ctx context.Context, kind, namespace, name string) (*pb.Resource, error) {
	c.mu.RLock()
	if c.state != StateConnected {
		c.mu.RUnlock()
		return nil, fmt.Errorf("not connected")
	}
	client := c.client
	c.mu.RUnlock()

	req := &pb.ResourceRequest{
		Kind:      kind,
		Namespace: namespace,
		Name:      name,
	}

	return client.GetResource(ctx, req)
}

// ListResources lists resources of a given kind
func (c *Client) ListResources(ctx context.Context, kind, namespace string, labels map[string]string) (*pb.ResourceList, error) {
	c.mu.RLock()
	if c.state != StateConnected {
		c.mu.RUnlock()
		return nil, fmt.Errorf("not connected")
	}
	client := c.client
	c.mu.RUnlock()

	req := &pb.ListRequest{
		Kind:          kind,
		Namespace:     namespace,
		LabelSelector: labels,
	}

	return client.ListResources(ctx, req)
}

// ExecuteCommand executes a command against a resource
func (c *Client) ExecuteCommand(ctx context.Context, operation string, target *pb.Resource, params []byte, dryRun bool) (*pb.CommandResult, error) {
	c.mu.RLock()
	if c.state != StateConnected {
		c.mu.RUnlock()
		return nil, fmt.Errorf("not connected")
	}
	client := c.client
	c.mu.RUnlock()

	req := &pb.CommandRequest{
		Operation:     operation,
		Target:        target,
		Params:        params,
		DryRun:        dryRun,
		CorrelationId: audit.GenerateCorrelationID(),
	}

	return client.ExecuteCommand(ctx, req)
}

// GetTopologyGraph retrieves the topology graph
func (c *Client) GetTopologyGraph(ctx context.Context, namespace string, maxDepth int32) (*pb.TopologyGraph, error) {
	c.mu.RLock()
	if c.state != StateConnected {
		c.mu.RUnlock()
		return nil, fmt.Errorf("not connected")
	}
	client := c.client
	c.mu.RUnlock()

	req := &pb.TopologyRequest{
		Namespace: namespace,
		MaxDepth:  maxDepth,
	}

	return client.GetTopologyGraph(ctx, req)
}

// GetClusterHealth retrieves cluster health metrics
func (c *Client) GetClusterHealth(ctx context.Context) (*pb.ClusterHealth, error) {
	c.mu.RLock()
	if c.state != StateConnected {
		c.mu.RUnlock()
		return nil, fmt.Errorf("not connected")
	}
	client := c.client
	c.mu.RUnlock()

	req := &pb.HealthRequest{
		IncludeDetails: true,
	}

	return client.GetClusterHealth(ctx, req)
}

// ReceiveUpdates returns the channel for receiving updates
func (c *Client) ReceiveUpdates() <-chan interface{} {
	return c.updatesChan
}

// StateChanges returns the channel for connection state changes
func (c *Client) StateChanges() <-chan ConnectionState {
	return c.stateChan
}

// IsConnected returns whether the client is connected
func (c *Client) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.state == StateConnected
}

// GetState returns the current connection state
func (c *Client) GetState() ConnectionState {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.state
}

// GetStats returns connection statistics
func (c *Client) GetStats() map[string]interface{} {
	c.mu.RLock()
	defer c.mu.RUnlock()

	var connectedDuration time.Duration
	if c.state == StateConnected {
		connectedDuration = time.Since(c.connectedAt)
	}

	return map[string]interface{}{
		"state":              c.state,
		"connected_at":       c.connectedAt,
		"connected_duration": connectedDuration.String(),
		"last_update":        c.lastUpdate,
		"total_updates":      c.totalUpdates,
		"reconnect_count":    c.reconnectCount,
		"dropped_updates":    c.droppedUpdates,
		"backlog_size":       len(c.updatesChan),
	}
}

// SetBackpressureHandler sets a custom backpressure handler
func (c *Client) SetBackpressureHandler(handler func(queueSize int, droppedCount int)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.backpressureHandler = handler
}

// setState changes the connection state and notifies listeners
func (c *Client) setState(state ConnectionState) {
	c.state = state

	// Non-blocking send to state channel
	select {
	case c.stateChan <- state:
	default:
	}
}

// monitorConnection monitors the connection health and triggers reconnect on failure.
func (c *Client) monitorConnection(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-c.stopChan:
			return
		case <-ticker.C:
			c.mu.RLock()
			conn := c.conn
			c.mu.RUnlock()

			if conn == nil {
				continue
			}

			state := conn.GetState()
			if state == connectivity.TransientFailure || state == connectivity.Shutdown {
				c.auditLog.Log(ctx, audit.NewEvent(audit.EventInvestigationFailed).
					WithDescription(fmt.Sprintf("Connection unhealthy: %v, triggering reconnect", state)))
				go c.reconnectWithBackoff(ctx)
			}
		}
	}
}

// reconnectWithBackoff attempts to reconnect using exponential backoff.
func (c *Client) reconnectWithBackoff(ctx context.Context) {
	c.mu.Lock()
	if c.state == StateReconnecting || c.state == StateConnecting {
		c.mu.Unlock()
		return
	}
	c.setState(StateReconnecting)
	c.mu.Unlock()

	delay := c.reconnect.initialDelay
	attempt := 0

	for {
		select {
		case <-ctx.Done():
			return
		case <-c.stopChan:
			return
		default:
		}

		if c.reconnect.maxAttempts > 0 && attempt >= c.reconnect.maxAttempts {
			c.auditLog.Log(ctx, audit.NewEvent(audit.EventInvestigationFailed).
				WithDescription(fmt.Sprintf("Reconnect: max attempts (%d) reached, giving up", c.reconnect.maxAttempts)))
			c.setState(StateDisconnected)
			return
		}

		attempt++
		c.mu.Lock()
		c.reconnectCount++
		c.mu.Unlock()

		c.auditLog.Log(ctx, audit.NewEvent(audit.EventServerStarted).
			WithDescription(fmt.Sprintf("Reconnect attempt %d (delay: %v)", attempt, delay)))

		// Close old connection
		c.mu.Lock()
		if c.conn != nil {
			_ = c.conn.Close()
			c.conn = nil
			c.client = nil
		}
		c.mu.Unlock()

		// Wait before retrying
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-c.stopChan:
			timer.Stop()
			return
		case <-timer.C:
		}

		// Try to reconnect
		if err := c.Connect(ctx); err != nil {
			c.auditLog.Log(ctx, audit.NewEvent(audit.EventInvestigationFailed).
				WithDescription(fmt.Sprintf("Reconnect attempt %d failed: %v", attempt, err)))

			// Increase delay with cap
			delay = time.Duration(float64(delay) * c.reconnect.multiplier)
			if delay > c.reconnect.maxDelay {
				delay = c.reconnect.maxDelay
			}
			continue
		}

		c.auditLog.Log(ctx, audit.NewEvent(audit.EventServerStarted).
			WithDescription(fmt.Sprintf("Reconnected successfully after %d attempt(s)", attempt)).
			WithResult(audit.ResultSuccess))
		return
	}
}

// buildTransportCredentials returns TLS or insecure credentials based on config.
func (c *Client) buildTransportCredentials() (credentials.TransportCredentials, error) {
	if !c.config.Backend.TLSEnabled {
		return insecure.NewCredentials(), nil
	}

	tlsCfg := &tls.Config{
		MinVersion: tls.VersionTLS12,
	}

	// Load client certificate if provided
	if c.config.Backend.TLSCertPath != "" && c.config.Backend.TLSKeyPath != "" {
		cert, err := tls.LoadX509KeyPair(c.config.Backend.TLSCertPath, c.config.Backend.TLSKeyPath)
		if err != nil {
			return nil, fmt.Errorf("failed to load client certificate: %w", err)
		}
		tlsCfg.Certificates = []tls.Certificate{cert}
	}

	// Load custom CA certificate if provided
	if c.config.Backend.TLSCAPath != "" {
		caPEM, err := os.ReadFile(c.config.Backend.TLSCAPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read CA certificate: %w", err)
		}
		certPool := x509.NewCertPool()
		if !certPool.AppendCertsFromPEM(caPEM) {
			return nil, fmt.Errorf("failed to parse CA certificate")
		}
		tlsCfg.RootCAs = certPool
	}

	return credentials.NewTLS(tlsCfg), nil
}

// SetReconnectPolicy overrides the default reconnect policy.
func (c *Client) SetReconnectPolicy(policy reconnectPolicy) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.reconnect = policy
}
