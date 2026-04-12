package kubectl

import (
	"context"
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/output"
)

// ── Persistent Volumes (cluster-scoped) ─────────────────────────────────────

var pvSupportedModifiers = map[string]bool{
	"capacity":       true,
	"storage-class":  true,
	"access-modes":   true,
	"reclaim-policy": true,
	"status":         true,
	"all":            true,
}

func enhancePersistentVolumes(kubeconfigPath string, modifiers []string, sortBy string, outputFormat string) error {
	config, err := clientcmd.BuildConfigFromFlags("", kubeconfigPath)
	if err != nil {
		return fmt.Errorf("failed to load kubeconfig: %w", err)
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return fmt.Errorf("failed to create kubernetes client: %w", err)
	}

	if err := validateModifiers("persistentvolume", modifiers, pvSupportedModifiers); err != nil {
		return err
	}

	modifiers = parseAllModifier(modifiers, pvSupportedModifiers)

	pvList, err := clientset.CoreV1().PersistentVolumes().List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list persistent volumes: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeCluster})
	table.AddNameColumn()
	table.AddColumn(output.Column{Name: "CAPACITY", Priority: output.PrioritySecondary, MinWidth: 8, MaxWidth: 12, Align: output.Right})
	table.AddColumn(output.Column{Name: "ACCESS MODES", Priority: output.PrioritySecondary, MinWidth: 12, MaxWidth: 20, Align: output.Left})
	table.AddColumn(output.Column{Name: "RECLAIM POLICY", Priority: output.PrioritySecondary, MinWidth: 14, MaxWidth: 18, Align: output.Left})
	table.AddColumn(output.Column{
		Name: "STATUS", Priority: output.PriorityCritical, MinWidth: 10, MaxWidth: 15, Align: output.Left,
		ColorFunc: output.StatusColorFunc("pvc"),
	})
	table.AddColumn(output.Column{Name: "CLAIM", Priority: output.PrioritySecondary, MinWidth: 15, MaxWidth: 40, Align: output.Left})
	table.AddColumn(output.Column{Name: "STORAGE CLASS", Priority: output.PrioritySecondary, MinWidth: 12, MaxWidth: 25, Align: output.Left})
	table.AddAgeColumn()

	for _, pv := range pvList.Items {
		claim := "<unbound>"
		if pv.Spec.ClaimRef != nil {
			claim = fmt.Sprintf("%s/%s", pv.Spec.ClaimRef.Namespace, pv.Spec.ClaimRef.Name)
		}

		accessModes := make([]string, len(pv.Spec.AccessModes))
		for i, mode := range pv.Spec.AccessModes {
			accessModes[i] = string(mode)
		}

		table.AddRow([]string{
			"", // CLUSTER column placeholder
			pv.Name,
			getPVCapacity(&pv),
			strings.Join(accessModes, ","),
			string(pv.Spec.PersistentVolumeReclaimPolicy),
			output.FormatStatus(string(pv.Status.Phase)),
			claim,
			pv.Spec.StorageClassName,
			output.FormatAge(pv.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}

	table.Print()
	return nil
}

func getPVCapacity(pv *corev1.PersistentVolume) string {
	capacity := pv.Spec.Capacity.Storage()
	if capacity != nil {
		return capacity.String()
	}
	return "<none>"
}

// ── Persistent Volume Claims (namespace-scoped) ─────────────────────────────

var pvcSupportedModifiers = map[string]bool{
	"capacity":      true,
	"storage-class": true,
	"access-modes":  true,
	"volume":        true,
	"status":        true,
	"all":           true,
}

func enhancePersistentVolumeClaims(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
	loadingRules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath}
	configOverrides := &clientcmd.ConfigOverrides{}
	if ctx != "" {
		configOverrides.CurrentContext = ctx
	}
	restConfig, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, configOverrides).ClientConfig()
	if err != nil {
		return fmt.Errorf("failed to load kubeconfig: %w", err)
	}

	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return fmt.Errorf("failed to create kubernetes client: %w", err)
	}

	if err := validateModifiers("persistentvolumeclaim", modifiers, pvcSupportedModifiers); err != nil {
		return err
	}

	modifiers = parseAllModifier(modifiers, pvcSupportedModifiers)

	if allNamespaces {
		namespace = ""
	}

	pvcList, err := clientset.CoreV1().PersistentVolumeClaims(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list persistent volume claims: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddColumn(output.Column{
		Name: "STATUS", Priority: output.PriorityCritical, MinWidth: 10, MaxWidth: 15, Align: output.Left,
		ColorFunc: output.StatusColorFunc("pvc"),
	})
	table.AddColumn(output.Column{Name: "VOLUME", Priority: output.PrioritySecondary, MinWidth: 15, MaxWidth: 40, Align: output.Left})
	table.AddColumn(output.Column{Name: "CAPACITY", Priority: output.PrioritySecondary, MinWidth: 8, MaxWidth: 12, Align: output.Right})
	table.AddColumn(output.Column{Name: "ACCESS MODES", Priority: output.PrioritySecondary, MinWidth: 12, MaxWidth: 20, Align: output.Left})
	table.AddColumn(output.Column{Name: "STORAGE CLASS", Priority: output.PrioritySecondary, MinWidth: 12, MaxWidth: 25, Align: output.Left})
	table.AddAgeColumn()

	for _, pvc := range pvcList.Items {
		storageClass := ""
		if pvc.Spec.StorageClassName != nil {
			storageClass = *pvc.Spec.StorageClassName
		}

		accessModes := make([]string, len(pvc.Spec.AccessModes))
		for i, mode := range pvc.Spec.AccessModes {
			accessModes[i] = string(mode)
		}

		table.AddRow([]string{
			pvc.Namespace,
			pvc.Name,
			output.FormatStatus(string(pvc.Status.Phase)),
			pvc.Spec.VolumeName,
			getPVCCapacity(&pvc),
			strings.Join(accessModes, ","),
			storageClass,
			output.FormatAge(pvc.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}

	table.Print()
	return nil
}

func getPVCCapacity(pvc *corev1.PersistentVolumeClaim) string {
	capacity := pvc.Status.Capacity.Storage()
	if capacity != nil {
		return capacity.String()
	}
	requested := pvc.Spec.Resources.Requests.Storage()
	if requested != nil {
		return requested.String()
	}
	return "<none>"
}

// ── Ingresses (namespace-scoped) ─────────────────────────────────────────────

var ingressSupportedModifiers = map[string]bool{
	"hosts":    true,
	"backends": true,
	"tls":      true,
	"all":      true,
}

func enhanceIngresses(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
	loadingRules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath}
	configOverrides := &clientcmd.ConfigOverrides{}
	if ctx != "" {
		configOverrides.CurrentContext = ctx
	}
	restConfig, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, configOverrides).ClientConfig()
	if err != nil {
		return fmt.Errorf("failed to load kubeconfig: %w", err)
	}

	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return fmt.Errorf("failed to create kubernetes client: %w", err)
	}

	if err := validateModifiers("ingress", modifiers, ingressSupportedModifiers); err != nil {
		return err
	}

	modifiers = parseAllModifier(modifiers, ingressSupportedModifiers)

	if allNamespaces {
		namespace = ""
	}

	ingList, err := clientset.NetworkingV1().Ingresses(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list ingresses: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddColumn(output.Column{Name: "CLASS", Priority: output.PrioritySecondary, MinWidth: 10, MaxWidth: 20, Align: output.Left})
	table.AddColumn(output.Column{Name: "HOSTS", Priority: output.PriorityCritical, MinWidth: 15, MaxWidth: 40, Align: output.Left})
	table.AddColumn(output.Column{Name: "ADDRESS", Priority: output.PrioritySecondary, MinWidth: 12, MaxWidth: 30, Align: output.Left,
		ColorFunc: func(v string) lipgloss.Style {
			if v == "<pending>" {
				return output.GetTheme().Muted
			}
			return output.GetTheme().Success
		},
	})
	table.AddColumn(output.Column{Name: "PORTS", Priority: output.PrioritySecondary, MinWidth: 8, MaxWidth: 12, Align: output.Left})
	table.AddAgeColumn()

	for _, ing := range ingList.Items {
		table.AddRow([]string{
			ing.Namespace,
			ing.Name,
			getIngressClass(&ing),
			getIngressHosts(&ing),
			getIngressAddress(&ing),
			getIngressPorts(&ing),
			output.FormatAge(ing.CreationTimestamp.Time),
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}

	table.Print()
	return nil
}

func getIngressClass(ing *networkingv1.Ingress) string {
	if ing.Spec.IngressClassName != nil {
		return *ing.Spec.IngressClassName
	}
	return "<none>"
}

func getIngressHosts(ing *networkingv1.Ingress) string {
	hosts := make([]string, 0)
	for _, rule := range ing.Spec.Rules {
		if rule.Host != "" {
			hosts = append(hosts, rule.Host)
		}
	}
	if len(hosts) == 0 {
		return "*"
	}
	return strings.Join(hosts, ",")
}

func getIngressAddress(ing *networkingv1.Ingress) string {
	if len(ing.Status.LoadBalancer.Ingress) == 0 {
		return "<pending>"
	}
	addrs := make([]string, 0)
	for _, lbIng := range ing.Status.LoadBalancer.Ingress {
		if lbIng.IP != "" {
			addrs = append(addrs, lbIng.IP)
		} else if lbIng.Hostname != "" {
			addrs = append(addrs, lbIng.Hostname)
		}
	}
	return strings.Join(addrs, ",")
}

func getIngressPorts(ing *networkingv1.Ingress) string {
	hasTLS := len(ing.Spec.TLS) > 0
	if hasTLS {
		return "80, 443"
	}
	return "80"
}

// ── Events (namespace-scoped) ────────────────────────────────────────────────

var eventSupportedModifiers = map[string]bool{
	"type":    true,
	"reason":  true,
	"object":  true,
	"message": true,
	"count":   true,
	"all":     true,
}

func enhanceEvents(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
	loadingRules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath}
	configOverrides := &clientcmd.ConfigOverrides{}
	if ctx != "" {
		configOverrides.CurrentContext = ctx
	}
	restConfig, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, configOverrides).ClientConfig()
	if err != nil {
		return fmt.Errorf("failed to load kubeconfig: %w", err)
	}

	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return fmt.Errorf("failed to create kubernetes client: %w", err)
	}

	if err := validateModifiers("event", modifiers, eventSupportedModifiers); err != nil {
		return err
	}

	modifiers = parseAllModifier(modifiers, eventSupportedModifiers)

	if allNamespaces {
		namespace = ""
	}

	eventList, err := clientset.CoreV1().Events(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list events: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddColumn(output.Column{
		Name: "TYPE", Priority: output.PriorityCritical, MinWidth: 8, MaxWidth: 10, Align: output.Left,
		ColorFunc: func(v string) lipgloss.Style { return output.EventTypeStyle(v) },
	})
	table.AddColumn(output.Column{Name: "REASON", Priority: output.PriorityCritical, MinWidth: 12, MaxWidth: 25, Align: output.Left})
	table.AddAgeColumn()
	table.AddColumn(output.Column{Name: "FROM", Priority: output.PrioritySecondary, MinWidth: 12, MaxWidth: 25, Align: output.Left,
		ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Muted },
	})
	table.AddColumn(output.Column{Name: "MESSAGE", Priority: output.PriorityAlways, MinWidth: 20, MaxWidth: 60, Align: output.Left})

	for _, event := range eventList.Items {
		table.AddRow([]string{
			event.Namespace,
			event.Name,
			event.Type,
			event.Reason,
			output.FormatAge(event.FirstTimestamp.Time),
			event.Source.Component,
			event.Message,
		})
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}

	table.Print()
	return nil
}

