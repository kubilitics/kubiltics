package rest

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/auth"
	"github.com/kubilitics/kubilitics-backend/internal/config"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/repository"
)

// GroupsHandler handles /api/v1/groups/* endpoints
type GroupsHandler struct {
	repo *repository.SQLiteRepository
	cfg  *config.Config
}

// NewGroupsHandler creates a new groups handler
func NewGroupsHandler(repo *repository.SQLiteRepository, cfg *config.Config) *GroupsHandler {
	return &GroupsHandler{
		repo: repo,
		cfg:  cfg,
	}
}

// RegisterRoutes registers group routes
func (h *GroupsHandler) RegisterRoutes(router *mux.Router) {
	router.HandleFunc("/groups", h.ListGroups).Methods("GET")
	router.HandleFunc("/groups", h.CreateGroup).Methods("POST")
	router.HandleFunc("/groups/{id}", h.GetGroup).Methods("GET")
	router.HandleFunc("/groups/{id}", h.UpdateGroup).Methods("PATCH")
	router.HandleFunc("/groups/{id}", h.DeleteGroup).Methods("DELETE")
	router.HandleFunc("/groups/{id}/members", h.ListGroupMembers).Methods("GET")
	router.HandleFunc("/groups/{id}/members", h.AddGroupMember).Methods("POST")
	router.HandleFunc("/groups/{id}/members/{userId}", h.RemoveGroupMember).Methods("DELETE")
	router.HandleFunc("/groups/{id}/cluster-permissions", h.ListGroupClusterPermissions).Methods("GET")
	router.HandleFunc("/groups/{id}/cluster-permissions", h.SetGroupClusterPermission).Methods("POST")
	router.HandleFunc("/groups/{id}/cluster-permissions/{clusterId}", h.DeleteGroupClusterPermission).Methods("DELETE")
	router.HandleFunc("/groups/{id}/namespace-permissions", h.ListGroupNamespacePermissions).Methods("GET")
	router.HandleFunc("/groups/{id}/namespace-permissions", h.SetGroupNamespacePermission).Methods("POST")
	router.HandleFunc("/groups/{id}/namespace-permissions/{clusterId}/{namespace}", h.DeleteGroupNamespacePermission).Methods("DELETE")
}

