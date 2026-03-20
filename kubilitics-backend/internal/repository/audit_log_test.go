package repository

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

func setupTestRepoForAuditLogs(t *testing.T) *SQLiteRepository {
	t.Helper()
	repo, err := NewSQLiteRepository(":memory:")
	if err != nil {
		t.Fatalf("Failed to create repository: %v", err)
	}
	migrationSQL := `
		CREATE TABLE IF NOT EXISTS audit_log (
			id TEXT PRIMARY KEY,
			timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			user_id TEXT,
			username TEXT NOT NULL,
			cluster_id TEXT,
			action TEXT NOT NULL,
			resource_kind TEXT,
			resource_namespace TEXT,
			resource_name TEXT,
			status_code INTEGER,
			request_ip TEXT NOT NULL,
			details TEXT,
			session_id TEXT,
			device_info TEXT,
			geolocation TEXT,
			risk_score INTEGER,
			correlation_id TEXT
		);
	`
	if err := repo.RunMigrations(migrationSQL); err != nil {
		t.Fatalf("Failed to run migrations: %v", err)
	}
	return repo
}

func TestCreateAuditLog(t *testing.T) {
	repo := setupTestRepoForAuditLogs(t)
	defer repo.Close()

	statusCode := http.StatusOK
	userID := "user-123"
	clusterID := "cluster-123"
	resourceKind := "Pod"
	resourceNamespace := "default"
	resourceName := "test-pod"
	entry := &models.AuditLogEntry{
		ID:               uuid.New().String(),
		Timestamp:        time.Now(),
		UserID:           &userID,
		Username:         "testuser",
		ClusterID:        &clusterID,
		Action:           "create",
		ResourceKind:     &resourceKind,
		ResourceNamespace: &resourceNamespace,
		ResourceName:     &resourceName,
		StatusCode:       &statusCode,
		RequestIP:        "192.168.1.100",
		Details:          "POST /api/v1/clusters/cluster-123/resources/pods",
	}

	err := repo.CreateAuditLog(context.Background(), entry)
	if err != nil {
		t.Fatalf("Failed to create audit log: %v", err)
	}
}

func TestCreateAuditLog_AutoGeneratesID(t *testing.T) {
	repo := setupTestRepoForAuditLogs(t)
	defer repo.Close()

	statusCode := http.StatusOK
	entry := &models.AuditLogEntry{
		Timestamp:        time.Now(),
		Username:         "testuser",
		Action:           "create",
		StatusCode:       &statusCode,
		RequestIP:        "192.168.1.100",
	}

	err := repo.CreateAuditLog(context.Background(), entry)
	if err != nil {
		t.Fatalf("Failed to create audit log: %v", err)
	}
	if entry.ID == "" {
		t.Error("Audit log ID should be auto-generated")
	}
}

func TestListAuditLog_NoFilters(t *testing.T) {
	repo := setupTestRepoForAuditLogs(t)
	defer repo.Close()

	// Create multiple audit log entries
	for i := 0; i < 5; i++ {
		statusCode := http.StatusOK
		entry := &models.AuditLogEntry{
			ID:               uuid.New().String(),
			Timestamp:        time.Now(),
			Username:         "testuser",
			Action:           "create",
			StatusCode:       &statusCode,
			RequestIP:        "192.168.1.100",
		}
		repo.CreateAuditLog(context.Background(), entry)
	}

	entries, err := repo.ListAuditLog(context.Background(), nil, nil, nil, nil, nil, 10)
	if err != nil {
		t.Fatalf("Failed to list audit log: %v", err)
	}
	if len(entries) != 5 {
		t.Errorf("Expected 5 entries, got %d", len(entries))
	}
}

