package engine

// Package engine — concrete ReasoningEngine implementation.
//
// This implements the FULL investigation loop:
//   Build context → Render prompt → Call LLM with tools →
//   Accumulate findings → Conclude
//
// The LLM is given the full MCP tool catalog so it can call observation and
// analysis tools itself during the investigation.  Every stream event
// (text token + tool call) is forwarded to all registered subscribers so
// the frontend receives real-time progress updates via WebSocket.

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/kubilitics/kubilitics-ai/internal/audit"
	"github.com/kubilitics/kubilitics-ai/internal/db"
	"github.com/kubilitics/kubilitics-ai/internal/llm/adapter"
	"github.com/kubilitics/kubilitics-ai/internal/llm/types"
	reasoningContext "github.com/kubilitics/kubilitics-ai/internal/reasoning/context"
	"github.com/kubilitics/kubilitics-ai/internal/reasoning/prompt"
)

// InvestigationState represents the lifecycle state of an investigation.
type InvestigationState string

const (
	StateCreated       InvestigationState = "CREATED"
	StateInvestigating InvestigationState = "INVESTIGATING"
	StateAnalyzing     InvestigationState = "ANALYZING"
	StateConcluded     InvestigationState = "CONCLUDED"
	StateFailed        InvestigationState = "FAILED"
	StateCancelled     InvestigationState = "CANCELLED"
)

// Investigation holds the full state of a single investigation session.
type Investigation struct {
	ID            string                 `json:"id"`
	Type          string                 `json:"type"`
	State         InvestigationState     `json:"state"`
	Description   string                 `json:"description"`
	Context       string                 `json:"context"`
	Findings      []Finding              `json:"findings"`
	ToolCalls     []ToolCallRecord       `json:"tool_calls"`
	Conclusion    string                 `json:"conclusion"`
	Confidence    int                    `json:"confidence"`
	Steps         []Step                 `json:"steps"`
	Tokens        int                    `json:"tokens_used"`
	CreatedAt     time.Time              `json:"created_at"`
	UpdatedAt     time.Time              `json:"updated_at"`
	ConcludedAt   *time.Time             `json:"concluded_at,omitempty"`
	AutonomyLevel int                    `json:"autonomy_level"`
	Metadata      map[string]interface{} `json:"metadata"`
}

// Finding is a single discovered fact extracted from LLM output.
type Finding struct {
	Statement  string    `json:"statement"`
	Evidence   string    `json:"evidence"`
	Confidence int       `json:"confidence"`
	Severity   string    `json:"severity"`
	Timestamp  time.Time `json:"timestamp"`
}

// ToolCallRecord tracks every tool the LLM invoked during the investigation.
type ToolCallRecord struct {
	ToolName  string                 `json:"tool_name"`
	Args      map[string]interface{} `json:"args"`
	Result    string                 `json:"result"`
	TurnIndex int                    `json:"turn_index"`
	Timestamp time.Time              `json:"timestamp"`
}

// Step is a recorded step in the investigation process.
type Step struct {
	Number      int       `json:"number"`
	Description string    `json:"description"`
	Result      string    `json:"result"`
	Timestamp   time.Time `json:"timestamp"`
}

// InvestigationEvent is streamed to subscribers during an active investigation.
type InvestigationEvent struct {
	InvestigationID string             `json:"investigation_id"`
	Type            string             `json:"type"` // "step" | "tool" | "text" | "finding" | "conclusion" | "done" | "error"
	Step            *Step              `json:"step,omitempty"`
	ToolEvent       *types.ToolEvent   `json:"tool_event,omitempty"`
	TextToken       string             `json:"text_token,omitempty"`
	Finding         *Finding           `json:"finding,omitempty"`
	Conclusion      string             `json:"conclusion,omitempty"`
	Error           string             `json:"error,omitempty"`
	State           InvestigationState `json:"state"`
	Timestamp       time.Time          `json:"timestamp"`
}

