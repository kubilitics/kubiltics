package rest

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/service"
)

func TestGetCapabilities(t *testing.T) {
	cfg := &config.Config{}
	cs := service.NewClusterService(&mockClusterRepo{list: []*models.Cluster{}}, cfg)
	h := NewHandler(cs, nil, cfg, nil, nil, nil, nil, nil, nil, nil)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	var capabilities map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&capabilities); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	// Verify capabilities structure (may vary based on implementation)
	if len(capabilities) == 0 {
		t.Error("Expected capabilities object")
	}
}

func TestGetCapabilities_ContentType(t *testing.T) {
	cfg := &config.Config{}
	cs := service.NewClusterService(&mockClusterRepo{list: []*models.Cluster{}}, cfg)
	h := NewHandler(cs, nil, cfg, nil, nil, nil, nil, nil, nil, nil)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, h)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	contentType := rec.Header().Get("Content-Type")
	if contentType != "application/json" {
		t.Errorf("Expected Content-Type 'application/json', got '%s'", contentType)
	}
}
