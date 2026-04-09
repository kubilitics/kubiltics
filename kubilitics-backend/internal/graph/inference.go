package graph

import (
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/models"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
)

// addEdge adds a directed dependency edge with deduplication.
// It registers both source and target in the nodes map, maintains forward/reverse
// adjacency maps, and appends to the edges slice.
func addEdge(
	nodes map[string]models.ResourceRef,
	forward map[string]map[string]bool,
	reverse map[string]map[string]bool,
	edges *[]models.BlastDependencyEdge,
	source, target models.ResourceRef,
	edgeType, detail string,
) {
	srcKey := refKey(source)
	tgtKey := refKey(target)

	// Register nodes
	nodes[srcKey] = source
	nodes[tgtKey] = target

	// Initialise adjacency sets if needed
	if forward[srcKey] == nil {
		forward[srcKey] = make(map[string]bool)
	}
	if reverse[tgtKey] == nil {
		reverse[tgtKey] = make(map[string]bool)
	}

	// Deduplicate: skip if edge already recorded
	if forward[srcKey][tgtKey] {
		return
	}

	forward[srcKey][tgtKey] = true
	reverse[tgtKey][srcKey] = true

	*edges = append(*edges, models.BlastDependencyEdge{
		Source: source,
		Target: target,
		Type:   edgeType,
		Detail: detail,
	})
}

// inferOwnerRefDeps maps Pods to their owning workloads (Deployment via ReplicaSet,
// StatefulSet, DaemonSet, Job). Returns podOwners: "namespace/podName" -> owner ResourceRef.
func inferOwnerRefDeps(
	nodes map[string]models.ResourceRef,
	forward map[string]map[string]bool,
	reverse map[string]map[string]bool,
	edges *[]models.BlastDependencyEdge,
	pods []corev1.Pod,
	deployments []appsv1.Deployment,
	statefulsets []appsv1.StatefulSet,
	daemonsets []appsv1.DaemonSet,
) map[string]models.ResourceRef {
	podOwners := make(map[string]models.ResourceRef)

	// Build a map of ReplicaSet names -> owning Deployment for indirect ownership.
	// We detect this by matching Deployment selector to Pod labels, then checking
	// if the Pod's ownerRef is a ReplicaSet whose name starts with the Deployment name.
	// A simpler approach: build deploy selector -> deploy ref, then match pods.

	// Index deployments by namespace/selector for matching
	type deployInfo struct {
		ref      models.ResourceRef
		selector labels.Selector
	}
	deploysByNS := make(map[string][]deployInfo)
	for _, d := range deployments {
		if d.Spec.Selector == nil {
			continue
		}
		sel, err := metav1.LabelSelectorAsSelector(d.Spec.Selector)
		if err != nil {
			continue
		}
		ref := models.ResourceRef{Kind: "Deployment", Namespace: d.Namespace, Name: d.Name}
		deploysByNS[d.Namespace] = append(deploysByNS[d.Namespace], deployInfo{ref: ref, selector: sel})
	}

	// Index StatefulSets by namespace
	type ssInfo struct {
		ref      models.ResourceRef
		selector labels.Selector
	}
	ssByNS := make(map[string][]ssInfo)
	for _, ss := range statefulsets {
		if ss.Spec.Selector == nil {
			continue
		}
		sel, err := metav1.LabelSelectorAsSelector(ss.Spec.Selector)
		if err != nil {
			continue
		}
		ref := models.ResourceRef{Kind: "StatefulSet", Namespace: ss.Namespace, Name: ss.Name}
		ssByNS[ss.Namespace] = append(ssByNS[ss.Namespace], ssInfo{ref: ref, selector: sel})
	}

	// Index DaemonSets by namespace
	type dsInfo struct {
		ref      models.ResourceRef
		selector labels.Selector
	}
	dsByNS := make(map[string][]dsInfo)
	for _, ds := range daemonsets {
		if ds.Spec.Selector == nil {
			continue
		}
		sel, err := metav1.LabelSelectorAsSelector(ds.Spec.Selector)
		if err != nil {
			continue
		}
		ref := models.ResourceRef{Kind: "DaemonSet", Namespace: ds.Namespace, Name: ds.Name}
		dsByNS[ds.Namespace] = append(dsByNS[ds.Namespace], dsInfo{ref: ref, selector: sel})
	}

	for i := range pods {
		pod := &pods[i]
		podRef := models.ResourceRef{Kind: "Pod", Namespace: pod.Namespace, Name: pod.Name}
		podLabels := labels.Set(pod.Labels)
		podKey := pod.Namespace + "/" + pod.Name

		var owner *models.ResourceRef

		// Check ownerReferences first
		for _, ownerRef := range pod.OwnerReferences {
			switch ownerRef.Kind {
			case "ReplicaSet":
				// Find the Deployment that owns this ReplicaSet by matching selectors
				for _, di := range deploysByNS[pod.Namespace] {
					if di.selector.Matches(podLabels) {
						ref := di.ref
						owner = &ref
						break
					}
				}
			case "StatefulSet":
				ref := models.ResourceRef{Kind: "StatefulSet", Namespace: pod.Namespace, Name: ownerRef.Name}
				owner = &ref
			case "DaemonSet":
				ref := models.ResourceRef{Kind: "DaemonSet", Namespace: pod.Namespace, Name: ownerRef.Name}
				owner = &ref
			case "Job":
				ref := models.ResourceRef{Kind: "Job", Namespace: pod.Namespace, Name: ownerRef.Name}
				owner = &ref
			}
			if owner != nil {
				break
			}
		}

		// Fallback: if no ownerRef matched, try selector matching
		if owner == nil {
			for _, di := range deploysByNS[pod.Namespace] {
				if di.selector.Matches(podLabels) {
					ref := di.ref
					owner = &ref
					break
				}
			}
		}
		if owner == nil {
			for _, si := range ssByNS[pod.Namespace] {
				if si.selector.Matches(podLabels) {
					ref := si.ref
					owner = &ref
					break
				}
			}
		}
		if owner == nil {
			for _, di := range dsByNS[pod.Namespace] {
				if di.selector.Matches(podLabels) {
					ref := di.ref
					owner = &ref
					break
				}
			}
		}

		if owner != nil {
			addEdge(nodes, forward, reverse, edges, *owner, podRef, "owns", fmt.Sprintf("%s/%s owns Pod/%s", owner.Kind, owner.Name, pod.Name))
			podOwners[podKey] = *owner
		}
	}

	return podOwners
}

