package service

import (
	"context"
	"fmt"
	"math"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"

	"github.com/kubilitics/kubilitics-backend/internal/k8s"
	"github.com/kubilitics/kubilitics-backend/internal/models"
)

// BlastRadiusService computes dependency graphs and criticality scores for
// Kubernetes resources within a namespace.
type BlastRadiusService interface {
	ComputeBlastRadius(ctx context.Context, client *k8s.Client, namespace, kind, name string) (*models.BlastRadiusResult, error)
}

type blastRadiusService struct{}

// NewBlastRadiusService creates a new blast radius computation service.
func NewBlastRadiusService() BlastRadiusService {
	return &blastRadiusService{}
}

// depGraph holds adjacency lists for the dependency graph.
// forward[A] = resources that A depends on (A -> B means A uses B).
// reverse[B] = resources that depend on B (B <- A).
type depGraph struct {
	forward map[string]map[string]bool // adjacency: source -> set of targets
	reverse map[string]map[string]bool // reverse adjacency: target -> set of sources
	edges   []models.BlastDependencyEdge
	refs    map[string]models.ResourceRef // key -> ResourceRef
}

func newDepGraph() *depGraph {
	return &depGraph{
		forward: make(map[string]map[string]bool),
		reverse: make(map[string]map[string]bool),
		edges:   nil,
		refs:    make(map[string]models.ResourceRef),
	}
}

func refKey(r models.ResourceRef) string {
	return r.Kind + "/" + r.Namespace + "/" + r.Name
}

func (g *depGraph) addRef(r models.ResourceRef) {
	g.refs[refKey(r)] = r
}

func (g *depGraph) addEdge(source, target models.ResourceRef, depType string) {
	sk := refKey(source)
	tk := refKey(target)
	g.addRef(source)
	g.addRef(target)

	if g.forward[sk] == nil {
		g.forward[sk] = make(map[string]bool)
	}
	if g.forward[sk][tk] {
		return // duplicate
	}
	g.forward[sk][tk] = true

	if g.reverse[tk] == nil {
		g.reverse[tk] = make(map[string]bool)
	}
	g.reverse[tk][sk] = true

	g.edges = append(g.edges, models.BlastDependencyEdge{
		Source: source,
		Target: target,
		Type:   depType,
	})
}

// namespaceResources bundles all fetched resources from a namespace.
type namespaceResources struct {
	Deployments  []appsv1.Deployment
	StatefulSets []appsv1.StatefulSet
	DaemonSets   []appsv1.DaemonSet
	Services     []corev1.Service
	Pods         []corev1.Pod
	ConfigMaps   []corev1.ConfigMap
	Secrets      []corev1.Secret
	Ingresses    []networkingv1.Ingress
	NetPolicies  []networkingv1.NetworkPolicy
	PVCs         []corev1.PersistentVolumeClaim
}

