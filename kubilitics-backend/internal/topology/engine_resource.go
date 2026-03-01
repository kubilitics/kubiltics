package topology

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
)

// ErrResourceNotFound is returned when the requested resource does not exist.
var ErrResourceNotFound = errors.New("resource not found")

const resourceSubgraphMaxNodes = 500

// ResourceTopologyKinds lists canonical kinds that support resource-scoped topology
// (BuildResourceSubgraph). API accepts plural lowercase (e.g. "statefulsets").
var ResourceTopologyKinds = []string{"Node", "Pod", "Deployment", "ReplicaSet", "StatefulSet", "DaemonSet", "Job", "CronJob", "Service", "Ingress", "IngressClass", "Endpoints", "EndpointSlice", "NetworkPolicy", "ConfigMap", "Secret", "PersistentVolumeClaim", "PersistentVolume", "StorageClass", "VolumeAttachment", "ResourceQuota", "LimitRange", "PriorityClass", "ResourceSlice", "DeviceClass", "Namespace", "ServiceAccount", "HorizontalPodAutoscaler", "ReplicationController", "Role", "ClusterRole", "RoleBinding", "ClusterRoleBinding", "PodDisruptionBudget", "RuntimeClass", "Lease", "CSIDriver", "CSINode", "MutatingWebhookConfiguration", "ValidatingWebhookConfiguration", "FlowSchema", "PriorityLevelConfiguration"}

// buildResourceEdge adds an edge with the given label (used for resource-scoped topology).
func buildResourceEdge(source, target, label string) models.TopologyEdge {
	id := source + "->" + target + ":" + label
	return models.TopologyEdge{
		ID:               id,
		Source:           source,
		Target:           target,
		RelationshipType: label,
		Label:            label,
		Metadata:         models.EdgeMetadata{Derivation: "resourceTopology", Confidence: 1, SourceField: ""},
	}
}

// addResourceEdge adds an edge to the graph if both nodes exist.
func addResourceEdge(g *Graph, source, target, label string) {
	if g.GetNode(source) == nil || g.GetNode(target) == nil {
		return
	}
	g.AddEdge(buildResourceEdge(source, target, label))
}

// ensureNode adds a node to the graph if not at capacity and not duplicate.
func ensureNode(g *Graph, kind, namespace, name, status string, meta metav1.ObjectMeta) string {
	node := buildNode(kind, namespace, name, status, meta)
	g.AddNode(node)
	return node.ID
}

// NormalizeResourceKind maps API kind (e.g. "jobs", "pods", "nodes") to canonical Kind (e.g. "Job", "Pod", "Node").
// Exported so the REST handler can pass a canonical kind to the topology service.
func NormalizeResourceKind(kind string) string {
	return normalizeResourceKind(strings.TrimSpace(kind))
}

func normalizeResourceKind(kind string) string {
	switch kind {
	case "pods", "pod":
		return "Pod"
	case "deployments", "deployment", "Deployments":
		return "Deployment"
	case "replicasets", "replicaset", "ReplicaSets":
		return "ReplicaSet"
	case "statefulsets", "statefulset", "StatefulSets":
		return "StatefulSet"
	case "daemonsets", "daemonset", "DaemonSets":
		return "DaemonSet"
	case "jobs", "job", "Jobs":
		return "Job"
	case "cronjobs", "cronjob", "CronJobs":
		return "CronJob"
	case "services", "service":
		return "Service"
	case "nodes", "node":
		return "Node"
	case "configmaps", "configmap":
		return "ConfigMap"
	case "secrets", "secret":
		return "Secret"
	case "persistentvolumeclaims", "persistentvolumeclaim", "pvc":
		return "PersistentVolumeClaim"
	case "persistentvolumes", "persistentvolume", "pv":
		return "PersistentVolume"
	case "storageclasses", "storageclass":
		return "StorageClass"
	case "serviceaccounts", "serviceaccount":
		return "ServiceAccount"
	case "ingresses", "ingress":
		return "Ingress"
	case "ingressclasses", "ingressclass":
		return "IngressClass"
	case "endpoints", "endpoint":
		return "Endpoints"
	case "endpointslices", "endpointslice":
		return "EndpointSlice"
	case "networkpolicies", "networkpolicy":
		return "NetworkPolicy"
	case "volumeattachments", "volumeattachment":
		return "VolumeAttachment"
	case "resourcequotas", "resourcequota":
		return "ResourceQuota"
	case "limitranges", "limitrange":
		return "LimitRange"
	case "priorityclasses", "priorityclass":
		return "PriorityClass"
	case "resourceslices", "resourceslice":
		return "ResourceSlice"
	case "deviceclasses", "deviceclass":
		return "DeviceClass"
	case "namespaces", "namespace":
		return "Namespace"
	case "horizontalpodautoscalers", "horizontalpodautoscaler", "hpa":
		return "HorizontalPodAutoscaler"
	case "replicationcontrollers", "replicationcontroller", "rc":
		return "ReplicationController"
	case "roles", "role":
		return "Role"
	case "clusterroles", "clusterrole":
		return "ClusterRole"
	case "rolebindings", "rolebinding":
		return "RoleBinding"
	case "clusterrolebindings", "clusterrolebinding":
		return "ClusterRoleBinding"
	case "poddisruptionbudgets", "poddisruptionbudget", "pdb":
		return "PodDisruptionBudget"
	case "runtimeclasses", "runtimeclass":
		return "RuntimeClass"
	case "leases", "lease":
		return "Lease"
	case "csidrivers", "csidriver":
		return "CSIDriver"
	case "csinodes", "csinode":
		return "CSINode"
	case "mutatingwebhookconfigurations", "mutatingwebhookconfiguration", "mwc":
		return "MutatingWebhookConfiguration"
	case "validatingwebhookconfigurations", "validatingwebhookconfiguration", "vwc":
		return "ValidatingWebhookConfiguration"
	case "flowschemas", "flowschema":
		return "FlowSchema"
	case "prioritylevelconfigurations", "prioritylevelconfiguration", "plc":
		return "PriorityLevelConfiguration"
	default:
		return kind
	}
}

// BuildResourceSubgraph builds a topology subgraph for a single resource (e.g. Pod, Deployment).
// Returns error with message "resource not found" when the seed resource does not exist.
// Cap: resourceSubgraphMaxNodes nodes.
func (e *Engine) BuildResourceSubgraph(ctx context.Context, kind, namespace, name string) (*Graph, error) {
	canonicalKind := normalizeResourceKind(strings.TrimSpace(kind))
	switch canonicalKind {
	case "Pod":
		return e.buildPodSubgraph(ctx, namespace, name)
	case "Deployment":
		return e.buildDeploymentSubgraph(ctx, namespace, name)
	case "ReplicaSet":
		return e.buildReplicaSetSubgraph(ctx, namespace, name)
	case "StatefulSet":
		return e.buildStatefulSetSubgraph(ctx, namespace, name)
	case "DaemonSet":
		return e.buildDaemonSetSubgraph(ctx, namespace, name)
	case "Job":
		return e.buildJobSubgraph(ctx, namespace, name)
	case "CronJob":
		return e.buildCronJobSubgraph(ctx, namespace, name)
	case "Service":
		return e.buildServiceSubgraph(ctx, namespace, name)
	case "Ingress":
		return e.buildIngressSubgraph(ctx, namespace, name)
	case "IngressClass":
		return e.buildIngressClassSubgraph(ctx, namespace, name)
	case "Endpoints":
		return e.buildEndpointsSubgraph(ctx, namespace, name)
	case "EndpointSlice":
		return e.buildEndpointSliceSubgraph(ctx, namespace, name)
	case "NetworkPolicy":
		return e.buildNetworkPolicySubgraph(ctx, namespace, name)
	case "ConfigMap":
		return e.buildConfigMapSubgraph(ctx, namespace, name)
	case "Secret":
		return e.buildSecretSubgraph(ctx, namespace, name)
	case "PersistentVolumeClaim":
		return e.buildPersistentVolumeClaimSubgraph(ctx, namespace, name)
	case "PersistentVolume":
		return e.buildPersistentVolumeSubgraph(ctx, namespace, name)
	case "StorageClass":
		return e.buildStorageClassSubgraph(ctx, namespace, name)
	case "VolumeAttachment":
		return e.buildVolumeAttachmentSubgraph(ctx, namespace, name)
	case "Node":
		return e.buildNodeSubgraph(ctx, name)
	case "ResourceQuota":
		return e.buildResourceQuotaSubgraph(ctx, namespace, name)
	case "LimitRange":
		return e.buildLimitRangeSubgraph(ctx, namespace, name)
	case "PriorityClass":
		return e.buildPriorityClassSubgraph(ctx, name)
	case "ResourceSlice":
		return e.buildResourceSliceSubgraph(ctx, name)
	case "DeviceClass":
		return e.buildDeviceClassSubgraph(ctx, name)
	case "Namespace":
		return e.buildNamespaceSubgraph(ctx, name)
	case "ServiceAccount":
		return e.buildServiceAccountSubgraph(ctx, namespace, name)
	case "HorizontalPodAutoscaler":
		return e.buildHorizontalPodAutoscalerSubgraph(ctx, namespace, name)
	case "ReplicationController":
		return e.buildReplicationControllerSubgraph(ctx, namespace, name)
	case "Role":
		return e.buildRoleSubgraph(ctx, namespace, name)
	case "ClusterRole":
		return e.buildClusterRoleSubgraph(ctx, name)
	case "RoleBinding":
		return e.buildRoleBindingSubgraph(ctx, namespace, name)
	case "ClusterRoleBinding":
		return e.buildClusterRoleBindingSubgraph(ctx, name)
	case "PodDisruptionBudget":
		return e.buildPodDisruptionBudgetSubgraph(ctx, namespace, name)
	case "RuntimeClass":
		return e.buildRuntimeClassSubgraph(ctx, name)
	case "Lease":
		return e.buildLeaseSubgraph(ctx, namespace, name)
	case "CSIDriver":
		return e.buildCSIDriverSubgraph(ctx, name)
	case "CSINode":
		return e.buildCSINodeSubgraph(ctx, name)
	case "MutatingWebhookConfiguration":
		return e.buildMutatingWebhookConfigurationSubgraph(ctx, name)
	case "ValidatingWebhookConfiguration":
		return e.buildValidatingWebhookConfigurationSubgraph(ctx, name)
	case "FlowSchema":
		return e.buildFlowSchemaSubgraph(ctx, name)
	case "PriorityLevelConfiguration":
		return e.buildPriorityLevelConfigurationSubgraph(ctx, name)
	default:
		return nil, fmt.Errorf("resource topology not implemented for kind %q (supported kinds: %s)", canonicalKind, strings.Join(ResourceTopologyKinds, ", "))
	}
}