// Subscriber receives investigation events in real-time.
type Subscriber struct {
	Ch chan InvestigationEvent
}

// LLMAdapterInterface enables test injection for the LLM adapter.
// adapter.LLMAdapter satisfies this interface.
type LLMAdapterInterface interface {
	CompleteWithTools(
		ctx context.Context,
		messages []types.Message,
		tools []types.Tool,
		executor types.ToolExecutor,
		cfg types.AgentConfig,
	) (<-chan types.AgentStreamEvent, error)

	CountTokens(ctx context.Context, messages []types.Message, tools []types.Tool) (int, error)
}

// Compile-time check: adapter.LLMAdapter satisfies LLMAdapterInterface.
var _ LLMAdapterInterface = (adapter.LLMAdapter)(nil)

// engineImpl is the concrete ReasoningEngine.
type engineImpl struct {
	mu sync.RWMutex
	// Dependencies
	store          db.Store
	contextBuilder reasoningContext.ContextBuilder
	promptManager  prompt.PromptManager
	llmAdapter     LLMAdapterInterface
	toolExecutor   types.ToolExecutor
	toolSchemas    []types.Tool
	auditLog       audit.Logger

	// Subscribers (investigation ID → list of subscribers)
	subsMu      sync.Mutex
	subscribers map[string][]*Subscriber
}

// NewReasoningEngineWithDeps creates a ReasoningEngine (backward-compat, no LLM).
func NewReasoningEngineWithDeps(
	store db.Store,
	cb reasoningContext.ContextBuilder,
	pm prompt.PromptManager,
	auditLog audit.Logger,
) ReasoningEngine {
	return &engineImpl{
		store:          store,
		contextBuilder: cb,
		promptManager:  pm,
		auditLog:       auditLog,
		subscribers:    make(map[string][]*Subscriber),
	}
}

// NewReasoningEngine creates a fully-wired ReasoningEngine with LLM execution.
func NewReasoningEngine(
	store db.Store,
	cb reasoningContext.ContextBuilder,
	pm prompt.PromptManager,
	llm LLMAdapterInterface,
	executor types.ToolExecutor,
	toolSchemas []types.Tool,
	auditLog audit.Logger,
) ReasoningEngine {
	return &engineImpl{
		store:          store,
		contextBuilder: cb,
		promptManager:  pm,
		llmAdapter:     llm,
		toolExecutor:   executor,
		toolSchemas:    toolSchemas,
		auditLog:       auditLog,
		subscribers:    make(map[string][]*Subscriber),
	}
}

// Subscribe registers a channel to receive real-time investigation events.
// Returns a Subscriber whose Ch will be closed when the investigation finishes.
func (e *engineImpl) Subscribe(investigationID string) *Subscriber {
	sub := &Subscriber{Ch: make(chan InvestigationEvent, 64)}
	e.subsMu.Lock()
	e.subscribers[investigationID] = append(e.subscribers[investigationID], sub)
	e.subsMu.Unlock()
	return sub
}

// publish sends an event to all subscribers of the given investigation.
func (e *engineImpl) publish(id string, ev InvestigationEvent) {
	e.subsMu.Lock()
	subs := e.subscribers[id]
	e.subsMu.Unlock()
	for _, s := range subs {
		select {
		case s.Ch <- ev:
		default:
		}
	}
}

// closeSubs closes all subscriber channels for an investigation.
func (e *engineImpl) closeSubs(id string) {
	e.subsMu.Lock()
	subs := e.subscribers[id]
	delete(e.subscribers, id)
	e.subsMu.Unlock()
	for _, s := range subs {
		close(s.Ch)
	}
}

// ─── Public interface ─────────────────────────────────────────────────────────

