package relationships

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// TaintTolerationMatcher produces Pod→Node edges for pods that tolerate a node's taints.
// Only pods actually scheduled on the node (spec.nodeName) are considered.
type TaintTolerationMatcher struct{}

func (TaintTolerationMatcher) Name() string { return "taint_toleration" }

func (m *TaintTolerationMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}

	// Index nodes by name for quick lookup.
	nodeByName := make(map[string]*corev1.Node, len(bundle.Nodes))
	for i := range bundle.Nodes {
		nodeByName[bundle.Nodes[i].Name] = &bundle.Nodes[i]
	}

	var edges []v2.TopologyEdge

	for i := range bundle.Pods {
		pod := &bundle.Pods[i]
		if pod.Spec.NodeName == "" || len(pod.Spec.Tolerations) == 0 {
			continue
		}
		node, ok := nodeByName[pod.Spec.NodeName]
		if !ok || len(node.Spec.Taints) == 0 {
			continue
		}

		podID := v2.NodeID("Pod", pod.Namespace, pod.Name)
		tgt := v2.NodeID("Node", "", node.Name)

		for _, taint := range node.Spec.Taints {
			if tol := findMatchingToleration(pod.Spec.Tolerations, &taint); tol != nil {
				label := fmt.Sprintf("tolerates: %s=%s:%s", taint.Key, taint.Value, taint.Effect)
				edges = append(edges, v2.TopologyEdge{
					ID:                   v2.EdgeID(podID, tgt, "tolerates_"+taint.Key),
					Source:               podID,
					Target:               tgt,
					RelationshipType:     "tolerates",
					RelationshipCategory: "scheduling",
					Label:                label,
					Detail:               "spec.tolerations",
					Style:                "dashed",
					Healthy:              true,
				})
			}
		}
	}
	return edges, nil
}

// findMatchingToleration returns the first toleration that matches the given taint, or nil.
func findMatchingToleration(tolerations []corev1.Toleration, taint *corev1.Taint) *corev1.Toleration {
	for i := range tolerations {
		tol := &tolerations[i]
		// Wildcard toleration: empty key with Exists operator matches any taint.
		if tol.Key == "" && tol.Operator == corev1.TolerationOpExists {
			if tol.Effect == "" || tol.Effect == taint.Effect {
				return tol
			}
			continue
		}
		if tol.Key != taint.Key {
			continue
		}
		if tol.Effect != "" && tol.Effect != taint.Effect {
			continue
		}
		if tol.Operator == corev1.TolerationOpExists {
			return tol
		}
		if tol.Value == taint.Value {
			return tol
		}
	}
	return nil
}
