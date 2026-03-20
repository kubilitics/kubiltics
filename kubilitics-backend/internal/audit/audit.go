package audit

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// CreateEntry writes an audit log entry (BE-SEC-002). Append-only.
func CreateEntry(ctx context.Context, repo *repository.SQLiteRepository, e *models.AuditLogEntry) {
	if repo == nil {
		return
	}
	if e.Timestamp.IsZero() {
		e.Timestamp = time.Now()
	}
	_ = repo.CreateAuditLog(ctx, e)
}

// RequestInfo extracts user and request metadata for audit logging.
func RequestInfo(r *http.Request, statusCode int) (userID *string, username string, requestIP string) {
	requestIP = r.RemoteAddr
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if idx := strings.Index(xff, ","); idx > 0 {
			requestIP = strings.TrimSpace(xff[:idx])
		} else {
			requestIP = strings.TrimSpace(xff)
		}
	}
	username = "anonymous"
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil {
		userID = &claims.UserID
		username = claims.Username
	}
	return userID, username, requestIP
}

// ActionFromRequest derives action and resource info from request path and method (BE-SEC-002).
func ActionFromRequest(r *http.Request) (action string, clusterID, resourceKind, resourceNamespace, resourceName *string) {
	vars := mux.Vars(r)
	if cid, ok := vars["clusterId"]; ok && cid != "" {
		clusterID = &cid
	}
	if k, ok := vars["kind"]; ok && k != "" {
		resourceKind = &k
	}
	if ns, ok := vars["namespace"]; ok && ns != "" {
		resourceNamespace = &ns
	}
	if n, ok := vars["name"]; ok && n != "" {
		resourceName = &n
	}
	path := r.URL.Path
	switch r.Method {
	case http.MethodPost:
		if strings.Contains(path, "/apply") {
			action = "apply"
		} else if strings.Contains(path, "/clusters") && !strings.Contains(path, "/resources") && len(vars) == 0 {
			action = "cluster_add"
		} else if strings.Contains(path, "/shell") || strings.Contains(path, "/exec") || strings.Contains(path, "/kcli/exec") {
			action = "exec"
		} else if strings.Contains(path, "/rollback") {
			action = "rollback"
		} else if strings.Contains(path, "/trigger") || strings.Contains(path, "/retry") {
			action = "trigger"
		} else {
			action = "post"
		}
	case http.MethodPatch:
		action = "patch"
	case http.MethodDelete:
		if strings.Contains(path, "/clusters/") && strings.Count(path, "/") <= 3 {
			action = "cluster_remove"
		} else {
			action = "delete"
		}
	default:
		action = strings.ToLower(r.Method)
	}
	return action, clusterID, resourceKind, resourceNamespace, resourceName
}
