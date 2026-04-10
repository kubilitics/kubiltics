package relationships

import (
	"context"
	"fmt"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// IngressMatcher produces Ingress→Service, Ingress→IngressClass, Ingress→Secret (TLS) edges.
type IngressMatcher struct{}

func (IngressMatcher) Name() string { return "ingress" }

func (m *IngressMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}
	var edges []v2.TopologyEdge

	for i := range bundle.Ingresses {
		ing := &bundle.Ingresses[i]
		ingID := v2.NodeID("Ingress", ing.Namespace, ing.Name)
		if ing.Spec.IngressClassName != nil && *ing.Spec.IngressClassName != "" {
			tgt := v2.NodeID("IngressClass", "", *ing.Spec.IngressClassName)
			edges = append(edges, v2.TopologyEdge{
				ID:                   v2.EdgeID(ingID, tgt, "ingress_class"),
				Source:               ingID,
				Target:               tgt,
				RelationshipType:     "ingress_class",
				RelationshipCategory: "networking",
				Label:                "class",
				Detail:               "spec.ingressClassName",
				Style:                "dashed",
				Healthy:              true,
			})
		}
		for _, rule := range ing.Spec.Rules {
			if rule.HTTP == nil {
				continue
			}
			for _, path := range rule.HTTP.Paths {
				if path.Backend.Service != nil {
					tgt := v2.NodeID("Service", ing.Namespace, path.Backend.Service.Name)
					var label string
					if path.Backend.Service.Port.Name != "" {
						label = fmt.Sprintf("routes /%s → %s", path.Path, path.Backend.Service.Port.Name)
					} else if path.Backend.Service.Port.Number != 0 {
						label = fmt.Sprintf("routes /%s → :%d", path.Path, path.Backend.Service.Port.Number)
					} else {
						label = fmt.Sprintf("routes /%s", path.Path)
					}
					edges = append(edges, v2.TopologyEdge{
						ID:                   v2.EdgeID(ingID, tgt, "ingress_backend"),
						Source:               ingID,
						Target:               tgt,
						RelationshipType:     "ingress_backend",
						RelationshipCategory: "networking",
						Label:                label,
						Detail:               "spec.rules[].http.paths[].backend.service",
						Style:                "dashed",
						Healthy:              true,
					})
				}
			}
		}
		if ing.Spec.DefaultBackend != nil && ing.Spec.DefaultBackend.Service != nil {
			tgt := v2.NodeID("Service", ing.Namespace, ing.Spec.DefaultBackend.Service.Name)
			edges = append(edges, v2.TopologyEdge{
				ID:                   v2.EdgeID(ingID, tgt, "ingress_default"),
				Source:               ingID,
				Target:               tgt,
				RelationshipType:     "ingress_backend",
				RelationshipCategory: "networking",
				Label:                "default backend",
				Detail:               "spec.defaultBackend.service",
				Style:                "dashed",
				Healthy:              true,
			})
		}
		for _, tls := range ing.Spec.TLS {
			if len(tls.SecretName) > 0 {
				tgt := v2.NodeID("Secret", ing.Namespace, tls.SecretName)
				edges = append(edges, v2.TopologyEdge{
					ID:                   v2.EdgeID(ingID, tgt, "ingress_tls"),
					Source:               ingID,
					Target:               tgt,
					RelationshipType:     "ingress_tls",
					RelationshipCategory: "networking",
					Label:                "TLS cert",
					Detail:               "spec.tls[].secretName",
					Style:                "dashed",
					Healthy:              true,
				})
			}
		}
	}
	return edges, nil
}
