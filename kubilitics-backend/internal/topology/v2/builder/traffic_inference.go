package builder

import (
	"fmt"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/topology/v2"
)

// TrafficEdge represents an inferred service-to-service traffic flow derived
// from Kubernetes resource relationships rather than live metrics.
type TrafficEdge struct {
	Source     string  `json:"source"`     // source service/pod ID
	Target     string  `json:"target"`     // target service/pod ID
	Type       string  `json:"type"`       // "inferred_traffic", "direct_call"
	Protocol   string  `json:"protocol"`   // TCP, HTTP, gRPC
	Port       int     `json:"port"`       // target port
	Direction  string  `json:"direction"`  // "ingress" or "egress"
	Confidence float64 `json:"confidence"` // 0.0-1.0
}

// InferTraffic derives traffic edges from topology nodes, edges, and the
// underlying Kubernetes resource bundle. It uses five inference rules:
//
//  1. Ingress -> Service: HTTP traffic flow (confidence 0.95)
//  2. Service -> Pod (via selector match): traffic distribution (confidence 0.9)
//  3. Pod -> Service (via env/DNS): outbound calls (confidence 0.7)
//  4. NetworkPolicy ingress rules: allowed cross-namespace traffic (confidence 0.85)
//  5. EndpointSlice ready addresses: active traffic targets (confidence 0.95)
func InferTraffic(nodes []v2.TopologyNode, edges []v2.TopologyEdge, bundle *v2.ResourceBundle) []TrafficEdge {
	var traffic []TrafficEdge

	// Build lookup maps for quick access
	nodeByID := make(map[string]*v2.TopologyNode, len(nodes))
	for i := range nodes {
		nodeByID[nodes[i].ID] = &nodes[i]
	}

	// Rule 1: Ingress -> Service (HTTP traffic, confidence 0.95)
	traffic = append(traffic, inferIngressToService(bundle, nodeByID)...)

	// Rule 2: Service -> Pod via selector (confidence 0.9)
	traffic = append(traffic, inferServiceToPod(edges, nodeByID)...)

	// Rule 3: Pod -> Service via env/DNS (confidence 0.7)
	traffic = append(traffic, inferPodToService(bundle, nodeByID)...)

	// Rule 4: NetworkPolicy ingress rules (confidence 0.85)
	traffic = append(traffic, inferNetworkPolicyTraffic(bundle, nodeByID)...)

	// Rule 5: EndpointSlice ready addresses (confidence 0.95)
	traffic = append(traffic, inferEndpointSliceTraffic(bundle, nodeByID)...)

	return traffic
}

// inferIngressToService creates traffic edges from Ingress resources to the
// Services they route to.
func inferIngressToService(bundle *v2.ResourceBundle, nodeByID map[string]*v2.TopologyNode) []TrafficEdge {
	if bundle == nil {
		return nil
	}
	var result []TrafficEdge
	for i := range bundle.Ingresses {
		ing := &bundle.Ingresses[i]
		ingressID := v2.NodeID("Ingress", ing.Namespace, ing.Name)

		for _, rule := range ing.Spec.Rules {
			if rule.HTTP == nil {
				continue
			}
			for _, path := range rule.HTTP.Paths {
				if path.Backend.Service == nil {
					continue
				}
				svcName := path.Backend.Service.Name
				svcID := v2.NodeID("Service", ing.Namespace, svcName)
				if _, ok := nodeByID[svcID]; !ok {
					continue
				}

				port := 80
				if path.Backend.Service.Port.Number != 0 {
					port = int(path.Backend.Service.Port.Number)
				}

				result = append(result, TrafficEdge{
					Source:     ingressID,
					Target:     svcID,
					Type:       "inferred_traffic",
					Protocol:   "HTTP",
					Port:       port,
					Direction:  "ingress",
					Confidence: 0.95,
				})
			}
		}
	}
	return result
}

// inferServiceToPod creates traffic edges from Services to Pods based on
// existing selector-match edges in the topology graph.
func inferServiceToPod(edges []v2.TopologyEdge, nodeByID map[string]*v2.TopologyNode) []TrafficEdge {
	var result []TrafficEdge
	for i := range edges {
		e := &edges[i]
		srcNode := nodeByID[e.Source]
		tgtNode := nodeByID[e.Target]
		if srcNode == nil || tgtNode == nil {
			continue
		}

		// Service -> Pod edges (selector relationship)
		if srcNode.Kind == "Service" && tgtNode.Kind == "Pod" {
			port := 0
			if srcNode.Extra != nil {
				if ports, ok := srcNode.Extra["ports"]; ok {
					if portList, ok := ports.([]interface{}); ok && len(portList) > 0 {
						if pm, ok := portList[0].(map[string]interface{}); ok {
							if p, ok := pm["port"].(float64); ok {
								port = int(p)
							}
						}
					}
				}
			}
			result = append(result, TrafficEdge{
				Source:     srcNode.ID,
				Target:     tgtNode.ID,
				Type:       "direct_call",
				Protocol:   "TCP",
				Port:       port,
				Direction:  "ingress",
				Confidence: 0.9,
			})
		}
	}
	return result
}

