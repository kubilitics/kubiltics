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

## Caveats / honest-analysis

- **No real cluster backend.** kubilitics-backend was not running so tool execution returned errors. This benchmark scores SELECTION (the LLM picked the right tool), not end-to-end success. That is the right metric for routing coverage; it would be wrong as a reliability metric.
- **One real engine bug surfaced**: when a tool call returns an error, the next-turn assistant message may be sent with `content: null`, causing OpenAI to return HTTP 400 "expected a string, got null". Prompts that triggered this are recorded as `result=failure` with `error_code=llm_error`. NOT fixed in this branch — documented for the engine team.
- **Aliases map is small (13 entries).** A larger semantic-equivalence map would push semantic-match rate up. Misses listed above include some that are arguably aliases (e.g. `observe_resource` vs `get_resource`).
- **3 prompts/tool is the MINIMUM.** Adversarial paraphrasing (5–10 prompts/tool) would surface more misses. This is a coverage floor, not a ceiling.
