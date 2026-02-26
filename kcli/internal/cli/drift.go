// drift.go — kcli drift: detect manual changes that bypass GitOps (P3-7).
//
// Identifies resources managed by Helm/ArgoCD/Flux but last modified by kubectl
// (manual apply), indicating drift from the declared GitOps state.
package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"
)

type driftResource struct {
	Kind      string
	Name      string
	Namespace string
	GitOps    string // Helm, ArgoCD, Flux
	LastBy    string // last manager from managedFields
	When      string
}

func newDriftCmd(a *app) *cobra.Command {
	var watch bool
	var interval string
	var alertSlack string
	var namespace string

	cmd := &cobra.Command{
		Use:   "drift",
		Short: "Detect manual kubectl apply changes that bypass GitOps",
		Long: `Identify resources managed by Helm, ArgoCD, or Flux that were last modified
by kubectl (manual apply) — indicating drift from the declared GitOps state.

Uses managedFields: if a resource has GitOps annotations but the most recent
field manager is kubectl, it was likely changed manually and will be overwritten
on the next GitOps sync.`,
		GroupID: "workflow",
		Example: `  kcli drift
  kcli drift -n production
  kcli drift --watch
  kcli drift --watch --alert-slack https://hooks.slack.com/...`,
		RunE: func(cmd *cobra.Command, args []string) error {
			ns := namespace
			if ns == "" {
				ns = a.namespace
			}
			if watch {
				return a.runDriftWatch(ns, interval, alertSlack)
			}
			return a.runDriftOnce(ns)
		},
	}
	cmd.Flags().BoolVar(&watch, "watch", false, "Continuously monitor for drift")
	cmd.Flags().StringVar(&interval, "interval", "30s", "Poll interval when --watch (e.g. 30s, 1m)")
	cmd.Flags().StringVar(&alertSlack, "alert-slack", "", "Slack webhook URL to alert when drift is detected")
	cmd.Flags().StringVarP(&namespace, "namespace", "n", "", "Scope to namespace (default: all)")
	return cmd
}

func (a *app) runDriftOnce(namespace string) error {
	drifts, err := a.detectDrift(namespace)
	if err != nil {
		return err
	}

	fmt.Fprintf(a.stdout, "\n%s%s Drift Detection%s", ansiBold, ansiCyan, ansiReset)
	if namespace != "" {
		fmt.Fprintf(a.stdout, " — %s%s%s", ansiYellow, namespace, ansiReset)
	} else {
		fmt.Fprintf(a.stdout, " — cluster-wide")
	}
	fmt.Fprintf(a.stdout, "\n%sResources managed by GitOps but last modified by kubectl%s\n\n",
		ansiGray, ansiReset)

	if len(drifts) == 0 {
		fmt.Fprintf(a.stdout, "%s✓ No drift detected — GitOps-managed resources appear unchanged by manual apply.%s\n\n",
			ansiGreen, ansiReset)
		return nil
	}

	fmt.Fprintf(a.stdout, "%s%s %d resource(s) with drift:%s\n\n", ansiBold, ansiYellow, len(drifts), ansiReset)
	fmt.Fprintf(a.stdout, "  %-20s %-35s %-10s %-25s %s\n", "KIND", "NAME", "NAMESPACE", "GITOPS", "LAST MODIFIED BY")
	fmt.Fprintf(a.stdout, "  %s\n", strings.Repeat("─", 100))
	for _, d := range drifts {
		fmt.Fprintf(a.stdout, "  %-20s %-35s %-10s %-25s %s\n",
			d.Kind, truncate(d.Name, 35), truncate(d.Namespace, 10), d.GitOps, d.LastBy)
	}
	fmt.Fprintf(a.stdout, "\n%sTip: Run `kcli blame %s/NAME` to see change history. GitOps will overwrite on next sync.%s\n\n",
		ansiGray, strings.ToLower(drifts[0].Kind), ansiReset)
	return nil
}

