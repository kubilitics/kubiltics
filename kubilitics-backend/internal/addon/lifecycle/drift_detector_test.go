package lifecycle

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestSplitYAMLDocuments(t *testing.T) {
	manifest := `
apiVersion: v1
kind: ConfigMap
metadata:
  name: cm1
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: cm2
`
	docs := splitYAMLDocuments(manifest)
	assert.Len(t, docs, 2)
	assert.Contains(t, docs[0], "cm1")
	assert.Contains(t, docs[1], "cm2")

	// Empty
	assert.Len(t, splitYAMLDocuments(""), 0)
	assert.Len(t, splitYAMLDocuments("   \n  "), 0)
}

func TestParseManifestToUnstructured(t *testing.T) {
	manifest := `
apiVersion: v1
kind: ConfigMap
metadata:
  name: cm1
---
invalid yaml that should be skipped
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: cm2
`
	objs, err := parseManifestToUnstructured(manifest)
	assert.NoError(t, err)
	assert.Len(t, objs, 2)
	assert.Equal(t, "cm1", objs[0].GetName())
	assert.Equal(t, "cm2", objs[1].GetName())
}

func TestLabelsSubsetEqual(t *testing.T) {
	desired := map[string]string{"app": "foo", "tier": "web"}
	live := map[string]string{"app": "foo", "tier": "web", "extra": "bar"}
	assert.True(t, labelsSubsetEqual(desired, live))

	liveMissing := map[string]string{"app": "foo"}
	assert.False(t, labelsSubsetEqual(desired, liveMissing))

	liveDiff := map[string]string{"app": "foo", "tier": "db"}
	assert.False(t, labelsSubsetEqual(desired, liveDiff))
}

func TestAnnotationsSubsetEqual(t *testing.T) {
	desired := map[string]string{
		"my-ann":                             "value",
		"kubectl.kubernetes.io/last-applied": "old",
	}
	live := map[string]string{
		"my-ann":                             "value",
		"kubectl.kubernetes.io/last-applied": "new",
		"extra":                              "val",
	}
	// The managed annotation should be ignored.
	assert.True(t, annotationsSubsetEqual(desired, live))

	liveDiff := map[string]string{
		"my-ann": "diff",
	}
	assert.False(t, annotationsSubsetEqual(desired, liveDiff))
}

func TestDesiredSubsetEqual(t *testing.T) {
	desired := map[string]interface{}{
		"replicas": 3,
		"template": map[string]interface{}{
			"spec": map[string]interface{}{
				"containers": []interface{}{
					map[string]interface{}{"name": "web", "image": "nginx"},
				},
			},
		},
	}

	live := map[string]interface{}{
		"replicas":                3,
		"progressDeadlineSeconds": 600, // injected
		"template": map[string]interface{}{
			"spec": map[string]interface{}{
				"dnsPolicy": "ClusterFirst", // injected
				"containers": []interface{}{
					map[string]interface{}{"name": "web", "image": "nginx"},
				},
			},
		},
	}

	assert.True(t, desiredSubsetEqual(desired, live))

	liveDiff := map[string]interface{}{
		"replicas": 2,
		"template": map[string]interface{}{
			"spec": map[string]interface{}{
				"containers": []interface{}{
					map[string]interface{}{"name": "web", "image": "nginx"},
				},
			},
		},
	}
	assert.False(t, desiredSubsetEqual(desired, liveDiff))
}

func TestCompareSpecAndMetadata(t *testing.T) {
	desired := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"metadata": map[string]interface{}{
				"labels": map[string]interface{}{"app": "nginx"},
			},
			"spec": map[string]interface{}{
				"replicas": 1,
			},
		},
	}
	live := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"metadata": map[string]interface{}{
				"labels": map[string]interface{}{"app": "nginx", "injected": "true"},
			},
			"spec": map[string]interface{}{
				"replicas":                1,
				"progressDeadlineSeconds": 600,
			},
		},
	}

	dr, sev := compareSpecAndMetadata(desired, live, "Deployment", "default", "web")
	assert.Nil(t, dr)
	assert.Equal(t, "", sev)

	// Drift
	live.Object["spec"].(map[string]interface{})["replicas"] = 2
	dr, sev = compareSpecAndMetadata(desired, live, "Deployment", "default", "web")
	assert.NotNil(t, dr)
	assert.Equal(t, DriftStructural, sev)
	assert.Equal(t, "spec", dr.Field)

	// ConfigMap drift
	desiredCM := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"data": map[string]interface{}{"key": "val1"},
		},
	}
	liveCM := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"data": map[string]interface{}{"key": "val2"},
		},
	}
	dr, sev = compareSpecAndMetadata(desiredCM, liveCM, "ConfigMap", "default", "cm")
	assert.NotNil(t, dr)
	assert.Equal(t, DriftStructural, sev)
	assert.Equal(t, "data", dr.Field)

	// RBAC drift
	desiredRole := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"rules": []interface{}{map[string]interface{}{"verbs": []interface{}{"get"}}},
		},
	}
	liveRole := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"rules": []interface{}{map[string]interface{}{"verbs": []interface{}{"list"}}},
		},
	}
	dr, sev = compareSpecAndMetadata(desiredRole, liveRole, "Role", "default", "role")
	assert.NotNil(t, dr)
	assert.Equal(t, DriftStructural, sev)
	assert.Equal(t, "rules", dr.Field)
}
