package cli

import (
	"strings"
	"testing"
)

func TestParseRunbookCmd(t *testing.T) {
	tests := []struct {
		cmd  string
		want []string
	}{
		{"kcli why pod/foo", []string{"why", "pod/foo"}},
		{"why pod/foo", []string{"why", "pod/foo"}},
		{"kcli get deployment/api -n prod", []string{"get", "deployment/api", "-n", "prod"}},
		{"describe pod/x -n default", []string{"describe", "pod/x", "-n", "default"}},
	}
	for _, tt := range tests {
		t.Run(tt.cmd, func(t *testing.T) {
			got := parseRunbookCmd(tt.cmd)
			if len(got) != len(tt.want) {
				t.Errorf("parseRunbookCmd(%q) = %v, want %v", tt.cmd, got, tt.want)
				return
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("parseRunbookCmd(%q)[%d] = %q, want %q", tt.cmd, i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestSubstituteVars(t *testing.T) {
	vars := map[string]string{"pod": "crashed-xyz", "owner": "api", "namespace": "prod"}
	got := substituteVars("kcli why pod/{pod} -n {namespace}", vars)
	want := "kcli why pod/crashed-xyz -n prod"
	if got != want {
		t.Errorf("substituteVars = %q, want %q", got, want)
	}
}

func TestEvalRunbookCondition(t *testing.T) {
	a := &app{}
	tests := []struct {
		cond string
		vars map[string]string
		want bool
	}{
		{"namespace == production", map[string]string{"namespace": "production"}, true},
		{"namespace == production", map[string]string{"namespace": "staging"}, false},
		{"namespace != production", map[string]string{"namespace": "staging"}, true},
		{"confidence > 0.80", map[string]string{"confidence": "0.85"}, true},
		{"confidence > 0.80", map[string]string{"confidence": "0.50"}, false},
		{"confidence >= 0.80", map[string]string{"confidence": "0.80"}, true},
	}
	for i, tt := range tests {
		t.Run(strings.ReplaceAll(tt.cond, " ", "_")+"_"+string(rune('a'+i)), func(t *testing.T) {
			got := a.evalRunbookCondition(tt.cond, tt.vars)
			if got != tt.want {
				t.Errorf("evalRunbookCondition(%q, %v) = %v, want %v", tt.cond, tt.vars, got, tt.want)
			}
		})
	}
}
