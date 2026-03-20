// Package validate provides input validation for API path and body parameters (D1.1, D1.2, BE-DATA-001).
package validate

import (
	"regexp"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// ClusterIDMaxLen is the maximum allowed length for clusterId (stored in DB, used in paths).
const ClusterIDMaxLen = 128

// K8s name regex: DNS subdomain (RFC 1123) — lowercase alphanumeric, '-' or '.', max 253 for namespace/name.
// We use a conservative subset: alphanumeric and hyphen, 1–253 chars.
var k8sNameRe = regexp.MustCompile(`^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$`)

// ClusterID validates clusterId from path: alphanumeric, hyphen, underscore; 1–ClusterIDMaxLen.
func ClusterID(id string) bool {
	if id == "" || len(id) > ClusterIDMaxLen {
		return false
	}
	for _, r := range id {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			continue
		}
		return false
	}
	return true
}

// Kind validates Kubernetes resource kind: alphanumeric, no path chars; 1–64 chars.
func Kind(kind string) bool {
	if kind == "" || len(kind) > 64 {
		return false
	}
	for _, r := range kind {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			continue
		}
		return false
	}
	return true
}

// Namespace validates namespace: empty (cluster-scoped) or valid DNS subdomain.
func Namespace(ns string) bool {
	if ns == "" {
		return true
	}
	if len(ns) > 253 {
		return false
	}
	return k8sNameRe.MatchString(strings.ToLower(ns))
}

// Name validates resource name: valid DNS subdomain.
func Name(name string) bool {
	if name == "" || len(name) > 253 {
		return false
	}
	return k8sNameRe.MatchString(strings.ToLower(name))
}

// ResourceName validates a user-provided name for projects, addons, release names, etc.
// Enforces DNS-safe naming: lowercase alphanumeric and hyphens, max 253 chars.
// Returns an empty string on valid input, or a human-readable error message.
func ResourceName(name string) string {
	if name == "" {
		return "name is required"
	}
	if len(name) > 253 {
		return "name must be at most 253 characters"
	}
	if !k8sNameRe.MatchString(strings.ToLower(name)) {
		return "name must consist of lowercase alphanumeric characters, '-' or '.', and must start and end with an alphanumeric character (RFC 1123 DNS subdomain)"
	}
	return ""
}

// ApplyYAMLDangerousWarnings parses YAML (single or multi-doc) and returns warnings for dangerous pod/container settings (BE-DATA-001).
// Example: hostPID: true, privileged: true. Caller may log and optionally reject.
func ApplyYAMLDangerousWarnings(yamlContent string) []string {
	var warnings []string
	docs := splitYAMLDocs(yamlContent)
	for _, doc := range docs {
		doc = strings.TrimSpace(doc)
		if doc == "" {
			continue
		}
		var m map[string]interface{}
		if err := yaml.Unmarshal([]byte(doc), &m); err != nil {
			continue // invalid YAML fragment; apply will fail later
		}
		walkForDangerous(m, "", &warnings)
	}
	return warnings
}

func splitYAMLDocs(content string) []string {
	return strings.Split(content, "---")
}

func walkForDangerous(node interface{}, path string, warnings *[]string) {
	switch n := node.(type) {
	case map[string]interface{}:
		for k, v := range n {
			p := path + "/" + k
			switch strings.ToLower(k) {
			case "hostpid":
				if b, ok := toBool(v); ok && b {
					*warnings = append(*warnings, pathKey(p)+"hostPID: true (pod can see host PID namespace)")
				}
			case "privileged":
				if b, ok := toBool(v); ok && b {
					*warnings = append(*warnings, pathKey(p)+"privileged: true (container runs privileged)")
				}
			case "hostnetwork":
				if b, ok := toBool(v); ok && b {
					*warnings = append(*warnings, pathKey(p)+"hostNetwork: true (pod uses host network)")
				}
			}
			walkForDangerous(v, p, warnings)
		}
	case []interface{}:
		for i, v := range n {
			walkForDangerous(v, path+"/["+strconv.Itoa(i)+"]", warnings)
		}
	}
}

func pathKey(p string) string {
	if p == "" {
		return ""
	}
	return p + " "
}

func toBool(v interface{}) (bool, bool) {
	b, ok := v.(bool)
	return b, ok
}

// PatchJSONDangerousWarnings inspects a JSON merge-patch body (map[string]interface{}) for
// dangerous pod/container security settings (BE-DATA-001). Returns warnings for fields like
// hostPID: true, privileged: true, hostNetwork: true — same checks as ApplyYAMLDangerousWarnings.
func PatchJSONDangerousWarnings(patch map[string]interface{}) []string {
	var warnings []string
	walkForDangerous(patch, "", &warnings)
	return warnings
}
