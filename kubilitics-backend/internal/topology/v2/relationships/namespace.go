package relationships

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// NamespaceMatcher produces Resource→Namespace containment edges for all namespaced resources.
type NamespaceMatcher struct{}

func (NamespaceMatcher) Name() string { return "namespace" }

func (m *NamespaceMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}

	nsSet := make(map[string]bool, len(bundle.Namespaces))
	for _, ns := range bundle.Namespaces {
		nsSet[ns.Name] = true
	}

	var edges []v2.TopologyEdge
	seen := make(map[string]bool)

	addContainment := func(kind, namespace, name string) {
		if namespace == "" || !nsSet[namespace] {
			return
		}
		src := v2.NodeID(kind, namespace, name)
		tgt := v2.NodeID("Namespace", "", namespace)
		id := v2.EdgeID(src, tgt, "namespace")
		if seen[id] {
			return
		}
		seen[id] = true
		edges = append(edges, v2.TopologyEdge{
			ID:                   id,
			Source:               src,
			Target:               tgt,
			RelationshipType:     "namespace",
			RelationshipCategory: "containment",
			Label:                "in namespace",
			Detail:               "metadata.namespace",
			Style:                "dotted",
			Healthy:              true,
		})
	}

	for i := range bundle.Pods {
		addContainment("Pod", bundle.Pods[i].Namespace, bundle.Pods[i].Name)
	}
	for i := range bundle.Deployments {
		addContainment("Deployment", bundle.Deployments[i].Namespace, bundle.Deployments[i].Name)
	}
	for i := range bundle.StatefulSets {
		addContainment("StatefulSet", bundle.StatefulSets[i].Namespace, bundle.StatefulSets[i].Name)
	}
	for i := range bundle.DaemonSets {
		addContainment("DaemonSet", bundle.DaemonSets[i].Namespace, bundle.DaemonSets[i].Name)
	}
	for i := range bundle.ReplicaSets {
		addContainment("ReplicaSet", bundle.ReplicaSets[i].Namespace, bundle.ReplicaSets[i].Name)
	}
	for i := range bundle.Services {
		addContainment("Service", bundle.Services[i].Namespace, bundle.Services[i].Name)
	}
	for i := range bundle.ConfigMaps {
		addContainment("ConfigMap", bundle.ConfigMaps[i].Namespace, bundle.ConfigMaps[i].Name)
	}
	for i := range bundle.Secrets {
		addContainment("Secret", bundle.Secrets[i].Namespace, bundle.Secrets[i].Name)
	}
	for i := range bundle.Ingresses {
		addContainment("Ingress", bundle.Ingresses[i].Namespace, bundle.Ingresses[i].Name)
	}
	for i := range bundle.PVCs {
		addContainment("PersistentVolumeClaim", bundle.PVCs[i].Namespace, bundle.PVCs[i].Name)
	}
	for i := range bundle.ServiceAccounts {
		addContainment("ServiceAccount", bundle.ServiceAccounts[i].Namespace, bundle.ServiceAccounts[i].Name)
	}
	for i := range bundle.Jobs {
		addContainment("Job", bundle.Jobs[i].Namespace, bundle.Jobs[i].Name)
	}
	for i := range bundle.CronJobs {
		addContainment("CronJob", bundle.CronJobs[i].Namespace, bundle.CronJobs[i].Name)
	}
	for i := range bundle.Roles {
		addContainment("Role", bundle.Roles[i].Namespace, bundle.Roles[i].Name)
	}
	for i := range bundle.RoleBindings {
		addContainment("RoleBinding", bundle.RoleBindings[i].Namespace, bundle.RoleBindings[i].Name)
	}
	for i := range bundle.HPAs {
		addContainment("HorizontalPodAutoscaler", bundle.HPAs[i].Namespace, bundle.HPAs[i].Name)
	}
	for i := range bundle.PDBs {
		addContainment("PodDisruptionBudget", bundle.PDBs[i].Namespace, bundle.PDBs[i].Name)
	}
	for i := range bundle.NetworkPolicies {
		addContainment("NetworkPolicy", bundle.NetworkPolicies[i].Namespace, bundle.NetworkPolicies[i].Name)
	}

	return edges, nil
}
