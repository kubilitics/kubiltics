package rest

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	k8sfake "k8s.io/client-go/kubernetes/fake"

	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

var errClusterNotFound = errors.New("cluster not found")

// Mock cluster service for testing
type mockClusterService struct {
	clusters      []*models.Cluster
	clusterMap    map[string]*models.Cluster
	discoverError error
	addError      error
	removeError   error
	summary       *models.ClusterSummary
	overview      map[string]interface{}
	workloads     map[string]interface{}
	clientMap     map[string]*k8s.Client
}

func (m *mockClusterService) ListClusters(ctx context.Context) ([]*models.Cluster, error) {
	return m.clusters, nil
}

func (m *mockClusterService) DiscoverClusters(ctx context.Context) ([]*models.Cluster, error) {
	if m.discoverError != nil {
		return nil, m.discoverError
	}
	return m.clusters, nil
}

func (m *mockClusterService) GetCluster(ctx context.Context, id string) (*models.Cluster, error) {
	if c, ok := m.clusterMap[id]; ok {
		return c, nil
	}
	return nil, errClusterNotFound
}

func (m *mockClusterService) AddCluster(ctx context.Context, kubeconfigPath, contextName string) (*models.Cluster, error) {
	if m.addError != nil {
		return nil, m.addError
	}
	cluster := &models.Cluster{
		ID:             uuid.New().String(),
		Name:           "test-cluster",
		Context:        contextName,
		KubeconfigPath: kubeconfigPath,
		Status:         "connected",
	}
	return cluster, nil
}

func (m *mockClusterService) AddClusterFromBytes(ctx context.Context, kubeconfigBytes []byte, contextName string) (*models.Cluster, error) {
	if m.addError != nil {
		return nil, m.addError
	}
	cluster := &models.Cluster{
		ID:      uuid.New().String(),
		Name:    contextName,
		Context: contextName,
		Status:  "connected",
	}
	return cluster, nil
}

func (m *mockClusterService) RemoveCluster(ctx context.Context, id string) error {
	if m.removeError != nil {
		return m.removeError
	}
	if _, ok := m.clusterMap[id]; !ok {
		return errClusterNotFound
	}
	return nil
}

func (m *mockClusterService) GetClient(clusterID string) (*k8s.Client, error) {
	// GetClient should only succeed if clusterID is an actual cluster ID (in clusterMap)
	// If it's a context/name, return error so resolveClusterID falls back to ListClusters lookup
	if _, ok := m.clusterMap[clusterID]; !ok {
		return nil, errClusterNotFound
	}

	if client, ok := m.clientMap[clusterID]; ok {
		return client, nil
	}
	// Create a dummy client if cluster exists but no client set
	clientset := k8sfake.NewSimpleClientset()
	// Create a fake dynamic client for ListResources with list kinds registered
	scheme := runtime.NewScheme()
	listKinds := map[schema.GroupVersionResource]string{
		{Group: "apps", Version: "v1", Resource: "deployments"}:  "DeploymentList",
		{Group: "apps", Version: "v1", Resource: "statefulsets"}: "StatefulSetList",
		{Group: "apps", Version: "v1", Resource: "daemonsets"}:   "DaemonSetList",
		{Group: "batch", Version: "v1", Resource: "jobs"}:        "JobList",
		{Group: "batch", Version: "v1", Resource: "cronjobs"}:    "CronJobList",
	}
	dynamicClient := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, listKinds)
	// Create client with both Clientset and Dynamic
	client := k8s.NewClientForTest(clientset)
	// Set Dynamic field directly (it's exported)
	client.Dynamic = dynamicClient
	m.clientMap[clusterID] = client
	return client, nil
}

func (m *mockClusterService) GetClusterSummary(ctx context.Context, id string) (*models.ClusterSummary, error) {
	if m.summary != nil {
		return m.summary, nil
	}
	return nil, errClusterNotFound
}

func (m *mockClusterService) GetClusterOverview(ctx context.Context, id string) (map[string]interface{}, error) {
	if m.overview != nil {
		return m.overview, nil
	}
	return nil, errClusterNotFound
}