// Investigate starts a new investigation and returns its ID.
func (e *engineImpl) Investigate(ctx context.Context, description string, investigationType string, autonomyLevel int) (string, error) {
	if description == "" {
		return "", fmt.Errorf("investigation description is required")
	}
	if investigationType == "" {
		investigationType = "general"
	}

	correlationID := audit.GenerateCorrelationID()
	inv := &Investigation{
		ID:            correlationID,
		Type:          investigationType,
		State:         StateCreated,
		Description:   description,
		Findings:      []Finding{},
		ToolCalls:     []ToolCallRecord{},
		Steps:         []Step{},
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
		AutonomyLevel: autonomyLevel,
		Metadata:      map[string]interface{}{},
	}

	if err := e.saveInvestigation(ctx, inv); err != nil {
		return "", fmt.Errorf("failed to create investigation: %w", err)
	}

	// Detach from request context so investigation survives HTTP close.
	go e.runInvestigation(context.Background(), inv)

	if e.auditLog != nil {
		e.auditLog.Log(ctx, audit.NewEvent(audit.EventInvestigationStarted).
			WithCorrelationID(correlationID).
			WithDescription(fmt.Sprintf("Started investigation [%s]: %s", investigationType, description)).
			WithResult(audit.ResultPending))
	}

	return correlationID, nil
}

// GetInvestigation retrieves an investigation by ID.
func (e *engineImpl) GetInvestigation(ctx context.Context, id string) (interface{}, error) {
	dbRec, err := e.store.GetInvestigation(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to get investigation: %w", err)
	}
	return fromDBInvestigation(dbRec), nil
}

// CancelInvestigation cancels an in-progress investigation.
func (e *engineImpl) CancelInvestigation(ctx context.Context, id string) error {
	dbRec, err := e.store.GetInvestigation(ctx, id)
	if err != nil {
		return fmt.Errorf("investigation not found: %s", id)
	}
	inv := fromDBInvestigation(dbRec)

	if inv.State == StateConcluded || inv.State == StateCancelled || inv.State == StateFailed {
		return fmt.Errorf("investigation %s is already in terminal state: %s", id, inv.State)
	}
	inv.State = StateCancelled
	inv.UpdatedAt = time.Now()

	return e.saveInvestigation(ctx, inv)
}

// ListInvestigations returns all investigations.
func (e *engineImpl) ListInvestigations(ctx context.Context, _ interface{}) ([]interface{}, error) {
	recs, err := e.store.ListInvestigations(ctx, 100, 0)
	if err != nil {
		return nil, err
	}
	result := make([]interface{}, len(recs))
	for i, rec := range recs {
		result[i] = fromDBInvestigation(rec)
	}
	return result, nil
}

// SetLLMAdapter replaces the underlying LLM adapter at runtime.
func (e *engineImpl) SetLLMAdapter(adapter LLMAdapterInterface) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.llmAdapter = adapter
}

// ─── Core investigation loop ──────────────────────────────────────────────────

