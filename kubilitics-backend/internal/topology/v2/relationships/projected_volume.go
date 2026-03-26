package relationships

import (
	"context"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
	corev1 "k8s.io/api/core/v1"
)

// ProjectedVolumeMatcher produces Pod→ConfigMap, Pod→Secret, and Pod→ServiceAccount edges
// from spec.volumes[].projected.sources[] and distinguishes them from regular volume mounts.
type ProjectedVolumeMatcher struct{}

func (ProjectedVolumeMatcher) Name() string { return "projected_volume" }

func (m *ProjectedVolumeMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}
	var edges []v2.TopologyEdge
	seen := make(map[string]bool)

	for i := range bundle.Pods {
		pod := &bundle.Pods[i]
		podID := v2.NodeID("Pod", pod.Namespace, pod.Name)

		// Build volume name → mount path lookup from all containers.
		// Build a local list of all containers to check (don't modify pod.Spec)
		volumeMountPaths := make(map[string]string)
		allContainers := make([]corev1.Container, 0, len(pod.Spec.Containers)+len(pod.Spec.InitContainers))
		allContainers = append(allContainers, pod.Spec.Containers...)
		allContainers = append(allContainers, pod.Spec.InitContainers...)
		for c := range allContainers {
			for _, vm := range allContainers[c].VolumeMounts {
				volumeMountPaths[vm.Name] = vm.MountPath
			}
		}

		for _, vol := range pod.Spec.Volumes {
			if vol.Projected == nil {
				continue
			}
			path := volumeMountPaths[vol.Name]
			if path == "" {
				path = vol.Name
			}

			for _, src := range vol.Projected.Sources {
				// ConfigMap projection
				if src.ConfigMap != nil {
					tgt := v2.NodeID("ConfigMap", pod.Namespace, src.ConfigMap.Name)
					id := v2.EdgeID(podID, tgt, "projected_volume")
					if !seen[id] {
						seen[id] = true
						edges = append(edges, v2.TopologyEdge{
							ID:                   id,
							Source:               podID,
							Target:               tgt,
							RelationshipType:     "projected_volume",
							RelationshipCategory: "configuration",
							Label:                fmt.Sprintf("projects → %s", path),
							Detail:               "spec.volumes[].projected.sources[].configMap",
							Style:                "dashed",
							Healthy:              true,
						})
					}
				}

				// Secret projection
				if src.Secret != nil {
					tgt := v2.NodeID("Secret", pod.Namespace, src.Secret.Name)
					id := v2.EdgeID(podID, tgt, "projected_volume")
					if !seen[id] {
						seen[id] = true
						edges = append(edges, v2.TopologyEdge{
							ID:                   id,
							Source:               podID,
							Target:               tgt,
							RelationshipType:     "projected_volume",
							RelationshipCategory: "configuration",
							Label:                fmt.Sprintf("projects → %s", path),
							Detail:               "spec.volumes[].projected.sources[].secret",
							Style:                "dashed",
							Healthy:              true,
						})
					}
				}

				// ServiceAccountToken projection
				if src.ServiceAccountToken != nil {
					saName := pod.Spec.ServiceAccountName
					if saName == "" {
						saName = "default"
					}
					tgt := v2.NodeID("ServiceAccount", pod.Namespace, saName)
					id := v2.EdgeID(podID, tgt, "projected_token")
					if !seen[id] {
						seen[id] = true
						edges = append(edges, v2.TopologyEdge{
							ID:                   id,
							Source:               podID,
							Target:               tgt,
							RelationshipType:     "projected_token",
							RelationshipCategory: "rbac",
							Label:                fmt.Sprintf("token → %s", path),
							Detail:               "spec.volumes[].projected.sources[].serviceAccountToken",
							Style:                "dashed",
							Healthy:              true,
						})
					}
				}
			}
		}
	}
	return edges, nil
}
