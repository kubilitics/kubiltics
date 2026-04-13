package otel

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/events"
	"k8s.io/client-go/kubernetes"
)

const (
	pullInterval  = 15 * time.Second
	agentNS       = "kubilitics-system"
	agentSvcName  = "kubilitics-trace-agent"
	agentSvcPort  = "9417"
	proxyBasePath = "/api/v1/namespaces/" + agentNS + "/services/" + agentSvcName + ":" + agentSvcPort + "/proxy"
)

// pulledTraceSummary is a lightweight struct matching the trace-agent's
// /traces/since JSON response. Fields mirror TraceSummary but use JSON
// tags that match the agent's output.
type pulledTraceSummary struct {
	TraceID       string `json:"trace_id"`
	RootService   string `json:"root_service"`
	RootOperation string `json:"root_operation"`
	StartTime     int64  `json:"start_time"`
	DurationNs    int64  `json:"duration_ns"`
	SpanCount     int    `json:"span_count"`
	ErrorCount    int    `json:"error_count"`
	ServiceCount  int    `json:"service_count"`
	Status        string `json:"status"`
	Services      string `json:"services"` // JSON text from agent, e.g. '["svc1","svc2"]'
	UpdatedAt     int64  `json:"updated_at"`
}

// pulledTraceDetail matches the trace-agent's /traces/{id} response.
type pulledTraceDetail struct {
	TraceID       string       `json:"trace_id"`
	RootService   string       `json:"root_service"`
	RootOperation string       `json:"root_operation"`
	StartTime     int64        `json:"start_time"`
	DurationNs    int64        `json:"duration_ns"`
	SpanCount     int          `json:"span_count"`
	ErrorCount    int          `json:"error_count"`
	ServiceCount  int          `json:"service_count"`
	Status        string       `json:"status"`
	Services      string       `json:"services"`
	Spans         []pulledSpan `json:"spans"`
}

// pulledSpan matches the trace-agent's span JSON output.
type pulledSpan struct {
	SpanID        string `json:"span_id"`
	TraceID       string `json:"trace_id"`
	ParentSpanID  string `json:"parent_span_id"`
	ServiceName   string `json:"service_name"`
	OperationName string `json:"operation_name"`
	SpanKind      string `json:"span_kind"`
	StartTime     int64  `json:"start_time"`
	EndTime       int64  `json:"end_time"`
	DurationNs    int64  `json:"duration_ns"`
	StatusCode    string `json:"status_code"`
	StatusMessage string `json:"status_message"`
	// K8s metadata
	K8sPodName    string `json:"k8s_pod_name"`
	K8sNamespace  string `json:"k8s_namespace"`
	K8sNodeName   string `json:"k8s_node_name"`
	K8sContainer  string `json:"k8s_container"`
	K8sDeployment string `json:"k8s_deployment"`
	// HTTP
	HTTPMethod     string `json:"http_method"`
	HTTPURL        string `json:"http_url"`
	HTTPStatusCode *int   `json:"http_status_code"`
	HTTPRoute      string `json:"http_route"`
	// DB
	DBSystem    string `json:"db_system"`
	DBStatement string `json:"db_statement"`
	// Attributes stored as JSON string
	Attributes string `json:"attributes"`
	Events     string `json:"events"`
}

// TracePuller polls the in-cluster trace-agent and stores traces locally.
type TracePuller struct {
	store   *Store
	mu      sync.Mutex
	pullers map[string]context.CancelFunc // clusterID -> cancel
}

// NewTracePuller creates a new TracePuller.
func NewTracePuller(store *Store) *TracePuller {
	return &TracePuller{
		store:   store,
		pullers: make(map[string]context.CancelFunc),
	}
}

