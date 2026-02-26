package cli

// autoheal.go — kcli autoheal command group.
//
// Self-healing automation with configurable safety policies.
// Applies AI-generated fixes automatically within defined safety boundaries.
//
// Commands:
//   kcli autoheal status           — show autoheal status and active watches
//   kcli autoheal policy list      — list healing policies
//   kcli autoheal policy set       — set policy for a namespace
//   kcli autoheal history          — what was auto-healed recently
//   kcli fix <resource> --auto-apply — apply AI fix automatically

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

// ─── Autoheal types ───────────────────────────────────────────────────────────

type autohealPolicy struct {
	Namespace string `json:"namespace"`
	Level     string `json:"level"` // disabled, conservative, moderate, aggressive
	UpdatedAt string `json:"updated_at"`
}

type autohealEvent struct {
	Timestamp string `json:"timestamp"`
	Resource  string `json:"resource"`
	Namespace string `json:"namespace"`
	Action    string `json:"action"`
	Result    string `json:"result"`
	SafetyLevel string `json:"safety_level"`
}

type autohealStore struct {
	Policies []autohealPolicy `json:"policies"`
	History  []autohealEvent  `json:"history"`
}

// ─── Autoheal store path ──────────────────────────────────────────────────────

func autohealStorePath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".kcli", "autoheal.json")
}

func loadAutohealStore() (*autohealStore, error) {
	path := autohealStorePath()
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &autohealStore{}, nil
		}
		return nil, err
	}
	var s autohealStore
	if err := json.Unmarshal(b, &s); err != nil {
		return &autohealStore{}, nil
	}
	return &s, nil
}

