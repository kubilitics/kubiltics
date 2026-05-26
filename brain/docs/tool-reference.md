# Kubilitics AI — MCP Tool Reference

**157 tools · 8 categories · Generated 2026-05-26**

---

## The Vision — Why This Exists

> "The best Kubernetes tool on earth — your 3am incident commander, your morning standup briefer, your architecture advisor, and your compliance auditor. All in one."

Kubilitics is not a dashboard. Dashboards show you metrics after you already know what to look at. Kubilitics is an **AI layer that understands your cluster the way a seasoned SRE does** — and can diagnose, plan, and act on it safely through natural conversation.

You don't learn commands. You don't write kubectl queries. You describe a situation in plain English, and Kubilitics selects the right tools from 157 available, calls them in the right order, guards their execution through a 9-layer safety stack, and synthesises the answer into an explanation a human can act on.

The 157 tools below are the vocabulary this AI speaks. Every one maps to a real cluster operation. Together they cover every operational scenario: incidents, capacity planning, security audits, cost optimisation, compliance, architecture review, and proactive health monitoring.

---

## Architecture — How a Query Becomes an Answer

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                      KUBILITICS END-TO-END AI QUERY FLOW                     ║
╚═══════════════════════════════════════════════════════════════════════════════╝

  You type:  "Why are my pods crashing in production?"
                              │
                              │  (Tauri desktop app — Chat Panel)
                              ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                    kubilitics-backend  (Go · port 8190)                 │
  │                                                                         │
  │  POST /api/v1/ai/sessions/{id}/chat                                     │
  │  ┌──────────────────────────────────┐                                   │
  │  │  Auth + cluster ID resolution   │  (active cluster from Zustand)    │
  │  │  Rate-limit: 60 req/min         │                                   │
  │  └──────────────────┬──────────────┘                                   │
  └─────────────────────┼───────────────────────────────────────────────────┘
                        │  gRPC stream  (Chat RPC — kotg-schema proto)
                        ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                    kubilitics-ai / brain  (Go · port 50051 gRPC)        │
  │                                                                         │
  │  System prompt (auto-injected per session):                             │
  │  ┌─────────────────────────────────────────────────────────────────┐   │
  │  │ Active cluster:  prod-us-east-1                                 │   │
  │  │ Nodes: 47  |  Namespaces: 12  |  Focus: production             │   │
  │  │ Tool budget: 50 calls/session  |  Destructive tools: BLOCKED   │   │
  │  └─────────────────────────────────────────────────────────────────┘   │
  │                                                                         │
  │  LLM  (GPT-4o / Claude Sonnet / Ollama — provider-agnostic)           │
  │  ┌─────────────────────────────────────────────────────────────────┐   │
  │  │  "User asks about pod crashes → I need logs + events"          │   │
  │  │                                                                 │   │
  │  │  tool_call #1 → list_problems(namespace="production")          │   │
  │  │  tool_call #2 → get_pod_logs(namespace=…, name=…, lines=200)  │   │
  │  │  tool_call #3 → analyze_pod_health(namespace="production")     │   │
  │  └─────────────────────────────────────────────────────────────────┘   │
  └─────────────────────┬───────────────────────────────────────────────────┘
                        │  ExecuteTool() — per call, per tool
                        ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                         MCP SAFETY STACK (9 layers)                     │
  │                                                                         │
  │  1 ▸ Rate limiter         60 calls/min per session, token-bucket        │
  │  2 ▸ Cert gate            Certified/Provisional → allow                 │
  │                           Uncertified + destructive → BLOCK             │
  │  3 ▸ Wildcard arg guard   name:"*" on mutations → reject                │
  │  4 ▸ Budget pre-check     session limit (default 50) enforced           │
  │  5 ▸ Tool handler         real Kubernetes API call                      │
  │  6 ▸ Redactor             strip SECRET_KEY, passwords, tokens           │
  │  7 ▸ Injection scanner    reject prompt-injection patterns in results   │
  │  8 ▸ Budget consume       decrement session counter on success          │
  │  9 ▸ Output cap           truncate result to 8 KB max                   │
  └─────────────────────┬───────────────────────────────────────────────────┘
                        │
                        ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │               Kubernetes API Server  (your cluster)                     │
  │                                                                         │
  │  GET  /api/v1/namespaces/production/pods                                │
  │  GET  /api/v1/namespaces/production/pods/{name}/log?tailLines=200       │
  │  GET  /api/v1/namespaces/production/events?fieldSelector=…              │
  └─────────────────────┬───────────────────────────────────────────────────┘
                        │  Raw Kubernetes data (JSON)
                        ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                LLM synthesises final answer                             │
  │                                                                         │
  │  "Your payment-api pods (3 of 5 ready) are OOMKilled. The crash        │
  │   started at 02:15 UTC — same time as the v2.3.1 rollout.             │
  │   Root cause: connection pool leak in the new release.                 │
  │                                                                         │
  │   Immediate options:                                                    │
  │   1. Roll back to v2.3.0  (I can plan this safely — just ask)         │
  │   2. Raise memory limit 256Mi → 512Mi as a temporary measure           │
  │                                                                         │
  │   Blast radius: 2 downstream services depend on payment-api."          │
  └─────────────────────┬───────────────────────────────────────────────────┘
                        │  AssistantEvent stream (WebSocket)
                        ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │            Chat Panel — streamed blocks rendered in real time           │
  │                                                                         │
  │   ToolCallBlock  →  shows which tools fired and their latency          │
  │   TextBlock      →  the synthesised narrative above                    │
  │   ActionPending  →  "Roll back?" button (requires your confirmation)   │
  └─────────────────────────────────────────────────────────────────────────┘
```

---

## How the LLM Selects Tools

The LLM does not pick tools randomly. It uses the tool descriptions and your query to reason about what information is needed, in what order, with what parameters. Three patterns dominate:

**Pattern 1 — Single-tool pinpoint** (you name a resource explicitly)
```
"Show me the logs for payment-api-6d9f-xk2j in production"
  → get_pod_logs(namespace=production, name=payment-api-6d9f-xk2j, lines=200)
```

**Pattern 2 — Two-tool compose** (you name a symptom, not a resource)
```
"Why is the checkout service returning 502s?"
  → analyze_service_health(namespace=..., name=checkout)  [find the service state]
  → analyze_network_connectivity(namespace=..., service=checkout)  [trace connectivity]
```

**Pattern 3 — Multi-tool incident workflow** (you describe a situation)
```
"We just got paged — something is wrong in production"
  → triage_cluster()                    [rank all active problems]
  → list_problems(namespace=production) [narrow to prod namespace]
  → analyze_blast_radius(...)           [understand blast radius]
  → narrate_incident_timeline(...)      [produce the incident timeline]
```

The `cluster_id` parameter is **always injected automatically** from the session's system prompt — you never need to supply it.

---

## Reading Each Tool Entry

Every tool below is documented with:

| Section | What it tells you |
|---|---|
| **Purpose** | What the tool does and when to use it |
| **Parameters** | Every input field with types and defaults |
| **Example** | Ready-to-paste JSON for direct API calls |
| **User asks** | 3 natural language queries that trigger this tool |
| **AI processes** | How the LLM reasons when it selects this tool |
| **Test coverage** | Which automated tests validate this tool |

---

## Testing & Validation Summary

| Check | Status | Detail |
|---|---|---|
| **Schema contracts** | ✅ 157/157 PASS | `TestContract_AllToolsHaveRequiredFields` — name, description, category, inputSchema present |
| **Registration** | ✅ 157/157 PASS | `TestRegisterAllTools_AllToolsRegistered` — all tools reachable via `ExecuteTool` |
| **Functional unit tests** | ✅ 216 cases PASS | Per-tool handler tests (server package) with fake backend |
| **Parallel load (non-destructive)** | ✅ 148/148 PASS | All read-only tools callable concurrently under `-race` detector |
| **Race detector** | ✅ 0 races | `go test -tags load -race` clean |
| **Lint** | ✅ 0 issues | `golangci-lint` clean (brain + backend) |
| **Certification grade** | ⏳ Provisional | Report generated; no live CI signals injected yet |
| **Destructive tools** | 🔒 9 Blocked | Gated until `certify-tools` runs with live K8s signal |
| **Benchmarks** | ✅ 20/20 | All safety layers measured; cert gate at 4 ns |

### What "Provisional" means

The certification engine grades every tool across four signals:
- **Contract** — schema + required fields (all 157 pass)
- **Live validation** — real cluster round-trip (requires `certify-tools` CLI against a live cluster)
- **Statement coverage** — go test coverage >60% threshold
- **Chaos resilience** — recovers from nil/timeout backend responses

All 157 tools are Provisional because live signals have not been injected into the report yet. Run `./certify-tools --backend http://localhost:8190` against a running cluster to graduate tools to Certified.

---

## Tool Categories at a Glance

