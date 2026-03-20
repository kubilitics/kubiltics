package rbac

import (
	"fmt"
	"strings"

	"github.com/kubilitics/kubilitics-backend/internal/models"
	"gopkg.in/yaml.v3"
)

// GenerateManifestYAML generates Role/ClusterRole and RoleBinding/ClusterRoleBinding YAML
// from addon RBAC rules. Scope "cluster" produces ClusterRole + ClusterRoleBinding;
// "namespace" produces Role + RoleBinding in the given namespace.
func GenerateManifestYAML(rules []models.AddOnRBACRule, namespace, addonID string) (string, error) {
	if len(rules) == 0 {
		return "# No RBAC rules defined for this add-on\n", nil
	}
	var out strings.Builder
	safeName := strings.ReplaceAll(addonID, "/", "-")
	if safeName == "" {
		safeName = "addon"
	}
	roleName := safeName + "-role"
	bindingName := safeName + "-rolebinding"

	// Group rules by scope so we emit one Role/ClusterRole per scope type
	var clusterRules []policyRule
	var nsRules []policyRule
	for _, r := range rules {
		pr := policyRule{APIGroups: r.APIGroups, Resources: r.Resources, Verbs: r.Verbs}
		if r.Scope == string(models.ScopeCluster) {
			clusterRules = append(clusterRules, pr)
		} else {
			nsRules = append(nsRules, pr)
		}
	}

	if len(clusterRules) > 0 {
		clusterRole := map[string]interface{}{
			"apiVersion": "rbac.authorization.k8s.io/v1",
			"kind":       "ClusterRole",
			"metadata":   map[string]interface{}{"name": roleName + "-cluster"},
			"rules":      rulesToMaps(clusterRules),
		}
		b, err := yaml.Marshal(clusterRole)
		if err != nil {
			return "", fmt.Errorf("marshal ClusterRole: %w", err)
		}
		out.Write(b)
		out.WriteString("---\n")
		clusterBinding := map[string]interface{}{
			"apiVersion": "rbac.authorization.k8s.io/v1",
			"kind":       "ClusterRoleBinding",
			"metadata":   map[string]interface{}{"name": bindingName + "-cluster"},
			"roleRef": map[string]interface{}{
				"apiGroup": "rbac.authorization.k8s.io",
				"kind":     "ClusterRole",
				"name":     roleName + "-cluster",
			},
			"subjects": []map[string]interface{}{
				{"kind": "ServiceAccount", "name": "default", "namespace": namespace},
			},
		}
		b, err = yaml.Marshal(clusterBinding)
		if err != nil {
			return "", fmt.Errorf("marshal ClusterRoleBinding: %w", err)
		}
		out.Write(b)
		out.WriteString("---\n")
	}

	if len(nsRules) > 0 {
		if namespace == "" {
			namespace = "default"
		}
		role := map[string]interface{}{
			"apiVersion": "rbac.authorization.k8s.io/v1",
			"kind":       "Role",
			"metadata": map[string]interface{}{
				"name":      roleName,
				"namespace": namespace,
			},
			"rules": rulesToMaps(nsRules),
		}
		b, err := yaml.Marshal(role)
		if err != nil {
			return "", fmt.Errorf("marshal Role: %w", err)
		}
		out.Write(b)
		out.WriteString("---\n")
		binding := map[string]interface{}{
			"apiVersion": "rbac.authorization.k8s.io/v1",
			"kind":       "RoleBinding",
			"metadata": map[string]interface{}{
				"name":      bindingName,
				"namespace": namespace,
			},
			"roleRef": map[string]interface{}{
				"apiGroup": "rbac.authorization.k8s.io",
				"kind":     "Role",
				"name":     roleName,
			},
			"subjects": []map[string]interface{}{
				{"kind": "ServiceAccount", "name": "default", "namespace": namespace},
			},
		}
		b, err = yaml.Marshal(binding)
		if err != nil {
			return "", fmt.Errorf("marshal RoleBinding: %w", err)
		}
		out.Write(b)
	}

	return strings.TrimSuffix(out.String(), "---\n"), nil
}

type policyRule struct {
	APIGroups []string
	Resources []string
	Verbs     []string
}

func rulesToMaps(rules []policyRule) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(rules))
	for _, r := range rules {
		m := map[string]interface{}{
			"verbs": r.Verbs,
		}
		if len(r.APIGroups) > 0 {
			m["apiGroups"] = r.APIGroups
		}
		if len(r.Resources) > 0 {
			m["resources"] = r.Resources
		}
		out = append(out, m)
	}
	return out
}
