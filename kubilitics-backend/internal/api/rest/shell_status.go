package rest

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gorilla/mux"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
	"gopkg.in/yaml.v3"
	"k8s.io/client-go/tools/clientcmd"
)

type shellStatusResponse struct {
	ClusterID            string `json:"clusterId"`
	ClusterName          string `json:"clusterName"`
	Context              string `json:"context"`
	Namespace            string `json:"namespace"`
	KCLIAvailable        bool   `json:"kcliAvailable"`
	KCLIShellModeAllowed bool   `json:"kcliShellModeAllowed"`
	AIEnabled            bool   `json:"aiEnabled"`
}

// GetShellStatus handles GET /clusters/{clusterId}/shell/status.
// Returns effective shell metadata (context + default namespace) and feature availability.
func (h *Handler) GetShellStatus(w http.ResponseWriter, r *http.Request) {
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
	aiEnabled := isAIEnabled()

	respondJSON(w, http.StatusOK, shellStatusResponse{
		ClusterID:            resolvedID,
		ClusterName:          cluster.Name,
		Context:              contextName,
		Namespace:            namespace,
		KCLIAvailable:        kcliErr == nil,
		KCLIShellModeAllowed: h.isKCLIShellModeAllowed(),
		AIEnabled:            aiEnabled,
	})
}

func isAIEnabled() bool {
	if strings.TrimSpace(os.Getenv("KCLI_AI_PROVIDER")) != "" {
		return true
	}
	if strings.TrimSpace(os.Getenv("KCLI_AI_ENDPOINT")) != "" {
		return true
	}
	if strings.TrimSpace(os.Getenv("KCLI_OPENAI_API_KEY")) != "" ||
		strings.TrimSpace(os.Getenv("KCLI_ANTHROPIC_API_KEY")) != "" ||
		strings.TrimSpace(os.Getenv("KCLI_AZURE_OPENAI_API_KEY")) != "" ||
		strings.TrimSpace(os.Getenv("KCLI_OLLAMA_ENDPOINT")) != "" {
		return true
	}
	if enabled, ok := readKCLIAIEnabledFromConfig(); ok {
		return enabled
	}
	return false
}

type kcliConfigFile struct {
	AI struct {
		Enabled  bool   `yaml:"enabled"`
		Provider string `yaml:"provider"`
		Endpoint string `yaml:"endpoint"`
		Model    string `yaml:"model"`
	} `yaml:"ai"`
}

func readKCLIAIEnabledFromConfig() (bool, bool) {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return false, false
	}
	path := filepath.Join(home, ".kcli", "config.yaml")
	raw, err := os.ReadFile(path)
	if err != nil {
		return false, false
	}
	var cfg kcliConfigFile
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		return false, false
	}
	if cfg.AI.Enabled {
		return true, true
	}
	if strings.TrimSpace(cfg.AI.Provider) != "" || strings.TrimSpace(cfg.AI.Endpoint) != "" || strings.TrimSpace(cfg.AI.Model) != "" {
		return true, true
	}
	return false, true
}