| Category | Count | Purpose |
|---|---|---|
| [Observation](#observation-49-tools) | 49 | Read-only cluster state — inspect any resource |
| [Analysis](#analysis-41-tools) | 41 | Deep insights, health scoring, root-cause reasoning |
| [Recommendation](#recommendation-18-tools) | 18 | Planning, optimisation, upgrade paths |
| [Troubleshooting](#troubleshooting-17-tools) | 17 | Specific failure diagnosis |
| [Security](#security-15-tools) | 15 | CIS checks, RBAC audit, compliance |
| [Execution](#execution-9-tools--safety-gated) | 9 | Cluster mutations — safety-gated |
| [Cost](#cost-4-tools) | 4 | Spend analysis, waste detection, forecasting |
| [Automation](#automation-4-tools) | 4 | Playbooks, schedules, alert rules, runbooks |

---

## Observation (49 tools)

*All read-only. Autonomy level 1. Never blocked.*

---

### `triage_cluster`
**Purpose:** Single-turn cluster triage — the first tool to call when paged at 3am. Returns a ranked narrative of top pod problems, node pressure, and recent critical events in one response.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID (defaults to active cluster) |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```


**User asks:**
- "We just got paged — what's on fire in production right now?"
- "Give me a 3am health summary before I dig in"
- "What are the top problems I should look at this morning?"

**AI processes:** The LLM recognises an open-ended cluster-wide incident or health-check intent. It calls `triage_cluster` first because this tool returns a ranked narrative of all active problems in a single call — the fastest possible triage. The result is a prioritised list the LLM uses as the backbone for its response, drilling into specifics with follow-up tools only when the user asks.

**Test coverage:** `TestHandleTriageCluster_ComposesAndRanks`, `TestLoad_Concurrent20x10` (200 parallel calls)
---

### `resolve_resource`
**Purpose:** Fuzzy-find a resource by kind + name hint across the whole cluster. Call this first when you know the kind but not the namespace.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `kind` | string | Yes | Resource kind e.g. `Deployment`, `Service`, `ConfigMap` |
| `name_hint` | string | Yes | Name or fuzzy substring |
| `cluster_id` | string | No | Cluster ID |
| `cluster_wide` | boolean | No | Search all namespaces (default true) |

**Example:**
```json
{ "kind": "Deployment", "name_hint": "payment-api" }
```


**User asks:**
- "Find my payment-api deployment — I'm not sure which namespace it's in"
- "Where is the redis StatefulSet running?"
- "Is there a ConfigMap called feature-flags anywhere in the cluster?"

**AI processes:** The LLM detects a resource-location query where the namespace is unknown or ambiguous. It calls `resolve_resource` with the kind and name hint, receives the canonical namespace + name, then passes that resolved identity to inspection or analysis tools in subsequent calls.

**Test coverage:** `TestResolveResource_ExactMatchAcrossNamespaces`, `TestResolveResource_NoMatchGivesSuggestions`, `TestResolveResource_RequiresArgs`
---

### `inspect_pod`
**Purpose:** Deep dive into a Pod — spec, status, recent events, ownership chain (RS → Deployment), containers and their states.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Pod name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-6d8f9b-xk2j" }
```


**User asks:**
- "Show me everything about the payment-api-6d9f-xk2j pod"
- "Which containers are in that pod and what state are they in?"
- "Who owns this pod — what Deployment created it?"

**AI processes:** The LLM receives a specific pod name and needs deep state. It calls `inspect_pod` to get spec, status, ownership chain (RS → Deployment), container states, and recent events in one composite response — avoiding 3-4 separate kubectl calls.

**Test coverage:** `TestHandleInspectPodValidation`, `TestHandlePodDetailed_FullResponse`, `TestPrivacy_Pod_EnvSecretsNeverLeak`
---

### `inspect_deployment`
**Purpose:** Deep dive into a Deployment — spec, status, rollout history, recent events, child ReplicaSets.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api" }
```


**User asks:**
- "What's the rollout history of payment-api?"
- "How many replicas does checkout-service have and are they all ready?"
- "Show me the deployment spec for the auth service"

**AI processes:** The LLM identifies a Deployment-specific query and calls `inspect_deployment` to retrieve spec, rollout history, child ReplicaSets, and recent events. The result lets the LLM explain readiness, last-deploy timing, and change history.

**Test coverage:** `TestHandleDeploymentDetailed_FullResponse`
---

### `inspect_replicaset`
**Purpose:** Deep dive into a ReplicaSet — spec, status, events, ownership chain (parent Deployment → child Pods).

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | ReplicaSet name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api-7d9c8b" }
```


**User asks:**
- "Why does this ReplicaSet have pods stuck in Pending?"
- "What Deployment owns the payment-api-7d9c8b ReplicaSet?"
- "Show me the replica count and pod template for this RS"

**AI processes:** The LLM detects a ReplicaSet-level question and calls `inspect_replicaset` to get spec, current replica count, owner Deployment, and child pod states — giving context that pod-level tools alone can't provide.

**Test coverage:** Contract test + registration test
---

### `inspect_statefulset`
**Purpose:** Deep dive into a StatefulSet — spec, update strategy, ordinal readiness, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | StatefulSet name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "database", "name": "postgres-primary" }
```


**User asks:**
- "Is the postgres-primary StatefulSet fully ready?"
- "Which ordinal replicas are not yet Running in the Kafka StatefulSet?"
- "What's the update strategy for our database StatefulSet?"

**AI processes:** Stateful workloads have ordered rollout semantics the LLM needs to reason about. `inspect_statefulset` returns ordinal readiness, update strategy, and events — letting the LLM explain why replica-3 is blocking the rolling update.

**Test coverage:** Contract + `TestAnalyzeStatefulSetHealth_DegradedReplicas`
---

### `inspect_daemonset`
**Purpose:** Deep dive into a DaemonSet — spec, node coverage, rolling update progress, events, child Pods.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | DaemonSet name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "monitoring", "name": "node-exporter" }
```


**User asks:**
- "Is node-exporter running on all my nodes?"
- "Why is the logging DaemonSet missing pods on 3 nodes?"
- "What's the rollout status of the fluentd DaemonSet?"

**AI processes:** DaemonSet coverage questions require node-level correlation. `inspect_daemonset` returns per-node coverage, desired vs. current counts, and events — letting the LLM pinpoint which specific nodes are missing the DaemonSet pod and why.

**Test coverage:** Contract + `TestAnalyzeDaemonSetHealth_DegradedCount`
---

### `inspect_job`
**Purpose:** Deep dive into a Job — spec, completion state, failed count, backoff limit, events, parent CronJob and child Pods.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Job name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "batch", "name": "nightly-report-28497520" }
```


**User asks:**
- "Did the nightly-report job complete successfully?"
- "Why is the data-migration job failing — how many retries has it done?"
- "Show me the logs from the failed job pod"

**AI processes:** The LLM identifies a batch-job outcome question and calls `inspect_job` to get completion state, failed count, backoff limit, and parent CronJob. It then cross-references with `get_pod_logs` on the failed pod for the actual error.

**Test coverage:** Contract + `TestAnalyzeJobHealth_FailedJob`
---

### `inspect_cronjob`
**Purpose:** Deep dive into a CronJob — schedule, suspend flag, last run, events, child Jobs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | CronJob name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "batch", "name": "nightly-report" }
```


**User asks:**
- "When did the backup CronJob last run and did it succeed?"
- "Is the nightly-cleanup CronJob suspended?"
- "What's the schedule for the weekly-report job?"

**AI processes:** CronJob questions combine schedule inspection with last-run outcomes. `inspect_cronjob` returns the cron schedule, last successful time, active jobs, and suspension state — letting the LLM explain missed runs or scheduling drift.

**Test coverage:** Contract + `TestAnalyzeCronJobHealth_Suspended`
---

### `inspect_node`
**Purpose:** Deep dive into a Node — capacity, taints, conditions (Ready/MemoryPressure/DiskPressure), events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Node name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "ip-10-0-1-42.us-east-1.compute.internal" }
```


**User asks:**
- "Show me the capacity and conditions of worker-node-42"
- "Is worker-node-42 under memory pressure?"
- "How many pods are currently scheduled on this node?"

**AI processes:** Node-level capacity questions require direct node inspection. `inspect_node` returns allocatable resources, taints, conditions (MemoryPressure, DiskPressure, Ready), and running pod count — giving the LLM the data to explain scheduling failures or resource contention.

**Test coverage:** `TestHandleNodeDetailed_FullResponse`
---

### `inspect_namespace`
**Purpose:** Deep dive into a Namespace — metadata, phase, pod count, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Namespace name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "production" }
```


**User asks:**
- "What resource quotas are set on the production namespace?"
- "How close is the staging namespace to hitting its CPU quota?"
- "Show me the LimitRange defaults in the payments namespace?"

**AI processes:** Namespace quota questions affect all workloads in that namespace. `inspect_namespace` returns ResourceQuota usage, LimitRange defaults, and labels/annotations — letting the LLM explain why new pods are rejected or why a namespace looks different from others.

**Test coverage:** Contract + registration
---

### `inspect_service`
**Purpose:** Deep dive into a Service — type, ports, selector, endpoints, pods selected, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Service name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api-svc" }
```


**User asks:**
- "Show me the endpoints behind the checkout-service"
- "What's the ClusterIP and selector for the auth Service?"
- "Why does this LoadBalancer Service have no external IP?"

**AI processes:** Service connectivity questions require both spec and live endpoint state. `inspect_service` returns type, selector, ports, ClusterIP, and associated Endpoints — letting the LLM explain why traffic isn't reaching pods.

**Test coverage:** `TestHandleServiceDetailed_ClusterIP`
---

### `inspect_ingress`
**Purpose:** Deep dive into an Ingress — rules, TLS, ingressClassName, backend services, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Ingress name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-gateway" }
```


**User asks:**
- "Show me the routing rules for the api-gateway Ingress"
- "What TLS cert is the payments Ingress using?"
- "Why is my Ingress returning 404 for /checkout?"

**AI processes:** Ingress routing questions need spec + backend service state. `inspect_ingress` returns host rules, path mappings, TLS config, and controller annotations — giving the LLM the routing table to explain why a specific path is failing.

**Test coverage:** Contract + `TestAnalyzeIngressHealth_NoBackend`
---

### `inspect_networkpolicy`
**Purpose:** Deep dive into a NetworkPolicy — podSelector, policyTypes, ingress/egress rules, pods selected, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | NetworkPolicy name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "deny-all-ingress" }
```


**User asks:**
- "What traffic does the payment-isolation NetworkPolicy allow?"
- "Is there a NetworkPolicy blocking ingress to the database namespace?"
- "Show me all the egress rules for the checkout pod NetworkPolicy"

**AI processes:** Network policy debugging requires parsing complex rule sets. `inspect_networkpolicy` returns ingress/egress rules, pod selectors, and namespace selectors in a structured format — letting the LLM trace whether a specific source → destination path is permitted.

**Test coverage:** Contract + `TestDiagnoseNetworkPolicyBlocking_DefaultDeny`
---

### `inspect_pvc`
**Purpose:** Deep dive into a PVC — accessModes, storage, storageClassName, phase, bound volume, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | PVC name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "database", "name": "data-postgres-primary-0" }
```


**User asks:**
- "Why is the postgres PVC still in Pending state?"
- "How much of the data-volume PVC is used?"
- "What StorageClass is backing the kafka-data PVC?"

**AI processes:** PVC state questions often reveal storage provisioning failures. `inspect_pvc` returns phase, capacity, access modes, StorageClass, and events — letting the LLM explain why provisioning failed or which node the volume is bound to.

**Test coverage:** Contract + `TestDiagnosePVCPending_NoStorageClass`
---

### `inspect_pv`
**Purpose:** Deep dive into a PersistentVolume — capacity, accessModes, reclaimPolicy, claimRef, status, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | PV name (cluster-scoped) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "pvc-a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
```


**User asks:**
- "Show me the details of the pv-data-postgres-0 PersistentVolume"
- "What reclaim policy does this PV have?"
- "Why is this PV still in Released state after the PVC was deleted?"

**AI processes:** `inspect_pv` returns the PersistentVolume spec including reclaim policy, access modes, capacity, and claim reference — letting the LLM explain why a PV is stuck in Released instead of Available.

**Test coverage:** Contract + registration
---

### `inspect_storageclass`
**Purpose:** Deep dive into a StorageClass — provisioner, parameters, volumeBindingMode, PV count, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | StorageClass name (cluster-scoped) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "gp3-encrypted" }
```


**User asks:**
- "What provisioner is the gp2-encrypted StorageClass using?"
- "Is the fast-ssd StorageClass set to immediate or WaitForFirstConsumer binding?"
- "Show me the parameters of the default StorageClass"

**AI processes:** StorageClass configuration determines PVC provisioning behaviour. `inspect_storageclass` returns provisioner, parameters, binding mode, and whether it's the cluster default — letting the LLM explain PVC scheduling issues caused by binding mode mismatches.

**Test coverage:** Contract + registration
---

### `inspect_configmap`
**Purpose:** Deep dive into a ConfigMap — metadata, data keys, consumers, events. Data values are not returned to protect sensitive configs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | ConfigMap name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "app-config" }
```


**User asks:**
- "Show me the contents of the app-config ConfigMap in production"
- "What database host is configured in the feature-flags ConfigMap?"
- "Which ConfigMaps are mounted into the payment-api pods?"

**AI processes:** `inspect_configmap` returns the full ConfigMap data (key-value pairs) and metadata. The LLM uses it to verify configuration values, explain misconfigurations, or check whether a config change was actually applied.

**Test coverage:** `TestPrivacy_ConfigMap_DataValuesNeverLeak`, `TestSummarizeItem_ConfigMap_Active`
---

### `inspect_secret`
**Purpose:** Deep dive into a Secret — metadata, type, data keys (values always redacted), TLS info, events. Never returns secret values.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Secret name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "db-credentials" }
```


**User asks:**
- "Does the tls-cert Secret exist in the payments namespace?"
- "What type is the docker-registry Secret and which keys does it have?"
- "Which Secrets are referenced by the payment-api pod?"

**AI processes:** `inspect_secret` returns Secret metadata and key names — never values. The LLM uses it to verify a Secret exists, has the right type, and contains the expected keys without ever exposing sensitive data.

**Test coverage:** `TestPrivacy_Secret_DataValuesNeverLeak`, `TestSummarizeItem_Secret_Active`
---

### `inspect_role`
**Purpose:** Deep dive into a Role — rules, referencing RoleBindings, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Role name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "pod-reader" }
```


**User asks:**
- "What can the payment-reader Role do in the production namespace?"
- "Show me all the verbs the ci-deployer Role has on Deployments"
- "Does the auditor Role have read access to Secrets?"

**AI processes:** `inspect_role` returns the full rules list (apiGroups, resources, verbs) for a namespace-scoped Role. The LLM parses it to answer RBAC permission questions without the user needing to understand policy syntax.

**Test coverage:** Contract + `TestSummarizeItem_Role_Active`
---

### `inspect_rolebinding`
**Purpose:** Deep dive into a RoleBinding — roleRef, subjects, resolved Role summary, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | RoleBinding name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "pod-reader-binding" }
```


**User asks:**
- "Who is bound to the payment-reader Role?"
- "What subjects are in the ci-deployer RoleBinding?"
- "Does the jenkins ServiceAccount have the deploy Role?"

**AI processes:** `inspect_rolebinding` returns subjects (users, groups, ServiceAccounts) and the referenced Role. The LLM uses it to answer 'who has permission X' or 'does this ServiceAccount have this role'.

**Test coverage:** Contract + registration
---

### `inspect_clusterrole`
**Purpose:** Deep dive into a ClusterRole — rules, referencing ClusterRoleBindings, events. Cluster-scoped.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | ClusterRole name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "system:node" }
```


**User asks:**
- "What does the cluster-admin ClusterRole allow?"
- "What resources can the monitoring-reader ClusterRole access cluster-wide?"
- "Show me the rules for the system:node ClusterRole"

**AI processes:** `inspect_clusterrole` returns the rules for a cluster-scoped Role. The LLM uses it to explain what permissions a service or operator has across all namespaces — critical for RBAC audit questions.

**Test coverage:** Contract + registration
---

### `inspect_clusterrolebinding`
**Purpose:** Deep dive into a ClusterRoleBinding — roleRef, subjects, resolved ClusterRole, events. Cluster-scoped.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | ClusterRoleBinding name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "cluster-admin-binding" }
```


**User asks:**
- "Which ServiceAccounts are bound to cluster-admin?"
- "What subjects have the node-reader ClusterRole cluster-wide?"
- "Is the metrics-server ServiceAccount bound to a ClusterRole?"

**AI processes:** `inspect_clusterrolebinding` returns all subjects with a cluster-wide role. The LLM uses it to audit over-privileged bindings and answer 'who has cluster-wide access to X' questions.

**Test coverage:** Contract + registration
---

### `inspect_hpa`
**Purpose:** Deep dive into an HPA — minReplicas, maxReplicas, scaleTargetRef, current/desired replicas, conditions, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | HPA name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-hpa" }
```


**User asks:**
- "Why isn't my HPA scaling up even though CPU is high?"
- "What metrics is the payment-api HPA tracking?"
- "What are the min/max replica bounds on the checkout HPA?"

**AI processes:** `inspect_hpa` returns target metrics, current/desired replica counts, conditions, and last scale time. The LLM cross-references with `analyze_hpa_behavior` to explain why scaling is or isn't happening.

**Test coverage:** Contract + `TestDiagnoseHPANotScaling_MinEqualsMax`
---

### `inspect_pdb`
**Purpose:** Deep dive into a PodDisruptionBudget — minAvailable/maxUnavailable, selector, currentHealthy, disruptionsAllowed, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | PDB name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-pdb" }
```


**User asks:**
- "Will this PodDisruptionBudget block my node drain?"
- "What's the minAvailable setting on the checkout PDB?"
- "How many pods does the payment-api PDB currently allow to be disrupted?"

**AI processes:** `inspect_pdb` returns min/max available settings, disruptions allowed, and current healthy pod count. The LLM uses it to explain why a drain or rolling update is blocked by the disruption budget.

**Test coverage:** Contract + registration
---

### `inspect_vpa`
**Purpose:** Deep dive into a VerticalPodAutoscaler — targetRef, updatePolicy, resource recommendations, events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | VPA name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-vpa" }
```


**User asks:**
- "What CPU/memory recommendations is the VPA making for payment-api?"
- "Is the VerticalPodAutoscaler in Auto mode or just recommendation mode?"
- "Show me the VPA bounds for the database pods"

**AI processes:** `inspect_vpa` returns the VPA update policy, resource recommendations (target, lower bound, upper bound), and the target workload. The LLM uses it to advise on right-sizing decisions.

**Test coverage:** Contract + registration
---

### `inspect_limitrange`
**Purpose:** Deep dive into a LimitRange — limits (type, default, defaultRequest, max, min), events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | LimitRange name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "default-limits" }
```


**User asks:**
- "What are the default CPU and memory limits in the production namespace?"
- "Why are my pods getting a default 100m CPU limit I didn't set?"
- "What's the max memory a single container can request in staging?"

**AI processes:** `inspect_limitrange` returns default requests/limits, max constraints, and the resource types it covers. The LLM explains why pods are getting unexpected limits or why a pod spec was rejected.

**Test coverage:** Contract + registration
---

### `inspect_resourcequota`
**Purpose:** Deep dive into a ResourceQuota — hard limits and current usage (CPU, memory, pods, services, etc.), events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | ResourceQuota name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "compute-quota" }
```


**User asks:**
- "How close is the production namespace to its CPU quota?"
- "How many more pods can I deploy before hitting the quota?"
- "Why did my pod get a 'exceeded quota' error?"

**AI processes:** `inspect_resourcequota` returns hard limits and current usage for CPU, memory, pod count, and PVC counts. The LLM calculates remaining capacity and explains which specific quota is blocking a deployment.

**Test coverage:** Contract + registration
---

### `inspect_crd`
**Purpose:** Deep dive into a CustomResourceDefinition — group, names, scope, versions, validation schema, instance count.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | CRD name e.g. `certificates.cert-manager.io` |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "certificates.cert-manager.io" }
```


**User asks:**
- "What fields does the Certificate CRD from cert-manager accept?"
- "Is the externaldns.k8s.io CRD installed in this cluster?"
- "Show me the spec schema for the ServiceMonitor CRD"

**AI processes:** `inspect_crd` returns the CRD's group, version, scope, and OpenAPI schema. The LLM uses it to explain custom resource structure and help users write valid custom resource manifests.

**Test coverage:** `TestHandleCRDDetailed`
---