func fetchNamespaceResources(ctx context.Context, client *k8s.Client, namespace string) (*namespaceResources, error) {
	nr := &namespaceResources{}
	listOpts := metav1.ListOptions{}

	deployList, err := client.Clientset.AppsV1().Deployments(namespace).List(ctx, listOpts)
	if err != nil {
		return nil, fmt.Errorf("list deployments: %w", err)
	}
	nr.Deployments = deployList.Items

	stsList, err := client.Clientset.AppsV1().StatefulSets(namespace).List(ctx, listOpts)
	if err != nil {
		return nil, fmt.Errorf("list statefulsets: %w", err)
	}
	nr.StatefulSets = stsList.Items

	dsList, err := client.Clientset.AppsV1().DaemonSets(namespace).List(ctx, listOpts)
	if err != nil {
		return nil, fmt.Errorf("list daemonsets: %w", err)
	}
	nr.DaemonSets = dsList.Items

	svcList, err := client.Clientset.CoreV1().Services(namespace).List(ctx, listOpts)
	if err != nil {
		return nil, fmt.Errorf("list services: %w", err)
	}
	nr.Services = svcList.Items

	podList, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, listOpts)
	if err != nil {
		return nil, fmt.Errorf("list pods: %w", err)
	}
	nr.Pods = podList.Items

	cmList, err := client.Clientset.CoreV1().ConfigMaps(namespace).List(ctx, listOpts)
	if err != nil {
		return nil, fmt.Errorf("list configmaps: %w", err)
	}
	nr.ConfigMaps = cmList.Items

	secList, err := client.Clientset.CoreV1().Secrets(namespace).List(ctx, listOpts)
	if err != nil {
		return nil, fmt.Errorf("list secrets: %w", err)
	}
	nr.Secrets = secList.Items

	ingList, err := client.Clientset.NetworkingV1().Ingresses(namespace).List(ctx, listOpts)
	if err != nil {
		return nil, fmt.Errorf("list ingresses: %w", err)
	}
	nr.Ingresses = ingList.Items

	npList, err := client.Clientset.NetworkingV1().NetworkPolicies(namespace).List(ctx, listOpts)
	if err != nil {
		return nil, fmt.Errorf("list networkpolicies: %w", err)
	}
	nr.NetPolicies = npList.Items

	pvcList, err := client.Clientset.CoreV1().PersistentVolumeClaims(namespace).List(ctx, listOpts)
	if err != nil {
		return nil, fmt.Errorf("list pvcs: %w", err)
	}
	nr.PVCs = pvcList.Items

	return nr, nil
}

