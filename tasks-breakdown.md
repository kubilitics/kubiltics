# KOTG.AI — Engineering Tasks Breakdown

**Version:** 2.0
**Date:** 2026-02-28
**Status:** Research-Validated Engineering Roadmap
**Total Duration:** 14–18 months (team of 3–5 engineers)

---

## Overview

Seven phases, sequentially dependent. Each phase ends with a gate review: tests pass, benchmarks met, documentation updated. No skipping phases.

| Phase | Name | Duration | Key Deliverable | Gate Criteria |
|---|---|---|---|---|
| **0** | Architecture Validation | 2 weeks | Tech spike — all choices proven locally | Spike results documented; no blocking surprises |
| **1** | Foundation | 6 weeks | `pip install kotg-ai` + `kotg diagnose` works | YAML validity ≥90%; RAG returns correct docs |
| **2** | Intelligence Layer | 8 weeks | RAG pipeline + KOTG-7B fine-tuned model | YAML validity ≥95%; RCA accuracy ≥65% |
| **3** | Knowledge Graph | 6 weeks | Live cluster graph + incident memory | Graph sync <5s; incident match ≥70% accuracy |
| **4** | Agent System | 10 weeks | 5 specialized LangGraph agents working | Complex incident diagnosed in <60s |
| **5** | MCP Ecosystem | 8 weeks | 50+ MCP tools + community registry | 50 tools tested; cloud provider tools working |
| **6** | Cluster Integration | 6 weeks | Kubernetes Operator + kubectl plugin | Operator deploys in <5min; krew install works |
| **7** | Production Platform | 12 weeks | Web UI + enterprise features + KOTG Cloud | First paying enterprise customer |

---

## Phase 0 — Architecture Validation (Spike)

**Duration:** 2 weeks
**Goal:** Prove every major technology choice works BEFORE building. Eliminate surprises at week 10.
**Team:** All engineers in parallel; results shared in week 2 review.

**Why Phase 0 exists:** LangGraph v1.0, Kuzu v0.7, BGE-M3, Outlines, LangGraph Supervisor — all are relatively new. We need to prove the full chain works locally on the target hardware profile BEFORE committing to the full architecture.

### Spike 0.1 — LangGraph Supervisor with Local LLMs (3 days)

| Task | Engineer | Acceptance |
|---|---|---|
| Run LangGraph Supervisor with 2 agents using `qwen2.5-coder:14b` via Ollama | Eng-3 | Supervisor correctly routes tasks; HITL Interrupt works |
| Validate tool calling reliability: Qwen2.5-14B with raw JSON vs Outlines | Eng-3 | Confirm Outlines improves reliability from ~92% → ~99% |
| Measure P95 latency for a 5-step diagnosis loop on MacBook M2 16GB | Eng-3 | ≤60s P95 |
| Test LangSmith tracing with LangGraph — does auto-tracing work? | Eng-3 | Full trace visible in LangSmith dashboard |

**Output:** Decision memo: "LangGraph Supervisor + Qwen2.5-Coder-14B + Outlines = confirmed stack"

### Spike 0.2 — Qdrant Hybrid Search with BGE-M3 (2 days)

| Task | Engineer | Acceptance |
|---|---|---|
| Embed 10K K8s documentation chunks with BGE-M3 via Ollama | Eng-2 | Embedding throughput ≥100 chunks/min locally |
| Build BM42 sparse vector index alongside dense | Eng-2 | Hybrid query returns better results than dense-only on 20 test queries |
| Validate Contextual Retrieval preprocessing: does it improve precision? | Eng-2 | ≥30% improvement on 20 test queries vs plain chunking |
| Test Jina Reranker v2 on 20 K8s queries | Eng-2 | Top-1 precision improves ≥20% vs no reranking |

**Output:** Qdrant schema locked; chunking strategy confirmed.

### Spike 0.3 — Kuzu Graph DB (2 days)

| Task | Engineer | Acceptance |
|---|---|---|
| Create Kuzu schema (all node + rel tables from implementation-plan.md) | Eng-3 | Schema created without errors |
| Populate from local `kubectl get -o json` snapshot of test cluster | Eng-2 | 100 pods / 20 deployments synced in <5s |
| Write 10 representative Cypher queries (pod relationships, recent changes) | Eng-3 | All queries return correct results; <500ms each |
| Test GraphRAG fusion: Kuzu result + Qdrant result combined into context | Eng-3 | Combined context richer than either alone |

**Output:** Graph schema confirmed; GraphRAG fusion pattern proven.

### Spike 0.4 — KOTG MCP Server (1 day)

| Task | Engineer | Acceptance |
|---|---|---|
| Build minimal FastMCP server with 1 tool (`diagnose_cluster`) | Eng-1 | Tool works via stdio transport |
| Connect to Claude Desktop as MCP server | Eng-1 | Claude can call KOTG.AI tool from Claude Desktop |
| Test Streamable HTTP transport (for non-local deployment) | Eng-1 | Tool works via HTTP |

**Output:** MCP server architecture confirmed; transport choice locked.

### Phase 0 Gate Review

- All 4 spikes completed with written results
- No blocking technical issues
- Hardware requirements confirmed (minimum: 16GB M2 for full agent suite)
- Final tech stack table signed off by all engineers

---

## Phase 1 — Foundation

**Duration:** 6 weeks
**Goal:** Working CLI with local LLM + basic RAG + kubectl MCP tools
**Success Criteria:** `kotg diagnose` returns meaningful diagnosis of a real cluster issue using Qwen2.5-Coder-7B locally

### Milestone 1.1 — Repository & Project Setup (Week 1)

