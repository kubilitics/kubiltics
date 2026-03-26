package relationships

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
)

// SelectorMatcher produces edges for Service→Pod, PDB→Pod, NetworkPolicy→Pod via label selectors.
type SelectorMatcher struct{}

func (SelectorMatcher) Name() string { return "selector" }

func (m *SelectorMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}
	var edges []v2.TopologyEdge

	// Service → Pod (spec.selector)
	for i := range bundle.Services {
		svc := &bundle.Services[i]
		if len(svc.Spec.Selector) == 0 {
			continue
		}
		sel := labels.SelectorFromSet(svc.Spec.Selector)
		for j := range bundle.Pods {
			pod := &bundle.Pods[j]
			if pod.Namespace != svc.Namespace {
				continue
			}
			if sel.Matches(labels.Set(pod.Labels)) {
				src := v2.NodeID("Service", svc.Namespace, svc.Name)
				tgt := v2.NodeID("Pod", pod.Namespace, pod.Name)
				label := "selects"
				if len(svc.Spec.Selector) > 0 {
					keys := make([]string, 0, len(svc.Spec.Selector))
					for k := range svc.Spec.Selector {
						keys = append(keys, k)
					}
					sort.Strings(keys)
					pairs := make([]string, 0, len(keys))
					for _, k := range keys {
						pairs = append(pairs, fmt.Sprintf("%s=%s", k, svc.Spec.Selector[k]))
					}
					label = fmt.Sprintf("selects (%s)", strings.Join(pairs, ", "))
				}
				edges = append(edges, v2.TopologyEdge{
					ID:                   v2.EdgeID(src, tgt, "selector"),
					Source:               src,
					Target:               tgt,
					RelationshipType:     "selector",
					RelationshipCategory: "networking",
					Label:                label,
					Detail:               "spec.selector",
					Style:                "dashed",
					Healthy:              true,
				})
			}
		}
	}

	// PDB → Pod (spec.selector)
	for i := range bundle.PDBs {
		pdb := &bundle.PDBs[i]
		if pdb.Spec.Selector == nil {
			continue
		}
		sel, err := metav1.LabelSelectorAsSelector(pdb.Spec.Selector)
		if err != nil {
			continue
		}
		for j := range bundle.Pods {
			pod := &bundle.Pods[j]
			if pod.Namespace != pdb.Namespace {
				continue
			}
			if sel.Matches(labels.Set(pod.Labels)) {
				src := v2.NodeID("PodDisruptionBudget", pdb.Namespace, pdb.Name)
				tgt := v2.NodeID("Pod", pod.Namespace, pod.Name)
				edges = append(edges, v2.TopologyEdge{
					ID:                   v2.EdgeID(src, tgt, "selector"),
					Source:               src,
					Target:               tgt,
					RelationshipType:     "selector",
					RelationshipCategory: "policy",
					Label:                "protects",
					Detail:               "spec.selector",
					Style:                "dashed",
					Healthy:              true,
				})
			}
		}
	}

	// NetworkPolicy → Pod (spec.podSelector)
	for i := range bundle.NetworkPolicies {
		np := &bundle.NetworkPolicies[i]
		sel, err := metav1.LabelSelectorAsSelector(&np.Spec.PodSelector)
		if err != nil {
			continue
		}
		for j := range bundle.Pods {
			pod := &bundle.Pods[j]
			if pod.Namespace != np.Namespace {
				continue
			}
			if sel.Matches(labels.Set(pod.Labels)) {
				src := v2.NodeID("NetworkPolicy", np.Namespace, np.Name)
				tgt := v2.NodeID("Pod", pod.Namespace, pod.Name)
				edges = append(edges, v2.TopologyEdge{
					ID:                   v2.EdgeID(src, tgt, "selector"),
					Source:               src,
					Target:               tgt,
					RelationshipType:     "selector",
					RelationshipCategory: "policy",
					Label:                "applies to",
					Detail:               "spec.podSelector",
					Style:                "dashed",
					Healthy:              true,
				})
			}
		}
	}

	return edges, nil
}
