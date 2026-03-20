package server

// handlers_wizards.go — E-PLAT-006: AI-enhanced resource creation wizard endpoints.
//
// Endpoints:
//   POST /api/v1/wizards/suggest   — suggest CPU/memory/replicas for a given workload
//   POST /api/v1/wizards/validate  — detect misconfigurations in a resource spec
//
// The suggest endpoint uses:
//   1. Well-known image heuristics (fast path, no LLM call needed)
//   2. LLM completion as fallback for unknown images
//
// The validate endpoint checks for common K8s misconfigurations:
//   - Missing resource limits
//   - No liveness/readiness probes
//   - Root container
//   - Single replica (availability risk)

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
)

// ─── Request / response types ────────────────────────────────────────────────

// WizardSuggestRequest is the request body for POST /api/v1/wizards/suggest.
type WizardSuggestRequest struct {
	// Image is the container image name (e.g. "nginx:1.25", "postgres:15").
	Image string `json:"image"`
	// Namespace hints the environment (production/staging/development/default).
	Namespace string `json:"namespace,omitempty"`
	// Replicas is the desired replica count (0 = let AI decide).
	Replicas int `json:"replicas,omitempty"`
	// WorkloadType gives extra context ("web", "worker", "database", "cache", "ml").
	WorkloadType string `json:"workload_type,omitempty"`
	// ExistingCPU / ExistingMemory are the values already in the form.
	ExistingCPU    string `json:"existing_cpu,omitempty"`
	ExistingMemory string `json:"existing_memory,omitempty"`
}

// ResourceSuggestion is a single container resource suggestion.
type ResourceSuggestion struct {
	CPURequest    string `json:"cpu_request"`
	CPULimit      string `json:"cpu_limit"`
	MemoryRequest string `json:"memory_request"`
	MemoryLimit   string `json:"memory_limit"`
	Replicas      int    `json:"replicas"`
	Confidence    string `json:"confidence"` // "high" | "medium" | "low"
	Source        string `json:"source"`     // "heuristic" | "llm"
}

// ValidationIssue is a single configuration issue detected by the validator.
type ValidationIssue struct {
	Severity string `json:"severity"` // "error" | "warning" | "info"
	Field    string `json:"field"`
	Message  string `json:"message"`
	Fix      string `json:"fix"`
}

// WizardSuggestResponse is the response body for POST /api/v1/wizards/suggest.
type WizardSuggestResponse struct {
	Suggestion    ResourceSuggestion `json:"suggestion"`
	Rationale     string             `json:"rationale"`
	SimilarImages []string           `json:"similar_images,omitempty"`
	CostEstimate  *CostEstimate      `json:"cost_estimate,omitempty"`
	Timestamp     time.Time          `json:"timestamp"`
}

// WizardValidateRequest is the request body for POST /api/v1/wizards/validate.
type WizardValidateRequest struct {
	ResourceKind string                 `json:"resource_kind"` // "Deployment", "StatefulSet", etc.
	Spec         map[string]interface{} `json:"spec"`
	Containers   []ContainerSpec        `json:"containers"`
	Replicas     int                    `json:"replicas"`
	Namespace    string                 `json:"namespace"`
}

// ContainerSpec is a simplified container spec for validation.
type ContainerSpec struct {
	Name      string `json:"name"`
	Image     string `json:"image"`
	CPU       string `json:"cpu"`
	Memory    string `json:"memory"`
	Port      string `json:"port"`
	HasProbes bool   `json:"has_probes"`
	RunAsRoot bool   `json:"run_as_root"`
}

// WizardValidateResponse is the response body for POST /api/v1/wizards/validate.
type WizardValidateResponse struct {
	Issues    []ValidationIssue `json:"issues"`
	Score     int               `json:"score"` // 0-100, higher is better
	Summary   string            `json:"summary"`
	Timestamp time.Time         `json:"timestamp"`
}

// CostEstimate is a rough monthly cost estimate.
type CostEstimate struct {
	MonthlyCPUCostUSD float64 `json:"monthly_cpu_cost_usd"`
	MonthlyMemCostUSD float64 `json:"monthly_mem_cost_usd"`
	MonthlyTotalUSD   float64 `json:"monthly_total_usd"`
	Replicas          int     `json:"replicas"`
}

// ─── Well-known image heuristics ─────────────────────────────────────────────

type imageProfile struct {
	cpuRequest    string
	cpuLimit      string
	memRequest    string
	memLimit      string
	replicas      int
	workloadType  string
	rationale     string
	similarImages []string
}