func (m *mockClusterService) GetWorkloadsOverview(ctx context.Context, id string) (map[string]interface{}, error) {
	if m.workloads != nil {
		return m.workloads, nil
	}
	return nil, errClusterNotFound
}

func (m *mockClusterService) TestConnection(ctx context.Context, id string) error {
	return nil
}

func (m *mockClusterService) HasMetalLB(ctx context.Context, id string) (bool, error) {
	return false, nil
}

func (m *mockClusterService) LoadClustersFromRepo(ctx context.Context) error {
	return nil
}

func (m *mockClusterService) GetOverview(clusterID string) (*models.ClusterOverview, bool) {
	return nil, false
}

func (m *mockClusterService) Subscribe(clusterID string) (chan *models.ClusterOverview, func()) {
	return nil, func() {}
}

func (m *mockClusterService) ReconnectCluster(ctx context.Context, id string) (*models.Cluster, error) {
	if c, ok := m.clusterMap[id]; ok {
		return c, nil
	}
	return nil, errClusterNotFound
}

// makeMockClientWithCounts returns a k8s.Client backed by fakes with the given node and namespace counts.
// Used by summary/overview tests where the handler builds counts from the client.
func makeMockClientWithCounts(nodeCount, namespaceCount int) *k8s.Client {
	var objs []runtime.Object
	for i := 0; i < nodeCount; i++ {
		objs = append(objs, &corev1.Node{
			ObjectMeta: metav1.ObjectMeta{Name: "node-" + fmt.Sprintf("%d", i)},
		})
	}
	for i := 0; i < namespaceCount; i++ {
		objs = append(objs, &corev1.Namespace{
			ObjectMeta: metav1.ObjectMeta{Name: "ns-" + fmt.Sprintf("%d", i)},
		})
	}
	clientset := k8sfake.NewSimpleClientset(objs...)
	scheme := runtime.NewScheme()
	listKinds := map[schema.GroupVersionResource]string{
		{Group: "apps", Version: "v1", Resource: "deployments"}:  "DeploymentList",
		{Group: "apps", Version: "v1", Resource: "statefulsets"}: "StatefulSetList",
		{Group: "apps", Version: "v1", Resource: "daemonsets"}:   "DaemonSetList",
		{Group: "batch", Version: "v1", Resource: "jobs"}:        "JobList",
		{Group: "batch", Version: "v1", Resource: "cronjobs"}:    "CronJobList",
	}
	dynamicClient := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, listKinds)
	client := k8s.NewClientForTest(clientset)
	client.Dynamic = dynamicClient
	return client
}

// Mock events service
type mockEventsService struct{}

func (m *mockEventsService) ListEventsAllNamespaces(ctx context.Context, clusterID string, limit int) ([]*models.Event, error) {
	return []*models.Event{}, nil
}

func (m *mockEventsService) ListEvents(ctx context.Context, clusterID, namespace string, opts metav1.ListOptions) (*metav1.List, []*models.Event, error) {
	return &metav1.List{}, []*models.Event{}, nil
}

func (m *mockEventsService) WatchEvents(ctx context.Context, clusterID, namespace string, eventChan chan<- *models.Event, errChan chan<- error) {
	// Mock implementation - do nothing
}

func (m *mockEventsService) GetResourceEvents(ctx context.Context, clusterID, namespace, resourceKind, resourceName string) ([]*models.Event, error) {
	return []*models.Event{}, nil
}

func setupClusterHandlerTest(t *testing.T) (*Handler, *mockClusterService) {
	t.Helper()
	mockSvc := &mockClusterService{
		clusterMap: make(map[string]*models.Cluster),
		clusters:   []*models.Cluster{},
		clientMap:  make(map[string]*k8s.Client),
	}
	cfg := &config.Config{
		AuthMode: "disabled",
	}
	mockEventsSvc := &mockEventsService{}
	handler := NewHandler(mockSvc, nil, cfg, nil, mockEventsSvc, nil, nil, nil, nil, nil)
	return handler, mockSvc
}