// inferSelectorDeps links Services to Pods (and their owners) via label selectors.
func inferSelectorDeps(
	nodes map[string]models.ResourceRef,
	forward map[string]map[string]bool,
	reverse map[string]map[string]bool,
	edges *[]models.BlastDependencyEdge,
	services []corev1.Service,
	pods []corev1.Pod,
	podOwners map[string]models.ResourceRef,
) {
	for i := range services {
		svc := &services[i]
		if len(svc.Spec.Selector) == 0 {
			continue
		}
		svcRef := models.ResourceRef{Kind: "Service", Namespace: svc.Namespace, Name: svc.Name}
		sel := labels.SelectorFromSet(labels.Set(svc.Spec.Selector))

		linkedOwners := make(map[string]bool)
		for j := range pods {
			pod := &pods[j]
			if pod.Namespace != svc.Namespace {
				continue
			}
			if !sel.Matches(labels.Set(pod.Labels)) {
				continue
			}

			// Link to owner workload if known, otherwise to the pod
			podKey := pod.Namespace + "/" + pod.Name
			if owner, ok := podOwners[podKey]; ok {
				ownerKey := refKey(owner)
				if !linkedOwners[ownerKey] {
					linkedOwners[ownerKey] = true
					addEdge(nodes, forward, reverse, edges, svcRef, owner, "selects",
						fmt.Sprintf("Service/%s selects %s/%s", svc.Name, owner.Kind, owner.Name))
				}
			} else {
				podRef := models.ResourceRef{Kind: "Pod", Namespace: pod.Namespace, Name: pod.Name}
				addEdge(nodes, forward, reverse, edges, svcRef, podRef, "selects",
					fmt.Sprintf("Service/%s selects Pod/%s", svc.Name, pod.Name))
			}
		}
	}
}