| Task ID | Task | Eng | Complexity | Output |
|---|---|---|---|---|
| 1.1.1 | Initialize Python project: `uv`, `pyproject.toml`, monorepo structure | Eng-1 | Low | `kotg/{core,agents,mcp,rag,graph,ui,cli}` skeleton |
| 1.1.2 | Configure linting + formatting: `ruff`, `mypy`, `black` | Eng-1 | Low | `.ruff.toml`, `mypy.ini`, pre-commit hooks |
| 1.1.3 | Configure CI: GitHub Actions — lint + test + benchmark on every PR | Eng-1 | Low | `.github/workflows/ci.yml` |
| 1.1.4 | Docker Compose: Ollama + Qdrant + model-pull service | Eng-2 | Medium | `docker-compose.yml` — one command dev env |
| 1.1.5 | Write `CONTRIBUTING.md` + dev setup guide | Eng-1 | Low | New contributor can onboard in <30min |
| 1.1.6 | GitHub issue templates + project board | Eng-1 | Low | Project management infrastructure |
| 1.1.7 | Set up LangSmith account + project + trace link in CI | Eng-3 | Low | All CI test runs traced to LangSmith |

**Gate:** `git clone && docker compose up && kotg --help` works on a clean machine.

### Milestone 1.2 — Core LLM Integration (Week 1–2)

| Task ID | Task | Eng | Complexity | Output |
|---|---|---|---|---|
| 1.2.1 | Implement `OllamaClient` wrapper: async, streaming, retry with exponential backoff | Eng-2 | Medium | Reliable LLM client |
| 1.2.2 | Implement `ModelRouter`: tier (T0–T4) → model name; complexity heuristic classifier | Eng-2 | Medium | Correct model selection per task |
| 1.2.3 | Implement LiteLLM integration as the single LLM abstraction layer | Eng-2 | Medium | One client for Ollama/vLLM/cloud |
| 1.2.4 | Implement `Outlines` structured output wrapper for tool call JSON | Eng-3 | Medium | ≥99% valid JSON for T1 tool calls |
| 1.2.5 | Implement `Instructor` Pydantic output validation wrapper | Eng-3 | Low | Type-safe LLM outputs everywhere |
| 1.2.6 | Implement `PromptTemplate` system (Jinja2) with K8s-specific templates | Eng-1 | Medium | Reusable, tested prompt management |
| 1.2.7 | Implement streaming token output + response latency tracking | Eng-2 | Medium | Real-time streaming CLI output |
| 1.2.8 | Write unit tests: retry logic, tier routing, structured output | Eng-2 | Low | ≥90% test coverage for core/llm |
| 1.2.9 | Implement `kotg models install [tier]` — Ollama pull automation | Eng-2 | Low | `kotg models install medium` works |

**Gate:** `from kotg.core import ModelRouter; router.generate(messages, tier=MEDIUM)` returns valid response with <2s cold start.

### Milestone 1.3 — kubectl MCP Tools (Week 2–3)

| Task ID | Task | Eng | Complexity | Output |
|---|---|---|---|---|
| 1.3.1 | Implement `MCPTool` ABC + `MCPToolRegistry` with 4-tier safety model | Eng-3 | High | MCP base framework |
| 1.3.2 | Implement `kubectl_get` MCP tool with shell injection prevention | Eng-3 | High | Safe `kubectl get` wrapper |
| 1.3.3 | Implement `kubectl_describe` MCP tool | Eng-3 | Medium | Safe `kubectl describe` wrapper |
| 1.3.4 | Implement `kubectl_logs` MCP tool (with `--previous`, `--tail`) | Eng-3 | Medium | Safe log retrieval |
| 1.3.5 | Implement `kubectl_events` MCP tool (sorted by timestamp) | Eng-3 | Low | Cluster event retrieval |
| 1.3.6 | Implement `kubectl_top` MCP tool (nodes + pods) | Eng-3 | Low | Resource usage retrieval |
| 1.3.7 | Implement `kubectl_diff` MCP tool (Tier 3 — dry-run safe) | Eng-3 | Medium | Safe diff before apply |
| 1.3.8 | Implement shell injection prevention: metacharacter regex + dangerous verb blocklist | Eng-3 | High | Security test: 50 injection attempts fail |
| 1.3.9 | Implement 64KB output truncation + structured `ToolResult` schema | Eng-3 | Low | No LLM context overflow |
| 1.3.10 | Write integration tests against a local Kind cluster | Eng-3 | Medium | All tools tested against live K8s |
| 1.3.11 | Implement kubeconfig context management (multi-cluster from day 1) | Eng-3 | Medium | `--context prod-cluster` works |

**Gate:** All kubectl tools pass injection test suite; integration tests pass on Kind.

### Milestone 1.4 — Basic RAG Pipeline (Week 3–4)

| Task ID | Task | Eng | Complexity | Output |
|---|---|---|---|---|
| 1.4.1 | Implement `DocsCrawler` — async Kubernetes docs fetcher | Eng-2 | Medium | 500MB K8s docs fetched |
| 1.4.2 | Implement `KEPFetcher` — all KEPs from k/enhancements GitHub | Eng-2 | Low | KEP dataset |
| 1.4.3 | Implement chunking pipeline: SemanticSplitter + CodeSplitter (LlamaIndex) | Eng-2 | Medium | Well-chunked documents |
| 1.4.4 | Implement Contextual Retrieval preprocessing (T0 model adds context prefix per chunk) | Eng-2 | Medium | 49-67% retrieval improvement |
| 1.4.5 | Implement BGE-M3 embedding pipeline (dense + sparse simultaneously) | Eng-2 | Medium | Dual-vector embeddings |
| 1.4.6 | Implement Qdrant indexer with BM42 sparse + dense vectors | Eng-2 | Medium | Hybrid-searchable index |
| 1.4.7 | Implement `HybridRetriever`: dense + BM42 sparse + Reciprocal Rank Fusion | Eng-2 | High | Better retrieval than dense-only |
| 1.4.8 | Implement Jina Reranker v2 integration | Eng-2 | Medium | Top-5 precision after reranking |
| 1.4.9 | Implement `RAGPipeline` end-to-end orchestrator (LlamaIndex Workflows) | Eng-3 | High | Full RAG flow |
| 1.4.10 | Build 200-question evaluation set; measure NDCG@5 | Eng-2 | High | Baseline NDCG@5 ≥0.70 |

