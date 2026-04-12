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

func newWhereCmd(a *app) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "where <resource[/name]> [flags]",
		Short: "Show where a resource is physically running",
		Long: `Display the physical location of Kubernetes resources on nodes.

For pods: shows node, zone, region, and IP in a key-value table.
For deployments/statefulsets/daemonsets: shows pod distribution across zones.

If only a resource type is given (no /name), all resources of that type are
listed with their locations.

Examples:
  kcli where pod/my-pod                 # Show single pod location
  kcli where pods                       # List all pods with their locations
  kcli where deployment/api-server      # Show deployment zone distribution
  kcli where deployments                # List all deployments with zone info
  kcli where statefulset/redis          # Show statefulset zone distribution
  kcli where daemonset/fluentbit        # Show daemonset zone distribution
  kcli where ds/node-exporter           # Short alias works too
  kcli where pods -n kube-system        # Pods in a specific namespace`,
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

			ctx := context.Background()

			// Check if arg contains "/" — specific resource vs bare type
			parts := strings.SplitN(args[0], "/", 2)
			if len(parts) == 2 {
				// resource/name format
				resourceType := mapResourceName(strings.ToLower(parts[0]))
				resourceName := parts[1]

				switch resourceType {
				case "pods":
					return showPodLocation(ctx, clientset, namespace, resourceName)
				case "deployments":
					return showDeploymentLocation(ctx, clientset, namespace, resourceName)
				case "statefulsets":
					return showStatefulSetLocation(ctx, clientset, namespace, resourceName)
				case "daemonsets":
					return showDaemonSetLocation(ctx, clientset, namespace, resourceName)
				default:
					return fmt.Errorf("'where' not supported for resource type: %s", resourceType)
				}
			}

			// Bare resource type — list all
			resourceType := mapResourceName(strings.ToLower(parts[0]))

			switch resourceType {
			case "pods":
				return listAllPodLocations(ctx, clientset, namespace)
			case "deployments":
				return listAllDeploymentLocations(ctx, clientset, namespace)
			case "statefulsets":
				return listAllStatefulSetLocations(ctx, clientset, namespace)
			case "daemonsets":
				return listAllDaemonSetLocations(ctx, clientset, namespace)
			default:
				return fmt.Errorf("'where' not supported for resource type: %s", resourceType)
			}
		},
	}

	return cmd
}

// ---------------------------------------------------------------------------
// Single-resource display
// ---------------------------------------------------------------------------

func showPodLocation(ctx context.Context, clientset kubernetes.Interface, namespace, podName string) error {
	pod, err := clientset.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get pod: %w", err)
	}

	var zone, region string
	if pod.Spec.NodeName != "" {
		nodeObj, err := clientset.CoreV1().Nodes().Get(ctx, pod.Spec.NodeName, metav1.GetOptions{})
		if err == nil {
			zone = nodeObj.Labels["topology.kubernetes.io/zone"]
			region = nodeObj.Labels["topology.kubernetes.io/region"]
		}
	}

	theme := output.GetTheme()
	fmt.Println(theme.Header.Render(fmt.Sprintf("Pod: %s", pod.Name)))

	table := output.NewTable()
	table.Style = output.Rounded
	table.AddColumn(output.Column{
		Name:     "FIELD",
		Priority: output.PriorityAlways,
		MinWidth: 10,
		MaxWidth: 20,
		ColorFunc: func(v string) lipgloss.Style {
			return theme.Muted
		},
	})
	table.AddColumn(output.Column{
		Name:     "VALUE",
		Priority: output.PriorityAlways,
		MinWidth: 15,
		MaxWidth: 60,
	})

	table.AddRow([]string{"Namespace", namespace})
	table.AddRow([]string{"Node", pod.Spec.NodeName})
	if zone != "" {
		table.AddRow([]string{"Zone", zone})
	}
	if region != "" {
		table.AddRow([]string{"Region", region})
	}
	if pod.Status.PodIP != "" {
		table.AddRow([]string{"IP", pod.Status.PodIP})
	}

	table.Print()
	return nil
}

