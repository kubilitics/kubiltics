// blame.go — kcli blame: change attribution (P3-3).
//
// Shows who changed a resource, when, and from which system. Uses:
// - managedFields (manager, operation, time) from the resource
// - Helm history when the resource is Helm-managed
// - ArgoCD/Flux labels when present (surfaces sync source)
package cli

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

type managedFieldEntry struct {
	Manager    string `json:"manager"`
	Operation  string `json:"operation"`
	Time       string `json:"time"`
	APIVersion string `json:"apiVersion,omitempty"`
}

type blameResource struct {
	Metadata struct {
		Name        string            `json:"name"`
		Namespace   string            `json:"namespace"`
		Labels      map[string]string  `json:"labels"`
		Annotations map[string]string  `json:"annotations"`
		ManagedFields []managedFieldEntry `json:"managedFields"`
	} `json:"metadata"`
}

type blameEntry struct {
	Manager   string
	Operation string
	When      time.Time
	Source    string
}

func newBlameCmd(a *app) *cobra.Command {
	return &cobra.Command{
		Use:   "blame (TYPE/NAME | TYPE NAME)",
		Short: "Show who changed a resource, when, and from which system",
		Long: `Show change attribution for a resource — who modified it, when, and from which system.

Uses Kubernetes managedFields (field manager metadata), Helm history when the resource
is Helm-managed, and ArgoCD/Flux labels when present.

Examples:
  kcli blame deployment/payment-api
  kcli blame pod/crashed -n prod`,
		GroupID: "observability",
		Args:    cobra.RangeArgs(1, 2),
		RunE: func(cmd *cobra.Command, args []string) error {
			resource := strings.TrimSpace(args[0])
			if len(args) == 2 {
				resource = args[0] + "/" + args[1]
			}
			return runBlame(a, cmd, resource)
		},
	}
}

