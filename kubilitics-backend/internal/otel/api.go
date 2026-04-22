package otel

import (
	"compress/gzip"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gorilla/mux"
)

// OTelHandler provides HTTP handlers for OTel trace ingestion and queries.
type OTelHandler struct {
	receiver *Receiver
	store    *Store
}

// NewOTelHandler creates a new OTelHandler.
func NewOTelHandler(receiver *Receiver, store *Store) *OTelHandler {
	return &OTelHandler{receiver: receiver, store: store}
}

// SetupOTelRoutes registers OTel-related routes on the given router.
// The router is expected to be the /api/v1 subrouter.
func SetupOTelRoutes(router *mux.Router, handler *OTelHandler) {
	// OTLP receiver: POST /api/v1/traces (on subrouter)
	router.HandleFunc("/traces", handler.ReceiveTraces).Methods("POST")

	// Trace query APIs (cluster-scoped)
	router.HandleFunc("/clusters/{clusterId}/traces", handler.ListTraces).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/traces/services", handler.GetServiceMap).Methods("GET")
	router.HandleFunc("/clusters/{clusterId}/traces/{traceId}", handler.GetTrace).Methods("GET")

	// Resource-specific traces (matches by k8s_pod_name, k8s_deployment, or service_name)
	router.HandleFunc("/clusters/{clusterId}/resource-traces", handler.GetResourceTraces).Methods("GET")
}

// SetupOTLPStandardRoute registers the OTLP standard endpoint POST /v1/traces
// on the ROOT router (not the /api/v1 subrouter). This is the standard OTLP/HTTP
// endpoint that OTel SDKs expect when configured with OTEL_EXPORTER_OTLP_ENDPOINT.
func SetupOTLPStandardRoute(rootRouter *mux.Router, handler *OTelHandler) {
	rootRouter.HandleFunc("/v1/traces", handler.ReceiveTraces).Methods("POST")
}

// ReceiveTraces handles POST /v1/traces (OTLP/HTTP JSON, optionally gzipped).
func (h *OTelHandler) ReceiveTraces(w http.ResponseWriter, r *http.Request) {
	// Limit request body to 10MB to prevent OOM from oversized payloads.
	r.Body = http.MaxBytesReader(w, r.Body, 10*1024*1024)

	contentType := r.Header.Get("Content-Type")

	// Reject protobuf with a clear error — we only support JSON for now.
	if strings.Contains(contentType, "protobuf") || strings.Contains(contentType, "octet-stream") {
		log.Printf("[otel/receiver] rejected protobuf payload: %s", contentType)
		http.Error(w, `{"error":"protobuf encoding not supported, please use Content-Type: application/json"}`, http.StatusUnsupportedMediaType)
		return
	}

	// Decompress gzip if present (otel-collector contrib enables gzip by default).
	var bodyReader io.Reader = r.Body
	if r.Header.Get("Content-Encoding") == "gzip" {
		gz, err := gzip.NewReader(r.Body)
		if err != nil {
			log.Printf("[otel/receiver] gzip decode error: %v", err)
			http.Error(w, `{"error":"failed to decompress gzip"}`, http.StatusBadRequest)
			return
		}
		defer func() { _ = gz.Close() }()
		bodyReader = gz
	}

	// Read the body into memory so we can both decode and (on error) log it.
	body, err := io.ReadAll(bodyReader)
	if err != nil {
		http.Error(w, `{"error":"failed to read body"}`, http.StatusBadRequest)
		return
	}

	var req OTLPTraceRequest
	dec := json.NewDecoder(strings.NewReader(string(body)))
	dec.UseNumber()
	if err := dec.Decode(&req); err != nil {
		log.Printf("[otel/receiver] JSON decode error: %v (body=%d bytes)", err, len(body))
		http.Error(w, `{"error":"invalid JSON: `+err.Error()+`"}`, http.StatusBadRequest)
		return
	}

	clusterIDHint := r.Header.Get("X-Kubilitics-Cluster-Id")
	if err := h.receiver.ProcessTraces(r.Context(), &req, clusterIDHint); err != nil {
		if errors.Is(err, ErrRateLimited) {
			w.Header().Set("Retry-After", "5")
			http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
			return
		}
		http.Error(w, `{"error":"failed to process traces"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("{}"))
}

// ListTraces handles GET /clusters/{clusterId}/traces.
func (h *OTelHandler) ListTraces(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	params := r.URL.Query()

	q := TraceQuery{
		ClusterID: clusterID,
		Service:   params.Get("service"),
		Operation: params.Get("operation"),
		Status:    params.Get("status"),
		UserID:    params.Get("user_id"),
	}

	if v := params.Get("min_duration"); v != "" {
		q.MinDuration, _ = strconv.ParseInt(v, 10, 64)
	}
	if v := params.Get("max_duration"); v != "" {
		q.MaxDuration, _ = strconv.ParseInt(v, 10, 64)
	}
	if v := params.Get("from"); v != "" {
		q.From, _ = strconv.ParseInt(v, 10, 64)
	}
	if v := params.Get("to"); v != "" {
		q.To, _ = strconv.ParseInt(v, 10, 64)
	}
	if v := params.Get("limit"); v != "" {
		q.Limit, _ = strconv.Atoi(v)
	}
	if v := params.Get("offset"); v != "" {
		q.Offset, _ = strconv.Atoi(v)
	}

	traces, err := h.store.QueryTraces(r.Context(), q)
	if err != nil {
		http.Error(w, `{"error":"failed to query traces"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(traces)
}

// GetTrace handles GET /clusters/{clusterId}/traces/{traceId}.
func (h *OTelHandler) GetTrace(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	traceID := vars["traceId"]

	detail, err := h.store.GetTrace(r.Context(), traceID)
	if err != nil {
		http.Error(w, `{"error":"trace not found"}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(detail)
}

// GetServiceMap handles GET /clusters/{clusterId}/traces/services.
func (h *OTelHandler) GetServiceMap(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	params := r.URL.Query()

	var from, to int64
	if v := params.Get("from"); v != "" {
		from, _ = strconv.ParseInt(v, 10, 64)
	}
	if v := params.Get("to"); v != "" {
		to, _ = strconv.ParseInt(v, 10, 64)
	}

	// Default to last 1 hour if no range specified
	if from == 0 && to == 0 {
		to = int64(^uint64(0) >> 1) // max int64
	}

	svcMap, err := h.store.GetServiceMap(r.Context(), clusterID, from, to)
	if err != nil {
		http.Error(w, `{"error":"failed to get service map"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(svcMap)
}

// GetResourceTraces handles GET /clusters/{clusterId}/resource-traces.
// Returns traces matching a specific K8s resource by pod name, deployment, or service.
func (h *OTelHandler) GetResourceTraces(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	clusterID := vars["clusterId"]
	params := r.URL.Query()

	kind := params.Get("kind")
	name := params.Get("name")
	namespace := params.Get("namespace")

	if kind == "" || name == "" {
		http.Error(w, `{"error":"kind and name are required"}`, http.StatusBadRequest)
		return
	}

	var from, to int64
	if v := params.Get("from"); v != "" {
		from, _ = strconv.ParseInt(v, 10, 64)
	}
	if v := params.Get("to"); v != "" {
		to, _ = strconv.ParseInt(v, 10, 64)
	}

	limit := 50
	if v := params.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}

	traces, err := h.store.QuerySpansByResource(r.Context(), clusterID, kind, name, namespace, from, to, limit)
	if err != nil {
		http.Error(w, `{"error":"failed to query resource traces"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(traces)
}
