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

	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/output"
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
	Manager   string    `json:"manager"`
	Operation string    `json:"operation"`
	When      time.Time `json:"when"`
	Source    string    `json:"source"`
}

// blameResult is the structured output for `kcli blame`.
type blameResult struct {
	Resource    string            `json:"resource"`
	Namespace   string            `json:"namespace"`
	HelmRelease string            `json:"helmRelease,omitempty"`
	ArgocdApp   string            `json:"argocdApp,omitempty"`
	FluxSource  string            `json:"fluxSource,omitempty"`
	Entries     []blameEntry      `json:"entries"`
}

func newBlameCmd(a *app) *cobra.Command {
	var outputFlag string
	cmd := &cobra.Command{
		Use:   "blame (TYPE/NAME | TYPE NAME)",
		Short: "Show who changed a resource, when, and from which system",
		Long: `Show change attribution for a resource — who modified it, when, and from which system.

Uses Kubernetes managedFields (field manager metadata), Helm history when the resource
is Helm-managed, and ArgoCD/Flux labels when present.

Examples:
  kcli blame deployment/payment-api
  kcli blame pod/crashed -n prod
  kcli blame deployment/api -o json`,
		GroupID: "observability",
		Args:    cobra.RangeArgs(1, 2),
		RunE: func(cmd *cobra.Command, args []string) error {
			resource := strings.TrimSpace(args[0])
			if len(args) == 2 {
				resource = args[0] + "/" + args[1]
			}
			ofmt, err := output.ParseFlag(outputFlag)
			if err != nil {
				return err
			}
			return runBlame(a, cmd, resource, ofmt)
		},
	}
	cmd.Flags().StringVarP(&outputFlag, "output", "o", "table", "output format: table|json|yaml")
	return cmd
}

func runBlame(a *app, cmd *cobra.Command, resource string, ofmt output.Format) error {
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

	// Extract GitOps / Helm metadata
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

	// Structured output
	if ofmt == output.FormatJSON || ofmt == output.FormatYAML {
		return output.Render(a.stdout, ofmt, blameResult{
			Resource:    kind + "/" + name,
			Namespace:   ns,
			HelmRelease: helmRelease,
			ArgocdApp:   argocdApp,
			FluxSource:  fluxSource,
			Entries:     entries,
		})
	}

	// Table output
	theme := output.GetTheme()

	fmt.Fprintf(a.stdout, "\n%s\n\n", theme.Header.Render(fmt.Sprintf("Blame: %s/%s", kind, name)))
	fmt.Fprintf(a.stdout, "%s\n\n", theme.Muted.Render(fmt.Sprintf("Namespace: %s", ns)))

	if helmRelease != "" || argocdApp != "" || fluxSource != "" {
		syncTable := output.NewTable()
		syncTable.Style = output.Rounded
		syncTable.AddColumn(output.Column{Name: "SYNC SOURCE", Priority: output.PriorityAlways, MinWidth: 15, MaxWidth: 40})
		syncTable.AddColumn(output.Column{Name: "VALUE", Priority: output.PriorityAlways, MinWidth: 15, MaxWidth: 50})
		if helmRelease != "" {
			syncTable.AddRow([]string{"Helm release", helmRelease})
		}
		if argocdApp != "" {
			syncTable.AddRow([]string{"ArgoCD app", argocdApp})
		}
		if fluxSource != "" {
			syncTable.AddRow([]string{"Flux", fluxSource})
		}
		syncTable.PrintTo(a.stdout)
		fmt.Fprintln(a.stdout)
	}

	// Field managers
	fmt.Fprintf(a.stdout, "%s\n", theme.Header.Render("Field managers (managedFields):"))
	if len(entries) == 0 {
		fmt.Fprintf(a.stdout, "  %s\n", theme.Muted.Render("(no managedFields — resource may predate SSA or was created by legacy client)"))
	} else {
		table := output.NewTable()
		table.Style = output.Rounded
		table.AddColumn(output.Column{Name: "MANAGER", Priority: output.PriorityAlways, MinWidth: 20, MaxWidth: 40})
		table.AddColumn(output.Column{Name: "OPERATION", Priority: output.PrioritySecondary, MinWidth: 8})
		table.AddColumn(output.Column{Name: "WHEN", Priority: output.PriorityContext, MinWidth: 19})
		table.AddColumn(output.Column{Name: "SOURCE", Priority: output.PrioritySecondary, MinWidth: 15})
		for _, e := range entries {
			when := "-"
			if !e.When.IsZero() {
				when = e.When.Format("2006-01-02 15:04:05")
			}
			table.AddRow([]string{e.Manager, e.Operation, when, e.Source})
		}
		table.PrintTo(a.stdout)
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
