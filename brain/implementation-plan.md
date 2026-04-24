# KOTG.AI — Implementation Plan

**Version:** 2.0
**Date:** 2026-02-28
**Budget Constraint:** $100 Total (initial build)
**Status:** Research-Validated Engineering Blueprint

---

## Executive Summary

This document provides the complete, research-validated technical implementation plan for KOTG.AI. Every technology decision is backed by 2025–2026 production evidence. Before reading this, understand three non-negotiable principles:

1. **Never ship a single-agent system.** Multi-agent + tool calling is the architectural moat.
2. **Never trust model benchmarks alone.** Kubernetes YAML validity and tool calling reliability are the only metrics that matter.
3. **Local-first is a feature, not a compromise.** Qwen2.5-Coder-7B outperforms GPT-3.5 on code generation and runs on 8GB RAM.

---

## 1. Technology Stack — Definitive Decisions

Do not deviate from these choices without an architecture review documenting why.

### 1.1 Core Technology Choices

| Layer | Technology | Version | Alternative Rejected | Decision Rationale |
|---|---|---|---|---|
| **Agent Orchestration** | LangGraph | v1.0+ (GA Oct 2025) | AutoGen v0.4, CrewAI | LangGraph v1.0 used in production at Uber/LinkedIn/Elastic; native HITL via `Interrupt`; Supervisor pattern for multi-agent; AutoGen forked (community drama); LangGraph v1.0 = stability commitment |
| **RAG Framework** | LlamaIndex | v0.11+ | LangChain, bare Qdrant | LlamaIndex Workflows are the best primitive for durable RAG pipelines; superior document connectors; LlamaIndex + LangGraph is the recommended production stack (complementary) |
| **LLM Abstraction** | LiteLLM | v1.30+ | LangChain LLM wrappers | 50ms overhead at 250 RPS; OpenAI-compatible for all providers; zero-change swap between Ollama/vLLM/cloud |
| **Local Inference (Dev)** | Ollama | v0.5+ | llama.cpp direct | Zero-config; cross-platform; best developer experience |
| **Local Inference (Prod)** | vLLM or SGLang | latest | Ollama only | vLLM: PagedAttention, continuous batching for concurrent agents; SGLang: 3-5× faster for structured output (use for YAML agent) |
| **Vector DB** | Qdrant | v1.11+ | Chroma, Weaviate, pgvector | Rust-based (5× faster than Chroma); native sparse+dense (BM42); on-disk for 50GB+ corpus; MIT license |
| **Graph DB** | Kuzu | v0.7+ | Neo4j CE | Embedded (no server); 18× faster than Neo4j on LDBC benchmark; Cypher-compatible; MIT license |
| **Embedding Model** | BGE-M3 (primary) | — | nomic-embed-text | State-of-the-art for technical content: 8192 token context; simultaneous dense+sparse+multi-vector; best MTEB scores for code/YAML |
| **Reranking** | Jina Reranker v2 | — | Cross-encoder BERT | 10× cheaper than LLM reranking; 90% of quality gain; production-proven |
| **Structured Output** | Outlines + Instructor | latest | JSON mode only | Guarantees valid JSON/YAML via grammar-constrained decoding; critical for 7B model tool calling (85% → 99% reliability) |
| **CLI** | Typer + Rich | latest | Click | Best Python CLI ergonomics; Rich for beautiful terminal output |
| **API Server** | FastAPI | v0.115+ | Flask | Async-native; WebSocket streaming; auto OpenAPI |
| **Conversation Storage** | SQLite (WAL mode) | — | PostgreSQL, Redis | Embedded; no server; WAL for concurrent reads; sufficient for all local deployments |
| **Analytics Storage** | DuckDB | v1.1+ | PostgreSQL, ClickHouse | Embedded OLAP; perfect for cost analytics, incident timelines; no server |
| **Observability** | LangSmith | — | LangFuse | Native to LangGraph; trace visualization; evaluation datasets; prompt management; free tier |
| **Fine-Tuning** | Unsloth + TRL | latest | Axolotl, LLaMA-Factory | 2× faster QLoRA training; 70% less VRAM; DPO/GRPO support |
| **Deployment** | Helm + KotgInstance CRD | — | Kustomize-only | Helm for distribution; CRD for in-cluster lifecycle management |

### 1.2 Critical Anti-Patterns — What We Are NOT Using