**Gate:** RAG returns correct document for 70%+ of 200 evaluation questions.

### Milestone 1.5 — Basic Agent + CLI (Week 4–5)

| Task ID | Task | Eng | Complexity | Output |
|---|---|---|---|---|
| 1.5.1 | Implement single-agent `KubernetesAgent` with ReAct loop (LangGraph) | Eng-3 | High | Working diagnosis agent |
| 1.5.2 | Implement intent classifier (T0 model → diagnose/explain/generate/analyze) | Eng-3 | Medium | Correct routing |
| 1.5.3 | Implement HITL gate via `LangGraph Interrupt` for Tier 4 tools | Eng-1 | Medium | Human approval before execution |
| 1.5.4 | Implement `kotg diagnose [description]` CLI command | Eng-1 | Medium | End-to-end diagnosis |
| 1.5.5 | Implement `kotg ask [question]` — conversational Q&A | Eng-1 | Low | K8s Q&A with RAG |
| 1.5.6 | Implement `kotg generate [description]` — YAML generation | Eng-1 | Medium | Production-safe YAML |
| 1.5.7 | Implement `kotg observe` — cluster health snapshot | Eng-1 | Medium | Health score + anomalies |
| 1.5.8 | Implement `kotg mcp serve` — expose KOTG as MCP server (stdio transport) | Eng-1 | Medium | Claude Desktop integration |
| 1.5.9 | Add Rich progress bars, spinners, syntax highlighting to all commands | Eng-1 | Low | Beautiful CLI output |
| 1.5.10 | Implement `kotg config` — configure models, contexts, Qdrant endpoint | Eng-1 | Low | Configuration management |
| 1.5.11 | Wire LangSmith tracing into all agent runs | Eng-3 | Low | All runs visible in LangSmith |

**Gate:** `kotg diagnose "my pod is CrashLoopBackOff"` returns correct diagnosis with kubectl tool calls on a Kind cluster.

### Milestone 1.6 — Phase 1 Testing, Docs, and Alpha Release (Week 6)

| Task ID | Task | Eng | Complexity | Output |
|---|---|---|---|---|
| 1.6.1 | End-to-end test suite: 20 common K8s failure scenarios on Kind | All | High | E2E test coverage |
| 1.6.2 | YAML generation test: 500 prompts → all pass `kubectl apply --dry-run` | Eng-2 | Medium | YAML validity benchmark |
| 1.6.3 | RAG evaluation: 200 questions → NDCG@5 report | Eng-2 | Low | Published eval results |
| 1.6.4 | Security test: 100 injection attempts → all blocked | Eng-3 | Low | Security validation |
| 1.6.5 | Performance test: P95 diagnosis latency on M2 16GB | Eng-3 | Low | ≤60s P95 baseline established |
| 1.6.6 | Write comprehensive README (install, quickstart, model guide, examples) | Eng-1 | Low | Public documentation |
| 1.6.7 | Create demo video + GIF for GitHub README | Eng-1 | Low | Social proof for GitHub |
| 1.6.8 | Publish to PyPI as `kotg-ai` (alpha) | Eng-1 | Low | `pip install kotg-ai` works |
| 1.6.9 | Set up GitHub Discussions + Discord | Eng-1 | Low | Community infrastructure |

**Phase 1 Gate:**
- `pip install kotg-ai && kotg diagnose "pod is CrashLoopBackOff"` works on Kind
- YAML validity ≥90% on 500-prompt benchmark
- RAG NDCG@5 ≥0.70
- 0 critical bugs in E2E test suite
- GitHub stars: target 50+

---

## Phase 2 — Intelligence Layer

**Duration:** 8 weeks
**Goal:** Build full knowledge base + fine-tune KOTG-7B
**Success Criteria:** KOTG-7B achieves 95%+ YAML validity; RAG answers K8s questions with expert accuracy

### Milestone 2.1 — Knowledge Base Ingestion Pipeline (Week 1–3)

| Task ID | Task | Eng | Complexity | Output |
|---|---|---|---|---|
| 2.1.1 | Implement `GitHubFetcher`: K8s issues with `kind/bug`, `help wanted` labels | Eng-2 | Medium | 2GB K8s issues dataset |
| 2.1.2 | Implement `CVEFetcher`: NVD + GHSA security advisories daily | Eng-3 | Medium | CVE dataset; daily updates |
| 2.1.3 | Implement `SOFetcher`: Stack Exchange API, top-50K K8s questions | Eng-3 | Medium | SO Q&A dataset |
| 2.1.4 | Implement `HelmChartFetcher`: ArtifactHub top-500 chart READMEs | Eng-3 | Medium | Helm dataset |
| 2.1.5 | Implement `IncidentFetcher`: curated public incident reports (RSS + GitHub) | Eng-2 | Medium | Incident report dataset |
| 2.1.6 | Build full `DocumentProcessor`: chunking + metadata + dedup + quality filter | Eng-2 | High | 1M+ quality chunks |
| 2.1.7 | Build `ContextualRetrievalPipeline`: T0 model generates context prefix per chunk | Eng-2 | High | Context-enriched chunks |
| 2.1.8 | Build `EmbeddingPipeline`: batch BGE-M3 (dense + sparse) + Qdrant upsert | Eng-2 | Medium | Searchable 50GB corpus |
| 2.1.9 | Implement MinHash LSH deduplication (0.85 Jaccard threshold) | Eng-2 | Medium | Clean deduplicated corpus |
| 2.1.10 | Schedule weekly/daily refresh via GitHub Actions (cron) | Eng-1 | Low | Auto-updating knowledge base |
| 2.1.11 | Run full ingestion: measure time, storage, query quality | Eng-2 | Low | Ingestion benchmark report |

