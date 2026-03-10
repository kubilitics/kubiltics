package relationships

import (
	"context"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// WebhookMatcher produces MutatingWebhook/ValidatingWebhook→Service edges via clientConfig.service.
type WebhookMatcher struct{}

func (WebhookMatcher) Name() string { return "webhook" }

func (m *WebhookMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}
	var edges []v2.TopologyEdge

	for i := range bundle.MutatingWebhooks {
		cfg := &bundle.MutatingWebhooks[i]
		whID := v2.NodeID("MutatingWebhookConfiguration", "", cfg.Name)
		for j := range cfg.Webhooks {
			wh := &cfg.Webhooks[j]
			if wh.ClientConfig.Service != nil {
				svc := wh.ClientConfig.Service
				ns := svc.Namespace
				if ns == "" {
					ns = "default"
				}
				tgt := v2.NodeID("Service", ns, svc.Name)
				edges = append(edges, v2.TopologyEdge{
					ID:                   v2.EdgeID(whID, tgt, "webhook_service"),
					Source:               whID,
					Target:               tgt,
					RelationshipType:     "webhook_service",
					RelationshipCategory: "policy",
					Label:                "calls",
					Detail:               "webhooks[].clientConfig.service",
					Style:                "dashed",
					Healthy:              true,
				})
			}
		}
	}
	for i := range bundle.ValidatingWebhooks {
		cfg := &bundle.ValidatingWebhooks[i]
		whID := v2.NodeID("ValidatingWebhookConfiguration", "", cfg.Name)
		for j := range cfg.Webhooks {
			wh := &cfg.Webhooks[j]
			if wh.ClientConfig.Service != nil {
				svc := wh.ClientConfig.Service
				ns := svc.Namespace
				if ns == "" {
					ns = "default"
				}
				tgt := v2.NodeID("Service", ns, svc.Name)
				edges = append(edges, v2.TopologyEdge{
					ID:                   v2.EdgeID(whID, tgt, "webhook_service"),
					Source:               whID,
					Target:               tgt,
					RelationshipType:     "webhook_service",
					RelationshipCategory: "policy",
					Label:                "calls",
					Detail:               "webhooks[].clientConfig.service",
					Style:                "dashed",
					Healthy:              true,
				})
			}
		}
	}
	return edges, nil
}
