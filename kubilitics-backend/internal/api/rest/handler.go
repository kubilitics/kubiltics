package rest

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/hashicorp/golang-lru/v2/expirable"

	"github.com/kubilitics/kubilitics-backend/internal/api/middleware"
	"github.com/kubilitics/kubilitics-backend/internal/healthscore"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/graph"
	"github.com/kubilitics/kubilitics-backend/internal/intelligence/diff"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/topologyexport"
	"github.com/kubilitics/kubilitics-backend/internal/service"
	"github.com/kubilitics/kubilitics-backend/internal/topology"
	topologyv2 "github.com/kubilitics/kubilitics-backend/internal/topology/v2"
	topologyv2builder "github.com/kubilitics/kubilitics-backend/internal/topology/v2/builder"
	"golang.org/x/time/rate"
	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	schedulingv1 "k8s.io/api/scheduling/v1"
	storagev1 "k8s.io/api/storage/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// topologyCacheEntry stores a cached topology response with an expiration time.
type topologyCacheEntry struct {
	data      *topologyv2.TopologyResponse
	expiresAt time.Time
}

// topologyCache is a package-level in-memory cache for topology responses.
// Key format: "clusterID|mode|namespace|depth"
var topologyCache sync.Map

const topologyCacheTTL = 30 * time.Second

// MaxTopologyNodes is the maximum number of nodes allowed in a topology response.
// If exceeded, depth=0 filtering is applied automatically and the response is marked as truncated.
const MaxTopologyNodes = 500

// topologyCacheKey builds a cache key from the request parameters.
func topologyCacheKey(clusterID, mode, namespace string, depth int) string {
	return clusterID + "|" + mode + "|" + namespace + "|" + strconv.Itoa(depth)
}

// topologyCacheGet returns a cached entry if it exists and has not expired.
func topologyCacheGet(key string) (*topologyv2.TopologyResponse, bool) {
	v, ok := topologyCache.Load(key)
	if !ok {
		return nil, false
	}
	entry, ok2 := v.(*topologyCacheEntry)
	if !ok2 {
		topologyCache.Delete(key)
		return nil, false
	}
	if time.Now().After(entry.expiresAt) {
		topologyCache.Delete(key)
		return nil, false
	}
	return entry.data, true
}

// topologyCacheSet stores a topology response in the cache.
func topologyCacheSet(key string, data *topologyv2.TopologyResponse) {
	topologyCache.Store(key, &topologyCacheEntry{
		data:      data,
		expiresAt: time.Now().Add(topologyCacheTTL),
	})
}

// TopologyCacheInvalidateForCluster removes all cached V2 topology entries for the
// given clusterID. Gap 2 fix: called from graph engine onRebuild callback to
// actively invalidate caches when K8s resources change, rather than relying
// solely on TTL expiration.
func TopologyCacheInvalidateForCluster(clusterID string) {
	prefix := clusterID + "|"
	topologyCache.Range(func(key, _ any) bool {
		if k, ok := key.(string); ok && strings.HasPrefix(k, prefix) {
			topologyCache.Delete(key)
		}
		return true
	})
}

// ClusterLifecycleHook is called by the REST handler when a cluster is
// connected, reconnected, or removed. PipelineManager implements this
// interface so that event pipelines start/stop with cluster lifecycle.
type ClusterLifecycleHook interface {
	// OnClusterConnected is called after a cluster is successfully added or reconnected.
	OnClusterConnected(clientset kubernetes.Interface, clusterID string) error
	// OnClusterDisconnected is called after a cluster is removed.
	OnClusterDisconnected(clusterID string)
}

// Handler manages HTTP request handlers
type Handler struct {
	clusterService        service.ClusterService
	topologyService       service.TopologyService
	logsService           service.LogsService
	eventsService         service.EventsService
	metricsService        service.MetricsService
	unifiedMetricsService *service.UnifiedMetricsService
	projSvc               service.ProjectService
	addonService          service.AddOnService
	cfg                   *config.Config
	repo                  *repository.SQLiteRepository // BE-AUTHZ-001: for RBAC filtering (can be nil if auth disabled)
	kcliLimiterMu         sync.Mutex
	kcliLimiters          map[string]*rate.Limiter
	kcliStreamMu          sync.Mutex
	kcliStreamActive      map[string]int
	k8sClientCache        *expirable.LRU[string, *k8s.Client] // Cache for stateless requests
	wsConnMu              sync.Mutex
	wsConns               map[string]int // "clusterId:userIdentity" -> active WS connection count
	graphEnginesMu        sync.RWMutex
	graphEngines          map[string]*graph.ClusterGraphEngine // clusterId -> engine
	snapshotStore         diff.SnapshotStore                   // topology diff snapshot persistence
	scheduleHandler       *ScheduleHandler                     // optional: report schedule CRUD (nil = disabled)
	tracingHandler        *TracingHandler                      // optional: tracing enable/disable/instrument (nil = disabled)
	lifecycleHooks        []ClusterLifecycleHook               // optional: lifecycle hooks (events pipeline, etc.)
}

// NewHandler creates a new HTTP handler. unifiedMetricsService can be nil; then metrics summary uses legacy per-resource endpoints. projSvc can be nil; then project routes return 501. addonService can be nil; then addon routes return 404 or 501. repo can be nil if auth is disabled. snapshotStore can be nil; then topology snapshot endpoints return 503.
func NewHandler(cs service.ClusterService, ts service.TopologyService, cfg *config.Config, logsService service.LogsService, eventsService service.EventsService, metricsService service.MetricsService, unifiedMetricsService *service.UnifiedMetricsService, projSvc service.ProjectService, addonService service.AddOnService, repo *repository.SQLiteRepository, graphEngines map[string]*graph.ClusterGraphEngine, snapshotStore diff.SnapshotStore) *Handler {
	if cfg == nil {
		cfg = &config.Config{}
	}
	return &Handler{
		clusterService:        cs,
		topologyService:       ts,
		logsService:           logsService,
		eventsService:         eventsService,
		metricsService:        metricsService,
		unifiedMetricsService: unifiedMetricsService,
		projSvc:               projSvc,
		addonService:          addonService,
		cfg:                   cfg,
		repo:                  repo,
		kcliLimiters:          map[string]*rate.Limiter{},
		kcliStreamActive:      map[string]int{},
		k8sClientCache:        expirable.NewLRU[string, *k8s.Client](100, nil, time.Minute*10),
		wsConns:               map[string]int{},
		graphEngines:          graphEngines,
		snapshotStore:         snapshotStore,
	}
}

// SetScheduleHandler attaches the report schedule handler to enable schedule CRUD routes.
// Call this before SetupRoutes. When nil, schedule routes are not registered.
func (h *Handler) SetScheduleHandler(sh *ScheduleHandler) {
	h.scheduleHandler = sh
}

// SetTracingHandler attaches the tracing handler to enable tracing lifecycle routes.
// Call this before SetupRoutes.
func (h *Handler) SetTracingHandler(th *TracingHandler) {
	h.tracingHandler = th
}

// SetLifecycleHook attaches a ClusterLifecycleHook (typically PipelineManager) so
// that event pipelines start/stop when clusters are added/removed/reconnected.
// Can be called multiple times to register multiple hooks.
func (h *Handler) SetLifecycleHook(hook ClusterLifecycleHook) {
	h.lifecycleHooks = append(h.lifecycleHooks, hook)
}

// notifyClusterConnected tells all lifecycle hooks that a cluster has been
// connected or reconnected. It fetches the K8s client from the cluster service
// and calls the hooks asynchronously to avoid blocking the HTTP response.
func (h *Handler) notifyClusterConnected(clusterID string) {
	if len(h.lifecycleHooks) == 0 {
		return
	}
	client, err := h.clusterService.GetClient(clusterID)
	if err != nil {
		fmt.Printf("[handler] lifecycle hook: cannot get client for cluster %s: %v\n", clusterID, err)
		return
	}
	go func() {
		for _, hook := range h.lifecycleHooks {
			if err := hook.OnClusterConnected(client.Clientset, clusterID); err != nil {
				fmt.Printf("[handler] lifecycle hook: failed for cluster %s: %v\n", clusterID, err)
			}
		}
	}()
}

// wsCheckOrigin validates a WebSocket upgrade request's Origin header against the
// configured allowed origins. This prevents CSRF-over-WebSocket attacks by ensuring
// only trusted origins (configured via KUBILITICS_ALLOWED_ORIGINS) can establish
// WebSocket connections to exec, shell, addon install, and overview stream endpoints.
func (h *Handler) wsCheckOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		// Non-browser clients (curl, wscat) do not send Origin; allow them.
		return true
	}
	normalized := strings.ToLower(strings.TrimRight(origin, "/"))
	for _, allowed := range h.cfg.AllowedOrigins {
		if strings.ToLower(strings.TrimRight(allowed, "/")) == normalized {
			return true
		}
	}
	return false
}

// newWSUpgrader returns a websocket.Upgrader that validates the Origin header
// against the server's configured allowed origins.
func (h *Handler) newWSUpgrader(readBuf, writeBuf int) websocket.Upgrader {
	return websocket.Upgrader{
		CheckOrigin:     h.wsCheckOrigin,
		ReadBufferSize:  readBuf,
		WriteBufferSize: writeBuf,
	}
}

const maxWSConnsPerClusterUser = 10

// wsAcquire checks if the user can open another WebSocket connection for the given cluster.
// Returns a release function to call when the connection closes, or an error if the limit is reached.
// When auth is disabled, the remote IP address is used as the identity.
func (h *Handler) wsAcquire(r *http.Request, clusterID string) (release func(), err error) {
	identity := "anon:" + r.RemoteAddr
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil {
		identity = "user:" + claims.UserID
	}
	key := clusterID + ":" + identity
	h.wsConnMu.Lock()
	defer h.wsConnMu.Unlock()
	if h.wsConns[key] >= maxWSConnsPerClusterUser {
		return nil, fmt.Errorf("WebSocket connection limit (%d) reached for this cluster", maxWSConnsPerClusterUser)
	}
	h.wsConns[key]++
	released := false
	return func() {
		h.wsConnMu.Lock()
		defer h.wsConnMu.Unlock()
		if !released {
			released = true
			h.wsConns[key]--
			if h.wsConns[key] <= 0 {
				delete(h.wsConns, key)
			}
		}
	}, nil
}

// resolveClusterID returns clusterID if it exists (either as live client or in repo); otherwise looks up by Context or Name (e.g. "docker-desktop") so frontend can pass either backend UUID or context name.
func (h *Handler) resolveClusterID(ctx context.Context, clusterID string) (string, error) {
	// 1. Try memory cache (live clients)
	if _, err := h.clusterService.GetClient(clusterID); err == nil {
		return clusterID, nil
	}

	// 2. Try direct lookup from repo (includes disconnected clusters)
	if c, err := h.clusterService.GetCluster(ctx, clusterID); err == nil && c != nil {
		return clusterID, nil
	}

	// 3. Fall back to search by Context or Name
	clusters, listErr := h.clusterService.ListClusters(ctx)
	if listErr != nil {
		return "", listErr
	}
	for _, c := range clusters {
		if c.Context == clusterID || c.Name == clusterID {
			return c.ID, nil
		}
	}
	return "", fmt.Errorf("cluster not found: %s", clusterID)
}

