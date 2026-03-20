package relationships

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// ScalingMatcher produces HPA→Deployment and HPA→StatefulSet edges.
type ScalingMatcher struct{}

func (ScalingMatcher) Name() string { return "scaling" }

func (m *ScalingMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}
	var edges []v2.TopologyEdge

	for i := range bundle.HPAs {
		hpa := &bundle.HPAs[i]
		ref := hpa.Spec.ScaleTargetRef
		src := v2.NodeID("HorizontalPodAutoscaler", hpa.Namespace, hpa.Name)
		var tgt string
		switch ref.Kind {
		case "Deployment":
			tgt = v2.NodeID("Deployment", hpa.Namespace, ref.Name)
		case "StatefulSet":
			tgt = v2.NodeID("StatefulSet", hpa.Namespace, ref.Name)
		default:
			continue
		}
		edges = append(edges, v2.TopologyEdge{
			ID:                   v2.EdgeID(src, tgt, "scaling"),
			Source:               src,
			Target:               tgt,
			RelationshipType:     "scaling",
			RelationshipCategory: "scaling",
			Label:                "scales",
			Detail:               "spec.scaleTargetRef",
			Style:                "dashed",
			Healthy:              true,
		})
	}
	return edges, nil
}