// imageHeuristics maps well-known image prefixes to resource profiles.
// Values are based on commonly observed production sizing.
var imageHeuristics = map[string]imageProfile{
	// Web servers
	"nginx": {
		cpuRequest: "50m", cpuLimit: "500m",
		memRequest: "64Mi", memLimit: "256Mi",
		replicas: 2, workloadType: "web",
		rationale:     "nginx is a lightweight web server. 50m CPU and 64Mi memory are typically sufficient. 2 replicas for basic availability.",
		similarImages: []string{"nginx:alpine", "nginx:stable"},
	},
	"apache": {
		cpuRequest: "100m", cpuLimit: "500m",
		memRequest: "128Mi", memLimit: "512Mi",
		replicas: 2, workloadType: "web",
		rationale:     "Apache httpd has a larger footprint than nginx. 128Mi base memory is typical.",
		similarImages: []string{"httpd:alpine", "httpd:2.4"},
	},
	"traefik": {
		cpuRequest: "100m", cpuLimit: "1000m",
		memRequest: "128Mi", memLimit: "512Mi",
		replicas: 2, workloadType: "proxy",
		rationale:     "Traefik proxy needs moderate CPU for routing. 128Mi base memory.",
		similarImages: []string{"traefik:v2", "traefik:latest"},
	},
	"envoy": {
		cpuRequest: "100m", cpuLimit: "1000m",
		memRequest: "128Mi", memLimit: "512Mi",
		replicas: 2, workloadType: "proxy",
		rationale:     "Envoy proxy requires moderate resources for connection pooling.",
		similarImages: []string{"envoyproxy/envoy"},
	},
	// Databases
	"postgres": {
		cpuRequest: "250m", cpuLimit: "2000m",
		memRequest: "256Mi", memLimit: "1Gi",
		replicas: 1, workloadType: "database",
		rationale:     "PostgreSQL needs at least 256Mi memory for shared_buffers. Single replica (use StatefulSet for HA). Consider 1Gi+ for production.",
		similarImages: []string{"postgres:15", "postgres:alpine", "bitnami/postgresql"},
	},
	"mysql": {
		cpuRequest: "250m", cpuLimit: "2000m",
		memRequest: "512Mi", memLimit: "2Gi",
		replicas: 1, workloadType: "database",
		rationale:     "MySQL typically needs 512Mi+ for InnoDB buffer pool. Single replica (use StatefulSet for HA).",
		similarImages: []string{"mysql:8", "mysql:5.7", "mariadb"},
	},
	"mariadb": {
		cpuRequest: "250m", cpuLimit: "2000m",
		memRequest: "512Mi", memLimit: "2Gi",
		replicas: 1, workloadType: "database",
		rationale:     "MariaDB same profile as MySQL. 512Mi base memory recommended.",
		similarImages: []string{"mariadb:latest", "mysql"},
	},
	"mongodb": {
		cpuRequest: "250m", cpuLimit: "2000m",
		memRequest: "512Mi", memLimit: "2Gi",
		replicas: 1, workloadType: "database",
		rationale:     "MongoDB uses WiredTiger cache (default 50% RAM). 512Mi base recommended.",
		similarImages: []string{"mongo:latest", "bitnami/mongodb"},
	},
	// Cache
	"redis": {
		cpuRequest: "100m", cpuLimit: "500m",
		memRequest: "128Mi", memLimit: "512Mi",
		replicas: 1, workloadType: "cache",
		rationale:     "Redis is memory-bound, not CPU-bound. Size memory based on expected dataset size. 128Mi base.",
		similarImages: []string{"redis:7-alpine", "redis:latest", "bitnami/redis"},
	},
	"memcached": {
		cpuRequest: "100m", cpuLimit: "500m",
		memRequest: "128Mi", memLimit: "256Mi",
		replicas: 1, workloadType: "cache",
		rationale:     "Memcached is very lightweight. Size based on cache capacity requirements.",
		similarImages: []string{"memcached:alpine"},
	},
	// Message queues
	"rabbitmq": {
		cpuRequest: "250m", cpuLimit: "1000m",
		memRequest: "512Mi", memLimit: "1Gi",
		replicas: 1, workloadType: "queue",
		rationale:     "RabbitMQ uses Erlang VM, needs 512Mi+ for message persistence.",
		similarImages: []string{"rabbitmq:management", "bitnami/rabbitmq"},
	},
	"kafka": {
		cpuRequest: "500m", cpuLimit: "2000m",
		memRequest: "1Gi", memLimit: "4Gi",
		replicas: 1, workloadType: "queue",
		rationale:     "Kafka JVM needs at least 1Gi heap. High throughput needs more CPU.",
		similarImages: []string{"confluentinc/cp-kafka", "bitnami/kafka"},
	},
	// Node.js
	"node": {
		cpuRequest: "100m", cpuLimit: "1000m",
		memRequest: "128Mi", memLimit: "512Mi",
		replicas: 2, workloadType: "web",
		rationale:     "Node.js apps are typically CPU-bound for computation, memory varies by app. 2 replicas recommended.",
		similarImages: []string{"node:20-alpine", "node:18-alpine"},
	},
	// Python
	"python": {
		cpuRequest: "100m", cpuLimit: "1000m",
		memRequest: "128Mi", memLimit: "512Mi",
		replicas: 2, workloadType: "web",
		rationale:     "Python apps vary widely. 128Mi base, size memory based on data processing needs.",
		similarImages: []string{"python:3.11-slim", "python:alpine"},
	},
	// Java/JVM
	"openjdk": {
		cpuRequest: "250m", cpuLimit: "2000m",
		memRequest: "512Mi", memLimit: "1Gi",
		replicas: 2, workloadType: "web",
		rationale:     "JVM needs at least 256-512Mi for heap. Set Xmx to 75% of limit.",
		similarImages: []string{"openjdk:17-slim", "eclipse-temurin"},
	},
	"eclipse-temurin": {
		cpuRequest: "250m", cpuLimit: "2000m",
		memRequest: "512Mi", memLimit: "1Gi",
		replicas: 2, workloadType: "web",
		rationale:     "JVM needs at least 512Mi for heap. Set Xmx to 75% of limit.",
		similarImages: []string{"openjdk:17", "eclipse-temurin:17"},
	},
	// Go
	"golang": {
		cpuRequest: "100m", cpuLimit: "1000m",
		memRequest: "64Mi", memLimit: "256Mi",
		replicas: 2, workloadType: "web",
		rationale:     "Go binaries are very efficient. 64Mi base memory is typical for most Go services.",
		similarImages: []string{"golang:alpine"},
	},
	// Elasticsearch
	"elasticsearch": {
		cpuRequest: "500m", cpuLimit: "2000m",
		memRequest: "1Gi", memLimit: "4Gi",
		replicas: 1, workloadType: "database",
		rationale:     "Elasticsearch JVM needs at least 512Mi heap (set Xmx=50% of limit). Min 1Gi for development.",
		similarImages: []string{"docker.elastic.co/elasticsearch/elasticsearch"},
	},
	// Prometheus/Grafana
	"prom/prometheus": {
		cpuRequest: "250m", cpuLimit: "1000m",
		memRequest: "512Mi", memLimit: "2Gi",
		replicas: 1, workloadType: "monitoring",
		rationale:     "Prometheus memory scales with number of series. 512Mi base for typical clusters.",
		similarImages: []string{"prom/prometheus:latest"},
	},
	"grafana/grafana": {
		cpuRequest: "100m", cpuLimit: "500m",
		memRequest: "128Mi", memLimit: "512Mi",
		replicas: 1, workloadType: "monitoring",
		rationale:     "Grafana is relatively lightweight. 128Mi base is typical.",
		similarImages: []string{"grafana/grafana:latest"},
	},
}