// ListGroups lists all groups
func (h *GroupsHandler) ListGroups(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	groups, err := h.repo.ListGroups(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to list groups: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(groups)
}

// CreateGroupRequest is the body for POST /groups
type CreateGroupRequest struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// CreateGroup creates a new group
func (h *GroupsHandler) CreateGroup(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	var req CreateGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.Name == "" {
		respondError(w, http.StatusBadRequest, "name required")
		return
	}

	group := &models.Group{
		Name:        req.Name,
		Description: req.Description,
	}

	if err := h.repo.CreateGroup(r.Context(), group); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to create group: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(group)
}

// GetGroup gets a group by ID
func (h *GroupsHandler) GetGroup(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	vars := mux.Vars(r)
	groupID := vars["id"]

	group, err := h.repo.GetGroup(r.Context(), groupID)
	if err != nil {
		respondError(w, http.StatusNotFound, "Group not found")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(group)
}

// UpdateGroupRequest is the body for PATCH /groups/{id}
type UpdateGroupRequest struct {
	Name        string `json:"name,omitempty"`
	Description string `json:"description,omitempty"`
}

// UpdateGroup updates a group
func (h *GroupsHandler) UpdateGroup(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	vars := mux.Vars(r)
	groupID := vars["id"]

	group, err := h.repo.GetGroup(r.Context(), groupID)
	if err != nil {
		respondError(w, http.StatusNotFound, "Group not found")
		return
	}

	var req UpdateGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.Name != "" {
		group.Name = req.Name
	}
	if req.Description != "" {
		group.Description = req.Description
	}

	if err := h.repo.UpdateGroup(r.Context(), group); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to update group: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(group)
}

// DeleteGroup deletes a group
func (h *GroupsHandler) DeleteGroup(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	vars := mux.Vars(r)
	groupID := vars["id"]

	if err := h.repo.DeleteGroup(r.Context(), groupID); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to delete group: "+err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ListGroupMembers lists members of a group
func (h *GroupsHandler) ListGroupMembers(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	vars := mux.Vars(r)
	groupID := vars["id"]

	members, err := h.repo.ListGroupMembers(r.Context(), groupID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to list members: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(members)
}

// AddGroupMemberRequest is the body for POST /groups/{id}/members
type AddGroupMemberRequest struct {
	UserID string `json:"user_id"`
	Role   string `json:"role,omitempty"` // member, admin (default: member)
}

// AddGroupMember adds a user to a group
func (h *GroupsHandler) AddGroupMember(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	vars := mux.Vars(r)
	groupID := vars["id"]

	var req AddGroupMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.UserID == "" {
		respondError(w, http.StatusBadRequest, "user_id required")
		return
	}

	if req.Role == "" {
		req.Role = "member"
	}

	member := &models.GroupMember{
		GroupID: groupID,
		UserID:  req.UserID,
		Role:    req.Role,
	}

	if err := h.repo.AddGroupMember(r.Context(), member); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to add member: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(member)
}

// RemoveGroupMember removes a user from a group
func (h *GroupsHandler) RemoveGroupMember(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	vars := mux.Vars(r)
	groupID := vars["id"]
	userID := vars["userId"]

	if err := h.repo.RemoveGroupMember(r.Context(), groupID, userID); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to remove member: "+err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ListGroupClusterPermissions lists cluster permissions for a group
func (h *GroupsHandler) ListGroupClusterPermissions(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	vars := mux.Vars(r)
	groupID := vars["id"]

	perms, err := h.repo.ListGroupClusterPermissions(r.Context(), groupID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to list permissions: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(perms)
}

// SetGroupClusterPermissionRequest is the body for POST /groups/{id}/cluster-permissions
type SetGroupClusterPermissionRequest struct {
	ClusterID string `json:"cluster_id"`
	Role      string `json:"role"` // viewer, operator, admin
}

// SetGroupClusterPermission sets a cluster permission for a group
func (h *GroupsHandler) SetGroupClusterPermission(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	vars := mux.Vars(r)
	groupID := vars["id"]

	var req SetGroupClusterPermissionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.ClusterID == "" || req.Role == "" {
		respondError(w, http.StatusBadRequest, "cluster_id and role required")
		return
	}

	if req.Role != "viewer" && req.Role != "operator" && req.Role != "admin" {
		respondError(w, http.StatusBadRequest, "role must be viewer, operator, or admin")
		return
	}

	perm := &models.GroupClusterPermission{
		GroupID:   groupID,
		ClusterID: req.ClusterID,
		Role:      req.Role,
	}

	if err := h.repo.CreateGroupClusterPermission(r.Context(), perm); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to set permission: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(perm)
}

// DeleteGroupClusterPermission deletes a cluster permission for a group
func (h *GroupsHandler) DeleteGroupClusterPermission(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	vars := mux.Vars(r)
	groupID := vars["id"]
	clusterID := vars["clusterId"]

	if err := h.repo.DeleteGroupClusterPermission(r.Context(), groupID, clusterID); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to delete permission: "+err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ListGroupNamespacePermissions lists namespace permissions for a group
func (h *GroupsHandler) ListGroupNamespacePermissions(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	vars := mux.Vars(r)
	groupID := vars["id"]

	perms, err := h.repo.ListGroupNamespacePermissions(r.Context(), groupID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to list permissions: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(perms)
}

// SetGroupNamespacePermissionRequest is the body for POST /groups/{id}/namespace-permissions
type SetGroupNamespacePermissionRequest struct {
	ClusterID string `json:"cluster_id"`
	Namespace string `json:"namespace"`
	Role      string `json:"role"` // viewer, operator, admin
}

// SetGroupNamespacePermission sets a namespace permission for a group
func (h *GroupsHandler) SetGroupNamespacePermission(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	vars := mux.Vars(r)
	groupID := vars["id"]

	var req SetGroupNamespacePermissionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.ClusterID == "" || req.Namespace == "" || req.Role == "" {
		respondError(w, http.StatusBadRequest, "cluster_id, namespace, and role required")
		return
	}

	if req.Role != "viewer" && req.Role != "operator" && req.Role != "admin" {
		respondError(w, http.StatusBadRequest, "role must be viewer, operator, or admin")
		return
	}

	perm := &models.GroupNamespacePermission{
		GroupID:   groupID,
		ClusterID: req.ClusterID,
		Namespace: req.Namespace,
		Role:      req.Role,
	}

	if err := h.repo.CreateGroupNamespacePermission(r.Context(), perm); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to set permission: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(perm)
}

// DeleteGroupNamespacePermission deletes a namespace permission for a group
func (h *GroupsHandler) DeleteGroupNamespacePermission(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil || claims.Role != "admin" {
		respondError(w, http.StatusForbidden, "Admin access required")
		return
	}

	vars := mux.Vars(r)
	groupID := vars["id"]
	clusterID := vars["clusterId"]
	namespace := vars["namespace"]

	if err := h.repo.DeleteGroupNamespacePermission(r.Context(), groupID, clusterID, namespace); err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to delete permission: "+err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
