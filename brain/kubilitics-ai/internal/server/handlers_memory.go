package server

// handlers_memory.go — Memory/World Model REST endpoints (A-CORE-009).
//
// Endpoints:
//   GET  /api/v1/memory/overview           — cluster overview (world model stats + recent changes)
//   GET  /api/v1/memory/resources          — list/search resources from world model
//   GET  /api/v1/memory/resources/{key}    — single resource summary
//   GET  /api/v1/memory/changes            — recent changes feed (?since=10m&namespace=X&kind=Y)
//   GET  /api/v1/memory/temporal/changes   — temporal store: changes in range for a resource
//   GET  /api/v1/memory/temporal/snapshot  — cluster snapshot at a point in time
//   GET  /api/v1/memory/temporal/window    — retention window info
//   POST /api/v1/memory/temporal/snapshot  — trigger snapshot now
//   GET  /api/v1/memory/vector/stats       — vector store stats
//   POST /api/v1/memory/vector/search      — semantic / keyword search
//   POST /api/v1/memory/vector/index       — index an item

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ─── Router ───────────────────────────────────────────────────────────────────

// handleMemory is the top-level dispatcher for /api/v1/memory/*
func (s *Server) handleMemory(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/memory")
	path = strings.TrimSuffix(path, "/")

	switch {
	// World model endpoints
	case path == "" || path == "/overview":
		s.handleMemoryOverview(w, r)
	case path == "/resources":
		s.handleMemoryResources(w, r)
	case strings.HasPrefix(path, "/resources/"):
		s.handleMemoryResourceDetail(w, r, strings.TrimPrefix(path, "/resources/"))
	case path == "/changes":
		s.handleMemoryChanges(w, r)

	// Temporal store endpoints
	case path == "/temporal/changes":
		s.handleTemporalChanges(w, r)
	case path == "/temporal/snapshot":
		s.handleTemporalSnapshot(w, r)
	case path == "/temporal/window":
		s.handleTemporalWindow(w, r)

	// Vector store endpoints
	case path == "/vector/stats":
		s.handleVectorStats(w, r)
	case path == "/vector/search":
		s.handleVectorSearch(w, r)
	case path == "/vector/index":
		s.handleVectorIndex(w, r)

	default:
		http.NotFound(w, r)
	}
}

// ─── World Model endpoints ────────────────────────────────────────────────────

func (s *Server) handleMemoryOverview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.worldModel == nil || s.queryAPI == nil {
		jsonOK(w, map[string]interface{}{
			"error":        "world model not initialised",
			"bootstrapped": false,
		})
		return
	}
	overview, err := s.queryAPI.GetClusterOverview(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, overview)
}

func (s *Server) handleMemoryResources(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.worldModel == nil {
		jsonOK(w, map[string]interface{}{"resources": []interface{}{}, "count": 0})
		return
	}

	q := r.URL.Query()
	kind := q.Get("kind")
	namespace := q.Get("namespace")
	search := q.Get("search")
	limitStr := q.Get("limit")
	limit := 100
	if limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 && n <= 1000 {
			limit = n
		}
	}

	var results interface{}
	var count int
	if search != "" && s.queryAPI != nil {
		// Text search via QueryAPI
		res, err := s.queryAPI.FindResourcesMatchingText(r.Context(), search, limit)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if res == nil {
			res = nil // keep typed nil; count stays 0
		}
		results = res
		count = len(res)
	} else {
		// Kind/namespace filter via WorldModel
		res, err := s.worldModel.ListResources(r.Context(), kind, namespace)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if len(res) > limit {
			res = res[:limit]
		}
		results = res
		count = len(res)
	}

	jsonOK(w, map[string]interface{}{
		"resources": results,
		"count":     count,
		"kind":      kind,
		"namespace": namespace,
		"search":    search,
	})
}

func (s *Server) handleMemoryResourceDetail(w http.ResponseWriter, r *http.Request, key string) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.queryAPI == nil {
		http.Error(w, "world model not initialised", http.StatusServiceUnavailable)
		return
	}
	// key format: Kind/namespace/name  or  Kind//name  or  Kind/name (cluster-scoped)
	parts := strings.SplitN(key, "/", 3)
	if len(parts) < 2 {
		http.Error(w, "invalid resource key; expected Kind/namespace/name", http.StatusBadRequest)
		return
	}
	kind := parts[0]
	namespace := ""
	name := parts[1]
	if len(parts) == 3 {
		namespace = parts[1]
		name = parts[2]
	}

	summary, err := s.queryAPI.GetResourceSummary(r.Context(), kind, namespace, name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	jsonOK(w, summary)
}

func (s *Server) handleMemoryChanges(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.queryAPI == nil {
		jsonOK(w, map[string]interface{}{"changes": []interface{}{}, "count": 0})
		return
	}

	sinceStr := r.URL.Query().Get("since")
	since := 10 * time.Minute
	if sinceStr != "" {
		if d, err := time.ParseDuration(sinceStr); err == nil {
			since = d
		}
	}

	changes, err := s.queryAPI.GetChangedSince(r.Context(), since)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if changes == nil {
		changes = []map[string]interface{}{}
	}
	jsonOK(w, map[string]interface{}{
		"changes": changes,
		"count":   len(changes),
		"since":   since.String(),
	})
}

