# Kubilitics-AI: Complete Vision Alignment & Implementation Guide

**Version**: 1.0
**Date**: 2026-02-11
**Status**: Authoritative Implementation Specification
**Purpose**: 100% Vision-Aligned Implementation Guide for kubilitics-ai Subsystem

---

## Executive Summary

This document provides the **complete, authoritative implementation guide** for the kubilitics-ai subsystem, ensuring 100% alignment with the design documents in `project-docs/`. It synthesizes the architectural vision, current implementation baseline, and concrete next steps.

### Current State (Baseline Assessment)

**Directory Structure**: ✅ **EXCELLENT** - 100% aligned with design
- All major components have proper package structure
- Clear separation: api/, internal/, pkg/, cmd/
- Proper layering: MCP → Reasoning → Safety → Analytics → Memory
- ~4,310 lines of skeleton/interface code established

**Architecture Skeleton**: ✅ **WELL-DEFINED** - Interfaces and contracts established
- All major interfaces defined with clear contracts
- Dependency injection points identified
- Integration points documented in code comments
- Zero implementation of business logic (all stubs)

**Documentation**: ✅ **EXCEPTIONAL** - Package-level documentation comprehensive
- Every package has detailed responsibility documentation
- Integration points clearly documented
- Tool taxonomy clearly defined
- Chain-of-thought enforcement strategy documented

**What's Missing**: **ALL IMPLEMENTATION** - 0% of business logic implemented
- No LLM integration code
- No MCP protocol implementation
- No tool handlers
- No reasoning logic
- No analytics algorithms
- No safety policy evaluation
- No database layer
- No REST API handlers
- No WebSocket implementation
- No gRPC client

### Vision Alignment Score: **100%** 🎯

The directory structure, interfaces, and architectural contracts are **perfectly aligned** with the design vision. What remains is pure implementation work following the clearly defined contracts.

---

## Part 1: Architecture Deep Dive

### 1.1 The Unidirectional Dependency Model

```
┌─────────────────────────────────────────────────────────────┐
│  kubilitics-frontend (React/Tauri)                          │
│  - Calls REST API: http://localhost:8081/api/v1/ai/*        │
│  - WebSocket stream: ws://localhost:8081/api/v1/ai/chat     │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP/WebSocket
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  kubilitics-ai (port 8081) — THE BRAIN                      │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ REST API Layer (internal/api/rest/)                   │  │
│  │ - POST /api/v1/ai/investigate                         │  │
│  │ - GET  /api/v1/ai/insights                            │  │
│  │ - POST /api/v1/ai/actions/{id}/approve                │  │
│  └───────────────────┬──────────────────────────────────┘  │
│                      ▼                                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Reasoning Engine (internal/reasoning/engine/)         │  │
│  │ - Orchestrates investigation lifecycle                │  │
│  │ - Manages state machine                               │  │
│  │ - Calls MCP Server for tool execution                 │  │
│  └───────────────────┬──────────────────────────────────┘  │
│                      ▼                                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ MCP Server (internal/mcp/server/)                     │  │
│  │ - THE SOLE INTERFACE to LLM                           │  │
│  │ - Registers 20+ tools (observation/analysis/exec)     │  │
│  │ - Validates tool calls                                │  │
│  │ - Routes to appropriate handlers                      │  │
│  └───┬───────┬────────┬────────────────────────────────┘  │
│      │       │        │                                     │
│      ▼       ▼        ▼                                     │
│  ┌────┐  ┌─────┐  ┌──────┐                                │
│  │Obs │  │Anal │  │Exec  │  Tool Handlers                  │
│  │Tool│  │Tool │  │Tool  │  (internal/mcp/tools/)          │
│  └─┬──┘  └──┬──┘  └───┬──┘                                │
│    │        │         │                                     │
│    └────────┴─────────┴────────┐                           │
│                                 ▼                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ LLM Adapter Layer (internal/llm/adapter/)             │  │
│  │ - OpenAI / Anthropic / Ollama / Custom                │  │
│  │ - Token counting & budgeting                          │  │
│  │ - Streaming response handling                         │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Safety Engine (internal/safety/policy/)               │  │
│  │ - Evaluates EVERY execution tool call                 │  │
│  │ - Immutable rules + configurable policies             │  │
│  │ - Blast radius calculation                            │  │
│  │ - Autonomy level enforcement                          │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ World Model (internal/memory/worldmodel/)             │  │
│  │ - In-memory cluster state (synced from backend)       │  │
│  │ - Fast lookup without hitting backend                 │  │
│  │ - Temporal storage (sliding window of changes)        │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Analytics Engine (internal/analytics/)                │  │
│  │ - Z-Score anomaly detection                           │  │
│  │ - IQR outlier detection                               │  │
│  │ - Seasonal decomposition                              │  │
│  │ - CUSUM change point detection                        │  │
│  │ - Holt-Winters forecasting                            │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────┬────────────────────────────────────────┘
                      │ gRPC (port 50051)
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  kubilitics-backend (port 8080) — THE BODY                  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ gRPC Server (NEW: internal/grpc/)                     │  │
│  │ - StreamClusterState (server-streaming)               │  │
│  │ - GetResource (unary)                                 │  │
│  │ - ExecuteCommand (unary)                              │  │
│  │ - GetTopologyGraph (unary)                            │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────┬────────────────────────────────────────┘
                      │
                      ▼
            Kubernetes API Server
```

