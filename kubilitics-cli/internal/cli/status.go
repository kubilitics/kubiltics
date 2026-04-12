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

func newStatusCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "status [resource/name] [flags]",
		Short: "Quick status check",
		Long: `Display quick status information for resources or overall cluster health.

Examples:
  kcli status                         # Overall cluster health
  kcli status pod/my-pod              # Pod status
  kcli status deployment/api-server   # Deployment status with replica info`,
		GroupID: "observability",
		Args:    cobra.MaximumNArgs(1),
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

			ctx := context.Background()

			if len(args) == 0 {
				return showClusterHealth(ctx, clientset)
			}

			parts := strings.SplitN(args[0], "/", 2)
			if len(parts) != 2 {
				return fmt.Errorf("invalid resource specification, use format: resource/name or leave blank for cluster health")
			}

			resourceType := mapResourceName(strings.ToLower(parts[0]))
			resourceName := parts[1]

			switch resourceType {
			case "pods":
				return showPodStatus(ctx, clientset, namespace, resourceName)
			case "deployments":
				return showDeploymentStatus(ctx, clientset, namespace, resourceName)
			case "services":
				return showServiceStatus(ctx, clientset, namespace, resourceName)
			case "statefulsets":
				return showStatefulSetStatus(ctx, clientset, namespace, resourceName)
			case "daemonsets":
				return showDaemonSetStatus(ctx, clientset, namespace, resourceName)
			case "jobs":
				return showJobStatus(ctx, clientset, namespace, resourceName)
			default:
				return fmt.Errorf("status not supported for resource type: %s", resourceType)
			}
		},
	}

	return cmd
}

func showClusterHealth(ctx context.Context, clientset kubernetes.Interface) error {
	nodeList, err := clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to get nodes: %w", err)
	}
	readyNodes := 0
	for _, node := range nodeList.Items {
		for _, condition := range node.Status.Conditions {
			if condition.Type == "Ready" && condition.Status == "True" {
				readyNodes++
			}
		}
	}

	podList, err := clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to get pods: %w", err)
	}
	runningPods := 0
	for _, pod := range podList.Items {
		if pod.Status.Phase == "Running" {
			runningPods++
		}
	}

	deployList, err := clientset.AppsV1().Deployments("").List(ctx, metav1.ListOptions{})
	deployReady := 0
	totalDeploys := 0
	if err == nil {
		totalDeploys = len(deployList.Items)
		for _, d := range deployList.Items {
			if d.Status.ReadyReplicas == d.Status.Replicas && d.Status.Replicas > 0 {
				deployReady++
			}
		}
	}

	totalNodes := len(nodeList.Items)
	totalPods := len(podList.Items)

	table := output.NewTable()
	table.Style = output.Rounded
	table.AddColumn(output.Column{Name: "RESOURCE", Priority: output.PriorityAlways, MinWidth: 14, MaxWidth: 20, Align: output.Left,
		ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Primary },
	})
	table.AddColumn(output.Column{Name: "STATUS", Priority: output.PriorityAlways, MinWidth: 12, MaxWidth: 18, Align: output.Left,
		ColorFunc: output.StatusColorFunc(""),
	})
	table.AddColumn(output.Column{Name: "READY", Priority: output.PriorityAlways, MinWidth: 8, MaxWidth: 12, Align: output.Right,
		ColorFunc: output.ReadyColorFunc(),
	})
	table.AddColumn(output.Column{Name: "TOTAL", Priority: output.PriorityAlways, MinWidth: 6, MaxWidth: 10, Align: output.Right})

	nodeStatus := "Ready"
	if readyNodes < totalNodes {
		nodeStatus = "Degraded"
	}
	podStatus := "Running"
	if runningPods < totalPods {
		podStatus = "Issues"
	}
	deployStatus := "Ready"
	if deployReady < totalDeploys {
		deployStatus = "Degraded"
	}

	table.AddRow([]string{"Nodes", output.FormatStatus(nodeStatus), fmt.Sprintf("%d/%d", readyNodes, totalNodes), fmt.Sprintf("%d", totalNodes)})
	table.AddRow([]string{"Pods", output.FormatStatus(podStatus), fmt.Sprintf("%d/%d", runningPods, totalPods), fmt.Sprintf("%d", totalPods)})
	if totalDeploys > 0 {
		table.AddRow([]string{"Deployments", output.FormatStatus(deployStatus), fmt.Sprintf("%d/%d", deployReady, totalDeploys), fmt.Sprintf("%d", totalDeploys)})
	}

	fmt.Println()
	table.Print()
	return nil
}

