package cli

// gitops.go — kcli gitops command group.
//
// First-class GitOps integration for ArgoCD and Flux.
// Auto-detects the installed engine from the cluster and provides
// unified UX regardless of backend.
//
// Read-only operations (status, history, diff) use Kubernetes CRD API directly —
// no argocd or flux binary needed on PATH. Write operations (sync, reconcile,
// suspend, resume) try kubectl-based approaches first and fall back to the
// vendor binary only when a kubectl approach is not available.
//
// Commands:
//   kcli gitops status            — show all apps, sync state, health
//   kcli gitops sync <app>        — trigger sync
//   kcli gitops diff <app>        — git vs live diff
//   kcli gitops rollback <app>    — rollback to last synced state
//   kcli gitops history <app>     — deployment history
//   kcli gitops lock <app>        — prevent auto-sync
//   kcli gitops unlock <app>      — re-enable auto-sync
//   kcli gitops reconcile <res>   — Flux: reconcile a resource
//   kcli gitops suspend <res>     — Flux: suspend
//   kcli gitops resume <res>      — Flux: resume

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

// ─── Engine detection ─────────────────────────────────────────────────────────

type gitopsEngine string

const (
	engineArgoCD gitopsEngine = "argocd"
	engineFlux   gitopsEngine = "flux"
	engineNone   gitopsEngine = ""
)

func (a *app) detectGitopsEngine() gitopsEngine {
	// Check config override
	if a.cfg != nil {
		if e := a.cfg.Integrations.GitopsEngine; e != "" {
			return gitopsEngine(e)
		}
	}
	// Detect ArgoCD: check for argocd-server deployment
	out, err := a.captureKubectl([]string{"get", "deployment", "argocd-server", "-n", "argocd", "--ignore-not-found"})
	if err == nil && strings.Contains(out, "argocd-server") {
		return engineArgoCD
	}
	// Detect Flux: check for flux-system namespace
	out, err = a.captureKubectl([]string{"get", "namespace", "flux-system", "--ignore-not-found"})
	if err == nil && strings.Contains(out, "flux-system") {
		return engineFlux
	}
	return engineNone
}

func findArgoCDBinary() (string, error) {
	if p, err := exec.LookPath("argocd"); err == nil {
		return p, nil
	}
	return "", fmt.Errorf("this operation requires the argocd CLI\n" +
		"  Install: brew install argocd\n" +
		"  Or see: https://argo-cd.readthedocs.io/en/stable/cli_installation/")
}

func findFluxBinary() (string, error) {
	if p, err := exec.LookPath("flux"); err == nil {
		return p, nil
	}
	return "", fmt.Errorf("this operation requires the flux CLI\n" +
		"  Install: brew install fluxcd/tap/flux\n" +
		"  Or see: https://fluxcd.io/flux/installation/")
}

// ─── ArgoCD types ─────────────────────────────────────────────────────────────

type argoApp struct {
	Metadata struct {
		Name      string `json:"name"`
		Namespace string `json:"namespace"`
	} `json:"metadata"`
	Spec struct {
		Source struct {
			RepoURL        string `json:"repoURL"`
			TargetRevision string `json:"targetRevision"`
			Path           string `json:"path"`
		} `json:"source"`
		Destination struct {
			Namespace string `json:"namespace"`
		} `json:"destination"`
	} `json:"spec"`
	Status struct {
		Sync struct {
			Status   string `json:"status"`
			Revision string `json:"revision"`
		} `json:"sync"`
		Health struct {
			Status  string `json:"status"`
			Message string `json:"message"`
		} `json:"health"`
		OperationState struct {
			Phase   string    `json:"phase"`
			Message string    `json:"message"`
			FinishedAt time.Time `json:"finishedAt"`
		} `json:"operationState"`
		Conditions []struct {
			Type    string `json:"type"`
			Message string `json:"message"`
		} `json:"conditions"`
	} `json:"status"`
}

type argoAppList struct {
	Items []argoApp `json:"items"`
}

// ─── Flux CRD types ───────────────────────────────────────────────────────────

// fluxCondition is a standard metav1.Condition on Flux resources.
type fluxCondition struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason"`
	Message            string `json:"message"`
	LastTransitionTime string `json:"lastTransitionTime"`
}

