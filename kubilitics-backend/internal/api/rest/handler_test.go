// Package rest: API integration tests (B4.2). HTTP handlers with mock cluster service; assert status and JSON shape.
package rest

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/service"
)

type mockClusterRepo struct {
	list []*models.Cluster
	get  map[string]*models.Cluster // optional: id -> cluster for Get(ctx, id)
}

func TestAPI_GET_ShellStatus_ReturnsContextAndNamespace(t *testing.T) {
	clusterRouteID := "demo-ctx"
	clusterID := "cluster-shell-status-id"
	kubeconfig := `
apiVersion: v1
kind: Config
current-context: demo-ctx
contexts:
- name: demo-ctx
  context:
    cluster: demo
    user: demo-user
    namespace: kube-system
clusters:
- name: demo
  cluster:
    server: https://127.0.0.1:6443
users:
- name: demo-user
  user:
    token: fake
`
	tmpFile := filepath.Join(t.TempDir(), "kubeconfig.yaml")
	if err := os.WriteFile(tmpFile, []byte(kubeconfig), 0o600); err != nil {
		t.Fatalf("write kubeconfig: %v", err)
	}

	cluster := &models.Cluster{
		ID:             clusterID,
		Name:           "demo",
		Context:        "demo-ctx",
		KubeconfigPath: tmpFile,
	}
	repo := &mockClusterRepo{
		list: []*models.Cluster{cluster},
		get: map[string]*models.Cluster{
			clusterID: cluster,
		},
	}
	cfg := &config.Config{}
	cs := service.NewClusterService(repo, cfg)
	h := NewHandler(cs, nil, cfg, nil, nil, nil, nil, nil, nil, nil)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/"+clusterRouteID+"/shell/status", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /shell/status status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		ClusterID     string `json:"clusterId"`
		ClusterName   string `json:"clusterName"`
		Context       string `json:"context"`
		Namespace     string `json:"namespace"`
		KCLIAvailable bool   `json:"kcliAvailable"`
		AIEnabled     bool   `json:"aiEnabled"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out.ClusterID != clusterID {
		t.Fatalf("clusterId = %q, want %q", out.ClusterID, clusterID)
	}
	if out.Context != "demo-ctx" {
		t.Fatalf("context = %q, want demo-ctx", out.Context)
	}
	if out.Namespace != "kube-system" {
		t.Fatalf("namespace = %q, want kube-system", out.Namespace)
	}
}

func TestAPI_GET_KCLITUIState_ReturnsContextAndNamespace(t *testing.T) {
	clusterRouteID := "demo-ctx"
	clusterID := "cluster-kcli-tui-state-id"
	kubeconfig := `
apiVersion: v1
kind: Config
current-context: demo-ctx
contexts:
- name: demo-ctx
  context:
    cluster: demo
    user: demo-user
    namespace: kube-system
clusters:
- name: demo
  cluster:
    server: https://127.0.0.1:6443
users:
- name: demo-user
  user:
    token: fake
`
	tmpFile := filepath.Join(t.TempDir(), "kubeconfig.yaml")
	if err := os.WriteFile(tmpFile, []byte(kubeconfig), 0o600); err != nil {
		t.Fatalf("write kubeconfig: %v", err)
	}

	cluster := &models.Cluster{
		ID:             clusterID,
		Name:           "demo",
		Context:        "demo-ctx",
		KubeconfigPath: tmpFile,
	}
	repo := &mockClusterRepo{
		list: []*models.Cluster{cluster},
		get: map[string]*models.Cluster{
			clusterID: cluster,
		},
	}
	cfg := &config.Config{}
	cs := service.NewClusterService(repo, cfg)
	h := NewHandler(cs, nil, cfg, nil, nil, nil, nil, nil, nil, nil)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/"+clusterRouteID+"/kcli/tui/state", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /kcli/tui/state status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		ClusterID string `json:"clusterId"`
		Context   string `json:"context"`
		Namespace string `json:"namespace"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out.ClusterID != clusterID {
		t.Fatalf("clusterId = %q, want %q", out.ClusterID, clusterID)
	}
	if out.Context != "demo-ctx" {
		t.Fatalf("context = %q, want demo-ctx", out.Context)
	}
	if out.Namespace != "kube-system" {
		t.Fatalf("namespace = %q, want kube-system", out.Namespace)
	}
}