func showDeploymentLocation(ctx context.Context, clientset kubernetes.Interface, namespace, deployName string) error {
	deploy, err := clientset.AppsV1().Deployments(namespace).Get(ctx, deployName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get deployment: %w", err)
	}

	theme := output.GetTheme()
	fmt.Println(theme.Header.Render(fmt.Sprintf("Deployment: %s (%d replicas)", deploy.Name, deploy.Status.Replicas)))

	rsList, _ := clientset.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
	zoneMap := make(map[string][]string)
	totalPods := 0

	for _, rs := range rsList.Items {
		if len(rs.OwnerReferences) > 0 && rs.OwnerReferences[0].Name == deployName {
			podList, _ := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
			for _, pod := range podList.Items {
				if len(pod.OwnerReferences) > 0 && pod.OwnerReferences[0].Name == rs.Name {
					totalPods++
					zone := "unknown"
					if pod.Spec.NodeName != "" {
						if nodeObj, err := clientset.CoreV1().Nodes().Get(ctx, pod.Spec.NodeName, metav1.GetOptions{}); err == nil {
							if z, exists := nodeObj.Labels["topology.kubernetes.io/zone"]; exists {
								zone = z
							}
						}
					}
					zoneMap[zone] = append(zoneMap[zone], pod.Spec.NodeName)
				}
			}
		}
	}

	printZoneDistribution(zoneMap, totalPods)
	return nil
}

func showStatefulSetLocation(ctx context.Context, clientset kubernetes.Interface, namespace, stsName string) error {
	sts, err := clientset.AppsV1().StatefulSets(namespace).Get(ctx, stsName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get statefulset: %w", err)
	}

	theme := output.GetTheme()
	fmt.Println(theme.Header.Render(fmt.Sprintf("StatefulSet: %s (%d replicas)", sts.Name, sts.Status.Replicas)))

	podList, _ := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	zoneMap := make(map[string][]string)
	totalPods := 0

	for _, pod := range podList.Items {
		if len(pod.OwnerReferences) > 0 && pod.OwnerReferences[0].Name == stsName {
			totalPods++
			zone := "unknown"
			if pod.Spec.NodeName != "" {
				if nodeObj, err := clientset.CoreV1().Nodes().Get(ctx, pod.Spec.NodeName, metav1.GetOptions{}); err == nil {
					if z, exists := nodeObj.Labels["topology.kubernetes.io/zone"]; exists {
						zone = z
					}
				}
			}
			zoneMap[zone] = append(zoneMap[zone], pod.Spec.NodeName)
		}
	}

	printZoneDistribution(zoneMap, totalPods)
	return nil
}

func showDaemonSetLocation(ctx context.Context, clientset kubernetes.Interface, namespace, dsName string) error {
	ds, err := clientset.AppsV1().DaemonSets(namespace).Get(ctx, dsName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get daemonset: %w", err)
	}

	theme := output.GetTheme()
	fmt.Println(theme.Header.Render(fmt.Sprintf("DaemonSet: %s (%d desired, %d ready)", ds.Name, ds.Status.DesiredNumberScheduled, ds.Status.NumberReady)))

	podList, _ := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	zoneMap := make(map[string][]string)
	totalPods := 0

	for _, pod := range podList.Items {
		if len(pod.OwnerReferences) > 0 && pod.OwnerReferences[0].Name == dsName {
			totalPods++
			zone := "unknown"
			if pod.Spec.NodeName != "" {
				if nodeObj, err := clientset.CoreV1().Nodes().Get(ctx, pod.Spec.NodeName, metav1.GetOptions{}); err == nil {
					if z, exists := nodeObj.Labels["topology.kubernetes.io/zone"]; exists {
						zone = z
					}
				}
			}
			zoneMap[zone] = append(zoneMap[zone], pod.Spec.NodeName)
		}
	}

	printZoneDistribution(zoneMap, totalPods)
	return nil
}

// ---------------------------------------------------------------------------
// List-all display (bare resource type, no /name)
// ---------------------------------------------------------------------------

