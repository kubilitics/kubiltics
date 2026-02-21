package server

// A-CORE-013: Persistence layer REST handlers.
//
// Routes (all under /api/v1/persistence/):
//   GET  /api/v1/persistence/health            → ping DB + return schema info
//   GET  /api/v1/persistence/audit             → query audit log (resource/action/user/from/to/limit/offset)
//   POST /api/v1/persistence/audit             → append an audit event
//   GET  /api/v1/persistence/conversations     → list conversations (cluster_id/limit/offset)
//   GET  /api/v1/persistence/conversations/{id}→ get conversation + messages
//   GET  /api/v1/persistence/anomalies         → query anomaly history
//   GET  /api/v1/persistence/anomalies/summary → severity summary for a time window
//   GET  /api/v1/persistence/cost/snapshots    → list cost snapshots
//   GET  /api/v1/persistence/cost/trend        → cost trend points (from/to)
//   GET  /api/v1/persistence/cost/latest       → latest cost snapshot

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/db"
)

// handlePersistenceDispatch routes /api/v1/persistence/* requests.
func (s *Server) handlePersistenceDispatch(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Strip prefix to get the sub-path
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/persistence")
	path = strings.TrimPrefix(path, "/")

	switch {
	case path == "" || path == "health":
		s.handlePersistenceHealth(w, r)
	case path == "audit":
		if r.Method == http.MethodPost {
			s.handlePersistenceAuditAppend(w, r)
		} else {
			s.handlePersistenceAuditQuery(w, r)
		}
	case path == "conversations":
		s.handlePersistenceConversationsList(w, r)
	case strings.HasPrefix(path, "conversations/"):
		id := strings.TrimPrefix(path, "conversations/")
		s.handlePersistenceConversationGet(w, r, id)
	case path == "anomalies":
		s.handlePersistenceAnomalyQuery(w, r)
	case path == "anomalies/summary":
		s.handlePersistenceAnomalySummary(w, r)
	case path == "cost/snapshots":
		s.handlePersistenceCostSnapshots(w, r)
	case path == "cost/trend":
		s.handlePersistenceCostTrend(w, r)
	case path == "cost/latest":
		s.handlePersistenceCostLatest(w, r)
	default:
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
	}
}

// ─── Health ───────────────────────────────────────────────────────────────────

func (s *Server) handlePersistenceHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if s.store == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{
			"status": "unavailable",
			"note":   "persistence store not initialised",
		})
		return
	}
	if err := s.store.Ping(r.Context()); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{
			"status": "error",
			"error":  err.Error(),
		})
		return
	}
	json.NewEncoder(w).Encode(map[string]any{
		"status":  "ok",
		"backend": "sqlite",
	})
}

// ─── Audit log ────────────────────────────────────────────────────────────────

func (s *Server) handlePersistenceAuditQuery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if s.store == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{"error": "store not initialised"})
		return
	}

	q := r.URL.Query()
	aq := db.AuditQuery{
		Resource: q.Get("resource"),
		Action:   q.Get("action"),
		UserID:   q.Get("user_id"),
		Limit:    parseIntParam(q.Get("limit"), 50),
		Offset:   parseIntParam(q.Get("offset"), 0),
	}
	if v := q.Get("from"); v != "" {
		aq.From, _ = time.Parse(time.RFC3339, v)
	}
	if v := q.Get("to"); v != "" {
		aq.To, _ = time.Parse(time.RFC3339, v)
	}

	events, err := s.store.QueryAuditEvents(r.Context(), aq)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	if events == nil {
		events = []*db.AuditRecord{}
	}
	json.NewEncoder(w).Encode(map[string]any{
		"events": events,
		"total":  len(events),
	})
}

func (s *Server) handlePersistenceAuditAppend(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{"error": "store not initialised"})
		return
	}

	var rec db.AuditRecord
	if err := json.NewDecoder(r.Body).Decode(&rec); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}
	if rec.EventType == "" {
		http.Error(w, `{"error":"event_type required"}`, http.StatusBadRequest)
		return
	}
	if rec.Timestamp.IsZero() {
		rec.Timestamp = time.Now()
	}

	if err := s.store.AppendAuditEvent(r.Context(), &rec); err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{"status": "appended", "id": rec.ID})
}

// ─── Conversations ────────────────────────────────────────────────────────────

func (s *Server) handlePersistenceConversationsList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if s.store == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{"error": "store not initialised"})
		return
	}

	q := r.URL.Query()
	clusterID := q.Get("cluster_id")
	limit := parseIntParam(q.Get("limit"), 50)
	offset := parseIntParam(q.Get("offset"), 0)

	convs, err := s.store.ListConversations(r.Context(), clusterID, limit, offset)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	if convs == nil {
		convs = []*db.ConversationRecord{}
	}
	json.NewEncoder(w).Encode(map[string]any{
		"conversations": convs,
		"total":         len(convs),
	})
}

