package cli

// ---------------------------------------------------------------------------
// P0-1: First-class 'taint' / 'cordon' / 'uncordon' node operation commands
//
// Node taints are powerful but the syntax (KEY=VALUE:EFFECT) and the three
// effect types are not obvious.  This file provides documented commands for
// all three node scheduling control operations.
//
// All flags pass through to kubectl unchanged (DisableFlagParsing: true).
// ---------------------------------------------------------------------------

import (
	"github.com/spf13/cobra"
)

// newTaintCmd returns a first-class 'taint' command with comprehensive help text.
func newTaintCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "taint NODE KEY=VALUE:EFFECT [flags]",
		Short: "Add or remove taints from nodes to control pod scheduling",
		Long: `Add or remove taints on nodes.

Taints repel pods unless the pod has a matching toleration.  They are the
mechanism for dedicating nodes to specific workloads (GPUs, spot instances,
compliance zones, etc.).

Taint effect types:

  NoSchedule         — New pods without a matching toleration will NOT be scheduled
                       on this node.  Existing pods are unaffected.

  PreferNoSchedule   — Kubernetes will TRY to avoid scheduling pods here, but
                       it's a soft preference (not guaranteed to prevent scheduling).

  NoExecute          — New pods without a toleration are not scheduled AND
                       existing pods without a toleration are EVICTED.
                       ⚠  This actively evicts running pods.

To REMOVE a taint, append a minus sign: KEY:EFFECT-
  kcli taint node worker-1 dedicated:NoSchedule-

Important flags (all pass through to kubectl):

  --overwrite           Overwrite existing taints with new values
  --all                 Taint all nodes (use carefully)
  -l, --selector=SELECTOR  Label selector for target nodes
  --dry-run=none|client|server  Preview without tainting

Examples:

  # Dedicate a node to GPU workloads (pods need toleration for gpu:NoSchedule)
  kcli taint node gpu-node-1 dedicated=gpu:NoSchedule

  # Mark a node as a spot instance (prefer-not-schedule for critical pods)
  kcli taint node spot-worker-3 cloud.google.com/spot:PreferNoSchedule

  # Evict all non-tolerating pods from a node (for urgent maintenance)
  kcli taint node worker-1 maintenance=drain:NoExecute

  # Remove a specific taint
  kcli taint node worker-1 dedicated:NoSchedule-

  # Taint a node for team isolation
  kcli taint node team-node-1 team=payments:NoSchedule

  # Preview what would be changed
  kcli taint node worker-1 maintenance=true:NoSchedule --dry-run=server`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"taint"}, clean...))
		},
	}
}

// newCordonCmd returns a first-class 'cordon' command with comprehensive help text.
func newCordonCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "cordon NODE [flags]",
		Short: "Mark a node as unschedulable (prevent new pod scheduling)",
		Long: `Mark a node as unschedulable.

Sets node.spec.unschedulable=true, which prevents the Kubernetes scheduler
from placing new pods on the node.  Existing pods continue running.

Use cordon to:
  - Gracefully prepare a node for maintenance (follow with 'drain')
  - Temporarily prevent workloads from landing on a misbehaving node
  - Reserve capacity for a specific use case

To allow scheduling again: kcli uncordon NODE

For full node evacuation: kcli drain NODE --ignore-daemonsets

Important flags:

  --dry-run=none|client|server  Preview without cordoning
  -l, --selector=SELECTOR       Cordon nodes matching label selector

Examples:

  # Cordon a node before maintenance
  kcli cordon worker-1
  kcli drain worker-1 --ignore-daemonsets --delete-emptydir-data
  # ... perform maintenance ...
  kcli uncordon worker-1

  # Cordon multiple nodes by label
  kcli cordon -l kubernetes.io/os=windows`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"cordon"}, clean...))
		},
	}
}

// newUncordonCmd returns a first-class 'uncordon' command with comprehensive help text.
func newUncordonCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "uncordon NODE [flags]",
		Short: "Mark a node as schedulable (re-enable pod scheduling)",
		Long: `Mark a node as schedulable.

Removes the unschedulable taint set by 'cordon', allowing the Kubernetes
scheduler to place new pods on the node again.

This is the final step in the maintenance workflow:
  1. kcli cordon NODE        — prevent new scheduling
  2. kcli drain NODE ...     — evict existing pods safely
  3. <perform maintenance>
  4. kcli uncordon NODE      — re-enable scheduling ← this command

Note: uncordon does NOT reschedule pods that were previously evicted.
Pods are rescheduled by their controllers (Deployment, StatefulSet, etc.)
when they detect they need more replicas.

Important flags:

  --dry-run=none|client|server  Preview without uncordoning
  -l, --selector=SELECTOR       Uncordon nodes matching label selector

Examples:

  # Re-enable scheduling on a single node after maintenance
  kcli uncordon worker-1

  # Uncordon multiple nodes by label selector
  kcli uncordon -l maintenance-complete=true

  # Preview
  kcli uncordon worker-1 --dry-run=server`,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, rawArgs []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()
			return a.runKubectl(append([]string{"uncordon"}, clean...))
		},
	}
}
