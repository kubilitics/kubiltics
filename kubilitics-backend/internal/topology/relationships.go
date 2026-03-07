package topology

import (
	"context"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// RelationshipInferencer handles all relationship inference logic
type RelationshipInferencer struct {
	engine *Engine
	graph  *Graph
}

// NewRelationshipInferencer creates a new relationship inferencer
func NewRelationshipInferencer(engine *Engine, graph *Graph) *RelationshipInferencer {
	return &RelationshipInferencer{
		engine: engine,
		graph:  graph,
	}
}

// InferAllRelationships discovers all relationships between resources
func (ri *RelationshipInferencer) InferAllRelationships(ctx context.Context) error {
	// 0. Namespace containment (Namespace -> all namespaced resources)
	// Guarantees the graph is always connected through namespace roots.
	if err := ri.inferNamespaceContainment(); err != nil {
		return fmt.Errorf("failed to infer namespace containment: %w", err)
	}

	// 1. Owner reference relationships (Deployment -> ReplicaSet -> Pod, etc.)
	if err := ri.inferOwnerReferences(); err != nil {
		return fmt.Errorf("failed to infer owner references: %w", err)
	}

	// 2. Label selector relationships (Service -> Pods, NetworkPolicy -> Pods)
	if err := ri.inferLabelSelectors(); err != nil {
		return fmt.Errorf("failed to infer label selectors: %w", err)
	}

	// 3. Volume relationships (Pod -> ConfigMap/Secret/PVC)
	if err := ri.inferVolumeRelationships(ctx); err != nil {
		return fmt.Errorf("failed to infer volume relationships: %w", err)
	}

	// 4. Environment variable relationships (Pod -> ConfigMap/Secret)
	if err := ri.inferEnvironmentRelationships(ctx); err != nil {
		return fmt.Errorf("failed to infer environment relationships: %w", err)
	}

	// 5. RBAC relationships (ServiceAccount -> Role/ClusterRole)
	if err := ri.inferRBACRelationships(); err != nil {
		return fmt.Errorf("failed to infer RBAC relationships: %w", err)
	}

	// 6. Network relationships (Ingress -> Service -> Endpoints -> Pods)
	if err := ri.inferNetworkRelationships(); err != nil {
		return fmt.Errorf("failed to infer network relationships: %w", err)
	}

	// 7. Storage relationships (PVC -> PV -> StorageClass)
	if err := ri.inferStorageRelationships(ctx); err != nil {
		return fmt.Errorf("failed to infer storage relationships: %w", err)
	}

	// 8. Node relationships (Pod -> Node)
	if err := ri.inferNodeRelationships(ctx); err != nil {
		return fmt.Errorf("failed to infer node relationships: %w", err)
	}

	// 9. Autoscaling relationships (HPA -> Deployment/ReplicaSet/StatefulSet)
	if err := ri.inferAutoscalingRelationships(); err != nil {
		return fmt.Errorf("failed to infer autoscaling relationships: %w", err)
	}

	// 10. Job/CronJob relationships
	if err := ri.inferJobRelationships(); err != nil {
		return fmt.Errorf("failed to infer job relationships: %w", err)
	}

	return nil
}

// inferNamespaceContainment creates Namespace -> Resource "contains" edges for all
// namespaced resources. This guarantees the graph is always connected through namespace roots.
func (ri *RelationshipInferencer) inferNamespaceContainment() error {
	namespaces := ri.graph.GetNodesByType("Namespace")
	if len(namespaces) == 0 {
		return nil
	}

	// Build namespace name -> node ID map for O(1) lookup
	nsMap := make(map[string]string, len(namespaces))
	for _, ns := range namespaces {
		nsMap[ns.Name] = ns.ID
	}

	// Cluster-scoped kinds that should NOT get namespace containment edges
	clusterScoped := map[string]bool{
		"Namespace":          true,
		"Node":               true,
		"PersistentVolume":   true,
		"StorageClass":       true,
		"ClusterRole":        true,
		"ClusterRoleBinding": true,
		"IngressClass":       true,
		"PriorityClass":      true,
		"CSIDriver":          true,
		"CSINode":            true,
		"RuntimeClass":       true,
	}

	for _, node := range ri.graph.Nodes {
		if clusterScoped[node.Kind] || node.Namespace == "" {
			continue
		}
		nsID, ok := nsMap[node.Namespace]
		if !ok {
			continue
		}
		ri.graph.AddEdge(models.TopologyEdge{
			ID:               fmt.Sprintf("%s-%s-contains", nsID, node.ID),
			Source:           nsID,
			Target:           node.ID,
			RelationshipType: "contains",
			Label:            "contains",
			Metadata:         models.EdgeMetadata{Derivation: "namespaceMembership", Confidence: 1, SourceField: "metadata.namespace"},
		})
	}
	return nil
}

// inferOwnerReferences infers relationships based on OwnerReferences (from graph.SetOwnerRefs).
func (ri *RelationshipInferencer) inferOwnerReferences() error {
	for _, node := range ri.graph.Nodes {
		refs := ri.graph.GetOwnerRefs(node.ID)
		for _, ref := range refs {
			ownerNode := ri.graph.GetNodeByUID(ref.UID)
			if ownerNode != nil {
				edge := models.TopologyEdge{
					ID:               fmt.Sprintf("%s-%s-owner", ownerNode.ID, node.ID),
					Source:           ownerNode.ID,
					Target:           node.ID,
					RelationshipType: "owns",
					Label:            "owns",
					Metadata:         models.EdgeMetadata{Derivation: "ownerReference", Confidence: 1, SourceField: "metadata.ownerReferences"},
				}
				ri.graph.AddEdge(edge)
			}
		}
	}
	return nil
}

// inferLabelSelectors infers relationships based on label selectors.
// Uses the inverted label index for O(k) intersection per selector (k = selector key count)
// instead of O(Services × Pods) brute-force matching.
func (ri *RelationshipInferencer) inferLabelSelectors() error {
	services := ri.graph.GetNodesByType("Service")

	for _, service := range services {
		// Use spec.selector stored in nodeExtra (not metadata.labels).
		extra := ri.graph.GetNodeExtra(service.ID)
		if extra == nil {
			continue
		}
		selectorRaw, ok := extra["selector"].(map[string]interface{})
		if !ok || len(selectorRaw) == 0 {
			continue
		}
		svcSelector := make(map[string]string, len(selectorRaw))
		for k, v := range selectorRaw {
			if vs, ok := v.(string); ok {
				svcSelector[k] = vs
			}
		}
		if len(svcSelector) == 0 {
			continue
		}
		// O(k) intersection via inverted label index instead of O(pods) linear scan.
		matchedPods := ri.graph.GetNodesBySelector(service.Namespace, svcSelector)
		for _, pod := range matchedPods {
			if pod.Kind != "Pod" {
				continue
			}
			edge := models.TopologyEdge{
				ID:               fmt.Sprintf("%s-%s-selector", service.ID, pod.ID),
				Source:           service.ID,
				Target:           pod.ID,
				RelationshipType: "selects",
				Label:            "selects",
				Metadata:         models.EdgeMetadata{Derivation: "labelSelector", Confidence: 1, SourceField: "spec.selector"},
			}
			ri.graph.AddEdge(edge)
		}
	}

	networkPolicies := ri.graph.GetNodesByType("NetworkPolicy")
	for _, np := range networkPolicies {
		// Use spec.podSelector.matchLabels stored in nodeExtra (not metadata.labels).
		extra := ri.graph.GetNodeExtra(np.ID)
		if extra == nil {
			continue
		}
		podSelectorRaw, ok := extra["podSelector"].(map[string]interface{})
		if !ok || len(podSelectorRaw) == 0 {
			continue
		}
		npSelector := make(map[string]string, len(podSelectorRaw))
		for k, v := range podSelectorRaw {
			if vs, ok := v.(string); ok {
				npSelector[k] = vs
			}
		}
		if len(npSelector) == 0 {
			continue
		}
		// O(k) intersection via inverted label index instead of O(pods) linear scan.
		matchedPods := ri.graph.GetNodesBySelector(np.Namespace, npSelector)
		for _, pod := range matchedPods {
			if pod.Kind != "Pod" {
				continue
			}
			edge := models.TopologyEdge{
				ID:               fmt.Sprintf("%s-%s-netpol", np.ID, pod.ID),
				Source:           np.ID,
				Target:           pod.ID,
				RelationshipType: "selects",
				Label:            "applies to",
				Metadata:         models.EdgeMetadata{Derivation: "labelSelector", Confidence: 1, SourceField: "spec.podSelector"},
			}
			ri.graph.AddEdge(edge)
		}
	}

	// PDB -> Pods: use spec.selector.matchLabels stored in nodeExtra.
	pdbs := ri.graph.GetNodesByType("PodDisruptionBudget")
	for _, pdb := range pdbs {
		extra := ri.graph.GetNodeExtra(pdb.ID)
		if extra == nil {
			continue
		}
		podSelectorRaw, ok := extra["podSelector"].(map[string]interface{})
		if !ok || len(podSelectorRaw) == 0 {
			continue
		}
		pdbSelector := make(map[string]string, len(podSelectorRaw))
		for k, v := range podSelectorRaw {
			if vs, ok := v.(string); ok {
				pdbSelector[k] = vs
			}
		}
		if len(pdbSelector) == 0 {
			continue
		}
		matchedPods := ri.graph.GetNodesBySelector(pdb.Namespace, pdbSelector)
		for _, pod := range matchedPods {
			if pod.Kind != "Pod" {
				continue
			}
			ri.graph.AddEdge(models.TopologyEdge{
				ID:               fmt.Sprintf("%s-%s-pdb", pdb.ID, pod.ID),
				Source:           pdb.ID,
				Target:           pod.ID,
				RelationshipType: "selects",
				Label:            "protects",
				Metadata:         models.EdgeMetadata{Derivation: "labelSelector", Confidence: 1, SourceField: "spec.selector"},
			})
		}
	}

	// HPA -> Deployments/StatefulSets/ReplicaSets: use O(1) name index.
	hpas := ri.graph.GetNodesByType("HorizontalPodAutoscaler")
	for _, hpa := range hpas {
		extra := ri.graph.GetNodeExtra(hpa.ID)
		if extra == nil {
			continue
		}
		scaleTargetRef, ok := extra["scaleTargetRef"].(map[string]interface{})
		if !ok {
			continue
		}
		targetKind, _ := scaleTargetRef["kind"].(string)
		targetName, _ := scaleTargetRef["name"].(string)
		// O(1) lookup via name index instead of scanning all nodes of targetKind.
		target := ri.graph.GetNodeByName(hpa.Namespace, targetKind, targetName)
		if target != nil {
			edge := models.TopologyEdge{
				ID:               fmt.Sprintf("%s-%s-hpa", hpa.ID, target.ID),
				Source:           hpa.ID,
				Target:           target.ID,
				RelationshipType: "manages",
				Label:            "scales",
				Metadata:         models.EdgeMetadata{Derivation: "fieldReference", Confidence: 1, SourceField: "spec.scaleTargetRef"},
			}
			ri.graph.AddEdge(edge)
		}
	}

	return nil
}

// inferVolumeRelationships infers relationships from pod volumes.
// Uses O(1) name index lookups instead of O(n) linear scans for each reference target.
func (ri *RelationshipInferencer) inferVolumeRelationships(ctx context.Context) error {
	pods := ri.graph.GetNodesByType("Pod")

	for _, pod := range pods {
		// Use cached pod spec from discovery phase instead of re-fetching from API server.
		spec, ok := ri.graph.PodSpecCache[pod.Namespace+"/"+pod.Name]
		if !ok {
			continue
		}

		for _, volume := range spec.Volumes {
			if volume.ConfigMap != nil {
				// O(1) name index lookup instead of scanning all ConfigMaps
				cm := ri.graph.GetNodeByName(pod.Namespace, "ConfigMap", volume.ConfigMap.Name)
				if cm != nil {
					ri.graph.AddEdge(models.TopologyEdge{
						ID:               fmt.Sprintf("%s-%s-vol-cm", pod.ID, cm.ID),
						Source:           pod.ID,
						Target:           cm.ID,
						RelationshipType: "configures",
						Label:            fmt.Sprintf("mounts (%s)", volume.Name),
						Metadata:         models.EdgeMetadata{Derivation: "volumeMount", Confidence: 1, SourceField: "spec.volumes"},
					})
				}
			}
			if volume.Secret != nil {
				secret := ri.graph.GetNodeByName(pod.Namespace, "Secret", volume.Secret.SecretName)
				if secret != nil {
					ri.graph.AddEdge(models.TopologyEdge{
						ID:               fmt.Sprintf("%s-%s-vol-secret", pod.ID, secret.ID),
						Source:           pod.ID,
						Target:           secret.ID,
						RelationshipType: "configures",
						Label:            fmt.Sprintf("mounts (%s)", volume.Name),
						Metadata:         models.EdgeMetadata{Derivation: "volumeMount", Confidence: 1, SourceField: "spec.volumes"},
					})
				}
			}
			if volume.PersistentVolumeClaim != nil {
				pvc := ri.graph.GetNodeByName(pod.Namespace, "PersistentVolumeClaim", volume.PersistentVolumeClaim.ClaimName)
				if pvc != nil {
					ri.graph.AddEdge(models.TopologyEdge{
						ID:               fmt.Sprintf("%s-%s-vol-pvc", pod.ID, pvc.ID),
						Source:           pod.ID,
						Target:           pvc.ID,
						RelationshipType: "mounts",
						Label:            fmt.Sprintf("claims (%s)", volume.Name),
						Metadata:         models.EdgeMetadata{Derivation: "volumeMount", Confidence: 1, SourceField: "spec.volumes"},
					})
				}
			}
		}
	}

	return nil
}

// inferEnvironmentRelationships infers relationships from environment variables.
// Uses O(1) name index lookups instead of O(n) scans for ConfigMap/Secret references.
func (ri *RelationshipInferencer) inferEnvironmentRelationships(ctx context.Context) error {
	pods := ri.graph.GetNodesByType("Pod")

	for _, pod := range pods {
		// Use cached pod spec from discovery phase instead of re-fetching from API server.
		spec, ok := ri.graph.PodSpecCache[pod.Namespace+"/"+pod.Name]
		if !ok {
			continue
		}

		for _, container := range spec.Containers {
			// Check envFrom
			for _, envFrom := range container.EnvFrom {
				if envFrom.ConfigMapRef != nil {
					cm := ri.graph.GetNodeByName(pod.Namespace, "ConfigMap", envFrom.ConfigMapRef.Name)
					if cm != nil {
						ri.graph.AddEdge(models.TopologyEdge{
							ID:               fmt.Sprintf("%s-%s-env-cm", pod.ID, cm.ID),
							Source:           pod.ID,
							Target:           cm.ID,
							RelationshipType: "configures",
							Label:            "reads env from",
							Metadata:         models.EdgeMetadata{Derivation: "envReference", Confidence: 1, SourceField: "spec.containers[].envFrom"},
						})
					}
				}
				if envFrom.SecretRef != nil {
					secret := ri.graph.GetNodeByName(pod.Namespace, "Secret", envFrom.SecretRef.Name)
					if secret != nil {
						ri.graph.AddEdge(models.TopologyEdge{
							ID:               fmt.Sprintf("%s-%s-env-secret", pod.ID, secret.ID),
							Source:           pod.ID,
							Target:           secret.ID,
							RelationshipType: "configures",
							Label:            "reads env from",
							Metadata:         models.EdgeMetadata{Derivation: "envReference", Confidence: 1, SourceField: "spec.containers[].envFrom"},
						})
					}
				}
			}
			for _, env := range container.Env {
				if env.ValueFrom != nil {
					if env.ValueFrom.ConfigMapKeyRef != nil {
						cm := ri.graph.GetNodeByName(pod.Namespace, "ConfigMap", env.ValueFrom.ConfigMapKeyRef.Name)
						if cm != nil {
							ri.graph.AddEdge(models.TopologyEdge{
								ID:               fmt.Sprintf("%s-%s-env-cm-%s", pod.ID, cm.ID, env.Name),
								Source:           pod.ID,
								Target:           cm.ID,
								RelationshipType: "configures",
								Label:            fmt.Sprintf("reads %s", env.Name),
								Metadata:         models.EdgeMetadata{Derivation: "envReference", Confidence: 1, SourceField: "spec.containers[].env"},
							})
						}
					}
					if env.ValueFrom.SecretKeyRef != nil {
						secret := ri.graph.GetNodeByName(pod.Namespace, "Secret", env.ValueFrom.SecretKeyRef.Name)
						if secret != nil {
							ri.graph.AddEdge(models.TopologyEdge{
								ID:               fmt.Sprintf("%s-%s-env-secret-%s", pod.ID, secret.ID, env.Name),
								Source:           pod.ID,
								Target:           secret.ID,
								RelationshipType: "configures",
								Label:            fmt.Sprintf("reads %s", env.Name),
								Metadata:         models.EdgeMetadata{Derivation: "envReference", Confidence: 1, SourceField: "spec.containers[].env"},
							})
						}
					}
				}
			}
		}
	}

	return nil
}

// inferRBACRelationships infers RBAC relationships.
// Uses O(1) name index lookups for ServiceAccount, Role, and ClusterRole resolution.
func (ri *RelationshipInferencer) inferRBACRelationships() error {
	pods := ri.graph.GetNodesByType("Pod")
	// Pod -> ServiceAccount: from spec.serviceAccountName (stored in node extra by engine)
	for _, pod := range pods {
		extra := ri.graph.GetNodeExtra(pod.ID)
		if extra == nil {
			continue
		}
		saName, _ := extra["serviceAccountName"].(string)
		if saName == "" {
			saName = "default"
		}
		// O(1) name index lookup instead of scanning all ServiceAccounts
		sa := ri.graph.GetNodeByName(pod.Namespace, "ServiceAccount", saName)
		if sa != nil {
			ri.graph.AddEdge(models.TopologyEdge{
				ID:               fmt.Sprintf("%s-%s-uses-sa", pod.ID, sa.ID),
				Source:           pod.ID,
				Target:           sa.ID,
				RelationshipType: "uses",
				Label:            "runs as",
				Metadata:         models.EdgeMetadata{Derivation: "fieldReference", Confidence: 1, SourceField: "spec.serviceAccountName"},
			})
		}
	}

	roleBindings := ri.graph.GetNodesByType("RoleBinding")
	for _, rb := range roleBindings {
		extra := ri.graph.GetNodeExtra(rb.ID)
		if extra == nil {
			continue
		}
		if roleRef, ok := extra["roleRef"].(map[string]interface{}); ok {
			roleName, _ := roleRef["name"].(string)
			roleKind, _ := roleRef["kind"].(string)
			if roleKind == "" {
				roleKind = "Role"
			}
			// O(1) lookup for Role or ClusterRole
			role := ri.graph.GetNodeByName(rb.Namespace, roleKind, roleName)
			if roleKind == "ClusterRole" {
				role = ri.graph.GetNodeByName("", "ClusterRole", roleName)
			}
			if role != nil {
				ri.graph.AddEdge(models.TopologyEdge{
					ID:               fmt.Sprintf("%s-%s-role", rb.ID, role.ID),
					Source:           rb.ID,
					Target:           role.ID,
					RelationshipType: "permits",
					Label:            "grants",
					Metadata:         models.EdgeMetadata{Derivation: "rbacBinding", Confidence: 1, SourceField: "roleRef"},
				})
			}
		}
		if subjects, ok := extra["subjects"].([]interface{}); ok {
			for _, subj := range subjects {
				subject, _ := subj.(map[string]interface{})
				kind, _ := subject["kind"].(string)
				name, _ := subject["name"].(string)
				namespace, _ := subject["namespace"].(string)
				if kind == "ServiceAccount" {
					sa := ri.graph.GetNodeByName(namespace, "ServiceAccount", name)
					if sa != nil {
						ri.graph.AddEdge(models.TopologyEdge{
							ID:               fmt.Sprintf("%s-%s-subject", rb.ID, sa.ID),
							Source:           rb.ID,
							Target:           sa.ID,
							RelationshipType: "permits",
							Label:            "binds to",
							Metadata:         models.EdgeMetadata{Derivation: "rbacBinding", Confidence: 1, SourceField: "subjects"},
						})
					}
				}
			}
		}
	}

	clusterRoleBindings := ri.graph.GetNodesByType("ClusterRoleBinding")
	for _, crb := range clusterRoleBindings {
		extra := ri.graph.GetNodeExtra(crb.ID)
		if extra == nil {
			continue
		}
		if roleRef, ok := extra["roleRef"].(map[string]interface{}); ok {
			roleName, _ := roleRef["name"].(string)
			// ClusterRoleBindings always reference ClusterRoles (namespace="")
			role := ri.graph.GetNodeByName("", "ClusterRole", roleName)
			if role != nil {
				ri.graph.AddEdge(models.TopologyEdge{
					ID:               fmt.Sprintf("%s-%s-crole", crb.ID, role.ID),
					Source:           crb.ID,
					Target:           role.ID,
					RelationshipType: "permits",
					Label:            "grants",
					Metadata:         models.EdgeMetadata{Derivation: "rbacBinding", Confidence: 1, SourceField: "roleRef"},
				})
			}
		}
		if subjects, ok := extra["subjects"].([]interface{}); ok {
			for _, subj := range subjects {
				subject, _ := subj.(map[string]interface{})
				kind, _ := subject["kind"].(string)
				name, _ := subject["name"].(string)
				namespace, _ := subject["namespace"].(string)
				if kind == "ServiceAccount" {
					sa := ri.graph.GetNodeByName(namespace, "ServiceAccount", name)
					if sa != nil {
						ri.graph.AddEdge(models.TopologyEdge{
							ID:               fmt.Sprintf("%s-%s-csubject", crb.ID, sa.ID),
							Source:           crb.ID,
							Target:           sa.ID,
							RelationshipType: "permits",
							Label:            "binds to",
							Metadata:         models.EdgeMetadata{Derivation: "rbacBinding", Confidence: 1, SourceField: "subjects"},
						})
					}
				}
			}
		}
	}
	return nil
}

// inferNetworkRelationships infers network-related relationships.
// Uses O(1) name index lookups for Ingress→Service and Service→Endpoints resolution.
func (ri *RelationshipInferencer) inferNetworkRelationships() error {
	// Ingress -> Service
	ingresses := ri.graph.GetNodesByType("Ingress")

	for _, ingress := range ingresses {
		extra := ri.graph.GetNodeExtra(ingress.ID)
		if extra == nil {
			continue
		}
		spec, ok := extra["spec"].(map[string]interface{})
		if !ok {
			continue
		}
		rules, ok := spec["rules"].([]interface{})
		if !ok {
			continue
		}

		for _, rule := range rules {
			ruleMap, ok := rule.(map[string]interface{})
			if !ok {
				continue
			}

			http, ok := ruleMap["http"].(map[string]interface{})
			if !ok {
				continue
			}

			paths, ok := http["paths"].([]interface{})
			if !ok {
				continue
			}

			for _, path := range paths {
				pathMap, ok := path.(map[string]interface{})
				if !ok {
					continue
				}

				backend, ok := pathMap["backend"].(map[string]interface{})
				if !ok {
					continue
				}

				service, ok := backend["service"].(map[string]interface{})
				if !ok {
					continue
				}

				serviceName, _ := service["name"].(string)

				// O(1) lookup via name index
				svc := ri.graph.GetNodeByName(ingress.Namespace, "Service", serviceName)
				if svc != nil {
					ri.graph.AddEdge(models.TopologyEdge{
						ID:               fmt.Sprintf("%s-%s-ingress", ingress.ID, svc.ID),
						Source:           ingress.ID,
						Target:           svc.ID,
						RelationshipType: "routes",
						Label:            "routes to",
						Metadata:         models.EdgeMetadata{Derivation: "fieldReference", Confidence: 1, SourceField: "spec.rules"},
					})
				}
			}
		}

		// Handle defaultBackend (Ingress with no rules or catch-all backend)
		if defaultBackend, ok := spec["defaultBackend"].(map[string]interface{}); ok {
			if svcRef, ok := defaultBackend["service"].(map[string]interface{}); ok {
				if serviceName, ok := svcRef["name"].(string); ok && serviceName != "" {
					svc := ri.graph.GetNodeByName(ingress.Namespace, "Service", serviceName)
					if svc != nil {
						ri.graph.AddEdge(models.TopologyEdge{
							ID:               fmt.Sprintf("%s-%s-default", ingress.ID, svc.ID),
							Source:           ingress.ID,
							Target:           svc.ID,
							RelationshipType: "routes",
							Label:            "default backend",
							Metadata:         models.EdgeMetadata{Derivation: "fieldReference", Confidence: 1, SourceField: "spec.defaultBackend"},
						})
					}
				}
			}
		}
	}

	// Service -> Endpoints: same-name convention, use O(1) name index.
	services := ri.graph.GetNodesByType("Service")
	for _, svc := range services {
		ep := ri.graph.GetNodeByName(svc.Namespace, "Endpoints", svc.Name)
		if ep != nil {
			ri.graph.AddEdge(models.TopologyEdge{
				ID:               fmt.Sprintf("%s-%s-endpoints", svc.ID, ep.ID),
				Source:           svc.ID,
				Target:           ep.ID,
				RelationshipType: "exposes",
				Label:            "exposes",
				Metadata:         models.EdgeMetadata{Derivation: "fieldReference", Confidence: 1, SourceField: "spec"},
			})
		}
	}

	return nil
}

// inferStorageRelationships infers storage relationships.
// Uses O(1) name index lookups for PV and StorageClass resolution.
func (ri *RelationshipInferencer) inferStorageRelationships(ctx context.Context) error {
	// PVC -> PV
	pvcs := ri.graph.GetNodesByType("PersistentVolumeClaim")

	for _, pvc := range pvcs {
		k8sPVC, err := ri.engine.client.Clientset.CoreV1().PersistentVolumeClaims(pvc.Namespace).Get(ctx, pvc.Name, metav1.GetOptions{})
		if err != nil {
			continue
		}

		if k8sPVC.Spec.VolumeName != "" {
			// PVs are cluster-scoped (namespace="")
			pv := ri.graph.GetNodeByName("", "PersistentVolume", k8sPVC.Spec.VolumeName)
			if pv != nil {
				ri.graph.AddEdge(models.TopologyEdge{
					ID:               fmt.Sprintf("%s-%s-pv", pvc.ID, pv.ID),
					Source:           pvc.ID,
					Target:           pv.ID,
					RelationshipType: "stores",
					Label:            "bound to",
					Metadata:         models.EdgeMetadata{Derivation: "fieldReference", Confidence: 1, SourceField: "spec.volumeName"},
				})
			}
		}
		if k8sPVC.Spec.StorageClassName != nil {
			// StorageClasses are cluster-scoped (namespace="")
			sc := ri.graph.GetNodeByName("", "StorageClass", *k8sPVC.Spec.StorageClassName)
			if sc != nil {
				ri.graph.AddEdge(models.TopologyEdge{
					ID:               fmt.Sprintf("%s-%s-sc", pvc.ID, sc.ID),
					Source:           pvc.ID,
					Target:           sc.ID,
					RelationshipType: "stores",
					Label:            "uses",
					Metadata:         models.EdgeMetadata{Derivation: "fieldReference", Confidence: 1, SourceField: "spec.storageClassName"},
				})
			}
		}
	}

	pvs := ri.graph.GetNodesByType("PersistentVolume")
	for _, pv := range pvs {
		k8sPV, err := ri.engine.client.Clientset.CoreV1().PersistentVolumes().Get(ctx, pv.Name, metav1.GetOptions{})
		if err != nil {
			continue
		}
		if k8sPV.Spec.StorageClassName != "" {
			sc := ri.graph.GetNodeByName("", "StorageClass", k8sPV.Spec.StorageClassName)
			if sc != nil {
				ri.graph.AddEdge(models.TopologyEdge{
					ID:               fmt.Sprintf("%s-%s-sc", pv.ID, sc.ID),
					Source:           pv.ID,
					Target:           sc.ID,
					RelationshipType: "stores",
					Label:            "provisioned by",
					Metadata:         models.EdgeMetadata{Derivation: "fieldReference", Confidence: 1, SourceField: "spec.storageClassName"},
				})
			}
		}
	}

	return nil
}

// inferNodeRelationships infers node-related relationships.
// Uses stored spec.nodeName from discovery phase (no extra API calls needed).
func (ri *RelationshipInferencer) inferNodeRelationships(_ context.Context) error {
	pods := ri.graph.GetNodesByType("Pod")

	for _, pod := range pods {
		extra := ri.graph.GetNodeExtra(pod.ID)
		if extra == nil {
			continue
		}
		nodeName, _ := extra["nodeName"].(string)
		if nodeName == "" {
			continue
		}

		// Nodes are cluster-scoped (namespace="")
		node := ri.graph.GetNodeByName("", "Node", nodeName)
		if node != nil {
			ri.graph.AddEdge(models.TopologyEdge{
				ID:               fmt.Sprintf("%s-%s-node", pod.ID, node.ID),
				Source:           pod.ID,
				Target:           node.ID,
				RelationshipType: "schedules",
				Label:            "runs on",
				Metadata:         models.EdgeMetadata{Derivation: "fieldReference", Confidence: 1, SourceField: "spec.nodeName"},
			})
		}
	}

	return nil
}

// inferAutoscalingRelationships infers autoscaling relationships
func (ri *RelationshipInferencer) inferAutoscalingRelationships() error {
	// Already handled in inferLabelSelectors for HPAs
	// Add VPA relationships if needed in the future
	return nil
}

// inferJobRelationships infers job and cronjob relationships
func (ri *RelationshipInferencer) inferJobRelationships() error {
	// CronJob -> Job already handled by owner references
	// Job -> Pod already handled by owner references
	return nil
}

// matchesSelector checks if labels match a selector
func (ri *RelationshipInferencer) matchesSelector(podLabels, selector map[string]string) bool {
	if len(selector) == 0 {
		return false
	}

	for key, value := range selector {
		if podLabels[key] != value {
			return false
		}
	}

	return true
}
