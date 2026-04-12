package cli

import (
	"context"
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/k8sclient"
	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/output"
)

func newFindCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "find [type] <pattern> [flags]",
		Short: "Search for resources by name pattern",
		Long: `Search across resources for a name pattern with case-insensitive matching.

Examples:
  kcli find payment           # Search all types for "payment"
  kcli find pod payment       # Search pods for "payment"
  kcli find svc api           # Search services for "api"
  kcli find deploy prod       # Search deployments for "prod"
  kcli find payment -A        # Search all namespaces`,
		GroupID: "workflow",
		Args:    cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			bundle, err := k8sclient.NewBundle(a.kubeconfig, a.context)
			if err != nil {
				return fmt.Errorf("failed to create kubernetes client: %w", err)
			}
			clientset, ok := bundle.Clientset.(kubernetes.Interface)
			if !ok {
				return fmt.Errorf("unexpected clientset type")
			}

			namespace := a.namespace
			allNS, _ := cmd.Flags().GetBool("all-namespaces")
			if allNS {
				namespace = ""
			}

			var resourceType, pattern string
			if len(args) == 1 {
				pattern = args[0]
			} else {
				resourceType = mapResourceName(strings.ToLower(args[0]))
				pattern = args[1]
			}
			if pattern == "" {
				return fmt.Errorf("search pattern required")
			}

			return runFindResources(context.Background(), clientset, namespace, resourceType, pattern)
		},
	}

	cmd.Flags().BoolP("all-namespaces", "A", false, "Search all namespaces")
	return cmd
}

