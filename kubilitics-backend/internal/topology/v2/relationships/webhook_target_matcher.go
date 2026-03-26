package relationships

import (
	"context"
	"fmt"
	"strings"

	admissionv1 "k8s.io/api/admissionregistration/v1"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// WebhookTargetMatcher produces MutatingWebhookConfiguration→Namespace edges
// based on webhook rules and namespace selectors.
type WebhookTargetMatcher struct{}

func (WebhookTargetMatcher) Name() string { return "webhook_target" }

func (m *WebhookTargetMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}

	var edges []v2.TopologyEdge

	for i := range bundle.MutatingWebhooks {
		cfg := &bundle.MutatingWebhooks[i]
		whID := v2.NodeID("MutatingWebhookConfiguration", "", cfg.Name)

		for j := range cfg.Webhooks {
			wh := &cfg.Webhooks[j]

			// Build a human-readable label from the webhook rules.
			label := buildRuleLabel(wh.Rules)

			// Determine which namespaces this webhook applies to.
			if wh.NamespaceSelector != nil && len(wh.NamespaceSelector.MatchLabels) > 0 {
				// Match namespaces by label selector.
				for k := range bundle.Namespaces {
					ns := &bundle.Namespaces[k]
					if matchesLabels(ns.Labels, wh.NamespaceSelector.MatchLabels) {
						tgt := v2.NodeID("Namespace", "", ns.Name)
						edges = append(edges, v2.TopologyEdge{
							ID:                   v2.EdgeID(whID, tgt, "webhook_intercepts"),
							Source:               whID,
							Target:               tgt,
							RelationshipType:     "webhook_intercepts",
							RelationshipCategory: "policy",
							Label:                label,
							Detail:               "webhooks[].namespaceSelector",
							Style:                "dashed",
							Healthy:              true,
						})
					}
				}
			} else {
				// No namespaceSelector — webhook applies to all namespaces.
				for k := range bundle.Namespaces {
					ns := &bundle.Namespaces[k]
					tgt := v2.NodeID("Namespace", "", ns.Name)
					edges = append(edges, v2.TopologyEdge{
						ID:                   v2.EdgeID(whID, tgt, "webhook_intercepts"),
						Source:               whID,
						Target:               tgt,
						RelationshipType:     "webhook_intercepts",
						RelationshipCategory: "policy",
						Label:                label,
						Detail:               "webhooks[].rules (all namespaces)",
						Style:                "dashed",
						Healthy:              true,
					})
				}
			}
		}
	}
	return edges, nil
}

// matchesLabels returns true if all selector key/value pairs exist in the labels map.
func matchesLabels(labels, selector map[string]string) bool {
	for k, v := range selector {
		if labels[k] != v {
			return false
		}
	}
	return true
}

// buildRuleLabel constructs a label string from webhook rules.
func buildRuleLabel(rules []admissionv1.RuleWithOperations) string {
	if len(rules) == 0 {
		return "intercepts: *"
	}
	var parts []string
	for _, rule := range rules {
		resources := strings.Join(rule.Resources, ",")
		ops := make([]string, len(rule.Operations))
		for i, op := range rule.Operations {
			ops[i] = string(op)
		}
		operations := strings.Join(ops, ",")
		parts = append(parts, fmt.Sprintf("intercepts: %s on %s", resources, operations))
	}
	return strings.Join(parts, "; ")
}