| Tool | Reason for Rejection |
|---|---|
| **LangChain LLM wrappers** | Use LiteLLM directly. LangChain adds abstraction with no benefit for raw LLM calls. LangGraph is separate from LangChain — use it. |
| **Chroma** | Qdrant is faster, supports sparse natively, scales to 50GB+ on disk. Chroma is a demo tool. |
| **Redis** | Over-engineering. SQLite WAL handles session state. DuckDB handles analytics. |
| **Neo4j CE** | AGPL license risk; Kuzu is 18× faster for our embedded use case. |
| **Apache Airflow** | Too heavy for KB scheduling. GitHub Actions (free) or K8s CronJob. |
| **Llama 4** | **NOT open-weight.** Meta Llama 4 Scout/Maverick are API-only commercial products. Do not reference for local inference. |
| **"Llama 3.2 8B"** | **DOES NOT EXIST.** Llama 3.2 = 1B/3B (text) + 11B/90B (vision). The 8B text model is Llama 3.1. Use `llama3.1:8b` or prefer `qwen2.5-coder:7b-instruct`. |
| **GPT-4o/Claude as primary** | Cloud LLMs are optional fallback only. Core intelligence must be local. |
| **AutoGen v0.4** | Community fork (AG2 vs Microsoft) creates maintenance uncertainty. LangGraph has better multi-agent primitives for K8s diagnosis. |

---

## 2. AI Model Strategy

### 2.1 Tiered Model Architecture

| Tier | Role | Primary Model | Fallback | RAM | Tool Call Reliability |
|---|---|---|---|---|---|
| **T0 — Nano** | Intent classification, slot extraction | `qwen2.5:0.5b` | `phi-4-mini:3.8b` | 1GB | N/A (single-token) |
| **T1 — Small** | Simple Q&A, YAML templates, quick explanations | `qwen2.5-coder:7b-instruct` | `llama3.1:8b` | 6GB | ~85% (use Outlines) |
| **T2 — Medium** | Multi-step diagnosis, tool calling loops | `qwen2.5-coder:14b-instruct` | `deepseek-r1-distill-qwen:14b` | 10GB | ~92% |
| **T3 — Large** | Architecture analysis, complex RCA, KEP review | `deepseek-r1-distill-qwen:32b` | `qwen2.5:32b` | 22GB | ~97% |
| **T4 — Expert** | Maximum intelligence (optional cloud) | `deepseek-r1:671b` via API | `claude-3-7-sonnet` | API | ~99% |
| **Embed** | Dense + sparse vector embeddings | `bge-m3:latest` | `nomic-embed-text` | 2GB | N/A |

**Edge Profile (4GB RAM, fully offline):**
- T0: `qwen2.5:0.5b` (1GB Q4)
- T1: `qwen3:4b` (3GB Q4) — Qwen3 series outperforms Qwen2.5 at same parameter count

### 2.2 Primary Model Justification (2025-2026 Validated)

**YAML Generation (T1): `qwen2.5-coder:7b-instruct` (Q4_K_M)**
- Outperforms GPT-3.5 on HumanEval and code generation benchmarks
- Strong YAML schema adherence; excellent instruction following
- 7B fits on 8GB RAM; Apache 2.0 license
- Use with Outlines grammar constraints for 99% valid YAML

**Multi-Step Diagnosis (T2): `qwen2.5-coder:14b-instruct` (Q4_K_M)**
- 14B provides ~92% tool calling reliability (vs ~85% for 7B)
- Strong chain-of-thought; handles multi-turn diagnostic loops
- 10GB RAM; runs on Apple M2 Pro with Metal acceleration

**Complex Reasoning (T3): `deepseek-r1-distill-qwen:32b` (Q4_K_M)**
- R1 distillation = built-in chain-of-thought
- Best for architecture review, KEP analysis, multi-cluster design
- 22GB RAM; NVIDIA GPU or Apple M3 Max recommended

**Embeddings: `bge-m3`**
- 8192 token context window (handles long K8s docs without truncation)
- Simultaneous dense + sparse + multi-vector output
- State-of-the-art on MTEB for technical/code content
- Fallback: `nomic-embed-text` for resource-constrained edge nodes

**Custom Fine-Tuned: `KOTG-7B`** (built Phase 2)
- Base: Qwen2.5-7B-Instruct → QLoRA fine-tuning with Unsloth
- Training: 200K+ curated K8s examples
- Delivery: `ollama pull kotg/kotg-7b` (GGUF Q4_K_M)

### 2.3 Inference Engine Stack

```
DEV (local single-user):
  Ollama → zero-config model management, cross-platform, OpenAI API

PROD (multi-agent, concurrent):
  vLLM  → PagedAttention + continuous batching
         → handles 3+ concurrent agent tool-call loops

YAML/STRUCTURED (high-throughput):
  SGLang → RadixAttention + jump-forward constrained decoding
          → 3-5× faster than vLLM for structured output generation

ALL unified via: LiteLLM Proxy (50ms overhead, OpenAI-compatible)
```

### 2.4 Hardware Profiles

