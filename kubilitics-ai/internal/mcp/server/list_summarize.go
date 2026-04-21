package server

import "encoding/json"

// MaxToolOutputBytes is the hard ceiling on the JSON-serialized tool
// result returned to the LLM. gpt-4o-mini's output budget collapses
// beyond ~20KB per tool result — it calls the tool, gets the wall of
// JSON, then emits zero text on the final turn. This cap is enforced
// blanket-fashion by capToolOutput so no single tool handler can
// torpedo the turn regardless of how lazy it is about pre-summarizing.
const MaxToolOutputBytes = 8 * 1024

// capToolOutput ensures a tool result serializes to at most
// MaxToolOutputBytes. Under budget → unchanged. Over budget → trim the
// largest list-valued field (usually "items"), keep a top-level
// item_count if we had one, and set the _truncated / _truncated_reason
// markers so the LLM can tell the operator "showing first N of M".
//
// Preserving item_count is the load-bearing move: for list/count
// questions the model can still truthfully say "49 pods" even when
// per-pod detail has been cut.
func capToolOutput(v interface{}) interface{} {
	if v == nil {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return v // can't size it; pass through rather than drop the result
	}
	if len(b) <= MaxToolOutputBytes {
		return v
	}

	m, ok := v.(map[string]interface{})
	if !ok {
		// Non-map (array, string) over budget. Stringify and cut.
		trunc := string(b)
		if len(trunc) > MaxToolOutputBytes-200 {
			trunc = trunc[:MaxToolOutputBytes-200]
		}
		return map[string]interface{}{
			"_truncated":        true,
			"_truncated_reason": "tool returned a large non-object payload; showing the first bytes",
			"preview":           trunc,
		}
	}

	// We have a map. Shallow-copy and trim the largest slice-valued field.
	out := make(map[string]interface{}, len(m))
	for k, val := range m {
		out[k] = val
	}
	out["_truncated"] = true
	out["_truncated_reason"] = "tool output exceeded 8KB; per-item detail reduced"

	trimKey := ""
	if _, ok := out["items"].([]interface{}); ok {
		trimKey = "items"
	} else {
		maxLen := 0
		for k, val := range out {
			if arr, ok := val.([]interface{}); ok && len(arr) > maxLen {
				maxLen = len(arr)
				trimKey = k
			}
		}
	}
	if trimKey != "" {
		arr := out[trimKey].([]interface{})
		for len(arr) > 0 {
			out[trimKey] = arr
			bb, _ := json.Marshal(out)
			if len(bb) <= MaxToolOutputBytes {
				break
			}
			arr = arr[:len(arr)/2]
		}
		if len(arr) == 0 {
			delete(out, trimKey)
		}
	}

	// Final defense: if the map still serializes over budget (e.g. an
	// unexpected shape with a huge non-array field), flatten the whole
	// thing to a truncated JSON string. Preserves item_count + any
	// top-level scalars the LLM needs for counting, and guarantees
	// the string fed back never exceeds the cap.
	if bb, _ := json.Marshal(out); len(bb) > MaxToolOutputBytes {
		keep := map[string]interface{}{
			"_truncated":        true,
			"_truncated_reason": "tool output still over budget after array trim; flattened to preview",
		}
		for _, k := range []string{"item_count", "kind", "apiVersion", "cluster_id", "namespace"} {
			if v, ok := out[k]; ok {
				keep[k] = v
			}
		}
		preview := string(bb)
		if len(preview) > MaxToolOutputBytes-512 {
			preview = preview[:MaxToolOutputBytes-512]
		}
		keep["preview"] = preview
		return keep
	}
	return out
}

