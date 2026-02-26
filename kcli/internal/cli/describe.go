package cli

// ---------------------------------------------------------------------------
// P0-1: First-class 'describe' command with comprehensive help text
//
// 'describe' is the second-most-used kubectl command after 'get'.  This file
// replaces the generic newKubectlVerbCmd passthrough with a documented command
// that surfaces all important flags so engineers can discover them via --help.
//
// All flags pass through to kubectl unchanged (DisableFlagParsing: true).
// ---------------------------------------------------------------------------

import (
	"github.com/spf13/cobra"
)

// newDescribeCmd returns a first-class 'describe' command with comprehensive help text.
func newDescribeCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:     "describe (TYPE [NAME_PREFIX | -l label] | TYPE/NAME) [flags]",
		Short:   "Show detailed state of one or many resources",
		Aliases: []string{"desc"},
		Long: `Show details of a specific resource or group of resources.

Print a detailed description of the selected resources, including related
resources such as events. Combines output from 'get' and 'events' into a
single, easy-to-read view.

Important flags (all pass through to kubectl):

  -f, --filename=[]         Files, dirs, or URLs identifying the resource
  -R, --recursive           Recurse into sub-directories for -f
  -l, --selector=SELECTOR   Label selector (e.g. app=nginx)
  -A, --all-namespaces      Describe matching resources in all namespaces

  --show-events=true|false  Include related events in output (default: true)
                            Set to false for large resources or noise reduction

  --chunk-size=N            Server-side pagination for large lists (default: 500)
                            Set to 0 to disable pagination

  -o, --output=FORMAT       Output format (default: text)
                            json | yaml — structured output for automation

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command
  -n, --namespace  Override the namespace for this command

Examples:

  # Describe a single pod by name
  kcli describe pod/api-server-xyz

  # Describe all pods with a label selector
  kcli describe pods -l app=nginx

  # Describe a deployment (shows rollout history, events, pod template)
  kcli describe deployment/payment-api

  # Describe a node (shows taints, conditions, allocated resources)
  kcli describe node worker-1

  # Describe without events (less noisy for stable resources)
  kcli describe pod/api-xyz --show-events=false

  # Describe all pods across all namespaces
  kcli describe pods -A

  # Describe a resource from a manifest file
  kcli describe -f deployment.yaml`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"describe"}, clean...))
		},
	}
}
