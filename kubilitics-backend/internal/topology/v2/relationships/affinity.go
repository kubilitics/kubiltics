package relationships

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
)

// AffinityMatcher produces edges from Pod affinity/anti-affinity rules and node affinity selectors.
type AffinityMatcher struct{}

func (AffinityMatcher) Name() string { return "affinity" }

func (m *AffinityMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}
	var edges []v2.TopologyEdge

	for i := range bundle.Pods {
		pod := &bundle.Pods[i]
		if pod.Spec.Affinity == nil {
			continue
		}
		podID := v2.NodeID("Pod", pod.Namespace, pod.Name)

		// Node affinity — required and preferred
		if na := pod.Spec.Affinity.NodeAffinity; na != nil {
			edges = appendNodeAffinityEdges(edges, podID, na, bundle)
			edges = appendPreferredNodeAffinityEdges(edges, podID, na, bundle)
		}

		// Pod affinity — required and preferred
		if pa := pod.Spec.Affinity.PodAffinity; pa != nil {
			edges = appendPodAffinityEdges(edges, pod, podID, pa.RequiredDuringSchedulingIgnoredDuringExecution, "pod_affinity", "pod affinity", "solid", bundle)
			edges = appendWeightedPodAffinityEdges(edges, pod, podID, pa.PreferredDuringSchedulingIgnoredDuringExecution, "preferred_pod_affinity", "preferred pod affinity", bundle)
		}

		// Pod anti-affinity — required and preferred
		if paa := pod.Spec.Affinity.PodAntiAffinity; paa != nil {
			edges = appendPodAffinityEdges(edges, pod, podID, paa.RequiredDuringSchedulingIgnoredDuringExecution, "pod_anti_affinity", "pod anti-affinity", "solid", bundle)
			edges = appendWeightedPodAffinityEdges(edges, pod, podID, paa.PreferredDuringSchedulingIgnoredDuringExecution, "preferred_pod_anti_affinity", "preferred pod anti-affinity", bundle)
		}
	}
	return edges, nil
}

// appendNodeAffinityEdges adds edges from a Pod to Nodes whose labels match the required node selector terms.
func appendNodeAffinityEdges(edges []v2.TopologyEdge, podID string, na *corev1.NodeAffinity, bundle *v2.ResourceBundle) []v2.TopologyEdge {
	req := na.RequiredDuringSchedulingIgnoredDuringExecution
	if req == nil {
		return edges
	}
	for _, term := range req.NodeSelectorTerms {
		for j := range bundle.Nodes {
			node := &bundle.Nodes[j]
			if nodeMatchesSelectorTerm(node, term) {
				tgt := v2.NodeID("Node", "", node.Name)
				edges = append(edges, v2.TopologyEdge{
					ID:                   v2.EdgeID(podID, tgt, "node_affinity"),
					Source:               podID,
					Target:               tgt,
					RelationshipType:     "node_affinity",
					RelationshipCategory: "scheduling",
					Label:                "node affinity",
					Detail:               "spec.affinity.nodeAffinity",
					Style:                "solid",
					Healthy:              true,
				})
			}
		}
	}
	return edges
}

// nodeMatchesSelectorTerm checks if a Node's labels satisfy all matchExpressions in a NodeSelectorTerm.
func nodeMatchesSelectorTerm(node *corev1.Node, term corev1.NodeSelectorTerm) bool {
	nodeLabels := node.Labels
	if nodeLabels == nil {
		nodeLabels = map[string]string{}
	}
	for _, expr := range term.MatchExpressions {
		val, exists := nodeLabels[expr.Key]
		switch expr.Operator {
		case corev1.NodeSelectorOpIn:
			if !exists || !stringInSlice(val, expr.Values) {
				return false
			}
		case corev1.NodeSelectorOpNotIn:
			if exists && stringInSlice(val, expr.Values) {
				return false
			}
		case corev1.NodeSelectorOpExists:
			if !exists {
				return false
			}
		case corev1.NodeSelectorOpDoesNotExist:
			if exists {
				return false
			}
		default:
			return false
		}
	}
	return true
}

