package relationships

import (
	"context"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
	corev1 "k8s.io/api/core/v1"
)

// VolumeMountMatcher produces Pod→ConfigMap, Pod→Secret, Pod→PVC edges from spec.volumes and container volumeMounts.
type VolumeMountMatcher struct{}

func (VolumeMountMatcher) Name() string { return "volume_mount" }

func (m *VolumeMountMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}
	var edges []v2.TopologyEdge
	seen := make(map[string]bool)

	for i := range bundle.Pods {
		pod := &bundle.Pods[i]
		podID := v2.NodeID("Pod", pod.Namespace, pod.Name)
		volumeMountPaths := make(map[string]string) // volume name -> mount path (from any container)
		// Build a local list of all containers to check (don't modify pod.Spec)
		allContainers := make([]corev1.Container, 0, len(pod.Spec.Containers)+len(pod.Spec.InitContainers))
		allContainers = append(allContainers, pod.Spec.Containers...)
		allContainers = append(allContainers, pod.Spec.InitContainers...)
		for c := range allContainers {
			for _, vm := range allContainers[c].VolumeMounts {
				volumeMountPaths[vm.Name] = vm.MountPath
			}
		}
		for _, vol := range pod.Spec.Volumes {
			path := volumeMountPaths[vol.Name]
			if path == "" {
				path = vol.Name
			}
			if vol.ConfigMap != nil {
				tgt := v2.NodeID("ConfigMap", pod.Namespace, vol.ConfigMap.Name)
				id := v2.EdgeID(podID, tgt, "volume_mount")
				if !seen[id] {
					seen[id] = true
					edges = append(edges, v2.TopologyEdge{
						ID:                   id,
						Source:               podID,
						Target:               tgt,
						RelationshipType:     "volume_mount",
						RelationshipCategory: "configuration",
						Label:                fmt.Sprintf("mounts → %s", path),
						Detail:               "spec.volumes[].configMap",
						Style:                "dashed",
						Healthy:              true,
					})
				}
			}
			if vol.Secret != nil {
				tgt := v2.NodeID("Secret", pod.Namespace, vol.Secret.SecretName)
				id := v2.EdgeID(podID, tgt, "volume_mount")
				if !seen[id] {
					seen[id] = true
					edges = append(edges, v2.TopologyEdge{
						ID:                   id,
						Source:               podID,
						Target:               tgt,
						RelationshipType:     "volume_mount",
						RelationshipCategory: "configuration",
						Label:                fmt.Sprintf("mounts → %s", path),
						Detail:               "spec.volumes[].secret",
						Style:                "dashed",
						Healthy:              true,
					})
				}
			}
			if vol.PersistentVolumeClaim != nil {
				tgt := v2.NodeID("PersistentVolumeClaim", pod.Namespace, vol.PersistentVolumeClaim.ClaimName)
				id := v2.EdgeID(podID, tgt, "volume_mount")
				if !seen[id] {
					seen[id] = true
					edges = append(edges, v2.TopologyEdge{
						ID:                   id,
						Source:               podID,
						Target:               tgt,
						RelationshipType:     "volume_mount",
						RelationshipCategory: "storage",
						Label:                fmt.Sprintf("mounts → %s", path),
						Detail:               "spec.volumes[].persistentVolumeClaim",
						Style:                "dashed",
						Healthy:              true,
					})
				}
			}
		}
	}
	return edges, nil
}
