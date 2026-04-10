package relationships

import (
	"context"
	"testing"

	v2 "github.com/kubilitics/kubilitics-backend/internal/topology/v2"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestRBACMatcher_Name(t *testing.T) {
	m := RBACMatcher{}
	if m.Name() != "rbac" {
		t.Errorf("expected name 'rbac', got %q", m.Name())
	}
}

func TestRBACMatcher_NilBundle(t *testing.T) {
	m := &RBACMatcher{}
	edges, err := m.Match(context.Background(), nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if edges != nil {
		t.Errorf("expected nil for nil bundle, got %v", edges)
	}
}

func TestRBACMatcher_EmptyBundle(t *testing.T) {
	m := &RBACMatcher{}
	edges, err := m.Match(context.Background(), &v2.ResourceBundle{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(edges) != 0 {
		t.Errorf("expected 0 edges for empty bundle, got %d", len(edges))
	}
}

func TestRBACMatcher_ValidRoleBinding(t *testing.T) {
	rb := rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-rb",
			Namespace: "default",
		},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "Role",
			Name:     "my-role",
		},
		Subjects: []rbacv1.Subject{
			{
				Kind:      rbacv1.ServiceAccountKind,
				Name:      "my-sa",
				Namespace: "default",
			},
		},
	}

	bundle := &v2.ResourceBundle{
		RoleBindings: []rbacv1.RoleBinding{rb},
	}

	m := &RBACMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Expect: RoleBinding→Role edge + ServiceAccount→RoleBinding edge
	if len(edges) < 2 {
		t.Errorf("expected at least 2 edges (binding+subject), got %d", len(edges))
	}

	rbID := v2.NodeID("RoleBinding", "default", "my-rb")
	roleID := v2.NodeID("Role", "default", "my-role")
	saID := v2.NodeID("ServiceAccount", "default", "my-sa")

	var hasBindEdge, hasSAEdge bool
	for _, e := range edges {
		if e.Source == rbID && e.Target == roleID && e.RelationshipType == "role_binding" {
			hasBindEdge = true
		}
		if e.Source == saID && e.Target == rbID {
			hasSAEdge = true
		}
	}
	if !hasBindEdge {
		t.Error("expected RoleBinding→Role edge")
	}
	if !hasSAEdge {
		t.Error("expected ServiceAccount→RoleBinding edge")
	}
}

func TestRBACMatcher_RoleBindingEmptyRoleRef_Skipped(t *testing.T) {
	rb := rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "empty-rb",
			Namespace: "default",
		},
		RoleRef: rbacv1.RoleRef{
			Name: "", // empty — should skip
		},
	}

	bundle := &v2.ResourceBundle{
		RoleBindings: []rbacv1.RoleBinding{rb},
	}

	m := &RBACMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(edges) != 0 {
		t.Errorf("expected 0 edges for empty RoleRef.Name, got %d", len(edges))
	}
}

func TestRBACMatcher_ValidClusterRoleBinding(t *testing.T) {
	crb := rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name: "my-crb",
		},
		RoleRef: rbacv1.RoleRef{
			APIGroup: "rbac.authorization.k8s.io",
			Kind:     "ClusterRole",
			Name:     "my-cluster-role",
		},
		Subjects: []rbacv1.Subject{
			{
				Kind:      rbacv1.ServiceAccountKind,
				Name:      "my-sa",
				Namespace: "default",
			},
		},
	}

	bundle := &v2.ResourceBundle{
		ClusterRoleBindings: []rbacv1.ClusterRoleBinding{crb},
	}

	m := &RBACMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Expect: ClusterRoleBinding→ClusterRole + SA→ClusterRoleBinding
	if len(edges) < 2 {
		t.Errorf("expected at least 2 edges, got %d", len(edges))
	}

	crbID := v2.NodeID("ClusterRoleBinding", "", "my-crb")
	crID := v2.NodeID("ClusterRole", "", "my-cluster-role")
	saID := v2.NodeID("ServiceAccount", "default", "my-sa")

	var hasBindEdge, hasSAEdge bool
	for _, e := range edges {
		if e.Source == crbID && e.Target == crID {
			hasBindEdge = true
		}
		if e.Source == saID && e.Target == crbID {
			hasSAEdge = true
		}
	}
	if !hasBindEdge {
		t.Error("expected ClusterRoleBinding→ClusterRole edge")
	}
	if !hasSAEdge {
		t.Error("expected ServiceAccount→ClusterRoleBinding edge")
	}
}

func TestRBACMatcher_ClusterRoleBindingEmptyRoleRef_Skipped(t *testing.T) {
	crb := rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name: "empty-crb",
		},
		RoleRef: rbacv1.RoleRef{
			Name: "", // empty — should skip
		},
	}

	bundle := &v2.ResourceBundle{
		ClusterRoleBindings: []rbacv1.ClusterRoleBinding{crb},
	}

	m := &RBACMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(edges) != 0 {
		t.Errorf("expected 0 edges for empty RoleRef.Name on ClusterRoleBinding, got %d", len(edges))
	}
}

func TestRBACMatcher_UserAndGroupSubjects(t *testing.T) {
	rb := rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "user-group-rb",
			Namespace: "default",
		},
		RoleRef: rbacv1.RoleRef{
			Kind: "Role",
			Name: "viewer",
		},
		Subjects: []rbacv1.Subject{
			{Kind: rbacv1.UserKind, Name: "alice"},
			{Kind: rbacv1.GroupKind, Name: "devs"},
		},
	}

	bundle := &v2.ResourceBundle{
		RoleBindings: []rbacv1.RoleBinding{rb},
	}

	m := &RBACMatcher{}
	edges, err := m.Match(context.Background(), bundle)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// 1 role_binding edge + 1 user + 1 group = 3
	if len(edges) != 3 {
		t.Errorf("expected 3 edges (role + user + group), got %d", len(edges))
	}
}
