package prompt

// Package prompt — concrete PromptManager implementation with chain-of-thought templates.

import (
	"context"
	"fmt"
	"strings"
)

// promptManagerImpl is the concrete implementation of PromptManager.
type promptManagerImpl struct{}

// NewPromptManager creates a new prompt manager.
func NewPromptManager() PromptManager {
	return &promptManagerImpl{}
}

// ─── System prompts ───────────────────────────────────────────────────────────

const kubiliticsSystemPrompt = `You are Kubilitics AI, an expert Kubernetes cluster assistant embedded inside the Kubilitics dashboard.

ROLE:
- Diagnose Kubernetes issues with expert-level accuracy
- Propose actionable fixes with appropriate caution
- Always explain your reasoning step by step (chain of thought)
- Never execute destructive actions without explicit user confirmation

SAFETY RULES (NON-NEGOTIABLE):
1. Never suggest deleting production namespaces or cluster-level resources without a clear justification
2. Always recommend dry-run mode before destructive operations
3. When uncertain, ask for more information rather than guessing
4. Flag any security concerns you discover during investigation

NAMESPACE:
- For pod, deployment, or other namespaced resources, always require or infer namespace
- If the user does not specify a namespace, ask: "Which namespace is that in?" or infer from context (e.g. current page) when available
- Do not assume "default"; only use it when the user explicitly says so

TOOL USE:
- Use the minimal set of tools needed. For "pod names in deployment X" or "list pods in namespace Y": use list_resources (kind=Pod, namespace=...) first; only use deployment/replicaset-specific tools if you need ownership or rollout details.
- Do not pass a deployment name to tools that expect a ReplicaSet name (ReplicaSet names include a hash suffix, e.g. my-deploy-abc123).
- When a tool call fails, do not repeat the raw error to the user. In "What I executed" you may briefly note "I tried X; it wasn't needed for this answer" and lead with the successful outcome. Keep the final answer clear and positive.
- Use observation tools to gather data before forming conclusions; use analysis tools only when deeper diagnostics are needed.
- Only propose execution tool calls when you have high confidence and user consent.

OUTPUT FORMAT:
- Structure responses with clear sections: Observation, Analysis, Findings, Recommendation
- Express confidence as a percentage (e.g. "Confidence: 85%")
- Quote specific resource names and namespaces
- Provide kubectl commands the user can run to verify your findings

HUMANIZED RESPONSE TEMPLATE (use for user-facing answers):
1. **What you asked** — Briefly restate the question
2. **What I executed** — List the tools you called (e.g. list_resources, get_resource)
3. **Findings** — Present the data (lists, counts, or tables)
4. **Analysis** — Short interpretation if relevant
5. **Suggested action** — Only when relevant

TABLES AND LISTS:
- When the user asks for "pod names", "list pods", "pods in namespace X": respond with a clear list or a markdown table of pod names (and namespace if more than one).
- When the user asks for "pod names and usage", "usage in table", "pods with their usage": use list_resources (kind=Pod) and get_resource or metrics, then format the answer as a **markdown table** with columns such as: Pod name | Namespace | CPU | Memory | Status (or whatever the tool results provide).
- Use markdown table syntax: | Col1 | Col2 | followed by |---|---| and then data rows.
- Prefer tables when the user asks for "table", "in a table", or multiple attributes (names + usage, names + status).`

const anthropicSystemPrompt = kubiliticsSystemPrompt + `

ANTHROPIC-SPECIFIC:
- Use <thinking> tags for your internal chain of thought before responding
- Be concise in final answers but thorough in reasoning`

const openaiSystemPrompt = kubiliticsSystemPrompt + `

FORMAT:
- Use markdown for structured output
- Use bullet points for findings lists
- Bold important resource names and error messages`

// ─── Investigation prompt templates ───────────────────────────────────────────