func listAllPodLocations(ctx context.Context, clientset kubernetes.Interface, namespace string) error {
	podList, err := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list pods: %w", err)
	}

	if len(podList.Items) == 0 {
		theme := output.GetTheme()
		fmt.Println(theme.Muted.Render("No pods found in namespace " + namespace))
		return nil
	}

	// Cache node info to avoid repeated lookups
	nodeCache := make(map[string]nodeInfo)

	table := output.NewTable()
	table.Style = output.Rounded
	table.AddColumn(output.Column{Name: "NAME", Priority: output.PriorityAlways, MinWidth: 10, MaxWidth: 50})
	table.AddColumn(output.Column{Name: "NODE", Priority: output.PriorityAlways, MinWidth: 10, MaxWidth: 40})
	table.AddColumn(output.Column{Name: "ZONE", Priority: output.PriorityContext, MinWidth: 8, MaxWidth: 30})
	table.AddColumn(output.Column{Name: "REGION", Priority: output.PrioritySecondary, MinWidth: 8, MaxWidth: 30})
	table.AddColumn(output.Column{Name: "IP", Priority: output.PrioritySecondary, MinWidth: 10, MaxWidth: 20})

	for _, pod := range podList.Items {
		ni := resolveNodeInfo(ctx, clientset, pod.Spec.NodeName, nodeCache)
		table.AddRow([]string{pod.Name, pod.Spec.NodeName, ni.zone, ni.region, pod.Status.PodIP})
	}

	theme := output.GetTheme()
	fmt.Println(theme.Header.Render(fmt.Sprintf("Pods in namespace %s", namespace)))
	table.Print()
	return nil
}

func listAllDeploymentLocations(ctx context.Context, clientset kubernetes.Interface, namespace string) error {
	deployList, err := clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list deployments: %w", err)
	}

	if len(deployList.Items) == 0 {
		theme := output.GetTheme()
		fmt.Println(theme.Muted.Render("No deployments found in namespace " + namespace))
		return nil
	}

	table := output.NewTable()
	table.Style = output.Rounded
	table.AddColumn(output.Column{Name: "NAME", Priority: output.PriorityAlways, MinWidth: 10, MaxWidth: 50})
	table.AddColumn(output.Column{Name: "REPLICAS", Priority: output.PriorityAlways, MinWidth: 8, MaxWidth: 12, Align: output.Right})
	table.AddColumn(output.Column{Name: "ZONES", Priority: output.PriorityContext, MinWidth: 8, MaxWidth: 60})

	nodeCache := make(map[string]nodeInfo)
	rsList, _ := clientset.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
	podList, _ := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})

	for _, deploy := range deployList.Items {
		zones := make(map[string]bool)
		for _, rs := range rsList.Items {
			if len(rs.OwnerReferences) > 0 && rs.OwnerReferences[0].Name == deploy.Name {
				for _, pod := range podList.Items {
					if len(pod.OwnerReferences) > 0 && pod.OwnerReferences[0].Name == rs.Name {
						ni := resolveNodeInfo(ctx, clientset, pod.Spec.NodeName, nodeCache)
						if ni.zone != "" {
							zones[ni.zone] = true
						}
					}
				}
			}
		}
		zoneList := strings.Join(getMapKeys(zones), ", ")
		table.AddRow([]string{deploy.Name, fmt.Sprintf("%d", deploy.Status.Replicas), zoneList})
	}

	theme := output.GetTheme()
	fmt.Println(theme.Header.Render(fmt.Sprintf("Deployments in namespace %s", namespace)))
	table.Print()
	return nil
}

func listAllStatefulSetLocations(ctx context.Context, clientset kubernetes.Interface, namespace string) error {
	stsList, err := clientset.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list statefulsets: %w", err)
	}

	if len(stsList.Items) == 0 {
		theme := output.GetTheme()
		fmt.Println(theme.Muted.Render("No statefulsets found in namespace " + namespace))
		return nil
	}

	table := output.NewTable()
	table.Style = output.Rounded
	table.AddColumn(output.Column{Name: "NAME", Priority: output.PriorityAlways, MinWidth: 10, MaxWidth: 50})
	table.AddColumn(output.Column{Name: "REPLICAS", Priority: output.PriorityAlways, MinWidth: 8, MaxWidth: 12, Align: output.Right})
	table.AddColumn(output.Column{Name: "ZONES", Priority: output.PriorityContext, MinWidth: 8, MaxWidth: 60})

	nodeCache := make(map[string]nodeInfo)
	podList, _ := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})

	for _, sts := range stsList.Items {
		zones := make(map[string]bool)
		for _, pod := range podList.Items {
			if len(pod.OwnerReferences) > 0 && pod.OwnerReferences[0].Name == sts.Name {
				ni := resolveNodeInfo(ctx, clientset, pod.Spec.NodeName, nodeCache)
				if ni.zone != "" {
					zones[ni.zone] = true
				}
			}
		}
		zoneList := strings.Join(getMapKeys(zones), ", ")
		table.AddRow([]string{sts.Name, fmt.Sprintf("%d", sts.Status.Replicas), zoneList})
	}

	theme := output.GetTheme()
	fmt.Println(theme.Header.Render(fmt.Sprintf("StatefulSets in namespace %s", namespace)))
	table.Print()
	return nil
}