// inferIngressDeps links Ingress rules to backend Services.
func inferIngressDeps(
	nodes map[string]models.ResourceRef,
	forward map[string]map[string]bool,
	reverse map[string]map[string]bool,
	edges *[]models.BlastDependencyEdge,
	ingresses []networkingv1.Ingress,
) {
	for i := range ingresses {
		ing := &ingresses[i]
		ingRef := models.ResourceRef{Kind: "Ingress", Namespace: ing.Namespace, Name: ing.Name}

		// Default backend
		if ing.Spec.DefaultBackend != nil && ing.Spec.DefaultBackend.Service != nil {
			svcRef := models.ResourceRef{Kind: "Service", Namespace: ing.Namespace, Name: ing.Spec.DefaultBackend.Service.Name}
			addEdge(nodes, forward, reverse, edges, ingRef, svcRef, "routes",
				fmt.Sprintf("Ingress/%s default backend -> Service/%s", ing.Name, svcRef.Name))
		}

		for _, rule := range ing.Spec.Rules {
			if rule.HTTP == nil {
				continue
			}
			for _, path := range rule.HTTP.Paths {
				if path.Backend.Service == nil {
					continue
				}
				svcRef := models.ResourceRef{Kind: "Service", Namespace: ing.Namespace, Name: path.Backend.Service.Name}
				detail := fmt.Sprintf("Ingress/%s %s%s -> Service/%s", ing.Name, rule.Host, path.Path, svcRef.Name)
				addEdge(nodes, forward, reverse, edges, ingRef, svcRef, "routes", detail)
			}
		}
	}
}


// buildHPATargets returns the set of refKeys for workloads targeted by HPAs.
func buildHPATargets(hpas []autoscalingv1.HorizontalPodAutoscaler) map[string]bool {
	result := make(map[string]bool)
	for _, hpa := range hpas {
		ref := models.ResourceRef{
			Kind:      hpa.Spec.ScaleTargetRef.Kind,
			Namespace: hpa.Namespace,
			Name:      hpa.Spec.ScaleTargetRef.Name,
		}
		result[refKey(ref)] = true
	}
	return result
}

// buildPDBTargets returns the set of refKeys for workloads covered by PDBs.
// It matches PDB selectors against pods and resolves to their owners.
func buildPDBTargets(
	pdbs []policyv1.PodDisruptionBudget,
	pods []corev1.Pod,
	podOwners map[string]models.ResourceRef,
) map[string]bool {
	result := make(map[string]bool)
	for _, pdb := range pdbs {
		if pdb.Spec.Selector == nil {
			continue
		}
		sel, err := metav1.LabelSelectorAsSelector(pdb.Spec.Selector)
		if err != nil {
			continue
		}
		for j := range pods {
			pod := &pods[j]
			if pod.Namespace != pdb.Namespace {
				continue
			}
			if !sel.Matches(labels.Set(pod.Labels)) {
				continue
			}
			podKey := pod.Namespace + "/" + pod.Name
			if owner, ok := podOwners[podKey]; ok {
				result[refKey(owner)] = true
			}
		}
	}
	return result
}

// buildIngressHostMap maps service refKeys to lists of host+path strings
// from Ingress resources.
func buildIngressHostMap(ingresses []networkingv1.Ingress) map[string][]string {
	result := make(map[string][]string)
	for i := range ingresses {
		ing := &ingresses[i]
		for _, rule := range ing.Spec.Rules {
			if rule.HTTP == nil {
				continue
			}
			for _, path := range rule.HTTP.Paths {
				if path.Backend.Service == nil {
					continue
				}
				svcRef := models.ResourceRef{Kind: "Service", Namespace: ing.Namespace, Name: path.Backend.Service.Name}
				key := refKey(svcRef)
				hostPath := rule.Host + path.Path
				result[key] = append(result[key], hostPath)
			}
		}
	}
	return result
}
