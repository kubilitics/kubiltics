package server

// handlers_gaps.go — handlers that close the 6 gaps surfaced by the
// 100-prompt Together.ai bench on 2026-04-22. See
// docs/strategy/2026-04-22-gap-findings-from-100-bench.md for evidence.
//
// Each handler follows the same HTTP-via-backend pattern as the existing
// observation/analysis handlers.

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strings"
)

// ═══════════════════════════════════════════════════════════════════════════
// Gap 2 — resolve_resource (kind + name_hint → {namespace, name})
// ═══════════════════════════════════════════════════════════════════════════

// resolveMatch is the named struct used by handleResolveResource so
// matchesToSlice can take a concrete slice type (Go won't let us pass
// []anonymous-struct across function boundaries).
type resolveMatch struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Score     int    `json:"-"`
}

// handleResolveResource resolves a fuzzy resource name to concrete
// {namespace, name} coordinates across the whole cluster. Motivated by
// bench failures scen-change-105 / scen-config-96 / scen-compare-18 where
// the LLM called inspect_* with namespace=default when the resource lived
// elsewhere.
func (s *mcpServerImpl) handleResolveResource(ctx context.Context, args map[string]interface{}) (interface{}, error) {
	c := s.http()
	clusterID, err := c.resolveCluster(ctx, args)
	if err != nil {
		return nil, err
	}
	kind := strArg(args, "kind")
	nameHint := strArg(args, "name_hint")
	if kind == "" || nameHint == "" {
		return nil, fmt.Errorf("resolve_resource: 'kind' and 'name_hint' are required")
	}
	kindPlural := kindToRestPlural(kind)

	// Ask the backend for every resource of this kind cluster-wide. The
	// backend /resources/{kind} endpoint returns all namespaces when no
	// namespace query is passed.
	var raw interface{}
	if err := c.get(ctx, c.clusterPath(clusterID, "/resources/"+url.PathEscape(kindPlural)), &raw); err != nil {
		return map[string]interface{}{
			"kind":        kind,
			"name_hint":   nameHint,
			"matches":     []interface{}{},
			"suggestions": []interface{}{},
			"error":       fmt.Sprintf("list %s: %v", kindPlural, err),
		}, nil
	}

	items := extractResourceItems(raw)
	hintLower := strings.ToLower(nameHint)

	var exact, prefix, substr []resolveMatch
	var allNames []string

	for _, it := range items {
		meta, _ := it["metadata"].(map[string]interface{})
		name, _ := meta["name"].(string)
		namespace, _ := meta["namespace"].(string)
		if name == "" {
			// Fall back to top-level fields on list-view summaries.
			if n, ok := it["name"].(string); ok {
				name = n
			}
			if ns, ok := it["namespace"].(string); ok {
				namespace = ns
			}
		}
		if name == "" {
			continue
		}
		allNames = append(allNames, name)

		lowerName := strings.ToLower(name)
		m := resolveMatch{Namespace: namespace, Name: name, Kind: kind}
		switch {
		case lowerName == hintLower:
			m.Score = 3
			exact = append(exact, m)
		case strings.HasPrefix(lowerName, hintLower):
			m.Score = 2
			prefix = append(prefix, m)
		case strings.Contains(lowerName, hintLower):
			m.Score = 1
			substr = append(substr, m)
		}
	}

	merged := append(append(append([]resolveMatch{}, exact...), prefix...), substr...)
	if len(merged) > 5 {
		merged = merged[:5]
	}

	result := map[string]interface{}{
		"kind":      kind,
		"name_hint": nameHint,
		"matches":   matchesToSlice(merged),
	}
	if len(merged) == 0 {
		// Surface up to 10 real names so the LLM can pick a correction.
		sort.Strings(allNames)
		if len(allNames) > 10 {
			allNames = allNames[:10]
		}
		result["suggestions"] = allNames
	}
	return result, nil
}

func matchesToSlice(in []resolveMatch) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(in))
	for _, m := range in {
		out = append(out, map[string]interface{}{
			"namespace": m.Namespace,
			"name":      m.Name,
			"kind":      m.Kind,
		})
	}
	return out
}

// extractResourceItems peels off the typical backend envelopes ({items: [...]},
// [...] bare array, or single-object) so resolve_resource/metrics handlers
// can treat all list responses uniformly.
func extractResourceItems(raw interface{}) []map[string]interface{} {
	if raw == nil {
		return nil
	}
	var items []map[string]interface{}
	switch v := raw.(type) {
	case []interface{}:
		for _, e := range v {
			if m, ok := e.(map[string]interface{}); ok {
				items = append(items, m)
			}
		}
	case map[string]interface{}:
		if list, ok := v["items"].([]interface{}); ok {
			for _, e := range list {
				if m, ok := e.(map[string]interface{}); ok {
					items = append(items, m)
				}
			}
		}
	}
	return items
}
