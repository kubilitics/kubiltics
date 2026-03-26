package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
	"github.com/kubilitics/kubilitics-backend/internal/topology/v2/builder"
)

// TopologyHandler handles REST requests for the v2 topology API.
type TopologyHandler struct {
	cache     *v2.Cache
	collector v2.Collector
}

// NewTopologyHandler creates a handler with optional dependencies.
func NewTopologyHandler(cache *v2.Cache, collector v2.Collector) *TopologyHandler {
	if cache == nil {
		cache = v2.NewCache()
	}
	return &TopologyHandler{
		cache:     cache,
		collector: collector,
	}
}

// HandleGetTopology handles GET /api/v1/clusters/{id}/topology/v2
func (h *TopologyHandler) HandleGetTopology(w http.ResponseWriter, r *http.Request) {
	clusterID := extractPathParam(r, "id")
	if clusterID == "" {
		writeError(w, http.StatusBadRequest, "missing cluster ID")
		return
	}

	opts := parseQueryOptions(r, clusterID)
	if !isValidViewMode(opts.Mode) {
		writeError(w, http.StatusBadRequest, "invalid mode: must be one of cluster, namespace, workload, resource, rbac")
		return
	}

	cacheKey := v2.CacheKey{
		ClusterID: opts.ClusterID,
		Mode:      opts.Mode,
		Namespace: opts.Namespace,
		Resource:  opts.Resource,
	}
	if cached, ok := h.cache.Get(cacheKey); ok {
		writeJSON(w, http.StatusOK, cached)
		return
	}

	ctx := r.Context()
	if h.collector == nil {
		writeError(w, http.StatusServiceUnavailable, "no resource collector configured: cannot build topology")
		return
	}
	bundle, err := h.collector.Collect(ctx, clusterID, opts.Namespace)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to collect resources: "+err.Error())
		return
	}

	resp, err := builder.BuildGraph(ctx, opts, bundle)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build topology: "+err.Error())
		return
	}

	// Apply view filter
	filter := &v2.ViewFilter{}
	resp = filter.Filter(resp, opts)

	// Apply health enrichment
	if opts.IncludeHealth {
		enricher := &v2.HealthEnricher{}
		enricher.EnrichNodes(resp.Nodes, bundle)
	}

	// Apply metrics enrichment
	if opts.IncludeMetrics {
		enricher := &v2.MetricsEnricher{}
		enricher.EnrichNodes(resp.Nodes, bundle)
	}

	// Aggregate pods into summary nodes when a single owner has >3 pods
	resp.Nodes, resp.Edges = builder.AggregatePods(resp.Nodes, resp.Edges)

	// Update metadata counts after filtering
	resp.Metadata.ResourceCount = len(resp.Nodes)
	resp.Metadata.EdgeCount = len(resp.Edges)

	h.cache.Set(cacheKey, resp, v2.DefaultCacheTTL)
	writeJSON(w, http.StatusOK, resp)
}

// HandleGetResource handles GET /api/v1/clusters/{id}/topology/v2/resource/{kind}/{ns}/{name}
func (h *TopologyHandler) HandleGetResource(w http.ResponseWriter, r *http.Request) {
	clusterID := extractPathParam(r, "id")
	kind := extractPathParam(r, "kind")
	ns := extractPathParam(r, "ns")
	name := extractPathParam(r, "name")

	if clusterID == "" || kind == "" || name == "" {
		writeError(w, http.StatusBadRequest, "missing required path parameters")
		return
	}

	resourceID := v2.NodeID(kind, ns, name)
	opts := v2.Options{
		ClusterID: clusterID,
		Mode:      v2.ViewModeResource,
		Namespace: ns,
		Resource:  resourceID,
		Depth:     2,
		IncludeHealth:  true,
		IncludeMetrics: true,
	}

	depthStr := r.URL.Query().Get("depth")
	if depthStr != "" {
		if d, err := strconv.Atoi(depthStr); err == nil && d > 0 {
			opts.Depth = d
		}
	}

	ctx := r.Context()
	if h.collector == nil {
		writeError(w, http.StatusServiceUnavailable, "no resource collector configured: cannot build topology")
		return
	}
	bundle, err := h.collector.Collect(ctx, clusterID, ns)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to collect resources: "+err.Error())
		return
	}

	resp, err := builder.BuildGraph(ctx, opts, bundle)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build topology: "+err.Error())
		return
	}

	filter := &v2.ViewFilter{}
	resp = filter.Filter(resp, opts)

	enricher := &v2.HealthEnricher{}
	enricher.EnrichNodes(resp.Nodes, bundle)
	metricsEnricher := &v2.MetricsEnricher{}
	metricsEnricher.EnrichNodes(resp.Nodes, bundle)

	// Aggregate pods into summary nodes when a single owner has >3 pods
	resp.Nodes, resp.Edges = builder.AggregatePods(resp.Nodes, resp.Edges)

	resp.Metadata.ResourceCount = len(resp.Nodes)
	resp.Metadata.EdgeCount = len(resp.Edges)

	writeJSON(w, http.StatusOK, resp)
}

