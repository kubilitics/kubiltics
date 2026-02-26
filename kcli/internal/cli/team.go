package cli

// team.go — kcli team command group.
//
// Team collaboration features: shared context library and team coordination.
// Stores shared contexts as exportable JSON that team members can sync.
//
// Commands:
//   kcli team ctx list          — list shared contexts
//   kcli team ctx push <name>   — export your context to a shared file
//   kcli team ctx pull <name>   — import a team context
//   kcli team ctx lock <name>   — mark context as locked (read-only reminder)
//   kcli team whoami            — show current user identity

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

// ─── Team context types ───────────────────────────────────────────────────────

type teamContext struct {
	Name      string `json:"name"`
	SharedBy  string `json:"shared_by"`
	SharedAt  string `json:"shared_at"`
	Server    string `json:"server"`
	Namespace string `json:"namespace"`
	Locked    bool   `json:"locked"`
	Notes     string `json:"notes"`
}

type teamContextStore struct {
	Contexts []teamContext `json:"contexts"`
}

// ─── Team store ───────────────────────────────────────────────────────────────

func teamStorePath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".kcli", "team.json")
}

func loadTeamStore() (*teamContextStore, error) {
	path := teamStorePath()
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &teamContextStore{}, nil
		}
		return nil, err
	}
	var s teamContextStore
	if err := json.Unmarshal(b, &s); err != nil {
		return &teamContextStore{}, nil
	}
	return &s, nil
}

func saveTeamStore(s *teamContextStore) error {
	path := teamStorePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

// ─── newTeamCmd ───────────────────────────────────────────────────────────────

func newTeamCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "team",
		Short: "Team collaboration — shared contexts and coordination",
		Long: `kcli team provides shared context management for engineering teams.

Share kubeconfig contexts with your team via a central file or
by exporting/importing context definitions.

For production teams, use a shared file path (NFS/S3/git-tracked) or
the Kubilitics platform for real-time context sync.`,
		GroupID: "workflow",
		RunE: func(cmd *cobra.Command, args []string) error {
			return cmd.Help()
		},
	}

	// kcli team ctx
	ctxCmd := &cobra.Command{
		Use:   "ctx",
		Short: "Manage shared team contexts",
		RunE: func(cmd *cobra.Command, args []string) error {
			return newTeamCtxListCmd(a).RunE(cmd, args)
		},
	}
	ctxCmd.AddCommand(
		newTeamCtxListCmd(a),
		newTeamCtxPushCmd(a),
		newTeamCtxPullCmd(a),
		newTeamCtxLockCmd(a),
		newTeamCtxExportCmd(a),
	)

	// kcli team whoami
	whoami := &cobra.Command{
		Use:   "whoami",
		Short: "Show current user identity and cluster access",
		RunE: func(cmd *cobra.Command, args []string) error {
			user := currentUser()
			ctx, _ := currentContext(a)
			ns, _ := currentNamespace(a)

			fmt.Fprintf(a.stdout, "\n%s%s Identity%s\n\n", ansiBold, ansiCyan, ansiReset)
			fmt.Fprintf(a.stdout, "  %sUser:%s      %s\n", ansiGray, ansiReset, user)
			fmt.Fprintf(a.stdout, "  %sContext:%s   %s\n", ansiGray, ansiReset, ctx)
			fmt.Fprintf(a.stdout, "  %sNamespace:%s %s\n\n", ansiGray, ansiReset, ns)

			// Show kubectl auth whoami if available
			out, err := a.captureKubectl([]string{"auth", "whoami", "--output=json"})
			if err == nil && out != "" {
				var whoamiResp struct {
					Status struct {
						UserInfo struct {
							Username string   `json:"username"`
							Groups   []string `json:"groups"`
						} `json:"userInfo"`
					} `json:"status"`
				}
				if json.Unmarshal([]byte(out), &whoamiResp) == nil {
					ui := whoamiResp.Status.UserInfo
					if ui.Username != "" {
						fmt.Fprintf(a.stdout, "  %sK8s Username:%s %s\n", ansiGray, ansiReset, ui.Username)
					}
					if len(ui.Groups) > 0 {
						fmt.Fprintf(a.stdout, "  %sGroups:%s %s\n\n", ansiGray, ansiReset, strings.Join(ui.Groups, ", "))
					}
				}
			}
			return nil
		},
	}

	cmd.AddCommand(ctxCmd, whoami)
	return cmd
}

// ─── kcli team ctx list ───────────────────────────────────────────────────────

func newTeamCtxListCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:     "list",
		Short:   "List shared team contexts",
		Aliases: []string{"ls"},
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := loadTeamStore()
			if err != nil {
				return err
			}

			fmt.Fprintf(a.stdout, "\n%s%s Shared Team Contexts%s\n\n", ansiBold, ansiCyan, ansiReset)

			if len(s.Contexts) == 0 {
				fmt.Fprintf(a.stdout, "%sNo shared contexts yet.%s\n\n", ansiGray, ansiReset)
				fmt.Fprintf(a.stdout, "Share your current context:\n")
				fmt.Fprintf(a.stdout, "  kcli team ctx push <context-name>\n\n")
				return nil
			}

			fmt.Fprintf(a.stdout, "%s%-30s %-20s %-20s %-10s %s%s\n",
				ansiBold, "CONTEXT", "SHARED BY", "SHARED AT", "LOCKED", "NOTES", ansiReset)
			fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 90))
			for _, c := range s.Contexts {
				lockedStr := ""
				if c.Locked {
					lockedStr = ansiYellow + "🔒 yes" + ansiReset
				}
				fmt.Fprintf(a.stdout, "%-30s %-20s %-20s %-10s %s\n",
					c.Name, c.SharedBy, c.SharedAt[:10], lockedStr,
					ansiGray+truncate(c.Notes, 30)+ansiReset,
				)
			}
			fmt.Fprintln(a.stdout)
			return nil
		},
	}
}

