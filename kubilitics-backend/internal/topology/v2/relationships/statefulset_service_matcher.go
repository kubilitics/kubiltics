package relationships

import (
	"context"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// StatefulSetServiceMatcher produces StatefulSet->Service edges based on spec.serviceName.
type StatefulSetServiceMatcher struct{}

func (StatefulSetServiceMatcher) Name() string { return "statefulset_service" }

func (m *StatefulSetServiceMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}

	// Build a lookup of services by namespace/name for fast matching.
	type nsName struct{ ns, name string }
	svcSet := make(map[nsName]struct{}, len(bundle.Services))
	for i := range bundle.Services {
		svc := &bundle.Services[i]
		svcSet[nsName{svc.Namespace, svc.Name}] = struct{}{}
	}

	var edges []v2.TopologyEdge
	for i := range bundle.StatefulSets {
		sts := &bundle.StatefulSets[i]
		svcName := sts.Spec.ServiceName
		if svcName == "" {
			continue
		}
		// Only create an edge if the service actually exists in the bundle.
		if _, ok := svcSet[nsName{sts.Namespace, svcName}]; !ok {
			continue
		}
		stsID := v2.NodeID("StatefulSet", sts.Namespace, sts.Name)
		tgt := v2.NodeID("Service", sts.Namespace, svcName)
		edges = append(edges, v2.TopologyEdge{
			ID:                   v2.EdgeID(stsID, tgt, "headless_service"),
			Source:               stsID,
			Target:               tgt,
			RelationshipType:     "headless_service",
			RelationshipCategory: "networking",
			Label:                fmt.Sprintf("headless: %s", svcName),
			Detail:               "spec.serviceName",
			Style:                "solid",
			Healthy:              true,
		})
	}
	return edges, nil
}