// fluxWorkload covers both Kustomization and HelmRelease at the fields we care
// about. Both share the same metadata/status shape for status display.
type fluxWorkload struct {
	Kind     string `json:"kind"` // populated after list fetch
	Metadata struct {
		Name      string `json:"name"`
		Namespace string `json:"namespace"`
	} `json:"metadata"`
	Spec struct {
		// Kustomization
		Path string `json:"path"`
		// HelmRelease
		Chart struct {
			Spec struct {
				Chart   string `json:"chart"`
				Version string `json:"version"`
			} `json:"spec"`
		} `json:"chart"`
	} `json:"spec"`
	Status struct {
		ObservedGeneration  int64           `json:"observedGeneration"`
		LastAppliedRevision string          `json:"lastAppliedRevision"`
		Conditions          []fluxCondition `json:"conditions"`
	} `json:"status"`
}

type fluxWorkloadList struct {
	Items []fluxWorkload `json:"items"`
}

// fluxReadyStatus returns the Ready condition status or "Unknown" if not present.
func fluxReadyStatus(w fluxWorkload) (status, reason, message string) {
	for _, c := range w.Status.Conditions {
		if c.Type == "Ready" {
			return c.Status, c.Reason, c.Message
		}
	}
	return "Unknown", "", ""
}

// ─── ArgoCD history types ─────────────────────────────────────────────────────

type argoHistoryEntry struct {
	ID         int64  `json:"id"`
	Revision   string `json:"revision"`
	DeployedAt string `json:"deployedAt"`
	Source     struct {
		RepoURL        string `json:"repoURL"`
		Path           string `json:"path"`
		TargetRevision string `json:"targetRevision"`
	} `json:"source"`
}

// ─── GitOps status ────────────────────────────────────────────────────────────

func (a *app) gitopsStatusArgoCD() error {
	// Try using kubectl to get ArgoCD apps (works without argocd CLI)
	out, err := a.captureKubectl([]string{"get", "applications", "-n", "argocd", "-o", "json"})
	if err != nil {
		// Fall back to argocd CLI
		bin, berr := findArgoCDBinary()
		if berr != nil {
			return fmt.Errorf("cannot access ArgoCD: %w — ensure RBAC or install argocd CLI", err)
		}
		cmd := exec.Command(bin, "app", "list")
		cmd.Stdout = a.stdout
		cmd.Stderr = a.stderr
		return cmd.Run()
	}

	var apps argoAppList
	if err := json.Unmarshal([]byte(out), &apps); err != nil {
		return fmt.Errorf("failed to parse ArgoCD applications: %w", err)
	}

	// Count by status
	synced, outOfSync, degraded := 0, 0, 0
	for _, app := range apps.Items {
		switch app.Status.Sync.Status {
		case "Synced":
			synced++
		case "OutOfSync":
			outOfSync++
		}
		if app.Status.Health.Status == "Degraded" {
			degraded++
		}
	}

	fmt.Fprintf(a.stdout, "\n%s%s GitOps Status — ArgoCD%s\n", ansiBold, ansiCyan, ansiReset)
	fmt.Fprintf(a.stdout, "%sApps: %d total  %sSynced: %d%s  %sOutOfSync: %d%s  %sDegraded: %d%s\n\n",
		ansiGray, len(apps.Items),
		ansiGreen, synced, ansiReset,
		ansiYellow, outOfSync, ansiReset,
		ansiRed, degraded, ansiReset,
	)

	if len(apps.Items) == 0 {
		fmt.Fprintf(a.stdout, "%sNo ArgoCD applications found in namespace 'argocd'.%s\n\n", ansiGray, ansiReset)
		return nil
	}

	fmt.Fprintf(a.stdout, "%s%-30s %-12s %-12s %-15s %s%s\n",
		ansiBold, "APPLICATION", "SYNC", "HEALTH", "REVISION", "NAMESPACE", ansiReset)
	fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 85))

	for _, app := range apps.Items {
		syncColor := ansiGreen
		if app.Status.Sync.Status == "OutOfSync" {
			syncColor = ansiYellow
		}
		healthColor := ansiGreen
		if app.Status.Health.Status == "Degraded" || app.Status.Health.Status == "Missing" {
			healthColor = ansiRed
		} else if app.Status.Health.Status == "Progressing" {
			healthColor = ansiYellow
		}
		rev := app.Status.Sync.Revision
		if len(rev) > 8 {
			rev = rev[:8]
		}
		fmt.Fprintf(a.stdout, "%-30s %s%-12s%s %s%-12s%s %-15s %s\n",
			truncate(app.Metadata.Name, 30),
			syncColor, truncate(app.Status.Sync.Status, 12), ansiReset,
			healthColor, truncate(app.Status.Health.Status, 12), ansiReset,
			rev,
			app.Spec.Destination.Namespace,
		)
		if app.Status.Health.Status == "Degraded" && app.Status.Health.Message != "" {
			fmt.Fprintf(a.stdout, "  %s↳ %s%s\n", ansiRed, truncate(app.Status.Health.Message, 70), ansiReset)
		}
		if app.Status.Sync.Status == "OutOfSync" {
			fmt.Fprintf(a.stdout, "  %s↳ Run: kcli gitops sync %s%s\n", ansiYellow, app.Metadata.Name, ansiReset)
		}
	}

	fmt.Fprintf(a.stdout, "\n%sTip: kcli gitops sync <app>  ·  kcli gitops diff <app>  ·  kcli gitops rollback <app>%s\n\n",
		ansiGray, ansiReset)
	return nil
}

