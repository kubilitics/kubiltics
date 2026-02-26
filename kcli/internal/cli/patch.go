package cli

// ---------------------------------------------------------------------------
// P0-1: First-class 'patch' command with comprehensive help text
//
// 'patch' is widely used in GitOps and automation workflows.  The --type
// flag (strategic vs merge vs json) is critical for correct patching but
// completely invisible in the generic passthrough.  This file surfaces all
// important patch types and their use cases.
//
// All flags pass through to kubectl unchanged (DisableFlagParsing: true).
// ---------------------------------------------------------------------------

import (
	"github.com/spf13/cobra"
)

// newPatchCmd returns a first-class 'patch' command with comprehensive help text.
func newPatchCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "patch (TYPE NAME | TYPE/NAME) -p PATCH [flags]",
		Short: "Update specific fields of a resource in place",
		Long: `Update one or more fields of a resource using a patch.

Three patch types are supported:

  strategic   (default for most core resources)
              Kubernetes-aware merge that understands list strategies.
              e.g. patching containers[] replaces by name, not position.
              Best for modifying spec fields of Deployments, Pods, etc.

  merge       RFC 7386 JSON Merge Patch
              Replaces lists entirely (null removes the field).
              Use when strategic is unavailable (CRDs, custom resources).

  json        RFC 6902 JSON Patch
              Precise operations: add, remove, replace, copy, move, test.
              Use for atomic operations or when you need to test a value first.

Important flags (all pass through to kubectl):

  -p, --patch=PATCH        The patch to apply (inline JSON or YAML string)
  --patch-type=TYPE        Patch type: strategic | merge | json (default: strategic)
  --type=TYPE              Alias for --patch-type

  -f, --filename=[]        Files identifying resources to patch
  -R, --recursive          Recurse into sub-directories for -f

  --dry-run=none|client|server
                           Preview without applying
                           server — most accurate; validates against API schema

  --field-manager=NAME     Field manager name for SSA tracking (default: kubectl-patch)

  -o, --output=FORMAT      Output format after patch (yaml, json, name)

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command
  -n, --namespace  Override the namespace for this command

Examples:

  # Strategic patch — add an environment variable to a container
  kcli patch deployment/api -p '{"spec":{"template":{"spec":{"containers":[{"name":"api","env":[{"name":"LOG_LEVEL","value":"debug"}]}]}}}}'

  # Merge patch — update image tag (simpler syntax for single-value changes)
  kcli patch deployment/api --type=merge -p '{"spec":{"template":{"spec":{"containers":[{"name":"api","image":"myapp:v2"}]}}}}'

  # JSON patch — precisely replace a specific value by path
  kcli patch deployment/api --type=json -p '[{"op":"replace","path":"/spec/replicas","value":5}]'

  # JSON patch — test-then-replace (atomic: fails if current value doesn't match)
  kcli patch deployment/api --type=json -p '[{"op":"test","path":"/spec/replicas","value":3},{"op":"replace","path":"/spec/replicas","value":5}]'

  # Patch with dry-run (see what would change)
  kcli patch deployment/api --type=merge -p '{"spec":{"replicas":0}}' --dry-run=server

  # Patch a node annotation
  kcli patch node worker-1 -p '{"metadata":{"annotations":{"maintenance":"scheduled"}}}'

  # Remove a field using merge patch (null = delete the field)
  kcli patch deployment/api --type=merge -p '{"spec":{"template":{"spec":{"terminationGracePeriodSeconds":null}}}}'`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"patch"}, clean...))
		},
	}
}
