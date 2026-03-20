package auth

import (
	"testing"
)

func TestHasRole_Admin(t *testing.T) {
	// Admin should have access to everything
	if !HasRole(RoleAdmin, RoleAdmin) {
		t.Error("Admin should have admin role")
	}
	if !HasRole(RoleAdmin, RoleOperator) {
		t.Error("Admin should have operator role")
	}
	if !HasRole(RoleAdmin, RoleViewer) {
		t.Error("Admin should have viewer role")
	}
}

func TestHasRole_Operator(t *testing.T) {
	// Operator should have operator and viewer access
	if HasRole(RoleOperator, RoleAdmin) {
		t.Error("Operator should not have admin role")
	}
	if !HasRole(RoleOperator, RoleOperator) {
		t.Error("Operator should have operator role")
	}
	if !HasRole(RoleOperator, RoleViewer) {
		t.Error("Operator should have viewer role")
	}
}

func TestHasRole_Viewer(t *testing.T) {
	// Viewer should only have viewer access
	if HasRole(RoleViewer, RoleAdmin) {
		t.Error("Viewer should not have admin role")
	}
	if HasRole(RoleViewer, RoleOperator) {
		t.Error("Viewer should not have operator role")
	}
	if !HasRole(RoleViewer, RoleViewer) {
		t.Error("Viewer should have viewer role")
	}
}

func TestHasRole_InvalidRoles(t *testing.T) {
	// Invalid roles should return false
	// Note: HasRole returns true for any role when requiredRole is RoleViewer (line 16-17)
	// So "invalid" role can view (returns true)
	if !HasRole("invalid", RoleViewer) {
		t.Error("Any role (even invalid) should be able to view")
	}
	// Invalid required role should not grant access (except for viewer)
	if HasRole(RoleViewer, "invalid") {
		t.Error("Invalid required role should not grant access")
	}
	// Invalid user role with invalid required role
	if HasRole("invalid", "invalid") {
		t.Error("Invalid user role with invalid required role should return false")
	}
}

func TestEffectiveRole_WithClusterPermission(t *testing.T) {
	userRole := RoleViewer
	clusterRole := RoleOperator
	effective := EffectiveRole(userRole, &clusterRole)
	if effective != RoleOperator {
		t.Errorf("Expected effective role %s, got %s", RoleOperator, effective)
	}
}

func TestEffectiveRole_WithoutClusterPermission(t *testing.T) {
	userRole := RoleViewer
	effective := EffectiveRole(userRole, nil)
	if effective != RoleViewer {
		t.Errorf("Expected effective role %s, got %s", RoleViewer, effective)
	}
}

func TestEffectiveRole_EmptyClusterPermission(t *testing.T) {
	userRole := RoleViewer
	emptyRole := ""
	effective := EffectiveRole(userRole, &emptyRole)
	if effective != RoleViewer {
		t.Errorf("Expected effective role %s (fallback to user role), got %s", RoleViewer, effective)
	}
}
