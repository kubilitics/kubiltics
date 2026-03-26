package relationships

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// SchedulingMatcher produces Pod→Node and Pod→ServiceAccount edges.
type SchedulingMatcher struct{}

func (SchedulingMatcher) Name() string { return "scheduling" }

func (m *SchedulingMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}
	var edges []v2.TopologyEdge

	for i := range bundle.Pods {
		pod := &bundle.Pods[i]
		podID := v2.NodeID("Pod", pod.Namespace, pod.Name)
		if pod.Spec.NodeName != "" {
			tgt := v2.NodeID("Node", "", pod.Spec.NodeName)
			edges = append(edges, v2.TopologyEdge{
				ID:                   v2.EdgeID(podID, tgt, "scheduling"),
				Source:               podID,
				Target:               tgt,
				RelationshipType:     "scheduling",
				RelationshipCategory: "scheduling",
				Label:                "runs on",
				Detail:               "spec.nodeName",
				Style:                "dotted",
				Healthy:              true,
			})
		}
		if pod.Spec.ServiceAccountName != "" {
			saName := pod.Spec.ServiceAccountName
			tgt := v2.NodeID("ServiceAccount", pod.Namespace, saName)
			edges = append(edges, v2.TopologyEdge{
				ID:                   v2.EdgeID(podID, tgt, "service_account"),
				Source:               podID,
				Target:               tgt,
				RelationshipType:     "service_account",
				RelationshipCategory: "rbac",
				Label:                "uses",
				Detail:               "spec.serviceAccountName",
				Style:                "dashed",
				Healthy:              true,
			})
		}
		if pod.Spec.PriorityClassName != "" {
			tgt := v2.NodeID("PriorityClass", "", pod.Spec.PriorityClassName)
			edges = append(edges, v2.TopologyEdge{
				ID:                   v2.EdgeID(podID, tgt, "priority_class"),
				Source:               podID,
				Target:               tgt,
				RelationshipType:     "priority_class",
				RelationshipCategory: "scheduling",
				Label:                "priority",
				Detail:               "spec.priorityClassName",
				Style:                "dashed",
				Healthy:              true,
			})
		}
		if pod.Spec.RuntimeClassName != nil && *pod.Spec.RuntimeClassName != "" {
			tgt := v2.NodeID("RuntimeClass", "", *pod.Spec.RuntimeClassName)
			edges = append(edges, v2.TopologyEdge{
				ID:                   v2.EdgeID(podID, tgt, "runtime_class"),
				Source:               podID,
				Target:               tgt,
				RelationshipType:     "runtime_class",
				RelationshipCategory: "scheduling",
				Label:                "runtime",
				Detail:               "spec.runtimeClassName",
				Style:                "dashed",
				Healthy:              true,
			})
		}
	}
	return edges, nil
}