// ComputeBlastRadius fetches all resources in the namespace, builds the
// dependency graph, then BFS-walks from the target resource to compute the
// blast radius and criticality score.
func (s *blastRadiusService) ComputeBlastRadius(ctx context.Context, client *k8s.Client, namespace, kind, name string) (*models.BlastRadiusResult, error) {
	nr, err := fetchNamespaceResources(ctx, client, namespace)
	if err != nil {
		return nil, fmt.Errorf("fetch namespace resources: %w", err)
	}

	graph := newDepGraph()

	// Build maps for quick lookups
	svcByName := make(map[string]*corev1.Service)
	for i := range nr.Services {
		svcByName[nr.Services[i].Name] = &nr.Services[i]
	}
	cmNames := make(map[string]bool)
	for i := range nr.ConfigMaps {
		cmNames[nr.ConfigMaps[i].Name] = true
	}
	secretNames := make(map[string]bool)
	for i := range nr.Secrets {
		secretNames[nr.Secrets[i].Name] = true
	}

	// ownerRef maps Pod -> owner (Deployment/StatefulSet/DaemonSet)
	podOwner := make(map[string]models.ResourceRef) // pod name -> owner ref
	for i := range nr.Pods {
		pod := &nr.Pods[i]
		for _, owner := range pod.OwnerReferences {
			switch owner.Kind {
			case "ReplicaSet":
				// Find which Deployment owns this ReplicaSet
				for j := range nr.Deployments {
					dep := &nr.Deployments[j]
					sel, selErr := metav1.LabelSelectorAsSelector(dep.Spec.Selector)
					if selErr != nil {
						continue
					}
					if sel.Matches(labels.Set(pod.Labels)) {
						podOwner[pod.Name] = models.ResourceRef{Kind: "Deployment", Name: dep.Name, Namespace: namespace}
						break
					}
				}
			case "StatefulSet":
				podOwner[pod.Name] = models.ResourceRef{Kind: "StatefulSet", Name: owner.Name, Namespace: namespace}
			case "DaemonSet":
				podOwner[pod.Name] = models.ResourceRef{Kind: "DaemonSet", Name: owner.Name, Namespace: namespace}
			}
		}
	}

	// 1. Parse Pod env vars for service references (SERVICE_HOST, _PORT patterns)
	inferEnvVarDependencies(graph, nr, namespace, podOwner, svcByName)

	// 2. ConfigMap/Secret volume mounts shared across deployments
	inferVolumeMountDependencies(graph, nr, namespace)

	// 3. Service selectors -> matching Pods -> owner Deployments
	inferSelectorDependencies(graph, nr, namespace, podOwner)

	// 4. Ingress rules -> backend Services
	inferIngressDependencies(graph, nr, namespace)

	// 5. NetworkPolicy ingress/egress rules
	inferNetworkPolicyDependencies(graph, nr, namespace, podOwner)

	// Register all top-level resources as nodes
	for i := range nr.Deployments {
		graph.addRef(models.ResourceRef{Kind: "Deployment", Name: nr.Deployments[i].Name, Namespace: namespace})
	}
	for i := range nr.StatefulSets {
		graph.addRef(models.ResourceRef{Kind: "StatefulSet", Name: nr.StatefulSets[i].Name, Namespace: namespace})
	}
	for i := range nr.DaemonSets {
		graph.addRef(models.ResourceRef{Kind: "DaemonSet", Name: nr.DaemonSets[i].Name, Namespace: namespace})
	}
	for i := range nr.Services {
		graph.addRef(models.ResourceRef{Kind: "Service", Name: nr.Services[i].Name, Namespace: namespace})
	}

	// Compute blast radius via BFS from target
	targetRef := models.ResourceRef{Kind: kind, Name: name, Namespace: namespace}
	targetKey := refKey(targetRef)

	// Validate target exists in graph
	if _, exists := graph.refs[targetKey]; !exists {
		return nil, fmt.Errorf("resource %s/%s/%s not found in namespace dependency graph", kind, namespace, name)
	}

	// BFS: find all resources affected if this resource goes down.
	// Walk the reverse graph (resources that depend on this one) to find impact.
	affected := bfsWalk(graph.reverse, targetKey)

	// Also walk forward to find resources this depends on (for fan_out).
	dependsOn := bfsWalk(graph.forward, targetKey)

	// FanIn = direct dependents (not transitive)
	fanIn := len(graph.reverse[targetKey])
	// FanOut = direct dependencies
	fanOut := len(graph.forward[targetKey])

	// Collect affected resource refs (excluding self)
	affectedRefs := make([]models.ResourceRef, 0, len(affected))
	for k := range affected {
		if k != targetKey {
			if ref, ok := graph.refs[k]; ok {
				affectedRefs = append(affectedRefs, ref)
			}
		}
	}

	// Count total workloads (Deployments + StatefulSets + DaemonSets + Services)
	totalWorkloads := len(nr.Deployments) + len(nr.StatefulSets) + len(nr.DaemonSets) + len(nr.Services)
	blastRadiusPercent := 0.0
	if totalWorkloads > 1 {
		blastRadiusPercent = float64(len(affectedRefs)) / float64(totalWorkloads-1) * 100.0
	}

	// Check attributes for scoring
	isDataStore := kind == "StatefulSet"
	if !isDataStore {
		// Check if target has PVCs (data store indicator)
		for i := range nr.PVCs {
			pvc := &nr.PVCs[i]
			// PVCs owned by this workload
			for _, owner := range pvc.OwnerReferences {
				if owner.Kind == kind && owner.Name == name {
					isDataStore = true
					break
				}
			}
			if isDataStore {
				break
			}
		}
	}

	hasIngress := false
	for _, ing := range nr.Ingresses {
		for _, rule := range ing.Spec.Rules {
			if rule.HTTP == nil {
				continue
			}
			for _, path := range rule.HTTP.Paths {
				if path.Backend.Service != nil && path.Backend.Service.Name == name && kind == "Service" {
					hasIngress = true
					break
				}
			}
			if hasIngress {
				break
			}
		}
		if hasIngress {
			break
		}
	}
	// Also check if the service that fronts this deployment has an ingress
	if !hasIngress && (kind == "Deployment" || kind == "StatefulSet" || kind == "DaemonSet") {
		targetSvcs := findServicesForWorkload(nr, kind, name, namespace)
		for _, svcName := range targetSvcs {
			for _, ing := range nr.Ingresses {
				for _, rule := range ing.Spec.Rules {
					if rule.HTTP == nil {
						continue
					}
					for _, path := range rule.HTTP.Paths {
						if path.Backend.Service != nil && path.Backend.Service.Name == svcName {
							hasIngress = true
						}
					}
				}
			}
		}
	}

	replicaCount := getReplicaCount(nr, kind, name)
	isSPOF := replicaCount == 1

	score := computeCriticalityScore(fanIn, fanOut, isDataStore, hasIngress, isSPOF, blastRadiusPercent)
	level := criticalityLevel(score)

	// Collect dependency chain edges relevant to this resource
	relevantEdges := make([]models.BlastDependencyEdge, 0)
	allRelevant := make(map[string]bool)
	for k := range affected {
		allRelevant[k] = true
	}
	for k := range dependsOn {
		allRelevant[k] = true
	}
	allRelevant[targetKey] = true
	for _, edge := range graph.edges {
		sk := refKey(edge.Source)
		tk := refKey(edge.Target)
		if allRelevant[sk] && allRelevant[tk] {
			relevantEdges = append(relevantEdges, edge)
		}
	}

	return &models.BlastRadiusResult{
		TargetResource:     targetRef,
		CriticalityScore:   score,
		CriticalityLevel:   level,
		BlastRadiusPercent: math.Round(blastRadiusPercent*100) / 100,
		TotalAffected:      len(affectedRefs),
		FanIn:              fanIn,
		FanOut:             fanOut,
		IsSPOF:             isSPOF,
		IsIngressExposed:   hasIngress,
		ReplicaCount:       int(replicaCount),
		DependencyChain:    relevantEdges,
	}, nil
}

