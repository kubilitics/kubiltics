package relationships

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
)

// NetworkPolicyRuleMatcher produces edges from ingress/egress rules within NetworkPolicy specs.
// This complements SelectorMatcher which only handles the top-level spec.podSelector.
type NetworkPolicyRuleMatcher struct{}

func (NetworkPolicyRuleMatcher) Name() string { return "network_policy_rules" }

func (m *NetworkPolicyRuleMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}
	var edges []v2.TopologyEdge
	seen := make(map[string]bool)

	for i := range bundle.NetworkPolicies {
		np := &bundle.NetworkPolicies[i]
		npID := v2.NodeID("NetworkPolicy", np.Namespace, np.Name)

		// Ingress rules: from[].podSelector and from[].namespaceSelector
		for _, rule := range np.Spec.Ingress {
			for _, peer := range rule.From {
				m.matchPodSelector(bundle, npID, np.Namespace, peer.PodSelector, "np_allows_ingress_from", "allows ingress from", seen, &edges)
				m.matchNamespaceSelector(bundle, npID, peer.NamespaceSelector, "np_allows_from_namespace", "allows from namespace", seen, &edges)
			}
		}

		// Egress rules: to[].podSelector and to[].namespaceSelector
		for _, rule := range np.Spec.Egress {
			for _, peer := range rule.To {
				m.matchPodSelector(bundle, npID, np.Namespace, peer.PodSelector, "np_allows_egress_to", "allows egress to", seen, &edges)
				m.matchNamespaceSelector(bundle, npID, peer.NamespaceSelector, "np_allows_to_namespace", "allows to namespace", seen, &edges)
			}
		}
	}
	return edges, nil
}

// matchPodSelector creates NP→Pod edges for pods matching the given label selector.
func (m *NetworkPolicyRuleMatcher) matchPodSelector(
	bundle *v2.ResourceBundle,
	npID, npNamespace string,
	selector *metav1.LabelSelector,
	relType, label string,
	seen map[string]bool,
	edges *[]v2.TopologyEdge,
) {
	if selector == nil {
		return
	}
	sel, err := metav1.LabelSelectorAsSelector(selector)
	if err != nil {
		return
	}
	for j := range bundle.Pods {
		pod := &bundle.Pods[j]
		if pod.Namespace != npNamespace {
			continue
		}
		if sel.Matches(labels.Set(pod.Labels)) {
			tgt := v2.NodeID("Pod", pod.Namespace, pod.Name)
			id := v2.EdgeID(npID, tgt, relType)
			if !seen[id] {
				seen[id] = true
				*edges = append(*edges, v2.TopologyEdge{
					ID:                   id,
					Source:               npID,
					Target:               tgt,
					RelationshipType:     v2.RelationshipType(relType),
					RelationshipCategory: "policy",
					Label:                label,
					Detail:               "spec.ingress/egress[].podSelector",
					Style:                "dashed",
					Healthy:              true,
				})
			}
		}
	}
}

// matchNamespaceSelector creates NP→Namespace edges for namespaces matching the given label selector.
func (m *NetworkPolicyRuleMatcher) matchNamespaceSelector(
	bundle *v2.ResourceBundle,
	npID string,
	selector *metav1.LabelSelector,
	relType, label string,
	seen map[string]bool,
	edges *[]v2.TopologyEdge,
) {
	if selector == nil {
		return
	}
	sel, err := metav1.LabelSelectorAsSelector(selector)
	if err != nil {
		return
	}
	for j := range bundle.Namespaces {
		ns := &bundle.Namespaces[j]
		if sel.Matches(labels.Set(ns.Labels)) {
			tgt := v2.NodeID("Namespace", "", ns.Name)
			id := v2.EdgeID(npID, tgt, relType)
			if !seen[id] {
				seen[id] = true
				*edges = append(*edges, v2.TopologyEdge{
					ID:                   id,
					Source:               npID,
					Target:               tgt,
					RelationshipType:     v2.RelationshipType(relType),
					RelationshipCategory: "policy",
					Label:                label,
					Detail:               "spec.ingress/egress[].namespaceSelector",
					Style:                "dashed",
					Healthy:              true,
				})
			}
		}
	}
}
