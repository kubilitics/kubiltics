package cli

import (
	"strings"

	"github.com/spf13/cobra"
	"k8s.io/client-go/tools/clientcmd"

	kubectlpkg "github.com/kubilitics/kubilitics/kubilitics-cli/internal/kubectl"
)

// newShowCmd creates the `kcli show` command — a natural-language alias for `get`
// that routes through the enhanced get engine for richer table output.
// Supports "with" modifiers: kcli show pods with ip,node
func newShowCmd(a *app) *cobra.Command {
	var sortBy string
	var outputFormat string

	cmd := &cobra.Command{
		Use:   "show <resource> [with <modifiers>] [flags]",
		Short: "Natural language alias for 'get' with enhanced output",
		Long: `Show resources with natural language syntax and enhanced colored table output.

Supports "with" modifiers for extra columns, just like "kcli get".

Examples:
  kcli show pods                        # Pods in current namespace
  kcli show pods -A                     # Pods across all namespaces
  kcli show pods with ip                # Pods + IP column
  kcli show pods with ip node           # Pods + IP + NODE columns
  kcli show pods with ip,node           # Same (comma-separated)
  kcli show pods with all               # All available columns
  kcli show deployments                 # Deployments with ready/status
  kcli show svc                         # Services with type/IP/ports
  kcli show nodes                       # Nodes with status/roles/version
  kcli show pods -n prod                # Specific namespace
  kcli show pods --sort age             # Sort by age`,
		GroupID:            "core",
		Args:               cobra.MinimumNArgs(1),
		DisableFlagParsing: true,
		RunE: func(c *cobra.Command, rawArgs []string) error {
			// Handle --help manually since DisableFlagParsing is true
			for _, a := range rawArgs {
				if a == "--help" || a == "-h" {
					return c.Help()
				}
			}

			clean, restore, err := a.applyInlineGlobalFlags(rawArgs)
			if err != nil {
				return err
			}
			defer restore()

			if len(clean) == 0 {
				return c.Help()
			}

			resourceType := mapResourceName(strings.ToLower(clean[0]))
			remaining := clean[1:]

			// Parse "with" modifiers from remaining args
			var modifiers []string
			var flagArgs []string
			inModifiers := false
			for _, arg := range remaining {
				if strings.EqualFold(arg, "with") {
					inModifiers = true
					continue
				}
				if inModifiers && !strings.HasPrefix(arg, "-") {
					// Collect modifiers (comma or space separated)
					for _, m := range strings.Split(arg, ",") {
						m = strings.TrimSpace(strings.ToLower(m))
						if m != "" {
							modifiers = append(modifiers, m)
						}
					}
				} else {
					inModifiers = false
					flagArgs = append(flagArgs, arg)
				}
			}

			// Extract flags
			namespace := a.namespace
			allNS := false
			for i := 0; i < len(flagArgs); i++ {
				switch {
				case flagArgs[i] == "-A" || flagArgs[i] == "--all-namespaces":
					allNS = true
				case flagArgs[i] == "-n" || flagArgs[i] == "--namespace":
					if i+1 < len(flagArgs) {
						i++
						namespace = flagArgs[i]
					}
				case strings.HasPrefix(flagArgs[i], "--namespace="):
					namespace = strings.TrimPrefix(flagArgs[i], "--namespace=")
				case strings.HasPrefix(flagArgs[i], "--sort=") || flagArgs[i] == "--sort":
					if strings.HasPrefix(flagArgs[i], "--sort=") {
						sortBy = strings.TrimPrefix(flagArgs[i], "--sort=")
					} else if i+1 < len(flagArgs) {
						i++
						sortBy = flagArgs[i]
					}
				case flagArgs[i] == "-o" || flagArgs[i] == "--output":
					if i+1 < len(flagArgs) {
						i++
						outputFormat = flagArgs[i]
					}
				case strings.HasPrefix(flagArgs[i], "-o=") || strings.HasPrefix(flagArgs[i], "--output="):
					outputFormat = strings.TrimPrefix(strings.TrimPrefix(flagArgs[i], "--output="), "-o=")
				}
			}

			kubeconfigPath := a.kubeconfig
			if kubeconfigPath == "" {
				kubeconfigPath = kubectlpkg.DefaultKubeconfigPath()
			}

			// Resolve current namespace when not explicitly set
			if namespace == "" && !allNS {
				loadingRules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath}
				configOverrides := &clientcmd.ConfigOverrides{}
				if a.context != "" {
					configOverrides.CurrentContext = a.context
				}
				clientConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, configOverrides)
				if ns, _, err := clientConfig.Namespace(); err == nil && ns != "" {
					namespace = ns
				} else {
					namespace = "default"
				}
			}

			return kubectlpkg.EnhancedGet(kubeconfigPath, a.context, namespace, resourceType, modifiers, allNS, sortBy, outputFormat)
		},
	}

	return cmd
}
