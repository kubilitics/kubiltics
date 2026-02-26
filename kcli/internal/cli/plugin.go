package cli

import (
	"fmt"
	"sort"
	"strings"

	"github.com/kubilitics/kcli/internal/plugin"
	"github.com/spf13/cobra"
)

func newPluginCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "plugin",
		Short: "Manage and run kcli plugins",
		Long: `Manage and run kcli plugins.

Plugins are executed inside an OS-level isolation boundary derived from the
manifest permissions declarations:

  macOS  — sandbox-exec(8) Seatbelt policy (deny-by-default, allowlist model)
  Linux  — unshare(1) namespace isolation (user, pid, mount, ipc, uts, net)
  other  — no OS sandbox; plugin runs with your full user privileges

Use 'kcli plugin inspect-sandbox <name>' to view the generated policy.
Binaries must live in ~/.kcli/plugins/ (or set KCLI_PLUGIN_ALLOW_PATH=1 to
allow plugins found on PATH).`,
		GroupID: "workflow",
	}
	cmd.AddCommand(
		&cobra.Command{
			Use:   "list",
			Short: "List installed plugins",
			RunE: func(cmd *cobra.Command, _ []string) error {
				plugins, err := plugin.DiscoverInfo()
				if err != nil {
					return err
				}
				if len(plugins) == 0 {
					fmt.Fprintln(cmd.OutOrStdout(), "No plugins installed.")
					return nil
				}
				for _, p := range plugins {
					status := "ready"
					if p.ValidationError != nil {
						status = "invalid"
					}
					version := "-"
					if p.Manifest != nil {
						version = p.Manifest.Version
					}
					fmt.Fprintf(cmd.OutOrStdout(), "%s\t%s\t%s\n", p.Name, version, status)
				}
				return nil
			},
		},
		&cobra.Command{
			Use:   "search <keyword>",
			Short: "Search installed plugins and marketplace catalog",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				results, err := plugin.SearchInstalled(args[0])
				if err != nil {
					return err
				}
				market, merr := plugin.SearchMarketplace(args[0])
				if merr != nil {
					return merr
				}
				if len(results) == 0 && len(market) == 0 {
					fmt.Fprintln(cmd.OutOrStdout(), "No matching plugins.")
					return nil
				}
				if len(results) > 0 {
					fmt.Fprintln(cmd.OutOrStdout(), "Installed:")
					for _, p := range results {
						desc := "-"
						if p.Manifest != nil && strings.TrimSpace(p.Manifest.Description) != "" {
							desc = p.Manifest.Description
						}
						fmt.Fprintf(cmd.OutOrStdout(), "  %s\t%s\n", p.Name, desc)
					}
				}
				if len(market) > 0 {
					fmt.Fprintln(cmd.OutOrStdout(), "Marketplace:")
					for _, p := range market {
						tag := "community"
						if p.Official {
							tag = "official"
						}
						fmt.Fprintf(cmd.OutOrStdout(), "  %s\t%s\tv%s\t%s\tdl=%d\trating=%.1f\n", p.Name, tag, p.Version, p.Description, p.Downloads, p.Rating)
					}
				}
				return nil
			},
		},
		&cobra.Command{
			Use:   "marketplace",
			Short: "List marketplace catalog plugins",
			RunE: func(cmd *cobra.Command, _ []string) error {
				catalog, err := plugin.MarketplaceCatalog()
				if err != nil {
					return err
				}
				for _, p := range catalog {
					tag := "community"
					if p.Official {
						tag = "official"
					}
					fmt.Fprintf(cmd.OutOrStdout(), "%s\t%s\tv%s\tdl=%d\trating=%.1f\n", p.Name, tag, p.Version, p.Downloads, p.Rating)
				}
				return nil
			},
		},
		&cobra.Command{
			Use:   "inspect <name>",
			Short: "Show plugin manifest and permission policy",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				return printPluginInspect(cmd, strings.TrimSpace(args[0]))
			},
		},
		&cobra.Command{
			Use:     "info <name>",
			Aliases: []string{"show"},
			Short:   "Alias of plugin inspect",
			Args:    cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				return printPluginInspect(cmd, strings.TrimSpace(args[0]))
			},
		},
		&cobra.Command{
			Use:   "install <source>",
			Short: "Install plugin from local path or github.com/<org>/<repo>",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				entry, err := plugin.InstallFromSource(args[0])
				if err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Installed plugin %q from %s (%s)\n", entry.Name, entry.Source, entry.SourceType)
				return nil
			},
		},
		newPluginUpdateCmd(),
		&cobra.Command{
			Use:   "update-all",
			Short: "Update all installed plugins from their recorded sources",
			RunE: func(cmd *cobra.Command, _ []string) error {
				updated, err := plugin.UpdateAllInstalled()
				if err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Updated %d plugin(s)\n", len(updated))
				return nil
			},
		},
		&cobra.Command{
			Use:     "remove <name>",
			Aliases: []string{"uninstall"},
			Short:   "Remove installed plugin binary and manifest",
			Args:    cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				if err := plugin.RemoveInstalled(args[0]); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Removed plugin %q\n", args[0])
				return nil
			},
		},
		&cobra.Command{
			Use:   "allow <name> [permission...]",
			Short: "Approve plugin permissions (all declared permissions when omitted)",
			Args:  cobra.MinimumNArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				name := strings.TrimSpace(args[0])
				var permissions []string
				if len(args) > 1 {
					permissions = args[1:]
				} else {
					info, err := plugin.Inspect(name)
					if err != nil {
						return err
					}
					if info.ValidationError != nil {
						return fmt.Errorf("plugin %q has invalid manifest: %w", name, info.ValidationError)
					}
					permissions = info.Manifest.Permissions
				}
				if err := plugin.AllowPermissions(name, permissions); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Approved %d permission(s) for plugin %q\n", len(permissions), name)
				return nil
			},
		},
		&cobra.Command{
			Use:   "revoke <name> [permission...]",
			Short: "Revoke plugin permission approvals (all when omitted)",
			Args:  cobra.MinimumNArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				name := strings.TrimSpace(args[0])
				permissions := []string(nil)
				if len(args) > 1 {
					permissions = args[1:]
				}
				if err := plugin.RevokePermissions(name, permissions); err != nil {
					return err
				}
				if len(permissions) == 0 {
					fmt.Fprintf(cmd.OutOrStdout(), "Revoked all permissions for plugin %q\n", name)
				} else {
					fmt.Fprintf(cmd.OutOrStdout(), "Revoked %d permission(s) for plugin %q\n", len(permissions), name)
				}
				return nil
			},
		},
		&cobra.Command{
			Use:   "run <name> [args...]",
			Short: "Run a plugin by name",
			Args:  cobra.MinimumNArgs(1),
			RunE: func(_ *cobra.Command, args []string) error {
				return plugin.Run(args[0], args[1:])
			},
		},
		newPluginVerifyCmd(),
		newPluginInspectSandboxCmd(),
		newPluginAllowlistCmd(),
	)
	return cmd
}

func newPluginVerifyCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "verify [name]",
		Short: "Verify plugin binary integrity using SHA-256 checksums",
		Long: `Verify the integrity of installed plugin binaries.

With no name, verifies all installed plugins.
With a name, verifies a specific plugin.

kcli records the SHA-256 checksum of each plugin binary at install time and
stores it in ~/.kcli/registry.json.  'verify' re-computes the current checksum
and compares it against the recorded value to detect tampering or corruption.

Exit codes:
  0 — all verified plugins passed
  1 — one or more plugins failed verification or an error occurred
`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 1 {
				name := strings.TrimSpace(args[0])
				if err := plugin.VerifyPlugin(name); err != nil {
					return err
				}
				path, _ := plugin.Resolve(name)
				checksum, _ := plugin.FileSHA256(path)
				fmt.Fprintf(cmd.OutOrStdout(), "%s: OK (%s)\n", name, checksum)
				return nil
			}
			// Verify all installed plugins.
			plugins, err := plugin.DiscoverInfo()
			if err != nil {
				return err
			}
			if len(plugins) == 0 {
				fmt.Fprintln(cmd.OutOrStdout(), "No plugins installed.")
				return nil
			}
			var failed int
			for _, p := range plugins {
				if verr := plugin.VerifyPlugin(p.Name); verr != nil {
					fmt.Fprintf(cmd.OutOrStdout(), "%s: FAIL — %v\n", p.Name, verr)
					failed++
					continue
				}
				checksum, cerr := plugin.FileSHA256(p.Path)
				if cerr != nil {
					checksum = fmt.Sprintf("<error: %v>", cerr)
				}
				fmt.Fprintf(cmd.OutOrStdout(), "%s: OK (%s)\n", p.Name, checksum)
			}
			if failed > 0 {
				return fmt.Errorf("%d plugin(s) failed integrity verification", failed)
			}
			return nil
		},
	}
}

