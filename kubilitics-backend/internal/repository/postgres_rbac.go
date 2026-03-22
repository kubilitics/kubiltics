package repository

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// Cluster permission methods (BE-AUTHZ-001)

func (r *PostgresRepository) CreateClusterPermission(ctx context.Context, cp *models.ClusterPermission) error {
	if cp.ID == "" {
		cp.ID = uuid.New().String()
	}
	query := `INSERT INTO cluster_permissions (id, user_id, cluster_id, role, created_at) VALUES ($1, $2, $3, $4, $5)`
	_, err := r.db.ExecContext(ctx, query, cp.ID, cp.UserID, cp.ClusterID, cp.Role, cp.CreatedAt)
	return err
}

func (r *PostgresRepository) GetClusterPermission(ctx context.Context, userID, clusterID string) (*models.ClusterPermission, error) {
	var cp models.ClusterPermission
	err := r.db.GetContext(ctx, &cp, `SELECT id, user_id, cluster_id, role, created_at FROM cluster_permissions WHERE user_id = $1 AND cluster_id = $2`, userID, clusterID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &cp, nil
}

func (r *PostgresRepository) UpdateClusterPermission(ctx context.Context, cp *models.ClusterPermission) error {
	_, err := r.db.ExecContext(ctx, `UPDATE cluster_permissions SET role = $1 WHERE user_id = $2 AND cluster_id = $3`, cp.Role, cp.UserID, cp.ClusterID)
	return err
}

func (r *PostgresRepository) DeleteClusterPermission(ctx context.Context, userID, clusterID string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM cluster_permissions WHERE user_id = $1 AND cluster_id = $2`, userID, clusterID)
	return err
}

func (r *PostgresRepository) ListClusterPermissionsByUser(ctx context.Context, userID string) ([]*models.ClusterPermission, error) {
	var perms []*models.ClusterPermission
	err := r.db.SelectContext(ctx, &perms, `SELECT id, user_id, cluster_id, role, created_at FROM cluster_permissions WHERE user_id = $1`, userID)
	return perms, err
}

func (r *PostgresRepository) ListClusterPermissionsByCluster(ctx context.Context, clusterID string) ([]*models.ClusterPermission, error) {
	var perms []*models.ClusterPermission
	err := r.db.SelectContext(ctx, &perms, `SELECT id, user_id, cluster_id, role, created_at FROM cluster_permissions WHERE cluster_id = $1`, clusterID)
	return perms, err
}

// Namespace permission methods (Phase 3: Advanced RBAC)

// CreateNamespacePermission creates a namespace-level permission
func (r *PostgresRepository) CreateNamespacePermission(ctx context.Context, perm *models.NamespacePermission) error {
	if perm.ID == "" {
		perm.ID = uuid.New().String()
	}
	query := `INSERT INTO namespace_permissions (id, user_id, cluster_id, namespace, role, created_at) VALUES ($1, $2, $3, $4, $5, $6)`
	_, err := r.db.ExecContext(ctx, query, perm.ID, perm.UserID, perm.ClusterID, perm.Namespace, perm.Role, perm.CreatedAt)
	return err
}

// GetNamespacePermission gets a namespace permission
func (r *PostgresRepository) GetNamespacePermission(ctx context.Context, userID, clusterID, namespace string) (*models.NamespacePermission, error) {
	var perm models.NamespacePermission
	query := `SELECT id, user_id, cluster_id, namespace, role, created_at FROM namespace_permissions WHERE user_id = $1 AND cluster_id = $2 AND namespace = $3`
	err := r.db.GetContext(ctx, &perm, query, userID, clusterID, namespace)
	if err != nil {
		return nil, err
	}
	return &perm, nil
}

// ListNamespacePermissionsByUser lists all namespace permissions for a user
func (r *PostgresRepository) ListNamespacePermissionsByUser(ctx context.Context, userID string) ([]*models.NamespacePermission, error) {
	var perms []*models.NamespacePermission
	query := `SELECT id, user_id, cluster_id, namespace, role, created_at FROM namespace_permissions WHERE user_id = $1`
	err := r.db.SelectContext(ctx, &perms, query, userID)
	return perms, err
}

// ListNamespacePermissionsByCluster lists all namespace permissions for a cluster
func (r *PostgresRepository) ListNamespacePermissionsByCluster(ctx context.Context, clusterID string) ([]*models.NamespacePermission, error) {
	var perms []*models.NamespacePermission
	query := `SELECT id, user_id, cluster_id, namespace, role, created_at FROM namespace_permissions WHERE cluster_id = $1`
	err := r.db.SelectContext(ctx, &perms, query, clusterID)
	return perms, err
}

// GetNamespacePermissionForResource gets the effective namespace permission for a user/cluster/namespace
// Checks both specific namespace permissions and wildcard permissions
func (r *PostgresRepository) GetNamespacePermissionForResource(ctx context.Context, userID, clusterID, namespace string) (*models.NamespacePermission, error) {
	// First check specific namespace permission
	perm, err := r.GetNamespacePermission(ctx, userID, clusterID, namespace)
	if err == nil && perm != nil {
		return perm, nil
	}
	// Then check wildcard permission
	perm, err = r.GetNamespacePermission(ctx, userID, clusterID, "*")
	if err == nil && perm != nil {
		return perm, nil
	}
	return nil, sql.ErrNoRows
}

// DeleteNamespacePermission deletes a namespace permission
func (r *PostgresRepository) DeleteNamespacePermission(ctx context.Context, permID string) error {
	query := `DELETE FROM namespace_permissions WHERE id = $1`
	_, err := r.db.ExecContext(ctx, query, permID)
	return err
}

// DeleteNamespacePermissionByUserClusterNamespace deletes a namespace permission by user/cluster/namespace
func (r *PostgresRepository) DeleteNamespacePermissionByUserClusterNamespace(ctx context.Context, userID, clusterID, namespace string) error {
	query := `DELETE FROM namespace_permissions WHERE user_id = $1 AND cluster_id = $2 AND namespace = $3`
	_, err := r.db.ExecContext(ctx, query, userID, clusterID, namespace)
	return err
}

// GetUserEffectiveClusterPermissions gets effective cluster permissions for a user (direct + group)
func (r *PostgresRepository) GetUserEffectiveClusterPermissions(ctx context.Context, userID string) ([]*models.ClusterPermission, error) {
	var perms []*models.ClusterPermission
	query := `
		SELECT DISTINCT cp.id, cp.user_id, cp.cluster_id, cp.role, cp.created_at
		FROM cluster_permissions cp
		WHERE cp.user_id = $1
		UNION
		SELECT DISTINCT cp.id, gcp.user_id, cp.cluster_id, cp.role, cp.created_at
		FROM cluster_permissions cp
		JOIN group_cluster_permissions gcp ON cp.id = gcp.permission_id
		JOIN group_members gm ON gcp.group_id = gm.group_id
		WHERE gm.user_id = $1
	`
	err := r.db.SelectContext(ctx, &perms, query, userID)
	return perms, err
}

// GetUserEffectiveNamespacePermissions gets effective namespace permissions for a user (direct + group)
func (r *PostgresRepository) GetUserEffectiveNamespacePermissions(ctx context.Context, userID string) ([]*models.NamespacePermission, error) {
	var perms []*models.NamespacePermission
	query := `
		SELECT DISTINCT np.id, np.user_id, np.cluster_id, np.namespace, np.role, np.created_at
		FROM namespace_permissions np
		WHERE np.user_id = $1
		UNION
		SELECT DISTINCT np.id, gnp.user_id, np.cluster_id, np.namespace, np.role, np.created_at
		FROM namespace_permissions np
		JOIN group_namespace_permissions gnp ON np.id = gnp.permission_id
		JOIN group_members gm ON gnp.group_id = gm.group_id
		WHERE gm.user_id = $1
	`
	err := r.db.SelectContext(ctx, &perms, query, userID)
	return perms, err
}

// Group methods

// CreateGroup creates a new group
func (r *PostgresRepository) CreateGroup(ctx context.Context, group *models.Group) error {
	if group.ID == "" {
		group.ID = uuid.New().String()
	}
	query := `INSERT INTO groups (id, name, description, created_at) VALUES ($1, $2, $3, $4)`
	_, err := r.db.ExecContext(ctx, query, group.ID, group.Name, group.Description, time.Now())
	return err
}

// GetGroup gets a group by ID
func (r *PostgresRepository) GetGroup(ctx context.Context, id string) (*models.Group, error) {
	var group models.Group
	err := r.db.GetContext(ctx, &group, `SELECT id, name, description, created_at FROM groups WHERE id = $1`, id)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &group, nil
}

// GetGroupByName gets a group by name
func (r *PostgresRepository) GetGroupByName(ctx context.Context, name string) (*models.Group, error) {
	var group models.Group
	err := r.db.GetContext(ctx, &group, `SELECT id, name, description, created_at FROM groups WHERE name = $1`, name)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &group, nil
}

// ListGroups lists all groups
func (r *PostgresRepository) ListGroups(ctx context.Context) ([]*models.Group, error) {
	var groups []*models.Group
	err := r.db.SelectContext(ctx, &groups, `SELECT id, name, description, created_at FROM groups ORDER BY name ASC`)
	return groups, err
}

// UpdateGroup updates a group
func (r *PostgresRepository) UpdateGroup(ctx context.Context, group *models.Group) error {
	query := `UPDATE groups SET name = $1, description = $2 WHERE id = $3`
	_, err := r.db.ExecContext(ctx, query, group.Name, group.Description, group.ID)
	return err
}

// DeleteGroup deletes a group
func (r *PostgresRepository) DeleteGroup(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM groups WHERE id = $1`, id)
	return err
}

