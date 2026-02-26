package cli

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/kubilitics/kcli/internal/k8sclient"
	"github.com/kubilitics/kcli/internal/state"
	"github.com/spf13/cobra"
)

// kubeconfig view output for context extraction
type kubeContextEntry struct {
	Name    string `json:"name"`
	Context struct {
		Cluster   string `json:"cluster"`
		User      string `json:"user"`
		Namespace string `json:"namespace,omitempty"`
	} `json:"context"`
}

func newContextCmd(a *app) *cobra.Command {
	var onlyFavorites bool
	var pick bool

	ctxCmd := &cobra.Command{
		Use:     "ctx [name|-]",
		Short:   "Get, set, and manage kube contexts",
		GroupID: "workflow",
		Args:    cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			store, err := state.Load()
			if err != nil {
				return err
			}
			if len(args) == 0 {
				if pick {
					return pickContextInteractive(a, store, onlyFavorites, cmd)
				}
				return printContexts(a, store, onlyFavorites)
			}
			target := strings.TrimSpace(args[0])
			if target == "-" {
				if store.LastContext == "" {
					return fmt.Errorf("no previous context recorded")
				}
				target = store.LastContext
			}
			// Resolve alias → real context name
			target = store.ResolveContextAlias(target)
			current, _ := currentContext(a)
			if err := a.runKubectl([]string{"config", "use-context", target}); err != nil {
				return err
			}
			store.MarkContextSwitched(current, target)
			if err := state.Save(store); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Switched to context %q\n", target)
			return nil
		},
	}
	ctxCmd.Flags().BoolVarP(&onlyFavorites, "favorites", "f", false, "show favorite contexts only")
	ctxCmd.Flags().BoolVar(&pick, "pick", false, "interactive fuzzy-like context picker")

	ctxCmd.AddCommand(newContextRenameCmd(a))
	ctxCmd.AddCommand(newContextDeleteCmd(a))

	favCmd := &cobra.Command{Use: "fav", Short: "Manage favorite contexts"}
	favCmd.AddCommand(
		&cobra.Command{
			Use:   "add <context>",
			Short: "Add context to favorites",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				s, err := state.Load()
				if err != nil {
					return err
				}
				s.AddFavorite(strings.TrimSpace(args[0]))
				if err := state.Save(s); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Added %q to favorites\n", args[0])
				return nil
			},
		},
		&cobra.Command{
			Use:   "rm <context>",
			Short: "Remove context from favorites",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				s, err := state.Load()
				if err != nil {
					return err
				}
				s.RemoveFavorite(strings.TrimSpace(args[0]))
				if err := state.Save(s); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Removed %q from favorites\n", args[0])
				return nil
			},
		},
		&cobra.Command{
			Use:   "ls",
			Short: "List favorite contexts",
			RunE: func(cmd *cobra.Command, _ []string) error {
				s, err := state.Load()
				if err != nil {
					return err
				}
				if len(s.Favorites) == 0 {
					fmt.Fprintln(cmd.OutOrStdout(), "No favorite contexts. Add one with: kcli ctx fav add <context>")
					return nil
				}
				cur, _ := currentContext(a)
				// Sort: current first, then alphabetical.
				favs := make([]string, len(s.Favorites))
				copy(favs, s.Favorites)
				sort.Slice(favs, func(i, j int) bool {
					if favs[i] == cur {
						return true
					}
					if favs[j] == cur {
						return false
					}
					return favs[i] < favs[j]
				})
				for _, v := range favs {
					marker := "  ★ "
					suffix := ""
					if v == cur {
						suffix = " → (current)"
					}
					fmt.Fprintf(cmd.OutOrStdout(), "%s%s%s\n", marker, v, suffix)
				}
				return nil
			},
		},
	)
	ctxCmd.AddCommand(favCmd)
	ctxCmd.AddCommand(newContextGroupCmd(a))
	ctxCmd.AddCommand(newContextAliasCmd(a))

	ctxCmd.ValidArgsFunction = func(cmd *cobra.Command, args []string, _ string) ([]string, cobra.ShellCompDirective) {
		if len(args) > 0 {
			return nil, cobra.ShellCompDirectiveNoFileComp
		}
		ctxs, err := listContexts(a)
		if err != nil {
			return nil, cobra.ShellCompDirectiveNoFileComp
		}
		return ctxs, cobra.ShellCompDirectiveNoFileComp
	}

	return ctxCmd
}

func newContextDeleteCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "delete <name>",
		Short: "Delete a context from kubeconfig",
		Long:  "Removes the context from kubeconfig. Cannot delete the current context; switch to another context first.",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := strings.TrimSpace(args[0])
			if name == "" {
				return fmt.Errorf("context name is required")
			}
			current, err := currentContext(a)
			if err != nil {
				return err
			}
			if current == name {
				return fmt.Errorf("cannot delete current context %q; switch to another context first (e.g. kcli ctx <other>)", name)
			}
			if err := a.runKubectl([]string{"config", "delete-context", name}); err != nil {
				return err
			}
			// Update state: remove from favorites and clear last if deleted
			s, err := state.Load()
			if err != nil {
				return err
			}
			s.RemoveFavorite(name)
			if s.LastContext == name {
				s.LastContext = ""
			}
			if s.RecentContexts != nil {
				out := make([]string, 0, len(s.RecentContexts))
				for _, c := range s.RecentContexts {
					if c != name {
						out = append(out, c)
					}
				}
				s.RecentContexts = out
			}
			_ = state.Save(s)
			fmt.Fprintf(cmd.OutOrStdout(), "Deleted context %q\n", name)
			return nil
		},
	}
}

func newContextRenameCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "rename <old-name> <new-name>",
		Short: "Rename a context in kubeconfig",
		Long:  "Creates a new context with the same cluster/user/namespace and removes the old one. Switches current context if the renamed context was active.",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			oldName := strings.TrimSpace(args[0])
			newName := strings.TrimSpace(args[1])
			if oldName == "" || newName == "" {
				return fmt.Errorf("both old and new context names are required")
			}
			if oldName == newName {
				return fmt.Errorf("old and new names are the same")
			}
			ctxs, err := listContexts(a)
			if err != nil {
				return err
			}
			hasOld := false
			for _, c := range ctxs {
				if c == oldName {
					hasOld = true
					break
				}
			}
			if !hasOld {
				return fmt.Errorf("context %q not found", oldName)
			}
			for _, c := range ctxs {
				if c == newName {
					return fmt.Errorf("context %q already exists", newName)
				}
			}
			// Get context details: cluster, user, namespace
			out, err := a.captureKubectl([]string{"config", "view", "-o", "json"})
			if err != nil {
				return fmt.Errorf("failed to read kubeconfig: %w", err)
			}
			var view struct {
				Contexts []kubeContextEntry `json:"contexts"`
			}
			if err := json.Unmarshal([]byte(out), &view); err != nil {
				return fmt.Errorf("failed to parse kubeconfig: %w", err)
			}
			var cluster, user, namespace string
			for _, e := range view.Contexts {
				if e.Name == oldName {
					cluster = strings.TrimSpace(e.Context.Cluster)
					user = strings.TrimSpace(e.Context.User)
					namespace = strings.TrimSpace(e.Context.Namespace)
					break
				}
			}
			if cluster == "" || user == "" {
				return fmt.Errorf("context %q has no cluster or user (invalid kubeconfig entry)", oldName)
			}
			// set-context newName --cluster=... --user=...
			setArgs := []string{"config", "set-context", newName, "--cluster=" + cluster, "--user=" + user}
			if namespace != "" {
				setArgs = append(setArgs, "--namespace="+namespace)
			}
			if err := a.runKubectl(setArgs); err != nil {
				return fmt.Errorf("failed to create renamed context: %w", err)
			}
			if err := a.runKubectl([]string{"config", "delete-context", oldName}); err != nil {
				return fmt.Errorf("failed to remove old context: %w", err)
			}
			current, _ := currentContext(a)
			if current == oldName {
				if err := a.runKubectl([]string{"config", "use-context", newName}); err != nil {
					return fmt.Errorf("renamed context but failed to switch current: %w", err)
				}
				s, _ := state.Load()
				if s != nil {
					s.MarkContextSwitched(oldName, newName)
					_ = state.Save(s)
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Renamed context %q to %q and switched to %q\n", oldName, newName, newName)
			} else {
				// Update state: rename in favorites and recent
				s, err := state.Load()
				if err != nil {
					fmt.Fprintf(cmd.OutOrStdout(), "Renamed context %q to %q\n", oldName, newName)
					return nil
				}
				// Replace old with new in favorites
				for i, f := range s.Favorites {
					if f == oldName {
						s.Favorites[i] = newName
						break
					}
				}
				if s.LastContext == oldName {
					s.LastContext = newName
				}
				if s.RecentContexts != nil {
					for i, c := range s.RecentContexts {
						if c == oldName {
							s.RecentContexts[i] = newName
							break
						}
					}
				}
				if s.ContextGroups != nil {
					for g, members := range s.ContextGroups {
						for i, m := range members {
							if m == oldName {
								s.ContextGroups[g][i] = newName
							}
						}
					}
				}
				_ = state.Save(s)
				fmt.Fprintf(cmd.OutOrStdout(), "Renamed context %q to %q\n", oldName, newName)
			}
			return nil
		},
	}
}

