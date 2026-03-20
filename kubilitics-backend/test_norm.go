//go:build ignore

package main

import (
	"fmt"
	"strings"
)

// Simplified versions from internal/k8s/resources.go
func NormalizeKindToResource(kind string) string {
	s := strings.ToLower(strings.TrimSpace(kind))
	if s == "" {
		return s
	}
	// Simplified: only check if ends in 's'
	if !strings.HasSuffix(s, "s") {
		return s + "s"
	}
	return s
}

func main() {
	kinds := []string{"Pod", "Service", "IngressClass", "StorageClass", "Deployment", "Namespace"}
	for _, k := range kinds {
		fmt.Printf("Kind: %-15s -> Resource: %s\n", k, NormalizeKindToResource(k))
	}
}
