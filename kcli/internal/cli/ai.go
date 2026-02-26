package cli

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/kubilitics/kcli/internal/ai"
	kcfg "github.com/kubilitics/kcli/internal/config"
	"github.com/kubilitics/kcli/internal/state"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

func newAICmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "ai [question]",
		Short: "AI-assisted analysis commands (optional)",
		Long:  "AI commands send to the configured provider: current context/namespace, target resource IDs, and for summarize: event messages. Secrets are redacted. Avoid PII in resource names or events. See 'kcli ai config' and ai.maxInputChars in ~/.kcli/config.yaml.",
		GroupID: "ai",
		Args:    cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				return cmd.Help()
			}
			return runAIAction(a, cmd, "query", strings.Join(args, " "))
		},
	}
	cmd.AddCommand(
		newAIActionCmd(a, "explain [resource]", "Explain a Kubernetes resource", "explain"),
		newAIActionCmd(a, "why [resource]", "Explain probable cause behind current state", "why"),
		newAISummarizeCmd(a),
		newAIActionCmd(a, "suggest-fix [resource]", "Suggest remediation for a workload", "suggest-fix"),
		newAIActionCmd(a, "fix [resource]", "Suggest remediation for a workload", "suggest-fix"),
		newAIWhatWouldBeSentCmd(a),
		newAIConfigCmd(a),
		newAIStatusCmd(a),
		newAIUsageCmd(),
		newAICostCmd(a),
		newAIPricingCmd(),
	)
	return cmd
}

// newAIWhatWouldBeSentCmd returns the 'kcli ai what-would-be-sent' command that
// shows the exact sanitized prompt that would be sent to the AI provider —
// without actually calling the provider.  Engineers use this to audit what
// data leaves their cluster before enabling AI features.
func newAIWhatWouldBeSentCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "what-would-be-sent [action] [resource]",
		Short: "Show the exact prompt that would be sent to the AI provider (audit tool)",
		Long: `Print the full sanitized prompt that would be sent to the AI provider
without making an API call.

Use this command to:
  - Audit what Kubernetes cluster data leaves your environment
  - Verify that sensitive values are being redacted correctly
  - Debug AI responses by reviewing the exact input
  - Compliance reviews for air-gapped or regulated environments

Sensitive values (API keys, tokens, PEM certificates, JWT tokens, etc.) are
redacted before sending. Content inside <k8s-resource-data> tags is marked
as untrusted data per the system prompt instruction.

Examples:

  # See what would be sent for a 'why' analysis
  kcli ai what-would-be-sent why pod/crashed-xyz

  # See the explain prompt for a Kubernetes field
  kcli ai what-would-be-sent explain "kubectl explain pod.spec.containers.resources\n\nFIELD: resources\nDESCRIPTION: Compute Resources required by this container."

  # See the query prompt
  kcli ai what-would-be-sent query "why are my pods OOMKilled?"`,
		Args: cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			action := "why"
			target := ""
			if len(args) >= 1 {
				action = strings.TrimSpace(args[0])
			}
			if len(args) >= 2 {
				target = strings.TrimSpace(strings.Join(args[1:], " "))
			}
			prompt := ai.BuildPrompt(ai.PromptRequest{
				Action: action,
				Target: target,
				Query:  target,
			})
			maxInputChars := 16384
			if a.cfg != nil && a.cfg.AI.MaxInputChars > 0 {
				maxInputChars = a.cfg.AI.MaxInputChars
			}
			fullPrompt := "System:\n" + prompt.System + "\n\nUser:\n" + prompt.User
			truncated := false
			if len(fullPrompt) > maxInputChars {
				fullPrompt = fullPrompt[:maxInputChars]
				truncated = true
			}
			fmt.Fprintf(cmd.OutOrStdout(), "═══════════════════════════════════════════════════════\n")
			fmt.Fprintf(cmd.OutOrStdout(), " kcli ai what-would-be-sent  (no API call made)\n")
			fmt.Fprintf(cmd.OutOrStdout(), " action: %s | target: %q\n", action, target)
			fmt.Fprintf(cmd.OutOrStdout(), " estimated tokens: %d | max input chars: %d\n", prompt.EstimatedTokens, maxInputChars)
			if truncated {
				fmt.Fprintf(cmd.OutOrStdout(), " ⚠  prompt would be TRUNCATED at %d chars\n", maxInputChars)
			}
			fmt.Fprintf(cmd.OutOrStdout(), "═══════════════════════════════════════════════════════\n\n")
			fmt.Fprintln(cmd.OutOrStdout(), fullPrompt)
			if truncated {
				fmt.Fprintf(cmd.OutOrStdout(), "\n[... truncated at %d chars ...]", maxInputChars)
			}
			return nil
		},
	}
}