**Gate:** 1M+ chunks in Qdrant; NDCG@5 improves vs Phase 1 baseline.

### Milestone 2.2 — Advanced RAG Tuning (Week 3–5)

| Task ID | Task | Eng | Complexity | Output |
|---|---|---|---|---|
| 2.2.1 | Tune retrieval parameters: top-k, similarity thresholds, RRF weights | Eng-3 | Medium | Optimal retrieval config |
| 2.2.2 | Implement `QueryRewriter`: expand K8s queries with terminology synonyms | Eng-3 | Medium | Better recall on ambiguous queries |
| 2.2.3 | Implement entity extraction: detect K8s resource types, namespaces in query | Eng-3 | Medium | Filtered retrieval by entity |
| 2.2.4 | Expand evaluation set to 500 questions (50 per K8s topic area) | Eng-2 | High | Comprehensive eval golden set |
| 2.2.5 | RAGAS evaluation: faithfulness + answer relevancy + context recall | Eng-2 | Medium | RAGAS metrics published |
| 2.2.6 | A/B test: Contextual Retrieval vs standard chunking (500 queries) | Eng-2 | Medium | Prove ≥40% improvement in practice |
| 2.2.7 | Integrate RAGAS evaluation into CI pipeline | Eng-2 | Low | Automated RAG quality gate |

**Gate:** RAGAS faithfulness ≥0.85; context_recall ≥0.80; NDCG@5 ≥0.78.

### Milestone 2.3 — KOTG-7B Dataset & Fine-Tuning (Week 4–7)

| Task ID | Task | Eng | Complexity | Output |
|---|---|---|---|---|
| 2.3.1 | Design all 5 dataset schemas (Pydantic models for YAML gen, RCA, Q&A, security, tool selection) | Eng-2 | Medium | Dataset schemas |
| 2.3.2 | Build YAML generation dataset: 500 manual → DeepSeek-R1 expansion to 50K; validate all | Eng-2 | Very High | 50K validated YAML training examples |
| 2.3.3 | Build Incident RCA dataset: GitHub issues + SO → chain-of-thought traces (20K) | Eng-2 | Very High | 20K incident training examples |
| 2.3.4 | Build K8s Q&A dataset: docs + KEPs → 100K examples | Eng-2 | High | 100K Q&A training examples |
| 2.3.5 | Build security analysis dataset: manifests + CIS/Kyverno (20K) | Eng-3 | High | 20K security training examples |
| 2.3.6 | Build tool selection dataset: query → MCP tool + args (10K synthetic) | Eng-3 | High | 10K tool selection examples |
| 2.3.7 | Run MinHash dedup + quality filtering across all datasets | Eng-2 | Medium | 200K clean, deduplicated examples |
| 2.3.8 | Set up Vast.ai RTX 4090 fine-tuning environment | Eng-2 | Low | GPU compute ready |
| 2.3.9 | Implement SFT pipeline: Unsloth + TRL + Qwen2.5-7B-Instruct | Eng-2 | High | Fine-tuning code |
| 2.3.10 | Run 3-epoch SFT (est. 12hr on RTX 4090) | Eng-2 | Low | KOTG-7B-SFT weights |
| 2.3.11 | Implement DPO pipeline: 5K comparison pairs (correct vs hallucinated) | Eng-2 | High | DPO training code |
| 2.3.12 | Run DPO alignment (est. 6hr on RTX 4090) | Eng-2 | Low | KOTG-7B-DPO weights |
| 2.3.13 | Evaluate KOTG-7B vs base on all 5 benchmark metrics | Eng-2 | Medium | Benchmark report |
| 2.3.14 | Convert to GGUF Q4_K_M; upload to HuggingFace Hub | Eng-2 | Low | `kotg-ai/kotg-7b-v1-gguf` on HF |
| 2.3.15 | Create Ollama Modelfile; publish to Ollama registry | Eng-2 | Low | `ollama pull kotg/kotg-7b` works |

**Gate:** KOTG-7B: YAML validity ≥95%; RCA accuracy ≥65%; tool call validity ≥88%.

### Milestone 2.4 — Phase 2 Release (Week 8)

| Task ID | Task | Complexity | Output |
|---|---|---|---|
| 2.4.1 | Full benchmark report: all 5 metrics vs base model | Medium | Public benchmark |
| 2.4.2 | Update README, docs with RAG + model documentation | Low | Documentation |
| 2.4.3 | Blog post: "How we built KOTG-7B under $20" | Low | Community traction |
| 2.4.4 | Tag v0.2.0 release on GitHub + PyPI | Low | Release |

**Phase 2 Gate:** KOTG-7B on Ollama; 1M+ knowledge chunks; RAGAS faithfulness ≥0.85.

---

## Phase 3 — Kubernetes Knowledge Graph

**Duration:** 6 weeks
**Goal:** Live, queryable Kuzu graph of cluster state + incident memory
**Success Criteria:** `kotg graph query "what changed before the CrashLoopBackOff?"` returns accurate causal timeline

### Milestone 3.1 — Graph Foundation (Week 1–2)

| Task ID | Task | Eng | Complexity | Output |
|---|---|---|---|---|
| 3.1.1 | Implement full Kuzu schema (all node + rel tables from implementation-plan.md) | Eng-3 | High | Graph schema |
| 3.1.2 | Implement `GraphClient` wrapper: Cypher query builder + connection management | Eng-3 | High | Graph access layer |
| 3.1.3 | Implement graph seeding from `kubectl get -o json` snapshot | Eng-2 | Medium | Batch initial population |
| 3.1.4 | Write schema migration framework (v1 → v2 without data loss) | Eng-3 | Medium | Schema versioning |
| 3.1.5 | Build 50 pre-written Cypher queries (pod relationships, recent changes, health) | Eng-3 | Medium | Query library |

