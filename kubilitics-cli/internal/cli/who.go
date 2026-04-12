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

func newWhoCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "who <resource/name> [flags]",
		Short: "Trace resource ownership chain",
		Long: `Show the ownership chain and related resources for a Kubernetes object.

Displays:
  - Ownership chain (upward traversal to owners)
  - Related resources (services, configmaps, secrets)
  - Service accounts and mounted volumes

Examples:
  kcli who pod/my-pod                 # Show pod ownership chain
  kcli who deployment/payment-service # Show deployment and related resources
  kcli who service/api-gateway        # Show service endpoints and selected pods
  kcli who statefulset/redis          # Show statefulset ownership and pods
  kcli who daemonset/fluentd          # Show daemonset pods across nodes
  kcli who job/db-migrate             # Show job status, owner cronjob, and pods
  kcli who pod/my-pod -n production   # Show ownership in a specific namespace`,
		GroupID: "observability",
		Args:    cobra.ExactArgs(1),
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
			if namespace == "" {
				namespace = "default"
			}

			parts := strings.SplitN(args[0], "/", 2)
			if len(parts) != 2 {
				return fmt.Errorf("invalid resource specification, use format: resource/name")
			}
			resourceType := mapResourceName(strings.ToLower(parts[0]))
			resourceName := parts[1]
			ctx := context.Background()

			switch resourceType {
			case "pods":
				return showPodOwnership(ctx, clientset, namespace, resourceName)
			case "deployments":
				return showDeploymentOwnership(ctx, clientset, namespace, resourceName)
			case "services":
				return showServiceOwnership(ctx, clientset, namespace, resourceName)
			case "statefulsets":
				return showStatefulSetOwnership(ctx, clientset, namespace, resourceName)
			case "daemonsets":
				return showDaemonSetOwnership(ctx, clientset, namespace, resourceName)
			case "jobs":
				return showJobOwnership(ctx, clientset, namespace, resourceName)
			default:
				return fmt.Errorf("'who' not supported for resource type: %s", resourceType)
			}
		},
	}

	return cmd
}

// ownershipHeader prints the styled "Ownership Chain:" header.
func ownershipHeader() {
	theme := output.GetTheme()
	fmt.Println(theme.Header.Render("Ownership Chain:"))
}

// ownershipNamespace prints a styled namespace line in the ownership tree.
func ownershipNamespace(namespace string) {
	theme := output.GetTheme()
	fmt.Printf("  └─ %s %s\n",
		theme.Primary.Render("Namespace:"),
		theme.Muted.Render(namespace))
}

// ownershipKind prints a styled resource kind+name at a given indent depth in the tree.
func ownershipKind(indent int, kind, name string) {
	theme := output.GetTheme()
	prefix := strings.Repeat("   ", indent) + "  └─ "
	fmt.Printf("%s%s %s\n", prefix,
		theme.Primary.Render(kind+":"),
		theme.Info.Render(name))
}

// ownershipKindReady prints a styled resource kind+name with a ready count.
func ownershipKindReady(indent int, kind, name string, ready, total int32) {
	theme := output.GetTheme()
	prefix := strings.Repeat("   ", indent) + "  └─ "

	readyStr := fmt.Sprintf("(%d/%d ready)", ready, total)
	var readyStyle lipgloss.Style
	if ready == total && ready > 0 {
		readyStyle = theme.StatusReady
	} else if ready == 0 {
		readyStyle = theme.StatusError
	} else {
		readyStyle = theme.StatusPending
	}

	fmt.Printf("%s%s %s %s\n", prefix,
		theme.Primary.Render(kind+":"),
		theme.Info.Render(name),
		readyStyle.Render(readyStr))
}

// ownershipYouAreHere prints a styled "YOU ARE HERE" marker for the target resource.
func ownershipYouAreHere(indent int, kind, name, status, age string) {
	theme := output.GetTheme()
	prefix := strings.Repeat("   ", indent) + "  └─ "
	fmt.Printf("%s%s %s (%s, %s)  %s\n", prefix,
		theme.Primary.Render(kind+":"),
		theme.Info.Render(name),
		status, age,
		theme.Highlight.Bold(true).Render("← YOU ARE HERE"))
}