func runFindResources(ctx context.Context, clientset kubernetes.Interface, namespace, resourceType, pattern string) error {
	pattern = strings.ToLower(pattern)

	table := output.NewTable()
	table.Style = output.Rounded
	table.AddColumn(output.Column{Name: "RESOURCE TYPE", Priority: output.PriorityCritical, MinWidth: 15, MaxWidth: 20, Align: output.Left,
		ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Info },
	})
	table.AddColumn(output.Column{Name: "NAME", Priority: output.PriorityAlways, MinWidth: 20, MaxWidth: 50, Align: output.Left})
	table.AddColumn(output.Column{Name: "NAMESPACE", Priority: output.PriorityContext, MinWidth: 15, MaxWidth: 25, Align: output.Left,
		ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Muted },
	})
	table.AddColumn(output.Column{Name: "STATUS", Priority: output.PriorityCritical, MinWidth: 12, MaxWidth: 20, Align: output.Left,
		ColorFunc: output.StatusColorFunc("pod"),
	})

	typesToSearch := []string{"pods", "deployments", "services", "configmaps", "secrets", "ingresses", "jobs", "cronjobs", "statefulsets", "daemonsets", "persistentvolumeclaims"}
	if resourceType != "" && resourceType != "all" {
		typesToSearch = []string{resourceType}
	}

	resultCount := 0
	for _, resType := range typesToSearch {
		switch resType {
		case "pods":
			if list, err := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{}); err == nil {
				for _, item := range list.Items {
					if strings.Contains(strings.ToLower(item.Name), pattern) {
						table.AddRow([]string{"Pod", highlightMatch(item.Name, pattern), item.Namespace, string(item.Status.Phase)})
						resultCount++
					}
				}
			}
		case "deployments":
			if list, err := clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{}); err == nil {
				for _, item := range list.Items {
					if strings.Contains(strings.ToLower(item.Name), pattern) {
						table.AddRow([]string{"Deployment", highlightMatch(item.Name, pattern), item.Namespace, fmt.Sprintf("%d/%d", item.Status.ReadyReplicas, item.Status.Replicas)})
						resultCount++
					}
				}
			}
		case "services":
			if list, err := clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{}); err == nil {
				for _, item := range list.Items {
					if strings.Contains(strings.ToLower(item.Name), pattern) {
						table.AddRow([]string{"Service", highlightMatch(item.Name, pattern), item.Namespace, string(item.Spec.Type)})
						resultCount++
					}
				}
			}
		case "configmaps":
			if list, err := clientset.CoreV1().ConfigMaps(namespace).List(ctx, metav1.ListOptions{}); err == nil {
				for _, item := range list.Items {
					if strings.Contains(strings.ToLower(item.Name), pattern) {
						table.AddRow([]string{"ConfigMap", highlightMatch(item.Name, pattern), item.Namespace, "Active"})
						resultCount++
					}
				}
			}
		case "secrets":
			if list, err := clientset.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{}); err == nil {
				for _, item := range list.Items {
					if strings.Contains(strings.ToLower(item.Name), pattern) {
						table.AddRow([]string{"Secret", highlightMatch(item.Name, pattern), item.Namespace, string(item.Type)})
						resultCount++
					}
				}
			}
		case "ingresses":
			if list, err := clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{}); err == nil {
				for _, item := range list.Items {
					if strings.Contains(strings.ToLower(item.Name), pattern) {
						table.AddRow([]string{"Ingress", highlightMatch(item.Name, pattern), item.Namespace, "Active"})
						resultCount++
					}
				}
			}
		case "jobs":
			if list, err := clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{}); err == nil {
				for _, item := range list.Items {
					if strings.Contains(strings.ToLower(item.Name), pattern) {
						s := "Running"
						if item.Status.Succeeded > 0 {
							s = "Succeeded"
						} else if item.Status.Failed > 0 {
							s = "Failed"
						}
						table.AddRow([]string{"Job", highlightMatch(item.Name, pattern), item.Namespace, s})
						resultCount++
					}
				}
			}
		case "cronjobs":
			if list, err := clientset.BatchV1().CronJobs(namespace).List(ctx, metav1.ListOptions{}); err == nil {
				for _, item := range list.Items {
					if strings.Contains(strings.ToLower(item.Name), pattern) {
						s := "Active"
						if item.Spec.Suspend != nil && *item.Spec.Suspend {
							s = "Suspended"
						}
						table.AddRow([]string{"CronJob", highlightMatch(item.Name, pattern), item.Namespace, s})
						resultCount++
					}
				}
			}
		case "statefulsets":
			if list, err := clientset.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{}); err == nil {
				for _, item := range list.Items {
					if strings.Contains(strings.ToLower(item.Name), pattern) {
						table.AddRow([]string{"StatefulSet", highlightMatch(item.Name, pattern), item.Namespace, fmt.Sprintf("%d/%d", item.Status.ReadyReplicas, item.Status.Replicas)})
						resultCount++
					}
				}
			}
		case "daemonsets":
			if list, err := clientset.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{}); err == nil {
				for _, item := range list.Items {
					if strings.Contains(strings.ToLower(item.Name), pattern) {
						table.AddRow([]string{"DaemonSet", highlightMatch(item.Name, pattern), item.Namespace, fmt.Sprintf("%d/%d", item.Status.NumberReady, item.Status.DesiredNumberScheduled)})
						resultCount++
					}
				}
			}
		case "persistentvolumeclaims":
			if list, err := clientset.CoreV1().PersistentVolumeClaims(namespace).List(ctx, metav1.ListOptions{}); err == nil {
				for _, item := range list.Items {
					if strings.Contains(strings.ToLower(item.Name), pattern) {
						table.AddRow([]string{"PVC", highlightMatch(item.Name, pattern), item.Namespace, string(item.Status.Phase)})
						resultCount++
					}
				}
			}
		}
	}

	if resultCount == 0 {
		fmt.Printf("No resources matching pattern '%s' found\n", pattern)
		return nil
	}

	table.Print()
	fmt.Printf("\nFound %d match(es)\n", resultCount)
	return nil
}

func highlightMatch(name, pattern string) string {
	lower := strings.ToLower(name)
	idx := strings.Index(lower, strings.ToLower(pattern))
	if idx == -1 {
		return name
	}
	before := name[:idx]
	match := name[idx : idx+len(pattern)]
	after := name[idx+len(pattern):]
	boldStyle := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("11"))
	return before + boldStyle.Render(match) + after
}