### Milestone 3.2 — Live Cluster Sync (Week 2–4)

| Task ID | Task | Eng | Complexity | Output |
|---|---|---|---|---|
| 3.2.1 | Implement Kubernetes Informers: Pod, Deployment, Service, ConfigMap, Event, Node | Eng-3 | Very High | Real-time event stream |
| 3.2.2 | Implement `GraphSyncer`: K8s watch events → Kuzu MERGE mutations | Eng-3 | Very High | Live graph updates |
| 3.2.3 | Implement immutable change log in SQLite (timestamp + resource JSON snapshot) | Eng-3 | High | 7-day change history |
| 3.2.4 | Implement `ChangeCorrelator`: correlates changes across resources in ±5 minute window | Eng-3 | Very High | Causal change chains |
| 3.2.5 | Validate: resource change visible in graph within 5 seconds | Eng-2 | Medium | Sync latency test |
| 3.2.6 | Unit + integration tests for all sync logic (mock K8s API + real Kind) | Eng-2 | High | Test coverage ≥85% |

### Milestone 3.3 — Graph Query for Agents (Week 4–5)

| Task ID | Task | Eng | Complexity | Output |
|---|---|---|---|---|
| 3.3.1 | Implement `NL2Cypher` converter (few-shot LLM → Cypher; validate against schema) | Eng-3 | Very High | Natural language graph queries |
| 3.3.2 | Implement `GraphRAGFusion`: merge Kuzu traversal results with Qdrant chunks | Eng-3 | Very High | Richer combined context |
| 3.3.3 | Expose graph query as MCP tool: `kuzu_query(cypher)` | Eng-3 | Medium | Agents can traverse graph |
| 3.3.4 | Implement `kotg graph query [question]` CLI command | Eng-1 | Low | User-facing graph query |

### Milestone 3.4 — Incident Memory (Week 5–6)

| Task ID | Task | Eng | Complexity | Output |
|---|---|---|---|---|
| 3.4.1 | Implement `IncidentRecorder`: create Incident nodes from CLI reports / alerts | Eng-2 | High | Incident capture |
| 3.4.2 | Implement `IncidentLinker`: link Incident → affected resources via TRIGGERED_BY | Eng-2 | High | Causal linking |
| 3.4.3 | Implement `IncidentMemory.find_similar()`: GraphRAG over past incidents | Eng-2 | High | "We've seen this before" detection |
| 3.4.4 | Implement SIMILAR_TO edges between incidents (embedding similarity in Qdrant) | Eng-2 | High | Incident clustering |
| 3.4.5 | Test with 50 synthetic incident replays; measure match accuracy | Eng-2 | Medium | ≥70% match accuracy |

**Phase 3 Gate:**
- Live cluster graph syncs within 5s of changes
- Causal query returns accurate timeline with ≥70% accuracy
- IncidentMemory matches similar incidents with ≥70% accuracy

---

## Phase 4 — Agent System

**Duration:** 10 weeks
**Goal:** Full multi-agent orchestration with LangGraph v1.0 Supervisor
**Success Criteria:** Complex K8s incident diagnosed + remediation plan generated in <60s by autonomous agents

### Milestone 4.1 — LangGraph Agent Framework (Week 1–2)

| Task ID | Task | Eng | Complexity | Output |
|---|---|---|---|---|
| 4.1.1 | Set up LangGraph v1.0 Supervisor pattern as agent orchestration layer | Eng-3 | High | Agent orchestration foundation |
| 4.1.2 | Design shared `AgentState` schema (Pydantic) passed across all agents | Eng-3 | High | Common state model |
| 4.1.3 | Implement agent registration and dynamic routing in Supervisor | Eng-3 | High | Task routing |
| 4.1.4 | Implement task decomposition for complex queries (TaskPlanner) | Eng-3 | Very High | Multi-step planning |
| 4.1.5 | Implement Tier 4 HITL gate via LangGraph Interrupt (CLI + future Web UI) | Eng-1 | High | Safety gate |
| 4.1.6 | Implement standardized `AgentMessage` communication schema | Eng-3 | Medium | Agent communication |
| 4.1.7 | Implement global immutable audit log (SQLite append-only + hash chaining) | Eng-1 | Medium | Audit trail |
| 4.1.8 | Implement execution mode: Observe / Suggest / Execute (supervised) / Execute (trusted) | Eng-1 | Medium | Safety controls |
| 4.1.9 | Validate all agent runs appear in LangSmith with full trace | Eng-3 | Low | Observability validation |

### Milestone 4.2 — Cluster Observer Agent (Week 2–3)

| Task ID | Task | Complexity | Output |
|---|---|---|---|
| 4.2.1 | Implement `ClusterObserverAgent` (T0 model, continuous 60s polling) | High | Observer agent |
| 4.2.2 | Implement cluster health scoring: 0–100 composite score (pod health, node conditions, event severity) | High | Health score |
| 4.2.3 | Implement anomaly detection: statistical baseline comparison (7-day rolling) | Very High | Anomaly alerts |
| 4.2.4 | Implement `kotg observe [--watch]` CLI command with live updates | Medium | CLI integration |
| 4.2.5 | Test 30 anomaly scenarios (OOMKilled surge, restart storm, node NotReady) | High | Validated observer |

### Milestone 4.3 — Debugging Agent (Week 3–5)