### `list_problems`
**Purpose:** Find BROKEN or UNHEALTHY pods only. Use for incident triage, not general pod listing. Returns pods in the specified problem state.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `filter` | string | Yes | One of: `crashlooping`, `oom`, `pending`, `evicted`, `image_pull_error`, `unhealthy` |
| `namespace` | string | No | Namespace scope (all if omitted) |
| `since` | string | No | Go duration e.g. `15m`, `1h` |
| `limit` | integer | No | Max results (default 50, max 200) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "filter": "crashlooping", "namespace": "production", "since": "30m" }
```


**User asks:**
- "What's currently broken in the production namespace?"
- "Give me all pods that are not Running or Completed"
- "List everything unhealthy across the whole cluster"

**AI processes:** `list_problems` scans for pods in non-Running/Completed states, nodes with conditions, and recent Warning events — returning a prioritised problem list. The LLM uses it as the starting point for any incident investigation before drilling into specific resources.

**Test coverage:** `TestHandleListProblems_CompileGuard`, `TestHandleListProblems_UnknownFilter`
---

### `search_logs`
**Purpose:** Pattern-clustered log search across pods in a namespace. Returns grouped error templates with counts — not raw log dumps.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `regex` | string | Yes | Pattern to search for e.g. `"error\|panic\|FATAL"` |
| `workload` | string | No | Filter to a specific workload name |
| `since` | string | No | Go duration |
| `max_pods` | integer | No | Pod cap (default 10) |
| `max_lines_per_pod` | integer | No | Line cap (default 1000) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "regex": "connection refused|timeout", "since": "1h" }
```


**User asks:**
- "Find all pods that logged 'connection refused' in the last hour"
- "Which services are logging Java OOM errors right now?"
- "Search for 'FATAL' across the production namespace logs"

**AI processes:** `search_logs` streams log lines matching a pattern across pods in a namespace. The LLM uses it when the user knows what error to look for but not which pod it's coming from — turning a vague 'something is logging errors' into a specific pod + error message.

**Test coverage:** `TestHandleSearchLogs_CompileGuard`, `TestHandleSearchLogs_RequiresNamespaceAndRegex`, `TestHandleSearchLogsValidation`
---

### `export_topology_to_drawio`
**Purpose:** Export cluster topology as an editable draw.io diagram. Returns a URL that opens the architecture diagram.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID |
| `namespace` | string | No | Scope to namespace (all if omitted) |

**Example:**
```json
{ "cluster_id": "prod-us-east-1", "namespace": "production" }
```


**User asks:**
- "Generate a topology diagram of the production namespace"
- "Export the cluster architecture to Draw.io format"
- "Create a visual map of all service dependencies"

**AI processes:** `export_topology_to_drawio` generates a Draw.io XML document mapping services, deployments, ingresses, and their relationships. The LLM calls it when the user wants a visual architecture artifact rather than a text description.

**Test coverage:** `TestHandleExportTopologyToDrawio_MermaidFallback`
---

### `observe_pod_metrics`
**Purpose:** Live CPU/memory usage for a pod or namespace aggregate from the metrics server.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | No | Pod name (aggregate if omitted) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-6d8f9b-xk2j" }
```


**User asks:**
- "What's the current CPU and memory usage of payment-api?"
- "Is the auth-service pod using more memory than its limit?"
- "Show me live resource consumption for the checkout pod"

**AI processes:** `observe_pod_metrics` fetches real-time CPU and memory usage from the Metrics API. The LLM pairs it with `check_resource_limits` to explain how close a pod is to its limits and whether an OOMKill is imminent.

**Test coverage:** `TestObservePodMetrics_SinglePod`, `TestObservePodMetrics_FallbackWhenUnavailable`
---

### `observe_node_metrics`
**Purpose:** Live CPU/memory/disk metrics for one or all nodes.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | No | Node name (all nodes if omitted) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "ip-10-0-1-42.us-east-1.compute.internal" }
```


**User asks:**
- "Which nodes are under the most CPU pressure right now?"
- "Show me memory utilisation across all worker nodes"
- "Is worker-node-42 resource-saturated?"

**AI processes:** `observe_node_metrics` returns per-node CPU and memory consumption. The LLM uses it to identify hot nodes during capacity or scheduling investigations, and correlates with pod placement from `inspect_node`.

**Test coverage:** `TestHandleMetrics_NodeScope`
---

### `observe_top_pods_by_metric`
**Purpose:** Top-N pods sorted by CPU or memory usage. Use for identifying resource hogs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `metric` | string | Yes | One of: `cpu`, `memory` |
| `namespace` | string | No | Namespace scope |
| `limit` | integer | No | Top N results (default 10) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "metric": "memory", "namespace": "production", "limit": 5 }
```


**User asks:**
- "Which pods are consuming the most memory right now?"
- "Show me the top 10 CPU consumers in production"
- "What's burning the most compute in the cluster?"

**AI processes:** `observe_top_pods_by_metric` ranks pods by CPU or memory consumption. The LLM uses it to quickly identify noisy neighbours or runaway processes without the user needing to know which pod to look at.

**Test coverage:** `TestObserveTopPodsByMetric_SortsByCPU`, `TestObserveTopPodsByMetric_InvalidType`, `TestObserveTopPodsByMetric_EmptyFallback`
---

### `observe_services_by_filter`
**Purpose:** Find services with health issues — no endpoints, flapping, or other anomalies.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `flapping` | boolean | No | Return services with churning endpoints |
| `no_endpoints` | boolean | No | Return services with zero endpoints |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "no_endpoints": true, "namespace": "production" }
```


**User asks:**
- "List all Services of type LoadBalancer"
- "Which Services have no selector (headless)?"
- "Find all ClusterIP Services in the payments namespace"

**AI processes:** `observe_services_by_filter` filters the service inventory by type, selector state, or namespace. The LLM uses it for inventory questions and as a precursor to network connectivity analysis.

**Test coverage:** `TestServicesByFilter_NoEndpoints`, `TestServicesByFilter_EmptyResults_HasExplanatoryMessage`, `TestServicesByFilter_ImpliedFiltersWhenNoneGiven`
---

### `observe_secrets_usage`
**Purpose:** Every Secret with a reference graph showing which pods mount it, reference it as env vars, or leave it unused.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Which Secrets are currently mounted into running pods?"
- "Are there Secrets in production that no pod is using?"
- "Show me all pods referencing the tls-cert Secret"

**AI processes:** `observe_secrets_usage` cross-references Secret names with pod volume mounts and env references. The LLM uses it to identify unused Secrets during cleanup audits or to verify a Secret rotation was picked up.

**Test coverage:** `TestSecretsUsage_MarksUnused`, `TestSecretsUsage_CatchesTrulyUnused`, `TestPrivacy_Secret_DataValuesNeverLeak`
---

### `observe_ingresses_by_tls_expiry`
**Purpose:** Ingresses whose TLS certificates expire within N days. Use for proactive cert rotation alerting.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `days` | integer | No | Expiry window in days (default 30) |
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "days": 14, "namespace": "production" }
```


**User asks:**
- "Which TLS certificates are expiring in the next 30 days?"
- "Are any of my Ingress TLS certs already expired?"
- "Show me all Ingresses sorted by certificate expiry date"

**AI processes:** `observe_ingresses_by_tls_expiry` inspects TLS secrets referenced by Ingresses and calculates days-to-expiry. The LLM uses it to produce a certificate renewal priority list before outages occur.

**Test coverage:** `TestIngressesByTLSExpiry_FlagsExpiring`, `TestIngressesByTLSExpiry_UnavailableFallback`
---

### `observe_recent_changes`
**Purpose:** All meaningful changes in a time window — rollouts, pod create/delete, config updates. Use for "what changed recently?" questions.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `since` | string | No | Go duration (default `15m`) |
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "since": "1h", "namespace": "production" }
```


**User asks:**
- "What changed in the cluster in the last 2 hours?"
- "Show me all resource changes since the last deployment"
- "What was modified in production since midnight?"

**AI processes:** `observe_recent_changes` queries cluster events and resource metadata to surface recent creations, updates, and deletions. The LLM uses it as the first step in 'what changed before things broke' investigations.

**Test coverage:** `TestRecentChanges_FiltersByWindow`, `TestRecentChanges_EmptyWindow`
---

### `observe_flapping_services`
**Purpose:** Services whose endpoint set changed more than a threshold number of times, indicating instability.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `threshold` | integer | No | Churn count threshold (default 3) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "threshold": 5 }
```


**User asks:**
- "Which Services keep losing and regaining endpoints?"
- "Are there any flapping backends behind my load balancer?"
- "Why do I keep seeing intermittent connection errors to checkout?"

**AI processes:** `observe_flapping_services` detects Services whose endpoint counts oscillate over time. The LLM uses it to identify instability that manifests as intermittent errors rather than hard failures.

**Test coverage:** `TestObserveFlappingServices_CountsChurn`
---

### `observe_noisy_neighbors`
**Purpose:** Pods using more than a CPU or memory threshold of their node's total capacity. Identifies resource hogs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cpu_threshold` | number | No | Fraction of node CPU (default 0.5) |
| `memory_threshold` | number | No | Fraction of node memory (default 0.5) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cpu_threshold": 0.7, "namespace": "production" }
```


**User asks:**
- "Which pods are consuming disproportionate resources on shared nodes?"
- "Is there a noisy neighbour starving my payment pods?"
- "Show me resource contention on the nodes hosting production workloads"

**AI processes:** `observe_noisy_neighbors` correlates pod resource usage with node allocatable capacity to identify pods consuming more than their fair share. The LLM uses it to explain latency spikes caused by co-location.

**Test coverage:** `TestObserveNoisyNeighbors_ThresholdFilter`, `TestObserveNoisyNeighbors_MetricsMissing_GracefulNote`
---

### `observe_unhealthy_probes`
**Purpose:** Pods with unhealthy liveness or readiness probe events in the event stream.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Which pods have failing liveness or readiness probes?"
- "Why does Kubernetes keep restarting my payment-api pods?"
- "Show me all probe failures in the last 30 minutes"

**AI processes:** `observe_unhealthy_probes` surfaces pods with repeated probe failures and their probe configurations. The LLM pairs the probe config with failure counts to explain whether the probe thresholds are too tight or the application is genuinely unhealthy.

**Test coverage:** `TestObserveUnhealthyProbes_FiltersByReason`
---

### `observe_missing_probes`
**Purpose:** Workloads (Deployments, StatefulSets, DaemonSets) without liveness OR readiness probes.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Which of my pods don't have liveness probes configured?"
- "Show me all Deployments missing readiness probes"
- "Are there production workloads without health checks?"

**AI processes:** `observe_missing_probes` scans pod specs for absent liveness/readiness probes. The LLM uses it during health hardening reviews and explains the operational risk of running without probes.

**Test coverage:** `TestObserveMissingProbes_FlagsContainer`
---

### `observe_stuck_rollouts`
**Purpose:** Deployments with a stalled Progressing condition where ready replicas is less than desired.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `threshold` | string | No | Stuck duration (default `5m`) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "threshold": "10m" }
```


**User asks:**
- "Why is my Deployment still showing 'Progressing' after 10 minutes?"
- "Which rollouts are currently stuck or stalled?"
- "Is the payment-api rollout paused or blocked?"

**AI processes:** `observe_stuck_rollouts` finds Deployments where the rollout is not completing within the progress deadline. The LLM explains whether it's a pod scheduling issue, a failing probe, or a resource quota block.

**Test coverage:** `TestObserveStuckRollouts_TransitionOlderThanCutoff`
---

### `observe_high_cardinality_labels`
**Purpose:** Label keys exceeding a cardinality threshold — a common cause of Prometheus performance issues.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `threshold` | integer | No | Unique value count (default 100) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "threshold": 50 }
```


**User asks:**
- "Are there any labels causing Prometheus cardinality explosions?"
- "Which Kubernetes labels have thousands of unique values?"
- "Show me labels that could be hurting metrics performance"

**AI processes:** `observe_high_cardinality_labels` scans resource labels for high unique-value cardinality. The LLM uses it during observability health reviews and recommends which labels to remove from pod specs.

**Test coverage:** `TestObserveHighCardinalityLabels_GracefulDegrade`
---

### `observe_restart_storms`
**Purpose:** Containers with restart count above a threshold — identifies crashlooping or flapping pods.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `threshold` | integer | No | Restart count (default 5) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "threshold": 10, "namespace": "production" }
```


**User asks:**
- "Which pods have restarted more than 10 times today?"
- "Show me pods in a restart loop right now"
- "Are there CrashLoopBackOff pods in production?"

**AI processes:** `observe_restart_storms` returns pods with high restart counts and their last exit codes. The LLM pairs this with `get_pod_logs` on the most recent crash to identify the root cause of the restart loop.

**Test coverage:** `TestObserveRestartStorms_FlagsAboveThreshold`
---

### `observe_pending_scheduler_events`
**Purpose:** Pending pods with FailedScheduling events. Shows why pods cannot be placed on nodes.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Why are new pods stuck in Pending state?"
- "Is the scheduler failing to place pods anywhere?"
- "What's blocking pod scheduling in the production namespace?"

**AI processes:** `observe_pending_scheduler_events` surfaces scheduler events for Pending pods including the reason (InsufficientMemory, Unschedulable, taints). The LLM uses it to explain exactly why pods can't be placed.

**Test coverage:** `TestObservePendingSchedulerEvents_FilterByReason`
---

### `observe_zombie_finalizers`
**Purpose:** Resources stuck in Terminating state for longer than a threshold — indicates finalizer deadlocks.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `threshold` | string | No | Stuck duration (default `5m`) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "threshold": "15m", "namespace": "production" }
```


**User asks:**
- "Why is this namespace stuck in Terminating state?"
- "There are resources that won't delete — what's holding them?"
- "Show me all objects with stuck finalizers"

**AI processes:** `observe_zombie_finalizers` finds resources stuck in Terminating due to pending finalizers. The LLM explains which controller owns the finalizer and why it hasn't run — common in operator or webhook outages.

**Test coverage:** `TestObserveZombieFinalizers_DeletionOlderThanCutoff`
---

### `observe_orphaned_pods`
**Purpose:** Pods whose ownerReference points to a non-existent ReplicaSet or Job — leaked pods that consume resources.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Are there pods running with no parent Deployment or StatefulSet?"
- "Show me pods that were created manually and have no owner"
- "Which pods will survive if I delete their Deployment?"

**AI processes:** `observe_orphaned_pods` finds pods lacking an ownerReference. The LLM uses it during cluster hygiene reviews to identify pods that bypass deployment lifecycle controls.

**Test coverage:** `TestObserveOrphanedPods_OwnerMissing`
---

## Analysis (41 tools)

*Read-only with AI-synthesised insights. Autonomy level 1–2.*

---

### `analyze_pod_health`
**Purpose:** Deep health analysis of a pod — OOMKills, restart loops, eviction patterns, stuck-pending root causes.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Pod name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-6d8f9b-xk2j" }
```


