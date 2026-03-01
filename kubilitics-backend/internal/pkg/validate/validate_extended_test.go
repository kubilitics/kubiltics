package validate

import (
	"testing"
)

func TestClusterID_Valid(t *testing.T) {
	validIDs := []string{
		"cluster-1",
		"cluster_123",
		"test-cluster",
		"a",
		"cluster123",
		"CLUSTER-123",
		"test_cluster_123",
	}

	for _, id := range validIDs {
		if !ClusterID(id) {
			t.Errorf("Expected '%s' to be valid cluster ID", id)
		}
	}
}

func TestClusterID_Invalid(t *testing.T) {
	invalidIDs := []string{
		"",
		"cluster with spaces",
		"cluster@123",
		"cluster#123",
		"cluster.123",
		"cluster/123",
		"cluster:123",
		string(make([]byte, ClusterIDMaxLen+1)), // Too long
	}

	for _, id := range invalidIDs {
		if ClusterID(id) {
			t.Errorf("Expected '%s' to be invalid cluster ID", id)
		}
	}
}

func TestKind_Valid(t *testing.T) {
	validKinds := []string{
		"Pod",
		"Deployment",
		"Service",
		"ConfigMap",
		"Secret",
		"a",
		"Pod123",
		"DeploymentV1",
	}

	for _, kind := range validKinds {
		if !Kind(kind) {
			t.Errorf("Expected '%s' to be valid kind", kind)
		}
	}
}

func TestKind_Invalid(t *testing.T) {
	invalidKinds := []string{
		"",
		"pod-with-dash",
		"pod_with_underscore",
		"pod.with.dot",
		"pod/with/slash",
		string(make([]byte, 65)), // Too long
	}

	for _, kind := range invalidKinds {
		if Kind(kind) {
			t.Errorf("Expected '%s' to be invalid kind", kind)
		}
	}
}

func TestNamespace_Valid(t *testing.T) {
	validNamespaces := []string{
		"",
		"default",
		"kube-system",
		"my-namespace",
		"namespace123",
		"my.namespace",
		"a",
	}

	for _, ns := range validNamespaces {
		if !Namespace(ns) {
			t.Errorf("Expected '%s' to be valid namespace", ns)
		}
	}
}

func TestNamespace_Invalid(t *testing.T) {
	invalidNamespaces := []string{
		"namespace with spaces",
		"namespace@123",
		"namespace#123",
		string(make([]byte, 254)), // Too long
	}

	for _, ns := range invalidNamespaces {
		if Namespace(ns) {
			t.Errorf("Expected '%s' to be invalid namespace", ns)
		}
	}
}

func TestName_Valid(t *testing.T) {
	validNames := []string{
		"pod-name",
		"deployment123",
		"my.resource",
		"a",
		"test-resource-name",
	}

	for _, name := range validNames {
		if !Name(name) {
			t.Errorf("Expected '%s' to be valid name", name)
		}
	}
}

func TestName_Invalid(t *testing.T) {
	invalidNames := []string{
		"",
		"name with spaces",
		"name@123",
		string(make([]byte, 254)), // Too long
	}

	for _, name := range invalidNames {
		if Name(name) {
			t.Errorf("Expected '%s' to be invalid name", name)
		}
	}
}

func TestApplyYAMLDangerousWarnings_HostPID(t *testing.T) {
	yaml := `
apiVersion: v1
kind: Pod
metadata:
  name: test-pod
spec:
  hostPID: true
  containers:
  - name: test
    image: nginx
`
	warnings := ApplyYAMLDangerousWarnings(yaml)
	if len(warnings) == 0 {
		t.Error("Expected warning for hostPID")
	}
	found := false
	for _, w := range warnings {
		if contains(w, "hostPID") {
			found = true
			break
		}
	}
	if !found {
		t.Error("Expected warning about hostPID")
	}
}

func TestApplyYAMLDangerousWarnings_Privileged(t *testing.T) {
	yaml := `
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: test
    image: nginx
    securityContext:
      privileged: true
`
	warnings := ApplyYAMLDangerousWarnings(yaml)
	if len(warnings) == 0 {
		t.Error("Expected warning for privileged")
	}
	found := false
	for _, w := range warnings {
		if contains(w, "privileged") {
			found = true
			break
		}
	}
	if !found {
		t.Error("Expected warning about privileged")
	}
}

func TestApplyYAMLDangerousWarnings_HostNetwork(t *testing.T) {
	yaml := `
apiVersion: v1
kind: Pod
spec:
  hostNetwork: true
  containers:
  - name: test
    image: nginx
`
	warnings := ApplyYAMLDangerousWarnings(yaml)
	if len(warnings) == 0 {
		t.Error("Expected warning for hostNetwork")
	}
	found := false
	for _, w := range warnings {
		if contains(w, "hostNetwork") {
			found = true
			break
		}
	}
	if !found {
		t.Error("Expected warning about hostNetwork")
	}
}