// bfsWalk does breadth-first traversal on the adjacency map from startKey,
// returning the set of all reachable keys (excluding the start).
func bfsWalk(adj map[string]map[string]bool, startKey string) map[string]bool {
	visited := map[string]bool{startKey: true}
	queue := []string{startKey}
	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]
		for neighbor := range adj[curr] {
			if !visited[neighbor] {
				visited[neighbor] = true
				queue = append(queue, neighbor)
			}
		}
	}
	return visited
}

// inferEnvVarDependencies discovers service references in pod environment
// variables. Kubernetes automatically injects {SVCNAME}_SERVICE_HOST and
// {SVCNAME}_SERVICE_PORT for each Service; user-defined env vars may also
// reference services by DNS name.
func inferEnvVarDependencies(graph *depGraph, nr *namespaceResources, namespace string, podOwner map[string]models.ResourceRef, svcByName map[string]*corev1.Service) {
	// Build a lookup: normalized service name -> actual service name
	svcLookup := make(map[string]string) // "MY_SVC" -> "my-svc"
	for svcName := range svcByName {
		normalized := strings.ToUpper(strings.ReplaceAll(svcName, "-", "_"))
		svcLookup[normalized] = svcName
	}

	for i := range nr.Pods {
		pod := &nr.Pods[i]
		owner, hasOwner := podOwner[pod.Name]
		if !hasOwner {
			continue
		}

		for _, container := range pod.Spec.Containers {
			for _, env := range container.Env {
				// Pattern 1: auto-injected {SVCNAME}_SERVICE_HOST or {SVCNAME}_SERVICE_PORT
				if strings.HasSuffix(env.Name, "_SERVICE_HOST") || strings.HasSuffix(env.Name, "_SERVICE_PORT") {
					prefix := env.Name
					prefix = strings.TrimSuffix(prefix, "_SERVICE_HOST")
					prefix = strings.TrimSuffix(prefix, "_SERVICE_PORT")
					if svcName, ok := svcLookup[prefix]; ok {
						svcRef := models.ResourceRef{Kind: "Service", Name: svcName, Namespace: namespace}
						graph.addEdge(owner, svcRef, "env_var")
					}
				}

				// Pattern 2: env value contains a service DNS name (svcname.namespace.svc)
				if env.Value != "" {
					for svcName := range svcByName {
						if strings.Contains(env.Value, svcName+"."+namespace) ||
							strings.Contains(env.Value, svcName+"."+namespace+".svc") {
							svcRef := models.ResourceRef{Kind: "Service", Name: svcName, Namespace: namespace}
							graph.addEdge(owner, svcRef, "env_var")
						}
					}
				}
			}
		}
	}
}

