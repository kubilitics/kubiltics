// memory.go — kcli memory: failure pattern memory (P3-2).
//
// Store diagnosed failures and their resolutions. Surface matches when similar
// failures recur (e.g. in kcli why).
package cli

import (
	"fmt"
	"sort"
	"strings"

	"github.com/kubilitics/kcli/internal/state"
	"github.com/spf13/cobra"
)

func newMemoryCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:     "memory",
		Short:   "Store and recall past failure resolutions",
		GroupID: "ai",
		Long: `Store diagnosed failures and their resolutions. When similar failures recur,
kcli why surfaces past resolutions: "Similar issue resolved on 2026-01-15: increased memory to 4Gi".

Examples:
  kcli memory add pod/crashed --resolution "increased memory to 4Gi"
  kcli memory add deployment/api --resolution "fixed image tag" --issue OOMKilled
  kcli memory list`,
	}
	cmd.AddCommand(newMemoryListCmd(a))
	cmd.AddCommand(newMemoryAddCmd(a))
	return cmd
}

func newMemoryListCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List past failures and resolutions",
		Aliases: []string{"ls"},
		RunE: func(cmd *cobra.Command, _ []string) error {
			m, err := state.LoadMemory()
			if err != nil {
				return fmt.Errorf("failed to load memory: %w", err)
			}
			if len(m.Records) == 0 {
				fmt.Fprintln(a.stdout, "No failure records. Add one with: kcli memory add pod/name --resolution \"...\"")
				return nil
			}
			// Sort by resolvedAt descending (newest first)
			recs := make([]state.MemoryRecord, len(m.Records))
			copy(recs, m.Records)
			sort.Slice(recs, func(i, j int) bool {
				return recs[i].ResolvedAt > recs[j].ResolvedAt
			})
			fmt.Fprintf(a.stdout, "\n%s%s Failure Memory (%d records)%s\n\n",
				ansiBold, ansiCyan, len(recs), ansiReset)
			fmt.Fprintf(a.stdout, "%s%-30s %-18s %-12s %s%s\n", ansiBold, "RESOURCE", "ISSUE", "RESOLVED", "RESOLUTION", ansiReset)
			fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 100))
			for _, r := range recs {
				resolved := r.ResolvedAt
				if len(resolved) >= 10 {
					resolved = resolved[:10]
				}
				resolution := r.Resolution
				if len(resolution) > 45 {
					resolution = resolution[:42] + "..."
				}
				fmt.Fprintf(a.stdout, "%-30s %-18s %-12s %s\n",
					truncate(r.Resource, 30), truncate(r.Issue, 18), resolved, resolution)
			}
			fmt.Fprintln(a.stdout)
			return nil
		},
	}
}

func newMemoryAddCmd(a *app) *cobra.Command {
	var resolution string
	var issue string
	addCmd := &cobra.Command{
		Use:   "add (TYPE/NAME | TYPE NAME)",
		Short: "Add a failure resolution to memory",
		Long: `Record a diagnosed failure and its resolution. When you run kcli why on a similar
resource later, the resolution will be surfaced.`,
		Args: cobra.RangeArgs(1, 2),
		RunE: func(cmd *cobra.Command, args []string) error {
			resource := strings.TrimSpace(args[0])
			if len(args) == 2 {
				resource = args[0] + "/" + args[1]
			}
			if resolution == "" {
				return fmt.Errorf("--resolution is required")
			}
			m, err := state.LoadMemory()
			if err != nil {
				return fmt.Errorf("failed to load memory: %w", err)
			}
			m.Add(state.MemoryRecord{
				Resource:   resource,
				Issue:      issue,
				Resolution: resolution,
			})
			if err := m.Save(); err != nil {
				return fmt.Errorf("failed to save memory: %w", err)
			}
			fmt.Fprintf(a.stdout, "Added: %s → %s\n", resource, resolution)
			return nil
		},
	}
	addCmd.Flags().StringVar(&resolution, "resolution", "", "Resolution that fixed the failure (required)")
	addCmd.Flags().StringVar(&issue, "issue", "", "Issue type (e.g. OOMKilled, CrashLoopBackOff) for matching")
	return addCmd
}
