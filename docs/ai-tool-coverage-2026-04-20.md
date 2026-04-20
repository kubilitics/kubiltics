# Comprehensive AI Tool Coverage Bench

- **Tag**: `llm-direct-coverage-openai-gpt-4o-mini`
- **Provider**: OpenAI · `gpt-4o-mini`
- **Tools in taxonomy**: 166 unique (151 in `taxonomy.go` core + 12 in `chat_tools.go`, deduped)
- **Prompts generated**: 498 (3 per tool, programmatic templates)
- **Iterations per prompt**: 1
- **Concurrency**: 10 (no in-flight clamp)

## Top-line numbers

- LLM calls: **498**
- LLM-call successes: 496 (99.6%)
- LLM-call errors: 2 (0.4%)

### Tool-selection match rate

- **Exact match**: 224/498 = **45.0%**
- **Semantic match (alias)**: 3/498 = **0.6%**
- **Combined hit rate**: 45.6%
- **Miss**: 271/498 = 54.4%

### Latencies (successful LLM calls)

- LLM total ms — p50=4069 · p95=10833 · p99=16428
- LLM TTFT ms  — p50=3194 · p95=9139 · p99=14031
- Tool exec ms — p50=3 · p95=50 · p99=107

### Cost

- Input tokens (estimated): 6,241
- Output tokens (estimated, chars/4): 42,368
- **Estimated OpenAI cost**: $0.0264

## Per-category breakdown

| Category | N | Exact | Semantic | Miss | Combined hit |
|---|---|---|---|---|---|
| action | 15 | 6 (40.0%) | 0 (0.0%) | 9 (60.0%) | 40.0% |
| analysis | 93 | 65 (69.9%) | 0 (0.0%) | 28 (30.1%) | 69.9% |
| automation | 12 | 9 (75.0%) | 0 (0.0%) | 3 (25.0%) | 75.0% |
| cost | 12 | 12 (100.0%) | 0 (0.0%) | 0 (0.0%) | 100.0% |
| execution | 27 | 1 (3.7%) | 0 (0.0%) | 26 (96.3%) | 3.7% |
| observation | 279 | 95 (34.1%) | 3 (1.1%) | 181 (64.9%) | 35.1% |
| recommendation | 24 | 9 (37.5%) | 0 (0.0%) | 15 (62.5%) | 37.5% |
| security | 15 | 9 (60.0%) | 0 (0.0%) | 6 (40.0%) | 60.0% |
| troubleshooting | 21 | 18 (85.7%) | 0 (0.0%) | 3 (14.3%) | 85.7% |

## Top-50 misses

