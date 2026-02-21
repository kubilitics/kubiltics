package server

// handlers_topology_ai.go — E-PLAT-001: AI-Powered Topology Blast Radius Analysis
//
// Endpoints:
//   POST /api/v1/topology/analyze       — AI natural-language blast radius analysis
//   POST /api/v1/topology/critical-path — Critical path from ingress → backend pods
//   POST /api/v1/topology/node-explain  — AI tooltip explanation for a single node
//
// Strategy:
//   1. Client sends a lightweight graph summary (node list + edge list)
//   2. Backend uses LLM to generate natural-language impact analysis
//   3. Critical path is computed via BFS on the server side; LLM adds explanation
//   4. node-explain gives context + anomaly detection for the hovered node

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
)

// ─── Request / Response Types ─────────────────────────────────────────────────

// TopologyNodeSummary is a lightweight node representation for API transfer.
type TopologyNodeSummary struct {
	ID          string            `json:"id"`
	Kind        string            `json:"kind"`
	Name        string            `json:"name"`
	Namespace   string            `json:"namespace,omitempty"`
	Health      string            `json:"health,omitempty"`   // healthy|warning|critical|unknown
	Replicas    int               `json:"replicas,omitempty"` // ready replicas
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

// TopologyEdgeSummary is a lightweight edge for API transfer.
type TopologyEdgeSummary struct {
	Source           string `json:"source"`
	Target           string `json:"target"`
	RelationshipType string `json:"relationship_type"`
}

// TopologyAnalyzeRequest is the body for POST /api/v1/topology/analyze.
type TopologyAnalyzeRequest struct {
	// TargetNodeID is the resource being changed/deleted.
	TargetNodeID string `json:"target_node_id"`
	// Operation is what the user wants to do: "delete", "scale-down", "update", "restart".
	Operation string `json:"operation"`
	// Nodes is the full list of topology nodes.
	Nodes []TopologyNodeSummary `json:"nodes"`
	// Edges is the full list of topology edges.
	Edges []TopologyEdgeSummary `json:"edges"`
	// BlastRadiusNodeIDs are the pre-computed affected node IDs (from client-side algorithm).
	BlastRadiusNodeIDs []string `json:"blast_radius_node_ids,omitempty"`
	// TotalImpact is the pre-computed impact score 0-100.
	TotalImpact float64 `json:"total_impact,omitempty"`
}

// TopologyAnalyzeResponse is the response for the analyze endpoint.
type TopologyAnalyzeResponse struct {
	// NaturalLanguageSummary is the AI-generated plain English explanation.
	NaturalLanguageSummary string `json:"natural_language_summary"`
	// RiskLevel is "low", "medium", "high", or "critical".
	RiskLevel string `json:"risk_level"`
	// AffectedServices lists the impacted user-facing services.
	AffectedServices []string `json:"affected_services"`
	// RecommendedActions are the AI-generated mitigation steps.
	RecommendedActions []string `json:"recommended_actions"`
	// CanProceedSafely indicates if the operation is safe at current state.
	CanProceedSafely bool `json:"can_proceed_safely"`
	// SafetyCheckMessage explains why it is/isn't safe.
	SafetyCheckMessage string `json:"safety_check_message"`
	// Source is "llm" or "heuristic" (heuristic used when LLM unavailable).
	Source string `json:"source"`
}

// CriticalPathRequest is the body for POST /api/v1/topology/critical-path.
type CriticalPathRequest struct {
	Nodes []TopologyNodeSummary `json:"nodes"`
	Edges []TopologyEdgeSummary `json:"edges"`
	// NamespaceFilter optionally restricts the analysis to a namespace.
	NamespaceFilter string `json:"namespace_filter,omitempty"`
}

// CriticalPathResponse describes the user-facing critical path.
type CriticalPathResponse struct {
	// PathNodeIDs is the ordered list of node IDs forming the critical path.
	PathNodeIDs []string `json:"path_node_ids"`
	// PathDescription is the human-readable path (e.g. "frontend-ingress → frontend-svc → frontend-deploy → frontend-pod").
	PathDescription string `json:"path_description"`
	// SPOFs are single points of failure detected on the path.
	SPOFs []string `json:"spofs"`
	// BottleneckNodeIDs are nodes with high downstream fan-out.
	BottleneckNodeIDs []string `json:"bottleneck_node_ids"`
	// LLMExplanation is the AI narrative about the critical path.
	LLMExplanation string `json:"llm_explanation"`
	// Source is "llm" or "heuristic".
	Source string `json:"source"`
}

// NodeExplainRequest is the body for POST /api/v1/topology/node-explain.
type NodeExplainRequest struct {
	Node  TopologyNodeSummary   `json:"node"`
	Nodes []TopologyNodeSummary `json:"nodes,omitempty"` // surrounding context
	Edges []TopologyEdgeSummary `json:"edges,omitempty"`
}

// NodeExplainResponse is the AI tooltip content.
type NodeExplainResponse struct {
	// Role describes what this resource does (e.g. "LoadBalancer service for frontend traffic").
	Role string `json:"role"`
	// Dependencies lists the key upstream/downstream resources.
	Dependencies []string `json:"dependencies"`
	// Anomalies lists detected issues (e.g. "Single replica - no HA", "Missing readiness probe").
	Anomalies []string `json:"anomalies"`
	// HealthSummary is a 1-sentence health status explanation.
	HealthSummary string `json:"health_summary"`
	// Source is "llm" or "heuristic".
	Source string `json:"source"`
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

// handleTopologyAnalyze handles POST /api/v1/topology/analyze.
func (s *Server) handleTopologyAnalyze(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req TopologyAnalyzeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.TargetNodeID == "" {
		http.Error(w, "target_node_id is required", http.StatusBadRequest)
		return
	}

	// Find the target node.
	var targetNode *TopologyNodeSummary
	for i := range req.Nodes {
		if req.Nodes[i].ID == req.TargetNodeID {
			targetNode = &req.Nodes[i]
			break
		}
	}
	if targetNode == nil {
		http.Error(w, "target_node_id not found in nodes list", http.StatusBadRequest)
		return
	}

	operation := req.Operation
	if operation == "" {
		operation = "delete"
	}

	// Build affected nodes summary from blast radius IDs.
	affectedNames := buildAffectedNames(req.BlastRadiusNodeIDs, req.Nodes)
	affectedServices := filterByKind(req.BlastRadiusNodeIDs, req.Nodes, "Service", "Ingress")

	// Try LLM first.
	if s.llmAdapter != nil {
		resp := s.analyzeWithLLM(r, req, targetNode, operation, affectedNames, affectedServices)
		writeJSON(w, http.StatusOK, resp)
		return
	}

	// Heuristic fallback.
	resp := analyzeWithHeuristics(req, targetNode, operation, affectedNames, affectedServices)
	writeJSON(w, http.StatusOK, resp)
}

// handleCriticalPath handles POST /api/v1/topology/critical-path.
func (s *Server) handleCriticalPath(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req CriticalPathRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Compute critical path via BFS from ingress/service entry points.
	pathNodeIDs, pathDesc, spofs, bottlenecks := computeCriticalPath(req.Nodes, req.Edges, req.NamespaceFilter)

	// Build LLM explanation if available.
	var explanation, source string
	if s.llmAdapter != nil {
		explanation = s.explainCriticalPathLLM(r, req, pathNodeIDs, pathDesc, spofs)
		source = "llm"
	} else {
		explanation = buildHeuristicCriticalPathExplanation(pathNodeIDs, pathDesc, spofs, req.Nodes)
		source = "heuristic"
	}

	resp := CriticalPathResponse{
		PathNodeIDs:       pathNodeIDs,
		PathDescription:   pathDesc,
		SPOFs:             spofs,
		BottleneckNodeIDs: bottlenecks,
		LLMExplanation:    explanation,
		Source:            source,
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleNodeExplain handles POST /api/v1/topology/node-explain.
func (s *Server) handleNodeExplain(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req NodeExplainRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.Node.ID == "" {
		http.Error(w, "node.id is required", http.StatusBadRequest)
		return
	}

	// Build basic context from graph.
	deps := buildNodeDependencies(req.Node, req.Edges, req.Nodes)
	anomalies := detectNodeAnomalies(req.Node, req.Edges, req.Nodes)

	if s.llmAdapter != nil {
		resp := s.explainNodeLLM(r, req, deps, anomalies)
		writeJSON(w, http.StatusOK, resp)
		return
	}

	// Heuristic fallback.
	resp := NodeExplainResponse{
		Role:          buildHeuristicRole(req.Node),
		Dependencies:  deps,
		Anomalies:     anomalies,
		HealthSummary: buildHeuristicHealthSummary(req.Node),
		Source:        "heuristic",
	}
	writeJSON(w, http.StatusOK, resp)
}

// ─── LLM helpers ──────────────────────────────────────────────────────────────

func (s *Server) analyzeWithLLM(
	r *http.Request,
	req TopologyAnalyzeRequest,
	target *TopologyNodeSummary,
	operation string,
	affectedNames []string,
	affectedServices []string,
) TopologyAnalyzeResponse {
	prompt := buildAnalysisPrompt(req, target, operation, affectedNames, affectedServices)
	messages := []types.Message{
		{
			Role:    "user",
			Content: prompt,
		},
	}

	content, _, err := s.llmAdapter.Complete(r.Context(), messages, nil)
	if err != nil || content == "" {
		return analyzeWithHeuristics(req, target, operation, affectedNames, affectedServices)
	}

	// Parse structured JSON response from LLM.
	if parsed, ok := parseLLMAnalysisResponse(content); ok {
		parsed.Source = "llm"
		return parsed
	}

	// If JSON parsing fails, use raw content as summary.
	riskLevel := classifyRiskByImpact(req.TotalImpact, len(req.BlastRadiusNodeIDs))
	return TopologyAnalyzeResponse{
		NaturalLanguageSummary: content,
		RiskLevel:              riskLevel,
		AffectedServices:       affectedServices,
		RecommendedActions:     buildDefaultRecommendations(target, operation),
		CanProceedSafely:       riskLevel == "low",
		SafetyCheckMessage:     fmt.Sprintf("Impact score: %.0f/100, %d resources affected", req.TotalImpact, len(req.BlastRadiusNodeIDs)),
		Source:                 "llm",
	}
}

func (s *Server) explainCriticalPathLLM(
	r *http.Request,
	req CriticalPathRequest,
	pathNodeIDs []string,
	pathDesc string,
	spofs []string,
) string {
	if len(pathNodeIDs) == 0 {
		return "No critical user-facing path was identified in this topology."
	}

	spofText := "none"
	if len(spofs) > 0 {
		spofText = strings.Join(spofs, ", ")
	}

	prompt := fmt.Sprintf(`You are a Kubernetes reliability expert analyzing a cluster topology.

Critical path from entry points to backend pods: %s
Single points of failure (SPOFs): %s
Total nodes in topology: %d

Provide a concise (3-5 sentences) explanation of:
1. What this critical path means for user traffic
2. The risk level of the SPOFs
3. One specific, actionable recommendation to improve resilience

Keep the response plain text, no markdown formatting.`, pathDesc, spofText, len(req.Nodes))

	messages := []types.Message{{Role: "user", Content: prompt}}
	content, _, err := s.llmAdapter.Complete(r.Context(), messages, nil)
	if err != nil || content == "" {
		return buildHeuristicCriticalPathExplanation(pathNodeIDs, pathDesc, spofs, req.Nodes)
	}
	return strings.TrimSpace(content)
}

func (s *Server) explainNodeLLM(
	r *http.Request,
	req NodeExplainRequest,
	deps []string,
	anomalies []string,
) NodeExplainResponse {
	depText := "none"
	if len(deps) > 0 {
		depText = strings.Join(deps, ", ")
	}
	anomalyText := "none detected"
	if len(anomalies) > 0 {
		anomalyText = strings.Join(anomalies, "; ")
	}

	prompt := fmt.Sprintf(`You are a Kubernetes expert. Explain this resource in plain English for an operations engineer.

Resource: %s "%s" in namespace "%s"
Health: %s
Replicas: %d
Dependencies: %s
Anomalies: %s

Respond ONLY with a JSON object like:
{
  "role": "one sentence describing what this resource does and its purpose",
  "health_summary": "one sentence health status and what it means"
}`,
		req.Node.Kind, req.Node.Name, req.Node.Namespace,
		req.Node.Health, req.Node.Replicas,
		depText, anomalyText,
	)

	messages := []types.Message{{Role: "user", Content: prompt}}
	content, _, err := s.llmAdapter.Complete(r.Context(), messages, nil)
	if err == nil && content != "" {
		if parsed, ok := parseNodeExplainLLM(content); ok {
			return NodeExplainResponse{
				Role:          parsed.Role,
				Dependencies:  deps,
				Anomalies:     anomalies,
				HealthSummary: parsed.HealthSummary,
				Source:        "llm",
			}
		}
	}

	return NodeExplainResponse{
		Role:          buildHeuristicRole(req.Node),
		Dependencies:  deps,
		Anomalies:     anomalies,
		HealthSummary: buildHeuristicHealthSummary(req.Node),
		Source:        "heuristic",
	}
}

// ─── Graph algorithms ─────────────────────────────────────────────────────────

// computeCriticalPath finds the longest user-facing path from entry points (Ingress/LoadBalancer)
// down to backend pods using BFS, then identifies SPOFs and bottlenecks.
func computeCriticalPath(
	nodes []TopologyNodeSummary,
	edges []TopologyEdgeSummary,
	nsFilter string,
) (pathNodeIDs []string, pathDesc string, spofs []string, bottlenecks []string) {

	// Build adjacency: downstream edges (source → targets)
	downstream := make(map[string][]string)
	upstream := make(map[string][]string)
	for _, e := range edges {
		downstream[e.Source] = append(downstream[e.Source], e.Target)
		upstream[e.Target] = append(upstream[e.Target], e.Source)
	}

	// Node lookup
	nodeMap := make(map[string]TopologyNodeSummary)
	for _, n := range nodes {
		nodeMap[n.ID] = n
	}

	// Filter by namespace if requested
	inScope := func(id string) bool {
		if nsFilter == "" {
			return true
		}
		n, ok := nodeMap[id]
		return ok && (n.Namespace == nsFilter || n.Namespace == "")
	}

	// Find entry points: Ingress first, then LoadBalancer Services
	var entryPoints []string
	for _, n := range nodes {
		if !inScope(n.ID) {
			continue
		}
		if n.Kind == "Ingress" {
			entryPoints = append(entryPoints, n.ID)
		}
	}
	if len(entryPoints) == 0 {
		for _, n := range nodes {
			if !inScope(n.ID) {
				continue
			}
			if n.Kind == "Service" {
				entryPoints = append(entryPoints, n.ID)
			}
		}
	}
	if len(entryPoints) == 0 {
		for _, n := range nodes {
			if !inScope(n.ID) {
				continue
			}
			if n.Kind == "Deployment" || n.Kind == "StatefulSet" {
				entryPoints = append(entryPoints, n.ID)
			}
		}
	}

	// BFS from entry points to find the deepest path
	type bfsState struct {
		id   string
		path []string
	}

	var longestPath []string
	visited := make(map[string]bool)

	queue := make([]bfsState, 0)
	for _, ep := range entryPoints {
		queue = append(queue, bfsState{id: ep, path: []string{ep}})
	}

	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]

		if visited[cur.id] {
			continue
		}
		visited[cur.id] = true

		if len(cur.path) > len(longestPath) {
			longestPath = append([]string{}, cur.path...)
		}

		for _, next := range downstream[cur.id] {
			if !visited[next] && inScope(next) {
				newPath := append(append([]string{}, cur.path...), next)
				queue = append(queue, bfsState{id: next, path: newPath})
			}
		}
	}

	pathNodeIDs = longestPath

	// Build human-readable description
	pathNames := make([]string, 0, len(longestPath))
	for _, id := range longestPath {
		if n, ok := nodeMap[id]; ok {
			pathNames = append(pathNames, fmt.Sprintf("%s/%s", n.Kind, n.Name))
		}
	}
	if len(pathNames) > 0 {
		pathDesc = strings.Join(pathNames, " → ")
	} else {
		pathDesc = "No user-facing path identified"
	}

	// Detect SPOFs: nodes on the critical path that have no upstream alternatives
	spofSet := make(map[string]bool)
	for _, id := range longestPath {
		upstreamNodes := upstream[id]
		if len(upstreamNodes) == 0 {
			continue // entry point, not a SPOF
		}
		// A SPOF is a node where ALL its upstream providers are also on the critical path
		// (no alternative providers from outside)
		allOnPath := true
		pathSet := make(map[string]bool)
		for _, p := range longestPath {
			pathSet[p] = true
		}
		for _, up := range upstreamNodes {
			if !pathSet[up] {
				allOnPath = false
				break
			}
		}

		n := nodeMap[id]
		// Also flag single-replica deployments/statefulsets as SPOFs
		if n.Kind == "Deployment" || n.Kind == "StatefulSet" {
			if n.Replicas <= 1 {
				spofSet[id] = true
			}
		}
		if allOnPath && len(upstreamNodes) == 1 {
			spofSet[id] = true
		}
	}

	for id := range spofSet {
		if n, ok := nodeMap[id]; ok {
			spofs = append(spofs, fmt.Sprintf("%s/%s", n.Kind, n.Name))
		}
	}

	// Detect bottlenecks: nodes with many downstream connections (fan-out > 3)
	for id, targets := range downstream {
		if len(targets) >= 3 {
			if n, ok := nodeMap[id]; ok && inScope(id) {
				bottlenecks = append(bottlenecks, n.ID)
			}
		}
	}

	return pathNodeIDs, pathDesc, spofs, bottlenecks
}

// buildAffectedNames returns names of affected nodes from blast radius IDs.
func buildAffectedNames(ids []string, nodes []TopologyNodeSummary) []string {
	nodeMap := make(map[string]TopologyNodeSummary)
	for _, n := range nodes {
		nodeMap[n.ID] = n
	}
	names := make([]string, 0, len(ids))
	for _, id := range ids {
		if n, ok := nodeMap[id]; ok {
			names = append(names, fmt.Sprintf("%s/%s", n.Kind, n.Name))
		}
	}
	return names
}

// filterByKind returns node names matching specific kinds from the blast radius set.
func filterByKind(ids []string, nodes []TopologyNodeSummary, kinds ...string) []string {
	kindSet := make(map[string]bool)
	for _, k := range kinds {
		kindSet[k] = true
	}
	nodeMap := make(map[string]TopologyNodeSummary)
	for _, n := range nodes {
		nodeMap[n.ID] = n
	}
	var result []string
	for _, id := range ids {
		if n, ok := nodeMap[id]; ok && kindSet[n.Kind] {
			result = append(result, n.Name)
		}
	}
	return result
}

// buildNodeDependencies returns a short list of dependency descriptions.
func buildNodeDependencies(node TopologyNodeSummary, edges []TopologyEdgeSummary, nodes []TopologyNodeSummary) []string {
	nodeMap := make(map[string]TopologyNodeSummary)
	for _, n := range nodes {
		nodeMap[n.ID] = n
	}

	var deps []string
	seen := make(map[string]bool)
	for _, e := range edges {
		var otherID string
		var rel string
		if e.Source == node.ID {
			otherID = e.Target
			rel = "→ " + e.RelationshipType
		} else if e.Target == node.ID {
			otherID = e.Source
			rel = e.RelationshipType + " →"
		} else {
			continue
		}

		if seen[otherID] {
			continue
		}
		seen[otherID] = true

		if other, ok := nodeMap[otherID]; ok {
			deps = append(deps, fmt.Sprintf("%s/%s (%s)", other.Kind, other.Name, rel))
		}
		if len(deps) >= 5 {
			break
		}
	}
	return deps
}

// detectNodeAnomalies checks for common K8s issues on a node.
func detectNodeAnomalies(node TopologyNodeSummary, edges []TopologyEdgeSummary, nodes []TopologyNodeSummary) []string {
	var anomalies []string

	// Single replica for stateful workloads
	if (node.Kind == "Deployment" || node.Kind == "StatefulSet") && node.Replicas <= 1 {
		if node.Namespace == "production" || node.Namespace == "prod" {
			anomalies = append(anomalies, "Single replica in production — no high availability")
		} else {
			anomalies = append(anomalies, "Single replica — consider increasing for resilience")
		}
	}

	// Health issues
	switch node.Health {
	case "critical":
		anomalies = append(anomalies, "Resource is in critical state")
	case "warning":
		anomalies = append(anomalies, "Resource has warnings — investigate pod events")
	case "unknown":
		anomalies = append(anomalies, "Health status unknown — may be newly created or disconnected")
	}

	// Orphaned: no upstream owners for non-entry-point resources
	hasUpstream := false
	for _, e := range edges {
		if e.Target == node.ID {
			hasUpstream = true
			break
		}
	}
	if !hasUpstream && node.Kind != "Ingress" && node.Kind != "Node" && node.Kind != "Namespace" {
		anomalies = append(anomalies, "No upstream owners — may be orphaned")
	}

	return anomalies
}

// ─── Heuristic fallbacks ──────────────────────────────────────────────────────

func analyzeWithHeuristics(
	req TopologyAnalyzeRequest,
	target *TopologyNodeSummary,
	operation string,
	affectedNames []string,
	affectedServices []string,
) TopologyAnalyzeResponse {
	riskLevel := classifyRiskByImpact(req.TotalImpact, len(req.BlastRadiusNodeIDs))

	var summary string
	affected := len(req.BlastRadiusNodeIDs)
	svcText := ""
	if len(affectedServices) > 0 {
		svcText = fmt.Sprintf(" User-facing services impacted: %s.", strings.Join(affectedServices, ", "))
	}

	switch operation {
	case "delete":
		summary = fmt.Sprintf(
			"Deleting %s/%s will affect %d downstream resources.%s Impact score: %.0f/100.",
			target.Kind, target.Name, affected, svcText, req.TotalImpact,
		)
	case "scale-down":
		summary = fmt.Sprintf(
			"Scaling down %s/%s will reduce capacity for %d downstream resources.%s",
			target.Kind, target.Name, affected, svcText,
		)
	default:
		summary = fmt.Sprintf(
			"Performing '%s' on %s/%s affects %d resources.%s Impact: %.0f/100.",
			operation, target.Kind, target.Name, affected, svcText, req.TotalImpact,
		)
	}

	canProceed := riskLevel == "low" || riskLevel == "medium"
	safetyMsg := fmt.Sprintf("%d resource(s) in blast radius. Risk: %s.", affected, riskLevel)

	return TopologyAnalyzeResponse{
		NaturalLanguageSummary: summary,
		RiskLevel:              riskLevel,
		AffectedServices:       affectedServices,
		RecommendedActions:     buildDefaultRecommendations(target, operation),
		CanProceedSafely:       canProceed,
		SafetyCheckMessage:     safetyMsg,
		Source:                 "heuristic",
	}
}

func buildHeuristicRole(node TopologyNodeSummary) string {
	roles := map[string]string{
		"Deployment":              "Manages a set of replica pods for a stateless application",
		"StatefulSet":             "Manages stateful pods with stable identities and persistent storage",
		"DaemonSet":               "Ensures a pod runs on every (or selected) cluster node",
		"Service":                 "Provides stable network access to a group of pods",
		"Ingress":                 "Routes external HTTP/HTTPS traffic into the cluster",
		"ConfigMap":               "Stores non-sensitive configuration data for pods",
		"Secret":                  "Stores sensitive data like passwords and API keys",
		"PersistentVolumeClaim":   "Requests persistent storage for pods",
		"PersistentVolume":        "Provides a piece of persistent storage in the cluster",
		"Pod":                     "The smallest deployable unit containing one or more containers",
		"Node":                    "Physical or virtual machine that runs pods in the cluster",
		"Namespace":               "Logical partition that isolates resources within the cluster",
		"HorizontalPodAutoscaler": "Automatically scales pod replicas based on metrics",
		"Job":                     "Runs pods to completion for batch processing",
		"CronJob":                 "Schedules Jobs to run at specified times or intervals",
	}
	if role, ok := roles[node.Kind]; ok {
		return fmt.Sprintf("%s (%s)", role, node.Name)
	}
	return fmt.Sprintf("Kubernetes %s resource named %s", node.Kind, node.Name)
}

func buildHeuristicHealthSummary(node TopologyNodeSummary) string {
	switch node.Health {
	case "healthy":
		return fmt.Sprintf("%s/%s is operating normally", node.Kind, node.Name)
	case "warning":
		return fmt.Sprintf("%s/%s has warnings — one or more pods may be degraded", node.Kind, node.Name)
	case "critical":
		return fmt.Sprintf("%s/%s is in a critical state — immediate attention required", node.Kind, node.Name)
	default:
		return fmt.Sprintf("%s/%s health status is unknown", node.Kind, node.Name)
	}
}

func buildHeuristicCriticalPathExplanation(pathNodeIDs []string, pathDesc string, spofs []string, nodes []TopologyNodeSummary) string {
	if len(pathNodeIDs) == 0 {
		return "No user-facing critical path could be identified in the current topology."
	}
	spofText := ""
	if len(spofs) > 0 {
		spofText = fmt.Sprintf(" Single points of failure detected: %s.", strings.Join(spofs, ", "))
	}
	return fmt.Sprintf(
		"The critical user traffic path traverses %d resources: %s.%s Consider adding redundancy at each hop to improve availability.",
		len(pathNodeIDs), pathDesc, spofText,
	)
}

func classifyRiskByImpact(totalImpact float64, affectedCount int) string {
	switch {
	case totalImpact >= 80 || affectedCount >= 20:
		return "critical"
	case totalImpact >= 50 || affectedCount >= 10:
		return "high"
	case totalImpact >= 20 || affectedCount >= 3:
		return "medium"
	default:
		return "low"
	}
}

func buildDefaultRecommendations(target *TopologyNodeSummary, operation string) []string {
	recs := []string{}
	switch operation {
	case "delete":
		recs = append(recs, fmt.Sprintf("Drain traffic from %s/%s before deleting", target.Kind, target.Name))
		recs = append(recs, "Verify no active connections before proceeding")
		if target.Kind == "StatefulSet" || target.Kind == "PersistentVolumeClaim" {
			recs = append(recs, "Backup data before deleting stateful resources")
		}
	case "scale-down":
		recs = append(recs, "Scale down gradually (25% at a time) to monitor impact")
		recs = append(recs, "Watch error rates and latency during scale-down")
	case "update":
		recs = append(recs, "Use a rolling update strategy to minimize downtime")
		recs = append(recs, "Set appropriate maxSurge and maxUnavailable values")
	case "restart":
		recs = append(recs, "Ensure enough replicas are healthy before restarting")
		recs = append(recs, "Monitor pod restart counts and readiness probes")
	}
	recs = append(recs, "Review audit log after the operation completes")
	return recs
}

// ─── LLM prompt builders ──────────────────────────────────────────────────────

func buildAnalysisPrompt(
	req TopologyAnalyzeRequest,
	target *TopologyNodeSummary,
	operation string,
	affectedNames []string,
	affectedServices []string,
) string {
	affected := len(req.BlastRadiusNodeIDs)
	svcText := "none"
	if len(affectedServices) > 0 {
		svcText = strings.Join(affectedServices, ", ")
	}

	affectedSample := affectedNames
	if len(affectedSample) > 10 {
		affectedSample = append(affectedSample[:10], fmt.Sprintf("... and %d more", len(affectedNames)-10))
	}

	return fmt.Sprintf(`You are a Kubernetes SRE analyzing the impact of a cluster operation.

Operation: %s
Target resource: %s "%s" (namespace: %s, health: %s, replicas: %d)
Blast radius: %d downstream resources affected
Impact score: %.0f/100
User-facing services in blast radius: %s
Sample affected resources: %s

Respond ONLY with a JSON object:
{
  "natural_language_summary": "2-3 sentence plain English explanation of what will happen",
  "risk_level": "low|medium|high|critical",
  "recommended_actions": ["action1", "action2", "action3"],
  "can_proceed_safely": true/false,
  "safety_check_message": "one sentence safety assessment"
}`,
		operation,
		target.Kind, target.Name, target.Namespace, target.Health, target.Replicas,
		affected, req.TotalImpact, svcText,
		strings.Join(affectedSample, ", "),
	)
}

func parseLLMAnalysisResponse(content string) (TopologyAnalyzeResponse, bool) {
	// Extract JSON block from the response (may have surrounding text)
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start < 0 || end <= start {
		return TopologyAnalyzeResponse{}, false
	}
	jsonStr := content[start : end+1]

	var result struct {
		NaturalLanguageSummary string   `json:"natural_language_summary"`
		RiskLevel              string   `json:"risk_level"`
		RecommendedActions     []string `json:"recommended_actions"`
		CanProceedSafely       bool     `json:"can_proceed_safely"`
		SafetyCheckMessage     string   `json:"safety_check_message"`
		AffectedServices       []string `json:"affected_services"`
	}
	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		return TopologyAnalyzeResponse{}, false
	}
	if result.NaturalLanguageSummary == "" {
		return TopologyAnalyzeResponse{}, false
	}

	return TopologyAnalyzeResponse{
		NaturalLanguageSummary: result.NaturalLanguageSummary,
		RiskLevel:              result.RiskLevel,
		AffectedServices:       result.AffectedServices,
		RecommendedActions:     result.RecommendedActions,
		CanProceedSafely:       result.CanProceedSafely,
		SafetyCheckMessage:     result.SafetyCheckMessage,
	}, true
}

type nodeExplainLLMResult struct {
	Role          string `json:"role"`
	HealthSummary string `json:"health_summary"`
}

func parseNodeExplainLLM(content string) (nodeExplainLLMResult, bool) {
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start < 0 || end <= start {
		return nodeExplainLLMResult{}, false
	}
	var result nodeExplainLLMResult
	if err := json.Unmarshal([]byte(content[start:end+1]), &result); err != nil {
		return nodeExplainLLMResult{}, false
	}
	return result, result.Role != ""
}