// ── StatefulSets (namespace-scoped) ──────────────────────────────────────────

var stsSupportedModifiers = map[string]bool{
	"replicas":   true,
	"images":     true,
	"labels":     true,
	"selectors":  true,
	"conditions": true,
	"all":        true,
}

func enhanceStatefulSets(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
	loadingRules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath}
	configOverrides := &clientcmd.ConfigOverrides{}
	if ctx != "" {
		configOverrides.CurrentContext = ctx
	}
	restConfig, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, configOverrides).ClientConfig()
	if err != nil {
		return fmt.Errorf("failed to load kubeconfig: %w", err)
	}

	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return fmt.Errorf("failed to create kubernetes client: %w", err)
	}

	if err := validateModifiers("statefulset", modifiers, stsSupportedModifiers); err != nil {
		return err
	}
	modifiers = parseAllModifier(modifiers, stsSupportedModifiers)

	if allNamespaces {
		namespace = ""
	}

	stsList, err := clientset.AppsV1().StatefulSets(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list statefulsets: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddReadyColumn()
	table.AddColumn(output.Column{Name: "UP-TO-DATE", Priority: output.PrioritySecondary, MinWidth: 10, MaxWidth: 12, Align: output.Right})
	table.AddAgeColumn()

	modifierCols := map[string][]output.Column{
		"replicas": {
			{Name: "DESIRED", Priority: output.PrioritySecondary, MinWidth: 7, MaxWidth: 10, Align: output.Right},
			{Name: "CURRENT", Priority: output.PrioritySecondary, MinWidth: 7, MaxWidth: 10, Align: output.Right},
		},
		"images":     {{Name: "IMAGES", Priority: output.PriorityAlways, MinWidth: 20, MaxWidth: 50, Align: output.Left}},
		"labels":     {{Name: "LABELS", Priority: output.PriorityAlways, MinWidth: 20, MaxWidth: 60, Align: output.Left, ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Muted }}},
		"selectors":  {{Name: "SELECTORS", Priority: output.PriorityAlways, MinWidth: 20, MaxWidth: 50, Align: output.Left, ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Muted }}},
		"conditions": {{Name: "CONDITIONS", Priority: output.PriorityAlways, MinWidth: 15, MaxWidth: 50, Align: output.Left}},
	}
	for _, mod := range modifiers {
		if cols, ok := modifierCols[mod]; ok {
			for _, col := range cols {
				table.AddColumn(col)
			}
		}
	}

	for _, sts := range stsList.Items {
		desired := int32(1)
		if sts.Spec.Replicas != nil {
			desired = *sts.Spec.Replicas
		}
		row := []string{
			sts.Namespace,
			sts.Name,
			fmt.Sprintf("%d/%d", sts.Status.ReadyReplicas, desired),
			fmt.Sprintf("%d", sts.Status.UpdatedReplicas),
			output.FormatAge(sts.CreationTimestamp.Time),
		}
		for _, mod := range modifiers {
			switch mod {
			case "replicas":
				row = append(row, fmt.Sprintf("%d", desired), fmt.Sprintf("%d", sts.Status.CurrentReplicas))
			case "images":
				var imgs []string
				for _, c := range sts.Spec.Template.Spec.Containers {
					imgs = append(imgs, c.Image)
				}
				row = append(row, strings.Join(imgs, ","))
			case "labels":
				row = append(row, formatLabels(sts.Labels))
			case "selectors":
				row = append(row, formatLabels(sts.Spec.Selector.MatchLabels))
			case "conditions":
				var conds []string
				for _, c := range sts.Status.Conditions {
					if c.Status == "True" {
						conds = append(conds, string(c.Type))
					}
				}
				if len(conds) == 0 {
					row = append(row, "<none>")
				} else {
					row = append(row, strings.Join(conds, ","))
				}
			}
		}
		table.AddRow(row)
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}
	table.Print()
	return nil
}

