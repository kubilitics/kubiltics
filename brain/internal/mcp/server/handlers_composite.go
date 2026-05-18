package server

// compositeSource records the per-sub-handler latency that a composite
// tool aggregated. Emitted in the sources[] array of the envelope.
type compositeSource struct {
	Tool string `json:"tool"`
	MS   int64  `json:"ms"`
}

// composableResult is the envelope for the Week-1 composite tools
// (TriageCluster, ProblemList, LogPatterns). Distinct from inspectResult
// which is locked to the detailed/events/ownership triad.
type composableResult struct {
	Kind      string            `json:"kind"`
	ClusterID string            `json:"cluster_id,omitempty"`
	Summary   string            `json:"summary"`
	Data      interface{}       `json:"data"`
	Sources   []compositeSource `json:"sources,omitempty"`
	Partial   []string          `json:"partial,omitempty"`
}

// buildComposableResult assembles the envelope, omits partial when no
// sub-handler errors were supplied, and passes the output through the
// same capping path as inspectResult.
func buildComposableResult(
	kind, clusterID, summary string,
	data interface{},
	sources []compositeSource,
	errs map[string]error,
) interface{} {
	res := composableResult{
		Kind:      kind,
		ClusterID: clusterID,
		Summary:   summary,
		Data:      data,
		Sources:   sources,
	}
	for tool, err := range errs {
		if err == nil {
			continue
		}
		res.Partial = append(res.Partial, tool)
	}
	return capListOutput(summarizeListForLLM(res))
}