| Profile | Hardware | Max Tier | Use Case |
|---|---|---|---|
| **Ultra-Light (Edge)** | 4GB RAM, CPU | T1 (Qwen3-4B) | K3s edge; offline-only |
| **Standard (Laptop)** | 8GB RAM, CPU/M1 | T1 full, T2 slow | Solo engineer CLI |
| **Performance (M2/M3)** | 16GB RAM, Apple Silicon | T2 full | Recommended minimum for multi-agent |
| **Power (M3 Pro/Max)** | 32GB+ RAM, Apple Silicon | T3 full | Architecture advisor; full suite |
| **GPU Server** | 24GB VRAM (RTX 4090) | T3 full | Production in-cluster deployment |
| **Multi-GPU** | 2× RTX 4090 / A100 | T4 local | Enterprise high-concurrency |

---

## 3. RAG Architecture

### 3.1 The Contextual Retrieval Insight

Standard RAG embeds chunks without surrounding context. KOTG.AI uses **Contextual Retrieval** (Anthropic, Sept 2024), which reduces retrieval failure by 49–67%:

```
Standard chunk (no context):
  "The container failed to start because of missing environment variables."
  → Semantically ambiguous; which container? which variables?

Contextual chunk (with KOTG preprocessing):
  "[Kubernetes 1.30, Pod lifecycle, production troubleshooting]
   Context: This chunk describes how kubelet handles missing environment
   variables from ConfigMap references when a Pod fails to start.
   The container failed to start because of missing environment variables."
  → Dramatically better retrieval precision
```

A T0 model (Qwen2.5-0.5B) generates the context prefix for each chunk at ingestion time. Adds ~0.3% to ingestion cost; reduces retrieval errors by ~49%.

### 3.2 Hybrid Retrieval Pipeline

```
Query
  │
  ├── T0: Intent classification (diagnose/explain/generate/analyze)
  ├── T0: Entity extraction (resource types, namespaces, error keywords)
  └── T1: Query rewriting (add K8s synonyms, expand acronyms)
          │
          ▼
    Qdrant Hybrid Search
    ├── Dense: BGE-M3 embeddings (semantic similarity)
    └── Sparse: BM42 (keyword precision, better than BM25 for technical docs)
        → Reciprocal Rank Fusion → top-20 combined results
          │
          ▼
    Jina Reranker v2 → top-5 high-precision results
          │
          ▼
    Kuzu Graph Augmentation
    ├── "What resources are related to the failing Pod?"
    ├── "What changed in the 10 minutes before this incident?"
    └── "Have we seen similar incidents? What fixed them?"
          │
          ▼
    Context Assembly (≤8K tokens)
    ├── Deduplicate overlapping chunks
    ├── Order by relevance + recency
    └── Add source citations (for hallucination detection)
          │
          ▼
    LLM Synthesis (T1-T3 model)
```

### 3.3 Vector Store Schema

```python
# Qdrant collection: KOTG knowledge base
knowledge_collection_config = {
    "name": "kotg_knowledge",
    "vectors": {
        "bge-m3-dense": VectorParams(size=1024, distance=Distance.COSINE),
        "bge-m3-sparse": SparseVectorParams(modifier=Modifier.IDF),  # BM42
    },
    "payload_schema": {
        "source": "keyword",         # docs|kep|stackoverflow|github|cve|runbook
        "k8s_version": "keyword",    # 1.29|1.30|1.31|1.32
        "resource_type": "keyword",  # Pod|Deployment|Service|Node|...
        "category": "keyword",       # networking|storage|security|cost|scheduling
        "severity": "keyword",       # critical|high|medium|low
        "timestamp": "datetime",
    }
}

# Qdrant collection: incident memory (cluster-specific, private)
incident_collection_config = {
    "name": "kotg_incidents",
    "vectors": {
        "incident-dense": VectorParams(size=1024, distance=Distance.COSINE),
        "incident-sparse": SparseVectorParams(),
    },
    "payload_schema": {
        "cluster_id": "keyword",
        "root_cause_category": "keyword",  # oomkilled|crashloop|imagepull|networkpolicy|...
        "resolution_summary": "text",
        "resolution_time_minutes": "integer",
        "recurrence_count": "integer",
    }
}
```

### 3.4 Knowledge Base Sources

| Source | Size Est. | Frequency | Method |
|---|---|---|---|
| kubernetes.io official docs | 500MB | Weekly | DocsCrawler (aiohttp + trafilatura) |
| KEPs (k/enhancements) | 200MB | Weekly | PyGitHub |
| Kubernetes GitHub issues (bug/help) | 2GB | Daily | PyGitHub API |
| CNCF project docs | 1GB | Weekly | DocsCrawler |
| ArtifactHub Helm chart READMEs (top-500) | 300MB | Weekly | ArtifactHub API |
| NVD + GHSA CVE advisories | 150MB | Daily | NVD API + GHSA GraphQL |
| StackOverflow K8s (top 50K by votes) | 300MB | Monthly | Stack Exchange API |
| Public incident reports | 100MB | Monthly | Curated sources |
| Kubernetes source code (key packages) | 200MB | Monthly | GitHub API |
| Curated performance guides | 50MB | Monthly | Manual |

