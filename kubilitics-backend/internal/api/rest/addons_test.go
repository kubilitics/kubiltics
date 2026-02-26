package rest

// T6.10 — REST API handler tests for addon endpoints.
// Uses httptest.ResponseRecorder + direct router.ServeHTTP calls so that
// the auth.Claims injected into the request context survive all the way
// to the RBAC middleware (no HTTP round-trip that would strip the context).

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/addon/financial"
	"github.com/kubilitics/kubilitics-backend/internal/addon/helm"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
	"github.com/kubilitics/kubilitics-backend/internal/service"
	dbmigrations "github.com/kubilitics/kubilitics-backend/migrations"
)

// ──────────────────────────────────────────────────────────────────────────────
// Mock AddOnService
// ──────────────────────────────────────────────────────────────────────────────

type mockAddonService struct {
	browseCatalogErr error
	browseCatalogOut []models.AddOnEntry
	getAddOnErr      error
	getAddOnOut      *models.AddOnDetail
	planInstallErr   error
	planInstallOut   *models.InstallPlan
	executeErr       error
	executeOut       *models.AddOnInstall
	uninstallErr     error
}

func (m *mockAddonService) BrowseCatalog(_ context.Context, _, _ string, _ []string, _ string) ([]models.AddOnEntry, error) {
	return m.browseCatalogOut, m.browseCatalogErr
}
func (m *mockAddonService) ListCatalog(_ context.Context, _ string, _, _ int) ([]models.AddOnEntry, int, error) {
	if m.browseCatalogErr != nil {
		return nil, 0, m.browseCatalogErr
	}
	n := len(m.browseCatalogOut)
	return m.browseCatalogOut, n, nil
}
func (m *mockAddonService) GetAddOn(_ context.Context, _ string) (*models.AddOnDetail, error) {
	return m.getAddOnOut, m.getAddOnErr
}
func (m *mockAddonService) PlanInstall(_ context.Context, _, _, _ string) (*models.InstallPlan, error) {
	return m.planInstallOut, m.planInstallErr
}
func (m *mockAddonService) EstimateCost(_ context.Context, _ string, _ *models.InstallPlan) (*financial.PlanCostEstimate, error) {
	return &financial.PlanCostEstimate{}, nil
}
func (m *mockAddonService) RunPreflight(_ context.Context, _ string, _ *models.InstallPlan) (*models.PreflightReport, error) {
	return &models.PreflightReport{OverallStatus: models.PreflightGO}, nil
}
func (m *mockAddonService) DryRunInstall(_ context.Context, _ string, _ service.InstallRequest) (*helm.DryRunResult, error) {
	return &helm.DryRunResult{}, nil
}
func (m *mockAddonService) ExecuteInstall(_ context.Context, _ string, _ service.InstallRequest, _ chan<- service.InstallProgressEvent) (*models.AddOnInstall, error) {
	return m.executeOut, m.executeErr
}
func (m *mockAddonService) ExecuteUpgrade(_ context.Context, _, _ string, _ service.UpgradeRequest, _ chan<- service.InstallProgressEvent) error {
	return nil
}
func (m *mockAddonService) ExecuteRollback(_ context.Context, _, _ string, _ int) error { return nil }
func (m *mockAddonService) ExecuteUninstall(_ context.Context, _, _ string, _ bool) error {
	return m.uninstallErr
}
func (m *mockAddonService) ListClusterAddOns(_ context.Context, _ string) ([]models.AddOnInstallWithHealth, error) {
	return nil, nil
}
func (m *mockAddonService) GetInstall(_ context.Context, _ string) (*models.AddOnInstallWithHealth, error) {
	return nil, nil
}
func (m *mockAddonService) GetReleaseHistory(_ context.Context, _, _ string) ([]models.HelmReleaseRevision, error) {
	return nil, nil
}
func (m *mockAddonService) GetAuditEvents(_ context.Context, _ models.AddOnAuditFilter) ([]models.AddOnAuditEvent, error) {
	return nil, nil
}
func (m *mockAddonService) SetUpgradePolicy(_ context.Context, _ string, _ models.AddOnUpgradePolicy) error {
	return nil
}
func (m *mockAddonService) GetFinancialStack(_ context.Context, _ string) (*financial.FinancialStack, error) {
	return &financial.FinancialStack{}, nil
}
func (m *mockAddonService) BuildFinancialStackPlan(_ context.Context, _ string) (*models.InstallPlan, error) {
	return &models.InstallPlan{}, nil
}
func (m *mockAddonService) GenerateRBACManifest(_ context.Context, _, _, _ string) (string, error) {
	return "", nil
}
func (m *mockAddonService) ListProfiles(_ context.Context) ([]models.ClusterProfile, error) {
	return nil, nil
}
func (m *mockAddonService) GetProfile(_ context.Context, _ string) (*models.ClusterProfile, error) {
	return nil, nil
}
func (m *mockAddonService) CreateProfile(_ context.Context, _ *models.ClusterProfile) error {
	return nil
}
func (m *mockAddonService) ApplyProfile(_ context.Context, _, _, _ string, _ chan<- service.InstallProgressEvent) error {
	return nil
}
func (m *mockAddonService) CreateRollout(_ context.Context, _, _, _ string, _ int, _ []string, _ string) (*models.AddonRollout, error) {
	return &models.AddonRollout{ID: "rollout-1"}, nil
}
func (m *mockAddonService) GetRecommendations(_ context.Context, _, _ string) (*financial.RightsizingRecommendation, error) {
	return &financial.RightsizingRecommendation{ReleaseName: "mock-addon"}, nil
}