func TestAPI_GET_ShellComplete_FileFlagPathCompletion(t *testing.T) {
	clusterRouteID := "demo-ctx"
	clusterID := "cluster-shell-complete-id"
	tmpDir := t.TempDir()
	manifest := filepath.Join(tmpDir, "manifest.yaml")
	if err := os.WriteFile(manifest, []byte("apiVersion: v1\nkind: Pod\n"), 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	cluster := &models.Cluster{
		ID:             clusterID,
		Name:           "demo",
		Context:        clusterRouteID,
		KubeconfigPath: "/tmp/kubeconfig",
	}
	repo := &mockClusterRepo{
		list: []*models.Cluster{cluster},
		get: map[string]*models.Cluster{
			clusterID: cluster,
		},
	}
	cfg := &config.Config{}
	cs := service.NewClusterService(repo, cfg)
	h := NewHandler(cs, nil, cfg, nil, nil, nil, nil, nil, nil, nil)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	line := "kubectl apply -f " + filepath.Join(tmpDir, "man")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/"+clusterRouteID+"/shell/complete?line="+url.QueryEscape(line), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /shell/complete status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Completions []string `json:"completions"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	found := false
	for _, c := range out.Completions {
		if c == manifest {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected completion %q in %#v", manifest, out.Completions)
	}
}

func TestAPI_GET_KCLIComplete_FileFlagPathCompletion(t *testing.T) {
	clusterRouteID := "demo-ctx"
	clusterID := "cluster-kcli-complete-id"
	tmpDir := t.TempDir()
	manifest := filepath.Join(tmpDir, "manifest.yaml")
	if err := os.WriteFile(manifest, []byte("apiVersion: v1\nkind: Pod\n"), 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	cluster := &models.Cluster{
		ID:             clusterID,
		Name:           "demo",
		Context:        clusterRouteID,
		KubeconfigPath: "/tmp/kubeconfig",
	}
	repo := &mockClusterRepo{
		list: []*models.Cluster{cluster},
		get: map[string]*models.Cluster{
			clusterID: cluster,
		},
	}
	cfg := &config.Config{}
	cs := service.NewClusterService(repo, cfg)
	h := NewHandler(cs, nil, cfg, nil, nil, nil, nil, nil, nil, nil)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	line := "apply -f " + filepath.Join(tmpDir, "man")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/"+clusterRouteID+"/kcli/complete?line="+url.QueryEscape(line), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /kcli/complete status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Completions []string `json:"completions"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	found := false
	for _, c := range out.Completions {
		if c == manifest {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected completion %q in %#v", manifest, out.Completions)
	}
}

func (m *mockClusterRepo) Create(ctx context.Context, cluster *models.Cluster) error { return nil }
func (m *mockClusterRepo) Get(ctx context.Context, id string) (*models.Cluster, error) {
	if m.get != nil {
		if c, ok := m.get[id]; ok {
			return c, nil
		}
	}
	return nil, nil
}
func (m *mockClusterRepo) List(ctx context.Context) ([]*models.Cluster, error) {
	return m.list, nil
}
func (m *mockClusterRepo) Update(ctx context.Context, cluster *models.Cluster) error { return nil }
func (m *mockClusterRepo) Delete(ctx context.Context, id string) error               { return nil }

func TestAPI_GET_Clusters_Returns200AndArray(t *testing.T) {
	repo := &mockClusterRepo{list: []*models.Cluster{}}
	cfg := &config.Config{}
	cs := service.NewClusterService(repo, cfg)
	h := NewHandler(cs, nil, cfg, nil, nil, nil, nil, nil, nil, nil)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("GET /api/v1/clusters status = %d, want 200", rec.Code)
	}
	var out []models.Cluster
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Errorf("decode response: %v", err)
	}
	if out == nil {
		t.Error("response body should be JSON array (possibly empty)")
	}
}

func TestAPI_GET_Health_Returns200(t *testing.T) {
	router := mux.NewRouter()
	router.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
	}).Methods("GET")

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("GET /health status = %d, want 200", rec.Code)
	}
}

// TestAPI_POST_Shell_BlockedVerb_Returns400 verifies that blocked kubectl verbs (e.g. delete) return 400.
func TestAPI_POST_Shell_BlockedVerb_Returns400(t *testing.T) {
	clusterID := "test-cluster-id"
	repo := &mockClusterRepo{
		list: []*models.Cluster{},
		get: map[string]*models.Cluster{
			clusterID: {
				ID:             clusterID,
				Name:           "test",
				Context:        "test-ctx",
				KubeconfigPath: "/tmp/kubeconfig",
			},
		},
	}
	cfg := &config.Config{}
	cs := service.NewClusterService(repo, cfg)
	h := NewHandler(cs, nil, cfg, nil, nil, nil, nil, nil, nil, nil)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	body := `{"command":"delete pod mypod"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/clusters/"+clusterID+"/shell", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("POST /shell with blocked verb status = %d, want 400", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Command not allowed") {
		t.Errorf("response body should contain 'Command not allowed', got: %s", rec.Body.String())
	}
}

// TestAPI_POST_Shell_EmptyCommand_Returns200 verifies that empty command runs kubectl version (200 + JSON).
func TestAPI_POST_Shell_EmptyCommand_Returns200(t *testing.T) {
	clusterID := "test-cluster-id"
	repo := &mockClusterRepo{
		list: []*models.Cluster{},
		get: map[string]*models.Cluster{
			clusterID: {
				ID:             clusterID,
				Name:           "test",
				Context:        "test-ctx",
				KubeconfigPath: "/tmp/kubeconfig",
			},
		},
	}
	cfg := &config.Config{}
	cs := service.NewClusterService(repo, cfg)
	h := NewHandler(cs, nil, cfg, nil, nil, nil, nil, nil, nil, nil)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	body := `{"command":""}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/clusters/"+clusterID+"/shell", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("POST /shell with empty command status = %d, want 200", rec.Code)
	}
	var out struct {
		Stdout   string `json:"stdout"`
		Stderr   string `json:"stderr"`
		ExitCode int    `json:"exitCode"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Errorf("decode response: %v", err)
	}
	// Backend returns stdout/stderr/exitCode for empty command (kubectl version); exitCode may be non-zero if kubectl not in path
}
