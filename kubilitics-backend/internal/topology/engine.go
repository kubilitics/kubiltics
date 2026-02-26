package topology

import (
	"context"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// buildNode creates a contract-shaped TopologyNode (id=kind/ns/name, kind, metadata, computed).
func buildNode(kind, namespace, name, status string, meta metav1.ObjectMeta) models.TopologyNode {
	id := kind + "/" + name
	if namespace != "" {
		id = kind + "/" + namespace + "/" + name
	}
	createdAt := ""
	if !meta.CreationTimestamp.IsZero() {
		createdAt = meta.CreationTimestamp.UTC().Format("2006-01-02T15:04:05Z")
	}
	if meta.Labels == nil {
		meta.Labels = make(map[string]string)
	}
	if meta.Annotations == nil {
		meta.Annotations = make(map[string]string)
	}
	return models.TopologyNode{
		ID:        id,
		Kind:      kind,
		Namespace: namespace,
		Name:      name,
		Status:    status,
		Metadata:  models.NodeMetadata{Labels: meta.Labels, Annotations: meta.Annotations, UID: string(meta.UID), CreatedAt: createdAt},
		Computed:  models.NodeComputed{Health: "healthy"},
	}
}

func convertOwnerRefs(refs []metav1.OwnerReference) []OwnerRef {
	out := make([]OwnerRef, 0, len(refs))
	for _, r := range refs {
		out = append(out, OwnerRef{UID: string(r.UID), Kind: r.Kind, Name: r.Name, Namespace: ""})
	}
	return out
}

// Engine builds topology graphs from Kubernetes resources
type Engine struct {
	client *k8s.Client
}

// NewEngine creates a new topology engine
func NewEngine(client *k8s.Client) *Engine {
	return &Engine{
		client: client,
	}
}

// BuildGraph constructs the topology graph (clusterID is used for contract metadata).
// maxNodes caps the number of nodes (C1.4); 0 = no limit. When reached, graph is truncated and IsComplete=false.
func (e *Engine) BuildGraph(ctx context.Context, filters models.TopologyFilters, clusterID string, maxNodes int) (*models.TopologyGraph, error) {
	graph := NewGraph(maxNodes)

	// Phase 1: Discover all resources
	if err := e.discoverResources(ctx, graph, filters); err != nil {
		return nil, fmt.Errorf("resource discovery failed: %w", err)
	}

	// Phase 2: Infer relationships
	inferencer := NewRelationshipInferencer(e, graph)
	if err := inferencer.InferAllRelationships(ctx); err != nil {
		return nil, fmt.Errorf("relationship inference failed: %w", err)
	}

	// Phase 3: Generate deterministic layout seed
	graph.LayoutSeed = graph.GenerateLayoutSeed()

	// Phase 4: Validate graph
	if err := graph.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}

	topology := graph.ToTopologyGraph(clusterID)
	return &topology, nil
}

// discoverResources discovers all K8s resources and creates nodes
func (e *Engine) discoverResources(ctx context.Context, graph *Graph, filters models.TopologyFilters) error {
	namespace := filters.Namespace
	if namespace == "" {
		namespace = metav1.NamespaceAll
	}

	// Core resources
	if err := e.discoverPods(ctx, graph, namespace); err != nil {
		return err
	}
	if err := e.discoverServices(ctx, graph, namespace); err != nil {
		return err
	}
	if err := e.discoverConfigMaps(ctx, graph, namespace); err != nil {
		return err
	}
	if err := e.discoverSecrets(ctx, graph, namespace); err != nil {
		return err
	}
	if err := e.discoverNodes(ctx, graph); err != nil {
		return err
	}
	if err := e.discoverNamespaces(ctx, graph); err != nil {
		return err
	}
	if err := e.discoverPersistentVolumes(ctx, graph); err != nil {
		return err
	}
	if err := e.discoverPersistentVolumeClaims(ctx, graph, namespace); err != nil {
		return err
	}
	if err := e.discoverServiceAccounts(ctx, graph, namespace); err != nil {
		return err
	}
	if err := e.discoverEndpoints(ctx, graph, namespace); err != nil {
		return err
	}

	// Apps resources
	if err := e.discoverDeployments(ctx, graph, namespace); err != nil {
		return err
	}
	if err := e.discoverReplicaSets(ctx, graph, namespace); err != nil {
		return err
	}
	if err := e.discoverStatefulSets(ctx, graph, namespace); err != nil {
		return err
	}
	if err := e.discoverDaemonSets(ctx, graph, namespace); err != nil {
		return err
	}

	// Batch resources
	if err := e.discoverJobs(ctx, graph, namespace); err != nil {
		return err
	}
	if err := e.discoverCronJobs(ctx, graph, namespace); err != nil {
		return err
	}

	// Networking resources
	if err := e.discoverIngresses(ctx, graph, namespace); err != nil {
		return err
	}
	if err := e.discoverNetworkPolicies(ctx, graph, namespace); err != nil {
		return err
	}

	// RBAC resources
	if err := e.discoverRoles(ctx, graph, namespace); err != nil {
		return err
	}
	if err := e.discoverRoleBindings(ctx, graph, namespace); err != nil {
		return err
	}
	if err := e.discoverClusterRoles(ctx, graph); err != nil {
		return err
	}
	if err := e.discoverClusterRoleBindings(ctx, graph); err != nil {
		return err
	}

	// Storage resources
	if err := e.discoverStorageClasses(ctx, graph); err != nil {
		return err
	}

	// Autoscaling resources
	if err := e.discoverHorizontalPodAutoscalers(ctx, graph, namespace); err != nil {
		return err
	}

	// Policy resources
	if err := e.discoverPodDisruptionBudgets(ctx, graph, namespace); err != nil {
		return err
	}

	return nil
}

