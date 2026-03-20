package helm

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"sort"

	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chartutil"
)

// MergeValues deep-merges override into base; override wins. Nested maps are merged recursively.
func MergeValues(base, override map[string]interface{}) map[string]interface{} {
	if base == nil {
		base = make(map[string]interface{})
	}
	if override == nil {
		return base
	}
	out := make(map[string]interface{}, len(base)+len(override))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range override {
		if vMap, ok := v.(map[string]interface{}); ok {
			if bVal, exists := out[k]; exists {
				if bMap, ok := bVal.(map[string]interface{}); ok {
					out[k] = MergeValues(bMap, vMap)
					continue
				}
			}
		}
		out[k] = v
	}
	return out
}

// ValidateValues validates values against the chart's values.schema.json if present.
func ValidateValues(ch *chart.Chart, values map[string]interface{}) error {
	if ch == nil {
		return nil
	}
	return chartutil.ValidateAgainstSchema(ch, values)
}

// secretKeyPattern matches keys that likely hold secrets (case-insensitive).
var secretKeyPattern = regexp.MustCompile(`(?i)(password|passwd|secret|token|key|credential|auth)`)

// RedactSecretValues returns a deep copy of values with secret-like keys replaced by "[REDACTED]".
func RedactSecretValues(values map[string]interface{}) map[string]interface{} {
	if values == nil {
		return nil
	}
	return redactMap(values)
}

func redactMap(m map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(m))
	for k, v := range m {
		if secretKeyPattern.MatchString(k) {
			out[k] = "[REDACTED]"
			continue
		}
		if vMap, ok := v.(map[string]interface{}); ok {
			out[k] = redactMap(vMap)
			continue
		}
		if vSlice, ok := v.([]interface{}); ok {
			out[k] = redactSlice(vSlice)
			continue
		}
		out[k] = v
	}
	return out
}

func redactSlice(s []interface{}) []interface{} {
	out := make([]interface{}, len(s))
	for i, v := range s {
		if vMap, ok := v.(map[string]interface{}); ok {
			out[i] = redactMap(vMap)
			continue
		}
		if vSlice, ok := v.([]interface{}); ok {
			out[i] = redactSlice(vSlice)
			continue
		}
		out[i] = v
	}
	return out
}

// ValuesHash returns a deterministic sha256 hex of values (JSON with sorted keys).
func ValuesHash(values map[string]interface{}) (string, error) {
	if len(values) == 0 {
		return "", nil
	}
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	m := make(map[string]interface{}, len(values))
	for _, k := range keys {
		m[k] = values[k]
	}
	data, err := json.Marshal(m)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

// DefaultValues returns the chart's default values only (no overrides).
func DefaultValues(ch *chart.Chart) (map[string]interface{}, error) {
	if ch == nil {
		return nil, nil
	}
	return chartutil.CoalesceValues(ch, map[string]interface{}{})
}