// Group member methods

// AddGroupMember adds a user to a group
func (r *PostgresRepository) AddGroupMember(ctx context.Context, groupID, userID string) error {
	query := `INSERT INTO group_members (group_id, user_id, added_at) VALUES ($1, $2, NOW())`
	_, err := r.db.ExecContext(ctx, query, groupID, userID)
	return err
}

// RemoveGroupMember removes a user from a group
func (r *PostgresRepository) RemoveGroupMember(ctx context.Context, groupID, userID string) error {
	query := `DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`
	_, err := r.db.ExecContext(ctx, query, groupID, userID)
	return err
}

// ListGroupMembers lists all members of a group
func (r *PostgresRepository) ListGroupMembers(ctx context.Context, groupID string) ([]string, error) {
	var userIDs []string
	query := `SELECT user_id FROM group_members WHERE group_id = $1 ORDER BY added_at ASC`
	err := r.db.SelectContext(ctx, &userIDs, query, groupID)
	return userIDs, err
}

// ListUserGroups lists all groups a user belongs to
func (r *PostgresRepository) ListUserGroups(ctx context.Context, userID string) ([]*models.Group, error) {
	var groups []*models.Group
	query := `
		SELECT g.id, g.name, g.description, g.created_at
		FROM groups g
		JOIN group_members gm ON g.id = gm.group_id
		WHERE gm.user_id = $1
		ORDER BY g.name ASC
	`
	err := r.db.SelectContext(ctx, &groups, query, userID)
	return groups, err
}