func newContextGroupCmd(a *app) *cobra.Command {
	groupCmd := &cobra.Command{
		Use:   "group [name]",
		Short: "Manage named context groups for multi-cluster workflows",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := state.Load()
			if err != nil {
				return err
			}
			if len(args) == 0 {
				return printContextGroups(cmd, s)
			}
			name := strings.TrimSpace(args[0])
			if name == "" {
				return fmt.Errorf("group name is required")
			}
			if s.ContextGroups == nil {
				s.ContextGroups = map[string][]string{}
			}
			members, ok := s.ContextGroups[name]
			if !ok {
				return fmt.Errorf("context group %q not found", name)
			}
			s.SetActiveContextGroup(name)
			if err := state.Save(s); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Active group: %s (%d contexts)\n", name, len(members))
			for _, c := range members {
				fmt.Fprintf(cmd.OutOrStdout(), "  - %s\n", c)
			}
			return nil
		},
	}

	groupCmd.AddCommand(
		&cobra.Command{
			Use:   "set <name> <context...>",
			Short: "Create/replace a context group",
			Args:  cobra.MinimumNArgs(2),
			RunE: func(cmd *cobra.Command, args []string) error {
				s, err := state.Load()
				if err != nil {
					return err
				}
				name := strings.TrimSpace(args[0])
				valid, missing, err := validateContextsExist(a, args[1:])
				if err != nil {
					return err
				}
				if len(missing) > 0 {
					return fmt.Errorf("unknown contexts: %s", strings.Join(missing, ", "))
				}
				s.SetContextGroup(name, valid)
				if _, ok := s.ContextGroups[name]; !ok {
					return fmt.Errorf("group name is required")
				}
				if err := state.Save(s); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Set group %q with %d contexts\n", name, len(s.ContextGroups[name]))
				return nil
			},
		},
		&cobra.Command{
			Use:   "add <name> <context...>",
			Short: "Add contexts to a group",
			Args:  cobra.MinimumNArgs(2),
			RunE: func(cmd *cobra.Command, args []string) error {
				s, err := state.Load()
				if err != nil {
					return err
				}
				name := strings.TrimSpace(args[0])
				valid, missing, err := validateContextsExist(a, args[1:])
				if err != nil {
					return err
				}
				if len(missing) > 0 {
					return fmt.Errorf("unknown contexts: %s", strings.Join(missing, ", "))
				}
				s.AddContextGroupMembers(name, valid)
				if _, ok := s.ContextGroups[name]; !ok {
					return fmt.Errorf("group name is required")
				}
				if err := state.Save(s); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Group %q now has %d contexts\n", name, len(s.ContextGroups[name]))
				return nil
			},
		},
		&cobra.Command{
			Use:   "rm <name> [context...]",
			Short: "Remove contexts from group or delete group",
			Args:  cobra.MinimumNArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				s, err := state.Load()
				if err != nil {
					return err
				}
				name := strings.TrimSpace(args[0])
				if s.ContextGroups == nil {
					return fmt.Errorf("context group %q not found", name)
				}
				if _, ok := s.ContextGroups[name]; !ok {
					return fmt.Errorf("context group %q not found", name)
				}
				s.RemoveContextGroupMembers(name, args[1:])
				if err := state.Save(s); err != nil {
					return err
				}
				if s.ContextGroups == nil {
					fmt.Fprintf(cmd.OutOrStdout(), "Deleted group %q\n", name)
					return nil
				}
				if members, ok := s.ContextGroups[name]; ok {
					fmt.Fprintf(cmd.OutOrStdout(), "Group %q now has %d contexts\n", name, len(members))
				} else {
					fmt.Fprintf(cmd.OutOrStdout(), "Deleted group %q\n", name)
				}
				return nil
			},
		},
		newContextGroupExportCmd(),
		newContextGroupImportCmd(a),
		&cobra.Command{
			Use:   "ls",
			Short: "List all context groups",
			RunE: func(cmd *cobra.Command, _ []string) error {
				s, err := state.Load()
				if err != nil {
					return err
				}
				return printContextGroups(cmd, s)
			},
		},
	)

	return groupCmd
}

func newContextGroupExportCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "export <path|->",
		Short: "Export context groups as JSON",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := state.Load()
			if err != nil {
				return err
			}
			payload := map[string]interface{}{
				"activeGroup": s.ActiveContextGroup,
				"groups":      s.ContextGroups,
			}
			b, err := json.MarshalIndent(payload, "", "  ")
			if err != nil {
				return err
			}
			target := strings.TrimSpace(args[0])
			if target == "-" {
				fmt.Fprintln(cmd.OutOrStdout(), string(b))
				return nil
			}
			if err := os.WriteFile(target, b, 0o600); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Exported context groups to %s\n", target)
			return nil
		},
	}
}

func newContextGroupImportCmd(a *app) *cobra.Command {
	var merge bool
	var allowMissing bool
	cmd := &cobra.Command{
		Use:   "import <path>",
		Short: "Import context groups from JSON",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			b, err := os.ReadFile(strings.TrimSpace(args[0]))
			if err != nil {
				return err
			}
			active, incoming, err := decodeContextGroupPayload(b)
			if err != nil {
				return err
			}
			knownSet, err := contextSet(a)
			if err != nil {
				return err
			}

			validated := map[string][]string{}
			for name, members := range incoming {
				valid := make([]string, 0, len(members))
				missing := make([]string, 0)
				for _, m := range members {
					m = strings.TrimSpace(m)
					if m == "" {
						continue
					}
					if _, ok := knownSet[m]; ok || allowMissing {
						valid = append(valid, m)
					} else {
						missing = append(missing, m)
					}
				}
				if len(missing) > 0 {
					return fmt.Errorf("group %q has unknown contexts: %s", name, strings.Join(missing, ", "))
				}
				if len(valid) > 0 {
					validated[name] = valid
				}
			}

			s, err := state.Load()
			if err != nil {
				return err
			}
			if !merge || s.ContextGroups == nil {
				s.ContextGroups = map[string][]string{}
			}
			for name, members := range validated {
				if merge {
					s.AddContextGroupMembers(name, members)
				} else {
					s.SetContextGroup(name, members)
				}
			}
			if active != "" {
				s.SetActiveContextGroup(active)
			}
			if err := state.Save(s); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Imported %d context groups\n", len(validated))
			return nil
		},
	}
	cmd.Flags().BoolVar(&merge, "merge", true, "merge with existing groups (false replaces all groups)")
	cmd.Flags().BoolVar(&allowMissing, "allow-missing", false, "allow contexts not currently in kubeconfig")
	return cmd
}

func validateContextsExist(a *app, contexts []string) (valid []string, missing []string, err error) {
	knownSet, err := contextSet(a)
	if err != nil {
		return nil, nil, err
	}
	seen := map[string]struct{}{}
	for _, c := range contexts {
		c = strings.TrimSpace(c)
		if c == "" {
			continue
		}
		if _, ok := seen[c]; ok {
			continue
		}
		seen[c] = struct{}{}
		if _, ok := knownSet[c]; ok {
			valid = append(valid, c)
		} else {
			missing = append(missing, c)
		}
	}
	return valid, missing, nil
}