**Total: ~5GB compressed, ~50GB uncompressed**

### 3.5 Chunking Strategy

```
Markdown/prose  → SemanticSplitter (LlamaIndex)
                  512 tokens ± 25% (sentence-boundary-aware)
                  64 token overlap between chunks

YAML/code       → CodeSplitter (LlamaIndex)
                  Preserve YAML document boundaries (---)
                  Keep resource definitions intact (no mid-resource splits)

Long sections   → HierarchicalNodeParser (LlamaIndex)
                  Parent: full section (~2048 tokens, stored not indexed)
                  Child: 512 token chunks (retrieved; parent injected into context)

All chunks      → Contextual Retrieval preprocessing
                  T0 model generates 1-2 sentence context prefix per chunk
```

---

## 4. Knowledge Graph Architecture

### 4.1 Kuzu Schema

```cypher
-- Node tables
CREATE NODE TABLE Cluster(id STRING, name STRING, k8s_version STRING,
  provider STRING, region STRING, PRIMARY KEY(id));

CREATE NODE TABLE Namespace(id STRING, name STRING, cluster_id STRING,
  labels STRING, status STRING, PRIMARY KEY(id));

CREATE NODE TABLE Deployment(id STRING, name STRING, namespace STRING,
  cluster_id STRING, replicas_desired INT, replicas_ready INT,
  image STRING, status STRING, last_updated TIMESTAMP, PRIMARY KEY(id));

CREATE NODE TABLE Pod(id STRING, name STRING, namespace STRING,
  cluster_id STRING, phase STRING, node_name STRING,
  restart_count INT, containers STRING, started_at TIMESTAMP,
  last_transition TIMESTAMP, PRIMARY KEY(id));

CREATE NODE TABLE Service(id STRING, name STRING, namespace STRING,
  cluster_id STRING, type STRING, cluster_ip STRING, ports STRING,
  PRIMARY KEY(id));

CREATE NODE TABLE ConfigMap(id STRING, name STRING, namespace STRING,
  cluster_id STRING, data_keys STRING, last_modified TIMESTAMP,
  PRIMARY KEY(id));

CREATE NODE TABLE Secret(id STRING, name STRING, namespace STRING,
  cluster_id STRING, type STRING, PRIMARY KEY(id));  -- values NEVER stored

CREATE NODE TABLE Node(id STRING, name STRING, cluster_id STRING,
  role STRING, status STRING, allocatable_cpu STRING,
  allocatable_memory STRING, conditions STRING, PRIMARY KEY(id));

CREATE NODE TABLE Event(id STRING, namespace STRING, cluster_id STRING,
  reason STRING, message STRING, type STRING,
  involved_kind STRING, involved_name STRING,
  count INT, last_timestamp TIMESTAMP, PRIMARY KEY(id));

CREATE NODE TABLE CVE(id STRING, severity STRING, cvss_score DOUBLE,
  description STRING, affected_versions STRING,
  published_date TIMESTAMP, PRIMARY KEY(id));

CREATE NODE TABLE Incident(id STRING, cluster_id STRING, title STRING,
  severity STRING, root_cause STRING, resolution STRING,
  started_at TIMESTAMP, resolved_at TIMESTAMP,
  resolution_time_minutes INT, PRIMARY KEY(id));

CREATE NODE TABLE KnowledgeChunk(id STRING, content_preview STRING,
  source STRING, k8s_version STRING, qdrant_point_id STRING,
  PRIMARY KEY(id));

-- Relationship tables
CREATE REL TABLE OWNS(FROM Deployment TO Pod);
CREATE REL TABLE MOUNTS_CONFIGMAP(FROM Pod TO ConfigMap);
CREATE REL TABLE MOUNTS_SECRET(FROM Pod TO Secret);
CREATE REL TABLE SELECTS(FROM Service TO Pod);
CREATE REL TABLE RUNS_ON(FROM Pod TO Node);
CREATE REL TABLE IN_NAMESPACE(FROM Deployment TO Namespace,
  FROM Pod TO Namespace, FROM Service TO Namespace);
CREATE REL TABLE IN_CLUSTER(FROM Namespace TO Cluster);
CREATE REL TABLE INCIDENT_AFFECTED(FROM Incident TO Deployment,
  FROM Incident TO Pod);
CREATE REL TABLE TRIGGERED_BY(FROM Incident TO Event,
  properties(correlation_score DOUBLE));
CREATE REL TABLE RESOLVED_BY(FROM Incident TO Deployment,
  properties(action STRING));
CREATE REL TABLE AFFECTS_VERSION(FROM CVE TO Cluster,
  properties(confirmed BOOLEAN));
CREATE REL TABLE SIMILAR_TO(FROM Incident TO Incident,
  properties(similarity_score DOUBLE));
```

