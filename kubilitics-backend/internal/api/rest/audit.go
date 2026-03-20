package rest

import (
	"encoding/csv"
	"net/http"
	"strconv"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// ListAuditLog handles GET /api/v1/audit-log (BE-SEC-002). Admin-only.
// Query params: user_id, cluster_id, action, since (RFC3339), until (RFC3339), limit (default 100), format=csv for export.
func (h *Handler) ListAuditLog(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != auth.RoleAdmin {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}
	q := r.URL.Query()
	var userID, clusterID, action *string
	if v := q.Get("user_id"); v != "" {
		userID = &v
	}
	if v := q.Get("cluster_id"); v != "" {
		clusterID = &v
	}
	if v := q.Get("action"); v != "" {
		action = &v
	}
	var since, until *time.Time
	if v := q.Get("since"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			since = &t
		}
	}
	if v := q.Get("until"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			until = &t
		}
	}
	limit := 100
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 10000 {
			limit = n
		}
	}
	if h.repo == nil {
		respondError(w, http.StatusInternalServerError, "Audit log not available")
		return
	}
	entries, err := h.repo.ListAuditLog(r.Context(), userID, clusterID, action, since, until, limit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if q.Get("format") == "csv" {
		exportAuditLogCSV(w, entries)
		return
	}
	respondJSON(w, http.StatusOK, entries)
}

func exportAuditLogCSV(w http.ResponseWriter, entries []*models.AuditLogEntry) {
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", "attachment; filename=audit-log.csv")
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"id", "timestamp", "user_id", "username", "cluster_id", "action", "resource_kind", "resource_namespace", "resource_name", "status_code", "request_ip", "details"})
	for _, e := range entries {
		userID := ""
		if e.UserID != nil {
			userID = *e.UserID
		}
		clusterID := ""
		if e.ClusterID != nil {
			clusterID = *e.ClusterID
		}
		kind := ""
		if e.ResourceKind != nil {
			kind = *e.ResourceKind
		}
		ns := ""
		if e.ResourceNamespace != nil {
			ns = *e.ResourceNamespace
		}
		name := ""
		if e.ResourceName != nil {
			name = *e.ResourceName
		}
		status := ""
		if e.StatusCode != nil {
			status = strconv.Itoa(*e.StatusCode)
		}
		_ = cw.Write([]string{
			e.ID,
			e.Timestamp.Format(time.RFC3339),
			userID,
			e.Username,
			clusterID,
			e.Action,
			kind,
			ns,
			name,
			status,
			e.RequestIP,
			e.Details,
		})
	}
	cw.Flush()
}