// Group cluster permission methods

// CreateGroupClusterPermission adds cluster permission to a group
func (r *PostgresRepository) CreateGroupClusterPermission(ctx context.Context, perm *models.GroupClusterPermission) error {
	if perm.ID == "" {
		perm.ID = uuid.New().String()
	}
	perm.CreatedAt = time.Now()
	query := `INSERT INTO group_cluster_permissions (id, group_id, cluster_id, role, created_at) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (group_id, cluster_id) DO UPDATE SET role = EXCLUDED.role, created_at = EXCLUDED.created_at`
	_, err := r.db.ExecContext(ctx, query, perm.ID, perm.GroupID, perm.ClusterID, perm.Role, perm.CreatedAt)
	return err
}

// ListGroupClusterPermissions lists cluster permissions for a group
func (r *PostgresRepository) ListGroupClusterPermissions(ctx context.Context, groupID string) ([]*models.GroupClusterPermission, error) {
	var perms []*models.GroupClusterPermission
	query := `SELECT id, group_id, cluster_id, role, created_at FROM group_cluster_permissions WHERE group_id = $1`
	err := r.db.SelectContext(ctx, &perms, query, groupID)
	return perms, err
}

// DeleteGroupClusterPermission removes cluster permission from a group
func (r *PostgresRepository) DeleteGroupClusterPermission(ctx context.Context, groupID, permissionID string) error {
	query := `DELETE FROM group_cluster_permissions WHERE group_id = $1 AND id = $2`
	_, err := r.db.ExecContext(ctx, query, groupID, permissionID)
	return err
}

