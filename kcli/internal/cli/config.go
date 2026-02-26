package cli

import (
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strings"

	kcfg "github.com/kubilitics/kcli/internal/config"
	"github.com/kubilitics/kcli/internal/keychain"
	"github.com/spf13/cobra"
)

func newConfigCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Manage kcli configuration (~/.kcli/config.yaml)",
		Long:  "Manages kcli settings (view, get, set, reset, edit). For kubeconfig (get-contexts, use-context, set-cluster), use 'kcli kubeconfig' instead.",
		GroupID: "workflow",
	}
	cmd.AddCommand(
		newConfigViewCmd(),
		newConfigGetCmd(),
		newConfigSetCmd(a),
		newConfigResetCmd(a),
		newConfigEditCmd(),
		newConfigProfileCmd(a),
	)
	return cmd
}

func newConfigViewCmd() *cobra.Command {
	var output string
	cmd := &cobra.Command{
		Use:   "view",
		Short: "Show effective configuration",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := kcfg.Load()
			if err != nil {
				return err
			}
			// Use redacted config for display so AI API key is never shown
			disp := cfg.Redacted()
			switch strings.ToLower(strings.TrimSpace(output)) {
			case "", "yaml":
				v, err := disp.ToYAML()
				if err != nil {
					return err
				}
				fmt.Fprint(cmd.OutOrStdout(), v)
				return nil
			case "json":
				v, err := disp.ToJSON()
				if err != nil {
					return err
				}
				fmt.Fprintln(cmd.OutOrStdout(), v)
				return nil
			default:
				return fmt.Errorf("unsupported --output %q (supported: yaml, json)", output)
			}
		},
	}
	cmd.Flags().StringVar(&output, "output", "yaml", "output format: yaml|json")
	return cmd
}

func newConfigGetCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "get <key>",
		Short: "Get a config value by key path",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := kcfg.Load()
			if err != nil {
				return err
			}
			v, err := cfg.GetByKey(args[0])
			if err != nil {
				return err
			}
			switch t := v.(type) {
			case []string:
				fmt.Fprintln(cmd.OutOrStdout(), strings.Join(t, ","))
			case bool:
				fmt.Fprintln(cmd.OutOrStdout(), t)
			case int:
				fmt.Fprintln(cmd.OutOrStdout(), t)
			case string:
				fmt.Fprintln(cmd.OutOrStdout(), t)
			default:
				fmt.Fprintln(cmd.OutOrStdout(), v)
			}
			return nil
		},
	}
	return cmd
}

func newConfigSetCmd(a *app) *cobra.Command {
	var useKeychain bool
	cmd := &cobra.Command{
		Use:   "set <key> <value>",
		Short: "Set a config value by key path",
		Long:  "Set a config value. Use --keychain to store the value in the system keychain (macOS Keychain / Linux Secret Service) instead of in the config file. Supported for: ai.api_key, integrations.pagerDutyKey, integrations.slackWebhook, integrations.jiraToken.",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			store, err := kcfg.LoadStore()
			if err != nil {
				return err
			}
			cfg := store.Current()
			key, value := args[0], args[1]
			if useKeychain {
				if !keychain.Available() {
					return fmt.Errorf("keychain not available on this platform (macOS: Keychain, Linux: install libsecret-tools for secret-tool)")
				}
				norm := strings.ToLower(strings.TrimSpace(key))
				if _, ok := kcfg.KeychainableKeys[norm]; !ok {
					return fmt.Errorf("key %q cannot be stored in keychain (supported: ai.api_key, integrations.pagerDutyKey, integrations.slackWebhook, integrations.jiraToken)", key)
				}
				account := store.ActiveProfile + "." + kcfg.NormalizeKeyForAccount(key)
				if err := keychain.Set(keychain.Service, account, value); err != nil {
					return fmt.Errorf("keychain set failed: %w", err)
				}
				cfg.AddKeychainKey(key)
			}
			if err := cfg.SetByKey(key, value); err != nil {
				return err
			}
			if err := kcfg.Save(cfg); err != nil {
				return err
			}
			// Reload so a.cfg has the latest config (and keychain-resolved values).
			reloaded, err := kcfg.Load()
			if err == nil {
				a.cfg = reloaded
			}
			msg := "Updated %s\n"
			if useKeychain {
				msg = "Updated %s (stored in system keychain)\n"
			}
			fmt.Fprintf(cmd.OutOrStdout(), msg, key)
			return nil
		},
	}
	cmd.Flags().BoolVar(&useKeychain, "keychain", false, "store value in system keychain (macOS Keychain / Linux Secret Service) instead of config file")
	return cmd
}