func showPodStatus(ctx context.Context, clientset kubernetes.Interface, namespace, podName string) error {
	pod, err := clientset.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get pod: %w", err)
	}

	// Summary table
	summary := output.NewTable()
	summary.Style = output.Rounded
	summary.AddColumn(output.Column{Name: "FIELD", Priority: output.PriorityAlways, MinWidth: 12, MaxWidth: 18, Align: output.Left,
		ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Muted },
	})
	summary.AddColumn(output.Column{Name: "VALUE", Priority: output.PriorityAlways, MinWidth: 20, MaxWidth: 50, Align: output.Left})

	summary.AddRow([]string{"Namespace", pod.Namespace})
	summary.AddRow([]string{"Name", pod.Name})
	summary.AddRow([]string{"Status", output.FormatStatus(string(pod.Status.Phase))})
	summary.AddRow([]string{"Node", pod.Spec.NodeName})
	summary.AddRow([]string{"Pod IP", pod.Status.PodIP})
	summary.AddRow([]string{"Age", output.FormatAge(pod.CreationTimestamp.Time)})

	fmt.Println()
	summary.Print()

	// Containers table
	if len(pod.Status.ContainerStatuses) > 0 {
		ct := output.NewTable()
		ct.Style = output.Rounded
		ct.AddColumn(output.Column{Name: "CONTAINER", Priority: output.PriorityAlways, MinWidth: 15, MaxWidth: 35, Align: output.Left,
			ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Primary },
		})
		ct.AddColumn(output.Column{Name: "STATUS", Priority: output.PriorityAlways, MinWidth: 12, MaxWidth: 18, Align: output.Left,
			ColorFunc: output.StatusColorFunc("pod"),
		})
		ct.AddColumn(output.Column{Name: "RESTARTS", Priority: output.PriorityAlways, MinWidth: 8, MaxWidth: 10, Align: output.Right,
			ColorFunc: output.RestartColorFunc(),
		})

		for _, cs := range pod.Status.ContainerStatuses {
			status := "Ready"
			if !cs.Ready {
				status = "NotReady"
			}
			ct.AddRow([]string{cs.Name, output.FormatStatus(status), fmt.Sprintf("%d", cs.RestartCount)})
		}

		fmt.Println()
		ct.Print()
	}

	// Volumes table
	var volumes [][]string
	for _, vol := range pod.Spec.Volumes {
		switch {
		case vol.ConfigMap != nil:
			volumes = append(volumes, []string{"ConfigMap", vol.ConfigMap.Name})
		case vol.Secret != nil:
			volumes = append(volumes, []string{"Secret", vol.Secret.SecretName})
		case vol.PersistentVolumeClaim != nil:
			volumes = append(volumes, []string{"PVC", vol.PersistentVolumeClaim.ClaimName})
		}
	}
	if len(volumes) > 0 {
		vt := output.NewTable()
		vt.Style = output.Rounded
		vt.AddColumn(output.Column{Name: "VOLUME TYPE", Priority: output.PriorityAlways, MinWidth: 12, MaxWidth: 18, Align: output.Left})
		vt.AddColumn(output.Column{Name: "NAME", Priority: output.PriorityAlways, MinWidth: 15, MaxWidth: 40, Align: output.Left})
		for _, v := range volumes {
			vt.AddRow(v)
		}
		fmt.Println()
		vt.Print()
	}

	return nil
}