func (e *Engine) discoverPods(ctx context.Context, graph *Graph, namespace string) error {
	pods, err := e.client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list pods: %w", err)
	}
	for _, pod := range pods.Items {
		node := buildNode("Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
		graph.AddNode(node)
		graph.SetOwnerRefs(node.ID, convertOwnerRefs(pod.OwnerReferences))
		saName := pod.Spec.ServiceAccountName
		if saName == "" {
			saName = "default"
		}
		graph.SetNodeExtra(node.ID, map[string]interface{}{"serviceAccountName": saName})
	}
	return nil
}

func (e *Engine) discoverServices(ctx context.Context, graph *Graph, namespace string) error {
	services, err := e.client.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list services: %w", err)
	}
	for _, svc := range services.Items {
		graph.AddNode(buildNode("Service", svc.Namespace, svc.Name, "Active", svc.ObjectMeta))
	}
	return nil
}

func (e *Engine) discoverDeployments(ctx context.Context, graph *Graph, namespace string) error {
	deployments, err := e.client.Clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list deployments: %w", err)
	}
	for _, deploy := range deployments.Items {
		node := buildNode("Deployment", deploy.Namespace, deploy.Name, "Active", deploy.ObjectMeta)
		graph.AddNode(node)
		graph.SetOwnerRefs(node.ID, convertOwnerRefs(deploy.OwnerReferences))
	}
	return nil
}

func (e *Engine) discoverReplicaSets(ctx context.Context, graph *Graph, namespace string) error {
	replicaSets, err := e.client.Clientset.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list replicasets: %w", err)
	}
	for _, rs := range replicaSets.Items {
		node := buildNode("ReplicaSet", rs.Namespace, rs.Name, "Active", rs.ObjectMeta)
		graph.AddNode(node)
		graph.SetOwnerRefs(node.ID, convertOwnerRefs(rs.OwnerReferences))
	}
	return nil
}

func (e *Engine) discoverStatefulSets(ctx context.Context, graph *Graph, namespace string) error {
	statefulSets, err := e.client.Clientset.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list statefulsets: %w", err)
	}
	for _, sts := range statefulSets.Items {
		node := buildNode("StatefulSet", sts.Namespace, sts.Name, "Active", sts.ObjectMeta)
		graph.AddNode(node)
		graph.SetOwnerRefs(node.ID, convertOwnerRefs(sts.OwnerReferences))
	}
	return nil
}

func (e *Engine) discoverDaemonSets(ctx context.Context, graph *Graph, namespace string) error {
	daemonSets, err := e.client.Clientset.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list daemonsets: %w", err)
	}
	for _, ds := range daemonSets.Items {
		node := buildNode("DaemonSet", ds.Namespace, ds.Name, "Active", ds.ObjectMeta)
		graph.AddNode(node)
		graph.SetOwnerRefs(node.ID, convertOwnerRefs(ds.OwnerReferences))
	}
	return nil
}

func (e *Engine) discoverJobs(ctx context.Context, graph *Graph, namespace string) error {
	jobs, err := e.client.Clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list jobs: %w", err)
	}
	for _, job := range jobs.Items {
		node := buildNode("Job", job.Namespace, job.Name, "Active", job.ObjectMeta)
		graph.AddNode(node)
		graph.SetOwnerRefs(node.ID, convertOwnerRefs(job.OwnerReferences))
	}
	return nil
}

