package rest

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// ComplianceHandler handles /api/v1/compliance/* endpoints
type ComplianceHandler struct {
	repo *repository.SQLiteRepository
	cfg  *config.Config
}

// NewComplianceHandler creates a new compliance handler
func NewComplianceHandler(repo *repository.SQLiteRepository, cfg *config.Config) *ComplianceHandler {
	return &ComplianceHandler{
		repo: repo,
		cfg:  cfg,
	}
}

// RegisterRoutes registers compliance routes
func (h *ComplianceHandler) RegisterRoutes(router *mux.Router) {
	router.HandleFunc("/compliance/user-access-report", h.GetUserAccessReport).Methods("GET")
	router.HandleFunc("/compliance/permission-matrix", h.GetPermissionMatrix).Methods("GET")
	router.HandleFunc("/compliance/audit-summary", h.GetAuditSummary).Methods("GET")
	router.HandleFunc("/compliance/export", h.ExportReport).Methods("GET")
}

// UserAccessReportResponse represents a user access report
type UserAccessReportResponse struct {
	GeneratedAt time.Time               `json:"generated_at"`
	Users       []UserAccessReportEntry `json:"users"`
	Summary     UserAccessReportSummary `json:"summary"`
}

// UserAccessReportEntry represents a single user's access
type UserAccessReportEntry struct {
	UserID               string                       `json:"user_id"`
	Username             string                       `json:"username"`
	Role                 string                       `json:"role"`
	Groups               []string                     `json:"groups"`
	ClusterPermissions   map[string]string            `json:"cluster_permissions"`   // cluster_id -> role
	NamespacePermissions map[string]map[string]string `json:"namespace_permissions"` // cluster_id -> namespace -> role
	LastLogin            *time.Time                   `json:"last_login,omitempty"`
	MFAEnabled           bool                         `json:"mfa_enabled"`
	AccountStatus        string                       `json:"account_status"` // active, locked, deleted
}

// UserAccessReportSummary provides summary statistics
type UserAccessReportSummary struct {
	TotalUsers               int `json:"total_users"`
	ActiveUsers              int `json:"active_users"`
	LockedUsers              int `json:"locked_users"`
	UsersWithMFA             int `json:"users_with_mfa"`
	UsersWithClusterAccess   int `json:"users_with_cluster_access"`
	UsersWithNamespaceAccess int `json:"users_with_namespace_access"`
}

// GetUserAccessReport generates a user access report
func (h *ComplianceHandler) GetUserAccessReport(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	ctx := r.Context()
	users, err := h.repo.ListUsers(ctx)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to list users: "+err.Error())
		return
	}

	report := UserAccessReportResponse{
		GeneratedAt: time.Now(),
		Users:       make([]UserAccessReportEntry, 0, len(users)),
		Summary:     UserAccessReportSummary{},
	}

	for _, user := range users {
		entry := UserAccessReportEntry{
			UserID:               user.ID,
			Username:             user.Username,
			Role:                 user.Role,
			ClusterPermissions:   make(map[string]string),
			NamespacePermissions: make(map[string]map[string]string),
			LastLogin:            user.LastLogin,
			AccountStatus:        "active",
		}

		// Check account status
		if user.IsDeleted() {
			entry.AccountStatus = "deleted"
		} else if user.IsLocked() {
			entry.AccountStatus = "locked"
		}

		// Get MFA status
		mfaSecret, _ := h.repo.GetMFATOTPSecret(ctx, user.ID)
		entry.MFAEnabled = mfaSecret != nil && mfaSecret.Enabled
		if entry.MFAEnabled {
			report.Summary.UsersWithMFA++
		}

		// Get groups
		groups, _ := h.repo.ListUserGroups(ctx, user.ID)
		entry.Groups = make([]string, len(groups))
		for i, g := range groups {
			entry.Groups[i] = g.Name
		}

		// Get cluster permissions (direct + group)
		clusterPerms, _ := h.repo.GetUserEffectiveClusterPermissions(ctx, user.ID)
		entry.ClusterPermissions = clusterPerms
		if len(clusterPerms) > 0 {
			report.Summary.UsersWithClusterAccess++
		}

		// Get namespace permissions per cluster
		for clusterID := range clusterPerms {
			nsPerms, _ := h.repo.GetUserEffectiveNamespacePermissions(ctx, user.ID, clusterID)
			if len(nsPerms) > 0 {
				entry.NamespacePermissions[clusterID] = nsPerms
				report.Summary.UsersWithNamespaceAccess++
			}
		}

		report.Users = append(report.Users, entry)

		// Update summary
		switch entry.AccountStatus {
		case "active":
			report.Summary.ActiveUsers++
		case "locked":
			report.Summary.LockedUsers++
		}
	}

	report.Summary.TotalUsers = len(users)

	format := r.URL.Query().Get("format")
	if format == "csv" {
		h.exportUserAccessReportCSV(w, report)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(report)
}