func (e *engineImpl) runInvestigation(ctx context.Context, inv *Investigation) {
	defer e.closeSubs(inv.ID)

	// Step 1: Build cluster context
	e.transition(inv, StateInvestigating)
	e.addStep(inv, "Build cluster context", "Gathering relevant cluster state…")
	e.publish(inv.ID, e.stepEvent(inv, inv.Steps[len(inv.Steps)-1]))

	var clusterContext string
	if e.contextBuilder != nil {
		built, err := e.contextBuilder.BuildContext(ctx, inv.Type, inv.Description, nil)
		if err == nil {
			clusterContext = built
		} else {
			clusterContext = fmt.Sprintf("Context unavailable: %v", err)
		}
	} else {
		clusterContext = "(no context builder — working from description only)"
	}
	inv.Context = clusterContext
	e.updateStep(inv, "Build cluster context",
		fmt.Sprintf("Context assembled (%d chars)", len(clusterContext)))
	e.publish(inv.ID, e.stepEvent(inv, inv.Steps[len(inv.Steps)-1]))

	// Step 2: Render investigation prompt
	e.transition(inv, StateAnalyzing)
	e.addStep(inv, "Generate investigation prompt", "Rendering chain-of-thought template…")
	e.publish(inv.ID, e.stepEvent(inv, inv.Steps[len(inv.Steps)-1]))

	var investigationPrompt string
	if e.promptManager != nil {
		rendered, err := e.promptManager.RenderInvestigationPrompt(ctx, inv.Type, inv.Description, clusterContext)
		if err == nil {
			investigationPrompt = rendered
		}
	}
	if investigationPrompt == "" {
		investigationPrompt = fmt.Sprintf(
			"Investigate the following Kubernetes issue:\n\n%s\n\nCluster context:\n%s",
			inv.Description, clusterContext)
	}
	e.updateStep(inv, "Generate investigation prompt", "Prompt ready")
	e.publish(inv.ID, e.stepEvent(inv, inv.Steps[len(inv.Steps)-1]))

	// Step 3: LLM agentic loop
	if e.llmAdapter == nil || e.toolExecutor == nil {
		e.addStep(inv, "LLM analysis skipped",
			"No LLM adapter configured; investigation context prepared for manual review")
		e.publish(inv.ID, e.stepEvent(inv, inv.Steps[len(inv.Steps)-1]))
		e.conclude(ctx, inv, "(LLM not configured — review context manually)", 0)
		return
	}

	e.addStep(inv, "LLM investigation", "Running agentic investigation loop…")
	e.publish(inv.ID, e.stepEvent(inv, inv.Steps[len(inv.Steps)-1]))

	// Save initial progress
	_ = e.saveInvestigation(ctx, inv)

	messages := []types.Message{
		{Role: "system", Content: buildSystemPrompt()},
		{Role: "user", Content: investigationPrompt},
	}

	if tokenCount, err := e.llmAdapter.CountTokens(ctx, messages, e.toolSchemas); err == nil {
		inv.Tokens = tokenCount
	}

	agentCfg := types.DefaultAgentConfig()
	agentCfg.MaxTurns = 12

	// Use investigation-specific autonomy level for tool execution
	// If inv.AutonomyLevel is 0, the executor will fall back to its configured default
	// or we can explicitly set it here if needed.
	// The ToolExecutor.WithAutonomyLevel method handles the logic of returning a modified executor.
	scopedExecutor := e.toolExecutor
	if inv.AutonomyLevel > 0 {
		scopedExecutor = e.toolExecutor.WithAutonomyLevel(inv.AutonomyLevel)
	}

	eventCh, err := e.llmAdapter.CompleteWithTools(ctx, messages, e.toolSchemas, scopedExecutor, agentCfg)
	if err != nil {
		e.failInvestigation(ctx, inv, fmt.Sprintf("LLM call failed: %v", err))
		return
	}

	var responseBuilder strings.Builder
	var toolCallRecords []ToolCallRecord
	var lastToolEvent *types.ToolEvent

	for ev := range eventCh {
		if ev.Err != nil {
			e.failInvestigation(ctx, inv, fmt.Sprintf("LLM stream error: %v", ev.Err))
			return
		}
		if ev.Done {
			break
		}

		if ev.TextToken != "" {
			responseBuilder.WriteString(ev.TextToken)
			e.publish(inv.ID, InvestigationEvent{
				InvestigationID: inv.ID,
				Type:            "text",
				TextToken:       ev.TextToken,
				State:           inv.State,
				Timestamp:       time.Now(),
			})
		}

		if ev.ToolEvent != nil {
			te := ev.ToolEvent
			e.publish(inv.ID, InvestigationEvent{
				InvestigationID: inv.ID,
				Type:            "tool",
				ToolEvent:       te,
				State:           inv.State,
				Timestamp:       time.Now(),
			})
			switch te.Phase {
			case "calling":
				lastToolEvent = te
			case "result":
				var args map[string]interface{}
				if lastToolEvent != nil {
					args = lastToolEvent.Args
				}
				rec := ToolCallRecord{
					ToolName:  te.ToolName,
					Args:      args,
					Result:    te.Result,
					TurnIndex: te.TurnIndex,
					Timestamp: time.Now(),
				}
				toolCallRecords = append(toolCallRecords, rec)
				e.mu.Lock()
				inv.ToolCalls = append(inv.ToolCalls, rec)
				inv.UpdatedAt = time.Now()
				e.mu.Unlock()

				// Persist tool call
				_ = e.saveInvestigation(ctx, inv)
			}
		}
	}

	fullResponse := responseBuilder.String()
	e.updateStep(inv, "LLM investigation",
		fmt.Sprintf("Investigation complete (%d chars, %d tool calls)",
			len(fullResponse), len(toolCallRecords)))
	e.publish(inv.ID, e.stepEvent(inv, inv.Steps[len(inv.Steps)-1]))

	// Step 4: Extract findings
	findings, conclusion := extractAnalysis(fullResponse, toolCallRecords)
	e.mu.Lock()
	inv.Findings = findings
	inv.Metadata["raw_response_len"] = len(fullResponse)
	inv.Metadata["tool_calls_count"] = len(toolCallRecords)
	e.mu.Unlock()

	for i := range findings {
		e.publish(inv.ID, InvestigationEvent{
			InvestigationID: inv.ID,
			Type:            "finding",
			Finding:         &findings[i],
			State:           inv.State,
			Timestamp:       time.Now(),
		})
	}

	// Step 5: Conclude
	confidence := calculateConfidence(findings)
	e.conclude(ctx, inv, conclusion, confidence)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func buildSystemPrompt() string {
	return `You are Kubilitics AI — an expert Kubernetes SRE with deep knowledge of Kubernetes internals.

Your role: diagnose Kubernetes issues with expert accuracy and propose actionable fixes.

INVESTIGATION APPROACH:
1. Call observation tools to gather current cluster state
2. Use analysis tools to identify patterns and anomalies
3. Form and test hypotheses with additional tool calls
4. Document findings with evidence from tool results
5. Conclude with root cause and prioritized recommendations

OUTPUT FORMAT:
You MUST output your final analysis in strictly valid JSON format matching this schema:
{
  "findings": [
    {
      "statement": "Key discovery statement",
      "evidence": "Tool output or log snippet supporting this",
      "confidence": 0-100,
      "severity": "critical|high|medium|low|info"
    }
  ],
  "root_cause": "Concise summary of the primary issue",
  "recommendations": [
    "Actionable step 1",
    "Actionable step 2"
  ]
}

SAFETY RULES:
- Never suggest deleting resources without explicit justification
- Always recommend dry-run before destructive operations
- Flag security concerns immediately`
}

type jsonAnalysis struct {
	Findings []struct {
		Statement  string `json:"statement"`
		Evidence   string `json:"evidence"`
		Confidence int    `json:"confidence"`
		Severity   string `json:"severity"`
	} `json:"findings"`
	RootCause       string   `json:"root_cause"`
	Recommendations []string `json:"recommendations"`
}

func extractFindingsLegacy(response string, toolCalls []ToolCallRecord) []Finding {
	var findings []Finding
	lines := strings.Split(response, "\n")
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "**Finding:**") || strings.HasPrefix(line, "Finding:") {
			statement := strings.TrimPrefix(strings.TrimPrefix(line, "**Finding:**"), "Finding:")
			statement = strings.TrimSpace(statement)
			if statement == "" && i+1 < len(lines) {
				statement = strings.TrimSpace(lines[i+1])
			}
			if statement != "" {
				evidence := ""
				for j := i + 1; j < len(lines) && j < i+4; j++ {
					if strings.Contains(lines[j], "evidence") || strings.Contains(lines[j], "tool") {
						evidence = strings.TrimSpace(lines[j])
						break
					}
				}
				findings = append(findings, Finding{
					Statement:  statement,
					Evidence:   evidence,
					Confidence: 70,
					Severity:   inferSeverity(statement),
					Timestamp:  time.Now(),
				})
			}
		}
	}
	for _, tc := range toolCalls {
		if len(tc.Result) > 20 {
			findings = append(findings, Finding{
				Statement:  fmt.Sprintf("Tool %s returned data relevant to investigation", tc.ToolName),
				Evidence:   truncate(tc.Result, 200),
				Confidence: 60,
				Severity:   "info",
				Timestamp:  tc.Timestamp,
			})
		}
	}
	return findings
}