// newRelatedResourcesTable creates a styled table for related resources.
func newRelatedResourcesTable() *output.Table {
	table := output.NewTable()
	table.Style = output.Rounded
	table.AddColumn(output.Column{
		Name:     "TYPE",
		Priority: output.PriorityAlways,
		MinWidth: 14,
		MaxWidth: 20,
		Align:    output.Left,
		ColorFunc: func(string) lipgloss.Style {
			return output.GetTheme().Primary
		},
	})
	table.AddColumn(output.Column{
		Name:     "NAME",
		Priority: output.PriorityAlways,
		MinWidth: 20,
		MaxWidth: 50,
		Align:    output.Left,
		ColorFunc: func(string) lipgloss.Style {
			return output.GetTheme().Info
		},
	})
	table.AddColumn(output.Column{
		Name:     "DETAIL",
		Priority: output.PrioritySecondary,
		MinWidth: 15,
		MaxWidth: 40,
		Align:    output.Left,
		ColorFunc: func(string) lipgloss.Style {
			return output.GetTheme().Muted
		},
	})
	return table
}

// newPodTable creates a styled table for pod listings.
func newPodTable() *output.Table {
	table := output.NewTable()
	table.Style = output.Rounded
	table.AddNameColumn()
	table.AddStatusColumn("pod")
	table.AddAgeColumn()
	table.AddColumn(output.Column{
		Name:     "NODE",
		Priority: output.PrioritySecondary,
		MinWidth: 12,
		MaxWidth: 40,
		Align:    output.Left,
		ColorFunc: func(string) lipgloss.Style {
			return output.GetTheme().Muted
		},
	})
	return table
}

// sectionHeader prints a styled section header with a blank line before it.
func sectionHeader(title string) {
	theme := output.GetTheme()
	fmt.Printf("\n%s\n", theme.Header.Render("  "+title))
}

func showPodOwnership(ctx context.Context, clientset kubernetes.Interface, namespace, podName string) error {
	pod, err := clientset.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get pod: %w", err)
	}

	ownershipHeader()
	ownershipNamespace(namespace)

	if len(pod.OwnerReferences) > 0 {
		owner := pod.OwnerReferences[0]
		ownershipKind(1, owner.Kind, owner.Name)

		if owner.Kind == "ReplicaSet" {
			rs, err := clientset.AppsV1().ReplicaSets(namespace).Get(ctx, owner.Name, metav1.GetOptions{})
			if err == nil && len(rs.OwnerReferences) > 0 && rs.OwnerReferences[0].Kind == "Deployment" {
				deploy, _ := clientset.AppsV1().Deployments(namespace).Get(ctx, rs.OwnerReferences[0].Name, metav1.GetOptions{})
				if deploy != nil {
					ownershipKindReady(2, "Deployment", deploy.Name, deploy.Status.ReadyReplicas, deploy.Status.Replicas)
				}
			}
		}
	}

	ownershipYouAreHere(2, "Pod", pod.Name,
		string(pod.Status.Phase), output.FormatAge(pod.CreationTimestamp.Time))

	// Related Resources table
	sectionHeader("Related Resources")

	table := newRelatedResourcesTable()

	svcList, _ := clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	for _, svc := range svcList.Items {
		if matchesSelector(pod.Labels, svc.Spec.Selector) {
			table.AddRow([]string{"Service", svc.Name, fmt.Sprintf("%s %s", svc.Spec.Type, svc.Spec.ClusterIP)})
		}
	}

	for _, vol := range pod.Spec.Volumes {
		if vol.ConfigMap != nil {
			table.AddRow([]string{"ConfigMap", vol.ConfigMap.Name, "mounted"})
		}
		if vol.Secret != nil {
			table.AddRow([]string{"Secret", vol.Secret.SecretName, "mounted"})
		}
	}

	if pod.Spec.ServiceAccountName != "" {
		table.AddRow([]string{"ServiceAccount", pod.Spec.ServiceAccountName, ""})
	}

	if len(table.Rows) > 0 {
		table.Print()
	} else {
		theme := output.GetTheme()
		fmt.Printf("  %s\n", theme.Muted.Render("(no related resources found)"))
	}

	return nil
}

