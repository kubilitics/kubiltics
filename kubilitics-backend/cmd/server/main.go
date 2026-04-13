package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/mux"
	"github.com/jmoiron/sqlx"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/cors"

	grpcapi "github.com/kubilitics/kubilitics-backend/internal/api/grpc"
	"github.com/kubilitics/kubilitics-backend/internal/api/middleware"
	"github.com/kubilitics/kubilitics-backend/internal/api/rest"
	"github.com/kubilitics/kubilitics-backend/internal/autopilot"
	"github.com/kubilitics/kubilitics-backend/internal/api/websocket"
	"github.com/kubilitics/kubilitics-backend/internal/addon/notifications"
	"github.com/kubilitics/kubilitics-backend/internal/addon/helm"
	"github.com/kubilitics/kubilitics-backend/internal/addon/lifecycle"
	"github.com/kubilitics/kubilitics-backend/internal/addon/registry"
	"github.com/kubilitics/kubilitics-backend/internal/addon/resolver"
	"github.com/kubilitics/kubilitics-backend/internal/addon/scanner"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/events"
	"github.com/kubilitics/kubilitics-backend/internal/otel"
	"github.com/kubilitics/kubilitics-backend/internal/graph"
	"github.com/kubilitics/kubilitics-backend/internal/intelligence/diff"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/metrics"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/topologycache"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/tracing"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	"github.com/kubilitics/kubilitics-backend/internal/service"
	"github.com/kubilitics/kubilitics-backend/internal/topology"
	"github.com/kubilitics/kubilitics-backend/internal/version"
	dbmigrations "github.com/kubilitics/kubilitics-backend/migrations"
)

// enrichPath ensures exec-based kubeconfig credential plugins (aws, gcloud,
// az, oci, doctl, etc.) are discoverable regardless of how the process was
// launched. macOS/Linux GUI apps (Tauri, Electron) inherit a minimal PATH
// (/usr/bin:/bin) that excludes Homebrew, user-installed CLIs, and cloud SDKs.
//
// Strategy (defense-in-depth — if one method fails, the next covers it):
//  1. Append well-known tool directories for all platforms.
//  2. On macOS/Linux, read the user's actual login shell PATH.
//  3. Try the user's preferred shell ($SHELL), fall back to bash then zsh.
//  4. Validate: after enrichment, verify critical tools are findable and log.
func enrichPath() {
	sep := ":"
	if runtime.GOOS == "windows" {
		sep = ";"
	}

	current := os.Getenv("PATH")
	seen := make(map[string]bool)
	for _, p := range strings.Split(current, sep) {
		seen[p] = true
	}

	addPath := func(p string) {
		if p == "" || seen[p] {
			return
		}
		seen[p] = true
		current = current + sep + p
	}

	// ── 1. Well-known directories ──────────────────────────────────────
	wellKnown := []string{
		"/usr/local/bin",
		"/usr/local/sbin",
		"/opt/homebrew/bin",       // macOS ARM Homebrew
		"/opt/homebrew/sbin",
		"/snap/bin",               // Ubuntu snap packages
		"/home/linuxbrew/.linuxbrew/bin", // Linux Homebrew
	}

	home, _ := os.UserHomeDir()
	if home != "" {
		wellKnown = append(wellKnown,
			filepath.Join(home, ".local", "bin"),             // pip, pipx, etc.
			filepath.Join(home, "bin"),                       // user binaries
			filepath.Join(home, ".rd", "bin"),                // Rancher Desktop
			filepath.Join(home, "google-cloud-sdk", "bin"),   // gcloud SDK
			filepath.Join(home, ".google-cloud-sdk", "bin"),  // alternate gcloud
			filepath.Join(home, "Library", "Python", "3.11", "bin"), // macOS Python
			filepath.Join(home, "Library", "Python", "3.12", "bin"),
			filepath.Join(home, ".cargo", "bin"),             // Rust tools
			filepath.Join(home, "go", "bin"),                 // Go binaries
			filepath.Join(home, ".nix-profile", "bin"),       // Nix
			filepath.Join(home, ".asdf", "shims"),            // asdf version manager
			filepath.Join(home, ".volta", "bin"),             // Volta (Node)
		)
	}

	// AWS CLI v2 (macOS install location)
	if runtime.GOOS == "darwin" {
		wellKnown = append(wellKnown, "/usr/local/aws-cli/v2/current/bin")
	}

	for _, p := range wellKnown {
		addPath(p)
	}

	// ── 2. Read user's login shell PATH ────────────────────────────────
	// This is the most reliable method — gets the exact PATH the user has
	// in their terminal, including any modifications from .bashrc, .zshrc,
	// .profile, pyenv, nvm, conda, etc.
	if runtime.GOOS == "darwin" || runtime.GOOS == "linux" {
		shellPATH := readShellPATH()
		if shellPATH != "" {
			for _, p := range strings.Split(shellPATH, ":") {
				addPath(p)
			}
		}
	}

	os.Setenv("PATH", current)
}