// wrapWithRBAC wraps a handler with RBAC middleware if auth is enabled (BE-AUTHZ-001).
func (h *Handler) wrapWithRBAC(handler http.HandlerFunc, minRole string) http.Handler {
	if h.cfg.AuthMode == "" || h.cfg.AuthMode == "disabled" || h.repo == nil {
		return http.HandlerFunc(handler)
	}
	switch minRole {
	case auth.RoleAdmin:
		return middleware.RequireAdmin(h.repo)(http.HandlerFunc(handler))
	case auth.RoleOperator:
		return middleware.RequireOperator(h.repo)(http.HandlerFunc(handler))
	case auth.RoleViewer:
		return middleware.RequireViewer(h.repo)(http.HandlerFunc(handler))
	default:
		return http.HandlerFunc(handler)
	}
}

func SetupRoutes(router *mux.Router, h *Handler) {
	// API versioning discovery
	router.HandleFunc("/versions", h.GetVersions).Methods("GET")

	// Cluster discovery MUST be registered before {clusterId} parameter route
	router.HandleFunc("/clusters/discover", h.DiscoverClusters).Methods("GET")

	// Capabilities (e.g. resource topology kinds) so clients can verify backend support
	router.HandleFunc("/capabilities", h.GetCapabilities).Methods("GET")

	// Audit log (BE-SEC-002): admin-only, append-only; ?format=csv for export
	router.Handle("/audit-log", h.wrapWithRBAC(h.ListAuditLog, auth.RoleAdmin)).Methods("GET")

	// Project routes (multi-cluster, multi-tenancy)
	router.Handle("/projects", h.wrapWithRBAC(h.ListProjects, auth.RoleViewer)).Methods("GET")
	router.Handle("/projects", h.wrapWithRBAC(h.CreateProject, auth.RoleAdmin)).Methods("POST")
	router.Handle("/projects/{projectId}", h.wrapWithRBAC(h.GetProject, auth.RoleViewer)).Methods("GET")
	router.Handle("/projects/{projectId}", h.wrapWithRBAC(h.UpdateProject, auth.RoleAdmin)).Methods("PATCH")
	router.Handle("/projects/{projectId}", h.wrapWithRBAC(h.DeleteProject, auth.RoleAdmin)).Methods("DELETE")
	router.Handle("/projects/{projectId}/clusters", h.wrapWithRBAC(h.AddClusterToProject, auth.RoleAdmin)).Methods("POST")
	router.Handle("/projects/{projectId}/clusters/{clusterId}", h.wrapWithRBAC(h.RemoveClusterFromProject, auth.RoleAdmin)).Methods("DELETE")
	router.Handle("/projects/{projectId}/namespaces", h.wrapWithRBAC(h.AddNamespaceToProject, auth.RoleAdmin)).Methods("POST")
	router.Handle("/projects/{projectId}/namespaces/{clusterId}/{namespaceName}", h.wrapWithRBAC(h.RemoveNamespaceFromProject, auth.RoleAdmin)).Methods("DELETE")

	// Cluster routes (BE-AUTHZ-001: GET = viewer, POST/DELETE = admin)
	router.Handle("/clusters", h.wrapWithRBAC(h.ListClusters, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters", h.wrapWithRBAC(h.AddCluster, auth.RoleAdmin)).Methods("POST")
	router.Handle("/clusters/{clusterId}", h.wrapWithRBAC(h.GetCluster, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}", h.wrapWithRBAC(h.RemoveCluster, auth.RoleAdmin)).Methods("DELETE")
	router.Handle("/clusters/{clusterId}/summary", h.wrapWithRBAC(h.GetClusterSummary, auth.RoleViewer)).Methods("GET")
	// Reconnect: resets circuit breaker and creates a fresh K8s client (POST = mutating; operator-level)
	router.Handle("/clusters/{clusterId}/reconnect", h.wrapWithRBAC(h.ReconnectCluster, auth.RoleOperator)).Methods("POST")
	router.Handle("/clusters/{clusterId}/overview", h.wrapWithRBAC(h.GetClusterOverview, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/overview/stream", h.wrapWithRBAC(h.GetClusterOverviewStream, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/workloads", h.wrapWithRBAC(h.GetWorkloadsOverview, auth.RoleViewer)).Methods("GET")

	// Topology routes (BE-AUTHZ-001: GET = viewer, POST export = operator)
	router.Handle("/clusters/{clusterId}/topology", h.wrapWithRBAC(h.GetTopology, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/topology/cluster", h.wrapWithRBAC(h.GetTopologyV2, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/topology/traffic", h.wrapWithRBAC(h.GetTopologyV2Traffic, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/topology/impact/{kind}/{namespace}/{name}", h.wrapWithRBAC(h.GetTopologyV2Impact, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/topology/criticality", h.wrapWithRBAC(h.GetCriticality, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/topology/resource/{kind}/{namespace}/{name}", h.wrapWithRBAC(h.GetResourceTopology, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/topology/export", h.wrapWithRBAC(h.ExportTopology, auth.RoleOperator)).Methods("POST")
	// Blast radius analysis (USP #2): dependency inference + criticality scoring
	router.Handle("/clusters/{clusterId}/blast-radius/summary",
		h.wrapWithRBAC(h.GetBlastRadiusSummary, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/blast-radius/graph-status",
		h.wrapWithRBAC(h.GetGraphStatus, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/blast-radius/{namespace}/{kind}/{name}", h.wrapWithRBAC(h.GetBlastRadius, auth.RoleViewer)).Methods("GET")

	// Intelligence layer: health scores, SPOF inventory, risk ranking
	router.Handle("/clusters/{clusterId}/health", h.wrapWithRBAC(h.GetClusterHealth, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/risk-ranking", h.wrapWithRBAC(h.GetClusterRiskRanking, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/spofs", h.wrapWithRBAC(h.GetSPOFInventory, auth.RoleViewer)).Methods("GET")

	// Pre-apply blast radius preview
	router.Handle("/clusters/{clusterId}/blast-radius/preview", h.wrapWithRBAC(h.PreviewBlastRadius, auth.RoleOperator)).Methods("POST")

	// Topology diffing: snapshots and comparison
	router.Handle("/clusters/{clusterId}/topology/snapshot", h.wrapWithRBAC(h.CreateTopologySnapshot, auth.RoleOperator)).Methods("POST")
	router.Handle("/clusters/{clusterId}/topology/diff", h.wrapWithRBAC(h.GetTopologyDiff, auth.RoleViewer)).Methods("GET")

	// Resilience reports
	router.Handle("/clusters/{clusterId}/reports/resilience", h.wrapWithRBAC(h.GetResilienceReport, auth.RoleViewer)).Methods("POST")

	// Report schedules — inline handlers (scheduler module pending)
	router.HandleFunc("/clusters/{clusterId}/reports/schedules", func(w http.ResponseWriter, r *http.Request) {
		respondJSON(w, http.StatusOK, []interface{}{})
	}).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/reports/schedules", func(w http.ResponseWriter, r *http.Request) {
		respondJSON(w, http.StatusCreated, map[string]string{"id": "pending", "status": "created"})
	}).Methods("POST")

	// What-If Simulation Engine (Pillar 3)
	router.Handle("/clusters/{clusterId}/simulation/run", h.wrapWithRBAC(h.PostSimulationRun, auth.RoleViewer)).Methods("POST")
	router.Handle("/clusters/{clusterId}/simulation/validate", h.wrapWithRBAC(h.PostSimulationValidate, auth.RoleViewer)).Methods("POST")
	router.Handle("/clusters/{clusterId}/simulation/scenarios", h.wrapWithRBAC(h.GetSimulationScenarios, auth.RoleViewer)).Methods("GET")

	// Distributed Tracing lifecycle (enable/disable/instrument/status)
	if h.tracingHandler != nil {
		router.Handle("/clusters/{clusterId}/tracing/enable", h.wrapWithRBAC(h.tracingHandler.EnableTracing, auth.RoleOperator)).Methods("POST")
		router.Handle("/clusters/{clusterId}/tracing/disable", h.wrapWithRBAC(h.tracingHandler.DisableTracing, auth.RoleOperator)).Methods("POST")
		router.Handle("/clusters/{clusterId}/tracing/status", h.wrapWithRBAC(h.tracingHandler.GetTracingStatus, auth.RoleViewer)).Methods("GET")
		router.Handle("/clusters/{clusterId}/tracing/instrument", h.wrapWithRBAC(h.tracingHandler.InstrumentDeployments, auth.RoleOperator)).Methods("POST")

		// Per-deployment one-click auto-instrumentation.
		router.Handle("/clusters/{clusterId}/deployments/{namespace}/{deployment}/instrumentation-status", h.wrapWithRBAC(h.tracingHandler.GetInstrumentationStatus, auth.RoleViewer)).Methods("GET")
		router.Handle("/clusters/{clusterId}/deployments/{namespace}/{deployment}/instrument", h.wrapWithRBAC(h.tracingHandler.InstrumentDeployment, auth.RoleOperator)).Methods("POST")
		router.Handle("/clusters/{clusterId}/deployments/{namespace}/{deployment}/uninstrument", h.wrapWithRBAC(h.tracingHandler.UninstrumentDeployment, auth.RoleOperator)).Methods("POST")
	}

	// Architectural Auto-Pilot (Pillar 4)
	router.Handle("/clusters/{clusterId}/autopilot/findings", h.wrapWithRBAC(h.GetAutoPilotFindings, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/autopilot/actions", h.wrapWithRBAC(h.GetAutoPilotActions, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/autopilot/actions/{actionId}", h.wrapWithRBAC(h.GetAutoPilotAction, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/autopilot/actions/{actionId}/approve", h.wrapWithRBAC(h.PostAutoPilotApprove, auth.RoleOperator)).Methods("POST")
	router.Handle("/clusters/{clusterId}/autopilot/actions/{actionId}/dismiss", h.wrapWithRBAC(h.PostAutoPilotDismiss, auth.RoleOperator)).Methods("POST")
	router.Handle("/clusters/{clusterId}/autopilot/config", h.wrapWithRBAC(h.GetAutoPilotConfig, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/autopilot/config/{ruleId}", h.wrapWithRBAC(h.PutAutoPilotRuleConfig, auth.RoleOperator)).Methods("PUT")
	router.Handle("/clusters/{clusterId}/autopilot/scan", h.wrapWithRBAC(h.PostAutoPilotScan, auth.RoleOperator)).Methods("POST")
	router.Handle("/clusters/{clusterId}/autopilot/rules", h.wrapWithRBAC(h.GetAutoPilotRules, auth.RoleViewer)).Methods("GET")

	// Fleet X-Ray (Pillar 5)
	router.Handle("/fleet/xray/dashboard", h.wrapWithRBAC(h.FleetXRayDashboard, auth.RoleViewer)).Methods("GET")
	router.Handle("/fleet/xray/clusters/{clusterId}/metrics", h.wrapWithRBAC(h.FleetXRayClusterMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/fleet/xray/compare", h.wrapWithRBAC(h.FleetXRayCompare, auth.RoleViewer)).Methods("GET")
	router.Handle("/fleet/xray/templates", h.wrapWithRBAC(h.FleetXRayListTemplates, auth.RoleViewer)).Methods("GET")
	router.Handle("/fleet/xray/templates", h.wrapWithRBAC(h.FleetXRayCreateTemplate, auth.RoleOperator)).Methods("POST")
	router.Handle("/fleet/xray/templates/{templateId}", h.wrapWithRBAC(h.FleetXRayGetTemplate, auth.RoleViewer)).Methods("GET")
	router.Handle("/fleet/xray/templates/{templateId}", h.wrapWithRBAC(h.FleetXRayUpdateTemplate, auth.RoleOperator)).Methods("PUT")
	router.Handle("/fleet/xray/templates/{templateId}", h.wrapWithRBAC(h.FleetXRayDeleteTemplate, auth.RoleOperator)).Methods("DELETE")
	router.Handle("/fleet/xray/templates/{templateId}/scores", h.wrapWithRBAC(h.FleetXRayTemplateScores, auth.RoleViewer)).Methods("GET")
	router.Handle("/fleet/xray/dr", h.wrapWithRBAC(h.FleetXRayDRAssessment, auth.RoleViewer)).Methods("GET")
	router.Handle("/fleet/xray/history/{clusterId}", h.wrapWithRBAC(h.FleetXRayHistory, auth.RoleViewer)).Methods("GET")

	// Global search (command palette): GET /clusters/{clusterId}/search?q=...&limit=25
	router.Handle("/clusters/{clusterId}/search", h.wrapWithRBAC(h.GetSearch, auth.RoleViewer)).Methods("GET")

	// Cluster features (e.g. MetalLB detection)
	router.Handle("/clusters/{clusterId}/features/metallb", h.wrapWithRBAC(h.GetMetalLBFeature, auth.RoleViewer)).Methods("GET")

	// Add-on catalog (no cluster context). Frontend uses /addons/catalog and /addons/catalog/{addonId}.
	router.Handle("/addons", h.wrapWithRBAC(h.ListCatalog, auth.RoleViewer)).Methods("GET")
	router.Handle("/addons/catalog", h.wrapWithRBAC(h.ListCatalog, auth.RoleViewer)).Methods("GET")
	// Bootstrap profiles — must be registered before /addons/{addonId} to avoid wildcard capture.
	router.Handle("/addons/profiles", h.wrapWithRBAC(h.ListProfiles, auth.RoleViewer)).Methods("GET")
	router.Handle("/addons/profiles", h.wrapWithRBAC(h.CreateProfile, auth.RoleOperator)).Methods("POST")
	router.Handle("/addons/profiles/{profileId}", h.wrapWithRBAC(h.GetProfile, auth.RoleViewer)).Methods("GET")
	router.Handle("/addons/{addonId}", h.wrapWithRBAC(h.GetCatalogEntry, auth.RoleViewer)).Methods("GET")
	// /values must be registered before the bare {addonId} wildcard so Gorilla picks the specific path first.
	router.Handle("/addons/catalog/{addonId}/values", h.wrapWithRBAC(h.GetCatalogValues, auth.RoleViewer)).Methods("GET")
	router.Handle("/addons/catalog/{addonId}", h.wrapWithRBAC(h.GetCatalogEntry, auth.RoleViewer)).Methods("GET")
	// Add-on cluster-scoped: read-only (viewer)
	router.Handle("/clusters/{clusterId}/addons/plan", h.wrapWithRBAC(h.PlanInstall, auth.RoleViewer)).Methods("POST")
	router.Handle("/clusters/{clusterId}/addons/preflight", h.wrapWithRBAC(h.RunPreflight, auth.RoleViewer)).Methods("POST")
	router.Handle("/clusters/{clusterId}/addons/estimate-cost", h.wrapWithRBAC(h.EstimateCost, auth.RoleViewer)).Methods("POST")
	router.Handle("/clusters/{clusterId}/addons/dry-run", h.wrapWithRBAC(h.DryRunInstall, auth.RoleViewer)).Methods("POST")
	router.Handle("/clusters/{clusterId}/addons/installed", h.wrapWithRBAC(h.ListInstalled, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/addons/installed/{installId}", h.wrapWithRBAC(h.GetInstall, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/addons/installed/{installId}/history", h.wrapWithRBAC(h.GetReleaseHistory, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/addons/installed/{installId}/audit", h.wrapWithRBAC(h.GetAuditEvents, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/addons/financial-stack", h.wrapWithRBAC(h.GetFinancialStack, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/addons/financial-stack-plan", h.wrapWithRBAC(h.BuildFinancialStackPlan, auth.RoleViewer)).Methods("POST")
	router.Handle("/clusters/{clusterId}/addons/catalog/{addonId}/rbac", h.wrapWithRBAC(h.GetRBACManifest, auth.RoleViewer)).Methods("GET")
	// Add-on cluster-scoped: mutating (operator)
	router.Handle("/clusters/{clusterId}/addons/execute", h.wrapWithRBAC(h.ExecuteInstall, auth.RoleOperator)).Methods("POST")
	router.Handle("/clusters/{clusterId}/addons/install/stream", h.wrapWithRBAC(h.StreamInstall, auth.RoleOperator)).Methods("GET")
	router.Handle("/clusters/{clusterId}/addons/installed/{installId}/upgrade", h.wrapWithRBAC(h.UpgradeInstall, auth.RoleOperator)).Methods("POST")
	router.Handle("/clusters/{clusterId}/addons/installed/{installId}/rollback", h.wrapWithRBAC(h.RollbackInstall, auth.RoleOperator)).Methods("POST")
	router.Handle("/clusters/{clusterId}/addons/installed/{installId}", h.wrapWithRBAC(h.UninstallAddon, auth.RoleOperator)).Methods("DELETE")
	router.Handle("/clusters/{clusterId}/addons/installed/{installId}/policy", h.wrapWithRBAC(h.SetUpgradePolicy, auth.RoleOperator)).Methods("PUT")
	// Cost attribution endpoint (T8.09) — requires OpenCost running in cluster
	router.Handle("/clusters/{clusterId}/addons/installed/{installId}/cost-attribution", h.wrapWithRBAC(h.GetCostAttribution, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/addons/installed/{installId}/rightsizing", h.wrapWithRBAC(h.GetAddonRecommendations, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/addons/recommendations", h.wrapWithRBAC(h.GetAddonAdvisorRecommendations, auth.RoleViewer)).Methods("GET")
	// Helm test execution (T9.01)
	router.Handle("/clusters/{clusterId}/addons/installed/{installId}/test", h.wrapWithRBAC(h.RunAddonTests, auth.RoleOperator)).Methods("POST")
	// Maintenance window routes (T9.03)
	router.Handle("/clusters/{clusterId}/addons/maintenance-windows", h.wrapWithRBAC(h.ListMaintenanceWindows, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/addons/maintenance-windows", h.wrapWithRBAC(h.CreateMaintenanceWindow, auth.RoleAdmin)).Methods("POST")
	router.Handle("/clusters/{clusterId}/addons/maintenance-windows/{windowId}", h.wrapWithRBAC(h.DeleteMaintenanceWindow, auth.RoleAdmin)).Methods("DELETE")
	router.Handle("/clusters/{clusterId}/addons/apply-profile", h.wrapWithRBAC(h.ApplyProfile, auth.RoleOperator)).Methods("POST")

	// Multi-cluster rollout routes (T8.06)
	router.Handle("/addons/rollouts", h.wrapWithRBAC(h.ListRollouts, auth.RoleViewer)).Methods("GET")
	router.Handle("/addons/rollouts", h.wrapWithRBAC(h.CreateRollout, auth.RoleOperator)).Methods("POST")
	router.Handle("/addons/rollouts/{rolloutId}", h.wrapWithRBAC(h.GetRollout, auth.RoleViewer)).Methods("GET")
	router.Handle("/addons/rollouts/{rolloutId}/abort", h.wrapWithRBAC(h.AbortRollout, auth.RoleOperator)).Methods("POST")

	// Notification channel routes (T8.11)
	router.Handle("/addons/notification-channels", h.wrapWithRBAC(h.ListNotificationChannels, auth.RoleViewer)).Methods("GET")
	router.Handle("/addons/notification-channels", h.wrapWithRBAC(h.CreateNotificationChannel, auth.RoleOperator)).Methods("POST")
	router.Handle("/addons/notification-channels/{channelId}", h.wrapWithRBAC(h.UpdateNotificationChannel, auth.RoleOperator)).Methods("PATCH")
	router.Handle("/addons/notification-channels/{channelId}", h.wrapWithRBAC(h.DeleteNotificationChannel, auth.RoleAdmin)).Methods("DELETE")

	// Private registry routes (T9.04)
	router.Handle("/addons/registries", h.wrapWithRBAC(h.ListCatalogSources, auth.RoleViewer)).Methods("GET")
	router.Handle("/addons/registries", h.wrapWithRBAC(h.CreateCatalogSource, auth.RoleOperator)).Methods("POST")
	router.Handle("/addons/registries/{sourceId}", h.wrapWithRBAC(h.DeleteCatalogSource, auth.RoleAdmin)).Methods("DELETE")

	// CRD instances: list custom resources by CRD name (must be before generic resources)
	router.Handle("/clusters/{clusterId}/crd-instances/{crdName}", h.wrapWithRBAC(h.ListCRDInstances, auth.RoleViewer)).Methods("GET")

	// Resource routes — specific subpaths must be registered before the generic {kind}/{namespace}/{name} route
	// BE-AUTHZ-001: GET = viewer, POST/PATCH/DELETE = operator
	router.Handle("/clusters/{clusterId}/resources/{kind}", h.wrapWithRBAC(h.ListResources, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollout-history", h.wrapWithRBAC(h.GetDeploymentRolloutHistory, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollback", h.wrapWithRBAC(h.PostDeploymentRollback, auth.RoleOperator)).Methods("POST")
	router.Handle("/clusters/{clusterId}/resources/cronjobs/{namespace}/{name}/trigger", h.wrapWithRBAC(h.PostCronJobTrigger, auth.RoleOperator)).Methods("POST")
	router.Handle("/clusters/{clusterId}/resources/cronjobs/{namespace}/{name}/jobs", h.wrapWithRBAC(h.GetCronJobJobs, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/jobs/{namespace}/{name}/retry", h.wrapWithRBAC(h.PostJobRetry, auth.RoleOperator)).Methods("POST")
	router.Handle("/clusters/{clusterId}/resources/pods/{namespace}/{pod}/debug", h.wrapWithRBAC(h.CreateDebugContainer, auth.RoleOperator)).Methods("POST")
	router.Handle("/clusters/{clusterId}/resources/services/{namespace}/{name}/endpoints", h.wrapWithRBAC(h.GetServiceEndpoints, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/configmaps/{namespace}/{name}/consumers", h.wrapWithRBAC(h.GetConfigMapConsumers, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/secrets/{namespace}/{name}/consumers", h.wrapWithRBAC(h.GetSecretConsumers, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/secrets/{namespace}/{name}/tls-info", h.wrapWithRBAC(h.GetSecretTLSInfo, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/persistentvolumeclaims/{namespace}/{name}/consumers", h.wrapWithRBAC(h.GetPVCConsumers, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/storageclasses/pv-counts", h.wrapWithRBAC(h.GetStorageClassPVCounts, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/namespaces/counts", h.wrapWithRBAC(h.GetNamespaceCounts, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/serviceaccounts/token-counts", h.wrapWithRBAC(h.GetServiceAccountTokenCounts, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/{kind}/{namespace}/{name}", h.wrapWithRBAC(h.GetResource, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/{kind}/{namespace}/{name}", h.wrapWithRBAC(h.PatchResource, auth.RoleOperator)).Methods("PATCH")
	router.Handle("/clusters/{clusterId}/resources/{kind}/{namespace}/{name}", h.wrapWithRBAC(h.DeleteResource, auth.RoleOperator)).Methods("DELETE")
	router.Handle("/clusters/{clusterId}/apply", h.wrapWithRBAC(h.ApplyManifest, auth.RoleOperator)).Methods("POST")

	// Logs routes (BE-AUTHZ-001: viewer can read logs)
	router.Handle("/clusters/{clusterId}/logs/{namespace}/{pod}", h.wrapWithRBAC(h.GetPodLogs, auth.RoleViewer)).Methods("GET")

	// Metrics routes: unified summary first (resource-agnostic), then legacy per-resource
	router.Handle("/clusters/{clusterId}/metrics/summary", h.wrapWithRBAC(h.GetMetricsSummary, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/history", h.wrapWithRBAC(h.GetMetricsHistory, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics", h.wrapWithRBAC(h.GetClusterMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/nodes/{nodeName}", h.wrapWithRBAC(h.GetNodeMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/deployment/{name}", h.wrapWithRBAC(h.GetDeploymentMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/replicaset/{name}", h.wrapWithRBAC(h.GetReplicaSetMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/statefulset/{name}", h.wrapWithRBAC(h.GetStatefulSetMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/daemonset/{name}", h.wrapWithRBAC(h.GetDaemonSetMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/job/{name}", h.wrapWithRBAC(h.GetJobMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/cronjob/{name}", h.wrapWithRBAC(h.GetCronJobMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/{pod}", h.wrapWithRBAC(h.GetPodMetrics, auth.RoleViewer)).Methods("GET")

	// Node operations routes (CordonNode handles both cordon and uncordon via unschedulable flag)
	router.Handle("/clusters/{clusterId}/resources/nodes/{name}/cordon", h.wrapWithRBAC(h.CordonNode, auth.RoleOperator)).Methods("POST")
	router.Handle("/clusters/{clusterId}/resources/nodes/{name}/uncordon", h.wrapWithRBAC(h.CordonNode, auth.RoleOperator)).Methods("POST")
	router.Handle("/clusters/{clusterId}/resources/nodes/{name}/drain", h.wrapWithRBAC(h.DrainNode, auth.RoleOperator)).Methods("POST")

	// Events routes
	router.Handle("/clusters/{clusterId}/events", h.wrapWithRBAC(h.GetEvents, auth.RoleViewer)).Methods("GET")

	// Port-forward: start a real kubectl port-forward subprocess - BE-AUTHZ-001: operator required
	router.Handle("/clusters/{clusterId}/port-forward", h.wrapWithRBAC(h.PostPortForward, auth.RoleOperator)).Methods("POST")
	// Port-forward: stop a running session
	router.Handle("/clusters/{clusterId}/port-forward/{sessionId}", h.wrapWithRBAC(h.DeletePortForward, auth.RoleOperator)).Methods("DELETE")

	// Pod exec (WebSocket) - BE-AUTHZ-001: operator required
	router.Handle("/clusters/{clusterId}/pods/{namespace}/{name}/exec", h.wrapWithRBAC(h.GetPodExec, auth.RoleOperator)).Methods("GET")

	// Cluster shell (run kubectl commands) - BE-AUTHZ-001: operator required
	router.Handle("/clusters/{clusterId}/shell", h.wrapWithRBAC(h.PostShell, auth.RoleOperator)).Methods("POST")
	// Cluster shell metadata (effective context/namespace + capabilities)
	router.Handle("/clusters/{clusterId}/shell/status", h.wrapWithRBAC(h.GetShellStatus, auth.RoleViewer)).Methods("GET")
	// Cluster shell stream (WebSocket PTY — full interactive kubectl cloud shell)
	router.Handle("/clusters/{clusterId}/shell/stream", h.wrapWithRBAC(h.GetShellStream, auth.RoleOperator)).Methods("GET")
	// Shell completion (IDE-style Tab; optional for dropdown)
	router.Handle("/clusters/{clusterId}/shell/complete", h.wrapWithRBAC(h.GetShellComplete, auth.RoleViewer)).Methods("GET")
	// kcli server-side execution (embedded mode foundation) - BE-AUTHZ-001: operator required
	router.Handle("/clusters/{clusterId}/kcli/exec", h.wrapWithRBAC(h.PostKCLIExec, auth.RoleOperator)).Methods("POST")
	// kcli stream (WebSocket PTY, default mode=ui) - BE-AUTHZ-001: operator required
	router.Handle("/clusters/{clusterId}/kcli/stream", h.wrapWithRBAC(h.GetKCLIStream, auth.RoleOperator)).Methods("GET")
	// kcli completion (IDE-style Tab)
	router.Handle("/clusters/{clusterId}/kcli/complete", h.wrapWithRBAC(h.GetKCLIComplete, auth.RoleViewer)).Methods("GET")
	// kcli TUI/session state for frontend sync
	router.Handle("/clusters/{clusterId}/kcli/tui/state", h.wrapWithRBAC(h.GetKCLITUIState, auth.RoleViewer)).Methods("GET")

	// File transfer (browse/download/upload files in pod containers)
	router.Handle("/clusters/{clusterId}/resources/{namespace}/{pod}/ls", h.wrapWithRBAC(h.ListContainerFiles, auth.RoleViewer)).Methods("POST")
	router.Handle("/clusters/{clusterId}/resources/{namespace}/{pod}/download", h.wrapWithRBAC(h.DownloadContainerFile, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/resources/{namespace}/{pod}/upload", h.wrapWithRBAC(h.UploadContainerFile, auth.RoleOperator)).Methods("POST")

	// Download kubeconfig for a cluster - BE-AUTHZ-001: viewer can read kubeconfig
	router.Handle("/clusters/{clusterId}/kubeconfig", h.wrapWithRBAC(h.GetKubeconfig, auth.RoleViewer)).Methods("GET")

	// Fleet (cross-cluster) routes — aggregated overview and search across all clusters
	router.Handle("/fleet/overview", h.wrapWithRBAC(h.GetFleetOverview, auth.RoleViewer)).Methods("GET")
	router.Handle("/fleet/search", h.wrapWithRBAC(h.GetFleetSearch, auth.RoleViewer)).Methods("GET")

	// Health check
	router.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
	}).Methods("GET")

	// NOTE: NotFoundHandler moved to cmd/server/main.go (set AFTER all routes
	// including events-intelligence and otel are registered). Setting it here
	// would shadow routes registered by other packages on the same router.
}

// ListClusters handles GET /clusters (BE-AUTHZ-001: filters by user permissions).
func (h *Handler) ListClusters(w http.ResponseWriter, r *http.Request) {
	clusters, err := h.clusterService.ListClusters(r.Context())
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}
	// BE-AUTHZ-001: Filter clusters by user permissions if auth enabled
	if h.cfg.AuthMode != "" && h.cfg.AuthMode != "disabled" && h.repo != nil {
		claims := auth.ClaimsFromContext(r.Context())
		if claims != nil {
			// Admin sees all clusters
			if claims.Role == auth.RoleAdmin {
				respondJSON(w, http.StatusOK, clusters)
				return
			}
			// Get user's cluster permissions — fail-closed: on DB error return empty list, not all clusters.
			perms, err := h.repo.ListClusterPermissionsByUser(r.Context(), claims.UserID)
			if err != nil {
				requestID := logger.FromContext(r.Context())
				respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError,
					"failed to query cluster permissions", requestID)
				return
			}
			permMap := make(map[string]bool)
			for _, p := range perms {
				permMap[p.ClusterID] = true
			}
			// Filter: user sees clusters they have explicit permission for, or all if no permissions set (backward compat)
			if len(permMap) > 0 {
				filtered := make([]*models.Cluster, 0, len(clusters))
				for _, c := range clusters {
					if permMap[c.ID] {
						filtered = append(filtered, c)
					}
				}
				clusters = filtered
			}
		}
	}
	respondJSON(w, http.StatusOK, clusters)
}

// DiscoverClusters handles GET /clusters/discover
func (h *Handler) DiscoverClusters(w http.ResponseWriter, r *http.Request) {
	clusters, err := h.clusterService.DiscoverClusters(r.Context())
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, clusters)
}

// GetCluster handles GET /clusters/{clusterId}. clusterId may be backend UUID or context/name (e.g. docker-desktop).
func (h *Handler) GetCluster(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	// Headlamp/Lens model: if kubeconfig provided, return cluster info without storing
	kubeconfigBytes, contextName, err := h.getKubeconfigFromRequest(r)
	if err == nil && len(kubeconfigBytes) > 0 {
		// Create temporary client to get cluster info
		client, err := k8s.NewClientFromBytes(kubeconfigBytes, contextName)
		if err != nil {
			respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, fmt.Sprintf("Invalid kubeconfig: %v", err))
			return
		}

		info, err := client.GetClusterInfo(r.Context())
		if err != nil {
			respondErrorWithRequestID(w, r, http.StatusInternalServerError, ErrCodeInternalError, err.Error())
			return
		}

		// Return cluster info without storing (Headlamp/Lens stateless model)
		clusterInfo := map[string]interface{}{
			"id":        clusterID,
			"name":      contextName,
			"context":   contextName,
			"serverURL": info["server_url"],
			"version":   info["version"],
			"status":    "connected",
		}
		respondJSON(w, http.StatusOK, clusterInfo)
		return
	}

	// Fall back to stored cluster (backward compatibility)
	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}

	cluster, err := h.clusterService.GetCluster(r.Context(), resolvedID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, cluster)
}

// AddCluster handles POST /clusters.
// Accepts kubeconfig_base64 (browser upload/paste) or kubeconfig_path (server-side file path).
// Both paths fully persist the cluster in the backend database with provider auto-detection.
// Returns 201 Created with the complete Cluster model.
func (h *Handler) AddCluster(w http.ResponseWriter, r *http.Request) {
	var req struct {
		KubeconfigPath   string `json:"kubeconfig_path"`   // Server-side file path (e.g. ~/.kube/config)
		KubeconfigBase64 string `json:"kubeconfig_base64"` // Base64-encoded kubeconfig (browser upload/paste)
		Context          string `json:"context"`           // Optional context name override
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	// Path 1: kubeconfig content uploaded/pasted from browser (base64-encoded).
	// Writes to ~/.kubilitics/kubeconfigs/, persists cluster, detects provider.
	if req.KubeconfigBase64 != "" {
		// Try standard base64 (with padding) then raw (without padding) as fallback.
		decoded, err := base64.StdEncoding.DecodeString(req.KubeconfigBase64)
		if err != nil {
			decoded, err = base64.RawStdEncoding.DecodeString(req.KubeconfigBase64)
			if err != nil {
				respondError(w, http.StatusBadRequest, "kubeconfig_base64 is not valid base64")
				return
			}
		}

		cluster, err := h.clusterService.AddClusterFromBytes(r.Context(), decoded, req.Context)
		if err != nil {
			// P1-MC: Return 409 Conflict when cluster limit reached, with count and limit.
			var limitErr *service.ErrClusterLimitReached
			if errors.As(err, &limitErr) {
				respondJSON(w, http.StatusConflict, map[string]interface{}{
					"error":   limitErr.Error(),
					"current": limitErr.Current,
					"limit":   limitErr.Max,
				})
				return
			}
			respondError(w, http.StatusBadRequest, fmt.Sprintf("Failed to add cluster: %v", err))
			return
		}

		// Start events pipeline for the newly added cluster.
		h.notifyClusterConnected(cluster.ID)

		respondJSON(w, http.StatusCreated, cluster)
		return
	}

	// Path 2: server-side kubeconfig file path (CLI / existing integration).
	if req.KubeconfigPath == "" {
		respondError(w, http.StatusBadRequest, "Either kubeconfig_path or kubeconfig_base64 required")
		return
	}

	cluster, err := h.clusterService.AddCluster(r.Context(), req.KubeconfigPath, req.Context)
	if err != nil {
		// P1-MC: Return 409 Conflict when cluster limit reached, with count and limit.
		var limitErr *service.ErrClusterLimitReached
		if errors.As(err, &limitErr) {
			respondJSON(w, http.StatusConflict, map[string]interface{}{
				"error":   limitErr.Error(),
				"current": limitErr.Current,
				"limit":   limitErr.Max,
			})
			return
		}
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Start events pipeline for the newly added cluster.
	h.notifyClusterConnected(cluster.ID)

	respondJSON(w, http.StatusCreated, cluster)
}

// RemoveCluster handles DELETE /clusters/{clusterId}. clusterId may be backend UUID or context/name.
func (h *Handler) RemoveCluster(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	// Stop lifecycle hooks (events pipeline, etc.) before removing the cluster.
	for _, hook := range h.lifecycleHooks {
		hook.OnClusterDisconnected(resolvedID)
	}

	if err := h.clusterService.RemoveCluster(r.Context(), resolvedID); err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "Cluster removed"})
}

// ReconnectCluster handles POST /clusters/{clusterId}/reconnect.
// Resets the circuit breaker for the cluster and builds a fresh K8s client.
// Returns the updated cluster object (status "connected" on success, "error" on failure).
func (h *Handler) ReconnectCluster(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondErrorWithRequestID(w, r, http.StatusBadRequest, ErrCodeInvalidRequest, "Invalid clusterId")
		return
	}
	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusNotFound, ErrCodeNotFound, err.Error())
		return
	}
	cluster, err := h.clusterService.ReconnectCluster(r.Context(), resolvedID)
	if err != nil {
		respondErrorWithRequestID(w, r, http.StatusServiceUnavailable, ErrCodeInternalError, err.Error())
		return
	}

	// Restart events pipeline for the reconnected cluster.
	h.notifyClusterConnected(cluster.ID)

	respondJSON(w, http.StatusOK, cluster)
}

// GetClusterSummary handles GET /clusters/{clusterId}/summary. clusterId may be backend UUID or context/name.
// Optional query: projectId — when set, counts are restricted to namespaces belonging to that project in this cluster.
func (h *Handler) GetClusterSummary(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	resolvedID, resolveErr := h.resolveClusterID(r.Context(), clusterID)
	if resolveErr != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, resolveErr.Error(), requestID)
		return
	}
	clusterID = resolvedID
	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	// getClientFromRequest returns client (from kubeconfig or stored cluster); build summary from it
	info, infoErr := client.GetClusterInfo(r.Context())
	if infoErr != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusInternalServerError, ErrCodeInternalError, infoErr.Error(), requestID)
		return
	}
	nodeCount, _ := info["node_count"].(int)
	namespaceCount, _ := info["namespace_count"].(int)
	nodes, _ := client.Clientset.CoreV1().Nodes().List(r.Context(), metav1.ListOptions{})

	var projectNSSet map[string]struct{}
	if projectID := strings.TrimSpace(r.URL.Query().Get("projectId")); projectID != "" && h.projSvc != nil {
		proj, projErr := h.projSvc.GetProject(r.Context(), projectID)
		if projErr == nil {
			for _, n := range proj.Namespaces {
				if n.ClusterID == clusterID {
					if projectNSSet == nil {
						projectNSSet = make(map[string]struct{})
					}
					projectNSSet[n.NamespaceName] = struct{}{}
				}
			}
			// In project context, always use project namespace count (even if 0)
			if projectNSSet != nil {
				namespaceCount = len(projectNSSet)
			} else {
				namespaceCount = 0
			}
		}
	}

	// Fetch all resource counts in parallel — 27 API calls via goroutines
	ctx := r.Context()
	listOpts := metav1.ListOptions{}
	var wg sync.WaitGroup

	var pods *corev1.PodList
	var deployments *appsv1.DeploymentList
	var services *corev1.ServiceList
	var statefulsets *appsv1.StatefulSetList
	var replicasets *appsv1.ReplicaSetList
	var daemonsets *appsv1.DaemonSetList
	var jobs *batchv1.JobList
	var cronjobs *batchv1.CronJobList
	var ingresses *networkingv1.IngressList
	var ingressClasses *networkingv1.IngressClassList
	var endpoints *corev1.EndpointsList
	var endpointSlices *discoveryv1.EndpointSliceList
	var networkPolicies *networkingv1.NetworkPolicyList
	var configmaps *corev1.ConfigMapList
	var secrets *corev1.SecretList
	var pvs *corev1.PersistentVolumeList
	var pvcs *corev1.PersistentVolumeClaimList
	var storageClasses *storagev1.StorageClassList
	var serviceAccounts *corev1.ServiceAccountList
	var roles *rbacv1.RoleList
	var clusterRoles *rbacv1.ClusterRoleList
	var roleBindings *rbacv1.RoleBindingList
	var clusterRoleBindings *rbacv1.ClusterRoleBindingList
	var hpas *autoscalingv2.HorizontalPodAutoscalerList
	var limitRanges *corev1.LimitRangeList
	var resourceQuotas *corev1.ResourceQuotaList
	var pdbs *policyv1.PodDisruptionBudgetList
	var priorityClasses *schedulingv1.PriorityClassList
	var mutatingWebhooks *admissionregistrationv1.MutatingWebhookConfigurationList
	var validatingWebhooks *admissionregistrationv1.ValidatingWebhookConfigurationList

	wg.Add(30)
	go func() { defer wg.Done(); pods, _ = client.Clientset.CoreV1().Pods("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); deployments, _ = client.Clientset.AppsV1().Deployments("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); services, _ = client.Clientset.CoreV1().Services("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); statefulsets, _ = client.Clientset.AppsV1().StatefulSets("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); replicasets, _ = client.Clientset.AppsV1().ReplicaSets("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); daemonsets, _ = client.Clientset.AppsV1().DaemonSets("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); jobs, _ = client.Clientset.BatchV1().Jobs("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); cronjobs, _ = client.Clientset.BatchV1().CronJobs("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); ingresses, _ = client.Clientset.NetworkingV1().Ingresses("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); ingressClasses, _ = client.Clientset.NetworkingV1().IngressClasses().List(ctx, listOpts) }()
	go func() { defer wg.Done(); endpoints, _ = client.Clientset.CoreV1().Endpoints("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); endpointSlices, _ = client.Clientset.DiscoveryV1().EndpointSlices("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); networkPolicies, _ = client.Clientset.NetworkingV1().NetworkPolicies("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); configmaps, _ = client.Clientset.CoreV1().ConfigMaps("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); secrets, _ = client.Clientset.CoreV1().Secrets("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); pvs, _ = client.Clientset.CoreV1().PersistentVolumes().List(ctx, listOpts) }()
	go func() { defer wg.Done(); pvcs, _ = client.Clientset.CoreV1().PersistentVolumeClaims("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); storageClasses, _ = client.Clientset.StorageV1().StorageClasses().List(ctx, listOpts) }()
	go func() { defer wg.Done(); serviceAccounts, _ = client.Clientset.CoreV1().ServiceAccounts("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); roles, _ = client.Clientset.RbacV1().Roles("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); clusterRoles, _ = client.Clientset.RbacV1().ClusterRoles().List(ctx, listOpts) }()
	go func() { defer wg.Done(); roleBindings, _ = client.Clientset.RbacV1().RoleBindings("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); clusterRoleBindings, _ = client.Clientset.RbacV1().ClusterRoleBindings().List(ctx, listOpts) }()
	go func() { defer wg.Done(); hpas, _ = client.Clientset.AutoscalingV2().HorizontalPodAutoscalers("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); limitRanges, _ = client.Clientset.CoreV1().LimitRanges("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); resourceQuotas, _ = client.Clientset.CoreV1().ResourceQuotas("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); pdbs, _ = client.Clientset.PolicyV1().PodDisruptionBudgets("").List(ctx, listOpts) }()
	go func() { defer wg.Done(); priorityClasses, _ = client.Clientset.SchedulingV1().PriorityClasses().List(ctx, listOpts) }()
	go func() { defer wg.Done(); mutatingWebhooks, _ = client.Clientset.AdmissionregistrationV1().MutatingWebhookConfigurations().List(ctx, listOpts) }()
	go func() { defer wg.Done(); validatingWebhooks, _ = client.Clientset.AdmissionregistrationV1().ValidatingWebhookConfigurations().List(ctx, listOpts) }()
	wg.Wait()

	// Nil-safe count helper
	safeCount := func(items interface{}) int {
		if items == nil {
			return 0
		}
		// Use reflection-free counting via type switches for common types
		return -1 // sentinel — use direct len() below
	}
	_ = safeCount // suppress unused

	// Compute counts — nil-safe
	podCount := 0; if pods != nil { podCount = len(pods.Items) }
	// Pod status breakdown
	podStatus := models.OverviewPodStatus{}
	if pods != nil {
		for _, p := range pods.Items {
			switch p.Status.Phase {
			case "Running":
				podStatus.Running++
			case "Pending":
				podStatus.Pending++
			case "Failed":
				podStatus.Failed++
			case "Succeeded":
				podStatus.Succeeded++
			}
			for _, cs := range p.Status.ContainerStatuses {
				podStatus.TotalRestarts += int(cs.RestartCount)
			}
		}
	}
	deploymentCount := 0; if deployments != nil { deploymentCount = len(deployments.Items) }
	serviceCount := 0; if services != nil { serviceCount = len(services.Items) }
	statefulsetCount := 0; if statefulsets != nil { statefulsetCount = len(statefulsets.Items) }
	replicasetCount := 0; if replicasets != nil { replicasetCount = len(replicasets.Items) }
	daemonsetCount := 0; if daemonsets != nil { daemonsetCount = len(daemonsets.Items) }
	jobCount := 0; if jobs != nil { jobCount = len(jobs.Items) }
	cronjobCount := 0; if cronjobs != nil { cronjobCount = len(cronjobs.Items) }
	ingressCount := 0; if ingresses != nil { ingressCount = len(ingresses.Items) }
	ingressClassCount := 0; if ingressClasses != nil { ingressClassCount = len(ingressClasses.Items) }
	endpointCount := 0; if endpoints != nil { endpointCount = len(endpoints.Items) }
	endpointSliceCount := 0; if endpointSlices != nil { endpointSliceCount = len(endpointSlices.Items) }
	networkPolicyCount := 0; if networkPolicies != nil { networkPolicyCount = len(networkPolicies.Items) }
	configmapCount := 0; if configmaps != nil { configmapCount = len(configmaps.Items) }
	secretCount := 0; if secrets != nil { secretCount = len(secrets.Items) }
	pvCount := 0; if pvs != nil { pvCount = len(pvs.Items) }
	pvcCount := 0; if pvcs != nil { pvcCount = len(pvcs.Items) }
	storageClassCount := 0; if storageClasses != nil { storageClassCount = len(storageClasses.Items) }
	serviceAccountCount := 0; if serviceAccounts != nil { serviceAccountCount = len(serviceAccounts.Items) }
	roleCount := 0; if roles != nil { roleCount = len(roles.Items) }
	clusterRoleCount := 0; if clusterRoles != nil { clusterRoleCount = len(clusterRoles.Items) }
	roleBindingCount := 0; if roleBindings != nil { roleBindingCount = len(roleBindings.Items) }
	clusterRoleBindingCount := 0; if clusterRoleBindings != nil { clusterRoleBindingCount = len(clusterRoleBindings.Items) }
	hpaCount := 0; if hpas != nil { hpaCount = len(hpas.Items) }
	limitRangeCount := 0; if limitRanges != nil { limitRangeCount = len(limitRanges.Items) }
	resourceQuotaCount := 0; if resourceQuotas != nil { resourceQuotaCount = len(resourceQuotas.Items) }
	pdbCount := 0; if pdbs != nil { pdbCount = len(pdbs.Items) }
	priorityClassCount := 0; if priorityClasses != nil { priorityClassCount = len(priorityClasses.Items) }
	mutatingWebhookCount := 0; if mutatingWebhooks != nil { mutatingWebhookCount = len(mutatingWebhooks.Items) }
	validatingWebhookCount := 0; if validatingWebhooks != nil { validatingWebhookCount = len(validatingWebhooks.Items) }

	// Project namespace filtering for namespaced resources
	if projectNSSet != nil {
		podCount = 0; podStatus = models.OverviewPodStatus{}
		for _, p := range pods.Items {
			if _, ok := projectNSSet[p.Namespace]; !ok { continue }
			podCount++
			switch p.Status.Phase { case "Running": podStatus.Running++; case "Pending": podStatus.Pending++; case "Failed": podStatus.Failed++; case "Succeeded": podStatus.Succeeded++ }
			for _, cs := range p.Status.ContainerStatuses { podStatus.TotalRestarts += int(cs.RestartCount) }
		}
		deploymentCount = 0; for _, d := range deployments.Items { if _, ok := projectNSSet[d.Namespace]; ok { deploymentCount++ } }
		serviceCount = 0; for _, s := range services.Items { if _, ok := projectNSSet[s.Namespace]; ok { serviceCount++ } }
		statefulsetCount = 0; for _, sts := range statefulsets.Items { if _, ok := projectNSSet[sts.Namespace]; ok { statefulsetCount++ } }
		replicasetCount = 0; for _, rs := range replicasets.Items { if _, ok := projectNSSet[rs.Namespace]; ok { replicasetCount++ } }
		daemonsetCount = 0; for _, ds := range daemonsets.Items { if _, ok := projectNSSet[ds.Namespace]; ok { daemonsetCount++ } }
		jobCount = 0; for _, j := range jobs.Items { if _, ok := projectNSSet[j.Namespace]; ok { jobCount++ } }
		cronjobCount = 0; for _, cj := range cronjobs.Items { if _, ok := projectNSSet[cj.Namespace]; ok { cronjobCount++ } }
		ingressCount = 0; if ingresses != nil { for _, i := range ingresses.Items { if _, ok := projectNSSet[i.Namespace]; ok { ingressCount++ } } }
		endpointCount = 0; if endpoints != nil { for _, e := range endpoints.Items { if _, ok := projectNSSet[e.Namespace]; ok { endpointCount++ } } }
		endpointSliceCount = 0; if endpointSlices != nil { for _, e := range endpointSlices.Items { if _, ok := projectNSSet[e.Namespace]; ok { endpointSliceCount++ } } }
		networkPolicyCount = 0; if networkPolicies != nil { for _, n := range networkPolicies.Items { if _, ok := projectNSSet[n.Namespace]; ok { networkPolicyCount++ } } }
		configmapCount = 0; if configmaps != nil { for _, c := range configmaps.Items { if _, ok := projectNSSet[c.Namespace]; ok { configmapCount++ } } }
		secretCount = 0; if secrets != nil { for _, s := range secrets.Items { if _, ok := projectNSSet[s.Namespace]; ok { secretCount++ } } }
		pvcCount = 0; if pvcs != nil { for _, p := range pvcs.Items { if _, ok := projectNSSet[p.Namespace]; ok { pvcCount++ } } }
		serviceAccountCount = 0; if serviceAccounts != nil { for _, s := range serviceAccounts.Items { if _, ok := projectNSSet[s.Namespace]; ok { serviceAccountCount++ } } }
		roleCount = 0; if roles != nil { for _, ro := range roles.Items { if _, ok := projectNSSet[ro.Namespace]; ok { roleCount++ } } }
		roleBindingCount = 0; if roleBindings != nil { for _, rb := range roleBindings.Items { if _, ok := projectNSSet[rb.Namespace]; ok { roleBindingCount++ } } }
		hpaCount = 0; if hpas != nil { for _, h := range hpas.Items { if _, ok := projectNSSet[h.Namespace]; ok { hpaCount++ } } }
		limitRangeCount = 0; if limitRanges != nil { for _, l := range limitRanges.Items { if _, ok := projectNSSet[l.Namespace]; ok { limitRangeCount++ } } }
		resourceQuotaCount = 0; if resourceQuotas != nil { for _, rq := range resourceQuotas.Items { if _, ok := projectNSSet[rq.Namespace]; ok { resourceQuotaCount++ } } }
		pdbCount = 0; if pdbs != nil { for _, p := range pdbs.Items { if _, ok := projectNSSet[p.Namespace]; ok { pdbCount++ } } }
		// Cluster-scoped resources (PVs, StorageClasses, ClusterRoles, etc.) are NOT project-filtered
	}

	// Compute cluster health from actual resource states
	healthResult := computeClusterHealth(nodes, pods, deployments)

	summary := &models.ClusterSummary{
		ID:               clusterID,
		Name:             clusterID,
		NodeCount:        nodeCount,
		NamespaceCount:   namespaceCount,
		PodCount:         podCount,
		PodStatus:        podStatus,
		DeploymentCount:  deploymentCount,
		ServiceCount:     serviceCount,
		StatefulSetCount: statefulsetCount,
		ReplicaSetCount:  replicasetCount,
		DaemonSetCount:   daemonsetCount,
		JobCount:         jobCount,
		CronJobCount:     cronjobCount,
		HealthStatus:     healthResult.Status,
		HealthReason:     healthResult.Insight,

		IngressCount:       ingressCount,
		IngressClassCount:  ingressClassCount,
		EndpointCount:      endpointCount,
		EndpointSliceCount: endpointSliceCount,
		NetworkPolicyCount: networkPolicyCount,

		ConfigMapCount: configmapCount,
		SecretCount:    secretCount,

		PersistentVolumeCount:      pvCount,
		PersistentVolumeClaimCount: pvcCount,
		StorageClassCount:          storageClassCount,

		ServiceAccountCount:     serviceAccountCount,
		RoleCount:               roleCount,
		ClusterRoleCount:        clusterRoleCount,
		RoleBindingCount:        roleBindingCount,
		ClusterRoleBindingCount: clusterRoleBindingCount,

		HPACount:                 hpaCount,
		LimitRangeCount:          limitRangeCount,
		ResourceQuotaCount:       resourceQuotaCount,
		PodDisruptionBudgetCount: pdbCount,

		PriorityClassCount: priorityClassCount,

		CustomResourceDefinitionCount: 0, // CRDs require dynamic client, handled separately if needed
		MutatingWebhookConfigCount:    mutatingWebhookCount,
		ValidatingWebhookConfigCount:  validatingWebhookCount,
	}
	respondJSON(w, http.StatusOK, summary)
}

// computeClusterHealth builds a ClusterState from raw K8s list data and delegates
// to the enterprise healthscore.Score() engine.
func computeClusterHealth(nodes *corev1.NodeList, pods *corev1.PodList, deployments *appsv1.DeploymentList) *healthscore.HealthResult {
	var state healthscore.ClusterState

	// Nodes: count ready, disk/memory/PID pressure
	if nodes != nil {
		state.TotalNodes = len(nodes.Items)
		for i := range nodes.Items {
			for _, cond := range nodes.Items[i].Status.Conditions {
				switch cond.Type {
				case corev1.NodeReady:
					if cond.Status == corev1.ConditionTrue {
						state.ReadyNodes++
					}
				case corev1.NodeDiskPressure:
					if cond.Status == corev1.ConditionTrue {
						state.DiskPressure++
					}
				case corev1.NodeMemoryPressure:
					if cond.Status == corev1.ConditionTrue {
						state.MemPressure++
					}
				case corev1.NodePIDPressure:
					if cond.Status == corev1.ConditionTrue {
						state.PIDPressure++
					}
				}
			}
		}
	}

	// Pods: phase counts, CrashLoopBackOff, OOMKilled, restarts
	if pods != nil {
		for i := range pods.Items {
			p := &pods.Items[i]
			switch p.Status.Phase {
			case corev1.PodRunning:
				state.PodsRunning++
			case corev1.PodPending:
				state.PodsPending++
			case corev1.PodFailed:
				state.PodsFailed++
			case corev1.PodSucceeded:
				state.PodsSucceeded++
			}
			for _, cs := range p.Status.ContainerStatuses {
				state.TotalRestarts += int(cs.RestartCount)
				if cs.State.Waiting != nil && cs.State.Waiting.Reason == "CrashLoopBackOff" {
					state.PodsCrashLoop++
				}
				if cs.LastTerminationState.Terminated != nil && cs.LastTerminationState.Terminated.Reason == "OOMKilled" {
					state.PodsOOMKilled++
				}
			}
		}
	}

	// Deployments: available vs unavailable
	if deployments != nil {
		state.DeploymentsTotal = len(deployments.Items)
		for i := range deployments.Items {
			d := &deployments.Items[i]
			if d.Status.UnavailableReplicas > 0 {
				state.DeploymentsUnavailable++
			} else if d.Status.AvailableReplicas > 0 {
				state.DeploymentsAvailable++
			} else {
				state.DeploymentsAvailable++ // no replicas requested or all satisfied
			}
		}
		state.DeploymentsProgressing = state.DeploymentsTotal - state.DeploymentsAvailable - state.DeploymentsUnavailable
		if state.DeploymentsProgressing < 0 {
			state.DeploymentsProgressing = 0
		}
	}

	result := healthscore.Score(state)
	return &result
}

// GetCapabilities returns backend capabilities (e.g. resource topology kinds). GET /api/v1/capabilities.
func (h *Handler) GetCapabilities(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]interface{}{
		"resource_topology_kinds": topology.ResourceTopologyKinds,
	})
}

// GetTopology handles GET /clusters/{clusterId}/topology with timeout and metrics (B2.2, B2.3).
func (h *Handler) GetTopology(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	namespace := r.URL.Query().Get("namespace")
	filters := models.TopologyFilters{Namespace: namespace}

	// Parse depth parameter for progressive disclosure (0-3, default 3 = all)
	depth := 3
	if d := r.URL.Query().Get("depth"); d != "" {
		if parsed, err := strconv.Atoi(d); err == nil && parsed >= 0 && parsed <= 3 {
			depth = parsed
		}
	}

	// BE-SCALE-002: Support force_refresh query param to bypass cache
	forceRefresh := r.URL.Query().Get("force_refresh") == "true"

	maxNodes := 0
	if h.cfg != nil && h.cfg.TopologyMaxNodes > 0 {
		maxNodes = h.cfg.TopologyMaxNodes
	}

	timeoutSec := 30
	if h.cfg != nil && h.cfg.TopologyTimeoutSec > 0 {
		timeoutSec = h.cfg.TopologyTimeoutSec
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	// getClientFromRequest returns client (from kubeconfig or stored cluster); use it for topology
	start := time.Now()
	topology, err := h.topologyService.GetTopologyWithClient(ctx, client, clusterID, filters, maxNodes, forceRefresh)
	metrics.TopologyBuildDurationSeconds.Observe(time.Since(start).Seconds())

	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			respondError(w, http.StatusServiceUnavailable, "Topology build timed out")
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Apply progressive disclosure depth filtering (same kind-set as V2 depth_filter.go)
	if depth < 3 && topology != nil {
		topology.Nodes, topology.Edges = filterTopologyByDepth(topology.Nodes, topology.Edges, depth)
	}

	respondJSON(w, http.StatusOK, topology)
}

// filterTopologyByDepth applies progressive disclosure to V1 TopologyGraph.
// Uses the same depth-kind mapping as the V2 builder's FilterByDepth.
func filterTopologyByDepth(nodes []models.TopologyNode, edges []models.TopologyEdge, depth int) ([]models.TopologyNode, []models.TopologyEdge) {
	// Cumulative kind sets per depth level (same as v2/builder/depth_filter.go)
	depthKinds := []map[string]bool{
		// depth 0: executive view
		{"Deployment": true, "StatefulSet": true, "DaemonSet": true, "CronJob": true, "Service": true, "Ingress": true, "Node": true, "Namespace": true},
		// depth 1: + intermediary controllers
		{"ReplicaSet": true, "Job": true, "Endpoints": true, "EndpointSlice": true, "HorizontalPodAutoscaler": true, "PodDisruptionBudget": true},
		// depth 2: + workload units, configuration, storage
		{"Pod": true, "ConfigMap": true, "Secret": true, "PersistentVolumeClaim": true, "PersistentVolume": true, "StorageClass": true, "ServiceAccount": true},
	}
	allowed := make(map[string]bool)
	for level := 0; level <= depth && level < len(depthKinds); level++ {
		for k := range depthKinds[level] {
			allowed[k] = true
		}
	}
	if depth >= 3 {
		return nodes, edges
	}

	var filteredNodes []models.TopologyNode
	visibleIDs := make(map[string]bool)
	for _, n := range nodes {
		if allowed[n.Kind] {
			filteredNodes = append(filteredNodes, n)
			visibleIDs[n.ID] = true
		}
	}

	var filteredEdges []models.TopologyEdge
	for _, e := range edges {
		if visibleIDs[e.Source] && visibleIDs[e.Target] {
			filteredEdges = append(filteredEdges, e)
		}
	}

	return filteredNodes, filteredEdges
}

// GetTopologyV2 handles GET /clusters/{clusterId}/topology/cluster. Builds topology from live cluster data.
//
// Query parameters:
//   - mode: view mode (cluster, namespace, workload, resource, rbac). Default: namespace
//   - namespace: filter by namespace
//   - depth: progressive disclosure level (0-3). Default: 0
//     0 = executive view (Deployments, StatefulSets, DaemonSets, CronJobs, Services, Ingresses, Nodes, Namespaces)
//     1 = above + ReplicaSets, Jobs, Endpoints, EndpointSlices, HPAs, PDBs
//     2 = above + Pods, ConfigMaps, Secrets, PVCs, PVs, StorageClasses, ServiceAccounts
//     3 = everything (Roles, RoleBindings, ClusterRoles, NetworkPolicies, Events, etc.)
//   - expand: node ID to expand (e.g. "Deployment/default/nginx"). Adds all direct
//     neighbors of that node to the depth-filtered result.
func (h *Handler) GetTopologyV2(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	clusterName := clusterID
	if c, err := h.clusterService.GetCluster(r.Context(), clusterID); err == nil && c != nil && c.Name != "" {
		clusterName = c.Name
	}
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = string(topologyv2.ViewModeNamespace)
	}
	namespace := r.URL.Query().Get("namespace")

	// Parse depth parameter (default 0 = executive view)
	depth := 0
	if d := r.URL.Query().Get("depth"); d != "" {
		if parsed, err := strconv.Atoi(d); err == nil && parsed >= 0 && parsed <= 3 {
			depth = parsed
		}
	}

	// Parse expand parameter
	expandNodeID := r.URL.Query().Get("expand")

	opts := topologyv2.Options{
		ClusterID:   clusterID,
		ClusterName: clusterName,
		Mode:        topologyv2.ViewMode(mode),
		Namespace:   namespace,
	}
	// Apply request timeout (10s default, configurable)
	timeoutSec := 10
	if h.cfg != nil && h.cfg.TopologyTimeoutSec > 0 {
		timeoutSec = h.cfg.TopologyTimeoutSec
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	client, err := h.getClientFromRequest(ctx, r, clusterID, h.cfg)
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, "Cluster not connected")
		return
	}

	// Check cache (key includes expand so expanded views aren't confused with base views)
	cacheKey := topologyCacheKey(clusterID, mode, namespace, depth)
	if expandNodeID != "" {
		cacheKey += "|expand=" + expandNodeID
	}

	var resp *topologyv2.TopologyResponse
	if cached, ok := topologyCacheGet(cacheKey); ok {
		resp = cached
	} else {
		// Cache miss — build topology
		built, buildErr := topologyv2builder.BuildTopology(ctx, opts, client)
		if buildErr != nil {
			if errors.Is(buildErr, context.DeadlineExceeded) {
				respondError(w, http.StatusServiceUnavailable, "Topology build timed out")
				return
			}
			respondError(w, http.StatusInternalServerError, buildErr.Error())
			return
		}

		// Apply progressive disclosure depth filtering
		totalNodes := len(built.Nodes)

		// Truncation guard: if too many nodes, force depth=0
		truncated := false
		effectiveDepth := depth
		if totalNodes > MaxTopologyNodes && depth > 0 {
			effectiveDepth = 0
			truncated = true
		}

		filteredNodes, filteredEdges, expandable := topologyv2builder.FilterByDepth(built.Nodes, built.Edges, effectiveDepth)

		// If still too many after depth=0, mark truncated
		if len(filteredNodes) > MaxTopologyNodes {
			truncated = true
		}

		// If expand parameter is set, expand that node's neighbors
		if expandNodeID != "" {
			filteredNodes, filteredEdges = topologyv2builder.ExpandNode(built.Nodes, built.Edges, filteredNodes, expandNodeID)
			// Recalculate expandable after expansion
			visibleIDs := make(map[string]bool, len(filteredNodes))
			for _, n := range filteredNodes {
				visibleIDs[n.ID] = true
			}
			expandable = nil
			for _, e := range built.Edges {
				if visibleIDs[e.Source] && !visibleIDs[e.Target] {
					expandable = append(expandable, e.Source)
				}
				if visibleIDs[e.Target] && !visibleIDs[e.Source] {
					expandable = append(expandable, e.Target)
				}
			}
			// Deduplicate
			seen := make(map[string]bool)
			deduped := expandable[:0]
			for _, id := range expandable {
				if !seen[id] {
					seen[id] = true
					deduped = append(deduped, id)
				}
			}
			expandable = deduped
		}

		built.Nodes = filteredNodes
		built.Edges = filteredEdges
		built.Metadata.Depth = effectiveDepth
		built.Metadata.TotalNodes = totalNodes
		built.Metadata.Expandable = expandable
		built.Metadata.ResourceCount = len(filteredNodes)
		built.Metadata.EdgeCount = len(filteredEdges)
		if truncated {
			built.Metadata.Truncated = true
			built.Metadata.TruncateReason = fmt.Sprintf("response exceeded %d nodes; auto-filtered to depth=0", MaxTopologyNodes)
		}

		resp = built
		topologyCacheSet(cacheKey, resp)
	}

	respondJSON(w, http.StatusOK, resp)
}

// GetTopologyV2Traffic handles GET /clusters/{clusterId}/topology/cluster/traffic.
// Returns inferred traffic edges and criticality scores for every topology node.
func (h *Handler) GetTopologyV2Traffic(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	clusterName := clusterID
	if c, err := h.clusterService.GetCluster(r.Context(), clusterID); err == nil && c != nil && c.Name != "" {
		clusterName = c.Name
	}
	namespace := r.URL.Query().Get("namespace")
	opts := topologyv2.Options{
		ClusterID:   clusterID,
		ClusterName: clusterName,
		Mode:        topologyv2.ViewModeNamespace,
		Namespace:   namespace,
	}

	// Apply request timeout
	timeoutSec := 10
	if h.cfg != nil && h.cfg.TopologyTimeoutSec > 0 {
		timeoutSec = h.cfg.TopologyTimeoutSec
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	client, err := h.getClientFromRequest(ctx, r, clusterID, h.cfg)
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, "Cluster not connected")
		return
	}

	// Check cache for the underlying topology
	cacheKey := topologyCacheKey(clusterID, "traffic", namespace, 0)

	var resp *topologyv2.TopologyResponse
	if cached, ok := topologyCacheGet(cacheKey); ok {
		resp = cached
	} else {
		built, buildErr := topologyv2builder.BuildTopology(ctx, opts, client)
		if buildErr != nil {
			if errors.Is(buildErr, context.DeadlineExceeded) {
				respondError(w, http.StatusServiceUnavailable, "Topology build timed out")
				return
			}
			respondError(w, http.StatusInternalServerError, buildErr.Error())
			return
		}

		// Truncation guard
		if len(built.Nodes) > MaxTopologyNodes {
			filteredNodes, filteredEdges, _ := topologyv2builder.FilterByDepth(built.Nodes, built.Edges, 0)
			built.Nodes = filteredNodes
			built.Edges = filteredEdges
			built.Metadata.Truncated = true
			built.Metadata.TruncateReason = fmt.Sprintf("response exceeded %d nodes; auto-filtered to depth=0", MaxTopologyNodes)
		}

		resp = built
		topologyCacheSet(cacheKey, resp)
	}

	// Collect the resource bundle for traffic inference
	bundle, _ := topologyv2.CollectFromClient(ctx, client, namespace)

	trafficEdges := topologyv2builder.InferTraffic(resp.Nodes, resp.Edges, bundle)
	criticalityScores := topologyv2builder.ScoreNodes(resp.Nodes, resp.Edges)

	result := map[string]interface{}{
		"clusterId":   clusterID,
		"clusterName": clusterName,
		"namespace":   namespace,
		"traffic":     trafficEdges,
		"criticality": criticalityScores,
		"nodeCount":   len(resp.Nodes),
		"edgeCount":   len(resp.Edges),
	}
	if resp.Metadata.Truncated {
		result["truncated"] = true
		result["truncateReason"] = resp.Metadata.TruncateReason
	}

	respondJSON(w, http.StatusOK, result)
}

// GetTopologyV2Impact handles GET /clusters/{clusterId}/topology/cluster/impact/{kind}/{namespace}/{name}.
// Returns blast radius: all resources transitively impacted if the given resource fails.
func (h *Handler) GetTopologyV2Impact(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	kind := strings.TrimSpace(vars["kind"])
	namespace := strings.TrimSpace(vars["namespace"])
	name := strings.TrimSpace(vars["name"])
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	if kind == "" || name == "" {
		respondError(w, http.StatusBadRequest, "kind and name are required")
		return
	}
	// Cluster-scoped resources use "-" or "_" for namespace
	if namespace == "-" || namespace == "_" {
		namespace = ""
	}
	depth := 3
	if d := r.URL.Query().Get("depth"); d != "" {
		if v, err := strconv.Atoi(d); err == nil && v > 0 && v <= 10 {
			depth = v
		}
	}

	clusterName := clusterID
	if c, err := h.clusterService.GetCluster(r.Context(), clusterID); err == nil && c != nil && c.Name != "" {
		clusterName = c.Name
	}
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		respondError(w, http.StatusServiceUnavailable, "Cluster not connected")
		return
	}
	opts := topologyv2.Options{
		ClusterID:   clusterID,
		ClusterName: clusterName,
		Mode:        topologyv2.ViewModeCluster,
	}
	resp, err := topologyv2builder.BuildTopology(r.Context(), opts, client)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Build resource ID in the format used by topology nodes
	var resourceID string
	if namespace == "" {
		resourceID = kind + "/" + name
	} else {
		resourceID = kind + "/" + namespace + "/" + name
	}

	// Build reverse index and compute impact
	ri := topologyv2builder.BuildReverseIndex(resp.Edges)
	impacted := ri.GetImpactDetailed(resourceID, depth)

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"resourceId": resourceID,
		"kind":       kind,
		"namespace":  namespace,
		"name":       name,
		"depth":      depth,
		"impacted":   impacted,
		"count":      len(impacted),
	})
}

// GetResourceTopology handles GET /clusters/{clusterId}/topology/resource/{kind}/{namespace}/{name}.
// For cluster-scoped resources (Node, PV, StorageClass, etc.) use namespace "-" or "_".
func (h *Handler) GetResourceTopology(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	kind := strings.TrimSpace(vars["kind"])
	namespace := strings.TrimSpace(vars["namespace"])
	name := strings.TrimSpace(vars["name"])
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	if kind == "" || name == "" {
		respondError(w, http.StatusBadRequest, "kind and name are required")
		return
	}
	if namespace == "-" || namespace == "_" {
		namespace = ""
	}

	// Normalize kind so "jobs" -> "Job", "statefulsets" -> "StatefulSet", etc. (single place for API contract).
	kind = topology.NormalizeResourceKind(kind)

	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	timeoutSec := 30
	if h.cfg != nil && h.cfg.TopologyTimeoutSec > 0 {
		timeoutSec = h.cfg.TopologyTimeoutSec
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	// Use v2 topology engine (24 matchers) for resource-scoped graph
	clusterName := clusterID
	if c, err := h.clusterService.GetCluster(ctx, clusterID); err == nil && c != nil && c.Name != "" {
		clusterName = c.Name
	}
	v2Opts := topologyv2.Options{
		ClusterID:   clusterID,
		ClusterName: clusterName,
		Mode:        topologyv2.ViewModeCluster, // Use cluster mode to get ALL nodes; handler does its own BFS filtering
	}
	// Parse hop depth from query (default 1 = direct connections only).
	// Accept both "depth" (frontend convention) and "hops" (backend legacy) — "depth" takes precedence.
	hops := 1
	if d := r.URL.Query().Get("depth"); d != "" {
		if v, err := strconv.Atoi(d); err == nil && v >= 1 && v <= 5 {
			hops = v
		}
	} else if d := r.URL.Query().Get("hops"); d != "" {
		if v, err := strconv.Atoi(d); err == nil && v >= 1 && v <= 5 {
			hops = v
		}
	}

	// Cache key for the full topology build (before BFS filtering)
	resCacheKey := topologyCacheKey(clusterID, "resource", namespace, 0)

	var v2Resp *topologyv2.TopologyResponse
	var buildErr error
	if cached, ok := topologyCacheGet(resCacheKey); ok {
		v2Resp = cached
	} else {
		v2Resp, buildErr = topologyv2builder.BuildTopology(ctx, v2Opts, client)
		if buildErr == nil && v2Resp != nil && len(v2Resp.Nodes) > 0 {
			// Score all nodes on the FULL graph before caching.
			// Scores are computed once and carried through BFS filtering via node.Extra.
			attachCriticalityScores(v2Resp)
			topologyCacheSet(resCacheKey, v2Resp)
		}
	}

	if buildErr == nil && v2Resp != nil && len(v2Resp.Nodes) > 0 {
		var targetID string
		if namespace == "" {
			targetID = kind + "/" + name
		} else {
			targetID = kind + "/" + namespace + "/" + name
		}
		filter := &topologyv2.ViewFilter{}
		result := filter.Filter(v2Resp, topologyv2.Options{
			Mode:      topologyv2.ViewModeResource,
			Namespace: namespace,
			Resource:  targetID,
			Depth:     hops,
		})
		if result == nil {
			result = &topologyv2.TopologyResponse{}
		}
		result.Metadata.ResourceCount = len(result.Nodes)
		result.Metadata.EdgeCount = len(result.Edges)
		result.Metadata.TotalNodes = len(v2Resp.Nodes)
		result.Metadata.Depth = hops
		result.Metadata.FocusResource = targetID

		for i := range result.Nodes {
			if result.Nodes[i].ID != targetID {
				continue
			}
			if result.Nodes[i].Extra == nil {
				result.Nodes[i].Extra = make(map[string]interface{})
			}
			result.Nodes[i].Extra["isCentral"] = true
			break
		}

		respondJSON(w, http.StatusOK, result)
		return
	}

	if buildErr != nil && errors.Is(buildErr, context.DeadlineExceeded) {
		respondError(w, http.StatusServiceUnavailable, "Topology build timed out")
		return
	}

	// v2 engine failed — return the build error directly (no v1 fallback)
	if buildErr != nil {
		respondError(w, http.StatusInternalServerError, fmt.Sprintf("topology build failed: %v", buildErr))
		return
	}
	respondError(w, http.StatusNotFound, fmt.Sprintf("Resource %s/%s not found in topology", kind, name))
}

// attachCriticalityScores runs ScoreNodes on the full topology and writes
// the results into each node's Extra["criticality"] map. This must be
// called ONCE on the full graph before caching so that scores survive
// BFS filtering (Extra is carried through).
func attachCriticalityScores(resp *topologyv2.TopologyResponse) {
	scores := topologyv2builder.ScoreNodes(resp.Nodes, resp.Edges)
	scoreMap := make(map[string]topologyv2builder.CriticalityScore, len(scores))
	for _, s := range scores {
		scoreMap[s.NodeID] = s
	}
	var matched int
	for i := range resp.Nodes {
		if score, ok := scoreMap[resp.Nodes[i].ID]; ok {
			if resp.Nodes[i].Extra == nil {
				resp.Nodes[i].Extra = make(map[string]interface{})
			}
			resp.Nodes[i].Extra["criticality"] = map[string]interface{}{
				"score":           score.Score,
				"level":           score.Level,
				"pageRank":        score.PageRank,
				"fanIn":           score.FanIn,
				"fanOut":          score.FanOut,
				"blastRadius":     score.BlastRadius,
				"dependencyDepth": score.DependencyDepth,
				"isSPOF":          score.IsSPOF,
				"confidence":      score.Confidence,
			}
			matched++
		}
	}
	_ = matched // scored all nodes
}

// criticalitySummary is the lightweight response type for the /criticality endpoint.
type criticalitySummary struct {
	NodeID      string  `json:"nodeId"`
	Kind        string  `json:"kind"`
	Namespace   string  `json:"namespace"`
	Name        string  `json:"name"`
	Level       string  `json:"level"`
	BlastRadius int     `json:"blastRadius"`
	IsSPOF      bool    `json:"isSPOF"`
	Score       float64 `json:"score"`
}

// GetCriticality handles GET /clusters/{clusterId}/topology/cluster/criticality.
// Returns a flat JSON array of criticality scores for every resource in the topology.
// Optional query param: namespace (filter results to a single namespace).
func (h *Handler) GetCriticality(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}

	nsFilter := strings.TrimSpace(r.URL.Query().Get("namespace"))

	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	timeoutSec := 30
	if h.cfg != nil && h.cfg.TopologyTimeoutSec > 0 {
		timeoutSec = h.cfg.TopologyTimeoutSec
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	// Use the same cache as resource topology (full cluster-mode build)
	cacheKey := topologyCacheKey(clusterID, "resource", "", 0)

	var resp *topologyv2.TopologyResponse
	if cached, ok := topologyCacheGet(cacheKey); ok {
		resp = cached
	} else {
		clusterName := clusterID
		if c, err := h.clusterService.GetCluster(ctx, clusterID); err == nil && c != nil && c.Name != "" {
			clusterName = c.Name
		}
		opts := topologyv2.Options{
			ClusterID:   clusterID,
			ClusterName: clusterName,
			Mode:        topologyv2.ViewModeCluster,
		}
		built, buildErr := topologyv2builder.BuildTopology(ctx, opts, client)
		if buildErr != nil {
			if errors.Is(buildErr, context.DeadlineExceeded) {
				respondError(w, http.StatusServiceUnavailable, "Topology build timed out")
				return
			}
			respondError(w, http.StatusInternalServerError, buildErr.Error())
			return
		}
		if built != nil && len(built.Nodes) > 0 {
			attachCriticalityScores(built)
			topologyCacheSet(cacheKey, built)
		}
		resp = built
	}

	if resp == nil || len(resp.Nodes) == 0 {
		respondJSON(w, http.StatusOK, []criticalitySummary{})
		return
	}

	// Score from cached Extra (already attached by attachCriticalityScores)
	// If Extra["criticality"] is missing (old cache entry), recompute
	if _, hasCrit := resp.Nodes[0].Extra["criticality"]; !hasCrit {
		attachCriticalityScores(resp)
	}

	results := make([]criticalitySummary, 0, len(resp.Nodes))
	for _, n := range resp.Nodes {
		if nsFilter != "" && n.Namespace != nsFilter {
			continue
		}
		crit, ok := n.Extra["criticality"].(map[string]interface{})
		if !ok {
			continue
		}
		score, _ := crit["score"].(float64)
		level, _ := crit["level"].(string)
		blastRadius, _ := crit["blastRadius"].(int)
		isSPOF, _ := crit["isSPOF"].(bool)

		results = append(results, criticalitySummary{
			NodeID:      n.ID,
			Kind:        n.Kind,
			Namespace:   n.Namespace,
			Name:        n.Name,
			Level:       level,
			BlastRadius: blastRadius,
			IsSPOF:      isSPOF,
			Score:       score,
		})
	}

	respondJSON(w, http.StatusOK, results)
}

// ExportTopology handles POST /clusters/{clusterId}/topology/export (BE-FUNC-001).
// Format via query param ?format=json|svg|png or JSON body {"format": "..."}. Default: json.
func (h *Handler) ExportTopology(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	format := r.URL.Query().Get("format")
	if format == "" && r.Body != nil {
		var req struct {
			Format string `json:"format"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.Format != "" {
			format = req.Format
		}
	}
	if format == "" {
		format = "json"
	}

	// Architecture diagram: handled separately (needs namespace + kubeconfig path)
	if format == service.ExportFormatArchitecture {
		if !topologyexport.IsKubeDiagramsAvailable() {
			respondError(w, http.StatusServiceUnavailable, "kube-diagrams not installed. Install with: pip install KubeDiagrams && brew install graphviz")
			return
		}
		namespace := r.URL.Query().Get("namespace")
		data, err := topologyexport.GraphToArchitecturePNG(r.Context(), client.KubeconfigPath(), namespace, "")
		if err != nil {
			respondError(w, http.StatusInternalServerError, "Architecture diagram generation failed: "+err.Error())
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Content-Disposition", `attachment; filename="architecture-diagram.png"`)
		w.WriteHeader(http.StatusOK)
		w.Write(data)
		return
	}

	// getClientFromRequest returns client (from kubeconfig or stored cluster); use it for export
	data, err := h.topologyService.ExportTopologyWithClient(r.Context(), client, clusterID, format)
	if err != nil {
		if errors.Is(err, service.ErrExportNotImplemented) {
			respondError(w, http.StatusBadRequest, "Unsupported format. Use format=json|svg|png|architecture")
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Content-Type and Content-Disposition per format (BE-FUNC-001)
	var contentType, filename string
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "json":
		contentType = "application/json"
		filename = "topology.json"
	case "svg":
		contentType = "image/svg+xml"
		filename = "topology.svg"
	case "png":
		contentType = "image/png"
		filename = "topology.png"
	default:
		contentType = "application/octet-stream"
		filename = "topology." + format
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	w.Write(data)
}

// pathVarsKey is the context key for path params set by rollout path-intercept middleware.
type pathVarsKey struct{}

// SetPathVars sets clusterId/namespace/name (or other path params) on the request context so handlers can read them when mux.Vars is empty.
func SetPathVars(r *http.Request, vars map[string]string) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), &pathVarsKey{}, vars))
}

// GetPathVars returns path params from context (set by middleware) or from mux.Vars(r).
func GetPathVars(r *http.Request) map[string]string {
	if v := r.Context().Value(&pathVarsKey{}); v != nil {
		if m, ok := v.(map[string]string); ok {
			return m
		}
	}
	return mux.Vars(r)
}

// Helper functions
func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, message string) {
	respondJSON(w, status, map[string]string{"error": message})
}

// respondErrorWithRequestID is a convenience wrapper that includes request ID from context
func respondErrorWithRequestID(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	requestID := logger.FromContext(r.Context())
	respondErrorWithCode(w, status, code, message, requestID)
}