// buildDeploymentSubgraph builds Deployment -> ReplicaSets -> Pods, plus Services that select those pods and HPA if any.
func (e *Engine) buildDeploymentSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for Deployment resource topology")
	}
	dep, err := e.client.Clientset.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}

	g := NewGraph(resourceSubgraphMaxNodes)
	ns := dep.Namespace
	depID := ensureNode(g, "Deployment", ns, dep.Name, deploymentStatus(dep), dep.ObjectMeta)

	// ReplicaSets owned by this Deployment
	rsList, err := e.client.Clientset.AppsV1().ReplicaSets(ns).List(ctx, metav1.ListOptions{})
	if err != nil {
		g.LayoutSeed = g.GenerateLayoutSeed()
		if err := g.Validate(); err != nil {
			return nil, fmt.Errorf("graph validation failed: %w", err)
		}
		return g, nil
	}

	selector, err := metav1.LabelSelectorAsSelector(dep.Spec.Selector)
	if err != nil {
		selector = labels.Nothing()
	}

	var podIDs []string
	for i := range rsList.Items {
		rs := &rsList.Items[i]
		var ownedByThisDep bool
		for _, ref := range rs.OwnerReferences {
			if ref.Kind == "Deployment" && ref.Name == dep.Name {
				ownedByThisDep = true
				break
			}
		}
		if !ownedByThisDep {
			continue
		}
		rsID := ensureNode(g, "ReplicaSet", rs.Namespace, rs.Name, "Active", rs.ObjectMeta)
		addResourceEdge(g, depID, rsID, "Manages")

		// Pods owned by this ReplicaSet
		rsSelector, _ := metav1.LabelSelectorAsSelector(rs.Spec.Selector)
		podList, err := e.client.Clientset.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{
			LabelSelector: rsSelector.String(),
		})
		if err != nil {
			continue
		}
		for j := range podList.Items {
			pod := &podList.Items[j]
			podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
			addResourceEdge(g, rsID, podID, "Manages")
			podIDs = append(podIDs, podID)
		}
	}

	// If no ReplicaSets/pods found, try pods matching deployment selector directly
	if len(podIDs) == 0 && selector != nil && !selector.Empty() {
		podList, err := e.client.Clientset.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{LabelSelector: selector.String()})
		if err == nil {
			for i := range podList.Items {
				pod := &podList.Items[i]
				podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
				addResourceEdge(g, depID, podID, "Manages")
				podIDs = append(podIDs, podID)
			}
		}
	}

	// Services that select the deployment's pods (same selector as deployment)
	var deploymentServiceNames []string
	if selector != nil && !selector.Empty() {
		svcList, err := e.client.Clientset.CoreV1().Services(ns).List(ctx, metav1.ListOptions{})
		if err == nil && dep.Spec.Selector != nil && len(dep.Spec.Selector.MatchLabels) > 0 {
			depLabels := labels.Set(dep.Spec.Selector.MatchLabels)
			for i := range svcList.Items {
				svc := &svcList.Items[i]
				if len(svc.Spec.Selector) == 0 {
					continue
				}
				if labels.SelectorFromSet(svc.Spec.Selector).Matches(depLabels) {
					svcID := ensureNode(g, "Service", svc.Namespace, svc.Name, "Active", svc.ObjectMeta)
					addResourceEdge(g, svcID, depID, "Selects")
					deploymentServiceNames = append(deploymentServiceNames, svc.Name)
				}
			}
		}
	}

	// Ingresses that route to any of the deployment's services
	if len(deploymentServiceNames) > 0 {
		svcSet := make(map[string]bool)
		for _, n := range deploymentServiceNames {
			svcSet[n] = true
		}
		ingList, err := e.client.Clientset.NetworkingV1().Ingresses(ns).List(ctx, metav1.ListOptions{})
		if err == nil {
			for i := range ingList.Items {
				ing := &ingList.Items[i]
				refsService := false
				var refSvcName string
				for _, rule := range ing.Spec.Rules {
					if rule.HTTP == nil {
						continue
					}
					for _, path := range rule.HTTP.Paths {
						if path.Backend.Service != nil && svcSet[path.Backend.Service.Name] {
							refsService = true
							refSvcName = path.Backend.Service.Name
							break
						}
					}
					if refsService {
						break
					}
				}
				if !refsService && ing.Spec.DefaultBackend != nil && ing.Spec.DefaultBackend.Service != nil && svcSet[ing.Spec.DefaultBackend.Service.Name] {
					refsService = true
					refSvcName = ing.Spec.DefaultBackend.Service.Name
				}
				if refsService && refSvcName != "" {
					ingID := ensureNode(g, "Ingress", ing.Namespace, ing.Name, "Active", ing.ObjectMeta)
					svcID := "Service/" + ns + "/" + refSvcName
					addResourceEdge(g, ingID, svcID, "Exposes")
				}
			}
		}
	}

	// HPA that scales this deployment
	hpaList, err := e.client.Clientset.AutoscalingV2().HorizontalPodAutoscalers(ns).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range hpaList.Items {
			hpa := &hpaList.Items[i]
			if hpa.Spec.ScaleTargetRef.Kind == "Deployment" && hpa.Spec.ScaleTargetRef.Name == dep.Name {
				hpaID := ensureNode(g, "HorizontalPodAutoscaler", hpa.Namespace, hpa.Name, "Active", hpa.ObjectMeta)
				addResourceEdge(g, hpaID, depID, "Scales")
				break
			}
		}
	}

	// Pod template references: ConfigMaps, Secrets, ServiceAccount, PriorityClass, PVCs
	e.addPodTemplateRefsToGraph(ctx, g, ns, depID, &dep.Spec.Template.Spec)

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildReplicaSetSubgraph builds ReplicaSet -> Pods and optional parent Deployment.
func (e *Engine) buildReplicaSetSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for ReplicaSet resource topology")
	}
	rs, err := e.client.Clientset.AppsV1().ReplicaSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}

	g := NewGraph(resourceSubgraphMaxNodes)
	ns := rs.Namespace
	rsID := ensureNode(g, "ReplicaSet", ns, rs.Name, "Active", rs.ObjectMeta)

	// Parent Deployment if any
	for _, ref := range rs.OwnerReferences {
		if ref.Kind == "Deployment" {
			dep, err := e.client.Clientset.AppsV1().Deployments(ns).Get(ctx, ref.Name, metav1.GetOptions{})
			if err == nil {
				depID := ensureNode(g, "Deployment", dep.Namespace, dep.Name, deploymentStatus(dep), dep.ObjectMeta)
				addResourceEdge(g, depID, rsID, "Manages")
			}
			break
		}
	}

	// Pods owned by or matching this ReplicaSet
	selector, err := metav1.LabelSelectorAsSelector(rs.Spec.Selector)
	if err == nil && !selector.Empty() {
		podList, err := e.client.Clientset.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{LabelSelector: selector.String()})
		if err == nil {
			for i := range podList.Items {
				pod := &podList.Items[i]
				podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
				addResourceEdge(g, rsID, podID, "Manages")
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildStatefulSetSubgraph builds StatefulSet -> Pods and Services that select those pods.
func (e *Engine) buildStatefulSetSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for StatefulSet resource topology")
	}
	sts, err := e.client.Clientset.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}

	g := NewGraph(resourceSubgraphMaxNodes)
	ns := sts.Namespace
	stsID := ensureNode(g, "StatefulSet", ns, sts.Name, statefulSetStatus(sts), sts.ObjectMeta)

	selector, err := metav1.LabelSelectorAsSelector(sts.Spec.Selector)
	if err != nil {
		selector = labels.Nothing()
	}

	var podIDs []string
	if selector != nil && !selector.Empty() {
		podList, err := e.client.Clientset.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{LabelSelector: selector.String()})
		if err == nil {
			for i := range podList.Items {
				pod := &podList.Items[i]
				// Only include pods owned by this StatefulSet
				for _, ref := range pod.OwnerReferences {
					if ref.Kind == "StatefulSet" && ref.Name == sts.Name {
						podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
						addResourceEdge(g, stsID, podID, "Manages")
						podIDs = append(podIDs, podID)
						break
					}
				}
			}
		}
	}

	// Services that select the StatefulSet's pods
	if selector != nil && !selector.Empty() && sts.Spec.Selector != nil && len(sts.Spec.Selector.MatchLabels) > 0 {
		stsLabels := labels.Set(sts.Spec.Selector.MatchLabels)
		svcList, err := e.client.Clientset.CoreV1().Services(ns).List(ctx, metav1.ListOptions{})
		if err == nil {
			for i := range svcList.Items {
				svc := &svcList.Items[i]
				if len(svc.Spec.Selector) == 0 {
					continue
				}
				if labels.SelectorFromSet(svc.Spec.Selector).Matches(stsLabels) {
					svcID := ensureNode(g, "Service", svc.Namespace, svc.Name, "Active", svc.ObjectMeta)
					addResourceEdge(g, svcID, stsID, "Selects")
				}
			}
		}
	}

	// HPA that scales this StatefulSet
	hpaList, err := e.client.Clientset.AutoscalingV2().HorizontalPodAutoscalers(ns).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range hpaList.Items {
			hpa := &hpaList.Items[i]
			if hpa.Spec.ScaleTargetRef.Kind == "StatefulSet" && hpa.Spec.ScaleTargetRef.Name == sts.Name {
				hpaID := ensureNode(g, "HorizontalPodAutoscaler", hpa.Namespace, hpa.Name, "Active", hpa.ObjectMeta)
				addResourceEdge(g, hpaID, stsID, "Scales")
				break
			}
		}
	}

	// Pod template references: ConfigMaps, Secrets, ServiceAccount, PriorityClass, PVCs
	e.addPodTemplateRefsToGraph(ctx, g, ns, stsID, &sts.Spec.Template.Spec)

	// volumeClaimTemplates → existing PVCs (pattern: {template}-{sts}-{index}) (W-18)
	if len(sts.Spec.VolumeClaimTemplates) > 0 {
		pvcList, err := e.client.Clientset.CoreV1().PersistentVolumeClaims(ns).List(ctx, metav1.ListOptions{})
		if err == nil {
			for i := range pvcList.Items {
				if g.Truncated {
					break
				}
				pvc := &pvcList.Items[i]
				for _, tmpl := range sts.Spec.VolumeClaimTemplates {
					prefix := tmpl.Name + "-" + sts.Name + "-"
					if strings.HasPrefix(pvc.Name, prefix) {
						pvcID := ensureNode(g, "PersistentVolumeClaim", pvc.Namespace, pvc.Name, string(pvc.Status.Phase), pvc.ObjectMeta)
						addResourceEdge(g, stsID, pvcID, "Claims")
						break
					}
				}
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildDaemonSetSubgraph builds DaemonSet -> Pods and Services that select those pods.
func (e *Engine) buildDaemonSetSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for DaemonSet resource topology")
	}
	ds, err := e.client.Clientset.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}

	g := NewGraph(resourceSubgraphMaxNodes)
	ns := ds.Namespace
	dsID := ensureNode(g, "DaemonSet", ns, ds.Name, daemonSetStatus(ds), ds.ObjectMeta)

	// Pods owned by this DaemonSet
	podList, err := e.client.Clientset.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range podList.Items {
			pod := &podList.Items[i]
			for _, ref := range pod.OwnerReferences {
				if ref.Kind == "DaemonSet" && ref.Name == ds.Name {
					podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
					addResourceEdge(g, dsID, podID, "Manages")
					break
				}
			}
		}
	}

	// Services that select the DaemonSet's pods (match selector)
	if ds.Spec.Selector != nil && len(ds.Spec.Selector.MatchLabels) > 0 {
		dsLabels := labels.Set(ds.Spec.Selector.MatchLabels)
		svcList, err := e.client.Clientset.CoreV1().Services(ns).List(ctx, metav1.ListOptions{})
		if err == nil {
			for i := range svcList.Items {
				svc := &svcList.Items[i]
				if len(svc.Spec.Selector) == 0 {
					continue
				}
				if labels.SelectorFromSet(svc.Spec.Selector).Matches(dsLabels) {
					svcID := ensureNode(g, "Service", svc.Namespace, svc.Name, "Active", svc.ObjectMeta)
					addResourceEdge(g, svcID, dsID, "Selects")
				}
			}
		}
	}

	// Pod template references: ConfigMaps, Secrets, ServiceAccount, PriorityClass, PVCs
	e.addPodTemplateRefsToGraph(ctx, g, ns, dsID, &ds.Spec.Template.Spec)

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildJobSubgraph builds Job -> Pods.
func (e *Engine) buildJobSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for Job resource topology")
	}
	job, err := e.client.Clientset.BatchV1().Jobs(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}

	g := NewGraph(resourceSubgraphMaxNodes)
	ns := job.Namespace
	jobID := ensureNode(g, "Job", ns, job.Name, jobStatus(job), job.ObjectMeta)

	// Pods owned by this Job
	podList, err := e.client.Clientset.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range podList.Items {
			pod := &podList.Items[i]
			for _, ref := range pod.OwnerReferences {
				if ref.Kind == "Job" && ref.Name == job.Name {
					podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
					addResourceEdge(g, jobID, podID, "Manages")
					break
				}
			}
		}
	}

	// Optional: CronJob owner
	for _, ref := range job.OwnerReferences {
		if ref.Kind == "CronJob" {
			cj, err := e.client.Clientset.BatchV1().CronJobs(ns).Get(ctx, ref.Name, metav1.GetOptions{})
			if err == nil {
				cjID := ensureNode(g, "CronJob", cj.Namespace, cj.Name, cronJobStatus(cj), cj.ObjectMeta)
				addResourceEdge(g, cjID, jobID, "Creates")
			}
			break
		}
	}

	// Pod template references: ConfigMaps, Secrets, ServiceAccount, PriorityClass, PVCs
	e.addPodTemplateRefsToGraph(ctx, g, ns, jobID, &job.Spec.Template.Spec)

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildCronJobSubgraph builds CronJob -> Jobs -> Pods.
func (e *Engine) buildCronJobSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for CronJob resource topology")
	}
	cj, err := e.client.Clientset.BatchV1().CronJobs(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}

	g := NewGraph(resourceSubgraphMaxNodes)
	ns := cj.Namespace
	cjID := ensureNode(g, "CronJob", ns, cj.Name, cronJobStatus(cj), cj.ObjectMeta)

	// Jobs owned by this CronJob
	jobList, err := e.client.Clientset.BatchV1().Jobs(ns).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range jobList.Items {
			job := &jobList.Items[i]
			for _, ref := range job.OwnerReferences {
				if ref.Kind == "CronJob" && ref.Name == cj.Name {
					jobID := ensureNode(g, "Job", job.Namespace, job.Name, jobStatus(job), job.ObjectMeta)
					addResourceEdge(g, cjID, jobID, "Creates")

					// Pods owned by this Job
					podList, err := e.client.Clientset.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{})
					if err == nil {
						for j := range podList.Items {
							pod := &podList.Items[j]
							for _, pref := range pod.OwnerReferences {
								if pref.Kind == "Job" && pref.Name == job.Name {
									podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
									addResourceEdge(g, jobID, podID, "Manages")
									break
								}
							}
						}
					}
					break
				}
			}
		}
	}

	// Job template references: ConfigMaps, Secrets, ServiceAccount, PriorityClass, PVCs
	e.addPodTemplateRefsToGraph(ctx, g, ns, cjID, &cj.Spec.JobTemplate.Spec.Template.Spec)

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

func statefulSetStatus(sts *appsv1.StatefulSet) string {
	if sts.Status.ReadyReplicas >= sts.Status.Replicas && sts.Status.Replicas > 0 {
		return "Active"
	}
	if sts.Status.Replicas == 0 {
		return "ScaledToZero"
	}
	return "Progressing"
}

func daemonSetStatus(ds *appsv1.DaemonSet) string {
	if ds.Status.NumberReady >= ds.Status.DesiredNumberScheduled && ds.Status.DesiredNumberScheduled > 0 {
		return "Active"
	}
	if ds.Status.DesiredNumberScheduled == 0 {
		return "ScaledToZero"
	}
	return "Progressing"
}

func jobStatus(job *batchv1.Job) string {
	if job.Status.Succeeded > 0 {
		return "Complete"
	}
	if job.Status.Failed > 0 && job.Status.Active == 0 {
		return "Failed"
	}
	return "Active"
}

func cronJobStatus(cj *batchv1.CronJob) string {
	if cj.Spec.Suspend != nil && *cj.Spec.Suspend {
		return "Suspended"
	}
	return "Active"
}

func deploymentStatus(dep *appsv1.Deployment) string {
	if dep.Status.ReadyReplicas >= dep.Status.Replicas && dep.Status.Replicas > 0 {
		return "Active"
	}
	if dep.Status.Replicas == 0 {
		return "ScaledToZero"
	}
	return "Progressing"
}

