package cli

// ---------------------------------------------------------------------------
// P0-1: First-class 'scale' command with comprehensive help text
//
// 'scale' is a critical operations command.  Incorrect use (e.g. scaling
// with a stale --resource-version) can fail silently.  This file replaces
// the generic passthrough with a documented command surfacing all important
// flags including --current-replicas and --resource-version preconditions.
//
// All flags pass through to kubectl unchanged (DisableFlagParsing: true).
// ---------------------------------------------------------------------------

import (
	"github.com/spf13/cobra"
)

// newScaleCmd returns a first-class 'scale' command with comprehensive help text.
func newScaleCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "scale (TYPE NAME | TYPE/NAME) --replicas=COUNT [flags]",
		Short: "Set a new size for a deployment, replicaset, or statefulset",
		Long: `Set a new size for a Deployment, ReplicaSet, StatefulSet, or Job.

The --replicas flag is required. Use --current-replicas or --resource-version
as preconditions to prevent racing with concurrent scaling operations.

Supported resources:
  Deployment, ReplicaSet, StatefulSet, Job (fixed completion count)

Important flags (all pass through to kubectl):

  --replicas=N           New desired replica count (REQUIRED)

  Preconditions (recommended for production use):
  --current-replicas=N   Only scale if current count matches N
                         Prevents races with HPA or concurrent kubectl calls
  --resource-version=VER Only scale if resource version matches
                         Use 'kcli get TYPE/NAME -o jsonpath={.metadata.resourceVersion}'

  -f, --filename=[]      Files identifying resources to scale
  -R, --recursive        Recurse into sub-directories for -f
  -l, --selector=SELECTOR  Label selector

  --timeout=DURATION     Wait timeout for scale operation (e.g. 60s, 5m)

  -o, --output=FORMAT    Output format after scaling (yaml, json, name)

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command
  -n, --namespace  Override the namespace for this command

Examples:

  # Scale a deployment to 3 replicas
  kcli scale deployment/api --replicas=3

  # Scale down safely (only if currently at 5 — prevents HPA race)
  kcli scale deployment/api --replicas=2 --current-replicas=5

  # Scale multiple deployments at once
  kcli scale deployment/frontend deployment/backend --replicas=5

  # Scale all deployments matching a selector
  kcli scale deployments -l app=nginx --replicas=3

  # Scale a StatefulSet
  kcli scale statefulset/postgres --replicas=3

  # Preview the scale operation (dry run)
  kcli scale deployment/api --replicas=0 --dry-run=server`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"scale"}, clean...))
		},
	}
}
