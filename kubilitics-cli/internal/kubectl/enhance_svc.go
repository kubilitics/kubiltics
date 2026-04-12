package kubectl

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/charmbracelet/lipgloss"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/output"
)

var serviceSupportedModifiers = map[string]bool{
	"endpoints": true,
	"ports":     true,
	"selectors": true,
	"external":  true,
	"all":       true,
}

func enhanceServices(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
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

	if err := validateModifiers("service", modifiers, serviceSupportedModifiers); err != nil {
		return err
	}

	modifiers = parseAllModifier(modifiers, serviceSupportedModifiers)

	if allNamespaces {
		namespace = ""
	}

	svcList, err := clientset.CoreV1().Services(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list services: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddColumn(output.Column{
		Name: "TYPE", Priority: output.PrioritySecondary,
		MinWidth: 10, MaxWidth: 15, Align: output.Left,
		ColorFunc: func(v string) lipgloss.Style {
			theme := output.GetTheme()
			switch v {
			case "LoadBalancer":
				return theme.Highlight
			case "NodePort":
				return theme.Info
			default:
				return theme.Primary
			}
		},
	})
	table.AddColumn(output.Column{Name: "CLUSTER-IP", Priority: output.PrioritySecondary, MinWidth: 12, MaxWidth: 18, Align: output.Left})
	table.AddColumn(output.Column{Name: "EXTERNAL-IP", Priority: output.PrioritySecondary, MinWidth: 12, MaxWidth: 30, Align: output.Left,
		ColorFunc: func(v string) lipgloss.Style {
			theme := output.GetTheme()
			if v == "<none>" || v == "<pending>" {
				return theme.Muted
			}
			return theme.Success
		},
	})
	table.AddColumn(output.Column{Name: "PORT(S)", Priority: output.PrioritySecondary, MinWidth: 10, MaxWidth: 30, Align: output.Left})
	table.AddAgeColumn()

	modifierCols := map[string]output.Column{
		"endpoints": {Name: "ENDPOINTS", Priority: output.PrioritySecondary, MinWidth: 8, MaxWidth: 12, Align: output.Right, ColorFunc: output.ReadyColorFunc()},
		"ports":     {Name: "PORTS", Priority: output.PriorityExtended, MinWidth: 15, MaxWidth: 40, Align: output.Left},
		"selectors": {Name: "SELECTORS", Priority: output.PriorityExtended, MinWidth: 20, MaxWidth: 50, Align: output.Left, ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Muted }},
	}

	for _, mod := range modifiers {
		if col, ok := modifierCols[mod]; ok {
			table.AddColumn(col)
		}
	}

	for _, svc := range svcList.Items {
		row := []string{
			svc.Namespace,
			svc.Name,
			string(svc.Spec.Type),
			svc.Spec.ClusterIP,
			getServiceExternalIP(&svc),
			getServicePorts(&svc),
			output.FormatAge(svc.CreationTimestamp.Time),
		}

		for _, mod := range modifiers {
			switch mod {
			case "endpoints":
				row = append(row, getServiceEndpoints(&svc, clientset, namespace))
			case "ports":
				row = append(row, getServiceDetailedPorts(&svc))
			case "selectors":
				row = append(row, formatLabels(svc.Spec.Selector))
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

func getServiceExternalIP(svc *corev1.Service) string {
	if len(svc.Spec.ExternalIPs) > 0 {
		return strings.Join(svc.Spec.ExternalIPs, ",")
	}

	if svc.Spec.Type == corev1.ServiceTypeLoadBalancer {
		if len(svc.Status.LoadBalancer.Ingress) > 0 {
			ips := make([]string, 0)
			for _, ing := range svc.Status.LoadBalancer.Ingress {
				if ing.IP != "" {
					ips = append(ips, ing.IP)
				} else if ing.Hostname != "" {
					ips = append(ips, ing.Hostname)
				}
			}
			if len(ips) > 0 {
				return strings.Join(ips, ",")
			}
		}
		return "<pending>"
	}

	return "<none>"
}

func getServicePorts(svc *corev1.Service) string {
	if len(svc.Spec.Ports) == 0 {
		return "<none>"
	}

	var ports []string
	for _, port := range svc.Spec.Ports {
		portStr := fmt.Sprintf("%d", port.Port)
		targetPort := port.TargetPort.String()
		if targetPort != "0" && targetPort != strconv.Itoa(int(port.Port)) {
			portStr += fmt.Sprintf(":%s", targetPort)
		}
		if port.Protocol != "" && port.Protocol != "TCP" {
			portStr += fmt.Sprintf("/%s", port.Protocol)
		}
		ports = append(ports, portStr)
	}
	return strings.Join(ports, ",")
}

func getServiceDetailedPorts(svc *corev1.Service) string {
	if len(svc.Spec.Ports) == 0 {
		return "<none>"
	}

	var ports []string
	for _, port := range svc.Spec.Ports {
		portStr := fmt.Sprintf("%d->%s", port.Port, port.TargetPort.String())
		if port.Protocol != "" {
			portStr += fmt.Sprintf("/%s", port.Protocol)
		}
		if port.Name != "" {
			portStr = fmt.Sprintf("%s(%s)", port.Name, portStr)
		}
		ports = append(ports, portStr)
	}
	return strings.Join(ports, ";")
}

func getServiceEndpoints(svc *corev1.Service, clientset kubernetes.Interface, namespace string) string {
	if len(svc.Spec.Selector) == 0 {
		if svc.Spec.ExternalName != "" {
			return svc.Spec.ExternalName
		}
		return "<none>"
	}

	selector, err := metav1.LabelSelectorAsSelector(&metav1.LabelSelector{
		MatchLabels: svc.Spec.Selector,
	})
	if err != nil {
		return "<none>"
	}

	podList, err := clientset.CoreV1().Pods(svc.Namespace).List(context.Background(), metav1.ListOptions{
		LabelSelector: selector.String(),
	})
	if err != nil || len(podList.Items) == 0 {
		return "<none>"
	}

	endpoints := make([]string, 0)
	for _, pod := range podList.Items {
		if pod.Status.PodIP != "" {
			for _, cond := range pod.Status.Conditions {
				if cond.Type == corev1.PodReady && cond.Status == corev1.ConditionTrue {
					endpoints = append(endpoints, pod.Status.PodIP)
					break
				}
			}
		}
	}

	if len(endpoints) == 0 {
		return "0/0"
	}

	return fmt.Sprintf("%d/%d", len(endpoints), len(podList.Items))
}