**Critical Design Principles**:
1. **kubilitics-ai depends on kubilitics-backend** (via gRPC)
2. **kubilitics-backend has ZERO dependency on kubilitics-ai**
3. If kubilitics-ai crashes → backend continues working perfectly
4. If backend restarts → kubilitics-ai reconnects automatically
5. LLM NEVER talks directly to Kubernetes (only via MCP tools → backend)

---

### 1.2 The Investigation Lifecycle (9 Phases)

Every non-trivial investigation follows this flow:

```
Phase 1: Intent Detection
├─ Input: User query (natural language or structured)
├─ Process: Classify into diagnosis / optimization / prediction / planning / informational
└─ Output: Intent type + confidence score + reasoning template

Phase 2: Context Construction
├─ Input: Intent type + target resources
├─ Process:
│  ├─ Query World Model for current state
│  ├─ Query Backend for recent events
│  ├─ Query Backend for metrics (time-series)
│  ├─ Query Backend for logs (if diagnostic)
│  ├─ Query Backend for topology graph
│  ├─ Apply intent-aware prioritization
│  ├─ Apply hierarchical summarization
│  ├─ Apply token-aware overflow handling
│  └─ Count tokens and trim to budget
└─ Output: ContextData object (~5K-15K tokens)

Phase 3: Hypothesis Generation
├─ Input: ContextData
├─ Process:
│  ├─ Send context to LLM via MCP
│  ├─ LLM generates 3-7 hypotheses with priors
│  └─ Store in Investigation Graph
└─ Output: List of Hypothesis nodes with prior probabilities

Phase 4: Evidence Gathering
├─ Input: Hypotheses
├─ Process:
│  ├─ For each hypothesis (sequential with early stopping):
│  │  ├─ Determine which tools to call
│  │  ├─ Call MCP tools (observation + analysis)
│  │  ├─ Log tool calls in Investigation Graph
│  │  └─ Update hypothesis confidence scores
│  ├─ Stop if one hypothesis > 0.80 confidence
│  └─ Stop if max_tool_calls (15) reached
└─ Output: Evidence nodes linked to hypotheses

Phase 5: Causal Validation
├─ Input: Hypotheses + Evidence
├─ Process:
│  ├─ Bayesian updating: P(H|E) = P(H) × P(E|H) / P(E)
│  ├─ Apply likelihood ratios
│  ├─ Check causal plausibility
│  └─ Update posterior probabilities
└─ Output: Final confidence scores for all hypotheses

Phase 6: Confidence Scoring
├─ Input: Posterior probabilities
├─ Process:
│  ├─ Identify dominant hypothesis (highest confidence)
│  ├─ Classify confidence: high (>0.80) / moderate (0.50-0.80) / low (<0.50)
│  └─ If multiple high-confidence hypotheses, present all
└─ Output: Ranked list of conclusions with confidence levels

Phase 7: Recommendation Synthesis
├─ Input: Conclusions
├─ Process:
│  ├─ Generate tiered recommendations:
│  │  ├─ Immediate (restart pod, force reschedule)
│  │  ├─ Short-term (increase limits, roll back)
│  │  └─ Long-term (add policies, improve monitoring)
│  ├─ Include for each: action, justification, impact, risk, rollback plan
│  └─ Rank by urgency × confidence × impact
└─ Output: List of Recommendation objects

Phase 8: Human Approval Gate
├─ Input: Recommendations
├─ Process:
│  ├─ Route to Autonomy Controller
│  ├─ Check autonomy level:
│  │  ├─ Level 0-2: Present only, no action
│  │  ├─ Level 3: Request approval
│  │  ├─ Level 4: Simulate first, then request approval
│  │  └─ Level 5: Auto-execute (with rollback)
│  ├─ Route to Safety Engine
│  └─ Check policy compliance, cost budget, blast radius
└─ Output: Approved actions OR waiting-for-approval queue

Phase 9: Execution & Verification
├─ Input: Approved actions
├─ Process:
│  ├─ Call execution tools via MCP (patch, scale, delete, etc.)
│  ├─ MCP calls Safety Engine for final check
│  ├─ MCP calls Backend Proxy → kubilitics-backend ExecuteCommand
│  ├─ kubilitics-backend executes kubectl command
│  ├─ Create rollback record in Audit Store
│  ├─ Poll metrics for 1-5 minutes (verification)
│  ├─ If verification succeeds → mark investigation COMPLETED
│  └─ If verification fails → trigger automatic rollback
└─ Output: Execution results + verification status
```

**Guard Rails** (prevent runaway investigations):
- `max_tool_calls`: 15 (default)
- `token_budget`: 50% of LLM context window
- `time_budget`: 5 minutes wall-clock
- `max_hypotheses`: 7
- `max_concurrent_sessions`: 3 per cluster
- `cost_budget`: User-configurable per session

---

### 1.3 The MCP Tool Taxonomy (4 Tiers)

#### Tier 1: Observation Tools (Read-Only, High Frequency)

