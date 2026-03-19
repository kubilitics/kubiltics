package context

// Package context — concrete ContextBuilder implementation.

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/kubilitics/kubilitics-ai/internal/integration/backend"
)

// contextBuilderImpl is the concrete implementation of ContextBuilder.
type contextBuilderImpl struct {
	proxy *backend.Proxy
}

// NewContextBuilderWithProxy creates a ContextBuilder backed by the backend proxy.
func NewContextBuilderWithProxy(proxy *backend.Proxy) ContextBuilder {
	return &contextBuilderImpl{proxy: proxy}
}

// BuildContext gathers cluster state and returns a formatted context string for the LLM.
func (b *contextBuilderImpl) BuildContext(ctx context.Context, investigationType, description string, resources []string) (string, error) {
	var sb strings.Builder

	sb.WriteString(fmt.Sprintf("## Cluster Context for Investigation: %s\n\n", investigationType))
	sb.WriteString(fmt.Sprintf("**Description:** %s\n\n", description))

	// Gather cluster health
	if b.proxy != nil && b.proxy.IsInitialized() {
		health, err := b.proxy.GetClusterHealth(ctx)
		if err == nil && health != nil {
			sb.WriteString("### Cluster Health\n")
			sb.WriteString(fmt.Sprintf("- Status: %s (Score: %d)\n", health.Status, health.Score))
			if health.ResourceCounts != nil {
				sb.WriteString(fmt.Sprintf("- Nodes: %d | Pods: %d | Deployments: %d | Services: %d\n",
					health.ResourceCounts.Nodes,
					health.ResourceCounts.Pods,
					health.ResourceCounts.Deployments,
					health.ResourceCounts.Services,
				))
			}
			for _, issue := range health.Issues {
				sb.WriteString(fmt.Sprintf("- Issue: [%s] %s\n", issue.Severity, issue.Message))
			}
			sb.WriteString("\n")
		}

		// Gather specified resources
		if len(resources) > 0 {
			sb.WriteString("### Target Resources\n")
			for _, res := range resources {
				parts := strings.SplitN(res, "/", 3)
				if len(parts) == 3 {
					kind, ns, name := parts[0], parts[1], parts[2]
					r, err := b.proxy.GetResource(ctx, kind, ns, name)
					if err == nil && r != nil {
						sb.WriteString(fmt.Sprintf("**%s/%s/%s** (Status: %s)\n", kind, ns, name, r.Status))
						if len(r.Data) > 0 && len(r.Data) < 4096 {
							var raw map[string]interface{}
							if json.Unmarshal(r.Data, &raw) == nil {
								// Include status section if present
								if statusSection, ok := raw["status"]; ok {
									statusJSON, _ := json.MarshalIndent(statusSection, "  ", "  ")
									sb.WriteString(fmt.Sprintf("  Status:\n  %s\n", string(statusJSON)))
								}
							}
						}
					}
				}
			}
			sb.WriteString("\n")
		}
	} else {
		sb.WriteString("*Note: Backend proxy not initialized — context is limited.*\n\n")
	}

	sb.WriteString("### Investigation Focus\n")
	sb.WriteString(fmt.Sprintf("Type: %s\nDescription: %s\n", investigationType, description))

	return sb.String(), nil
}

// GetTokenCount estimates tokens using a simple characters/4 heuristic.
func (b *contextBuilderImpl) GetTokenCount(_ context.Context, contextStr string) (int, error) {
	chars := utf8.RuneCountInString(contextStr)
	// ~4 characters per token is a reasonable estimate for English/code text
	return chars / 4, nil
}

// PruneContext trims context to fit within the token budget.
func (b *contextBuilderImpl) PruneContext(_ context.Context, contextStr string, maxTokens int) (string, []string, error) {
	maxChars := maxTokens * 4
	if utf8.RuneCountInString(contextStr) <= maxChars {
		return contextStr, nil, nil
	}

	// Split into sections by "##" headers
	sections := strings.Split(contextStr, "\n## ")
	removed := []string{}
	result := sections[0] // Always keep the first section (title)

	for _, section := range sections[1:] {
		candidate := result + "\n## " + section
		if utf8.RuneCountInString(candidate) <= maxChars {
			result = candidate
		} else {
			// Extract section title for reporting
			lines := strings.SplitN(section, "\n", 2)
			removed = append(removed, lines[0])
		}
	}

	return result, removed, nil
}

// GetContextMetadata returns metadata about the context builder configuration.
func (b *contextBuilderImpl) GetContextMetadata(_ context.Context) (interface{}, error) {
	return map[string]interface{}{
		"proxy_initialized":     b.proxy != nil && b.proxy.IsInitialized(),
		"token_estimate_method": "chars/4",
	}, nil
}
