package cli

// ---------------------------------------------------------------------------
// P0-1: First-class 'top' command with comprehensive help text
//
// 'kcli top pods/nodes' is the go-to command for real-time resource usage.
// This file replaces the generic passthrough with a documented command that
// surfaces --containers, --sort-by, and --sum flags that are widely useful
// but completely hidden in the generic passthrough.
//
// Requires metrics-server to be installed in the cluster.
//
// All flags pass through to kubectl unchanged (DisableFlagParsing: true).
// ---------------------------------------------------------------------------

import (
	"github.com/spf13/cobra"
)

// newTopCmd returns a first-class 'top' command with comprehensive help text.
func newTopCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "top (pods|nodes) [NAME] [flags]",
		Short: "Show resource usage (CPU and memory) for pods or nodes",
		Long: `Display CPU and memory resource usage for pods or nodes.

Requires the metrics-server to be running in your cluster.
If you see "Error from server (ServiceUnavailable)", run:
  kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

Usage modes:
  kcli top pods             — usage for all pods in current namespace
  kcli top pods NAME        — usage for a specific pod
  kcli top nodes            — usage for all nodes
  kcli top nodes NAME       — usage for a specific node

Important flags (all pass through to kubectl):

  -l, --selector=SELECTOR   Label selector (pods only, e.g. app=nginx)
  -A, --all-namespaces      Show metrics across all namespaces (pods only)

  --containers              Show per-container metrics instead of per-pod totals
                            Essential for multi-container pods (sidecars, init containers)

  --sort-by=cpu|memory      Sort output by CPU or memory usage
                            (useful for finding the biggest consumers)

  --sum                     Print sum of resource usage at the bottom of the table
                            (useful for capacity planning)

  --no-headers              Omit column headers (for scripting: kcli top pods | awk '{print $2}')

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command
  -n, --namespace  Override the namespace for this command

Examples:

  # Show CPU and memory for all pods
  kcli top pods

  # Show per-container metrics (sidecars included)
  kcli top pods --containers

  # Find the highest memory-consuming pods
  kcli top pods --sort-by=memory

  # Find the highest CPU-consuming pods across all namespaces
  kcli top pods -A --sort-by=cpu

  # Show node resource usage
  kcli top nodes

  # Show node usage sorted by CPU with totals
  kcli top nodes --sort-by=cpu --sum

  # Top pods for a specific deployment via label selector
  kcli top pods -l app=payment-api

  # Compact output for monitoring scripts
  kcli top pods --no-headers | awk '{print $1, $2, $4}'`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"top"}, clean...))
		},
	}
}