### 4.2 Live Cluster Synchronization

```
Kubernetes Informers (watch API — event-driven, zero polling overhead)
├── PodInformer      → GraphSyncer.sync_pod()
├── DeploymentInformer → GraphSyncer.sync_deployment()
├── ServiceInformer  → GraphSyncer.sync_service()
├── ConfigMapInformer → GraphSyncer.sync_configmap()
├── EventInformer    → GraphSyncer.sync_event()
└── NodeInformer     → GraphSyncer.sync_node()

GraphSyncer:
├── MERGE nodes by id (upsert semantics)
├── Update relationships on every change
├── Write immutable change log to SQLite (timestamp + resource JSON snapshot)
└── Trigger ChangeCorrelator on event bursts (detect cascading failures)

ChangeCorrelator:
└── Query: "what resources changed in ±5 minutes around this event?"
    → SQLite time-range query → graph edge creation (TRIGGERED_BY)
```

### 4.3 GraphRAG Fusion Query Example

```python
async def graphrag_diagnose(query: str, cluster_id: str) -> str:
    # 1. Parallel: vector search + graph traversal
    knowledge, cluster_state, similar_incidents = await asyncio.gather(
        qdrant_hybrid_search(query, top_k=10),
        kuzu.query("""
            MATCH (d:Deployment {cluster_id: $cluster_id})-[:OWNS]->(p:Pod)
            WHERE p.restart_count > 3 OR p.phase = 'Failed'
            OPTIONAL MATCH (p)-[:MOUNTS_CONFIGMAP]->(cm:ConfigMap)
            RETURN d.name, p.name, p.phase, p.restart_count, cm.name
            ORDER BY p.restart_count DESC LIMIT 20
        """, cluster_id=cluster_id),
        kuzu.query("""
            MATCH (i:Incident {cluster_id: $cluster_id})
            WHERE i.resolved_at IS NOT NULL
            ORDER BY i.resolved_at DESC LIMIT 5
            RETURN i.title, i.root_cause, i.resolution
        """, cluster_id=cluster_id),
    )

    # 2. Rerank knowledge chunks against actual cluster state
    reranked = await jina_reranker(query, knowledge, top_k=5)

    # 3. Assemble unified context (≤8K tokens)
    context = assemble_context(reranked, cluster_state, similar_incidents)

    # 4. Synthesize with T2 model
    return await llm.generate(messages=diagnose_prompt(query, context))
```

---

## 5. Agent Architecture

### 5.1 LangGraph v1.0 Supervisor Pattern

```python
from langgraph_supervisor import create_supervisor
from langgraph.prebuilt import create_react_agent

# Each agent: specialized model + dedicated toolset
observer = create_react_agent(
    model=ollama("qwen2.5:0.5b"),
    tools=[kubectl_get, kubectl_top, kubectl_events],
    name="observer",
    prompt="You are the Cluster Observer. Monitor cluster health and detect anomalies."
)

debugger = create_react_agent(
    model=ollama("qwen2.5-coder:14b"),
    tools=[kubectl_describe, kubectl_logs, kubectl_events, qdrant_search, kuzu_query],
    name="debugger",
    prompt="You are the Kubernetes Debugger. Use ReAct to diagnose root causes."
)

yaml_agent = create_react_agent(
    model=ollama("kotg/kotg-7b"),   # custom fine-tuned
    tools=[schema_validator, kubectl_dry_run, kyverno_validate],
    name="yaml_generator",
    prompt="You are the YAML Generator. Always apply security defaults."
)

security_agent = create_react_agent(
    model=ollama("qwen2.5:7b"),
    tools=[trivy_mcp, kubescape_mcp, falco_mcp, rbac_analyzer],
    name="security_agent",
    prompt="You are the Security Agent. Scan for CIS benchmark violations, CVEs, RBAC issues."
)

cost_agent = create_react_agent(
    model=ollama("qwen2.5:7b"),
    tools=[kubectl_top, metrics_server_mcp, opencost_mcp],
    name="cost_agent",
    prompt="You are the Cost Agent. Identify waste and rightsizing opportunities."
)

# Supervisor routes tasks to the right agent(s)
supervisor_graph = create_supervisor(
    agents=[observer, debugger, yaml_agent, security_agent, cost_agent],
    model=ollama("qwen2.5:7b"),
    output_mode="last_message",
    system_prompt="""You are the KOTG.AI Orchestrator. Route tasks to the right specialist.
    For incidents: use debugger. For YAML: use yaml_generator. 
    For security: use security_agent. For cost: use cost_agent."""
)
```

### 5.2 Human-in-the-Loop via LangGraph Interrupt

