package relationships

import (
	"context"
	"fmt"
	"strings"

	v2 "github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// CrossNamespaceDNSMatcher discovers cross-namespace service dependencies
// by scanning pod env var values and container args for Kubernetes service
// DNS patterns: svc-name.namespace.svc.cluster.local (or shorter forms).
//
// This is critical for blast radius accuracy — without it, cross-namespace
// dependencies are invisible even though they represent real production traffic.
type CrossNamespaceDNSMatcher struct{}

func (CrossNamespaceDNSMatcher) Name() string { return "cross_ns_dns" }

func (m *CrossNamespaceDNSMatcher) Match(ctx context.Context, bundle *v2.ResourceBundle) ([]v2.TopologyEdge, error) {
	if bundle == nil {
		return nil, nil
	}

	// Build Service lookup: "name.namespace" -> Service node ID
	svcByDNS := make(map[string]string) // "svc.ns" -> nodeID
	for i := range bundle.Services {
		svc := &bundle.Services[i]
		// Multiple DNS patterns for the same service:
		// svc-name.namespace.svc.cluster.local
		// svc-name.namespace.svc
		// svc-name.namespace
		key := svc.Name + "." + svc.Namespace
		nodeID := v2.NodeID("Service", svc.Namespace, svc.Name)
		svcByDNS[key+".svc.cluster.local"] = nodeID
		svcByDNS[key+".svc"] = nodeID
		svcByDNS[key] = nodeID
	}

	var edges []v2.TopologyEdge
	seen := make(map[string]bool)

	checkValue := func(podID, podNs, envName, value string) {
		if value == "" {
			return
		}
		for dns, svcNodeID := range svcByDNS {
			idx := strings.Index(value, dns)
			if idx < 0 {
				continue
			}
			// Check left boundary: must be start of string or non-alphanumeric/non-hyphen
			if idx > 0 {
				ch := value[idx-1]
				if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' {
					continue
				}
			}
			// Check right boundary: must be end of string or non-alphanumeric/non-hyphen
			endIdx := idx + len(dns)
			if endIdx < len(value) {
				ch := value[endIdx]
				if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' {
					continue
				}
			}
			// Extract the service's namespace from the DNS pattern
			parts := strings.SplitN(dns, ".", 3)
			if len(parts) < 2 {
				continue
			}
			svcNs := parts[1]
			// Only create edge if it's CROSS-namespace (same-ns is already handled by SelectorMatcher)
			if svcNs == podNs {
				continue
			}

			edgeKey := podID + "|" + svcNodeID
			if seen[edgeKey] {
				continue
			}
			seen[edgeKey] = true

			detail := fmt.Sprintf("env %s references %s", envName, dns)
			edges = append(edges, v2.TopologyEdge{
				ID:                   v2.EdgeID(podID, svcNodeID, "cross_ns_dns"),
				Source:               podID,
				Target:               svcNodeID,
				RelationshipType:     "cross_ns_dns",
				RelationshipCategory: "networking",
				Label:                "cross-ns dependency",
				Detail:               detail,
				Style:                "dashed",
				Healthy:              true,
			})
		}
	}

	for i := range bundle.Pods {
		pod := &bundle.Pods[i]
		podID := v2.NodeID("Pod", pod.Namespace, pod.Name)

		for _, c := range pod.Spec.Containers {
			// Check env var values
			for _, env := range c.Env {
				checkValue(podID, pod.Namespace, env.Name, env.Value)
			}
			// Check container args
			for _, arg := range c.Args {
				checkValue(podID, pod.Namespace, "arg", arg)
			}
			// Check container command
			for _, cmd := range c.Command {
				checkValue(podID, pod.Namespace, "command", cmd)
			}
		}

		for _, c := range pod.Spec.InitContainers {
			for _, env := range c.Env {
				checkValue(podID, pod.Namespace, env.Name, env.Value)
			}
		}
	}

	return edges, nil
}