func (s *Server) handlePersistenceConversationGet(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if s.store == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{"error": "store not initialised"})
		return
	}
	if id == "" {
		http.Error(w, `{"error":"conversation id required"}`, http.StatusBadRequest)
		return
	}

	conv, err := s.store.GetConversation(r.Context(), id)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusNotFound)
		return
	}

	limit := parseIntParam(r.URL.Query().Get("limit"), 100)
	msgs, err := s.store.GetMessages(r.Context(), id, limit)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	if msgs == nil {
		msgs = []*db.MessageRecord{}
	}

	json.NewEncoder(w).Encode(map[string]any{
		"conversation": conv,
		"messages":     msgs,
	})
}

// ─── Anomalies ────────────────────────────────────────────────────────────────

func (s *Server) handlePersistenceAnomalyQuery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if s.store == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{"error": "store not initialised"})
		return
	}

	q := r.URL.Query()
	aq := db.AnomalyQuery{
		ResourceID:  q.Get("resource_id"),
		Namespace:   q.Get("namespace"),
		Kind:        q.Get("kind"),
		AnomalyType: q.Get("anomaly_type"),
		Severity:    q.Get("severity"),
		Limit:       parseIntParam(q.Get("limit"), 100),
		Offset:      parseIntParam(q.Get("offset"), 0),
	}
	if v := q.Get("from"); v != "" {
		aq.From, _ = time.Parse(time.RFC3339, v)
	}
	if v := q.Get("to"); v != "" {
		aq.To, _ = time.Parse(time.RFC3339, v)
	}

	anomalies, err := s.store.QueryAnomalies(r.Context(), aq)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	if anomalies == nil {
		anomalies = []*db.AnomalyRecord{}
	}
	json.NewEncoder(w).Encode(map[string]any{
		"anomalies": anomalies,
		"total":     len(anomalies),
	})
}

func (s *Server) handlePersistenceAnomalySummary(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if s.store == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{"error": "store not initialised"})
		return
	}

	q := r.URL.Query()
	var from, to time.Time
	if v := q.Get("from"); v != "" {
		from, _ = time.Parse(time.RFC3339, v)
	}
	if v := q.Get("to"); v != "" {
		to, _ = time.Parse(time.RFC3339, v)
	}
	if from.IsZero() {
		from = time.Now().Add(-7 * 24 * time.Hour)
	}
	if to.IsZero() {
		to = time.Now()
	}

	summary, err := s.store.AnomalySummary(r.Context(), from, to)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	total := 0
	for _, v := range summary {
		total += v
	}
	json.NewEncoder(w).Encode(map[string]any{
		"summary": summary,
		"total":   total,
		"from":    from.Format(time.RFC3339),
		"to":      to.Format(time.RFC3339),
	})
}

// ─── Cost snapshots ───────────────────────────────────────────────────────────

func (s *Server) handlePersistenceCostSnapshots(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if s.store == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{"error": "store not initialised"})
		return
	}

	q := r.URL.Query()
	clusterID := q.Get("cluster_id")
	limit := parseIntParam(q.Get("limit"), 90)

	snaps, err := s.store.QueryCostSnapshots(r.Context(), clusterID, limit)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	if snaps == nil {
		snaps = []*db.CostSnapshotRecord{}
	}
	json.NewEncoder(w).Encode(map[string]any{
		"snapshots": snaps,
		"total":     len(snaps),
	})
}

func (s *Server) handlePersistenceCostTrend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if s.store == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{"error": "store not initialised"})
		return
	}

	q := r.URL.Query()
	clusterID := q.Get("cluster_id")
	var from, to time.Time
	if v := q.Get("from"); v != "" {
		from, _ = time.Parse(time.RFC3339, v)
	}
	if v := q.Get("to"); v != "" {
		to, _ = time.Parse(time.RFC3339, v)
	}
	if from.IsZero() {
		from = time.Now().Add(-30 * 24 * time.Hour)
	}
	if to.IsZero() {
		to = time.Now()
	}

	points, err := s.store.GetCostTrend(r.Context(), clusterID, from, to)
	if err != nil {
		http.Error(w, `{"error":"`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	if points == nil {
		points = []*db.CostTrendPoint{}
	}
	json.NewEncoder(w).Encode(map[string]any{
		"trend": points,
		"total": len(points),
		"from":  from.Format(time.RFC3339),
		"to":    to.Format(time.RFC3339),
	})
}

func (s *Server) handlePersistenceCostLatest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	if s.store == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]any{"error": "store not initialised"})
		return
	}

	clusterID := r.URL.Query().Get("cluster_id")
	snap, err := s.store.LatestCostSnapshot(r.Context(), clusterID)
	if err != nil {
		w.WriteHeader(http.StatusNoContent)
		json.NewEncoder(w).Encode(map[string]any{"note": "no cost snapshots recorded yet"})
		return
	}
	json.NewEncoder(w).Encode(snap)
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func parseIntParam(s string, def int) int {
	if s == "" {
		return def
	}
	v, err := strconv.Atoi(s)
	if err != nil || v < 0 {
		return def
	}
	return v
}