| Task ID | Task | Complexity | Output |
|---|---|---|---|
| 4.3.1 | Implement `DebuggingAgent` with full ReAct loop (max 10 iterations) | Very High | Core diagnosis agent |
| 4.3.2 | Implement hypothesis generation: cluster state + RAG + graph → ranked hypotheses | Very High | Hypothesis engine |
| 4.3.3 | Implement hypothesis validation: tool execution → confirm/eliminate | High | Evidence-based validation |
| 4.3.4 | Implement confidence scoring: 0.0–1.0 for each hypothesis | High | RCA confidence |
| 4.3.5 | Implement remediation generator: ranked options with risk scores | High | Remediation options |
| 4.3.6 | Test on 100 common K8s failure scenarios (CrashLoopBackOff, OOMKilled, ImagePullBackOff, PVC bound, NetworkPolicy) | Very High | Validated debugger |
| 4.3.7 | Implement `kotg diagnose --deep` (full multi-step agent output) | Medium | Enhanced CLI |
| 4.3.8 | Benchmark: ≥70% correct RCA on 100 test scenarios | High | RCA accuracy baseline |

### Milestone 4.4 — YAML Generation Agent (Week 4–5)

| Task ID | Task | Complexity | Output |
|---|---|---|---|
| 4.4.1 | Implement `YAMLGenerationAgent` with KOTG-7B + Outlines grammar constraints | High | YAML agent |
| 4.4.2 | Implement validation pipeline: JSON schema → kubectl dry-run → Kyverno policy | High | Validated YAML output |
| 4.4.3 | Implement multi-resource generation (Deployment + Service + HPA + PDB) | High | Complex resource bundles |
| 4.4.4 | Implement interactive refinement loop: user feedback → agent improves YAML | Medium | Iterative generation |
| 4.4.5 | Test 1,000 YAML prompts; measure validity rate (target ≥95%) | Medium | Quality benchmark |

### Milestone 4.5 — Security Agent (Week 5–7)

| Task ID | Task | Complexity | Output |
|---|---|---|---|
| 4.5.1 | Implement `SecurityAgent` with Trivy + Kubescape + RBAC Analyzer | High | Security agent |
| 4.5.2 | Implement CIS Kubernetes Benchmark scanner | Very High | CIS compliance |
| 4.5.3 | Implement RBAC privilege escalation detector (cluster-admin grants, wildcard rules) | Very High | RBAC analysis |
| 4.5.4 | Implement network policy gap detector (pods with no NetworkPolicy) | High | Network security |
| 4.5.5 | Implement secret exposure scanner (plaintext in env vars, ConfigMaps) | High | Secret leak detection |
| 4.5.6 | Generate SARIF format output (GitHub Security tab compatible) | Medium | SARIF reports |
| 4.5.7 | `kotg secure [namespace]` CLI command | Medium | CLI integration |
| 4.5.8 | Test against CIS Kubernetes Benchmark full suite | High | Compliance validation |

### Milestone 4.6 — Cost Optimization Agent (Week 6–7)

| Task ID | Task | Complexity | Output |
|---|---|---|---|
| 4.6.1 | Implement `CostOptimizationAgent` with metrics-server + OpenCost integration | High | Cost agent |
| 4.6.2 | Implement VPA-style rightsizing recommendations (CPU + memory) | Very High | Rightsizing |
| 4.6.3 | Implement idle workload detector (zero-traffic for 72h+ via metrics) | High | Waste detection |
| 4.6.4 | Implement PVC waste scanner (unbound or 0% utilization volumes) | Medium | Storage waste |
| 4.6.5 | Implement per-namespace cost attribution (OpenCost API) | High | Cost attribution |
| 4.6.6 | Implement 30-day savings forecast with confidence interval | High | Cost forecast |
| 4.6.7 | `kotg cost [--namespace]` CLI command | Medium | CLI integration |

### Milestone 4.7 — Architecture Advisor + System Integration (Week 8–10)

| Task ID | Task | Complexity | Output |
|---|---|---|---|
| 4.7.1 | Implement `ArchitectureAdvisorAgent` (T3 model: DeepSeek-R1-Distill-32B) | Very High | Architecture advisor |
| 4.7.2 | Implement ADR generator (Architecture Decision Record) | High | ADR generation |
| 4.7.3 | Implement full Supervisor routing: all 5 agents coordinating | Very High | Complete agent system |
| 4.7.4 | Implement `kotg run [workflow]` for pre-built workflows | High | Workflow automation |
| 4.7.5 | Build 10 pre-built workflows: daily-health-check, incident-scan, security-audit | High | Workflow library |
| 4.7.6 | End-to-end integration test: full incident lifecycle (observe → diagnose → remediate → verify) | Very High | System validation |
| 4.7.7 | Performance test: ≤60s P95 for complete diagnosis cycle | High | Performance baseline |
| 4.7.8 | LangSmith eval: 50-incident eval set; measure agent quality across all types | High | Agent quality metrics |

**Phase 4 Gate:**
- CrashLoopBackOff, OOMKilled, ImagePullBackOff, NetworkPolicy, PVC issues all diagnosed correctly ≥70% of the time
- Security scan generates CIS compliance report
- Cost report identifies rightsizing opportunities
- Full agent suite in LangSmith with all traces visible

---

## Phase 5 — MCP Tool Ecosystem

**Duration:** 8 weeks
**Goal:** 50+ MCP tools + community registry
**Success Criteria:** Community can discover, install, and use KOTG MCP tools; cloud provider integrations working

### Milestone 5.1 — KOTG MCP SDK (Week 1–3)

| Task ID | Task | Complexity | Output |
|---|---|---|---|
| 5.1.1 | Implement `MCPServer` using FastMCP; extend Red Hat kubectl MCP server | High | KOTG MCP server |
| 5.1.2 | Implement `MCPRegistry`: tool discovery, versioning, health monitoring | Very High | Tool registry |
| 5.1.3 | Implement Streamable HTTP transport for KOTG MCP server (production) | High | Remote MCP access |
| 5.1.4 | Implement sandboxed subprocess executor for untrusted community tools | Very High | Security sandbox |
| 5.1.5 | Implement tool signing and signature verification | High | Supply chain security |
| 5.1.6 | Publish `kotg-mcp-sdk` as separate PyPI package + documentation | Medium | Community SDK |

