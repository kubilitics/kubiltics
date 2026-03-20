package rest

import (
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/kubilitics/kubilitics-backend/internal/pkg/logger"
	"github.com/kubilitics/kubilitics-backend/internal/pkg/validate"
)

// SearchResultItem is a single resource match for the global search API.
type SearchResultItem struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace,omitempty"`
	Path      string `json:"path"`
}

// SearchResponse is the response body for GET /clusters/{clusterId}/search.
type SearchResponse struct {
	Results []SearchResultItem `json:"results"`
}

// searchKinds are the resource kinds queried for global search (plural, lowercase).
// Order determines priority when merging; path segment matches frontend routes.
var searchKinds = []string{
	"pods", "deployments", "services", "nodes", "namespaces",
	"configmaps", "secrets", "ingresses", "statefulsets", "daemonsets",
	"jobs", "cronjobs",
}

const searchPerKindLimit = 80
const searchDefaultLimit = 25
const searchMaxLimit = 50

// GetSearch handles GET /clusters/{clusterId}/search?q=...&limit=25
// Returns resources whose name or namespace (for namespaced resources) contains q (case-insensitive).
func (h *Handler) GetSearch(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		respondError(w, http.StatusBadRequest, "Missing or empty query parameter: q")
		return
	}
	if !validate.ClusterID(clusterID) {
		respondError(w, http.StatusBadRequest, "Invalid clusterId")
		return
	}

	limit := searchDefaultLimit
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			if n > searchMaxLimit {
				n = searchMaxLimit
			}
			limit = n
		}
	}

	// Headlamp/Lens model: try kubeconfig from request first, fall back to stored cluster
	client, err := h.getClientFromRequest(r.Context(), r, clusterID, h.cfg)
	if err != nil {
		requestID := logger.FromContext(r.Context())
		respondErrorWithCode(w, http.StatusNotFound, ErrCodeNotFound, err.Error(), requestID)
		return
	}

	ctx := r.Context()
	qLower := strings.ToLower(q)
	var mu sync.Mutex
	var all []SearchResultItem

	var wg sync.WaitGroup
	for _, kind := range searchKinds {
		kind := kind
		wg.Add(1)
		go func() {
			defer wg.Done()
			opts := metav1.ListOptions{Limit: int64(searchPerKindLimit)}
			list, listErr := client.ListResources(ctx, kind, "", opts)
			if listErr != nil {
				return
			}
			for i := range list.Items {
				item := &list.Items[i]
				name, _, _ := unstructured.NestedString(item.Object, "metadata", "name")
				namespace, _, _ := unstructured.NestedString(item.Object, "metadata", "namespace")
				if name == "" {
					continue
				}
				matches := strings.Contains(strings.ToLower(name), qLower) ||
					strings.Contains(strings.ToLower(namespace), qLower)
				if !matches {
					continue
				}
				path := buildSearchPath(kind, name, namespace)
				mu.Lock()
				all = append(all, SearchResultItem{Kind: kind, Name: name, Namespace: namespace, Path: path})
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	if len(all) > limit {
		all = all[:limit]
	}
	respondJSON(w, http.StatusOK, SearchResponse{Results: all})
}

// buildSearchPath returns the frontend route path for a resource (matches App.tsx routes).
func buildSearchPath(kind, name, namespace string) string {
	switch kind {
	case "nodes":
		return "/nodes/" + name
	case "namespaces":
		return "/namespaces/" + name
	default:
		if namespace == "" {
			namespace = "default"
		}
		return "/" + kind + "/" + namespace + "/" + name
	}
}