| Tool Name | Description | Backend Call | Cache TTL |
|-----------|-------------|--------------|-----------|
| `list_resources` | List K8s resources by kind/namespace/labels | `ListResources(kind, ns, labels)` | 2 min |
| `get_resource` | Get full resource definition | `GetResource(kind, ns, name)` | 5 min |
| `get_resource_yaml` | Get YAML representation | `GetResource` + YAML marshal | 5 min |
| `get_events` | Get events for resource | `GetEvents(resource_id)` | 1 min |
| `get_logs` | Get pod/container logs with semantic hint | `GetLogs(pod, container, hint)` | 30 sec |
| `get_metrics` | Get time-series metrics (CPU/mem/net) | `GetMetrics(resource_id, metric, window)` | 1 min |
| `get_topology` | Get dependency graph | `GetTopologyGraph(resource_id)` | 5 min |
| `search_resources` | Full-text search across resources | `SearchResources(query)` | 2 min |

**Implementation Notes**:
- All Tier 1 tools query World Model first (fast path)
- If World Model data is stale or incomplete, query Backend (slow path)
- Results are cached with TTL
- No LLM calls in Tier 1 (pure data retrieval)

#### Tier 2: Analysis Tools (Computed Insights)

| Tool Name | Description | Dependencies | Compute Type |
|-----------|-------------|--------------|--------------|
| `diff_resources` | Compare two resource versions | Tier 1 tools | String diff |
| `analyze_trends` | Statistical analysis of metrics | Tier 1 `get_metrics` | Analytics Engine |
| `simulate_impact` | Predict change impact | Topology Graph | Graph traversal |
| `check_best_practices` | K8s best practices validation | Tier 1 `get_resource` | Rule engine |
| `calculate_blast_radius` | Affected resources calculation | Topology Graph | Graph traversal |
| `correlate_events` | Find related events | Tier 1 `get_events` | Time-series correlation |
| `explain_resource` | Natural language explanation | LLM | LLM summarization |

**Implementation Notes**:
- Tier 2 tools NEVER call Backend directly (only via Tier 1 tools)
- Heavy compute tasks run in Analytics Engine (internal/analytics/)
- Results are structured JSON (never free-form text, except `explain_resource`)

#### Tier 3: Recommendation Tools (Output Generation)

| Tool Name | Description | Side Effect |
|-----------|-------------|-------------|
| `draft_recommendation` | Create formal recommendation | Insert into `recommendations` table |
| `create_insight` | Create insight object | Insert into `insights` table |
| `generate_report` | Create structured report | Insert into `reports` table |

**Implementation Notes**:
- These tools persist data but don't mutate cluster
- Results are immediately visible via REST API

#### Tier 4: Execution Tools (Mutations, GATED)

| Tool Name | Description | Safety Check | Backend Call |
|-----------|-------------|--------------|--------------|
| `patch_resource` | Apply JSON patch | Policy Engine | `ExecuteCommand("patch", resource, patch)` |
| `scale_resource` | Change replica count | Policy Engine + Blast Radius | `ExecuteCommand("scale", resource, replicas)` |
| `restart_rollout` | Restart deployment | Policy Engine | `ExecuteCommand("restart", resource)` |
| `rollback_rollout` | Roll back to previous revision | Policy Engine | `ExecuteCommand("rollback", resource, revision)` |
| `delete_resource` | Delete resource | **STRICT** Policy Engine | `ExecuteCommand("delete", resource)` |
| `apply_resource` | Apply YAML/JSON definition | Policy Engine + Best Practices | `ExecuteCommand("apply", yaml)` |

**Implementation Flow** (for every Tier 4 tool):
```
1. LLM calls tool via MCP
2. MCP Server calls Safety Engine: Evaluate(action)
3. Safety Engine checks:
   ├─ Immutable rules (e.g., "never delete kube-system resources")
   ├─ Configurable policies (e.g., "max 10 replicas for this namespace")
   ├─ Autonomy level (does current level allow auto-execution?)
   ├─ Blast radius (how many resources affected?)
   └─ Cost budget (does this exceed monthly budget?)
4. If Safety Engine returns DENY → return error to LLM
5. If Safety Engine returns REQUEST_APPROVAL → queue action, notify user
6. If Safety Engine returns APPROVE:
   ├─ Call Backend Proxy: ExecuteCommand(action)
   ├─ Backend executes kubectl command
   ├─ Create rollback record
   ├─ Poll metrics for verification
   └─ Return result to LLM
```

---

### 1.4 The Safety Engine (5 Autonomy Levels)

**Level 0: Observe**
- Read-only mode
- Tier 1 and Tier 2 tools ONLY
- Tier 3 and Tier 4 tools disabled
- Use case: Learning, demo, read-only access

**Level 1: Diagnose**
- Can create insights and recommendations
- Tier 1, Tier 2, Tier 3 tools enabled
- Tier 4 tools disabled
- Use case: Advisory mode, no automation

**Level 2: Propose**
- Can propose actions, requires approval for ALL
- All tools enabled
- Every Tier 4 tool call → REQUEST_APPROVAL
- Use case: Default, controlled automation

**Level 3: Simulate**
- Propose + simulate actions before requesting approval
- Dry-run execution, show predicted outcome
- Tier 4 tools call Backend with `--dry-run=server`
- Use case: Pre-production validation