**User asks:**
- "Why is the payment-api pod not healthy?"
- "Score the health of all pods in production and tell me what's at risk"
- "What's wrong with this pod — give me a full diagnosis"

**AI processes:** `analyze_pod_health` goes beyond raw state — it scores the pod across restarts, probe results, resource pressure, and event history. The LLM uses the score and signals to produce a ranked explanation of what is wrong and how serious it is.

**Test coverage:** Contract + functional
---

### `analyze_deployment_health`
**Purpose:** Deployment health analysis — rollout stalls, replica availability gaps, image drift between ReplicaSets.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api" }
```


**User asks:**
- "Is the checkout Deployment healthy right now?"
- "Why does the payment-api Deployment show degraded replicas?"
- "Score the health of all Deployments in production"

**AI processes:** `analyze_deployment_health` combines replica readiness, rollout progress, pod health scores, and event history into a composite health score. The LLM uses it to give an authoritative 'is this deployment healthy' answer rather than just reporting raw replica counts.

**Test coverage:** Contract + functional
---

### `analyze_replicaset_health`
**Purpose:** ReplicaSet health — desired vs available replicas, failed pod conditions.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | ReplicaSet name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api-7d9c8b" }
```


**User asks:**
- "Why does this ReplicaSet have fewer ready replicas than desired?"
- "Is the payment-api-7d9c8b ReplicaSet healthy?"
- "Show me the health status of all ReplicaSets in production"

**AI processes:** `analyze_replicaset_health` evaluates replica availability, pod states, and owner Deployment. The LLM uses it when investigating why a rollout left behind a previous RS that is still shedding traffic.

**Test coverage:** `TestAnalyzeReplicaSetHealth_OrphanedRS`
---

### `analyze_statefulset_health`
**Purpose:** StatefulSet health — ordinal readiness, volume provisioning issues, update strategy problems.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | StatefulSet name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "database", "name": "postgres-primary" }
```


**User asks:**
- "Is the Kafka StatefulSet fully operational?"
- "Why is only 2 of 3 postgres replicas ready?"
- "Health check the Redis StatefulSet — are all shards up?"

**AI processes:** `analyze_statefulset_health` checks ordinal readiness, update progress, and persistent volume bindings for each replica. The LLM uses it to explain which specific ordinal is degraded and whether data availability is at risk.

**Test coverage:** `TestAnalyzeStatefulSetHealth_DegradedReplicas`
---

### `analyze_daemonset_health`
**Purpose:** DaemonSet health — node coverage gaps, scheduling failures, rolling update progress.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | DaemonSet name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "monitoring", "name": "node-exporter" }
```


**User asks:**
- "Are all nodes running the logging DaemonSet?"
- "Why is the node-exporter DaemonSet missing on 5 nodes?"
- "Health score the fluentd DaemonSet across the cluster"

**AI processes:** `analyze_daemonset_health` checks desired vs. ready vs. available counts and identifies which nodes are missing the DaemonSet pod and why (tolerations, node selectors). The LLM translates this into an actionable explanation.

**Test coverage:** `TestAnalyzeDaemonSetHealth_DegradedCount`
---

### `analyze_job_health`
**Purpose:** Job health — completion status, failed count vs backoffLimit, duration analysis.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Job name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "batch", "name": "nightly-report-28497520" }
```


**User asks:**
- "Did the data-import Job succeed?"
- "Why has this Job exceeded its backoff limit?"
- "How long did the last backup Job take to complete?"

**AI processes:** `analyze_job_health` evaluates completion state, failure count against backoff limit, and duration. The LLM uses it to give a definitive success/failure verdict and explain what caused repeated failures.

**Test coverage:** `TestAnalyzeJobHealth_FailedJob`
---

### `analyze_cronjob_health`
**Purpose:** CronJob health — suspended state, last schedule time, failed child job patterns.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | CronJob name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "batch", "name": "nightly-report" }
```


**User asks:**
- "Is the nightly-backup CronJob running on schedule?"
- "Why did the weekly-report CronJob miss the last 3 runs?"
- "Is the cleanup CronJob producing failed jobs that are piling up?"

**AI processes:** `analyze_cronjob_health` checks schedule adherence, last-success time, active job count, and accumulated failed jobs. The LLM identifies whether misses are caused by concurrency policy, suspension, or underlying job failures.

**Test coverage:** `TestAnalyzeCronJobHealth_Suspended`
---

### `analyze_node_pressure`
**Purpose:** Node pressure analysis — MemoryPressure, DiskPressure, PIDPressure conditions and their causes.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | No | Node name (all nodes if omitted) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "ip-10-0-1-42.us-east-1.compute.internal" }
```


**User asks:**
- "Which nodes are close to running out of memory?"
- "Is worker-node-42 under disk pressure?"
- "Tell me about resource pressure across the cluster"

**AI processes:** `analyze_node_pressure` evaluates NodeConditions (MemoryPressure, DiskPressure, PIDPressure) combined with actual allocatable vs. requested resource ratios. The LLM uses it to predict which nodes will trigger evictions before it happens.

**Test coverage:** Contract + functional
---

### `detect_resource_contention`
**Purpose:** CPU throttling risk and memory overcommit detection across workloads.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Are pods fighting over CPU on shared nodes?"
- "Is there memory contention causing throttling in production?"
- "Which workloads are competing for the same resources?"

**AI processes:** `detect_resource_contention` identifies nodes where aggregate pod requests approach or exceed allocatable capacity, producing a contention heatmap. The LLM uses it to explain latency spikes that correlate with co-located workloads.

**Test coverage:** Contract + functional
---

### `analyze_service_health`
**Purpose:** Service health — endpoint readiness, orphan services with no pods, exposure risk assessment.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Service name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api-svc" }
```


**User asks:**
- "Is the checkout Service reachable from within the cluster?"
- "Why is checkout returning 502s to the ingress?"
- "Score the health of all Services in production"

**AI processes:** `analyze_service_health` checks endpoint availability, selector match against running pods, and recent endpoint churn. The LLM uses it to diagnose broken service-to-pod wiring before investigating network policy.

**Test coverage:** `TestAnalyzeServiceHealth_NoEndpoints`
---

### `analyze_ingress_health`
**Purpose:** Ingress health — backend services exist, no empty rules, TLS validity.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Ingress name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-gateway" }
```


**User asks:**
- "Why is my Ingress returning 502 for the /api path?"
- "Is the payments Ingress correctly routing to the backend Service?"
- "Health check all Ingresses — any misconfigurations?"

**AI processes:** `analyze_ingress_health` validates backend Service existence, endpoint readiness, TLS Secret presence, and annotation correctness. The LLM traces the full Ingress → Service → Endpoint → Pod path.

**Test coverage:** `TestAnalyzeIngressHealth_NoBackend`
---

### `analyze_network_connectivity`
**Purpose:** Network connectivity analysis — endpoint readiness, NetworkPolicy coverage, DNS issues.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Can the frontend Service reach the backend Service?"
- "Is there a NetworkPolicy blocking traffic from checkout to payment?"
- "Why can't my pod reach the database Service?"

**AI processes:** `analyze_network_connectivity` traces the connectivity path between two services, evaluating NetworkPolicy rules, DNS resolution, and endpoint availability. The LLM produces a hop-by-hop explanation of where traffic is blocked.

**Test coverage:** Contract + functional
---

### `analyze_storage_health`
**Purpose:** Storage health — unbound PVCs, failed provisioning, storage class misconfiguration.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "database" }
```


**User asks:**
- "Are all my PVCs bound and healthy?"
- "Which PVCs are close to their storage capacity?"
- "Is there a storage issue causing StatefulSet degradation?"

**AI processes:** `analyze_storage_health` evaluates PVC phase, capacity usage, and StorageClass provisioner health. The LLM correlates storage state with StatefulSet pod failures to explain data-plane degradation.

**Test coverage:** `TestHandleStorageStatus`, `TestHandleStorageStatus_AggregatesResources`
---

### `check_resource_limits`
**Purpose:** Find containers missing CPU/memory limits or requests — a common cause of node pressure.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Which pods are running without CPU or memory limits?"
- "Show me pods that have no resource requests set"
- "Which workloads are at risk of OOMKill due to missing limits?"

**AI processes:** `check_resource_limits` scans pod specs for absent or mismatched requests/limits. The LLM uses it during reliability reviews and explains the operational risk of each missing configuration.

**Test coverage:** Contract + functional
---

### `analyze_rbac_permissions`
**Purpose:** RBAC analysis — detect over-privileged service accounts, wildcard permissions, cluster-admin bindings.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "What can the ci-deployer ServiceAccount do in production?"
- "Does the monitoring ServiceAccount have too many permissions?"
- "Audit the RBAC permissions for the payment-api ServiceAccount"

**AI processes:** `analyze_rbac_permissions` resolves all RoleBindings and ClusterRoleBindings for a subject and flattens them into an effective permission set. The LLM uses it to answer 'what can X do' and flag overly broad grants.

**Test coverage:** Contract + functional
---

### `analyze_hpa_behavior`
**Purpose:** HPA behavior analysis — flapping, scaling delays, min=max stuck scenarios, inactive HPAs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | HPA name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-hpa" }
```


**User asks:**
- "Why isn't my HPA scaling up during the load spike?"
- "The HPA keeps oscillating between 3 and 8 replicas — why?"
- "What's preventing the checkout HPA from reaching maxReplicas?"

**AI processes:** `analyze_hpa_behavior` evaluates metric values against thresholds, scale-up/down cooldowns, and replica bounds. The LLM identifies whether the HPA is blocked by cooldown, metric lag, PDB constraints, or a misconfigured threshold.

**Test coverage:** Contract + functional
---

### `analyze_log_patterns`
**Purpose:** Extract and classify error/warning patterns from pod logs using pattern clustering.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Pod name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-6d8f9b-xk2j" }
```


**User asks:**
- "What are the most common error patterns in production logs?"
- "Are errors in payment-api increasing in frequency?"
- "Summarise what the checkout service has been logging"

**AI processes:** `analyze_log_patterns` samples recent log lines, extracts error signatures, and counts their frequency. The LLM uses the pattern summary to explain whether errors are new, worsening, or stable.

**Test coverage:** Contract + functional
---

### `assess_security_posture`
**Purpose:** CIS Kubernetes Benchmark checks — hostNetwork, hostPID, privileged containers, runAsRoot.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Give me a security score for the production namespace"
- "What are the biggest security risks in my cluster right now?"
- "Run a security assessment — where are we most exposed?"

**AI processes:** `assess_security_posture` aggregates findings across privileged containers, RBAC wildcards, host path mounts, TLS expiry, and image tags into a weighted risk score. The LLM produces a prioritised remediation roadmap.

**Test coverage:** Contract + functional
---

### `detect_configuration_drift`
**Purpose:** Configuration drift — compares live state against desired specification to find unmanaged changes.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Have any Deployments drifted from their intended configuration?"
- "Is the staging cluster configuration in sync with production?"
- "Which pods are running with a different image than their Deployment spec?"

**AI processes:** `detect_configuration_drift` compares running pod specs against their owning Deployment/StatefulSet templates. The LLM explains which specific fields have drifted and what likely caused it.

**Test coverage:** Contract + functional
---

### `analyze_resource_efficiency`
**Purpose:** Resource requests vs actual usage with rightsizing recommendations. Returns a findings summary, not raw metrics.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "How efficiently are we using the cluster resources we're paying for?"
- "What percentage of our CPU and memory allocation is actually being used?"
- "Which Deployments are massively over-provisioned?"

**AI processes:** `analyze_resource_efficiency` computes requested vs. actual usage ratios per workload. The LLM surfaces the biggest waste opportunities and quantifies potential cost savings from right-sizing.

**Test coverage:** `TestAnalyzeResourceEfficiency_ReturnsFindingsNotRawData`, `TestHandleAnalyzeResourceEfficiency_ReturnsFindingsAndCount`
---

### `analyze_failure_patterns`
**Purpose:** Detect recurring failure patterns across pods, deployments, and nodes over time.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "What types of failures have we seen most in the last week?"
- "Are failures clustered on specific nodes or namespaces?"
- "Show me the recurring failure signatures in the cluster"

**AI processes:** `analyze_failure_patterns` aggregates Warning events, pod exits, and node conditions over time to identify systemic patterns. The LLM uses it to distinguish one-off incidents from structural reliability problems.

**Test coverage:** Contract + functional
---

### `analyze_dependencies`
**Purpose:** Map service dependencies and single points of failure across a namespace.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "What services depend on payment-api?"
- "If the database goes down, what else breaks?"
- "Show me the upstream and downstream dependencies of checkout-service"

**AI processes:** `analyze_dependencies` maps service-to-service dependencies using Kubernetes Service selectors, Ingress backends, and ConfigMap references. The LLM uses it to answer blast-radius questions and draw dependency graphs.

**Test coverage:** `TestSummarizeDependencies`
---

### `analyze_capacity_trends`
**Purpose:** Predict future capacity needs based on historical trends. Returns findings and projections.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```


**User asks:**
- "Are we going to run out of node capacity in the next 30 days?"
- "Show me CPU and memory growth trends across the cluster"
- "At current growth rate, when will we need more nodes?"

**AI processes:** `analyze_capacity_trends` projects current resource utilisation growth to estimate when capacity limits will be reached. The LLM translates the trend data into a plain-English runway estimate with a recommendation.

**Test coverage:** `TestAnalyzeCapacityTrends_ReturnsFindingsNotRawData`
---

### `analyze_performance_bottlenecks`
**Purpose:** Identify bottlenecks across compute, network, and storage using correlated signals.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "What's causing the latency spike in the checkout flow?"
- "Which component in the request path is the performance bottleneck?"
- "Is the slowness caused by CPU throttling or memory pressure?"

**AI processes:** `analyze_performance_bottlenecks` correlates CPU throttling events, memory limits, and pod metrics to identify the constraining resource. The LLM traces the bottleneck through the service dependency chain.

**Test coverage:** `TestAnalyzePerformanceBottlenecks_ReturnsFindingsNotRawData`
---

### `analyze_error_correlation`
**Purpose:** Correlate errors across logs, events, and metrics to find root causes.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Do the errors in payment-api correlate with errors in the database?"
- "Is there a common cause for failures in multiple services right now?"
- "Show me error spikes that happened at the same time across services"

**AI processes:** `analyze_error_correlation` compares error event timestamps across multiple services to find co-occurring failures. The LLM uses it to distinguish cascading failures (one root cause) from independent ones.

**Test coverage:** Contract + functional
---

### `analyze_blast_radius`
**Purpose:** Assess the potential impact of changes or failures — resource, namespace, or cluster scope. Returns what would break if this resource failed.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `scope` | string | Yes | One of: `resource`, `namespace`, `cluster` |
| `kind` | string | Conditional | Required when scope=resource e.g. `Deployment` |
| `name` | string | Conditional | Required when scope=resource |
| `namespace` | string | No | Kubernetes namespace |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "scope": "resource", "kind": "Deployment", "name": "payment-api", "namespace": "production" }
```