func TestListAuditLog_ByUserID(t *testing.T) {
	repo := setupTestRepoForAuditLogs(t)
	defer repo.Close()

	userID1 := "user-1"
	userID2 := "user-2"

	// Create entries for different users
	for i := 0; i < 3; i++ {
		statusCode := http.StatusOK
		entry := &models.AuditLogEntry{
			ID:               uuid.New().String(),
			Timestamp:        time.Now(),
			UserID:           &userID1,
			Username:         "user1",
			Action:           "create",
			StatusCode:       &statusCode,
			RequestIP:        "192.168.1.100",
		}
		repo.CreateAuditLog(context.Background(), entry)
	}

	statusCode := http.StatusOK
	entry := &models.AuditLogEntry{
		ID:               uuid.New().String(),
		Timestamp:        time.Now(),
		UserID:           &userID2,
		Username:         "user2",
		Action:           "delete",
		StatusCode:       &statusCode,
		RequestIP:        "192.168.1.100",
	}
	repo.CreateAuditLog(context.Background(), entry)

	entries, err := repo.ListAuditLog(context.Background(), &userID1, nil, nil, nil, nil, 10)
	if err != nil {
		t.Fatalf("Failed to list audit log: %v", err)
	}
	if len(entries) != 3 {
		t.Errorf("Expected 3 entries for user-1, got %d", len(entries))
	}
}

func TestListAuditLog_ByClusterID(t *testing.T) {
	repo := setupTestRepoForAuditLogs(t)
	defer repo.Close()

	clusterID1 := "cluster-1"
	clusterID2 := "cluster-2"

	// Create entries for different clusters
	for i := 0; i < 2; i++ {
		statusCode := http.StatusOK
		entry := &models.AuditLogEntry{
			ID:               uuid.New().String(),
			Timestamp:        time.Now(),
			Username:         "testuser",
			ClusterID:        &clusterID1,
			Action:           "create",
			StatusCode:       &statusCode,
			RequestIP:        "192.168.1.100",
		}
		repo.CreateAuditLog(context.Background(), entry)
	}

	statusCode := http.StatusOK
	entry := &models.AuditLogEntry{
		ID:               uuid.New().String(),
		Timestamp:        time.Now(),
		Username:         "testuser",
		ClusterID:        &clusterID2,
		Action:           "delete",
		StatusCode:       &statusCode,
		RequestIP:        "192.168.1.100",
	}
	repo.CreateAuditLog(context.Background(), entry)

	entries, err := repo.ListAuditLog(context.Background(), nil, &clusterID1, nil, nil, nil, 10)
	if err != nil {
		t.Fatalf("Failed to list audit log: %v", err)
	}
	if len(entries) != 2 {
		t.Errorf("Expected 2 entries for cluster-1, got %d", len(entries))
	}
}

func TestListAuditLog_ByAction(t *testing.T) {
	repo := setupTestRepoForAuditLogs(t)
	defer repo.Close()

	// Create entries with different actions
	actions := []string{"create", "update", "delete", "create", "delete"}
	for _, action := range actions {
		statusCode := http.StatusOK
		entry := &models.AuditLogEntry{
			ID:               uuid.New().String(),
			Timestamp:        time.Now(),
			Username:         "testuser",
			Action:           action,
			StatusCode:       &statusCode,
			RequestIP:        "192.168.1.100",
		}
		repo.CreateAuditLog(context.Background(), entry)
	}

	action := "create"
	entries, err := repo.ListAuditLog(context.Background(), nil, nil, &action, nil, nil, 10)
	if err != nil {
		t.Fatalf("Failed to list audit log: %v", err)
	}
	if len(entries) != 2 {
		t.Errorf("Expected 2 'create' entries, got %d", len(entries))
	}
}

func TestListAuditLog_WithTimeRange(t *testing.T) {
	repo := setupTestRepoForAuditLogs(t)
	defer repo.Close()

	now := time.Now()
	since := now.Add(-1 * time.Hour)
	until := now.Add(1 * time.Hour)

	// Create entry within range
	statusCode := http.StatusOK
	entry1 := &models.AuditLogEntry{
		ID:               uuid.New().String(),
		Timestamp:        now,
		Username:         "testuser",
		Action:           "create",
		StatusCode:       &statusCode,
		RequestIP:        "192.168.1.100",
	}
	repo.CreateAuditLog(context.Background(), entry1)

	// Create entry outside range
	entry2 := &models.AuditLogEntry{
		ID:               uuid.New().String(),
		Timestamp:        now.Add(-2 * time.Hour),
		Username:         "testuser",
		Action:           "create",
		StatusCode:       &statusCode,
		RequestIP:        "192.168.1.100",
	}
	repo.CreateAuditLog(context.Background(), entry2)

	entries, err := repo.ListAuditLog(context.Background(), nil, nil, nil, &since, &until, 10)
	if err != nil {
		t.Fatalf("Failed to list audit log: %v", err)
	}
	if len(entries) < 1 {
		t.Error("Expected at least 1 entry within time range")
	}
}

