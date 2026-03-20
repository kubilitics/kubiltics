package service

import (
	"context"
	"testing"

	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func TestClusterService_GetCluster_Found(t *testing.T) {
	ctx := context.Background()
	repo := &mockClusterRepo{clusters: make(map[string]*models.Cluster)}
	svc := NewClusterService(repo, nil)

	cluster := &models.Cluster{
		ID:      "test-cluster",
		Name:    "Test Cluster",
		Context: "test-context",
		Status:  "connected",
	}
	repo.Create(ctx, cluster)

	retrieved, err := svc.GetCluster(ctx, "test-cluster")
	if err != nil {
		t.Fatalf("GetCluster: %v", err)
	}
	if retrieved.ID != "test-cluster" {
		t.Errorf("Expected ID 'test-cluster', got '%s'", retrieved.ID)
	}
}

func TestClusterService_ListClusters_WithClusters(t *testing.T) {
	ctx := context.Background()
	repo := &mockClusterRepo{clusters: make(map[string]*models.Cluster)}
	svc := NewClusterService(repo, nil)

	// Create multiple clusters
	for i := 0; i < 3; i++ {
		cluster := &models.Cluster{
			ID:      "cluster-" + string(rune('0'+i)),
			Name:    "Cluster " + string(rune('0'+i)),
			Context: "context-" + string(rune('0'+i)),
			Status:  "connected",
		}
		repo.Create(ctx, cluster)
	}

	list, err := svc.ListClusters(ctx)
	if err != nil {
		t.Fatalf("ListClusters: %v", err)
	}
	if len(list) != 3 {
		t.Errorf("Expected 3 clusters, got %d", len(list))
	}
}

func TestClusterService_RemoveCluster_Found(t *testing.T) {
	ctx := context.Background()
	repo := &mockClusterRepo{clusters: make(map[string]*models.Cluster)}
	svc := NewClusterService(repo, nil)

	cluster := &models.Cluster{
		ID:      "test-cluster",
		Name:    "Test Cluster",
		Context: "test-context",
		Status:  "connected",
	}
	repo.Create(ctx, cluster)

	err := svc.RemoveCluster(ctx, "test-cluster")
	if err != nil {
		t.Fatalf("RemoveCluster: %v", err)
	}

	// Verify cluster was deleted
	_, err = repo.Get(ctx, "test-cluster")
	if err == nil {
		t.Error("Cluster should be deleted")
	}
}

func TestClusterService_NewClusterService_WithConfig(t *testing.T) {
	cfg := &config.Config{
		MaxClusters:        50,
		K8sTimeoutSec:      60,
		K8sRateLimitPerSec: 10.0,
		K8sRateLimitBurst:  20,
	}
	repo := &mockClusterRepo{clusters: make(map[string]*models.Cluster)}
	svc := NewClusterService(repo, cfg)

	if svc == nil {
		t.Fatal("Service should not be nil")
	}
}

func TestClusterService_NewClusterService_WithNilConfig(t *testing.T) {
	repo := &mockClusterRepo{clusters: make(map[string]*models.Cluster)}
	svc := NewClusterService(repo, nil)

	if svc == nil {
		t.Fatal("Service should not be nil")
	}
}

func TestClusterService_GetClient_NotFound(t *testing.T) {
	repo := &mockClusterRepo{clusters: make(map[string]*models.Cluster)}
	svc := NewClusterService(repo, nil)

	_, err := svc.GetClient("nonexistent")
	if err == nil {
		t.Error("Expected error when client not found")
	}
}
