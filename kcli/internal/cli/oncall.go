package cli

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/kubilitics/kcli/internal/ai"
	"github.com/spf13/cobra"
)

const oncallSystemPrompt = `You are an SRE co-pilot in an interactive Kubernetes incident session. The user is debugging cluster issues. You see:
1) Conversation history (what they asked and what you suggested).
2) A current cluster snapshot: CrashLoopBackOff pods, OOMKilled, high restarts, node pressure, recent warning events.

Respond concisely. Explain anomalies in plain language. Suggest concrete next commands (kcli why, kcli logs, kubectl describe, etc.) based on what they have already tried. Remember context across the session. Never expose secrets.`

func newOncallCmd(a *app) *cobra.Command {
	var kubeContext string
	var watchInterval time.Duration
	var noWatch bool
	cmd := &cobra.Command{
		Use:   "oncall",
		Short: "Interactive AI-assisted incident session (SRE co-pilot)",
		GroupID: "incident",
		Long: `Start an interactive session where the AI watches cluster state and helps you debug.
The AI explains anomalies in plain language, suggests next commands based on what you've tried,
and remembers context for the duration of the session.

Commands in session:
  /snapshot   refresh and show current cluster anomalies
  /clear      clear conversation history
  /context    show current kube context
  /namespace  show current namespace
  exit, quit  end session`,
		Example: `  kcli oncall
  kcli oncall --context=prod-us
  kcli oncall --interval=45s --no-watch`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			client := a.aiClient()
			if !client.Enabled() {
				return fmt.Errorf("AI not configured. Run: kcli config set ai.provider openai && kcli config set ai.api_key <key>")
			}
			if strings.TrimSpace(kubeContext) != "" {
				a.context = strings.TrimSpace(kubeContext)
			}
			return runOncallLoop(a, cmd.Context(), client, watchInterval, !noWatch, cmd.OutOrStdout(), cmd.InOrStdin())
		},
	}
	cmd.Flags().StringVar(&kubeContext, "context", "", "kube context to use for this session (e.g. prod-us)")
	cmd.Flags().DurationVar(&watchInterval, "interval", 30*time.Second, "cluster snapshot refresh interval when watching")
	cmd.Flags().BoolVar(&noWatch, "no-watch", false, "do not refresh cluster snapshot in the background")
	return cmd
}

type oncallState struct {
	mu           sync.Mutex
	history      []struct{ Role, Content string }
	snapshot     string
	snapshotTime time.Time
}

func runOncallLoop(a *app, ctx context.Context, client *ai.Client, interval time.Duration, watch bool, stdout io.Writer, in io.Reader) error {
	state := &oncallState{}
	// Initial snapshot
	if report, err := buildIncidentReport(a, 2*time.Hour, 5); err == nil {
		state.mu.Lock()
		state.snapshot = formatIncidentReportForPrompt(report)
		state.snapshotTime = time.Now()
		state.mu.Unlock()
	}

	if watch && interval > 0 {
		go func() {
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					report, err := buildIncidentReport(a, 2*time.Hour, 5)
					if err != nil {
						continue
					}
					text := formatIncidentReportForPrompt(report)
					state.mu.Lock()
					state.snapshot = text
					state.snapshotTime = time.Now()
					state.mu.Unlock()
				}
			}
		}()
	}

	ctxName := a.context
	if ctxName == "" {
		ctxName = "(current)"
	}
	fmt.Fprintf(stdout, "\033[1m\033[36mkcli oncall\033[0m — AI incident co-pilot\n")
	fmt.Fprintf(stdout, "Context: %s  Namespace: %s\n", ctxName, defaultStr(a.namespace, "(all)"))
	fmt.Fprintf(stdout, "Commands: /snapshot  /clear  /context  /namespace  exit\n\n")

	scanner := bufio.NewScanner(in)
	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}
		fmt.Fprint(stdout, "oncall> ")
		if !scanner.Scan() {
			return scanner.Err()
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		lower := strings.ToLower(line)
		if lower == "exit" || lower == "quit" || lower == "q" {
			fmt.Fprintln(stdout, "Session ended.")
			return nil
		}
		if strings.HasPrefix(lower, "/context") {
			fmt.Fprintf(stdout, "context: %s\n", defaultStr(a.context, "(current from kubeconfig)"))
			continue
		}
		if strings.HasPrefix(lower, "/namespace") {
			fmt.Fprintf(stdout, "namespace: %s\n", defaultStr(a.namespace, "(all)"))
			continue
		}
		if strings.HasPrefix(lower, "/clear") {
			state.mu.Lock()
			state.history = nil
			state.mu.Unlock()
			fmt.Fprintln(stdout, "Conversation cleared.")
			continue
		}
		if strings.HasPrefix(lower, "/snapshot") {
			report, err := buildIncidentReport(a, 2*time.Hour, 5)
			if err != nil {
				fmt.Fprintf(stdout, "Snapshot error: %v\n", err)
				continue
			}
			state.mu.Lock()
			state.snapshot = formatIncidentReportForPrompt(report)
			state.snapshotTime = time.Now()
			snap := state.snapshot
			state.mu.Unlock()
			fmt.Fprintln(stdout, "--- Cluster snapshot ---")
			if snap == "" {
				fmt.Fprintln(stdout, "No anomalies in the last 2h.")
			} else {
				fmt.Fprintln(stdout, snap)
			}
			fmt.Fprintln(stdout, "------------------------")
			continue
		}

		// User message: add to history, build prompt, call AI, add response to history
		state.mu.Lock()
		state.history = append(state.history, struct{ Role, Content string }{Role: "user", Content: line})
		snap := state.snapshot
		historyCopy := append([]struct{ Role, Content string }{}, state.history...)
		state.mu.Unlock()

		userPrompt := buildOncallUserPrompt(historyCopy, snap, ctxName, defaultStr(a.namespace, ""))

		resp, err := client.QueryWithPrompt(ctx, oncallSystemPrompt, userPrompt)
		if err != nil {
			fmt.Fprintf(stdout, "AI error: %v\n", err)
			continue
		}

		state.mu.Lock()
		state.history = append(state.history, struct{ Role, Content string }{Role: "assistant", Content: resp})
		state.mu.Unlock()

		fmt.Fprintln(stdout, resp)
	}
}