func (a *app) gitopsStatusFlux() error {
	// Primary path: read Flux CRDs directly via kubectl — no binary needed.
	var allWorkloads []fluxWorkload

	// Kustomizations
	ksOut, ksErr := a.captureKubectl([]string{
		"get", "kustomizations.kustomize.toolkit.fluxcd.io",
		"--all-namespaces", "-o", "json",
	})
	if ksErr == nil {
		var list fluxWorkloadList
		if json.Unmarshal([]byte(ksOut), &list) == nil {
			for i := range list.Items {
				list.Items[i].Kind = "Kustomization"
			}
			allWorkloads = append(allWorkloads, list.Items...)
		}
	}

	// HelmReleases
	hrOut, hrErr := a.captureKubectl([]string{
		"get", "helmreleases.helm.toolkit.fluxcd.io",
		"--all-namespaces", "-o", "json",
	})
	if hrErr == nil {
		var list fluxWorkloadList
		if json.Unmarshal([]byte(hrOut), &list) == nil {
			for i := range list.Items {
				list.Items[i].Kind = "HelmRelease"
			}
			allWorkloads = append(allWorkloads, list.Items...)
		}
	}

	if ksErr != nil && hrErr != nil {
		// CRDs not accessible — fall back to flux binary if available.
		bin, berr := findFluxBinary()
		if berr != nil {
			return fmt.Errorf("cannot access Flux CRDs via kubectl (%v) and flux CLI not found\n"+
				"Ensure Flux is installed on the cluster and you have RBAC access to kustomizations/helmreleases", ksErr)
		}
		cmd := exec.Command(bin, "get", "all", "--all-namespaces")
		cmd.Stdout = a.stdout
		cmd.Stderr = a.stderr
		return cmd.Run()
	}

	// Count by status.
	ready, notReady, unknown := 0, 0, 0
	for _, w := range allWorkloads {
		status, _, _ := fluxReadyStatus(w)
		switch status {
		case "True":
			ready++
		case "False":
			notReady++
		default:
			unknown++
		}
	}

	fmt.Fprintf(a.stdout, "\n%s%s GitOps Status — Flux%s\n", ansiBold, ansiCyan, ansiReset)
	fmt.Fprintf(a.stdout, "%sResources: %d total  %sReady: %d%s  %sNotReady: %d%s  %sUnknown: %d%s\n\n",
		ansiGray, len(allWorkloads),
		ansiGreen, ready, ansiReset,
		ansiRed, notReady, ansiReset,
		ansiYellow, unknown, ansiReset,
	)

	if len(allWorkloads) == 0 {
		fmt.Fprintf(a.stdout, "%sNo Flux resources found (no Kustomizations or HelmReleases).%s\n\n", ansiGray, ansiReset)
		return nil
	}

	fmt.Fprintf(a.stdout, "%s%-15s %-25s %-12s %-12s %-30s%s\n",
		ansiBold, "KIND", "NAME", "NAMESPACE", "READY", "REVISION", ansiReset)
	fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 100))

	for _, w := range allWorkloads {
		status, reason, msg := fluxReadyStatus(w)
		statusColor := ansiGreen
		statusStr := "True"
		if status != "True" {
			statusColor = ansiRed
			statusStr = status
			if reason != "" {
				statusStr = reason
			}
		}
		rev := w.Status.LastAppliedRevision
		if len(rev) > 30 {
			rev = rev[:30]
		}
		fmt.Fprintf(a.stdout, "%-15s %-25s %-12s %s%-12s%s %-30s\n",
			w.Kind,
			truncate(w.Metadata.Name, 25),
			truncate(w.Metadata.Namespace, 12),
			statusColor, truncate(statusStr, 12), ansiReset,
			rev,
		)
		if status == "False" && msg != "" {
			fmt.Fprintf(a.stdout, "  %s↳ %s%s\n", ansiRed, truncate(msg, 80), ansiReset)
		}
	}

	fmt.Fprintf(a.stdout, "\n%sTip: kcli gitops reconcile kustomization/<name>  ·  kcli gitops history <name>%s\n\n",
		ansiGray, ansiReset)
	return nil
}

