package kubectl

import (
	"context"
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/output"
)

var nodeSupportedModifiers = map[string]bool{
	"capacity":   true,
	"taints":     true,
	"version":    true,
	"pods":       true,
	"conditions": true,
	"labels":     true,
	"zone":       true,
	"all":        true,
}

func enhanceNodes(kubeconfigPath, ctx string, modifiers []string, sortBy string, outputFormat string) error {
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

	if err := validateModifiers("node", modifiers, nodeSupportedModifiers); err != nil {
		return err
	}

	modifiers = parseAllModifier(modifiers, nodeSupportedModifiers)

	nodeList, err := clientset.CoreV1().Nodes().List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list nodes: %w", err)
	}

	clusterName := ctx
	if clusterName == "" {
		clusterName = "current"
	}

	table := output.NewResourceTable(output.ResourceTableOpts{
		Scope:       output.ScopeCluster,
		ClusterName: clusterName,
	})
	table.AddNameColumn()
	table.AddColumn(output.Column{
		Name: "STATUS", Priority: output.PriorityCritical,
		MinWidth: 10, MaxWidth: 15, Align: output.Left,
		ColorFunc: output.StatusColorFunc("node"),
	})
	table.AddColumn(output.Column{Name: "ROLES", Priority: output.PriorityContext, MinWidth: 12, MaxWidth: 25, Align: output.Left})
	table.AddAgeColumn()
	table.AddColumn(output.Column{Name: "VERSION", Priority: output.PrioritySecondary, MinWidth: 10, MaxWidth: 18, Align: output.Left})

	modifierCols := map[string][]output.Column{
		"capacity": {
			{Name: "CPU", Priority: output.PrioritySecondary, MinWidth: 5, MaxWidth: 10, Align: output.Right},
			{Name: "MEMORY", Priority: output.PrioritySecondary, MinWidth: 8, MaxWidth: 15, Align: output.Right},
		},
		"taints":     {{Name: "TAINTS", Priority: output.PriorityExtended, MinWidth: 15, MaxWidth: 50, Align: output.Left}},
		"pods":       {{Name: "PODS", Priority: output.PrioritySecondary, MinWidth: 5, MaxWidth: 8, Align: output.Right}},
		"conditions": {{Name: "CONDITIONS", Priority: output.PriorityExtended, MinWidth: 15, MaxWidth: 50, Align: output.Left}},
		"labels":     {{Name: "LABELS", Priority: output.PriorityExtended, MinWidth: 20, MaxWidth: 60, Align: output.Left, ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Muted }}},
		"zone":       {{Name: "ZONE", Priority: output.PrioritySecondary, MinWidth: 12, MaxWidth: 25, Align: output.Left}},
	}

	for _, mod := range modifiers {
		if cols, ok := modifierCols[mod]; ok {
			if mod != "version" {
				for _, col := range cols {
					table.AddColumn(col)
				}
			}
		}
	}

	for _, node := range nodeList.Items {
		status := getNodeStatus(&node)
		row := []string{
			clusterName,
			node.Name,
			output.FormatStatus(status),
			getNodeRoles(&node),
			output.FormatAge(node.CreationTimestamp.Time),
			getNodeKubeletVersion(&node),
		}

		for _, mod := range modifiers {
			switch mod {
			case "capacity":
				cpu := node.Status.Capacity.Cpu().String()
				mem := node.Status.Capacity.Memory().String()
				row = append(row, cpu, mem)
			case "taints":
				row = append(row, getNodeTaints(&node))
			case "version":
				row = append(row, getNodeKernelVersion(&node))
			case "pods":
				row = append(row, getNodePodCount(&node, clientset))
			case "conditions":
				row = append(row, getNodeConditions(&node))
			case "labels":
				row = append(row, formatLabels(node.Labels))
			case "zone":
				row = append(row, getNodeZone(&node))
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

func getNodeStatus(node *corev1.Node) string {
	for _, condition := range node.Status.Conditions {
		if condition.Type == corev1.NodeReady {
			if condition.Status == corev1.ConditionTrue {
				return "Ready"
			} else if condition.Status == corev1.ConditionFalse {
				return "NotReady"
			}
			return "Unknown"
		}
	}
	return "Unknown"
}

func getNodeRoles(node *corev1.Node) string {
	roles := make([]string, 0)

	for key := range node.Labels {
		if strings.HasPrefix(key, "node-role.kubernetes.io/") {
			role := strings.TrimPrefix(key, "node-role.kubernetes.io/")
			roles = append(roles, role)
		}
	}

	if len(roles) == 0 {
		return "<none>"
	}

	return strings.Join(roles, ",")
}

func getNodeKubeletVersion(node *corev1.Node) string {
	return node.Status.NodeInfo.KubeletVersion
}

func getNodeKernelVersion(node *corev1.Node) string {
	return node.Status.NodeInfo.KernelVersion
}

func getNodeTaints(node *corev1.Node) string {
	if len(node.Spec.Taints) == 0 {
		return "<none>"
	}

	var taints []string
	for _, taint := range node.Spec.Taints {
		taintStr := taint.Key
		if taint.Value != "" {
			taintStr += fmt.Sprintf("=%s", taint.Value)
		}
		taintStr += fmt.Sprintf(":%s", taint.Effect)
		taints = append(taints, taintStr)
	}

	return strings.Join(taints, ";")
}

func getNodeConditions(node *corev1.Node) string {
	var conditions []string
	for _, cond := range node.Status.Conditions {
		if cond.Status == corev1.ConditionTrue {
			conditions = append(conditions, string(cond.Type))
		}
	}
	if len(conditions) == 0 {
		return "<none>"
	}
	return strings.Join(conditions, ",")
}

func getNodeZone(node *corev1.Node) string {
	if zone, ok := node.Labels["topology.kubernetes.io/zone"]; ok {
		return zone
	}
	if region, ok := node.Labels["topology.kubernetes.io/region"]; ok {
		return region
	}
	return "<none>"
}

func getNodePodCount(node *corev1.Node, clientset kubernetes.Interface) string {
	allocatable := node.Status.Allocatable.Pods()
	if allocatable != nil {
		return allocatable.String()
	}
	return "0"
}
