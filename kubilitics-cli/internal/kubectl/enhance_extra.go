package kubectl

import (
	"context"
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/output"
)

// ── ServiceAccounts (namespace-scoped) ───────────────────────────────────────

func enhanceServiceAccounts(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
	clientset, err := newEnhanceClient(kubeconfigPath, ctx)
	if err != nil {
		return err
	}
	if allNamespaces {
		namespace = ""
	}

	saList, err := clientset.CoreV1().ServiceAccounts(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list serviceaccounts: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddColumn(output.Column{Name: "SECRETS", Priority: output.PriorityCritical, MinWidth: 7, MaxWidth: 10, Align: output.Right})
	table.AddAgeColumn()

	for _, sa := range saList.Items {
		table.AddRow([]string{
			sa.Namespace,
			sa.Name,
			fmt.Sprintf("%d", len(sa.Secrets)),
			output.FormatAge(sa.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}
	table.Print()
	return nil
}

// ── Endpoints (namespace-scoped) ─────────────────────────────────────────────

func enhanceEndpoints(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
	clientset, err := newEnhanceClient(kubeconfigPath, ctx)
	if err != nil {
		return err
	}
	if allNamespaces {
		namespace = ""
	}

	epList, err := clientset.CoreV1().Endpoints(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list endpoints: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddColumn(output.Column{Name: "ENDPOINTS", Priority: output.PriorityCritical, MinWidth: 20, MaxWidth: 60, Align: output.Left})
	table.AddAgeColumn()

	for _, ep := range epList.Items {
		var addrs []string
		for _, subset := range ep.Subsets {
			for _, addr := range subset.Addresses {
				for _, port := range subset.Ports {
					addrs = append(addrs, fmt.Sprintf("%s:%d", addr.IP, port.Port))
				}
			}
		}
		epStr := "<none>"
		if len(addrs) > 0 {
			if len(addrs) > 3 {
				epStr = strings.Join(addrs[:3], ", ") + fmt.Sprintf(" + %d more", len(addrs)-3)
			} else {
				epStr = strings.Join(addrs, ", ")
			}
		}
		table.AddRow([]string{
			ep.Namespace,
			ep.Name,
			epStr,
			output.FormatAge(ep.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}
	table.Print()
	return nil
}

// ── HPA (namespace-scoped) ───────────────────────────────────────────────────

func enhanceHPAs(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
	clientset, err := newEnhanceClient(kubeconfigPath, ctx)
	if err != nil {
		return err
	}
	if allNamespaces {
		namespace = ""
	}

	hpaList, err := clientset.AutoscalingV2().HorizontalPodAutoscalers(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list HPAs: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddColumn(output.Column{Name: "REFERENCE", Priority: output.PriorityCritical, MinWidth: 15, MaxWidth: 35, Align: output.Left,
		ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Info },
	})
	table.AddColumn(output.Column{Name: "TARGETS", Priority: output.PriorityCritical, MinWidth: 12, MaxWidth: 25, Align: output.Left})
	table.AddColumn(output.Column{Name: "MINPODS", Priority: output.PrioritySecondary, MinWidth: 7, MaxWidth: 10, Align: output.Right})
	table.AddColumn(output.Column{Name: "MAXPODS", Priority: output.PrioritySecondary, MinWidth: 7, MaxWidth: 10, Align: output.Right})
	table.AddColumn(output.Column{Name: "REPLICAS", Priority: output.PriorityCritical, MinWidth: 8, MaxWidth: 10, Align: output.Right})
	table.AddAgeColumn()

	for _, hpa := range hpaList.Items {
		ref := fmt.Sprintf("%s/%s", hpa.Spec.ScaleTargetRef.Kind, hpa.Spec.ScaleTargetRef.Name)

		// Build targets string
		var targets []string
		for _, metric := range hpa.Spec.Metrics {
			if metric.Resource != nil && metric.Resource.Target.AverageUtilization != nil {
				targets = append(targets, fmt.Sprintf("%s: %d%%", metric.Resource.Name, *metric.Resource.Target.AverageUtilization))
			}
		}
		targetStr := "<none>"
		if len(targets) > 0 {
			targetStr = strings.Join(targets, ", ")
		}

		minPods := int32(1)
		if hpa.Spec.MinReplicas != nil {
			minPods = *hpa.Spec.MinReplicas
		}

		table.AddRow([]string{
			hpa.Namespace,
			hpa.Name,
			ref,
			targetStr,
			fmt.Sprintf("%d", minPods),
			fmt.Sprintf("%d", hpa.Spec.MaxReplicas),
			fmt.Sprintf("%d", hpa.Status.CurrentReplicas),
			output.FormatAge(hpa.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}
	table.Print()
	return nil
}

// ── NetworkPolicies (namespace-scoped) ───────────────────────────────────────

func enhanceNetworkPolicies(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
	clientset, err := newEnhanceClient(kubeconfigPath, ctx)
	if err != nil {
		return err
	}
	if allNamespaces {
		namespace = ""
	}

	npList, err := clientset.NetworkingV1().NetworkPolicies(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list networkpolicies: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddColumn(output.Column{Name: "POD SELECTOR", Priority: output.PriorityCritical, MinWidth: 15, MaxWidth: 40, Align: output.Left,
		ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Muted },
	})
	table.AddColumn(output.Column{Name: "POLICY TYPES", Priority: output.PriorityCritical, MinWidth: 12, MaxWidth: 25, Align: output.Left})
	table.AddAgeColumn()

	for _, np := range npList.Items {
		selector := formatLabels(np.Spec.PodSelector.MatchLabels)
		var types []string
		for _, pt := range np.Spec.PolicyTypes {
			types = append(types, string(pt))
		}
		typeStr := strings.Join(types, ", ")
		if typeStr == "" {
			typeStr = "Ingress"
		}

		table.AddRow([]string{
			np.Namespace,
			np.Name,
			selector,
			typeStr,
			output.FormatAge(np.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}
	table.Print()
	return nil
}

// ── Roles (namespace-scoped) ─────────────────────────────────────────────────

func enhanceRoles(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
	clientset, err := newEnhanceClient(kubeconfigPath, ctx)
	if err != nil {
		return err
	}
	if allNamespaces {
		namespace = ""
	}

	roleList, err := clientset.RbacV1().Roles(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list roles: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddColumn(output.Column{Name: "RULES", Priority: output.PriorityCritical, MinWidth: 5, MaxWidth: 8, Align: output.Right})
	table.AddAgeColumn()

	for _, role := range roleList.Items {
		table.AddRow([]string{
			role.Namespace,
			role.Name,
			fmt.Sprintf("%d", len(role.Rules)),
			output.FormatAge(role.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}
	table.Print()
	return nil
}

// ── RoleBindings (namespace-scoped) ──────────────────────────────────────────

func enhanceRoleBindings(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
	clientset, err := newEnhanceClient(kubeconfigPath, ctx)
	if err != nil {
		return err
	}
	if allNamespaces {
		namespace = ""
	}

	rbList, err := clientset.RbacV1().RoleBindings(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list rolebindings: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddColumn(output.Column{Name: "ROLE", Priority: output.PriorityCritical, MinWidth: 15, MaxWidth: 40, Align: output.Left,
		ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Info },
	})
	table.AddColumn(output.Column{Name: "SUBJECTS", Priority: output.PrioritySecondary, MinWidth: 10, MaxWidth: 30, Align: output.Right})
	table.AddAgeColumn()

	for _, rb := range rbList.Items {
		roleRef := fmt.Sprintf("%s/%s", rb.RoleRef.Kind, rb.RoleRef.Name)
		table.AddRow([]string{
			rb.Namespace,
			rb.Name,
			roleRef,
			fmt.Sprintf("%d", len(rb.Subjects)),
			output.FormatAge(rb.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}
	table.Print()
	return nil
}

// ── ClusterRoles (cluster-scoped) ────────────────────────────────────────────

func enhanceClusterRoles(kubeconfigPath, ctx string, modifiers []string, sortBy string, outputFormat string) error {
	clientset, err := newEnhanceClient(kubeconfigPath, ctx)
	if err != nil {
		return err
	}

	crList, err := clientset.RbacV1().ClusterRoles().List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list clusterroles: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeCluster, ClusterName: ctx})
	table.AddNameColumn()
	table.AddColumn(output.Column{Name: "RULES", Priority: output.PriorityCritical, MinWidth: 5, MaxWidth: 8, Align: output.Right})
	table.AddAgeColumn()

	for _, cr := range crList.Items {
		table.AddRow([]string{
			ctx,
			cr.Name,
			fmt.Sprintf("%d", len(cr.Rules)),
			output.FormatAge(cr.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}
	table.Print()
	return nil
}

// ── ClusterRoleBindings (cluster-scoped) ─────────────────────────────────────

func enhanceClusterRoleBindings(kubeconfigPath, ctx string, modifiers []string, sortBy string, outputFormat string) error {
	clientset, err := newEnhanceClient(kubeconfigPath, ctx)
	if err != nil {
		return err
	}

	crbList, err := clientset.RbacV1().ClusterRoleBindings().List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list clusterrolebindings: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeCluster, ClusterName: ctx})
	table.AddNameColumn()
	table.AddColumn(output.Column{Name: "ROLE", Priority: output.PriorityCritical, MinWidth: 20, MaxWidth: 50, Align: output.Left,
		ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Info },
	})
	table.AddColumn(output.Column{Name: "SUBJECTS", Priority: output.PrioritySecondary, MinWidth: 8, MaxWidth: 10, Align: output.Right})
	table.AddAgeColumn()

	for _, crb := range crbList.Items {
		roleRef := fmt.Sprintf("%s/%s", crb.RoleRef.Kind, crb.RoleRef.Name)
		table.AddRow([]string{
			ctx,
			crb.Name,
			roleRef,
			fmt.Sprintf("%d", len(crb.Subjects)),
			output.FormatAge(crb.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}
	table.Print()
	return nil
}

// ── StorageClasses (cluster-scoped) ──────────────────────────────────────────

func enhanceStorageClasses(kubeconfigPath, ctx string, modifiers []string, sortBy string, outputFormat string) error {
	clientset, err := newEnhanceClient(kubeconfigPath, ctx)
	if err != nil {
		return err
	}

	scList, err := clientset.StorageV1().StorageClasses().List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list storageclasses: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeCluster, ClusterName: ctx})
	table.AddNameColumn()
	table.AddColumn(output.Column{Name: "PROVISIONER", Priority: output.PriorityCritical, MinWidth: 20, MaxWidth: 40, Align: output.Left})
	table.AddColumn(output.Column{Name: "RECLAIM POLICY", Priority: output.PrioritySecondary, MinWidth: 14, MaxWidth: 18, Align: output.Left})
	table.AddColumn(output.Column{Name: "VOLUME BINDING", Priority: output.PrioritySecondary, MinWidth: 14, MaxWidth: 22, Align: output.Left})
	table.AddColumn(output.Column{Name: "ALLOW EXPAND", Priority: output.PrioritySecondary, MinWidth: 12, MaxWidth: 14, Align: output.Left,
		ColorFunc: func(v string) lipgloss.Style {
			if v == "true" {
				return output.GetTheme().Success
			}
			return output.GetTheme().Muted
		},
	})
	table.AddAgeColumn()

	for _, sc := range scList.Items {
		reclaimPolicy := "Delete"
		if sc.ReclaimPolicy != nil {
			reclaimPolicy = string(*sc.ReclaimPolicy)
		}
		volumeBinding := "Immediate"
		if sc.VolumeBindingMode != nil {
			volumeBinding = string(*sc.VolumeBindingMode)
		}
		allowExpand := "false"
		if sc.AllowVolumeExpansion != nil && *sc.AllowVolumeExpansion {
			allowExpand = "true"
		}
		name := sc.Name
		if sc.Annotations["storageclass.kubernetes.io/is-default-class"] == "true" {
			name += " (default)"
		}

		table.AddRow([]string{
			ctx,
			name,
			sc.Provisioner,
			reclaimPolicy,
			volumeBinding,
			allowExpand,
			output.FormatAge(sc.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}
	table.Print()
	return nil
}

// ── LimitRanges (namespace-scoped) ───────────────────────────────────────────

func enhanceLimitRanges(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
	clientset, err := newEnhanceClient(kubeconfigPath, ctx)
	if err != nil {
		return err
	}
	if allNamespaces {
		namespace = ""
	}

	lrList, err := clientset.CoreV1().LimitRanges(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list limitranges: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddColumn(output.Column{Name: "LIMITS", Priority: output.PriorityCritical, MinWidth: 6, MaxWidth: 10, Align: output.Right})
	table.AddAgeColumn()

	for _, lr := range lrList.Items {
		table.AddRow([]string{
			lr.Namespace,
			lr.Name,
			fmt.Sprintf("%d", len(lr.Spec.Limits)),
			output.FormatAge(lr.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}
	table.Print()
	return nil
}

// ── ResourceQuotas (namespace-scoped) ────────────────────────────────────────

func enhanceResourceQuotas(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
	clientset, err := newEnhanceClient(kubeconfigPath, ctx)
	if err != nil {
		return err
	}
	if allNamespaces {
		namespace = ""
	}

	rqList, err := clientset.CoreV1().ResourceQuotas(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list resourcequotas: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddColumn(output.Column{Name: "RESOURCES", Priority: output.PriorityCritical, MinWidth: 8, MaxWidth: 12, Align: output.Right})
	table.AddAgeColumn()

	for _, rq := range rqList.Items {
		table.AddRow([]string{
			rq.Namespace,
			rq.Name,
			fmt.Sprintf("%d", len(rq.Status.Hard)),
			output.FormatAge(rq.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}
	table.Print()
	return nil
}