// ─── GitOps sync ──────────────────────────────────────────────────────────────

func (a *app) gitopsSyncArgoCD(app string) error {
	// Try kubectl patch first (no argocd CLI needed)
	patchArg := fmt.Sprintf(`{"operation":{"initiatedBy":{"username":"kcli"},"sync":{"revision":"HEAD"}}}`)
	err := a.runKubectl([]string{"patch", "application", app, "-n", "argocd",
		"--type=merge", "-p", patchArg})
	if err == nil {
		fmt.Fprintf(a.stdout, "%s✓ Sync triggered for %s%s\n", ansiGreen, app, ansiReset)
		return nil
	}
	// Fall back to argocd CLI
	bin, berr := findArgoCDBinary()
	if berr != nil {
		return fmt.Errorf("sync failed via kubectl: %w", err)
	}
	cmd := exec.Command(bin, "app", "sync", app)
	cmd.Stdout = a.stdout
	cmd.Stderr = a.stderr
	return cmd.Run()
}

// gitopsSyncFlux triggers a Flux reconciliation using the standard annotation
// approach (no flux binary required). If the annotation method fails, it falls
// back to the flux CLI.
func (a *app) gitopsSyncFlux(resource string) error {
	parts := strings.SplitN(resource, "/", 2)
	kind := "kustomization"
	name := resource
	if len(parts) == 2 {
		kind = strings.ToLower(parts[0])
		name = parts[1]
	}

	// Map short kind names to full CRD names for kubectl.
	crdKind := fluxCRDForKind(kind)
	ns := a.namespace
	if ns == "" {
		ns = "flux-system"
	}

	// Primary: trigger reconcile via annotation (no binary needed).
	// Flux controllers watch for changes to this annotation and reconcile immediately.
	now := time.Now().UTC().Format(time.RFC3339)
	patch := fmt.Sprintf(`{"metadata":{"annotations":{"reconcile.fluxcd.io/requestedAt":%q}}}`, now)
	err := a.runKubectl([]string{
		"patch", crdKind, name, "-n", ns,
		"--type=merge", "-p", patch,
	})
	if err == nil {
		fmt.Fprintf(a.stdout, "%s✓ Reconcile triggered for %s/%s via annotation%s\n",
			ansiGreen, kind, name, ansiReset)
		fmt.Fprintf(a.stdout, "%s  The Flux controller will reconcile shortly.%s\n", ansiGray, ansiReset)
		return nil
	}

	// Fall back to flux binary.
	bin, berr := findFluxBinary()
	if berr != nil {
		return fmt.Errorf("kubectl annotation failed (%v)\n%s", err, berr.Error())
	}
	cmd := exec.Command(bin, "reconcile", kind, name)
	cmd.Stdout = a.stdout
	cmd.Stderr = a.stderr
	return cmd.Run()
}

// fluxCRDForKind returns the CRD resource name for a given Flux kind shortname.
func fluxCRDForKind(kind string) string {
	switch strings.ToLower(kind) {
	case "kustomization", "ks":
		return "kustomizations.kustomize.toolkit.fluxcd.io"
	case "helmrelease", "hr":
		return "helmreleases.helm.toolkit.fluxcd.io"
	case "gitrepository", "gr":
		return "gitrepositories.source.toolkit.fluxcd.io"
	case "helmrepository":
		return "helmrepositories.source.toolkit.fluxcd.io"
	case "helmchart":
		return "helmcharts.source.toolkit.fluxcd.io"
	default:
		// Return as-is and let kubectl validate.
		return kind
	}
}

// ─── History via Kubernetes CRDs (no binary needed) ──────────────────────────