// summarizeListForLLM trims a K8s-style list payload (e.g. {items:[...]})
// to the fields an LLM actually needs to answer "list/count" questions:
// kind, name, namespace, labels, creationTimestamp, and a compact status
// slice. managedFields, annotations, the full spec, and status conditions
// are dropped. Without this, "list all pods" on a real cluster returns
// ~200KB of JSON per turn — gpt-4o-mini spends its output budget on
// parsing it and emits no written answer, leaving users with a bare tool
// block and no summary.
//
// The shape is preserved: { items: [...], item_count: N, kind: K? } so
// existing tools that count len(items) continue to work.
func summarizeListForLLM(raw interface{}) interface{} {
	m, ok := raw.(map[string]interface{})
	if !ok {
		return raw
	}
	// Some backend endpoints return a bare slice at the top level.
	itemsAny, hasItems := m["items"]
	if !hasItems {
		if arr, isArr := raw.([]interface{}); isArr {
			summarized := make([]interface{}, 0, len(arr))
			for _, it := range arr {
				summarized = append(summarized, summarizeItem(it))
			}
			return map[string]interface{}{
				"items":      summarized,
				"item_count": len(summarized),
			}
		}
		return raw
	}
	items, ok := itemsAny.([]interface{})
	if !ok {
		return raw
	}
	summarized := make([]interface{}, 0, len(items))
	for _, it := range items {
		summarized = append(summarized, summarizeItem(it))
	}
	out := map[string]interface{}{
		"items":      summarized,
		"item_count": len(summarized),
	}
	for _, k := range []string{"kind", "apiVersion", "cluster_id", "namespace"} {
		if v, ok := m[k]; ok {
			out[k] = v
		}
	}
	return out
}

// summarizeItem reduces a single K8s object to the fields an LLM reasoner
// cares about. Everything else — managedFields, annotations, full spec,
// verbose status — is discarded.
func summarizeItem(raw interface{}) interface{} {
	m, ok := raw.(map[string]interface{})
	if !ok {
		return raw
	}
	out := map[string]interface{}{}
	if k, ok := m["kind"].(string); ok {
		out["kind"] = k
	}
	if meta, ok := m["metadata"].(map[string]interface{}); ok {
		md := map[string]interface{}{}
		for _, k := range []string{"name", "namespace", "creationTimestamp", "labels"} {
			if v, ok := meta[k]; ok {
				md[k] = v
			}
		}
		out["metadata"] = md
	}
	if st, ok := m["status"].(map[string]interface{}); ok {
		ss := map[string]interface{}{}
		for _, k := range []string{"phase", "podIP", "hostIP", "reason", "message", "startTime"} {
			if v, ok := st[k]; ok {
				ss[k] = v
			}
		}
		for _, k := range []string{"replicas", "readyReplicas", "availableReplicas", "updatedReplicas", "unavailableReplicas"} {
			if v, ok := st[k]; ok {
				ss[k] = v
			}
		}
		if cs, ok := st["containerStatuses"].([]interface{}); ok {
			restarts := 0
			notReady := 0
			for _, c := range cs {
				if cm, ok := c.(map[string]interface{}); ok {
					if r, ok := cm["restartCount"].(float64); ok {
						restarts += int(r)
					}
					if ready, ok := cm["ready"].(bool); ok && !ready {
						notReady++
					}
				}
			}
			if restarts > 0 {
				ss["total_restarts"] = restarts
			}
			if notReady > 0 {
				ss["containers_not_ready"] = notReady
			}
		}
		if len(ss) > 0 {
			out["status"] = ss
		}
	}
	if sp, ok := m["spec"].(map[string]interface{}); ok {
		sp2 := map[string]interface{}{}
		if v, ok := sp["nodeName"]; ok {
			sp2["nodeName"] = v
		}
		if v, ok := sp["containers"].([]interface{}); ok {
			names := make([]string, 0, len(v))
			for _, c := range v {
				if cm, ok := c.(map[string]interface{}); ok {
					if n, ok := cm["name"].(string); ok {
						names = append(names, n)
					}
				}
			}
			if len(names) > 0 {
				sp2["container_names"] = names
			}
		}
		if len(sp2) > 0 {
			out["spec"] = sp2
		}
	}
	return out
}