var investigationTemplates = map[string]string{
	"pod_crash": `## Investigation: Pod Crash / Restart Loop

**Target:** {{.Description}}

**Cluster Context:**
{{.Context}}

**Your Task:**
Investigate the pod crash/restart issue above. Follow this approach:
1. Use list_resources and get_resource to understand the pod state
2. Use get_events to find warning events
3. Use analyze_pod_health to get restart counts and OOMKill history
4. Use analyze_log_patterns to extract error patterns from logs
5. Form a root cause hypothesis with evidence

Provide: Root Cause | Confidence | Recommended Action`,

	"performance": `## Investigation: Performance Degradation

**Target:** {{.Description}}

**Cluster Context:**
{{.Context}}

**Your Task:**
Investigate the performance issue. Follow this approach:
1. Use analyze_node_pressure to check node resource pressure
2. Use detect_resource_contention to find CPU/memory overcommit
3. Use analyze_deployment_health to check replica availability
4. Use check_resource_limits to find missing limits
5. Use analyze_hpa_behavior to check scaling behavior

Provide: Root Cause | Confidence | Recommended Action`,

	"security": `## Investigation: Security Concern

**Target:** {{.Description}}

**Cluster Context:**
{{.Context}}

**Your Task:**
Investigate the security issue. Follow this approach:
1. Use assess_security_posture to get CIS benchmark findings
2. Use analyze_rbac_permissions to find overprivileged accounts
3. Use analyze_network_connectivity to check for exposed services
4. Review pod security contexts for privileged containers

Provide: Risk Level | Findings | Recommended Hardening`,

	"cost": `## Investigation: Cost Anomaly

**Target:** {{.Description}}

**Cluster Context:**
{{.Context}}

**Your Task:**
Investigate the cost anomaly. Follow this approach:
1. Use check_resource_limits to find missing/misconfigured limits
2. Use detect_resource_contention to find overprovisioned resources
3. Use analyze_hpa_behavior to check for inefficient scaling
4. Use list_resources to identify unused/idle resources

Provide: Cost Driver | Savings Estimate | Recommended Action`,

	"deployment_failure": `## Investigation: Deployment Failure

**Target:** {{.Description}}

**Cluster Context:**
{{.Context}}

**Your Task:**
Investigate the deployment failure. Follow this approach:
1. Use analyze_deployment_health to get rollout conditions
2. Use get_events to find image pull or scheduling errors
3. Use analyze_pod_health to check new pod health
4. Use analyze_log_patterns on crashing containers
5. Check if previous revision was healthy

Provide: Failure Cause | Confidence | Rollback Decision`,

	"storage": `## Investigation: Storage Issue

**Target:** {{.Description}}

**Cluster Context:**
{{.Context}}

**Your Task:**
Investigate the storage issue. Follow this approach:
1. Use analyze_storage_health to find unbound PVCs
2. Use get_events to find PVC binding failures
3. Use list_resources for PersistentVolumes to check available capacity
4. Check StorageClass provisioner status

Provide: Root Cause | Affected Pods | Recommended Action`,

	"network": `## Investigation: Network Issue

**Target:** {{.Description}}

**Cluster Context:**
{{.Context}}

**Your Task:**
Investigate the network issue. Follow this approach:
1. Use analyze_network_connectivity to check service endpoints
2. Use list_resources for NetworkPolicies to check for blocking rules
3. Use get_events to find DNS or connectivity errors
4. Check ingress configuration if applicable

Provide: Root Cause | Affected Services | Recommended Fix`,

	"general": `## Investigation: General Issue

**Target:** {{.Description}}

**Cluster Context:**
{{.Context}}

**Your Task:**
Investigate the reported issue. Start by gathering relevant cluster state, then form a hypothesis.
Use the available observation and analysis tools methodically.

Provide: Root Cause | Evidence | Confidence | Recommended Action`,
}

// ─── Chain of thought templates ───────────────────────────────────────────────

var cotTemplates = map[string]string{
	"hypothesis": `**Hypothesis:** {{.Statement}}
**Rationale:** {{.Rationale}}
**Confidence:** {{.Confidence}}%
**Next Steps:** {{.NextSteps}}`,

	"finding": `**Finding:** {{.Statement}}
**Evidence:** {{.Evidence}}
**Confidence:** {{.Confidence}}%
**Severity:** {{.Severity}}`,

	"conclusion": `**Root Cause:** {{.RootCause}}
**Impact:** {{.Impact}}
**Confidence:** {{.Confidence}}%
**Recommended Actions:**
{{.Actions}}`,

	"tool_call": `**Tool:** {{.ToolName}}
**Purpose:** {{.Purpose}}
**Args:** {{.Args}}`,

	"step": `**Step {{.Number}}:** {{.Description}}
**Result:** {{.Result}}`,
}

// ─── promptManagerImpl methods ────────────────────────────────────────────────

func (m *promptManagerImpl) GetSystemPrompt(_ context.Context, llmProvider string) (string, error) {
	switch strings.ToLower(llmProvider) {
	case "anthropic":
		return anthropicSystemPrompt, nil
	case "openai":
		return openaiSystemPrompt, nil
	default:
		return kubiliticsSystemPrompt, nil
	}
}

func (m *promptManagerImpl) RenderInvestigationPrompt(_ context.Context, investigationType, description, clusterContext string) (string, error) {
	tmpl, ok := investigationTemplates[investigationType]
	if !ok {
		tmpl = investigationTemplates["general"]
	}

	// Simple template substitution
	rendered := strings.ReplaceAll(tmpl, "{{.Description}}", description)
	rendered = strings.ReplaceAll(rendered, "{{.Context}}", clusterContext)

	return rendered, nil
}

func (m *promptManagerImpl) GetChainOfThoughtTemplate(_ context.Context, stepType string) (string, error) {
	tmpl, ok := cotTemplates[stepType]
	if !ok {
		return "", fmt.Errorf("unknown step type: %s", stepType)
	}
	return tmpl, nil
}

func (m *promptManagerImpl) ValidateStructuredOutput(_ context.Context, output interface{}, schemaType string) error {
	if output == nil {
		return fmt.Errorf("output is nil for schema type: %s", schemaType)
	}
	// Basic validation — structured output is accepted if non-nil
	// Full JSON Schema validation would be added with a library
	return nil
}

func (m *promptManagerImpl) GetToolCallingPrompt(_ context.Context, toolName string) (string, error) {
	return fmt.Sprintf(`When calling tool '%s': state your purpose clearly before calling, interpret the result carefully, and use the findings to refine your investigation.`, toolName), nil
}

func (m *promptManagerImpl) ListPromptVersions(_ context.Context) ([]interface{}, error) {
	versions := make([]interface{}, 0, len(investigationTemplates))
	for name := range investigationTemplates {
		versions = append(versions, map[string]string{
			"name":    name,
			"version": "1.0.0",
		})
	}
	return versions, nil
}