func setupClusterHandlerTestWithAuth(t *testing.T) (*Handler, *mockClusterService, *repository.SQLiteRepository) {
	t.Helper()
	mockSvc := &mockClusterService{
		clusterMap: make(map[string]*models.Cluster),
		clusters:   []*models.Cluster{},
		clientMap:  make(map[string]*k8s.Client),
	}
	repo := setupTestRepoForAuth(t)
	cfg := &config.Config{
		AuthMode:      "required",
		AuthJWTSecret: "test-secret-key-minimum-32-characters-long",
	}
	mockEventsSvc := &mockEventsService{}
	handler := NewHandler(mockSvc, nil, cfg, nil, mockEventsSvc, nil, nil, nil, nil, repo)
	return handler, mockSvc, repo
}

// Test ListClusters endpoint
func TestHandler_ListClusters_Success(t *testing.T) {
	handler, mockSvc := setupClusterHandlerTest(t)

	cluster1 := &models.Cluster{
		ID:      uuid.New().String(),
		Name:    "cluster1",
		Context: "ctx1",
		Status:  "connected",
	}
	cluster2 := &models.Cluster{
		ID:      uuid.New().String(),
		Name:    "cluster2",
		Context: "ctx2",
		Status:  "connected",
	}
	mockSvc.clusters = []*models.Cluster{cluster1, cluster2}

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, handler)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var clusters []models.Cluster
	if err := json.NewDecoder(rec.Body).Decode(&clusters); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if len(clusters) != 2 {
		t.Errorf("Expected 2 clusters, got %d", len(clusters))
	}
}

func TestHandler_ListClusters_WithPermissions(t *testing.T) {
	handler, mockSvc, repo := setupClusterHandlerTestWithAuth(t)
	defer repo.Close()

	userID := uuid.New().String()
	password := "Xy9$mK2#pQ7@vN4&wL8*zR5!tB3"
	hashedPassword, _ := auth.HashPassword(password)
	user := &models.User{
		ID:           userID,
		Username:     "testuser",
		PasswordHash: hashedPassword,
		Role:         auth.RoleViewer,
	}
	repo.CreateUser(context.Background(), user)

	cluster1ID := uuid.New().String()
	cluster2ID := uuid.New().String()
	cluster1 := &models.Cluster{
		ID:      cluster1ID,
		Name:    "cluster1",
		Context: "ctx1",
		Status:  "connected",
	}
	cluster2 := &models.Cluster{
		ID:      cluster2ID,
		Name:    "cluster2",
		Context: "ctx2",
		Status:  "connected",
	}
	mockSvc.clusters = []*models.Cluster{cluster1, cluster2}
	mockSvc.clusterMap[cluster1ID] = cluster1
	mockSvc.clusterMap[cluster2ID] = cluster2
	// Create clients for both clusters so GetClient works
	clientset1 := k8sfake.NewSimpleClientset()
	scheme := runtime.NewScheme()
	dynamicClient1 := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, map[schema.GroupVersionResource]string{})
	client1 := k8s.NewClientForTest(clientset1)
	client1.Dynamic = dynamicClient1
	mockSvc.clientMap[cluster1ID] = client1

	clientset2 := k8sfake.NewSimpleClientset()
	dynamicClient2 := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, map[schema.GroupVersionResource]string{})
	client2 := k8s.NewClientForTest(clientset2)
	client2.Dynamic = dynamicClient2
	mockSvc.clientMap[cluster2ID] = client2

	// Grant permission only to cluster1
	perm := &models.ClusterPermission{
		ID:        uuid.New().String(),
		UserID:    userID,
		ClusterID: cluster1ID,
		Role:      auth.RoleViewer,
	}
	repo.CreateClusterPermission(context.Background(), perm)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	api.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := &auth.Claims{
				UserID:   userID,
				Username: "testuser",
				Role:     auth.RoleViewer,
			}
			ctx := auth.WithClaims(r.Context(), claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	SetupRoutes(api, handler)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var clusters []models.Cluster
	if err := json.NewDecoder(rec.Body).Decode(&clusters); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if len(clusters) != 1 {
		t.Errorf("Expected 1 cluster (filtered by permissions), got %d", len(clusters))
	}
	if clusters[0].ID != cluster1ID {
		t.Errorf("Expected cluster ID '%s', got '%s'", cluster1ID, clusters[0].ID)
	}
}

