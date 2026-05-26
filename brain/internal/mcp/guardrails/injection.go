package guardrails

import (
	"encoding/json"
	"strings"
	"unicode"
)

// InjectionScanner detects prompt injection attempts embedded in tool
// results.  Kubernetes resources may be named or annotated with adversarial
// strings (e.g. a ConfigMap whose value is "Ignore previous instructions …").
// Before a tool result is handed back to the LLM, every string value is
// checked for known injection patterns.
//
// On a hit the scanner replaces the offending substring with a safe
// sentinel and attaches a top-level `_injection_warning` field so
// operators can audit the event.
type InjectionScanner struct {
	patterns []injectionPattern
}

type injectionPattern struct {
	// label is the name logged/emitted in the warning.
	label string
	// check returns true if the string contains the pattern.
	check func(string) bool
}

// NewInjectionScanner returns a scanner preloaded with production patterns.
func NewInjectionScanner() *InjectionScanner {
	return &InjectionScanner{patterns: defaultPatterns()}
}

// ScanResult carries the (possibly sanitised) result and scan metadata.
type ScanResult struct {
	// Result is the original result with injections neutralised.
	Result interface{}
	// Triggered is true when at least one injection pattern matched.
	Triggered bool
	// Detections is the list of pattern labels that fired.
	Detections []string
}

// Scan inspects result for injection attempts.  The result is serialised
// to JSON and each string value is checked; detected patterns are replaced
// with "[INJECTION NEUTRALISED]".
func (s *InjectionScanner) Scan(result interface{}) ScanResult {
	sr := ScanResult{Result: result}

	// Serialise → walk strings → deserialise is the safest generic approach:
	// it handles any nesting depth without bespoke type switches.
	data, err := json.Marshal(result)
	if err != nil {
		// If we can't marshal, pass through — better a live result than a crash.
		return sr
	}

	// Extract all quoted string values from the JSON and check each one.
	// We rebuild the JSON string with substitutions applied.
	sanitised, detections := s.sanitiseJSON(string(data))
	if len(detections) == 0 {
		return sr
	}

	sr.Triggered = true
	sr.Detections = detections

	// Deserialise the sanitised JSON back into a map.
	var sanitisedResult interface{}
	if err := json.Unmarshal([]byte(sanitised), &sanitisedResult); err != nil {
		// Fallback: attach the warning to the original result map.
		sanitisedResult = result
	}

	// Attach a top-level warning so operators can audit injection events.
	if m, ok := sanitisedResult.(map[string]interface{}); ok {
		m["_injection_warning"] = map[string]interface{}{
			"triggered":  true,
			"detections": detections,
			"message":    "Prompt injection patterns were detected and neutralised in this tool result.",
		}
		sanitisedResult = m
	}

	sr.Result = sanitisedResult
	return sr
}

// sanitiseJSON walks a JSON string, finds all quoted string values, and
// replaces any that contain injection patterns.  Returns the sanitised JSON
// and the list of pattern labels that fired.
func (s *InjectionScanner) sanitiseJSON(jsonStr string) (string, []string) {
	var fired []string
	firedSet := make(map[string]bool)

	// Decode the raw JSON structure.
	var raw interface{}
	if err := json.Unmarshal([]byte(jsonStr), &raw); err != nil {
		return jsonStr, nil
	}

	sanitised := s.walkForScan(raw, firedSet)

	for label := range firedSet {
		fired = append(fired, label)
	}

	out, err := json.Marshal(sanitised)
	if err != nil {
		return jsonStr, fired
	}
	return string(out), fired
}

func (s *InjectionScanner) walkForScan(v interface{}, fired map[string]bool) interface{} {
	switch val := v.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{}, len(val))
		for k, child := range val {
			out[k] = s.walkForScan(child, fired)
		}
		return out
	case []interface{}:
		out := make([]interface{}, len(val))
		for i, item := range val {
			out[i] = s.walkForScan(item, fired)
		}
		return out
	case string:
		return s.sanitiseString(val, fired)
	default:
		return v
	}
}

func (s *InjectionScanner) sanitiseString(str string, fired map[string]bool) string {
	for _, p := range s.patterns {
		if p.check(str) {
			fired[p.label] = true
			str = "[INJECTION NEUTRALISED]"
			break // one substitution per value is enough
		}
	}
	return str
}

// defaultPatterns returns the built-in injection pattern set.
func defaultPatterns() []injectionPattern {
	lc := func(s string) string { return strings.ToLower(s) }
	contains := func(needle string) func(string) bool {
		return func(s string) bool { return strings.Contains(lc(s), needle) }
	}

	return []injectionPattern{
		{
			label: "ignore_instructions",
			check: func(s string) bool {
				l := lc(s)
				return strings.Contains(l, "ignore previous instructions") ||
					strings.Contains(l, "disregard your instructions") ||
					strings.Contains(l, "ignore all previous")
			},
		},
		{
			label: "role_override",
			check: func(s string) bool {
				l := lc(s)
				return strings.Contains(l, "you are now") ||
					strings.Contains(l, "act as a") ||
					strings.Contains(l, "pretend you are") ||
					strings.Contains(l, "your new role is")
			},
		},
		{
			label: "conversation_injection",
			check: func(s string) bool {
				// Anthropic conversation turn markers embedded in data.
				return strings.Contains(s, "\n\nHuman:") ||
					strings.Contains(s, "\n\nAssistant:") ||
					strings.Contains(s, "\n\nUser:")
			},
		},
		{
			label: "fake_tool_call",
			check: func(s string) bool {
				l := lc(s)
				return strings.Contains(l, "<tool_call>") ||
					strings.Contains(l, "<function_call>") ||
					strings.Contains(l, "```tool_code") ||
					strings.Contains(l, "<invoke>")
			},
		},
		{
			label: "end_of_sequence",
			check: func(s string) bool {
				// Common EOS tokens that models use; embedded in data they can
				// cause the model to treat subsequent text as a new turn.
				return strings.Contains(s, "</s>") ||
					strings.Contains(s, "<|endoftext|>") ||
					strings.Contains(s, "<|im_end|>")
			},
		},
		{
			label: "unicode_direction_override",
			// Unicode bidirectional override and BOM characters can visually hide content.
			// Checked via numeric escape to avoid embedding control characters in source.
			check: func(s string) bool {
				dangerous := []rune{
					'‮', // RIGHT-TO-LEFT OVERRIDE
					'⁦', // LEFT-TO-RIGHT ISOLATE
					'⁧', // RIGHT-TO-LEFT ISOLATE
					'⁨', // FIRST STRONG ISOLATE
					'‪', '‫', '‬', '‭', // other bidi controls
					'\uFEFF', // BOM / zero-width no-break space
				}
				for _, r := range s {
					for _, d := range dangerous {
						if r == d {
							return true
						}
					}
				}
				return false
			},
		},
		{
			label: "null_byte",
			check: func(s string) bool {
				return strings.ContainsRune(s, 0) || strings.ContainsRune(s, unicode.ReplacementChar)
			},
		},
		{
			label: "delete_all",
			check: contains("delete all"),
		},
		{
			label: "system_prompt_leak",
			check: func(s string) bool {
				l := lc(s)
				return strings.Contains(l, "repeat your system prompt") ||
					strings.Contains(l, "print your instructions") ||
					strings.Contains(l, "reveal your prompt")
			},
		},
	}
}