func printPluginInspect(cmd *cobra.Command, name string) error {
	info, err := plugin.Inspect(name)
	if err != nil {
		return err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "Name: %s\n", info.Name)
	fmt.Fprintf(cmd.OutOrStdout(), "Path: %s\n", info.Path)
	if info.ValidationError != nil {
		fmt.Fprintf(cmd.OutOrStdout(), "Manifest: invalid (%v)\n", info.ValidationError)
		return nil
	}
	fmt.Fprintf(cmd.OutOrStdout(), "Version: %s\n", info.Manifest.Version)
	if info.Manifest.Author != "" {
		fmt.Fprintf(cmd.OutOrStdout(), "Author: %s\n", info.Manifest.Author)
	}
	if info.Manifest.Description != "" {
		fmt.Fprintf(cmd.OutOrStdout(), "Description: %s\n", info.Manifest.Description)
	}
	if len(info.Manifest.Commands) > 0 {
		fmt.Fprintf(cmd.OutOrStdout(), "Commands: %s\n", strings.Join(info.Manifest.Commands, ", "))
	}
	required := append([]string(nil), info.Manifest.Permissions...)
	sort.Strings(required)
	missing, err := plugin.MissingPermissions(name, required)
	if err != nil {
		return err
	}
	missingSet := map[string]struct{}{}
	for _, p := range missing {
		missingSet[p] = struct{}{}
	}
	if len(required) == 0 {
		fmt.Fprintln(cmd.OutOrStdout(), "Permissions: none")
		return nil
	}
	fmt.Fprintln(cmd.OutOrStdout(), "Permissions:")
	for _, p := range required {
		status := "approved"
		if _, isMissing := missingSet[p]; isMissing {
			status = "pending-approval"
		}
		fmt.Fprintf(cmd.OutOrStdout(), "  - %s (%s)\n", p, status)
	}
	return nil
}

func newPluginInspectSandboxCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "inspect-sandbox <name>",
		Short: "Show the OS-level sandbox policy for a plugin",
		Long: `Show the OS-level isolation policy that would be applied when running a plugin.

The policy is generated from the plugin manifest's permissions declarations.
On macOS this is a Seatbelt (.sb) profile passed to sandbox-exec(8).
On Linux this is a summary of the unshare(1) namespace flags.

The sandbox is applied automatically on every plugin execution; this command
lets you audit the generated policy without running the plugin.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := strings.TrimSpace(args[0])
			profile, err := plugin.InspectSandboxProfile(name)
			if err != nil {
				return err
			}
			out := cmd.OutOrStdout()
			fmt.Fprintf(out, "Plugin:    %s\n", name)
			fmt.Fprintf(out, "Platform:  %s\n", profile.Platform)
			if profile.Available {
				fmt.Fprintf(out, "Sandbox:   enabled\n\n")
			} else {
				fmt.Fprintf(out, "Sandbox:   unavailable (plugin runs with full user privileges)\n\n")
			}
			fmt.Fprintf(out, "Policy:\n%s\n", profile.PolicyText)
			return nil
		},
	}
}

// newPluginAllowlistCmd builds the 'kcli plugin allowlist' command tree.
//
// Subcommands:
//
//	show    — print the current allowlist and enforcement status
//	add     — add one or more plugin names to the allowlist
//	rm      — remove one or more plugin names from the allowlist
//	lock    — enable enforcement (only allowlisted plugins may run/install)
//	unlock  — disable enforcement (advisory mode; any plugin may run)
func newPluginAllowlistCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "allowlist",
		Short: "Manage the enterprise plugin allowlist",
		Long: `Manage the organization plugin allowlist.

When the allowlist is locked, only plugins whose names appear in the list
may be installed or executed.  This lets platform administrators control
which plugins developers can use in a shared cluster environment.