func (e *Engine) discoverCronJobs(ctx context.Context, graph *Graph, namespace string) error {
	cronJobs, err := e.client.Clientset.BatchV1().CronJobs(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list cronjobs: %w", err)
	}
	for _, cj := range cronJobs.Items {
		node := buildNode("CronJob", cj.Namespace, cj.Name, "Active", cj.ObjectMeta)
		graph.AddNode(node)
		graph.SetOwnerRefs(node.ID, convertOwnerRefs(cj.OwnerReferences))
	}
	return nil
}

func (e *Engine) discoverConfigMaps(ctx context.Context, graph *Graph, namespace string) error {
	configMaps, err := e.client.Clientset.CoreV1().ConfigMaps(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list configmaps: %w", err)
	}
	for _, cm := range configMaps.Items {
		graph.AddNode(buildNode("ConfigMap", cm.Namespace, cm.Name, "Active", cm.ObjectMeta))
	}
	return nil
}

func (e *Engine) discoverSecrets(ctx context.Context, graph *Graph, namespace string) error {
	secrets, err := e.client.Clientset.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list secrets: %w", err)
	}
	for _, secret := range secrets.Items {
		graph.AddNode(buildNode("Secret", secret.Namespace, secret.Name, "Active", secret.ObjectMeta))
	}
	return nil
}

func (e *Engine) discoverNodes(ctx context.Context, graph *Graph) error {
	nodes, err := e.client.Clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list nodes: %w", err)
	}
	for _, node := range nodes.Items {
		status := "Ready"
		for _, cond := range node.Status.Conditions {
			if cond.Type == "Ready" && cond.Status != "True" {
				status = "NotReady"
			}
		}
		graphNode := buildNode("Node", "", node.Name, status, node.ObjectMeta)
		graph.AddNode(graphNode)
	}
	return nil
}

func (e *Engine) discoverNamespaces(ctx context.Context, graph *Graph) error {
	namespaces, err := e.client.Clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list namespaces: %w", err)
	}
	for _, ns := range namespaces.Items {
		graph.AddNode(buildNode("Namespace", "", ns.Name, string(ns.Status.Phase), ns.ObjectMeta))
	}
	return nil
}

func (e *Engine) discoverPersistentVolumes(ctx context.Context, graph *Graph) error {
	pvs, err := e.client.Clientset.CoreV1().PersistentVolumes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list persistent volumes: %w", err)
	}
	for _, pv := range pvs.Items {
		graph.AddNode(buildNode("PersistentVolume", "", pv.Name, string(pv.Status.Phase), pv.ObjectMeta))
	}
	return nil
}

func (e *Engine) discoverPersistentVolumeClaims(ctx context.Context, graph *Graph, namespace string) error {
	pvcs, err := e.client.Clientset.CoreV1().PersistentVolumeClaims(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list persistent volume claims: %w", err)
	}
	for _, pvc := range pvcs.Items {
		graph.AddNode(buildNode("PersistentVolumeClaim", pvc.Namespace, pvc.Name, string(pvc.Status.Phase), pvc.ObjectMeta))
	}
	return nil
}

func (e *Engine) discoverServiceAccounts(ctx context.Context, graph *Graph, namespace string) error {
	sas, err := e.client.Clientset.CoreV1().ServiceAccounts(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list service accounts: %w", err)
	}
	for _, sa := range sas.Items {
		graph.AddNode(buildNode("ServiceAccount", sa.Namespace, sa.Name, "Active", sa.ObjectMeta))
	}
	return nil
}

func (e *Engine) discoverEndpoints(ctx context.Context, graph *Graph, namespace string) error {
	endpoints, err := e.client.Clientset.CoreV1().Endpoints(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list endpoints: %w", err)
	}
	for _, ep := range endpoints.Items {
		graph.AddNode(buildNode("Endpoints", ep.Namespace, ep.Name, "Active", ep.ObjectMeta))
	}
	return nil
}

func (e *Engine) discoverIngresses(ctx context.Context, graph *Graph, namespace string) error {
	ingresses, err := e.client.Clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list ingresses: %w", err)
	}
	for _, ing := range ingresses.Items {
		node := buildNode("Ingress", ing.Namespace, ing.Name, "Active", ing.ObjectMeta)
		graph.AddNode(node)
		// Store spec for inference (rules -> http -> paths -> backend.service.name)
		var rules []interface{}
		for _, r := range ing.Spec.Rules {
			if r.HTTP != nil {
				var paths []interface{}
				for _, path := range r.HTTP.Paths {
					paths = append(paths, map[string]interface{}{
						"backend": map[string]interface{}{"service": map[string]interface{}{"name": path.Backend.Service.Name}},
					})
				}
				rules = append(rules, map[string]interface{}{"http": map[string]interface{}{"paths": paths}})
			}
		}
		graph.SetNodeExtra(node.ID, map[string]interface{}{"spec": map[string]interface{}{"rules": rules}})
	}
	return nil
}