// ─── Handlers ────────────────────────────────────────────────────────────────

// handleWizardDispatch routes /api/v1/wizards/* requests.
func (s *Server) handleWizardDispatch(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	path := strings.TrimPrefix(r.URL.Path, "/api/v1/wizards")
	path = strings.TrimPrefix(path, "/")

	switch {
	case path == "suggest" && r.Method == http.MethodPost:
		s.handleWizardSuggest(w, r)
	case path == "validate" && r.Method == http.MethodPost:
		s.handleWizardValidate(w, r)
	default:
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
	}
}

// handleWizardSuggest handles POST /api/v1/wizards/suggest.
func (s *Server) handleWizardSuggest(w http.ResponseWriter, r *http.Request) {
	var req WizardSuggestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}

	image := strings.ToLower(strings.TrimSpace(req.Image))

	// ── 1. Try heuristics first (fast, no LLM cost) ──────────────────────────
	if profile, ok := matchImageHeuristic(image); ok {
		resp := buildSuggestResponse(profile, req, "heuristic")
		json.NewEncoder(w).Encode(resp)
		return
	}

	// ── 2. Fall back to LLM ──────────────────────────────────────────────────
	if s.llmAdapter != nil {
		prompt := buildSuggestPrompt(req)
		messages := []types.Message{
			{Role: "user", Content: prompt},
		}
		content, _, err := s.llmAdapter.Complete(r.Context(), messages, nil)
		if err == nil && content != "" {
			if profile, ok := parseLLMSuggestion(content, req); ok {
				resp := buildSuggestResponse(profile, req, "llm")
				resp.Rationale = extractRationale(content)
				json.NewEncoder(w).Encode(resp)
				return
			}
		}
	}

	// ── 3. Return safe defaults ───────────────────────────────────────────────
	resp := buildDefaultSuggestResponse(req)
	json.NewEncoder(w).Encode(resp)
}