func contextSet(a *app) (map[string]struct{}, error) {
	ctxs, err := listContexts(a)
	if err != nil {
		return nil, err
	}
	out := make(map[string]struct{}, len(ctxs))
	for _, c := range ctxs {
		out[c] = struct{}{}
	}
	return out, nil
}

func decodeContextGroupPayload(b []byte) (active string, groups map[string][]string, err error) {
	var withMeta struct {
		ActiveGroup string              `json:"activeGroup"`
		Groups      map[string][]string `json:"groups"`
	}
	if err = json.Unmarshal(b, &withMeta); err == nil && withMeta.Groups != nil {
		return strings.TrimSpace(withMeta.ActiveGroup), withMeta.Groups, nil
	}
	var plain map[string][]string
	if err = json.Unmarshal(b, &plain); err == nil && plain != nil {
		return "", plain, nil
	}
	return "", nil, fmt.Errorf("invalid context group payload")
}

func printContextGroups(cmd *cobra.Command, s *state.Store) error {
	if s.ContextGroups == nil || len(s.ContextGroups) == 0 {
		fmt.Fprintln(cmd.OutOrStdout(), "No context groups configured.")
		return nil
	}
	names := make([]string, 0, len(s.ContextGroups))
	for name := range s.ContextGroups {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		marker := " "
		if name == s.ActiveContextGroup {
			marker = "*"
		}
		members := s.ContextGroups[name]
		fmt.Fprintf(cmd.OutOrStdout(), "%s %s (%d)\n", marker, name, len(members))
	}
	return nil
}

func printContexts(a *app, s *state.Store, onlyFavorites bool) error {
	ctxs, err := listContexts(a)
	if err != nil {
		return err
	}
	current, _ := currentContext(a)
	favorites := make(map[string]struct{}, len(s.Favorites))
	for _, v := range s.Favorites {
		favorites[v] = struct{}{}
	}
	sort.Strings(ctxs)
	for _, c := range ctxs {
		if onlyFavorites {
			if _, ok := favorites[c]; !ok {
				continue
			}
		}
		prefix := "  "
		if c == current {
			prefix = "* "
		}
		fav := ""
		if _, ok := favorites[c]; ok {
			fav = " [fav]"
		}
		fmt.Printf("%s%s%s\n", prefix, c, fav)
	}
	return nil
}

func pickContextInteractive(a *app, s *state.Store, onlyFavorites bool, cmd *cobra.Command) error {
	if !isTerminalSession() {
		return fmt.Errorf("--pick requires an interactive terminal")
	}
	ctxs, err := listContexts(a)
	if err != nil {
		return err
	}
	current, _ := currentContext(a)
	favorites := make(map[string]struct{}, len(s.Favorites))
	for _, v := range s.Favorites {
		favorites[v] = struct{}{}
	}
	sort.Strings(ctxs)
	candidates := make([]string, 0, len(ctxs))
	for _, c := range ctxs {
		if onlyFavorites {
			if _, ok := favorites[c]; !ok {
				continue
			}
		}
		candidates = append(candidates, c)
	}
	if len(candidates) == 0 {
		return fmt.Errorf("no contexts available")
	}

	reader := bufio.NewReader(os.Stdin)
	fmt.Fprint(cmd.OutOrStdout(), "Filter context (substring, empty=all): ")
	queryRaw, _ := reader.ReadString('\n')
	query := strings.ToLower(strings.TrimSpace(queryRaw))
	filtered := make([]string, 0, len(candidates))
	for _, c := range candidates {
		if query == "" || strings.Contains(strings.ToLower(c), query) {
			filtered = append(filtered, c)
		}
	}
	if len(filtered) == 0 {
		return fmt.Errorf("no contexts match %q", query)
	}
	if len(filtered) == 1 {
		target := filtered[0]
		if err := a.runKubectl([]string{"config", "use-context", target}); err != nil {
			return err
		}
		s.MarkContextSwitched(current, target)
		if err := state.Save(s); err != nil {
			return err
		}
		fmt.Fprintf(cmd.OutOrStdout(), "Switched to context %q\n", target)
		return nil
	}
	fmt.Fprintln(cmd.OutOrStdout(), "Select context:")
	for i, c := range filtered {
		marker := " "
		if c == current {
			marker = "*"
		}
		fmt.Fprintf(cmd.OutOrStdout(), "  %d) %s %s\n", i+1, marker, c)
	}
	fmt.Fprint(cmd.OutOrStdout(), "Choice [1-", len(filtered), "]: ")
	choiceRaw, _ := reader.ReadString('\n')
	choiceRaw = strings.TrimSpace(choiceRaw)
	n, err := strconv.Atoi(choiceRaw)
	if err != nil || n < 1 || n > len(filtered) {
		return fmt.Errorf("invalid selection %q", choiceRaw)
	}
	target := filtered[n-1]
	if err := a.runKubectl([]string{"config", "use-context", target}); err != nil {
		return err
	}
	s.MarkContextSwitched(current, target)
	if err := state.Save(s); err != nil {
		return err
	}
	fmt.Fprintf(cmd.OutOrStdout(), "Switched to context %q\n", target)
	return nil
}

