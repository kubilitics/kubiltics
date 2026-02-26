package cli

import (
	"fmt"
	"sort"
	"strings"

	"github.com/kubilitics/kcli/internal/state"
	"github.com/spf13/cobra"
)

func newNamespaceCmd(a *app) *cobra.Command {
	var list bool
	var current bool
	cmd := &cobra.Command{
		Use:     "ns [name|-]",
		Short:   "Get, set, and manage namespaces for the current context",
		GroupID: "workflow",
		Long: `Get the active namespace, list all namespaces, or switch to a different namespace.

  kcli ns              — list all namespaces (* marks the active one)
  kcli ns NAME         — switch active namespace to NAME
  kcli ns -            — switch back to the previous namespace
  kcli ns --current    — print only the current namespace (for scripting)
  kcli ns --list       — non-interactive list (one per line, no markers)
  kcli ns create NAME  — create a namespace and switch to it
  kcli ns delete NAME  — delete a namespace (with confirmation)
  kcli ns fav add NAME — add a namespace to favorites
  kcli ns fav ls       — list favorite namespaces`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			// --current: non-interactive, scriptable output
			if current {
				ns, err := currentNamespace(a)
				if err != nil {
					return err
				}
				fmt.Fprintln(cmd.OutOrStdout(), ns)
				return nil
			}
			if len(args) == 0 {
				return printNamespaces(a, cmd, list)
			}
			s, err := state.Load()
			if err != nil {
				return err
			}
			target := strings.TrimSpace(args[0])
			if target == "-" {
				if s.LastNamespace == "" {
					return fmt.Errorf("no previous namespace recorded")
				}
				target = s.LastNamespace
			}
			if target == "" {
				return fmt.Errorf("namespace cannot be empty")
			}
			cur, err := currentNamespace(a)
			if err != nil {
				return err
			}
			if err := a.runKubectl([]string{"config", "set-context", "--current", "--namespace", target}); err != nil {
				return err
			}
			s.MarkNamespaceSwitched(cur, target)
			if err := state.Save(s); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Namespace set to %q\n", target)
			return nil
		},
	}
	cmd.Flags().BoolVarP(&list, "list", "l", false, "list namespaces (one per line, no markers)")
	cmd.Flags().BoolVar(&current, "current", false, "print only the current namespace (for scripting)")
	cmd.AddCommand(newNamespaceFavCmd(a))
	cmd.AddCommand(newNamespaceCreateCmd(a))
	cmd.AddCommand(newNamespaceDeleteCmd(a))
	return cmd
}

// newNamespaceCreateCmd returns a subcommand that creates a namespace and switches to it.
func newNamespaceCreateCmd(a *app) *cobra.Command {
	var noSwitch bool
	return &cobra.Command{
		Use:   "create <name>",
		Short: "Create a namespace and switch to it",
		Long: `Create a new Kubernetes namespace and immediately switch the active namespace to it.

Use --no-switch to create without switching.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := strings.TrimSpace(args[0])
			if name == "" {
				return fmt.Errorf("namespace name cannot be empty")
			}
			// Create the namespace.
			if err := a.runKubectl([]string{"create", "namespace", name}); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Created namespace %q\n", name)
			if noSwitch {
				return nil
			}
			// Switch to the new namespace.
			cur, _ := currentNamespace(a)
			if err := a.runKubectl([]string{"config", "set-context", "--current", "--namespace", name}); err != nil {
				// Namespace was created but switch failed — don't return error.
				fmt.Fprintf(cmd.OutOrStdout(), "Namespace %q created (could not switch: see above)\n", name)
				return nil
			}
			s, err := state.Load()
			if err == nil {
				s.MarkNamespaceSwitched(cur, name)
				_ = state.Save(s)
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Switched to namespace %q\n", name)
			return nil
		},
	}
}

// newNamespaceDeleteCmd returns a subcommand that deletes a namespace with confirmation.
func newNamespaceDeleteCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "delete <name>",
		Short: "Delete a namespace and all resources within it",
		Long: `Delete a Kubernetes namespace and all resources within it.

⚠  This is irreversible. ALL resources in the namespace will be deleted:
   Pods, Deployments, Services, ConfigMaps, Secrets, PVCs, etc.

Confirmation is required unless --yes is passed.
Cannot delete a namespace while it is the active namespace; switch first.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := strings.TrimSpace(args[0])
			if name == "" {
				return fmt.Errorf("namespace name cannot be empty")
			}
			// Prevent deleting the currently active namespace.
			cur, err := currentNamespace(a)
			if err != nil {
				return err
			}
			if cur == name {
				return fmt.Errorf("cannot delete the active namespace %q; switch to another namespace first (e.g. kcli ns default)", name)
			}
			// Confirmation prompt (unless --yes / a.force).
			if !a.force {
				fmt.Fprintf(cmd.OutOrStdout(),
					"⚠  This will permanently delete namespace %q and ALL resources in it.\nContinue? [y/N]: ", name)
				var answer string
				fmt.Fscan(cmd.InOrStdin(), &answer)
				if strings.ToLower(strings.TrimSpace(answer)) != "y" {
					fmt.Fprintln(cmd.OutOrStdout(), "Aborted.")
					return nil
				}
			}
			if err := a.runKubectl([]string{"delete", "namespace", name}); err != nil {
				return err
			}
			// Clean up kcli state.
			s, err := state.Load()
			if err == nil {
				s.RemoveNamespaceFavorite(name)
				if s.LastNamespace == name {
					s.LastNamespace = ""
				}
				_ = state.Save(s)
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Namespace %q deleted\n", name)
			return nil
		},
	}
}