// handleWizardValidate handles POST /api/v1/wizards/validate.
func (s *Server) handleWizardValidate(w http.ResponseWriter, r *http.Request) {
	var req WizardValidateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}

	issues := validateSpec(req)
	score := calculateScore(issues)
	summary := buildValidationSummary(issues, score, req.ResourceKind)

	json.NewEncoder(w).Encode(WizardValidateResponse{
		Issues:    issues,
		Score:     score,
		Summary:   summary,
		Timestamp: time.Now(),
	})
}

// ─── Heuristic helpers ───────────────────────────────────────────────────────

// matchImageHeuristic looks up a resource profile for the given image string.
func matchImageHeuristic(image string) (imageProfile, bool) {
	// Strip tag
	base := image
	if idx := strings.LastIndex(image, ":"); idx > 0 {
		base = image[:idx]
	}
	// Strip registry prefix (e.g. docker.io/library/)
	if idx := strings.LastIndex(base, "/"); idx >= 0 {
		last := base[idx+1:]
		if _, ok := imageHeuristics[last]; ok {
			return imageHeuristics[last], true
		}
	}
	// Direct match
	if p, ok := imageHeuristics[base]; ok {
		return p, true
	}
	// Prefix match (e.g. "prom/prometheus" prefix)
	for k, v := range imageHeuristics {
		if strings.HasPrefix(base, k) || strings.HasPrefix(image, k) {
			return v, true
		}
	}
	return imageProfile{}, false
}

func buildSuggestResponse(p imageProfile, req WizardSuggestRequest, source string) WizardSuggestResponse {
	replicas := p.replicas
	if req.Replicas > 0 {
		replicas = req.Replicas
	}
	// Production environments get higher defaults
	if req.Namespace == "production" && replicas < 2 {
		replicas = 2
	}

	suggestion := ResourceSuggestion{
		CPURequest:    p.cpuRequest,
		CPULimit:      p.cpuLimit,
		MemoryRequest: p.memRequest,
		MemoryLimit:   p.memLimit,
		Replicas:      replicas,
		Confidence:    "high",
		Source:        source,
	}

	return WizardSuggestResponse{
		Suggestion:    suggestion,
		Rationale:     p.rationale,
		SimilarImages: p.similarImages,
		CostEstimate:  estimateCost(suggestion),
		Timestamp:     time.Now(),
	}
}

func buildDefaultSuggestResponse(req WizardSuggestRequest) WizardSuggestResponse {
	replicas := 2
	if req.Replicas > 0 {
		replicas = req.Replicas
	}
	if req.Namespace == "development" {
		replicas = 1
	}

	suggestion := ResourceSuggestion{
		CPURequest:    "100m",
		CPULimit:      "500m",
		MemoryRequest: "128Mi",
		MemoryLimit:   "512Mi",
		Replicas:      replicas,
		Confidence:    "low",
		Source:        "default",
	}
	return WizardSuggestResponse{
		Suggestion:   suggestion,
		Rationale:    "Using conservative defaults. For better suggestions, provide a recognized image name (nginx, postgres, redis, etc.).",
		CostEstimate: estimateCost(suggestion),
		Timestamp:    time.Now(),
	}
}