func (e *Engine) discoverNetworkPolicies(ctx context.Context, graph *Graph, namespace string) error {
	nps, err := e.client.Clientset.NetworkingV1().NetworkPolicies(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list network policies: %w", err)
	}
	for _, np := range nps.Items {
		graph.AddNode(buildNode("NetworkPolicy", np.Namespace, np.Name, "Active", np.ObjectMeta))
	}
	return nil
}

func (e *Engine) discoverRoles(ctx context.Context, graph *Graph, namespace string) error {
	roles, err := e.client.Clientset.RbacV1().Roles(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list roles: %w", err)
	}
	for _, role := range roles.Items {
		graph.AddNode(buildNode("Role", role.Namespace, role.Name, "Active", role.ObjectMeta))
	}
	return nil
}

func (e *Engine) discoverRoleBindings(ctx context.Context, graph *Graph, namespace string) error {
	rbs, err := e.client.Clientset.RbacV1().RoleBindings(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list role bindings: %w", err)
	}
	for _, rb := range rbs.Items {
		node := buildNode("RoleBinding", rb.Namespace, rb.Name, "Active", rb.ObjectMeta)
		graph.AddNode(node)
		extra := map[string]interface{}{"roleRef": map[string]interface{}{"kind": rb.RoleRef.Kind, "name": rb.RoleRef.Name}}
		subs := make([]interface{}, 0, len(rb.Subjects))
		for _, s := range rb.Subjects {
			subs = append(subs, map[string]interface{}{"kind": s.Kind, "name": s.Name, "namespace": s.Namespace})
		}
		extra["subjects"] = subs
		graph.SetNodeExtra(node.ID, extra)
	}
	return nil
}

func (e *Engine) discoverClusterRoles(ctx context.Context, graph *Graph) error {
	crs, err := e.client.Clientset.RbacV1().ClusterRoles().List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list cluster roles: %w", err)
	}
	for _, cr := range crs.Items {
		graph.AddNode(buildNode("ClusterRole", "", cr.Name, "Active", cr.ObjectMeta))
	}
	return nil
}

func (e *Engine) discoverClusterRoleBindings(ctx context.Context, graph *Graph) error {
	crbs, err := e.client.Clientset.RbacV1().ClusterRoleBindings().List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list cluster role bindings: %w", err)
	}
	for _, crb := range crbs.Items {
		node := buildNode("ClusterRoleBinding", "", crb.Name, "Active", crb.ObjectMeta)
		graph.AddNode(node)
		extra := map[string]interface{}{"roleRef": map[string]interface{}{"kind": crb.RoleRef.Kind, "name": crb.RoleRef.Name}}
		subs := make([]interface{}, 0, len(crb.Subjects))
		for _, s := range crb.Subjects {
			subs = append(subs, map[string]interface{}{"kind": s.Kind, "name": s.Name, "namespace": s.Namespace})
		}
		extra["subjects"] = subs
		graph.SetNodeExtra(node.ID, extra)
	}
	return nil
}

func (e *Engine) discoverStorageClasses(ctx context.Context, graph *Graph) error {
	scs, err := e.client.Clientset.StorageV1().StorageClasses().List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list storage classes: %w", err)
	}
	for _, sc := range scs.Items {
		graph.AddNode(buildNode("StorageClass", "", sc.Name, "Active", sc.ObjectMeta))
	}
	return nil
}

func (e *Engine) discoverHorizontalPodAutoscalers(ctx context.Context, graph *Graph, namespace string) error {
	hpas, err := e.client.Clientset.AutoscalingV2().HorizontalPodAutoscalers(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list horizontal pod autoscalers: %w", err)
	}
	for _, hpa := range hpas.Items {
		node := buildNode("HorizontalPodAutoscaler", hpa.Namespace, hpa.Name, "Active", hpa.ObjectMeta)
		graph.AddNode(node)
		if hpa.Spec.ScaleTargetRef.Kind != "" {
			graph.SetNodeExtra(node.ID, map[string]interface{}{
				"scaleTargetRef": map[string]interface{}{"kind": hpa.Spec.ScaleTargetRef.Kind, "name": hpa.Spec.ScaleTargetRef.Name},
			})
		}
	}
	return nil
}

func (e *Engine) discoverPodDisruptionBudgets(ctx context.Context, graph *Graph, namespace string) error {
	pdbs, err := e.client.Clientset.PolicyV1().PodDisruptionBudgets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list pod disruption budgets: %w", err)
	}
	for _, pdb := range pdbs.Items {
		graph.AddNode(buildNode("PodDisruptionBudget", pdb.Namespace, pdb.Name, "Active", pdb.ObjectMeta))
	}
	return nil
}