// readShellPATH attempts to read the user's full login shell PATH.
// Tries the user's configured $SHELL first, falls back to bash then zsh.
// Returns empty string on failure (non-fatal — well-known paths cover most cases).
func readShellPATH() string {
	shells := []string{}

	// Prefer user's configured shell
	if userShell := os.Getenv("SHELL"); userShell != "" {
		shells = append(shells, userShell)
	}

	// Fallbacks — try both in case one is missing
	shells = append(shells, "/bin/zsh", "/bin/bash")

	for _, shell := range shells {
		// Use -l (login) to source profile files, -i avoided (interactive mode
		// may hang), -c to execute and exit immediately. Timeout prevents hangs.
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		cmd := exec.CommandContext(ctx, shell, "-l", "-c", "echo $PATH")
		cmd.Env = append(os.Environ(), "PS1=") // suppress prompt in case shell sources .bashrc
		out, err := cmd.Output()
		cancel()

		if err == nil {
			result := strings.TrimSpace(string(out))
			if result != "" && strings.Contains(result, "/") {
				return result
			}
		}
	}
	return ""
}

func main() {
	// Enrich PATH for macOS GUI apps (Tauri sidecar).
	// macOS GUI apps don't inherit the user's shell PATH, so exec-based
	// credential plugins (aws, gcloud, azure) are not found.
	// Append common tool locations so client-go's exec provider works.
	enrichPath()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		// Use defaults and create logger with defaults
		cfg = &config.Config{
			Port:           8190,
			DatabasePath:   "./kubilitics.db",
			LogLevel:       "info",
			LogFormat:      "json",
			AllowedOrigins: []string{
			"tauri://localhost",     // Tauri v2 WebView (desktop app)
			"tauri://",             // Tauri origin without host
			"http://localhost:5173", // Vite dev server
			"http://localhost:8190",  // Backend self-origin
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
	log.Info("CORS allowed_origins", "origins", cfg.AllowedOrigins)

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
	defer func() { _ = repo.Close() }()

	// Run migrations from embedded FS in lexicographic order.
	// Using ReadDir instead of a hardcoded list so newly added migration files
	// are picked up automatically without touching this file.
	log.Info("Running database migrations")
	migrationEntries, err := dbmigrations.FS.ReadDir(".")
	if err != nil {
		log.Error("Failed to read embedded migrations directory", "error", err)
		os.Exit(1)
	}
	for _, entry := range migrationEntries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		migrationSQL, err := dbmigrations.FS.ReadFile(name)
		if err != nil {
			log.Warn("Could not read embedded migration", "migration", name, "error", err)
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

	// Initialize blast radius graph engines (non-blocking — runs in background after server starts).
	// Engines are started lazily: we verify API server connectivity before spinning up informers
	// to avoid flooding the process with retry loops for unreachable clusters.
	graphEngines := make(map[string]*graph.ClusterGraphEngine)
	go func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
		clusters, listErr := clusterService.ListClusters(ctx)
		if listErr != nil {
			log.Warn("Failed to list clusters for graph engines", "error", listErr)
			return
		}
		for _, cluster := range clusters {
			client, clientErr := clusterService.GetClient(cluster.ID)
			if clientErr != nil {
				log.Warn("Skipping graph engine — cannot get client", "cluster", cluster.ID, "error", clientErr)
				continue
			}
			// Quick connectivity check — skip clusters with unreachable API servers
			// Quick connectivity check: try to reach the API server
			type result struct {
				err error
			}
			ch := make(chan result, 1)
			go func() {
				_, e := client.Clientset.Discovery().ServerVersion()
				ch <- result{err: e}
			}()
			var err error
			select {
			case r := <-ch:
				err = r.err
			case <-time.After(5 * time.Second):
				err = fmt.Errorf("timeout connecting to API server")
			}
			if err != nil {
				log.Warn("Skipping graph engine — API server unreachable", "cluster", cluster.ID, "error", err)
				continue
			}
			engine := graph.NewClusterGraphEngine(cluster.ID, client.Clientset, log)
			// Gap 2 fix: actively invalidate BOTH V1 and V2 topology caches
			// when informers detect K8s resource changes. Without this, the
			// topology shows stale data for up to 30s (the TTL).
			engine.SetOnRebuild(func(cid string) {
				rest.TopologyCacheInvalidateForCluster(cid) // V2 handler cache (sync.Map)
				topologyCache.InvalidateForCluster(cid)     // V1 service cache (topologycache.Cache)
			})
			engine.Start(ctx)
			graphEngines[cluster.ID] = engine
			log.Info("Started blast radius graph engine", "cluster", cluster.ID)
		}
	}()

	logsService := service.NewLogsService(clusterService)
	eventsService := service.NewEventsServiceWithRepo(clusterService, repo)
	metricsService := service.NewMetricsService(clusterService)
	metricsProvider := metrics.NewMetricsServerProvider()
	unifiedMetricsService := service.NewUnifiedMetricsService(
		clusterService,
		metricsProvider,
		metrics.NewControllerMetricsResolver(),
		metrics.NewInMemoryMetricsCache(10*time.Second),
		repo,
	)
	_ = service.NewExportService(topologyService)
	unifiedMetricsService.StartCollector(ctx, 15*time.Second)

	// Start persistent metrics collector (stores ALL pod metrics to SQLite every 30s)
	metricsCollector := service.NewMetricsCollector(clusterService, metricsProvider, repo)
	metricsCollector.Start(ctx)

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

	// Validate AuthJWTSecret when auth is required: reject startup if secret is empty or too short.
	// This prevents a state where auth is "required" but tokens cannot be generated/validated.
	if strings.EqualFold(cfg.AuthMode, "required") {
		if cfg.AuthJWTSecret == "" {
			log.Error("FATAL: auth_mode is 'required' but auth_jwt_secret is empty — tokens cannot be generated; set KUBILITICS_AUTH_JWT_SECRET")
			os.Exit(1)
		}
		if len(cfg.AuthJWTSecret) < 32 {
			log.Error("FATAL: auth_jwt_secret is too short (must be >= 32 characters for security); set a stronger KUBILITICS_AUTH_JWT_SECRET")
			os.Exit(1)
		}
	}

	// Bootstrap admin user when auth is enabled and no users exist (BE-AUTH-001)
	if cfg.AuthMode != "" && cfg.AuthMode != "disabled" && cfg.AuthJWTSecret != "" && cfg.AuthAdminUser != "" && cfg.AuthAdminPass != "" {
		n, err := repo.CountUsers(ctx)
		if err != nil {
			log.Error("failed to count users during admin bootstrap — cannot determine if admin user exists", "error", err)
			os.Exit(1)
		}
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
	// Add-on service and LMC (Part 4)
	var addonSvc service.AddOnService
	var lmc *lifecycle.LifecycleController
	reg := registry.NewRegistry(repo, log)
	if err := reg.SeedOnStartup(ctx); err != nil {
		log.Warn("Add-on catalog seed failed", "error", err)
	} else {
		if err := repo.SeedBuiltinProfiles(ctx); err != nil {
			log.Warn("Built-in profile seed failed", "error", err)
		}
		res := resolver.NewDependencyResolver(repo, log)
		helmFactory := func(clusterID string) (helm.HelmClient, error) {
			c, err := clusterService.GetCluster(context.Background(), clusterID)
			if err != nil {
				return nil, err
			}
			if c.KubeconfigPath == "" {
				return nil, fmt.Errorf("cluster has no kubeconfig path")
			}
			kube, err := os.ReadFile(c.KubeconfigPath)
			if err != nil {
				return nil, err
			}
			return helm.NewHelmClient(kube, "", log)
		}
		scan := scanner.NewClusterScanner(clusterService, repo, log)
		addonSvcImpl := service.NewAddOnServiceImpl(repo, reg, scan, res, helmFactory, nil, nil, clusterService, log)
		lmcHelmFactory := func(kubeconfig []byte, namespace string, logger *slog.Logger) (helm.HelmClient, error) {
			return helm.NewHelmClient(kubeconfig, namespace, logger)
		}
		lmc = lifecycle.NewLifecycleController(clusterService, repo, lmcHelmFactory, reg, log)
		addonSvcImpl.SetLMC(lmc)
		addonSvc = addonSvcImpl
		reg.StartArtifactHubSync(ctx)
		log.Info("Add-on service and LMC initialized")
	}
	router := mux.NewRouter()
	router.UseEncodedPath()
	var snapshotStore diff.SnapshotStore
	sqliteStore, err := diff.NewSQLiteSnapshotStore(repo.DB())
	if err != nil {
		log.Warn("Failed to initialize SQLite snapshot store, falling back to in-memory", "error", err)
		snapshotStore = diff.NewInMemorySnapshotStore()
	} else {
		snapshotStore = sqliteStore
	}
	handler := rest.NewHandler(clusterService, topologyService, cfg, logsService, eventsService, metricsService, unifiedMetricsService, projectService, addonSvc, repo, graphEngines, snapshotStore)
	authHandler := rest.NewAuthHandler(repo, cfg)

	// Auto-Pilot initialization
	apRegistry := autopilot.NewRuleRegistry()
	apRepo := autopilot.NewMemRepository()
	apScheduler := autopilot.NewScheduler(apRegistry, nil, nil, nil, apRepo, graphEngines, 0)
	rest.InitAutoPilot(apScheduler, apRepo, apRegistry)
	
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

	// Scanner handler (DevSecOps scanning engine)
	scannerSvc := service.NewScannerService(repo, log)
	scannerHandler := rest.NewScannerHandler(scannerSvc)

	// Deployment rollout routes on main router (full path) so they always match regardless of subrouter path handling
	router.HandleFunc("/api/v1/clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollout-history", handler.GetDeploymentRolloutHistory).Methods("GET")
	router.HandleFunc("/api/v1/clusters/{clusterId}/resources/deployments/{namespace}/{name}/rollback", handler.PostDeploymentRollback).Methods("POST")
	router.HandleFunc("/api/v1/clusters/{clusterId}/shell/stream", handler.GetShellStream).Methods("GET")

	// actualPort is set after we bind; health handler includes it for discovery (e.g. desktop)
	var actualPort int

	// Health check endpoints
	healthzHandler := rest.NewHealthzHandler(repo)
	
	// Bare /healthz — delegates to liveness probe. The frontend health-check poller
	// previously called /healthz (not /healthz/live) and got 404 on every poll, which
	// caused the "Backend unreachable" banner to appear permanently. Register this
	// as defense-in-depth so any client calling /healthz gets a valid response.
	router.HandleFunc("/healthz", healthzHandler.Live).Methods("GET", "HEAD")

	// Liveness probe: /healthz/live - process is alive (no dependency checks)
	router.HandleFunc("/healthz/live", healthzHandler.Live).Methods("GET", "HEAD")

	// Readiness probe: /healthz/ready - dependencies are healthy (database connectivity)
	router.HandleFunc("/healthz/ready", healthzHandler.Ready).Methods("GET", "HEAD")
	
	// Legacy health endpoint (backward compatibility); delegates to readiness
	router.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		body := map[string]interface{}{
			"status":         "healthy",
			"service":        "kubilitics-backend",
			"version":        version.Version,
			"topology_kinds": topology.ResourceTopologyKinds,
		}
		if actualPort != 0 {
			body["port"] = actualPort
		}
		_ = json.NewEncoder(w).Encode(body)
	}).Methods("GET", "HEAD")

	// Prometheus metrics (enterprise observability)
	router.Handle("/metrics", promhttp.Handler()).Methods("GET")

	// API routes
	apiRouter := router.PathPrefix("/api/v1").Subrouter()
	// UseEncodedPath must be set on the subrouter too — it is NOT inherited from the parent router.
	// Without this, Go's net/http decodes %2F → / before Gorilla Mux sees the path, so
	// addon IDs like "community%2Fjenkinsci%2Fjenkins" are split across multiple path segments
	// and {addonId} (pattern [^/]+) never matches. Handlers call url.PathUnescape() to decode.
	apiRouter.UseEncodedPath()
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
	scannerHandler.RegisterRoutes(apiRouter)
	// OTel trace ingestion (register BEFORE rest.SetupRoutes which sets NotFoundHandler)
	otelDB := sqlx.NewDb(repo.DB(), "sqlite3")
	otelStore := otel.NewStore(otelDB)
	otelReceiver := otel.NewReceiver(otelStore, "")
	otelHandler := otel.NewOTelHandler(otelReceiver, otelStore)
	otel.SetupOTelRoutes(apiRouter, otelHandler)
	otel.SetupOTLPStandardRoute(router, otelHandler) // Standard OTLP endpoint: POST /v1/traces

	// Start span pruning goroutine (7 day retention)
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				deleted, err := otelStore.PruneSpans(ctx, 7)
				if err != nil {
					log.Warn("Failed to prune old spans", "error", err)
				} else if deleted > 0 {
					log.Info("Pruned old spans", "deleted", deleted)
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	// Events Intelligence pipeline (register BEFORE rest.SetupRoutes which sets NotFoundHandler)
	eventsDB := sqlx.NewDb(repo.DB(), "sqlite3")
	// PipelineManager: one pipeline per cluster (fixes single-pipeline bug).
	pipelineManager := events.NewPipelineManager(eventsDB)
	// Wire real-time metrics into every pipeline's enrichment stage.
	pipelineManager.SetMetricsProvider(events.NewMetricsAdapter(
		func(ctx context.Context, clusterID, namespace, podName string) (string, string, error) {
			pm, err := metricsService.GetPodMetrics(ctx, clusterID, namespace, podName)
			if err != nil {
				return "", "", err
			}
			return pm.CPU, pm.Memory, nil
		},
		func(ctx context.Context, clusterID, nodeName string) (string, string, error) {
			nm, err := metricsService.GetNodeMetrics(ctx, clusterID, nodeName)
			if err != nil {
				return "", "", err
			}
			return nm.CPU, nm.Memory, nil
		},
	))
	// Wire insight alerts into the existing webhook/Slack notification system.
	addonNotifier := notifications.NewNotifier(repo.ListNotificationChannels, log)
	alertAdapter := events.NewAlertNotifierAdapter(addonNotifier.Notify)
	pipelineManager.SetAlertNotifier(alertAdapter)

	eventsHandler := events.NewEventsHandlerFromManager(pipelineManager)
	// Wire the shared ChainCache into the handler so GetInsightCausalChain can
	// short-circuit SQLite lookups for recently built causal chains.
	eventsHandler.SetChainCache(pipelineManager.GetSharedChainCache())
	// Register on main router with full /api/v1 prefix (not apiRouter subrouter)
	// because the main router's NotFoundHandler at line ~720 catches unmatched paths
	// before the subrouter gets a chance to match.
	events.SetupEventsRoutes(apiRouter, eventsHandler)

	// Wire events pipeline lifecycle into cluster add/remove/reconnect handlers.
	handler.SetLifecycleHook(pipelineManager)

	// Distributed tracing: Helm-based install model — no in-cluster puller needed.
	tracingHandler := rest.NewTracingHandler(clusterService)
	handler.SetTracingHandler(tracingHandler)

	rest.SetupRoutes(apiRouter, handler)

	// API 404 — set AFTER all routes (events-intelligence, otel, rest) are registered
	// so the NotFoundHandler doesn't shadow any routes.
	apiRouter.NotFoundHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Not found"})
	})

	// Start events pipelines for ALL connected clusters (not just the first one).
	go func() {
		time.Sleep(10 * time.Second) // wait for cluster connections to establish
		clusters, err := clusterService.ListClusters(ctx)
		if err != nil {
			log.Warn("Failed to list clusters for events pipeline", "error", err)
			return
		}
		// Set default OTel cluster ID for single-cluster desktop setups.
		if len(clusters) == 1 {
			otelReceiver.SetDefaultClusterID(clusters[0].ID)
			log.Info("Set OTel default cluster ID", "cluster", clusters[0].ID)
		}

		for _, cl := range clusters {
			client, clientErr := clusterService.GetClient(cl.ID)
			if clientErr != nil {
				log.Warn("Skipping events pipeline — cannot get client", "cluster", cl.Name, "id", cl.ID, "error", clientErr)
				continue
			}
			if err := pipelineManager.StartCluster(client.Clientset, cl.ID); err != nil {
				log.Warn("Failed to start events pipeline", "cluster", cl.Name, "id", cl.ID, "error", err)
				continue
			}
			log.Info("Started events pipeline", "cluster", cl.Name, "id", cl.ID)

			// Start log collector for this cluster.
			pipelineManager.StartLogCollector(logsService, client.Clientset, cl.ID)
			log.Info("Started log collector", "cluster", cl.Name, "id", cl.ID)
		}
	}()

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

	// Setup CORS.
	// rs/cors only validates http:// and https:// origins. Tauri WebView uses the custom
	// tauri:// scheme which rs/cors silently rejects. Use AllowOriginFunc so we can match
	// tauri:// and other custom-scheme origins ourselves while still using rs/cors for the
	// rest of the CORS handling (preflight, headers, credentials).
	allowedOriginsSet := make(map[string]struct{}, len(cfg.AllowedOrigins))
	for _, o := range cfg.AllowedOrigins {
		allowedOriginsSet[strings.ToLower(strings.TrimRight(o, "/"))] = struct{}{}
	}
	c := cors.New(cors.Options{
		// AllowOriginFunc overrides AllowedOrigins; we handle matching for ALL origins here.
		AllowOriginFunc: func(origin string) bool {
			normalized := strings.ToLower(strings.TrimRight(origin, "/"))
			_, ok := allowedOriginsSet[normalized]
			if !ok && origin != "" {
				// Log CORS rejections for debugging (only log once per origin to avoid spam)
				log.Debug("CORS request rejected", "origin", origin, "normalized", normalized, "allowed_origins", cfg.AllowedOrigins)
			}
			return ok
		},
		AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{
			"Content-Type", "Authorization", "X-Request-ID",
			"X-Confirm-Destructive", "X-API-Key",
			"X-Kubeconfig",         // Desktop: kubeconfig sent per-request (Headlamp/Lens model)
			"X-Kubeconfig-Context", // Desktop: active context name
		},
		ExposedHeaders:   []string{"X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"},
		AllowCredentials: true,
	})
	handlerWithCORS := middleware.Gzip(c.Handler(routerWrapped))

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

	// Bind to configured address and port. Default is 127.0.0.1 (loopback only)
	// for desktop security. In-cluster deployments set KUBILITICS_BIND_ADDRESS=0.0.0.0.
	bindAddr := cfg.BindAddress
	if bindAddr == "" {
		bindAddr = "127.0.0.1"
	}
	addr := fmt.Sprintf("%s:%d", bindAddr, cfg.Port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Error("Failed to listen", "address", addr, "error", err)
		os.Exit(1)
	}
	actualPort = cfg.Port
	defer func() { _ = listener.Close() }()

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

	// Start LMC after server is ready (Part 4)
	if lmc != nil {
		go func() {
			if err := lmc.Start(ctx); err != nil {
				log.Warn("LMC start failed", "error", err)
			}
		}()
	}
	// Start HTTP server in goroutine
	go func() {
		log.Info("Server starting",
			"version", version.Version,
			"protocol", protocol,
			"address", addr,
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

	// Stop port-forward background cleaner
	rest.StopPortForwardCleaner()
	log.Info("Port-forward cleaner stopped")

	// Stop LMC before draining HTTP (Part 4)
	if lmc != nil {
		lmc.Stop()
		log.Info("LMC stopped")
	}
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
