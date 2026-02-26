package cli

import (
	"github.com/spf13/cobra"
)

// newKubeconfigCmd returns a command that passes through to kubectl config.
// This resolves the config name collision: kcli config = ~/.kcli/config.yaml,
// kcli kubeconfig = kubectl config (get-contexts, use-context, set-cluster, etc.).
func newKubeconfigCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "kubeconfig [kubectl config subcommand] [args...]",
		Short: "Modify kubeconfig files (pass-through to kubectl config)",
		Long: `Pass-through to kubectl config. For kcli settings (~/.kcli/config.yaml), use 'kcli config' instead.

Subcommands and examples:

  View and inspect:
    kcli kubeconfig view                    # show merged kubeconfig
    kcli kubeconfig view --minify           # show only current-context data
    kcli kubeconfig view --raw              # include raw cert data and secrets
    kcli kubeconfig get-contexts            # list all contexts
    kcli kubeconfig current-context         # show current context name
    kcli kubeconfig get-clusters            # list clusters
    kcli kubeconfig get-users               # list users

  Switch context:
    kcli kubeconfig use-context <name>      # set current context

  Create or modify entries:
    kcli kubeconfig set-cluster <name> --server=https://api.example.com
    kcli kubeconfig set-credentials <name> --token=TOKEN
    kcli kubeconfig set-credentials <name> --client-certificate=CERT --client-key=KEY
    kcli kubeconfig set-context <name> --cluster=X --user=Y --namespace=Z

  Delete entries:
    kcli kubeconfig delete-context <name>
    kcli kubeconfig delete-cluster <name>
    kcli kubeconfig delete-user <name>

  Rename:
    kcli kubeconfig rename-context <old> <new>

  Merge (KUBECONFIG=file1:file2 kcli kubeconfig view --merge):
    KUBECONFIG=~/.kube/config1:~/.kube/config2 kcli kubeconfig view

  Low-level property set/unset:
    kcli kubeconfig set PROPERTY_NAME VALUE
    kcli kubeconfig unset PROPERTY_NAME`,
		GroupID:            "core",
		DisableFlagParsing:  true,
		RunE: func(_ *cobra.Command, args []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(args)
			if err != nil {
				return err
			}
			defer restore()
			full := append([]string{"config"}, clean...)
			return a.runKubectl(full)
		},
	}
}