// Test DiscoverClusters endpoint
func TestHandler_DiscoverClusters_Success(t *testing.T) {
	handler, mockSvc := setupClusterHandlerTest(t)

	cluster1 := &models.Cluster{
		ID:      uuid.New().String(),
		Name:    "discovered-cluster1",
		Context: "ctx1",
		Status:  "connected",
	}
	mockSvc.clusters = []*models.Cluster{cluster1}

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, handler)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/discover", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var clusters []models.Cluster
	if err := json.NewDecoder(rec.Body).Decode(&clusters); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if len(clusters) != 1 {
		t.Errorf("Expected 1 cluster, got %d", len(clusters))
	}
}

// Test GetCluster endpoint
func TestHandler_GetCluster_Success(t *testing.T) {
	handler, mockSvc := setupClusterHandlerTest(t)

	clusterID := uuid.New().String()
	cluster := &models.Cluster{
		ID:      clusterID,
		Name:    "test-cluster",
		Context: "test-ctx",
		Status:  "connected",
	}
	mockSvc.clusterMap[clusterID] = cluster
	mockSvc.clusters = []*models.Cluster{cluster} // Add to clusters list for resolveClusterID

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, handler)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/"+clusterID, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var retrievedCluster models.Cluster
	if err := json.NewDecoder(rec.Body).Decode(&retrievedCluster); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if retrievedCluster.ID != clusterID {
		t.Errorf("Expected cluster ID '%s', got '%s'", clusterID, retrievedCluster.ID)
	}
}

func TestHandler_GetCluster_ByContext(t *testing.T) {
	handler, mockSvc := setupClusterHandlerTest(t)

	clusterID := uuid.New().String()
	cluster := &models.Cluster{
		ID:      clusterID,
		Name:    "test-cluster",
		Context: "docker-desktop",
		Status:  "connected",
	}
	mockSvc.clusterMap[clusterID] = cluster
	mockSvc.clusters = []*models.Cluster{cluster}
	// Create client so GetClient works for resolveClusterID
	clientset := k8sfake.NewSimpleClientset()
	scheme := runtime.NewScheme()
	dynamicClient := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, map[schema.GroupVersionResource]string{})
	client := k8s.NewClientForTest(clientset)
	client.Dynamic = dynamicClient
	mockSvc.clientMap[clusterID] = client

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, handler)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/docker-desktop", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var retrievedCluster models.Cluster
	if err := json.NewDecoder(rec.Body).Decode(&retrievedCluster); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if retrievedCluster.ID != clusterID {
		t.Errorf("Expected cluster ID '%s', got '%s'", clusterID, retrievedCluster.ID)
	}
}

func TestHandler_GetCluster_NotFound(t *testing.T) {
	handler, _ := setupClusterHandlerTest(t)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, handler)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/nonexistent", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("Expected status 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestHandler_GetCluster_InvalidID(t *testing.T) {
	handler, _ := setupClusterHandlerTest(t)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, handler)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/invalid@id", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

// Test AddCluster endpoint
func TestHandler_AddCluster_WithKubeconfigPath(t *testing.T) {
	handler, _ := setupClusterHandlerTest(t)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, handler)

	reqBody := map[string]string{
		"kubeconfig_path": "/path/to/kubeconfig",
		"context":         "test-ctx",
	}
	body, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/clusters", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("Expected status 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var cluster models.Cluster
	if err := json.NewDecoder(rec.Body).Decode(&cluster); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if cluster.Context != "test-ctx" {
		t.Errorf("Expected context 'test-ctx', got '%s'", cluster.Context)
	}
}

