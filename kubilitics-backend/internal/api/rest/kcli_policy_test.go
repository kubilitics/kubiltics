package rest

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/service"
)

func TestValidateKCLIArgs(t *testing.T) {
	t.Run("sanitizes and allows safe command", func(t *testing.T) {
		args, mutating, err := validateKCLIArgs([]string{"kcli", "get", "pods"}, false)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if mutating {
			t.Fatalf("expected non-mutating command")
		}
		if len(args) != 2 || args[0] != "get" {
			t.Fatalf("unexpected normalized args: %v", args)
		}
	})

	t.Run("rejects blocked flag", func(t *testing.T) {
		_, _, err := validateKCLIArgs([]string{"get", "pods", "--context", "prod"}, false)
		if err == nil || !strings.Contains(err.Error(), "not allowed") {
			t.Fatalf("expected blocked flag error, got: %v", err)
		}
	})

	t.Run("rejects unknown command", func(t *testing.T) {
		_, _, err := validateKCLIArgs([]string{"whoami"}, false)
		if err == nil || !strings.Contains(err.Error(), "not allowed") {
			t.Fatalf("expected command not allowed error, got: %v", err)
		}
	})

	t.Run("requires force for mutating", func(t *testing.T) {
		_, _, err := validateKCLIArgs([]string{"delete", "pod", "x"}, false)
		if err == nil || !strings.Contains(err.Error(), "requires force=true") {
			t.Fatalf("expected force requirement error, got: %v", err)
		}
	})

	t.Run("allows plugin command (plugins can run non-interactively)", func(t *testing.T) {
		_, _, err := validateKCLIArgs([]string{"plugin", "list"}, false)
		if err != nil {
			t.Fatalf("plugin list is allowed in exec endpoint, got: %v", err)
		}
	})
	t.Run("rejects ui command (requires interactive PTY)", func(t *testing.T) {
		_, _, err := validateKCLIArgs([]string{"ui"}, false)
		if err == nil || (!strings.Contains(err.Error(), "interactive") && !strings.Contains(err.Error(), "not allowed")) {
			t.Fatalf("expected ui blocked error, got: %v", err)
		}
	})
}

func TestPostKCLIExec_RequiresDestructiveHeader(t *testing.T) {
	clusterRouteID := "demo-ctx"
	clusterID := "cluster-kcli-exec-id"
	cluster := &models.Cluster{
		ID:             clusterID,
		Name:           "demo",
		Context:        clusterRouteID,
		KubeconfigPath: "/tmp/kubeconfig",
	}
	repo := &mockClusterRepo{
		list: []*models.Cluster{cluster},
		get:  map[string]*models.Cluster{clusterID: cluster},
	}
	cfg := &config.Config{}
	cs := service.NewClusterService(repo, cfg)
	h := NewHandler(cs, nil, cfg, nil, nil, nil, nil, nil, nil, nil)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	body := `{"args":["delete","pod","nginx"],"force":true}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/clusters/"+clusterRouteID+"/kcli/exec", strings.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "X-Confirm-Destructive") {
		t.Fatalf("expected destructive header guidance, got: %s", rec.Body.String())
	}
}

func TestPostKCLIExec_RateLimited(t *testing.T) {
	// Skip test if kcli binary is not available (expected in test environment)
	if _, err := exec.LookPath("kcli"); err != nil {
		if os.Getenv("KCLI_BIN") == "" {
			t.Skip("Skipping test: kcli binary not found and KCLI_BIN not set")
		}
	}

	clusterRouteID := "demo-ctx"
	clusterID := "cluster-kcli-limit-id"
	cluster := &models.Cluster{
		ID:             clusterID,
		Name:           "demo",
		Context:        clusterRouteID,
		KubeconfigPath: "/tmp/kubeconfig",
	}
	repo := &mockClusterRepo{
		list: []*models.Cluster{cluster},
		get:  map[string]*models.Cluster{clusterID: cluster},
	}
	cfg := &config.Config{
		KCLIRateLimitPerSec: 1,
		KCLIRateLimitBurst:  1,
	}
	cs := service.NewClusterService(repo, cfg)
	h := NewHandler(cs, nil, cfg, nil, nil, nil, nil, nil, nil, nil)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	req1 := httptest.NewRequest(http.MethodPost, "/api/v1/clusters/"+clusterRouteID+"/kcli/exec", strings.NewReader(`{"args":["get","pods"]}`))
	rec1 := httptest.NewRecorder()
	router.ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusOK {
		t.Fatalf("first request status = %d, want 200 body=%s", rec1.Code, rec1.Body.String())
	}

	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/clusters/"+clusterRouteID+"/kcli/exec", strings.NewReader(`{"args":["get","pods"]}`))
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusTooManyRequests {
		t.Fatalf("second request status = %d, want 429 body=%s", rec2.Code, rec2.Body.String())
	}
}

func TestGetKCLIStream_ShellModeDisabled(t *testing.T) {
	clusterRouteID := "demo-ctx"
	clusterID := "cluster-kcli-stream-id"
	cluster := &models.Cluster{
		ID:             clusterID,
		Name:           "demo",
		Context:        clusterRouteID,
		KubeconfigPath: "/tmp/kubeconfig",
	}
	repo := &mockClusterRepo{
		list: []*models.Cluster{cluster},
		get:  map[string]*models.Cluster{clusterID: cluster},
	}
	cfg := &config.Config{
		KCLIAllowShellMode: false,
	}
	cs := service.NewClusterService(repo, cfg)
	h := NewHandler(cs, nil, cfg, nil, nil, nil, nil, nil, nil, nil)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/"+clusterRouteID+"/kcli/stream?mode=shell", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 body=%s", rec.Code, rec.Body.String())
	}
}
