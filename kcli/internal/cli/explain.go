package cli

// ---------------------------------------------------------------------------
// P3-7: First-class 'explain' command with AI field explanation
//
// Wraps 'kubectl explain' and adds:
//   --ai    After printing the standard kubectl output, send the field
//           documentation to the configured AI provider for a concise
//           plain-English explanation with common use cases and an example.
//
// All standard kubectl explain flags pass through unchanged:
//   --recursive     Print all fields in the resource
//   --api-version   Use a specific API version
//   --output=plaintext|plaintext-openapiv2
//
// Non-TTY / AI-disabled: falls back to plain kubectl explain.
// ---------------------------------------------------------------------------

import (
	"context"
	"fmt"
	"strings"

	"github.com/spf13/cobra"
)

// newExplainCmd returns a first-class 'explain' command that passes through
// to kubectl explain and optionally enhances the output with AI context.
func newExplainCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "explain RESOURCE[.FIELD.PATH] [flags]",
		Short: "Show API documentation for a resource or field",
		Long: `Show documentation for a Kubernetes resource or a specific field path.

Displays the schema description, field types, and sub-fields directly from
the cluster's OpenAPI spec — no internet access required.

Standard kubectl flags (all pass through):

  --recursive             Print all fields of the resource and sub-resources
  --api-version=GROUP/V   Force a specific API version (e.g. apps/v1)
  --output=plaintext|plaintext-openapiv2
                          Output format (default: plaintext)

kcli-specific flags (stripped before forwarding to kubectl):

  --ai                    Append an AI-generated plain-English explanation
                          of the field, including common use cases and a
                          practical YAML example.  Requires AI to be
                          configured (see 'kcli config show').

Examples:

  # Explain the Pod resource
  kcli explain pod

  # Explain a specific field path
  kcli explain pod.spec.containers.resources

  # Explain with all sub-fields expanded
  kcli explain deployment.spec --recursive

  # Explain a field in a specific API version
  kcli explain ingress --api-version=networking.k8s.io/v1

  # Explain with AI context (plain-English + use cases + example)
  kcli explain pod.spec.topologySpreadConstraints --ai

  # Explain a CRD field
  kcli explain prometheusrule.spec.groups`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, rawArgs []string) error {
			// Strip kcli global flags (--context, --namespace, etc.).
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()

			// Strip our --ai flag; forward the rest to kubectl.
			aiMode, kArgs := parseExplainFlags(clean)

			if !aiMode {
				// Plain passthrough — identical to generic newKubectlVerbCmd.
				return a.runKubectl(append([]string{"explain"}, kArgs...))
			}

			// AI mode: capture kubectl explain output first.
			out, err := a.captureKubectl(append([]string{"explain"}, kArgs...))
			if err != nil {
				return err
			}

			// Print the standard kubectl output.
			fmt.Fprint(cmd.OutOrStdout(), out)

			// Append AI explanation.
			resource := explainTarget(kArgs)
			return a.explainAIEnhance(cmd, resource, out)
		},
	}
}

// ---------------------------------------------------------------------------
// parseExplainFlags separates --ai from kubectl explain flags.
// ---------------------------------------------------------------------------

// parseExplainFlags strips --ai from args, returning the rest for kubectl.
func parseExplainFlags(args []string) (aiMode bool, rest []string) {
	rest = make([]string, 0, len(args))
	for _, a := range args {
		if strings.TrimSpace(a) == "--ai" {
			aiMode = true
		} else {
			rest = append(rest, a)
		}
	}
	return
}

// explainTarget extracts the first positional (non-flag) argument — the
// resource/field path that the user wants explained.
func explainTarget(args []string) string {
	for _, a := range args {
		if !strings.HasPrefix(strings.TrimSpace(a), "-") {
			return strings.TrimSpace(a)
		}
	}
	return "resource"
}

// ---------------------------------------------------------------------------
// explainAIEnhance sends the kubectl explain output to the AI provider and
// appends a plain-English explanation, use cases, and a YAML example.
// ---------------------------------------------------------------------------

func (a *app) explainAIEnhance(cmd *cobra.Command, resource, explainOutput string) error {
	client := a.aiClient()
	if !client.Enabled() {
		fmt.Fprintf(cmd.OutOrStdout(),
			"\n%s── AI Explanation%s\n%s(AI not configured — run 'kcli config show' to set up an AI provider)%s\n",
			ansiBold, ansiReset, ansiGray, ansiReset)
		return nil
	}

	// The "explain" action has a dedicated prompt template in ai/prompt.go.
	// We pass a combined target so the AI sees both the field path and its
	// documentation — giving it enough context for a useful explanation.
	target := fmt.Sprintf("kubectl explain %s\n\n%s", resource, truncate(explainOutput, 3000))

	ctx, cancel := context.WithTimeout(cmd.Context(), a.aiTimeout)
	defer cancel()

	aiResponse, err := client.Analyze(ctx, "explain", target)
	if err != nil {
		fmt.Fprintf(cmd.OutOrStdout(),
			"\n%s── AI Explanation%s\n%s(AI unavailable: %v)%s\n",
			ansiBold, ansiReset, ansiGray, err, ansiReset)
		return nil // Don't fail the command if AI is unavailable.
	}

	fmt.Fprintf(cmd.OutOrStdout(), "\n%s── AI Explanation (%s)%s\n%s\n",
		ansiBold, resource, ansiReset, aiResponse)
	return nil
}
