package cli

// ---------------------------------------------------------------------------
// P0-1: First-class 'label' command with comprehensive help text
//
// 'label' is heavily used in GitOps, CI/CD, and canary deployments.
// The --overwrite flag is almost always needed but invisible in the generic
// passthrough.  This file surfaces all important flags.
//
// All flags pass through to kubectl unchanged (DisableFlagParsing: true).
// ---------------------------------------------------------------------------

import (
	"github.com/spf13/cobra"
)

// newLabelCmd returns a first-class 'label' command with comprehensive help text.
func newLabelCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "label (TYPE NAME | TYPE/NAME) KEY=VALUE ... [flags]",
		Short: "Add or update labels on a resource",
		Long: `Add, update, or remove labels on one or more resources.

Labels are key/value pairs used for selection, grouping, and filtering.
To remove a label, suffix the key with a minus sign: KEY-

Important flags (all pass through to kubectl):

  --overwrite           Overwrite existing labels with new values
                        ⚠  Required if the label already exists (errors otherwise)

  -l, --selector=SELECTOR  Target resources matching a label selector
                        (e.g. label all pods matching app=nginx)

  --all                 Label all resources of the given type in the namespace

  -A, --all-namespaces  Apply to resources across all namespaces
                        (combine with --selector for targeted updates)

  --resource-version=VER  Only label if resource version matches (optimistic concurrency)

  --dry-run=none|client|server
                        Preview without applying
                        server — most accurate; validates against API schema

  --list                List current labels on the resource (no changes made)

  --field-selector=SELECTOR  Server-side field filter (e.g. status.phase=Running)

  -o, --output=FORMAT   Output format after label (yaml, json, name)

  -f, --filename=[]     Files identifying resources to label

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command
  -n, --namespace  Override the namespace for this command

Examples:

  # Add a label to a pod
  kcli label pod/api-xyz app=payment

  # Update an existing label (--overwrite required)
  kcli label pod/api-xyz version=v2 --overwrite

  # Remove a label (append - to the key)
  kcli label pod/api-xyz version-

  # Label all pods with a specific selector
  kcli label pods -l app=nginx tier=frontend --overwrite

  # Label all pods in all namespaces (wide-impact — use with care)
  kcli label pods -l app=nginx monitored=true -A --overwrite

  # View current labels without making changes
  kcli label pod/api-xyz --list

  # Mark a node for a specific workload type
  kcli label node worker-1 workload=gpu-jobs

  # Dry-run: preview labels that would be applied
  kcli label deployment/api track=canary --dry-run=server`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"label"}, clean...))
		},
	}
}
