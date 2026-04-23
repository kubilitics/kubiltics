// Package logpattern extracts canonical templates from log lines and
// clusters lines that share a template. All operations are pure string
// transforms with no I/O.
package logpattern

import "regexp"

// Extract applies the ordered strip rules defined in the Week-1 spec and
// returns (template, fields). fields is a diagnostic map (currently not
// populated) reserved for future field-level analysis.
func Extract(line string) (template string, fields map[string]string) {
	template = line
	for _, r := range stripRules {
		template = r.re.ReplaceAllString(template, r.token)
	}
	return template, nil
}

type stripRule struct {
	re    *regexp.Regexp
	token string
}

// stripRules are applied in order; each consumes matches before the next.
// Order matters: ISO-8601 first so port numbers inside timestamps aren't
// chewed by the PORT rule.
var stripRules = []stripRule{
	// 1. ISO-8601 timestamp (with optional fractional seconds + timezone).
	{regexp.MustCompile(`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?`), "{TS}"},
	// 2. UUID v4.
	{regexp.MustCompile(`[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}`), "{UUID}"},
	// 3. IPv4 dotted-quad.
	{regexp.MustCompile(`\b\d+\.\d+\.\d+\.\d+\b`), "{IP}"},
	// 4. Kubernetes pod suffix (hex-8 dash hex-5..10) with leading literal.
	{regexp.MustCompile(`[a-f0-9]{8,10}-[a-f0-9]{5,10}\b`), "{POD}"},
	// 5. Long decimal number (> 4 digits), NOT a 3-digit HTTP status.
	//    Runs before HEX so all-digit tokens like "8273615249" don't get
	//    absorbed by the hex rule (decimals are a subset of hex alphabet).
	{regexp.MustCompile(`\b\d{5,}\b`), "{NUM}"},
	// 6. Long hex token (> 8 chars, all hex) — after UUID + POD + NUM.
	{regexp.MustCompile(`\b[a-f0-9]{9,}\b`), "{HEX}"},
	// 7. TCP/UDP port — only chew ":port" when it follows a host-or-IP-like
	//    prefix (alpha char or the closing "}" of a prior {IP} substitution).
	//    This leaves CLF-style timestamps like "[23/Apr/2026:14:05:11 +0000]"
	//    alone, whose colons are preceded by digits.
	{regexp.MustCompile(`([a-zA-Z}]):\d{2,5}\b`), "${1}:{PORT}"},
}