// inferVolumeMountDependencies finds ConfigMaps and Secrets shared across
// multiple deployments via volume mounts. Two workloads mounting the same
// ConfigMap or Secret are considered to share a dependency.
func inferVolumeMountDependencies(graph *depGraph, nr *namespaceResources, namespace string) {
	type volUser struct {
		kind, name string
	}

	// Map: configmap/secret name -> list of workloads that mount it
	cmUsers := make(map[string][]volUser)
	secretUsers := make(map[string][]volUser)

	processVolumes := func(volumes []corev1.Volume, workloadKind, workloadName string) {
		for _, vol := range volumes {
			if vol.ConfigMap != nil {
				cmUsers[vol.ConfigMap.Name] = append(cmUsers[vol.ConfigMap.Name], volUser{workloadKind, workloadName})
			}
			if vol.Secret != nil {
				secretUsers[vol.Secret.SecretName] = append(secretUsers[vol.Secret.SecretName], volUser{workloadKind, workloadName})
			}
			if vol.Projected != nil {
				for _, src := range vol.Projected.Sources {
					if src.ConfigMap != nil {
						cmUsers[src.ConfigMap.Name] = append(cmUsers[src.ConfigMap.Name], volUser{workloadKind, workloadName})
					}
					if src.Secret != nil {
						secretUsers[src.Secret.Name] = append(secretUsers[src.Secret.Name], volUser{workloadKind, workloadName})
					}
				}
			}
		}
	}

	for i := range nr.Deployments {
		d := &nr.Deployments[i]
		processVolumes(d.Spec.Template.Spec.Volumes, "Deployment", d.Name)
	}
	for i := range nr.StatefulSets {
		s := &nr.StatefulSets[i]
		processVolumes(s.Spec.Template.Spec.Volumes, "StatefulSet", s.Name)
	}
	for i := range nr.DaemonSets {
		ds := &nr.DaemonSets[i]
		processVolumes(ds.Spec.Template.Spec.Volumes, "DaemonSet", ds.Name)
	}

	// Create edges: workload -> ConfigMap (volume_mount dependency)
	for cmName, users := range cmUsers {
		cmRef := models.ResourceRef{Kind: "ConfigMap", Name: cmName, Namespace: namespace}
		for _, u := range users {
			wRef := models.ResourceRef{Kind: u.kind, Name: u.name, Namespace: namespace}
			graph.addEdge(wRef, cmRef, "volume_mount")
		}
	}
	for secName, users := range secretUsers {
		secRef := models.ResourceRef{Kind: "Secret", Name: secName, Namespace: namespace}
		for _, u := range users {
			wRef := models.ResourceRef{Kind: u.kind, Name: u.name, Namespace: namespace}
			graph.addEdge(wRef, secRef, "volume_mount")
		}
	}
}

