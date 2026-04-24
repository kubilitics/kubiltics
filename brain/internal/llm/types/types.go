package types

import (
	"sort"
	"strings"
)

// Message represents a message in a conversation
type Message struct {
	Role    string `json:"role"`    // user, assistant, system
	Content string `json:"content"` // message text
}

// Tool represents a tool/function definition that can be called by the LLM
type Tool struct {
	Name                  string                 `json:"name"`                              // tool name
	Description           string                 `json:"description"`                       // what the tool does
	Parameters            map[string]interface{} `json:"parameters"`                        // JSON schema for parameters
	RequiredAutonomyLevel int                    `json:"required_autonomy_level,omitempty"` // Minimum autonomy level required
}

// ToolCall represents a tool call made by the LLM
type ToolCall struct {
	ID        string                 `json:"id"`        // unique call ID
	Type      string                 `json:"type"`      // "function" or "tool_use"
	Name      string                 `json:"name"`      // tool name
	Arguments map[string]interface{} `json:"arguments"` // tool arguments
}

// CompletionRequest represents a request to complete text
type CompletionRequest struct {
	Messages []Message `json:"messages"` // conversation history
	Tools    []Tool    `json:"tools"`    // available tools
}

// CompletionResponse represents a completion response
type CompletionResponse struct {
	Content   string     `json:"content"`    // generated text
	ToolCalls []ToolCall `json:"tool_calls"` // tools called
	Usage     TokenUsage `json:"usage"`      // token usage
}

// MaxToolsPerRequest is the maximum number of tools to send in a single LLM API request.
// OpenAI and Anthropic APIs reject requests with more than 128 tools.
const MaxToolsPerRequest = 128

// CapToolsForAPI returns at most MaxToolsPerRequest tools so the API payload stays within limits.
// This is a safety-net truncation; prefer SelectToolsForQuery for intent-aware selection.
// The executor may still have more handlers; only the list sent to the LLM is capped.
func CapToolsForAPI(tools []Tool) []Tool {
	if len(tools) <= MaxToolsPerRequest {
		return tools
	}
	return tools[:MaxToolsPerRequest]
}

// queryIntent classifies a user message into capability areas.
// Returns a set of lowercase keywords found in the message, used to
// score tool relevance for SelectToolsForQuery.
func queryIntent(userMessage string) map[string]bool {
	msg := strings.ToLower(userMessage)
	kws := map[string]bool{}
	for _, kw := range []string{
		// Observation / listing
		"list", "show", "get", "fetch", "describe", "all", "pods", "pod",
		"deployments", "deployment", "services", "service", "nodes", "node",
		"namespaces", "namespace", "pvc", "configmap", "secret", "ingress",
		"resource", "resources", "replicaset", "statefulset", "daemonset",
		// Logs
		"log", "logs", "output", "stdout", "stderr", "print",
		// Events
		"event", "events", "warning", "warnings",
		// Health / status
		"health", "status", "ready", "running", "unhealthy", "condition",
		// Troubleshooting / debugging
		"crash", "crashloop", "error", "fail", "failed", "failing",
		"oom", "evicted", "pending", "restart", "restarts", "debug",
		"why", "broken", "not working", "stuck",
		// Metrics / performance
		"metric", "metrics", "cpu", "memory", "usage", "utilization",
		"top", "performance", "slow", "latency", "throughput",
		// Security
		"security", "rbac", "role", "rolebinding", "clusterrole",
		"networkpolicy", "psp", "securitycontext", "vulnerability",
		"compliance", "audit", "permission", "access", "privilege",
		// Cost / optimization
		"cost", "price", "spend", "budget", "waste", "optimize",
		"rightsizing", "limit", "request", "resource quota",
		// Scaling
		"scale", "scaling", "replicas", "hpa", "vpa", "autoscal",
		// Automation / actions
		"apply", "delete", "create", "patch", "rollout", "restart",
		"rollback", "deploy", "upgrade",
		// Analysis
		"analyze", "analysis", "investigate", "check", "inspect",
		"compare", "diff", "trend", "anomaly", "pattern",
	} {
		if strings.Contains(msg, kw) {
			kws[kw] = true
		}
	}
	return kws
}

// toolRelevance scores a tool's relevance to a set of intent keywords.
// Higher score = more relevant to the user's query.
func toolRelevance(tool Tool, intent map[string]bool) int {
	score := 0
	haystack := strings.ToLower(tool.Name + " " + tool.Description)
	for kw := range intent {
		if strings.Contains(haystack, kw) {
			score++
		}
	}
	return score
}

// SelectToolsForQuery returns the most relevant subset of tools for a given
// user message, staying within MaxToolsPerRequest.
//
// Strategy:
//  1. If tool count ≤ MaxToolsPerRequest, return all (no truncation needed).
//  2. Score each tool against the query intent (keyword overlap).
//  3. Always include tools with score > 0 (explicitly relevant).
//  4. Fill remaining slots from unscored tools (general capabilities).
//  5. Never exceed MaxToolsPerRequest; always return all tools if possible.
//
// This ensures that when a user asks about "security" they get security tools
// even if those happen to be beyond position 128 in the full list.
func SelectToolsForQuery(allTools []Tool, userMessage string) []Tool {
	if len(allTools) <= MaxToolsPerRequest {
		return allTools
	}

	intent := queryIntent(userMessage)

	type scored struct {
		tool  Tool
		score int
	}

	relevant := make([]scored, 0, MaxToolsPerRequest)
	fallback := make([]scored, 0, len(allTools))

	for _, t := range allTools {
		s := toolRelevance(t, intent)
		if s > 0 {
			relevant = append(relevant, scored{t, s})
		} else {
			fallback = append(fallback, scored{t, s})
		}
	}

	// Sort relevant by score descending
	sort.Slice(relevant, func(i, j int) bool {
		return relevant[i].score > relevant[j].score
	})

	// Build result: relevant first, then fill with fallback
	result := make([]Tool, 0, MaxToolsPerRequest)
	for _, s := range relevant {
		if len(result) >= MaxToolsPerRequest {
			break
		}
		result = append(result, s.tool)
	}
	for _, s := range fallback {
		if len(result) >= MaxToolsPerRequest {
			break
		}
		result = append(result, s.tool)
	}
	return result
}

// TokenUsage tracks token usage and cost
type TokenUsage struct {
	PromptTokens     int     `json:"prompt_tokens"`     // input tokens
	CompletionTokens int     `json:"completion_tokens"` // output tokens
	TotalTokens      int     `json:"total_tokens"`      // total tokens
	EstimatedCost    float64 `json:"estimated_cost"`    // estimated cost in USD
}
