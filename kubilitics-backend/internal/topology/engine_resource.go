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
var ResourceTopologyKinds = []string{"Node", "Pod", "Deployment", "ReplicaSet", "StatefulSet", "DaemonSet", "Job", "CronJob", "Service", "Ingress", "IngressClass", "Endpoints", "EndpointSlice", "NetworkPolicy", "ConfigMap", "Secret", "PersistentVolumeClaim", "PersistentVolume", "StorageClass", "VolumeAttachment", "ResourceQuota", "LimitRange", "PriorityClass", "ResourceSlice", "DeviceClass"}

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
func podReferencesSecret(pod *corev1.Pod, secretName string) bool {
	for _, vol := range pod.Spec.Volumes {
		if vol.Secret != nil && vol.Secret.SecretName == secretName {
			return true
		}
	}
	for _, c := range pod.Spec.Containers {
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