// inferSelectorDependencies connects Services to the Deployments/StatefulSets/DaemonSets
// whose pods they select.
func inferSelectorDependencies(graph *depGraph, nr *namespaceResources, namespace string, podOwner map[string]models.ResourceRef) {
	for i := range nr.Services {
		svc := &nr.Services[i]
		if len(svc.Spec.Selector) == 0 {
			continue
		}
		svcRef := models.ResourceRef{Kind: "Service", Name: svc.Name, Namespace: namespace}
		sel := labels.SelectorFromSet(labels.Set(svc.Spec.Selector))

		// Find pods matching this service selector, then resolve to their owner
		ownersFound := make(map[string]bool)
		for j := range nr.Pods {
			pod := &nr.Pods[j]
			if sel.Matches(labels.Set(pod.Labels)) {
				if owner, ok := podOwner[pod.Name]; ok {
					ownerKey := refKey(owner)
					if !ownersFound[ownerKey] {
						ownersFound[ownerKey] = true
						// Service -> Workload (the service fronts this workload)
						graph.addEdge(svcRef, owner, "selector")
					}
				}
			}
		}
	}
}

// inferIngressDependencies connects Ingresses to backend Services.
func inferIngressDependencies(graph *depGraph, nr *namespaceResources, namespace string) {
	for i := range nr.Ingresses {
		ing := &nr.Ingresses[i]
		ingRef := models.ResourceRef{Kind: "Ingress", Name: ing.Name, Namespace: namespace}

		// Default backend
		if ing.Spec.DefaultBackend != nil && ing.Spec.DefaultBackend.Service != nil {
			svcRef := models.ResourceRef{Kind: "Service", Name: ing.Spec.DefaultBackend.Service.Name, Namespace: namespace}
			graph.addEdge(ingRef, svcRef, "ingress_route")
		}

		// Rule-based backends
		for _, rule := range ing.Spec.Rules {
			if rule.HTTP == nil {
				continue
			}
			for _, path := range rule.HTTP.Paths {
				if path.Backend.Service != nil {
					svcRef := models.ResourceRef{Kind: "Service", Name: path.Backend.Service.Name, Namespace: namespace}
					graph.addEdge(ingRef, svcRef, "ingress_route")
				}
			}
		}
	}
}

// inferNetworkPolicyDependencies parses NetworkPolicy ingress/egress rules to
// discover which workloads are allowed to communicate.
func inferNetworkPolicyDependencies(graph *depGraph, nr *namespaceResources, namespace string, podOwner map[string]models.ResourceRef) {
	for i := range nr.NetPolicies {
		np := &nr.NetPolicies[i]

		// Find pods targeted by this NetworkPolicy
		npSel, err := metav1.LabelSelectorAsSelector(&np.Spec.PodSelector)
		if err != nil {
			continue
		}
		targetPodOwners := make(map[string]models.ResourceRef)
		for j := range nr.Pods {
			pod := &nr.Pods[j]
			if npSel.Matches(labels.Set(pod.Labels)) {
				if owner, ok := podOwner[pod.Name]; ok {
					targetPodOwners[refKey(owner)] = owner
				}
			}
		}

		// Ingress rules: who can reach the target pods
		for _, ingRule := range np.Spec.Ingress {
			for _, from := range ingRule.From {
				if from.PodSelector == nil {
					continue
				}
				fromSel, err := metav1.LabelSelectorAsSelector(from.PodSelector)
				if err != nil {
					continue
				}
				for j := range nr.Pods {
					pod := &nr.Pods[j]
					if fromSel.Matches(labels.Set(pod.Labels)) {
						if fromOwner, ok := podOwner[pod.Name]; ok {
							for _, targetOwner := range targetPodOwners {
								graph.addEdge(fromOwner, targetOwner, "network_policy")
							}
						}
					}
				}
			}
		}

		// Egress rules: what the target pods can reach
		for _, egRule := range np.Spec.Egress {
			for _, to := range egRule.To {
				if to.PodSelector == nil {
					continue
				}
				toSel, err := metav1.LabelSelectorAsSelector(to.PodSelector)
				if err != nil {
					continue
				}
				for j := range nr.Pods {
					pod := &nr.Pods[j]
					if toSel.Matches(labels.Set(pod.Labels)) {
						if toOwner, ok := podOwner[pod.Name]; ok {
							for _, srcOwner := range targetPodOwners {
								graph.addEdge(srcOwner, toOwner, "network_policy")
							}
						}
					}
				}
			}
		}
	}
}