**User asks:**
- "If payment-api goes down, what breaks?"
- "Show me the blast radius of losing worker-node-42"
- "What's the impact of deleting the auth-service right now?"

**AI processes:** `analyze_blast_radius` maps the dependency graph outward from a resource and estimates downstream impact by service criticality. The LLM uses Kubilitics' core blast-radius engine to produce a cascading failure narrative with affected services ranked by user impact.

**Test coverage:** `TestBlastRadius_ScopeResource_RequiresKindName`, `TestBlastRadius_ScopeNamespace_NoKindNeeded`, `TestBlastRadius_ScopeCluster_NoArgs`, `TestBlastRadius_InfersScope_WhenOmitted`, `TestBlastRadius_BackwardsCompat_KindAndName`, `TestHandleAnalyzeBlastRadius_ScopeResourceRequiresKindAndName`
---

### `analyze_rollout_risk`
**Purpose:** Assess risk of a planned deployment, update, or configuration change before applying.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api" }
```


**User asks:**
- "Is it safe to deploy payment-api v2.4.0 right now?"
- "What's the risk level of this Deployment change?"
- "Should I wait before rolling out during peak traffic hours?"

**AI processes:** `analyze_rollout_risk` evaluates replica count, PDB coverage, current cluster health, and time-of-day traffic patterns to produce a risk score. The LLM gives a go/no-go recommendation with specific conditions to watch during the rollout.

**Test coverage:** `TestHandleAnalyzeRolloutRisk_SingleDeployment`
---

### `analyze_pod_scheduling`
**Purpose:** Pod scheduling decisions — affinity rules, taint/toleration issues, placement optimization.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Pod name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-6d8f9b-xk2j" }
```


**User asks:**
- "Why can't my pod be scheduled anywhere?"
- "Show me which nodes are eligible for the checkout pod"
- "Are taints or affinity rules preventing scheduling?"

**AI processes:** `analyze_pod_scheduling` evaluates node selectors, affinity rules, tolerations, and available node capacity against the pod spec. The LLM explains exactly which constraint is preventing scheduling and which nodes would accept the pod if the constraint were relaxed.

**Test coverage:** Contract + functional
---

### `analyze_image_vulnerabilities`
**Purpose:** Scan container images for known CVEs using available cluster scanning data.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Which container images have known CVEs?"
- "Are any of our production images running with critical vulnerabilities?"
- "Show me all pods using images with high-severity security issues"

**AI processes:** `analyze_image_vulnerabilities` cross-references running image digests against vulnerability metadata. The LLM produces a prioritised remediation list sorted by severity and blast radius of affected workloads.

**Test coverage:** Contract + functional
---

### `analyze_workload_patterns`
**Purpose:** Identify traffic patterns, peak hours, and scaling opportunities from workload metrics.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "What are the traffic patterns for payment-api over the last 7 days?"
- "When is our cluster most heavily loaded?"
- "Should we configure time-based autoscaling for checkout?"

**AI processes:** `analyze_workload_patterns` analyses resource usage time-series to identify daily/weekly cycles. The LLM uses it to recommend scheduled scaling policies or optimal maintenance windows.

**Test coverage:** Contract + functional
---

### `who_can_do`
**Purpose:** Answer "who can `<verb>` `<resource>` in `<namespace>`?" in one call. Aggregates RBAC across all Roles, ClusterRoles, and their Bindings.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `verb` | string | Yes | RBAC verb e.g. `get`, `list`, `create`, `delete` |
| `resource` | string | Yes | Resource type e.g. `pods`, `secrets`, `deployments` |
| `namespace` | string | No | Namespace scope (cluster-wide if omitted) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "verb": "delete", "resource": "pods", "namespace": "production" }
```


**User asks:**
- "Who has permission to delete Secrets in production?"
- "Which ServiceAccounts can create or modify Deployments?"
- "Does anyone other than cluster-admins have exec access to pods?"

**AI processes:** `who_can_do` inverts the RBAC graph: given a verb + resource, it finds all subjects (users, groups, ServiceAccounts) that have that permission. The LLM uses it for 'who can do X' audits and least-privilege reviews.

**Test coverage:** `TestWhoCanDo_AggregatesMatchingRolesAndBindings`, `TestWhoCanDo_NoMatches`, `TestWhoCanDo_RequiresArgs`
---

### `narrate_incident_timeline`
**Purpose:** Produces a Slack-ready chronological incident summary from events, pod restarts, and log patterns in a time window.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `since` | string | No | Go duration (default `1h`) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "since": "2h" }
```


**User asks:**
- "Write up the timeline for the production incident that started at 2am"
- "Reconstruct what happened during today's checkout outage"
- "Give me an incident report I can share with the team"

**AI processes:** `narrate_incident_timeline` aggregates events, pod restarts, deployment changes, and node conditions around a time window into a chronological narrative. The LLM produces a ready-to-share incident timeline with root cause, impact, and remediation steps.

**Test coverage:** `TestNarrateIncidentTimeline_ReturnsHint`, `TestNarrate_DispatchRegistered`
---

### `narrate_deploy_diff`
**Purpose:** Plain-English explanation of what changed in the latest deployment and what impact to expect.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api" }
```


**User asks:**
- "What changed between the v2.3.0 and v2.3.1 deployments?"
- "Write a deploy diff summary for the payment-api release"
- "Explain what the last rollout actually changed"

**AI processes:** `narrate_deploy_diff` compares Deployment spec versions and pod template changes. The LLM produces a human-readable change summary explaining what was updated, why it might have caused an issue, and what to watch for in metrics.

**Test coverage:** `TestNarrate_DispatchRegistered`
---

### `narrate_weekly_status`
**Purpose:** Exec-friendly weekly cluster status — highlights, incidents, resource trends, upcoming risks.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```


**User asks:**
- "Write the weekly cluster status report for the SRE meeting"
- "Give me a summary of cluster health for the past 7 days"
- "Produce a standup briefing for the platform team"

**AI processes:** `narrate_weekly_status` aggregates incident count, availability metrics, deployment velocity, and top issues from the past week. The LLM produces a structured weekly narrative suitable for engineering leadership.

**Test coverage:** `TestNarrateWeeklyStatus_IncludesClusterData`
---

### `narrate_onboarding_for_user`
**Purpose:** ServiceAccount capabilities and RBAC scope in plain English — for onboarding engineers to a cluster.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `service_account` | string | No | ServiceAccount name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "service_account": "api-server" }
```


**User asks:**
- "Write an onboarding guide for a new engineer joining the platform team"
- "Explain our cluster setup to a developer who just joined"
- "Generate a 'here's what you need to know' doc for a new SRE"

**AI processes:** `narrate_onboarding_for_user` inspects the cluster topology, key workloads, namespaces, and access patterns to produce a contextual onboarding document. The LLM tailors it to the user's role — developer vs. SRE vs. security engineer.

**Test coverage:** `TestNarrate_DispatchRegistered`
---

### `narrate_service_dependency_graph`
**Purpose:** Upstream/downstream dependencies for a service with NetworkPolicy traffic flows in human-readable form.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Service name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api-svc" }
```


**User asks:**
- "Write a description of how all our services depend on each other"
- "Explain the service architecture in plain English"
- "Document the dependency chain from the user-facing API to the database"

**AI processes:** `narrate_service_dependency_graph` traces Service → Deployment → ConfigMap → Secret relationships and produces a dependency narrative. The LLM turns the raw graph into an architectural story suitable for architecture review documents.

**Test coverage:** `TestNarrate_DispatchRegistered`
---

### `narrate_capacity_report`
**Purpose:** Cluster-wide capacity narrative — per-node utilization, headroom, usage trend, projected saturation.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```


**User asks:**
- "Write the monthly capacity planning report"
- "Summarise our cluster capacity situation for the infrastructure review"
- "Document current headroom and growth projections"

**AI processes:** `narrate_capacity_report` synthesises node utilisation, quota headroom, and growth trend data into a capacity narrative. The LLM adds recommendations for provisioning timelines based on the trend data.

**Test coverage:** `TestNarrate_DispatchRegistered`
---

### `narrate_cost_report`
**Purpose:** Cost breakdown by namespace and workload with cost drivers and optimisation opportunities.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```


**User asks:**
- "Write the monthly Kubernetes cost report"
- "Summarise our infrastructure spend and where we're wasting money"
- "Produce a cost breakdown for the engineering leadership meeting"

**AI processes:** `narrate_cost_report` aggregates resource efficiency, idle capacity, and waste signals into a cost narrative. The LLM quantifies potential savings and prioritises optimisation opportunities by ROI.

**Test coverage:** `TestNarrate_DispatchRegistered`
---

### `narrate_security_posture`
**Purpose:** CISO-ready security posture report — pod security, NetworkPolicy coverage, RBAC, secret hygiene.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Write a security posture report for the CISO"
- "Summarise our Kubernetes security risks in plain English"
- "Produce a security briefing covering our biggest vulnerabilities"

**AI processes:** `narrate_security_posture` aggregates findings from RBAC audits, privileged container checks, TLS expiry, and image vulnerabilities into a security narrative. The LLM prioritises findings by exploitability and blast radius.

**Test coverage:** `TestNarrate_DispatchRegistered`
---

### `narrate_migration_readiness`
**Purpose:** Workloads, data, and config checklist for migrating a namespace to a new cluster or environment.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Namespace to migrate |
| `cluster_id` | string | No | Source cluster ID |

**Example:**
```json
{ "namespace": "staging" }
```


**User asks:**
- "Are we ready to migrate from Kubernetes 1.29 to 1.30?"
- "Write an upgrade readiness assessment for the cluster"
- "What blockers do we have before the platform migration?"

**AI processes:** `narrate_migration_readiness` checks deprecated APIs, PodSecurityPolicy usage, node compatibility, and add-on versions against the target Kubernetes version. The LLM produces a readiness checklist with specific actions to unblock the migration.

**Test coverage:** `TestNarrate_DispatchRegistered`
---

### `narrate_change_impact`
**Purpose:** What-if textual report showing first and second-order effects of a proposed change.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `kind` | string | Yes | Resource kind |
| `name` | string | Yes | Resource name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "kind": "Deployment", "name": "payment-api" }
```


**User asks:**
- "What's the impact of removing the payment-api Deployment?"
- "Write an impact assessment for the planned database migration"
- "If we change the API gateway configuration, what breaks?"

**AI processes:** `narrate_change_impact` maps the dependency graph of the target resource and estimates downstream blast radius. The LLM produces a change impact document with affected services, risk level, and rollback plan.

**Test coverage:** `TestNarrate_DispatchRegistered`
---

## Recommendation (18 tools)

*Planning and optimisation. Autonomy level 2.*

---

### `plan_scale_deployment`
**Purpose:** Plan a replica-count change — accounts for HPA constraints, PDB limits, node capacity.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `target_replicas` | integer | Yes | Desired replica count |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api", "target_replicas": 10 }
```


**User asks:**
- "Plan how to scale payment-api from 3 to 10 replicas safely"
- "How should I scale up for the Black Friday traffic spike?"
- "What's the safe sequence to scale checkout-service to handle 10x load?"

**AI processes:** `plan_scale_deployment` evaluates current replica count, resource headroom, PDB constraints, and HPA bounds before producing a step-by-step scaling plan. The LLM explains what to watch during each step and what rollback looks like.

**Test coverage:** `TestPlanScaleDeployment_ReturnsHint`, `TestPlan_DispatchRegistered`
---

### `plan_drain_node`
**Purpose:** Preview what would happen if a node were drained — lists pod evictions, PDB conflicts, capacity impact.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Node name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "ip-10-0-1-42.us-east-1.compute.internal" }
```


**User asks:**
- "How do I safely drain worker-node-42 for maintenance?"
- "Plan a node drain that won't cause downtime"
- "What's the safe sequence to take this node offline?"

**AI processes:** `plan_drain_node` evaluates PDB coverage, replica counts across affected workloads, and node capacity on remaining nodes before producing a drain plan. The LLM flags workloads that would breach their PDB and recommends pre-drain scale-ups.

**Test coverage:** `TestPlanDrainNode_IncludesPodList`, `TestPlan_DispatchRegistered`
---

### `plan_rollout_safety`
**Purpose:** Estimate blast radius of a planned rollout, recommend canary percentage and maxSurge/maxUnavailable settings.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api" }
```


**User asks:**
- "What do I need to check before rolling out this Deployment change?"
- "Give me a pre-flight checklist for the v2.4.0 release"
- "Plan a safe zero-downtime rollout of payment-api"

**AI processes:** `plan_rollout_safety` evaluates replica count, readiness probes, PDB, HPA bounds, and cluster health to produce a rollout safety checklist. The LLM adds go/no-go criteria and monitoring signals to watch.

**Test coverage:** `TestPlan_DispatchRegistered`
---

### `plan_cost_reduction`
**Purpose:** Identify cost-reduction candidates — over-provisioned pods, idle nodes, unused PVs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "staging" }
```


**User asks:**
- "Give me a plan to reduce our Kubernetes costs by 30%"
- "What's the step-by-step plan to right-size our over-provisioned workloads?"
- "Plan a cost optimisation sprint for the infrastructure team"

**AI processes:** `plan_cost_reduction` identifies the highest-waste workloads and produces a prioritised right-sizing plan with estimated savings per action. The LLM orders actions by impact vs. risk to avoid destabilising critical services.

**Test coverage:** `TestPlan_DispatchRegistered`
---

### `plan_ha_upgrade`
**Purpose:** Find single-replica workloads and recommend zero-downtime HA upgrade path.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "How do I make payment-api highly available?"
- "Give me a plan to add redundancy to single-replica services"
- "Plan an HA upgrade for the checkout service"

**AI processes:** `plan_ha_upgrade` evaluates current replica count, anti-affinity rules, PDB configuration, and service topology spread to produce an HA upgrade plan. The LLM explains each step and the HA guarantee it provides.

**Test coverage:** `TestPlan_DispatchRegistered`
---

### `plan_resource_quota`
**Purpose:** Suggest ResourceQuota values per namespace based on 30-day actual usage.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Help me set up resource quotas for the new team namespace"
- "What quotas should I put on the staging namespace?"
- "Plan a quota structure that prevents any single team from starving others"

**AI processes:** `plan_resource_quota` analyses existing workload sizes in the namespace and cluster capacity to recommend quota values. The LLM explains the rationale behind each limit and the headroom it preserves.

**Test coverage:** `TestPlan_DispatchRegistered`
---

### `plan_psa_enforcement`
**Purpose:** Which namespaces can move to `restricted` Pod Security Admission without breaking workloads?

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```


