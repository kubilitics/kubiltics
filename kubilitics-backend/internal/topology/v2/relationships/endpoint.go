package relationships

import (
	"context"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// EndpointMatcher produces Service→Endpoints, Service→EndpointSlice, Endpoints→Pod, EndpointSlice→Pod edges.
type EndpointMatcher struct{}

func (EndpointMatcher) Name() string { return "endpoint" }

func (m *EndpointMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}
	var edges []v2.TopologyEdge

	for i := range bundle.Services {
		svc := &bundle.Services[i]
		svcID := v2.NodeID("Service", svc.Namespace, svc.Name)
		for j := range bundle.Endpoints {
			ep := &bundle.Endpoints[j]
			if ep.Namespace == svc.Namespace && ep.Name == svc.Name {
				epID := v2.NodeID("Endpoints", ep.Namespace, ep.Name)
				edges = append(edges, v2.TopologyEdge{
					ID:                   v2.EdgeID(svcID, epID, "endpoints"),
					Source:               svcID,
					Target:               epID,
					RelationshipType:     "endpoints",
					RelationshipCategory: "networking",
					Label:                "auto-created",
					Detail:               "Endpoints mirror Service name",
					Style:                "dashed",
					Healthy:              true,
				})
				for _, sub := range ep.Subsets {
					for _, addr := range sub.Addresses {
						if addr.TargetRef != nil && addr.TargetRef.Kind == "Pod" {
							tgt := v2.NodeID("Pod", addr.TargetRef.Namespace, addr.TargetRef.Name)
							label := "target"
							if addr.IP != "" {
								label = fmt.Sprintf("target (%s)", addr.IP)
							}
							edges = append(edges, v2.TopologyEdge{
								ID:                   v2.EdgeID(epID, tgt, "endpoint_target"),
								Source:               epID,
								Target:               tgt,
								RelationshipType:     "endpoint_target",
								RelationshipCategory: "networking",
								Label:                label,
								Detail:               "subsets[].addresses[].targetRef",
								Style:                "dotted",
								Healthy:              true,
							})
						}
					}
				}
				break
			}
		}
		for j := range bundle.EndpointSlices {
			es := &bundle.EndpointSlices[j]
			if es.Namespace == svc.Namespace && es.Labels["kubernetes.io/service-name"] == svc.Name {
				esID := v2.NodeID("EndpointSlice", es.Namespace, es.Name)
				edges = append(edges, v2.TopologyEdge{
					ID:                   v2.EdgeID(svcID, esID, "endpoint_slice"),
					Source:               svcID,
					Target:               esID,
					RelationshipType:     "endpoint_slice",
					RelationshipCategory: "networking",
					Label:                "manages",
					Detail:               "EndpointSlice kubernetes.io/service-name label",
					Style:                "dashed",
					Healthy:              true,
				})
				for k := range es.Endpoints {
					ep := &es.Endpoints[k]
					if ep.TargetRef != nil && ep.TargetRef.Kind == "Pod" {
						tgt := v2.NodeID("Pod", ep.TargetRef.Namespace, ep.TargetRef.Name)
						label := "target"
						if len(ep.Addresses) > 0 {
							label = fmt.Sprintf("target (%s)", ep.Addresses[0])
						}
						edges = append(edges, v2.TopologyEdge{
							ID:                   v2.EdgeID(esID, tgt, "endpoint_target"),
							Source:               esID,
							Target:               tgt,
							RelationshipType:     "endpoint_target",
							RelationshipCategory: "networking",
							Label:                label,
							Detail:               "endpoints[].targetRef",
							Style:                "dotted",
							Healthy:              true,
						})
					}
				}
			}
		}
	}
	return edges, nil
}
