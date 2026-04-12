package cli

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/k8sclient"
	"github.com/kubilitics/kubilitics/kubilitics-cli/internal/output"
)

func newAgeCmd(a *app) *cobra.Command {
	var oldest bool
	cmd := &cobra.Command{
		Use:   "age <resource> [flags]",
		Short: "List resources sorted by age",
		Long: `Display resources sorted by creation time.

Examples:
  kcli age pods                    # Pods sorted by age (newest first)
  kcli age pods --oldest           # Pods sorted by age (oldest first)
  kcli age deployments             # Deployments sorted by age
  kcli age pods -A                 # Pods across all namespaces`,
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

			return listByAge(context.Background(), clientset, namespace, resourceType, oldest)
		},
	}

	cmd.Flags().BoolP("all-namespaces", "A", false, "Show resources from all namespaces")
	cmd.Flags().BoolVar(&oldest, "oldest", false, "Sort oldest first instead of newest first")

	return cmd
}

type resourceWithAge struct {
	namespace string
	name      string
	age       time.Time
	status    string
	kind      string
}

func listByAge(ctx context.Context, clientset kubernetes.Interface, namespace, resourceType string, oldest bool) error {
	var resources []resourceWithAge

	switch resourceType {
	case "pods":
		podList, err := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return fmt.Errorf("failed to list pods: %w", err)
		}
		for _, pod := range podList.Items {
			resources = append(resources, resourceWithAge{
				namespace: pod.Namespace, name: pod.Name,
				age: pod.CreationTimestamp.Time, status: string(pod.Status.Phase), kind: "Pod",
			})
		}

	case "deployments":
		list, err := clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return fmt.Errorf("failed to list deployments: %w", err)
		}
		for _, d := range list.Items {
			resources = append(resources, resourceWithAge{
				namespace: d.Namespace, name: d.Name,
				age: d.CreationTimestamp.Time, status: fmt.Sprintf("%d/%d", d.Status.ReadyReplicas, d.Status.Replicas), kind: "Deployment",
			})
		}

	case "services":
		list, err := clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return fmt.Errorf("failed to list services: %w", err)
		}
		for _, s := range list.Items {
			resources = append(resources, resourceWithAge{
				namespace: s.Namespace, name: s.Name,
				age: s.CreationTimestamp.Time, status: string(s.Spec.Type), kind: "Service",
			})
		}

	case "statefulsets":
		list, err := clientset.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return fmt.Errorf("failed to list statefulsets: %w", err)
		}
		for _, s := range list.Items {
			resources = append(resources, resourceWithAge{
				namespace: s.Namespace, name: s.Name,
				age: s.CreationTimestamp.Time, status: fmt.Sprintf("%d/%d", s.Status.ReadyReplicas, s.Status.Replicas), kind: "StatefulSet",
			})
		}

	case "daemonsets":
		list, err := clientset.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return fmt.Errorf("failed to list daemonsets: %w", err)
		}
		for _, d := range list.Items {
			resources = append(resources, resourceWithAge{
				namespace: d.Namespace, name: d.Name,
				age: d.CreationTimestamp.Time, status: fmt.Sprintf("%d/%d", d.Status.NumberReady, d.Status.DesiredNumberScheduled), kind: "DaemonSet",
			})
		}

	case "jobs":
		list, err := clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return fmt.Errorf("failed to list jobs: %w", err)
		}
		for _, j := range list.Items {
			status := "Running"
			if j.Status.Succeeded > 0 {
				status = "Succeeded"
			} else if j.Status.Failed > 0 {
				status = "Failed"
			}
			resources = append(resources, resourceWithAge{
				namespace: j.Namespace, name: j.Name,
				age: j.CreationTimestamp.Time, status: status, kind: "Job",
			})
		}

	case "cronjobs":
		list, err := clientset.BatchV1().CronJobs(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return fmt.Errorf("failed to list cronjobs: %w", err)
		}
		for _, cj := range list.Items {
			status := "Active"
			if cj.Spec.Suspend != nil && *cj.Spec.Suspend {
				status = "Suspended"
			}
			resources = append(resources, resourceWithAge{
				namespace: cj.Namespace, name: cj.Name,
				age: cj.CreationTimestamp.Time, status: status, kind: "CronJob",
			})
		}

	case "configmaps":
		list, err := clientset.CoreV1().ConfigMaps(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return fmt.Errorf("failed to list configmaps: %w", err)
		}
		for _, cm := range list.Items {
			resources = append(resources, resourceWithAge{
				namespace: cm.Namespace, name: cm.Name,
				age: cm.CreationTimestamp.Time, status: "Active", kind: "ConfigMap",
			})
		}

	case "secrets":
		list, err := clientset.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return fmt.Errorf("failed to list secrets: %w", err)
		}
		for _, sec := range list.Items {
			resources = append(resources, resourceWithAge{
				namespace: sec.Namespace, name: sec.Name,
				age: sec.CreationTimestamp.Time, status: string(sec.Type), kind: "Secret",
			})
		}

	case "ingresses":
		list, err := clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return fmt.Errorf("failed to list ingresses: %w", err)
		}
		for _, ing := range list.Items {
			resources = append(resources, resourceWithAge{
				namespace: ing.Namespace, name: ing.Name,
				age: ing.CreationTimestamp.Time, status: "Active", kind: "Ingress",
			})
		}

	default:
		return fmt.Errorf("age not supported for resource type: %s", resourceType)
	}

	// Sort by age
	if oldest {
		sort.Slice(resources, func(i, j int) bool { return resources[i].age.Before(resources[j].age) })
	} else {
		sort.Slice(resources, func(i, j int) bool { return resources[i].age.After(resources[j].age) })
	}

	// Create table
	table := output.NewResourceTable(output.ResourceTableOpts{Scope: output.ScopeNamespaced})
	table.AddNameColumn()
	table.AddAgeColumn()
	table.AddColumn(output.Column{
		Name: "STATUS", Priority: output.PriorityCritical,
		MinWidth: 12, MaxWidth: 25, Align: output.Left,
		ColorFunc: output.StatusColorFunc("pod"),
	})

	for _, res := range resources {
		table.AddRow([]string{res.namespace, res.name, output.FormatAge(res.age), output.FormatStatus(res.status)})
	}

	table.Print()
	return nil
}