```python
@tool
async def kubectl_apply(manifest: str) -> str:
    """Apply a Kubernetes manifest. Requires human approval."""
    # LangGraph Interrupt pauses the graph here
    result = interrupt({
        "type": "approval_required",
        "action": "kubectl apply",
        "manifest_preview": manifest[:1000],
        "dry_run_result": await dry_run(manifest),
        "rollback_plan": f"kubectl delete -f <manifest>",
        "risk": "This modifies cluster state in namespace {namespace}",
    })
    if result.get("approved"):
        return await apply_manifest(manifest)
    return "Execution cancelled by user."
```

**Execution Modes:**

| Mode | Tier 4 Tools | Description |
|---|---|---|
| **Observe** | Blocked | Read-only cluster inspection |
| **Suggest** | Blocked | Generates plans; no execution |
| **Execute (Supervised)** | Interrupt → approve | HITL per action; full audit trail |
| **Execute (Trusted)** | Scoped pre-approval | Pre-approved workflow templates only |

### 5.3 Structured Output — Solving the Local Model Reliability Problem

Tool calling reliability with local models out-of-the-box:
- 7B: ~85% valid JSON | 14B: ~92% | 32B: ~97%

**With Outlines grammar constraints: ~99% for all sizes.**

```python
# Approach 1: Outlines for guaranteed YAML structure
from outlines import models, generate
import outlines

@outlines.prompt
def yaml_generation_prompt(request: str):
    """Generate a Kubernetes Deployment YAML for: {{ request }}"""

model = models.transformers("Qwen/Qwen2.5-Coder-7B-Instruct")
generator = generate.json(model, KubernetesDeploymentSchema)  # Pydantic schema
deployment_yaml = generator(yaml_generation_prompt(request))
# Result is ALWAYS schema-valid

# Approach 2: Instructor for Pydantic-typed LLM outputs
import instructor
from litellm import completion

client = instructor.from_litellm(completion)
tool_call = client.chat.completions.create(
    model="ollama/qwen2.5-coder:14b",
    response_model=KubectlDescribeArgs,
    messages=[{"role": "user", "content": "describe the failing pod"}],
)
# tool_call is always a valid KubectlDescribeArgs Pydantic instance
```

---

## 6. MCP Tool Layer

### 6.1 MCP Protocol in 2026

MCP is the industry-standard AI tool protocol:
- Linux Foundation ownership (December 2025); OpenAI, Google, Microsoft, AWS are co-founders
- 16,000+ MCP servers; 97M+ monthly SDK downloads
- **Streamable HTTP** is the standard transport (SSE deprecated March 26, 2025; stdio still valid for local)
- Red Hat published official Kubernetes MCP Server — **extend it, don't rebuild**

### 6.2 KOTG.AI MCP Dual Role

```
KOTG as MCP CLIENT:
  Consumes external tool servers
  ├── kubectl-mcp (Red Hat official, extend with KOTG-specific tools)
  ├── helm-mcp, argocd-mcp, flux-mcp (GitOps)
  ├── prometheus-mcp, grafana-mcp, loki-mcp (observability)
  ├── trivy-mcp, kubescape-mcp, kyverno-mcp (security)
  └── aws-eks-mcp, gke-mcp, azure-aks-mcp (cloud providers)

KOTG as MCP SERVER:
  Exposes KOTG intelligence to any MCP client
  ├── Tools: diagnose_cluster, generate_yaml, scan_security, optimize_cost
  ├── Tools: explain_concept, search_knowledge, query_incident_history
  └── Consumed by: Claude Desktop, GitHub Copilot, Cursor, Zed, ...
  Transport: Streamable HTTP (remote) + stdio (local)
```

### 6.3 Tool Safety Tiers

| Tier | Examples | Risk | Gate |
|---|---|---|---|
| **T1 — Observe** | kubectl_get, kubectl_describe, kubectl_logs, kubectl_top | None | Auto |
| **T2 — Analyze** | trivy_scan, kubescape_scan, prometheus_query, qdrant_search | None | Auto |
| **T3 — Dry-Run** | kubectl_diff, helm_template, kyverno_validate | None | Auto |
| **T4 — Execute** | kubectl_apply, kubectl_delete, helm_install, kubectl_scale | High | LangGraph Interrupt |

### 6.4 MCP Security

Based on CVE-2025-6514 (malicious MCP proxy compromised 437K developer environments):
- Sandboxed subprocess per tool call (no cross-tool credential access)
- Tool signing required for registry-listed tools
- RBAC-mapped permissions (each tool declares minimum required K8s permissions)
- All tool invocations logged to immutable audit trail
- Enterprise mode: all MCP servers inside cluster VPC (zero internet egress)

### 6.5 FastMCP Server Skeleton

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("KOTG.AI Kubernetes Intelligence")

