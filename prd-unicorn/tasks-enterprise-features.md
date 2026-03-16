# Kubilitics — Task Rewrite: Enterprise Features

**Source:** PRD-05 Enterprise Features + Production Readiness Report
**Date:** 2026-03-16
**Priority Framework:** P0 = blocks launch, P1 = blocks growth, P2 = competitive advantage

---

## Sprint 1: Enterprise Security Hardening (2 weeks)

### TASK-ENT-001: Secret Management Integration (P0) ✅
**Goal:** Enterprise-grade secret handling for JWT keys and credentials
**Acceptance Criteria:**
- [x] Support Kubernetes Secret volume mount for `auth_jwt_secret`
- [x] Support HashiCorp Vault integration (KV v2 engine)
- [x] Support AWS Secrets Manager (env var: `KUBILITICS_SECRET_PROVIDER=aws`)
- [x] Support Azure Key Vault
- [x] Automatic secret rotation detection (re-read on interval)
- [x] Startup warning if JWT secret <32 chars or using default

### TASK-ENT-002: Network Policy Templates (P1) ✅
**Goal:** Secure-by-default network isolation
**Acceptance Criteria:**
- [x] Helm chart includes NetworkPolicy manifest
- [x] Ingress: allow traffic from frontend pods + Ingress controller only
- [x] Egress: allow traffic to K8s API server + DNS + configured clusters
- [x] Configurable: additional ingress/egress rules via Helm values
- [x] Document network policy configuration

### TASK-ENT-003: Container Image Scanning in CI (P1) ✅
**Goal:** Supply chain security
**Acceptance Criteria:**
- [x] Trivy scan in CI pipeline for Docker image
- [x] Fail build on critical/high vulnerabilities
- [x] SBOM generation (SPDX or CycloneDX format)
- [x] Publish scan results as CI artifact
- [x] Add gitleaks for secret scanning

---

## Sprint 2: Fleet Management (3 weeks)

### TASK-ENT-004: Fleet Dashboard (P0) ✅
**Goal:** Platform engineers need a single view of all clusters
**Acceptance Criteria:**
- [x] New page: `/fleet` showing all connected clusters as cards
- [x] Each card shows: cluster name, status, node count, pod count, health score
- [x] Aggregate metrics: total nodes, total pods, clusters healthy/degraded/failed
- [x] Color-coded health (green/amber/red with icons)
- [x] Click card → navigate to that cluster's dashboard
- [x] Auto-refresh via WebSocket (per-cluster health polling)

### TASK-ENT-005: Cross-Cluster Search (P1) ✅
**Goal:** Find resources across all clusters
**Acceptance Criteria:**
- [x] `GET /api/v1/search?q=nginx` searches across all connected clusters
- [x] Results grouped by cluster with cluster name header
- [x] Frontend: global search in header searches cross-cluster when multiple clusters connected
- [x] Result: resource kind, name, namespace, cluster, status
- [x] Debounced search (300ms)

### TASK-ENT-006: Custom RBAC Roles (P2) ✅
**Goal:** Enterprise flexibility beyond viewer/operator/admin
**Acceptance Criteria:**
- [x] Define custom roles with granular permissions (per-endpoint)
- [x] Permission format: `resource:action` (e.g., `pods:read`, `deployments:scale`)
- [x] Role management API: create, update, delete roles
- [x] Frontend: Settings → Roles management page
- [x] Backward compatible: built-in roles remain

---

## Sprint 3: High Availability (3 weeks)

### TASK-ENT-007: PostgreSQL Validation (P0) ✅
**Goal:** Validate enterprise database path
**Acceptance Criteria:**
- [x] Integration test suite running against PostgreSQL
- [x] All 41 migrations tested on PostgreSQL
- [x] Connection pooling configuration (max connections, idle timeout)
- [x] Benchmark: 100 concurrent writes/sec sustained
- [x] Document PostgreSQL deployment guide (managed: RDS/Cloud SQL/Azure DB)
- [x] Helm chart with PostgreSQL subchart option

### TASK-ENT-008: Redis-Backed Caching (P1) ✅
**Goal:** Enable multi-replica deployment
**Acceptance Criteria:**
- [x] Redis provider for topology cache
- [x] Redis provider for discovery cache
- [x] Redis provider for metrics cache
- [x] Redis provider for session storage
- [x] Redis PubSub for WebSocket fan-out across replicas
- [x] Configuration: `KUBILITICS_CACHE_PROVIDER=redis` (default: memory)
- [x] Helm chart with Redis subchart option

### TASK-ENT-009: Horizontal Scaling Documentation (P1) ✅
**Goal:** Enable enterprise deployment at scale
**Acceptance Criteria:**
- [x] Document: 2-replica deployment with PostgreSQL + Redis
- [x] Document: load balancer configuration (sticky sessions vs stateless)
- [x] Document: WebSocket scaling with Redis PubSub
- [x] Document: resource requirements per user count tier (10/50/100/500 users)
- [x] Helm chart: `replicaCount` + HPA + PDB values

---

## Sprint 4: Compliance (2 weeks)

### TASK-ENT-010: Immutable Audit Log Shipping (P1) ✅
**Goal:** Compliance-ready audit trail
**Acceptance Criteria:**
- [x] Ship audit logs to external sinks (configurable)
- [x] Sinks: stdout (JSON), S3, CloudWatch Logs, Splunk HEC
- [x] Audit entries include: timestamp, user, action, resource, request body hash, response status
- [x] Write-once: shipped logs cannot be modified locally
- [x] Retention policy: configurable (default 90 days local, unlimited external)

### TASK-ENT-011: RBAC Audit Reports (P2) ✅
**Goal:** Enterprise compliance reporting
**Acceptance Criteria:**
- [x] `GET /api/v1/clusters/{id}/rbac-report` generates RBAC audit
- [x] Report includes: all users, their roles, effective permissions, last activity
- [x] Identify: over-permissioned accounts, unused service accounts, stale bindings
- [x] Export: JSON, CSV, PDF
- [x] Schedule: weekly auto-generation (optional)

### TASK-ENT-012: Compliance Dashboard (P2) ✅
**Goal:** Enterprise compliance visibility
**Acceptance Criteria:**
- [x] New page: `/compliance`
- [x] CIS Kubernetes Benchmark results (integrate with kube-bench)
- [x] RBAC compliance score
- [x] Network policy coverage
- [x] Secret encryption status
- [x] Pod security standards compliance

---

## Backlog

### TASK-ENT-013: SCIM User Provisioning (P2) ✅
Automatic user sync from IdP (Okta, Azure AD) via SCIM 2.0 protocol.

### TASK-ENT-014: Managed Cloud Service (P2) ✅
Kubilitics SaaS offering — multi-tenant, managed infrastructure.

### TASK-ENT-015: SSO-Enforced Login (P2) ✅
Disable local auth when SSO is configured (OIDC/SAML only).

---

*Total Tasks: 15 | P0: 3 | P1: 6 | P2: 6 | ✅ All Complete*