// ── DaemonSets (namespace-scoped) ────────────────────────────────────────────

var dsSupportedModifiers = map[string]bool{
	"images":        true,
	"labels":        true,
	"selectors":     true,
	"node-selector": true,
	"conditions":    true,
	"all":           true,
}

func enhanceDaemonSets(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
	loadingRules := &clientcmd.ClientConfigLoadingRules{ExplicitPath: kubeconfigPath}
	configOverrides := &clientcmd.ConfigOverrides{}
	if ctx != "" {
		configOverrides.CurrentContext = ctx
	}
	restConfig, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, configOverrides).ClientConfig()
	if err != nil {
		return fmt.Errorf("failed to load kubeconfig: %w", err)
	}

	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return fmt.Errorf("failed to create kubernetes client: %w", err)
	}

	if err := validateModifiers("daemonset", modifiers, dsSupportedModifiers); err != nil {
		return err
	}
	modifiers = parseAllModifier(modifiers, dsSupportedModifiers)

	if allNamespaces {
		namespace = ""
	}

	dsList, err := clientset.AppsV1().DaemonSets(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list daemonsets: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddColumn(output.Column{Name: "DESIRED", Priority: output.PriorityCritical, MinWidth: 7, MaxWidth: 10, Align: output.Right})
	table.AddColumn(output.Column{Name: "CURRENT", Priority: output.PrioritySecondary, MinWidth: 7, MaxWidth: 10, Align: output.Right})
	table.AddColumn(output.Column{Name: "READY", Priority: output.PriorityCritical, MinWidth: 5, MaxWidth: 8, Align: output.Right,
		ColorFunc: output.ReadyColorFunc(),
	})
	table.AddColumn(output.Column{Name: "UP-TO-DATE", Priority: output.PrioritySecondary, MinWidth: 10, MaxWidth: 12, Align: output.Right})
	table.AddColumn(output.Column{Name: "AVAILABLE", Priority: output.PrioritySecondary, MinWidth: 9, MaxWidth: 12, Align: output.Right})
	table.AddAgeColumn()

	modifierCols := map[string]output.Column{
		"images":        {Name: "IMAGES", Priority: output.PriorityAlways, MinWidth: 20, MaxWidth: 50, Align: output.Left},
		"labels":        {Name: "LABELS", Priority: output.PriorityAlways, MinWidth: 20, MaxWidth: 60, Align: output.Left, ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Muted }},
		"selectors":     {Name: "SELECTORS", Priority: output.PriorityAlways, MinWidth: 20, MaxWidth: 50, Align: output.Left, ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Muted }},
		"node-selector": {Name: "NODE SELECTOR", Priority: output.PriorityAlways, MinWidth: 20, MaxWidth: 50, Align: output.Left},
		"conditions":    {Name: "CONDITIONS", Priority: output.PriorityAlways, MinWidth: 15, MaxWidth: 50, Align: output.Left},
	}
	for _, mod := range modifiers {
		if col, ok := modifierCols[mod]; ok {
			table.AddColumn(col)
		}
	}

	for _, ds := range dsList.Items {
		row := []string{
			ds.Namespace,
			ds.Name,
			fmt.Sprintf("%d", ds.Status.DesiredNumberScheduled),
			fmt.Sprintf("%d", ds.Status.CurrentNumberScheduled),
			fmt.Sprintf("%d/%d", ds.Status.NumberReady, ds.Status.DesiredNumberScheduled),
			fmt.Sprintf("%d", ds.Status.UpdatedNumberScheduled),
			fmt.Sprintf("%d", ds.Status.NumberAvailable),
			output.FormatAge(ds.CreationTimestamp.Time),
		}
		for _, mod := range modifiers {
			switch mod {
			case "images":
				var imgs []string
				for _, c := range ds.Spec.Template.Spec.Containers {
					imgs = append(imgs, c.Image)
				}
				row = append(row, strings.Join(imgs, ","))
			case "labels":
				row = append(row, formatLabels(ds.Labels))
			case "selectors":
				row = append(row, formatLabels(ds.Spec.Selector.MatchLabels))
			case "node-selector":
				row = append(row, formatLabels(ds.Spec.Template.Spec.NodeSelector))
			case "conditions":
				var conds []string
				for _, c := range ds.Status.Conditions {
					if c.Status == "True" {
						conds = append(conds, string(c.Type))
					}
				}
				if len(conds) == 0 {
					row = append(row, "<none>")
				} else {
					row = append(row, strings.Join(conds, ","))
				}
			}
		}
		table.AddRow(row)
	}

	if sortBy != "" {
		sortTableRows(table, sortBy)
	}
	table.Print()
	return nil
}