// OnClusterConnected starts polling for a cluster. Implements ClusterLifecycleHook.
func (p *TracePuller) OnClusterConnected(clientset kubernetes.Interface, clusterID string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Already polling this cluster
	if _, exists := p.pullers[clusterID]; exists {
		return nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	p.pullers[clusterID] = cancel

	go p.pollLoop(ctx, clientset, clusterID)
	log.Printf("[otel/puller] started polling trace-agent for cluster %s", clusterID)
	return nil
}

// OnClusterDisconnected stops polling for a cluster. Implements ClusterLifecycleHook.
func (p *TracePuller) OnClusterDisconnected(clusterID string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if cancel, ok := p.pullers[clusterID]; ok {
		cancel()
		delete(p.pullers, clusterID)
		log.Printf("[otel/puller] stopped polling trace-agent for cluster %s", clusterID)
	}
}

// StopCluster is an alias for OnClusterDisconnected for use by the tracing handler.
func (p *TracePuller) StopCluster(clusterID string) {
	p.OnClusterDisconnected(clusterID)
}

// PullNow triggers an immediate pull for a cluster. Used by the tracing
// status endpoint to ensure traces are fresh when the user opens the page.
func (p *TracePuller) PullNow(ctx context.Context, clientset kubernetes.Interface, clusterID string) error {
	// Also ensure the poll loop is running
	p.OnClusterConnected(clientset, clusterID)

	_, err := p.pullOnce(ctx, clientset, clusterID, 0) // since=0 pulls everything
	if err != nil {
		log.Printf("[otel/puller] PullNow for %s failed: %v", clusterID, err)
	}
	return err
}

// IsAgentReachable checks whether the trace-agent is healthy via the K8s
// API server service proxy.
func (p *TracePuller) IsAgentReachable(ctx context.Context, clientset kubernetes.Interface) bool {
	result := clientset.CoreV1().RESTClient().Get().
		AbsPath(proxyBasePath + "/health").
		Do(ctx)
	if result.Error() != nil {
		return false
	}
	raw, err := result.Raw()
	if err != nil {
		return false
	}
	// Agent returns {"status":"ok"} on health endpoint
	return len(raw) > 0
}

// pollLoop runs the pull cycle every pullInterval until ctx is cancelled.
func (p *TracePuller) pollLoop(ctx context.Context, clientset kubernetes.Interface, clusterID string) {
	// If the legacy trace-agent service isn't reachable, this cluster is
	// using direct OTLP push (standard otel-collector → POST /v1/traces),
	// so we skip polling entirely. The puller is kept for backwards compat
	// with any clusters still running the proprietary kubilitics-trace-agent.
	if !p.IsAgentReachable(ctx, clientset) {
		log.Printf("[otel/puller] cluster %s: legacy trace-agent not reachable, skipping pull (using direct OTLP push)", clusterID)
		return
	}

	// Start with "pull everything" — use 0 as the initial since timestamp.
	var lastPullNs int64

	ticker := time.NewTicker(pullInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			newLast, err := p.pullOnce(ctx, clientset, clusterID, lastPullNs)
			if err != nil {
				// Agent not reachable or error — silently retry next cycle.
				log.Printf("[otel/puller] cluster %s: pull failed (will retry): %v", clusterID, err)
				continue
			}
			if newLast > lastPullNs {
				lastPullNs = newLast
			}
		}
	}
}

