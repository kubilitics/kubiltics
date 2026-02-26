package cli

// ---------------------------------------------------------------------------
// P0-1: First-class 'annotate' command with comprehensive help text
//
// 'annotate' is widely used in deployment automation, GitOps triggers, and
// to store operational metadata.  The --overwrite flag is consistently
// needed.  This file surfaces all important flags.
//
// All flags pass through to kubectl unchanged (DisableFlagParsing: true).
// ---------------------------------------------------------------------------

import (
	"github.com/spf13/cobra"
)

// newAnnotateCmd returns a first-class 'annotate' command with comprehensive help text.
func newAnnotateCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "annotate (TYPE NAME | TYPE/NAME) KEY=VALUE ... [flags]",
		Short: "Add or update annotations on a resource",
		Long: `Add, update, or remove annotations on one or more resources.

Annotations are key/value pairs for attaching non-identifying metadata.
Unlike labels, annotation keys often use domain prefixes (e.g. kubectl.kubernetes.io/).
To remove an annotation, suffix the key with a minus sign: KEY-

Common annotation use cases:
  - Deployment triggers: kubectl.kubernetes.io/restartedAt=<timestamp>
  - Change tracking: deployment.kubernetes.io/change-cause="Updated image to v2.3.1"
  - GitOps metadata: argocd.argoproj.io/sync-wave="5"
  - Resource ownership: meta.helm.sh/release-name, meta.helm.sh/release-namespace

Important flags (all pass through to kubectl):

  --overwrite           Overwrite existing annotations with new values
                        ⚠  Required if the annotation already exists (errors otherwise)

  -l, --selector=SELECTOR  Target resources matching a label selector

  --all                 Annotate all resources of the given type in the namespace

  -A, --all-namespaces  Apply to resources across all namespaces

  --resource-version=VER  Only annotate if resource version matches (optimistic concurrency)

  --dry-run=none|client|server
                        Preview without applying
                        server — most accurate; validates against API schema

  --list                List current annotations on the resource (no changes made)

  --field-selector=SELECTOR  Server-side field filter

  -o, --output=FORMAT   Output format after annotate (yaml, json, name)

  -f, --filename=[]     Files identifying resources to annotate

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command
  -n, --namespace  Override the namespace for this command

Examples:

  # Trigger a rolling restart (kubectl rollout restart equivalent)
  kcli annotate deployment/api kubectl.kubernetes.io/restartedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ) --overwrite

  # Record a deployment reason (visible in rollout history)
  kcli annotate deployment/api kubernetes.io/change-cause="Updated to v2.3.1 for CVE-2024-XXXX fix" --overwrite

  # Add an annotation to a pod
  kcli annotate pod/api-xyz debug=true --overwrite

  # Remove an annotation (append - to the key)
  kcli annotate pod/api-xyz debug-

  # Annotate all pods with a selector
  kcli annotate pods -l app=nginx monitored=datadog --overwrite

  # View current annotations without making changes
  kcli annotate pod/api-xyz --list

  # Dry-run: preview annotation that would be applied
  kcli annotate deployment/api deploy-time=$(date +%s) --dry-run=server --overwrite`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"annotate"}, clean...))
		},
	}
}
