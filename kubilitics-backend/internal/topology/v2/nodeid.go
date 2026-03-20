package v2

import "fmt"

// NodeID returns the canonical node ID for a resource: "Kind/namespace/name" or "Kind/name" for cluster-scoped.
func NodeID(kind, namespace, name string) string {
	if namespace == "" {
		return kind + "/" + name
	}
	return kind + "/" + namespace + "/" + name
}

// EdgeID returns a unique edge ID for (source, target, relationshipType).
func EdgeID(source, target string, relationshipType string) string {
	return fmt.Sprintf("%s|%s|%s", source, target, relationshipType)
}
