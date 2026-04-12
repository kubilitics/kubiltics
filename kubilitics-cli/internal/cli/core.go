package cli

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/k8sclient"
	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/version"
	"github.com/spf13/cobra"
)

func newKubectlVerbCmd(a *app, verb, short string, aliases ...string) *cobra.Command {
	cmd := &cobra.Command{
		Use:                verb + " [args...]",
		Short:              short,
		Aliases:            aliases,
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, args []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(args)
			if err != nil {
				return err
			}
			defer restore()
			if verb == "get" {
				return a.runGetWithMultiCluster(clean)
			}
			full := append([]string{verb}, clean...)
			return a.runKubectl(full)
		},
	}
	switch verb {
	case "get", "describe":
		cmd.ValidArgsFunction = a.completeKubectl(verb)
	}
	return cmd
}

func newAuthCmd(a *app) *cobra.Command {
	auth := &cobra.Command{
		Use:     "auth",
		Short:   "Inspect authorization",
		GroupID: "core",
	}
	canI := &cobra.Command{
		Use:                "can-i [args...]",
		Short:              "Check whether an action is allowed",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, args []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(args)
			if err != nil {
				return err
			}
			defer restore()
			full := append([]string{"auth", "can-i"}, clean...)
			return a.runKubectl(full)
		},
	}
	auth.AddCommand(canI)
	auth.AddCommand(&cobra.Command{
		Use:   "check",
		Short: "Validate kubeconfig, auth method, and API connectivity using client-go",
		RunE: func(cmd *cobra.Command, _ []string) error {
			bundle, err := k8sclient.NewBundle(a.kubeconfig, a.context)
			if err != nil {
				return err
			}
			ctx, cancel := context.WithTimeout(cmd.Context(), 10*time.Second)
			defer cancel()
			if err := k8sclient.TestConnection(ctx, bundle); err != nil {
				return err
			}

			authMethods := k8sclient.DetectAuthMethods(bundle.RawConfig, bundle.EffectiveContext)
			fmt.Fprintf(cmd.OutOrStdout(), "Context: %s\n", strings.TrimSpace(bundle.EffectiveContext))
			fmt.Fprintf(cmd.OutOrStdout(), "Auth: %s\n", strings.Join(authMethods, ", "))
			fmt.Fprintln(cmd.OutOrStdout(), "Connection: OK")
			return nil
		},
	})
	return auth
}

func newKGPShortcutCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:                "kgp [args...]",
		Short:              "Shortcut for: kcli get pods",
		GroupID:            "core",
		DisableFlagParsing: true,
		RunE: func(_ *cobra.Command, args []string) error {
			clean, restore, err := a.applyInlineGlobalFlags(args)
			if err != nil {
				return err
			}
			defer restore()
			return a.runGetWithMultiCluster(append([]string{"pods"}, clean...))
		},
	}
	return cmd
}

func newVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:     "version",
		Short:   "Show kcli build information",
		GroupID: "workflow",
		RunE: func(cmd *cobra.Command, _ []string) error {
			fmt.Fprintf(cmd.OutOrStdout(), "kcli %s (commit %s, built %s)\n", version.Version, version.Commit, version.BuildDate)
			return nil
		},
	}
}