### Milestone 5.2 — Core CNCF Tool Suite (Week 2–6)

**Kubernetes & GitOps:**

| Tool | Key Capabilities | Complexity |
|---|---|---|
| `helm-mcp` | install, upgrade, rollback, diff, template, test | High |
| `kustomize-mcp` | build, diff, apply overlays | Medium |
| `argocd-mcp` | sync, diff, rollback, app health, application list | High |
| `flux-mcp` | reconcile, suspend, resume, source update | High |

**Observability:**

| Tool | Key Capabilities | Complexity |
|---|---|---|
| `prometheus-mcp` | PromQL execution, alert queries, target health | High |
| `grafana-mcp` | dashboard query, alert management | High |
| `loki-mcp` | LogQL queries, log streaming | High |

**Security:**

| Tool | Key Capabilities | Complexity |
|---|---|---|
| `trivy-mcp` | image scan, fs scan, k8s cluster scan | Medium |
| `kubescape-mcp` | NSA/MITRE framework scan, CIS benchmark | Medium |
| `kyverno-mcp` | policy apply, validate, generate, report | High |
| `falco-mcp` | runtime threat events, rule management | High |

### Milestone 5.3 — Cloud Provider Tools (Week 4–7)

| Tool | Key Capabilities | Complexity |
|---|---|---|
| `aws-eks-mcp` | EKS cluster ops, nodegroup management, fargate | Very High |
| `aws-cloudwatch-mcp` | metrics, logs, alarms, Container Insights | High |
| `gke-mcp` | GKE cluster ops, autopilot, workload identity | Very High |
| `azure-aks-mcp` | AKS cluster ops, node pools, ACR integration | Very High |
| `opencost-mcp` | cost attribution, namespace costs, savings | High |

### Milestone 5.4 — Community Registry (Week 6–8)

| Task ID | Task | Complexity | Output |
|---|---|---|---|
| 5.4.1 | Build MCP tool registry API (FastAPI + GitHub-backed) with search + versioning | High | Registry API |
| 5.4.2 | Build community submission pipeline: GitHub PR → auto-test → publish | High | Contribution workflow |
| 5.4.3 | Implement auto-discovery: agents query registry at startup, load installed tools | Medium | Dynamic tool loading |
| 5.4.4 | Build tool health monitoring (automated tests against sandbox endpoints) | High | Registry reliability |
| 5.4.5 | Launch with ≥10 community-contributed tools | High | Community ecosystem |
| 5.4.6 | Security audit of all community tools (automated scan + manual review threshold) | Very High | Security validation |

**Phase 5 Gate:** 50+ MCP tools available; cloud provider tools tested end-to-end; community registry accepting submissions.

---

## Phase 6 — Kubernetes Cluster Integration

**Duration:** 6 weeks
**Goal:** KOTG.AI as a native Kubernetes workload
**Success Criteria:** `kubectl apply -f kotg-operator.yaml` deploys KOTG.AI in-cluster; `kubectl krew install kotg` works

### Milestone 6.1 — KotgInstance Operator (Week 1–4)

| Task ID | Task | Complexity | Output |
|---|---|---|---|
| 6.1.1 | Design `KotgInstance` CRD schema (model tiers, storage, MCP tools, HA) | High | CRD specification |
| 6.1.2 | Implement operator with Kopf (Python) or Operator SDK (Go) | Medium | Operator skeleton |
| 6.1.3 | Implement KotgInstance reconcile loop: create/update/delete all components | Very High | Working operator |
| 6.1.4 | Implement Ollama StatefulSet lifecycle management + model download Job | High | In-cluster LLM |
| 6.1.5 | Implement Qdrant StatefulSet with PVC provisioning | Medium | In-cluster vector DB |
| 6.1.6 | Implement Kuzu PVC-backed storage (portable SQLite/Kuzu files) | Medium | In-cluster graph DB |
| 6.1.7 | Implement knowledge base sync CronJob (weekly doc refresh) | Medium | Automated KB updates |
| 6.1.8 | Implement multi-replica coordination (leader election for observer agent) | High | HA support |
| 6.1.9 | Publish Helm chart to ArtifactHub | Low | `helm install kotg` works |
| 6.1.10 | Apply to OperatorHub.io | Low | Community distribution |

### Milestone 6.2 — kubectl Plugin (Week 3–5)

| Task ID | Task | Complexity | Output |
|---|---|---|---|
| 6.2.1 | Implement `kubectl-kotg` binary (Go or Python, statically linked) | Medium | kubectl plugin |
| 6.2.2 | Commands: `kubectl kotg diagnose`, `kubectl kotg secure`, `kubectl kotg cost`, `kubectl kotg generate` | High | Full plugin feature set |
| 6.2.3 | Publish to krew index | Low | `kubectl krew install kotg` works |

### Milestone 6.3 — Production Hardening (Week 5–6)

| Task ID | Task | Complexity | Output |
|---|---|---|---|
| 6.3.1 | Implement graceful degradation: reduce model tier when resources low | High | Resilient operation |
| 6.3.2 | Implement circuit breakers for all external MCP tool calls | High | Fault tolerance |
| 6.3.3 | Implement resource limits + VPA for KOTG pods | Medium | Resource management |
| 6.3.4 | Security hardening: mTLS between components, RBAC minimal permissions | High | Security posture |
| 6.3.5 | Performance test: ≤30s diagnosis time on 4-core in-cluster deployment | High | Performance SLO |
| 6.3.6 | 2-week soak test: 99.5%+ uptime target | High | Reliability validation |
| 6.3.7 | Write KOTG operations runbook | Medium | Ops documentation |

**Phase 6 Gate:** Operator deploys in <5min; krew install works; 99.5% uptime in 2-week soak; ≤30s P95 diagnosis in-cluster.

---

## Phase 7 — Production Platform