// gitopsHistoryArgoCD fetches deployment history from the ArgoCD Application
// CRD (.status.history) — no argocd binary required.
func (a *app) gitopsHistoryArgoCD(appName string) error {
	// Determine namespace: Application can live in any namespace; default is "argocd".
	ns := "argocd"
	out, err := a.captureKubectl([]string{
		"get", "application.argoproj.io", appName, "-n", ns, "-o", "json",
	})
	if err != nil {
		// Fall back to argocd binary.
		bin, berr := findArgoCDBinary()
		if berr != nil {
			return fmt.Errorf("cannot fetch ArgoCD application %q via kubectl (%v)\n%s", appName, err, berr.Error())
		}
		cmd := exec.Command(bin, "app", "history", appName)
		cmd.Stdout = a.stdout
		cmd.Stderr = a.stderr
		return cmd.Run()
	}

	// Parse the full Application object.
	var appObj struct {
		Status struct {
			History []argoHistoryEntry `json:"history"`
		} `json:"status"`
	}
	if err := json.Unmarshal([]byte(out), &appObj); err != nil {
		return fmt.Errorf("failed to parse application %q: %w", appName, err)
	}

	history := appObj.Status.History
	fmt.Fprintf(a.stdout, "\n%s%s Deployment History — %s%s\n\n", ansiBold, ansiCyan, appName, ansiReset)

	if len(history) == 0 {
		fmt.Fprintf(a.stdout, "%sNo deployment history found for application %q.%s\n\n", ansiGray, appName, ansiReset)
		return nil
	}

	fmt.Fprintf(a.stdout, "%s%-5s %-12s %-25s %-35s%s\n",
		ansiBold, "ID", "REVISION", "DEPLOYED AT", "SOURCE", ansiReset)
	fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 82))

	// Display most recent first.
	for i := len(history) - 1; i >= 0; i-- {
		h := history[i]
		rev := h.Revision
		if len(rev) > 12 {
			rev = rev[:12]
		}
		deployedAt := h.DeployedAt
		if deployedAt == "" {
			deployedAt = "—"
		}
		source := h.Source.RepoURL
		if h.Source.Path != "" {
			source += ":" + h.Source.Path
		}
		current := ""
		if i == len(history)-1 {
			current = ansiGreen + " ← current" + ansiReset
		}
		fmt.Fprintf(a.stdout, "%-5d %-12s %-25s %s%s\n",
			h.ID, rev, deployedAt, truncate(source, 35), current)
	}
	fmt.Fprintln(a.stdout)
	return nil
}

// gitopsHistoryFlux shows the Flux resource conditions as change history — no
// flux binary required.
func (a *app) gitopsHistoryFlux(resource string) error {
	parts := strings.SplitN(resource, "/", 2)
	kind := "kustomization"
	name := resource
	if len(parts) == 2 {
		kind = strings.ToLower(parts[0])
		name = parts[1]
	}
	crdKind := fluxCRDForKind(kind)
	ns := a.namespace
	if ns == "" {
		ns = "flux-system"
	}

	out, err := a.captureKubectl([]string{
		"get", crdKind, name, "-n", ns, "-o", "json",
	})
	if err != nil {
		// Fall back to flux binary events.
		bin, berr := findFluxBinary()
		if berr != nil {
			return fmt.Errorf("cannot fetch %s %q via kubectl (%v)\n%s", kind, name, err, berr.Error())
		}
		cmd := exec.Command(bin, "events", "--for", kind+"/"+name)
		cmd.Stdout = a.stdout
		cmd.Stderr = a.stderr
		return cmd.Run()
	}

	var w fluxWorkload
	if err := json.Unmarshal([]byte(out), &w); err != nil {
		return fmt.Errorf("failed to parse %s %q: %w", kind, name, err)
	}

	fmt.Fprintf(a.stdout, "\n%s%s Reconciliation History — %s/%s%s\n", ansiBold, ansiCyan, kind, name, ansiReset)
	if w.Status.LastAppliedRevision != "" {
		fmt.Fprintf(a.stdout, "%sLast Applied Revision: %s%s\n", ansiGray, w.Status.LastAppliedRevision, ansiReset)
	}
	fmt.Fprintln(a.stdout)

	if len(w.Status.Conditions) == 0 {
		fmt.Fprintf(a.stdout, "%sNo conditions recorded for this resource.%s\n\n", ansiGray, ansiReset)
		return nil
	}

	fmt.Fprintf(a.stdout, "%s%-20s %-8s %-30s %-25s%s\n",
		ansiBold, "TYPE", "STATUS", "REASON", "LAST TRANSITION", ansiReset)
	fmt.Fprintf(a.stdout, "%s\n", strings.Repeat("─", 90))

	for _, c := range w.Status.Conditions {
		statusColor := ansiGreen
		if c.Status == "False" {
			statusColor = ansiRed
		} else if c.Status == "Unknown" {
			statusColor = ansiYellow
		}
		fmt.Fprintf(a.stdout, "%-20s %s%-8s%s %-30s %-25s\n",
			c.Type,
			statusColor, c.Status, ansiReset,
			truncate(c.Reason, 30),
			truncate(c.LastTransitionTime, 25),
		)
		if c.Message != "" {
			fmt.Fprintf(a.stdout, "  %s↳ %s%s\n", ansiGray, truncate(c.Message, 80), ansiReset)
		}
	}
	fmt.Fprintln(a.stdout)
	return nil
}

