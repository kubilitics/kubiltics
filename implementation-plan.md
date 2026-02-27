# KOTG.AI — Implementation Plan

**Version:** 1.0  
**Date:** 2026-02-27  
**Budget Constraint:** $100 Total  
**Status:** Engineering Draft

---

## 1. Executive Summary

This document provides a complete technical implementation plan for KOTG.AI — a local-first, multi-agent Kubernetes intelligence platform. The entire system is designed to be built, run, and maintained within a $100 total budget by relying exclusively on open-source LLMs, free-tier infrastructure, and community tooling.

---

## 2. AI Model Strategy

### 2.1 Model Selection Criteria

For a $100 budget, we cannot use OpenAI, Anthropic, or Gemini APIs at any meaningful scale. Instead, KOTG.AI uses a **tiered local LLM strategy**:

| Tier | Use Case | Model | Hardware Requirement | Quantization |
|---|---|---|---|---|
| **Tier 0 — Nano** | Intent classification, slot extraction | `Qwen2.5-0.5B` | 1GB RAM, CPU | Q4_K_M |
| **Tier 1 — Small** | Tool selection, YAML generation, simple Q&A | `Qwen2.5-3B` | 3GB RAM, CPU | Q4_K_M |
| **Tier 2 — Medium** | Multi-step reasoning, incident diagnosis | `Llama-3.2-8B` or `Qwen2.5-7B` | 8GB RAM / Apple Silicon | Q4_K_M |
| **Tier 3 — Large** | Complex architecture analysis, KEP review | `DeepSeek-R1-14B` or `Llama-3.1-70B` | 16GB VRAM or CPU offload | Q4_K_M |
| **Tier 4 — Expert** | Full cluster reasoning (optional cloud fallback) | `DeepSeek-R1-32B` | 32GB RAM or cloud | GGUF Q4 |

### 2.2 Recommended Primary Models

**Primary Reasoning Model:** `Qwen2.5-Coder-7B-Instruct` (Q4_K_M)
- Reasons: Excellent code/YAML generation; strong instruction following; 7B fits on 8GB RAM; Apache 2.0 license
- Use for: YAML generation, kubectl command generation, code analysis

**Primary Conversation Model:** `Llama-3.2-8B-Instruct` (Q4_K_M)
- Reasons: Strong multilingual support; excellent instruction following; Meta's best small model
- Use for: Natural language Q&A, incident explanation, user interaction

**Specialized Reasoning Model:** `DeepSeek-R1-Distill-Qwen-7B` (Q4_K_M)
- Reasons: Chain-of-thought reasoning built-in; excellent at multi-step diagnosis
- Use for: Complex incident diagnosis, root cause analysis, architecture review

**Fine-Tuned Kubernetes Model (KOTG-7B):** Custom fine-tune of Qwen2.5-7B on Kubernetes corpus
- Built in Phase 2; provides domain-specific expertise beyond general-purpose models

### 2.3 Inference Engine Stack

```
Local Inference Stack:
┌─────────────────────────────────────────┐
│           Ollama (Primary)              │
│  - Easy model management               │
│  - REST API compatible                  │
│  - Runs on CPU/GPU/Apple Silicon        │
├─────────────────────────────────────────┤
│        llama.cpp (Backend)              │
│  - Powers Ollama                        │
│  - GGUF quantized models               │
│  - CPU AVX2/AVX512 optimizations       │
│  - Metal (Apple Silicon) support       │
├─────────────────────────────────────────┤
│      vLLM (High-throughput option)     │
│  - For GPU servers and cloud           │
│  - Paged attention / continuous batch  │
│  - Use when GPU available              │
└─────────────────────────────────────────┘
```

**Why Ollama as primary:**
- Zero-config model management (`ollama pull llama3.2`)
- Cross-platform (Mac, Linux, Windows)
- OpenAI-compatible API (drop-in for any LangChain/LlamaIndex code)
- Ships GGUF-quantized models automatically

### 2.4 $100 Budget Allocation

