package guardrails

import (
	"encoding/base64"
	"regexp"
	"strings"
)

// Redactor scrubs sensitive values from tool results before they are
// returned to the LLM.  It operates recursively on map[string]interface{}
// trees so no JSON re-serialization is needed.
//
// Two strategies run in sequence:
//  1. Key-name matching — any map key whose name suggests a secret (password,
//     token, api_key …) gets its value replaced with "[REDACTED]".
//  2. Value-pattern matching — string values are scanned with regexes that
//     recognise well-known secret shapes (AWS access keys, GitHub PATs,
//     OpenAI keys, long base64 blobs).
type Redactor struct {
	sensitiveKeys map[string]bool
	patterns      []*regexp.Regexp
}

// NewRedactor creates a production-ready Redactor.
func NewRedactor() *Redactor {
	return &Redactor{
		sensitiveKeys: buildSensitiveKeySet(),
		patterns:      buildSecretPatterns(),
	}
}

// Redact walks result, replacing sensitive values in-place and returning
// a count of how many values were redacted.  It never modifies the
// original result map — it returns a deep copy with substitutions.
func (r *Redactor) Redact(result interface{}) (interface{}, int) {
	return r.walk(result)
}

func (r *Redactor) walk(v interface{}) (interface{}, int) {
	count := 0
	switch val := v.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{}, len(val))
		for k, child := range val {
			if r.isSensitiveKey(k) {
				if _, isStr := child.(string); isStr && child != "" {
					out[k] = "[REDACTED]"
					count++
				} else {
					out[k] = child
				}
			} else {
				walked, n := r.walk(child)
				out[k] = walked
				count += n
			}
		}
		return out, count

	case []interface{}:
		out := make([]interface{}, len(val))
		for i, item := range val {
			walked, n := r.walk(item)
			out[i] = walked
			count += n
		}
		return out, count

	case string:
		if redacted, n := r.redactString(val); n > 0 {
			return redacted, n
		}
		return val, 0

	default:
		return v, 0
	}
}

func (r *Redactor) isSensitiveKey(key string) bool {
	return r.sensitiveKeys[strings.ToLower(key)]
}

func (r *Redactor) redactString(s string) (string, int) {
	count := 0
	for _, pat := range r.patterns {
		if pat.MatchString(s) {
			s = pat.ReplaceAllString(s, "[REDACTED]")
			count++
		}
	}
	return s, count
}

// buildSensitiveKeySet returns the set of map key names that always get redacted.
func buildSensitiveKeySet() map[string]bool {
	keys := []string{
		"password", "passwd", "pass",
		"secret", "secrets",
		"token", "access_token", "refresh_token", "id_token",
		"api_key", "apikey", "api-key",
		"private_key", "privatekey", "private-key",
		"credential", "credentials",
		"authorization", "auth",
		"bearer",
		"client_secret", "client-secret",
		"aws_secret_access_key", "aws_access_key_id",
		"database_password", "db_password",
		"encryption_key", "signing_key",
		"jwt_secret",
		"tls_key", "ssl_key",
	}
	m := make(map[string]bool, len(keys))
	for _, k := range keys {
		m[k] = true
	}
	return m
}

// buildSecretPatterns returns regexes that recognise common secret shapes.
func buildSecretPatterns() []*regexp.Regexp {
	patterns := []string{
		// AWS access key ID
		`AKIA[A-Z0-9]{16}`,
		// AWS secret (40-char hex-ish)
		`(?i)aws.{0,10}secret.{0,10}[A-Za-z0-9/+=]{40}`,
		// GitHub PAT
		`ghp_[A-Za-z0-9]{36,}`,
		// GitHub fine-grained PAT
		`github_pat_[A-Za-z0-9_]{80,}`,
		// OpenAI key
		`sk-[A-Za-z0-9]{48,}`,
		// Generic Bearer token (at least 32 chars)
		`(?i)bearer\s+[A-Za-z0-9\-._~+/]{32,}`,
		// Base64-encoded blob ≥ 60 chars (likely a key or certificate fragment)
		`[A-Za-z0-9+/]{60,}={0,2}`,
	}
	compiled := make([]*regexp.Regexp, 0, len(patterns))
	for _, p := range patterns {
		compiled = append(compiled, regexp.MustCompile(p))
	}
	return compiled
}

// isBase64 is a helper used in tests to verify whether a string is valid
// base64-encoded data (used to generate test fixtures that would be redacted).
func isBase64(s string) bool {
	_, err := base64.StdEncoding.DecodeString(s)
	return err == nil
}