// ─── kcli ns fav ──────────────────────────────────────────────────────────────

func newNamespaceFavCmd(a *app) *cobra.Command {
	favCmd := &cobra.Command{
		Use:   "fav",
		Short: "Manage favorite namespaces",
	}
	favCmd.AddCommand(
		&cobra.Command{
			Use:   "add <namespace>",
			Short: "Add a namespace to favorites",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				ns := strings.TrimSpace(args[0])
				if ns == "" {
					return fmt.Errorf("namespace cannot be empty")
				}
				s, err := state.Load()
				if err != nil {
					return err
				}
				s.AddNamespaceFavorite(ns)
				if err := state.Save(s); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Added %q to namespace favorites\n", ns)
				return nil
			},
		},
		&cobra.Command{
			Use:   "rm <namespace>",
			Short: "Remove a namespace from favorites",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				ns := strings.TrimSpace(args[0])
				s, err := state.Load()
				if err != nil {
					return err
				}
				s.RemoveNamespaceFavorite(ns)
				if err := state.Save(s); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Removed %q from namespace favorites\n", ns)
				return nil
			},
		},
		&cobra.Command{
			Use:   "ls",
			Short: "List favorite namespaces",
			RunE: func(cmd *cobra.Command, _ []string) error {
				s, err := state.Load()
				if err != nil {
					return err
				}
				if len(s.NamespaceFavorites) == 0 {
					fmt.Fprintln(cmd.OutOrStdout(), "No namespace favorites. Add one with: kcli ns fav add <namespace>")
					return nil
				}
				cur, _ := currentNamespace(a)
				// Sort: current first, then alphabetical.
				favs := make([]string, len(s.NamespaceFavorites))
				copy(favs, s.NamespaceFavorites)
				sort.Slice(favs, func(i, j int) bool {
					if favs[i] == cur {
						return true
					}
					if favs[j] == cur {
						return false
					}
					return favs[i] < favs[j]
				})
				for _, ns := range favs {
					marker := "  ★ "
					suffix := ""
					if ns == cur {
						suffix = " → (current)"
					}
					fmt.Fprintf(cmd.OutOrStdout(), "%s%s%s\n", marker, ns, suffix)
				}
				return nil
			},
		},
	)
	return favCmd
}

func printNamespaces(a *app, cmd *cobra.Command, listOnly bool) error {
	out, err := a.captureKubectl([]string{"get", "namespaces", "-o", "name"})
	if err != nil {
		if listOnly {
			return err
		}
		// Fallback to current namespace only when listing namespaces fails.
		out, err = a.captureKubectl([]string{"config", "view", "--minify", "-o", "jsonpath={..namespace}"})
		if err != nil {
			return err
		}
		ns := strings.TrimSpace(out)
		if ns == "" {
			ns = "default"
		}
		fmt.Fprintln(cmd.OutOrStdout(), ns)
		return nil
	}
	current, err := currentNamespace(a)
	if err != nil {
		return err
	}
	if current == "" {
		current = "default"
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	namespaces := make([]string, 0, len(lines))
	for _, l := range lines {
		l = strings.TrimPrefix(strings.TrimSpace(l), "namespace/")
		if l != "" {
			namespaces = append(namespaces, l)
		}
	}
	sort.Strings(namespaces)
	if len(namespaces) == 0 {
		fmt.Fprintln(cmd.OutOrStdout(), current)
		return nil
	}
	for _, ns := range namespaces {
		prefix := "  "
		if ns == current {
			prefix = "* "
		}
		fmt.Fprintf(cmd.OutOrStdout(), "%s%s\n", prefix, ns)
	}
	return nil
}

func currentNamespace(a *app) (string, error) {
	out, err := a.captureKubectl([]string{"config", "view", "--minify", "-o", "jsonpath={..namespace}"})
	if err != nil {
		return "", err
	}
	ns := strings.TrimSpace(out)
	if ns == "" {
		ns = "default"
	}
	return ns, nil
}