**User asks:**
- "Plan the migration from PodSecurityPolicy to Pod Security Admission"
- "How do I enforce the Restricted pod security standard in production?"
- "What needs to change before I can enable PSA in enforce mode?"

**AI processes:** `plan_psa_enforcement` scans running pods for PSA policy violations and produces a migration plan per namespace. The LLM ranks violations by severity and provides the specific pod spec changes needed.

**Test coverage:** `TestPlan_DispatchRegistered`
---

### `plan_image_pull_secrets`
**Purpose:** Find duplicate image pull secrets across namespaces and suggest consolidation patterns.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```


**User asks:**
- "Set up image pull secrets for the new private registry"
- "Which namespaces need my-registry-secret added?"
- "Plan the rollout of a new docker registry credential across the cluster"

**AI processes:** `plan_image_pull_secrets` identifies which namespaces and ServiceAccounts need the new Secret and produces a distribution plan. The LLM explains the patching sequence and how to verify pull success.

**Test coverage:** `TestPlan_DispatchRegistered`
---

### `plan_backup_coverage`
**Purpose:** Identify stateful workloads (StatefulSets with PVCs) that lack backup annotations or backup jobs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "database" }
```


**User asks:**
- "Which of our StatefulSets don't have a backup strategy?"
- "Plan a backup coverage audit for production data"
- "Show me PVCs with no backup annotations and plan how to fix it"

**AI processes:** `plan_backup_coverage` audits StatefulSets and PVCs for backup annotations and velero/snapshot coverage. The LLM produces a coverage gap report with a prioritised plan to add backup to unprotected workloads.

**Test coverage:** `TestPlan_DispatchRegistered`
---

### `plan_pdb_coverage`
**Purpose:** Deployments and StatefulSets with 2+ replicas that have no matching PodDisruptionBudget.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Which Deployments don't have a PodDisruptionBudget?"
- "Plan PDB coverage for all production workloads"
- "What minAvailable setting should I use for each service?"

**AI processes:** `plan_pdb_coverage` scans Deployments for missing PDBs and recommends minAvailable values based on replica count and service criticality. The LLM produces ready-to-apply PDB manifests with explanations.

**Test coverage:** `TestPlan_DispatchRegistered`
---

### `recommend_resource_optimization`
**Purpose:** Resource optimization recommendations — CPU/memory rightsizing with projected savings.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Which pods should I right-size to save money?"
- "Give me CPU and memory recommendations for payment-api"
- "What resource limits should I set on the checkout deployment?"

**AI processes:** `recommend_resource_optimization` compares actual CPU/memory usage against requested values and produces right-sizing recommendations with confidence levels. The LLM explains the methodology and estimated savings from each recommendation.

**Test coverage:** `TestRecommendResourceOptimization_ReturnsFindingsAndHint`
---

### `recommend_cost_reduction`
**Purpose:** Cost-saving opportunities with projected savings by workload and resource type.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "staging" }
```


**User asks:**
- "Where can I cut Kubernetes costs without impacting reliability?"
- "What's the lowest-risk way to reduce our cloud spend by 20%?"
- "Recommend cost optimisations for the infrastructure team"

**AI processes:** `recommend_cost_reduction` identifies idle resources, over-provisioned workloads, and unused PVCs ranked by waste dollar value. The LLM presents actionable recommendations ordered by savings impact and risk.

**Test coverage:** `TestRecommendCostReduction_ReturnsHint`
---

### `recommend_scaling_strategy`
**Purpose:** Recommended HPA/VPA configurations and scaling strategies based on workload patterns.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Should I use HPA or VPA for the payment-api service?"
- "Recommend a scaling strategy for handling our traffic spikes"
- "Is KEDA a better fit than HPA for our queue-based workers?"

**AI processes:** `recommend_scaling_strategy` analyses workload traffic patterns, resource utilisation variance, and current autoscaler configuration to recommend HPA, VPA, or KEDA. The LLM explains the tradeoffs specific to the workload's characteristics.

**Test coverage:** `TestRecommendGenericFallback_ReturnsOverviewAndHint`
---

### `recommend_architecture_improvements`
**Purpose:** Architectural improvements for resilience, performance, and cost based on cluster analysis.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```


**User asks:**
- "What architectural changes would make our cluster more resilient?"
- "Review our Kubernetes architecture and tell me what to improve"
- "What are the biggest architectural risks in our current setup?"

**AI processes:** `recommend_architecture_improvements` evaluates single points of failure, anti-affinity coverage, topology spread, and inter-service coupling. The LLM produces a prioritised architectural improvement roadmap.

**Test coverage:** `TestRecommendGenericFallback_ReturnsOverviewAndHint`
---

### `recommend_security_hardening`
**Purpose:** Security hardening recommendations based on CIS benchmarks and CVE findings.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "What security hardening steps should I take for production?"
- "Give me a prioritised list of security improvements"
- "How do I make this cluster CIS Kubernetes Benchmark compliant?"

**AI processes:** `recommend_security_hardening` combines findings from RBAC audits, container security checks, and network policy gaps to produce a hardening roadmap. The LLM prioritises by exploitability × blast radius.

**Test coverage:** `TestRecommendSecurityHardening_ReturnsHint`
---

### `recommend_monitoring_improvements`
**Purpose:** Monitoring, alerting, and observability enhancements — missing metrics, alerts, dashboards.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "What monitoring gaps do we have in production?"
- "Which services have no health checks or alerts configured?"
- "Recommend what we should be alerting on that we currently aren't"

**AI processes:** `recommend_monitoring_improvements` identifies pods without probes, services without metrics annotations, and workloads without HPA. The LLM produces a monitoring gap report with specific alert recommendations.

**Test coverage:** `TestRecommendGenericFallback_ReturnsOverviewAndHint`
---

### `recommend_disaster_recovery`
**Purpose:** Disaster recovery and backup strategy recommendations for stateful workloads.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```


**User asks:**
- "What's our disaster recovery posture for the production cluster?"
- "If we lose the us-east-1 region, what's the recovery plan?"
- "Recommend DR improvements for our Kubernetes setup"

**AI processes:** `recommend_disaster_recovery` evaluates backup coverage, multi-zone spread, StatefulSet replication, and PDB protection to assess DR readiness. The LLM produces a gap analysis and prioritised DR roadmap.

**Test coverage:** `TestRecommendGenericFallback_ReturnsOverviewAndHint`
---

### `recommend_upgrade_path`
**Purpose:** Kubernetes and application upgrade paths with risk assessment and prerequisites.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```


**User asks:**
- "What's the upgrade path from Kubernetes 1.28 to 1.31?"
- "Should I upgrade control plane first or data plane first?"
- "What's the safest way to upgrade our production cluster?"

**AI processes:** `recommend_upgrade_path` evaluates current version, deprecated APIs in use, add-on compatibility, and workload disruption tolerance to produce a step-by-step upgrade path. The LLM includes pre- and post-upgrade validation steps.

**Test coverage:** `TestRecommendGenericFallback_ReturnsOverviewAndHint`
---

## Troubleshooting (17 tools)

*Specific failure diagnosis. Autonomy level 1.*

---

### `diagnose_pod_not_ready`
**Purpose:** Why is a pod not Ready? Detects CrashLoopBackOff, OOMKilled, ImagePullBackOff, probe failures, pending scheduling.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Pod name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-6d8f9b-xk2j" }
```


**User asks:**
- "The payment-api pod is Running but not Ready — why?"
- "Why is my pod stuck in 0/1 READY state?"
- "Diagnose why the readiness probe keeps failing for checkout"

**AI processes:** `diagnose_pod_not_ready` inspects readiness probe configuration, recent probe failure events, container logs, and endpoint status. The LLM produces a specific diagnosis — misconfigured path, app startup lag, or dependency not ready.

**Test coverage:** `TestDiagnosePodNotReady_CrashLoopDetected`, `TestDiagnose_DispatchRegistered`
---

### `diagnose_service_no_endpoints`
**Purpose:** Why does a service have no endpoints? Detects selector mismatches, zero ready pods, headless/external services.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Service name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api-svc" }
```


**User asks:**
- "The checkout Service has no endpoints — why?"
- "My Service exists but curl to it returns connection refused"
- "Why isn't the payment-api Service routing to any pods?"

**AI processes:** `diagnose_service_no_endpoints` checks the Service selector against running pod labels, pod Ready status, and NetworkPolicy rules. The LLM traces exactly which selector label is wrong or why matching pods are not yet Ready.

**Test coverage:** `TestDiagnoseServiceNoEndpoints_SelectorMatchesNone`
---

### `diagnose_pvc_pending`
**Purpose:** Why is a PVC stuck in Pending? Detects missing StorageClass, provisioner failures, capacity limits.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | PVC name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "database", "name": "data-postgres-primary-0" }
```


**User asks:**
- "My PVC has been Pending for 10 minutes — what's wrong?"
- "Why isn't the StorageClass provisioning this PersistentVolumeClaim?"
- "The postgres pod is stuck because its PVC won't bind"

**AI processes:** `diagnose_pvc_pending` checks StorageClass provisioner health, volume binding mode, available PVs, and provisioner events. The LLM explains whether the issue is no matching PV, a broken provisioner, or a WaitForFirstConsumer binding waiting for a pod.

**Test coverage:** `TestDiagnosePVCPending_NoStorageClass`
---

### `diagnose_ingress_404`
**Purpose:** Why is an ingress returning 404? Walks rules → service → endpoints to find the broken link.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Ingress name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-gateway" }
```


**User asks:**
- "My Ingress is returning 404 for /api/v1/payments — why?"
- "The Ingress exists but requests to it return Not Found"
- "Diagnose the routing issue for the payments Ingress"

**AI processes:** `diagnose_ingress_404` validates Ingress path rules against backend Service existence, path type (Prefix vs. Exact), and controller annotations. The LLM pinpoints the exact misconfiguration — wrong path type, missing pathPrefix, or absent backend Service.

**Test coverage:** `TestDiagnoseIngress404_BackendServiceMissing`
---

### `diagnose_deployment_rollback_needed`
**Purpose:** Is a deployment degraded after the latest revision? Returns whether rollback is recommended.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api" }
```


**User asks:**
- "Should I roll back the payment-api deployment?"
- "The new release is causing errors — is rollback the right move?"
- "Diagnose whether this deployment needs to be rolled back"

**AI processes:** `diagnose_deployment_rollback_needed` compares error rates, restart counts, and probe failures before and after the rollout. The LLM gives a clear yes/no rollback recommendation with the evidence and what to expect after rolling back.

**Test coverage:** `TestDiagnoseDeploymentRollbackNeeded_DegradedWithHistory`
---

### `diagnose_cronjob_missing_runs`
**Purpose:** Why didn't a CronJob fire? Checks suspend flag, concurrencyPolicy, lastScheduleTime, failed child jobs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | CronJob name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "batch", "name": "nightly-report" }
```


**User asks:**
- "The nightly-backup CronJob didn't run last night — why?"
- "Why has the cleanup CronJob missed 3 scheduled runs?"
- "Diagnose why this CronJob isn't executing on schedule"

**AI processes:** `diagnose_cronjob_missing_runs` checks suspension state, concurrency policy, last-schedule time, and recent Job creation events. The LLM explains whether misses are caused by a suspended CronJob, a concurrency collision, or a controller issue.

**Test coverage:** `TestDiagnoseCronJobMissingRuns_Suspended`
---

### `diagnose_node_unschedulable`
**Purpose:** Why won't pods land on a node? Checks cordon, taints, conditions, capacity.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Node name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "ip-10-0-1-42.us-east-1.compute.internal" }
```


**User asks:**
- "Why is worker-node-42 marked as Unschedulable?"
- "A node is cordoned — was it done manually or by the system?"
- "How do I safely uncordon this node?"

**AI processes:** `diagnose_node_unschedulable` checks the node's Unschedulable flag, taints, conditions, and recent events. The LLM explains whether the node was cordoned manually, by a drain, or by a node problem detector — and the safe path to returning it to service.

**Test coverage:** `TestDiagnoseNodeUnschedulable_Cordoned`
---

### `diagnose_hpa_not_scaling`
**Purpose:** Why isn't an HPA scaling? Checks min=max, ScalingActive/AbleToScale conditions, metric availability.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | HPA name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-hpa" }
```


**User asks:**
- "CPU is at 95% but the HPA isn't adding replicas — why?"
- "The HPA shows ScalingActive=False — what does that mean?"
- "Diagnose why autoscaling isn't working for checkout"

**AI processes:** `diagnose_hpa_not_scaling` evaluates HPA conditions, metric server availability, metric values vs. thresholds, and scale-up cooldown. The LLM identifies the specific blocking condition — cooldown period, metric not available, or maxReplicas already reached.

**Test coverage:** `TestDiagnoseHPANotScaling_MinEqualsMax`
---

### `diagnose_networkpolicy_blocking`
**Purpose:** Is a NetworkPolicy blocking traffic between two pods? Evaluates ingress/egress rules and podSelectors.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `from_pod` | string | Yes | Source pod name |
| `to_pod` | string | Yes | Destination pod name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "from_pod": "frontend-pod", "to_pod": "api-server-pod" }
```


**User asks:**
- "A NetworkPolicy is blocking traffic I need — which one?"
- "Why can't checkout reach the payment service despite both running?"
- "Diagnose which NetworkPolicy rule is dropping my traffic"

**AI processes:** `diagnose_networkpolicy_blocking` evaluates all NetworkPolicies affecting both source and destination pods and traces which rule is dropping the traffic. The LLM produces the exact NetworkPolicy name, rule, and the yaml change needed to allow the traffic.

**Test coverage:** `TestDiagnoseNetworkPolicyBlocking_DefaultDeny`
---

### `diagnose_certificate_failures`
**Purpose:** cert-manager certificate issuance failures in a time window. Returns failed Certificate objects with reasons.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `since` | string | No | Go duration (default `1h`) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "since": "2h" }
```


**User asks:**
- "My service is returning SSL handshake errors — why?"
- "The TLS cert for payments.example.com seems expired"
- "Diagnose the certificate issue causing HTTPS failures"

**AI processes:** `diagnose_certificate_failures` checks TLS Secrets referenced by Ingresses for expiry, format validity, and cert-manager Certificate resource conditions. The LLM explains whether the cert is expired, renewal is stuck, or the Secret has wrong data.

**Test coverage:** `TestDiagnoseCertificateFailures_EventBased`
---