// appendPodAffinityEdges adds edges from the source pod to other pods that match the label selector in the affinity terms.
func appendPodAffinityEdges(edges []v2.TopologyEdge, srcPod *corev1.Pod, podID string, terms []corev1.PodAffinityTerm, relType, label, style string, bundle *v2.ResourceBundle) []v2.TopologyEdge {
	for _, term := range terms {
		sel, err := metav1.LabelSelectorAsSelector(term.LabelSelector)
		if err != nil {
			continue
		}
		for j := range bundle.Pods {
			other := &bundle.Pods[j]
			if other.Namespace == srcPod.Namespace && other.Name == srcPod.Name {
				continue
			}
			// If namespaces is specified, the target pod must be in one of them.
			if len(term.Namespaces) > 0 && !stringInSlice(other.Namespace, term.Namespaces) {
				continue
			}
			if sel.Matches(labels.Set(other.Labels)) {
				tgt := v2.NodeID("Pod", other.Namespace, other.Name)
				edges = append(edges, v2.TopologyEdge{
					ID:                   v2.EdgeID(podID, tgt, relType),
					Source:               podID,
					Target:               tgt,
					RelationshipType:     v2.RelationshipType(relType),
					RelationshipCategory: "scheduling",
					Label:                label,
					Detail:               "spec.affinity",
					Style:                v2.EdgeStyle(style),
					Healthy:              true,
				})
			}
		}
	}
	return edges
}

// appendPreferredNodeAffinityEdges adds edges from a Pod to Nodes whose labels match preferred node selector terms.
func appendPreferredNodeAffinityEdges(edges []v2.TopologyEdge, podID string, na *corev1.NodeAffinity, bundle *v2.ResourceBundle) []v2.TopologyEdge {
	for _, pref := range na.PreferredDuringSchedulingIgnoredDuringExecution {
		for j := range bundle.Nodes {
			node := &bundle.Nodes[j]
			if nodeMatchesSelectorTerm(node, pref.Preference) {
				tgt := v2.NodeID("Node", "", node.Name)
				edges = append(edges, v2.TopologyEdge{
					ID:                   v2.EdgeID(podID, tgt, "preferred_node_affinity"),
					Source:               podID,
					Target:               tgt,
					RelationshipType:     "preferred_node_affinity",
					RelationshipCategory: "scheduling",
					Label:                "preferred node affinity",
					Detail:               "spec.affinity.nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution",
					Style:                "dashed",
					Healthy:              true,
				})
			}
		}
	}
	return edges
}

// appendWeightedPodAffinityEdges adds edges from the source pod to other pods matching preferred pod affinity/anti-affinity terms.
func appendWeightedPodAffinityEdges(edges []v2.TopologyEdge, srcPod *corev1.Pod, podID string, terms []corev1.WeightedPodAffinityTerm, relType, label string, bundle *v2.ResourceBundle) []v2.TopologyEdge {
	for _, wt := range terms {
		term := wt.PodAffinityTerm
		sel, err := metav1.LabelSelectorAsSelector(term.LabelSelector)
		if err != nil {
			continue
		}
		for j := range bundle.Pods {
			other := &bundle.Pods[j]
			if other.Namespace == srcPod.Namespace && other.Name == srcPod.Name {
				continue
			}
			if len(term.Namespaces) > 0 && !stringInSlice(other.Namespace, term.Namespaces) {
				continue
			}
			if sel.Matches(labels.Set(other.Labels)) {
				tgt := v2.NodeID("Pod", other.Namespace, other.Name)
				edges = append(edges, v2.TopologyEdge{
					ID:                   v2.EdgeID(podID, tgt, relType),
					Source:               podID,
					Target:               tgt,
					RelationshipType:     v2.RelationshipType(relType),
					RelationshipCategory: "scheduling",
					Label:                label,
					Detail:               "spec.affinity",
					Style:                "dashed",
					Healthy:              true,
				})
			}
		}
	}
	return edges
}

func stringInSlice(s string, slice []string) bool {
	for _, v := range slice {
		if v == s {
			return true
		}
	}
	return false
}