func showDeploymentStatus(ctx context.Context, clientset kubernetes.Interface, namespace, deployName string) error {
	deploy, err := clientset.AppsV1().Deployments(namespace).Get(ctx, deployName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get deployment: %w", err)
	}

	summary := newDetailTable()
	summary.AddRow([]string{"Namespace", deploy.Namespace})
	summary.AddRow([]string{"Name", deploy.Name})
	readyStr := fmt.Sprintf("%d/%d", deploy.Status.ReadyReplicas, deploy.Status.Replicas)
	status := "Ready"
	if deploy.Status.ReadyReplicas != deploy.Status.Replicas {
		status = "Degraded"
	}
	summary.AddRow([]string{"Status", output.FormatStatus(status)})
	summary.AddRow([]string{"Ready", readyStr})
	summary.AddRow([]string{"Up-to-date", fmt.Sprintf("%d", deploy.Status.UpdatedReplicas)})
	summary.AddRow([]string{"Available", fmt.Sprintf("%d", deploy.Status.AvailableReplicas)})
	stratType := string(deploy.Spec.Strategy.Type)
	if stratType == "" {
		stratType = "RollingUpdate"
	}
	summary.AddRow([]string{"Strategy", stratType})
	if deploy.Spec.Strategy.Type == "RollingUpdate" && deploy.Spec.Strategy.RollingUpdate != nil {
		summary.AddRow([]string{"Max Surge", fmt.Sprintf("%v", deploy.Spec.Strategy.RollingUpdate.MaxSurge)})
		summary.AddRow([]string{"Max Unavailable", fmt.Sprintf("%v", deploy.Spec.Strategy.RollingUpdate.MaxUnavailable)})
	}
	summary.AddRow([]string{"Age", output.FormatAge(deploy.CreationTimestamp.Time)})
	fmt.Println()
	summary.Print()

	if len(deploy.Status.Conditions) > 0 {
		ct := output.NewTable()
		ct.Style = output.Rounded
		ct.AddColumn(output.Column{Name: "CONDITION", Priority: output.PriorityAlways, MinWidth: 15, MaxWidth: 25, Align: output.Left,
			ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Primary },
		})
		ct.AddColumn(output.Column{Name: "STATUS", Priority: output.PriorityAlways, MinWidth: 12, MaxWidth: 18, Align: output.Left,
			ColorFunc: output.StatusColorFunc(""),
		})
		ct.AddColumn(output.Column{Name: "MESSAGE", Priority: output.PriorityCritical, MinWidth: 20, MaxWidth: 50, Align: output.Left})
		for _, cond := range deploy.Status.Conditions {
			s := "False"
			if cond.Status == "True" {
				s = "True"
			}
			ct.AddRow([]string{string(cond.Type), output.FormatStatus(s), cond.Message})
		}
		fmt.Println()
		ct.Print()
	}

	return nil
}

func showServiceStatus(ctx context.Context, clientset kubernetes.Interface, namespace, svcName string) error {
	svc, err := clientset.CoreV1().Services(namespace).Get(ctx, svcName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get service: %w", err)
	}

	summary := newDetailTable()
	summary.AddRow([]string{"Namespace", svc.Namespace})
	summary.AddRow([]string{"Name", svc.Name})
	summary.AddRow([]string{"Type", string(svc.Spec.Type)})
	summary.AddRow([]string{"Cluster IP", svc.Spec.ClusterIP})
	fmt.Println()
	summary.Print()

	if len(svc.Spec.Ports) > 0 {
		pt := output.NewTable()
		pt.Style = output.Rounded
		pt.AddColumn(output.Column{Name: "PORT NAME", Priority: output.PriorityAlways, MinWidth: 10, MaxWidth: 20, Align: output.Left})
		pt.AddColumn(output.Column{Name: "PORT", Priority: output.PriorityAlways, MinWidth: 6, MaxWidth: 10, Align: output.Right})
		pt.AddColumn(output.Column{Name: "TARGET", Priority: output.PriorityAlways, MinWidth: 8, MaxWidth: 15, Align: output.Right})
		pt.AddColumn(output.Column{Name: "PROTOCOL", Priority: output.PriorityAlways, MinWidth: 8, MaxWidth: 10, Align: output.Left})
		for _, port := range svc.Spec.Ports {
			proto := "TCP"
			if port.Protocol != "" {
				proto = string(port.Protocol)
			}
			pt.AddRow([]string{port.Name, fmt.Sprintf("%d", port.Port), port.TargetPort.String(), proto})
		}
		fmt.Println()
		pt.Print()
	}

	ep, err := clientset.CoreV1().Endpoints(namespace).Get(ctx, svcName, metav1.GetOptions{})
	if err == nil && len(ep.Subsets) > 0 {
		et := output.NewTable()
		et.Style = output.Rounded
		et.AddColumn(output.Column{Name: "ENDPOINT", Priority: output.PriorityAlways, MinWidth: 12, MaxWidth: 20, Align: output.Left,
			ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Success },
		})
		for _, subset := range ep.Subsets {
			for _, addr := range subset.Addresses {
				et.AddRow([]string{addr.IP})
			}
		}
		fmt.Println()
		et.Print()
	}

	return nil
}

