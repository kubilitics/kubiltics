package rest

import (
	"net/http"
	"strings"

	"github.com/gorilla/mux"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/clientcmd/api"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// GetKubeconfig handles GET /clusters/{clusterId}/kubeconfig
// Returns a minimal, context-specific kubeconfig YAML for the cluster (single context, cluster, user).
func (h *Handler) GetKubeconfig(w http.ResponseWriter, r *http.Request) {
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

	raw, err := clientcmd.LoadFromFile(cluster.KubeconfigPath)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to read kubeconfig")
		return
	}

	contextName := cluster.Context
	if contextName == "" {
		contextName = raw.CurrentContext
	}
	ctx, ok := raw.Contexts[contextName]
	if !ok {
		respondError(w, http.StatusBadRequest, "Context not found in kubeconfig")
		return
	}

	minimal := api.NewConfig()
	minimal.CurrentContext = contextName
	if raw.Clusters[ctx.Cluster] == nil {
		respondError(w, http.StatusBadRequest, "Cluster reference not found in kubeconfig")
		return
	}
	if raw.AuthInfos[ctx.AuthInfo] == nil {
		respondError(w, http.StatusBadRequest, "AuthInfo reference not found in kubeconfig")
		return
	}
	minimal.Clusters[ctx.Cluster] = raw.Clusters[ctx.Cluster]
	minimal.AuthInfos[ctx.AuthInfo] = raw.AuthInfos[ctx.AuthInfo]
	minimal.Contexts[contextName] = ctx

	yaml, err := clientcmd.Write(*minimal)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "Failed to encode kubeconfig")
		return
	}

	name := cluster.Name
	for _, c := range []string{"/", "\\", " "} {
		name = strings.ReplaceAll(name, c, "-")
	}
	if name == "" {
		name = "cluster"
	}
	w.Header().Set("Content-Type", "application/x-yaml")
	w.Header().Set("Content-Disposition", `attachment; filename="kubeconfig-`+name+`.yaml"`)
	w.WriteHeader(http.StatusOK)
	w.Write(yaml)
}