// estimateCost returns a rough monthly cost estimate based on cloud pricing.
// Uses approximate GCP/AWS pricing: $0.031/vCPU-hour, $0.0042/GB-hour (us-central1).
func estimateCost(s ResourceSuggestion) *CostEstimate {
	cpuCores := parseCPUMillicores(s.CPURequest) / 1000.0
	memGB := parseMemoryMiB(s.MemoryRequest) / 1024.0
	hoursPerMonth := 730.0

	cpuCost := cpuCores * 0.031 * hoursPerMonth * float64(s.Replicas)
	memCost := memGB * 0.0042 * hoursPerMonth * float64(s.Replicas)

	return &CostEstimate{
		MonthlyCPUCostUSD: round2(cpuCost),
		MonthlyMemCostUSD: round2(memCost),
		MonthlyTotalUSD:   round2(cpuCost + memCost),
		Replicas:          s.Replicas,
	}
}

func round2(f float64) float64 {
	return float64(int(f*100)) / 100
}

func parseCPUMillicores(s string) float64 {
	s = strings.TrimSpace(strings.ToLower(s))
	if strings.HasSuffix(s, "m") {
		s = strings.TrimSuffix(s, "m")
		var v float64
		fmt.Sscanf(s, "%f", &v)
		return v
	}
	var v float64
	fmt.Sscanf(s, "%f", &v)
	return v * 1000
}

func parseMemoryMiB(s string) float64 {
	s = strings.TrimSpace(strings.ToUpper(s))
	switch {
	case strings.HasSuffix(s, "GI"):
		s = strings.TrimSuffix(s, "GI")
		var v float64
		fmt.Sscanf(s, "%f", &v)
		return v * 1024
	case strings.HasSuffix(s, "G"):
		s = strings.TrimSuffix(s, "G")
		var v float64
		fmt.Sscanf(s, "%f", &v)
		return v * 1024
	case strings.HasSuffix(s, "MI"):
		s = strings.TrimSuffix(s, "MI")
		var v float64
		fmt.Sscanf(s, "%f", &v)
		return v
	case strings.HasSuffix(s, "M"):
		s = strings.TrimSuffix(s, "M")
		var v float64
		fmt.Sscanf(s, "%f", &v)
		return v
	}
	var v float64
	fmt.Sscanf(s, "%f", &v)
	return v
}

// ─── LLM helpers ─────────────────────────────────────────────────────────────

func buildSuggestPrompt(req WizardSuggestRequest) string {
	env := req.Namespace
	if env == "" {
		env = "production"
	}
	return fmt.Sprintf(`You are a Kubernetes expert. Suggest resource requests and limits for this container.

Image: %s
Environment: %s
Replicas requested: %d
Workload type hint: %s

Respond ONLY in this exact JSON format (no extra text):
{
  "cpu_request": "100m",
  "cpu_limit": "500m",
  "memory_request": "128Mi",
  "memory_limit": "512Mi",
  "replicas": 2,
  "rationale": "brief explanation"
}`, req.Image, env, req.Replicas, req.WorkloadType)
}

func parseLLMSuggestion(content string, req WizardSuggestRequest) (imageProfile, bool) {
	// Try to extract JSON from the LLM response
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start < 0 || end <= start {
		return imageProfile{}, false
	}
	jsonStr := content[start : end+1]

	var parsed struct {
		CPURequest    string `json:"cpu_request"`
		CPULimit      string `json:"cpu_limit"`
		MemoryRequest string `json:"memory_request"`
		MemoryLimit   string `json:"memory_limit"`
		Replicas      int    `json:"replicas"`
		Rationale     string `json:"rationale"`
	}
	if err := json.Unmarshal([]byte(jsonStr), &parsed); err != nil {
		return imageProfile{}, false
	}
	if parsed.CPURequest == "" || parsed.MemoryRequest == "" {
		return imageProfile{}, false
	}
	replicas := parsed.Replicas
	if replicas == 0 {
		replicas = 2
	}
	return imageProfile{
		cpuRequest: parsed.CPURequest,
		cpuLimit:   parsed.CPULimit,
		memRequest: parsed.MemoryRequest,
		memLimit:   parsed.MemoryLimit,
		replicas:   replicas,
		rationale:  parsed.Rationale,
	}, true
}

func extractRationale(content string) string {
	// Try to find rationale in the JSON, otherwise return first paragraph
	start := strings.Index(content, "\"rationale\"")
	if start >= 0 {
		rest := content[start+11:]
		start2 := strings.Index(rest, "\"")
		end := strings.Index(rest[start2+1:], "\"")
		if start2 >= 0 && end >= 0 {
			return rest[start2+1 : start2+1+end]
		}
	}
	// Fall back to first 200 chars of content
	if len(content) > 200 {
		return content[:200] + "…"
	}
	return content
}

