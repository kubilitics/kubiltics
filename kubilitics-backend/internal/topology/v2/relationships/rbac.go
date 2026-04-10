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
		if rb.RoleRef.Name == "" {
			continue
		}
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
			switch subj.Kind {
			case rbacv1.ServiceAccountKind:
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
			case rbacv1.UserKind:
				userID := v2.NodeID("User", "", subj.Name)
				edges = append(edges, v2.TopologyEdge{
					ID:                   v2.EdgeID(userID, rbID, "bound by"),
					Source:               userID,
					Target:               rbID,
					RelationshipType:     "role_binding",
					RelationshipCategory: "rbac",
					Label:                "bound by",
					Detail:               "subjects",
					Style:                "solid",
					Healthy:              true,
				})
			case rbacv1.GroupKind:
				groupID := v2.NodeID("Group", "", subj.Name)
				edges = append(edges, v2.TopologyEdge{
					ID:                   v2.EdgeID(groupID, rbID, "bound by"),
					Source:               groupID,
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
	}
	for i := range bundle.ClusterRoleBindings {
		crb := &bundle.ClusterRoleBindings[i]
		if crb.RoleRef.Name == "" {
			continue
		}
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
			switch subj.Kind {
			case rbacv1.ServiceAccountKind:
				ns := subj.Namespace
				if ns == "" {
					continue // Skip — namespace is required for SA subjects
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
			case rbacv1.UserKind:
				userID := v2.NodeID("User", "", subj.Name)
				edges = append(edges, v2.TopologyEdge{
					ID:                   v2.EdgeID(userID, crbID, "bound by"),
					Source:               userID,
					Target:               crbID,
					RelationshipType:     "cluster_role_binding",
					RelationshipCategory: "rbac",
					Label:                "bound by",
					Detail:               "subjects",
					Style:                "solid",
					Healthy:              true,
				})
			case rbacv1.GroupKind:
				groupID := v2.NodeID("Group", "", subj.Name)
				edges = append(edges, v2.TopologyEdge{
					ID:                   v2.EdgeID(groupID, crbID, "bound by"),
					Source:               groupID,
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
	}
	return edges, nil
}
