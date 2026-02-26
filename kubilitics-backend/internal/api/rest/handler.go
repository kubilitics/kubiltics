package rest

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"github.com/hashicorp/golang-lru/v2/expirable"

	"github.com/kubilitics/kubilitics-backend/internal/api/middleware"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/drawio"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	"github.com/kubilitics/kubilitics-backend/internal/service"
	"github.com/kubilitics/kubilitics-backend/internal/topology"
	"golang.org/x/time/rate"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

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
}

// NewHandler creates a new HTTP handler. unifiedMetricsService can be nil; then metrics summary uses legacy per-resource endpoints. projSvc can be nil; then project routes return 501. addonService can be nil; then addon routes return 404 or 501. repo can be nil if auth is disabled.
func NewHandler(cs service.ClusterService, ts service.TopologyService, cfg *config.Config, logsService service.LogsService, eventsService service.EventsService, metricsService service.MetricsService, unifiedMetricsService *service.UnifiedMetricsService, projSvc service.ProjectService, addonService service.AddOnService, repo *repository.SQLiteRepository) *Handler {
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
	}
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
	router.Handle("/clusters/{clusterId}/topology/resource/{kind}/{namespace}/{name}", h.wrapWithRBAC(h.GetResourceTopology, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/topology/export", h.wrapWithRBAC(h.ExportTopology, auth.RoleOperator)).Methods("POST")
	router.Handle("/clusters/{clusterId}/topology/export/drawio", h.wrapWithRBAC(h.GetTopologyExportDrawio, auth.RoleViewer)).Methods("GET")

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
	router.Handle("/clusters/{clusterId}/metrics", h.wrapWithRBAC(h.GetClusterMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/nodes/{nodeName}", h.wrapWithRBAC(h.GetNodeMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/deployment/{name}", h.wrapWithRBAC(h.GetDeploymentMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/replicaset/{name}", h.wrapWithRBAC(h.GetReplicaSetMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/statefulset/{name}", h.wrapWithRBAC(h.GetStatefulSetMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/daemonset/{name}", h.wrapWithRBAC(h.GetDaemonSetMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/job/{name}", h.wrapWithRBAC(h.GetJobMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/cronjob/{name}", h.wrapWithRBAC(h.GetCronJobMetrics, auth.RoleViewer)).Methods("GET")
	router.Handle("/clusters/{clusterId}/metrics/{namespace}/{pod}", h.wrapWithRBAC(h.GetPodMetrics, auth.RoleViewer)).Methods("GET")

	// Events routes
	router.Handle("/clusters/{clusterId}/events", h.wrapWithRBAC(h.GetEvents, auth.RoleViewer)).Methods("GET")

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

	// Download kubeconfig for a cluster - BE-AUTHZ-001: viewer can read kubeconfig
	router.Handle("/clusters/{clusterId}/kubeconfig", h.wrapWithRBAC(h.GetKubeconfig, auth.RoleViewer)).Methods("GET")

	// Health check
	router.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
	}).Methods("GET")

	// API 404: return JSON so frontend never sees Go default "404 page not found"
	router.NotFoundHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		respondError(w, http.StatusNotFound, "Not found")
	})
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
			// Get user's cluster permissions
			perms, _ := h.repo.ListClusterPermissionsByUser(r.Context(), claims.UserID)
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
			respondError(w, http.StatusBadRequest, fmt.Sprintf("Failed to add cluster: %v", err))
			return
		}

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
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

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
	nodeCount := info["node_count"].(int)
	namespaceCount := info["namespace_count"].(int)

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

	pods, _ := client.Clientset.CoreV1().Pods("").List(r.Context(), metav1.ListOptions{})
	deployments, _ := client.Clientset.AppsV1().Deployments("").List(r.Context(), metav1.ListOptions{})
	services, _ := client.Clientset.CoreV1().Services("").List(r.Context(), metav1.ListOptions{})

	podCount := len(pods.Items)
	deploymentCount := len(deployments.Items)
	serviceCount := len(services.Items)
	if projectNSSet != nil {
		podCount = 0
		for _, p := range pods.Items {
			if _, ok := projectNSSet[p.Namespace]; ok {
				podCount++
			}
		}
		deploymentCount = 0
		for _, d := range deployments.Items {
			if _, ok := projectNSSet[d.Namespace]; ok {
				deploymentCount++
			}
		}
		serviceCount = 0
		for _, s := range services.Items {
			if _, ok := projectNSSet[s.Namespace]; ok {
				serviceCount++
			}
		}
	}

	summary := &models.ClusterSummary{
		ID:              clusterID,
		Name:            clusterID,
		NodeCount:       nodeCount,
		NamespaceCount:  namespaceCount,
		PodCount:        podCount,
		DeploymentCount: deploymentCount,
		ServiceCount:    serviceCount,
		HealthStatus:    "healthy",
	}
	respondJSON(w, http.StatusOK, summary)
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

	respondJSON(w, http.StatusOK, topology)
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

	// getClientFromRequest returns client (from kubeconfig or stored cluster); use it for resource topology
	graph, err := h.topologyService.GetResourceTopologyWithClient(ctx, client, clusterID, kind, namespace, name)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			respondError(w, http.StatusServiceUnavailable, "Resource topology build timed out")
			return
		}
		if errors.Is(err, topology.ErrResourceNotFound) {
			respondError(w, http.StatusNotFound, "Resource not found")
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, graph)
}

// ExportTopology handles POST /clusters/{clusterId}/topology/export (BE-FUNC-001).
// Format via query param ?format=json|svg|drawio|png or JSON body {"format": "..."}. Default: json.
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

	// getClientFromRequest returns client (from kubeconfig or stored cluster); use it for export
	data, err := h.topologyService.ExportTopologyWithClient(r.Context(), client, clusterID, format)
	if err != nil {
		if errors.Is(err, service.ErrExportNotImplemented) {
			respondError(w, http.StatusBadRequest, "Unsupported format. Use format=json|svg|drawio|png")
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
	case "drawio":
		contentType = "application/xml"
		filename = "topology.drawio.xml"
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

// GetTopologyExportDrawio handles GET /clusters/{clusterId}/topology/export/drawio
// Returns { url, mermaid } for opening the topology in draw.io.
func (h *Handler) GetTopologyExportDrawio(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	format := r.URL.Query().Get("format")
	if format == "" {
		format = "mermaid"
	}
	if format != "mermaid" && format != "xml" {
		respondError(w, http.StatusBadRequest, "format must be mermaid or xml")
		return
	}

	topology, err := h.topologyService.GetTopologyWithClient(r.Context(), client, clusterID, models.TopologyFilters{}, 0, false)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	mermaid := drawio.TopologyGraphToMermaid(topology)
	drawioURL, err := drawio.GenerateDrawioURL(mermaid)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to generate draw.io URL: "+err.Error())
		return
	}

	resp := map[string]interface{}{
		"url": drawioURL,
	}
	if format == "mermaid" {
		resp["mermaid"] = mermaid
	}
	respondJSON(w, http.StatusOK, resp)
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