func newConfigResetCmd(a *app) *cobra.Command {
	var yes bool
	cmd := &cobra.Command{
		Use:   "reset",
		Short: "Reset configuration to defaults",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if !yes {
				return fmt.Errorf("refusing to reset config without --yes")
			}
			cfg := kcfg.Default()
			if err := kcfg.Save(cfg); err != nil {
				return err
			}
			a.cfg = cfg
			fmt.Fprintln(cmd.OutOrStdout(), "Configuration reset to defaults")
			return nil
		},
	}
	cmd.Flags().BoolVar(&yes, "yes", false, "confirm reset")
	return cmd
}

func newConfigEditCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "edit",
		Short: "Open config file in your editor",
		RunE: func(cmd *cobra.Command, _ []string) error {
			path, err := kcfg.EnsureExists()
			if err != nil {
				return err
			}
			editor := strings.TrimSpace(os.Getenv("VISUAL"))
			if editor == "" {
				editor = strings.TrimSpace(os.Getenv("EDITOR"))
			}
			if editor == "" {
				editor = "vi"
			}
			ep := strings.Fields(editor)
			if len(ep) == 0 {
				return fmt.Errorf("invalid editor command")
			}
			args := append(ep[1:], path)
			proc := exec.Command(ep[0], args...)
			proc.Stdin = cmd.InOrStdin()
			proc.Stdout = cmd.OutOrStdout()
			proc.Stderr = cmd.ErrOrStderr()
			if err := proc.Run(); err != nil {
				return err
			}
			cfg, err := kcfg.Load()
			if err != nil {
				return fmt.Errorf("edited config is invalid: %w", err)
			}
			if err := kcfg.Save(cfg); err != nil {
				return err
			}
			fmt.Fprintln(cmd.OutOrStdout(), "Configuration validated")
			return nil
		},
	}
	return cmd
}

func newConfigProfileCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "profile",
		Short: "Manage configuration profiles",
	}
	cmd.AddCommand(
		newConfigProfileListCmd(),
		newConfigProfileUseCmd(a),
		newConfigProfileAddCmd(),
		newConfigProfileRmCmd(),
	)
	return cmd
}

func newConfigProfileListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List all profiles",
		RunE: func(cmd *cobra.Command, _ []string) error {
			s, err := kcfg.LoadStore()
			if err != nil {
				return err
			}
			names := make([]string, 0, len(s.Profiles))
			for name := range s.Profiles {
				names = append(names, name)
			}
			sort.Strings(names)
			for _, name := range names {
				prefix := "  "
				if name == s.ActiveProfile {
					prefix = "* "
				}
				fmt.Fprintf(cmd.OutOrStdout(), "%s%s\n", prefix, name)
			}
			return nil
		},
	}
}

func newConfigProfileUseCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "use <name>",
		Short: "Switch to a different profile",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := strings.TrimSpace(args[0])
			s, err := kcfg.LoadStore()
			if err != nil {
				return err
			}
			if _, ok := s.Profiles[name]; !ok {
				return fmt.Errorf("profile %q not found", name)
			}
			s.ActiveProfile = name
			if err := kcfg.SaveStore(s); err != nil {
				return err
			}
			a.cfg = s.Current()
			a.resetAIClient() // Reset AI client to pick up new profile settings
			fmt.Fprintf(cmd.OutOrStdout(), "Switched to profile %q\n", name)
			return nil
		},
	}
}

func newConfigProfileAddCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "add <name>",
		Short: "Create a new profile with default settings",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := strings.TrimSpace(args[0])
			if name == "" {
				return fmt.Errorf("profile name cannot be empty")
			}
			s, err := kcfg.LoadStore()
			if err != nil {
				return err
			}
			if _, ok := s.Profiles[name]; ok {
				return fmt.Errorf("profile %q already exists", name)
			}
			if s.Profiles == nil {
				s.Profiles = make(map[string]*kcfg.Config)
			}
			s.Profiles[name] = kcfg.Default()
			if err := kcfg.SaveStore(s); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Created profile %q\n", name)
			return nil
		},
	}
}

func newConfigProfileRmCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "rm <name>",
		Short: "Delete a profile",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := strings.TrimSpace(args[0])
			if name == "default" {
				return fmt.Errorf("cannot remove 'default' profile")
			}
			s, err := kcfg.LoadStore()
			if err != nil {
				return err
			}
			if _, ok := s.Profiles[name]; !ok {
				return fmt.Errorf("profile %q not found", name)
			}
			if s.ActiveProfile == name {
				return fmt.Errorf("cannot remove currently active profile; switch to another one first")
			}
			delete(s.Profiles, name)
			if err := kcfg.SaveStore(s); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Removed profile %q\n", name)
			return nil
		},
	}
}
