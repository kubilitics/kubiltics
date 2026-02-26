package helm

import (
	"reflect"
	"testing"
)

func TestMergeValues(t *testing.T) {
	tests := []struct {
		name     string
		base     map[string]interface{}
		override map[string]interface{}
		expected map[string]interface{}
	}{
		{
			name: "flat merge",
			base: map[string]interface{}{
				"a": 1,
				"b": 2,
			},
			override: map[string]interface{}{
				"b": 3,
				"c": 4,
			},
			expected: map[string]interface{}{
				"a": 1,
				"b": 3,
				"c": 4,
			},
		},
		{
			name: "nested merge",
			base: map[string]interface{}{
				"global": map[string]interface{}{
					"image": "nginx",
					"tag":   "latest",
				},
			},
			override: map[string]interface{}{
				"global": map[string]interface{}{
					"tag": "1.21",
				},
				"replicaCount": 2,
			},
			expected: map[string]interface{}{
				"global": map[string]interface{}{
					"image": "nginx",
					"tag":   "1.21",
				},
				"replicaCount": 2,
			},
		},
		{
			name:     "nil base",
			base:     nil,
			override: map[string]interface{}{"a": 1},
			expected: map[string]interface{}{"a": 1},
		},
		{
			name:     "nil override",
			base:     map[string]interface{}{"a": 1},
			override: nil,
			expected: map[string]interface{}{"a": 1},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := MergeValues(tt.base, tt.override)
			if !reflect.DeepEqual(got, tt.expected) {
				t.Errorf("MergeValues() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestRedactSecretValues(t *testing.T) {
	input := map[string]interface{}{
		"apiToken":   "super-secret",
		"dbPassword": "password123",
		"normal":     "value",
		"nested": map[string]interface{}{
			"secret": "hidden",
			"safe":   "ok",
		},
		"list": []interface{}{
			map[string]interface{}{"token": "t1"},
			"plain",
		},
	}

	expected := map[string]interface{}{
		"apiToken":   "[REDACTED]",
		"dbPassword": "[REDACTED]",
		"normal":     "value",
		"nested": map[string]interface{}{
			"secret": "[REDACTED]",
			"safe":   "ok",
		},
		"list": []interface{}{
			map[string]interface{}{"token": "[REDACTED]"},
			"plain",
		},
	}

	got := RedactSecretValues(input)
	if !reflect.DeepEqual(got, expected) {
		t.Errorf("RedactSecretValues() = %v, want %v", got, expected)
	}
}

func TestValuesHash(t *testing.T) {
	v1 := map[string]interface{}{"a": 1, "b": 2}
	v2 := map[string]interface{}{"b": 2, "a": 1}

	h1, err := ValuesHash(v1)
	if err != nil {
		t.Fatalf("ValuesHash(v1) error: %v", err)
	}

	h2, err := ValuesHash(v2)
	if err != nil {
		t.Fatalf("ValuesHash(v2) error: %v", err)
	}

	if h1 != h2 {
		t.Errorf("ValuesHash should be deterministic: %s != %s", h1, h2)
	}

	if h1 == "" {
		t.Errorf("ValuesHash should not be empty")
	}
}

// TestRedactSecretValues_NestedMap verifies that nested secret keys are redacted.
func TestRedactSecretValues_NestedMap(t *testing.T) {
	input := map[string]interface{}{
		"db": map[string]interface{}{
			"password": "super-secret",
			"host":     "db.example.com",
		},
		"app": map[string]interface{}{
			"replicas": 3,
		},
	}

	got := RedactSecretValues(input)

	dbMap, ok := got["db"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected db to be a map, got %T", got["db"])
	}
	if dbMap["password"] != "[REDACTED]" {
		t.Errorf("db.password = %v, want [REDACTED]", dbMap["password"])
	}
	if dbMap["host"] != "db.example.com" {
		t.Errorf("db.host = %v, want db.example.com (non-secret should be preserved)", dbMap["host"])
	}
	appMap, ok := got["app"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected app to be a map, got %T", got["app"])
	}
	if appMap["replicas"] != 3 {
		t.Errorf("app.replicas = %v, want 3 (non-secret should be preserved)", appMap["replicas"])
	}
}

// TestValuesHash_Deterministic verifies that hashing the same map multiple times always
// produces the same hex string, regardless of Go map iteration order.
func TestValuesHash_Deterministic(t *testing.T) {
	m := map[string]interface{}{
		"replicaCount": 3,
		"image":        map[string]interface{}{"tag": "latest"},
		"service":      map[string]interface{}{"port": 80, "type": "ClusterIP"},
	}

	h1, err := ValuesHash(m)
	if err != nil {
		t.Fatalf("ValuesHash first call: %v", err)
	}
	h2, err := ValuesHash(m)
	if err != nil {
		t.Fatalf("ValuesHash second call: %v", err)
	}
	if h1 != h2 {
		t.Errorf("ValuesHash not deterministic: %s != %s", h1, h2)
	}
	if len(h1) != 64 {
		t.Errorf("expected SHA-256 hex length 64, got %d", len(h1))
	}
}

// TestMergeValues_DeepMerge verifies that a nested override wins without destroying
// sibling keys in the base map.
func TestMergeValues_DeepMerge(t *testing.T) {
	base := map[string]interface{}{
		"global": map[string]interface{}{
			"image":      "nginx",
			"tag":        "1.20",
			"pullPolicy": "IfNotPresent",
		},
		"replicaCount": 1,
	}
	override := map[string]interface{}{
		"global": map[string]interface{}{
			"tag": "1.25", // override only tag; image and pullPolicy must survive
		},
	}

	got := MergeValues(base, override)

	globalMap, ok := got["global"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected global to be a map, got %T", got["global"])
	}
	if globalMap["tag"] != "1.25" {
		t.Errorf("global.tag = %v, want 1.25 (override should win)", globalMap["tag"])
	}
	if globalMap["image"] != "nginx" {
		t.Errorf("global.image = %v, want nginx (sibling key should survive deep merge)", globalMap["image"])
	}
	if globalMap["pullPolicy"] != "IfNotPresent" {
		t.Errorf("global.pullPolicy = %v, want IfNotPresent (sibling key should survive deep merge)", globalMap["pullPolicy"])
	}
	if got["replicaCount"] != 1 {
		t.Errorf("replicaCount = %v, want 1 (top-level key should survive)", got["replicaCount"])
	}
}

func TestValidateValues_NilChart(t *testing.T) {
	err := ValidateValues(nil, map[string]interface{}{})
	if err != nil {
		t.Errorf("ValidateValues with nil chart should return nil error, got %v", err)
	}
}

func TestDefaultValues_NilChart(t *testing.T) {
	vals, err := DefaultValues(nil)
	if err != nil {
		t.Errorf("DefaultValues with nil chart should return nil error, got %v", err)
	}
	if vals != nil {
		t.Errorf("DefaultValues with nil chart should return nil values, got %v", vals)
	}
}
