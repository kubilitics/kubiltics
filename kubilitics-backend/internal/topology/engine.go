package topology

import (
	"context"
	"fmt"
	"log"
	"strings"

	"golang.org/x/sync/errgroup"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
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

	// Phase 3: Prune disconnected cluster-scoped resources when namespace filter is active.
	// Without this, ALL Nodes/PVs/StorageClasses/ClusterRoles appear even if unrelated
	// to the selected namespace, creating visual islands in the topology.
	if filters.Namespace != "" {
		graph.PruneDisconnectedClusterScoped()
	}

	// Phase 4: Generate deterministic layout seed
	graph.LayoutSeed = graph.GenerateLayoutSeed()

	// Phase 5: Validate graph
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

	// All discover* methods are now thread-safe via graph.mu.
	// Run all resource discovery calls concurrently with bounded parallelism.
	type discoverFunc func() error
	discoveries := []discoverFunc{
		// Core resources
		func() error { return e.discoverPods(ctx, graph, namespace) },
		func() error { return e.discoverServices(ctx, graph, namespace) },
		func() error { return e.discoverConfigMaps(ctx, graph, namespace) },
		func() error { return e.discoverSecrets(ctx, graph, namespace) },
		func() error { return e.discoverNodes(ctx, graph) },
		func() error { return e.discoverNamespaces(ctx, graph, namespace) },
		func() error { return e.discoverPersistentVolumes(ctx, graph) },
		func() error { return e.discoverPersistentVolumeClaims(ctx, graph, namespace) },
		func() error { return e.discoverServiceAccounts(ctx, graph, namespace) },
		func() error { return e.discoverEndpoints(ctx, graph, namespace) },
		// Apps resources
		func() error { return e.discoverDeployments(ctx, graph, namespace) },
		func() error { return e.discoverReplicaSets(ctx, graph, namespace) },
		func() error { return e.discoverStatefulSets(ctx, graph, namespace) },
		func() error { return e.discoverDaemonSets(ctx, graph, namespace) },
		// Batch resources
		func() error { return e.discoverJobs(ctx, graph, namespace) },
		func() error { return e.discoverCronJobs(ctx, graph, namespace) },
		// Networking resources
		func() error { return e.discoverIngresses(ctx, graph, namespace) },
		func() error { return e.discoverNetworkPolicies(ctx, graph, namespace) },
		// RBAC resources
		func() error { return e.discoverRoles(ctx, graph, namespace) },
		func() error { return e.discoverRoleBindings(ctx, graph, namespace) },
		func() error { return e.discoverClusterRoles(ctx, graph) },
		func() error { return e.discoverClusterRoleBindings(ctx, graph) },
		// Storage resources
		func() error { return e.discoverStorageClasses(ctx, graph) },
		// Autoscaling resources
		func() error { return e.discoverHorizontalPodAutoscalers(ctx, graph, namespace) },
		// Policy resources
		func() error { return e.discoverPodDisruptionBudgets(ctx, graph, namespace) },
		// Custom Resource Definitions (CRD instances via dynamic client)
		func() error { return e.discoverCustomResources(ctx, graph, namespace) },
	}

	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(5) // Bound concurrent K8s API calls to avoid overloading apiserver
	_ = gctx      // gctx propagated via closure captures of ctx

	for _, fn := range discoveries {
		fn := fn // capture loop var
		g.Go(func() error {
			if err := fn(); err != nil {
				// Log and continue — partial graph recovery instead of failing on first error
				log.Printf("topology: resource discovery error (continuing): %v", err)
				return nil
			}
			return nil
		})
	}

	if err := g.Wait(); err != nil {
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

		// Infer health from actual container statuses and pod phase (P1 topology data model fix).
		health := "healthy"
		totalRestarts := 0
		unhealthy := false
		for _, cs := range pod.Status.ContainerStatuses {
			totalRestarts += int(cs.RestartCount)
			if cs.State.Waiting != nil {
				switch cs.State.Waiting.Reason {
				case "CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull",
					"CreateContainerConfigError", "InvalidImageName", "CreateContainerError":
					unhealthy = true
				}
			}
			if cs.State.Terminated != nil && cs.State.Terminated.ExitCode != 0 {
				unhealthy = true
			}
		}
		for _, cs := range pod.Status.InitContainerStatuses {
			totalRestarts += int(cs.RestartCount)
			if cs.State.Waiting != nil {
				switch cs.State.Waiting.Reason {
				case "CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull",
					"CreateContainerConfigError", "InvalidImageName", "CreateContainerError":
					unhealthy = true
				}
			}
		}
		if unhealthy {
			health = "unhealthy"
		} else {
			switch string(pod.Status.Phase) {
			case "Running", "Succeeded":
				health = "healthy"
			case "Pending":
				health = "warning"
			case "Failed":
				health = "unhealthy"
			default:
				health = "warning"
			}
		}
		node.Computed.Health = health
		if totalRestarts > 0 {
			node.Computed.RestartCount = &totalRestarts
		}

		graph.AddNode(node)
		graph.SetOwnerRefs(node.ID, convertOwnerRefs(pod.OwnerReferences))
		// Cache full pod spec so inferVolumeRelationships / inferEnvironmentRelationships
		// can reuse it instead of re-fetching each pod individually from the API server.
		graph.mu.Lock()
		graph.PodSpecCache[pod.Namespace+"/"+pod.Name] = pod.Spec
		graph.mu.Unlock()
		saName := pod.Spec.ServiceAccountName
		if saName == "" {
			saName = "default"
		}
		extra := map[string]interface{}{"serviceAccountName": saName}
		if pod.Spec.NodeName != "" {
			extra["nodeName"] = pod.Spec.NodeName
		}
		graph.SetNodeExtra(node.ID, extra)
	}
	return nil
}