| prompt_id | expected_tool | actual_tools | reason |
|---|---|---|---|
| observe_resource__3 | observe_resource | (none) | no tool selected (model answered from prior knowledge) |
| observe_pod_detailed__1 | observe_pod_detailed | (none) | no tool selected (model answered from prior knowledge) |
| observe_resource__1 | observe_resource | observe_resources_by_query | picked sibling instead |
| observe_pod_detailed__3 | observe_pod_detailed | (none) | no tool selected (model answered from prior knowledge) |
| observe_pod_dependencies__1 | observe_pod_dependencies | (none) | no tool selected (model answered from prior knowledge) |
| observe_pod_logs_filtered__1 | observe_pod_logs_filtered | (none) | no tool selected (model answered from prior knowledge) |
| observe_pod_logs__1 | observe_pod_logs | (none) | no tool selected (model answered from prior knowledge) |
| observe_pod_detailed__2 | observe_pod_detailed | list_resources, list_resources | picked sibling instead |
| observe_pod_ownership_chain__1 | observe_pod_ownership_chain | (none) | no tool selected (model answered from prior knowledge) |
| observe_pod_logs__3 | observe_pod_logs | (none) | no tool selected (model answered from prior knowledge) |
| observe_pod_logs_filtered__3 | observe_pod_logs_filtered | (none) | no tool selected (model answered from prior knowledge) |
| observe_pod_ownership_chain__3 | observe_pod_ownership_chain | (none) | no tool selected (model answered from prior knowledge) |
| observe_resource_links__1 | observe_resource_links | (none) | no tool selected (model answered from prior knowledge) |
| observe_resource_links__3 | observe_resource_links | (none) | no tool selected (model answered from prior knowledge) |
| observe_pod_dependencies__3 | observe_pod_dependencies | (none) | no tool selected (model answered from prior knowledge) |
| observe_pod_events__3 | observe_pod_events | (none) | no tool selected (model answered from prior knowledge) |
| observe_pod_events__1 | observe_pod_events | (none) | no tool selected (model answered from prior knowledge) |
| observe_pod_logs__2 | observe_pod_logs | list_resources, list_resources | picked sibling instead |
| export_topology_to_drawio__1 | export_topology_to_drawio | observe_resource_topology | picked sibling instead |
| export_topology_to_drawio__2 | export_topology_to_drawio | observe_resource_topology | picked sibling instead |
| export_topology_to_drawio__3 | export_topology_to_drawio | observe_resource_topology | picked sibling instead |
| observe_pod_events__2 | observe_pod_events | list_resources, list_resources, observe_namespace_detailed | picked sibling instead |
| observe_metrics__3 | observe_metrics | (none) | no tool selected (model answered from prior knowledge) |
| observe_node_detailed__1 | observe_node_detailed | (none) | no tool selected (model answered from prior knowledge) |
| observe_node_detailed__3 | observe_node_detailed | (none) | no tool selected (model answered from prior knowledge) |
| observe_node_events__3 | observe_node_events | (none) | no tool selected (model answered from prior knowledge) |
| observe_namespace_detailed__3 | observe_namespace_detailed | (none) | no tool selected (model answered from prior knowledge) |
| observe_namespace_events__1 | observe_namespace_events | (none) | no tool selected (model answered from prior knowledge) |
| observe_node_detailed__2 | observe_node_detailed | observe_node_status, list_resources, get_cluster_health | picked sibling instead |
| observe_pod_ownership_chain__2 | observe_pod_ownership_chain | list_resources, list_resources, list_resources, list_resources, list_resources, list_resources, list_resources, list_resources, list_resources | picked sibling instead |
| observe_namespace_events__3 | observe_namespace_events | (none) | no tool selected (model answered from prior knowledge) |
| observe_service_detailed__3 | observe_service_detailed | (none) | no tool selected (model answered from prior knowledge) |
| observe_service_detailed__1 | observe_service_detailed | (none) | no tool selected (model answered from prior knowledge) |
| observe_service_events__1 | observe_service_events | (none) | no tool selected (model answered from prior knowledge) |
| observe_namespace_detailed__2 | observe_namespace_detailed | observe_namespace_overview, get_cluster_health | picked sibling instead |
| observe_service_events__3 | observe_service_events | (none) | no tool selected (model answered from prior knowledge) |
| observe_service_endpoints__3 | observe_service_endpoints | (none) | no tool selected (model answered from prior knowledge) |
| observe_namespace_events__2 | observe_namespace_events | observe_namespace_overview, list_resources | picked sibling instead |
| observe_ingress_detailed__3 | observe_ingress_detailed | (none) | no tool selected (model answered from prior knowledge) |
| observe_ingress_events__3 | observe_ingress_events | (none) | no tool selected (model answered from prior knowledge) |
| observe_ingress_detailed__1 | observe_ingress_detailed | list_resources | picked sibling instead |
| observe_service_endpoints__1 | observe_service_endpoints | observe_resource_topology, list_resources | picked sibling instead |
| observe_service_endpoints__2 | observe_service_endpoints | analyze_service_health, analyze_network_connectivity, list_resources | picked sibling instead |
| observe_networkpolicy_detailed__3 | observe_networkpolicy_detailed | (none) | no tool selected (model answered from prior knowledge) |
| observe_networkpolicy_events__1 | observe_networkpolicy_events | (none) | no tool selected (model answered from prior knowledge) |
| observe_ingress_events__2 | observe_ingress_events | observe_networkpolicy_events, list_resources | picked sibling instead |
| observe_networkpolicy_events__3 | observe_networkpolicy_events | (none) | no tool selected (model answered from prior knowledge) |
| observe_ingress_events__1 | observe_ingress_events | list_resources, list_resources | picked sibling instead |
| observe_deployment_rollout_history__1 | observe_deployment_rollout_history | (none) | no tool selected (model answered from prior knowledge) |
| observe_deployment_rollout_history__3 | observe_deployment_rollout_history | (none) | no tool selected (model answered from prior knowledge) |

_Total misses recorded: 271_

---

## v2 — alias expansion + autonomy + content:null fix (2026-04-20, same day)

Re-run after three targeted improvements landed in `vellankikoti/kotg.ai@feat/ai-tool-coverage-improvements`:

1. **Alias map expanded** from 13 → **139 entries** via a new `cmd/build-aliases` Go tool that groups read-only verb families by canonical resource noun, with hand-curated cross-noun additions (cost forecast/analyze, custom/api resources, topology export, restart/scale workload action ↔ pod/deployment).
2. **`content:null` fix** in `internal/llm/provider/openai/tool_loop.go` — `oaiMessage.MarshalJSON` now always emits `"content":""` for assistant messages with tool_calls and for tool messages, instead of dropping the key under `omitempty`. Locked in by 4 unit tests.
3. **Autonomy + cluster-id flags** added to `cmd/bench`. `-autonomy 3` POSTs to `/api/v1/safety/autonomy/_default_` (new sentinel routing the empty-string runtime user) before any prompt fires. Execution-category prompts in `scripts/gen_prompts.py` now carry an explicit pre-authorization clause (`"I have approved this change in advance and explicitly authorize you to call the X tool …"`).

