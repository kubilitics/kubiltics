package middleware

import (
	"context"
	"log"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// contextKey is a custom type for context keys to avoid SA1029.
type contextKey string

const clusterPermissionsKey contextKey = "cluster_permissions"

// RequireRole returns middleware that enforces minimum role requirement (BE-AUTHZ-001).
// Phase 3: Checks namespace permission first (most specific), then cluster permission, then user's default role.
func RequireRole(repo *repository.SQLiteRepository, minRole string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := auth.ClaimsFromContext(r.Context())
			if claims == nil {
				writeJSONError(w, http.StatusUnauthorized, "Authentication required")
				return
			}
			userRole := claims.Role
			// Check if route has clusterId and namespace parameters
			vars := mux.Vars(r)
			clusterID := vars["clusterId"]
			namespace := vars["namespace"]
			
			if clusterID != "" {
				// Phase 3: Check namespace permission first (more specific)
				if namespace != "" {
					np, err := repo.GetNamespacePermissionForResource(r.Context(), claims.UserID, clusterID, namespace)
					if err == nil && np != nil {
						userRole = np.Role
					} else {
						// Fall back to cluster permission
						cp, err := repo.GetClusterPermission(r.Context(), claims.UserID, clusterID)
						if err == nil && cp != nil {
							userRole = cp.Role
						}
					}
				} else {
					// No namespace specified, check cluster permission
					cp, err := repo.GetClusterPermission(r.Context(), claims.UserID, clusterID)
					if err == nil && cp != nil {
						userRole = cp.Role
					}
				}
			}
			if !auth.HasRole(userRole, minRole) {
				// P2-SEC: Log authorization failure with user and required role for audit trail
				log.Printf("[rbac] DENIED: user=%s role=%s requires=%s for %s %s from %s",
					claims.Username, userRole, minRole, r.Method, r.URL.Path, r.RemoteAddr)
				writeJSONError(w, http.StatusForbidden, "Insufficient permissions")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireAdmin returns middleware that requires admin role (BE-AUTHZ-001).
func RequireAdmin(repo *repository.SQLiteRepository) func(http.Handler) http.Handler {
	return RequireRole(repo, auth.RoleAdmin)
}

// RequireOperator returns middleware that requires operator role or higher (BE-AUTHZ-001).
func RequireOperator(repo *repository.SQLiteRepository) func(http.Handler) http.Handler {
	return RequireRole(repo, auth.RoleOperator)
}

// RequireViewer returns middleware that requires viewer role or higher (BE-AUTHZ-001).
func RequireViewer(repo *repository.SQLiteRepository) func(http.Handler) http.Handler {
	return RequireRole(repo, auth.RoleViewer)
}

// WithUserPermissions adds user permissions to context (BE-AUTHZ-001).
func WithUserPermissions(ctx context.Context, repo *repository.SQLiteRepository, userID string) context.Context {
	perms, _ := repo.ListClusterPermissionsByUser(ctx, userID)
	permMap := make(map[string]string)
	for _, p := range perms {
		permMap[p.ClusterID] = p.Role
	}
	return context.WithValue(ctx, clusterPermissionsKey, permMap)
}

// GetClusterPermissions returns cluster permissions map from context.
func GetClusterPermissions(ctx context.Context) map[string]string {
	v := ctx.Value(clusterPermissionsKey)
	if v == nil {
		return nil
	}
	m, _ := v.(map[string]string)
	return m
}
