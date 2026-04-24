// Package toolrouter implements topic-aware tool selection for LLM requests.
//
// The kubilitics-ai taxonomy ships 163 MCP tools. Sending all of them to the
// LLM on every turn bloats the prompt (~25K tool-schema tokens before the
// first user byte), confuses smaller models, and blows budget. The router
// classifies the latest user question into 1-3 topics from a fixed taxonomy
// and filters the tool list to a small, relevant subset (core + topic tools,
// capped at MaxToolsPerCall). The result is 5-10x fewer input tokens with
// meaningfully higher tool-selection precision on incident-style prompts.
//
// Classification is keyword-based (deterministic, testable, free). An
// LLM-based classifier is a pluggable followup — it would satisfy the same
// Router interface and slot in behind a feature flag without changing any
// caller.
package toolrouter

import (
	"sort"
	"strings"

	"github.com/vellankikoti/kubilitics/brain/internal/llm/types"
)

// MaxToolsPerCall caps the filtered list sent to the LLM per request.
// Tuned for Llama-class models: 30 is small enough to fit well under the
// 128-tool API hard limit AND keep schema tokens <5K, yet large enough to
// cover the common incident topics plus their adjacent helpers.
const MaxToolsPerCall = 30

// MaxTopicsPerQuery bounds how many topics we take from the classifier so
// the tool budget stays predictable.
const MaxTopicsPerQuery = 3

// Router selects a relevant subset of tools for a given user question.
// Implementations MUST always include the "core" topic's tools (list/get/
// overview) so the LLM can always answer basic lookup questions even when
// classification misses.
type Router interface {
	SelectTools(question string, allTools []types.Tool) Selection
}

// Selection is the result of a routing decision. Topics is exposed for
// observability (bench report, tracer Stage) so we can see which topics
// fired on real prompts and tune the keyword map.
type Selection struct {
	Topics []Topic
	Tools  []types.Tool
}

// NewKeywordRouter returns the default Router implementation: score topics
// by keyword hits against the lowercased user message, take top N, fall
// back to a safe default when nothing matches.
func NewKeywordRouter() Router { return &keywordRouter{} }

type keywordRouter struct{}

func (r *keywordRouter) SelectTools(question string, allTools []types.Tool) Selection {
	topics := classify(question)
	return Selection{
		Topics: topics,
		Tools:  filterTools(topics, allTools),
	}
}

// classify returns the topic set for a question. TopicCore is always
// present. Topic order after core is by descending keyword-hit score, capped
// at MaxTopicsPerQuery. When nothing matches, a sensible default fires so
// bench prompts that phrase things unusually still get useful coverage.
func classify(question string) []Topic {
	msg := " " + strings.ToLower(question) + " "
	type scored struct {
		topic Topic
		score int
	}
	ranked := make([]scored, 0, len(topicKeywords))
	for topic, kws := range topicKeywords {
		s := 0
		for _, kw := range kws {
			// Cheap word-ish boundary: keyword is matched as a substring
			// but bracketed by space in the padded msg above so "pod" does
			// not match "podsecurity" spuriously. A proper tokenizer isn't
			// worth the complexity for a v1 classifier.
			if strings.Contains(msg, " "+kw+" ") || strings.Contains(msg, " "+kw) || strings.Contains(msg, kw+" ") {
				s++
			}
		}
		if s > 0 {
			ranked = append(ranked, scored{topic, s})
		}
	}
	sort.Slice(ranked, func(i, j int) bool {
		if ranked[i].score != ranked[j].score {
			return ranked[i].score > ranked[j].score
		}
		// Stable tie-break on topic name so tests are deterministic.
		return ranked[i].topic < ranked[j].topic
	})

	result := []Topic{TopicCore}
	if len(ranked) == 0 {
		// Default: cover the most common incident shapes.
		result = append(result, TopicPods, TopicWorkloads)
		return result
	}
	for i, r := range ranked {
		if i >= MaxTopicsPerQuery {
			break
		}
		result = append(result, r.topic)
	}
	return result
}

