package rest

import (
	"net/http"
	"strings"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
	"k8s.io/client-go/tools/clientcmd"
)

type kcliTUIStateResponse struct {
	ClusterID            string `json:"clusterId"`
	ClusterName          string `json:"clusterName"`
	Context              string `json:"context"`
	Namespace            string `json:"namespace"`
	AIEnabled            bool   `json:"aiEnabled"`
	KCLIAvailable        bool   `json:"kcliAvailable"`
	KCLIShellModeAllowed bool   `json:"kcliShellModeAllowed"`
}

// GetKCLITUIState handles GET /clusters/{clusterId}/kcli/tui/state.
// Returns effective context/namespace and feature switches required by frontend terminal/TUI integration.
func (h *Handler) GetKCLITUIState(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}
	resolvedID, err := h.resolveClusterID(r.Context(), clusterID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	cluster, err := h.clusterService.GetCluster(r.Context(), resolvedID)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	if cluster.KubeconfigPath == "" {
		respondError(w, http.StatusBadRequest, "Cluster has no kubeconfig path")
		return
	}
	cfg, err := clientcmd.LoadFromFile(cluster.KubeconfigPath)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to read kubeconfig")
		return
	}
	contextName := strings.TrimSpace(cluster.Context)
	if contextName == "" {
		contextName = strings.TrimSpace(cfg.CurrentContext)
	}
	namespace := "default"
	if contextName != "" {
		if ctxCfg, ok := cfg.Contexts[contextName]; ok && ctxCfg != nil {
			if ns := strings.TrimSpace(ctxCfg.Namespace); ns != "" {
				namespace = ns
			}
		}
	}
	_, kcliErr := resolveKCLIBinary()

	respondJSON(w, http.StatusOK, kcliTUIStateResponse{
		ClusterID:            resolvedID,
		ClusterName:          cluster.Name,
		Context:              contextName,
		Namespace:            namespace,
		AIEnabled:            isAIEnabled(),
		KCLIAvailable:        kcliErr == nil,
		KCLIShellModeAllowed: h.isKCLIShellModeAllowed(),
	})
}
