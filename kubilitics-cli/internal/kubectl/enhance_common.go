package kubectl

import (
	"context"
	"fmt"

	"github.com/charmbracelet/lipgloss"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/output"
)

// newEnhanceClient creates a kubernetes clientset from kubeconfig parameters.
func newEnhanceClient(kubeconfigPath, ctx string) (kubernetes.Interface, error) {
	loadingRules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath}
	configOverrides := &clientcmd.ConfigOverrides{}
	if ctx != "" {
		configOverrides.CurrentContext = ctx
	}
	restConfig, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, configOverrides).ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to load kubeconfig: %w", err)
	}
	return kubernetes.NewForConfig(restConfig)
}

// ── Namespaces (cluster-scoped) ──────────────────────────────────────────────

func enhanceNamespaces(kubeconfigPath, ctx string, modifiers []string, sortBy string, outputFormat string) error {
	clientset, err := newEnhanceClient(kubeconfigPath, ctx)
	if err != nil {
		return err
	}

	nsList, err := clientset.CoreV1().Namespaces().List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list namespaces: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeCluster, ClusterName: ctx})
	table.AddNameColumn()
	table.AddStatusColumn("")
	table.AddAgeColumn()

	for _, ns := range nsList.Items {
		table.AddRow([]string{
			ctx,
			ns.Name,
			output.FormatStatus(string(ns.Status.Phase)),
			output.FormatAge(ns.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}
	table.Print()
	return nil
}

// ── ConfigMaps (namespace-scoped) ────────────────────────────────────────────

func enhanceConfigMaps(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
	clientset, err := newEnhanceClient(kubeconfigPath, ctx)
	if err != nil {
		return err
	}
	if allNamespaces {
		namespace = ""
	}

	cmList, err := clientset.CoreV1().ConfigMaps(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list configmaps: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddColumn(output.Column{Name: "DATA", Priority: output.PriorityCritical, MinWidth: 4, MaxWidth: 8, Align: output.Right})
	table.AddAgeColumn()

	for _, cm := range cmList.Items {
		table.AddRow([]string{
			cm.Namespace,
			cm.Name,
			fmt.Sprintf("%d", len(cm.Data)),
			output.FormatAge(cm.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}
	table.Print()
	return nil
}

// ── Secrets (namespace-scoped) ───────────────────────────────────────────────

func enhanceSecrets(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
	clientset, err := newEnhanceClient(kubeconfigPath, ctx)
	if err != nil {
		return err
	}
	if allNamespaces {
		namespace = ""
	}

	secretList, err := clientset.CoreV1().Secrets(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list secrets: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddColumn(output.Column{Name: "TYPE", Priority: output.PrioritySecondary, MinWidth: 15, MaxWidth: 40, Align: output.Left,
		ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Muted },
	})
	table.AddColumn(output.Column{Name: "DATA", Priority: output.PriorityCritical, MinWidth: 4, MaxWidth: 8, Align: output.Right})
	table.AddAgeColumn()

	for _, sec := range secretList.Items {
		table.AddRow([]string{
			sec.Namespace,
			sec.Name,
			string(sec.Type),
			fmt.Sprintf("%d", len(sec.Data)),
			output.FormatAge(sec.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}
	table.Print()
	return nil
}

// ── Jobs (namespace-scoped) ──────────────────────────────────────────────────

func enhanceJobs(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
	clientset, err := newEnhanceClient(kubeconfigPath, ctx)
	if err != nil {
		return err
	}
	if allNamespaces {
		namespace = ""
	}

	jobList, err := clientset.BatchV1().Jobs(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list jobs: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddStatusColumn("job")
	table.AddColumn(output.Column{Name: "COMPLETIONS", Priority: output.PriorityCritical, MinWidth: 11, MaxWidth: 14, Align: output.Right,
		ColorFunc: output.ReadyColorFunc(),
	})
	table.AddColumn(output.Column{Name: "DURATION", Priority: output.PrioritySecondary, MinWidth: 10, MaxWidth: 15, Align: output.Left})
	table.AddAgeColumn()

	for _, job := range jobList.Items {
		status := "Running"
		if job.Status.Succeeded > 0 {
			status = "Complete"
		} else if job.Status.Failed > 0 {
			status = "Failed"
		}

		completions := int32(1)
		if job.Spec.Completions != nil {
			completions = *job.Spec.Completions
		}

		duration := "-"
		if job.Status.StartTime != nil {
			if job.Status.CompletionTime != nil {
				d := job.Status.CompletionTime.Sub(job.Status.StartTime.Time)
				duration = output.FormatDuration(d)
			} else {
				duration = "running"
			}
		}

		table.AddRow([]string{
			job.Namespace,
			job.Name,
			output.FormatStatus(status),
			fmt.Sprintf("%d/%d", job.Status.Succeeded, completions),
			duration,
			output.FormatAge(job.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}
	table.Print()
	return nil
}

// ── CronJobs (namespace-scoped) ──────────────────────────────────────────────

func enhanceCronJobs(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
	clientset, err := newEnhanceClient(kubeconfigPath, ctx)
	if err != nil {
		return err
	}
	if allNamespaces {
		namespace = ""
	}

	cjList, err := clientset.BatchV1().CronJobs(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list cronjobs: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddColumn(output.Column{Name: "SCHEDULE", Priority: output.PriorityCritical, MinWidth: 12, MaxWidth: 25, Align: output.Left})
	table.AddColumn(output.Column{
		Name: "SUSPEND", Priority: output.PrioritySecondary, MinWidth: 7, MaxWidth: 10, Align: output.Left,
		ColorFunc: func(v string) lipgloss.Style {
			if v == "true" {
				return output.GetTheme().Warning
			}
			return output.GetTheme().StatusReady
		},
	})
	table.AddColumn(output.Column{Name: "ACTIVE", Priority: output.PrioritySecondary, MinWidth: 6, MaxWidth: 8, Align: output.Right})
	table.AddColumn(output.Column{Name: "LAST SCHEDULE", Priority: output.PrioritySecondary, MinWidth: 12, MaxWidth: 18, Align: output.Left,
		ColorFunc: output.AgeColorFunc(),
	})
	table.AddAgeColumn()

	for _, cj := range cjList.Items {
		suspended := "false"
		if cj.Spec.Suspend != nil && *cj.Spec.Suspend {
			suspended = "true"
		}

		lastSchedule := "-"
		if cj.Status.LastScheduleTime != nil {
			lastSchedule = output.FormatAge(cj.Status.LastScheduleTime.Time)
		}

		table.AddRow([]string{
			cj.Namespace,
			cj.Name,
			cj.Spec.Schedule,
			suspended,
			fmt.Sprintf("%d", len(cj.Status.Active)),
			lastSchedule,
			output.FormatAge(cj.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}
	table.Print()
	return nil
}

// ── ReplicaSets (namespace-scoped) ───────────────────────────────────────────

func enhanceReplicaSets(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
	clientset, err := newEnhanceClient(kubeconfigPath, ctx)
	if err != nil {
		return err
	}
	if allNamespaces {
		namespace = ""
	}

	rsList, err := clientset.AppsV1().ReplicaSets(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list replicasets: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddColumn(output.Column{Name: "DESIRED", Priority: output.PriorityCritical, MinWidth: 7, MaxWidth: 10, Align: output.Right})
	table.AddColumn(output.Column{Name: "CURRENT", Priority: output.PriorityCritical, MinWidth: 7, MaxWidth: 10, Align: output.Right})
	table.AddReadyColumn()
	table.AddAgeColumn()

	for _, rs := range rsList.Items {
		desired := int32(0)
		if rs.Spec.Replicas != nil {
			desired = *rs.Spec.Replicas
		}
		table.AddRow([]string{
			rs.Namespace,
			rs.Name,
			fmt.Sprintf("%d", desired),
			fmt.Sprintf("%d", rs.Status.Replicas),
			fmt.Sprintf("%d/%d", rs.Status.ReadyReplicas, desired),
			output.FormatAge(rs.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}
	table.Print()
	return nil
}
