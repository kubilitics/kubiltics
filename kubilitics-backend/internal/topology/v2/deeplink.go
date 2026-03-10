package v2

import (
	"fmt"
	"strings"
)

// DeepLink represents a parsed topology deep-link URL.
type DeepLink struct {
	ClusterID string
	Kind      string
	Namespace string
	Name      string
	Mode      ViewMode
}

// DeepLinkPath returns the URL path for a topology deep link.
// Pattern: /topology/{cluster}/resource/{kind}/{ns}/{name}
func DeepLinkPath(clusterID, kind, namespace, name string) string {
	if namespace == "" {
		return fmt.Sprintf("/topology/%s/resource/%s/%s", clusterID, strings.ToLower(kind), name)
	}
	return fmt.Sprintf("/topology/%s/resource/%s/%s/%s", clusterID, strings.ToLower(kind), namespace, name)
}

// DeepLinkForNode returns the deep-link path for a specific topology node.
func DeepLinkForNode(clusterID string, node TopologyNode) string {
	return DeepLinkPath(clusterID, node.Kind, node.Namespace, node.Name)
}

// ParseDeepLink attempts to parse a deep-link path into its components.
// Supported patterns:
//   /topology/{cluster}/resource/{kind}/{ns}/{name}
//   /topology/{cluster}/resource/{kind}/{name}     (cluster-scoped)
//   /topology/{cluster}                            (cluster overview)
//   /topology/{cluster}/ns/{namespace}              (namespace view)
func ParseDeepLink(path string) (*DeepLink, error) {
	path = strings.TrimPrefix(path, "/")
	parts := strings.Split(path, "/")
	if len(parts) < 2 || parts[0] != "topology" {
		return nil, fmt.Errorf("invalid deep link: must start with /topology/")
	}

	dl := &DeepLink{
		ClusterID: parts[1],
		Mode:      ViewModeCluster,
	}

	if len(parts) == 2 {
		return dl, nil
	}

	switch parts[2] {
	case "resource":
		dl.Mode = ViewModeResource
		if len(parts) == 5 {
			// cluster-scoped: /topology/{cluster}/resource/{kind}/{name}
			dl.Kind = parts[3]
			dl.Name = parts[4]
		} else if len(parts) >= 6 {
			// namespaced: /topology/{cluster}/resource/{kind}/{ns}/{name}
			dl.Kind = parts[3]
			dl.Namespace = parts[4]
			dl.Name = parts[5]
		} else {
			return nil, fmt.Errorf("invalid resource deep link: expected /topology/{cluster}/resource/{kind}/{ns}/{name}")
		}
	case "ns":
		dl.Mode = ViewModeNamespace
		if len(parts) >= 4 {
			dl.Namespace = parts[3]
		}
	case "rbac":
		dl.Mode = ViewModeRBAC
		if len(parts) >= 4 {
			dl.Namespace = parts[3]
		}
	case "workload":
		dl.Mode = ViewModeWorkload
		if len(parts) >= 4 {
			dl.Namespace = parts[3]
		}
	default:
		return nil, fmt.Errorf("invalid deep link segment: %s", parts[2])
	}

	return dl, nil
}

// ToOptions converts a DeepLink to topology Options for building the graph.
func (dl *DeepLink) ToOptions() Options {
	resource := ""
	if dl.Kind != "" {
		resource = NodeID(capitalize(dl.Kind), dl.Namespace, dl.Name)
	}
	return Options{
		ClusterID: dl.ClusterID,
		Mode:      dl.Mode,
		Namespace: dl.Namespace,
		Resource:  resource,
		Depth:     2,
	}
}

func capitalize(s string) string {
	if len(s) == 0 {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