func listAllDaemonSetLocations(ctx context.Context, clientset kubernetes.Interface, namespace string) error {
	dsList, err := clientset.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list daemonsets: %w", err)
	}

	if len(dsList.Items) == 0 {
		theme := output.GetTheme()
		fmt.Println(theme.Muted.Render("No daemonsets found in namespace " + namespace))
		return nil
	}

	table := output.NewTable()
	table.Style = output.Rounded
	table.AddColumn(output.Column{Name: "NAME", Priority: output.PriorityAlways, MinWidth: 10, MaxWidth: 50})
	table.AddColumn(output.Column{Name: "DESIRED", Priority: output.PriorityAlways, MinWidth: 7, MaxWidth: 12, Align: output.Right})
	table.AddColumn(output.Column{Name: "READY", Priority: output.PriorityAlways, MinWidth: 5, MaxWidth: 12, Align: output.Right})
	table.AddColumn(output.Column{Name: "ZONES", Priority: output.PriorityContext, MinWidth: 8, MaxWidth: 60})

	nodeCache := make(map[string]nodeInfo)
	podList, _ := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})

	for _, ds := range dsList.Items {
		zones := make(map[string]bool)
		for _, pod := range podList.Items {
			if len(pod.OwnerReferences) > 0 && pod.OwnerReferences[0].Name == ds.Name {
				ni := resolveNodeInfo(ctx, clientset, pod.Spec.NodeName, nodeCache)
				if ni.zone != "" {
					zones[ni.zone] = true
				}
			}
		}
		zoneList := strings.Join(getMapKeys(zones), ", ")
		table.AddRow([]string{
			ds.Name,
			fmt.Sprintf("%d", ds.Status.DesiredNumberScheduled),
			fmt.Sprintf("%d", ds.Status.NumberReady),
			zoneList,
		})
	}

	theme := output.GetTheme()
	fmt.Println(theme.Header.Render(fmt.Sprintf("DaemonSets in namespace %s", namespace)))
	table.Print()
	return nil
}

// ---------------------------------------------------------------------------
// Zone distribution table (used by single-resource deploy/sts/ds)
// ---------------------------------------------------------------------------

func printZoneDistribution(zoneMap map[string][]string, totalPods int) {
	theme := output.GetTheme()

	table := output.NewTable()
	table.Style = output.Rounded
	table.AddColumn(output.Column{Name: "ZONE", Priority: output.PriorityAlways, MinWidth: 10, MaxWidth: 40})
	table.AddColumn(output.Column{Name: "PODS", Priority: output.PriorityAlways, MinWidth: 5, MaxWidth: 10, Align: output.Right})
	table.AddColumn(output.Column{Name: "NODES", Priority: output.PriorityAlways, MinWidth: 10, MaxWidth: 60})

	for zone, nodes := range zoneMap {
		nodeMap := make(map[string]bool)
		for _, n := range nodes {
			nodeMap[n] = true
		}
		table.AddRow([]string{zone, fmt.Sprintf("%d", len(nodes)), strings.Join(getMapKeys(nodeMap), ", ")})
	}

	table.SetFooter([]string{"Total", fmt.Sprintf("%d", totalPods), ""})
	table.Print()

	// Imbalance warning
	zoneCount := len(zoneMap)
	if zoneCount > 1 {
		avgPods := totalPods / zoneCount
		for zone, nodes := range zoneMap {
			if len(nodes) > avgPods*2 {
				fmt.Println(theme.Warning.Render(
					fmt.Sprintf("Warning: %s has %d pods (average: %d) — potential imbalance", zone, len(nodes), avgPods),
				))
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type nodeInfo struct {
	zone   string
	region string
}

func resolveNodeInfo(ctx context.Context, clientset kubernetes.Interface, nodeName string, cache map[string]nodeInfo) nodeInfo {
	if nodeName == "" {
		return nodeInfo{}
	}
	if ni, ok := cache[nodeName]; ok {
		return ni
	}
	ni := nodeInfo{}
	nodeObj, err := clientset.CoreV1().Nodes().Get(ctx, nodeName, metav1.GetOptions{})
	if err == nil {
		ni.zone = nodeObj.Labels["topology.kubernetes.io/zone"]
		ni.region = nodeObj.Labels["topology.kubernetes.io/region"]
	}
	cache[nodeName] = ni
	return ni
}