// PermissionMatrixResponse represents a permission matrix
type PermissionMatrixResponse struct {
	GeneratedAt time.Time               `json:"generated_at"`
	Matrix      []PermissionMatrixEntry `json:"matrix"`
}

// PermissionMatrixEntry represents a single permission entry
type PermissionMatrixEntry struct {
	UserID       string `json:"user_id"`
	Username     string `json:"username"`
	ResourceType string `json:"resource_type"` // cluster, namespace
	ResourceID   string `json:"resource_id"`   // cluster_id or cluster_id/namespace
	Role         string `json:"role"`
	Source       string `json:"source"` // direct, group
	GroupName    string `json:"group_name,omitempty"`
}

// GetPermissionMatrix generates a permission matrix
func (h *ComplianceHandler) GetPermissionMatrix(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	ctx := r.Context()
	users, err := h.repo.ListUsers(ctx)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to list users: "+err.Error())
		return
	}

	matrix := make([]PermissionMatrixEntry, 0)

	for _, user := range users {
		if user.IsDeleted() {
			continue
		}

		// Direct cluster permissions
		clusterPerms, _ := h.repo.ListClusterPermissionsByUser(ctx, user.ID)
		for _, perm := range clusterPerms {
			matrix = append(matrix, PermissionMatrixEntry{
				UserID:       user.ID,
				Username:     user.Username,
				ResourceType: "cluster",
				ResourceID:   perm.ClusterID,
				Role:         perm.Role,
				Source:       "direct",
			})
		}

		// Direct namespace permissions
		nsPerms, _ := h.repo.ListNamespacePermissionsByUser(ctx, user.ID)
		for _, perm := range nsPerms {
			matrix = append(matrix, PermissionMatrixEntry{
				UserID:       user.ID,
				Username:     user.Username,
				ResourceType: "namespace",
				ResourceID:   fmt.Sprintf("%s/%s", perm.ClusterID, perm.Namespace),
				Role:         perm.Role,
				Source:       "direct",
			})
		}

		// Group permissions
		groups, _ := h.repo.ListUserGroups(ctx, user.ID)
		for _, group := range groups {
			// Group cluster permissions
			groupClusterPerms, _ := h.repo.ListGroupClusterPermissions(ctx, group.ID)
			for _, perm := range groupClusterPerms {
				matrix = append(matrix, PermissionMatrixEntry{
					UserID:       user.ID,
					Username:     user.Username,
					ResourceType: "cluster",
					ResourceID:   perm.ClusterID,
					Role:         perm.Role,
					Source:       "group",
					GroupName:    group.Name,
				})
			}

			// Group namespace permissions
			groupNsPerms, _ := h.repo.ListGroupNamespacePermissions(ctx, group.ID)
			for _, perm := range groupNsPerms {
				matrix = append(matrix, PermissionMatrixEntry{
					UserID:       user.ID,
					Username:     user.Username,
					ResourceType: "namespace",
					ResourceID:   fmt.Sprintf("%s/%s", perm.ClusterID, perm.Namespace),
					Role:         perm.Role,
					Source:       "group",
					GroupName:    group.Name,
				})
			}
		}
	}

	response := PermissionMatrixResponse{
		GeneratedAt: time.Now(),
		Matrix:      matrix,
	}

	format := r.URL.Query().Get("format")
	if format == "csv" {
		h.exportPermissionMatrixCSV(w, response)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(response)
}