// ─── GitOps diff via CRD (ArgoCD) ────────────────────────────────────────────

// gitopsDiffArgoCD shows comparedTo sync info from the CRD (no binary needed).
// If argocd binary is available, falls through to it for a proper resource diff.
func (a *app) gitopsDiffArgoCD(appName string) error {
	// Try the argocd binary first for a real diff.
	bin, err := findArgoCDBinary()
	if err == nil {
		cmd := exec.Command(bin, "app", "diff", appName)
		cmd.Stdout = a.stdout
		cmd.Stderr = a.stderr
		return cmd.Run()
	}

	// Binary not found — show sync status + comparedTo from CRD.
	out, kerr := a.captureKubectl([]string{
		"get", "application.argoproj.io", appName, "-n", "argocd", "-o", "json",
	})
	if kerr != nil {
		return fmt.Errorf("argocd diff requires either the argocd CLI or kubectl access to application CRDs\n"+
			"  argocd CLI: %v\n  kubectl: %v", err, kerr)
	}

	var appObj struct {
		Status struct {
			Sync struct {
				Status     string `json:"status"`
				Revision   string `json:"revision"`
				ComparedTo struct {
					Source struct {
						RepoURL        string `json:"repoURL"`
						TargetRevision string `json:"targetRevision"`
						Path           string `json:"path"`
					} `json:"source"`
					Destination struct {
						Namespace string `json:"namespace"`
					} `json:"destination"`
				} `json:"comparedTo"`
			} `json:"sync"`
		} `json:"status"`
	}
	if json.Unmarshal([]byte(out), &appObj) != nil {
		return fmt.Errorf("failed to parse application %q for diff", appName)
	}

	s := appObj.Status.Sync
	fmt.Fprintf(a.stdout, "\n%s%s Diff Info — %s%s\n\n", ansiBold, ansiCyan, appName, ansiReset)
	fmt.Fprintf(a.stdout, "  Sync Status:       %s\n", s.Status)
	fmt.Fprintf(a.stdout, "  Live Revision:     %s\n", s.Revision)
	fmt.Fprintf(a.stdout, "  Desired Revision:  %s\n", s.ComparedTo.Source.TargetRevision)
	fmt.Fprintf(a.stdout, "  Repo:              %s\n", s.ComparedTo.Source.RepoURL)
	fmt.Fprintf(a.stdout, "  Path:              %s\n", s.ComparedTo.Source.Path)
	fmt.Fprintln(a.stdout)
	if s.Status == "OutOfSync" {
		fmt.Fprintf(a.stdout, "%s⚠ Application is OutOfSync. Install argocd CLI for a detailed diff:%s\n", ansiYellow, ansiReset)
		fmt.Fprintf(a.stdout, "  brew install argocd && argocd app diff %s\n\n", appName)
	} else {
		fmt.Fprintf(a.stdout, "%s✓ Application is Synced — no diff.%s\n\n", ansiGreen, ansiReset)
	}
	return nil
}

// ─── newGitopsCmd ─────────────────────────────────────────────────────────────