func newWhyCmd(a *app) *cobra.Command {
	return newAIActionCmd(a, "why [resource]", "AI why-analysis for a resource", "why")
}

func newSummarizeCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{Use: "summarize", Short: "AI summarize commands", GroupID: "ai"}
	cmd.AddCommand(newSummarizeEventsCmd(a))
	return cmd
}

func newSuggestCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{Use: "suggest", Short: "AI suggestion commands", GroupID: "ai"}
	cmd.AddCommand(newAIActionCmd(a, "fix [resource]", "Suggest fix", "suggest-fix"))
	return cmd
}

func newFixCmd(a *app) *cobra.Command {
	return newAIActionCmd(a, "fix [resource]", "AI fix suggestions for a resource", "suggest-fix")
}

func newAISummarizeCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{Use: "summarize", Short: "AI summarize commands"}
	cmd.AddCommand(newSummarizeEventsCmd(a))
	return cmd
}

func newSummarizeEventsCmd(a *app) *cobra.Command {
	var since string
	cmd := &cobra.Command{
		Use:   "events [resource]",
		Short: "Summarize Kubernetes events",
		Args:  cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			target := strings.TrimSpace(strings.Join(args, " "))
			if strings.TrimSpace(since) != "" {
				if target != "" {
					target += " "
				}
				target += "--since=" + strings.TrimSpace(since)
			}
			return runAIAction(a, cmd, "summarize-events", target)
		},
	}
	cmd.Flags().StringVar(&since, "since", "", "event lookback duration hint for AI context (e.g. 6h)")
	return cmd
}

func newAIActionCmd(a *app, use, short, action string) *cobra.Command {
	return &cobra.Command{
		Use:   use,
		Short: short,
		Args:  cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			target := strings.TrimSpace(strings.Join(args, " "))
			return runAIAction(a, cmd, action, target)
		},
	}
}

func newAIConfigCmd(a *app) *cobra.Command {
	var provider string
	var model string
	var key string
	var endpoint string
	var enable bool
	var disable bool
	var budget float64
	var softLimit float64

	cmd := &cobra.Command{
		Use:   "config",
		Short: "View or update AI configuration",
		RunE: func(cmd *cobra.Command, _ []string) error {
			changed := false
			if provider != "" {
				a.cfg.AI.Provider = strings.ToLower(strings.TrimSpace(provider))
				changed = true
			}
			if model != "" {
				a.cfg.AI.Model = strings.TrimSpace(model)
				changed = true
			}
			if key != "" {
				a.cfg.AI.APIKey = strings.TrimSpace(key)
				changed = true
			}
			if endpoint != "" {
				a.cfg.AI.Endpoint = strings.TrimSpace(endpoint)
				changed = true
			}
			if enable && disable {
				return fmt.Errorf("--enable and --disable are mutually exclusive")
			}
			if enable {
				a.cfg.AI.Enabled = true
				changed = true
			}
			if disable {
				a.cfg.AI.Enabled = false
				changed = true
			}
			if cmd.Flags().Changed("budget") {
				a.cfg.AI.BudgetMonthlyUSD = budget
				changed = true
			}
			if cmd.Flags().Changed("soft-limit") {
				a.cfg.AI.SoftLimitPercent = softLimit
				changed = true
			}

			if changed {
				if err := kcfg.Save(a.cfg); err != nil {
					return err
				}
				a.resetAIClient()
				fmt.Fprintln(cmd.OutOrStdout(), "AI config updated")
			}
			printAIConfig(cmd, a.cfg)
			return nil
		},
	}
	cmd.Flags().StringVar(&provider, "provider", "", "provider: openai|anthropic|azure-openai|ollama|custom")
	cmd.Flags().StringVar(&model, "model", "", "default model")
	cmd.Flags().StringVar(&key, "key", "", "API key (stored in ~/.kcli/config.yaml)")
	cmd.Flags().StringVar(&endpoint, "endpoint", "", "provider endpoint override")
	cmd.Flags().BoolVar(&enable, "enable", false, "enable AI")
	cmd.Flags().BoolVar(&disable, "disable", false, "disable AI")
	cmd.Flags().Float64Var(&budget, "budget", a.cfg.AI.BudgetMonthlyUSD, "monthly AI budget in USD")
	cmd.Flags().Float64Var(&softLimit, "soft-limit", a.cfg.AI.SoftLimitPercent, "soft budget warning threshold percent")
	return cmd
}

func newAIStatusCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show AI runtime status",
		RunE: func(cmd *cobra.Command, _ []string) error {
			client := a.aiClient()
			u, err := ai.LoadMonthlyUsage(time.Now())
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Enabled: %v\n", client.Enabled())
			fmt.Fprintf(cmd.OutOrStdout(), "Provider: %s\n", client.ProviderName())
			fmt.Fprintf(cmd.OutOrStdout(), "Model: %s\n", emptyDash(a.cfg.AI.Model))
			fmt.Fprintf(cmd.OutOrStdout(), "Budget: $%.2f/month (soft %.0f%%)\n", a.cfg.AI.BudgetMonthlyUSD, a.cfg.AI.SoftLimitPercent)
			fmt.Fprintf(cmd.OutOrStdout(), "Month: %s\n", u.Month)
			fmt.Fprintf(cmd.OutOrStdout(), "Usage: $%.4f (%d calls, %d cache hits)\n", u.EstimatedCostUSD, u.TotalCalls, u.CacheHits)
			if a.cfg.AI.BudgetMonthlyUSD > 0 {
				pct := (u.EstimatedCostUSD / a.cfg.AI.BudgetMonthlyUSD) * 100
				fmt.Fprintf(cmd.OutOrStdout(), "Budget utilization: %.1f%%\n", pct)
				if pct >= 100 {
					fmt.Fprintln(cmd.OutOrStdout(), "Status: HARD LIMIT REACHED (AI blocked)")
				} else if pct >= a.cfg.AI.SoftLimitPercent {
					fmt.Fprintln(cmd.OutOrStdout(), "Status: SOFT LIMIT REACHED")
				} else {
					fmt.Fprintln(cmd.OutOrStdout(), "Status: OK")
				}
			}
			return nil
		},
	}
}

func newAIUsageCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "usage",
		Short: "Show monthly AI usage statistics",
		RunE: func(cmd *cobra.Command, _ []string) error {
			u, err := ai.LoadMonthlyUsage(time.Now())
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Month: %s\n", u.Month)
			fmt.Fprintf(cmd.OutOrStdout(), "Calls: %d\n", u.TotalCalls)
			fmt.Fprintf(cmd.OutOrStdout(), "Cache hits: %d\n", u.CacheHits)
			fmt.Fprintf(cmd.OutOrStdout(), "Prompt tokens: %d\n", u.PromptTokens)
			fmt.Fprintf(cmd.OutOrStdout(), "Completion tokens: %d\n", u.CompletionTokens)
			fmt.Fprintf(cmd.OutOrStdout(), "Estimated cost: $%.4f\n", u.EstimatedCostUSD)
			return nil
		},
	}
}

func newAICostCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "cost",
		Short: "Show monthly AI cost and budget status",
		RunE: func(cmd *cobra.Command, _ []string) error {
			u, err := ai.LoadMonthlyUsage(time.Now())
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Month: %s\n", u.Month)
			fmt.Fprintf(cmd.OutOrStdout(), "Cost: $%.4f\n", u.EstimatedCostUSD)
			fmt.Fprintf(cmd.OutOrStdout(), "Budget: $%.2f\n", a.cfg.AI.BudgetMonthlyUSD)
			if a.cfg.AI.BudgetMonthlyUSD <= 0 {
				fmt.Fprintln(cmd.OutOrStdout(), "Budget: disabled")
				return nil
			}
			pct := (u.EstimatedCostUSD / a.cfg.AI.BudgetMonthlyUSD) * 100
			fmt.Fprintf(cmd.OutOrStdout(), "Utilization: %.1f%%\n", pct)
			if pct >= 100 {
				fmt.Fprintln(cmd.OutOrStdout(), "Result: hard limit reached")
			} else if pct >= a.cfg.AI.SoftLimitPercent {
				fmt.Fprintln(cmd.OutOrStdout(), "Result: soft limit reached")
			} else {
				fmt.Fprintln(cmd.OutOrStdout(), "Result: within budget")
			}
			return nil
		},
	}
}