func (e *Engine) discoverServices(ctx context.Context, graph *Graph, namespace string) error {
	services, err := e.client.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list services: %w", err)
	}
	for _, svc := range services.Items {
		node := buildNode("Service", svc.Namespace, svc.Name, "Active", svc.ObjectMeta)
		graph.AddNode(node)
		// Store spec.selector for relationship inference (Service->Pod matching).
		if len(svc.Spec.Selector) > 0 {
			selector := make(map[string]interface{}, len(svc.Spec.Selector))
			for k, v := range svc.Spec.Selector {
				selector[k] = v
			}
			graph.SetNodeExtra(node.ID, map[string]interface{}{"selector": selector})
		}
	}
	return nil
}

func (e *Engine) discoverDeployments(ctx context.Context, graph *Graph, namespace string) error {
	deployments, err := e.client.Clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list deployments: %w", err)
	}
	for _, deploy := range deployments.Items {
		// Determine status from replica state instead of hardcoding "Active".
		desired := int32(1)
		if deploy.Spec.Replicas != nil {
			desired = *deploy.Spec.Replicas
		}
		ready := deploy.Status.ReadyReplicas
		available := deploy.Status.AvailableReplicas

		status := "Active"
		health := "healthy"
		if desired == 0 {
			status = "ScaledDown"
			health = "healthy" // Intentionally scaled to zero
		} else if ready == 0 {
			status = "Unavailable"
			health = "unhealthy"
		} else if ready < desired || available < desired {
			status = "Progressing"
			health = "warning"
		}

		node := buildNode("Deployment", deploy.Namespace, deploy.Name, status, deploy.ObjectMeta)
		node.Computed.Health = health
		node.Computed.Replicas = &struct {
			Desired   int `json:"desired"`
			Ready     int `json:"ready"`
			Available int `json:"available"`
		}{
			Desired:   int(desired),
			Ready:     int(ready),
			Available: int(available),
		}

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
		desired := int32(0)
		if rs.Spec.Replicas != nil {
			desired = *rs.Spec.Replicas
		}
		ready := rs.Status.ReadyReplicas
		available := rs.Status.AvailableReplicas

		status := "Active"
		health := "healthy"
		if desired == 0 {
			status = "ScaledDown"
			health = "healthy" // Old RS after rollout, intentionally scaled to zero
		} else if ready == 0 {
			status = "Unavailable"
			health = "unhealthy"
		} else if ready < desired {
			status = "Progressing"
			health = "warning"
		}

		node := buildNode("ReplicaSet", rs.Namespace, rs.Name, status, rs.ObjectMeta)
		node.Computed.Health = health
		node.Computed.Replicas = &struct {
			Desired   int `json:"desired"`
			Ready     int `json:"ready"`
			Available int `json:"available"`
		}{
			Desired:   int(desired),
			Ready:     int(ready),
			Available: int(available),
		}

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
		desired := int32(1)
		if sts.Spec.Replicas != nil {
			desired = *sts.Spec.Replicas
		}
		ready := sts.Status.ReadyReplicas
		available := sts.Status.AvailableReplicas

		status := "Active"
		health := "healthy"
		if desired == 0 {
			status = "ScaledDown"
			health = "healthy"
		} else if ready == 0 {
			status = "Unavailable"
			health = "unhealthy"
		} else if ready < desired || available < desired {
			status = "Progressing"
			health = "warning"
		}

		node := buildNode("StatefulSet", sts.Namespace, sts.Name, status, sts.ObjectMeta)
		node.Computed.Health = health
		node.Computed.Replicas = &struct {
			Desired   int `json:"desired"`
			Ready     int `json:"ready"`
			Available int `json:"available"`
		}{
			Desired:   int(desired),
			Ready:     int(ready),
			Available: int(available),
		}

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
		desired := ds.Status.DesiredNumberScheduled
		ready := ds.Status.NumberReady
		available := ds.Status.NumberAvailable

		status := "Active"
		health := "healthy"
		if desired == 0 {
			status = "NoNodes"
			health = "healthy"
		} else if ready == 0 {
			status = "Unavailable"
			health = "unhealthy"
		} else if ready < desired || available < desired {
			status = "Progressing"
			health = "warning"
		}

		node := buildNode("DaemonSet", ds.Namespace, ds.Name, status, ds.ObjectMeta)
		node.Computed.Health = health
		node.Computed.Replicas = &struct {
			Desired   int `json:"desired"`
			Ready     int `json:"ready"`
			Available int `json:"available"`
		}{
			Desired:   int(desired),
			Ready:     int(ready),
			Available: int(available),
		}

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
		status := "Active"
		health := "warning" // In-progress jobs are warning level
		for _, cond := range job.Status.Conditions {
			if string(cond.Type) == "Complete" && string(cond.Status) == "True" {
				status = "Complete"
				health = "healthy"
				break
			}
			if string(cond.Type) == "Failed" && string(cond.Status) == "True" {
				status = "Failed"
				health = "unhealthy"
				break
			}
		}
		// No active pods, no success, no failure → likely hasn't started yet
		if status == "Active" && job.Status.Active == 0 && job.Status.Succeeded == 0 && job.Status.Failed == 0 {
			health = "warning"
		}

		node := buildNode("Job", job.Namespace, job.Name, status, job.ObjectMeta)
		node.Computed.Health = health
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
		status := "Active"
		health := "healthy"
		if cj.Spec.Suspend != nil && *cj.Spec.Suspend {
			status = "Suspended"
			health = "warning"
		}

		node := buildNode("CronJob", cj.Namespace, cj.Name, status, cj.ObjectMeta)
		node.Computed.Health = health
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
		health := "healthy"
		for _, cond := range node.Status.Conditions {
			if string(cond.Type) == "Ready" && string(cond.Status) != "True" {
				status = "NotReady"
				health = "unhealthy"
			}
		}
		// Check for pressure conditions that indicate degraded node health.
		if health == "healthy" {
			for _, cond := range node.Status.Conditions {
				if string(cond.Status) == "True" {
					switch string(cond.Type) {
					case "MemoryPressure", "DiskPressure", "PIDPressure", "NetworkUnavailable":
						health = "warning"
					}
				}
			}
		}

		graphNode := buildNode("Node", "", node.Name, status, node.ObjectMeta)
		graphNode.Computed.Health = health
		graph.AddNode(graphNode)
	}
	return nil
}