func showStatefulSetStatus(ctx context.Context, clientset kubernetes.Interface, namespace, stsName string) error {
	sts, err := clientset.AppsV1().StatefulSets(namespace).Get(ctx, stsName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get statefulset: %w", err)
	}

	status := "Ready"
	if sts.Status.ReadyReplicas != sts.Status.Replicas {
		status = "Degraded"
	}

	summary := newDetailTable()
	summary.AddRow([]string{"Namespace", sts.Namespace})
	summary.AddRow([]string{"Name", sts.Name})
	summary.AddRow([]string{"Status", output.FormatStatus(status)})
	summary.AddRow([]string{"Ready", fmt.Sprintf("%d/%d", sts.Status.ReadyReplicas, sts.Status.Replicas)})
	summary.AddRow([]string{"Age", output.FormatAge(sts.CreationTimestamp.Time)})
	fmt.Println()
	summary.Print()
	return nil
}

func showDaemonSetStatus(ctx context.Context, clientset kubernetes.Interface, namespace, dsName string) error {
	ds, err := clientset.AppsV1().DaemonSets(namespace).Get(ctx, dsName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get daemonset: %w", err)
	}

	status := "Ready"
	if ds.Status.NumberReady != ds.Status.DesiredNumberScheduled {
		status = "Degraded"
	}

	summary := newDetailTable()
	summary.AddRow([]string{"Namespace", ds.Namespace})
	summary.AddRow([]string{"Name", ds.Name})
	summary.AddRow([]string{"Status", output.FormatStatus(status)})
	summary.AddRow([]string{"Ready", fmt.Sprintf("%d/%d", ds.Status.NumberReady, ds.Status.DesiredNumberScheduled)})
	summary.AddRow([]string{"Age", output.FormatAge(ds.CreationTimestamp.Time)})
	fmt.Println()
	summary.Print()
	return nil
}

func showJobStatus(ctx context.Context, clientset kubernetes.Interface, namespace, jobName string) error {
	job, err := clientset.BatchV1().Jobs(namespace).Get(ctx, jobName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get job: %w", err)
	}

	status := "Running"
	if job.Status.Succeeded > 0 {
		status = "Succeeded"
	} else if job.Status.Failed > 0 {
		status = "Failed"
	}

	summary := newDetailTable()
	summary.AddRow([]string{"Namespace", job.Namespace})
	summary.AddRow([]string{"Name", job.Name})
	summary.AddRow([]string{"Status", output.FormatStatus(status)})
	summary.AddRow([]string{"Active", fmt.Sprintf("%d", job.Status.Active)})
	summary.AddRow([]string{"Succeeded", fmt.Sprintf("%d", job.Status.Succeeded)})
	summary.AddRow([]string{"Failed", fmt.Sprintf("%d", job.Status.Failed)})
	summary.AddRow([]string{"Age", output.FormatAge(job.CreationTimestamp.Time)})
	fmt.Println()
	summary.Print()
	return nil
}

// newDetailTable creates a reusable key-value table for resource detail views.
func newDetailTable() *output.Table {
	table := output.NewTable()
	table.Style = output.Rounded
	table.AddColumn(output.Column{Name: "FIELD", Priority: output.PriorityAlways, MinWidth: 15, MaxWidth: 20, Align: output.Left,
		ColorFunc: func(string) lipgloss.Style { return output.GetTheme().Muted },
	})
	table.AddColumn(output.Column{Name: "VALUE", Priority: output.PriorityAlways, MinWidth: 20, MaxWidth: 50, Align: output.Left})
	return table
}
