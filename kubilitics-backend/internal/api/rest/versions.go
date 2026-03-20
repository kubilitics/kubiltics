package rest

import (
	"net/http"
)

// VersionsResponse represents the API versions response
type VersionsResponse struct {
	Versions []string `json:"versions"`
	Default  string   `json:"default"`
	Latest   string   `json:"latest"`
}

// GetVersions handles GET /api/versions - API version discovery
func (h *Handler) GetVersions(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, VersionsResponse{
		Versions: []string{"v1"},
		Default:  "v1",
		Latest:   "v1",
	})
}