| Item | Cost | Notes |
|---|---|---|
| Compute for fine-tuning | $40 | Vast.ai RTX 4090 @ $0.40/hr × 100hr (includes dataset processing + multiple training runs) |
| Vector DB hosting (Qdrant Cloud free tier) | $0 | Free tier: 1GB forever |
| Domain registration | $12 | kotgai.dev or similar |
| GitHub Actions CI/CD | $0 | Free for public repos |
| Container registry | $0 | GitHub Container Registry (free) |
| Documentation hosting | $0 | GitHub Pages (free) |
| Dataset processing compute | $20 | Cloud VM for corpus ingestion |
| Miscellaneous | $28 | Buffer |
| **TOTAL** | **$100** | |

---

## 3. RAG Architecture

### 3.1 Overview

KOTG.AI uses a **multi-tier RAG (Retrieval-Augmented Generation)** architecture that combines dense vector search, sparse keyword search, and structured knowledge graph traversal.

```
Query Pipeline:
User Query
    │
    ▼
Query Classifier (Tier 0 model)
    │
    ├── Simple fact → Direct RAG retrieval
    ├── Complex reasoning → Multi-agent + RAG
    └── Tool execution → Agent + MCP tools
    │
    ▼
Query Rewriter (expand, disambiguate)
    │
    ▼
┌─────────────────────────────────────────┐
│          HYBRID RETRIEVAL               │
│  ┌──────────────┐  ┌────────────────┐   │
│  │ Dense Search │  │ Sparse Search  │   │
│  │ (Qdrant)     │  │ (BM25/Tantivy) │   │
│  └──────┬───────┘  └───────┬────────┘   │
│         └────────┬─────────┘            │
│              Reciprocal                 │
│             Rank Fusion                 │
└─────────────────┬───────────────────────┘
                  │
                  ▼
          Knowledge Graph Query
          (entity relationships)
                  │
                  ▼
         Context Assembly
         (reranking + dedup)
                  │
                  ▼
      LLM Generation (Tier 1-3 model)
                  │
                  ▼
            Response
```

### 3.2 Vector Database: Qdrant

**Why Qdrant over alternatives:**
- Rust-based: 5× faster than Chroma; 2× faster than Weaviate
- On-disk storage: handles 50GB+ knowledge base on laptop
- Sparse + dense search in one system (hybrid retrieval)
- Docker-native; Kubernetes-native
- Free self-hosted; free cloud tier (1GB)
- Filters by metadata (Kubernetes version, resource type, severity)

```python
# Qdrant collection schema for Kubernetes knowledge
collection_config = {
    "name": "kotg_knowledge",
    "vectors": {
        "dense": VectorParams(size=1536, distance=Distance.COSINE),
        "sparse": SparseVectorParams()
    },
    "payload_schema": {
        "source": "keyword",        # docs/github/stackoverflow/incident
        "k8s_version": "keyword",   # 1.28/1.29/1.30
        "resource_type": "keyword", # Pod/Deployment/Service/etc.
        "severity": "keyword",      # critical/high/medium/low
        "category": "keyword",      # networking/storage/security/cost
        "timestamp": "datetime"
    }
}
```

### 3.3 Embedding Model

**Model:** `nomic-embed-text` or `mxbai-embed-large`
- Both run locally via Ollama
- 768-1536 dimensional embeddings
- No API cost
- Excellent semantic similarity for technical content