@mcp.tool()
async def diagnose_cluster(description: str, namespace: str = "") -> str:
    """Run multi-agent diagnosis of a Kubernetes issue."""
    agent = KubernetesAgent(registry=build_default_registry())
    state = await agent.run(description, namespace=namespace)
    return state.final_response

@mcp.tool()
async def generate_kubernetes_yaml(
    request: str,
    resource_type: str = "Deployment",
    security_hardened: bool = True,
) -> str:
    """Generate production-safe Kubernetes YAML with security defaults."""
    ...

@mcp.tool()
async def search_kubernetes_knowledge(query: str, top_k: int = 5) -> str:
    """Search the KOTG knowledge base for Kubernetes documentation."""
    ...

if __name__ == "__main__":
    mcp.run(transport="stdio")  # Claude Desktop: stdio; Production: streamable-http
```

---

## 7. Fine-Tuning Strategy (KOTG-7B)

### 7.1 Why Fine-Tune

Base Qwen2.5-7B-Instruct lacks:
- Deep knowledge of K8s edge cases and error message interpretation patterns
- K8s-specific ReAct reasoning (observe → hypothesize → diagnose → fix → verify)
- Reliable 95%+ YAML validity with security defaults always present
- Consistent JSON/tool-call output format for MCP tool selection

Expected gains over base model:

| Metric | Base Qwen2.5-7B | KOTG-7B Target |
|---|---|---|
| YAML schema validity | 72% | 95% |
| Security defaults applied | 45% | 90% |
| Incident RCA accuracy | 38% | 70%+ |
| Tool call JSON validity | 55% | 88% |
| K8s hallucination rate | 18% | <5% |

### 7.2 Training Dataset (200K Examples, ~2GB)

| Dataset | Size | Source | Validation |
|---|---|---|---|
| YAML Generation | 50K | 500 manual seeds → DeepSeek-R1 expansion | `kubectl apply --dry-run` must pass |
| Incident RCA (chain-of-thought) | 20K | GitHub issues, StackOverflow, incident reports | Expert review on 10% sample |
| K8s Q&A | 100K | Official docs, KEPs, CNCF blogs | Verified against official docs |
| Security Analysis | 20K | CIS benchmarks + Kyverno policies | Kubescape validation |
| Tool Selection | 10K | Synthetic: query → correct MCP tool + args | Pydantic schema validation |

Data quality: MinHash LSH deduplication (0.85 Jaccard threshold). No hallucinated content.

### 7.3 Training Configuration

```python
# Phase 1: Supervised Fine-Tuning (SFT) with Unsloth
from unsloth import FastLanguageModel

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Qwen2.5-7B-Instruct",
    max_seq_length=4096,
    load_in_4bit=True,
)

model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    lora_alpha=32,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                    "gate_proj", "up_proj", "down_proj"],
    lora_dropout=0.05,
    use_gradient_checkpointing="unsloth",  # 30% more throughput
)