Allowlist data is stored in ~/.kcli/plugin-allowlist.json.

Examples:

  # Allow specific plugins and enable enforcement
  kcli plugin allowlist add argocd cert-manager backup
  kcli plugin allowlist lock

  # Check current status
  kcli plugin allowlist show

  # Remove a plugin from the allowlist
  kcli plugin allowlist rm cert-manager

  # Disable enforcement (advisory mode)
  kcli plugin allowlist unlock`,
	}
	cmd.AddCommand(
		&cobra.Command{
			Use:   "show",
			Short: "Show allowed plugins and enforcement status",
			RunE: func(cmd *cobra.Command, _ []string) error {
				store, err := plugin.LoadAllowlist()
				if err != nil {
					return err
				}
				out := cmd.OutOrStdout()
				status := "unlocked (advisory — any plugin may run)"
				if store.Locked {
					status = "LOCKED (only allowlisted plugins may install/run)"
				}
				fmt.Fprintf(out, "Enforcement: %s\n", status)
				if len(store.Plugins) == 0 {
					fmt.Fprintln(out, "Plugins:     (none)")
					return nil
				}
				fmt.Fprintln(out, "Plugins:")
				for _, p := range store.Plugins {
					fmt.Fprintf(out, "  - %s\n", p)
				}
				return nil
			},
		},
		&cobra.Command{
			Use:   "add <name> [name...]",
			Short: "Add plugin(s) to the allowlist",
			Args:  cobra.MinimumNArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				if err := plugin.AllowlistAdd(args); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Added %d plugin(s) to the allowlist: %s\n",
					len(args), strings.Join(args, ", "))
				return nil
			},
		},
		&cobra.Command{
			Use:     "rm <name> [name...]",
			Aliases: []string{"remove"},
			Short:   "Remove plugin(s) from the allowlist",
			Args:    cobra.MinimumNArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				if err := plugin.AllowlistRemove(args); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Removed %d plugin(s) from the allowlist: %s\n",
					len(args), strings.Join(args, ", "))
				return nil
			},
		},
		&cobra.Command{
			Use:   "lock",
			Short: "Enable allowlist enforcement",
			Long: `Enable allowlist enforcement.

Once locked, only plugins listed in 'kcli plugin allowlist show' may be
installed or executed.  Use 'kcli plugin allowlist unlock' to revert.`,
			RunE: func(cmd *cobra.Command, _ []string) error {
				if err := plugin.AllowlistSetLocked(true); err != nil {
					return err
				}
				fmt.Fprintln(cmd.OutOrStdout(), "Allowlist locked — only allowlisted plugins may install/run.")
				return nil
			},
		},
		&cobra.Command{
			Use:   "unlock",
			Short: "Disable allowlist enforcement (advisory mode)",
			Long: `Disable allowlist enforcement.

The allowlist file is preserved but no longer checked during plugin install
or execution.  Use 'kcli plugin allowlist lock' to re-enable enforcement.`,
			RunE: func(cmd *cobra.Command, _ []string) error {
				if err := plugin.AllowlistSetLocked(false); err != nil {
					return err
				}
				fmt.Fprintln(cmd.OutOrStdout(), "Allowlist unlocked — any plugin may install/run.")
				return nil
			},
		},
	)
	return cmd
}

func newPluginUpdateCmd() *cobra.Command {
	var updateAll bool
	cmd := &cobra.Command{
		Use:   "update [name]",
		Short: "Update one plugin (or all plugins with --all)",
		Args: func(_ *cobra.Command, args []string) error {
			if updateAll {
				if len(args) != 0 {
					return fmt.Errorf("update --all does not take a plugin name")
				}
				return nil
			}
			if len(args) != 1 {
				return fmt.Errorf("update requires exactly one plugin name, or use --all")
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			if updateAll {
				updated, err := plugin.UpdateAllInstalled()
				if err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Updated %d plugin(s)\n", len(updated))
				return nil
			}
			entry, err := plugin.UpdateInstalled(args[0])
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Updated plugin %q from %s\n", entry.Name, entry.Source)
			return nil
		},
	}
	cmd.Flags().BoolVar(&updateAll, "all", false, "update all installed plugins")
	return cmd
}
