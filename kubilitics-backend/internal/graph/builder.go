package graph

import (
	"fmt"
	"math"
	"time"

	"github.com/kubilitics/kubilitics-backend/internal/models"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
)

// ClusterResources holds all fetched resources from informer caches.
type ClusterResources struct {
	Pods             []corev1.Pod
	Deployments      []appsv1.Deployment
	ReplicaSets      []appsv1.ReplicaSet
	StatefulSets     []appsv1.StatefulSet
	DaemonSets       []appsv1.DaemonSet
	Jobs             []batchv1.Job
	CronJobs         []batchv1.CronJob
	Services         []corev1.Service
	ConfigMaps       []corev1.ConfigMap
	Secrets          []corev1.Secret
	ServiceAccounts  []corev1.ServiceAccount
	Ingresses        []networkingv1.Ingress
	NetworkPolicies  []networkingv1.NetworkPolicy
	PVCs             []corev1.PersistentVolumeClaim
	HPAs             []autoscalingv1.HorizontalPodAutoscaler
	PDBs             []policyv1.PodDisruptionBudget
	Endpoints        []corev1.Endpoints
}

// BuildSnapshot constructs a complete GraphSnapshot from cluster resources.
// It runs all inference functions, registers every resource as a node,
// computes PageRank and criticality scores, and returns the immutable snapshot.
func BuildSnapshot(res *ClusterResources, hasIstio bool, virtualServices, destinationRules []map[string]interface{}) *GraphSnapshot {
	if res == nil {
		res = &ClusterResources{}
	}
	start := time.Now()

	nodes := make(map[string]models.ResourceRef)
	forward := make(map[string]map[string]bool)
	reverse := make(map[string]map[string]bool)
	var edges []models.BlastDependencyEdge

	// --- Step 1: Run all inference functions to build edges ---

	// Owner references: Pod -> Deployment/StatefulSet/DaemonSet/Job
	podOwners := inferOwnerRefDeps(nodes, forward, reverse, &edges,
		res.Pods, res.Deployments, res.StatefulSets, res.DaemonSets)

	// Service selector -> Pod/owner
	inferSelectorDeps(nodes, forward, reverse, &edges,
		res.Services, res.Pods, podOwners)

	// Ingress -> Service
	inferIngressDeps(nodes, forward, reverse, &edges, res.Ingresses)

	// Build PodOwners: pod key → ultimate workload owner key
	// Resolves RS → Deployment chain via the reverse adjacency
	podOwnersMap := make(map[string]string)
	for podKey, ownerRef := range podOwners {
		ownerKey := refKey(ownerRef)
		// If owner is a ReplicaSet, check if it's owned by a Deployment
		if ownerRef.Kind == "ReplicaSet" {
			for grandOwnerKey := range reverse[ownerKey] {
				grandOwner := nodes[grandOwnerKey]
				if grandOwner.Kind == "Deployment" {
					podOwnersMap[podKey] = grandOwnerKey
					break
				}
			}
			if _, resolved := podOwnersMap[podKey]; !resolved {
				podOwnersMap[podKey] = ownerKey // RS with no Deployment parent
			}
		} else {
			podOwnersMap[podKey] = ownerKey
		}
	}

	// --- Step 2: Register ALL resources as first-class nodes (even without edges) ---

	namespaces := make(map[string]bool)

	registerNode := func(kind, namespace, name string) {
		ref := models.ResourceRef{Kind: kind, Namespace: namespace, Name: name}
		nodes[refKey(ref)] = ref
		if namespace != "" {
			namespaces[namespace] = true
		}
	}

	for _, p := range res.Pods {
		registerNode("Pod", p.Namespace, p.Name)
	}

	// Build PodNodes: podKey -> nodeName (from pod.Spec.NodeName)
	podNodes := make(map[string]string)
	for _, p := range res.Pods {
		if p.Spec.NodeName != "" {
			podKey := fmt.Sprintf("Pod/%s/%s", p.Namespace, p.Name)
			podNodes[podKey] = p.Spec.NodeName
		}
	}
	for _, d := range res.Deployments {
		registerNode("Deployment", d.Namespace, d.Name)
	}
	for _, ss := range res.StatefulSets {
		registerNode("StatefulSet", ss.Namespace, ss.Name)
	}
	for _, ds := range res.DaemonSets {
		registerNode("DaemonSet", ds.Namespace, ds.Name)
	}
	for _, j := range res.Jobs {
		registerNode("Job", j.Namespace, j.Name)
	}
	for _, cj := range res.CronJobs {
		registerNode("CronJob", cj.Namespace, cj.Name)
	}
	for _, svc := range res.Services {
		registerNode("Service", svc.Namespace, svc.Name)
	}
	for _, cm := range res.ConfigMaps {
		registerNode("ConfigMap", cm.Namespace, cm.Name)
	}
	for _, s := range res.Secrets {
		registerNode("Secret", s.Namespace, s.Name)
	}
	for _, sa := range res.ServiceAccounts {
		registerNode("ServiceAccount", sa.Namespace, sa.Name)
	}
	for _, ing := range res.Ingresses {
		registerNode("Ingress", ing.Namespace, ing.Name)
	}
	for _, np := range res.NetworkPolicies {
		registerNode("NetworkPolicy", np.Namespace, np.Name)
	}
	for _, pvc := range res.PVCs {
		registerNode("PersistentVolumeClaim", pvc.Namespace, pvc.Name)
	}

	// Also collect namespaces from nodes registered by inference
	for _, ref := range nodes {
		if ref.Namespace != "" {
			namespaces[ref.Namespace] = true
		}
	}

	// --- Step 3: Compute PageRank ---

	pageRanks := simplePageRank(nodes, forward, reverse)

	// --- Step 4: Build HPA targets, PDB targets, ingress host map ---

	hpaTargets := buildHPATargets(res.HPAs)
	pdbTargets := buildPDBTargets(res.PDBs, res.Pods, podOwners)
	ingressHostMap := buildIngressHostMap(res.Ingresses)

	// --- Step 5: For each node, compute criticality and risks ---

	nodeScores := make(map[string]float64, len(nodes))
	nodeRisks := make(map[string][]models.RiskIndicator, len(nodes))
	nodeReplicas := make(map[string]int, len(nodes))
	nodeHasHPA := make(map[string]bool, len(nodes))
	nodeHasPDB := make(map[string]bool, len(nodes))
	nodeIngress := make(map[string][]string, len(nodes))

	for key, ref := range nodes {
		fanIn := len(reverse[key])
		hasHPA := hpaTargets[key]
		hasPDB := pdbTargets[key]
		ingressHosts := ingressHostMap[key]
		replicas := getReplicaCountFromResources(res, ref.Kind, ref.Name, ref.Namespace)

		// Determine if data store: StatefulSets or workloads with PVCs
		isDataStore := ref.Kind == "StatefulSet"
		if !isDataStore {
			for _, pvc := range res.PVCs {
				if pvc.Namespace != ref.Namespace {
					continue
				}
				for _, owner := range pvc.OwnerReferences {
					if owner.Kind == ref.Kind && owner.Name == ref.Name {
						isDataStore = true
						break
					}
				}
				if isDataStore {
					break
				}
			}
		}

		// Count cross-namespace dependents via BFS on reverse adjacency
		affected := bfsWalk(reverse, key)
		nsSet := make(map[string]bool)
		for aKey := range affected {
			if aRef, ok := nodes[aKey]; ok {
				nsSet[aRef.Namespace] = true
			}
		}
		crossNsCount := len(nsSet)

		isIngressExposed := len(ingressHosts) > 0

		// Structural importance: PageRank (max 30) + fan-in (max 20).
		// Full composite scoring now happens at query time in scoring_v2.go.
		score := math.Min(pageRanks[key]*30.0, 30.0) + math.Min(float64(fanIn)*3.0, 20.0)

		risks := detectRisks(key, replicas, fanIn, hasHPA, hasPDB, isIngressExposed, ingressHosts, isDataStore, crossNsCount)

		nodeScores[key] = score
		nodeRisks[key] = risks
		nodeReplicas[key] = replicas
		nodeHasHPA[key] = hasHPA
		nodeHasPDB[key] = hasPDB
		if len(ingressHosts) > 0 {
			nodeIngress[key] = ingressHosts
		}
	}

	// --- Step 5b: Build Service -> ready endpoints map ---
	serviceEndpoints := make(map[string][]corev1.EndpointAddress)
	for _, ep := range res.Endpoints {
		svcKey := fmt.Sprintf("Service/%s/%s", ep.Namespace, ep.Name)
		for _, subset := range ep.Subsets {
			serviceEndpoints[svcKey] = append(serviceEndpoints[svcKey], subset.Addresses...)
		}
	}

	// --- Step 5c: Build Service -> representative pod labels map ---
	servicePodLabels := make(map[string]map[string]string)
	for _, ep := range res.Endpoints {
		svcKey := fmt.Sprintf("Service/%s/%s", ep.Namespace, ep.Name)
		for _, subset := range ep.Subsets {
			for _, addr := range subset.Addresses {
				if addr.TargetRef != nil && addr.TargetRef.Kind == "Pod" {
					for _, pod := range res.Pods {
						if pod.Name == addr.TargetRef.Name && pod.Namespace == addr.TargetRef.Namespace {
							servicePodLabels[svcKey] = pod.Labels
							break
						}
					}
					if servicePodLabels[svcKey] != nil {
						break
					}
				}
			}
			if servicePodLabels[svcKey] != nil {
				break
			}
		}
	}

	// --- Step 6: Count total workloads ---

	totalWorkloads := len(res.Deployments) + len(res.StatefulSets) + len(res.DaemonSets) +
		len(res.Services) + len(res.Jobs) + len(res.CronJobs)

	// --- Step 7: Build and return GraphSnapshot ---

	return &GraphSnapshot{
		Nodes:   nodes,
		Forward: forward,
		Reverse: reverse,
		Edges:   edges,

		NodeScores:   nodeScores,
		NodeRisks:    nodeRisks,
		NodeReplicas: nodeReplicas,
		NodeHasHPA:   nodeHasHPA,
		NodeHasPDB:   nodeHasPDB,
		NodeIngress:  nodeIngress,

		PodNodes:         podNodes,
		PodOwners:        podOwnersMap,
		ServiceEndpoints: serviceEndpoints,
		ServicePodLabels: servicePodLabels,
		PDBs:             res.PDBs,

		TotalWorkloads: totalWorkloads,
		BuiltAt:        time.Now().UnixMilli(),
		BuildDuration:  time.Since(start),
		Namespaces:     namespaces,
	}
}

// getReplicaCountFromResources returns the desired replica count for a workload
// by inspecting the ClusterResources. Returns 0 for non-workload kinds.
func getReplicaCountFromResources(res *ClusterResources, kind, name, namespace string) int {
	switch kind {
	case "Deployment":
		for _, d := range res.Deployments {
			if d.Name == name && d.Namespace == namespace {
				if d.Spec.Replicas != nil {
					return int(*d.Spec.Replicas)
				}
				return 1 // default
			}
		}
	case "StatefulSet":
		for _, ss := range res.StatefulSets {
			if ss.Name == name && ss.Namespace == namespace {
				if ss.Spec.Replicas != nil {
					return int(*ss.Spec.Replicas)
				}
				return 1
			}
		}
	case "DaemonSet":
		for _, ds := range res.DaemonSets {
			if ds.Name == name && ds.Namespace == namespace {
				return int(ds.Status.DesiredNumberScheduled)
			}
		}
	case "ReplicaSet":
		for _, rs := range res.ReplicaSets {
			if rs.Name == name && rs.Namespace == namespace {
				if rs.Spec.Replicas != nil {
					return int(*rs.Spec.Replicas)
				}
				return 1
			}
		}
	}
	return 0
}