// HandleGetImpact handles GET /api/v1/clusters/{id}/topology/v2/impact/{kind}/{ns}/{name}
// It returns all resources that transitively depend on the specified resource,
// enabling "what breaks if I delete this?" analysis.
// Query param: depth (default 3, max 10)
func (h *TopologyHandler) HandleGetImpact(w http.ResponseWriter, r *http.Request) {
	clusterID := extractPathParam(r, "id")
	kind := extractPathParam(r, "kind")
	ns := extractPathParam(r, "ns")
	name := extractPathParam(r, "name")

	if clusterID == "" || kind == "" || name == "" {
		writeError(w, http.StatusBadRequest, "missing required path parameters")
		return
	}

	depth := 3
	if d, err := strconv.Atoi(r.URL.Query().Get("depth")); err == nil && d > 0 {
		if d > 10 {
			d = 10
		}
		depth = d
	}

	resourceID := v2.NodeID(kind, ns, name)

	// Check cache for the full cluster graph (shared across impact queries for the same cluster)
	graphCacheKey := v2.CacheKey{
		ClusterID: clusterID,
		Mode:      v2.ViewModeCluster,
		Namespace: "",
		Resource:  "__impact_graph__",
	}

	resp, cached := h.cache.Get(graphCacheKey)
	if !cached {
		if h.collector == nil {
			writeError(w, http.StatusServiceUnavailable, "no resource collector configured: cannot build topology")
			return
		}
		ctx := r.Context()
		bundle, err := h.collector.Collect(ctx, clusterID, "")
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to collect resources: "+err.Error())
			return
		}

		// Build the full graph to get all edges
		opts := v2.Options{
			ClusterID: clusterID,
			Mode:      v2.ViewModeCluster,
		}
		var buildErr error
		resp, buildErr = builder.BuildGraph(ctx, opts, bundle)
		if buildErr != nil {
			writeError(w, http.StatusInternalServerError, "failed to build topology: "+buildErr.Error())
			return
		}
		h.cache.Set(graphCacheKey, resp, v2.DefaultCacheTTL)
	}

	// Build reverse index and compute impact
	ri := builder.BuildReverseIndex(resp.Edges)
	impacted := ri.GetImpactDetailed(resourceID, depth)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"resourceId": resourceID,
		"depth":      depth,
		"impacted":   impacted,
		"count":      len(impacted),
	})
}

// HandleExport handles GET /api/v1/clusters/{id}/topology/v2/export/{format}
func (h *TopologyHandler) HandleExport(w http.ResponseWriter, r *http.Request) {
	clusterID := extractPathParam(r, "id")
	format := extractPathParam(r, "format")

	if clusterID == "" || format == "" {
		writeError(w, http.StatusBadRequest, "missing required path parameters")
		return
	}

	opts := parseQueryOptions(r, clusterID)
	ctx := r.Context()
	if h.collector == nil {
		writeError(w, http.StatusServiceUnavailable, "no resource collector configured: cannot build topology")
		return
	}
	bundle, err := h.collector.Collect(ctx, clusterID, opts.Namespace)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to collect resources: "+err.Error())
		return
	}

	resp, err := builder.BuildGraph(ctx, opts, bundle)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build topology: "+err.Error())
		return
	}

	filter := &v2.ViewFilter{}
	resp = filter.Filter(resp, opts)

	switch format {
	case "json":
		w.Header().Set("Content-Disposition", "attachment; filename=topology.json")
		writeJSON(w, http.StatusOK, resp)
	case "drawio":
		w.Header().Set("Content-Type", "application/xml")
		w.Header().Set("Content-Disposition", "attachment; filename=topology.drawio")
		drawioXML := exportDrawIO(resp)
		w.Write([]byte(drawioXML))
	default:
		writeError(w, http.StatusBadRequest, "unsupported export format: "+format+". Supported: json, drawio")
	}
}

func parseQueryOptions(r *http.Request, clusterID string) v2.Options {
	q := r.URL.Query()
	mode := v2.ViewMode(q.Get("mode"))
	if mode == "" {
		mode = v2.ViewModeNamespace
	}
	depth := 2
	if d, err := strconv.Atoi(q.Get("depth")); err == nil && d > 0 {
		depth = d
	}
	return v2.Options{
		ClusterID:      clusterID,
		Mode:           mode,
		Namespace:      q.Get("namespace"),
		Resource:       q.Get("resource"),
		Depth:          depth,
		IncludeMetrics: q.Get("includeMetrics") == "true",
		IncludeHealth:  q.Get("includeHealth") != "false",
		IncludeCost:    q.Get("includeCost") == "true",
	}
}

func isValidViewMode(mode v2.ViewMode) bool {
	switch mode {
	case v2.ViewModeCluster, v2.ViewModeNamespace, v2.ViewModeWorkload, v2.ViewModeResource, v2.ViewModeRBAC:
		return true
	}
	return false
}

func extractPathParam(r *http.Request, key string) string {
	// Support both gorilla/mux and chi patterns via r.PathValue (Go 1.22+)
	if val := r.PathValue(key); val != "" {
		return val
	}
	return ""
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func exportDrawIO(resp *v2.TopologyResponse) string {
	// Minimal DrawIO XML export
	xml := `<?xml version="1.0" encoding="UTF-8"?>
<mxfile>
<diagram name="Topology">
<mxGraphModel>
<root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
`
	for i, n := range resp.Nodes {
		x := (i % 5) * 220
		y := (i / 5) * 120
		xml += `<mxCell id="` + n.ID + `" value="` + n.Kind + `: ` + n.Name + `" style="rounded=1;" vertex="1" parent="1">
<mxGeometry x="` + strconv.Itoa(x) + `" y="` + strconv.Itoa(y) + `" width="200" height="80" as="geometry"/>
</mxCell>
`
	}
	for _, e := range resp.Edges {
		xml += `<mxCell id="` + e.ID + `" value="` + e.Label + `" edge="1" source="` + e.Source + `" target="` + e.Target + `" parent="1"/>
`
	}
	xml += `</root>
</mxGraphModel>
</diagram>
</mxfile>`
	return xml
}