func isTerminalSession() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}

func listContexts(a *app) ([]string, error) {
	return k8sclient.ListContexts(a.kubeconfig)
}

func currentContext(a *app) (string, error) {
	if strings.TrimSpace(a.context) != "" {
		return strings.TrimSpace(a.context), nil
	}
	return k8sclient.CurrentContext(a.kubeconfig)
}

// ─── kcli ctx alias ───────────────────────────────────────────────────────────

func newContextAliasCmd(_ *app) *cobra.Command {
	aliasCmd := &cobra.Command{
		Use:   "alias",
		Short: "Manage context aliases (short names for long context names)",
		Example: `  kcli ctx alias add prod arn:aws:eks:us-east-1:123456789:cluster/production
  kcli ctx alias ls
  kcli ctx alias rm prod`,
	}

	aliasCmd.AddCommand(
		&cobra.Command{
			Use:   "add <alias> <context>",
			Short: "Create an alias for a context name",
			Args:  cobra.ExactArgs(2),
			RunE: func(cmd *cobra.Command, args []string) error {
				alias := strings.TrimSpace(args[0])
				ctx := strings.TrimSpace(args[1])
				if alias == "" || ctx == "" {
					return fmt.Errorf("alias and context name are required")
				}
				s, err := state.Load()
				if err != nil {
					return err
				}
				s.SetContextAlias(alias, ctx)
				if err := state.Save(s); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Alias %q → %q saved\n", alias, ctx)
				return nil
			},
		},
		&cobra.Command{
			Use:   "rm <alias>",
			Short: "Remove a context alias",
			Args:  cobra.ExactArgs(1),
			RunE: func(cmd *cobra.Command, args []string) error {
				alias := strings.TrimSpace(args[0])
				s, err := state.Load()
				if err != nil {
					return err
				}
				s.RemoveContextAlias(alias)
				if err := state.Save(s); err != nil {
					return err
				}
				fmt.Fprintf(cmd.OutOrStdout(), "Alias %q removed\n", alias)
				return nil
			},
		},
		&cobra.Command{
			Use:   "ls",
			Short: "List all context aliases",
			RunE: func(cmd *cobra.Command, _ []string) error {
				s, err := state.Load()
				if err != nil {
					return err
				}
				if len(s.ContextAliases) == 0 {
					fmt.Fprintln(cmd.OutOrStdout(), "No context aliases configured.")
					return nil
				}
				aliases := make([]string, 0, len(s.ContextAliases))
				for k := range s.ContextAliases {
					aliases = append(aliases, k)
				}
				sort.Strings(aliases)
				fmt.Fprintf(cmd.OutOrStdout(), "%-20s %s\n", "ALIAS", "CONTEXT")
				fmt.Fprintf(cmd.OutOrStdout(), "%s\n", strings.Repeat("─", 60))
				for _, alias := range aliases {
					fmt.Fprintf(cmd.OutOrStdout(), "%-20s %s\n", alias, s.ContextAliases[alias])
				}
				return nil
			},
		},
	)

	return aliasCmd
}