func newGitopsCmd(a *app) *cobra.Command {
	var engineOverride string

	cmd := &cobra.Command{
		Use:   "gitops",
		Short: "GitOps status and operations — ArgoCD and Flux",
		Long: `kcli gitops provides unified GitOps operations for ArgoCD and Flux.

Auto-detects the installed GitOps engine from the cluster. Override with
--engine=argocd or --engine=flux, or set gitops_engine in ~/.kcli/config.yaml.`,
		GroupID: "workflow",
		RunE: func(cmd *cobra.Command, args []string) error {
			return cmd.Help()
		},
	}
	cmd.PersistentFlags().StringVar(&engineOverride, "engine", "", "GitOps engine to use (argocd|flux)")

	// status
	status := &cobra.Command{
		Use:     "status",
		Short:   "Show GitOps application sync status and health",
		Aliases: []string{"ls", "list"},
		RunE: func(c *cobra.Command, args []string) error {
			engine := gitopsEngine(engineOverride)
			if engine == "" {
				engine = a.detectGitopsEngine()
			}
			switch engine {
			case engineArgoCD:
				return a.gitopsStatusArgoCD()
			case engineFlux:
				return a.gitopsStatusFlux()
			default:
				fmt.Fprintf(a.stdout, "%sNo GitOps engine detected.%s\n\n", ansiYellow, ansiReset)
				fmt.Fprintf(a.stdout, "Install ArgoCD (argocd-server deployment in 'argocd' namespace) or\n")
				fmt.Fprintf(a.stdout, "Flux (flux-system namespace) to use kcli gitops.\n\n")
				fmt.Fprintf(a.stdout, "Or force: kcli gitops --engine=argocd status\n")
				return nil
			}
		},
	}

	// sync
	sync := &cobra.Command{
		Use:   "sync <app>",
		Short: "Trigger a GitOps sync for an application",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			engine := gitopsEngine(engineOverride)
			if engine == "" {
				engine = a.detectGitopsEngine()
			}
			switch engine {
			case engineArgoCD:
				return a.gitopsSyncArgoCD(args[0])
			case engineFlux:
				return a.gitopsSyncFlux(args[0])
			default:
				return fmt.Errorf("no GitOps engine detected — use --engine=argocd or --engine=flux")
			}
		},
	}

	// diff
	diff := &cobra.Command{
		Use:   "diff <app>",
		Short: "Show diff between Git and live cluster state",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			engine := gitopsEngine(engineOverride)
			if engine == "" {
				engine = a.detectGitopsEngine()
			}
			switch engine {
			case engineArgoCD:
				// Uses CRD as fallback if binary not available.
				return a.gitopsDiffArgoCD(args[0])
			case engineFlux:
				// Flux diff requires the flux CLI (no CRD equivalent).
				bin, err := findFluxBinary()
				if err != nil {
					return err
				}
				parts := strings.SplitN(args[0], "/", 2)
				kind, name := "kustomization", args[0]
				if len(parts) == 2 {
					kind, name = parts[0], parts[1]
				}
				cmd := exec.Command(bin, "diff", kind, name)
				cmd.Stdout = a.stdout
				cmd.Stderr = a.stderr
				return cmd.Run()
			default:
				return fmt.Errorf("no GitOps engine detected")
			}
		},
	}

	// rollback
	rollback := &cobra.Command{
		Use:   "rollback <app>",
		Short: "Roll back an application to its last synced revision",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			engine := gitopsEngine(engineOverride)
			if engine == "" {
				engine = a.detectGitopsEngine()
			}
			switch engine {
			case engineArgoCD:
				bin, err := findArgoCDBinary()
				if err != nil {
					return err
				}
				cmd := exec.Command(bin, "app", "rollback", args[0])
				cmd.Stdout = a.stdout
				cmd.Stderr = a.stderr
				return cmd.Run()
			default:
				return fmt.Errorf("rollback is supported for ArgoCD — use --engine=argocd")
			}
		},
	}

	// history
	history := &cobra.Command{
		Use:     "history <app>",
		Short:   "Show deployment history for a GitOps application",
		Args:    cobra.ExactArgs(1),
		Aliases: []string{"hist"},
		RunE: func(c *cobra.Command, args []string) error {
			engine := gitopsEngine(engineOverride)
			if engine == "" {
				engine = a.detectGitopsEngine()
			}
			switch engine {
			case engineArgoCD:
				// Prefers CRD; falls back to argocd binary only if CRD inaccessible.
				return a.gitopsHistoryArgoCD(args[0])
			case engineFlux:
				// Prefers CRD conditions; falls back to flux events binary only if inaccessible.
				return a.gitopsHistoryFlux(args[0])
			default:
				return fmt.Errorf("no GitOps engine detected")
			}
		},
	}

	// lock / unlock (ArgoCD app auto-sync control)
	lock := &cobra.Command{
		Use:   "lock <app>",
		Short: "Disable auto-sync for an ArgoCD application (prevent auto-sync)",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			// Patch the ArgoCD application to disable auto-sync
			patch := `{"spec":{"syncPolicy":null}}`
			if err := a.runKubectl([]string{"patch", "application", args[0], "-n", "argocd",
				"--type=merge", "-p", patch}); err != nil {
				return fmt.Errorf("failed to lock %s: %w", args[0], err)
			}
			fmt.Fprintf(a.stdout, "%s✓ Auto-sync disabled for %s%s\n", ansiYellow, args[0], ansiReset)
			fmt.Fprintf(a.stdout, "%s  Use: kcli gitops unlock %s to re-enable%s\n", ansiGray, args[0], ansiReset)
			return nil
		},
	}

	unlock := &cobra.Command{
		Use:   "unlock <app>",
		Short: "Re-enable auto-sync for an ArgoCD application",
		Args:  cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			patch := `{"spec":{"syncPolicy":{"automated":{"prune":false,"selfHeal":false}}}}`
			if err := a.runKubectl([]string{"patch", "application", args[0], "-n", "argocd",
				"--type=merge", "-p", patch}); err != nil {
				return fmt.Errorf("failed to unlock %s: %w", args[0], err)
			}
			fmt.Fprintf(a.stdout, "%s✓ Auto-sync re-enabled for %s%s\n", ansiGreen, args[0], ansiReset)
			return nil
		},
	}

	// Flux-specific: reconcile, suspend, resume
	reconcile := &cobra.Command{
		Use:   "reconcile <kind/name>",
		Short: "Flux: force reconciliation of a resource (e.g. kustomization/my-app)",
		Long: `Force a Flux reconciliation via the reconcile.fluxcd.io/requestedAt annotation.
No flux binary required — uses kubectl patch to set the annotation and the
Flux controller picks it up immediately.`,
		Args: cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			return a.gitopsSyncFlux(args[0])
		},
	}

	suspend := &cobra.Command{
		Use:   "suspend <kind/name>",
		Short: "Flux: suspend reconciliation of a resource",
		Long: `Suspend Flux reconciliation via kubectl patch (spec.suspend=true).
No flux binary required.`,
		Args: cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			parts := strings.SplitN(args[0], "/", 2)
			kind, name := "kustomization", args[0]
			if len(parts) == 2 {
				kind, name = strings.ToLower(parts[0]), parts[1]
			}
			crdKind := fluxCRDForKind(kind)
			ns := a.namespace
			if ns == "" {
				ns = "flux-system"
			}

			// Primary: kubectl patch spec.suspend=true (no binary needed).
			err := a.runKubectl([]string{
				"patch", crdKind, name, "-n", ns,
				"--type=merge", "-p", `{"spec":{"suspend":true}}`,
			})
			if err == nil {
				fmt.Fprintf(a.stdout, "%s✓ Suspended %s/%s — reconciliation paused%s\n",
					ansiYellow, kind, name, ansiReset)
				fmt.Fprintf(a.stdout, "%s  Use: kcli gitops resume %s to re-enable%s\n",
					ansiGray, args[0], ansiReset)
				return nil
			}

			// Fall back to flux binary.
			bin, berr := findFluxBinary()
			if berr != nil {
				return fmt.Errorf("kubectl patch failed (%v)\n%s", err, berr.Error())
			}
			cmd := exec.Command(bin, "suspend", kind, name)
			cmd.Stdout = a.stdout
			cmd.Stderr = a.stderr
			return cmd.Run()
		},
	}

	resume := &cobra.Command{
		Use:   "resume <kind/name>",
		Short: "Flux: resume reconciliation of a resource",
		Long: `Resume Flux reconciliation via kubectl patch (spec.suspend=false).
No flux binary required.`,
		Args: cobra.ExactArgs(1),
		RunE: func(c *cobra.Command, args []string) error {
			parts := strings.SplitN(args[0], "/", 2)
			kind, name := "kustomization", args[0]
			if len(parts) == 2 {
				kind, name = strings.ToLower(parts[0]), parts[1]
			}
			crdKind := fluxCRDForKind(kind)
			ns := a.namespace
			if ns == "" {
				ns = "flux-system"
			}

			// Primary: kubectl patch spec.suspend=false (no binary needed).
			err := a.runKubectl([]string{
				"patch", crdKind, name, "-n", ns,
				"--type=merge", "-p", `{"spec":{"suspend":false}}`,
			})
			if err == nil {
				fmt.Fprintf(a.stdout, "%s✓ Resumed %s/%s — reconciliation re-enabled%s\n",
					ansiGreen, kind, name, ansiReset)
				return nil
			}

			// Fall back to flux binary.
			bin, berr := findFluxBinary()
			if berr != nil {
				return fmt.Errorf("kubectl patch failed (%v)\n%s", err, berr.Error())
			}
			cmd := exec.Command(bin, "resume", kind, name)
			cmd.Stdout = a.stdout
			cmd.Stderr = a.stderr
			return cmd.Run()
		},
	}

	cmd.AddCommand(status, sync, diff, rollback, history, lock, unlock, reconcile, suspend, resume)
	return cmd
}