// ─── Validation helpers ───────────────────────────────────────────────────────

func validateSpec(req WizardValidateRequest) []ValidationIssue {
	var issues []ValidationIssue

	// Check replicas
	if req.Replicas == 1 && req.Namespace == "production" {
		issues = append(issues, ValidationIssue{
			Severity: "warning",
			Field:    "spec.replicas",
			Message:  "Single replica in production — no fault tolerance",
			Fix:      "Set replicas to at least 2 for high availability",
		})
	}
	if req.Replicas == 0 {
		issues = append(issues, ValidationIssue{
			Severity: "error",
			Field:    "spec.replicas",
			Message:  "Replicas must be at least 1",
			Fix:      "Set replicas to 1 or more",
		})
	}

	// Check each container
	for _, c := range req.Containers {
		prefix := fmt.Sprintf("containers[%s]", c.Name)

		// Missing resource limits
		if c.CPU == "" || c.CPU == "0" {
			issues = append(issues, ValidationIssue{
				Severity: "error",
				Field:    prefix + ".resources.requests.cpu",
				Message:  "CPU request is not set — pod may be evicted under pressure",
				Fix:      "Set cpu to at least 50m",
			})
		}
		if c.Memory == "" || c.Memory == "0" {
			issues = append(issues, ValidationIssue{
				Severity: "error",
				Field:    prefix + ".resources.requests.memory",
				Message:  "Memory request is not set — pod may be evicted under pressure",
				Fix:      "Set memory to at least 64Mi",
			})
		}

		// Suspicious defaults
		if c.CPU == "100m" && c.Memory == "128Mi" {
			issues = append(issues, ValidationIssue{
				Severity: "info",
				Field:    prefix + ".resources",
				Message:  "Using default resource values — consider right-sizing for your workload",
				Fix:      "Use AI Suggest to get tailored recommendations for " + c.Image,
			})
		}

		// No probes
		if !c.HasProbes {
			issues = append(issues, ValidationIssue{
				Severity: "warning",
				Field:    prefix + ".livenessProbe",
				Message:  "No liveness or readiness probe defined",
				Fix:      "Add liveness/readiness probes for automatic health checking",
			})
		}

		// Root container
		if c.RunAsRoot {
			issues = append(issues, ValidationIssue{
				Severity: "warning",
				Field:    prefix + ".securityContext.runAsNonRoot",
				Message:  "Container runs as root — security risk",
				Fix:      "Set securityContext.runAsNonRoot: true",
			})
		}

		// Latest tag
		image := strings.ToLower(c.Image)
		if strings.HasSuffix(image, ":latest") || !strings.Contains(image, ":") {
			issues = append(issues, ValidationIssue{
				Severity: "warning",
				Field:    prefix + ".image",
				Message:  "Using ':latest' tag or no tag — not reproducible",
				Fix:      "Pin to a specific version tag (e.g. nginx:1.25.3)",
			})
		}

		// Very high memory limit check
		if parseMemoryMiB(c.Memory) > 8192 {
			issues = append(issues, ValidationIssue{
				Severity: "info",
				Field:    prefix + ".resources.limits.memory",
				Message:  "Memory limit is very high (>8Gi) — verify this is intentional",
				Fix:      "Consider splitting into multiple smaller pods or using resource quotas",
			})
		}
	}

	return issues
}

func calculateScore(issues []ValidationIssue) int {
	score := 100
	for _, issue := range issues {
		switch issue.Severity {
		case "error":
			score -= 20
		case "warning":
			score -= 10
		case "info":
			score -= 2
		}
	}
	if score < 0 {
		score = 0
	}
	return score
}

func buildValidationSummary(issues []ValidationIssue, score int, kind string) string {
	errors := 0
	warnings := 0
	for _, i := range issues {
		if i.Severity == "error" {
			errors++
		} else if i.Severity == "warning" {
			warnings++
		}
	}

	if len(issues) == 0 {
		return fmt.Sprintf("%s configuration looks good! Score: %d/100", kind, score)
	}

	parts := []string{}
	if errors > 0 {
		parts = append(parts, fmt.Sprintf("%d error(s)", errors))
	}
	if warnings > 0 {
		parts = append(parts, fmt.Sprintf("%d warning(s)", warnings))
	}
	return fmt.Sprintf("%s has %s. Score: %d/100. Address errors before deploying to production.",
		kind, strings.Join(parts, " and "), score)
}