func TestListAuditLog_WithLimit(t *testing.T) {
	repo := setupTestRepoForAuditLogs(t)
	defer repo.Close()

	// Create 10 entries
	for i := 0; i < 10; i++ {
		statusCode := http.StatusOK
		entry := &models.AuditLogEntry{
			ID:               uuid.New().String(),
			Timestamp:        time.Now(),
			Username:         "testuser",
			Action:           "create",
			StatusCode:       &statusCode,
			RequestIP:        "192.168.1.100",
		}
		repo.CreateAuditLog(context.Background(), entry)
	}

	entries, err := repo.ListAuditLog(context.Background(), nil, nil, nil, nil, nil, 5)
	if err != nil {
		t.Fatalf("Failed to list audit log: %v", err)
	}
	if len(entries) > 5 {
		t.Errorf("Expected at most 5 entries, got %d", len(entries))
	}
}

func TestListAuditLog_DefaultLimit(t *testing.T) {
	repo := setupTestRepoForAuditLogs(t)
	defer repo.Close()

	// Create 150 entries (more than default limit of 100)
	for i := 0; i < 150; i++ {
		statusCode := http.StatusOK
		entry := &models.AuditLogEntry{
			ID:               uuid.New().String(),
			Timestamp:        time.Now(),
			Username:         "testuser",
			Action:           "create",
			StatusCode:       &statusCode,
			RequestIP:        "192.168.1.100",
		}
		repo.CreateAuditLog(context.Background(), entry)
	}

	entries, err := repo.ListAuditLog(context.Background(), nil, nil, nil, nil, nil, 0)
	if err != nil {
		t.Fatalf("Failed to list audit log: %v", err)
	}
	if len(entries) > 100 {
		t.Errorf("Expected at most 100 entries (default limit), got %d", len(entries))
	}
}

func TestCreateAuditLog_WithEnhancedFields(t *testing.T) {
	repo := setupTestRepoForAuditLogs(t)
	defer repo.Close()

	statusCode := http.StatusOK
	sessionID := "session-123"
	deviceInfo := "Mozilla/5.0"
	geolocation := "US/New York"
	riskScore := 50
	correlationID := "corr-123"

	userID := "user-123"
	clusterID := "cluster-123"
	resourceKind := "Pod"
	resourceNamespace := "default"
	resourceName := "test-pod"
	entry := &models.AuditLogEntry{
		ID:               uuid.New().String(),
		Timestamp:        time.Now(),
		UserID:           &userID,
		Username:         "testuser",
		ClusterID:        &clusterID,
		Action:           "create",
		ResourceKind:     &resourceKind,
		ResourceNamespace: &resourceNamespace,
		ResourceName:     &resourceName,
		StatusCode:       &statusCode,
		RequestIP:        "192.168.1.100",
		Details:          "POST /api/v1/clusters/cluster-123/resources/pods",
		SessionID:        &sessionID,
		DeviceInfo:       &deviceInfo,
		Geolocation:      &geolocation,
		RiskScore:        &riskScore,
		CorrelationID:    &correlationID,
	}

	err := repo.CreateAuditLog(context.Background(), entry)
	if err != nil {
		t.Fatalf("Failed to create audit log with enhanced fields: %v", err)
	}

	entries, err := repo.ListAuditLog(context.Background(), nil, nil, nil, nil, nil, 1)
	if err != nil {
		t.Fatalf("Failed to list audit log: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("Expected at least 1 entry")
	}
	if entries[0].SessionID == nil || *entries[0].SessionID != sessionID {
		t.Error("Session ID should be set")
	}
	if entries[0].RiskScore == nil || *entries[0].RiskScore != riskScore {
		t.Error("Risk score should be set")
	}
}