func (a *app) runDriftWatch(namespace string, intervalStr string, alertSlack string) error {
	d, err := parseDuration(intervalStr)
	if err != nil {
		return fmt.Errorf("invalid --interval %q: %w (use e.g. 30s, 1m)", intervalStr, err)
	}

	done, cancel := contextWithSignal()
	defer cancel()

	webhook := alertSlack
	if webhook == "" && a.cfg != nil {
		webhook = strings.TrimSpace(a.cfg.Integrations.SlackWebhook)
	}
	if webhook == "" {
		webhook = strings.TrimSpace(os.Getenv("SLACK_WEBHOOK_URL"))
	}

	ctxName := a.getCurrentContextName()
	seenKeys := make(map[string]bool)
	cycle := 0

	for {
		cycle++
		select {
		case <-done:
			fmt.Fprintf(a.stdout, "\n%sStopped. Run `kcli drift` for a single check.%s\n\n", ansiGray, ansiReset)
			return nil
		default:
		}

		drifts, err := a.detectDrift(namespace)
		if err != nil {
			fmt.Fprintf(a.stderr, "%sWARN: drift check failed: %v%s\n", ansiYellow, err, ansiReset)
		} else if len(drifts) > 0 {
			newKeys := make(map[string]bool)
			var newDrifts []driftResource
			for _, d := range drifts {
				key := d.Namespace + "/" + d.Kind + "/" + d.Name
				newKeys[key] = true
				if !seenKeys[key] {
					newDrifts = append(newDrifts, d)
				}
			}
			seenKeys = newKeys

			if len(newDrifts) > 0 {
				ts := time.Now().Format("15:04:05")
				fmt.Fprintf(a.stdout, "\n%s[%s] %sDrift detected: %d resource(s)%s\n",
					ansiGray, ts, ansiYellow, len(newDrifts), ansiReset)
				for _, d := range newDrifts {
					fmt.Fprintf(a.stdout, "  %s/%s (%s) — last by %s\n", d.Kind, d.Name, d.Namespace, d.LastBy)
				}
				fmt.Fprintln(a.stdout)

				if webhook != "" {
					if err := a.sendDriftSlackAlert(newDrifts, ctxName, webhook); err != nil {
						fmt.Fprintf(a.stderr, "%sWARN: Slack alert failed: %v%s\n", ansiYellow, err, ansiReset)
					}
				}
			}
		} else if cycle == 1 {
			fmt.Fprintf(a.stdout, "\n%s✓ No drift. Watching every %s... (Ctrl+C to stop)%s\n\n", ansiGreen, intervalStr, ansiReset)
		}

		select {
		case <-done:
			return nil
		case <-time.After(d):
			// continue
		}
	}
}

func contextWithSignal() (<-chan struct{}, func()) {
	done := make(chan struct{})
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	var cancel func()
	cancel = func() {
		signal.Stop(sigCh)
		select {
		case <-done:
		default:
			close(done)
		}
	}
	go func() {
		<-sigCh
		cancel()
	}()
	return done, cancel
}

