package graph

import (
	"fmt"
	"regexp"
	"strings"

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

// dnsPattern matches Kubernetes DNS service references like "svc-name.namespace.svc.cluster.local"
var dnsPattern = regexp.MustCompile(`([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.svc(?:\.cluster\.local)?`)

// svcHostPattern matches Kubernetes auto-injected env vars like MYSERVICE_SERVICE_HOST
var svcHostPattern = regexp.MustCompile(`^([A-Z][A-Z0-9_]*)_SERVICE_HOST$`)

// inferEnvVarDeps scans pod env vars for service references (same and cross-namespace).
func inferEnvVarDeps(
	nodes map[string]models.ResourceRef,
	forward map[string]map[string]bool,
	reverse map[string]map[string]bool,
	edges *[]models.BlastDependencyEdge,
	pods []corev1.Pod,
	podOwners map[string]models.ResourceRef,
	services []corev1.Service,
) {
	// Build a set of known services for validation
	svcSet := make(map[string]bool) // "namespace/name"
	for _, svc := range services {
		svcSet[svc.Namespace+"/"+svc.Name] = true
	}

	// Also build a map for env-var-style name lookup: "NAMESPACE/UPPER_DASHED_NAME"
	// K8s converts service names to uppercase and replaces dashes with underscores
	svcByEnvKey := make(map[string]models.ResourceRef) // "namespace/ENV_NAME" -> ref
	for _, svc := range services {
		envName := strings.ToUpper(strings.ReplaceAll(svc.Name, "-", "_"))
		key := svc.Namespace + "/" + envName
		svcByEnvKey[key] = models.ResourceRef{Kind: "Service", Namespace: svc.Namespace, Name: svc.Name}
	}

	for i := range pods {
		pod := &pods[i]
		podKey := pod.Namespace + "/" + pod.Name

		// Determine the source node (owner or pod)
		var sourceRef models.ResourceRef
		if owner, ok := podOwners[podKey]; ok {
			sourceRef = owner
		} else {
			sourceRef = models.ResourceRef{Kind: "Pod", Namespace: pod.Namespace, Name: pod.Name}
		}

		seen := make(map[string]bool) // dedup per source

		for _, c := range pod.Spec.Containers {
			for _, env := range c.Env {
				// Pattern 1: {SVCNAME}_SERVICE_HOST (same namespace, auto-injected)
				if m := svcHostPattern.FindStringSubmatch(env.Name); m != nil {
					envPrefix := m[1]
					lookupKey := pod.Namespace + "/" + envPrefix
					if svcRef, ok := svcByEnvKey[lookupKey]; ok {
						tgtKey := refKey(svcRef)
						if !seen[tgtKey] {
							seen[tgtKey] = true
							addEdge(nodes, forward, reverse, edges, sourceRef, svcRef, "env-var",
								fmt.Sprintf("env %s references Service/%s", env.Name, svcRef.Name))
						}
					}
				}

				// Pattern 2: DNS names in env values (cross-namespace)
				if env.Value != "" {
					matches := dnsPattern.FindAllStringSubmatch(env.Value, -1)
					for _, match := range matches {
						svcName := match[1]
						svcNS := match[2]
						svcLookup := svcNS + "/" + svcName
						if svcSet[svcLookup] {
							svcRef := models.ResourceRef{Kind: "Service", Namespace: svcNS, Name: svcName}
							tgtKey := refKey(svcRef)
							if !seen[tgtKey] {
								seen[tgtKey] = true
								addEdge(nodes, forward, reverse, edges, sourceRef, svcRef, "env-dns",
									fmt.Sprintf("env %s references %s.%s.svc", env.Name, svcName, svcNS))
							}
						}
					}
				}
			}
		}
	}
}

// inferVolumeMountDeps links workloads to ConfigMaps, Secrets, and PVCs via volume mounts.
func inferVolumeMountDeps(
	nodes map[string]models.ResourceRef,
	forward map[string]map[string]bool,
	reverse map[string]map[string]bool,
	edges *[]models.BlastDependencyEdge,
	deployments []appsv1.Deployment,
	statefulsets []appsv1.StatefulSet,
	daemonsets []appsv1.DaemonSet,
) {
	type workload struct {
		ref     models.ResourceRef
		volumes []corev1.Volume
	}

	var workloads []workload

	for _, d := range deployments {
		workloads = append(workloads, workload{
			ref:     models.ResourceRef{Kind: "Deployment", Namespace: d.Namespace, Name: d.Name},
			volumes: d.Spec.Template.Spec.Volumes,
		})
	}
	for _, ss := range statefulsets {
		workloads = append(workloads, workload{
			ref:     models.ResourceRef{Kind: "StatefulSet", Namespace: ss.Namespace, Name: ss.Name},
			volumes: ss.Spec.Template.Spec.Volumes,
		})
	}
	for _, ds := range daemonsets {
		workloads = append(workloads, workload{
			ref:     models.ResourceRef{Kind: "DaemonSet", Namespace: ds.Namespace, Name: ds.Name},
			volumes: ds.Spec.Template.Spec.Volumes,
		})
	}

	for _, w := range workloads {
		for _, vol := range w.volumes {
			if vol.ConfigMap != nil {
				target := models.ResourceRef{Kind: "ConfigMap", Namespace: w.ref.Namespace, Name: vol.ConfigMap.Name}
				addEdge(nodes, forward, reverse, edges, w.ref, target, "mounts",
					fmt.Sprintf("%s/%s mounts ConfigMap/%s", w.ref.Kind, w.ref.Name, vol.ConfigMap.Name))
			}
			if vol.Secret != nil {
				target := models.ResourceRef{Kind: "Secret", Namespace: w.ref.Namespace, Name: vol.Secret.SecretName}
				addEdge(nodes, forward, reverse, edges, w.ref, target, "mounts",
					fmt.Sprintf("%s/%s mounts Secret/%s", w.ref.Kind, w.ref.Name, vol.Secret.SecretName))
			}
			if vol.PersistentVolumeClaim != nil {
				target := models.ResourceRef{Kind: "PersistentVolumeClaim", Namespace: w.ref.Namespace, Name: vol.PersistentVolumeClaim.ClaimName}
				addEdge(nodes, forward, reverse, edges, w.ref, target, "mounts",
					fmt.Sprintf("%s/%s mounts PVC/%s", w.ref.Kind, w.ref.Name, vol.PersistentVolumeClaim.ClaimName))
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

// inferNetworkPolicyDeps links NetworkPolicies to workloads via podSelector
// and handles cross-namespace references via namespaceSelector in ingress rules.
func inferNetworkPolicyDeps(
	nodes map[string]models.ResourceRef,
	forward map[string]map[string]bool,
	reverse map[string]map[string]bool,
	edges *[]models.BlastDependencyEdge,
	netpols []networkingv1.NetworkPolicy,
	pods []corev1.Pod,
	podOwners map[string]models.ResourceRef,
) {
	for i := range netpols {
		np := &netpols[i]
		npRef := models.ResourceRef{Kind: "NetworkPolicy", Namespace: np.Namespace, Name: np.Name}

		// The policy's podSelector selects pods in the same namespace
		sel, err := metav1.LabelSelectorAsSelector(&np.Spec.PodSelector)
		if err != nil {
			continue
		}

		// Link to target pods/owners
		linkedOwners := make(map[string]bool)
		for j := range pods {
			pod := &pods[j]
			if pod.Namespace != np.Namespace {
				continue
			}
			if !sel.Matches(labels.Set(pod.Labels)) {
				continue
			}
			podKey := pod.Namespace + "/" + pod.Name
			if owner, ok := podOwners[podKey]; ok {
				ownerKey := refKey(owner)
				if !linkedOwners[ownerKey] {
					linkedOwners[ownerKey] = true
					addEdge(nodes, forward, reverse, edges, npRef, owner, "network-policy",
						fmt.Sprintf("NetworkPolicy/%s targets %s/%s", np.Name, owner.Kind, owner.Name))
				}
			}
		}

		// Cross-namespace: ingress rules with namespaceSelector + podSelector
		for _, ingRule := range np.Spec.Ingress {
			for _, from := range ingRule.From {
				if from.NamespaceSelector == nil {
					continue
				}
				nsSel, err := metav1.LabelSelectorAsSelector(from.NamespaceSelector)
				if err != nil {
					continue
				}

				var podSel labels.Selector
				if from.PodSelector != nil {
					podSel, err = metav1.LabelSelectorAsSelector(from.PodSelector)
					if err != nil {
						continue
					}
				}

				// Match pods across namespaces
				for j := range pods {
					pod := &pods[j]
					// Check namespace labels - we approximate by checking if the
					// namespace name matches (for simple selectors) or skip namespace
					// label matching since we don't have Namespace objects.
					// For cross-namespace edges, we check pods in other namespaces.
					if pod.Namespace == np.Namespace {
						continue
					}

					// If a podSelector is specified, check it
					if podSel != nil && !podSel.Matches(labels.Set(pod.Labels)) {
						continue
					}

					// We can't fully validate namespaceSelector without Namespace objects,
					// but for non-empty selectors, we accept pods from other namespaces
					// if the selector is not "match nothing".
					if nsSel.Empty() {
						continue
					}

					podKey := pod.Namespace + "/" + pod.Name
					if owner, ok := podOwners[podKey]; ok {
						ownerKey := refKey(owner)
						if !linkedOwners[ownerKey] {
							linkedOwners[ownerKey] = true
							addEdge(nodes, forward, reverse, edges, npRef, owner, "network-policy-cross-ns",
								fmt.Sprintf("NetworkPolicy/%s allows from %s/%s/%s", np.Name, owner.Kind, owner.Namespace, owner.Name))
						}
					}
				}
			}
		}
	}
}

// inferIstioDeps extracts cross-namespace dependencies from Istio VirtualService
// and DestinationRule CRDs. Uses untyped data since these are custom resources.
// No-op if hasIstio is false.
func inferIstioDeps(
	nodes map[string]models.ResourceRef,
	forward map[string]map[string]bool,
	reverse map[string]map[string]bool,
	edges *[]models.BlastDependencyEdge,
	virtualServices []map[string]interface{},
	destinationRules []map[string]interface{},
	hasIstio bool,
) {
	if !hasIstio {
		return
	}

	for _, vs := range virtualServices {
		meta := extractMetadata(vs)
		if meta.name == "" {
			continue
		}
		vsRef := models.ResourceRef{Kind: "VirtualService", Namespace: meta.namespace, Name: meta.name}

		// Extract HTTP route destinations
		spec, _ := vs["spec"].(map[string]interface{})
		if spec == nil {
			continue
		}
		httpRoutes, _ := spec["http"].([]interface{})
		for _, hr := range httpRoutes {
			httpRoute, _ := hr.(map[string]interface{})
			if httpRoute == nil {
				continue
			}
			routes, _ := httpRoute["route"].([]interface{})
			for _, r := range routes {
				route, _ := r.(map[string]interface{})
				if route == nil {
					continue
				}
				dest, _ := route["destination"].(map[string]interface{})
				if dest == nil {
					continue
				}
				host, _ := dest["host"].(string)
				if host == "" {
					continue
				}

				svcRef := resolveIstioHost(host, meta.namespace)
				addEdge(nodes, forward, reverse, edges, vsRef, svcRef, "istio-route",
					fmt.Sprintf("VirtualService/%s routes to %s/%s/%s", meta.name, svcRef.Kind, svcRef.Namespace, svcRef.Name))
			}
		}

		// Also handle TCP routes
		tcpRoutes, _ := spec["tcp"].([]interface{})
		for _, tr := range tcpRoutes {
			tcpRoute, _ := tr.(map[string]interface{})
			if tcpRoute == nil {
				continue
			}
			routes, _ := tcpRoute["route"].([]interface{})
			for _, r := range routes {
				route, _ := r.(map[string]interface{})
				if route == nil {
					continue
				}
				dest, _ := route["destination"].(map[string]interface{})
				if dest == nil {
					continue
				}
				host, _ := dest["host"].(string)
				if host == "" {
					continue
				}
				svcRef := resolveIstioHost(host, meta.namespace)
				addEdge(nodes, forward, reverse, edges, vsRef, svcRef, "istio-route",
					fmt.Sprintf("VirtualService/%s tcp-routes to %s/%s/%s", meta.name, svcRef.Kind, svcRef.Namespace, svcRef.Name))
			}
		}
	}

	for _, dr := range destinationRules {
		meta := extractMetadata(dr)
		if meta.name == "" {
			continue
		}
		drRef := models.ResourceRef{Kind: "DestinationRule", Namespace: meta.namespace, Name: meta.name}

		spec, _ := dr["spec"].(map[string]interface{})
		if spec == nil {
			continue
		}
		host, _ := spec["host"].(string)
		if host == "" {
			continue
		}

		svcRef := resolveIstioHost(host, meta.namespace)
		addEdge(nodes, forward, reverse, edges, drRef, svcRef, "istio-destination-rule",
			fmt.Sprintf("DestinationRule/%s targets %s/%s/%s", meta.name, svcRef.Kind, svcRef.Namespace, svcRef.Name))
	}
}

type crdMeta struct {
	name      string
	namespace string
}

func extractMetadata(obj map[string]interface{}) crdMeta {
	meta, _ := obj["metadata"].(map[string]interface{})
	if meta == nil {
		return crdMeta{}
	}
	name, _ := meta["name"].(string)
	ns, _ := meta["namespace"].(string)
	return crdMeta{name: name, namespace: ns}
}

// resolveIstioHost parses an Istio host string into a Service ResourceRef.
// Supports short names ("my-svc"), FQDN ("my-svc.other-ns.svc.cluster.local"),
// and namespace-qualified ("my-svc.other-ns").
func resolveIstioHost(host, defaultNS string) models.ResourceRef {
	// FQDN: svc.namespace.svc.cluster.local
	if m := dnsPattern.FindStringSubmatch(host); m != nil {
		return models.ResourceRef{Kind: "Service", Namespace: m[2], Name: m[1]}
	}
	// namespace-qualified: svc.namespace
	parts := strings.SplitN(host, ".", 3)
	if len(parts) == 2 {
		return models.ResourceRef{Kind: "Service", Namespace: parts[1], Name: parts[0]}
	}
	// Short name: same namespace
	return models.ResourceRef{Kind: "Service", Namespace: defaultNS, Name: host}
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
