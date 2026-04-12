package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/k8sclient"
	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/output"
)

func newCountCmd(a *app) *cobra.Command {
	var outputFormat string
	cmd := &cobra.Command{
		Use:   "count <resource> [flags]",
		Short: "Quick resource counts by status",
		Long: `Display resource counts grouped by status for quick overview.

Examples:
  kcli count pods              # Pod counts by status
  kcli count deployments       # Deployment counts by status
  kcli count all               # Count all resource types
  kcli count pods -A           # Count pods across all namespaces
  kcli count deployments -o json  # JSON output`,
		GroupID: "observability",
		Args:    cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			resourceType := mapResourceName(strings.ToLower(args[0]))

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

			ctx := context.Background()

			switch resourceType {
			case "pods":
				return countPods(ctx, clientset, namespace, outputFormat)
			case "deployments":
				return countDeployments(ctx, clientset, namespace, outputFormat)
			case "services":
				return countServices(ctx, clientset, namespace, outputFormat)
			case "jobs":
				return countJobs(ctx, clientset, namespace, outputFormat)
			case "cronjobs":
				return countCronJobs(ctx, clientset, namespace, outputFormat)
			case "statefulsets":
				return countStatefulSets(ctx, clientset, namespace, outputFormat)
			case "all":
				return countAllResources(ctx, clientset, namespace, outputFormat)
			default:
				return fmt.Errorf("count not supported for resource type: %s", resourceType)
			}
		},
	}

	cmd.Flags().BoolP("all-namespaces", "A", false, "Count resources across all namespaces")
	cmd.Flags().StringVarP(&outputFormat, "output", "o", "table", "Output format: table, json")

	return cmd
}

func countPods(ctx context.Context, clientset kubernetes.Interface, namespace string, outputFormat string) error {
	podList, err := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list pods: %w", err)
	}
	counts := make(map[string]int)
	for _, pod := range podList.Items {
		counts[string(pod.Status.Phase)]++
	}
	return displayCountResults("Pods", counts, len(podList.Items), outputFormat)
}

func countDeployments(ctx context.Context, clientset kubernetes.Interface, namespace string, outputFormat string) error {
	list, err := clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list deployments: %w", err)
	}
	counts := make(map[string]int)
	for _, d := range list.Items {
		if d.Status.ReadyReplicas == d.Status.Replicas && d.Status.Replicas > 0 {
			counts["Ready"]++
		} else {
			counts["NotReady"]++
		}
	}
	return displayCountResults("Deployments", counts, len(list.Items), outputFormat)
}

func countServices(ctx context.Context, clientset kubernetes.Interface, namespace string, outputFormat string) error {
	list, err := clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list services: %w", err)
	}
	counts := make(map[string]int)
	for _, svc := range list.Items {
		counts[string(svc.Spec.Type)]++
	}
	return displayCountResults("Services", counts, len(list.Items), outputFormat)
}

func countJobs(ctx context.Context, clientset kubernetes.Interface, namespace string, outputFormat string) error {
	list, err := clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list jobs: %w", err)
	}
	counts := make(map[string]int)
	for _, j := range list.Items {
		if j.Status.Succeeded > 0 {
			counts["Succeeded"]++
		} else if j.Status.Failed > 0 {
			counts["Failed"]++
		} else {
			counts["Running"]++
		}
	}
	return displayCountResults("Jobs", counts, len(list.Items), outputFormat)
}

func countCronJobs(ctx context.Context, clientset kubernetes.Interface, namespace string, outputFormat string) error {
	list, err := clientset.BatchV1().CronJobs(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list cronjobs: %w", err)
	}
	counts := make(map[string]int)
	for _, cj := range list.Items {
		if cj.Spec.Suspend != nil && *cj.Spec.Suspend {
			counts["Suspended"]++
		} else {
			counts["Active"]++
		}
	}
	return displayCountResults("CronJobs", counts, len(list.Items), outputFormat)
}

func countStatefulSets(ctx context.Context, clientset kubernetes.Interface, namespace string, outputFormat string) error {
	list, err := clientset.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list statefulsets: %w", err)
	}
	counts := make(map[string]int)
	for _, sts := range list.Items {
		if sts.Status.ReadyReplicas == sts.Status.Replicas && sts.Status.Replicas > 0 {
			counts["Ready"]++
		} else {
			counts["NotReady"]++
		}
	}
	return displayCountResults("StatefulSets", counts, len(list.Items), outputFormat)
}

func countAllResources(ctx context.Context, clientset kubernetes.Interface, namespace string, outputFormat string) error {
	type resourceCount struct {
		Type  string `json:"type"`
		Count int    `json:"count"`
	}

	var results []resourceCount
	var mu sync.Mutex
	var wg sync.WaitGroup

	resourceTypes := []string{"pods", "deployments", "services", "jobs", "cronjobs", "statefulsets", "daemonsets"}
	for _, resType := range resourceTypes {
		wg.Add(1)
		go func(resType string) {
			defer wg.Done()
			var count int
			switch resType {
			case "pods":
				if l, e := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{}); e == nil {
					count = len(l.Items)
				}
			case "deployments":
				if l, e := clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{}); e == nil {
					count = len(l.Items)
				}
			case "services":
				if l, e := clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{}); e == nil {
					count = len(l.Items)
				}
			case "jobs":
				if l, e := clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{}); e == nil {
					count = len(l.Items)
				}
			case "cronjobs":
				if l, e := clientset.BatchV1().CronJobs(namespace).List(ctx, metav1.ListOptions{}); e == nil {
					count = len(l.Items)
				}
			case "statefulsets":
				if l, e := clientset.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{}); e == nil {
					count = len(l.Items)
				}
			case "daemonsets":
				if l, e := clientset.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{}); e == nil {
					count = len(l.Items)
				}
			}
			mu.Lock()
			results = append(results, resourceCount{Type: resType, Count: count})
			mu.Unlock()
		}(resType)
	}
	wg.Wait()

	if outputFormat == "json" {
		data, _ := json.MarshalIndent(results, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	table := output.NewTable()
	table.Style = output.Rounded
	table.AddColumn(output.Column{Name: "RESOURCE TYPE", Priority: output.PriorityAlways, MinWidth: 20, MaxWidth: 30, Align: output.Left,
		ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Primary },
	})
	table.AddColumn(output.Column{Name: "COUNT", Priority: output.PriorityAlways, MinWidth: 10, MaxWidth: 15, Align: output.Right})
	for _, rc := range results {
		table.AddRow([]string{strings.ToUpper(rc.Type[:1]) + rc.Type[1:], fmt.Sprintf("%d", rc.Count)})
	}

	table.Print()
	return nil
}

func displayCountResults(resourceType string, counts map[string]int, total int, outputFormat string) error {
	if outputFormat == "json" {
		result := map[string]interface{}{"resource": resourceType, "counts": counts, "total": total}
		data, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	table := output.NewTable()
	table.Style = output.Rounded
	table.AddColumn(output.Column{
		Name: "STATUS", Priority: output.PriorityAlways,
		MinWidth: 15, MaxWidth: 25, Align: output.Left,
		ColorFunc: output.StatusColorFunc("pod"),
	})
	table.AddColumn(output.Column{
		Name: "COUNT", Priority: output.PriorityAlways,
		MinWidth: 10, MaxWidth: 15, Align: output.Right,
	})
	for status, count := range counts {
		table.AddRow([]string{output.FormatStatus(status), fmt.Sprintf("%d", count)})
	}
	table.SetFooter([]string{"Total", fmt.Sprintf("%d", total)})

	table.Print()
	return nil
}
