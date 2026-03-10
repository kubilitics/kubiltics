package relationships

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// StorageMatcher produces PVC→PV, PV→StorageClass, PVC→StorageClass edges.
type StorageMatcher struct{}

func (StorageMatcher) Name() string { return "storage" }

func (m *StorageMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}
	var edges []v2.TopologyEdge

	for i := range bundle.PVCs {
		pvc := &bundle.PVCs[i]
		pvcID := v2.NodeID("PersistentVolumeClaim", pvc.Namespace, pvc.Name)
		if pvc.Spec.StorageClassName != nil && *pvc.Spec.StorageClassName != "" {
			tgt := v2.NodeID("StorageClass", "", *pvc.Spec.StorageClassName)
			edges = append(edges, v2.TopologyEdge{
				ID:                   v2.EdgeID(pvcID, tgt, "storage_class"),
				Source:               pvcID,
				Target:               tgt,
				RelationshipType:     "storage_class",
				RelationshipCategory: "storage",
				Label:                "uses",
				Detail:               "spec.storageClassName",
				Style:                "dashed",
				Healthy:              true,
			})
		}
	}
	for i := range bundle.PVs {
		pv := &bundle.PVs[i]
		pvID := v2.NodeID("PersistentVolume", "", pv.Name)
		if pv.Spec.StorageClassName != "" {
			tgt := v2.NodeID("StorageClass", "", pv.Spec.StorageClassName)
			edges = append(edges, v2.TopologyEdge{
				ID:                   v2.EdgeID(pvID, tgt, "storage_class"),
				Source:               pvID,
				Target:               tgt,
				RelationshipType:     "storage_class",
				RelationshipCategory: "storage",
				Label:                "uses",
				Detail:               "spec.storageClassName",
				Style:                "dashed",
				Healthy:              true,
			})
		}
		if pv.Spec.ClaimRef != nil {
			pvcID := v2.NodeID("PersistentVolumeClaim", pv.Spec.ClaimRef.Namespace, pv.Spec.ClaimRef.Name)
			edges = append(edges, v2.TopologyEdge{
				ID:                   v2.EdgeID(pvcID, pvID, "bound_to"),
				Source:               pvcID,
				Target:               pvID,
				RelationshipType:     "bound_to",
				RelationshipCategory: "storage",
				Label:                "bound to",
				Detail:               "spec.claimRef",
				Style:                "solid",
				Healthy:              true,
			})
		}
	}
	return edges, nil
}