func extractConclusionLegacy(response string) string {
	lines := strings.Split(response, "\n")
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "**Root Cause:**") || strings.HasPrefix(line, "Root Cause:") {
			conclusion := strings.TrimPrefix(strings.TrimPrefix(line, "**Root Cause:**"), "Root Cause:")
			conclusion = strings.TrimSpace(conclusion)
			if conclusion == "" && i+1 < len(lines) {
				conclusion = strings.TrimSpace(lines[i+1])
			}
			if conclusion != "" {
				return conclusion
			}
		}
	}
	paras := strings.Split(strings.TrimSpace(response), "\n\n")
	if len(paras) > 0 {
		last := strings.TrimSpace(paras[len(paras)-1])
		if len(last) > 20 {
			return truncate(last, 400)
		}
	}
	return "Investigation complete — review findings above for details"
}

// extractJSONBlock strips optional markdown fences and returns the outermost
// JSON object found in the LLM response.  Handles:
//   - Bare JSON:       { ... }
//   - Code-fenced:     ```json\n{ ... }\n```  or  ```\n{ ... }\n```
func extractJSONBlock(response string) (string, bool) {
	// Strip markdown code fences if present.
	stripped := response
	for _, fence := range []string{"```json", "```JSON", "```"} {
		if idx := strings.Index(stripped, fence); idx != -1 {
			stripped = stripped[idx+len(fence):]
			if end := strings.Index(stripped, "```"); end != -1 {
				stripped = stripped[:end]
			}
			break
		}
	}

	jsonStart := strings.Index(stripped, "{")
	jsonEnd := strings.LastIndex(stripped, "}")
	if jsonStart != -1 && jsonEnd != -1 && jsonEnd > jsonStart {
		return stripped[jsonStart : jsonEnd+1], true
	}
	return "", false
}