func (m *mockAddonService) GetAdvisorRecommendations(_ context.Context, _ string) ([]models.AdvisorRecommendation, error) {
	return nil, nil
}

func (m *mockAddonService) GetRollout(_ context.Context, _ string) (*models.AddonRollout, error) {
	return &models.AddonRollout{ID: "rollout-1"}, nil
}
func (m *mockAddonService) ListRollouts(_ context.Context, _ string) ([]models.AddonRollout, error) {
	return nil, nil
}
func (m *mockAddonService) AbortRollout(_ context.Context, _ string) error { return nil }
func (m *mockAddonService) RunAddonTests(_ context.Context, _, _ string) (*helm.TestResult, error) {
	return &helm.TestResult{Passed: true, Tests: []helm.TestSuite{{Name: "test-pod", Status: "Succeeded"}}}, nil
}
func (m *mockAddonService) CreateMaintenanceWindow(_ context.Context, _ *models.AddonMaintenanceWindow) error {
	return nil
}
func (m *mockAddonService) ListMaintenanceWindows(_ context.Context, _ string) ([]models.AddonMaintenanceWindow, error) {
	return []models.AddonMaintenanceWindow{}, nil
}
func (m *mockAddonService) DeleteMaintenanceWindow(_ context.Context, _ string) error { return nil }
func (m *mockAddonService) ListCatalogSources(_ context.Context) ([]models.PrivateCatalogSource, error) {
	return nil, nil
}
func (m *mockAddonService) CreateCatalogSource(_ context.Context, _ *models.PrivateCatalogSource) error {
	return nil
}
func (m *mockAddonService) DeleteCatalogSource(_ context.Context, _ string) error { return nil }

var _ service.AddOnService = (*mockAddonService)(nil)

// ──────────────────────────────────────────────────────────────────────────────
// Minimal mock ClusterService
// ──────────────────────────────────────────────────────────────────────────────

type testClusterService struct{}

func (t *testClusterService) ListClusters(_ context.Context) ([]*models.Cluster, error) {
	return []*models.Cluster{{ID: "cluster-1", Name: "cluster-1"}}, nil
}
func (t *testClusterService) GetCluster(_ context.Context, id string) (*models.Cluster, error) {
	return &models.Cluster{ID: id, Name: id}, nil
}
func (t *testClusterService) GetClient(id string) (*k8s.Client, error) {
	if id == "cluster-1" {
		return &k8s.Client{}, nil
	}
	return nil, fmt.Errorf("cluster %s not found", id)
}
func (t *testClusterService) AddCluster(_ context.Context, _, _ string) (*models.Cluster, error) {
	return nil, nil
}
func (t *testClusterService) AddClusterFromBytes(_ context.Context, _ []byte, _ string) (*models.Cluster, error) {
	return nil, nil
}
func (t *testClusterService) RemoveCluster(_ context.Context, _ string) error  { return nil }
func (t *testClusterService) TestConnection(_ context.Context, _ string) error { return nil }
func (t *testClusterService) GetClusterSummary(_ context.Context, _ string) (*models.ClusterSummary, error) {
	return nil, nil
}
func (t *testClusterService) LoadClustersFromRepo(_ context.Context) error { return nil }
func (t *testClusterService) HasMetalLB(_ context.Context, _ string) (bool, error) {
	return false, nil
}
func (t *testClusterService) DiscoverClusters(_ context.Context) ([]*models.Cluster, error) {
	return nil, nil
}
func (t *testClusterService) GetOverview(_ string) (*models.ClusterOverview, bool) { return nil, false }
func (t *testClusterService) Subscribe(_ string) (chan *models.ClusterOverview, func()) {
	ch := make(chan *models.ClusterOverview)
	return ch, func() { close(ch) }
}
func (t *testClusterService) ReconnectCluster(_ context.Context, _ string) (*models.Cluster, error) {
	return nil, nil
}

