package relationships

import (
	"context"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
	corev1 "k8s.io/api/core/v1"
)

// EnvRefMatcher produces Pod→ConfigMap and Pod→Secret edges from envFrom and env[].valueFrom.
type EnvRefMatcher struct{}

func (EnvRefMatcher) Name() string { return "env_ref" }

func (m *EnvRefMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}
	var edges []v2.TopologyEdge
	seen := make(map[string]bool)

	processContainer := func(podID string, ns string, envFrom []corev1.EnvFromSource, envVars []corev1.EnvVar) {
		for _, e := range envFrom {
			if e.ConfigMapRef != nil {
				tgt := v2.NodeID("ConfigMap", ns, e.ConfigMapRef.Name)
				id := v2.EdgeID(podID, tgt, "env_from")
				if !seen[id] {
					seen[id] = true
					edges = append(edges, v2.TopologyEdge{
						ID:                   id,
						Source:               podID,
						Target:               tgt,
						RelationshipType:     "env_from",
						RelationshipCategory: "configuration",
						Label:                "env from",
						Detail:               "envFrom.configMapRef",
						Style:                "dashed",
						Healthy:              true,
					})
				}
			}
			if e.SecretRef != nil {
				tgt := v2.NodeID("Secret", ns, e.SecretRef.Name)
				id := v2.EdgeID(podID, tgt, "env_from")
				if !seen[id] {
					seen[id] = true
					edges = append(edges, v2.TopologyEdge{
						ID:                   id,
						Source:               podID,
						Target:               tgt,
						RelationshipType:     "env_from",
						RelationshipCategory: "configuration",
						Label:                "env from",
						Detail:               "envFrom.secretRef",
						Style:                "dashed",
						Healthy:              true,
					})
				}
			}
		}
		for _, e := range envVars {
			if e.ValueFrom == nil {
				continue
			}
			keyLabel := e.Name
			if e.ValueFrom.ConfigMapKeyRef != nil {
				tgt := v2.NodeID("ConfigMap", ns, e.ValueFrom.ConfigMapKeyRef.Name)
				id := v2.EdgeID(podID, tgt, "env_key")
				if !seen[id] {
					seen[id] = true
					edges = append(edges, v2.TopologyEdge{
						ID:                   id,
						Source:               podID,
						Target:               tgt,
						RelationshipType:     "env_ref",
						RelationshipCategory: "configuration",
						Label:                fmt.Sprintf("env: %s", keyLabel),
						Detail:               "env[].valueFrom.configMapKeyRef",
						Style:                "dashed",
						Healthy:              true,
					})
				}
			}
			if e.ValueFrom.SecretKeyRef != nil {
				tgt := v2.NodeID("Secret", ns, e.ValueFrom.SecretKeyRef.Name)
				id := v2.EdgeID(podID, tgt, "env_key")
				if !seen[id] {
					seen[id] = true
					edges = append(edges, v2.TopologyEdge{
						ID:                   id,
						Source:               podID,
						Target:               tgt,
						RelationshipType:     "env_ref",
						RelationshipCategory: "configuration",
						Label:                fmt.Sprintf("env: %s", keyLabel),
						Detail:               "env[].valueFrom.secretKeyRef",
						Style:                "dashed",
						Healthy:              true,
					})
				}
			}
		}
	}

	for i := range bundle.Pods {
		pod := &bundle.Pods[i]
		podID := v2.NodeID("Pod", pod.Namespace, pod.Name)
		for c := range pod.Spec.Containers {
			cont := &pod.Spec.Containers[c]
			processContainer(podID, pod.Namespace, cont.EnvFrom, cont.Env)
		}
		for c := range pod.Spec.InitContainers {
			cont := &pod.Spec.InitContainers[c]
			processContainer(podID, pod.Namespace, cont.EnvFrom, cont.Env)
		}
		for c := range pod.Spec.EphemeralContainers {
			ec := &pod.Spec.EphemeralContainers[c]
			processContainer(podID, pod.Namespace, ec.EnvFrom, ec.Env)
		}
	}
	return edges, nil
}
