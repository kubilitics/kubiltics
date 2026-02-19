package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/mux"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/cors"

	grpcapi "github.com/kubilitics/kubilitics-backend/internal/api/grpc"
	"github.com/kubilitics/kubilitics-backend/internal/api/middleware"
	"github.com/kubilitics/kubilitics-backend/internal/api/rest"
	"github.com/kubilitics/kubilitics-backend/internal/api/websocket"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/topologycache"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/tracing"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	"github.com/kubilitics/kubilitics-backend/internal/service"
	"github.com/kubilitics/kubilitics-backend/internal/topology"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		// Use defaults and create logger with defaults
		cfg = &config.Config{
			Port:           819,
			DatabasePath:   "./kubilitics.db",
			LogLevel:       "info",
			LogFormat:      "json",
			AllowedOrigins: []string{
			"tauri://localhost",     // Tauri v2 WebView (desktop app)
			"tauri://",             // Tauri origin without host
			"http://localhost:5173", // Vite dev server
			"http://localhost:819",  // Backend self-origin
		},
		}
	}
	if cfg.LogFormat == "" {
		cfg.LogFormat = "json"
	}
	if cfg.LogLevel == "" {
		cfg.LogLevel = "info"
	}

	// BE-OBS-002: Initialize structured logger
	log := logger.StdLogger(cfg.LogFormat, cfg.LogLevel)
	log.Info("Kubilitics Backend starting", "port", cfg.Port, "db", cfg.DatabasePath, "log_format", cfg.LogFormat, "log_level", cfg.LogLevel)

	defer func() {
		if r := recover(); r != nil {
			log.Error("Critical crash", "error", r)
			os.Exit(1)
		}
	}()

	if err != nil {
		log.Warn("Failed to load config, using defaults", "error", err)
	}

	// BE-OBS-001: Initialize OpenTelemetry tracing
	var tracingCleanup func()
	if cfg.TracingEnabled && cfg.TracingEndpoint != "" {
		serviceName := cfg.TracingServiceName
		if serviceName == "" {
			serviceName = "kubilitics-backend"
		}
		samplingRate := cfg.TracingSamplingRate
		if samplingRate <= 0 {
			samplingRate = 1.0
		}
		cleanup, err := tracing.Init(serviceName, cfg.TracingEndpoint, samplingRate)
		if err != nil {
			log.Warn("Failed to initialize tracing", "error", err, "endpoint", cfg.TracingEndpoint)
		} else {
			tracingCleanup = cleanup
			log.Info("Tracing initialized", "endpoint", cfg.TracingEndpoint, "service", serviceName, "sampling_rate", samplingRate)
		}
	} else {
		tracingCleanup = func() {}
		log.Debug("Tracing disabled", "enabled", cfg.TracingEnabled, "endpoint", cfg.TracingEndpoint)
	}
	defer tracingCleanup()

	// Initialize database
	log.Info("Initializing database", "path", cfg.DatabasePath)
	repo, err := repository.NewSQLiteRepository(cfg.DatabasePath)
	if err != nil {
		log.Error("Failed to initialize database", "error", err)
		os.Exit(1)
	}
	defer repo.Close()

	// Run migrations (001..020)
	log.Info("Running database migrations")
	for _, name := range []string{"001_initial_schema.sql", "002_add_cluster_provider.sql", "003_projects.sql", "004_simplify_project_clusters.sql", "005_auth.sql", "006_auth_security.sql", "007_rbac.sql", "008_api_keys.sql", "009_audit_log.sql", "010_user_soft_delete.sql", "011_token_blacklist.sql", "012_sessions.sql", "013_namespace_permissions.sql", "014_audit_log_enhancements.sql", "015_password_history.sql", "016_password_reset_tokens.sql", "017_saml_sessions.sql", "018_mfa_totp.sql", "019_groups.sql", "020_security_events.sql"} {
		migrationSQL, err := os.ReadFile(filepath.Join("migrations", name))
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			log.Warn("Could not read migration", "migration", name, "error", err)
			continue
		}
		if err := repo.RunMigrations(string(migrationSQL)); err != nil {
			log.Warn("Failed to run migration", "migration", name, "error", err)
		} else {
			log.Debug("Migration completed", "migration", name)
		}
	}

	// Initialize services (cluster repo for persistence)
	log.Info("Initializing services")
	clusterService := service.NewClusterService(repo, cfg)
	if err := clusterService.LoadClustersFromRepo(ctx); err != nil {
		log.Warn("Failed to load clusters from repo", "error", err)
	}
	// Auto-load clusters from default kubeconfig when DB is empty (Docker Desktop, kind, etc.)
	if cfg.KubeconfigAutoLoad {
		list, _ := clusterService.ListClusters(ctx)
		if len(list) == 0 {
			kubeconfigPath := cfg.KubeconfigPath
			if kubeconfigPath == "" {
				kubeconfigPath = os.Getenv("KUBECONFIG")
			}
			if kubeconfigPath == "" {
				if home, _ := os.UserHomeDir(); home != "" {
					kubeconfigPath = filepath.Join(home, ".kube", "config")
				}
			}
			if kubeconfigPath != "" {
				contexts, _, err := k8s.GetKubeconfigContexts(kubeconfigPath)
				if err != nil {
					log.Warn("Could not list kubeconfig contexts", "kubeconfig", kubeconfigPath, "error", err)
				} else {
					for _, contextName := range contexts {
						_, err := clusterService.AddCluster(ctx, kubeconfigPath, contextName)
						if err != nil {
							log.Warn("Could not add cluster", "context", contextName, "error", err)
						} else {
							log.Info("Auto-added cluster context", "context", contextName)
						}
					}
				}
			}
		}
	}
	// Log registered clusters so operators see what is available; all resource APIs use these clusters.
	list, _ := clusterService.ListClusters(ctx)
	if len(list) > 0 {
		names := make([]string, 0, len(list))
		for _, c := range list {
			ctxName := c.Context
			if ctxName == "" {
				ctxName = c.Name
			}
			if ctxName == "" {
				ctxName = c.ID
			}
			names = append(names, ctxName)
		}
		log.Info("Registered clusters", "count", len(list), "clusters", strings.Join(names, ", "))
	} else {
		log.Info("No clusters registered yet", "hint", "add via Connect (POST /api/v1/clusters) or ensure kubeconfig_auto_load and default kubeconfig are set")
	}
	var topologyCache *topologycache.Cache
	if cfg != nil && cfg.TopologyCacheTTLSec > 0 {
		topologyCache = topologycache.New(time.Duration(cfg.TopologyCacheTTLSec) * time.Second)
	} else {
		topologyCache = topologycache.New(0)
	}
	topologyService := service.NewTopologyService(clusterService, topologyCache)
	logsService := service.NewLogsService(clusterService)
	eventsService := service.NewEventsService(clusterService)
	metricsService := service.NewMetricsService(clusterService)
	unifiedMetricsService := service.NewUnifiedMetricsService(
		clusterService,
		metrics.NewMetricsServerProvider(),
		metrics.NewControllerMetricsResolver(),
		metrics.NewInMemoryMetricsCache(30*time.Second),
	)
	_ = service.NewExportService(topologyService)

	log.Info("Services initialized")

	// Start cleanup service for token expiry
	cleanupService := service.NewCleanupService(repo, cfg, log)
	cleanupService.Start(ctx)
	defer cleanupService.Stop()
	log.Info("Cleanup service started")

	// Initialize WebSocket hub (C1.3: topology cache invalidation on resource events)
	log.Info("Initializing WebSocket hub")
	wsHub := websocket.NewHub(ctx)
	wsHub.SetTopologyInvalidator(topologyCache.InvalidateForClusterNamespace)
	go wsHub.Run()
	log.Info("WebSocket hub started")

	// Note: Kubernetes informer setup would be done when a cluster is added
	// For now, we'll initialize it when needed

	// Setup HTTP router
	log.Debug("Resource topology supported", "kinds", topology.ResourceTopologyKinds)
	// Fail fast if Node is missing (e.g. old binary); prevents 500 on Node detail topology.
	hasNode := false
	for _, k := range topology.ResourceTopologyKinds {
		if k == "Node" {
			hasNode = true
			break
		}
	}
	if !hasNode {
		log.Error("topology: Node must be in ResourceTopologyKinds; rebuild backend from current source (make clean && make backend)")
		os.Exit(1)
	}
	projectService := service.NewProjectService(repo, repo)
	// Bootstrap admin user when auth is enabled and no users exist (BE-AUTH-001)
	if cfg.AuthMode != "" && cfg.AuthMode != "disabled" && cfg.AuthJWTSecret != "" && cfg.AuthAdminUser != "" && cfg.AuthAdminPass != "" {
		n, _ := repo.CountUsers(ctx)
		if n == 0 {
			hash, err := auth.HashPassword(cfg.AuthAdminPass)
			if err != nil {
				log.Warn("Failed to hash admin password", "error", err)
			} else {
				admin := &models.User{Username: cfg.AuthAdminUser, PasswordHash: hash, Role: "admin"}
				if err := repo.CreateUser(ctx, admin); err != nil {
					log.Warn("Failed to create admin user", "error", err)
				} else {
					log.Info("Created bootstrap admin user", "username", cfg.AuthAdminUser)
				}
			}
		}
	}
	router := mux.NewRouter()
	handler := rest.NewHandler(clusterService, topologyService, cfg, logsService, eventsService, metricsService, unifiedMetricsService, projectService, repo)
	authHandler := rest.NewAuthHandler(repo, cfg)
	
	// OIDC handler (Phase 2: Enterprise Authentication)
	oidcHandler, err := rest.NewOIDCHandler(cfg, repo)
	if err != nil {
		log.Warn("Failed to initialize OIDC handler", "error", err)
	}
	
	// SAML handler (Phase 2: Enterprise Authentication)
	samlHandler, err := rest.NewSAMLHandler(cfg, repo)
	if err != nil {
		log.Warn("Failed to initialize SAML handler", "error", err)
	}

	// Groups handler (Phase 5: Group/Team Management)
	groupsHandler := rest.NewGroupsHandler(repo, cfg)

	// Security handler (Phase 5: Security Event Detection)
	securityHandler := rest.NewSecurityHandler(repo, cfg)

	// Compliance handler (Phase 5: Compliance Reporting)
	complianceHandler := rest.NewComplianceHandler(repo, cfg)

	// Deployment rollout routes on main router (full path) so they always match regardless of subrouter path handling
	router.HandleFunc("/api/v1/clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollout-history", handler.GetDeploymentRolloutHistory).Methods("GET")
	router.HandleFunc("/api/v1/clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollback", handler.PostDeploymentRollback).Methods("POST")
	router.HandleFunc("/api/v1/clusters/{clusterId}/shell/stream", handler.GetShellStream).Methods("GET")

	// actualPort is set after we bind; health handler includes it for discovery (e.g. desktop)
	var actualPort int

	// Health check endpoints
	healthzHandler := rest.NewHealthzHandler(repo)
	
	// Liveness probe: /healthz/live - process is alive (no dependency checks)
	router.HandleFunc("/healthz/live", healthzHandler.Live).Methods("GET")
	
	// Readiness probe: /healthz/ready - dependencies are healthy (database connectivity)
	router.HandleFunc("/healthz/ready", healthzHandler.Ready).Methods("GET")
	
	// Legacy health endpoint (backward compatibility); delegates to readiness
	router.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		body := map[string]interface{}{
			"status":         "healthy",
			"service":        "kubilitics-backend",
			"version":        "1.0.0",
			"topology_kinds": topology.ResourceTopologyKinds,
		}
		if actualPort != 0 {
			body["port"] = actualPort
		}
		_ = json.NewEncoder(w).Encode(body)
	}).Methods("GET")

	// Prometheus metrics (enterprise observability)
	router.Handle("/metrics", promhttp.Handler()).Methods("GET")

	// API routes
	apiRouter := router.PathPrefix("/api/v1").Subrouter()
	authHandler.RegisterRoutes(apiRouter)
	if oidcHandler != nil {
		oidcHandler.RegisterRoutes(apiRouter)
	}
	if samlHandler != nil {
		samlHandler.RegisterRoutes(apiRouter)
	}
	groupsHandler.RegisterRoutes(apiRouter)
	securityHandler.RegisterRoutes(apiRouter)
	complianceHandler.RegisterRoutes(apiRouter)
	rest.SetupRoutes(apiRouter, handler)

	// WebSocket routes
	wsHandler := websocket.NewHandler(ctx, wsHub, nil, cfg, repo) // informerMgr will be set per cluster
	router.HandleFunc("/ws/resources", wsHandler.ServeWS).Methods("GET")

	// Main router 404: return JSON so frontend never sees Go default "404 page not found"
	router.NotFoundHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Not found"})
	})

	// Enterprise middleware: tracing (BE-OBS-001), body limit (BE-DATA-001), secure headers (D1.2), request ID, rate limit (BE-FUNC-003), auth (BE-AUTH-001), structured log, audit (BE-SEC-002), recovery
	// Tracing must be early to propagate trace context
	if cfg.TracingEnabled {
		router.Use(middleware.Tracing)
	}
	router.Use(middleware.MaxBodySize(middleware.DefaultStandardMaxBodyBytes, middleware.DefaultApplyMaxBodyBytes))
	router.Use(middleware.CORSValidation(cfg, log)) // Validate CORS config
	router.Use(middleware.SecureHeaders(cfg))
	router.Use(middleware.RequestID)
	router.Use(middleware.RateLimit())
	router.Use(middleware.MetricsAuth(cfg, repo)) // Protect /metrics if enabled
	router.Use(middleware.Auth(cfg, repo))
	router.Use(middleware.StructuredLog)
	router.Use(middleware.AuditLog(repo))
	router.Use(recoveryMiddleware(log))

	// Rollout path-intercept: handle rollout-history and rollback before the router so they never 404
	routerWrapped := rolloutPathInterceptor(handler, router)

	// Setup CORS
	c := cors.New(cors.Options{
		AllowedOrigins:   cfg.AllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{
			"Content-Type", "Authorization", "X-Request-ID",
			"X-Confirm-Destructive", "X-API-Key",
			"X-Kubeconfig",         // Desktop: kubeconfig sent per-request (Headlamp/Lens model)
			"X-Kubeconfig-Context", // Desktop: active context name
		},
		ExposedHeaders:   []string{"X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"},
		AllowCredentials: true,
	})
	handlerWithCORS := c.Handler(routerWrapped)

	readTimeout := 15 * time.Second
	writeTimeout := 15 * time.Second
	if cfg.RequestTimeoutSec > 0 {
		readTimeout = time.Duration(cfg.RequestTimeoutSec) * time.Second
		writeTimeout = time.Duration(cfg.RequestTimeoutSec) * time.Second
	}
	shutdownTimeout := 10 * time.Second
	if cfg.ShutdownTimeoutSec > 0 {
		shutdownTimeout = time.Duration(cfg.ShutdownTimeoutSec) * time.Second
	}

	// Bind strictly to configured port (default 819) on all interfaces
	// Phase 2: Enforce Proper Port Strategy - No port hunting, no random ports.
	addr := fmt.Sprintf("0.0.0.0:%d", cfg.Port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Error("Failed to listen", "address", addr, "error", err)
		os.Exit(1)
	}
	actualPort = cfg.Port
	defer listener.Close()

	srv := &http.Server{
		Handler:      handlerWithCORS,
		ReadTimeout:  readTimeout,
		WriteTimeout: writeTimeout,
		IdleTimeout:  60 * time.Second,
	}

	// BE-TLS-001: TLS Support
	protocol := "http"
	wsProtocol := "ws"
	if cfg.TLSEnabled {
		if cfg.TLSCertPath == "" || cfg.TLSKeyPath == "" {
			log.Error("TLS enabled but certificate or key path not configured", "hint", "Set KUBILITICS_TLS_CERT_PATH and KUBILITICS_TLS_KEY_PATH")
			os.Exit(1)
		}
		// Verify cert and key files exist
		if _, err := os.Stat(cfg.TLSCertPath); os.IsNotExist(err) {
			log.Error("TLS certificate file not found", "path", cfg.TLSCertPath)
			os.Exit(1)
		}
		if _, err := os.Stat(cfg.TLSKeyPath); os.IsNotExist(err) {
			log.Error("TLS key file not found", "path", cfg.TLSKeyPath)
			os.Exit(1)
		}
		protocol = "https"
		wsProtocol = "wss"
	} else {
		log.Warn("TLS is disabled", "hint", "not recommended for production")
	}

	// Start gRPC server for kubilitics-ai integration
	var grpcServer *grpcapi.Server
	if cfg.GRPCPort > 0 {
		grpcServer = grpcapi.NewServer(cfg, clusterService, topologyService, metricsService, log)
		if err := grpcServer.Start(ctx); err != nil {
			log.Error("Failed to start gRPC server", "error", err, "port", cfg.GRPCPort)
		} else {
			log.Info("gRPC server started", "port", cfg.GRPCPort)
		}
		defer func() {
			if grpcServer != nil {
				grpcServer.Stop()
			}
		}()
	}

	// Start HTTP server in goroutine
	go func() {
		log.Info("Server starting",
			"protocol", protocol,
			"address", fmt.Sprintf("0.0.0.0:%d", actualPort),
			"api", fmt.Sprintf("%s://localhost:%d/api/v1", protocol, actualPort),
			"websocket", fmt.Sprintf("%s://localhost:%d/ws/resources", wsProtocol, actualPort),
			"health", fmt.Sprintf("%s://localhost:%d/health", protocol, actualPort),
			"metrics", fmt.Sprintf("%s://localhost:%d/metrics", protocol, actualPort),
		)
		if cfg.TLSEnabled {
			log.Info("TLS enabled", "cert", cfg.TLSCertPath, "key", cfg.TLSKeyPath)
		}

		var err error
		if cfg.TLSEnabled {
			err = srv.ServeTLS(listener, cfg.TLSCertPath, cfg.TLSKeyPath)
		} else {
			err = srv.Serve(listener)
		}
		if err != nil && err != http.ErrServerClosed {
			log.Error("Server failed", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info("Shutting down server")

	// Stop WebSocket hub
	wsHub.Stop()
	log.Info("WebSocket hub stopped")

	// Graceful shutdown: drain in-flight requests
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Warn("Server forced to shutdown", "error", err)
	}

	log.Info("Server exited gracefully")
}

func recoveryMiddleware(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if err := recover(); err != nil {
					log.Error("Panic recovered", "error", err, "path", r.URL.Path, "method", r.Method)
					http.Error(w, "Internal server error", http.StatusInternalServerError)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// rolloutPathInterceptor handles GET .../rollout-history and POST .../rollback before the router so they never 404.
// Path: /api/v1/clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollout-history or /rollback
func rolloutPathInterceptor(restHandler *rest.Handler, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if strings.Contains(path, "shell/stream") {
			// Logged via StructuredLog middleware
		}
		if path == "" {
			path = "/"
		}
		segs := strings.Split(strings.Trim(path, "/"), "/")
		if len(segs) >= 9 && segs[0] == "api" && segs[1] == "v1" && segs[2] == "clusters" && segs[4] == "resources" && segs[5] == "deployments" {
			clusterID := segs[3]
			namespace := segs[6]
			name := segs[7]
			suffix := segs[8]
			if suffix == "rollout-history" && r.Method == http.MethodGet {
				r = rest.SetPathVars(r, map[string]string{"clusterId": clusterID, "namespace": namespace, "name": name})
				restHandler.GetDeploymentRolloutHistory(w, r)
				return
			}
			if suffix == "rollback" && r.Method == http.MethodPost {
				r = rest.SetPathVars(r, map[string]string{"clusterId": clusterID, "namespace": namespace, "name": name})
				restHandler.PostDeploymentRollback(w, r)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