func (a *app) detectDrift(namespace string) ([]driftResource, error) {
	types := []string{"deployments", "statefulsets", "daemonsets", "configmaps", "secrets"}
	var allDrifts []driftResource

	kindMap := map[string]string{
		"deployments": "Deployment", "statefulsets": "StatefulSet", "daemonsets": "DaemonSet",
		"configmaps": "ConfigMap", "secrets": "Secret",
	}

	for _, resType := range types {
		args := []string{"get", resType, "-o", "json", "-A"}
		if namespace != "" {
			args = []string{"get", resType, "-o", "json", "-n", namespace}
		}
		out, err := a.captureKubectl(args)
		if err != nil {
			continue
		}

		itemKind := kindMap[resType]
		if itemKind == "" {
			itemKind = resType
		}

		var list struct {
			Items []struct {
				Metadata struct {
					Name        string `json:"name"`
					Namespace   string `json:"namespace"`
					Annotations map[string]string `json:"annotations"`
					Labels      map[string]string `json:"labels"`
					ManagedFields []struct {
						Manager   string `json:"manager"`
						Operation string `json:"operation"`
						Time      string `json:"time"`
					} `json:"managedFields"`
				} `json:"metadata"`
			} `json:"items"`
		}
		if err := json.Unmarshal([]byte(out), &list); err != nil {
			continue
		}

		for _, item := range list.Items {
			gitOps := gitOpsSource(item.Metadata.Annotations, item.Metadata.Labels)
			if gitOps == "" {
				continue
			}

			lastManager, lastTime := lastManagerFromFields(item.Metadata.ManagedFields)
			if lastManager == "" {
				continue
			}
			if isGitOpsManager(lastManager) {
				continue
			}
			if !isManualManager(lastManager) {
				continue
			}

			allDrifts = append(allDrifts, driftResource{
				Kind:      itemKind,
				Name:      item.Metadata.Name,
				Namespace: item.Metadata.Namespace,
				GitOps:    gitOps,
				LastBy:    lastManager,
				When:      lastTime,
			})
		}
	}

	sort.Slice(allDrifts, func(i, j int) bool {
		if allDrifts[i].Namespace != allDrifts[j].Namespace {
			return allDrifts[i].Namespace < allDrifts[j].Namespace
		}
		if allDrifts[i].Kind != allDrifts[j].Kind {
			return allDrifts[i].Kind < allDrifts[j].Kind
		}
		return allDrifts[i].Name < allDrifts[j].Name
	})
	return allDrifts, nil
}

func gitOpsSource(annotations, labels map[string]string) string {
	if annotations != nil {
		if annotations["meta.helm.sh/release-name"] != "" {
			return "Helm"
		}
		if annotations["kustomize.toolkit.fluxcd.io/checksum"] != "" {
			return "Flux Kustomization"
		}
		if annotations["helm.toolkit.fluxcd.io/checksum"] != "" {
			return "Flux HelmRelease"
		}
	}
	if labels != nil {
		if labels["argocd.argoproj.io/instance"] != "" {
			return "ArgoCD"
		}
	}
	return ""
}

func lastManagerFromFields(fields []struct {
	Manager   string `json:"manager"`
	Operation string `json:"operation"`
	Time      string `json:"time"`
}) (string, string) {
	if len(fields) == 0 {
		return "", ""
	}
	var latest struct {
		Manager string
		Time    time.Time
	}
	for _, f := range fields {
		if f.Manager == "" {
			continue
		}
		var t time.Time
		if f.Time != "" {
			t, _ = time.Parse(time.RFC3339, f.Time)
		}
		if t.After(latest.Time) {
			latest.Manager = f.Manager
			latest.Time = t
		}
	}
	when := ""
	if !latest.Time.IsZero() {
		when = latest.Time.Format("2006-01-02 15:04")
	}
	return latest.Manager, when
}

func isGitOpsManager(manager string) bool {
	m := strings.ToLower(manager)
	return strings.Contains(m, "helm") ||
		strings.Contains(m, "argocd") || strings.Contains(m, "argo-cd") ||
		strings.Contains(m, "flux")
}

func isManualManager(manager string) bool {
	m := strings.ToLower(manager)
	return strings.Contains(m, "kubectl")
}

func (a *app) sendDriftSlackAlert(drifts []driftResource, ctxName string, webhook string) error {
	var buf strings.Builder
	for _, d := range drifts {
		buf.WriteString(fmt.Sprintf("• %s/%s (%s) — last modified by %s\n", d.Kind, d.Name, d.Namespace, d.LastBy))
	}
	msg := fmt.Sprintf("⚠️ kcli drift: %d resource(s) modified outside GitOps [%s]\n\n%s\nRun `kcli blame` for details.",
		len(drifts), ctxName, buf.String())

	payload := map[string]interface{}{
		"text": msg,
		"blocks": []map[string]interface{}{
			{
				"type": "section",
				"text": map[string]string{"type": "mrkdwn", "text": msg},
			},
		},
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	resp, err := http.Post(webhook, "application/json", bytes.NewReader(b))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Slack webhook returned HTTP %d", resp.StatusCode)
	}
	return nil
}