### `troubleshoot_pod_failures`
**Purpose:** Full pod failure investigation — multi-step root cause analysis with fix suggestions.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Pod name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-6d8f9b-xk2j" }
```


**User asks:**
- "Multiple pods are failing in production — help me figure out why"
- "There's a wave of pod crashes across the cluster"
- "Troubleshoot the OOMKill storm in the production namespace"

**AI processes:** `troubleshoot_pod_failures` runs a multi-step investigation: restart patterns, exit codes, log patterns, resource limits, and node pressure. The LLM synthesises findings across multiple tools into a single root-cause narrative with a remediation sequence.

**Test coverage:** `TestHandleTroubleshootPodFailures_IncludesHint`
---

### `troubleshoot_network_issues`
**Purpose:** Network connectivity diagnosis — DNS resolution, service discovery, endpoint health aggregated.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Services can't reach each other — something is wrong with the network"
- "We're seeing random connection timeouts between services"
- "Troubleshoot inter-service connectivity in production"

**AI processes:** `troubleshoot_network_issues` evaluates DNS resolution, Service endpoint health, NetworkPolicy rules, and CNI events. The LLM traces the network path hop by hop and identifies where connectivity is breaking.

**Test coverage:** `TestHandleTroubleshootNetworkIssues_AggregatesServices`
---

### `troubleshoot_performance_degradation`
**Purpose:** Performance degradation investigation — correlates CPU throttling, memory pressure, disk I/O, network saturation.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Response times are up 5x — what's causing the degradation?"
- "Something is slowing down the entire checkout flow"
- "Troubleshoot why payment-api latency spiked at 14:00 UTC"

**AI processes:** `troubleshoot_performance_degradation` correlates CPU throttling, memory pressure, pod restart times, and resource contention across the dependency chain. The LLM traces the latency spike to its root cause and distinguishes resource exhaustion from application regression.

**Test coverage:** Contract + functional
---

### `troubleshoot_deployment_failures`
**Purpose:** Failed deployment investigation — rollout history, image changes, config changes, failed pod logs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api" }
```


**User asks:**
- "The payment-api deployment is failing — it won't roll out"
- "New pods from this Deployment keep crashing immediately"
- "Troubleshoot why this Deployment can't complete its rollout"

**AI processes:** `troubleshoot_deployment_failures` examines rollout conditions, new pod startup failures, image pull errors, and config injection issues. The LLM produces a diagnosis: image not found, misconfigured environment, probe timeout, or resource quota hit.

**Test coverage:** Contract + functional
---

### `troubleshoot_resource_constraints`
**Purpose:** Resource exhaustion investigation — OOM kills, CPU saturation, quota limits reached.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Pods keep getting OOMKilled — how do I fix it?"
- "We're hitting CPU throttling limits across production"
- "Troubleshoot the resource constraints causing instability"

**AI processes:** `troubleshoot_resource_constraints` identifies pods with limits too tight for actual usage and nodes where aggregate requests exceed allocatable. The LLM recommends specific limit adjustments with before/after comparison.

**Test coverage:** Contract + functional
---

### `troubleshoot_rbac_issues`
**Purpose:** RBAC permission debugging — find what's blocking a ServiceAccount from accessing a resource.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "My pod is getting 'Forbidden' errors talking to the Kubernetes API"
- "The CI pipeline can't create Deployments — permission denied"
- "Troubleshoot why this ServiceAccount doesn't have the access it needs"

**AI processes:** `troubleshoot_rbac_issues` traces the ServiceAccount → RoleBinding → Role chain and identifies the missing permission. The LLM produces the exact Role or ClusterRole rule needed and the RoleBinding to create.

**Test coverage:** `TestHandleTroubleshootRBACIssues_FetchesAllRBACResources`
---

### `troubleshoot_storage_issues`
**Purpose:** PV/PVC issues — mount failures, provisioning errors, capacity problems.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "database" }
```


**User asks:**
- "The database pod is crashing because of storage errors"
- "My StatefulSet pods are getting I/O errors"
- "Troubleshoot the storage issue causing data layer failures"

**AI processes:** `troubleshoot_storage_issues` checks PVC phase, StorageClass provisioner health, PV reclaim state, and pod volume mount events. The LLM traces the storage failure from PVC through PV to the backing infrastructure.

**Test coverage:** Contract + functional
---

## Security (15 tools)

*CIS benchmarks and compliance. Autonomy level 1.*

---

### `check_privileged_containers`
**Purpose:** Pods with `privileged: true` containers, hostNetwork, or hostPID set. Returns affected workloads.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Are any of our containers running in privileged mode?"
- "Which pods have privileged: true in their security context?"
- "Show me all privileged containers in production"

**AI processes:** `check_privileged_containers` scans every running container's security context for `privileged: true`. The LLM explains the blast radius of each finding — a privileged container has full host access and is a critical security risk.

**Test coverage:** `TestCheckPrivilegedContainers_Flags`, `TestSecurityChecks_DispatchRegistered`
---

### `check_root_containers`
**Purpose:** Containers without `runAsNonRoot: true` — containers that may run as UID 0.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Which containers are running as root?"
- "Are any production pods running as UID 0?"
- "Show me containers with runAsNonRoot not set"

**AI processes:** `check_root_containers` checks `runAsUser` and `runAsNonRoot` in container and pod security contexts. The LLM surfaces each finding with the workload name and the specific fix (add `runAsNonRoot: true`).

**Test coverage:** `TestSecurityChecks_DispatchRegistered`
---

### `check_writable_root_fs`
**Purpose:** Containers without `readOnlyRootFilesystem: true` — attack surface for malware persistence.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Which containers have a writable root filesystem?"
- "Are any production containers missing readOnlyRootFilesystem: true?"
- "Show me containers that could be modified by an attacker at runtime"

**AI processes:** `check_writable_root_fs` scans for `readOnlyRootFilesystem: false` or absent in container security contexts. The LLM explains why a writable root filesystem increases the blast radius of a container compromise.

**Test coverage:** `TestSecurityChecks_DispatchRegistered`
---

### `check_capabilities_all_added`
**Purpose:** Containers adding `CAP_SYS_ADMIN` or `ALL` Linux capabilities — highest privilege escalation risk.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Which containers are adding dangerous Linux capabilities?"
- "Show me containers with capabilities.add that include NET_ADMIN or SYS_ADMIN"
- "Are any pods adding ALL capabilities?"

**AI processes:** `check_capabilities_all_added` scans `securityContext.capabilities.add` for dangerous capabilities. The LLM explains what each capability grants and recommends dropping it or switching to a more restrictive alternative.

**Test coverage:** `TestSecurityChecks_DispatchRegistered`
---

### `check_host_path_mounts`
**Purpose:** Pods mounting host filesystem paths — allows escape from container isolation.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Which pods are mounting host filesystem paths?"
- "Are any containers accessing /etc or /var/run/docker.sock from the host?"
- "Show me hostPath volume mounts across production"

**AI processes:** `check_host_path_mounts` finds pods with `hostPath` volumes and reports the host path being mounted. The LLM flags high-risk paths (/var/run/docker.sock, /etc, /) and explains the container escape risk.

**Test coverage:** `TestSecurityChecks_DispatchRegistered`
---

### `check_default_service_accounts_in_use`
**Purpose:** Workloads using the `default` ServiceAccount — security best practice is to use dedicated SAs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Which pods are using the default ServiceAccount?"
- "Are any workloads running without a dedicated ServiceAccount?"
- "Show me pods that might have unintended API access via the default SA"

**AI processes:** `check_default_service_accounts_in_use` finds pods using the `default` ServiceAccount which may have unexpected RBAC bindings. The LLM explains why dedicated ServiceAccounts with minimal permissions are the correct pattern.

**Test coverage:** `TestSecurityChecks_DispatchRegistered`
---

### `check_secrets_in_env`
**Purpose:** Containers referencing Secret keys via `env` variables instead of volume mounts — env vars can leak in logs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Are any containers passing secrets as plain environment variables?"
- "Which pods expose sensitive values in their env instead of using Secret refs?"
- "Show me containers with hardcoded passwords in environment variables"

**AI processes:** `check_secrets_in_env` scans container env for `valueFrom.secretKeyRef` absence where secret-like key names are present. The LLM flags containers exposing credentials directly in env and recommends Secret references.

**Test coverage:** `TestSecurityChecks_DispatchRegistered`
---

### `check_image_tag_latest`
**Purpose:** Workloads using `:latest` tag or no tag — prevents reproducible deployments.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Which containers are using the :latest image tag?"
- "Show me all pods where the image isn't pinned to a specific version"
- "Are any production workloads using mutable image tags?"

**AI processes:** `check_image_tag_latest` scans pod specs for images without a digest or with `:latest` or no tag. The LLM explains why mutable tags break reproducibility and recommends digest pinning.

**Test coverage:** `TestCheckImageTagLatest_Flags`
---

### `check_ingress_tls_expiry_30d`
**Purpose:** Ingress TLS certificates expiring within 30 days. Cluster-wide scan for cert-manager and manual certs.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```


**User asks:**
- "Which TLS certificates expire within the next 30 days?"
- "Will any of our HTTPS endpoints go down from cert expiry this month?"
- "Alert me to Ingress TLS certs about to expire"

**AI processes:** `check_ingress_tls_expiry_30d` inspects TLS Secrets behind Ingresses and calculates days to expiry. The LLM produces an urgency-sorted list with the Ingress name, cert CN, and exact expiry date.

**Test coverage:** `TestSecurityChecks_DispatchRegistered`
---

### `check_rbac_wildcards`
**Purpose:** Roles or ClusterRoles granting `verbs: ["*"]` or `resources: ["*"]` — overly broad permissions.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Are there any RBAC roles with wildcard (*) permissions?"
- "Which roles give unrestricted access to all resources?"
- "Find over-privileged ClusterRoles with '*' on resources or verbs"

**AI processes:** `check_rbac_wildcards` scans Role and ClusterRole rules for `*` in resources or verbs. The LLM ranks findings by blast radius — a `*/*` grant on ClusterRole is the highest severity finding.

**Test coverage:** `TestCheckRBACWildcards_Flags`
---

### `security_scan_cluster`
**Purpose:** Comprehensive cluster security scan — CIS benchmarks, privileged pods, network exposure, RBAC gaps.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope (cluster-wide if omitted) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```


**User asks:**
- "Run a full security scan of the cluster"
- "Give me a comprehensive security audit of production"
- "What are the security vulnerabilities across the entire cluster?"

**AI processes:** `security_scan_cluster` runs all security check tools in sequence and aggregates findings into a risk-scored report. The LLM produces an executive summary with a severity-ordered remediation list.

**Test coverage:** Contract + functional
---

### `security_scan_secrets`
**Purpose:** Scan for exposed secrets — weak encryption, secrets in ConfigMaps, leaked environment variables.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Audit how Secrets are being used across the cluster"
- "Are there any Secrets that are unencrypted or exposed?"
- "Scan for Secret security issues in production"

**AI processes:** `security_scan_secrets` checks Secret encryption at rest, Secret usage in env variables, unused Secrets, and RBAC access to Secrets. The LLM produces a Secret hygiene report with specific remediation steps.

**Test coverage:** Contract + functional
---

### `security_audit_rbac`
**Purpose:** Comprehensive RBAC audit — over-privileged accounts, cluster-admin bindings, orphaned bindings.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```


**User asks:**
- "Give me a full RBAC audit for the cluster"
- "Who has excessive permissions and what should be revoked?"
- "Audit all RBAC bindings for least-privilege violations"

**AI processes:** `security_audit_rbac` enumerates all RoleBindings and ClusterRoleBindings and flags subjects with over-broad permissions. The LLM prioritises findings by risk: wildcard grants > cluster-admin bindings > cross-namespace access.

**Test coverage:** Contract + functional
---

### `security_check_pod_security`
**Purpose:** Validate pod security policies and admission controls against cluster standards.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production" }
```


**User asks:**
- "Do our pods meet the Pod Security Standards?"
- "Which pods would fail the Restricted pod security policy?"
- "Audit pod security contexts across production"

**AI processes:** `security_check_pod_security` evaluates pods against Baseline and Restricted Pod Security Standards and produces a compliance report. The LLM explains which specific fields violate each standard and the exact spec change to remediate.

**Test coverage:** Contract + functional
---

### `security_compliance_report`
**Purpose:** Compliance reports for SOC2, HIPAA, or PCI-DSS — maps cluster state to control requirements.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `standard` | string | No | One of: `soc2`, `hipaa`, `pci-dss` |
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "standard": "soc2", "cluster_id": "prod-us-east-1" }
```


**User asks:**
- "Generate a CIS Kubernetes Benchmark compliance report"
- "Are we compliant with SOC2 Kubernetes requirements?"
- "Produce a security compliance report for the audit"

**AI processes:** `security_compliance_report` maps cluster configuration against CIS Kubernetes Benchmark controls and produces a compliance score. The LLM formats it as an audit-ready document with pass/fail per control and evidence for each finding.

**Test coverage:** Contract + functional
---

## Execution (9 tools — safety-gated)

> **All execution tools are currently Blocked** by the certification gate.
> They require a live CI validation run (`./certify-tools --backend <url>`) to graduate to Provisional before execution is allowed.
> All support `dry_run: true` to preview impact without mutation.

---

### `restart_pod`
**Purpose:** Restart a pod by deletion (the owning controller recreates it). Use for hung pods or log-roll scenarios.

**Safety:** Level 2. Requires `approved: true` in args. Rate-limited. Idempotency-guarded (60s dedup window).

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Pod name |
| `approved` | boolean | Yes | Must be `true` — confirms human approval |
| `dry_run` | boolean | No | Preview without deleting |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-6d8f9b-xk2j", "approved": true, "dry_run": true }
```


**User asks:**
- "Restart the payment-api-6d9f-xk2j pod"
- "The pod is stuck — can you delete and recreate it?"
- "Force restart the hanging checkout pod"

**AI processes:** `restart_pod` deletes the pod so the owning controller creates a replacement. The LLM presents an `ActionPending` block requiring explicit confirmation before execution. It checks PDB constraints and warns if the restart would breach minimum availability.

**Test coverage:** `TestExecutionToolsStillPresent`, idempotency + timeout tests
---

### `scale_deployment`
**Purpose:** Scale a Deployment to a target replica count.

**Safety:** Level 3. Requires `approved: true`. Records idempotency key to prevent duplicate scales.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `replicas` | integer | Yes | Target replica count |
| `approved` | boolean | Yes | Must be `true` |
| `dry_run` | boolean | No | Preview without scaling |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api", "replicas": 5, "approved": true, "dry_run": true }
```


**User asks:**
- "Scale payment-api to 5 replicas"
- "Reduce checkout-service to 2 replicas for off-peak hours"
- "Scale up the auth service to handle the load spike"