// Group namespace permission methods

// CreateGroupNamespacePermission adds namespace permission to a group
func (r *PostgresRepository) CreateGroupNamespacePermission(ctx context.Context, perm *models.GroupNamespacePermission) error {
	if perm.ID == "" {
		perm.ID = uuid.New().String()
	}
	perm.CreatedAt = time.Now()
	query := `INSERT INTO group_namespace_permissions (id, group_id, cluster_id, namespace, role, created_at) VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (group_id, cluster_id, namespace) DO UPDATE SET role = EXCLUDED.role, created_at = EXCLUDED.created_at`
	_, err := r.db.ExecContext(ctx, query, perm.ID, perm.GroupID, perm.ClusterID, perm.Namespace, perm.Role, perm.CreatedAt)
	return err
}

// ListGroupNamespacePermissions lists namespace permissions for a group
func (r *PostgresRepository) ListGroupNamespacePermissions(ctx context.Context, groupID string) ([]*models.GroupNamespacePermission, error) {
	var perms []*models.GroupNamespacePermission
	query := `SELECT id, group_id, cluster_id, namespace, role, created_at FROM group_namespace_permissions WHERE group_id = $1`
	err := r.db.SelectContext(ctx, &perms, query, groupID)
	return perms, err
}

// DeleteGroupNamespacePermission removes namespace permission from a group
func (r *PostgresRepository) DeleteGroupNamespacePermission(ctx context.Context, groupID, permissionID string) error {
	query := `DELETE FROM group_namespace_permissions WHERE group_id = $1 AND permission_id = $2`
	_, err := r.db.ExecContext(ctx, query, groupID, permissionID)
	return err
}

// OIDC Group Sync methods

// CreateOIDCGroupMapping creates an OIDC group mapping
func (r *PostgresRepository) CreateOIDCGroupMapping(ctx context.Context, mapping *models.OIDCGroupMapping) error {
	if mapping.ID == "" {
		mapping.ID = uuid.New().String()
	}
	mapping.CreatedAt = time.Now()
	query := `INSERT INTO oidc_group_mappings (id, group_id, oidc_group_name, created_at) VALUES ($1, $2, $3, $4)
		ON CONFLICT (group_id) DO UPDATE SET oidc_group_name = $3, created_at = $4`
	_, err := r.db.ExecContext(ctx, query, mapping.ID, mapping.GroupID, mapping.OIDCGroupName, mapping.CreatedAt)
	return err
}

// GetOIDCGroupMapping gets a group by OIDC group name
func (r *PostgresRepository) GetOIDCGroupMapping(ctx context.Context, oidcGroupName string) (*models.OIDCGroupMapping, error) {
	var mapping models.OIDCGroupMapping
	query := `SELECT id, group_id, oidc_group_name, created_at FROM oidc_group_mappings WHERE oidc_group_name = $1`
	err := r.db.GetContext(ctx, &mapping, query, oidcGroupName)
	if err != nil {
		return nil, err
	}
	return &mapping, nil
}

// ListOIDCGroupMappings lists all OIDC group mappings
func (r *PostgresRepository) ListOIDCGroupMappings(ctx context.Context) ([]*models.OIDCGroupMapping, error) {
	var mappings []*models.OIDCGroupMapping
	query := `SELECT id, group_id, oidc_group_name, created_at FROM oidc_group_mappings ORDER BY oidc_group_name ASC`
	err := r.db.SelectContext(ctx, &mappings, query)
	return mappings, err
}

// DeleteOIDCGroupMapping deletes an OIDC group mapping
func (r *PostgresRepository) DeleteOIDCGroupMapping(ctx context.Context, groupID string) error {
	query := `DELETE FROM oidc_group_mappings WHERE group_id = $1`
	_, err := r.db.ExecContext(ctx, query, groupID)
	return err
}