var _ service.ClusterService = (*testClusterService)(nil)

// ──────────────────────────────────────────────────────────────────────────────
// Test helper: builds a Handler with auth enabled (or disabled) and a mock addon service.
// ──────────────────────────────────────────────────────────────────────────────

func setupHandlerRepo(t *testing.T) *repository.SQLiteRepository {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "handler_test.db")
	repo, err := repository.NewSQLiteRepository(dbPath)
	if err != nil {
		t.Fatalf("NewSQLiteRepository: %v", err)
	}
	t.Cleanup(func() { _ = repo.Close() })
	entries, err := dbmigrations.FS.ReadDir(".")
	if err != nil {
		t.Fatalf("read migrations: %v", err)
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		sql, _ := dbmigrations.FS.ReadFile(e.Name())
		_ = repo.RunMigrations(string(sql))
	}
	return repo
}

// buildHandler creates a Handler with auth-mode "jwt" so wrapWithRBAC uses the real middleware.
func buildHandler(t *testing.T, addonSvc service.AddOnService) *Handler {
	t.Helper()
	repo := setupHandlerRepo(t)
	cfg := &config.Config{AuthMode: "jwt"}
	return NewHandler(
		&testClusterService{},
		nil, cfg, nil, nil, nil, nil, nil,
		addonSvc,
		repo,
	)
}

// buildHandlerNoAuth creates a Handler with auth disabled (AuthMode="").
func buildHandlerNoAuth(t *testing.T, addonSvc service.AddOnService) *Handler {
	t.Helper()
	cfg := &config.Config{}
	return NewHandler(
		&testClusterService{},
		nil, cfg, nil, nil, nil, nil, nil,
		addonSvc,
		nil, // nil repo → auth disabled
	)
}

// serve dispatches a single request through the full addon route tree and returns the recorder.
// Because we call router.ServeHTTP directly (no network round-trip), the auth.Claims
// already in r.Context() are preserved all the way to the RBAC middleware.
func serve(h *Handler, r *http.Request) *httptest.ResponseRecorder {
	router := mux.NewRouter()
	SetupRoutes(router, h)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, r)
	return w
}

// claimsCtx returns a shallow copy of r with the given role's claims injected into the context.
func claimsCtx(r *http.Request, role string) *http.Request {
	return r.WithContext(auth.WithClaims(r.Context(), &auth.Claims{
		UserID:   "user-1",
		Username: "test-user",
		Role:     role,
	}))
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

// TestListCatalog_Unauthenticated verifies that GET /addons returns 401 when no JWT is present.
func TestListCatalog_Unauthenticated(t *testing.T) {
	svc := &mockAddonService{browseCatalogOut: []models.AddOnEntry{{ID: "cert-manager"}}}
	h := buildHandler(t, svc)

	r := httptest.NewRequest(http.MethodGet, "/addons", nil)
	// No claimsCtx — RBAC middleware must reject with 401.
	w := serve(h, r)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for unauthenticated request, got %d", w.Code)
	}
}