**AI processes:** `scale_deployment` patches the Deployment's replica count. It is safety-gated — the LLM produces a pre-flight check (PDB, resource headroom, HPA conflicts) and shows an `ActionPending` confirmation block before any mutation is made.

**Test coverage:** `TestExecutionToolsStillPresent`
---

### `cordon_node`
**Purpose:** Mark a node as unschedulable (cordon). New pods will not be scheduled on it.

**Safety:** Level 3. Requires `approved: true`.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Node name |
| `approved` | boolean | Yes | Must be `true` |
| `dry_run` | boolean | No | Preview without cordoning |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "ip-10-0-1-42.us-east-1.compute.internal", "approved": true, "dry_run": true }
```


**User asks:**
- "Cordon worker-node-42 so no new pods get scheduled there"
- "Mark this node as unschedulable before maintenance"
- "Prevent new workloads from landing on worker-node-42"

**AI processes:** `cordon_node` marks the node Unschedulable via the node spec patch. The LLM explains that existing pods remain running and shows which workloads are currently on the node before presenting the `ActionPending` confirmation.

**Test coverage:** `TestExecutionToolsStillPresent`
---

### `drain_node`
**Purpose:** Evict all pods from a node for maintenance. Respects PodDisruptionBudgets.

**Safety:** Level 4. Requires `approved: true`. High impact — validate with `plan_drain_node` first.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Node name |
| `approved` | boolean | Yes | Must be `true` |
| `dry_run` | boolean | No | Preview without draining |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "ip-10-0-1-42.us-east-1.compute.internal", "approved": true, "dry_run": true }
```


**User asks:**
- "Drain worker-node-42 for kernel maintenance"
- "Evict all pods from this node safely before I take it offline"
- "Drain the node without violating any PodDisruptionBudgets"

**AI processes:** `drain_node` evicts all pods respecting PDB constraints and grace periods. The LLM runs a pre-drain PDB simulation first — flagging any workload that would breach its budget — before the `ActionPending` block. It is the highest-impact execution tool.

**Test coverage:** `TestExecutionToolsStillPresent`
---

### `apply_resource_patch`
**Purpose:** Apply a JSON merge or strategic merge patch to any Kubernetes resource.

**Safety:** Level 4. Requires `approved: true`. Validate with `analyze_blast_radius` first.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `kind` | string | Yes | Resource kind |
| `name` | string | Yes | Resource name |
| `patch` | string | Yes | JSON patch body |
| `approved` | boolean | Yes | Must be `true` |
| `dry_run` | boolean | No | Validate without applying |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "kind": "Deployment", "name": "payment-api", "patch": "{\"spec\":{\"replicas\":3}}", "approved": true, "dry_run": true }
```


**User asks:**
- "Apply this ConfigMap change to the production namespace"
- "Patch the payment-api Deployment to add this label"
- "Update the resource limits on checkout-service"

**AI processes:** `apply_resource_patch` applies a strategic merge patch to a Kubernetes resource. The LLM shows the diff between current and patched state and an `ActionPending` confirmation block before any change is made. Wildcard names are rejected by the safety stack.

**Test coverage:** `TestExecutionToolsStillPresent`
---

### `delete_resource`
**Purpose:** Delete a Kubernetes resource. The highest-risk execution tool — always validate impact first.

**Safety:** Level 5 (maximum). Requires `approved: true`. Use `analyze_blast_radius` before calling.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace (omit for cluster-scoped) |
| `kind` | string | Yes | Resource kind |
| `name` | string | Yes | Resource name |
| `approved` | boolean | Yes | Must be `true` |
| `dry_run` | boolean | No | Preview without deleting |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "kind": "Pod", "name": "stuck-pod-xyz", "approved": true, "dry_run": true }
```


**User asks:**
- "Delete the stale test-job in the staging namespace"
- "Remove the orphaned payment-api-old ConfigMap"
- "Clean up the failed migration Job"

**AI processes:** `delete_resource` deletes a named Kubernetes resource. The LLM checks for dependents (pods referencing a ConfigMap, services selecting a pod) before presenting the `ActionPending` block. It is blocked until certified — requires `certify-tools` validation.

**Test coverage:** `TestExecutionToolsStillPresent`
---

### `rollback_deployment`
**Purpose:** Roll back a Deployment to a previous revision.

**Safety:** Level 3. Requires `approved: true`. Uses `diagnose_deployment_rollback_needed` to confirm before calling.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `revision` | integer | No | Target revision (previous if omitted) |
| `approved` | boolean | Yes | Must be `true` |
| `dry_run` | boolean | No | Preview without rolling back |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api", "approved": true, "dry_run": true }
```


**User asks:**
- "Roll back payment-api to the previous version"
- "The v2.3.1 release is causing errors — revert it"
- "Undo the last deployment of checkout-service"

**AI processes:** `rollback_deployment` reverts the Deployment to the previous ReplicaSet. The LLM shows the diff between current and previous image/config before the `ActionPending` block, and monitors rollout completion after execution.

**Test coverage:** `TestExecutionToolsStillPresent`
---

### `update_resource_limits`
**Purpose:** Update CPU/memory requests and limits on a Deployment's pod template.

**Safety:** Level 3. Requires `approved: true`. Triggers a rolling restart.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | Deployment name |
| `container` | string | Yes | Container name |
| `cpu_request` | string | No | e.g. `"250m"` |
| `cpu_limit` | string | No | e.g. `"500m"` |
| `memory_request` | string | No | e.g. `"256Mi"` |
| `memory_limit` | string | No | e.g. `"512Mi"` |
| `approved` | boolean | Yes | Must be `true` |
| `dry_run` | boolean | No | Preview without patching |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "payment-api", "container": "api", "cpu_request": "250m", "memory_limit": "512Mi", "approved": true, "dry_run": true }
```


**User asks:**
- "Increase payment-api memory limit to 512Mi"
- "Set CPU request to 250m and limit to 1000m for checkout"
- "Right-size the resource limits on auth-service"

**AI processes:** `update_resource_limits` patches the pod template resource spec. The LLM validates that new limits are achievable given node allocatable capacity and namespace quota before presenting the `ActionPending` block. A new rollout is triggered automatically.

**Test coverage:** `TestExecutionToolsStillPresent`
---

### `trigger_hpa_scale`
**Purpose:** Manually override an HPA's desired replica count. Temporary — HPA will resume control after the cooldown period.

**Safety:** Level 4. Requires `approved: true`.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | Yes | Kubernetes namespace |
| `name` | string | Yes | HPA name |
| `desired_replicas` | integer | Yes | Target replica count |
| `approved` | boolean | Yes | Must be `true` |
| `dry_run` | boolean | No | Preview without scaling |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "production", "name": "api-server-hpa", "desired_replicas": 8, "approved": true, "dry_run": true }
```


**User asks:**
- "Force the HPA to scale checkout to 8 replicas immediately"
- "Override the autoscaler and set minimum replicas to 5 for peak traffic"
- "Manually trigger an HPA scale-up for the Black Friday preparation"

**AI processes:** `trigger_hpa_scale` patches HPA min/max replica bounds or triggers an immediate scale. The LLM explains the difference between setting minReplicas (persistent) vs. a manual scale (overridden at next autoscaler reconcile) before the `ActionPending` confirmation.

**Test coverage:** `TestExecutionToolsStillPresent`
---

## Cost (4 tools)

---

### `cost_analyze_spending`
**Purpose:** Analyze cluster costs with breakdown by namespace, workload, and resource type.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```


**User asks:**
- "How much are we spending on Kubernetes infrastructure?"
- "Break down our cloud costs by namespace and workload"
- "Show me the cost distribution across teams"

**AI processes:** `cost_analyze_spending` aggregates resource requests × node costs to produce a cost allocation breakdown. The LLM presents costs per namespace, workload, and team — making infrastructure spending visible to engineering leadership.

**Test coverage:** `TestCostAnalyzeSpending_FallsToDefaultHint`
---

### `cost_identify_waste`
**Purpose:** Identify wasted resources — over-provisioned pods, unused PVs, idle nodes.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "namespace": "staging" }
```


**User asks:**
- "Where are we wasting money on idle or over-provisioned resources?"
- "Show me PVCs, pods, and nodes that are running but not needed"
- "Find the biggest cost waste items in our cluster"

**AI processes:** `cost_identify_waste` identifies idle PVCs, over-provisioned workloads (requested >> actual), and low-utilisation nodes. The LLM quantifies the dollar waste for each item and ranks by immediate savings potential.

**Test coverage:** `TestCostIdentifyWaste_ReturnsHint`
---

### `cost_forecast_spending`
**Purpose:** Forecast future costs based on historical resource usage trends.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `days` | integer | No | Forecast horizon in days (default 30) |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "days": 90, "cluster_id": "prod-us-east-1" }
```


**User asks:**
- "What will our Kubernetes costs be in 3 months at current growth?"
- "Project infrastructure spend for the Q3 budget planning"
- "If we add 20% more workloads, what does that cost?"

**AI processes:** `cost_forecast_spending` projects current resource utilisation growth and pricing trends to produce a cost forecast. The LLM presents a range (optimistic/base/pessimistic) and highlights the growth drivers with the highest cost impact.

**Test coverage:** `TestCostForecastSpending_ReturnsHint`
---

### `cost_optimization_plan`
**Purpose:** Generate a comprehensive cost optimization plan with projected ROI by action.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "cluster_id": "prod-us-east-1" }
```


**User asks:**
- "Create a cost optimisation plan for the next quarter"
- "Give me a step-by-step plan to reduce Kubernetes spend by 25%"
- "Prioritise cost reduction actions by ROI"

**AI processes:** `cost_optimization_plan` combines waste identification, right-sizing recommendations, and spot/preemptible node opportunities into a prioritised plan. The LLM estimates savings and implementation effort for each action.

**Test coverage:** Contract + functional
---

## Automation (4 tools)

---

### `automation_run_playbook`
**Purpose:** Run a predefined remediation playbook — `clear-logs`, `restart-deployment`, `cordon-node`, etc.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `playbook` | string | Yes | Playbook name |
| `namespace` | string | No | Namespace scope |
| `target` | string | No | Target resource name |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "playbook": "restart-deployment", "namespace": "production", "target": "payment-api" }
```


**User asks:**
- "Run the OOMKill recovery playbook for payment-api"
- "Execute the on-call runbook for high-error-rate incidents"
- "Trigger the automated remediation playbook for CrashLoopBackOff"

**AI processes:** `automation_run_playbook` executes a predefined sequence of diagnostic and remediation steps. The LLM presents the playbook steps for review before execution and streams results from each step as it runs.

**Test coverage:** Contract + functional
---

### `automation_schedule_task`
**Purpose:** Schedule recurring tasks — backups, cleanups, health checks — as CronJobs or automation entries.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `task` | string | Yes | Task type |
| `schedule` | string | Yes | Cron expression e.g. `"0 2 * * *"` |
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "task": "cleanup-old-jobs", "schedule": "0 3 * * *", "namespace": "batch" }
```


**User asks:**
- "Schedule a daily cluster health report at 8am"
- "Set up a weekly cost optimisation analysis every Monday"
- "Automate a nightly check for certificate expiry"

**AI processes:** `automation_schedule_task` registers a recurring AI analysis task with a cron schedule. The LLM confirms the schedule, the tools that will run, and where the report will be delivered before creating the automation.

**Test coverage:** Contract + functional
---

### `automation_create_alert_rule`
**Purpose:** Create intelligent alert rules with auto-remediation triggers for common failure patterns.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Alert rule name |
| `condition` | string | Yes | Condition expression |
| `action` | string | No | Auto-remediation action |
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "name": "high-restart-count", "condition": "restarts > 5", "action": "restart-pod", "namespace": "production" }
```


**User asks:**
- "Create an alert that fires when payment-api has more than 5 restarts in 10 minutes"
- "Alert me when any namespace hits 80% of its CPU quota"
- "Set up an alert for TLS certs expiring within 14 days"

**AI processes:** `automation_create_alert_rule` creates a Prometheus alert rule or Kubernetes event-based trigger. The LLM proposes the alert expression with appropriate thresholds and asks for confirmation before creating the rule.

**Test coverage:** Contract + functional
---

### `automation_generate_runbook`
**Purpose:** Generate runbooks for common operational scenarios — incident response, maintenance windows, scaling events.

**Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `scenario` | string | Yes | Scenario type e.g. `"oom-kill"`, `"node-drain"`, `"cert-expiry"` |
| `namespace` | string | No | Namespace scope |
| `cluster_id` | string | No | Cluster ID |

**Example:**
```json
{ "scenario": "oom-kill", "namespace": "production" }
```


**User asks:**
- "Generate a runbook for handling OOMKill incidents"
- "Create a step-by-step runbook for the on-call team for CrashLoopBackOff"
- "Write an automated runbook for database PVC full incidents"

**AI processes:** `automation_generate_runbook` inspects the cluster topology and historical incident patterns to generate a contextual runbook. The LLM produces a structured document with detection, diagnosis, remediation, and escalation sections.

**Test coverage:** Contract + functional
---

## Validation Checklist — Per Tool

To graduate a tool from **Provisional → Certified**, run:

```bash
# From the brain/ directory against a live cluster:
./certify-tools --backend http://localhost:8190 --output reports/certification/tool-certifications.json

# The MCP server auto-reloads the report within 5 minutes.
```

Each tool needs:

| Signal | What passes | Weight |
|---|---|---|
| Contract | name, description, category, inputSchema present | 25 |
| Live validation | Tool returns non-error result against real cluster | 25 |
| Statement coverage | ≥60% go test coverage | 25 |
| Chaos resilience | Tool handles nil/timeout backend without panic | 25 |

Score ≥75 → **Certified**. Score ≥50 → **Provisional**. Score <50 → **Uncertified** (blocked if destructive).

---

## Quick Reference Card

```
TRIAGE              triage_cluster
FIND RESOURCE       resolve_resource kind=Deployment name_hint=payment
INSPECT             inspect_<kind> namespace=X name=Y
FIND PROBLEMS       list_problems filter=crashlooping
SEARCH LOGS         search_logs namespace=X regex="error|panic"
ANALYZE HEALTH      analyze_<kind>_health namespace=X name=Y
DIAGNOSE            diagnose_pod_not_ready / diagnose_service_no_endpoints
WHO CAN DO          who_can_do verb=delete resource=pods
BLAST RADIUS        analyze_blast_radius scope=resource kind=Deployment name=X
SECURITY            check_privileged_containers / check_rbac_wildcards
COSTS               cost_analyze_spending / cost_identify_waste
EXECUTE (DRY RUN)   restart_pod namespace=X name=Y approved=true dry_run=true
```