func extractAnalysis(response string, toolCallRecords []ToolCallRecord) ([]Finding, string) {
	var findings []Finding
	var conclusion string

	// AI-009: Try JSON-first structured output (handles code fences + bare JSON).
	if jsonStr, ok := extractJSONBlock(response); ok {
		var analysis jsonAnalysis
		if err := json.Unmarshal([]byte(jsonStr), &analysis); err == nil && len(analysis.Findings) > 0 {
			for _, f := range analysis.Findings {
				sev := strings.ToLower(f.Severity)
				if sev == "" {
					sev = inferSeverity(f.Statement)
				}
				conf := f.Confidence
				if conf <= 0 || conf > 100 {
					conf = 70 // sensible default when LLM omits or sends invalid value
				}
				findings = append(findings, Finding{
					Statement:  f.Statement,
					Evidence:   f.Evidence,
					Confidence: conf,
					Severity:   sev,
					Timestamp:  time.Now(),
				})
			}
			conclusion = analysis.RootCause
			if len(analysis.Recommendations) > 0 {
				conclusion += "\n\nRecommendations:\n- " + strings.Join(analysis.Recommendations, "\n- ")
			}
			return findings, conclusion
		}
	}

	// Fallback to text extraction if JSON parsing failed or yielded nothing.
	return extractFindingsLegacy(response, toolCallRecords), extractConclusionLegacy(response)
}

func calculateConfidence(findings []Finding) int {
	if len(findings) == 0 {
		return 30
	}
	total := 0
	for _, f := range findings {
		total += f.Confidence
	}
	avg := total / len(findings)
	if len(findings) >= 3 {
		avg = minInt(avg+10, 100)
	}
	return avg
}

