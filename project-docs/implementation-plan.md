# KOTG.AI — Implementation Plan

**Version:** 1.0
**Date:** 2026-02-27
**Status:** Engineering Draft
**Budget:** $100 Total Bootstrap

---

## Table of Contents

1. [Architecture Philosophy](#architecture-philosophy)
2. [AI Model Strategy](#ai-model-strategy)
3. [Local Inference Engine](#local-inference-engine)
4. [RAG Architecture](#rag-architecture)
5. [Knowledge Graph Design](#knowledge-graph-design)
6. [Document Ingestion Pipeline](#document-ingestion-pipeline)
7. [Multi-Agent Architecture](#multi-agent-architecture)
8. [MCP Tool Integration Layer](#mcp-tool-integration-layer)
9. [Fine-Tuning Strategy](#fine-tuning-strategy)
10. [Dataset Creation](#dataset-creation)
11. [Evaluation Framework](#evaluation-framework)
12. [Cost Optimization Strategy](#cost-optimization-strategy)
13. [Infrastructure & Deployment](#infrastructure--deployment)
14. [Security Architecture](#security-architecture)

---

## Architecture Philosophy

### Core Principles

KOTG.AI is built on a set of inviolable architectural principles that guide every technical decision:

```
PRINCIPLE 1: Intelligence First, Compute Second
  → Use structured knowledge and RAG to compensate for model size
  → A 7B model with perfect Kubernetes context beats GPT-4 without it

PRINCIPLE 2: Local Always, Cloud Never (by default)
  → Every feature must work on a laptop with no internet
  → Cloud integrations are optional enhancements, not requirements

PRINCIPLE 3: Modular Specialization Over Monolithic Generalism
  → Seven specialist agents > one general agent
  → Each agent is optimized for its domain
  → Agents compose, not compete

PRINCIPLE 4: Safety Over Speed
  → Every autonomous action has a preview mode
  → Confidence thresholds gate all production actions
  → Audit log everything

PRINCIPLE 5: Knowledge Is the Product
  → The knowledge graph is the primary competitive moat
  → RAG quality matters more than model quality
  → Continuous knowledge ingestion is a core system service
```

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         KOTG.AI SYSTEM                              │
│                                                                      │
│  Input Layer                                                         │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────────────┐ │
│  │    CLI     │ │  REST API  │ │  Web UI    │ │  MCP Client      │ │
│  │  (typer)   │ │  (FastAPI) │ │  (Next.js) │ │  (stdio/HTTP)    │ │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └────────┬─────────┘ │
│        └──────────────┴──────────────┴────────────────── ┘          │
│                                    ▼                                 │
│  Orchestration Layer                                                 │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                   Intent Classifier                          │    │
│  │  (Classifies query into: diagnose/generate/analyze/plan)     │    │
│  └────────────────────┬────────────────────────────────────────┘    │
│                       ▼                                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                  Agent Router (LangGraph)                    │    │
│  │           Routes to appropriate agent(s)                     │    │
│  └────────────────────┬────────────────────────────────────────┘    │
│                       ▼                                              │
│  Agent Council Layer                                                 │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Parallel Agent Execution with Consensus Synthesis            │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │   │
│  │  │Architect │ │ Debugger │ │ Security │ │   FinOps     │   │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘   │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────────────┐    │   │
│  │  │   YAML   │ │Commander │ │     Cluster State        │    │   │
│  │  └──────────┘ └──────────┘ └──────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Intelligence Core                                                   │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  LLM Engine    │  RAG Engine    │  Knowledge Graph           │    │
│  │  (Ollama)      │  (ChromaDB)    │  (NetworkX/Neo4j)          │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  Tool Layer (MCP)                                                    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  kubectl │ helm │ prometheus │ loki │ argocd │ trivy │ ...   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  Data Layer                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────────┐  │
│  │ ChromaDB │ │ SQLite   │ │  Redis   │ │  File System (JSONL)  │  │
│  │(vectors) │ │(metadata)│ │ (cache)  │ │  (incident logs)     │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## AI Model Strategy

### Model Selection Philosophy

The fundamental insight is this: **a 7B parameter model with 100,000 perfectly curated Kubernetes-specific tokens in context is more useful than GPT-4 with generic training.** KOTG.AI wins on knowledge engineering, not raw parameter count.

### Primary Models (All Free, All Local)

#### Tier 1: Default Inference Model

**Qwen2.5-7B-Instruct** (Primary recommendation)

```yaml
Model: Qwen2.5-7B-Instruct-Q4_K_M (GGUF quantized)
Size: ~4.7GB
RAM Required: 8GB
VRAM Required: 0 (CPU works)
GPU Acceleration: Optional (NVIDIA/AMD/Apple Silicon)

Why Qwen2.5-7B:
  - Best instruction-following at 7B parameter scale
  - Excellent code generation (YAML, JSON, PromQL, LogQL)
  - Strong reasoning with Chain-of-Thought
  - 128K context window (huge for cluster analysis)
  - Apache 2.0 license — fully permissive for commercial use
  - Benchmarks: MMLU 74.2, HumanEval 72.8
  - Best performance/size ratio as of 2026
```

**Fallback Tier 1: Llama-3.2-8B-Instruct**

```yaml
Model: Llama-3.2-8B-Instruct-Q4_K_M
Size: ~5.0GB
RAM Required: 8GB
License: Meta Llama 3.2 Community License (commercial ok)

Why Llama 3.2:
  - Strong general reasoning
  - Excellent tool-calling support
  - Large community, many fine-tunes available
  - Good for agentic workflows
```

#### Tier 2: Heavy Reasoning Model (When Available)

**DeepSeek-R1-7B-Distill** (For complex multi-step reasoning)

```yaml
Model: DeepSeek-R1-Distill-Qwen-7B-Q4_K_M
Size: ~4.7GB
RAM Required: 8GB

Why DeepSeek-R1 Distill:
  - Explicit Chain-of-Thought reasoning traces
  - Dramatically better at multi-step Kubernetes debugging
  - Shows its work — engineers can follow the reasoning
  - Distilled from R1-671B: captures 70% of capability at 1% of size
  - Outstanding at root cause analysis problems
  - MIT License
```

#### Tier 3: Lightweight Routing Model

**Qwen2.5-1.5B-Instruct** (For intent classification, quick lookups)

```yaml
Model: Qwen2.5-1.5B-Instruct-Q8_0
Size: ~1.6GB
RAM Required: 4GB
Latency: <500ms per response

Use Cases:
  - Intent classification (is this a debug/generate/analyze query?)
  - Quick command validation
  - Rapid YAML linting
  - Tool selection routing
```

#### Tier 4: Embedding Model

**nomic-embed-text-v1.5** (For RAG embeddings)

```yaml
Model: nomic-embed-text-v1.5
Size: ~274MB
Dimensions: 768
Context: 8192 tokens
License: Apache 2.0

Why nomic-embed-text:
  - Best open-source embedding model for code+text
  - Supports Matryoshka embeddings (efficient storage)
  - 768 dimensions: good quality, reasonable storage cost
  - Outperforms OpenAI text-embedding-ada-002 on code tasks
  - Perfect for Kubernetes YAML + documentation embeddings
```

### Model Selection Logic

```python
class ModelRouter:
    """Intelligently routes queries to the right model."""

    ROUTING_RULES = {
        "intent_classification": "qwen2.5:1.5b",  # Fast, cheap
        "quick_lookup": "qwen2.5:1.5b",            # Fast, cheap
        "yaml_generation": "qwen2.5:7b",            # Good code gen
        "debugging": "deepseek-r1:7b",              # Best reasoning
        "root_cause_analysis": "deepseek-r1:7b",    # Best reasoning
        "architecture_advice": "qwen2.5:7b",        # Good general
        "security_analysis": "deepseek-r1:7b",      # Complex reasoning
        "cost_analysis": "qwen2.5:7b",              # Good general
        "natural_language": "qwen2.5:7b",           # Best conversation
    }

    def route(self, query_type: str, hardware: HardwareProfile) -> str:
        if hardware.available_ram_gb < 6:
            return "qwen2.5:1.5b"  # Degrade gracefully
        if hardware.available_ram_gb < 10:
            return "qwen2.5:7b"    # Standard
        return self.ROUTING_RULES.get(query_type, "qwen2.5:7b")
```

### Hardware Profiles

```yaml
Profile 1 — Laptop Minimum (CPU Only):
  RAM: 8GB
  Storage: 20GB
  GPU: None
  Models: qwen2.5:1.5b (primary), qwen2.5:7b (when needed)
  Expected latency: 5-30s per response
  Capability: 70% of full KOTG.AI features

Profile 2 — Developer Workstation (CPU + Light GPU):
  RAM: 16GB
  Storage: 50GB
  GPU: RTX 3060 / M2 Pro
  Models: qwen2.5:7b (primary), deepseek-r1:7b (reasoning)
  Expected latency: 2-10s per response
  Capability: 90% of full KOTG.AI features

Profile 3 — Server/Cluster Node:
  RAM: 32GB
  Storage: 200GB
  GPU: RTX 4090 / A100 (40GB)
  Models: All models, possibly 14B variants
  Expected latency: 0.5-3s per response
  Capability: 100% of full KOTG.AI features

Profile 4 — Edge/Embedded:
  RAM: 4GB
  Storage: 10GB
  GPU: None
  Models: qwen2.5:1.5b only
  Expected latency: 10-60s per response
  Capability: 40% of features (read-only, advisory only)
```

---

## Local Inference Engine

### Ollama as the Inference Backend

**Why Ollama:**
- Zero configuration — works out of the box
- Automatic hardware detection (CPU/GPU/Metal)
- REST API compatible with OpenAI API format
- Supports all GGUF models
- Active development, large community
- License: MIT

```bash
# Installation (zero cost)
curl -fsSL https://ollama.ai/install.sh | sh

# Pull required models
ollama pull qwen2.5:7b
ollama pull qwen2.5:1.5b
ollama pull deepseek-r1:7b
ollama pull nomic-embed-text

# Start server (automatic on install)
ollama serve  # Runs on localhost:11434
```

### KOTG.AI Inference Client

```python
# kotg/inference/client.py

from ollama import AsyncClient
from typing import AsyncIterator
import asyncio

class KOTGInferenceClient:
    """Async inference client with streaming support."""

    def __init__(self, base_url: str = "http://localhost:11434"):
        self.client = AsyncClient(host=base_url)
        self.model_router = ModelRouter()

    async def generate(
        self,
        prompt: str,
        query_type: str = "natural_language",
        system_prompt: str = None,
        stream: bool = True,
        temperature: float = 0.1,  # Low temp for Kubernetes ops
        context_window: int = 8192,
    ) -> AsyncIterator[str]:
        """Generate response with automatic model selection."""

        model = self.model_router.route(query_type, get_hardware_profile())
        messages = []

        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

        messages.append({"role": "user", "content": prompt})

        response = await self.client.chat(
            model=model,
            messages=messages,
            stream=stream,
            options={
                "temperature": temperature,
                "num_ctx": context_window,
                "num_predict": 4096,
            }
        )

        if stream:
            async for chunk in response:
                yield chunk.message.content
        else:
            yield response.message.content

    async def embed(self, text: str) -> list[float]:
        """Generate embeddings for RAG."""
        response = await self.client.embeddings(
            model="nomic-embed-text",
            prompt=text
        )
        return response.embedding
```

### Performance Optimization

```python
# kotg/inference/optimizer.py

class InferenceOptimizer:
    """Optimizes inference for different hardware profiles."""

    def get_ollama_config(self, profile: HardwareProfile) -> dict:
        if profile.gpu_vram_gb >= 24:
            return {
                "OLLAMA_NUM_GPU": 99,      # Use all GPU layers
                "OLLAMA_NUM_PARALLEL": 4,  # Parallel requests
                "OLLAMA_MAX_LOADED_MODELS": 3,
            }
        elif profile.gpu_vram_gb >= 8:
            return {
                "OLLAMA_NUM_GPU": 20,      # Partial GPU offload
                "OLLAMA_NUM_PARALLEL": 2,
                "OLLAMA_MAX_LOADED_MODELS": 2,
            }
        else:
            return {
                "OLLAMA_NUM_GPU": 0,       # CPU only
                "OLLAMA_NUM_THREADS": profile.cpu_cores,
                "OLLAMA_NUM_PARALLEL": 1,
            }
```

---

## RAG Architecture

### RAG Design Philosophy

KOTG.AI uses a sophisticated multi-tier RAG system that goes far beyond simple document retrieval. The system combines:

1. **Semantic Search** — Find conceptually related content
2. **Keyword Search** — Find exact Kubernetes terms and error codes
3. **Graph-Based Retrieval** — Find related concepts in the knowledge graph
4. **Temporal Retrieval** — Prioritize recent knowledge for evolving APIs
5. **Cluster-Specific Memory** — Retrieve past incidents from this specific cluster

### RAG Pipeline Architecture

```
Document Sources
     │
     ▼
┌─────────────────────────────────────────┐
│         INGESTION PIPELINE              │
│  Crawler → Chunker → Enhancer → Indexer │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│           VECTOR STORE                  │
│         ChromaDB (local)                │
│   Collections:                          │
│   • k8s_docs (official docs)            │
│   • k8s_issues (GitHub issues)          │
│   • k8s_keps (enhancement proposals)    │
│   • incidents (production postmortems)  │
│   • helm_charts (chart documentation)   │
│   • security_advisories (CVEs/CISAs)    │
│   • cluster_memory (per-cluster)        │
└─────────────────┬───────────────────────┘
                  │
Query Time        ▼
┌─────────────────────────────────────────┐
│         RETRIEVAL ENGINE                │
│                                         │
│  Query → Enhance → Multi-Search → Rank  │
│                                         │
│  1. Semantic search (cosine similarity) │
│  2. BM25 keyword search                 │
│  3. Knowledge graph traversal           │
│  4. Cluster memory lookup               │
│  5. Temporal ranking (recency boost)    │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│         CONTEXT ASSEMBLY                │
│                                         │
│  Retrieved chunks → Dedup → Rank →      │
│  Compress → Format → Inject into prompt │
└─────────────────────────────────────────┘
```

### ChromaDB Schema

```python
# kotg/rag/schema.py

COLLECTIONS = {
    "k8s_docs": {
        "description": "Official Kubernetes documentation",
        "metadata_schema": {
            "source": str,       # docs.kubernetes.io/...
            "k8s_version": str,  # "1.29", "1.30", etc.
            "category": str,     # "concepts", "tasks", "reference"
            "api_group": str,    # "apps", "core", "networking.k8s.io"
            "last_updated": str,
        }
    },
    "k8s_issues": {
        "description": "Kubernetes GitHub issue resolutions",
        "metadata_schema": {
            "issue_number": int,
            "repo": str,         # "kubernetes/kubernetes"
            "labels": list,      # ["kind/bug", "area/scheduling"]
            "resolution": str,   # "fixed", "wontfix", "duplicate"
            "k8s_version": str,
            "created_at": str,
            "closed_at": str,
        }
    },
    "incidents": {
        "description": "Production incident postmortems",
        "metadata_schema": {
            "company": str,      # anonymized
            "severity": str,     # "P1", "P2", "P3"
            "k8s_version": str,
            "cloud": str,        # "aws", "gcp", "azure", "on-prem"
            "root_cause_category": str,
            "resolution_time_minutes": int,
            "affected_components": list,
        }
    },
    "cluster_memory": {
        "description": "Per-cluster incident and event history",
        "metadata_schema": {
            "cluster_id": str,   # SHA256 of cluster UID
            "namespace": str,
            "resource_kind": str,
            "incident_id": str,
            "timestamp": str,
            "resolved": bool,
            "resolution_action": str,
        }
    }
}
```

### Advanced Retrieval Implementation

```python
# kotg/rag/retriever.py

from chromadb import Client
from rank_bm25 import BM25Okapi
from typing import List
import asyncio

class KOTGRetriever:
    """Multi-strategy retrieval for maximum relevance."""

    def __init__(self, chroma_client: Client):
        self.chroma = chroma_client
        self.embedder = KOTGEmbedder()
        self.graph = KubernetesKnowledgeGraph()

    async def retrieve(
        self,
        query: str,
        context: ClusterContext,
        n_results: int = 10,
        collections: List[str] = None,
    ) -> List[RetrievedChunk]:
        """Multi-strategy retrieval with intelligent fusion."""

        # Enhance query with Kubernetes-specific terms
        enhanced_query = await self.enhance_query(query, context)

        # Parallel retrieval from multiple strategies
        results = await asyncio.gather(
            self.semantic_search(enhanced_query, collections, n_results),
            self.keyword_search(enhanced_query, collections, n_results),
            self.graph_search(enhanced_query, n_results // 2),
            self.cluster_memory_search(query, context, n_results // 2),
        )

        semantic, keyword, graph, memory = results

        # Reciprocal Rank Fusion — combines rankings from all strategies
        fused = self.reciprocal_rank_fusion(
            [semantic, keyword, graph, memory],
            weights=[0.4, 0.2, 0.2, 0.2]
        )

        # Apply temporal decay — newer K8s content scores higher
        reranked = self.temporal_rerank(fused, decay_factor=0.1)

        return reranked[:n_results]

    async def enhance_query(self, query: str, context: ClusterContext) -> str:
        """Add cluster context and Kubernetes terminology to query."""
        enhancements = []

        # Add K8s version context
        if context.k8s_version:
            enhancements.append(f"kubernetes version {context.k8s_version}")

        # Add CNI context
        if context.cni:
            enhancements.append(f"CNI: {context.cni}")

        # Extract technical terms from query
        k8s_terms = self.extract_k8s_terms(query)
        enhancements.extend(k8s_terms)

        return f"{query} {' '.join(enhancements)}"

    def reciprocal_rank_fusion(
        self,
        result_lists: List[List[RetrievedChunk]],
        weights: List[float],
        k: int = 60
    ) -> List[RetrievedChunk]:
        """RRF algorithm for multi-source result fusion."""
        scores = {}

        for result_list, weight in zip(result_lists, weights):
            for rank, chunk in enumerate(result_list):
                doc_id = chunk.id
                if doc_id not in scores:
                    scores[doc_id] = {"chunk": chunk, "score": 0}
                scores[doc_id]["score"] += weight * (1 / (k + rank + 1))

        sorted_results = sorted(
            scores.values(),
            key=lambda x: x["score"],
            reverse=True
        )

        return [item["chunk"] for item in sorted_results]
```

### Context Window Management

```python
# kotg/rag/context_manager.py

class ContextWindowManager:
    """Manages context window packing for maximum information density."""

    MAX_CONTEXT_TOKENS = {
        "qwen2.5:1.5b": 32768,
        "qwen2.5:7b": 131072,  # 128K context!
        "deepseek-r1:7b": 65536,
    }

    def pack_context(
        self,
        query: str,
        retrieved_chunks: List[RetrievedChunk],
        cluster_state: ClusterState,
        model: str,
    ) -> str:
        """Pack maximum relevant context within token budget."""

        max_tokens = self.MAX_CONTEXT_TOKENS[model]
        reserved_for_response = 2048
        reserved_for_query = 512
        available = max_tokens - reserved_for_response - reserved_for_query

        # Priority ordering for context inclusion
        context_sections = [
            ("cluster_state", self.format_cluster_state(cluster_state)),
            ("recent_incidents", self.format_recent_incidents(cluster_state)),
            ("retrieved_knowledge", self.format_chunks(retrieved_chunks)),
        ]

        packed_context = []
        used_tokens = 0

        for section_name, section_content in context_sections:
            section_tokens = self.count_tokens(section_content)
            if used_tokens + section_tokens <= available:
                packed_context.append(section_content)
                used_tokens += section_tokens
            else:
                # Truncate to fit
                remaining = available - used_tokens
                truncated = self.truncate_to_tokens(section_content, remaining)
                packed_context.append(truncated)
                break

        return "\n\n".join(packed_context)
```

---

## Knowledge Graph Design

### Graph Architecture

The KOTG.AI Knowledge Graph encodes relationships between Kubernetes concepts that no RAG system can capture alone. It enables **graph-based reasoning** — understanding how a change in one component propagates through the system.

```
KNOWLEDGE GRAPH SCHEMA

Node Types:
├── Component (e.g., kube-scheduler, kubelet, etcd)
├── Resource (e.g., Deployment, Service, PVC)
├── Concept (e.g., PodDisruptionBudget, ResourceQuota)
├── Error (e.g., OOMKilled, CrashLoopBackOff, Evicted)
├── Cause (e.g., insufficient_memory, image_pull_failure)
├── Resolution (e.g., increase_memory_limit, check_registry)
├── KEP (e.g., KEP-3063, KEP-2258)
├── CVE (e.g., CVE-2024-1234)
├── BestPractice (e.g., use_readiness_probes)
└── Version (e.g., k8s-1.28, k8s-1.29, k8s-1.30)

Edge Types:
├── CAUSES (Error → Error, Component → Error)
├── RESOLVES (Resolution → Error)
├── DEPENDS_ON (Component → Component)
├── VALIDATES (Resource → Resource)
├── INTRODUCED_IN (Feature → Version)
├── DEPRECATED_IN (Feature → Version)
├── REQUIRES (Resource → Resource)
├── AFFECTS (CVE → Component)
├── IMPLEMENTS (Component → KEP)
└── RELATED_TO (Concept → Concept)
```

### Knowledge Graph Implementation

```python
# kotg/knowledge/graph.py

import networkx as nx
from typing import List, Dict, Set
import json

class KubernetesKnowledgeGraph:
    """
    Directed multigraph encoding Kubernetes concept relationships.
    Uses NetworkX for local operation, with Neo4j export for large deployments.
    """

    def __init__(self, graph_path: str = "~/.kotg/knowledge_graph.json"):
        self.graph = nx.MultiDiGraph()
        self.load(graph_path)

    def add_failure_pattern(self, pattern: FailurePattern):
        """Add a new failure pattern learned from an incident."""
        # Add nodes
        self.graph.add_node(pattern.error_code, type="Error",
                           description=pattern.error_description)
        self.graph.add_node(pattern.root_cause, type="Cause",
                           description=pattern.cause_description)
        self.graph.add_node(pattern.resolution, type="Resolution",
                           steps=pattern.resolution_steps)

        # Add edges
        self.graph.add_edge(pattern.root_cause, pattern.error_code,
                           relation="CAUSES", confidence=pattern.confidence)
        self.graph.add_edge(pattern.resolution, pattern.error_code,
                           relation="RESOLVES", success_rate=pattern.success_rate)

    def find_root_causes(self, error_code: str, depth: int = 3) -> List[str]:
        """Graph traversal to find all possible root causes."""
        causes = []
        predecessors = list(self.graph.predecessors(error_code))

        for pred in predecessors:
            edge_data = self.graph.get_edge_data(pred, error_code)
            if edge_data and any(
                d.get("relation") == "CAUSES" for d in edge_data.values()
            ):
                causes.append({
                    "cause": pred,
                    "confidence": max(
                        d.get("confidence", 0)
                        for d in edge_data.values()
                    )
                })

                if depth > 1:
                    deeper = self.find_root_causes(pred, depth - 1)
                    causes.extend(deeper)

        return sorted(causes, key=lambda x: x["confidence"], reverse=True)

    def get_component_dependencies(self, component: str) -> Dict:
        """Get all dependencies for a Kubernetes component."""
        deps = nx.single_source_shortest_path(self.graph, component, cutoff=3)
        return {node: path for node, path in deps.items()
                if node != component}

    def find_propagation_path(self, source_error: str, target_symptom: str):
        """Find how an error propagates through the system."""
        try:
            path = nx.shortest_path(self.graph, source_error, target_symptom)
            return path
        except nx.NetworkXNoPath:
            return None

    def export_to_neo4j(self, neo4j_uri: str, credentials: tuple):
        """Export graph to Neo4j for large-scale deployment."""
        from neo4j import GraphDatabase
        driver = GraphDatabase.driver(neo4j_uri, auth=credentials)
        # Export logic
```

### Pre-Built Knowledge Graph Content

```yaml
# Pre-populated failure patterns (excerpt)

failure_patterns:
  - error: "OOMKilled"
    causes:
      - cause: "memory_limit_too_low"
        confidence: 0.85
        resolution: "increase_memory_limit_or_fix_memory_leak"
      - cause: "memory_leak_in_application"
        confidence: 0.70
        resolution: "profile_application_memory_usage"
      - cause: "jvm_heap_not_tuned"
        confidence: 0.60
        resolution: "set_JVM_max_heap_below_container_limit"
    related_metrics:
      - "container_memory_working_set_bytes"
      - "container_oom_events_total"

  - error: "CrashLoopBackOff"
    causes:
      - cause: "application_startup_failure"
        confidence: 0.75
        resolution: "check_application_logs_for_startup_errors"
      - cause: "liveness_probe_failure"
        confidence: 0.65
        resolution: "fix_liveness_probe_configuration"
      - cause: "missing_environment_variable"
        confidence: 0.55
        resolution: "add_required_environment_variable"
      - cause: "missing_configmap_or_secret"
        confidence: 0.50
        resolution: "create_missing_kubernetes_secret_or_configmap"
    diagnostic_steps:
      - "kubectl logs <pod> --previous"
      - "kubectl describe pod <pod>"
      - "kubectl get events --sort-by=.lastTimestamp"

  - error: "Pending_pod_unschedulable"
    causes:
      - cause: "insufficient_cpu"
        confidence: 0.70
        detection: "Events: FailedScheduling insufficient cpu"
        resolution: "scale_node_pool_or_reduce_cpu_requests"
      - cause: "insufficient_memory"
        confidence: 0.70
        detection: "Events: FailedScheduling insufficient memory"
        resolution: "scale_node_pool_or_reduce_memory_requests"
      - cause: "node_affinity_mismatch"
        confidence: 0.60
        resolution: "check_nodeAffinity_and_node_labels"
      - cause: "taint_toleration_missing"
        confidence: 0.55
        resolution: "add_toleration_to_pod_spec"
      - cause: "pvc_not_found"
        confidence: 0.50
        resolution: "check_pvc_exists_and_storageclass"
```

---

## Document Ingestion Pipeline

### Pipeline Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                   INGESTION PIPELINE                         │
│                                                              │
│  Sources → Crawlers → Processors → Chunkers → Enhancers →   │
│  Embedders → Indexers → Quality Gates → ChromaDB Store       │
└──────────────────────────────────────────────────────────────┘
```

### Source-Specific Crawlers

```python
# kotg/ingestion/crawlers.py

class KubernetesDocsCrawler:
    """Crawls official Kubernetes documentation."""

    BASE_URL = "https://kubernetes.io/docs"
    SITEMAP = "https://kubernetes.io/sitemap.xml"

    async def crawl(self, output_dir: str):
        # Respect rate limits, crawl sitemap
        # Parse markdown structure
        # Preserve metadata (version, category, api_group)
        # Output: List[Document]

class GitHubIssuesCrawler:
    """Crawls Kubernetes GitHub issues and PRs."""

    REPOS = [
        "kubernetes/kubernetes",
        "kubernetes/ingress-nginx",
        "kubernetes-sigs/cluster-api",
        "istio/istio",
        "cilium/cilium",
    ]

    async def crawl_issues(
        self,
        repo: str,
        labels: List[str] = ["kind/bug"],
        state: str = "closed",  # Closed = has resolution
        since: str = "2019-01-01",
    ):
        # Use GitHub API (free tier: 60 req/hr unauthenticated)
        # With token: 5,000 req/hr
        # Prioritize: closed bugs with accepted resolution
        # Extract: issue body, comments, resolution PR
        pass

class KEPCrawler:
    """Crawls Kubernetes Enhancement Proposals."""

    KEP_REPO = "kubernetes/enhancements"

    async def crawl(self):
        # Clone/sync the enhancements repo
        # Parse KEP markdown files
        # Extract: motivation, design, status, kubernetes version
        pass

class IncidentReportCrawler:
    """Crawls public Kubernetes incident postmortems."""

    SOURCES = [
        "https://k8s.af",        # Kubernetes Failure Stories
        "github.com/danluu/post-mortems",  # Dan Luu's postmortem collection
        "srecon conference talks",
        "KubeCon talk slides and notes",
    ]

    async def crawl(self):
        # Parse public incident reports
        # Anonymize company-specific information
        # Extract: timeline, root cause, resolution, prevention
        pass
```

### Intelligent Chunking

```python
# kotg/ingestion/chunker.py

class KubernetesAwareChunker:
    """
    Kubernetes-specific document chunker that preserves semantic boundaries.
    Never splits YAML examples, code blocks, or procedure steps.
    """

    def chunk(self, document: Document) -> List[Chunk]:
        # Detect document structure
        if document.has_yaml_examples():
            return self.chunk_with_yaml_preservation(document)
        elif document.is_api_reference():
            return self.chunk_by_api_resource(document)
        elif document.is_incident_report():
            return self.chunk_incident_sections(document)
        else:
            return self.chunk_by_headers(document)

    def chunk_with_yaml_preservation(self, document: Document) -> List[Chunk]:
        """Never break YAML examples across chunks."""
        chunks = []
        current_chunk = []
        in_yaml_block = False

        for line in document.content.split('\n'):
            if line.startswith('```yaml') or line.startswith('```yml'):
                in_yaml_block = True
            elif line == '```' and in_yaml_block:
                in_yaml_block = False

            current_chunk.append(line)

            # Only allow splitting outside YAML blocks
            if not in_yaml_block and self.is_good_split_point(current_chunk):
                chunks.append(self.finalize_chunk(current_chunk, document))
                current_chunk = []

        return chunks

    def enhance_chunk(self, chunk: Chunk) -> Chunk:
        """Add Kubernetes metadata to improve retrieval."""
        chunk.metadata["k8s_resources"] = self.extract_resource_types(chunk.content)
        chunk.metadata["k8s_versions"] = self.extract_version_refs(chunk.content)
        chunk.metadata["error_codes"] = self.extract_error_codes(chunk.content)
        chunk.metadata["api_groups"] = self.extract_api_groups(chunk.content)
        return chunk
```

### Ingestion Quality Pipeline

```python
# kotg/ingestion/quality.py

class IngestionQualityPipeline:
    """Ensures only high-quality content enters the knowledge base."""

    def validate(self, chunk: Chunk) -> bool:
        checks = [
            self.minimum_length_check(chunk, min_tokens=50),
            self.not_duplicate_check(chunk),
            self.technical_content_check(chunk),
            self.language_check(chunk, expected="en"),
            self.not_outdated_api_check(chunk),  # Flag deprecated API versions
        ]
        return all(checks)

    def not_outdated_api_check(self, chunk: Chunk) -> bool:
        """Flag chunks referencing deprecated Kubernetes APIs."""
        deprecated_apis = [
            "apiVersion: extensions/v1beta1",
            "apiVersion: apps/v1beta1",
            "apiVersion: apps/v1beta2",
        ]
        for api in deprecated_apis:
            if api in chunk.content:
                chunk.metadata["contains_deprecated_api"] = True
                chunk.metadata["deprecation_warning"] = True
        return True  # Still include, just flagged
```

---

## Multi-Agent Architecture

### Agent Framework Selection

**LangGraph** (by LangChain) — Primary agent orchestration framework

```yaml
Why LangGraph:
  - Native support for multi-agent DAGs
  - State machine-based workflow control
  - Built-in tool calling with any LLM
  - Streaming support
  - Checkpointing for long-running workflows
  - Interrupt/resume for human-in-the-loop
  - MIT License, fully open source
```

### Agent System Overview

```python
# kotg/agents/system.py

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.sqlite import SqliteSaver
from typing import TypedDict, Annotated
import operator

class KOTGState(TypedDict):
    """Shared state across all agents."""
    query: str
    cluster_context: ClusterContext
    cluster_state: ClusterState
    retrieved_knowledge: list
    agent_outputs: Annotated[dict, operator.or_]  # Merge agent outputs
    final_response: str
    confidence_score: float
    requires_human_review: bool
    proposed_actions: list
    approved_actions: list
    audit_log: list

def build_kotg_graph() -> StateGraph:
    """Build the KOTG.AI multi-agent graph."""
    graph = StateGraph(KOTGState)

    # Add agent nodes
    graph.add_node("intent_classifier", intent_classifier_node)
    graph.add_node("cluster_state_agent", cluster_state_agent_node)
    graph.add_node("rag_retriever", rag_retriever_node)
    graph.add_node("debug_agent", debug_agent_node)
    graph.add_node("security_agent", security_agent_node)
    graph.add_node("cost_agent", cost_agent_node)
    graph.add_node("yaml_agent", yaml_agent_node)
    graph.add_node("architect_agent", architect_agent_node)
    graph.add_node("commander_agent", commander_agent_node)
    graph.add_node("synthesizer", response_synthesizer_node)
    graph.add_node("human_review", human_review_node)

    # Define routing logic
    graph.set_entry_point("intent_classifier")

    graph.add_conditional_edges(
        "intent_classifier",
        route_by_intent,
        {
            "debug": "cluster_state_agent",
            "generate": "yaml_agent",
            "analyze": "cluster_state_agent",
            "secure": "security_agent",
            "optimize": "cost_agent",
            "architect": "architect_agent",
            "incident": "commander_agent",
        }
    )

    # After cluster state, retrieve relevant knowledge
    graph.add_edge("cluster_state_agent", "rag_retriever")

    # Parallel execution for complex queries
    graph.add_conditional_edges(
        "rag_retriever",
        should_run_parallel_agents,
        {
            "parallel": ["debug_agent", "security_agent"],
            "single": "debug_agent",
        }
    )

    # Always synthesize before output
    for agent in ["debug_agent", "security_agent", "cost_agent",
                  "yaml_agent", "architect_agent", "commander_agent"]:
        graph.add_edge(agent, "synthesizer")

    # Human review gate for high-impact actions
    graph.add_conditional_edges(
        "synthesizer",
        needs_human_review,
        {
            "review_required": "human_review",
            "auto_approved": END,
        }
    )

    graph.add_edge("human_review", END)

    # Add checkpointing for resumable workflows
    checkpointer = SqliteSaver.from_conn_string("~/.kotg/checkpoints.db")
    return graph.compile(checkpointer=checkpointer)
```

### Individual Agent Implementations

#### 1. Cluster State Agent

```python
# kotg/agents/cluster_state.py

class ClusterStateAgent:
    """
    Collects and analyzes real-time cluster state.
    This is the "eyes" of KOTG.AI.
    """

    def __init__(self, kubectl_mcp: KubectlMCP, metrics_client: MetricsClient):
        self.kubectl = kubectl_mcp
        self.metrics = metrics_client

    async def collect_state(self, context: ClusterContext) -> ClusterState:
        """Parallel collection of all cluster signals."""

        results = await asyncio.gather(
            self.kubectl.get_all_pods_status(),
            self.kubectl.get_all_events(severity=["Warning", "Normal"]),
            self.kubectl.get_node_status(),
            self.kubectl.get_pending_resources(),
            self.metrics.get_cluster_resource_usage(),
            self.kubectl.get_failing_deployments(),
            self.kubectl.get_pvc_status(),
            return_exceptions=True
        )

        pods, events, nodes, pending, metrics, failing_deployments, pvcs = results

        return ClusterState(
            pods=pods,
            events=events,
            nodes=nodes,
            pending_resources=pending,
            resource_metrics=metrics,
            failing_deployments=failing_deployments,
            pvcs=pvcs,
            collected_at=datetime.utcnow(),
        )

    async def analyze(self, state: KOTGState) -> KOTGState:
        """Node function for LangGraph."""
        cluster_state = await self.collect_state(state["cluster_context"])
        state["cluster_state"] = cluster_state

        # Generate concise cluster health summary for LLM context
        state["cluster_state_summary"] = self.summarize_for_llm(cluster_state)
        return state
```

#### 2. Debug Agent

```python
# kotg/agents/debugger.py

class DebugAgent:
    """
    Root cause analysis specialist.
    Uses DeepSeek-R1 for its explicit reasoning traces.
    """

    SYSTEM_PROMPT = """You are KOTG.AI's debugging specialist with the combined knowledge of 100 senior Kubernetes engineers and SRE leads.

You have access to:
- Real-time cluster state and events
- 10 years of Kubernetes incident postmortems
- Kubernetes source code knowledge
- Current cluster topology and configuration

Your job is to diagnose Kubernetes problems with surgical precision.

For every problem you MUST:
1. Identify the ROOT CAUSE (not just symptoms)
2. Trace the CAUSAL CHAIN from root cause to observed symptom
3. Provide CONFIDENCE SCORE (0.0-1.0) for your diagnosis
4. List ALTERNATIVE HYPOTHESES if confidence < 0.8
5. Provide STEP-BY-STEP remediation with commands
6. Identify PREVENTIVE MEASURES to avoid recurrence

Output format: Structured JSON with fields for each requirement above.
"""

    async def analyze(self, state: KOTGState) -> KOTGState:
        """Perform root cause analysis."""

        # Build diagnostic context
        context = self.build_diagnostic_context(
            state["cluster_state"],
            state["retrieved_knowledge"],
            state["query"]
        )

        # Use DeepSeek-R1 for explicit reasoning
        prompt = self.build_cot_prompt(context, state["query"])

        response = await self.llm.generate(
            prompt=prompt,
            system_prompt=self.SYSTEM_PROMPT,
            query_type="debugging",
            temperature=0.05,  # Very low temp for deterministic diagnosis
        )

        diagnosis = self.parse_diagnosis(response)
        state["agent_outputs"]["debug"] = diagnosis

        # High-impact actions require human review
        if diagnosis.confidence < 0.6 or diagnosis.has_destructive_actions:
            state["requires_human_review"] = True

        return state
```

#### 3. YAML Generation Agent

```python
# kotg/agents/yaml_generator.py

class YAMLGenerationAgent:
    """
    Production-safe Kubernetes manifest generator.
    Validates against live cluster before suggesting.
    """

    SYSTEM_PROMPT = """You are KOTG.AI's YAML generation specialist. You generate production-safe Kubernetes manifests.

STRICT REQUIREMENTS:
1. Always use the latest stable apiVersion for the target cluster version
2. Always include resource requests AND limits
3. Always include readiness and liveness probes for Deployment/StatefulSet
4. Always include labels matching the organization's labeling conventions
5. Never include deprecated APIs
6. Always include SecurityContext with non-root, read-only filesystem where possible
7. Validate against the cluster's installed CRDs
8. Match the cluster's existing namespace labels and annotations

Output: Valid YAML only. No explanation unless asked. YAML must be immediately deployable.
"""

    async def generate(self, state: KOTGState) -> KOTGState:
        """Generate and validate Kubernetes manifests."""

        # Get cluster context for validation
        cluster_api_versions = await self.kubectl.get_api_versions()
        namespace_conventions = await self.kubectl.get_namespace_labels(
            state["cluster_context"].target_namespace
        )

        prompt = self.build_generation_prompt(
            request=state["query"],
            k8s_version=state["cluster_context"].k8s_version,
            available_apis=cluster_api_versions,
            conventions=namespace_conventions,
            retrieved_examples=state["retrieved_knowledge"],
        )

        raw_yaml = await self.llm.generate(
            prompt=prompt,
            system_prompt=self.SYSTEM_PROMPT,
            query_type="yaml_generation",
            temperature=0.0,  # Deterministic YAML generation
        )

        # Validate before presenting to user
        validation_result = await self.validate_yaml(
            raw_yaml,
            state["cluster_context"]
        )

        state["agent_outputs"]["yaml"] = {
            "manifest": raw_yaml,
            "validation": validation_result,
            "warnings": validation_result.warnings,
            "dry_run_result": await self.dry_run(raw_yaml, state["cluster_context"]),
        }

        return state

    async def validate_yaml(self, yaml_str: str, context: ClusterContext) -> ValidationResult:
        """Multi-layer YAML validation."""
        validations = await asyncio.gather(
            self.validate_syntax(yaml_str),
            self.validate_api_version(yaml_str, context.k8s_version),
            self.validate_security_policy(yaml_str, context),
            self.validate_resource_limits(yaml_str),
            self.validate_against_kubectl(yaml_str, context),
        )
        return ValidationResult.merge(validations)
```

#### 4. Security Agent

```python
# kotg/agents/security.py

class SecurityAgent:
    """
    Kubernetes security specialist.
    Covers CIS Benchmarks, CVEs, RBAC, Network Policies, and runtime security.
    """

    CIS_BENCHMARK_CHECKS = [
        "1.1.1: Ensure that the API server pod specification file permissions are set to 600 or more restrictive",
        "1.2.1: Ensure that the --anonymous-auth argument is set to false",
        # ... 150+ checks
    ]

    async def analyze(self, state: KOTGState) -> KOTGState:
        """Comprehensive security analysis."""

        results = await asyncio.gather(
            self.check_rbac_overprivilege(state["cluster_state"]),
            self.check_network_policy_gaps(state["cluster_state"]),
            self.check_pod_security_standards(state["cluster_state"]),
            self.check_secret_exposure(state["cluster_state"]),
            self.check_image_vulnerabilities(state["cluster_state"]),
            self.check_cis_compliance(state["cluster_state"]),
        )

        state["agent_outputs"]["security"] = SecurityReport(
            rbac_issues=results[0],
            network_policy_gaps=results[1],
            pod_security_violations=results[2],
            secret_exposure_risks=results[3],
            image_vulnerabilities=results[4],
            cis_compliance_score=results[5],
        )
        return state
```

#### 5. FinOps Agent

```python
# kotg/agents/finops.py

class FinOpsAgent:
    """
    Kubernetes cost optimization specialist.
    Identifies waste, rightsizes resources, and recommends architecture changes.
    """

    async def analyze(self, state: KOTGState) -> KOTGState:
        """Full FinOps analysis."""

        metrics = state["cluster_state"].resource_metrics
        deployments = state["cluster_state"].deployments

        # Identify rightsizing opportunities
        rightsizing = self.calculate_rightsizing(metrics, deployments)

        # Identify idle workloads
        idle = self.find_idle_workloads(metrics, deployments)

        # Identify namespace cost attribution
        cost_by_namespace = self.calculate_namespace_costs(metrics)

        # Spot instance opportunities
        spot_candidates = self.identify_spot_candidates(deployments)

        state["agent_outputs"]["finops"] = FinOpsReport(
            monthly_waste_usd=rightsizing.total_monthly_savings,
            rightsizing_recommendations=rightsizing.recommendations,
            idle_workloads=idle,
            cost_by_namespace=cost_by_namespace,
            spot_candidates=spot_candidates,
            immediate_actions=rightsizing.immediate_actions,
        )
        return state

    def calculate_rightsizing(
        self,
        metrics: ResourceMetrics,
        deployments: List[Deployment]
    ) -> RightsizingResult:
        """Calculate optimal resource allocations based on actual usage."""

        recommendations = []
        for deployment in deployments:
            actual_cpu = metrics.p95_cpu_by_pod.get(deployment.name, 0)
            actual_memory = metrics.p95_memory_by_pod.get(deployment.name, 0)
            requested_cpu = deployment.spec.resources.requests.cpu
            requested_memory = deployment.spec.resources.requests.memory

            cpu_ratio = actual_cpu / requested_cpu if requested_cpu > 0 else 0
            memory_ratio = actual_memory / requested_memory if requested_memory > 0 else 0

            if cpu_ratio < 0.3:  # Using less than 30% of requested CPU
                recommendations.append(RightsizingRec(
                    resource=deployment.name,
                    type="cpu_overprovisioned",
                    current_request=requested_cpu,
                    recommended_request=actual_cpu * 1.3,  # 30% headroom
                    monthly_savings_usd=self.calculate_cpu_cost_savings(
                        requested_cpu - (actual_cpu * 1.3)
                    )
                ))

        return RightsizingResult(recommendations=recommendations)
```

---

## MCP Tool Integration Layer

### MCP Server Architecture

```python
# kotg/mcp/gateway.py

from mcp import MCPServer, Tool
from typing import List

class KOTGMCPGateway:
    """
    Central gateway for all MCP tool integrations.
    Handles tool discovery, routing, and safe execution.
    """

    def __init__(self):
        self.registry = MCPToolRegistry()
        self.executor = SafeToolExecutor()

    async def execute_tool(
        self,
        tool_name: str,
        params: dict,
        dry_run: bool = True,  # Default to dry-run
        context: ClusterContext = None,
    ) -> ToolResult:
        """Execute an MCP tool with safety checks."""

        tool = self.registry.get(tool_name)
        if not tool:
            raise ToolNotFoundError(f"Tool '{tool_name}' not registered")

        # Classify tool risk level
        risk = self.executor.classify_risk(tool, params)

        if risk == "DESTRUCTIVE" and not context.autonomous_mode:
            return ToolResult(
                requires_approval=True,
                preview=await tool.preview(params),
                risk_level=risk,
            )

        if dry_run:
            return await tool.dry_run(params)

        # Execute with audit logging
        result = await self.executor.execute(tool, params)
        self.audit_log(tool_name, params, result, context)
        return result
```

### Core MCP Tools Implementation

```python
# kotg/mcp/tools/kubectl.py

class KubectlMCPTool:
    """Full kubectl MCP wrapper with safety controls."""

    SAFE_OPERATIONS = ["get", "describe", "logs", "explain", "diff", "auth can-i"]
    RISKY_OPERATIONS = ["apply", "patch", "label", "annotate", "scale"]
    DESTRUCTIVE_OPERATIONS = ["delete", "drain", "cordon", "taint"]

    async def execute(self, operation: str, args: dict) -> ToolResult:
        safety_level = self.classify_operation(operation)

        if safety_level == "DESTRUCTIVE":
            # Always preview destructive operations
            preview = self.format_preview(operation, args)
            if not args.get("force_execute"):
                return ToolResult(
                    preview=preview,
                    requires_confirmation=True,
                )

        cmd = self.build_kubectl_command(operation, args)
        return await self.run_command(cmd)

    def build_kubectl_command(self, operation: str, args: dict) -> str:
        """Build safe kubectl commands without shell injection."""
        # Use subprocess.run with list args — never shell=True
        parts = ["kubectl", operation]

        if args.get("namespace"):
            parts.extend(["-n", args["namespace"]])
        if args.get("resource"):
            parts.append(args["resource"])
        if args.get("name"):
            parts.append(args["name"])

        return parts  # List, not string — prevents injection
```

---

## Fine-Tuning Strategy

### When to Fine-Tune vs. RAG

```
Decision Matrix:

PROBLEM TYPE                    → SOLUTION
─────────────────────────────────────────────────────
Common K8s error patterns      → RAG (faster, cheaper)
Specific command generation     → Prompt engineering
Complex reasoning chains        → DeepSeek-R1 base model
K8s-specific format/style       → LoRA fine-tuning
Organization-specific patterns  → RAG + cluster memory
Novel K8s internals knowledge   → Knowledge graph
```

### LoRA Fine-Tuning Pipeline

```python
# kotg/training/finetune.py

from peft import LoraConfig, get_peft_model, TaskType
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

class KOTGFineTuner:
    """
    LoRA fine-tuning for Kubernetes-specific task adaptation.
    Runs on consumer GPUs (RTX 3060 8GB VRAM minimum).
    """

    LORA_CONFIG = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=16,              # LoRA rank — balance quality vs. size
        lora_alpha=32,     # Scaling factor
        lora_dropout=0.1,
        target_modules=["q_proj", "v_proj", "k_proj", "o_proj"],
        bias="none",
    )

    def train(
        self,
        base_model: str = "Qwen/Qwen2.5-7B-Instruct",
        dataset_path: str = "~/.kotg/training/k8s_dataset.jsonl",
        output_dir: str = "~/.kotg/models/kotg-7b-lora",
        num_epochs: int = 3,
    ):
        model = AutoModelForCausalLM.from_pretrained(
            base_model,
            load_in_4bit=True,   # QLoRA — fits in 8GB VRAM
            device_map="auto",
            torch_dtype=torch.float16,
        )

        model = get_peft_model(model, self.LORA_CONFIG)

        training_args = TrainingArguments(
            output_dir=output_dir,
            num_train_epochs=num_epochs,
            per_device_train_batch_size=2,
            gradient_accumulation_steps=4,  # Effective batch size: 8
            learning_rate=2e-4,
            fp16=True,
            save_strategy="epoch",
            logging_steps=10,
        )

        trainer = SFTTrainer(
            model=model,
            args=training_args,
            train_dataset=self.load_dataset(dataset_path),
            formatting_func=self.format_k8s_example,
        )

        trainer.train()
        model.save_pretrained(output_dir)
```

---

## Dataset Creation

### Training Dataset Structure

```jsonl
// k8s_debug_dataset.jsonl — Debug/RCA training examples
{
  "instruction": "A pod in the production namespace is in CrashLoopBackOff state. The pod logs show: 'Error: ECONNREFUSED 127.0.0.1:5432'. Diagnose the root cause and provide remediation steps.",
  "context": "Pod: api-server-7d4f9b-xyz\nNamespace: production\nImage: myapp:1.2.3\nEnvironment variables: DB_HOST=127.0.0.1, DB_PORT=5432\nSidecar containers: none",
  "response": "ROOT CAUSE: The application is configured to connect to PostgreSQL at 127.0.0.1 (localhost), but there is no PostgreSQL database running as a sidecar container or on localhost.\n\nCAUSAL CHAIN:\n1. Pod starts with DB_HOST=127.0.0.1 (incorrect — should point to a Service)\n2. Application attempts to connect to 127.0.0.1:5432 on startup\n3. Connection refused because no PostgreSQL is listening on localhost\n4. Application crashes → CrashLoopBackOff\n\nCONFIDENCE: 0.95\n\nREMEDIATION:\n1. Find the PostgreSQL Service: kubectl get svc -A | grep postgres\n2. Update the DB_HOST environment variable to the Service name\n3. kubectl patch deployment api-server -n production --patch '{\"spec\":{\"template\":{\"spec\":{\"containers\":[{\"name\":\"api-server\",\"env\":[{\"name\":\"DB_HOST\",\"value\":\"<postgres-service-name>\"}]}]}}}}'",
  "metadata": {
    "category": "crash_loop_backoff",
    "difficulty": "medium",
    "k8s_version": "1.28+",
    "source": "curated"
  }
}
```

### Dataset Sources and Sizes

```yaml
Dataset Sources:
  kubernetes_docs_qa:
    source: "Kubernetes official documentation"
    method: "Automated Q&A generation from doc chunks"
    target_size: 50,000 examples
    cost: $0 (open source docs + local LLM for generation)

  github_issue_resolutions:
    source: "kubernetes/kubernetes closed issues"
    method: "Issue body + resolution comment pairs"
    target_size: 30,000 examples
    cost: $0 (GitHub API free tier)

  incident_postmortems:
    source: "k8s.af + public postmortems"
    method: "Manual curation + structured extraction"
    target_size: 5,000 examples
    cost: $0 (public content)

  yaml_generation:
    source: "Helm charts, Kubernetes examples"
    method: "Request-response pairs from chart descriptions"
    target_size: 20,000 examples
    cost: $0 (open source charts)

  kubectl_commands:
    source: "Kubernetes docs + Stack Overflow"
    method: "Natural language to kubectl command pairs"
    target_size: 15,000 examples
    cost: $0

  security_scenarios:
    source: "CIS Benchmark, CVE reports, RBAC examples"
    method: "Scenario-based Q&A generation"
    target_size: 10,000 examples
    cost: $0

  total_dataset_size: 130,000 training examples
  total_cost: $0 (all open source, local LLM for generation)
```

---

## Evaluation Framework

### Evaluation Dimensions

```python
# kotg/evaluation/framework.py

class KOTGEvaluator:
    """
    Comprehensive evaluation framework for KOTG.AI intelligence quality.
    """

    def evaluate_all(self, model, test_suite: TestSuite) -> EvaluationReport:
        results = {
            "diagnostic_accuracy": self.evaluate_diagnostics(model, test_suite),
            "yaml_generation_quality": self.evaluate_yaml_gen(model, test_suite),
            "command_accuracy": self.evaluate_commands(model, test_suite),
            "security_detection_rate": self.evaluate_security(model, test_suite),
            "cost_analysis_accuracy": self.evaluate_finops(model, test_suite),
            "hallucination_rate": self.evaluate_hallucinations(model, test_suite),
            "production_safety_score": self.evaluate_safety(model, test_suite),
        }
        return EvaluationReport(results=results)

    def evaluate_diagnostics(self, model, test_suite) -> float:
        """Evaluate root cause analysis accuracy."""
        correct = 0
        for scenario in test_suite.diagnostic_scenarios:
            prediction = model.diagnose(scenario.cluster_state, scenario.symptoms)
            if prediction.root_cause == scenario.ground_truth_root_cause:
                correct += 1
            # Partial credit for identifying correct component
            elif prediction.root_cause_component == scenario.ground_truth_component:
                correct += 0.5
        return correct / len(test_suite.diagnostic_scenarios)

    def evaluate_hallucinations(self, model, test_suite) -> float:
        """
        Measure rate of factually incorrect Kubernetes information.
        Critical metric — hallucinations in production are dangerous.
        """
        hallucinations = 0
        for question in test_suite.factual_questions:
            answer = model.answer(question.text)
            if not self.verify_against_ground_truth(answer, question.facts):
                hallucinations += 1

        hallucination_rate = hallucinations / len(test_suite.factual_questions)
        return hallucination_rate  # Target: < 2%
```

### Benchmark Test Suite

```yaml
Benchmark Categories:

Tier 1 — Basic Kubernetes Knowledge:
  - 500 questions from Kubernetes docs
  - API version compatibility questions
  - Resource type identification
  - Target accuracy: >95%

Tier 2 — Diagnostic Scenarios:
  - 200 real-world incident scenarios with ground truth
  - Root cause identification
  - Remediation step validation
  - Target accuracy: >80%

Tier 3 — YAML Generation:
  - 100 resource generation requests
  - Validation: kubectl apply --dry-run=server
  - Security policy compliance check
  - Target pass rate: >95%

Tier 4 — Advanced Reasoning:
  - 50 complex multi-component failure scenarios
  - Multi-cluster reasoning
  - Performance tuning recommendations
  - Target accuracy: >70%

Tier 5 — Adversarial/Safety:
  - 100 deliberately misleading queries
  - Requests for dangerous operations
  - Ambiguous scenarios requiring human escalation
  - Target: 100% safe handling
```

---

## Cost Optimization Strategy

### Total Bootstrap Budget: $100

```
BUDGET ALLOCATION:

Cloud Compute for Dataset Generation:  $0
  → Use local LLMs on developer machines
  → Community-contributed incident data
  → Public sources (GitHub, docs)

Cloud Compute for Training:             $0
  → LoRA fine-tuning on local GPU
  → QLoRA fits in consumer GPU (RTX 3060 8GB)
  → No cloud GPU rental needed for MVP

Cloud Storage:                          $0
  → Local ChromaDB (file-based)
  → Git for code
  → GitHub for model registry (free)

CI/CD:                                  $0
  → GitHub Actions free tier
  → Local testing

Domain + Basic Infrastructure:          $12/year
  → kotg.ai domain registration

Model Hosting (Ollama):                 $0
  → Runs locally, no cloud cost

Documentation:                          $0
  → GitHub Pages / Docusaurus

Community Tools:                        $0
  → GitHub Discussions
  → Discord (free)

Security Scanning:                      $0
  → Trivy (open source)
  → Bandit for Python (open source)

TOTAL BOOTSTRAP COST:                   $12/year
REMAINING FROM $100 BUDGET:             $88

$88 Reserve (Emergency/Opportunity Use):
  → One-time VPS for CI if needed: $20
  → Conference/demo server (1 month): $30
  → Miscellaneous tooling/domains: $38
```

### Ongoing Zero-Cost Operations

```yaml
Operational Cost Model (Post-Launch):

Compute:
  - All inference runs locally on user hardware
  - No KOTG.AI server-side LLM costs
  - Knowledge graph updates: local cron job

Storage:
  - Vector DB: ChromaDB local files (~2GB)
  - Knowledge graph: NetworkX pickle (~500MB)
  - Model weights: ~15GB (all downloaded from Hugging Face for free)

API Dependencies:
  - GitHub API: Free tier (60 req/hr, or 5K with free account)
  - Kubernetes docs: Static crawl, weekly refresh
  - No paid API dependencies

Monthly Operational Cost: $0
```

---

## Infrastructure & Deployment

### Deployment Options

```yaml
Option 1 — Single Binary (Target: Day 1):
  $ pip install kotg
  $ kotg init
  $ kotg chat

Option 2 — Docker (Target: Week 2):
  $ docker run -v ~/.kotg:/root/.kotg kotg/kotg:latest

Option 3 — Kubernetes Operator (Target: Month 2):
  $ helm install kotg kotg/kotg-operator
  # Runs as a Deployment in the cluster
  # Has direct access to cluster API via ServiceAccount

Option 4 — Sidecar Agent (Target: Month 4):
  # Runs as a sidecar in monitoring namespace
  # Continuous cluster state collection
  # Proactive alerting and diagnosis
```

### Technology Stack Summary

```yaml
Language: Python 3.12+
CLI Framework: Typer + Rich (beautiful terminal output)
API Framework: FastAPI + uvicorn
Agent Framework: LangGraph 0.2+
LLM Runtime: Ollama (local inference)
Vector Database: ChromaDB (local, file-based)
Knowledge Graph: NetworkX (local) / Neo4j (enterprise)
Cache: Redis (optional) / diskcache (default)
Database: SQLite (local persistence)
Embeddings: nomic-embed-text via Ollama
Package Manager: uv (fast, modern)
Testing: pytest + pytest-asyncio
Linting: ruff + mypy
CI/CD: GitHub Actions
Container: Docker + docker-compose
Kubernetes: Helm chart for cluster deployment
Documentation: MkDocs + Material theme
```

---

*Document Version 1.0 | KOTG.AI Implementation Plan | Confidential*