**Level 4: Act-with-Guard**
- Auto-execute low-risk, approve high-risk
- Low-risk: scale up (not down), increase limits, restart pods
- High-risk: scale down, delete, modify RBAC
- Use case: Mature systems with trust

**Level 5: Full-Autonomous**
- Auto-execute ALL policy-approved actions
- Automatic rollback on verification failure
- Dead man's switch: reverts to Level 2 if backend connection lost
- Use case: Highly trusted systems, 24/7 automation

**Immutable Safety Rules** (enforced at ALL levels):
```go
var ImmutableRules = []Rule{
    {
        Name: "NoDeleteCriticalNamespaces",
        Check: func(action Action) bool {
            return !(action.Operation == "delete" &&
                     contains([]string{"kube-system", "kube-public", "kube-node-lease"}, action.Namespace))
        },
        Reason: "Deleting critical namespaces breaks cluster",
    },
    {
        Name: "NoScaleCriticalToZero",
        Check: func(action Action) bool {
            return !(action.Operation == "scale" &&
                     action.TargetReplicas == 0 &&
                     action.Resource.Labels["critical"] == "true")
        },
        Reason: "Scaling critical services to zero causes outage",
    },
    {
        Name: "NoDrainAllNodes",
        Check: func(action Action) bool {
            if action.Operation != "drain" {
                return true
            }
            healthyNodes := countHealthyNodes()
            return healthyNodes > 1 // Always keep at least 1 node
        },
        Reason: "Draining all nodes makes cluster unusable",
    },
    {
        Name: "NoBreakRBAC",
        Check: func(action Action) bool {
            return !(action.ResourceKind == "ClusterRole" &&
                     action.Operation == "delete" &&
                     action.Resource.Name == "cluster-admin")
        },
        Reason: "Deleting cluster-admin breaks cluster access",
    },
}
```

---

## Part 2: Current Implementation State

### What Exists (Skeleton/Interfaces)

✅ **Directory Structure** - Perfect alignment
✅ **Package Documentation** - Comprehensive
✅ **Interface Definitions** - All major interfaces defined
✅ **Data Models** - Core types defined in `internal/models/types.go`
✅ **Configuration Schema** - Config struct defined
✅ **go.mod** - Dependencies declared

### What's Missing (ALL Business Logic)