func buildOncallUserPrompt(history []struct{ Role, Content string }, snapshot, kubeContext, namespace string) string {
	var b strings.Builder
	b.WriteString("Conversation so far:\n")
	for _, m := range history {
		b.WriteString(m.Role + ": " + m.Content + "\n")
	}
	b.WriteString("\nCurrent cluster anomalies (refreshed periodically):\n")
	if snapshot == "" {
		b.WriteString("None in the last 2h.\n")
	} else {
		b.WriteString(snapshot)
		b.WriteString("\n")
	}
	b.WriteString("\nkubeContext=" + kubeContext + " namespace=" + namespace + "\n\n")
	b.WriteString("User: " + history[len(history)-1].Content)
	return b.String()
}

func formatIncidentReportForPrompt(r *incidentReport) string {
	if r == nil {
		return ""
	}
	var b strings.Builder
	if len(r.CrashLoopBackOff) > 0 {
		b.WriteString("CrashLoopBackOff: ")
		for i, p := range r.CrashLoopBackOff {
			if i > 0 {
				b.WriteString(", ")
			}
			b.WriteString(p.Namespace + "/" + p.Pod)
			if p.Container != "" {
				b.WriteString(" container=" + p.Container)
			}
			b.WriteString(fmt.Sprintf(" restarts=%d", p.Restarts))
		}
		b.WriteString("\n")
	}
	if len(r.OOMKilled) > 0 {
		b.WriteString("OOMKilled: ")
		for i, p := range r.OOMKilled {
			if i > 0 {
				b.WriteString(", ")
			}
			b.WriteString(p.Namespace + "/" + p.Pod)
			if p.Container != "" {
				b.WriteString(" container=" + p.Container)
			}
			b.WriteString(fmt.Sprintf(" restarts=%d", p.Restarts))
		}
		b.WriteString("\n")
	}
	if len(r.HighRestarts) > 0 {
		b.WriteString("High restarts: ")
		for i, p := range r.HighRestarts {
			if i > 0 {
				b.WriteString(", ")
			}
			b.WriteString(fmt.Sprintf("%s/%s restarts=%d", p.Namespace, p.Pod, p.Restarts))
		}
		b.WriteString("\n")
	}
	if len(r.NodePressure) > 0 {
		b.WriteString("Node pressure: ")
		for i, n := range r.NodePressure {
			if i > 0 {
				b.WriteString(", ")
			}
			b.WriteString(fmt.Sprintf("%s %s", n.Node, n.Condition))
			if n.Reason != "" {
				b.WriteString(" reason=" + n.Reason)
			}
		}
		b.WriteString("\n")
	}
	if len(r.CriticalEvents) > 0 {
		b.WriteString("Recent warning events:\n")
		for i, e := range r.CriticalEvents {
			if i >= 10 {
				break
			}
			b.WriteString(fmt.Sprintf("  %s %s %s\n", e.Type, e.Reason, e.Message))
		}
	}
	return strings.TrimSuffix(b.String(), "\n")
}

func defaultStr(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return strings.TrimSpace(s)
}
