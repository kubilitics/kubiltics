package relationships

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
	rbacv1 "k8s.io/api/rbac/v1"
)

// RBACMatcher produces ServiceAccount→RoleBinding→Role and ServiceAccount→ClusterRoleBinding→ClusterRole edges.
type RBACMatcher struct{}

func (RBACMatcher) Name() string { return "rbac" }

func (m *RBACMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}
	var edges []v2.TopologyEdge

	for i := range bundle.RoleBindings {
		rb := &bundle.RoleBindings[i]
		rbID := v2.NodeID("RoleBinding", rb.Namespace, rb.Name)
		roleID := v2.NodeID("Role", rb.Namespace, rb.RoleRef.Name)
		edges = append(edges, v2.TopologyEdge{
			ID:                   v2.EdgeID(rbID, roleID, "binds"),
			Source:               rbID,
			Target:               roleID,
			RelationshipType:     "role_binding",
			RelationshipCategory: "rbac",
			Label:                "binds",
			Detail:               "roleRef",
			Style:                "solid",
			Healthy:              true,
		})
		for _, subj := range rb.Subjects {
			if subj.Kind != rbacv1.ServiceAccountKind {
				continue
			}
			ns := subj.Namespace
			if ns == "" {
				ns = rb.Namespace
			}
			saID := v2.NodeID("ServiceAccount", ns, subj.Name)
			edges = append(edges, v2.TopologyEdge{
				ID:                   v2.EdgeID(saID, rbID, "bound by"),
				Source:               saID,
				Target:               rbID,
				RelationshipType:     "role_binding",
				RelationshipCategory: "rbac",
				Label:                "bound by",
				Detail:               "subjects",
				Style:                "solid",
				Healthy:              true,
			})
		}
	}
	for i := range bundle.ClusterRoleBindings {
		crb := &bundle.ClusterRoleBindings[i]
		crbID := v2.NodeID("ClusterRoleBinding", "", crb.Name)
		crID := v2.NodeID("ClusterRole", "", crb.RoleRef.Name)
		edges = append(edges, v2.TopologyEdge{
			ID:                   v2.EdgeID(crbID, crID, "binds"),
			Source:               crbID,
			Target:               crID,
			RelationshipType:     "cluster_role_binding",
			RelationshipCategory: "rbac",
			Label:                "binds",
			Detail:               "roleRef",
			Style:                "solid",
			Healthy:              true,
		})
		for _, subj := range crb.Subjects {
			if subj.Kind != rbacv1.ServiceAccountKind {
				continue
			}
			ns := subj.Namespace
			if ns == "" {
				ns = "default"
			}
			saID := v2.NodeID("ServiceAccount", ns, subj.Name)
			edges = append(edges, v2.TopologyEdge{
				ID:                   v2.EdgeID(saID, crbID, "bound by"),
				Source:               saID,
				Target:               crbID,
				RelationshipType:     "cluster_role_binding",
				RelationshipCategory: "rbac",
				Label:                "bound by",
				Detail:               "subjects",
				Style:                "solid",
				Healthy:              true,
			})
		}
	}
	return edges, nil
}