// ─── Temporal Store endpoints ─────────────────────────────────────────────────

func (s *Server) handleTemporalChanges(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.temporalStore == nil {
		jsonOK(w, map[string]interface{}{"changes": []interface{}{}, "count": 0, "note": "temporal store not initialised"})
		return
	}

	q := r.URL.Query()
	kind := q.Get("kind")
	namespace := q.Get("namespace")
	name := q.Get("name")

	startStr := q.Get("start")
	endStr := q.Get("end")
	start := time.Now().Add(-1 * time.Hour)
	end := time.Now()
	if startStr != "" {
		if t, err := time.Parse(time.RFC3339, startStr); err == nil {
			start = t
		}
	}
	if endStr != "" {
		if t, err := time.Parse(time.RFC3339, endStr); err == nil {
			end = t
		}
	}

	changes, err := s.temporalStore.GetChangesInRange(r.Context(), namespace, kind, name, start, end)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]interface{}{
		"changes":   changes,
		"count":     len(changes),
		"kind":      kind,
		"namespace": namespace,
		"name":      name,
		"start":     start.Format(time.RFC3339),
		"end":       end.Format(time.RFC3339),
	})
}

func (s *Server) handleTemporalSnapshot(w http.ResponseWriter, r *http.Request) {
	if s.temporalStore == nil {
		jsonOK(w, map[string]interface{}{"note": "temporal store not initialised"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		tsStr := r.URL.Query().Get("at")
		var at interface{} = time.Now()
		if tsStr != "" {
			if t, err := time.Parse(time.RFC3339, tsStr); err == nil {
				at = t
			}
		}
		snap, err := s.temporalStore.GetClusterSnapshotAt(r.Context(), at)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		jsonOK(w, snap)

	case http.MethodPost:
		if err := s.temporalStore.SnapshotNow(r.Context()); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		jsonOK(w, map[string]interface{}{
			"status":    "ok",
			"message":   "snapshot triggered",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleTemporalWindow(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.temporalStore == nil {
		jsonOK(w, map[string]interface{}{"available": false, "note": "temporal store not initialised"})
		return
	}

	oldest, newest, err := s.temporalStore.GetRetentionWindow(r.Context())
	if err != nil {
		jsonOK(w, map[string]interface{}{"available": false, "error": err.Error()})
		return
	}
	jsonOK(w, map[string]interface{}{
		"available": true,
		"oldest":    oldest,
		"newest":    newest,
		"capacity":  48,
		"interval":  "1h",
		"retention": "48h",
	})
}

// ─── Vector Store endpoints ───────────────────────────────────────────────────

func (s *Server) handleVectorStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.vectorStore == nil {
		jsonOK(w, map[string]interface{}{"available": false})
		return
	}
	available, _ := s.vectorStore.IsAvailable(r.Context())
	stats, err := s.vectorStore.GetStats(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]interface{}{
		"available": available,
		"stats":     stats,
	})
}

func (s *Server) handleVectorSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.vectorStore == nil {
		jsonOK(w, map[string]interface{}{"results": []interface{}{}, "count": 0, "note": "vector store not initialised"})
		return
	}

	var req struct {
		Query string `json:"query"`
		Type  string `json:"type"` // "investigations", "error_patterns", "documentation"
		Limit int    `json:"limit"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Limit <= 0 {
		req.Limit = 10
	}

	var results []interface{}
	var err error
	switch req.Type {
	case "error_patterns":
		results, err = s.vectorStore.SearchErrorPatterns(r.Context(), req.Query, req.Limit)
	case "documentation":
		results, err = s.vectorStore.SearchDocumentation(r.Context(), req.Query, req.Limit)
	default: // "investigations" or empty
		results, err = s.vectorStore.SearchInvestigations(r.Context(), req.Query, req.Limit)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]interface{}{
		"results": results,
		"count":   len(results),
		"query":   req.Query,
		"type":    req.Type,
	})
}

func (s *Server) handleVectorIndex(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.vectorStore == nil {
		http.Error(w, "vector store not initialised", http.StatusServiceUnavailable)
		return
	}

	var req struct {
		Type    string      `json:"type"`    // "investigation", "error_pattern", "document"
		Content interface{} `json:"content"` // arbitrary payload
		DocType string      `json:"doc_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	var err error
	switch req.Type {
	case "error_pattern":
		err = s.vectorStore.IndexErrorPattern(r.Context(), req.Content)
	case "document":
		content := ""
		if m, ok := req.Content.(map[string]interface{}); ok {
			if c, ok := m["content"].(string); ok {
				content = c
			}
		}
		err = s.vectorStore.IndexDocument(r.Context(), req.DocType, content)
	default:
		err = s.vectorStore.IndexInvestigation(r.Context(), req.Content)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]interface{}{"status": "indexed", "type": req.Type})
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// jsonOK writes v as JSON with a 200 status code.
func jsonOK(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// countOf returns the length of a slice wrapped in interface{}.
func countOf(v interface{}) int {
	switch t := v.(type) {
	case []interface{}:
		return len(t)
	case []*interface{}:
		return len(t)
	}
	return 0
}
