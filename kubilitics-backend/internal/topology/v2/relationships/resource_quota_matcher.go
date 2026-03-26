package relationships

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// ResourceQuotaMatcher produces edges from ResourceQuotas and LimitRanges to their Namespace.
type ResourceQuotaMatcher struct{}

func (ResourceQuotaMatcher) Name() string { return "resource_quota" }

func (m *ResourceQuotaMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}
	var edges []v2.TopologyEdge

	// ResourceQuota → Namespace
	for i := range bundle.ResourceQuotas {
		rq := &bundle.ResourceQuotas[i]
		if rq.Namespace == "" {
			continue
		}
		if !hasNamespace(bundle, rq.Namespace) {
			continue
		}
		src := v2.NodeID("ResourceQuota", rq.Namespace, rq.Name)
		tgt := v2.NodeID("Namespace", "", rq.Namespace)
		edges = append(edges, v2.TopologyEdge{
			ID:                   v2.EdgeID(src, tgt, "quota_enforcement"),
			Source:               src,
			Target:               tgt,
			RelationshipType:     "quota_enforcement",
			RelationshipCategory: "policy",
			Label:                rq.Name,
			Detail:               "ResourceQuota → Namespace",
			Style:                "dashed",
			Healthy:              true,
		})
	}

	// LimitRange → Namespace
	for i := range bundle.LimitRanges {
		lr := &bundle.LimitRanges[i]
		if lr.Namespace == "" {
			continue
		}
		if !hasNamespace(bundle, lr.Namespace) {
			continue
		}
		src := v2.NodeID("LimitRange", lr.Namespace, lr.Name)
		tgt := v2.NodeID("Namespace", "", lr.Namespace)
		edges = append(edges, v2.TopologyEdge{
			ID:                   v2.EdgeID(src, tgt, "limit_enforcement"),
			Source:               src,
			Target:               tgt,
			RelationshipType:     "limit_enforcement",
			RelationshipCategory: "policy",
			Label:                lr.Name,
			Detail:               "LimitRange → Namespace",
			Style:                "dashed",
			Healthy:              true,
		})
	}

	return edges, nil
}

func hasNamespace(b *v2.ResourceBundle, name string) bool {
	for i := range b.Namespaces {
		if b.Namespaces[i].Name == name {
			return true
		}
	}
	return false
}
