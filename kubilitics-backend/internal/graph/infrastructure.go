package graph

import "strings"

// CriticalComponent defines a known Kubernetes system component with its impact scope.
type CriticalComponent struct {
	ImpactScope string // "cluster-wide" | "node-level" | "control-plane"
	Description string
}

// criticalSystemComponents maps component name prefixes to their definitions.
// Names are matched as prefixes to handle suffixed names like "etcd-control-plane".
var criticalSystemComponents = map[string]CriticalComponent{
	"coredns":                 {ImpactScope: "cluster-wide", Description: "DNS resolution for all services"},
	"kube-proxy":              {ImpactScope: "node-level", Description: "Service networking and iptables rules"},
	"kube-apiserver":          {ImpactScope: "control-plane", Description: "All K8s API operations"},
	"etcd":                    {ImpactScope: "control-plane", Description: "Cluster state store"},
	"kube-controller-manager": {ImpactScope: "control-plane", Description: "Controller reconciliation loops"},
	"kube-scheduler":          {ImpactScope: "control-plane", Description: "Pod scheduling"},
	"metrics-server":          {ImpactScope: "cluster-wide", Description: "HPA and resource metrics"},
}

// matchCriticalComponent checks if a resource in kube-system matches a known critical component.
// Returns the component definition and true if matched, or zero value and false if not.
func matchCriticalComponent(namespace, name string) (CriticalComponent, bool) {
	if namespace != "kube-system" {
		return CriticalComponent{}, false
	}
	lowerName := strings.ToLower(name)
	for prefix, comp := range criticalSystemComponents {
		if strings.HasPrefix(lowerName, prefix) {
			return comp, true
		}
	}
	return CriticalComponent{}, false
}

// isKubeSystemResource returns true if the namespace is kube-system.
func isKubeSystemResource(namespace string) bool {
	return namespace == "kube-system"
}
