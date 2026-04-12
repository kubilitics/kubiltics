package kubectl

import (
	"context"
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/output"
)

var deploymentSupportedModifiers = map[string]bool{
	"replicas":   true,
	"images":     true,
	"strategy":   true,
	"labels":     true,
	"selectors":  true,
	"conditions": true,
	"all":        true,
}

func enhanceDeployments(kubeconfigPath, ctx, namespace string, modifiers []string, allNamespaces bool, sortBy string, outputFormat string) error {
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

	if err := validateModifiers("deployment", modifiers, deploymentSupportedModifiers); err != nil {
		return err
	}

	modifiers = parseAllModifier(modifiers, deploymentSupportedModifiers)

	if allNamespaces {
		namespace = ""
	}

	deployList, err := clientset.AppsV1().Deployments(namespace).List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list deployments: %w", err)
	}

	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddReadyColumn()
	table.AddColumn(output.Column{Name: "UP-TO-DATE", Priority: output.PrioritySecondary, MinWidth: 10, MaxWidth: 12, Align: output.Right})
	table.AddColumn(output.Column{Name: "AVAILABLE", Priority: output.PrioritySecondary, MinWidth: 9, MaxWidth: 12, Align: output.Right})
	table.AddAgeColumn()

	modifierColumns := map[string][]output.Column{
		"replicas": {
			{Name: "DESIRED", Priority: output.PriorityAlways, MinWidth: 7, MaxWidth: 10, Align: output.Right},
			{Name: "CURRENT", Priority: output.PriorityAlways, MinWidth: 7, MaxWidth: 10, Align: output.Right},
		},
		"images":     {{Name: "IMAGES", Priority: output.PriorityAlways, MinWidth: 20, MaxWidth: 50, Align: output.Left}},
		"strategy":   {{Name: "STRATEGY", Priority: output.PrioritySecondary, MinWidth: 12, MaxWidth: 18, Align: output.Left}},
		"labels":     {{Name: "LABELS", Priority: output.PriorityAlways, MinWidth: 20, MaxWidth: 60, Align: output.Left, ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Muted }}},
		"selectors":  {{Name: "SELECTORS", Priority: output.PriorityAlways, MinWidth: 20, MaxWidth: 50, Align: output.Left, ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Muted }}},
		"conditions": {{Name: "CONDITIONS", Priority: output.PriorityAlways, MinWidth: 15, MaxWidth: 50, Align: output.Left}},
	}

	for _, mod := range modifiers {
		if cols, ok := modifierColumns[mod]; ok {
			for _, col := range cols {
				table.AddColumn(col)
			}
		}
	}

	for _, deploy := range deployList.Items {
		row := []string{
			deploy.Namespace,
			deploy.Name,
			fmt.Sprintf("%d/%d", deploy.Status.ReadyReplicas, readDesiredReplicas(&deploy)),
			fmt.Sprintf("%d", deploy.Status.UpdatedReplicas),
			fmt.Sprintf("%d", deploy.Status.AvailableReplicas),
			output.FormatAge(deploy.CreationTimestamp.Time),
		}

		for _, mod := range modifiers {
			switch mod {
			case "replicas":
				desired := readDesiredReplicas(&deploy)
				current := deploy.Status.Replicas
				row = append(row, fmt.Sprintf("%d", desired), fmt.Sprintf("%d", current))
			case "images":
				row = append(row, getDeploymentImages(&deploy))
			case "strategy":
				row = append(row, getDeploymentStrategy(&deploy))
			case "labels":
				row = append(row, formatLabels(deploy.Labels))
			case "selectors":
				row = append(row, formatLabels(deploy.Spec.Selector.MatchLabels))
			case "conditions":
				row = append(row, getDeploymentConditions(&deploy))
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

func readDesiredReplicas(deploy *appsv1.Deployment) int32 {
	if deploy.Spec.Replicas != nil {
		return *deploy.Spec.Replicas
	}
	return 1
}

func getDeploymentImages(deploy *appsv1.Deployment) string {
	images := make([]string, 0)
	for _, container := range deploy.Spec.Template.Spec.Containers {
		images = append(images, container.Image)
	}
	return strings.Join(images, ",")
}

func getDeploymentStrategy(deploy *appsv1.Deployment) string {
	if deploy.Spec.Strategy.Type != "" {
		return string(deploy.Spec.Strategy.Type)
	}
	return "RollingUpdate"
}

func getDeploymentConditions(deploy *appsv1.Deployment) string {
	var conditions []string
	for _, cond := range deploy.Status.Conditions {
		if cond.Status == "True" {
			conditions = append(conditions, string(cond.Type))
		}
	}
	if len(conditions) == 0 {
		return "<none>"
	}
	return strings.Join(conditions, ",")
}