func showDeploymentOwnership(ctx context.Context, clientset kubernetes.Interface, namespace, deployName string) error {
	deploy, err := clientset.AppsV1().Deployments(namespace).Get(ctx, deployName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get deployment: %w", err)
	}

	ownershipHeader()
	ownershipNamespace(namespace)
	ownershipKindReady(1, "Deployment", deploy.Name, deploy.Status.ReadyReplicas, deploy.Status.Replicas)

	// Pods table
	sectionHeader("Related Pods")

	podTable := newPodTable()
	rsList, _ := clientset.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
	for _, rs := range rsList.Items {
		if len(rs.OwnerReferences) > 0 && rs.OwnerReferences[0].Name == deployName {
			podList, _ := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
			for _, pod := range podList.Items {
				if len(pod.OwnerReferences) > 0 && pod.OwnerReferences[0].Name == rs.Name {
					podTable.AddRow([]string{
						pod.Name,
						output.FormatStatus(string(pod.Status.Phase)),
						output.FormatAge(pod.CreationTimestamp.Time),
						pod.Spec.NodeName,
					})
				}
			}
		}
	}

	if len(podTable.Rows) > 0 {
		podTable.Print()
	} else {
		theme := output.GetTheme()
		fmt.Printf("  %s\n", theme.Muted.Render("(no pods found)"))
	}

	// Related Resources table
	sectionHeader("Related Resources")

	table := newRelatedResourcesTable()

	if deploy.Spec.Template.Spec.ServiceAccountName != "" {
		table.AddRow([]string{"ServiceAccount", deploy.Spec.Template.Spec.ServiceAccountName, ""})
	}
	for _, vol := range deploy.Spec.Template.Spec.Volumes {
		if vol.ConfigMap != nil {
			table.AddRow([]string{"ConfigMap", vol.ConfigMap.Name, ""})
		}
		if vol.Secret != nil {
			table.AddRow([]string{"Secret", vol.Secret.SecretName, ""})
		}
	}

	if len(table.Rows) > 0 {
		table.Print()
	} else {
		theme := output.GetTheme()
		fmt.Printf("  %s\n", theme.Muted.Render("(no related resources found)"))
	}

	return nil
}

func showServiceOwnership(ctx context.Context, clientset kubernetes.Interface, namespace, svcName string) error {
	svc, err := clientset.CoreV1().Services(namespace).Get(ctx, svcName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get service: %w", err)
	}

	ownershipHeader()
	ownershipNamespace(namespace)
	ownershipKind(1, "Service", svc.Name)

	// Service details as a related resources table
	sectionHeader("Service Details")

	detailTable := newRelatedResourcesTable()
	detailTable.AddRow([]string{"Type", string(svc.Spec.Type), ""})
	detailTable.AddRow([]string{"ClusterIP", svc.Spec.ClusterIP, ""})
	detailTable.Print()

	// Selected Pods table
	sectionHeader("Selected Pods")

	podTable := newPodTable()
	podList, _ := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	for _, pod := range podList.Items {
		if matchesSelector(pod.Labels, svc.Spec.Selector) {
			podTable.AddRow([]string{
				pod.Name,
				output.FormatStatus(string(pod.Status.Phase)),
				output.FormatAge(pod.CreationTimestamp.Time),
				pod.Spec.NodeName,
			})
		}
	}

	if len(podTable.Rows) > 0 {
		podTable.Print()
	} else {
		theme := output.GetTheme()
		fmt.Printf("  %s\n", theme.Muted.Render("(no pods matching selector)"))
	}

	return nil
}