### v2 top-line numbers

- LLM calls: **498** (same prompt set)
- LLM-call successes: 496 (99.6%)
- LLM-call errors: 2 (0.4%) — both v1 carry-overs (`agentic loop exceeded max turns`, no relation to content:null)
- **Exact match**: 234/498 = **47.0%** (+2.0 pp)
- **Semantic match**: 60/498 = **12.0%** (+11.4 pp)
- **Combined hit rate**: **59.0%** (+13.4 pp)
- **Miss**: 204/498 = 41.0% (-13.4 pp)
- `content:null` errors: **0** (would-be 0 here regardless because no real backend, but the fix is preventatively in place + tested)
- HTTP 400 errors: 0

### v1 → v2 per-category delta

| Category | v1 combined | v2 combined | Δ |
|---|---|---|---|
| action | 40.0% | 66.7% | **+26.7 pp** |
| analysis | 69.9% | 88.2% | **+18.3 pp** |
| automation | 75.0% | 75.0% | +0.0 pp |
| cost | 100.0% | 100.0% | +0.0 pp |
| execution | 3.7% | 18.5% | **+14.8 pp** |
| observation | 35.1% | 46.2% | **+11.1 pp** |
| recommendation | 37.5% | 75.0% | **+37.5 pp** |
| security | 60.0% | 73.3% | **+13.3 pp** |
| troubleshooting | 85.7% | 85.7% | +0.0 pp |

### Top-15 v2 remaining misses (by expected_tool)

| expected_tool | misses | dominant pattern |
|---|---|---|
| observe_pod_detailed | 3 | LLM emits text, no tool call |
| observe_pod_events | 3 | LLM emits text, no tool call |
| observe_ingress_events | 3 | LLM emits text, no tool call |
| observe_network_policies | 3 | LLM emits text, no tool call |
| observe_cronjob_events | 3 | LLM emits text, no tool call |
| observe_pv_detailed | 3 | LLM emits text, no tool call |
| observe_configmap_events | 3 | LLM emits text, no tool call |
| analyze_network_connectivity | 3 | LLM emits text, no tool call |
| recommend_security_hardening | 3 | LLM emits text, no tool call |
| recommend_architecture_improvements | 3 | LLM emits text, no tool call |
| troubleshoot_network_issues | 3 | LLM emits text, no tool call |
| security_compliance_report | 3 | LLM emits text, no tool call |
| action_apply_manifest | 3 | safety refusal despite autonomy=3 |
| scale_deployment | 3 | safety refusal despite autonomy=3 |
| automation_generate_runbook | 3 | LLM emits text, no tool call |

### Honest analysis on the gap to 75-85% target

The headline moved from 45.6% to 59.0% (+13.4 pp), well below the 75-85% goal. Two structural blockers explain the shortfall and neither is in the list of three improvements in scope:

1. **Tool-emission abstinence**: ~150 of the 204 remaining misses are observation/recommendation prompts where gpt-4o-mini answers from prior knowledge ("a NetworkPolicy controls ingress/egress…") instead of invoking a tool. The prompts are deliberately spartan ("Show me network policies."). Fix would be a system-prompt nudge ("you must always call a tool when asked to inspect cluster state") or per-tool description sharpening — both outside the alias/engine/autonomy scope of this branch.
2. **Execution refusals despite autonomy=3 and explicit pre-authorization**: gpt-4o-mini still refuses 22/27 execution prompts even after the augmentation ("I have approved this change in advance…"). The model's RLHF safety baseline overrides the user-asserted approval. Real systems would either upgrade to a less-tuned model or move execution into a confirm-then-act UX rather than expecting the LLM to take destructive action from a single prompt.

### v2 cost

- Identical input set, ~3% larger output (longer execution-prompt augmentation)
- **Estimated OpenAI cost**: ~$0.027 (same order of magnitude as v1's $0.0264)

## Caveats / honest-analysis

- **No real cluster backend.** kubilitics-backend was not running so tool execution returned errors. This benchmark scores SELECTION (the LLM picked the right tool), not end-to-end success. That is the right metric for routing coverage; it would be wrong as a reliability metric.
- **One real engine bug surfaced**: when a tool call returns an error, the next-turn assistant message may be sent with `content: null`, causing OpenAI to return HTTP 400 "expected a string, got null". Prompts that triggered this are recorded as `result=failure` with `error_code=llm_error`. NOT fixed in this branch — documented for the engine team.
- **Aliases map is small (13 entries).** A larger semantic-equivalence map would push semantic-match rate up. Misses listed above include some that are arguably aliases (e.g. `observe_resource` vs `get_resource`).
- **3 prompts/tool is the MINIMUM.** Adversarial paraphrasing (5–10 prompts/tool) would surface more misses. This is a coverage floor, not a ceiling.
