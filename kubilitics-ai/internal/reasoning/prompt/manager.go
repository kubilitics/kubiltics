package prompt

import "context"

// Package prompt provides prompt template management for investigations.
//
// Responsibilities:
//   - Manage system prompts that define LLM behavior and constraints
//   - Render investigation-specific prompts from templates
//   - Enforce Chain-of-Thought structured output formats
//   - Manage structured output parsing templates
//   - Handle prompt versioning for A/B testing
//   - Track prompt effectiveness via Analytics
//   - Support multiple LLM providers with provider-specific prompts
//
// Prompt Types:
//
//   1. System Prompt
//      - Defines LLM's role, constraints, and tool availability
//      - Enforces safety rules and ethical guidelines
//      - Provider-specific (OpenAI, Anthropic, Ollama)
//      - Rarely changes during runtime
//
//   2. Investigation Prompt
//      - Specific to each investigation trigger
//      - Includes investigation type, description, context
//      - Instructs LLM on next steps (hypothesize, explore, etc.)
//
//   3. Chain-of-Thought Templates
//      - Enforce structured reasoning output
//      - Hypothesis template: "Hypothesis: [statement]. Rationale: [explanation]"
//      - Finding template: "Finding: [statement]. Evidence: [tools/results]. Confidence: [%]"
//      - Conclusion template: "Root Cause: [statement]. Impact: [description]. Confidence: [%]"
//
//   4. Structured Output Parsing
//      - JSON schemas for hypothesis, findings, conclusions
//      - Validation before persisting to database
//      - Error messages for LLM if schema violation
//
//   5. Tool Calling Prompts
//      - Instructions for calling observation/analysis tools
//      - Tool argument validation schemas
//      - Error handling instructions
//
// Chain-of-Thought Enforcement:
//   All reasoning steps must include:
//     - What (statement of finding)
//     - Why (rationale/evidence)
//     - Confidence (percentage or descriptor)
//     - Next steps (what to do next or conclusion)
//
// Integration Points:
//   - Reasoning Engine: Render investigation prompts
//   - MCP Server: Enforce tool schemas
//   - Analytics Engine: Track prompt effectiveness
//   - Audit Logger: Record prompt versions used per investigation

// PromptManager defines the interface for prompt management.
type PromptManager interface {
	// GetSystemPrompt returns the system prompt for the given LLM provider.
	GetSystemPrompt(ctx context.Context, llmProvider string) (string, error)

	// RenderInvestigationPrompt renders an investigation-specific prompt.
	RenderInvestigationPrompt(ctx context.Context, investigationType string, description string, context string) (string, error)

	// GetChainOfThoughtTemplate returns the template for enforcing structured reasoning.
	GetChainOfThoughtTemplate(ctx context.Context, stepType string) (string, error)

	// ValidateStructuredOutput validates output against the expected schema.
	ValidateStructuredOutput(ctx context.Context, output interface{}, schemaType string) error

	// GetToolCallingPrompt returns instructions for tool calling.
	GetToolCallingPrompt(ctx context.Context, toolName string) (string, error)

	// ListPromptVersions lists all available prompt versions.
	ListPromptVersions(ctx context.Context) ([]interface{}, error)
}

// NewPromptManager creates a new prompt manager.
// The concrete implementation is in templates.go.