func (e *engineImpl) conclude(ctx context.Context, inv *Investigation, conclusion string, confidence int) {
	e.mu.Lock()
	inv.Conclusion = conclusion
	inv.Confidence = confidence
	e.mu.Unlock()

	e.transition(inv, StateConcluded)
	now := time.Now()
	e.mu.Lock()
	inv.ConcludedAt = &now
	e.mu.Unlock()

	_ = e.saveInvestigation(ctx, inv)

	e.publish(inv.ID, InvestigationEvent{
		InvestigationID: inv.ID,
		Type:            "conclusion",
		Conclusion:      conclusion,
		State:           StateConcluded,
		Timestamp:       now,
	})
	e.publish(inv.ID, InvestigationEvent{
		InvestigationID: inv.ID,
		Type:            "done",
		State:           StateConcluded,
		Timestamp:       now,
	})

	if e.auditLog != nil {
		e.auditLog.Log(ctx, audit.NewEvent(audit.EventInvestigationCompleted).
			WithCorrelationID(inv.ID).
			WithDescription(fmt.Sprintf("Investigation concluded (confidence=%d%%): %s",
				confidence, truncate(conclusion, 100))).
			WithResult(audit.ResultSuccess))
	}
}

func (e *engineImpl) failInvestigation(ctx context.Context, inv *Investigation, reason string) {
	e.transition(inv, StateFailed)
	_ = e.saveInvestigation(ctx, inv)

	e.publish(inv.ID, InvestigationEvent{
		InvestigationID: inv.ID,
		Type:            "error",
		Error:           reason,
		State:           StateFailed,
		Timestamp:       time.Now(),
	})
	e.publish(inv.ID, InvestigationEvent{
		InvestigationID: inv.ID,
		Type:            "done",
		State:           StateFailed,
		Timestamp:       time.Now(),
	})
	if e.auditLog != nil {
		e.auditLog.Log(ctx, audit.NewEvent(audit.EventInvestigationFailed).
			WithCorrelationID(inv.ID).
			WithDescription(fmt.Sprintf("Investigation failed: %s", reason)).
			WithResult(audit.ResultFailure))
	}
}

func (e *engineImpl) stepEvent(inv *Investigation, s Step) InvestigationEvent {
	return InvestigationEvent{
		InvestigationID: inv.ID,
		Type:            "step",
		Step:            &s,
		State:           inv.State,
		Timestamp:       time.Now(),
	}
}

func (e *engineImpl) transition(inv *Investigation, state InvestigationState) {
	e.mu.Lock()
	defer e.mu.Unlock()
	inv.State = state
	inv.UpdatedAt = time.Now()
}

func (e *engineImpl) addStep(inv *Investigation, description, result string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	inv.Steps = append(inv.Steps, Step{
		Number:      len(inv.Steps) + 1,
		Description: description,
		Result:      result,
		Timestamp:   time.Now(),
	})
	inv.UpdatedAt = time.Now()
}

func (e *engineImpl) updateStep(inv *Investigation, description, result string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for i := len(inv.Steps) - 1; i >= 0; i-- {
		if inv.Steps[i].Description == description {
			inv.Steps[i].Result = result
			break
		}
	}
	inv.UpdatedAt = time.Now()
}

func inferSeverity(text string) string {
	lower := strings.ToLower(text)
	switch {
	case strings.Contains(lower, "crash") || strings.Contains(lower, "oom") ||
		strings.Contains(lower, "critical") || strings.Contains(lower, "down") ||
		strings.Contains(lower, "fail"):
		return "critical"
	case strings.Contains(lower, "error") || strings.Contains(lower, "high") ||
		strings.Contains(lower, "pressure") || strings.Contains(lower, "restart"):
		return "high"
	case strings.Contains(lower, "warning") || strings.Contains(lower, "throttl") ||
		strings.Contains(lower, "slow") || strings.Contains(lower, "pending"):
		return "medium"
	default:
		return "low"
	}
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ─── DB Mapping Helpers ───────────────────────────────────────────────────────

func (e *engineImpl) saveInvestigation(ctx context.Context, inv *Investigation) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.store.SaveInvestigation(ctx, toDBInvestigation(inv))
}