// inferPodToService creates traffic edges from Pods to Services when the pod
// has environment variables referencing KUBERNETES_SERVICE_HOST or service DNS
// names (*.svc.cluster.local).
func inferPodToService(bundle *v2.ResourceBundle, nodeByID map[string]*v2.TopologyNode) []TrafficEdge {
	if bundle == nil {
		return nil
	}

	// Build a lookup of service names per namespace for DNS matching
	svcByNsName := make(map[string]string) // "ns/name" -> nodeID
	for i := range bundle.Services {
		svc := &bundle.Services[i]
		key := svc.Namespace + "/" + svc.Name
		svcByNsName[key] = v2.NodeID("Service", svc.Namespace, svc.Name)
	}

	var result []TrafficEdge
	for i := range bundle.Pods {
		pod := &bundle.Pods[i]
		podID := v2.NodeID("Pod", pod.Namespace, pod.Name)
		if _, ok := nodeByID[podID]; !ok {
			continue
		}

		seen := make(map[string]bool) // deduplicate targets
		for _, c := range pod.Spec.Containers {
			for _, env := range c.Env {
				// Check for KUBERNETES_SERVICE_HOST pattern
				if env.Name == "KUBERNETES_SERVICE_HOST" {
					continue // skip the built-in kubernetes service reference
				}

				// Check env values for service DNS references
				// e.g., "my-service.my-namespace.svc.cluster.local"
				if env.Value == "" {
					continue
				}
				svcRef := extractServiceDNS(env.Value, pod.Namespace, svcByNsName)
				if svcRef != "" && !seen[svcRef] {
					seen[svcRef] = true
					result = append(result, TrafficEdge{
						Source:     podID,
						Target:     svcRef,
						Type:       "inferred_traffic",
						Protocol:   "TCP",
						Port:       0,
						Direction:  "egress",
						Confidence: 0.7,
					})
				}
			}
		}
	}
	return result
}

// extractServiceDNS checks if a value contains a Kubernetes service DNS
// reference and returns the corresponding node ID if the service exists.
func extractServiceDNS(value string, podNamespace string, svcByNsName map[string]string) string {
	// Pattern: <svc>.<ns>.svc.cluster.local or <svc>.<ns>.svc
	if idx := strings.Index(value, ".svc.cluster.local"); idx >= 0 {
		parts := strings.SplitN(value[:idx], ".", 2)
		if len(parts) == 2 {
			key := parts[1] + "/" + parts[0]
			if id, ok := svcByNsName[key]; ok {
				return id
			}
		}
	}
	if idx := strings.Index(value, ".svc"); idx >= 0 && !strings.Contains(value[:idx+4], ".svc.cluster.local") {
		prefix := value[:idx]
		parts := strings.SplitN(prefix, ".", 2)
		if len(parts) == 2 {
			key := parts[1] + "/" + parts[0]
			if id, ok := svcByNsName[key]; ok {
				return id
			}
		}
	}
	// Simple name reference within same namespace
	for _, sep := range []string{"://", "://"} {
		if idx := strings.Index(value, sep); idx >= 0 {
			hostPort := value[idx+len(sep):]
			host := strings.SplitN(hostPort, "/", 2)[0]
			host = strings.SplitN(host, ":", 2)[0]
			key := podNamespace + "/" + host
			if id, ok := svcByNsName[key]; ok {
				return id
			}
		}
	}
	return ""
}