// findServicesForWorkload returns service names that select pods of the given workload.
func findServicesForWorkload(nr *namespaceResources, kind, name, namespace string) []string {
	// Find pods owned by this workload
	var podLabels []map[string]string
	switch kind {
	case "Deployment":
		for i := range nr.Deployments {
			if nr.Deployments[i].Name == name {
				podLabels = append(podLabels, nr.Deployments[i].Spec.Template.Labels)
			}
		}
	case "StatefulSet":
		for i := range nr.StatefulSets {
			if nr.StatefulSets[i].Name == name {
				podLabels = append(podLabels, nr.StatefulSets[i].Spec.Template.Labels)
			}
		}
	case "DaemonSet":
		for i := range nr.DaemonSets {
			if nr.DaemonSets[i].Name == name {
				podLabels = append(podLabels, nr.DaemonSets[i].Spec.Template.Labels)
			}
		}
	}

	var svcNames []string
	for _, lbls := range podLabels {
		for i := range nr.Services {
			svc := &nr.Services[i]
			if len(svc.Spec.Selector) == 0 {
				continue
			}
			sel := labels.SelectorFromSet(labels.Set(svc.Spec.Selector))
			if sel.Matches(labels.Set(lbls)) {
				svcNames = append(svcNames, svc.Name)
			}
		}
	}
	return svcNames
}

// getReplicaCount returns the desired replica count for a workload.
func getReplicaCount(nr *namespaceResources, kind, name string) int32 {
	switch kind {
	case "Deployment":
		for i := range nr.Deployments {
			if nr.Deployments[i].Name == name {
				if nr.Deployments[i].Spec.Replicas != nil {
					return *nr.Deployments[i].Spec.Replicas
				}
				return 1 // default
			}
		}
	case "StatefulSet":
		for i := range nr.StatefulSets {
			if nr.StatefulSets[i].Name == name {
				if nr.StatefulSets[i].Spec.Replicas != nil {
					return *nr.StatefulSets[i].Spec.Replicas
				}
				return 1
			}
		}
	case "DaemonSet":
		// DaemonSets run on all (or selected) nodes; never a single replica
		return 99
	case "Service":
		// Services themselves are not replicated; check backing workload
		return 0
	}
	return 0
}

// computeCriticalityScore implements the scoring formula:
//   - fan_in * 25 (capped at 25)
//   - fan_out * 10 (capped at 10)
//   - is_data_store * 20
//   - has_ingress * 15
//   - single_replica * 15
//   - blast_radius_percent * 0.15 (max 15)
//
// Total capped at 100.
func computeCriticalityScore(fanIn, fanOut int, isDataStore, hasIngress, isSPOF bool, blastRadiusPercent float64) float64 {
	score := 0.0

	// Fan-in: each dependent adds points, capped at 25
	fanInScore := float64(fanIn) * 5.0
	if fanInScore > 25 {
		fanInScore = 25
	}
	score += fanInScore

	// Fan-out: each dependency adds points, capped at 10
	fanOutScore := float64(fanOut) * 2.5
	if fanOutScore > 10 {
		fanOutScore = 10
	}
	score += fanOutScore

	if isDataStore {
		score += 20
	}
	if hasIngress {
		score += 15
	}
	if isSPOF {
		score += 15
	}

	// Blast radius contribution: up to 15 points
	brScore := blastRadiusPercent * 0.15
	if brScore > 15 {
		brScore = 15
	}
	score += brScore

	if score > 100 {
		score = 100
	}

	return math.Round(score*100) / 100
}

// criticalityLevel maps a numeric score to a human-readable level.
func criticalityLevel(score float64) string {
	switch {
	case score >= 75:
		return "critical"
	case score >= 50:
		return "high"
	case score >= 25:
		return "medium"
	default:
		return "low"
	}
}