// ─── kcli team ctx push ───────────────────────────────────────────────────────

func newTeamCtxPushCmd(a *app) *cobra.Command {
	var notes string
	cmd := &cobra.Command{
		Use:   "push <context-name>",
		Short: "Share a context with your team",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			var ctxName string
			if len(args) > 0 {
				ctxName = args[0]
			} else {
				var err error
				ctxName, err = currentContext(a)
				if err != nil {
					return err
				}
			}

			s, err := loadTeamStore()
			if err != nil {
				return err
			}

			// Get context server info
			out, _ := a.captureKubectl([]string{"config", "view", "-o",
				fmt.Sprintf("jsonpath={.clusters[?(@.name==\"%s\")].cluster.server}", ctxName)})
			server := strings.TrimSpace(out)

			ns, _ := currentNamespace(a)

			// Check if already exists
			for i, c := range s.Contexts {
				if c.Name == ctxName {
					s.Contexts[i].SharedBy = currentUser()
					s.Contexts[i].SharedAt = time.Now().Format(time.RFC3339)
					s.Contexts[i].Server = server
					s.Contexts[i].Namespace = ns
					s.Contexts[i].Notes = notes
					if err := saveTeamStore(s); err != nil {
						return err
					}
					fmt.Fprintf(a.stdout, "%s✓ Updated shared context: %s%s\n\n", ansiGreen, ctxName, ansiReset)
					return nil
				}
			}

			s.Contexts = append(s.Contexts, teamContext{
				Name:      ctxName,
				SharedBy:  currentUser(),
				SharedAt:  time.Now().Format(time.RFC3339),
				Server:    server,
				Namespace: ns,
				Notes:     notes,
			})

			if err := saveTeamStore(s); err != nil {
				return err
			}

			fmt.Fprintf(a.stdout, "%s✓ Shared context: %s%s\n", ansiGreen, ctxName, ansiReset)
			if server != "" {
				fmt.Fprintf(a.stdout, "  %sServer: %s%s\n", ansiGray, server, ansiReset)
			}
			fmt.Fprintf(a.stdout, "\n%sTip: Export team contexts with: kcli team ctx export > team-contexts.json%s\n\n",
				ansiGray, ansiReset)
			return nil
		},
	}
	cmd.Flags().StringVar(&notes, "notes", "", "Notes about this context")
	return cmd
}

// ─── kcli team ctx pull ───────────────────────────────────────────────────────

func newTeamCtxPullCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "pull <context-name>",
		Short: "Switch to a shared team context",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			s, err := loadTeamStore()
			if err != nil {
				return err
			}
			for _, c := range s.Contexts {
				if c.Name == name {
					if c.Locked {
						fmt.Fprintf(a.stdout, "%s⚠ Context '%s' is locked — switching anyway.%s\n", ansiYellow, name, ansiReset)
					}
					// Switch to the context
					if err := a.runKubectl([]string{"config", "use-context", name}); err != nil {
						return fmt.Errorf("context '%s' not in local kubeconfig: %w\nRun: kubectl config set-context %s --cluster=<cluster> --user=<user>",
							name, err, name)
					}
					fmt.Fprintf(a.stdout, "%s✓ Switched to team context: %s%s\n\n", ansiGreen, name, ansiReset)
					return nil
				}
			}
			return fmt.Errorf("shared context '%s' not found — run: kcli team ctx list", name)
		},
	}
}

// ─── kcli team ctx lock ───────────────────────────────────────────────────────

func newTeamCtxLockCmd(a *app) *cobra.Command {
	unlock := false
	cmd := &cobra.Command{
		Use:   "lock <context-name>",
		Short: "Mark a shared context as locked (prevents accidental edits)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			name := args[0]
			s, err := loadTeamStore()
			if err != nil {
				return err
			}
			for i, c := range s.Contexts {
				if c.Name == name {
					s.Contexts[i].Locked = !unlock
					if err := saveTeamStore(s); err != nil {
						return err
					}
					action := "Locked"
					if unlock {
						action = "Unlocked"
					}
					fmt.Fprintf(a.stdout, "%s✓ %s context: %s%s\n\n", ansiGreen, action, name, ansiReset)
					return nil
				}
			}
			return fmt.Errorf("shared context '%s' not found", name)
		},
	}
	cmd.Flags().BoolVar(&unlock, "unlock", false, "Unlock the context instead of locking it")
	return cmd
}

// ─── kcli team ctx export ─────────────────────────────────────────────────────

func newTeamCtxExportCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "export",
		Short: "Export shared contexts as JSON (for team sharing)",
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := loadTeamStore()
			if err != nil {
				return err
			}
			b, err := json.MarshalIndent(s, "", "  ")
			if err != nil {
				return err
			}
			fmt.Fprintln(a.stdout, string(b))
			return nil
		},
	}
}
