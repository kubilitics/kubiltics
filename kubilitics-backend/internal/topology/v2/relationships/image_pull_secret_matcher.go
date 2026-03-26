package relationships

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// ImagePullSecretMatcher produces edges from Pods to their imagePullSecrets.
type ImagePullSecretMatcher struct{}

func (ImagePullSecretMatcher) Name() string { return "image_pull_secret" }

func (m *ImagePullSecretMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}
	var edges []v2.TopologyEdge
	seen := make(map[string]bool)

	for i := range bundle.Pods {
		pod := &bundle.Pods[i]
		podID := v2.NodeID("Pod", pod.Namespace, pod.Name)
		for _, ref := range pod.Spec.ImagePullSecrets {
			if ref.Name == "" {
				continue
			}
			tgt := v2.NodeID("Secret", pod.Namespace, ref.Name)
			id := v2.EdgeID(podID, tgt, "image_pull_secret")
			if seen[id] {
				continue
			}
			seen[id] = true
			edges = append(edges, v2.TopologyEdge{
				ID:                   id,
				Source:               podID,
				Target:               tgt,
				RelationshipType:     "image_pull_secret",
				RelationshipCategory: "configuration",
				Label:                ref.Name,
				Detail:               "spec.imagePullSecrets",
				Style:                "dashed",
				Healthy:              true,
			})
		}
	}
	return edges, nil
}