func runBlame(a *app, cmd *cobra.Command, resource string) error {
	parts := strings.SplitN(resource, "/", 2)
	if len(parts) != 2 {
		return fmt.Errorf("resource must be TYPE/NAME (e.g. deployment/payment-api)")
	}
	kind, name := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
	if kind == "" || name == "" {
		return fmt.Errorf("resource must be TYPE/NAME")
	}

	args := []string{"get", kind, name, "-o", "json"}
	if a.namespace != "" {
		args = append(args, "-n", a.namespace)
	}
	out, err := a.captureKubectl(args)
	if err != nil {
		return fmt.Errorf("failed to get resource: %w", err)
	}

	var res blameResource
	if err := json.Unmarshal([]byte(out), &res); err != nil {
		return fmt.Errorf("failed to parse resource: %w", err)
	}

	ns := res.Metadata.Namespace
	if ns == "" {
		ns = "default"
	}

	// Collect blame entries from managedFields
	var entries []blameEntry
	for _, mf := range res.Metadata.ManagedFields {
		if mf.Manager == "" {
			continue
		}
		var t time.Time
		if mf.Time != "" {
			t, _ = time.Parse(time.RFC3339, mf.Time)
		}
		source := inferSource(mf.Manager)
		entries = append(entries, blameEntry{
			Manager:   mf.Manager,
			Operation: mf.Operation,
			When:      t,
			Source:    source,
		})
	}

	// Sort by time descending (most recent first)
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].When.After(entries[j].When)
	})

	// Print header
	fmt.Fprintf(a.stdout, "\n%s%s Blame: %s/%s%s\n\n",
		ansiBold, ansiCyan, kind, name, ansiReset)
	fmt.Fprintf(a.stdout, "%sNamespace: %s%s\n\n", ansiGray, ns, ansiReset)

	// GitOps / Helm metadata
	helmRelease := ""
	if res.Metadata.Annotations != nil {
		if r := res.Metadata.Annotations["meta.helm.sh/release-name"]; r != "" {
			helmRelease = r
		}
	}
	argocdApp := ""
	if res.Metadata.Labels != nil {
		if instance := res.Metadata.Labels["argocd.argoproj.io/instance"]; instance != "" {
			argocdApp = instance
		} else if instance := res.Metadata.Labels["app.kubernetes.io/instance"]; instance != "" {
			argocdApp = instance
		}
	}
	fluxSource := ""
	if res.Metadata.Annotations != nil {
		if k := res.Metadata.Annotations["kustomize.toolkit.fluxcd.io/checksum"]; k != "" {
			fluxSource = "Flux Kustomization"
		}
		if h := res.Metadata.Annotations["helm.toolkit.fluxcd.io/checksum"]; h != "" {
			fluxSource = "Flux HelmRelease"
		}
	}

	if helmRelease != "" || argocdApp != "" || fluxSource != "" {
		fmt.Fprintf(a.stdout, "%sSync source:%s\n", ansiBold, ansiReset)
		if helmRelease != "" {
			fmt.Fprintf(a.stdout, "  Helm release: %s\n", helmRelease)
		}
		if argocdApp != "" {
			fmt.Fprintf(a.stdout, "  ArgoCD app:  %s\n", argocdApp)
		}
		if fluxSource != "" {
			fmt.Fprintf(a.stdout, "  %s\n", fluxSource)
		}
		fmt.Fprintln(a.stdout)
	}

	// Helm history (if Helm-managed)
	if helmRelease != "" {
		histArgs := []string{"history", helmRelease, "--max", "10", "-n", ns}
		histOut, err := a.captureHelm(histArgs)
		if err == nil && strings.TrimSpace(histOut) != "" {
			fmt.Fprintf(a.stdout, "%sHelm history (last 10):%s\n", ansiBold, ansiReset)
			lines := strings.Split(strings.TrimSpace(histOut), "\n")
			for i, line := range lines {
				if i == 0 {
					fmt.Fprintf(a.stdout, "  %s\n", line)
					continue
				}
				fields := strings.Fields(line)
				if len(fields) >= 4 {
					rev, status, chart, updated := fields[0], fields[1], fields[2], strings.Join(fields[3:], " ")
					fmt.Fprintf(a.stdout, "  %s %s %s %s\n", rev, status, chart, updated)
				} else {
					fmt.Fprintf(a.stdout, "  %s\n", line)
				}
			}
			fmt.Fprintln(a.stdout)
		}
	}

	// Field managers
	fmt.Fprintf(a.stdout, "%sField managers (managedFields):%s\n", ansiBold, ansiReset)
	if len(entries) == 0 {
		fmt.Fprintf(a.stdout, "  %s(no managedFields — resource may predate SSA or was created by legacy client)%s\n", ansiGray, ansiReset)
	} else {
		fmt.Fprintf(a.stdout, "  %-40s %-8s %-22s %s\n", "MANAGER", "OP", "WHEN", "SOURCE")
		fmt.Fprintf(a.stdout, "  %s\n", strings.Repeat("─", 85))
		for _, e := range entries {
			when := "-"
			if !e.When.IsZero() {
				when = e.When.Format("2006-01-02 15:04:05")
			}
			fmt.Fprintf(a.stdout, "  %-40s %-8s %-22s %s\n",
				truncate(e.Manager, 40), e.Operation, when, e.Source)
		}
	}
	fmt.Fprintln(a.stdout)
	return nil
}

func inferSource(manager string) string {
	m := strings.ToLower(manager)
	switch {
	case strings.Contains(m, "helm"):
		return "Helm"
	case strings.Contains(m, "argocd"), strings.Contains(m, "argo-cd"):
		return "ArgoCD"
	case strings.Contains(m, "flux"):
		return "Flux"
	case strings.Contains(m, "kubectl"):
		return "kubectl"
	case strings.Contains(m, "kube-controller"):
		return "kube-controller-manager"
	case strings.Contains(m, "kubelet"):
		return "kubelet"
	case strings.Contains(m, "kube-scheduler"):
		return "kube-scheduler"
	default:
		return "-"
	}
}