**Duration:** 12 weeks
**Goal:** Web UI + enterprise features + KOTG Cloud
**Success Criteria:** First paying enterprise customer on KOTG Pro or Enterprise

### Milestone 7.1 — Web UI (Week 1–5)

| Task ID | Task | Complexity | Output |
|---|---|---|---|
| 7.1.1 | Design UX in Figma: chat interface, cluster dashboard, incident timeline, YAML editor | Medium | Design specs |
| 7.1.2 | Implement Next.js 15 (App Router) frontend with TypeScript | High | Web app |
| 7.1.3 | Implement real-time streaming chat (WebSocket + Server-Sent Events) | High | Live chat UI |
| 7.1.4 | Implement cluster topology visualization (Cytoscape.js — nodes = K8s resources) | Very High | Graph explorer |
| 7.1.5 | Implement incident timeline view (D3.js or Recharts) | High | Incident dashboard |
| 7.1.6 | Implement YAML editor with AI inline suggestions (Monaco Editor + KOTG) | High | YAML editor |
| 7.1.7 | Implement security + cost dashboards (charts, trends, recommendations) | High | Analytics dashboards |

### Milestone 7.2 — Enterprise Features (Week 4–9)

| Task ID | Task | Complexity | Output |
|---|---|---|---|
| 7.2.1 | Multi-tenant RBAC: teams, namespaces, tool tiers, audit access | Very High | Multi-tenancy |
| 7.2.2 | SSO via OIDC/SAML (Dex or Keycloak integration) | High | Enterprise auth |
| 7.2.3 | Immutable audit log (cryptographic chaining, tamper-evident) | High | Compliance logging |
| 7.2.4 | Compliance report generator: CIS, SOC2 evidence, PCI DSS | Very High | Compliance automation |
| 7.2.5 | Air-gapped deployment mode (bundled models + KB, zero internet) | High | Air-gap enterprise |
| 7.2.6 | Private knowledge base: ingest internal runbooks, wikis, incident history | High | Org intelligence |
| 7.2.7 | Private fine-tuning: train KOTG-PRIVATE on internal incident data (in-cluster) | Very High | Custom model |
| 7.2.8 | Enterprise SLA monitoring + PagerDuty integration | Medium | Enterprise reliability |

### Milestone 7.3 — KOTG Cloud (Week 7–12)

| Task ID | Task | Complexity | Output |
|---|---|---|---|
| 7.3.1 | Multi-tenant cloud infrastructure (GKE Autopilot + Cloud Run) | Very High | Cloud platform |
| 7.3.2 | Usage metering + billing (Stripe integration) | High | Revenue infrastructure |
| 7.3.3 | Managed model serving: vLLM cluster behind LiteLLM proxy | High | Scalable inference |
| 7.3.4 | Self-service onboarding: sign up → cluster connect → first diagnosis <10min | High | Product-led growth |
| 7.3.5 | Data isolation: per-tenant Qdrant collections + Kuzu DB files | Very High | Multi-tenant security |
| 7.3.6 | Usage dashboard: queries/month, incidents resolved, cost saved | Medium | Customer value metrics |

**Phase 7 Gate:** First paying enterprise customer; 50+ Pro subscribers; KOTG Cloud processing 100+ diagnoses/day.

---

## Cross-Phase Requirements

These tasks run throughout all phases:

### Security (Ongoing)
- Quarterly MCP tool security audit (automated + manual review)
- Monthly dependency vulnerability scan (`pip audit`, `trivy fs .`)
- Red team testing: prompt injection via cluster data quarterly
- CVE monitoring: if KOTG dependency has critical CVE → patch within 48h

### Evaluation (Ongoing, Every Phase)
- RAGAS evaluation: run weekly after Phase 1
- Agent eval (LangSmith): 50-incident eval set; run weekly after Phase 4
- YAML validity benchmark: run on every PR after Phase 1
- Performance benchmark: P95 latency tracked in CI after Phase 1

### Documentation (Every Phase)
- README updated for every new user-facing feature
- Architecture Decision Records (ADRs) for every major tech choice
- API documentation auto-generated via FastAPI OpenAPI
- CHANGELOG maintained for every release

### Community (After Phase 1 Launch)
- GitHub Discussions monitored daily; issues triaged within 48h
- Discord community managed
- Monthly community call
- Contribution guide updated with each phase

---

## Engineering Team Roles

| Role | Responsibilities |
|---|---|
| **Eng-1** | CLI, Web UI, documentation, DevOps, CI/CD, release management |
| **Eng-2** | RAG pipeline, data ingestion, fine-tuning, evaluation, embeddings |
| **Eng-3** | Agent system, LangGraph, MCP tools, knowledge graph, security |

Recommended: 3 engineers minimum. Each engineer owns their phase deliverables but all engineers participate in architecture spikes and gate reviews.

---

## Technology Reference (Locked Versions)

Never use `latest` in production. Pin these:

```toml
# pyproject.toml dependencies
langgraph = ">=1.0.0,<2.0.0"
langgraph-supervisor = ">=0.0.1"
langsmith = ">=0.2.0"
litellm = ">=1.30.0"
llama-index-core = ">=0.11.0"
llama-index-vector-stores-qdrant = ">=0.3.0"
llama-index-embeddings-ollama = ">=0.3.0"
qdrant-client = ">=1.11.0"
kuzu = ">=0.7.0"
outlines = ">=0.1.0"
instructor = ">=1.4.0"
mcp = ">=1.0.0"
fastapi = ">=0.115.0"
pydantic = ">=2.8.0"
pydantic-settings = ">=2.4.0"
typer = ">=0.12.0"
rich = ">=13.8.0"
duckdb = ">=1.1.0"
structlog = ">=24.4.0"
kubernetes = ">=31.0.0"
jinja2 = ">=3.1.0"
httpx = ">=0.27.0"
anyio = ">=4.6.0"
```