// pullOnce fetches trace summaries since lastPullNs, then fetches full details
// for each trace and stores them locally. Returns the latest timestamp seen.
func (p *TracePuller) pullOnce(ctx context.Context, clientset kubernetes.Interface, clusterID string, lastPullNs int64) (int64, error) {
	// Step 1: Fetch trace summaries since lastPullNs
	result := clientset.CoreV1().RESTClient().Get().
		AbsPath(proxyBasePath+"/traces/since").
		Param("since", fmt.Sprintf("%d", lastPullNs)).
		Param("limit", "500").
		Do(ctx)

	if result.Error() != nil {
		return lastPullNs, fmt.Errorf("fetch traces/since: %w", result.Error())
	}

	raw, err := result.Raw()
	if err != nil {
		return lastPullNs, fmt.Errorf("read traces/since body: %w", err)
	}

	var summaries []pulledTraceSummary
	if err := json.Unmarshal(raw, &summaries); err != nil {
		return lastPullNs, fmt.Errorf("parse traces/since: %w", err)
	}

	if len(summaries) == 0 {
		return lastPullNs, nil
	}

	latestNs := lastPullNs

	// Step 2: For each trace, fetch full detail and store
	for _, ts := range summaries {
		detail, err := p.fetchTraceDetail(ctx, clientset, ts.TraceID)
		if err != nil {
			log.Printf("[otel/puller] cluster %s: failed to fetch trace %s: %v", clusterID, ts.TraceID, err)
			continue
		}

		// Convert pulled spans to store Span objects
		spans := make([]Span, 0, len(detail.Spans))
		for _, ps := range detail.Spans {
			span := Span{
				SpanID:         ps.SpanID,
				TraceID:        ps.TraceID,
				ParentSpanID:   ps.ParentSpanID,
				ServiceName:    ps.ServiceName,
				OperationName:  ps.OperationName,
				SpanKind:       ps.SpanKind,
				StartTime:      ps.StartTime,
				EndTime:        ps.EndTime,
				DurationNs:     ps.DurationNs,
				StatusCode:     ps.StatusCode,
				StatusMessage:  ps.StatusMessage,
				HTTPMethod:     ps.HTTPMethod,
				HTTPURL:        ps.HTTPURL,
				HTTPStatusCode: ps.HTTPStatusCode,
				HTTPRoute:      ps.HTTPRoute,
				DBSystem:       ps.DBSystem,
				DBStatement:    ps.DBStatement,
				K8sPodName:     ps.K8sPodName,
				K8sNamespace:   ps.K8sNamespace,
				K8sNodeName:    ps.K8sNodeName,
				K8sContainer:   ps.K8sContainer,
				K8sDeployment:  ps.K8sDeployment,
				ClusterID:      clusterID,
				Attributes:     jsonTextOrEmpty(ps.Attributes),
				Events:         jsonTextOrEmpty(ps.Events),
				LinkedEventIDs: events.JSONText("[]"),
			}
			spans = append(spans, span)
		}

		// Store spans
		if err := p.store.InsertSpans(ctx, spans); err != nil {
			log.Printf("[otel/puller] cluster %s: failed to store spans for trace %s: %v", clusterID, ts.TraceID, err)
			continue
		}

		// Store trace summary
		servicesText := ts.Services
		if servicesText == "" {
			servicesText = "[]"
		}
		summary := &TraceSummary{
			TraceID:       ts.TraceID,
			RootService:   ts.RootService,
			RootOperation: ts.RootOperation,
			StartTime:     ts.StartTime,
			DurationNs:    ts.DurationNs,
			SpanCount:     ts.SpanCount,
			ErrorCount:    ts.ErrorCount,
			ServiceCount:  ts.ServiceCount,
			Status:        ts.Status,
			ClusterID:     clusterID,
			Services:      events.JSONText(servicesText),
			UpdatedAt:     time.Now().UnixNano(),
		}
		if err := p.store.InsertTraceSummary(ctx, summary); err != nil {
			log.Printf("[otel/puller] cluster %s: failed to store trace summary %s: %v", clusterID, ts.TraceID, err)
			continue
		}

		// Track latest timestamp
		if ts.StartTime > latestNs {
			latestNs = ts.StartTime
		}
	}

	log.Printf("[otel/puller] cluster %s: pulled %d traces", clusterID, len(summaries))
	return latestNs, nil
}

// fetchTraceDetail fetches the full trace (with spans) from the agent.
func (p *TracePuller) fetchTraceDetail(ctx context.Context, clientset kubernetes.Interface, traceID string) (*pulledTraceDetail, error) {
	result := clientset.CoreV1().RESTClient().Get().
		AbsPath(proxyBasePath + "/traces/" + traceID).
		Do(ctx)

	if result.Error() != nil {
		return nil, fmt.Errorf("fetch trace %s: %w", traceID, result.Error())
	}

	raw, err := result.Raw()
	if err != nil {
		return nil, fmt.Errorf("read trace %s body: %w", traceID, err)
	}

	var detail pulledTraceDetail
	if err := json.Unmarshal(raw, &detail); err != nil {
		return nil, fmt.Errorf("parse trace %s: %w", traceID, err)
	}

	return &detail, nil
}

// jsonTextOrEmpty converts a string to events.JSONText, defaulting to "{}" if empty.
func jsonTextOrEmpty(s string) events.JSONText {
	if s == "" {
		return events.JSONText("{}")
	}
	return events.JSONText(s)
}
