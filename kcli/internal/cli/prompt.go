package cli

import (
	"fmt"
	"strings"

	"github.com/kubilitics/kcli/internal/k8sclient"
	"github.com/spf13/cobra"
)

func newPromptCmd(a *app) *cobra.Command {
	var shell string
	cmd := &cobra.Command{
		Use:   "prompt",
		Short: "Output shell code to show current context/namespace in PS1",
		Long:  "Prints shell code that sets PS1 (or equivalent) using current kube context and namespace. Use: eval \"$(kcli prompt)\". Supports bash and zsh. Format is controlled by shell.promptFormat in ~/.kcli/config.yaml (default: [{{.context}}/{{.namespace}}]$ ).",
		RunE: func(cmd *cobra.Command, _ []string) error {
			ctx, ns, err := k8sclient.CurrentContextAndNamespace(a.kubeconfig, a.context)
			if err != nil {
				return err
			}
			format := "[{{.context}}/{{.namespace}}]$ "
			if a.cfg != nil && strings.TrimSpace(a.cfg.Shell.PromptFormat) != "" {
				format = a.cfg.Shell.PromptFormat
			}
			format = strings.ReplaceAll(format, "{{.context}}", ctx)
			format = strings.ReplaceAll(format, "{{.namespace}}", ns)
			// Escape for single-quoted shell string: ' -> '\''
			escaped := strings.ReplaceAll(format, "'", "'\\''")
			fmt.Fprintf(cmd.OutOrStdout(), "export PS1='%s'\n", escaped)
			return nil
		},
	}
	cmd.Flags().StringVar(&shell, "shell", "bash", "Shell for prompt code: bash, zsh")
	return cmd
}