// AuditSummaryResponse represents an audit log summary
type AuditSummaryResponse struct {
	GeneratedAt     time.Time               `json:"generated_at"`
	Period          string                  `json:"period"` // e.g., "last_30_days"
	TotalEvents     int                     `json:"total_events"`
	EventsByAction  map[string]int          `json:"events_by_action"`
	EventsByUser    map[string]int          `json:"events_by_user"`
	EventsByCluster map[string]int          `json:"events_by_cluster"`
	HighRiskEvents  int                     `json:"high_risk_events"`
	RecentEvents    []*models.AuditLogEntry `json:"recent_events"`
}

// GetAuditSummary generates an audit log summary
func (h *ComplianceHandler) GetAuditSummary(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	// Parse period (default: last 30 days)
	periodStr := r.URL.Query().Get("period")
	if periodStr == "" {
		periodStr = "30d"
	}

	var since time.Time
	switch periodStr {
	case "7d":
		since = time.Now().Add(-7 * 24 * time.Hour)
	case "30d":
		since = time.Now().Add(-30 * 24 * time.Hour)
	case "90d":
		since = time.Now().Add(-90 * 24 * time.Hour)
	default:
		if days, err := strconv.Atoi(strings.TrimSuffix(periodStr, "d")); err == nil {
			since = time.Now().Add(-time.Duration(days) * 24 * time.Hour)
		} else {
			since = time.Now().Add(-30 * 24 * time.Hour)
		}
	}

	ctx := r.Context()
	events, err := h.repo.ListAuditLog(ctx, nil, nil, nil, &since, nil, 10000)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to list audit log: "+err.Error())
		return
	}

	summary := AuditSummaryResponse{
		GeneratedAt:     time.Now(),
		Period:          periodStr,
		TotalEvents:     len(events),
		EventsByAction:  make(map[string]int),
		EventsByUser:    make(map[string]int),
		EventsByCluster: make(map[string]int),
		HighRiskEvents:  0,
		RecentEvents:    events,
	}

	// Count events
	for _, event := range events {
		summary.EventsByAction[event.Action]++
		if event.UserID != nil {
			summary.EventsByUser[*event.UserID]++
		}
		if event.ClusterID != nil {
			summary.EventsByCluster[*event.ClusterID]++
		}
		if event.RiskScore != nil && *event.RiskScore >= 80 {
			summary.HighRiskEvents++
		}
	}

	format := r.URL.Query().Get("format")
	if format == "csv" {
		h.exportAuditSummaryCSV(w, summary)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(summary)
}

// ExportReport exports a report in the requested format
func (h *ComplianceHandler) ExportReport(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	reportType := r.URL.Query().Get("type")
	format := r.URL.Query().Get("format")

	switch reportType {
	case "user-access":
		h.GetUserAccessReport(w, r)
	case "permission-matrix":
		h.GetPermissionMatrix(w, r)
	case "audit-summary":
		h.GetAuditSummary(w, r)
	default:
		respondError(w, http.StatusBadRequest, "Invalid report type. Must be: user-access, permission-matrix, or audit-summary")
		return
	}

	// Format handling is done in individual handlers
	_ = format
}

// CSV export helpers

