package auth

// Role hierarchy: admin > operator > viewer
const (
	RoleViewer   = "viewer"
	RoleOperator = "operator"
	RoleAdmin    = "admin"
)

// HasRole checks if the user's role meets the minimum required role.
// Hierarchy: admin >= operator >= viewer
func HasRole(userRole, requiredRole string) bool {
	if userRole == RoleAdmin {
		return true // admin can do everything
	}
	if requiredRole == RoleViewer {
		return true // any role can view
	}
	if requiredRole == RoleOperator {
		return userRole == RoleOperator || userRole == RoleAdmin
	}
	if requiredRole == RoleAdmin {
		return userRole == RoleAdmin
	}
	return false
}

// EffectiveRole returns the effective role for a user on a cluster:
// - If clusterPermission exists, use that role
// - Otherwise, use user's default role
func EffectiveRole(userRole string, clusterPermission *string) string {
	if clusterPermission != nil && *clusterPermission != "" {
		return *clusterPermission
	}
	return userRole
}
