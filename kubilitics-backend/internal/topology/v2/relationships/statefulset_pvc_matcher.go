package relationships

import (
	"context"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// StatefulSetPVCMatcher produces StatefulSet->PVC edges based on spec.volumeClaimTemplates.
// PVCs created by a StatefulSet follow the naming pattern: {templateName}-{statefulsetName}-{ordinal}.
// This matcher approximates by matching PVCs whose name starts with "{templateName}-{statefulsetName}-".
type StatefulSetPVCMatcher struct{}

func (StatefulSetPVCMatcher) Name() string { return "statefulset_pvc" }

func (m *StatefulSetPVCMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}

	var edges []v2.TopologyEdge
	for i := range bundle.StatefulSets {
		sts := &bundle.StatefulSets[i]
		if len(sts.Spec.VolumeClaimTemplates) == 0 {
			continue
		}
		stsID := v2.NodeID("StatefulSet", sts.Namespace, sts.Name)
		for _, vct := range sts.Spec.VolumeClaimTemplates {
			templateName := vct.Name
			if templateName == "" {
				continue
			}
			prefix := templateName + "-" + sts.Name + "-"
			for j := range bundle.PVCs {
				pvc := &bundle.PVCs[j]
				if pvc.Namespace != sts.Namespace {
					continue
				}
				if !strings.HasPrefix(pvc.Name, prefix) {
					continue
				}
				pvcID := v2.NodeID("PersistentVolumeClaim", pvc.Namespace, pvc.Name)
				edges = append(edges, v2.TopologyEdge{
					ID:                   v2.EdgeID(stsID, pvcID, "volume_claim_template"),
					Source:               stsID,
					Target:               pvcID,
					RelationshipType:     "volume_claim_template",
					RelationshipCategory: "storage",
					Label:                "volume claim template",
					Detail:               "spec.volumeClaimTemplates[" + templateName + "]",
					Style:                "solid",
					Healthy:              true,
				})
			}
		}
	}
	return edges, nil
}
