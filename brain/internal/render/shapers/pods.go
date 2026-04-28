// Package shapers contains per-tool transforms from raw MCP tool
// output to wire-shape render data. This is deterministic — the LLM
// is never involved.
package shapers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"time"
)

// Shapers is the registry of tool name → shaper function. Every
// Deterministic tool in render.registry MUST have an entry here
// (enforced by an architecture test in package render).
// Shapers maps a tool name to the function that turns its raw output
// into wire-shape render data. Every Deterministic tool in
// render.registry MUST have an entry here — enforced at build time
// by render.TestDeterministicToolsHaveShapers.
//
// All inspect_<kind> tools share ShapeGetResource because they all
// return rich nested JSON that the YamlBlock renderer pretty-prints
// directly. Adding a new inspect tool is a one-line registration in
// both this map and render.registry.
var Shapers = map[string]func(json.RawMessage) (json.RawMessage, error){
	// — Phase 1 production tools —
	"list_resources": ShapeListResources,
	"get_resource":   ShapeGetResource,

	// — Phase 2 #4: log-oriented tools —
	"get_logs": ShapeGetLogs,

	// — Phase 2 #3: inspect_<kind> family — all reuse ShapeGetResource —
	"inspect_pod":                ShapeGetResource,
	"inspect_deployment":         ShapeGetResource,
	"inspect_replicaset":         ShapeGetResource,
	"inspect_statefulset":        ShapeGetResource,
	"inspect_daemonset":          ShapeGetResource,
	"inspect_job":                ShapeGetResource,
	"inspect_cronjob":            ShapeGetResource,
	"inspect_node":               ShapeGetResource,
	"inspect_namespace":          ShapeGetResource,
	"inspect_crd":                ShapeGetResource,
	"inspect_service":            ShapeGetResource,
	"inspect_ingress":            ShapeGetResource,
	"inspect_networkpolicy":      ShapeGetResource,
	"inspect_pvc":                ShapeGetResource,
	"inspect_pv":                 ShapeGetResource,
	"inspect_storageclass":       ShapeGetResource,
	"inspect_configmap":          ShapeGetResource,
	"inspect_secret":             ShapeGetResource,
	"inspect_role":               ShapeGetResource,
	"inspect_rolebinding":        ShapeGetResource,
	"inspect_clusterrole":        ShapeGetResource,
	"inspect_clusterrolebinding": ShapeGetResource,
	"inspect_limitrange":         ShapeGetResource,
	"inspect_resourcequota":      ShapeGetResource,
	"inspect_hpa":                ShapeGetResource,
	"inspect_vpa":                ShapeGetResource,
	"inspect_pdb":                ShapeGetResource,

	// — Test-only fixture-driven entries —
	"list_pods":    ShapeListPods,
	"get_pod_yaml": ShapeGetPodYaml,
}

// listResourcesPayload mirrors the actual production return of the
// brain's list_resources MCP tool. Each item carries K8s-style nested
// metadata/spec/status — confirmed via runtime probe at
// /tmp/render-diag.log against a live cluster.
type listResourcesPayload struct {
	ItemCount int                      `json:"item_count"`
	Items     []map[string]interface{} `json:"items"`
}

// ShapeListResources turns the list_resources tool result into a
// kubectl-style table. Columns: NAME, NAMESPACE, STATUS, AGE.
// NAMESPACE is dropped if every row shares the same namespace.
func ShapeListResources(raw json.RawMessage) (json.RawMessage, error) {
	var p listResourcesPayload
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, fmt.Errorf("list_resources shaper: %w", err)
	}

	// Extract per-row name/namespace/phase/age from the nested K8s
	// shape. Tolerate missing fields silently — render correctness
	// must not depend on every K8s resource shape having every field.
	type extracted struct {
		Name, Namespace, Status, Age string
	}
	rowsExt := make([]extracted, 0, len(p.Items))
	for _, it := range p.Items {
		var e extracted
		if md, ok := it["metadata"].(map[string]interface{}); ok {
			if v, ok := md["name"].(string); ok {
				e.Name = v
			}
			if v, ok := md["namespace"].(string); ok {
				e.Namespace = v
			}
			if ts, ok := md["creationTimestamp"].(string); ok {
				if t, err := time.Parse(time.RFC3339, ts); err == nil {
					e.Age = humanAge(t)
				}
			}
		}
		if st, ok := it["status"].(map[string]interface{}); ok {
			if v, ok := st["phase"].(string); ok {
				e.Status = v
			}
		}
		// Fallback to top-level "name"/"status" if metadata is missing
		// (some kinds return flat shapes).
		if e.Name == "" {
			if v, ok := it["name"].(string); ok {
				e.Name = v
			}
		}
		if e.Status == "" {
			if v, ok := it["status"].(string); ok {
				e.Status = v
			}
		}
		rowsExt = append(rowsExt, e)
	}

	allSameNS := true
	if len(rowsExt) > 0 {
		first := rowsExt[0].Namespace
		for _, r := range rowsExt[1:] {
			if r.Namespace != first {
				allSameNS = false
				break
			}
		}
	}

	cols := []column{{Key: "NAME", Label: "NAME"}}
	if !allSameNS {
		cols = append(cols, column{Key: "NAMESPACE", Label: "NAMESPACE"})
	}
	cols = append(cols, column{Key: "STATUS", Label: "STATUS"}, column{Key: "AGE", Label: "AGE"})

	rows := make([]map[string]interface{}, len(rowsExt))
	for i, e := range rowsExt {
		row := map[string]interface{}{
			"NAME":   e.Name,
			"STATUS": statusOrDefault(e.Status),
			"AGE":    e.Age,
		}
		if !allSameNS {
			row["NAMESPACE"] = e.Namespace
		}
		rows[i] = row
	}
	return json.Marshal(table{Columns: cols, Rows: rows})
}