// buildServiceSubgraph builds Service -> Endpoints, EndpointSlices, Pods (selector); Ingresses that reference this service.
func (e *Engine) buildServiceSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for Service resource topology")
	}
	svc, err := e.client.Clientset.CoreV1().Services(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}

	g := NewGraph(resourceSubgraphMaxNodes)
	ns := svc.Namespace
	svcID := ensureNode(g, "Service", ns, svc.Name, "Active", svc.ObjectMeta)

	// Endpoints (same name as service)
	ep, err := e.client.Clientset.CoreV1().Endpoints(ns).Get(ctx, name, metav1.GetOptions{})
	if err == nil {
		epID := ensureNode(g, "Endpoints", ep.Namespace, ep.Name, "Active", ep.ObjectMeta)
		addResourceEdge(g, svcID, epID, "Creates")
		// Pods from subset addresses targetRef
		for i := range ep.Subsets {
			sub := &ep.Subsets[i]
			for j := range sub.Addresses {
				addr := &sub.Addresses[j]
				if addr.TargetRef != nil && addr.TargetRef.Kind == "Pod" && addr.TargetRef.Namespace == ns {
					pod, err := e.client.Clientset.CoreV1().Pods(ns).Get(ctx, addr.TargetRef.Name, metav1.GetOptions{})
					if err == nil {
						podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
						addResourceEdge(g, epID, podID, "Targets")
					}
				}
			}
		}
	}

	// EndpointSlices for this service
	epsList, err := e.client.Clientset.DiscoveryV1().EndpointSlices(ns).List(ctx, metav1.ListOptions{
		LabelSelector: "kubernetes.io/service-name=" + name,
	})
	if err == nil {
		for i := range epsList.Items {
			slice := &epsList.Items[i]
			sliceID := ensureNode(g, "EndpointSlice", slice.Namespace, slice.Name, "Active", slice.ObjectMeta)
			addResourceEdge(g, svcID, sliceID, "Backed by")
			for j := range slice.Endpoints {
				epa := &slice.Endpoints[j]
				if epa.TargetRef != nil && epa.TargetRef.Kind == "Pod" && epa.TargetRef.Namespace == ns {
					pod, err := e.client.Clientset.CoreV1().Pods(ns).Get(ctx, epa.TargetRef.Name, metav1.GetOptions{})
					if err == nil && g.GetNode("Pod/"+ns+"/"+pod.Name) == nil {
						podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
						addResourceEdge(g, sliceID, podID, "Targets")
					}
				}
			}
		}
	}

	// Pods matching service selector
	if len(svc.Spec.Selector) > 0 {
		sel := labels.SelectorFromSet(svc.Spec.Selector)
		podList, err := e.client.Clientset.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{LabelSelector: sel.String()})
		if err == nil {
			for i := range podList.Items {
				pod := &podList.Items[i]
				podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
				addResourceEdge(g, svcID, podID, "Selects")
			}
		}
	}

	// Ingresses that reference this service
	ingList, err := e.client.Clientset.NetworkingV1().Ingresses(ns).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range ingList.Items {
			ing := &ingList.Items[i]
			refsService := false
			for _, rule := range ing.Spec.Rules {
				if rule.HTTP == nil {
					continue
				}
				for _, path := range rule.HTTP.Paths {
					if path.Backend.Service != nil && path.Backend.Service.Name == name {
						refsService = true
						break
					}
				}
				if refsService {
					break
				}
			}
			if !refsService && ing.Spec.DefaultBackend != nil && ing.Spec.DefaultBackend.Service != nil && ing.Spec.DefaultBackend.Service.Name == name {
				refsService = true
			}
			if refsService {
				ingID := ensureNode(g, "Ingress", ing.Namespace, ing.Name, "Active", ing.ObjectMeta)
				addResourceEdge(g, ingID, svcID, "Exposes")
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildIngressSubgraph builds Ingress -> Services (from rules/defaultBackend), IngressClass, TLS Secrets.
func (e *Engine) buildIngressSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for Ingress resource topology")
	}
	ing, err := e.client.Clientset.NetworkingV1().Ingresses(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}

	g := NewGraph(resourceSubgraphMaxNodes)
	ns := ing.Namespace
	ingID := ensureNode(g, "Ingress", ns, ing.Name, "Active", ing.ObjectMeta)

	svcNames := make(map[string]bool)
	for _, rule := range ing.Spec.Rules {
		if rule.HTTP == nil {
			continue
		}
		for _, path := range rule.HTTP.Paths {
			if path.Backend.Service != nil {
				svcNames[path.Backend.Service.Name] = true
			}
		}
	}
	if ing.Spec.DefaultBackend != nil && ing.Spec.DefaultBackend.Service != nil {
		svcNames[ing.Spec.DefaultBackend.Service.Name] = true
	}
	for svcName := range svcNames {
		svc, err := e.client.Clientset.CoreV1().Services(ns).Get(ctx, svcName, metav1.GetOptions{})
		if err == nil {
			svcID := ensureNode(g, "Service", svc.Namespace, svc.Name, "Active", svc.ObjectMeta)
			addResourceEdge(g, ingID, svcID, "Exposes")
		}
	}

	if ing.Spec.IngressClassName != nil && *ing.Spec.IngressClassName != "" {
		ic, err := e.client.Clientset.NetworkingV1().IngressClasses().Get(ctx, *ing.Spec.IngressClassName, metav1.GetOptions{})
		if err == nil {
			icID := ensureNode(g, "IngressClass", "", ic.Name, "Active", ic.ObjectMeta)
			addResourceEdge(g, ingID, icID, "Uses")
		}
	}

	for _, tls := range ing.Spec.TLS {
		if tls.SecretName != "" {
			sec, err := e.client.Clientset.CoreV1().Secrets(ns).Get(ctx, tls.SecretName, metav1.GetOptions{})
			if err == nil {
				secID := ensureNode(g, "Secret", sec.Namespace, sec.Name, "Active", sec.ObjectMeta)
				addResourceEdge(g, ingID, secID, "TLS")
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildIngressClassSubgraph builds IngressClass -> Ingresses using this class (cluster-scoped; namespace is ignored).
func (e *Engine) buildIngressClassSubgraph(ctx context.Context, _, name string) (*Graph, error) {
	ic, err := e.client.Clientset.NetworkingV1().IngressClasses().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}

	g := NewGraph(resourceSubgraphMaxNodes)
	icID := ensureNode(g, "IngressClass", "", ic.Name, "Active", ic.ObjectMeta)

	ingList, err := e.client.Clientset.NetworkingV1().Ingresses(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range ingList.Items {
			ing := &ingList.Items[i]
			if ing.Spec.IngressClassName != nil && *ing.Spec.IngressClassName == name {
				ingID := ensureNode(g, "Ingress", ing.Namespace, ing.Name, "Active", ing.ObjectMeta)
				addResourceEdge(g, icID, ingID, "Used by")
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildEndpointsSubgraph builds Endpoints -> Service (same name), Pods from subset addresses.
func (e *Engine) buildEndpointsSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for Endpoints resource topology")
	}
	ep, err := e.client.Clientset.CoreV1().Endpoints(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}

	g := NewGraph(resourceSubgraphMaxNodes)
	ns := ep.Namespace
	epID := ensureNode(g, "Endpoints", ns, ep.Name, "Active", ep.ObjectMeta)

	svc, err := e.client.Clientset.CoreV1().Services(ns).Get(ctx, name, metav1.GetOptions{})
	if err == nil {
		svcID := ensureNode(g, "Service", svc.Namespace, svc.Name, "Active", svc.ObjectMeta)
		addResourceEdge(g, svcID, epID, "Creates")
	}

	for i := range ep.Subsets {
		sub := &ep.Subsets[i]
		for j := range sub.Addresses {
			addr := &sub.Addresses[j]
			if addr.TargetRef != nil && addr.TargetRef.Kind == "Pod" && addr.TargetRef.Namespace == ns {
				pod, err := e.client.Clientset.CoreV1().Pods(ns).Get(ctx, addr.TargetRef.Name, metav1.GetOptions{})
				if err == nil {
					podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
					addResourceEdge(g, epID, podID, "Targets")
				}
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildEndpointSliceSubgraph builds EndpointSlice -> Service (from label), Pods from endpoint targetRefs.
func (e *Engine) buildEndpointSliceSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for EndpointSlice resource topology")
	}
	slice, err := e.client.Clientset.DiscoveryV1().EndpointSlices(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}

	g := NewGraph(resourceSubgraphMaxNodes)
	ns := slice.Namespace
	sliceID := ensureNode(g, "EndpointSlice", ns, slice.Name, "Active", slice.ObjectMeta)

	svcName := slice.Labels["kubernetes.io/service-name"]
	if svcName != "" {
		svc, err := e.client.Clientset.CoreV1().Services(ns).Get(ctx, svcName, metav1.GetOptions{})
		if err == nil {
			svcID := ensureNode(g, "Service", svc.Namespace, svc.Name, "Active", svc.ObjectMeta)
			addResourceEdge(g, svcID, sliceID, "Backed by")
		}
	}

	for i := range slice.Endpoints {
		epa := &slice.Endpoints[i]
		if epa.TargetRef != nil && epa.TargetRef.Kind == "Pod" && epa.TargetRef.Namespace == ns {
			pod, err := e.client.Clientset.CoreV1().Pods(ns).Get(ctx, epa.TargetRef.Name, metav1.GetOptions{})
			if err == nil {
				podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
				addResourceEdge(g, sliceID, podID, "Targets")
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildNetworkPolicySubgraph builds NetworkPolicy -> Pods matching podSelector.
func (e *Engine) buildNetworkPolicySubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for NetworkPolicy resource topology")
	}
	np, err := e.client.Clientset.NetworkingV1().NetworkPolicies(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}

	g := NewGraph(resourceSubgraphMaxNodes)
	ns := np.Namespace
	npID := ensureNode(g, "NetworkPolicy", ns, np.Name, "Active", np.ObjectMeta)

	selector, err := metav1.LabelSelectorAsSelector(&np.Spec.PodSelector)
	if err == nil && !selector.Empty() {
		podList, err := e.client.Clientset.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{LabelSelector: selector.String()})
		if err == nil {
			for i := range podList.Items {
				pod := &podList.Items[i]
				podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
				addResourceEdge(g, npID, podID, "Restricts")
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildPodSubgraph builds the exhaustive pod-scoped topology (owner, node, services, volumes, SA, PV/SC, endpoints, ingress, HPA, PDB, NetworkPolicy).
func (e *Engine) buildPodSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for Pod resource topology")
	}
	pod, err := e.client.Clientset.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}

	g := NewGraph(resourceSubgraphMaxNodes)
	ns := pod.Namespace
	podID := ensureNode(g, "Pod", ns, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)

	// Owner (ReplicaSet, Deployment, StatefulSet, DaemonSet, Job, CronJob)
	if len(pod.OwnerReferences) > 0 {
		ref := pod.OwnerReferences[0]
		ownerKind := ref.Kind
		ownerName := ref.Name
		var ownerID string
		switch ownerKind {
		case "ReplicaSet":
			rs, err := e.client.Clientset.AppsV1().ReplicaSets(ns).Get(ctx, ownerName, metav1.GetOptions{})
			if err == nil {
				ownerID = ensureNode(g, "ReplicaSet", rs.Namespace, rs.Name, "Active", rs.ObjectMeta)
				addResourceEdge(g, ownerID, podID, "Manages")
				// Deployment from ReplicaSet owner
				for _, r := range rs.OwnerReferences {
					if r.Kind == "Deployment" {
						dep, err := e.client.Clientset.AppsV1().Deployments(ns).Get(ctx, r.Name, metav1.GetOptions{})
						if err == nil {
							depID := ensureNode(g, "Deployment", dep.Namespace, dep.Name, "Active", dep.ObjectMeta)
							addResourceEdge(g, depID, ownerID, "Manages")
						}
						break
					}
				}
			}
		case "StatefulSet":
			sts, err := e.client.Clientset.AppsV1().StatefulSets(ns).Get(ctx, ownerName, metav1.GetOptions{})
			if err == nil {
				ownerID = ensureNode(g, "StatefulSet", sts.Namespace, sts.Name, "Active", sts.ObjectMeta)
				addResourceEdge(g, ownerID, podID, "Manages")
			}
		case "DaemonSet":
			ds, err := e.client.Clientset.AppsV1().DaemonSets(ns).Get(ctx, ownerName, metav1.GetOptions{})
			if err == nil {
				ownerID = ensureNode(g, "DaemonSet", ds.Namespace, ds.Name, "Active", ds.ObjectMeta)
				addResourceEdge(g, ownerID, podID, "Manages")
			}
		case "Job":
			job, err := e.client.Clientset.BatchV1().Jobs(ns).Get(ctx, ownerName, metav1.GetOptions{})
			if err == nil {
				ownerID = ensureNode(g, "Job", job.Namespace, job.Name, "Active", job.ObjectMeta)
				addResourceEdge(g, ownerID, podID, "Manages")
			}
		case "ReplicationController":
			rc, err := e.client.Clientset.CoreV1().ReplicationControllers(ns).Get(ctx, ownerName, metav1.GetOptions{})
			if err == nil {
				ownerID = ensureNode(g, "ReplicationController", rc.Namespace, rc.Name, "Active", rc.ObjectMeta)
				addResourceEdge(g, ownerID, podID, "Manages")
			}
		}
	}

	// Node (runs on)
	if pod.Spec.NodeName != "" {
		node, err := e.client.Clientset.CoreV1().Nodes().Get(ctx, pod.Spec.NodeName, metav1.GetOptions{})
		if err == nil {
			status := "Ready"
			for _, c := range node.Status.Conditions {
				if c.Type == corev1.NodeReady && c.Status != corev1.ConditionTrue {
					status = "NotReady"
					break
				}
			}
			nodeID := ensureNode(g, "Node", "", node.Name, status, node.ObjectMeta)
			addResourceEdge(g, podID, nodeID, "Runs on")
		}
	}

	// Services (selector matches pod labels)
	svcList, err := e.client.Clientset.CoreV1().Services(ns).List(ctx, metav1.ListOptions{})
	if err == nil {
		podLabels := labels.Set(pod.Labels)
		for i := range svcList.Items {
			svc := &svcList.Items[i]
			if len(svc.Spec.Selector) == 0 {
				continue
			}
			selector := labels.SelectorFromSet(svc.Spec.Selector)
			if selector.Matches(podLabels) {
				svcID := ensureNode(g, "Service", svc.Namespace, svc.Name, "Active", svc.ObjectMeta)
				addResourceEdge(g, svcID, podID, "Selects")
			}
		}
	}

	// ConfigMaps, Secrets, PVCs from volumes
	var configMapNames, secretNames, pvcNames []string
	for _, vol := range pod.Spec.Volumes {
		if vol.ConfigMap != nil {
			configMapNames = append(configMapNames, vol.ConfigMap.Name)
		}
		if vol.Secret != nil {
			secretNames = append(secretNames, vol.Secret.SecretName)
		}
		if vol.PersistentVolumeClaim != nil {
			pvcNames = append(pvcNames, vol.PersistentVolumeClaim.ClaimName)
		}
	}
	for _, cmName := range configMapNames {
		cm, err := e.client.Clientset.CoreV1().ConfigMaps(ns).Get(ctx, cmName, metav1.GetOptions{})
		if err == nil {
			cmID := ensureNode(g, "ConfigMap", cm.Namespace, cm.Name, "Active", cm.ObjectMeta)
			addResourceEdge(g, podID, cmID, "Mounts")
		}
	}
	for _, secName := range secretNames {
		sec, err := e.client.Clientset.CoreV1().Secrets(ns).Get(ctx, secName, metav1.GetOptions{})
		if err == nil {
			secID := ensureNode(g, "Secret", sec.Namespace, sec.Name, "Active", sec.ObjectMeta)
			addResourceEdge(g, podID, secID, "Mounts")
		}
	}

	// ServiceAccount
	saName := pod.Spec.ServiceAccountName
	if saName == "" {
		saName = "default"
	}
	sa, err := e.client.Clientset.CoreV1().ServiceAccounts(ns).Get(ctx, saName, metav1.GetOptions{})
	if err == nil {
		saID := ensureNode(g, "ServiceAccount", sa.Namespace, sa.Name, "Active", sa.ObjectMeta)
		addResourceEdge(g, podID, saID, "Uses")
	}

	// PVCs and PV/StorageClass
	for _, pvcName := range pvcNames {
		pvc, err := e.client.Clientset.CoreV1().PersistentVolumeClaims(ns).Get(ctx, pvcName, metav1.GetOptions{})
		if err != nil {
			continue
		}
		pvcID := ensureNode(g, "PersistentVolumeClaim", pvc.Namespace, pvc.Name, string(pvc.Status.Phase), pvc.ObjectMeta)
		addResourceEdge(g, podID, pvcID, "Mounts")
		if pvc.Spec.VolumeName != "" {
			pv, err := e.client.Clientset.CoreV1().PersistentVolumes().Get(ctx, pvc.Spec.VolumeName, metav1.GetOptions{})
			if err == nil {
				pvID := ensureNode(g, "PersistentVolume", "", pv.Name, string(pv.Status.Phase), pv.ObjectMeta)
				addResourceEdge(g, pvcID, pvID, "Bound to")
				if pv.Spec.StorageClassName != "" {
					sc, err := e.client.Clientset.StorageV1().StorageClasses().Get(ctx, pv.Spec.StorageClassName, metav1.GetOptions{})
					if err == nil {
						scID := ensureNode(g, "StorageClass", "", sc.Name, "Active", sc.ObjectMeta)
						addResourceEdge(g, pvID, scID, "Uses")
					}
				}
			}
		}
		if pvc.Spec.StorageClassName != nil && *pvc.Spec.StorageClassName != "" {
			sc, err := e.client.Clientset.StorageV1().StorageClasses().Get(ctx, *pvc.Spec.StorageClassName, metav1.GetOptions{})
			if err == nil {
				scID := ensureNode(g, "StorageClass", "", sc.Name, "Active", sc.ObjectMeta)
				addResourceEdge(g, pvcID, scID, "Uses")
			}
		}
	}

	// Matching service names for Endpoints/EndpointSlices/Ingress
	matchingSvcNames := make(map[string]bool)
	svcList, _ = e.client.Clientset.CoreV1().Services(ns).List(ctx, metav1.ListOptions{})
	podLabels := labels.Set(pod.Labels)
	for i := range svcList.Items {
		svc := &svcList.Items[i]
		if len(svc.Spec.Selector) > 0 && labels.SelectorFromSet(svc.Spec.Selector).Matches(podLabels) {
			matchingSvcNames[svc.Name] = true
		}
	}
	// Endpoints
	epList, _ := e.client.Clientset.CoreV1().Endpoints(ns).List(ctx, metav1.ListOptions{})
	for i := range epList.Items {
		ep := &epList.Items[i]
		if matchingSvcNames[ep.Name] {
			epID := ensureNode(g, "Endpoints", ep.Namespace, ep.Name, "Active", ep.ObjectMeta)
			svcID := "Service/" + ns + "/" + ep.Name
			addResourceEdge(g, svcID, epID, "Creates")
		}
	}
	// EndpointSlices (discovery.k8s.io/v1)
	epsList, err := e.client.Clientset.DiscoveryV1().EndpointSlices(ns).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range epsList.Items {
			slice := &epsList.Items[i]
			svcName := slice.Labels["kubernetes.io/service-name"]
			if matchingSvcNames[svcName] {
				sliceID := ensureNode(g, "EndpointSlice", slice.Namespace, slice.Name, "Active", slice.ObjectMeta)
				svcID := "Service/" + ns + "/" + svcName
				addResourceEdge(g, svcID, sliceID, "Backed by")
			}
		}
	}

	// Ingress (backends referencing our services)
	ingList, err := e.client.Clientset.NetworkingV1().Ingresses(ns).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range ingList.Items {
			ing := &ingList.Items[i]
			for _, rule := range ing.Spec.Rules {
				if rule.HTTP == nil {
					continue
				}
				for _, path := range rule.HTTP.Paths {
					if path.Backend.Service != nil && matchingSvcNames[path.Backend.Service.Name] {
						ingID := ensureNode(g, "Ingress", ing.Namespace, ing.Name, "Active", ing.ObjectMeta)
						svcID := "Service/" + ns + "/" + path.Backend.Service.Name
						addResourceEdge(g, ingID, svcID, "Exposes")
						break
					}
				}
			}
		}
	}

	// HPA (scaleTargetRef to our Deployment/ReplicaSet)
	hpaList, err := e.client.Clientset.AutoscalingV2().HorizontalPodAutoscalers(ns).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range hpaList.Items {
			hpa := &hpaList.Items[i]
			if hpa.Spec.ScaleTargetRef.Name == "" {
				continue
			}
			targetKind := hpa.Spec.ScaleTargetRef.Kind
			targetName := hpa.Spec.ScaleTargetRef.Name
			linked := false
			if len(pod.OwnerReferences) > 0 {
				ownerRef := pod.OwnerReferences[0]
				if (targetKind == "ReplicaSet" && targetName == ownerRef.Name) || (targetKind == "Deployment" && ownerRef.Kind == "ReplicaSet" && linkedDeployment(ctx, e, ns, ownerRef.Name, targetName)) {
					linked = true
				}
			}
			if linked {
				hpaID := ensureNode(g, "HorizontalPodAutoscaler", hpa.Namespace, hpa.Name, "Active", hpa.ObjectMeta)
				targetID := ""
				if targetKind == "ReplicaSet" {
					targetID = "ReplicaSet/" + ns + "/" + targetName
				} else {
					targetID = "Deployment/" + ns + "/" + targetName
				}
				addResourceEdge(g, hpaID, targetID, "Scales")
			}
		}
	}

	// PDB (selector matches pod)
	pdbList, err := e.client.Clientset.PolicyV1().PodDisruptionBudgets(ns).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range pdbList.Items {
			pdb := &pdbList.Items[i]
			if pdb.Spec.Selector == nil {
				continue
			}
			selector, err := metav1.LabelSelectorAsSelector(pdb.Spec.Selector)
			if err != nil {
				continue
			}
			if selector.Matches(podLabels) {
				pdbID := ensureNode(g, "PodDisruptionBudget", pdb.Namespace, pdb.Name, "Active", pdb.ObjectMeta)
				addResourceEdge(g, pdbID, podID, "Protects")
			}
		}
	}

	// NetworkPolicy (podSelector matches pod)
	npList, err := e.client.Clientset.NetworkingV1().NetworkPolicies(ns).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range npList.Items {
			np := &npList.Items[i]
			selector, err := metav1.LabelSelectorAsSelector(&np.Spec.PodSelector)
			if err != nil {
				continue
			}
			if selector.Empty() || selector.Matches(podLabels) {
				npID := ensureNode(g, "NetworkPolicy", np.Namespace, np.Name, "Active", np.ObjectMeta)
				addResourceEdge(g, npID, podID, "Restricts")
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildNodeSubgraph builds Node + all Pods scheduled on it, with optional workload owners (Deployment, ReplicaSet, etc.).
// Node is cluster-scoped; namespace is ignored.
func (e *Engine) buildNodeSubgraph(ctx context.Context, name string) (*Graph, error) {
	node, err := e.client.Clientset.CoreV1().Nodes().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	status := "Ready"
	for _, c := range node.Status.Conditions {
		if c.Type == corev1.NodeReady && c.Status != corev1.ConditionTrue {
			status = "NotReady"
			break
		}
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	nodeID := ensureNode(g, "Node", "", node.Name, status, node.ObjectMeta)

	podList, err := e.client.Clientset.CoreV1().Pods(metav1.NamespaceAll).List(ctx, metav1.ListOptions{
		FieldSelector: "spec.nodeName=" + name,
	})
	if err != nil {
		g.LayoutSeed = g.GenerateLayoutSeed()
		if err := g.Validate(); err != nil {
			return nil, fmt.Errorf("graph validation failed: %w", err)
		}
		return g, nil
	}
	for i := range podList.Items {
		pod := &podList.Items[i]
		ns := pod.Namespace
		podID := ensureNode(g, "Pod", ns, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
		addResourceEdge(g, podID, nodeID, "Runs on")

		// Owner (ReplicaSet, Deployment, StatefulSet, DaemonSet, Job, ReplicationController)
		if len(pod.OwnerReferences) > 0 {
			ref := pod.OwnerReferences[0]
			ownerKind := ref.Kind
			ownerName := ref.Name
			switch ownerKind {
			case "ReplicaSet":
				rs, err := e.client.Clientset.AppsV1().ReplicaSets(ns).Get(ctx, ownerName, metav1.GetOptions{})
				if err == nil {
					ownerID := ensureNode(g, "ReplicaSet", rs.Namespace, rs.Name, "Active", rs.ObjectMeta)
					addResourceEdge(g, ownerID, podID, "Manages")
					for _, r := range rs.OwnerReferences {
						if r.Kind == "Deployment" {
							dep, err := e.client.Clientset.AppsV1().Deployments(ns).Get(ctx, r.Name, metav1.GetOptions{})
							if err == nil {
								depID := ensureNode(g, "Deployment", dep.Namespace, dep.Name, "Active", dep.ObjectMeta)
								addResourceEdge(g, depID, ownerID, "Manages")
							}
							break
						}
					}
				}
			case "StatefulSet":
				sts, err := e.client.Clientset.AppsV1().StatefulSets(ns).Get(ctx, ownerName, metav1.GetOptions{})
				if err == nil {
					ownerID := ensureNode(g, "StatefulSet", sts.Namespace, sts.Name, "Active", sts.ObjectMeta)
					addResourceEdge(g, ownerID, podID, "Manages")
				}
			case "DaemonSet":
				ds, err := e.client.Clientset.AppsV1().DaemonSets(ns).Get(ctx, ownerName, metav1.GetOptions{})
				if err == nil {
					ownerID := ensureNode(g, "DaemonSet", ds.Namespace, ds.Name, "Active", ds.ObjectMeta)
					addResourceEdge(g, ownerID, podID, "Manages")
				}
			case "Job":
				job, err := e.client.Clientset.BatchV1().Jobs(ns).Get(ctx, ownerName, metav1.GetOptions{})
				if err == nil {
					ownerID := ensureNode(g, "Job", job.Namespace, job.Name, "Active", job.ObjectMeta)
					addResourceEdge(g, ownerID, podID, "Manages")
				}
			case "ReplicationController":
				rc, err := e.client.Clientset.CoreV1().ReplicationControllers(ns).Get(ctx, ownerName, metav1.GetOptions{})
				if err == nil {
					ownerID := ensureNode(g, "ReplicationController", rc.Namespace, rc.Name, "Active", rc.ObjectMeta)
					addResourceEdge(g, ownerID, podID, "Manages")
				}
			}
		}
	}

	// VolumeAttachments on this node (I-01)
	vaList, vaErr := e.client.Clientset.StorageV1().VolumeAttachments().List(ctx, metav1.ListOptions{})
	if vaErr == nil {
		for i := range vaList.Items {
			if g.Truncated {
				break
			}
			va := &vaList.Items[i]
			if va.Spec.NodeName != name {
				continue
			}
			vaID := ensureNode(g, "VolumeAttachment", "", va.Name, "Active", va.ObjectMeta)
			addResourceEdge(g, nodeID, vaID, "Has")
		}
	}

	// Lease for this node (I-02) — kube-node-lease namespace convention
	leaseList, leaseErr := e.client.Clientset.CoordinationV1().Leases("kube-node-lease").List(ctx, metav1.ListOptions{})
	if leaseErr == nil {
		for i := range leaseList.Items {
			if g.Truncated {
				break
			}
			lease := &leaseList.Items[i]
			if lease.Spec.HolderIdentity == nil || *lease.Spec.HolderIdentity != name {
				continue
			}
			leaseID := ensureNode(g, "Lease", lease.Namespace, lease.Name, "Active", lease.ObjectMeta)
			addResourceEdge(g, leaseID, nodeID, "Renews")
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// podReferencesConfigMap returns true if the pod references the named ConfigMap (volume, envFrom, or env valueFrom).
func podReferencesConfigMap(pod *corev1.Pod, configMapName string) bool {
	for _, vol := range pod.Spec.Volumes {
		if vol.ConfigMap != nil && vol.ConfigMap.Name == configMapName {
			return true
		}
	}
	for _, c := range pod.Spec.Containers {
		for _, ef := range c.EnvFrom {
			if ef.ConfigMapRef != nil && ef.ConfigMapRef.Name == configMapName {
				return true
			}
		}
		for _, env := range c.Env {
			if env.ValueFrom != nil && env.ValueFrom.ConfigMapKeyRef != nil && env.ValueFrom.ConfigMapKeyRef.Name == configMapName {
				return true
			}
		}
	}
	return false
}

// podReferencesSecret returns true if the pod references the named Secret (volume, envFrom, or env valueFrom).
// containerReferencesSecret checks a single container (regular or init) for secret references.
func containerReferencesSecret(c corev1.Container, secretName string) bool {
	for _, ef := range c.EnvFrom {
		if ef.SecretRef != nil && ef.SecretRef.Name == secretName {
			return true
		}
	}
	for _, env := range c.Env {
		if env.ValueFrom != nil && env.ValueFrom.SecretKeyRef != nil && env.ValueFrom.SecretKeyRef.Name == secretName {
			return true
		}
	}
	return false
}

func podReferencesSecret(pod *corev1.Pod, secretName string) bool {
	// Volume mounts
	for _, vol := range pod.Spec.Volumes {
		if vol.Secret != nil && vol.Secret.SecretName == secretName {
			return true
		}
		// Projected volumes can reference secrets
		if vol.Projected != nil {
			for _, src := range vol.Projected.Sources {
				if src.Secret != nil && src.Secret.Name == secretName {
					return true
				}
			}
		}
	}
	// Regular containers
	for _, c := range pod.Spec.Containers {
		if containerReferencesSecret(c, secretName) {
			return true
		}
	}
	// Init containers (previously unchecked — common cause of missing connections)
	for _, c := range pod.Spec.InitContainers {
		if containerReferencesSecret(c, secretName) {
			return true
		}
	}
	// Ephemeral containers
	for _, c := range pod.Spec.EphemeralContainers {
		// EphemeralContainer embeds EphemeralContainerCommon which has the same Env/EnvFrom fields
		ec := corev1.Container{Name: c.Name, Env: c.Env, EnvFrom: c.EnvFrom}
		if containerReferencesSecret(ec, secretName) {
			return true
		}
	}
	// imagePullSecrets
	for _, ips := range pod.Spec.ImagePullSecrets {
		if ips.Name == secretName {
			return true
		}
	}
	return false
}

// podUsesPVC returns true if the pod uses the named PVC.
func podUsesPVC(pod *corev1.Pod, pvcName string) bool {
	for _, vol := range pod.Spec.Volumes {
		if vol.PersistentVolumeClaim != nil && vol.PersistentVolumeClaim.ClaimName == pvcName {
			return true
		}
	}
	return false
}

// ── Pod spec reference extraction helpers ────────────────────────────────────────────────────────

// podSpecExtractConfigMaps returns all unique ConfigMap names referenced by a PodSpec.
// Covers volumes, projected volumes, env.valueFrom, envFrom across all container types.
func podSpecExtractConfigMaps(spec *corev1.PodSpec) []string {
	seen := map[string]bool{}
	add := func(name string) {
		if name != "" {
			seen[name] = true
		}
	}
	for _, vol := range spec.Volumes {
		if vol.ConfigMap != nil {
			add(vol.ConfigMap.Name)
		}
		if vol.Projected != nil {
			for _, src := range vol.Projected.Sources {
				if src.ConfigMap != nil {
					add(src.ConfigMap.Name)
				}
			}
		}
	}
	extractFromContainers := func(containers []corev1.Container) {
		for _, c := range containers {
			for _, ef := range c.EnvFrom {
				if ef.ConfigMapRef != nil {
					add(ef.ConfigMapRef.Name)
				}
			}
			for _, env := range c.Env {
				if env.ValueFrom != nil && env.ValueFrom.ConfigMapKeyRef != nil {
					add(env.ValueFrom.ConfigMapKeyRef.Name)
				}
			}
		}
	}
	extractFromContainers(spec.Containers)
	extractFromContainers(spec.InitContainers)
	for _, ec := range spec.EphemeralContainers {
		extractFromContainers([]corev1.Container{{Name: ec.Name, EnvFrom: ec.EnvFrom, Env: ec.Env}})
	}
	result := make([]string, 0, len(seen))
	for name := range seen {
		result = append(result, name)
	}
	return result
}

// podSpecExtractSecrets returns all unique Secret names referenced by a PodSpec.
// Covers volumes, projected volumes, imagePullSecrets, env.valueFrom, envFrom across all container types.
func podSpecExtractSecrets(spec *corev1.PodSpec) []string {
	seen := map[string]bool{}
	add := func(name string) {
		if name != "" {
			seen[name] = true
		}
	}
	for _, vol := range spec.Volumes {
		if vol.Secret != nil {
			add(vol.Secret.SecretName)
		}
		if vol.Projected != nil {
			for _, src := range vol.Projected.Sources {
				if src.Secret != nil {
					add(src.Secret.Name)
				}
			}
		}
	}
	for _, ips := range spec.ImagePullSecrets {
		add(ips.Name)
	}
	extractFromContainers := func(containers []corev1.Container) {
		for _, c := range containers {
			for _, ef := range c.EnvFrom {
				if ef.SecretRef != nil {
					add(ef.SecretRef.Name)
				}
			}
			for _, env := range c.Env {
				if env.ValueFrom != nil && env.ValueFrom.SecretKeyRef != nil {
					add(env.ValueFrom.SecretKeyRef.Name)
				}
			}
		}
	}
	extractFromContainers(spec.Containers)
	extractFromContainers(spec.InitContainers)
	for _, ec := range spec.EphemeralContainers {
		extractFromContainers([]corev1.Container{{Name: ec.Name, EnvFrom: ec.EnvFrom, Env: ec.Env}})
	}
	result := make([]string, 0, len(seen))
	for name := range seen {
		result = append(result, name)
	}
	return result
}

// podSpecExtractPVCs returns all PVC claim names referenced in a PodSpec's volumes.
func podSpecExtractPVCs(spec *corev1.PodSpec) []string {
	seen := map[string]bool{}
	for _, vol := range spec.Volumes {
		if vol.PersistentVolumeClaim != nil && vol.PersistentVolumeClaim.ClaimName != "" {
			seen[vol.PersistentVolumeClaim.ClaimName] = true
		}
	}
	result := make([]string, 0, len(seen))
	for name := range seen {
		result = append(result, name)
	}
	return result
}

// addPodTemplateRefsToGraph adds edges from a workload node to ConfigMaps, Secrets, ServiceAccount,
// PVCs, and PriorityClass referenced in the given pod template spec.
// workloadID must already be present in the graph.
func (e *Engine) addPodTemplateRefsToGraph(ctx context.Context, g *Graph, namespace, workloadID string, spec *corev1.PodSpec) {
	if spec == nil {
		return
	}
	// ConfigMaps
	for _, cmName := range podSpecExtractConfigMaps(spec) {
		if g.Truncated {
			break
		}
		cm, err := e.client.Clientset.CoreV1().ConfigMaps(namespace).Get(ctx, cmName, metav1.GetOptions{})
		if err == nil {
			cmID := ensureNode(g, "ConfigMap", cm.Namespace, cm.Name, "Active", cm.ObjectMeta)
			addResourceEdge(g, workloadID, cmID, "Uses")
		}
	}
	// Secrets
	for _, secName := range podSpecExtractSecrets(spec) {
		if g.Truncated {
			break
		}
		sec, err := e.client.Clientset.CoreV1().Secrets(namespace).Get(ctx, secName, metav1.GetOptions{})
		if err == nil {
			secID := ensureNode(g, "Secret", sec.Namespace, sec.Name, "Active", sec.ObjectMeta)
			addResourceEdge(g, workloadID, secID, "Uses")
		}
	}
	// ServiceAccount
	if spec.ServiceAccountName != "" && spec.ServiceAccountName != "default" {
		sa, err := e.client.Clientset.CoreV1().ServiceAccounts(namespace).Get(ctx, spec.ServiceAccountName, metav1.GetOptions{})
		if err == nil {
			saID := ensureNode(g, "ServiceAccount", sa.Namespace, sa.Name, "Active", sa.ObjectMeta)
			addResourceEdge(g, workloadID, saID, "Uses")
		}
	}
	// PriorityClass (cluster-scoped)
	if spec.PriorityClassName != "" {
		pc, err := e.client.Clientset.SchedulingV1().PriorityClasses().Get(ctx, spec.PriorityClassName, metav1.GetOptions{})
		if err == nil {
			pcID := ensureNode(g, "PriorityClass", "", pc.Name, "Active", pc.ObjectMeta)
			addResourceEdge(g, workloadID, pcID, "Uses")
		}
	}
	// PVCs from volumes
	for _, pvcName := range podSpecExtractPVCs(spec) {
		if g.Truncated {
			break
		}
		pvc, err := e.client.Clientset.CoreV1().PersistentVolumeClaims(namespace).Get(ctx, pvcName, metav1.GetOptions{})
		if err == nil {
			pvcID := ensureNode(g, "PersistentVolumeClaim", pvc.Namespace, pvc.Name, string(pvc.Status.Phase), pvc.ObjectMeta)
			addResourceEdge(g, workloadID, pvcID, "Mounts")
		}
	}
}

// addPodOwnerToGraph adds the pod's owner (Deployment/StatefulSet/DaemonSet/Job/CronJob) to the graph and edge from owner to pod.
func (e *Engine) addPodOwnerToGraph(ctx context.Context, g *Graph, pod *corev1.Pod, podID string) {
	if len(pod.OwnerReferences) == 0 {
		return
	}
	ref := pod.OwnerReferences[0]
	ns := pod.Namespace
	switch ref.Kind {
	case "ReplicaSet":
		rs, err := e.client.Clientset.AppsV1().ReplicaSets(ns).Get(ctx, ref.Name, metav1.GetOptions{})
		if err != nil {
			return
		}
		ownerID := ensureNode(g, "ReplicaSet", rs.Namespace, rs.Name, "Active", rs.ObjectMeta)
		addResourceEdge(g, ownerID, podID, "Manages")
		for _, r := range rs.OwnerReferences {
			if r.Kind == "Deployment" {
				dep, err := e.client.Clientset.AppsV1().Deployments(ns).Get(ctx, r.Name, metav1.GetOptions{})
				if err == nil {
					depID := ensureNode(g, "Deployment", dep.Namespace, dep.Name, "Active", dep.ObjectMeta)
					addResourceEdge(g, depID, ownerID, "Manages")
				}
				break
			}
		}
	case "StatefulSet":
		sts, err := e.client.Clientset.AppsV1().StatefulSets(ns).Get(ctx, ref.Name, metav1.GetOptions{})
		if err == nil {
			ownerID := ensureNode(g, "StatefulSet", sts.Namespace, sts.Name, "Active", sts.ObjectMeta)
			addResourceEdge(g, ownerID, podID, "Manages")
		}
	case "DaemonSet":
		ds, err := e.client.Clientset.AppsV1().DaemonSets(ns).Get(ctx, ref.Name, metav1.GetOptions{})
		if err == nil {
			ownerID := ensureNode(g, "DaemonSet", ds.Namespace, ds.Name, "Active", ds.ObjectMeta)
			addResourceEdge(g, ownerID, podID, "Manages")
		}
	case "Job":
		job, err := e.client.Clientset.BatchV1().Jobs(ns).Get(ctx, ref.Name, metav1.GetOptions{})
		if err == nil {
			ownerID := ensureNode(g, "Job", job.Namespace, job.Name, "Active", job.ObjectMeta)
			addResourceEdge(g, ownerID, podID, "Manages")
			for _, r := range job.OwnerReferences {
				if r.Kind == "CronJob" {
					cj, err := e.client.Clientset.BatchV1().CronJobs(ns).Get(ctx, r.Name, metav1.GetOptions{})
					if err == nil {
						cjID := ensureNode(g, "CronJob", cj.Namespace, cj.Name, "Active", cj.ObjectMeta)
						addResourceEdge(g, cjID, ownerID, "Manages")
					}
					break
				}
			}
		}
	}
}

// buildConfigMapSubgraph builds ConfigMap -> Pods (that reference it) -> Workloads (Deployment/StatefulSet/etc).
func (e *Engine) buildConfigMapSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for ConfigMap resource topology")
	}
	cm, err := e.client.Clientset.CoreV1().ConfigMaps(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	cmID := ensureNode(g, "ConfigMap", cm.Namespace, cm.Name, "Active", cm.ObjectMeta)

	podList, err := e.client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		g.LayoutSeed = g.GenerateLayoutSeed()
		_ = g.Validate()
		return g, nil
	}
	for i := range podList.Items {
		if g.Truncated {
			break
		}
		pod := &podList.Items[i]
		if !podReferencesConfigMap(pod, name) {
			continue
		}
		podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
		addResourceEdge(g, cmID, podID, "Used by")
		e.addPodOwnerToGraph(ctx, g, pod, podID)
	}

	// Services that select any of the pods using this ConfigMap (design: ConfigMap → Pods → Deployments → Services)
	svcList, err := e.client.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range podList.Items {
			if g.Truncated {
				break
			}
			pod := &podList.Items[i]
			if !podReferencesConfigMap(pod, name) {
				continue
			}
			podID := "Pod/" + pod.Namespace + "/" + pod.Name
			if g.GetNode(podID) == nil {
				continue
			}
			podLabels := labels.Set(pod.Labels)
			for j := range svcList.Items {
				svc := &svcList.Items[j]
				if len(svc.Spec.Selector) == 0 {
					continue
				}
				if labels.SelectorFromSet(svc.Spec.Selector).Matches(podLabels) {
					svcID := ensureNode(g, "Service", svc.Namespace, svc.Name, "Active", svc.ObjectMeta)
					addResourceEdge(g, svcID, podID, "Selects")
				}
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildSecretSubgraph builds Secret -> Pods (that reference it) -> Workloads; TLS secrets -> Ingresses.
func (e *Engine) buildSecretSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for Secret resource topology")
	}
	sec, err := e.client.Clientset.CoreV1().Secrets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	secID := ensureNode(g, "Secret", sec.Namespace, sec.Name, "Active", sec.ObjectMeta)

	podList, err := e.client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range podList.Items {
			if g.Truncated {
				break
			}
			pod := &podList.Items[i]
			if !podReferencesSecret(pod, name) {
				continue
			}
			podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
			addResourceEdge(g, secID, podID, "Used by")
			e.addPodOwnerToGraph(ctx, g, pod, podID)
		}
	}

	// Ingresses that reference this secret (TLS)
	ingList, err := e.client.Clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range ingList.Items {
			if g.Truncated {
				break
			}
			ing := &ingList.Items[i]
			for _, tls := range ing.Spec.TLS {
				if tls.SecretName == name {
					ingID := ensureNode(g, "Ingress", ing.Namespace, ing.Name, "Active", ing.ObjectMeta)
					addResourceEdge(g, secID, ingID, "TLS")
					break
				}
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildPersistentVolumeClaimSubgraph builds PVC -> PV -> StorageClass; PVC <- Pods <- Workloads.
func (e *Engine) buildPersistentVolumeClaimSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for PersistentVolumeClaim resource topology")
	}
	pvc, err := e.client.Clientset.CoreV1().PersistentVolumeClaims(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	pvcID := ensureNode(g, "PersistentVolumeClaim", pvc.Namespace, pvc.Name, string(pvc.Status.Phase), pvc.ObjectMeta)

	if pvc.Spec.VolumeName != "" {
		pv, err := e.client.Clientset.CoreV1().PersistentVolumes().Get(ctx, pvc.Spec.VolumeName, metav1.GetOptions{})
		if err == nil {
			pvID := ensureNode(g, "PersistentVolume", "", pv.Name, string(pv.Status.Phase), pv.ObjectMeta)
			addResourceEdge(g, pvcID, pvID, "Bound to")
			if pv.Spec.StorageClassName != "" {
				sc, err := e.client.Clientset.StorageV1().StorageClasses().Get(ctx, pv.Spec.StorageClassName, metav1.GetOptions{})
				if err == nil {
					scID := ensureNode(g, "StorageClass", "", sc.Name, "Active", sc.ObjectMeta)
					addResourceEdge(g, pvID, scID, "Uses")
				}
			}
		}
	}
	if pvc.Spec.StorageClassName != nil && *pvc.Spec.StorageClassName != "" {
		sc, err := e.client.Clientset.StorageV1().StorageClasses().Get(ctx, *pvc.Spec.StorageClassName, metav1.GetOptions{})
		if err == nil && g.GetNode("StorageClass/"+sc.Name) == nil {
			scID := ensureNode(g, "StorageClass", "", sc.Name, "Active", sc.ObjectMeta)
			addResourceEdge(g, pvcID, scID, "Uses")
		}
	}

	podList, err := e.client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range podList.Items {
			if g.Truncated {
				break
			}
			pod := &podList.Items[i]
			if !podUsesPVC(pod, name) {
				continue
			}
			podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
			addResourceEdge(g, pvcID, podID, "Used by")
			e.addPodOwnerToGraph(ctx, g, pod, podID)
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildPersistentVolumeSubgraph builds PV -> PVC -> StorageClass; Pods using the PVC.
func (e *Engine) buildPersistentVolumeSubgraph(ctx context.Context, _, name string) (*Graph, error) {
	pv, err := e.client.Clientset.CoreV1().PersistentVolumes().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	pvID := ensureNode(g, "PersistentVolume", "", pv.Name, string(pv.Status.Phase), pv.ObjectMeta)

	if pv.Spec.StorageClassName != "" {
		sc, err := e.client.Clientset.StorageV1().StorageClasses().Get(ctx, pv.Spec.StorageClassName, metav1.GetOptions{})
		if err == nil {
			scID := ensureNode(g, "StorageClass", "", sc.Name, "Active", sc.ObjectMeta)
			addResourceEdge(g, pvID, scID, "Uses")
		}
	}

	if pv.Spec.ClaimRef != nil {
		ns := pv.Spec.ClaimRef.Namespace
		claimName := pv.Spec.ClaimRef.Name
		pvc, err := e.client.Clientset.CoreV1().PersistentVolumeClaims(ns).Get(ctx, claimName, metav1.GetOptions{})
		if err == nil {
			pvcID := ensureNode(g, "PersistentVolumeClaim", pvc.Namespace, pvc.Name, string(pvc.Status.Phase), pvc.ObjectMeta)
			addResourceEdge(g, pvID, pvcID, "Bound to")
			podList, err := e.client.Clientset.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{})
			if err == nil {
				for i := range podList.Items {
					if g.Truncated {
						break
					}
					pod := &podList.Items[i]
					if !podUsesPVC(pod, claimName) {
						continue
					}
					podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
					addResourceEdge(g, pvcID, podID, "Used by")
					e.addPodOwnerToGraph(ctx, g, pod, podID)
				}
			}
		}
	}

	if pv.Spec.NodeAffinity != nil && pv.Status.Phase == corev1.VolumeBound && pv.Spec.ClaimRef != nil {
		// Try to find a pod using the PVC and thus the node
		ns := pv.Spec.ClaimRef.Namespace
		claimName := pv.Spec.ClaimRef.Name
		podList, _ := e.client.Clientset.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{})
		for i := range podList.Items {
			pod := &podList.Items[i]
			if podUsesPVC(pod, claimName) && pod.Spec.NodeName != "" {
				node, err := e.client.Clientset.CoreV1().Nodes().Get(ctx, pod.Spec.NodeName, metav1.GetOptions{})
				if err == nil {
					status := "Ready"
					for _, c := range node.Status.Conditions {
						if c.Type == corev1.NodeReady && c.Status != corev1.ConditionTrue {
							status = "NotReady"
							break
						}
					}
					nodeID := ensureNode(g, "Node", "", node.Name, status, node.ObjectMeta)
					podID := "Pod/" + pod.Namespace + "/" + pod.Name
					if g.GetNode(podID) != nil {
						addResourceEdge(g, podID, nodeID, "Runs on")
					}
				}
				break
			}
		}
	}

	// CSI driver
	if pv.Spec.CSI != nil && pv.Spec.CSI.Driver != "" {
		csiDriver, err := e.client.Clientset.StorageV1().CSIDrivers().Get(ctx, pv.Spec.CSI.Driver, metav1.GetOptions{})
		if err == nil {
			csiID := ensureNode(g, "CSIDriver", "", csiDriver.Name, "Active", csiDriver.ObjectMeta)
			addResourceEdge(g, pvID, csiID, "Provisioned by")
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildStorageClassSubgraph builds StorageClass -> PVs and PVCs that use it.
func (e *Engine) buildStorageClassSubgraph(ctx context.Context, _, name string) (*Graph, error) {
	sc, err := e.client.Clientset.StorageV1().StorageClasses().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	scID := ensureNode(g, "StorageClass", "", sc.Name, "Active", sc.ObjectMeta)

	pvList, err := e.client.Clientset.CoreV1().PersistentVolumes().List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range pvList.Items {
			if g.Truncated {
				break
			}
			pv := &pvList.Items[i]
			if pv.Spec.StorageClassName != name {
				continue
			}
			pvID := ensureNode(g, "PersistentVolume", "", pv.Name, string(pv.Status.Phase), pv.ObjectMeta)
			addResourceEdge(g, pvID, scID, "Uses")
		}
	}

	pvcList, err := e.client.Clientset.CoreV1().PersistentVolumeClaims(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range pvcList.Items {
			if g.Truncated {
				break
			}
			pvc := &pvcList.Items[i]
			scName := ""
			if pvc.Spec.StorageClassName != nil {
				scName = *pvc.Spec.StorageClassName
			}
			if scName != name {
				continue
			}
			pvcID := ensureNode(g, "PersistentVolumeClaim", pvc.Namespace, pvc.Name, string(pvc.Status.Phase), pvc.ObjectMeta)
			addResourceEdge(g, pvcID, scID, "Uses")
		}
	}

	// CSIDriver (provisioner field matches CSIDriver name)
	csiDriver, err := e.client.Clientset.StorageV1().CSIDrivers().Get(ctx, sc.Provisioner, metav1.GetOptions{})
	if err == nil {
		csiID := ensureNode(g, "CSIDriver", "", csiDriver.Name, "Active", csiDriver.ObjectMeta)
		addResourceEdge(g, scID, csiID, "Uses")
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildVolumeAttachmentSubgraph builds VolumeAttachment -> Node, PV.
func (e *Engine) buildVolumeAttachmentSubgraph(ctx context.Context, _, name string) (*Graph, error) {
	va, err := e.client.Clientset.StorageV1().VolumeAttachments().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	vaID := ensureNode(g, "VolumeAttachment", "", va.Name, "Active", va.ObjectMeta)

	if va.Spec.NodeName != "" {
		node, err := e.client.Clientset.CoreV1().Nodes().Get(ctx, va.Spec.NodeName, metav1.GetOptions{})
		if err == nil {
			status := "Ready"
			for _, c := range node.Status.Conditions {
				if c.Type == corev1.NodeReady && c.Status != corev1.ConditionTrue {
					status = "NotReady"
					break
				}
			}
			nodeID := ensureNode(g, "Node", "", node.Name, status, node.ObjectMeta)
			addResourceEdge(g, vaID, nodeID, "Attached to")
		}
	}

	if va.Spec.Source.PersistentVolumeName != nil && *va.Spec.Source.PersistentVolumeName != "" {
		pv, err := e.client.Clientset.CoreV1().PersistentVolumes().Get(ctx, *va.Spec.Source.PersistentVolumeName, metav1.GetOptions{})
		if err == nil {
			pvID := ensureNode(g, "PersistentVolume", "", pv.Name, string(pv.Status.Phase), pv.ObjectMeta)
			addResourceEdge(g, vaID, pvID, "Attaches")
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildResourceQuotaSubgraph builds ResourceQuota -> Namespace.
func (e *Engine) buildResourceQuotaSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for ResourceQuota resource topology")
	}
	quota, err := e.client.Clientset.CoreV1().ResourceQuotas(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	quotaID := ensureNode(g, "ResourceQuota", quota.Namespace, quota.Name, "Active", quota.ObjectMeta)

	// Linked Namespace
	ns, err := e.client.Clientset.CoreV1().Namespaces().Get(ctx, quota.Namespace, metav1.GetOptions{})
	if err == nil {
		nsID := ensureNode(g, "Namespace", "", ns.Name, "Active", ns.ObjectMeta)
		addResourceEdge(g, quotaID, nsID, "Limits")
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildLimitRangeSubgraph builds LimitRange -> Namespace.
func (e *Engine) buildLimitRangeSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for LimitRange resource topology")
	}
	lr, err := e.client.Clientset.CoreV1().LimitRanges(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	lrID := ensureNode(g, "LimitRange", lr.Namespace, lr.Name, "Active", lr.ObjectMeta)

	// Linked Namespace
	ns, err := e.client.Clientset.CoreV1().Namespaces().Get(ctx, lr.Namespace, metav1.GetOptions{})
	if err == nil {
		nsID := ensureNode(g, "Namespace", "", ns.Name, "Active", ns.ObjectMeta)
		addResourceEdge(g, lrID, nsID, "Restricts")
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildPriorityClassSubgraph builds PriorityClass -> Pods (that use it).
func (e *Engine) buildPriorityClassSubgraph(ctx context.Context, name string) (*Graph, error) {
	pc, err := e.client.Clientset.SchedulingV1().PriorityClasses().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	pcID := ensureNode(g, "PriorityClass", "", pc.Name, "Active", pc.ObjectMeta)

	// Pods using this PriorityClass
	podList, err := e.client.Clientset.CoreV1().Pods(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range podList.Items {
			if g.Truncated {
				break
			}
			pod := &podList.Items[i]
			if pod.Spec.PriorityClassName == name {
				podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
				addResourceEdge(g, podID, pcID, "References")
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildResourceSliceSubgraph builds ResourceSlice -> Node.
func (e *Engine) buildResourceSliceSubgraph(ctx context.Context, name string) (*Graph, error) {
	unstr, err := e.client.GetResource(ctx, "ResourceSlice", "", name)
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	meta := metav1.ObjectMeta{
		Name:              unstr.GetName(),
		Namespace:         unstr.GetNamespace(),
		UID:               unstr.GetUID(),
		Labels:            unstr.GetLabels(),
		Annotations:       unstr.GetAnnotations(),
		CreationTimestamp: unstr.GetCreationTimestamp(),
	}
	rsID := ensureNode(g, "ResourceSlice", "", meta.Name, "Active", meta)

	// Linked Node
	nodeName, _, _ := unstructured.NestedString(unstr.Object, "spec", "nodeName")
	if nodeName != "" {
		node, err := e.client.Clientset.CoreV1().Nodes().Get(ctx, nodeName, metav1.GetOptions{})
		if err == nil {
			nodeID := ensureNode(g, "Node", "", node.Name, "Ready", node.ObjectMeta)
			addResourceEdge(g, rsID, nodeID, "Allocates on")
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildDeviceClassSubgraph builds DeviceClass.
func (e *Engine) buildDeviceClassSubgraph(ctx context.Context, name string) (*Graph, error) {
	unstr, err := e.client.GetResource(ctx, "DeviceClass", "", name)
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	meta := metav1.ObjectMeta{
		Name:              unstr.GetName(),
		UID:               unstr.GetUID(),
		Labels:            unstr.GetLabels(),
		Annotations:       unstr.GetAnnotations(),
		CreationTimestamp: unstr.GetCreationTimestamp(),
	}
	ensureNode(g, "DeviceClass", "", meta.Name, "Active", meta)

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// isOwnedBy returns true if refs contains an owner reference matching the given kind and name.
func isOwnedBy(refs []metav1.OwnerReference, kind, name string) bool {
	for _, r := range refs {
		if r.Kind == kind && r.Name == name {
			return true
		}
	}
	return false
}

// buildNamespaceSubgraph builds a high-level topology of all resources within a namespace.
// Shows workload controllers, services, ingresses, config/secret/storage, policy and admin resources.
// Individual Pods and ReplicaSets are omitted to keep the graph readable (see Deployment topology for those).
func (e *Engine) buildNamespaceSubgraph(ctx context.Context, name string) (*Graph, error) {
	ns, err := e.client.Clientset.CoreV1().Namespaces().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	nsStatus := string(ns.Status.Phase)
	if nsStatus == "" {
		nsStatus = "Active"
	}
	nsID := ensureNode(g, "Namespace", "", ns.Name, nsStatus, ns.ObjectMeta)

	// Fetch all resource types (errors are non-fatal — render what we can)
	depList, _ := e.client.Clientset.AppsV1().Deployments(name).List(ctx, metav1.ListOptions{})
	stsList, _ := e.client.Clientset.AppsV1().StatefulSets(name).List(ctx, metav1.ListOptions{})
	dsList, _ := e.client.Clientset.AppsV1().DaemonSets(name).List(ctx, metav1.ListOptions{})
	jobList, _ := e.client.Clientset.BatchV1().Jobs(name).List(ctx, metav1.ListOptions{})
	cjList, _ := e.client.Clientset.BatchV1().CronJobs(name).List(ctx, metav1.ListOptions{})
	svcList, _ := e.client.Clientset.CoreV1().Services(name).List(ctx, metav1.ListOptions{})
	ingList, _ := e.client.Clientset.NetworkingV1().Ingresses(name).List(ctx, metav1.ListOptions{})
	cmList, _ := e.client.Clientset.CoreV1().ConfigMaps(name).List(ctx, metav1.ListOptions{})
	secretList, _ := e.client.Clientset.CoreV1().Secrets(name).List(ctx, metav1.ListOptions{})
	pvcList, _ := e.client.Clientset.CoreV1().PersistentVolumeClaims(name).List(ctx, metav1.ListOptions{})
	npList, _ := e.client.Clientset.NetworkingV1().NetworkPolicies(name).List(ctx, metav1.ListOptions{})
	saList, _ := e.client.Clientset.CoreV1().ServiceAccounts(name).List(ctx, metav1.ListOptions{})
	quotaList, _ := e.client.Clientset.CoreV1().ResourceQuotas(name).List(ctx, metav1.ListOptions{})
	lrList, _ := e.client.Clientset.CoreV1().LimitRanges(name).List(ctx, metav1.ListOptions{})
	hpaList, _ := e.client.Clientset.AutoscalingV2().HorizontalPodAutoscalers(name).List(ctx, metav1.ListOptions{})

	// ── Workload nodes ───────────────────────────────────────────────────────────
	depIDs := map[string]string{}
	if depList != nil {
		for i := range depList.Items {
			if g.Truncated {
				break
			}
			dep := &depList.Items[i]
			id := ensureNode(g, "Deployment", dep.Namespace, dep.Name, deploymentStatus(dep), dep.ObjectMeta)
			addResourceEdge(g, nsID, id, "Contains")
			depIDs[dep.Name] = id
		}
	}

	stsIDs := map[string]string{}
	if stsList != nil {
		for i := range stsList.Items {
			if g.Truncated {
				break
			}
			sts := &stsList.Items[i]
			id := ensureNode(g, "StatefulSet", sts.Namespace, sts.Name, "Active", sts.ObjectMeta)
			addResourceEdge(g, nsID, id, "Contains")
			stsIDs[sts.Name] = id
		}
	}

	dsIDs := map[string]string{}
	if dsList != nil {
		for i := range dsList.Items {
			if g.Truncated {
				break
			}
			ds := &dsList.Items[i]
			id := ensureNode(g, "DaemonSet", ds.Namespace, ds.Name, "Active", ds.ObjectMeta)
			addResourceEdge(g, nsID, id, "Contains")
			dsIDs[ds.Name] = id
		}
	}

	cjIDs := map[string]string{}
	if cjList != nil {
		for i := range cjList.Items {
			if g.Truncated {
				break
			}
			cj := &cjList.Items[i]
			id := ensureNode(g, "CronJob", cj.Namespace, cj.Name, "Active", cj.ObjectMeta)
			addResourceEdge(g, nsID, id, "Contains")
			cjIDs[cj.Name] = id
		}
	}

	if jobList != nil {
		for i := range jobList.Items {
			if g.Truncated {
				break
			}
			job := &jobList.Items[i]
			jobID := ensureNode(g, "Job", job.Namespace, job.Name, "Active", job.ObjectMeta)
			addResourceEdge(g, nsID, jobID, "Contains")
			// Wire CronJob → Job if owned
			for _, ref := range job.OwnerReferences {
				if ref.Kind == "CronJob" {
					if cjID, ok := cjIDs[ref.Name]; ok {
						addResourceEdge(g, cjID, jobID, "Schedules")
					}
					break
				}
			}
		}
	}

	// ── Service nodes + Service → Workload edges ─────────────────────────────────
	svcIDs := map[string]string{}
	if svcList != nil {
		for i := range svcList.Items {
			if g.Truncated {
				break
			}
			svc := &svcList.Items[i]
			svcID := ensureNode(g, "Service", svc.Namespace, svc.Name, "Active", svc.ObjectMeta)
			addResourceEdge(g, nsID, svcID, "Contains")
			svcIDs[svc.Name] = svcID

			if len(svc.Spec.Selector) == 0 {
				continue
			}
			svcSel := labels.SelectorFromSet(svc.Spec.Selector)
			if depList != nil {
				for _, dep := range depList.Items {
					if dep.Spec.Template.Labels != nil && svcSel.Matches(labels.Set(dep.Spec.Template.Labels)) {
						if id, ok := depIDs[dep.Name]; ok {
							addResourceEdge(g, svcID, id, "Exposes")
						}
					}
				}
			}
			if stsList != nil {
				for _, sts := range stsList.Items {
					if sts.Spec.Template.Labels != nil && svcSel.Matches(labels.Set(sts.Spec.Template.Labels)) {
						if id, ok := stsIDs[sts.Name]; ok {
							addResourceEdge(g, svcID, id, "Exposes")
						}
					}
				}
			}
			if dsList != nil {
				for _, ds := range dsList.Items {
					if ds.Spec.Template.Labels != nil && svcSel.Matches(labels.Set(ds.Spec.Template.Labels)) {
						if id, ok := dsIDs[ds.Name]; ok {
							addResourceEdge(g, svcID, id, "Exposes")
						}
					}
				}
			}
		}
	}

	// ── Ingress nodes + Ingress → Service edges ──────────────────────────────────
	if ingList != nil {
		for i := range ingList.Items {
			if g.Truncated {
				break
			}
			ing := &ingList.Items[i]
			ingID := ensureNode(g, "Ingress", ing.Namespace, ing.Name, "Active", ing.ObjectMeta)
			addResourceEdge(g, nsID, ingID, "Contains")
			for _, rule := range ing.Spec.Rules {
				if rule.HTTP == nil {
					continue
				}
				for _, path := range rule.HTTP.Paths {
					if path.Backend.Service != nil {
						if id, ok := svcIDs[path.Backend.Service.Name]; ok {
							addResourceEdge(g, ingID, id, "Routes to")
						}
					}
				}
			}
			if ing.Spec.DefaultBackend != nil && ing.Spec.DefaultBackend.Service != nil {
				if id, ok := svcIDs[ing.Spec.DefaultBackend.Service.Name]; ok {
					addResourceEdge(g, ingID, id, "Routes to")
				}
			}
		}
	}

	// ── HPA nodes + HPA → Workload edges ─────────────────────────────────────────
	if hpaList != nil {
		for i := range hpaList.Items {
			if g.Truncated {
				break
			}
			hpa := &hpaList.Items[i]
			hpaID := ensureNode(g, "HorizontalPodAutoscaler", hpa.Namespace, hpa.Name, "Active", hpa.ObjectMeta)
			addResourceEdge(g, nsID, hpaID, "Contains")
			ref := hpa.Spec.ScaleTargetRef
			switch ref.Kind {
			case "Deployment":
				if id, ok := depIDs[ref.Name]; ok {
					addResourceEdge(g, hpaID, id, "Scales")
				}
			case "StatefulSet":
				if id, ok := stsIDs[ref.Name]; ok {
					addResourceEdge(g, hpaID, id, "Scales")
				}
			}
		}
	}

	// ── NetworkPolicy nodes + NetworkPolicy → Workload edges ────────────────────
	if npList != nil {
		for i := range npList.Items {
			if g.Truncated {
				break
			}
			np := &npList.Items[i]
			npID := ensureNode(g, "NetworkPolicy", np.Namespace, np.Name, "Active", np.ObjectMeta)
			addResourceEdge(g, nsID, npID, "Contains")
			if len(np.Spec.PodSelector.MatchLabels) > 0 {
				npSel := labels.SelectorFromSet(np.Spec.PodSelector.MatchLabels)
				if depList != nil {
					for _, dep := range depList.Items {
						if dep.Spec.Template.Labels != nil && npSel.Matches(labels.Set(dep.Spec.Template.Labels)) {
							if id, ok := depIDs[dep.Name]; ok {
								addResourceEdge(g, npID, id, "Governs")
							}
						}
					}
				}
				if stsList != nil {
					for _, sts := range stsList.Items {
						if sts.Spec.Template.Labels != nil && npSel.Matches(labels.Set(sts.Spec.Template.Labels)) {
							if id, ok := stsIDs[sts.Name]; ok {
								addResourceEdge(g, npID, id, "Governs")
							}
						}
					}
				}
				if dsList != nil {
					for _, ds := range dsList.Items {
						if ds.Spec.Template.Labels != nil && npSel.Matches(labels.Set(ds.Spec.Template.Labels)) {
							if id, ok := dsIDs[ds.Name]; ok {
								addResourceEdge(g, npID, id, "Governs")
							}
						}
					}
				}
			}
		}
	}

	// ── Config & Storage nodes ────────────────────────────────────────────────────
	if cmList != nil {
		for i := range cmList.Items {
			if g.Truncated {
				break
			}
			cm := &cmList.Items[i]
			cmID := ensureNode(g, "ConfigMap", cm.Namespace, cm.Name, "Active", cm.ObjectMeta)
			addResourceEdge(g, nsID, cmID, "Contains")
		}
	}

	if secretList != nil {
		for i := range secretList.Items {
			if g.Truncated {
				break
			}
			sec := &secretList.Items[i]
			secID := ensureNode(g, "Secret", sec.Namespace, sec.Name, "Active", sec.ObjectMeta)
			addResourceEdge(g, nsID, secID, "Contains")
		}
	}

	if pvcList != nil {
		for i := range pvcList.Items {
			if g.Truncated {
				break
			}
			pvc := &pvcList.Items[i]
			pvcID := ensureNode(g, "PersistentVolumeClaim", pvc.Namespace, pvc.Name, string(pvc.Status.Phase), pvc.ObjectMeta)
			addResourceEdge(g, nsID, pvcID, "Contains")
		}
	}

	// ── Admin nodes ───────────────────────────────────────────────────────────────
	if saList != nil {
		for i := range saList.Items {
			if g.Truncated {
				break
			}
			sa := &saList.Items[i]
			saID := ensureNode(g, "ServiceAccount", sa.Namespace, sa.Name, "Active", sa.ObjectMeta)
			addResourceEdge(g, nsID, saID, "Contains")
		}
	}

	if quotaList != nil {
		for i := range quotaList.Items {
			if g.Truncated {
				break
			}
			q := &quotaList.Items[i]
			qID := ensureNode(g, "ResourceQuota", q.Namespace, q.Name, "Active", q.ObjectMeta)
			addResourceEdge(g, nsID, qID, "Contains")
		}
	}

	if lrList != nil {
		for i := range lrList.Items {
			if g.Truncated {
				break
			}
			lr := &lrList.Items[i]
			lrID := ensureNode(g, "LimitRange", lr.Namespace, lr.Name, "Active", lr.ObjectMeta)
			addResourceEdge(g, nsID, lrID, "Contains")
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildServiceAccountSubgraph builds ServiceAccount -> Pods that use it (+ their owner workloads) + token Secrets.
func (e *Engine) buildServiceAccountSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for ServiceAccount resource topology")
	}
	sa, err := e.client.Clientset.CoreV1().ServiceAccounts(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	saID := ensureNode(g, "ServiceAccount", sa.Namespace, sa.Name, "Active", sa.ObjectMeta)

	// Pods that use this ServiceAccount
	podList, err := e.client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range podList.Items {
			if g.Truncated {
				break
			}
			pod := &podList.Items[i]
			if pod.Spec.ServiceAccountName != name {
				continue
			}
			podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
			addResourceEdge(g, saID, podID, "Used by")
			e.addPodOwnerToGraph(ctx, g, pod, podID)
		}
	}

	// Token Secrets bound to this ServiceAccount
	secretList, err := e.client.Clientset.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range secretList.Items {
			if g.Truncated {
				break
			}
			sec := &secretList.Items[i]
			if sec.Type == corev1.SecretTypeServiceAccountToken &&
				sec.Annotations[corev1.ServiceAccountNameKey] == name {
				secID := ensureNode(g, "Secret", sec.Namespace, sec.Name, "Active", sec.ObjectMeta)
				addResourceEdge(g, saID, secID, "Token")
			}
		}
	}

	// RoleBindings that grant permissions to this ServiceAccount
	rbList, err := e.client.Clientset.RbacV1().RoleBindings(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range rbList.Items {
			if g.Truncated {
				break
			}
			rb := &rbList.Items[i]
			for _, sub := range rb.Subjects {
				if sub.Kind == "ServiceAccount" && sub.Name == name && (sub.Namespace == "" || sub.Namespace == namespace) {
					rbID := ensureNode(g, "RoleBinding", rb.Namespace, rb.Name, "Active", rb.ObjectMeta)
					addResourceEdge(g, rbID, saID, "Grants")
					// Role/ClusterRole referenced by this RoleBinding
					if rb.RoleRef.Kind == "Role" {
						role, err := e.client.Clientset.RbacV1().Roles(namespace).Get(ctx, rb.RoleRef.Name, metav1.GetOptions{})
						if err == nil {
							roleID := ensureNode(g, "Role", role.Namespace, role.Name, "Active", role.ObjectMeta)
							addResourceEdge(g, rbID, roleID, "Binds to")
						}
					} else if rb.RoleRef.Kind == "ClusterRole" {
						cr, err := e.client.Clientset.RbacV1().ClusterRoles().Get(ctx, rb.RoleRef.Name, metav1.GetOptions{})
						if err == nil {
							crID := ensureNode(g, "ClusterRole", "", cr.Name, "Active", cr.ObjectMeta)
							addResourceEdge(g, rbID, crID, "Binds to")
						}
					}
					break
				}
			}
		}
	}

	// ClusterRoleBindings that grant permissions to this ServiceAccount (cluster-wide)
	crbList, err := e.client.Clientset.RbacV1().ClusterRoleBindings().List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range crbList.Items {
			if g.Truncated {
				break
			}
			crb := &crbList.Items[i]
			for _, sub := range crb.Subjects {
				if sub.Kind == "ServiceAccount" && sub.Name == name && sub.Namespace == namespace {
					crbID := ensureNode(g, "ClusterRoleBinding", "", crb.Name, "Active", crb.ObjectMeta)
					addResourceEdge(g, crbID, saID, "Grants")
					cr, err := e.client.Clientset.RbacV1().ClusterRoles().Get(ctx, crb.RoleRef.Name, metav1.GetOptions{})
					if err == nil {
						crID := ensureNode(g, "ClusterRole", "", cr.Name, "Active", cr.ObjectMeta)
						addResourceEdge(g, crbID, crID, "Binds to")
					}
					break
				}
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildHorizontalPodAutoscalerSubgraph builds HPA -> target workload (Deployment/StatefulSet/ReplicaSet) -> Pods.
func (e *Engine) buildHorizontalPodAutoscalerSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for HorizontalPodAutoscaler resource topology")
	}
	hpa, err := e.client.Clientset.AutoscalingV2().HorizontalPodAutoscalers(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	hpaID := ensureNode(g, "HorizontalPodAutoscaler", hpa.Namespace, hpa.Name, "Active", hpa.ObjectMeta)

	ref := hpa.Spec.ScaleTargetRef
	switch ref.Kind {
	case "Deployment":
		dep, err := e.client.Clientset.AppsV1().Deployments(namespace).Get(ctx, ref.Name, metav1.GetOptions{})
		if err == nil {
			depID := ensureNode(g, "Deployment", dep.Namespace, dep.Name, deploymentStatus(dep), dep.ObjectMeta)
			addResourceEdge(g, hpaID, depID, "Scales")
			rsList, _ := e.client.Clientset.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
			podList, _ := e.client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
			if rsList != nil {
				for i := range rsList.Items {
					if g.Truncated {
						break
					}
					rs := &rsList.Items[i]
					if !isOwnedBy(rs.OwnerReferences, "Deployment", dep.Name) {
						continue
					}
					rsID := ensureNode(g, "ReplicaSet", rs.Namespace, rs.Name, "Active", rs.ObjectMeta)
					addResourceEdge(g, depID, rsID, "Owns")
					if podList != nil {
						for j := range podList.Items {
							if g.Truncated {
								break
							}
							pod := &podList.Items[j]
							if isOwnedBy(pod.OwnerReferences, "ReplicaSet", rs.Name) {
								podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
								addResourceEdge(g, rsID, podID, "Owns")
							}
						}
					}
				}
			}
		}
	case "StatefulSet":
		sts, err := e.client.Clientset.AppsV1().StatefulSets(namespace).Get(ctx, ref.Name, metav1.GetOptions{})
		if err == nil {
			stsID := ensureNode(g, "StatefulSet", sts.Namespace, sts.Name, "Active", sts.ObjectMeta)
			addResourceEdge(g, hpaID, stsID, "Scales")
			podList, _ := e.client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
			if podList != nil {
				for i := range podList.Items {
					if g.Truncated {
						break
					}
					pod := &podList.Items[i]
					if isOwnedBy(pod.OwnerReferences, "StatefulSet", sts.Name) {
						podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
						addResourceEdge(g, stsID, podID, "Owns")
					}
				}
			}
		}
	case "ReplicaSet":
		rs, err := e.client.Clientset.AppsV1().ReplicaSets(namespace).Get(ctx, ref.Name, metav1.GetOptions{})
		if err == nil {
			rsID := ensureNode(g, "ReplicaSet", rs.Namespace, rs.Name, "Active", rs.ObjectMeta)
			addResourceEdge(g, hpaID, rsID, "Scales")
			podList, _ := e.client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
			if podList != nil {
				for i := range podList.Items {
					if g.Truncated {
						break
					}
					pod := &podList.Items[i]
					if isOwnedBy(pod.OwnerReferences, "ReplicaSet", rs.Name) {
						podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
						addResourceEdge(g, rsID, podID, "Owns")
					}
				}
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildReplicationControllerSubgraph builds ReplicationController -> Pods it owns + Services that select them.
func (e *Engine) buildReplicationControllerSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for ReplicationController resource topology")
	}
	rc, err := e.client.Clientset.CoreV1().ReplicationControllers(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	rcID := ensureNode(g, "ReplicationController", rc.Namespace, rc.Name, "Active", rc.ObjectMeta)

	// Pods owned by this RC (via owner references)
	podList, _ := e.client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if podList != nil {
		for i := range podList.Items {
			if g.Truncated {
				break
			}
			pod := &podList.Items[i]
			if isOwnedBy(pod.OwnerReferences, "ReplicationController", name) {
				podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
				addResourceEdge(g, rcID, podID, "Owns")
			}
		}
	}

	// Services that select pods matching this RC's selector
	if len(rc.Spec.Selector) > 0 {
		svcList, _ := e.client.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
		if svcList != nil {
			for i := range svcList.Items {
				if g.Truncated {
					break
				}
				svc := &svcList.Items[i]
				if len(svc.Spec.Selector) == 0 {
					continue
				}
				// Service selects RC pods when its selector matches the RC's pod selector labels
				svcSel := labels.SelectorFromSet(svc.Spec.Selector)
				if svcSel.Matches(labels.Set(rc.Spec.Selector)) {
					svcID := ensureNode(g, "Service", svc.Namespace, svc.Name, "Active", svc.ObjectMeta)
					addResourceEdge(g, svcID, rcID, "Selects")
				}
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildRoleSubgraph builds Role → RoleBindings that reference it → ServiceAccount subjects.
func (e *Engine) buildRoleSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for Role resource topology")
	}
	role, err := e.client.Clientset.RbacV1().Roles(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	roleID := ensureNode(g, "Role", role.Namespace, role.Name, "Active", role.ObjectMeta)

	rbList, err := e.client.Clientset.RbacV1().RoleBindings(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range rbList.Items {
			if g.Truncated {
				break
			}
			rb := &rbList.Items[i]
			if rb.RoleRef.Kind != "Role" || rb.RoleRef.Name != name {
				continue
			}
			rbID := ensureNode(g, "RoleBinding", rb.Namespace, rb.Name, "Active", rb.ObjectMeta)
			addResourceEdge(g, rbID, roleID, "Binds to")
			for _, sub := range rb.Subjects {
				if g.Truncated {
					break
				}
				if sub.Kind == "ServiceAccount" {
					subNS := sub.Namespace
					if subNS == "" {
						subNS = namespace
					}
					sa, err := e.client.Clientset.CoreV1().ServiceAccounts(subNS).Get(ctx, sub.Name, metav1.GetOptions{})
					if err == nil {
						saID := ensureNode(g, "ServiceAccount", sa.Namespace, sa.Name, "Active", sa.ObjectMeta)
						addResourceEdge(g, rbID, saID, "Grants")
					}
				}
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildClusterRoleSubgraph builds ClusterRole → ClusterRoleBindings + RoleBindings that reference it → subjects.
func (e *Engine) buildClusterRoleSubgraph(ctx context.Context, name string) (*Graph, error) {
	cr, err := e.client.Clientset.RbacV1().ClusterRoles().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	crID := ensureNode(g, "ClusterRole", "", cr.Name, "Active", cr.ObjectMeta)

	// ClusterRoleBindings that reference this ClusterRole
	crbList, err := e.client.Clientset.RbacV1().ClusterRoleBindings().List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range crbList.Items {
			if g.Truncated {
				break
			}
			crb := &crbList.Items[i]
			if crb.RoleRef.Kind != "ClusterRole" || crb.RoleRef.Name != name {
				continue
			}
			crbID := ensureNode(g, "ClusterRoleBinding", "", crb.Name, "Active", crb.ObjectMeta)
			addResourceEdge(g, crbID, crID, "Binds to")
			for _, sub := range crb.Subjects {
				if g.Truncated {
					break
				}
				if sub.Kind == "ServiceAccount" {
					sa, err := e.client.Clientset.CoreV1().ServiceAccounts(sub.Namespace).Get(ctx, sub.Name, metav1.GetOptions{})
					if err == nil {
						saID := ensureNode(g, "ServiceAccount", sa.Namespace, sa.Name, "Active", sa.ObjectMeta)
						addResourceEdge(g, crbID, saID, "Grants")
					}
				}
			}
		}
	}

	// Namespace-scoped RoleBindings that also bind this ClusterRole
	rbList, err := e.client.Clientset.RbacV1().RoleBindings(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range rbList.Items {
			if g.Truncated {
				break
			}
			rb := &rbList.Items[i]
			if rb.RoleRef.Kind != "ClusterRole" || rb.RoleRef.Name != name {
				continue
			}
			rbID := ensureNode(g, "RoleBinding", rb.Namespace, rb.Name, "Active", rb.ObjectMeta)
			addResourceEdge(g, rbID, crID, "Binds to")
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildRoleBindingSubgraph builds RoleBinding → Role/ClusterRole + ServiceAccount subjects.
func (e *Engine) buildRoleBindingSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for RoleBinding resource topology")
	}
	rb, err := e.client.Clientset.RbacV1().RoleBindings(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	rbID := ensureNode(g, "RoleBinding", rb.Namespace, rb.Name, "Active", rb.ObjectMeta)

	// Role or ClusterRole this binding references
	if rb.RoleRef.Kind == "Role" {
		role, err := e.client.Clientset.RbacV1().Roles(namespace).Get(ctx, rb.RoleRef.Name, metav1.GetOptions{})
		if err == nil {
			roleID := ensureNode(g, "Role", role.Namespace, role.Name, "Active", role.ObjectMeta)
			addResourceEdge(g, rbID, roleID, "Binds to")
		}
	} else if rb.RoleRef.Kind == "ClusterRole" {
		cr, err := e.client.Clientset.RbacV1().ClusterRoles().Get(ctx, rb.RoleRef.Name, metav1.GetOptions{})
		if err == nil {
			crID := ensureNode(g, "ClusterRole", "", cr.Name, "Active", cr.ObjectMeta)
			addResourceEdge(g, rbID, crID, "Binds to")
		}
	}

	// ServiceAccount subjects
	for _, sub := range rb.Subjects {
		if g.Truncated {
			break
		}
		if sub.Kind == "ServiceAccount" {
			subNS := sub.Namespace
			if subNS == "" {
				subNS = namespace
			}
			sa, err := e.client.Clientset.CoreV1().ServiceAccounts(subNS).Get(ctx, sub.Name, metav1.GetOptions{})
			if err == nil {
				saID := ensureNode(g, "ServiceAccount", sa.Namespace, sa.Name, "Active", sa.ObjectMeta)
				addResourceEdge(g, rbID, saID, "Grants")
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildClusterRoleBindingSubgraph builds ClusterRoleBinding → ClusterRole + ServiceAccount subjects.
func (e *Engine) buildClusterRoleBindingSubgraph(ctx context.Context, name string) (*Graph, error) {
	crb, err := e.client.Clientset.RbacV1().ClusterRoleBindings().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	crbID := ensureNode(g, "ClusterRoleBinding", "", crb.Name, "Active", crb.ObjectMeta)

	// ClusterRole target
	cr, err := e.client.Clientset.RbacV1().ClusterRoles().Get(ctx, crb.RoleRef.Name, metav1.GetOptions{})
	if err == nil {
		crID := ensureNode(g, "ClusterRole", "", cr.Name, "Active", cr.ObjectMeta)
		addResourceEdge(g, crbID, crID, "Binds to")
	}

	// ServiceAccount subjects
	for _, sub := range crb.Subjects {
		if g.Truncated {
			break
		}
		if sub.Kind == "ServiceAccount" {
			sa, err := e.client.Clientset.CoreV1().ServiceAccounts(sub.Namespace).Get(ctx, sub.Name, metav1.GetOptions{})
			if err == nil {
				saID := ensureNode(g, "ServiceAccount", sa.Namespace, sa.Name, "Active", sa.ObjectMeta)
				addResourceEdge(g, crbID, saID, "Grants")
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildPodDisruptionBudgetSubgraph builds PDB → target Pods (via selector) → their owner workloads.
func (e *Engine) buildPodDisruptionBudgetSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		return nil, fmt.Errorf("namespace required for PodDisruptionBudget resource topology")
	}
	pdb, err := e.client.Clientset.PolicyV1().PodDisruptionBudgets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)

	pdbStatus := "Active"
	if pdb.Status.DisruptionsAllowed == 0 {
		pdbStatus = "Blocking"
	}
	pdbID := ensureNode(g, "PodDisruptionBudget", pdb.Namespace, pdb.Name, pdbStatus, pdb.ObjectMeta)

	if pdb.Spec.Selector != nil {
		sel, err := metav1.LabelSelectorAsSelector(pdb.Spec.Selector)
		if err == nil && !sel.Empty() {
			podList, err := e.client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: sel.String()})
			if err == nil {
				for i := range podList.Items {
					if g.Truncated {
						break
					}
					pod := &podList.Items[i]
					podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
					addResourceEdge(g, pdbID, podID, "Protects")
					e.addPodOwnerToGraph(ctx, g, pod, podID)
				}
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildRuntimeClassSubgraph builds RuntimeClass <- Pods using this runtime class.
func (e *Engine) buildRuntimeClassSubgraph(ctx context.Context, name string) (*Graph, error) {
	rc, err := e.client.Clientset.NodeV1().RuntimeClasses().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	rcID := ensureNode(g, "RuntimeClass", "", rc.Name, "Active", rc.ObjectMeta)

	podList, err := e.client.Clientset.CoreV1().Pods(metav1.NamespaceAll).List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range podList.Items {
			if g.Truncated {
				break
			}
			pod := &podList.Items[i]
			if pod.Spec.RuntimeClassName == nil || *pod.Spec.RuntimeClassName != name {
				continue
			}
			podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
			addResourceEdge(g, podID, rcID, "Uses")
			e.addPodOwnerToGraph(ctx, g, pod, podID)
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildLeaseSubgraph builds Lease -> Node/Pod (via spec.holderIdentity).
func (e *Engine) buildLeaseSubgraph(ctx context.Context, namespace, name string) (*Graph, error) {
	if namespace == "" {
		namespace = "kube-node-lease"
	}
	lease, err := e.client.Clientset.CoordinationV1().Leases(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	leaseID := ensureNode(g, "Lease", lease.Namespace, lease.Name, "Active", lease.ObjectMeta)

	if lease.Spec.HolderIdentity != nil && *lease.Spec.HolderIdentity != "" {
		holderName := *lease.Spec.HolderIdentity
		// Try as Node (kube-node-lease convention)
		node, err := e.client.Clientset.CoreV1().Nodes().Get(ctx, holderName, metav1.GetOptions{})
		if err == nil {
			status := "Ready"
			for _, c := range node.Status.Conditions {
				if c.Type == corev1.NodeReady && c.Status != corev1.ConditionTrue {
					status = "NotReady"
					break
				}
			}
			nodeID := ensureNode(g, "Node", "", node.Name, status, node.ObjectMeta)
			addResourceEdge(g, leaseID, nodeID, "Held by")
		} else {
			// Try as Pod (leader election leases)
			podList, err := e.client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
			if err == nil {
				for i := range podList.Items {
					pod := &podList.Items[i]
					if pod.Name == holderName {
						podID := ensureNode(g, "Pod", pod.Namespace, pod.Name, string(pod.Status.Phase), pod.ObjectMeta)
						addResourceEdge(g, leaseID, podID, "Held by")
						e.addPodOwnerToGraph(ctx, g, pod, podID)
						break
					}
				}
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildCSIDriverSubgraph builds CSIDriver <- PVs using it + <- StorageClasses provisioned by it.
func (e *Engine) buildCSIDriverSubgraph(ctx context.Context, name string) (*Graph, error) {
	csiDriver, err := e.client.Clientset.StorageV1().CSIDrivers().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	csiID := ensureNode(g, "CSIDriver", "", csiDriver.Name, "Active", csiDriver.ObjectMeta)

	pvList, err := e.client.Clientset.CoreV1().PersistentVolumes().List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range pvList.Items {
			if g.Truncated {
				break
			}
			pv := &pvList.Items[i]
			if pv.Spec.CSI == nil || pv.Spec.CSI.Driver != name {
				continue
			}
			pvID := ensureNode(g, "PersistentVolume", "", pv.Name, string(pv.Status.Phase), pv.ObjectMeta)
			addResourceEdge(g, pvID, csiID, "Provisioned by")
		}
	}

	scList, err := e.client.Clientset.StorageV1().StorageClasses().List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range scList.Items {
			if g.Truncated {
				break
			}
			sc := &scList.Items[i]
			if sc.Provisioner != name {
				continue
			}
			scID := ensureNode(g, "StorageClass", "", sc.Name, "Active", sc.ObjectMeta)
			addResourceEdge(g, scID, csiID, "Uses")
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildCSINodeSubgraph builds CSINode -> Node (same name) + -> CSIDrivers loaded on this node.
func (e *Engine) buildCSINodeSubgraph(ctx context.Context, name string) (*Graph, error) {
	csiNode, err := e.client.Clientset.StorageV1().CSINodes().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	csiNodeID := ensureNode(g, "CSINode", "", csiNode.Name, "Active", csiNode.ObjectMeta)

	node, err := e.client.Clientset.CoreV1().Nodes().Get(ctx, name, metav1.GetOptions{})
	if err == nil {
		status := "Ready"
		for _, c := range node.Status.Conditions {
			if c.Type == corev1.NodeReady && c.Status != corev1.ConditionTrue {
				status = "NotReady"
				break
			}
		}
		nodeID := ensureNode(g, "Node", "", node.Name, status, node.ObjectMeta)
		addResourceEdge(g, csiNodeID, nodeID, "Represents")
	}

	for _, d := range csiNode.Spec.Drivers {
		if g.Truncated {
			break
		}
		driver, err := e.client.Clientset.StorageV1().CSIDrivers().Get(ctx, d.Name, metav1.GetOptions{})
		if err == nil {
			driverID := ensureNode(g, "CSIDriver", "", driver.Name, "Active", driver.ObjectMeta)
			addResourceEdge(g, csiNodeID, driverID, "Loads")
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildMutatingWebhookConfigurationSubgraph builds MutatingWebhookConfiguration -> Services it calls.
func (e *Engine) buildMutatingWebhookConfigurationSubgraph(ctx context.Context, name string) (*Graph, error) {
	mwc, err := e.client.Clientset.AdmissionregistrationV1().MutatingWebhookConfigurations().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	mwcID := ensureNode(g, "MutatingWebhookConfiguration", "", mwc.Name, "Active", mwc.ObjectMeta)

	for i := range mwc.Webhooks {
		if g.Truncated {
			break
		}
		wh := &mwc.Webhooks[i]
		if wh.ClientConfig.Service != nil {
			svc, err := e.client.Clientset.CoreV1().Services(wh.ClientConfig.Service.Namespace).Get(ctx, wh.ClientConfig.Service.Name, metav1.GetOptions{})
			if err == nil {
				svcID := ensureNode(g, "Service", svc.Namespace, svc.Name, "Active", svc.ObjectMeta)
				addResourceEdge(g, mwcID, svcID, "Calls")
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildValidatingWebhookConfigurationSubgraph builds ValidatingWebhookConfiguration -> Services it calls.
func (e *Engine) buildValidatingWebhookConfigurationSubgraph(ctx context.Context, name string) (*Graph, error) {
	vwc, err := e.client.Clientset.AdmissionregistrationV1().ValidatingWebhookConfigurations().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	vwcID := ensureNode(g, "ValidatingWebhookConfiguration", "", vwc.Name, "Active", vwc.ObjectMeta)

	for i := range vwc.Webhooks {
		if g.Truncated {
			break
		}
		wh := &vwc.Webhooks[i]
		if wh.ClientConfig.Service != nil {
			svc, err := e.client.Clientset.CoreV1().Services(wh.ClientConfig.Service.Namespace).Get(ctx, wh.ClientConfig.Service.Name, metav1.GetOptions{})
			if err == nil {
				svcID := ensureNode(g, "Service", svc.Namespace, svc.Name, "Active", svc.ObjectMeta)
				addResourceEdge(g, vwcID, svcID, "Calls")
			}
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildFlowSchemaSubgraph builds FlowSchema -> PriorityLevelConfiguration it assigns to.
func (e *Engine) buildFlowSchemaSubgraph(ctx context.Context, name string) (*Graph, error) {
	fs, err := e.client.Clientset.FlowcontrolV1().FlowSchemas().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	fsStatus := "Active"
	if len(fs.Status.Conditions) > 0 {
		fsStatus = string(fs.Status.Conditions[0].Status)
	}
	fsID := ensureNode(g, "FlowSchema", "", fs.Name, fsStatus, fs.ObjectMeta)

	if fs.Spec.PriorityLevelConfiguration.Name != "" {
		plc, err := e.client.Clientset.FlowcontrolV1().PriorityLevelConfigurations().Get(ctx, fs.Spec.PriorityLevelConfiguration.Name, metav1.GetOptions{})
		if err == nil {
			plcID := ensureNode(g, "PriorityLevelConfiguration", "", plc.Name, "Active", plc.ObjectMeta)
			addResourceEdge(g, fsID, plcID, "Assigns to")
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

// buildPriorityLevelConfigurationSubgraph builds PriorityLevelConfiguration <- FlowSchemas that reference it.
func (e *Engine) buildPriorityLevelConfigurationSubgraph(ctx context.Context, name string) (*Graph, error) {
	plc, err := e.client.Clientset.FlowcontrolV1().PriorityLevelConfigurations().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, ErrResourceNotFound
	}
	g := NewGraph(resourceSubgraphMaxNodes)
	plcID := ensureNode(g, "PriorityLevelConfiguration", "", plc.Name, "Active", plc.ObjectMeta)

	fsList, err := e.client.Clientset.FlowcontrolV1().FlowSchemas().List(ctx, metav1.ListOptions{})
	if err == nil {
		for i := range fsList.Items {
			if g.Truncated {
				break
			}
			fs := &fsList.Items[i]
			if fs.Spec.PriorityLevelConfiguration.Name != name {
				continue
			}
			fsStatus := "Active"
			if len(fs.Status.Conditions) > 0 {
				fsStatus = string(fs.Status.Conditions[0].Status)
			}
			fsID := ensureNode(g, "FlowSchema", "", fs.Name, fsStatus, fs.ObjectMeta)
			addResourceEdge(g, fsID, plcID, "Assigns to")
		}
	}

	g.LayoutSeed = g.GenerateLayoutSeed()
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("graph validation failed: %w", err)
	}
	return g, nil
}

func linkedDeployment(ctx context.Context, e *Engine, ns, rsName, deploymentName string) bool {
	rs, err := e.client.Clientset.AppsV1().ReplicaSets(ns).Get(ctx, rsName, metav1.GetOptions{})
	if err != nil {
		return false
	}
	for _, r := range rs.OwnerReferences {
		if r.Kind == "Deployment" && r.Name == deploymentName {
			return true
		}
	}
	return false
}