func (h *ComplianceHandler) exportUserAccessReportCSV(w http.ResponseWriter, report UserAccessReportResponse) {
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=user-access-report-%s.csv", time.Now().Format("20060102-150405")))
	writer := csv.NewWriter(w)
	defer writer.Flush()

	// Header
	_ = writer.Write([]string{"User ID", "Username", "Role", "Groups", "Cluster Permissions", "Namespace Permissions", "Last Login", "MFA Enabled", "Account Status"})

	// Data rows
	for _, entry := range report.Users {
		groupsStr := strings.Join(entry.Groups, "; ")
		clusterPermsStr := ""
		for clusterID, role := range entry.ClusterPermissions {
			clusterPermsStr += fmt.Sprintf("%s:%s; ", clusterID, role)
		}
		clusterPermsStr = strings.TrimSuffix(clusterPermsStr, "; ")

		nsPermsStr := ""
		for clusterID, nsPerms := range entry.NamespacePermissions {
			for ns, role := range nsPerms {
				nsPermsStr += fmt.Sprintf("%s/%s:%s; ", clusterID, ns, role)
			}
		}
		nsPermsStr = strings.TrimSuffix(nsPermsStr, "; ")

		lastLoginStr := ""
		if entry.LastLogin != nil {
			lastLoginStr = entry.LastLogin.Format(time.RFC3339)
		}

		_ = writer.Write([]string{
			entry.UserID,
			entry.Username,
			entry.Role,
			groupsStr,
			clusterPermsStr,
			nsPermsStr,
			lastLoginStr,
			strconv.FormatBool(entry.MFAEnabled),
			entry.AccountStatus,
		})
	}
}

func (h *ComplianceHandler) exportPermissionMatrixCSV(w http.ResponseWriter, response PermissionMatrixResponse) {
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=permission-matrix-%s.csv", time.Now().Format("20060102-150405")))
	writer := csv.NewWriter(w)
	defer writer.Flush()

	// Header
	_ = writer.Write([]string{"User ID", "Username", "Resource Type", "Resource ID", "Role", "Source", "Group Name"})

	// Data rows
	for _, entry := range response.Matrix {
		_ = writer.Write([]string{
			entry.UserID,
			entry.Username,
			entry.ResourceType,
			entry.ResourceID,
			entry.Role,
			entry.Source,
			entry.GroupName,
		})
	}
}

func (h *ComplianceHandler) exportAuditSummaryCSV(w http.ResponseWriter, summary AuditSummaryResponse) {
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=audit-summary-%s.csv", time.Now().Format("20060102-150405")))
	writer := csv.NewWriter(w)
	defer writer.Flush()

	// Header
	_ = writer.Write([]string{"Timestamp", "User ID", "Username", "Action", "Resource Type", "Resource Name", "Cluster ID", "Namespace", "IP Address", "Risk Score", "Details"})

	// Data rows
	for _, event := range summary.RecentEvents {
		userIDStr := ""
		if event.UserID != nil {
			userIDStr = *event.UserID
		}
		clusterIDStr := ""
		if event.ClusterID != nil {
			clusterIDStr = *event.ClusterID
		}
		riskScoreStr := ""
		if event.RiskScore != nil {
			riskScoreStr = strconv.Itoa(*event.RiskScore)
		}

		// Parse details JSON to extract resource info if available
		resourceType := ""
		resourceName := ""
		namespace := ""
		ipAddress := ""
		if event.Details != "" {
			var details map[string]interface{}
			if err := json.Unmarshal([]byte(event.Details), &details); err == nil {
				if rt, ok := details["resource_type"].(string); ok {
					resourceType = rt
				}
				if rn, ok := details["resource_name"].(string); ok {
					resourceName = rn
				}
				if ns, ok := details["namespace"].(string); ok {
					namespace = ns
				}
				if ip, ok := details["ip_address"].(string); ok {
					ipAddress = ip
				}
			}
		}

		_ = writer.Write([]string{
			event.Timestamp.Format(time.RFC3339),
			userIDStr,
			event.Username,
			event.Action,
			resourceType,
			resourceName,
			clusterIDStr,
			namespace,
			ipAddress,
			riskScoreStr,
			event.Details,
		})
	}
}
