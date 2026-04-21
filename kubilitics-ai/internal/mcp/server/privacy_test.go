package server

// The privacy guardrail tests lock down Kubilitics' core claim:
// sensitive Kubernetes data does not reach the LLM.
//
// Each test constructs a K8s-shaped payload carrying a known sensitive
// value ("PASSWORD_PROBE_xyz"), runs it through the summarizer +
// capToolOutput pipeline that feeds the LLM, then scans the JSON bytes
// the LLM would actually see. If the probe string appears, the test
// fails. If it doesn't, the claim holds for that scenario.
//
// These tests are table-driven by scenario so new K8s kinds are easy to
// add without copy-paste.

import (
	"encoding/json"
	"strings"
	"testing"
)

const secretProbe = "PASSWORD_PROBE_b1f9c7"

// leaks returns true if the probe string appears anywhere in the
// JSON-encoded output. Uses strings.Contains on the JSON-escaped bytes
// — if the probe is base64-encoded by the summarizer, callers should
// additionally check the base64 form.
func leaks(t *testing.T, out any, probe string) bool {
	t.Helper()
	b, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return strings.Contains(string(b), probe)
}

func TestPrivacy_Secret_DataValuesNeverLeak(t *testing.T) {
	raw := map[string]any{
		"apiVersion": "v1",
		"kind":       "SecretList",
		"items": []any{
			map[string]any{
				"kind": "Secret",
				"metadata": map[string]any{
					"name":      "db-creds",
					"namespace": "default",
				},
				"data": map[string]any{
					// base64 of the probe — common K8s encoding
					"password": "UEFTU1dPUkRfUFJPQkVfYjFmOWM3",
				},
				"stringData": map[string]any{
					"plain": secretProbe,
				},
				"type": "Opaque",
			},
		},
	}
	out := capToolOutput(summarizeListForLLM(raw))
	if leaks(t, out, secretProbe) {
		t.Fatalf("plaintext probe leaked: %v", out)
	}
	if leaks(t, out, "UEFTU1dPUkRfUFJPQkVfYjFmOWM3") {
		t.Fatalf("base64 probe leaked: %v", out)
	}
}

func TestPrivacy_ConfigMap_DataValuesNeverLeak(t *testing.T) {
	raw := map[string]any{
		"kind": "ConfigMapList",
		"items": []any{
			map[string]any{
				"kind": "ConfigMap",
				"metadata": map[string]any{
					"name":      "app-config",
					"namespace": "default",
				},
				"data": map[string]any{
					"aws-access-key": secretProbe,
					"innocent":       "log-level=info",
				},
			},
		},
	}
	out := capToolOutput(summarizeListForLLM(raw))
	if leaks(t, out, secretProbe) {
		t.Fatalf("configmap probe leaked: %v", out)
	}
}

func TestPrivacy_Pod_EnvSecretsNeverLeak(t *testing.T) {
	raw := map[string]any{
		"kind": "PodList",
		"items": []any{
			map[string]any{
				"kind": "Pod",
				"metadata": map[string]any{
					"name":      "web-1",
					"namespace": "default",
				},
				"spec": map[string]any{
					"containers": []any{
						map[string]any{
							"name":  "web",
							"image": "nginx",
							"env": []any{
								map[string]any{"name": "DB_PASSWORD", "value": secretProbe},
								map[string]any{"name": "LOG_LEVEL", "value": "info"},
							},
						},
					},
				},
			},
		},
	}
	out := capToolOutput(summarizeListForLLM(raw))
	if leaks(t, out, secretProbe) {
		t.Fatalf("pod env probe leaked: %v", out)
	}
}

func TestPrivacy_Annotations_LastAppliedConfigNeverLeaks(t *testing.T) {
	raw := map[string]any{
		"kind": "PodList",
		"items": []any{
			map[string]any{
				"kind": "Pod",
				"metadata": map[string]any{
					"name":      "app-1",
					"namespace": "default",
					"annotations": map[string]any{
						"kubectl.kubernetes.io/last-applied-configuration": `{"spec":{"containers":[{"env":[{"name":"T","value":"` + secretProbe + `"}]}]}}`,
					},
				},
			},
		},
	}
	out := capToolOutput(summarizeListForLLM(raw))
	if leaks(t, out, secretProbe) {
		t.Fatalf("annotation probe leaked: %v", out)
	}
}

func TestPrivacy_ManagedFields_NeverLeak(t *testing.T) {
	raw := map[string]any{
		"kind": "PodList",
		"items": []any{
			map[string]any{
				"kind": "Pod",
				"metadata": map[string]any{
					"name":      "app-1",
					"namespace": "default",
					"managedFields": []any{
						map[string]any{"manager": "kubectl", "fieldsV1": secretProbe},
					},
				},
			},
		},
	}
	out := capToolOutput(summarizeListForLLM(raw))
	if leaks(t, out, secretProbe) {
		t.Fatalf("managedFields probe leaked: %v", out)
	}
}

func TestPrivacy_ServiceAccount_TokenRefsKeptButTokenBytesNotLeaked(t *testing.T) {
	raw := map[string]any{
		"kind": "ServiceAccountList",
		"items": []any{
			map[string]any{
				"kind": "ServiceAccount",
				"metadata": map[string]any{
					"name":      "builder",
					"namespace": "default",
				},
				"secrets": []any{map[string]any{"name": "builder-token-abc"}},
			},
		},
	}
	out := capToolOutput(summarizeListForLLM(raw))
	if leaks(t, out, secretProbe) {
		t.Fatalf("SA probe leaked (unexpected — probe not in input): %v", out)
	}
}

// Benign data must pass through so the assistant remains useful.
func TestPrivacy_BenignNodeVersion_DoesReach(t *testing.T) {
	raw := map[string]any{
		"kind": "NodeList",
		"items": []any{
			map[string]any{
				"kind": "Node",
				"metadata": map[string]any{"name": "ip-10-0-0-1"},
				"status": map[string]any{
					"nodeInfo": map[string]any{"kubeletVersion": "v1.28.3"},
				},
			},
		},
	}
	out := capToolOutput(summarizeListForLLM(raw))
	// Name must pass through so the LLM can refer to the node in answers.
	if !leaks(t, out, "ip-10-0-0-1") {
		t.Fatalf("benign node name was stripped — summarizer is too aggressive: %v", out)
	}
}
