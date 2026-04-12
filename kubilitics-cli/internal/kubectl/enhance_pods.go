package kubectl

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/charmbracelet/lipgloss"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/output"
)

var podSupportedModifiers = map[string]bool{
	"ip":         true,
	"node":       true,
	"ns":         true,
	"labels":     true,
	"images":     true,
	"restarts":   true,
	"sc":         true,
	"ports":      true,
	"qos":        true,
	"sa":         true,
	"containers": true,
	"requests":   true,
	"limits":     true,
	"all":        true,
}

func enhancePods(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
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

	if err := validateModifiers("pod", modifiers, podSupportedModifiers); err != nil {
		return err
	}

	modifiers = parseAllModifier(modifiers, podSupportedModifiers)

	if allNamespaces {
		namespace = ""
	}

	podList, err := clientset.CoreV1().Pods(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list pods: %w", err)
	}

	// Build table
	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddReadyColumn()
	table.AddStatusColumn("pod")
	table.AddColumn(output.Column{
		Name: "RESTARTS", Priority: output.PrioritySecondary,
		MinWidth: 8, MaxWidth: 10, Align: output.Right,
		ColorFunc: output.RestartColorFunc(),
	})
	table.AddAgeColumn()

	// Modifier columns — PriorityAlways because user explicitly requested them.
	// They must NEVER be hidden by the responsive system.
	modifierColumns := map[string]output.Column{
		"ip":   {Name: "IP", Priority: output.PriorityAlways, MinWidth: 12, MaxWidth: 18, Align: output.Left},
		"node": {Name: "NODE", Priority: output.PriorityAlways, MinWidth: 12, MaxWidth: 40, Align: output.Left},
		"labels": {Name: "LABELS", Priority: output.PriorityAlways, MinWidth: 15, MaxWidth: 60, Align: output.Left,
			ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Muted }},
		"images":     {Name: "IMAGES", Priority: output.PriorityAlways, MinWidth: 15, MaxWidth: 50, Align: output.Left},
		"sc":         {Name: "CONDITIONS", Priority: output.PriorityAlways, MinWidth: 12, MaxWidth: 50, Align: output.Left},
		"ports":      {Name: "PORTS", Priority: output.PriorityAlways, MinWidth: 6, MaxWidth: 25, Align: output.Left},
		"qos":        {Name: "QOS", Priority: output.PriorityAlways, MinWidth: 8, MaxWidth: 15, Align: output.Left},
		"sa":         {Name: "SERVICE ACCOUNT", Priority: output.PriorityAlways, MinWidth: 10, MaxWidth: 30, Align: output.Left},
		"containers": {Name: "CONTAINERS", Priority: output.PriorityAlways, MinWidth: 10, MaxWidth: 50, Align: output.Left},
		"requests":   {Name: "REQUESTS", Priority: output.PriorityAlways, MinWidth: 12, MaxWidth: 40, Align: output.Left},
		"limits":     {Name: "LIMITS", Priority: output.PriorityAlways, MinWidth: 12, MaxWidth: 40, Align: output.Left},
	}

	for _, mod := range modifiers {
		if col, ok := modifierColumns[mod]; ok {
			table.AddColumn(col)
		}
	}

	// Build rows
	for _, pod := range podList.Items {
		row := []string{
			pod.Namespace,
			pod.Name,
			getPodReadyStatus(&pod),
			output.FormatStatus(getPodStatus(&pod)),
			fmt.Sprintf("%d", getTotalRestarts(&pod)),
			output.FormatAge(pod.CreationTimestamp.Time),
		}

		for _, mod := range modifiers {
			switch mod {
			case "ip":
				row = append(row, pod.Status.PodIP)
			case "node":
				row = append(row, pod.Spec.NodeName)
			case "labels":
				row = append(row, formatLabels(pod.Labels))
			case "images":
				row = append(row, getPodImages(&pod))
			case "sc":
				row = append(row, getPodConditions(&pod))
			case "ports":
				row = append(row, getPodPorts(&pod))
			case "qos":
				row = append(row, string(pod.Status.QOSClass))
			case "sa":
				row = append(row, pod.Spec.ServiceAccountName)
			case "containers":
				row = append(row, getPodContainerNames(&pod))
			case "requests":
				row = append(row, getPodRequests(&pod))
			case "limits":
				row = append(row, getPodLimits(&pod))
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

func getPodReadyStatus(pod *corev1.Pod) string {
	ready := 0
	total := len(pod.Spec.Containers)

	for _, status := range pod.Status.ContainerStatuses {
		if status.Ready {
			ready++
		}
	}

	return fmt.Sprintf("%d/%d", ready, total)
}

func getPodStatus(pod *corev1.Pod) string {
	if pod.DeletionTimestamp != nil {
		return "Terminating"
	}

	for _, status := range pod.Status.InitContainerStatuses {
		if status.State.Waiting != nil {
			return fmt.Sprintf("Init:%s", status.State.Waiting.Reason)
		}
		if status.State.Terminated != nil && status.State.Terminated.ExitCode != 0 {
			return fmt.Sprintf("Init:%s", status.State.Terminated.Reason)
		}
	}

	for _, status := range pod.Status.ContainerStatuses {
		if status.State.Waiting != nil {
			return status.State.Waiting.Reason
		}
		if status.State.Terminated != nil {
			return status.State.Terminated.Reason
		}
	}

	return string(pod.Status.Phase)
}

func getTotalRestarts(pod *corev1.Pod) int32 {
	var total int32
	for _, status := range pod.Status.ContainerStatuses {
		total += status.RestartCount
	}
	return total
}

func getPodImages(pod *corev1.Pod) string {
	images := make([]string, 0)
	for _, container := range pod.Spec.Containers {
		images = append(images, container.Image)
	}
	return strings.Join(images, ",")
}

func getPodPorts(pod *corev1.Pod) string {
	var ports []string
	for _, container := range pod.Spec.Containers {
		for _, port := range container.Ports {
			portStr := fmt.Sprintf("%d", port.ContainerPort)
			if port.Protocol != "" && port.Protocol != "TCP" {
				portStr += fmt.Sprintf("/%s", port.Protocol)
			}
			ports = append(ports, portStr)
		}
	}
	return strings.Join(ports, ",")
}

func getPodConditions(pod *corev1.Pod) string {
	var conditions []string
	for _, cond := range pod.Status.Conditions {
		if cond.Status == corev1.ConditionTrue {
			conditions = append(conditions, string(cond.Type))
		}
	}
	return strings.Join(conditions, ",")
}

func getPodContainerNames(pod *corev1.Pod) string {
	names := make([]string, 0, len(pod.Spec.Containers))
	for _, c := range pod.Spec.Containers {
		names = append(names, c.Name)
	}
	return strings.Join(names, ",")
}

func getPodRequests(pod *corev1.Pod) string {
	var parts []string
	for _, c := range pod.Spec.Containers {
		if cpu := c.Resources.Requests.Cpu(); cpu != nil && !cpu.IsZero() {
			parts = append(parts, fmt.Sprintf("cpu:%s", cpu.String()))
		}
		if mem := c.Resources.Requests.Memory(); mem != nil && !mem.IsZero() {
			parts = append(parts, fmt.Sprintf("mem:%s", mem.String()))
		}
	}
	if len(parts) == 0 {
		return "<none>"
	}
	return strings.Join(parts, ", ")
}

func getPodLimits(pod *corev1.Pod) string {
	var parts []string
	for _, c := range pod.Spec.Containers {
		if cpu := c.Resources.Limits.Cpu(); cpu != nil && !cpu.IsZero() {
			parts = append(parts, fmt.Sprintf("cpu:%s", cpu.String()))
		}
		if mem := c.Resources.Limits.Memory(); mem != nil && !mem.IsZero() {
			parts = append(parts, fmt.Sprintf("mem:%s", mem.String()))
		}
	}
	if len(parts) == 0 {
		return "<none>"
	}
	return strings.Join(parts, ", ")
}

func formatLabels(labels map[string]string) string {
	if len(labels) == 0 {
		return "<none>"
	}
	var pairs []string
	for k, v := range labels {
		pairs = append(pairs, fmt.Sprintf("%s=%s", k, v))
	}
	sort.Strings(pairs)
	return strings.Join(pairs, ",")
}

// sortTableRows sorts table rows by column name.
func sortTableRows(table *output.Table, sortByCol string) {
	colIdx := -1
	for i, col := range table.Columns {
		if strings.EqualFold(col.Name, sortByCol) {
			colIdx = i
			break
		}
	}
	if colIdx == -1 {
		return
	}
	sort.Slice(table.Rows, func(i, j int) bool {
		if colIdx >= len(table.Rows[i]) || colIdx >= len(table.Rows[j]) {
			return false
		}
		return table.Rows[i][colIdx] < table.Rows[j][colIdx]
	})
}

// sortRows sorts raw rows by column name (used by legacy callers).
func sortRows(rows [][]string, headers []string, sortByCol string) {
	colIdx := -1
	for i, h := range headers {
		if strings.EqualFold(h, sortByCol) {
			colIdx = i
			break
		}
	}

	if colIdx == -1 {
		return
	}

	sort.Slice(rows, func(i, j int) bool {
		if colIdx >= len(rows[i]) || colIdx >= len(rows[j]) {
			return false
		}
		return rows[i][colIdx] < rows[j][colIdx]
	})
}