func (e *Engine) discoverNamespaces(ctx context.Context, graph *Graph, namespace string) error {
	// When a specific namespace is selected, only include that namespace node
	// to avoid showing all other namespaces as empty boxes in the topology.
	if namespace != "" && namespace != metav1.NamespaceAll {
		ns, err := e.client.Clientset.CoreV1().Namespaces().Get(ctx, namespace, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("failed to get namespace %s: %w", namespace, err)
		}
		graph.AddNode(buildNode("Namespace", "", ns.Name, string(ns.Status.Phase), ns.ObjectMeta))
		return nil
	}
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
		// Store spec for inference (rules -> http -> paths -> backend.service.name + defaultBackend)
		extra := map[string]interface{}{}
		var rules []interface{}
		for _, r := range ing.Spec.Rules {
			if r.HTTP != nil {
				var paths []interface{}
				for _, path := range r.HTTP.Paths {
					if path.Backend.Service != nil {
						paths = append(paths, map[string]interface{}{
							"backend": map[string]interface{}{"service": map[string]interface{}{"name": path.Backend.Service.Name}},
						})
					}
				}
				rules = append(rules, map[string]interface{}{"http": map[string]interface{}{"paths": paths}})
			}
		}
		spec := map[string]interface{}{"rules": rules}
		// Store defaultBackend if present
		if ing.Spec.DefaultBackend != nil && ing.Spec.DefaultBackend.Service != nil {
			spec["defaultBackend"] = map[string]interface{}{
				"service": map[string]interface{}{"name": ing.Spec.DefaultBackend.Service.Name},
			}
		}
		extra["spec"] = spec
		graph.SetNodeExtra(node.ID, extra)
	}
	return nil
}