func saveAutohealStore(s *autohealStore) error {
	path := autohealStorePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

func (s *autohealStore) getPolicyLevel(namespace string) string {
	for _, p := range s.Policies {
		if p.Namespace == namespace || p.Namespace == "*" {
			return p.Level
		}
	}
	return "disabled" // default: disabled everywhere
}

func (s *autohealStore) setPolicy(namespace, level string) {
	for i, p := range s.Policies {
		if p.Namespace == namespace {
			s.Policies[i].Level = level
			s.Policies[i].UpdatedAt = time.Now().Format(time.RFC3339)
			return
		}
	}
	s.Policies = append(s.Policies, autohealPolicy{
		Namespace: namespace,
		Level:     level,
		UpdatedAt: time.Now().Format(time.RFC3339),
	})
}

func (s *autohealStore) addEvent(e autohealEvent) {
	e.Timestamp = time.Now().Format(time.RFC3339)
	s.History = append([]autohealEvent{e}, s.History...)
	// Keep last 1000 events
	if len(s.History) > 1000 {
		s.History = s.History[:1000]
	}
}

// ─── Safety level descriptions ────────────────────────────────────────────────

var safetyLevelDescriptions = map[string]string{
	"disabled":     "No automatic fixes applied. AI suggestions only.",
	"conservative": "Only applies fixes to non-production namespaces. Never deletes pods.",
	"moderate":     "Applies fixes to staging and dev. May restart pods. Skips production.",
	"aggressive":   "Applies fixes anywhere including production. Use with caution.",
}

// ─── newAutohealCmd ───────────────────────────────────────────────────────────

func newAutohealCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "autoheal",
		Short: "Self-healing automation with configurable safety policies",
		Long: `kcli autoheal configures automatic remediation policies for your cluster.

When kcli fix detects a fixable issue, autoheal policies determine whether
it applies the fix automatically or just shows the suggestion.

Safety levels:
  disabled     — suggestions only (default for all namespaces)
  conservative — auto-fix dev/staging only
  moderate     — auto-fix staging, may restart pods
  aggressive   — auto-fix anywhere (requires explicit configuration)

Production namespaces are NEVER auto-healed without explicit policy.`,
		GroupID: "incident",
		RunE: func(cmd *cobra.Command, args []string) error {
			return newAutohealStatusCmd(a).RunE(cmd, args)
		},
	}

	policy := &cobra.Command{
		Use:   "policy",
		Short: "Manage autoheal policies",
	}

	// policy list
	policyList := &cobra.Command{
		Use:   "list",
		Short: "List autoheal policies",
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := loadAutohealStore()
			if err != nil {
				return err
			}

			fmt.Fprintf(a.stdout, "\n%s%s Autoheal Policies%s\n\n", ansiBold, ansiCyan, ansiReset)

			if len(s.Policies) == 0 {
				fmt.Fprintf(a.stdout, "%sNo autoheal policies configured.%s\n", ansiGray, ansiReset)
				fmt.Fprintf(a.stdout, "%sDefault: disabled (suggestions only).%s\n\n", ansiGray, ansiReset)
				fmt.Fprintf(a.stdout, "Set a policy:\n")
				fmt.Fprintf(a.stdout, "  kcli autoheal policy set --namespace staging --level conservative\n\n")
				return nil
			}

			fmt.Fprintf(a.stdout, "%s%-30s %-15s %-20s %s%s\n",
				ansiBold, "NAMESPACE", "LEVEL", "UPDATED", "DESCRIPTION", ansiReset)
			fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 85))
			for _, p := range s.Policies {
				levelColor := ansiGreen
				switch p.Level {
				case "aggressive":
					levelColor = ansiRed
				case "moderate":
					levelColor = ansiYellow
				case "disabled":
					levelColor = ansiGray
				}
				fmt.Fprintf(a.stdout, "%-30s %s%-15s%s %-20s %s\n",
					p.Namespace,
					levelColor, p.Level, ansiReset,
					p.UpdatedAt,
					ansiGray+safetyLevelDescriptions[p.Level]+ansiReset,
				)
			}
			fmt.Fprintln(a.stdout)
			return nil
		},
	}

	// policy set
	var setNamespace string
	var setLevel string
	policySet := &cobra.Command{
		Use:   "set",
		Short: "Set autoheal policy for a namespace",
		Example: `  kcli autoheal policy set --namespace staging --level conservative
  kcli autoheal policy set --namespace production --level disabled
  kcli autoheal policy set --namespace '*' --level conservative  # all namespaces`,
		RunE: func(cmd *cobra.Command, args []string) error {
			ns := setNamespace
			if ns == "" {
				ns = a.namespace
			}
			if ns == "" {
				return fmt.Errorf("--namespace is required")
			}

			validLevels := map[string]bool{
				"disabled": true, "conservative": true, "moderate": true, "aggressive": true,
			}
			if !validLevels[setLevel] {
				return fmt.Errorf("invalid level %q — must be: disabled, conservative, moderate, aggressive", setLevel)
			}

			// Safety guard: production namespaces need explicit confirmation
			isProduction := strings.Contains(ns, "prod") || strings.Contains(ns, "production")
			if isProduction && (setLevel == "moderate" || setLevel == "aggressive") && !a.force {
				fmt.Fprintf(a.stderr, "%s⚠ Setting autoheal to '%s' in namespace '%s' will allow automatic changes in production!%s\n",
					ansiRed, setLevel, ns, ansiReset)
				fmt.Fprintf(a.stderr, "Use --force to confirm this intentional choice.\n")
				return fmt.Errorf("use --force to set aggressive/moderate autoheal in production namespaces")
			}

			s, err := loadAutohealStore()
			if err != nil {
				return err
			}
			s.setPolicy(ns, setLevel)
			if err := saveAutohealStore(s); err != nil {
				return err
			}

			levelColor := ansiGreen
			if setLevel == "aggressive" {
				levelColor = ansiRed
			} else if setLevel == "moderate" {
				levelColor = ansiYellow
			} else if setLevel == "disabled" {
				levelColor = ansiGray
			}

			fmt.Fprintf(a.stdout, "%s✓ Autoheal policy set for %s: %s%s%s%s\n",
				ansiGreen, ns, levelColor, setLevel, ansiReset, "")
			fmt.Fprintf(a.stdout, "  %s%s%s\n\n", ansiGray, safetyLevelDescriptions[setLevel], ansiReset)
			return nil
		},
	}
	policySet.Flags().StringVar(&setNamespace, "namespace", "", "Namespace to set policy for (* for all)")
	policySet.Flags().StringVar(&setLevel, "level", "conservative", "Policy level (disabled|conservative|moderate|aggressive)")

	// policy delete
	policyDelete := &cobra.Command{
		Use:   "delete <namespace>",
		Short: "Remove autoheal policy for a namespace",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ns := args[0]
			s, err := loadAutohealStore()
			if err != nil {
				return err
			}
			newPolicies := make([]autohealPolicy, 0, len(s.Policies))
			found := false
			for _, p := range s.Policies {
				if p.Namespace == ns {
					found = true
					continue
				}
				newPolicies = append(newPolicies, p)
			}
			if !found {
				return fmt.Errorf("no policy found for namespace %q", ns)
			}
			s.Policies = newPolicies
			if err := saveAutohealStore(s); err != nil {
				return err
			}
			fmt.Fprintf(a.stdout, "%s✓ Removed autoheal policy for %s%s\n\n", ansiGreen, ns, ansiReset)
			return nil
		},
	}

	policy.AddCommand(policyList, policySet, policyDelete)

	// history
	var histLast string
	history := &cobra.Command{
		Use:   "history",
		Short: "Show autoheal action history",
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := loadAutohealStore()
			if err != nil {
				return err
			}

			fmt.Fprintf(a.stdout, "\n%s%s Autoheal History%s\n\n", ansiBold, ansiCyan, ansiReset)

			if len(s.History) == 0 {
				fmt.Fprintf(a.stdout, "%sNo autoheal events recorded.%s\n\n", ansiGray, ansiReset)
				return nil
			}

			// Parse --last duration
			var cutoff time.Time
			if histLast != "" {
				dur, err := time.ParseDuration(histLast)
				if err == nil {
					cutoff = time.Now().Add(-dur)
				}
			}

			count := 0
			for _, e := range s.History {
				if !cutoff.IsZero() {
					ts, err := time.Parse(time.RFC3339, e.Timestamp)
					if err == nil && ts.Before(cutoff) {
						continue
					}
				}
				resultColor := ansiGreen
				if e.Result != "success" {
					resultColor = ansiRed
				}
				fmt.Fprintf(a.stdout, "  %s%-20s%s %s → %s%s%s\n",
					ansiGray, e.Timestamp, ansiReset,
					e.Resource,
					resultColor, e.Result, ansiReset,
				)
				fmt.Fprintf(a.stdout, "             %sAction: %s  [%s]%s\n\n",
					ansiGray, e.Action, e.SafetyLevel, ansiReset)
				count++
				if count >= 50 {
					break
				}
			}
			return nil
		},
	}
	history.Flags().StringVar(&histLast, "last", "", "Show events from last duration (e.g. 24h, 7d)")

	cmd.AddCommand(newAutohealStatusCmd(a), policy, history)
	return cmd
}

func newAutohealStatusCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show autoheal system status and configured policies",
		RunE: func(cmd *cobra.Command, args []string) error {
			s, err := loadAutohealStore()
			if err != nil {
				return err
			}

			fmt.Fprintf(a.stdout, "\n%s%s Autoheal System Status%s\n\n", ansiBold, ansiCyan, ansiReset)

			if len(s.Policies) == 0 {
				fmt.Fprintf(a.stdout, "%sStatus: All namespaces — disabled (suggestions only)%s\n\n", ansiGray, ansiReset)
			} else {
				fmt.Fprintf(a.stdout, "%sActive policies: %d%s\n\n", ansiGray, len(s.Policies), ansiReset)
				for _, p := range s.Policies {
					fmt.Fprintf(a.stdout, "  %-30s → %s\n", p.Namespace, p.Level)
				}
				fmt.Fprintln(a.stdout)
			}

			// Recent history summary
			if len(s.History) > 0 {
				sort.Slice(s.History, func(i, j int) bool {
					return s.History[i].Timestamp > s.History[j].Timestamp
				})
				fmt.Fprintf(a.stdout, "%sRecent autoheal actions: %d%s\n", ansiGray, len(s.History), ansiReset)
				limit := 5
				if len(s.History) < limit {
					limit = len(s.History)
				}
				for _, e := range s.History[:limit] {
					fmt.Fprintf(a.stdout, "  %s %s → %s\n", e.Timestamp, e.Resource, e.Action)
				}
			}

			fmt.Fprintf(a.stdout, "\n%sConfigure: kcli autoheal policy set --namespace staging --level conservative%s\n\n",
				ansiGray, ansiReset)
			return nil
		},
	}
}