func toDBInvestigation(inv *Investigation) *db.InvestigationRecord {
	metadataBytes, _ := json.Marshal(inv.Metadata)
	if len(metadataBytes) == 0 {
		metadataBytes = []byte("{}")
	}

	rec := &db.InvestigationRecord{
		ID:          inv.ID,
		Type:        inv.Type,
		State:       string(inv.State),
		Description: inv.Description,
		Context:     inv.Context,
		Conclusion:  inv.Conclusion,
		Confidence:  inv.Confidence,
		Metadata:    string(metadataBytes),
		CreatedAt:   inv.CreatedAt,
		UpdatedAt:   inv.UpdatedAt,
	}

	for _, f := range inv.Findings {
		rec.Findings = append(rec.Findings, db.FindingRecord{
			Statement:  f.Statement,
			Evidence:   f.Evidence,
			Confidence: f.Confidence,
			Severity:   f.Severity,
			Timestamp:  f.Timestamp,
		})
	}

	for _, tc := range inv.ToolCalls {
		argsBytes, _ := json.Marshal(tc.Args)
		if len(argsBytes) == 0 {
			argsBytes = []byte("{}")
		}
		rec.ToolCalls = append(rec.ToolCalls, db.ToolCallRecord{
			ToolName:  tc.ToolName,
			Args:      string(argsBytes),
			Result:    tc.Result,
			TurnIndex: tc.TurnIndex,
			Timestamp: tc.Timestamp,
		})
	}

	for _, s := range inv.Steps {
		rec.Steps = append(rec.Steps, db.StepRecord{
			Number:      s.Number,
			Description: s.Description,
			Result:      s.Result,
			Timestamp:   s.Timestamp,
		})
	}

	return rec
}

func fromDBInvestigation(rec *db.InvestigationRecord) *Investigation {
	inv := &Investigation{
		ID:          rec.ID,
		Type:        rec.Type,
		State:       InvestigationState(rec.State),
		Description: rec.Description,
		Context:     rec.Context,
		Conclusion:  rec.Conclusion,
		Confidence:  rec.Confidence,
		Tokens:      0, // Not persisted in DB yet
		CreatedAt:   rec.CreatedAt,
		UpdatedAt:   rec.UpdatedAt,
		Metadata:    make(map[string]interface{}),
	}
	if len(rec.Metadata) > 0 {
		_ = json.Unmarshal([]byte(rec.Metadata), &inv.Metadata)
	}

	if rec.State == string(StateConcluded) {
		inv.ConcludedAt = &rec.UpdatedAt
	}

	for _, f := range rec.Findings {
		inv.Findings = append(inv.Findings, Finding{
			Statement:  f.Statement,
			Evidence:   f.Evidence,
			Confidence: f.Confidence,
			Severity:   f.Severity,
			Timestamp:  f.Timestamp,
		})
	}

	for _, tc := range rec.ToolCalls {
		args := make(map[string]interface{})
		if len(tc.Args) > 0 {
			_ = json.Unmarshal([]byte(tc.Args), &args)
		}
		inv.ToolCalls = append(inv.ToolCalls, ToolCallRecord{
			ToolName:  tc.ToolName,
			Args:      args,
			Result:    tc.Result,
			TurnIndex: tc.TurnIndex,
			Timestamp: tc.Timestamp,
		})
	}

	for _, s := range rec.Steps {
		inv.Steps = append(inv.Steps, Step{
			Number:      s.Number,
			Description: s.Description,
			Result:      s.Result,
			Timestamp:   s.Timestamp,
		})
	}

	return inv
}