// TestListCatalog_Viewer verifies that a viewer-role request returns 200 with catalog entries.
func TestListCatalog_Viewer(t *testing.T) {
	svc := &mockAddonService{
		browseCatalogOut: []models.AddOnEntry{{
			ID:          "kubilitics/cert-manager",
			DisplayName: "Cert Manager",
			Tier:        string(models.TierCORE),
		}},
	}
	h := buildHandler(t, svc)

	r := httptest.NewRequest(http.MethodGet, "/addons", nil)
	r = claimsCtx(r, auth.RoleViewer)
	w := serve(h, r)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for viewer, got %d", w.Code)
	}
	var out struct {
		Items []models.AddOnEntry `json:"items"`
		Total int                 `json:"total"`
	}
	if err := json.NewDecoder(w.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(out.Items) != 1 || out.Items[0].ID != "kubilitics/cert-manager" || out.Total != 1 {
		t.Errorf("unexpected response: items=%+v total=%d", out.Items, out.Total)
	}
}

// TestGetCatalogEntry_NotFound verifies that GET /addons/{addonId} returns 404 when
// the service returns an error.
func TestGetCatalogEntry_NotFound(t *testing.T) {
	svc := &mockAddonService{getAddOnErr: errors.New("addon not found")}
	h := buildHandler(t, svc)

	r := httptest.NewRequest(http.MethodGet, "/addons/nonexistent-addon", nil)
	r = claimsCtx(r, auth.RoleViewer)
	w := serve(h, r)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 for missing addon, got %d", w.Code)
	}
}

// TestPlanInstall_MissingAddonId verifies that a plan request with no addon_id returns 400.
func TestPlanInstall_MissingAddonId(t *testing.T) {
	svc := &mockAddonService{}
	h := buildHandlerNoAuth(t, svc) // auth disabled: focus on input validation

	body := bytes.NewBufferString(`{"namespace": "default"}`) // missing addon_id
	r := httptest.NewRequest(http.MethodPost, "/clusters/cluster-1/addons/plan", body)
	r.Header.Set("Content-Type", "application/json")
	w := serve(h, r)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing addon_id, got %d", w.Code)
	}
}

// TestExecuteInstall_ViewerRole verifies that a viewer-role user cannot call the execute endpoint
// (requires Operator) — expects 403 Forbidden.
func TestExecuteInstall_ViewerRole(t *testing.T) {
	svc := &mockAddonService{}
	h := buildHandler(t, svc)

	body := bytes.NewBufferString(`{"addon_id":"cert-manager","namespace":"default"}`)
	r := httptest.NewRequest(http.MethodPost, "/clusters/cluster-1/addons/execute", body)
	r.Header.Set("Content-Type", "application/json")
	r = claimsCtx(r, auth.RoleViewer) // viewer cannot execute; operator required
	w := serve(h, r)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403 for viewer executing install, got %d", w.Code)
	}
}

// TestUninstallAddon_OperatorRole verifies that an operator-role user can delete an install
// and receives 204 No Content.
func TestUninstallAddon_OperatorRole(t *testing.T) {
	svc := &mockAddonService{uninstallErr: nil}
	h := buildHandler(t, svc)

	r := httptest.NewRequest(http.MethodDelete, "/clusters/cluster-1/addons/installed/install-abc", nil)
	r = claimsCtx(r, auth.RoleOperator)
	w := serve(h, r)

	if w.Code != http.StatusNoContent {
		t.Errorf("expected 204 for operator uninstall, got %d", w.Code)
	}
}

// TestStreamInstall_NoToken verifies that the WebSocket stream endpoint returns 401 when
// no authentication token is present (T6.01 fix: auth checked before WebSocket upgrade).
func TestStreamInstall_NoToken(t *testing.T) {
	svc := &mockAddonService{}
	h := buildHandler(t, svc)

	// Send a plain HTTP GET to the stream endpoint — no claims in context.
	// The T6.01 fix checks claims before upgrading to WebSocket, so this returns 401 as HTTP.
	r := httptest.NewRequest(http.MethodGet, "/clusters/cluster-1/addons/install/stream", nil)
	// No claimsCtx — RBAC middleware rejects before WebSocket upgrade.
	w := serve(h, r)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for unauthenticated stream request, got %d", w.Code)
	}
}

// TestListCatalog_ServiceError verifies that a service error maps to 500.
func TestListCatalog_ServiceError(t *testing.T) {
	svc := &mockAddonService{browseCatalogErr: errors.New("db connection lost")}
	h := buildHandlerNoAuth(t, svc) // auth disabled

	r := httptest.NewRequest(http.MethodGet, "/addons", nil)
	w := serve(h, r)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("expected 500 for service error, got %d", w.Code)
	}
}

// Unused import guard.
var _ = time.Now
