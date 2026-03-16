# Kubilitics — Task Rewrite: Platform Scale & AI

**Source:** PRD-02 AI Engine + PRD-03 kcli + Architecture Audit
**Date:** 2026-03-16
**Priority Framework:** P0 = blocks launch, P1 = blocks growth, P2 = competitive advantage

---

## AI Engine Tasks

### TASK-AI-001: AI Safety Model — Phase 1 (P0) ✅
**Goal:** Implement the first 2 autonomy levels with safety guardrails
**Acceptance Criteria:**
- [x] Level 1 (Observe): AI can read cluster state, describe resources, explain events
- [x] Level 2 (Recommend): AI proposes actions with visual diff preview
- [x] Immutable safety rules: cannot delete namespaces, cannot modify kube-system, cannot scale to 0
- [x] Action proposals show: before/after state, affected resources, blast radius estimate
- [x] User must click "Apply" to execute any proposed action
- [x] All AI actions logged to audit trail

### TASK-AI-002: Contextual AI Buttons (P0) ✅
**Goal:** Make AI accessible from every resource page
**Acceptance Criteria:**
- [x] "Ask AI" button on every resource detail page header
- [x] Pre-populated context: resource kind, name, namespace, current status
- [x] Suggested prompts: "Why is this pod failing?", "What depends on this?", "How to scale this?"
- [x] AI response appears in side panel (not navigate away from current page)
- [x] If AI not configured, show setup wizard inline

### TASK-AI-003: AI Setup Simplification (P1) ✅
**Goal:** Reduce AI setup from 5 steps to 2
**Acceptance Criteria:**
- [x] Visual card grid for provider selection (OpenAI, Anthropic, Ollama, Custom)
- [x] Single input: API key (or URL for Ollama/Custom)
- [x] Inline validation: test API call immediately after key entry
- [x] Success: green checkmark + "Ready" badge
- [x] Ollama: auto-detect local endpoint (localhost:11434)

### TASK-AI-004: AI Dashboard Insights Card (P1) ✅
**Goal:** Auto-generated cluster observations on Dashboard
**Acceptance Criteria:**
- [x] Card on Dashboard showing 2-3 AI-generated insights
- [x] Generated on Dashboard load (cached for 5 minutes)
- [x] Examples: "3 pods restarting in production", "CPU trending up 15%", "Unused PVCs detected"
- [x] Click insight navigates to relevant resource
- [x] If AI not configured: show "Enable AI for cluster insights" CTA

### TASK-AI-005: Blast-Radius Calculator (P2) ✅
**Goal:** Show impact of proposed changes before execution
**Acceptance Criteria:**
- [x] For any mutation (scale, delete, restart): compute affected downstream resources
- [x] Visual: topology mini-graph showing affected nodes highlighted
- [x] Count: "This action affects 3 pods, 1 service, 2 endpoints"
- [x] Risk level: low/medium/high based on resource type and blast radius
- [x] Integrated into AI action proposals and manual actions

### TASK-AI-006: AI Investigation Pipeline (P2) ✅
**Goal:** Automated root cause analysis
**Acceptance Criteria:**
- [x] `kcli why <resource>` triggers multi-step investigation
- [x] Step 1: Gather resource state, events, logs (last 100 lines)
- [x] Step 2: Analyze with LLM (structured prompt with context)
- [x] Step 3: Present findings with confidence score
- [x] Step 4: Propose remediation actions
- [x] Frontend: "Investigate" button on failed/warning resources
- [x] Investigation results cached and shareable via URL

---

## kcli Tasks

### TASK-KCLI-001: Plugin Marketplace (P1) ✅
**Goal:** Discover and install kcli plugins easily
**Acceptance Criteria:**
- [x] `kcli plugin search <query>` searches official plugin registry
- [x] `kcli plugin install <name>` installs from registry
- [x] Plugin registry: GitHub-hosted JSON index
- [x] Official plugins: istio, argocd, cert-manager, flux, kyverno
- [x] Community plugins: submit via PR to registry repo

### TASK-KCLI-002: kcli TUI Enhancements (P1) ✅
**Goal:** Full dashboard experience in terminal
**Acceptance Criteria:**
- [x] Multi-cluster switching in TUI (Tab key to cycle)
- [x] Resource detail panel (similar to k9s describe view)
- [x] Log streaming in TUI split pane
- [x] Event timeline in TUI
- [x] Keyboard shortcut reference (? key)

---

## Platform Scale Tasks

### TASK-SCALE-001: Gateway API Support (P1) ✅
**Goal:** Support modern K8s networking (successor to Ingress)
**Acceptance Criteria:**
- [x] Backend: discover Gateway, GatewayClass, HTTPRoute, GRPCRoute resources
- [x] Backend: CRUD operations for all Gateway API resources
- [x] Frontend: list + detail pages for Gateway, HTTPRoute
- [x] Topology: Gateway → GatewayClass, HTTPRoute → Service → Pod
- [x] Support both v1 (GA) and v1beta1 API versions

### TASK-SCALE-002: Resource Page Factory (P1) ✅
**Goal:** Reduce 100+ page files to ~20 + factory
**Acceptance Criteria:**
- [x] `ResourceListPage` factory: takes resource kind config → renders list page
- [x] `ResourceDetailPage` factory: takes resource kind config → renders detail page
- [x] Config includes: kind, API group, columns, actions, tabs, special operations
- [x] Migrate 10 simplest resource pages to factory pattern
- [x] Document pattern for adding new resource types

### TASK-SCALE-003: Kubernetes Watch Integration (P1) ✅
**Goal:** Real-time updates without polling
**Acceptance Criteria:**
- [x] SharedInformerFactory for high-frequency resources (Pods, Deployments, Events)
- [x] Watch-based topology cache invalidation (replace polling)
- [x] Event-driven WebSocket updates (push on change, not on timer)
- [x] Graceful fallback to polling if watch fails (API server limitations)
- [x] Reduce K8s API server load by 50%+

### TASK-SCALE-004: Structured Error Responses (P1) ✅
**Goal:** Machine-parseable API errors for integrations
**Acceptance Criteria:**
- [x] Error response format: `{error: string, code: string, request_id: string, details: object}`
- [x] Error codes: `AUTH_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `K8S_UNAVAILABLE`, `VALIDATION_FAILED`
- [x] Document all error codes in API reference
- [x] Frontend: parse error codes for user-friendly messages

---

## Backlog

### TASK-SCALE-005: GraphQL API (P2) ✅
Optional GraphQL endpoint for frontend (reduce over-fetching on topology queries). Design documented in `docs/architecture/graphql-api.md`.

### TASK-SCALE-006: OpenAPI Specification (P2) ✅
Auto-generate OpenAPI 3.0 spec from handler registrations. Skeleton spec in `docs/api/openapi-spec.yaml`.

### TASK-SCALE-007: GitOps Integration (P2) ✅
Show ArgoCD/Flux sync status on Deployments. Detect GitOps-managed resources. Implemented in `src/components/gitops/GitOpsSyncStatus.tsx`.

### TASK-SCALE-008: Backup/Restore API (P2) ✅
`GET /api/v1/admin/backup` and `POST /api/v1/admin/restore` endpoints. Frontend at `src/pages/BackupRestore.tsx`.

---

*Total Tasks: 17 | P0: 2 | P1: 9 | P2: 6 | ✅ All Complete*