func showStatefulSetOwnership(ctx context.Context, clientset kubernetes.Interface, namespace, stsName string) error {
	sts, err := clientset.AppsV1().StatefulSets(namespace).Get(ctx, stsName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get statefulset: %w", err)
	}

	ownershipHeader()
	ownershipNamespace(namespace)
	ownershipKindReady(1, "StatefulSet", sts.Name, sts.Status.ReadyReplicas, sts.Status.Replicas)

	// Pods table
	sectionHeader("Pods")

	podTable := newPodTable()
	podList, _ := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	for _, pod := range podList.Items {
		if len(pod.OwnerReferences) > 0 && pod.OwnerReferences[0].Name == stsName {
			podTable.AddRow([]string{
				pod.Name,
				output.FormatStatus(string(pod.Status.Phase)),
				output.FormatAge(pod.CreationTimestamp.Time),
				pod.Spec.NodeName,
			})
		}
	}

	if len(podTable.Rows) > 0 {
		podTable.Print()
	} else {
		theme := output.GetTheme()
		fmt.Printf("  %s\n", theme.Muted.Render("(no pods found)"))
	}

	return nil
}

func showDaemonSetOwnership(ctx context.Context, clientset kubernetes.Interface, namespace, dsName string) error {
	ds, err := clientset.AppsV1().DaemonSets(namespace).Get(ctx, dsName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get daemonset: %w", err)
	}

	ownershipHeader()
	ownershipNamespace(namespace)
	ownershipKindReady(1, "DaemonSet", ds.Name, ds.Status.NumberReady, ds.Status.DesiredNumberScheduled)

	// Pods table
	sectionHeader("Pods")

	podTable := newPodTable()
	podList, _ := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	for _, pod := range podList.Items {
		if len(pod.OwnerReferences) > 0 && pod.OwnerReferences[0].Name == dsName {
			podTable.AddRow([]string{
				pod.Name,
				output.FormatStatus(string(pod.Status.Phase)),
				output.FormatAge(pod.CreationTimestamp.Time),
				pod.Spec.NodeName,
			})
		}
	}

	if len(podTable.Rows) > 0 {
		podTable.Print()
	} else {
		theme := output.GetTheme()
		fmt.Printf("  %s\n", theme.Muted.Render("(no pods found)"))
	}

	return nil
}

func showJobOwnership(ctx context.Context, clientset kubernetes.Interface, namespace, jobName string) error {
	job, err := clientset.BatchV1().Jobs(namespace).Get(ctx, jobName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get job: %w", err)
	}

	ownershipHeader()
	ownershipNamespace(namespace)
	if len(job.OwnerReferences) > 0 && job.OwnerReferences[0].Kind == "CronJob" {
		ownershipKind(1, "CronJob", job.OwnerReferences[0].Name)
		ownershipKind(2, "Job", job.Name)
	} else {
		ownershipKind(1, "Job", job.Name)
	}

	// Job Status as a related resources table
	sectionHeader("Job Status")

	statusTable := newRelatedResourcesTable()
	statusTable.AddRow([]string{"Succeeded", fmt.Sprintf("%d", job.Status.Succeeded), ""})
	statusTable.AddRow([]string{"Failed", fmt.Sprintf("%d", job.Status.Failed), ""})
	statusTable.AddRow([]string{"Active", fmt.Sprintf("%d", job.Status.Active), ""})
	statusTable.Print()

	// Pods table
	sectionHeader("Pods")

	podTable := newPodTable()
	podList, _ := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	for _, pod := range podList.Items {
		if len(pod.OwnerReferences) > 0 && pod.OwnerReferences[0].Name == jobName {
			podTable.AddRow([]string{
				pod.Name,
				output.FormatStatus(string(pod.Status.Phase)),
				output.FormatAge(pod.CreationTimestamp.Time),
				pod.Spec.NodeName,
			})
		}
	}

	if len(podTable.Rows) > 0 {
		podTable.Print()
	} else {
		theme := output.GetTheme()
		fmt.Printf("  %s\n", theme.Muted.Render("(no pods found)"))
	}

	return nil
}