# Phase 2: DPO alignment (5K comparison pairs)
# from trl import DPOTrainer
# Improves: prefers correct YAML over hallucinated; correct RCA over guessing
```

**Budget:** ~$19 on Vast.ai RTX 4090 (SFT ~$12 + DPO ~$7)

**Distribution:** GGUF Q4_K_M → HuggingFace Hub → `ollama pull kotg/kotg-7b`

---

## 8. Evaluation Framework

Every AI feature must be measurable before shipping.

### 8.1 Automated CI Gate (every PR)

| Metric | Threshold | Tooling | On Failure |
|---|---|---|---|
| YAML schema validity | ≥95% | `kubectl apply --dry-run` | Block merge |
| Security defaults applied | ≥90% | Kubescape | Block merge |
| RAG retrieval NDCG@5 | ≥0.75 | Custom eval harness | Block merge |
| Tool call JSON validity | ≥99% | Pydantic parse | Block merge |
| E2E diagnosis latency P95 | ≤60s | pytest-benchmark | Warning |
| Agent steps to diagnosis | ≤8 avg | LangSmith | Warning |

### 8.2 RAG Quality (RAGAS)

500-question golden dataset (50 questions per K8s topic):

```python
from ragas.metrics import faithfulness, answer_relevancy, context_recall, context_precision
# Target: faithfulness > 0.85, context_recall > 0.80
# Run weekly; results published to team dashboard
```

### 8.3 Agent Evaluation (LangSmith)

All agent runs traced to LangSmith automatically (LangGraph native).
Weekly eval: 50 synthetic K8s incidents with known ground-truth root causes.
Target: ≥70% correct root cause identified within 8 agent steps.

### 8.4 Human Evaluation

- Monthly "KOTG Challenge": 20 real K8s problems, community votes
- Expert panel (5 CNCF contributors): quarterly review
- A/B test: KOTG-7B vs base model on user satisfaction

---

## 9. Full System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  INTERFACE LAYER                                                │
│  kotg CLI (Typer+Rich) | Web UI | kubectl plugin | MCP Server  │
├─────────────────────────────────────────────────────────────────┤
│  API GATEWAY: FastAPI + WebSocket streaming                     │
│  Rate limiting: 100 req/min per user; 10 concurrent per cluster │
├─────────────────────────────────────────────────────────────────┤
│  ORCHESTRATION: LangGraph v1.0 Supervisor Pattern               │
│  ├── Task Router + Planner                                      │
│  ├── Agent Pool: Observer | Debugger | YAML | Security | Cost   │
│  ├── HITL Gates: LangGraph Interrupt                            │
│  └── LangSmith: full trace observability                        │
├─────────────────────────────────────────────────────────────────┤
│  INTELLIGENCE LAYER                                             │
│  ├── LiteLLM → Ollama (dev) / vLLM (prod) / SGLang (YAML)     │
│  ├── Outlines / Instructor: structured output constraints       │
│  ├── LlamaIndex RAG Pipeline (Workflows)                        │
│  │   ├── Contextual Retrieval preprocessing                    │
│  │   ├── BGE-M3: dense + sparse embeddings                     │
│  │   ├── Qdrant: BM42 sparse + dense hybrid search             │
│  │   ├── Jina Reranker v2                                       │
│  │   └── GraphRAG fusion (Kuzu + Qdrant)                       │
│  └── Kuzu: live cluster graph + incident memory                 │
├─────────────────────────────────────────────────────────────────┤
│  MCP TOOL LAYER (Streamable HTTP transport)                     │
│  kubectl | helm | argocd | prometheus | trivy | 100+ tools      │
│  KOTG MCP Server: exposes KOTG to Claude Desktop, Copilot, etc.│
├─────────────────────────────────────────────────────────────────┤
│  DATA LAYER                                                     │
│  Qdrant | Kuzu | SQLite (audit+history) | DuckDB (analytics)   │
├─────────────────────────────────────────────────────────────────┤
│  OBSERVABILITY (KOTG itself)                                    │
│  LangSmith (agent traces) | Prometheus (KOTG metrics) | Structlog│
├─────────────────────────────────────────────────────────────────┤
│  KUBERNETES INTEGRATION                                         │
│  Python k8s client | Informers (watch API) | KotgInstance CRD  │
└─────────────────────────────────────────────────────────────────┘
```

### 9.1 Deployment Modes

```bash
# Mode 1: Local CLI (Phase 1)
pip install kotg-ai
kotg init && kotg diagnose

# Mode 2: KOTG as MCP Server (Phase 1, from day 1)
kotg mcp serve  # Exposes KOTG to Claude Desktop, Copilot, etc.

# Mode 3: In-Cluster via Helm (Phase 6)
helm install kotg kotg-ai/kotg --set model.tier=medium

# Mode 4: Air-Gapped Enterprise (Phase 7)
kotg install --air-gapped --bundle kotg-enterprise-v1.tar.gz
```

---

## 10. Data Privacy Architecture

| Data Category | Storage | Retention | Egress |
|---|---|---|---|
| User queries | SQLite (local) | 30 days | Never (default) |
| Cluster state | Kuzu (local) | 7-day change history | Never |
| Kubernetes Secrets | **Never stored** | — | Never |
| Agent traces | SQLite (local) | 7 days | Optional (LangSmith, user API key) |
| Incident memory | Qdrant (local) | Indefinite | Never |
| RAG knowledge | Qdrant (local) | Indefinite | Never (self-hosted) |

**Enterprise: Zero-Trust**
- Air-gapped mode: NetworkPolicy blocks all internet egress at K8s level
- Private fine-tuning: model stays inside cluster; weights never exported
- Immutable audit log: cryptographically chained SQLite (append-only)

---

## Appendix: Package Versions (Pin These)

| Package | Version Constraint |
|---|---|
| `langgraph` | `>=1.0.0,<2.0.0` |
| `langgraph-supervisor` | `>=0.0.1` |
| `langsmith` | `>=0.2.0` |
| `litellm` | `>=1.30.0` |
| `llama-index-core` | `>=0.11.0` |
| `qdrant-client` | `>=1.11.0` |
| `kuzu` | `>=0.7.0` |
| `outlines` | `>=0.1.0` |
| `instructor` | `>=1.4.0` |
| `mcp` | `>=1.0.0` |
| `fastapi` | `>=0.115.0` |
| `pydantic` | `>=2.8.0` |
| `pydantic-settings` | `>=2.4.0` |
| `unsloth` | latest (always) |
| `trl` | `>=0.12.0` |
| `typer` | `>=0.12.0` |
| `rich` | `>=13.8.0` |
| `duckdb` | `>=1.1.0` |
| `structlog` | `>=24.4.0` |
