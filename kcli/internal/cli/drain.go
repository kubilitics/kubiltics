package cli

// ---------------------------------------------------------------------------
// P0-1: First-class 'drain' command with comprehensive help text
//
// 'drain' is the most dangerous node operation.  Missing --ignore-daemonsets
// or --delete-emptydir-data causes the drain to abort with a confusing error.
// This file replaces the generic passthrough with comprehensive documentation
// of all important flags — especially the "why your drain is stuck" flags.
//
// All flags pass through to kubectl unchanged (DisableFlagParsing: true).
// ---------------------------------------------------------------------------

import (
	"github.com/spf13/cobra"
)

// newDrainCmd returns a first-class 'drain' command with comprehensive help text.
func newDrainCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "drain NODE [flags]",
		Short: "Drain a node for maintenance (evict all pods safely)",
		Long: `Drain a node in preparation for maintenance.

Marks the node as unschedulable (like cordon) and evicts all workloads using
the Eviction API. When all pods have been evicted (or timeout expires), the
node is ready for maintenance.

⚠  This command evicts pods — it WILL cause pod restarts. Always review what
   will be evicted with --dry-run=server first.

Why your drain is stuck (most common errors):
  • "cannot delete DaemonSet-managed Pods"  → add --ignore-daemonsets
  • "cannot delete Pods with local storage"  → add --delete-emptydir-data
  • "cannot delete Pods not managed by controller" → add --force (use carefully)

Important flags (all pass through to kubectl):

  --ignore-daemonsets     Skip DaemonSet-managed pods during drain
                          ✓ Almost always required (logging, monitoring agents
                          are DaemonSets and cannot be evicted anyway)

  --delete-emptydir-data  Allow deletion of pods using emptyDir volumes
                          ⚠  Data in emptyDir volumes WILL BE LOST permanently

  --force                 Force drain: also evict unmanaged pods (not owned by
                          a ReplicationController, Job, DaemonSet, or StatefulSet)
                          ⚠  Unmanaged pods will NOT be rescheduled

  --grace-period=SECONDS  Override terminationGracePeriodSeconds for evicted pods
                          Default: -1 (use the pod's own setting)
                          Use 0 to force-kill immediately (not recommended)

  --timeout=DURATION      Maximum time to wait for drain to complete
                          (e.g. 5m, 10m0s; default: unlimited)

  --dry-run=client|server Preview what would be evicted without evicting anything
                          Use server for most accurate results

  --selector=SELECTOR     Label selector (drain specific pods matching label)
  --pod-selector=SELECTOR Pod label selector (drain only pods matching label)

  --skip-wait-for-delete-timeout=SECONDS
                          Skip waiting for pods whose delete timestamp is older
                          than this number of seconds (0=disabled)

  --disable-eviction      Force deletion of pods, bypassing Eviction API and PodDisruptionBudgets
                          ⚠  Use only when Eviction API is broken or in emergencies

Multi-cluster flags (kcli-specific, stripped before forwarding):

  --context=NAME   Override the kubectl context for this command

Examples:

  # Dry-run first — see exactly what will be evicted
  kcli drain worker-1 --ignore-daemonsets --dry-run=server

  # Standard node drain (99% of cases)
  kcli drain worker-1 --ignore-daemonsets --delete-emptydir-data

  # Drain with timeout (for CI/CD or automated maintenance windows)
  kcli drain worker-1 --ignore-daemonsets --delete-emptydir-data --timeout=10m

  # Drain with faster pod eviction (use if pods have long grace periods)
  kcli drain worker-1 --ignore-daemonsets --grace-period=30

  # Drain even unmanaged pods (emergency use only)
  kcli drain worker-1 --ignore-daemonsets --delete-emptydir-data --force

  # After maintenance, uncordon the node to allow scheduling again:
  kcli uncordon worker-1`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"drain"}, clean...))
		},
	}
}
