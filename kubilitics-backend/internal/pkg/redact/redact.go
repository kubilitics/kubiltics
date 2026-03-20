// Package redact provides helpers to avoid exposing secret values in API responses or logs (C3.2).
package redact

const redactedValue = "***REDACTED***"

// SecretData redacts Kubernetes Secret .data and .stringData values in obj (in place).
// Keeps key names so clients know which keys exist; values are replaced with ***REDACTED***.
func SecretData(obj map[string]interface{}) {
	if obj == nil {
		return
	}
	if data, ok := obj["data"].(map[string]interface{}); ok {
		for k := range data {
			data[k] = redactedValue
		}
	}
	if stringData, ok := obj["stringData"].(map[string]interface{}); ok {
		for k := range stringData {
			stringData[k] = redactedValue
		}
	}
}

// IsSecretKind returns true if kind (e.g. "Secret", "secrets") indicates a Kubernetes Secret.
func IsSecretKind(kind string) bool {
	switch kind {
	case "Secret", "secret", "Secrets", "secrets":
		return true
	}
	return false
}