func TestApplyYAMLDangerousWarnings_NoWarnings(t *testing.T) {
	yaml := `
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: test
    image: nginx
`
	warnings := ApplyYAMLDangerousWarnings(yaml)
	if len(warnings) > 0 {
		t.Errorf("Expected no warnings, got %d", len(warnings))
	}
}

func TestApplyYAMLDangerousWarnings_MultiDoc(t *testing.T) {
	yaml := `
---
apiVersion: v1
kind: Pod
spec:
  hostPID: true
---
apiVersion: v1
kind: Pod
spec:
  privileged: true
`
	warnings := ApplyYAMLDangerousWarnings(yaml)
	if len(warnings) < 2 {
		t.Errorf("Expected at least 2 warnings, got %d", len(warnings))
	}
}

// --- PatchJSONDangerousWarnings tests ---

func TestPatchJSONDangerousWarnings_HostPID(t *testing.T) {
	patch := map[string]interface{}{
		"spec": map[string]interface{}{
			"template": map[string]interface{}{
				"spec": map[string]interface{}{
					"hostPID": true,
				},
			},
		},
	}
	warnings := PatchJSONDangerousWarnings(patch)
	if len(warnings) == 0 {
		t.Error("Expected warning for hostPID in JSON patch")
	}
	found := false
	for _, w := range warnings {
		if contains(w, "hostPID") {
			found = true
			break
		}
	}
	if !found {
		t.Error("Expected warning about hostPID")
	}
}

func TestPatchJSONDangerousWarnings_Privileged(t *testing.T) {
	patch := map[string]interface{}{
		"spec": map[string]interface{}{
			"template": map[string]interface{}{
				"spec": map[string]interface{}{
					"containers": []interface{}{
						map[string]interface{}{
							"name":  "test",
							"image": "nginx",
							"securityContext": map[string]interface{}{
								"privileged": true,
							},
						},
					},
				},
			},
		},
	}
	warnings := PatchJSONDangerousWarnings(patch)
	if len(warnings) == 0 {
		t.Error("Expected warning for privileged in JSON patch")
	}
	found := false
	for _, w := range warnings {
		if contains(w, "privileged") {
			found = true
			break
		}
	}
	if !found {
		t.Error("Expected warning about privileged")
	}
}

func TestPatchJSONDangerousWarnings_HostNetwork(t *testing.T) {
	patch := map[string]interface{}{
		"spec": map[string]interface{}{
			"hostNetwork": true,
		},
	}
	warnings := PatchJSONDangerousWarnings(patch)
	if len(warnings) == 0 {
		t.Error("Expected warning for hostNetwork in JSON patch")
	}
	found := false
	for _, w := range warnings {
		if contains(w, "hostNetwork") {
			found = true
			break
		}
	}
	if !found {
		t.Error("Expected warning about hostNetwork")
	}
}

func TestPatchJSONDangerousWarnings_NoWarnings(t *testing.T) {
	patch := map[string]interface{}{
		"spec": map[string]interface{}{
			"replicas": 3,
		},
	}
	warnings := PatchJSONDangerousWarnings(patch)
	if len(warnings) > 0 {
		t.Errorf("Expected no warnings for safe patch, got %d: %v", len(warnings), warnings)
	}
}

func TestPatchJSONDangerousWarnings_MultipleWarnings(t *testing.T) {
	patch := map[string]interface{}{
		"spec": map[string]interface{}{
			"hostPID":     true,
			"hostNetwork": true,
			"containers": []interface{}{
				map[string]interface{}{
					"securityContext": map[string]interface{}{
						"privileged": true,
					},
				},
			},
		},
	}
	warnings := PatchJSONDangerousWarnings(patch)
	if len(warnings) < 3 {
		t.Errorf("Expected at least 3 warnings (hostPID, hostNetwork, privileged), got %d: %v", len(warnings), warnings)
	}
}

func TestPatchJSONDangerousWarnings_EmptyPatch(t *testing.T) {
	patch := map[string]interface{}{}
	warnings := PatchJSONDangerousWarnings(patch)
	if len(warnings) > 0 {
		t.Errorf("Expected no warnings for empty patch, got %d", len(warnings))
	}
}

func TestPatchJSONDangerousWarnings_FalseValues(t *testing.T) {
	// Explicitly setting dangerous fields to false should NOT trigger warnings
	patch := map[string]interface{}{
		"spec": map[string]interface{}{
			"hostPID":     false,
			"hostNetwork": false,
			"containers": []interface{}{
				map[string]interface{}{
					"securityContext": map[string]interface{}{
						"privileged": false,
					},
				},
			},
		},
	}
	warnings := PatchJSONDangerousWarnings(patch)
	if len(warnings) > 0 {
		t.Errorf("Expected no warnings when dangerous fields are false, got %d: %v", len(warnings), warnings)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || 
		(len(s) > len(substr) && 
		(s[:len(substr)] == substr || 
		s[len(s)-len(substr):] == substr || 
		containsMiddle(s, substr))))
}

func containsMiddle(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
