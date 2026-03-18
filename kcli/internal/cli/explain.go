package cli

// ---------------------------------------------------------------------------
// P3-7: First-class 'explain' command
//
// Wraps 'kubectl explain' with enhanced UX.
//
// All standard kubectl explain flags pass through unchanged:
//   --recursive     Print all fields in the resource
//   --api-version   Use a specific API version
//   --output=plaintext|plaintext-openapiv2
// ---------------------------------------------------------------------------

import (
	"strings"

	"github.com/spf13/cobra"
)

// newExplainCmd returns a first-class 'explain' command that passes through
// to kubectl explain.
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

Examples:

  # Explain the Pod resource
  kcli explain pod

  # Explain a specific field path
  kcli explain pod.spec.containers.resources

  # Explain with all sub-fields expanded
  kcli explain deployment.spec --recursive

  # Explain a field in a specific API version
  kcli explain ingress --api-version=networking.k8s.io/v1

  # Explain a CRD field
  kcli explain prometheusrule.spec.groups`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			// Strip kcli global flags (--context, --namespace, etc.).
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()

			// Strip legacy --ai flag (no-op) and forward the rest to kubectl.
			_, kArgs := parseExplainFlags(clean)
			return a.runKubectl(append([]string{"explain"}, kArgs...))
		},
	}
}

// ---------------------------------------------------------------------------
// parseExplainFlags strips the legacy --ai flag from args, returning the rest
// for kubectl. The --ai flag is accepted silently for backward compatibility
// but has no effect (AI features have been removed).
// ---------------------------------------------------------------------------
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