// newAIPricingCmd implements `kcli ai pricing`.
// It shows the current per-token cost table, including whether it came from
// the live feed, the local disk cache, or the bundled fallback.
func newAIPricingCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "pricing",
		Short: "Show current AI provider per-token pricing",
		Long: `Show per-token cost rates for each AI provider.

kcli fetches live pricing from the kcli GitHub repository and caches it for
24 hours (~/.kcli/pricing.json).  The bundled fallback is used when offline.

Example:
  kcli ai pricing
`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			fmt.Fprint(cmd.OutOrStdout(), ai.FormatPricingTable())
			return nil
		},
	}
}

func printAIConfig(cmd *cobra.Command, cfg *kcfg.Config) {
	maskedKey := emptyDash(maskSecret(cfg.AI.APIKey))
	fmt.Fprintf(cmd.OutOrStdout(), "enabled: %v\n", cfg.AI.Enabled)
	fmt.Fprintf(cmd.OutOrStdout(), "provider: %s\n", emptyDash(cfg.AI.Provider))
	fmt.Fprintf(cmd.OutOrStdout(), "model: %s\n", emptyDash(cfg.AI.Model))
	fmt.Fprintf(cmd.OutOrStdout(), "endpoint: %s\n", emptyDash(cfg.AI.Endpoint))
	fmt.Fprintf(cmd.OutOrStdout(), "apiKey: %s\n", maskedKey)
	fmt.Fprintf(cmd.OutOrStdout(), "budgetMonthlyUSD: %.2f\n", cfg.AI.BudgetMonthlyUSD)
	fmt.Fprintf(cmd.OutOrStdout(), "softLimitPercent: %.0f\n", cfg.AI.SoftLimitPercent)
}

func maskSecret(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	if len(v) <= 6 {
		return "***"
	}
	return v[:3] + strings.Repeat("*", len(v)-6) + v[len(v)-3:]
}

func runAIAction(a *app, cmd *cobra.Command, action, target string) error {
	// P3-2: Surface similar past resolutions when running why
	if action == "why" && strings.TrimSpace(target) != "" {
		if mem, err := state.LoadMemory(); err == nil {
			if similar := mem.FindSimilar(target); similar != nil {
				resolved := similar.ResolvedAt
				if len(resolved) >= 10 {
					resolved = resolved[:10]
				}
				fmt.Fprintf(cmd.OutOrStdout(), "%sSimilar issue resolved on %s: %s%s\n\n",
					ansiGreen, resolved, similar.Resolution, ansiReset)
			}
		}
	}

	client := a.aiClient()
	if !client.Enabled() {
		fmt.Fprintln(cmd.OutOrStdout(), "AI disabled. Set KCLI_AI_PROVIDER (or provider-specific env vars) to enable.")
		return nil
	}

	ctx, cancel := context.WithTimeout(cmd.Context(), a.aiTimeout)
	defer cancel()

	res, err := withSpinner(cmd, "AI", func() (string, error) {
		return client.Analyze(ctx, action, target)
	})
	if err != nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "AI unavailable (%v). Continuing without AI output.\n", err)
		return nil
	}
	fmt.Fprintln(cmd.OutOrStdout(), res)
	return nil
}

func withSpinner(cmd *cobra.Command, label string, fn func() (string, error)) (string, error) {
	if !isInteractiveErr(cmd) {
		return fn()
	}
	ticker := time.NewTicker(120 * time.Millisecond)
	defer ticker.Stop()
	type result struct {
		v   string
		err error
	}
	out := make(chan result, 1)

	go func() {
		v, err := fn()
		out <- result{v: v, err: err}
	}()

	frames := []string{"-", "\\", "|", "/"}
	idx := 0
	for {
		select {
		case r := <-out:
			fmt.Fprint(cmd.ErrOrStderr(), "\r\033[2K")
			return r.v, r.err
		case <-ticker.C:
			fmt.Fprintf(cmd.ErrOrStderr(), "\r%s %s", frames[idx%len(frames)], label)
			idx++
		}
	}
}

func isInteractiveErr(cmd *cobra.Command) bool {
	f, ok := cmd.ErrOrStderr().(*os.File)
	if !ok {
		return false
	}
	return term.IsTerminal(int(f.Fd()))
}