❌ **cmd/server/main.go** - Empty `main()` function
❌ **internal/config/** - Config loading not implemented
❌ **internal/integration/grpc/** - gRPC client not implemented
❌ **internal/memory/worldmodel/** - World Model not implemented
❌ **internal/mcp/server/** - MCP protocol not implemented
❌ **internal/mcp/tools/** - Tool handlers not implemented
❌ **internal/reasoning/engine/** - Investigation lifecycle not implemented
❌ **internal/llm/adapter/** - LLM provider integration not implemented
❌ **internal/safety/policy/** - Policy evaluation not implemented
❌ **internal/analytics/** - Statistical algorithms not implemented
❌ **internal/api/rest/** - REST API handlers not implemented
❌ **internal/api/ws/** - WebSocket not implemented
❌ **internal/audit/** - Audit logging not implemented
❌ **internal/cache/** - Caching not implemented
❌ **Database schema** - No migrations, no SQL

### Lines of Code Assessment

- **Total Go files**: ~40 files
- **Total lines**: ~4,310 lines
- **Actual implementation**: **~0 lines** (all stubs/interfaces/docs)
- **Estimated final size**: ~50,000-80,000 lines (based on design complexity)

---

## Part 3: Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2) — "Make It Run"

**Goal**: Get a minimal kubilitics-ai server running, responding to health checks

#### 1.1 Config Management
```
Files to implement:
- internal/config/config.go (LoadConfig, Validate)
- internal/config/defaults.go (Default values)
- internal/config/validation.go (Validation rules)

Tasks:
[ ] Implement viper-based config loading (YAML + env vars)
[ ] Add validation for required fields (backend address, LLM provider)
[ ] Add default values for all optional fields
[ ] Test: Load config from file and environment
```

#### 1.2 Main Server
```
Files to implement:
- cmd/server/main.go (main function, graceful shutdown)

Tasks:
[ ] Parse CLI flags (--config, --port)
[ ] Load configuration
[ ] Initialize logger (zap)
[ ] Start HTTP server (no routes yet, just /health)
[ ] Implement graceful shutdown (SIGINT, SIGTERM)
[ ] Test: Server starts on port 8081, responds to /health
```

#### 1.3 Logging & Observability
```
Files to implement:
- internal/audit/logger.go (Structured audit logging)

Tasks:
[ ] Initialize zap logger with JSON format
[ ] Add context-aware logging (correlation IDs)
[ ] Add audit log writer (append-only file or stdout)
[ ] Test: Logs are structured and include all required fields
```

**Deliverable**: Server binary that starts, responds to `/health`, shuts down gracefully

---

### Phase 2: Backend Integration (Weeks 3-4) — "Talk to Backend"

**Goal**: Establish gRPC connection to kubilitics-backend, sync World Model

#### 2.1 gRPC Client
```
Files to implement:
- api/proto/cluster_data.proto (gRPC service definition)
- internal/integration/grpc/client.go (gRPC client)
- internal/integration/backend/proxy.go (Backend proxy wrapper)

Tasks:
[ ] Define ClusterDataService in .proto file
   ├─ StreamClusterState (server-streaming)
   ├─ GetResource (unary)
   ├─ ListResources (unary)
   ├─ ExecuteCommand (unary)
   └─ GetTopologyGraph (unary)
[ ] Generate Go code: make proto
[ ] Implement gRPC client with connection pooling
[ ] Implement reconnection logic (exponential backoff)
[ ] Add TLS support (optional)
[ ] Test: Connect to backend, receive health check response
```

#### 2.2 World Model (In-Memory Cluster State)
```
Files to implement:
- internal/memory/worldmodel/model.go (World Model)
- internal/memory/worldmodel/sync.go (Streaming sync)
- internal/memory/worldmodel/query.go (Query interface)

Tasks:
[ ] Define in-memory data structure (map[ResourceID]Resource)
[ ] Implement full sync on startup (bootstrap)
[ ] Implement incremental sync via StreamClusterState
[ ] Add query methods: GetResource, ListResources, SearchResources
[ ] Add temporal storage (sliding window of changes, last 1 hour)
[ ] Test: World Model syncs from backend, query works
```

#### 2.3 Backend Proxy (Abstraction Layer)
```
Files to implement:
- internal/integration/backend/proxy.go

Tasks:
[ ] Implement GetResource(kind, namespace, name)
[ ] Implement ListResources(kind, namespace, labelSelector)
[ ] Implement GetEvents(resourceID)
[ ] Implement GetMetrics(resourceID, metric, timeWindow)
[ ] Implement GetTopologyGraph(resourceID)
[ ] Implement ExecuteCommand(operation, resource, params)
[ ] Add result caching with TTL
[ ] Test: All methods work, caching reduces backend calls
```

**Deliverable**: kubilitics-ai syncs cluster state from backend, answers basic queries

---

### Phase 3: MCP Server (Weeks 5-6) — "Build the Tool Layer"

**Goal**: Implement MCP protocol, register Tier 1 observation tools

#### 3.1 MCP Protocol Implementation
```
Files to implement:
- internal/mcp/server/server.go (MCP protocol server)
- internal/mcp/server/registry.go (Tool registry)
- internal/mcp/server/schema.go (JSON schema validation)

Tasks:
[ ] Implement MCP protocol (stdio or WebSocket transport)
[ ] Implement tool registry (name → handler mapping)
[ ] Implement JSON schema validation for tool arguments
[ ] Implement tool execution dispatcher
[ ] Add tool call logging (audit trail)
[ ] Test: Can register tool, call tool, get result
```

#### 3.2 Tier 1 Observation Tools
```
Files to implement:
- internal/mcp/tools/observation/tools.go
- internal/mcp/tools/observation/list_resources.go
- internal/mcp/tools/observation/get_resource.go
- internal/mcp/tools/observation/get_events.go
- internal/mcp/tools/observation/get_logs.go
- internal/mcp/tools/observation/get_metrics.go
- internal/mcp/tools/observation/get_topology.go
- internal/mcp/tools/observation/search_resources.go

Tasks:
[ ] Implement list_resources (calls Backend Proxy)
[ ] Implement get_resource (calls Backend Proxy)
[ ] Implement get_resource_yaml (calls Backend Proxy + marshal)
[ ] Implement get_events (calls Backend Proxy)
[ ] Implement get_logs with semantic hint (calls Backend Proxy)
[ ] Implement get_metrics (calls Backend Proxy)
[ ] Implement get_topology (calls Backend Proxy)
[ ] Implement search_resources (calls Backend Proxy)
[ ] Test: All tools return structured results
```

**Deliverable**: MCP server running, all Tier 1 tools working, can be called by LLM

---

### Phase 4: LLM Integration (Weeks 7-8) — "Connect the Brain"

**Goal**: Integrate LLM providers, implement BYO-LLM adapter

#### 4.1 LLM Adapter Layer
```
Files to implement:
- internal/llm/adapter/adapter.go (Unified LLM interface)
- internal/llm/adapter/streaming.go (Streaming handler)
- internal/llm/adapter/token_counter.go (Token counting)

Tasks:
[ ] Define LLM interface: Complete(prompt, tools) -> Response
[ ] Implement streaming response handling
[ ] Implement token counting (tiktoken for OpenAI, API for Anthropic)
[ ] Implement error handling and retry logic
[ ] Test: Adapter can handle streaming LLM responses
```

#### 4.2 Provider Implementations
```
Files to implement:
- internal/llm/provider/openai/client.go
- internal/llm/provider/anthropic/client.go
- internal/llm/provider/ollama/client.go
- internal/llm/provider/custom/client.go

Tasks:
[ ] Implement OpenAI provider (using github.com/sashabaranov/go-openai)
[ ] Implement Anthropic provider (using HTTP client)
[ ] Implement Ollama provider (using HTTP client)
[ ] Implement Custom provider (OpenAI-compatible API)
[ ] Add model-specific configuration (max_tokens, temperature)
[ ] Test: Each provider can complete a prompt
```

#### 4.3 Budget Tracking
```
Files to implement:
- internal/llm/budget/tracker.go

Tasks:
[ ] Implement token usage tracking (per session, per user, global)
[ ] Implement cost estimation (tokens × model cost)
[ ] Implement budget enforcement (reject if over budget)
[ ] Add budget reset (monthly, daily)
[ ] Test: Budget tracking works, rejects over-budget requests
```

**Deliverable**: LLM integration works, can send prompts and get responses with tool calls

---

### Phase 5: Reasoning Engine (Weeks 9-11) — "Orchestrate Investigations"

**Goal**: Implement 9-phase investigation lifecycle

#### 5.1 Investigation State Machine
```
Files to implement:
- internal/reasoning/investigation/session.go
- internal/reasoning/investigation/state_machine.go

Tasks:
[ ] Implement Investigation struct with state tracking
[ ] Implement state transitions (Created → Investigating → Concluded)
[ ] Implement timeout handling (5 min default)
[ ] Implement cancellation
[ ] Test: State machine transitions correctly
```

#### 5.2 Context Builder
```
Files to implement:
- internal/reasoning/context/builder.go
- internal/reasoning/context/prioritization.go
- internal/reasoning/context/summarization.go

Tasks:
[ ] Implement intent-aware prioritization
[ ] Implement hierarchical summarization (100 pods → "100 running")
[ ] Implement temporal scoping (query time window)
[ ] Implement spatial scoping (query namespace)
[ ] Implement token-aware overflow handling
[ ] Test: Context fits within token budget
```

#### 5.3 Prompt Manager
```
Files to implement:
- internal/reasoning/prompt/manager.go
- internal/reasoning/prompt/templates.go

Tasks:
[ ] Implement system prompt generation
[ ] Implement Chain-of-Thought templates
[ ] Implement investigation-type-specific prompts
[ ] Add examples for few-shot learning
[ ] Test: Prompts render correctly
```

#### 5.4 Reasoning Engine Core
```
Files to implement:
- internal/reasoning/engine/engine.go
- internal/reasoning/engine/lifecycle.go

Tasks:
[ ] Implement Investigate(description, type) -> investigationID
[ ] Implement Phase 1: Intent Detection
[ ] Implement Phase 2: Context Construction
[ ] Implement Phase 3: Hypothesis Generation
[ ] Implement Phase 4: Evidence Gathering (tool calls via MCP)
[ ] Implement Phase 5: Causal Validation (Bayesian updating)
[ ] Implement Phase 6: Confidence Scoring
[ ] Implement Phase 7: Recommendation Synthesis
[ ] Implement Phase 8: Human Approval Gate
[ ] Implement Phase 9: Execution & Verification
[ ] Test: Full investigation lifecycle works end-to-end
```

**Deliverable**: Can trigger investigation, LLM reasons through hypothesis, produces findings

---

### Phase 6: Safety & Analytics (Weeks 12-13) — "Add Intelligence & Safety"

#### 6.1 Safety Policy Engine
```
Files to implement:
- internal/safety/policy/engine.go
- internal/safety/policy/immutable_rules.go
- internal/safety/policy/configurable_policies.go

Tasks:
[ ] Implement ImmutableRules (NoDeleteCritical, NoScaleToZero, etc.)
[ ] Implement Evaluate(action) -> (APPROVE|DENY|REQUEST_APPROVAL)
[ ] Implement policy violation checking
[ ] Implement policy CRUD (create, update, delete policies)
[ ] Test: Immutable rules block dangerous actions
```

#### 6.2 Autonomy Controller
```
Files to implement:
- internal/safety/autonomy/controller.go

Tasks:
[ ] Implement autonomy level enforcement (0-5)
[ ] Implement action routing (auto-execute vs. request approval)
[ ] Implement approval queue
[ ] Test: Autonomy levels work correctly
```

#### 6.3 Blast Radius Calculator
```
Files to implement:
- internal/safety/blastradius/calculator.go

Tasks:
[ ] Implement CalculateBlastRadius(action) -> affectedResources
[ ] Use topology graph to trace dependencies
[ ] Test: Blast radius calculation is accurate
```

#### 6.4 Rollback Manager
```
Files to implement:
- internal/safety/rollback/manager.go

Tasks:
[ ] Implement CreateRollbackRecord(action, originalState)
[ ] Implement Rollback(actionID)
[ ] Implement automatic rollback on verification failure
[ ] Test: Rollback restores original state
```

#### 6.5 Analytics Engine
```
Files to implement:
- internal/analytics/anomaly/detector.go (Z-Score, IQR)
- internal/analytics/timeseries/engine.go (Moving averages)
- internal/analytics/forecasting/predictor.go (Holt-Winters)
- internal/analytics/scoring/scorer.go (Health scores)

Tasks:
[ ] Implement Z-Score anomaly detection
[ ] Implement IQR outlier detection
[ ] Implement moving averages (SMA, EMA)
[ ] Implement seasonal decomposition
[ ] Implement CUSUM change point detection
[ ] Implement Holt-Winters forecasting
[ ] Implement linear regression (growth rates)
[ ] Implement percentile analysis (P50, P90, P99)
[ ] Test: Analytics algorithms produce correct results
```

**Deliverable**: Safety engine blocks dangerous actions, analytics detects anomalies

---

### Phase 7: REST API & Frontend Integration (Weeks 14-15) — "Expose to UI"

#### 7.1 REST API Handlers
```
Files to implement:
- internal/api/rest/handler.go (Main router)
- internal/api/rest/routes.go (Route definitions)
- internal/api/rest/investigations.go (Investigation endpoints)
- internal/api/rest/insights.go (Insight endpoints)
- internal/api/rest/actions.go (Action endpoints)
- internal/api/rest/analytics.go (Analytics endpoints)
- internal/api/rest/config.go (Config endpoints)
- internal/api/rest/usage.go (Usage endpoints)

Tasks:
[ ] Implement POST /api/v1/ai/investigations
[ ] Implement GET  /api/v1/ai/investigations
[ ] Implement GET  /api/v1/ai/investigations/{id}
[ ] Implement POST /api/v1/ai/investigations/{id}/cancel
[ ] Implement GET  /api/v1/ai/insights
[ ] Implement GET  /api/v1/ai/insights/resource/{kind}/{ns}/{name}
[ ] Implement POST /api/v1/ai/insights/{id}/dismiss
[ ] Implement GET  /api/v1/ai/actions/pending
[ ] Implement POST /api/v1/ai/actions/{id}/approve
[ ] Implement POST /api/v1/ai/actions/{id}/reject
[ ] Implement GET  /api/v1/ai/actions/history
[ ] Implement GET  /api/v1/ai/config
[ ] Implement PUT  /api/v1/ai/config
[ ] Implement GET  /api/v1/ai/usage
[ ] Test: All endpoints return correct responses
```

#### 7.2 WebSocket Handler
```
Files to implement:
- internal/api/ws/handler.go

Tasks:
[ ] Implement WebSocket upgrade
[ ] Implement investigation streaming (send updates as investigation progresses)
[ ] Implement chat interface (bidirectional messaging)
[ ] Implement backpressure handling
[ ] Test: WebSocket streams investigation updates
```

#### 7.3 Middleware
```
Files to implement:
- internal/api/middleware/auth.go (Authentication)
- internal/api/middleware/cors.go (CORS)
- internal/api/middleware/logging.go (Request logging)

Tasks:
[ ] Implement authentication (JWT or token-based)
[ ] Implement CORS (allow frontend origin)
[ ] Implement request logging with correlation IDs
[ ] Test: Middleware intercepts requests correctly
```

**Deliverable**: REST API fully functional, frontend can trigger investigations and view results

---

### Phase 8: Database & Persistence (Week 16) — "Remember Everything"

#### 8.1 Database Schema
```
Files to create:
- migrations/001_create_investigations.sql
- migrations/002_create_insights.sql
- migrations/003_create_actions.sql
- migrations/004_create_recommendations.sql
- migrations/005_create_audit_log.sql
- migrations/006_create_analytics_data.sql

Tasks:
[ ] Design schema for investigations table
[ ] Design schema for insights table
[ ] Design schema for actions table
[ ] Design schema for recommendations table
[ ] Design schema for audit_log table (append-only)
[ ] Design schema for analytics_data table (time-series)
[ ] Test: Schema creates successfully
```

#### 8.2 Database Layer
```
Files to implement:
- internal/memory/temporal/store.go (SQL wrapper)

Tasks:
[ ] Implement SQLite adapter (for desktop)
[ ] Implement PostgreSQL adapter (for server)
[ ] Implement migration runner
[ ] Implement query builder
[ ] Implement CRUD operations for all tables
[ ] Test: Data persists across restarts
```

**Deliverable**: All investigations, insights, and actions are persisted

---

### Phase 9: Testing & Polish (Weeks 17-18) — "Make It Production-Ready"

#### 9.1 Unit Tests
```
Tasks:
[ ] Write unit tests for all MCP tools
[ ] Write unit tests for Reasoning Engine phases
[ ] Write unit tests for Safety Engine rules
[ ] Write unit tests for Analytics algorithms
[ ] Write unit tests for LLM adapters
[ ] Target: >80% code coverage
```

#### 9.2 Integration Tests
```
Tasks:
[ ] Write integration test: Full investigation lifecycle
[ ] Write integration test: Safety engine blocks dangerous action
[ ] Write integration test: Analytics detects anomaly
[ ] Write integration test: gRPC reconnection on backend restart
[ ] Write integration test: LLM fallback on provider failure
```

#### 9.3 E2E Tests
```
Tasks:
[ ] Write E2E test: User triggers investigation via REST API
[ ] Write E2E test: Investigation completes, produces insight
[ ] Write E2E test: Action proposed, user approves, action executes
[ ] Write E2E test: Rollback on verification failure
```

#### 9.4 Documentation
```
Tasks:
[ ] Update README.md with complete setup instructions
[ ] Write API documentation (OpenAPI spec)
[ ] Write deployment guide (Docker, Kubernetes)
[ ] Write troubleshooting guide
[ ] Write examples directory (sample investigations)
```

**Deliverable**: kubilitics-ai is fully tested, documented, production-ready

---

## Part 4: Critical Implementation Patterns

### Pattern 1: Error Handling

```go
// Use structured errors with context
type InvestigationError struct {
    Phase         string
    InvestigationID string
    Err           error
    Context       map[string]interface{}
}

func (e *InvestigationError) Error() string {
    return fmt.Sprintf("investigation %s failed in phase %s: %v",
        e.InvestigationID, e.Phase, e.Err)
}

// Always wrap errors with context
if err := mcpServer.ExecuteTool(ctx, "get_resource", args); err != nil {
    return &InvestigationError{
        Phase:         "evidence_gathering",
        InvestigationID: inv.ID,
        Err:           err,
        Context:       map[string]interface{}{"tool": "get_resource", "args": args},
    }
}
```

### Pattern 2: Context Propagation

```go
// Every function takes context.Context as first parameter
func (e *Engine) Investigate(ctx context.Context, description string) (string, error) {
    // Create correlation ID
    correlationID := uuid.New().String()
    ctx = context.WithValue(ctx, "correlation_id", correlationID)

    // Pass context to all downstream calls
    inv, err := e.contextBuilder.Build(ctx, description)
    if err != nil {
        return "", err
    }

    // Context carries cancellation, timeout, correlation ID
    return inv.ID, nil
}
```

### Pattern 3: Graceful Degradation

```go
// Always check if dependencies are available, degrade gracefully
func (t *GetMetricsTool) Execute(ctx context.Context, args map[string]interface{}) (interface{}, error) {
    // Try backend first
    metrics, err := t.backendProxy.GetMetrics(ctx, args)
    if err == nil {
        return metrics, nil
    }

    // Fallback to cached data
    t.logger.Warn("backend unavailable, using cached metrics", zap.Error(err))
    cachedMetrics, cacheErr := t.cache.Get(ctx, cacheKey(args))
    if cacheErr == nil {
        return cachedMetrics, nil
    }

    // Both failed, return error
    return nil, fmt.Errorf("backend and cache unavailable: %w", err)
}
```

### Pattern 4: Streaming Responses

```go
// Use channels for streaming LLM responses
func (a *Adapter) CompleteStreaming(ctx context.Context, prompt string) (<-chan string, <-chan error) {
    tokens := make(chan string, 100)
    errs := make(chan error, 1)

    go func() {
        defer close(tokens)
        defer close(errs)

        stream, err := a.provider.CreateCompletionStream(ctx, prompt)
        if err != nil {
            errs <- err
            return
        }
        defer stream.Close()

        for {
            response, err := stream.Recv()
            if err == io.EOF {
                return
            }
            if err != nil {
                errs <- err
                return
            }

            select {
            case tokens <- response.Content:
            case <-ctx.Done():
                errs <- ctx.Err()
                return
            }
        }
    }()

    return tokens, errs
}
```

---

## Part 5: Success Metrics

### Functional Metrics
- ✅ Server starts successfully on port 8081
- ✅ Connects to kubilitics-backend via gRPC
- ✅ World Model syncs within 5 seconds for 1000-resource cluster
- ✅ All 20+ MCP tools return valid responses
- ✅ LLM integration works with OpenAI, Anthropic, Ollama
- ✅ Investigation lifecycle completes end-to-end
- ✅ Safety engine blocks dangerous actions
- ✅ Analytics detects CPU spike anomaly
- ✅ REST API returns correct responses for all endpoints
- ✅ WebSocket streams investigation updates in real-time

### Performance Metrics
- Investigation latency: <30 seconds for diagnostic queries
- Context construction: <5 seconds
- Tool call latency: <500ms for Tier 1 tools
- LLM response latency: <10 seconds (streaming)
- Backend gRPC latency: <100ms
- World Model query latency: <10ms

### Quality Metrics
- Code coverage: >80%
- Zero crashes on invalid input
- Graceful degradation when backend unavailable
- All errors have clear, actionable messages
- Investigation Graph fully auditable

---

## Part 6: Next Steps (Immediate)

### Week 1 Actions

1. **Implement Configuration Loading** ✅ Priority 1
   ```bash
   cd kubilitics-ai
   # Implement internal/config/config.go
   # Add tests: internal/config/config_test.go
   ```

2. **Implement Main Server** ✅ Priority 1
   ```bash
   # Implement cmd/server/main.go
   # Test: ./bin/kubilitics-ai --config config.yaml
   # Expected: Server starts, /health returns 200
   ```

3. **Implement gRPC Client** ✅ Priority 2
   ```bash
   # Define api/proto/cluster_data.proto
   # Generate: make proto
   # Implement internal/integration/grpc/client.go
   # Test: Connect to backend (even if backend not implemented yet)
   ```

4. **Set Up CI/CD** ✅ Priority 3
   ```bash
   # Add .github/workflows/kubilitics-ai-ci.yml
   # Add Makefile targets: build, test, lint, docker-build
   ```

---

## Conclusion

**Current State**: Excellent architectural foundation (100% vision-aligned), zero implementation

**What You Have**:
- Perfect directory structure
- Clear interface contracts
- Comprehensive documentation
- Solid dependency management

**What You Need**:
- ~50,000-80,000 lines of implementation
- 18 weeks of focused development
- Integration testing with kubilitics-backend
- Frontend integration testing

**The Vision is Clear. The Path is Defined. The Architecture is Sound.**

**Now: Execute Phase 1, Week 1.** 🚀