// inferNetworkPolicyTraffic creates traffic edges based on NetworkPolicy
// ingress rules that allow traffic between namespaces.
func inferNetworkPolicyTraffic(bundle *v2.ResourceBundle, nodeByID map[string]*v2.TopologyNode) []TrafficEdge {
	if bundle == nil {
		return nil
	}
	var result []TrafficEdge
	for i := range bundle.NetworkPolicies {
		np := &bundle.NetworkPolicies[i]
		targetNS := np.Namespace

		// Find pods matched by this NetworkPolicy's podSelector in the target namespace
		targetPods := matchPodsByLabels(bundle, targetNS, np.Spec.PodSelector.MatchLabels)

		for _, ingressRule := range np.Spec.Ingress {
			for _, from := range ingressRule.From {
				if from.NamespaceSelector == nil {
					continue
				}

				// Find source namespaces matching the selector
				sourceNamespaces := matchNamespaces(bundle, from.NamespaceSelector.MatchLabels)

				for _, srcNS := range sourceNamespaces {
					// Get pods in source namespace (optionally filtered by podSelector)
					var srcLabels map[string]string
					if from.PodSelector != nil {
						srcLabels = from.PodSelector.MatchLabels
					}
					srcPods := matchPodsByLabels(bundle, srcNS, srcLabels)

					for _, srcPod := range srcPods {
						srcID := v2.NodeID("Pod", srcNS, srcPod)
						if _, ok := nodeByID[srcID]; !ok {
							continue
						}
						for _, tgtPod := range targetPods {
							tgtID := v2.NodeID("Pod", targetNS, tgtPod)
							if _, ok := nodeByID[tgtID]; !ok {
								continue
							}
							port := 0
							protocol := "TCP"
							if len(ingressRule.Ports) > 0 {
								if ingressRule.Ports[0].Port != nil {
									port = ingressRule.Ports[0].Port.IntValue()
								}
								if ingressRule.Ports[0].Protocol != nil {
									protocol = string(*ingressRule.Ports[0].Protocol)
								}
							}
							result = append(result, TrafficEdge{
								Source:     srcID,
								Target:     tgtID,
								Type:       "inferred_traffic",
								Protocol:   protocol,
								Port:       port,
								Direction:  "ingress",
								Confidence: 0.85,
							})
						}
					}
				}
			}
		}
	}
	return result
}

// inferEndpointSliceTraffic creates traffic edges from Services to Pods based
// on EndpointSlice ready addresses — indicating active traffic targets.
func inferEndpointSliceTraffic(bundle *v2.ResourceBundle, nodeByID map[string]*v2.TopologyNode) []TrafficEdge {
	if bundle == nil {
		return nil
	}
	var result []TrafficEdge
	seen := make(map[string]bool)

	for i := range bundle.EndpointSlices {
		eps := &bundle.EndpointSlices[i]

		// Determine the owning Service from the kubernetes.io/service-name label
		svcName := eps.Labels["kubernetes.io/service-name"]
		if svcName == "" {
			continue
		}
		svcID := v2.NodeID("Service", eps.Namespace, svcName)
		if _, ok := nodeByID[svcID]; !ok {
			continue
		}

		port := 0
		protocol := "TCP"
		if len(eps.Ports) > 0 {
			if eps.Ports[0].Port != nil {
				port = int(*eps.Ports[0].Port)
			}
			if eps.Ports[0].Protocol != nil {
				protocol = string(*eps.Ports[0].Protocol)
			}
		}

		for _, endpoint := range eps.Endpoints {
			if endpoint.Conditions.Ready != nil && !*endpoint.Conditions.Ready {
				continue // skip not-ready endpoints
			}
			if endpoint.TargetRef == nil || endpoint.TargetRef.Kind != "Pod" {
				continue
			}
			podNS := eps.Namespace
			if endpoint.TargetRef.Namespace != "" {
				podNS = endpoint.TargetRef.Namespace
			}
			podID := v2.NodeID("Pod", podNS, endpoint.TargetRef.Name)
			if _, ok := nodeByID[podID]; !ok {
				continue
			}

			edgeKey := fmt.Sprintf("%s->%s", svcID, podID)
			if seen[edgeKey] {
				continue
			}
			seen[edgeKey] = true

			result = append(result, TrafficEdge{
				Source:     svcID,
				Target:     podID,
				Type:       "direct_call",
				Protocol:   protocol,
				Port:       port,
				Direction:  "ingress",
				Confidence: 0.95,
			})
		}
	}
	return result
}

// matchPodsByLabels returns pod names in a given namespace that match ALL of
// the specified labels. If labels is nil/empty, all pods in the namespace match.
func matchPodsByLabels(bundle *v2.ResourceBundle, namespace string, labels map[string]string) []string {
	var result []string
	for i := range bundle.Pods {
		pod := &bundle.Pods[i]
		if pod.Namespace != namespace {
			continue
		}
		if labelsMatch(pod.Labels, labels) {
			result = append(result, pod.Name)
		}
	}
	return result
}

// matchNamespaces returns namespace names whose labels match ALL specified labels.
func matchNamespaces(bundle *v2.ResourceBundle, labels map[string]string) []string {
	if len(labels) == 0 {
		// Empty selector matches all namespaces
		result := make([]string, 0, len(bundle.Namespaces))
		for i := range bundle.Namespaces {
			result = append(result, bundle.Namespaces[i].Name)
		}
		return result
	}
	var result []string
	for i := range bundle.Namespaces {
		ns := &bundle.Namespaces[i]
		if labelsMatch(ns.Labels, labels) {
			result = append(result, ns.Name)
		}
	}
	return result
}

// labelsMatch returns true if the resource labels contain all selector labels.
func labelsMatch(resourceLabels, selectorLabels map[string]string) bool {
	for k, v := range selectorLabels {
		if resourceLabels[k] != v {
			return false
		}
	}
	return true
}