func (e *Engine) discoverNetworkPolicies(ctx context.Context, graph *Graph, namespace string) error {
	nps, err := e.client.Clientset.NetworkingV1().NetworkPolicies(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return fmt.Errorf("failed to list network policies: %w", err)
	}
	for _, np := range nps.Items {
		node := buildNode("NetworkPolicy", np.Namespace, np.Name, "Active", np.ObjectMeta)
		graph.AddNode(node)
		// Store spec.podSelector.matchLabels for relationship inference (NP->Pod matching).
		if len(np.Spec.PodSelector.MatchLabels) > 0 {
			selector := make(map[string]interface{}, len(np.Spec.PodSelector.MatchLabels))
			for k, v := range np.Spec.PodSelector.MatchLabels {
				selector[k] = v
			}
			graph.SetNodeExtra(node.ID, map[string]interface{}{"podSelector": selector})
		}
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
		node := buildNode("PodDisruptionBudget", pdb.Namespace, pdb.Name, "Active", pdb.ObjectMeta)
		graph.AddNode(node)
		// Store spec.selector.matchLabels for relationship inference (PDB->Pod matching).
		if pdb.Spec.Selector != nil && len(pdb.Spec.Selector.MatchLabels) > 0 {
			selector := make(map[string]interface{}, len(pdb.Spec.Selector.MatchLabels))
			for k, v := range pdb.Spec.Selector.MatchLabels {
				selector[k] = v
			}
			graph.SetNodeExtra(node.ID, map[string]interface{}{"podSelector": selector})
		}
	}
	return nil
}

// Well-known CRD groups to discover in topology.
// This covers common operators (cert-manager, Prometheus, Istio, etc.).
// Each entry is group -> resource plural -> kind mapping.
var wellKnownCRDGroups = []struct {
	Group    string
	Version  string
	Resource string
	Kind     string
}{
	{"cert-manager.io", "v1", "certificates", "Certificate"},
	{"cert-manager.io", "v1", "issuers", "Issuer"},
	{"cert-manager.io", "v1", "clusterissuers", "ClusterIssuer"},
	{"monitoring.coreos.com", "v1", "servicemonitors", "ServiceMonitor"},
	{"monitoring.coreos.com", "v1", "prometheusrules", "PrometheusRule"},
	{"networking.istio.io", "v1beta1", "virtualservices", "VirtualService"},
	{"networking.istio.io", "v1beta1", "destinationrules", "DestinationRule"},
	{"networking.istio.io", "v1beta1", "gateways", "Gateway"},
	{"gateway.networking.k8s.io", "v1", "gateways", "Gateway"},
	{"gateway.networking.k8s.io", "v1", "httproutes", "HTTPRoute"},
}

// discoverCustomResources discovers well-known CRD instances using the dynamic client.
// Only attempts CRDs that actually exist in the cluster (404s are silently skipped).
// Also discovers any additional CRDs that have owner references to known resources.
func (e *Engine) discoverCustomResources(ctx context.Context, graph *Graph, namespace string) error {
	if e.client.Dynamic == nil {
		return nil // No dynamic client available
	}

	for _, crd := range wellKnownCRDGroups {
		gvr := schema.GroupVersionResource{
			Group:    crd.Group,
			Version:  crd.Version,
			Resource: crd.Resource,
		}
		var list *unstructured.UnstructuredList
		var err error
		if namespace != "" && namespace != metav1.NamespaceAll {
			list, err = e.client.Dynamic.Resource(gvr).Namespace(namespace).List(ctx, metav1.ListOptions{})
		} else {
			list, err = e.client.Dynamic.Resource(gvr).List(ctx, metav1.ListOptions{})
		}
		if err != nil {
			// 404 = CRD not installed in this cluster; skip silently
			if strings.Contains(err.Error(), "the server could not find the requested resource") ||
				strings.Contains(err.Error(), "not found") {
				continue
			}
			log.Printf("topology: CRD discovery error for %s/%s (skipping): %v", crd.Group, crd.Resource, err)
			continue
		}

		for _, item := range list.Items {
			ns := item.GetNamespace()
			name := item.GetName()
			uid := string(item.GetUID())
			labels := item.GetLabels()
			annotations := item.GetAnnotations()
			if labels == nil {
				labels = make(map[string]string)
			}
			if annotations == nil {
				annotations = make(map[string]string)
			}
			createdAt := ""
			ts := item.GetCreationTimestamp()
			if !ts.IsZero() {
				createdAt = ts.UTC().Format("2006-01-02T15:04:05Z")
			}

			id := crd.Kind + "/" + name
			if ns != "" {
				id = crd.Kind + "/" + ns + "/" + name
			}

			node := models.TopologyNode{
				ID:        id,
				Kind:      crd.Kind,
				Namespace: ns,
				Name:      name,
				Status:    "Active",
				Metadata:  models.NodeMetadata{Labels: labels, Annotations: annotations, UID: uid, CreatedAt: createdAt},
				Computed:  models.NodeComputed{Health: "healthy"},
			}
			graph.AddNode(node)

			// Store owner references for relationship inference
			ownerRefs := item.GetOwnerReferences()
			if len(ownerRefs) > 0 {
				graph.SetOwnerRefs(node.ID, convertOwnerRefs(ownerRefs))
			}
		}
	}
	return nil
}