For sparse embeddings: `SPLADE` or `BM25` via FastEmbed (Qdrant's built-in)

### 3.4 Knowledge Base Sources and Ingestion Pipeline

#### Source Catalog

| Source | Format | Size (est.) | Update Frequency |
|---|---|---|---|
| Kubernetes official docs | Markdown | 500MB | Weekly |
| Kubernetes GitHub issues (labeled) | JSON | 2GB | Daily |
| KEPs (Kubernetes Enhancement Proposals) | Markdown | 200MB | Weekly |
| CNCF project documentation | Markdown | 1GB | Weekly |
| Helm chart `values.yaml` + READMEs | YAML/MD | 500MB | Weekly |
| CVE/security advisories (NVD, GHSA) | JSON | 100MB | Daily |
| StackOverflow K8s questions (top 50K) | JSON | 300MB | Monthly |
| Production incident reports (public) | Markdown | 100MB | Monthly |
| Kubernetes source code (key packages) | Go | 200MB | Monthly |
| Performance tuning guides (curated) | Markdown | 50MB | Monthly |

**Total corpus: ~5GB compressed, ~50GB uncompressed**

#### Ingestion Pipeline Architecture

```
Data Sources
    │
    ▼
┌─────────────────────────────────────────┐
│         Document Ingestion Pipeline     │
│                                         │
│  Fetchers (async):                      │
│  ├── GitHubFetcher (issues, KEPs)       │
│  ├── DocsCrawler (official docs)        │
│  ├── HelmIndexFetcher (artifact hub)    │
│  ├── CVEFetcher (NVD/GHSA API)          │
│  └── SOFetcher (Stack Exchange API)     │
│                                         │
│  Processors:                            │
│  ├── ChunkSplitter (512 tokens, 50 OL)  │
│  ├── MetadataExtractor (K8s entities)   │
│  ├── QualityFilter (dedup, min length)  │
│  └── VersionTagger (K8s API versions)   │
│                                         │
│  Indexers:                              │
│  ├── DenseEmbedder (nomic-embed-text)   │
│  ├── SparseEmbedder (BM25/SPLADE)       │
│  └── QdrantWriter (batch upsert)        │
└─────────────────────────────────────────┘
```

**Implementation:** Python + LlamaIndex data connectors + Apache Airflow (or simple cron) for scheduling

---

## 4. Knowledge Graph Architecture

### 4.1 Why a Knowledge Graph

A pure vector store answers "what documents are similar to this query." A knowledge graph answers "what is the relationship between this Deployment, its ConfigMap, the recent change event, and the CrashLoopBackOff?"

The Kubernetes Knowledge Graph is KOTG.AI's secret weapon.

### 4.2 Graph Database: Kuzu (Embedded) + Neo4j (Optional)

**Primary: Kuzu**
- Embedded graph database (like SQLite for graphs)
- Runs in-process; no server needed
- Cypher-compatible query language
- Perfect for local deployment

**Optional Scale: Neo4j Community Edition**
- For large enterprise deployments
- Full APOC procedure library
- GraphQL API

### 4.3 Graph Schema

```cypher
// Nodes
(:Namespace {name, labels, annotations, cluster})
(:Deployment {name, namespace, replicas, image, version, status})
(:Pod {name, namespace, status, nodeName, phase, containers})
(:Service {name, namespace, type, clusterIP, ports})
(:ConfigMap {name, namespace, dataKeys, lastModified})
(:Secret {name, namespace, type}) // values never stored
(:Node {name, role, status, capacity, conditions})
(:Cluster {name, version, provider, region})
(:CVE {id, severity, affectedVersions, description})
(:Incident {id, timestamp, severity, rootCause, resolution})
(:KnowledgeChunk {id, content, source, k8sVersion, category})

// Relationships
(:Deployment)-[:OWNS]->(:Pod)
(:Pod)-[:MOUNTS]->(:ConfigMap)
(:Pod)-[:MOUNTS]->(:Secret)
(:Service)-[:SELECTS]->(:Pod)
(:Pod)-[:RUNS_ON]->(:Node)
(:Deployment)-[:IN_NAMESPACE]->(:Namespace)
(:Incident)-[:AFFECTED]->(:Deployment)
(:Incident)-[:CAUSED_BY]->(:ConfigMap)
(:Incident)-[:RESOLVED_BY {action}]->(:Deployment)
(:CVE)-[:AFFECTS_VERSION]->(:Cluster)
(:KnowledgeChunk)-[:DESCRIBES]->(:Deployment)
```

### 4.4 Graph Population Strategy

1. **Live cluster sync** via Kubernetes Informers (watch API) — real-time graph updates
2. **Historical ingestion** from kubectl audit logs
3. **Incident correlation** — automatically link incidents to affected resources
4. **Knowledge linking** — connect RAG chunks to relevant graph nodes

---

## 5. Agent Architecture

### 5.1 Multi-Agent Framework: LangGraph

**Why LangGraph over AutoGen/CrewAI:**
- State machine model (nodes + edges) is perfect for cluster diagnosis workflows
- First-class support for human-in-the-loop
- Built on LangChain (massive tool ecosystem)
- Streaming output support
- Checkpointing (resume interrupted workflows)

### 5.2 Agent Catalog

#### Agent 1: Cluster Observer Agent

**Role:** Continuous cluster state monitoring and anomaly detection  
**Triggers:** Scheduled polling; Kubernetes watch events; user queries  
**Tools:** kubectl-mcp, metrics-server-mcp, events-mcp  

```
Input: Cluster context (namespace, resource type, time range)
Process:
  1. Query cluster state (pods, events, node conditions)
  2. Compare against baseline (normal state from graph)
  3. Identify anomalies (CPU spikes, restart counts, pending pods)
  4. Score severity and route to appropriate agent
Output: Structured anomaly report with severity and affected resources
```

#### Agent 2: Debugging Agent

**Role:** Multi-step root cause analysis for Kubernetes incidents  
**Triggers:** Anomaly from Observer; direct user query; PagerDuty alert  
**Tools:** kubectl-mcp, logs-mcp, events-mcp, metrics-mcp  
**Model:** DeepSeek-R1-Distill-7B (chain-of-thought reasoning)  

```
Input: Anomaly report or incident description
Process:
  1. Retrieve cluster state context (graph query)
  2. Retrieve relevant knowledge (RAG query: similar past incidents)
  3. Generate initial hypotheses (LLM reasoning)
  4. Execute diagnostic tools (kubectl describe, logs, events)
  5. Validate/eliminate hypotheses based on evidence
  6. Identify root cause with confidence score
  7. Generate remediation options with risk assessment
Output: Root cause analysis report + ranked remediation options
```

**Example Chain-of-Thought:**
```
Observation: frontend Pod CrashLoopBackOff
Hypothesis 1: OOMKilled → check: kubectl top pod → CPU 0.1/limit 2.0, MEM 400MB/512MB → POSSIBLE
Hypothesis 2: ConfigMap missing → check: kubectl describe pod → MountError on config-v2 → CONFIRMED
Root Cause: ConfigMap 'app-config-v2' not found in namespace 'production'
Cause Chain: ArgoCD sync at 14:32 → Deployment updated to reference 'app-config-v2' → ConfigMap 'app-config-v2' does not exist (still 'app-config-v1')
Resolution: Create ConfigMap 'app-config-v2' OR revert Deployment to reference 'app-config-v1'
```

#### Agent 3: YAML Generation Agent

**Role:** Generate production-ready, security-hardened Kubernetes manifests  
**Model:** Qwen2.5-Coder-7B  
**Tools:** schema-validator-mcp, helm-mcp, kyverno-mcp  

```
Input: Natural language description of desired Kubernetes resource
Process:
  1. Parse requirements (resource type, name, labels, ports, images, etc.)
  2. Query knowledge graph for best practices for this resource type
  3. Apply security defaults (non-root, readOnlyRootFilesystem, resource limits)
  4. Generate YAML with inline comments
  5. Validate against Kubernetes JSON schema
  6. Scan with Kyverno policies
  7. Return YAML with security score and improvement suggestions
Output: Production-ready YAML + security analysis + policy compliance
```

**Security Defaults Applied Automatically:**
- `runAsNonRoot: true`
- `readOnlyRootFilesystem: true`
- `allowPrivilegeEscalation: false`
- `capabilities: drop: [ALL]`
- CPU and memory limits always set
- `imagePullPolicy: Always` for non-tagged images
- `seccompProfile: RuntimeDefault`
- Anti-affinity rules for production workloads

#### Agent 4: Security Agent

**Role:** Comprehensive Kubernetes security analysis  
**Model:** Llama-3.2-8B  
**Tools:** trivy-mcp, kubescape-mcp, falco-mcp, kyverno-mcp, rbac-analyzer-mcp  

```
Capabilities:
- CIS Kubernetes Benchmark compliance scanning
- RBAC over-permission detection
- CVE scanning for running container images
- Privileged container detection
- Network policy gap analysis
- Secret scanning (exposed in env vars, logs)
- Supply chain security (SBOM analysis)
- Runtime threat detection (Falco integration)
```

#### Agent 5: Cost Optimization Agent

**Role:** Identify and eliminate Kubernetes cost waste  
**Model:** Qwen2.5-7B  
**Tools:** kubectl-mcp, metrics-server-mcp, opencost-mcp, karpenter-mcp  

```
Capabilities:
- Resource request/limit rightsizing recommendations
- Idle workload detection (deployments with zero traffic)
- Spot/preemptible instance opportunity identification
- Namespace cost attribution
- PVC waste detection (unused volumes)
- Image pull cost optimization (layer caching)
- Multi-cluster cost comparison
- Cost forecast and anomaly alerting
```

#### Agent 6: Architecture Advisor Agent

**Role:** Senior architect-level Kubernetes design review and recommendations  
**Model:** DeepSeek-R1-14B (or Llama-3.1-70B for maximum quality)  
**Tools:** kubectl-mcp, helm-mcp, kep-knowledge-mcp  

```
Capabilities:
- Deployment strategy recommendations (RollingUpdate vs. Blue/Green vs. Canary)
- Multi-tenancy design review
- Multi-cluster topology recommendations
- Service mesh evaluation (Istio vs. Linkerd vs. Cilium)
- Storage architecture review
- Network policy design
- Custom operator evaluation
- Generate Architecture Decision Records (ADRs)
```

#### Agent 7: Automation Agent (Orchestrator)

**Role:** Coordinate all other agents; execute multi-step autonomous workflows  
**Model:** Qwen2.5-7B (fast, for coordination)  
**Tools:** All available MCP tools  

```
Capabilities:
- Parse complex user requests into agent subtasks
- Route subtasks to specialized agents
- Aggregate and synthesize agent outputs
- Execute approved remediation actions
- Monitor execution outcomes
- Escalate to human when confidence < threshold
```

### 5.3 Agent Communication Protocol

```python
# Standardized agent message format
class AgentMessage:
    agent_id: str           # which agent sent this
    task_id: str            # unique task identifier
    message_type: Literal["observation", "hypothesis", "action", "result", "error"]
    content: str            # natural language content
    structured_data: dict   # machine-readable payload
    confidence: float       # 0.0 - 1.0
    requires_approval: bool # human-in-the-loop gate
    tools_used: list[str]   # audit trail
    evidence: list[str]     # supporting evidence references
```

### 5.4 Human-in-the-Loop (HITL) Framework

All agents operate in one of three modes:

| Mode | Description | Use Case |
|---|---|---|
| **Observe** | Read-only; no cluster changes | Default for all agents |
| **Suggest** | Generates recommendations; human approves before execution | Interactive diagnosis |
| **Execute** | Autonomous execution within defined guardrails | Pre-approved workflows only |

Execution guardrails:
- Never delete resources without explicit confirmation
- Never modify production namespaces in Execute mode without double approval
- Always log every tool call to audit trail
- Always create a rollback plan before executing changes
- Dry-run validation before any `kubectl apply`

---

## 6. Local Inference Engine Details

### 6.1 Ollama Setup

```bash
# Installation
curl -fsSL https://ollama.ai/install.sh | sh

# Pull recommended models
ollama pull qwen2.5-coder:7b-instruct-q4_K_M
ollama pull llama3.2:8b-instruct-q4_K_M
ollama pull deepseek-r1:7b-q4_K_M
ollama pull nomic-embed-text:latest

# Start server
ollama serve
```

### 6.2 Model Router

KOTG.AI implements a smart model router that selects the appropriate model tier based on task complexity:

```python
class ModelRouter:
    def route(self, task: Task) -> str:
        if task.complexity == "trivial":        # classification, slot filling
            return "qwen2.5:0.5b"
        elif task.complexity == "simple":       # YAML gen, simple Q&A
            return "qwen2.5-coder:7b-instruct"
        elif task.complexity == "moderate":     # multi-step reasoning
            return "llama3.2:8b-instruct"
        elif task.complexity == "complex":      # deep analysis, architecture
            return "deepseek-r1:7b"
        else:                                   # maximum intelligence
            return "deepseek-r1:14b"            # or cloud fallback
```

### 6.3 Hardware Profiles

| Profile | Hardware | Models Available | Performance |
|---|---|---|---|
| **Ultra-Light** | 4GB RAM, CPU only | 0.5B, 3B | Basic Q&A, simple YAML |
| **Standard** | 8GB RAM, CPU/Apple M1 | 0.5B, 3B, 7B | Full feature set |
| **Performance** | 16GB RAM, CPU/Apple M2 | All up to 14B | Expert-level reasoning |
| **GPU-Accelerated** | 24GB VRAM (RTX 4090) | All including 70B | Maximum intelligence |
| **Cluster Node** | 32GB RAM + optional GPU | All models | Production deployment |

---

## 7. Fine-Tuning Strategy

### 7.1 Why Fine-Tune

Base models know general Kubernetes but lack:
- Deep knowledge of edge cases and obscure bugs
- Kubernetes-specific reasoning patterns (observe → hypothesize → execute → validate)
- Proper kubectl command generation in complex scenarios
- Understanding of Kubernetes source code internals

### 7.2 Dataset Creation

#### Dataset Sources

1. **Synthetic YAML Generation Dataset**  
   - Input: Natural language description ("Create a Deployment with 3 replicas running nginx 1.25 with resource limits")
   - Output: Valid YAML with security defaults
   - Size: 10,000 examples (seed 500 manually; expand using GPT-3.5-Turbo @ ~$0.002/1K tokens ≈ $10 for ~5M tokens; validate all entries via schema check + `kubectl apply --dry-run`)
   - Validation: Schema validator + kubectl dry-run

2. **Incident Diagnosis Dataset**  
   - Input: kubectl output (describe, logs, events) with issue description
   - Output: Root cause analysis + remediation steps (chain-of-thought)
   - Source: GitHub issues, StackOverflow, curated incident reports
   - Size: 20,000 examples
   - Format: Chain-of-thought reasoning traces

3. **Kubernetes Q&A Dataset**  
   - Input: Technical Kubernetes questions
   - Output: Expert answers with citations
   - Source: Kubernetes docs, KEPs, official blog posts
   - Size: 100,000 examples

4. **Security Analysis Dataset**  
   - Input: Kubernetes YAML manifests
   - Output: Security issues with severity and remediation
   - Size: 30,000 examples
   - Source: CIS benchmark tests + Kyverno policies

#### Total Dataset: ~200,000 examples, ~2GB

### 7.3 Fine-Tuning Process

**Method:** QLoRA (Quantized Low-Rank Adaptation)
- Reduces GPU memory by 4× vs. full fine-tuning
- Can fine-tune 7B model on a single RTX 4090 (24GB VRAM)
- Cost: ~$8 on Vast.ai for 10,000 steps

**Framework:** Unsloth + Hugging Face TRL
- Unsloth provides 2× faster training than standard QLoRA
- 50% less VRAM usage

**Base Model:** Qwen2.5-7B-Instruct (best base for KOTG-7B)

**Training Configuration:**
```python
training_args = TrainingArguments(
    output_dir="kotg-7b-v1",
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,  # effective batch size = 16
    learning_rate=2e-4,
    bf16=True,
    max_grad_norm=0.3,
    warmup_ratio=0.03,
    lr_scheduler_type="cosine",
)

lora_config = LoraConfig(
    r=16,               # LoRA rank
    lora_alpha=32,
    target_modules=["q_proj", "v_proj", "k_proj", "o_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM",
)
```

**Fine-tuning cost breakdown:**
- RTX 4090 on Vast.ai: $0.40/hr × 20hr = $8
- Dataset generation (one-time GPT-3.5-Turbo call, ~5M tokens at $0.002/1K): ~$10
- Total fine-tuning budget: $18

### 7.4 Evaluation Framework

#### Automated Benchmarks
1. **YAML Validity Score** — Percentage of generated YAMLs that pass `kubectl apply --dry-run`
2. **Security Compliance Score** — Percentage of YAMLs with all security defaults applied
3. **Incident Resolution Accuracy** — Correct root cause identified in held-out test set
4. **Hallucination Rate** — Percentage of factually incorrect Kubernetes statements
5. **Tool Call Accuracy** — Correct MCP tool selection and parameter generation

#### Human Evaluation (Community)
- Beta tester incident replay sessions
- Expert Kubernetes engineer review panel (5 CNCF contributors)
- Community voting on response quality

#### Benchmark Targets

| Metric | Baseline (Raw Qwen2.5-7B) | KOTG-7B Target |
|---|---|---|
| YAML Validity | 72% | 95% |
| Security Compliance | 45% | 90% |
| Incident RCA Accuracy | 38% | 75% |
| Hallucination Rate | 18% | 5% |
| Tool Call Accuracy | 55% | 88% |

---

## 8. System Architecture — Full Stack

### 8.1 Component Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                    KOTG.AI SYSTEM STACK                         │
├─────────────────────────────────────────────────────────────────┤
│  INTERFACE LAYER                                                │
│  ├── kotg CLI (Python + Click/Typer)                           │
│  ├── Web UI (FastAPI + HTMX or Next.js)                        │
│  ├── kubectl plugin (kotg-kubectl)                             │
│  └── Slack/Teams bot (via Bolt SDK)                            │
├─────────────────────────────────────────────────────────────────┤
│  API GATEWAY                                                    │
│  └── FastAPI + async (WebSocket for streaming)                 │
├─────────────────────────────────────────────────────────────────┤
│  ORCHESTRATION LAYER                                            │
│  └── LangGraph (multi-agent state machine)                     │
│      ├── Agent Router                                          │
│      ├── Task Planner                                          │
│      └── Agent Pool (7 specialized agents)                     │
├─────────────────────────────────────────────────────────────────┤
│  REASONING LAYER                                                │
│  ├── Model Router → Ollama API                                 │
│  ├── RAG Pipeline (LlamaIndex)                                 │
│  │   ├── Query Processor                                       │
│  │   ├── Hybrid Retriever (Qdrant dense + sparse)             │
│  │   └── Response Synthesizer                                  │
│  └── Knowledge Graph Querier (Kuzu)                           │
├─────────────────────────────────────────────────────────────────┤
│  TOOL EXECUTION LAYER                                           │
│  └── MCP Client                                                │
│      ├── Official KOTG MCP Servers (bundled)                  │
│      ├── Community MCP Registry                                │
│      └── Sandboxed Tool Executor                              │
├─────────────────────────────────────────────────────────────────┤
│  DATA LAYER                                                     │
│  ├── Qdrant (vector search)                                    │
│  ├── Kuzu (knowledge graph)                                    │
│  ├── SQLite (conversation history, audit logs)                 │
│  └── Redis (optional: caching, session state)                  │
├─────────────────────────────────────────────────────────────────┤
│  KUBERNETES INTEGRATION                                         │
│  ├── Kubernetes Python Client (official)                       │
│  ├── Informers (watch API for real-time events)               │
│  └── Operator (for in-cluster deployment)                     │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Deployment Modes

#### Mode 1: Local CLI (Day 1)
```bash
pip install kotg-ai
kotg init          # downloads models via Ollama
kotg diagnose      # connect to current kubectl context
```

#### Mode 2: Kubernetes In-Cluster Deployment
```yaml
# kotg-operator deploys KOTG.AI as a Kubernetes workload
apiVersion: kotg.ai/v1alpha1
kind: KotgInstance
metadata:
  name: cluster-assistant
spec:
  model: qwen2.5-coder:7b-instruct
  agents:
    - observer
    - debugger
    - security
  autonomyLevel: suggest  # observe | suggest | execute
  knowledgeBase:
    syncSchedule: "0 2 * * *"
```

#### Mode 3: Edge Deployment (Resource-Constrained)
- Uses 3B model only
- Minimal RAG (compressed knowledge base)
- Read-only agents (no execution)
- Works with 4GB RAM

### 8.3 Technology Stack Summary

| Layer | Technology | License | Reason |
|---|---|---|---|
| Language | Python 3.12 | PSF | Ecosystem compatibility |
| Agent Framework | LangGraph 0.2+ | MIT | Best multi-agent state machine |
| LLM Client | Ollama + LangChain | MIT/Apache 2.0 | Local inference |
| RAG Framework | LlamaIndex 0.10+ | MIT | Best RAG primitives |
| Vector DB | Qdrant | Apache 2.0 | Fast, hybrid, embedded |
| Graph DB | Kuzu | MIT | Embedded Cypher graph DB |
| K8s Client | kubernetes-python | Apache 2.0 | Official client |
| API Server | FastAPI | MIT | Fast async Python |
| CLI | Typer + Rich | MIT | Beautiful CLI output |
| Packaging | uv + pyproject.toml | MIT | Modern Python packaging |
| Container | Docker + OCI | Apache 2.0 | Portable deployment |
| Fine-tuning | Unsloth + TRL | Apache 2.0 | Fast QLoRA |

---

## 9. Cost Optimization Strategy (Staying Under $100)

### 9.1 Zero-Cost Infrastructure

| Resource | Solution | Cost |
|---|---|---|
| Model hosting | Ollama local | $0 |
| Vector DB | Qdrant embedded | $0 |
| CI/CD | GitHub Actions (public repo) | $0 |
| Container registry | GHCR (public) | $0 |
| Documentation | GitHub Pages | $0 |
| Knowledge base updates | GitHub Actions scheduled | $0 |
| Community support | GitHub Discussions | $0 |

### 9.2 One-Time Costs (Within $100)

| Item | Cost |
|---|---|
| Fine-tuning compute (Vast.ai, 20hr RTX 4090) | $8 |
| Dataset generation (GPT-3.5-Turbo seed, ~5M tokens @ $0.002/1K) | $10 |
| Knowledge corpus processing (EC2 spot instance) | $10 |
| Domain name | $12 |
| Buffer/miscellaneous | $60 |
| **Total** | **$100** |

### 9.3 Long-Term Zero Marginal Cost Architecture

Once deployed, KOTG.AI costs $0/month for API calls because:
1. All inference is local (Ollama)
2. All storage is embedded (Qdrant, Kuzu, SQLite)
3. All knowledge base updates use free GitHub Actions
4. No SaaS dependencies

---

## 10. Security Architecture

### 10.1 Threat Model

KOTG.AI has privileged access to Kubernetes clusters. Security is paramount.

| Threat | Mitigation |
|---|---|
| Malicious MCP tool execution | Sandboxed execution; tool signing; RBAC-gated tools |
| Prompt injection via cluster data | Input sanitization; structured output enforcement |
| Unauthorized cluster access | RBAC; kubeconfig scoping; audit logging |
| Model poisoning via knowledge base | Content verification; trusted source allowlist |
| Data exfiltration via LLM | Local-only mode; network egress controls |

### 10.2 KOTG.AI RBAC Model

```yaml
# Minimal read-only ClusterRole for Observer agent
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: kotg-observer
rules:
- apiGroups: [""]
  resources: ["pods", "services", "endpoints", "events", "nodes", "namespaces"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["apps"]
  resources: ["deployments", "replicasets", "statefulsets", "daemonsets"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["metrics.k8s.io"]
  resources: ["pods", "nodes"]
  verbs: ["get", "list"]
```

Execution-capable agents require explicit opt-in with narrowly scoped permissions.

---

*KOTG.AI Implementation Plan — Engineering-Ready Specification*
