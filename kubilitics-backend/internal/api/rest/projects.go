package rest

import (
	"encoding/json"
	"net/http"

	"github.com/gorilla/mux"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
	"github.com/kubilitics/kubilitics-backend/internal/service"
)

// ProjectService is optional; if nil, project routes return 501.
func (h *Handler) projectService() service.ProjectService {
	if h.projSvc == nil {
		return nil
	}
	return h.projSvc
}

// ListProjects handles GET /projects
func (h *Handler) ListProjects(w http.ResponseWriter, r *http.Request) {
	svc := h.projectService()
	if svc == nil {
		respondError(w, http.StatusNotImplemented, "Projects not configured")
		return
	}
	list, err := svc.ListProjects(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, list)
}

// GetProject handles GET /projects/{projectId}
func (h *Handler) GetProject(w http.ResponseWriter, r *http.Request) {
	svc := h.projectService()
	if svc == nil {
		respondError(w, http.StatusNotImplemented, "Projects not configured")
		return
	}
	vars := mux.Vars(r)
	projectID := vars["projectId"]
	if projectID == "" {
		respondError(w, http.StatusBadRequest, "projectId required")
		return
	}
	proj, err := svc.GetProject(r.Context(), projectID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, proj)
}

// CreateProject handles POST /projects
func (h *Handler) CreateProject(w http.ResponseWriter, r *http.Request) {
	svc := h.projectService()
	if svc == nil {
		respondError(w, http.StatusNotImplemented, "Projects not configured")
		return
	}
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if errMsg := validate.ResourceName(req.Name); errMsg != "" {
		respondError(w, http.StatusBadRequest, errMsg)
		return
	}
	p := &models.Project{Name: req.Name, Description: req.Description}
	created, err := svc.CreateProject(r.Context(), p)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondJSON(w, http.StatusCreated, created)
}

// UpdateProject handles PATCH /projects/{projectId}
func (h *Handler) UpdateProject(w http.ResponseWriter, r *http.Request) {
	svc := h.projectService()
	if svc == nil {
		respondError(w, http.StatusNotImplemented, "Projects not configured")
		return
	}
	vars := mux.Vars(r)
	projectID := vars["projectId"]
	if projectID == "" {
		respondError(w, http.StatusBadRequest, "projectId required")
		return
	}
	var req struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	proj, err := svc.GetProject(r.Context(), projectID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	if req.Name != nil {
		if errMsg := validate.ResourceName(*req.Name); errMsg != "" {
			respondError(w, http.StatusBadRequest, errMsg)
			return
		}
		proj.Name = *req.Name
	}
	if req.Description != nil {
		proj.Description = *req.Description
	}
	if err := svc.UpdateProject(r.Context(), &proj.Project); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, proj.Project)
}

// DeleteProject handles DELETE /projects/{projectId}
func (h *Handler) DeleteProject(w http.ResponseWriter, r *http.Request) {
	svc := h.projectService()
	if svc == nil {
		respondError(w, http.StatusNotImplemented, "Projects not configured")
		return
	}
	vars := mux.Vars(r)
	projectID := vars["projectId"]
	if projectID == "" {
		respondError(w, http.StatusBadRequest, "projectId required")
		return
	}
	if err := svc.DeleteProject(r.Context(), projectID); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// AddClusterToProject handles POST /projects/{projectId}/clusters
func (h *Handler) AddClusterToProject(w http.ResponseWriter, r *http.Request) {
	svc := h.projectService()
	if svc == nil {
		respondError(w, http.StatusNotImplemented, "Projects not configured")
		return
	}
	vars := mux.Vars(r)
	projectID := vars["projectId"]
	if projectID == "" {
		respondError(w, http.StatusBadRequest, "projectId required")
		return
	}
	var req struct {
		ClusterID string `json:"cluster_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if req.ClusterID == "" {
		respondError(w, http.StatusBadRequest, "cluster_id is required")
		return
	}
	if err := svc.AddClusterToProject(r.Context(), projectID, req.ClusterID); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// RemoveClusterFromProject handles DELETE /projects/{projectId}/clusters/{clusterId}
func (h *Handler) RemoveClusterFromProject(w http.ResponseWriter, r *http.Request) {
	svc := h.projectService()
	if svc == nil {
		respondError(w, http.StatusNotImplemented, "Projects not configured")
		return
	}
	vars := mux.Vars(r)
	projectID := vars["projectId"]
	clusterID := vars["clusterId"]
	if projectID == "" || clusterID == "" {
		respondError(w, http.StatusBadRequest, "projectId and clusterId required")
		return
	}
	if err := svc.RemoveClusterFromProject(r.Context(), projectID, clusterID); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// AddNamespaceToProject handles POST /projects/{projectId}/namespaces
func (h *Handler) AddNamespaceToProject(w http.ResponseWriter, r *http.Request) {
	svc := h.projectService()
	if svc == nil {
		respondError(w, http.StatusNotImplemented, "Projects not configured")
		return
	}
	vars := mux.Vars(r)
	projectID := vars["projectId"]
	if projectID == "" {
		respondError(w, http.StatusBadRequest, "projectId required")
		return
	}
	var req struct {
		ClusterID     string `json:"cluster_id"`
		NamespaceName string `json:"namespace_name"`
		Team          string `json:"team"` // abc team, cde team, etc.
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if req.ClusterID == "" || req.NamespaceName == "" {
		respondError(w, http.StatusBadRequest, "cluster_id and namespace_name are required")
		return
	}
	if err := svc.AddNamespaceToProject(r.Context(), projectID, req.ClusterID, req.NamespaceName, req.Team); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// RemoveNamespaceFromProject handles DELETE /projects/{projectId}/namespaces/{clusterId}/{namespaceName}
func (h *Handler) RemoveNamespaceFromProject(w http.ResponseWriter, r *http.Request) {
	svc := h.projectService()
	if svc == nil {
		respondError(w, http.StatusNotImplemented, "Projects not configured")
		return
	}
	vars := mux.Vars(r)
	projectID := vars["projectId"]
	clusterID := vars["clusterId"]
	namespaceName := vars["namespaceName"]
	if projectID == "" || clusterID == "" || namespaceName == "" {
		respondError(w, http.StatusBadRequest, "projectId, clusterId, and namespaceName required")
		return
	}
	if err := svc.RemoveNamespaceFromProject(r.Context(), projectID, clusterID, namespaceName); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