// filterTools returns the subset of allTools mapped to any of the given
// topics, plus the core set, deduped and capped at MaxToolsPerCall.
//
// Priority when capping:
//  1. Core tools (always kept; there are ~5 so this never caps out)
//  2. Tools whose derived topic matches one of the requested topics, in
//     topic-order (the first topic wins ties so the primary intent is
//     covered before adjacent topics)
//  3. Remaining slots filled with any unmatched tools (generic fallback)
func filterTools(topics []Topic, allTools []types.Tool) []types.Tool {
	want := make(map[Topic]int, len(topics))
	for i, t := range topics {
		// Lower value = higher priority (first topic wins).
		if _, seen := want[t]; !seen {
			want[t] = i
		}
	}

	type scored struct {
		tool     types.Tool
		priority int // 0 = core, 1 = matched, 2 = fallback
		rank     int // tie-break inside priority (topic-match order)
		shape    int // tie-break inside rank: aggregator (0) / composite (1) / legacy (2)
	}

	picked := make([]scored, 0, len(allTools))
	for _, tool := range allTools {
		tts := ToolTopics(tool.Name)
		isCore := false
		bestMatch := -1
		for _, tt := range tts {
			if tt == TopicCore {
				isCore = true
				continue
			}
			if idx, ok := want[tt]; ok {
				if bestMatch == -1 || idx < bestMatch {
					bestMatch = idx
				}
			}
		}
		shape := priorityKey(tool.Name)
		switch {
		case isCore:
			picked = append(picked, scored{tool, 0, 0, shape})
		case bestMatch >= 0:
			picked = append(picked, scored{tool, 1, bestMatch, shape})
		}
	}

	sort.SliceStable(picked, func(i, j int) bool {
		if picked[i].priority != picked[j].priority {
			return picked[i].priority < picked[j].priority
		}
		if picked[i].rank != picked[j].rank {
			return picked[i].rank < picked[j].rank
		}
		return picked[i].shape < picked[j].shape
	})

	out := make([]types.Tool, 0, MaxToolsPerCall)
	seen := make(map[string]bool, len(picked))
	for _, p := range picked {
		if len(out) >= MaxToolsPerCall {
			break
		}
		if seen[p.tool.Name] {
			continue
		}
		seen[p.tool.Name] = true
		out = append(out, p.tool)
	}
	return out
}

// priorityKey biases the filtered tool list so the LLM sees aggregators
// FIRST, composites next, legacy per-resource observers last. LLMs tend
// to pick the first relevant tool they see — the 2026-04-22 v2 bench
// showed the picker choosing legacy siblings when both sat in the prompt.
//
// Returns:
//   0 — aggregator (who_*, analyze_*, observe_recent_*, observe_*_metrics,
//       observe_*_by_*, observe_*_usage, resolve_*, observe_top_*)
//   1 — composite (inspect_*)
//   2 — everything else (legacy per-resource observers and fallbacks)
func priorityKey(toolName string) int {
	n := strings.ToLower(toolName)
	// Aggregators.
	if strings.HasPrefix(n, "who_") ||
		strings.HasPrefix(n, "analyze_") ||
		strings.HasPrefix(n, "resolve_") ||
		strings.HasPrefix(n, "observe_recent_") ||
		strings.HasPrefix(n, "observe_top_") {
		return 0
	}
	// Pattern-matched aggregators: observe_*_metrics, observe_*_by_*,
	// observe_*_usage. These are cheaper string ops than regex; the
	// taxonomy is small enough that startsWith + contains is clearer.
	if strings.HasPrefix(n, "observe_") {
		if strings.HasSuffix(n, "_metrics") ||
			strings.HasSuffix(n, "_usage") ||
			strings.Contains(n, "_by_") {
			return 0
		}
	}
	// Composites.
	if strings.HasPrefix(n, "inspect_") {
		return 1
	}
	return 2
}