func statusOrDefault(s string) string {
	if s == "" {
		return "Unknown"
	}
	return s
}

// ShapeGetResource turns the get_resource tool result (ResourceDetail
// shape: kind/name/namespace/status/labels/annotations/spec/status_info)
// into a YAML-ish text block for the YamlBlock renderer.
func ShapeGetResource(raw json.RawMessage) (json.RawMessage, error) {
	// The simplest fidelity-preserving rendering is to pretty-print
	// the JSON and label it as YAML-style. A future revision can
	// re-marshal as actual YAML using a yaml encoder; for now the
	// frontend's YamlBlock just renders the text in <pre>.
	var pretty bytes.Buffer
	if err := json.Indent(&pretty, raw, "", "  "); err != nil {
		return nil, fmt.Errorf("get_resource shaper: %w", err)
	}
	out, err := json.Marshal(struct {
		Yaml string `json:"yaml"`
	}{Yaml: pretty.String()})
	return out, err
}

type column struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Align string `json:"align,omitempty"`
}

type table struct {
	Columns []column                 `json:"columns"`
	Rows    []map[string]interface{} `json:"rows"`
}

type podLite struct {
	Metadata struct {
		Name              string    `json:"name"`
		Namespace         string    `json:"namespace"`
		CreationTimestamp time.Time `json:"creationTimestamp"`
	} `json:"metadata"`
	Spec struct {
		Containers []struct{ Name string `json:"name"` } `json:"containers"`
	} `json:"spec"`
	Status struct {
		Phase             string `json:"phase"`
		ContainerStatuses []struct {
			Ready        bool `json:"ready"`
			RestartCount int  `json:"restartCount"`
		} `json:"containerStatuses"`
	} `json:"status"`
}

func ShapeListPods(raw json.RawMessage) (json.RawMessage, error) {
	var pods []podLite
	if err := json.Unmarshal(raw, &pods); err != nil {
		return nil, fmt.Errorf("list_pods shaper: %w", err)
	}
	t := table{
		Columns: []column{
			{Key: "NAME", Label: "NAME"},
			{Key: "READY", Label: "READY"},
			{Key: "STATUS", Label: "STATUS"},
			{Key: "RESTARTS", Label: "RESTARTS", Align: "right"},
			{Key: "AGE", Label: "AGE"},
		},
		Rows: make([]map[string]interface{}, len(pods)),
	}
	for i, p := range pods {
		ready := 0
		restarts := 0
		for _, cs := range p.Status.ContainerStatuses {
			if cs.Ready { ready++ }
			restarts += cs.RestartCount
		}
		t.Rows[i] = map[string]interface{}{
			"NAME":     p.Metadata.Name,
			"READY":    fmt.Sprintf("%d/%d", ready, len(p.Spec.Containers)),
			"STATUS":   p.Status.Phase,
			"RESTARTS": restarts,
			"AGE":      humanAge(p.Metadata.CreationTimestamp),
		}
	}
	return json.Marshal(t)
}

func humanAge(t time.Time) string {
	if t.IsZero() { return "?" }
	d := time.Since(t)
	if d < 0 { return "?" } // future timestamp (clock skew); avoid negative duration strings
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	}
}

// ShapeGetPodYaml is a passthrough — the tool already returns
// {"yaml": "..."}. We re-marshal to enforce the wire shape.
func ShapeGetPodYaml(raw json.RawMessage) (json.RawMessage, error) {
	var in struct{ Yaml string `json:"yaml"` }
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, fmt.Errorf("get_pod_yaml shaper: %w", err)
	}
	out, err := json.Marshal(struct {
		Yaml string `json:"yaml"`
	}{Yaml: in.Yaml})
	return out, err
}
