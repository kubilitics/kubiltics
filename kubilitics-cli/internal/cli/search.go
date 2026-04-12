package cli

import (
	"fmt"
	"strings"

	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/runner"
	"github.com/spf13/cobra"
)

func newSearchCmd(a *app) *cobra.Command {
	var groupName string
	var resourceKinds string
	cmd := &cobra.Command{
		Use:   "search <query> [flags]",
		Short: "Search resources across contexts",
		Long: `Search for resources by name across one or more kubectl contexts.

Queries all resource types by default. Use --kinds to limit to specific types.
Use --context-group to search within a named group of contexts.

Examples:
  kcli search nginx                                # search current context
  kcli search payment --kinds=deployment,service   # search specific types
  kcli search redis --context-group=production     # search a context group
  kcli search api --kinds=pod                      # search pods only`,
		GroupID: "workflow",
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			query := strings.ToLower(strings.TrimSpace(args[0]))
			if query == "" {
				return fmt.Errorf("query cannot be empty")
			}
			contexts, err := a.resolveTargetContexts(groupName)
			if err != nil {
				return err
			}
			if len(contexts) == 0 {
				return fmt.Errorf("no contexts available for search")
			}

			kindsArg := strings.TrimSpace(resourceKinds)
			if kindsArg == "" {
				kindsArg = "all"
			}

			var (
				totalContexts  int
				failedContexts int
				failedNames    []string
				totalMatches   int
			)
			for _, ctxName := range contexts {
				totalContexts++
				getArgs := []string{"--context", ctxName, "get", kindsArg, "-A", "--no-headers"}
				if a.namespace != "" {
					getArgs = append(getArgs, "-n", a.namespace)
				}
				out, runErr := runner.CaptureKubectl(getArgs)
				if runErr != nil {
					failedContexts++
					failedNames = append(failedNames, ctxName)
					fmt.Fprintf(cmd.ErrOrStderr(), "warning: context %s failed: %v\n", ctxName, runErr)
					continue
				}
				lines := strings.Split(strings.TrimSpace(out), "\n")
				for _, line := range lines {
					line = strings.TrimSpace(line)
					if line == "" {
						continue
					}
					if strings.Contains(strings.ToLower(line), query) {
						totalMatches++
						fmt.Fprintf(cmd.OutOrStdout(), "[%s] %s\n", ctxName, line)
					}
				}
			}
			if totalMatches == 0 && failedContexts == 0 {
				fmt.Fprintln(cmd.OutOrStdout(), "No matching resources found.")
			}
			if failedContexts > 0 {
				fmt.Fprintf(cmd.OutOrStdout(), "\nSearched %d/%d contexts (%d unreachable: %s). Results may be incomplete.\n",
					totalContexts-failedContexts, totalContexts, failedContexts, strings.Join(failedNames, ", "))
			} else {
				fmt.Fprintf(cmd.OutOrStdout(), "\nTotal matches: %d\n", totalMatches)
			}
			if failedContexts == totalContexts && totalContexts > 0 {
				return fmt.Errorf("all %d contexts were unreachable", totalContexts)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&groupName, "context-group", "", "limit search to a named context group")
	cmd.Flags().StringVar(&resourceKinds, "kinds", "all", "comma-separated resource kinds passed to kubectl get")
	return cmd
}
