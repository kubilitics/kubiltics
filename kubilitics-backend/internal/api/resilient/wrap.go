package resilient

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
)

// WrapClusterHandler is the canonical middleware for every cluster-
// scoped API endpoint. It enforces the honest-degradation contract:
//
//   - On success: cache + return 200 {data, reachable:true, healthy}.
//   - On transient cluster error: return 200 {cached if any, reachable:false,
//     stale:<was cached?>, error_message, unreachable}. Never 5xx.
//   - On real bugs: 5xx with logged stack. Callers fix the server.
//
// The cache is a caller-provided LRU keyed by a request-derived key
// (typically the cluster logical identity). Caller controls capacity.
func WrapClusterHandler[T any](
	cache *LRUCache[string, T],
	cacheKey func(r *http.Request) string,
	fetch func(ctx context.Context, r *http.Request) (T, error),
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := cacheKey(r)
		data, err := fetch(r.Context(), r)
		if err == nil {
			cache.Put(key, data)
			writeJSON(w, 200, ResilientResponse[T]{
				Data:         data,
				Reachable:    true,
				HealthStatus: "healthy",
			})
			return
		}
		if IsTransientClusterError(err) {
			resp := ResilientResponse[T]{
				Reachable:    false,
				ErrorMessage: err.Error(),
				HealthStatus: "unreachable",
			}
			if cached, ok := cache.Get(key); ok {
				resp.Data = cached.Value
				resp.Stale = true
				at := cached.At
				resp.StaleAsOf = &at
			}
			writeJSON(w, 200, resp)
			return
		}
		// Real bug — log and 5xx.
		log.Printf("resilient: unexpected error (not transient): %v", err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