// Test RemoveCluster endpoint
func TestHandler_RemoveCluster_Success(t *testing.T) {
	handler, mockSvc := setupClusterHandlerTest(t)

	clusterID := uuid.New().String()
	cluster := &models.Cluster{
		ID:      clusterID,
		Name:    "test-cluster",
		Context: "test-ctx",
		Status:  "connected",
	}
	mockSvc.clusterMap[clusterID] = cluster
	mockSvc.clusters = []*models.Cluster{cluster} // Add to clusters list for resolveClusterID

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, handler)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/clusters/"+clusterID, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestHandler_RemoveCluster_NotFound(t *testing.T) {
	handler, _ := setupClusterHandlerTest(t)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, handler)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/clusters/nonexistent", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("Expected status 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

// Test GetClusterSummary endpoint
func TestHandler_GetClusterSummary_Success(t *testing.T) {
	handler, mockSvc := setupClusterHandlerTest(t)

	clusterID := uuid.New().String()
	cluster := &models.Cluster{
		ID:      clusterID,
		Name:    "test-cluster",
		Context: "test-ctx",
		Status:  "connected",
	}
	mockSvc.clusterMap[clusterID] = cluster
	mockSvc.clusters = []*models.Cluster{cluster} // Add to clusters list for resolveClusterID
	mockSvc.summary = &models.ClusterSummary{
		ID:              clusterID,
		Name:            "test-cluster",
		NodeCount:       3,
		PodCount:        10,
		NamespaceCount:  5,
		DeploymentCount: 2,
	}
	// Handler builds summary from client; seed fake with 3 nodes, 5 namespaces, 2 deployments so counts match
	mockSvc.clientMap[clusterID] = makeMockClientWithCounts(3, 5)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, handler)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/"+clusterID+"/summary", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var summary models.ClusterSummary
	if err := json.NewDecoder(rec.Body).Decode(&summary); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if summary.NodeCount != 3 {
		t.Errorf("Expected 3 nodes, got %d", summary.NodeCount)
	}
}

// Test GetClusterOverview endpoint
func TestHandler_GetClusterOverview_Success(t *testing.T) {
	handler, mockSvc := setupClusterHandlerTest(t)

	clusterID := uuid.New().String()
	cluster := &models.Cluster{
		ID:      clusterID,
		Name:    "test-cluster",
		Context: "test-ctx",
		Status:  "connected",
	}
	mockSvc.clusterMap[clusterID] = cluster
	mockSvc.summary = &models.ClusterSummary{
		ID:              clusterID,
		Name:            "test-cluster",
		NodeCount:       3,
		PodCount:        10,
		NamespaceCount:  5,
		DeploymentCount: 2,
	}
	// Handler builds overview from client; seed fake with 3 nodes, 5 namespaces
	mockSvc.clientMap[clusterID] = makeMockClientWithCounts(3, 5)

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, handler)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/"+clusterID+"/overview", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var overview models.ClusterOverview
	if err := json.NewDecoder(rec.Body).Decode(&overview); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if overview.Counts.Nodes != 3 {
		t.Errorf("Expected 3 nodes, got %d", overview.Counts.Nodes)
	}
}

// Test GetWorkloadsOverview endpoint
func TestHandler_GetWorkloadsOverview_Success(t *testing.T) {
	handler, mockSvc := setupClusterHandlerTest(t)

	clusterID := uuid.New().String()
	cluster := &models.Cluster{
		ID:      clusterID,
		Name:    "test-cluster",
		Context: "test-ctx",
		Status:  "connected",
	}
	mockSvc.clusterMap[clusterID] = cluster

	router := mux.NewRouter()
	api := router.PathPrefix("/api/v1").Subrouter()
	SetupRoutes(api, handler)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/"+clusterID+"/workloads", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var workloads models.WorkloadsOverview
	if err := json.NewDecoder(rec.Body).Decode(&workloads); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	// Verify workloads response structure exists
	if workloads.Pulse == (models.WorkloadPulse{}) {
		t.Error("Expected workloads pulse, got empty")
	}
}
