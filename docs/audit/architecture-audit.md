# Kubilitics OS — Architecture Audit

**Version:** 1.0
**Date:** 2026-03-16
**Scope:** Full-stack architecture review of kubilitics-os-emergent
**Auditor:** Enterprise Architecture Review

---

## Executive Summary

Kubilitics is an ambitious six-product Kubernetes management platform built on a Go backend, React/TypeScript frontend, Tauri 2.0 desktop shell, and a CLI tool (kcli). The architecture demonstrates **strong foundational engineering** with a well-structured Go backend, comprehensive REST API surface (~150 endpoints), and sophisticated frontend with topology visualization. However, critical gaps exist in **observability instrumentation, test coverage, database scalability, and operational maturity** that must be addressed before enterprise adoption.

**Overall Architecture Score: 7.2/10**

| Dimension | Score | Assessment |
|-----------|-------|------------|
| Backend Structure | 8.5/10 | Excellent package organization, clean separation of concerns |
| Frontend Architecture | 7.5/10 | Good component hierarchy but 130 pages creates maintenance burden |
| Data Layer | 6/10 | SQLite single-writer bottleneck; PostgreSQL path exists but unvalidated |
| API Design | 8/10 | RESTful, versioned, comprehensive; needs OpenAPI spec completion |
| Security | 7.5/10 | JWT+OIDC+SAML+MFA impressive; auth disabled by default is risky |
| Scalability | 5.5/10 | Single-instance Go binary; no horizontal scaling story |
| Observability | 5/10 | OpenTelemetry scaffolded but not instrumented end-to-end |
| Testing | 4.5/10 | 21.2% backend coverage; 7 frontend test files for 130 pages |
| DevOps/CI | 7/10 | Solid CI pipelines; no CD, no staging environment |
| Desktop Integration | 8/10 | Tauri 2.0 sidecar model is elegant and production-proven |

---

## 1. System Architecture Overview

### 1.1 Component Map

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERFACES                          │
├──────────┬──────────┬──────────┬──────────┬────────────────────┤
│ Desktop  │ Web App  │ Mobile   │ kcli     │ AI Assistant       │
│ Tauri2.0 │ React    │ Tauri    │ Go CLI   │ Chat Panel         │
│ macOS/   │ SPA      │ Mobile   │ kubectl  │ (embedded in all)  │
│ Win/Lin  │          │ iOS/And  │ compat   │                    │
├──────────┴──────────┴──────────┴──────────┴────────────────────┤
│                      FRONTEND LAYER                             │
│  React 18 · TypeScript · Vite · TailwindCSS · React Flow       │
│  Zustand (15 stores) · TanStack Query · Framer Motion          │
├─────────────────────────────────────────────────────────────────┤
│                      BACKEND LAYER                              │
│  Go · Gorilla Mux · REST API v1 · WebSocket · gRPC             │
│  ~150 endpoints · JWT/OIDC/SAML auth · Rate limiting            │
├──────────┬──────────┬──────────┬──────────┬────────────────────┤
│ Topology │ Add-on   │ Metrics  │ Auth     │ AI Engine          │
│ Engine   │ Platform │ Server   │ RBAC     │ (gRPC service)     │
│ v2       │ Helm     │ Provider │ MFA      │ kubilitics-ai      │
├──────────┴──────────┴──────────┴──────────┴────────────────────┤
│                      DATA LAYER                                 │
│  SQLite (default) / PostgreSQL (enterprise)                     │
│  41 migrations · Repository pattern · In-memory caches          │
├─────────────────────────────────────────────────────────────────┤
│                    KUBERNETES LAYER                              │
│  client-go · Dynamic client · Discovery cache                   │
│  Circuit breaker · Rate limiter · Multi-cluster                 │
│  47+ native resources · CRD auto-discovery                      │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Deployment Modes

| Mode | Backend | Database | Use Case |
|------|---------|----------|----------|
| Desktop Sidecar | Embedded Go binary on localhost:819 | SQLite | Individual developers |
| In-Cluster (Helm) | K8s Deployment + Service | PostgreSQL | Team/enterprise |
| Standalone Server | VM/bare-metal binary | SQLite or PostgreSQL | Air-gapped, on-prem |

### 1.3 Communication Patterns

| Path | Protocol | Purpose |
|------|----------|---------|
| Frontend → Backend | HTTP REST + WebSocket | All UI operations, real-time updates |
| Backend → Kubernetes | client-go (HTTP/2) | Resource CRUD, watch, metrics |
| Backend → AI Engine | gRPC (protobuf) | Cluster data for AI analysis |
| Desktop Shell → Backend | localhost HTTP | Sidecar communication |
| Backend → Helm | Go library (in-process) | Add-on installation |

---

## 2. Backend Architecture Analysis

### 2.1 Strengths

**Package Organization (A+)**
The `internal/` directory follows Go best practices with clear domain boundaries:

```
internal/
├── addon/          # Complete add-on lifecycle (registry, helm, scanner, resolver)
├── api/            # HTTP handlers, WebSocket, gRPC, middleware
├── auth/           # JWT, OIDC, SAML, MFA — enterprise-grade
├── k8s/            # Kubernetes client wrapper with circuit breaker
├── models/         # Data transfer objects
├── repository/     # Data access (SQLite + PostgreSQL)
├── service/        # Business logic orchestration
├── topology/       # Graph building, relationship inference
├── metrics/        # Metrics aggregation and caching
├── cost/           # Cost attribution (placeholder)
├── audit/          # Audit logging
└── pkg/            # Shared utilities
```

**Key Architectural Decisions (Good)**:
- Circuit breaker per cluster prevents cascading failures
- Repository interface pattern allows SQLite→PostgreSQL migration
- Rate limiting stratified by endpoint type (exec: 10/min, reads: 120/min, writes: 60/min)
- Graceful shutdown with cleanup handlers
- Content-hash-based catalog seeding (skip re-import if unchanged)

**API Surface (Comprehensive)**:
- 150+ REST endpoints covering clusters, resources, topology, metrics, auth, add-ons, shell, exec
- WebSocket for real-time resource updates and topology cache invalidation
- gRPC for AI engine integration
- Health checks (liveness + readiness) for K8s deployment

### 2.2 Concerns

**CONCERN-BE-01: Single-Instance Bottleneck (CRITICAL)**
The backend runs as a single Go process. There is no horizontal scaling story:
- SQLite enforces single-writer
- In-memory caches (topology, metrics, discovery) are process-local
- WebSocket hub is single-instance
- No leader election or work distribution

*Impact:* Limits to ~100 concurrent users and ~10 clusters before performance degrades.
*Recommendation:* For enterprise tier, implement Redis-backed caching, PostgreSQL for writes, and stateless HTTP handlers that can scale behind a load balancer. WebSocket can use Redis PubSub for fan-out.

**CONCERN-BE-02: Database Migration Complexity (HIGH)**
41 SQL migrations in a single migration directory. Current schema supports:
- Auth (users, sessions, tokens, MFA, SAML, groups, permissions)
- Add-ons (catalog, installs, health, audit, policies, rollouts, registries)
- Projects (multi-cluster, multi-namespace groupings)
- Audit log
- Topology snapshots

*Risks:*
- No migration rollback mechanism documented
- SQLite→PostgreSQL migration path exists but is not integration-tested
- Schema drift between SQLite and PostgreSQL implementations possible
- No migration version locking (concurrent startups could race)

**CONCERN-BE-03: Auth Disabled by Default (HIGH)**
`auth_mode` defaults to `disabled`. In desktop mode this is acceptable, but for in-cluster deployments, users must explicitly enable auth. The Helm chart should enforce `auth_mode=required` with a generated JWT secret.

**CONCERN-BE-04: Test Coverage at 21.2% (HIGH)**
Critical paths like topology building, add-on lifecycle, and resource handlers have insufficient test coverage. The 30+ auth tests are good, but business logic is underserved.

**CONCERN-BE-05: Error Response Inconsistency (MEDIUM)**
Error responses use `{"error": "message"}` format but without error codes, correlation IDs in the body, or structured error types. Enterprise integrations need machine-parseable error categories.

**CONCERN-BE-06: No Request Validation Framework (MEDIUM)**
Input validation appears ad-hoc per handler rather than using a validation middleware or schema-driven approach. This increases the surface for injection attacks.

---

## 3. Frontend Architecture Analysis

### 3.1 Strengths

**Technology Stack (Modern)**:
- React 18 with TypeScript, Vite for fast builds
- Zustand for lightweight state (15 stores, well-scoped)
- TanStack Query for server state with proper cache invalidation
- Radix UI primitives for accessible component foundations
- React Flow + ELK.js for production-grade graph visualization

**State Management (Well-Designed)**:
- Clear separation: Zustand for client state, TanStack Query for server state
- Security-conscious: API keys and credentials never persisted to localStorage
- Circuit breaker pattern in API client prevents hammering unreachable backends

**Topology Visualization (Excellent)**:
- Semantic zoom (4 detail levels: minimal → compact → base → expanded)
- 5 view modes (Cluster, Namespace, Workload, Resource, RBAC)
- Keyboard shortcuts (1-5 for views, / for search, S for screenshot)
- Export to PNG/SVG/PDF/JSON
- MAX_VISIBLE_NODES cap (250) prevents browser overload

### 3.2 Concerns

**CONCERN-FE-01: 130 Pages Without Code Generation (CRITICAL)**
130 lazy-loaded page components create massive maintenance burden. Many resource pages (list + detail) follow identical patterns. Without code generation or a resource page factory, every K8s resource addition requires hand-coding two new page files.

*Recommendation:* Build a `ResourceListPage` and `ResourceDetailPage` factory that takes a resource kind config object. This could reduce 100+ pages to ~20 unique pages + 1 factory.

**CONCERN-FE-02: 7 Test Files for 130 Pages (CRITICAL)**
Frontend test coverage is critically low:
- `clusterStore.test.ts` — store mutations
- `backendConfigStore.test.ts` — URL resolution
- `completionEngine.test.ts` — kubectl completion
- `useKubernetes.test.tsx` — K8s hooks
- `useNaturalLanguageSearch.test.ts` — NLP
- `KubeConfigSetup.test.tsx` — config parsing
- `backendApiClient.test.ts` — API client

Missing: topology rendering, dashboard layout, resource pages, form validation, routing, auth flows. A single regression in the topology canvas could ship undetected.

**CONCERN-FE-03: Bundle Size Risk (HIGH)**
The dependency list is heavy:
- Three.js + @react-three/fiber (3D, likely underutilized)
- Monaco Editor + CodeMirror (two editor engines)
- D3 + Recharts + Cytoscape + React Flow (four viz libraries)
- GSAP + Framer Motion (two animation libraries)
- xterm (terminal emulator)

*Estimated bundle:* 3-5MB gzipped. Manual chunk splitting helps but doesn't eliminate the weight.

*Recommendation:* Audit actual usage of Three.js, Cytoscape, and GSAP. If topology v2 fully replaced Cytoscape with React Flow, remove Cytoscape. If GSAP is used in <3 places, migrate to Framer Motion.

**CONCERN-FE-04: TypeScript Strict Mode Disabled (MEDIUM)**
`strict: false` in tsconfig means the codebase likely has implicit `any` types throughout. This undermines TypeScript's value for a codebase this large.

**CONCERN-FE-05: i18n Started but Incomplete (LOW)**
i18next is configured with English and German, but with 130 pages and 240 components, translation coverage is likely minimal. Either invest fully or remove to reduce complexity.

---

## 4. Data Architecture Analysis

### 4.1 Database Design

**Schema Maturity:** The 41-migration schema is well-structured with clear table groupings:

| Domain | Tables | Assessment |
|--------|--------|------------|
| Auth & RBAC | 16 tables | Comprehensive (users, sessions, tokens, MFA, SAML, groups, permissions) |
| Add-on Platform | 17 tables | Full lifecycle (catalog, installs, health, audit, policies, rollouts, registries) |
| Projects | 3 tables | Basic multi-tenancy (projects, cluster associations, namespace associations) |
| Core | 5 tables | Clusters, topology snapshots, resource history, events, preferences |

### 4.2 Concerns

**CONCERN-DB-01: SQLite Write Contention (HIGH)**
SQLite allows only one writer at a time. Under concurrent add-on installs, topology refreshes, and audit logging, write contention will cause `SQLITE_BUSY` errors.

*Recommendation:* Enable WAL mode (Write-Ahead Logging) for SQLite. For enterprise, validate the PostgreSQL path with load testing.

**CONCERN-DB-02: No Data Retention Policy (MEDIUM)**
Tables like `audit_log`, `events`, `resource_history`, and `addon_audit_events` will grow unbounded. No documented retention, archival, or cleanup policy exists.

**CONCERN-DB-03: No Connection Pooling Documentation (MEDIUM)**
For PostgreSQL enterprise deployments, connection pool settings (max connections, idle timeout, max lifetime) are not documented or configurable.

---

## 5. Security Architecture Analysis

### 5.1 Strengths

**Authentication Surface (Enterprise-Grade)**:
- JWT with HS256, access/refresh token flow
- API keys with prefix-based lookup
- OIDC (Google, GitHub, Okta, Azure AD)
- SAML 2.0 (Okta, OneLogin, PingFederate)
- MFA via TOTP with device registration
- Password policy (12+ chars, complexity, history, lockout)

**Authorization Model**:
- Three-tier RBAC (viewer, operator, admin)
- Per-cluster permission overrides
- Per-namespace permissions (planned)
- Fail-closed on DB errors

**Infrastructure Security**:
- Rate limiting stratified by endpoint sensitivity
- CORS validation with origin whitelist
- Secure headers middleware
- Request body size limits
- TLS support (configurable)
- No credentials in localStorage

### 5.2 Concerns

**CONCERN-SEC-01: JWT Secret Management (HIGH)**
`auth_jwt_secret` is configured via environment variable with a minimum 32-character requirement. No integration with Kubernetes Secrets, Vault, or cloud KMS documented.

**CONCERN-SEC-02: Base64 Kubeconfig in Request Headers (HIGH)**
The stateless model (`X-Kubeconfig` header) sends full kubeconfig per request. While flexible, this means cluster credentials transit through HTTP on every request. HTTPS is strongly recommended but not enforced.

**CONCERN-SEC-03: No CSRF Protection (MEDIUM)**
REST endpoints use Bearer tokens (immune to CSRF) but the WebSocket upgrade path should validate origin + token to prevent WebSocket hijacking. Origin validation exists but should be audited.

**CONCERN-SEC-04: Audit Log Immutability (MEDIUM)**
The audit log is stored in the same database as application data. A compromised admin could delete audit entries. True immutability requires write-once storage or external shipping (syslog, SIEM).

---

## 6. Kubernetes Integration Analysis

### 6.1 Resource Coverage

**47+ native resource types** supported across:
- Core (14): Pods, Services, ConfigMaps, Secrets, Namespaces, Nodes, PVs, PVCs, ServiceAccounts, Endpoints, EndpointSlices, Events, ResourceQuotas, LimitRanges
- Apps (5): Deployments, ReplicaSets, StatefulSets, DaemonSets, ControllerRevisions
- Batch (2): Jobs, CronJobs
- Networking (3): Ingresses, IngressClasses, NetworkPolicies
- Storage (4): StorageClasses, VolumeAttachments, CSIDrivers, CSINodes
- RBAC (4): Roles, ClusterRoles, RoleBindings, ClusterRoleBindings
- Autoscaling (1): HorizontalPodAutoscalers
- Policy (1): PodDisruptionBudgets
- Scheduling (1): PriorityClasses
- Discovery (1): EndpointSlices
- DRA (2): ResourceSlices, DeviceClasses
- Snapshots (3): VolumeSnapshots, VolumeSnapshotClasses, VolumeSnapshotContents
- Admission (2): MutatingWebhookConfigurations, ValidatingWebhookConfigurations
- API (2): APIServices, CustomResourceDefinitions
- Coordination (1): Leases
- Node (1): RuntimeClasses

**CRD Support:** Dynamic discovery with 5-minute cache. Generic `ListCRDInstances` endpoint for any CRD.

### 6.2 Concerns

**CONCERN-K8S-01: No Watch-Based Updates (HIGH)**
Resource lists appear to be polling-based rather than using Kubernetes watch/informer pattern for real-time updates. This means:
- Higher API server load (repeated LIST calls)
- Delayed state visibility (poll interval latency)
- No event-driven topology cache invalidation

*Recommendation:* Implement SharedInformerFactory for high-frequency resources (Pods, Deployments, Events).

**CONCERN-K8S-02: No Resource Version Tracking (MEDIUM)**
PATCH operations should use resource versions for optimistic concurrency. Without this, concurrent edits can silently overwrite each other.

**CONCERN-K8S-03: Multi-Cluster Connection Lifecycle (MEDIUM)**
Clusters are auto-loaded from kubeconfig on startup but the lifecycle of lost connections, certificate rotation, and context changes is not well-documented.

---

## 7. Add-on Platform Analysis

### 7.1 Strengths

The add-on platform is architecturally the most mature subsystem:
- 7-check preflight pipeline (connectivity, K8s version, namespace, RBAC, resources, dependencies, dry-run)
- DAG-based dependency resolution with conflict detection
- Full Helm lifecycle (install, upgrade, rollback, uninstall, test)
- Cost attribution models per cluster tier
- Multi-cluster fleet rollouts with status tracking
- Upgrade policies with maintenance windows
- Private registry support (Helm + OCI)
- Embedded core catalog with content-hash seeding

### 7.2 Concerns

**CONCERN-ADDON-01: Catalog Freshness (MEDIUM)**
The core catalog is embedded JSON. Updates require a backend release. Artifact Hub sync provides community charts, but sync frequency and failure handling need validation.

**CONCERN-ADDON-02: Helm Security (MEDIUM)**
Helm chart installation executes arbitrary templates. There is no policy engine (OPA/Kyverno) integration to validate what a chart will deploy before execution.

---

## 8. AI Integration Analysis

### 8.1 Architecture

The AI engine (`kubilitics-ai`) communicates via gRPC with the backend, receiving cluster state data for analysis. The frontend provides an embedded chat panel with multi-LLM support (OpenAI, Anthropic, Ollama, custom).

### 8.2 Concerns

**CONCERN-AI-01: AI Engine Coupling (MEDIUM)**
The gRPC `ClusterDataService` exposes raw cluster state to the AI service. This tight coupling means changes to the backend data model require coordinated AI service updates.

**CONCERN-AI-02: Safety Model Implementation Status (HIGH)**
The PRD defines a sophisticated 5-level autonomy model with immutable safety rules, but the current codebase shows basic AI chat integration without the full safety pipeline (blast-radius calculator, automatic rollback, approval gates).

---

## 9. Recommendations Summary

### P0 — Must Fix Before Enterprise GA

| ID | Issue | Effort | Impact |
|----|-------|--------|--------|
| CONCERN-BE-01 | Horizontal scaling story | Large | Unlocks enterprise tier |
| CONCERN-FE-01 | Resource page factory pattern | Medium | Reduces maintenance 5x |
| CONCERN-FE-02 | Frontend test coverage to 40%+ | Large | Prevents regressions |
| CONCERN-BE-04 | Backend test coverage to 60%+ | Large | Enterprise confidence |
| CONCERN-DB-01 | SQLite WAL mode + PostgreSQL validation | Medium | Production reliability |

### P1 — Should Fix Before Public Launch

| ID | Issue | Effort | Impact |
|----|-------|--------|--------|
| CONCERN-BE-03 | Auth enabled by default in Helm chart | Small | Security posture |
| CONCERN-SEC-01 | Vault/KMS integration for secrets | Medium | Enterprise security |
| CONCERN-K8S-01 | SharedInformerFactory for real-time | Large | Performance + UX |
| CONCERN-FE-03 | Bundle size audit and tree-shaking | Medium | Load performance |
| CONCERN-BE-05 | Structured error responses | Medium | API quality |

### P2 — Should Fix for Enterprise Maturity

| ID | Issue | Effort | Impact |
|----|-------|--------|--------|
| CONCERN-FE-04 | Enable TypeScript strict mode | Large | Type safety |
| CONCERN-DB-02 | Data retention policies | Medium | Operational health |
| CONCERN-SEC-04 | Immutable audit log shipping | Medium | Compliance |
| CONCERN-AI-02 | Full safety model implementation | Large | Differentiator delivery |
| CONCERN-FE-05 | i18n decision (invest or remove) | Medium | Complexity reduction |

---

## 10. Architecture Decision Records (Proposed)

### ADR-001: SQLite as Default Database
- **Status:** Accepted
- **Context:** Desktop and small deployments need zero-config persistence
- **Decision:** SQLite for desktop/small, PostgreSQL for enterprise
- **Risk:** Write contention at scale; must validate PostgreSQL path

### ADR-002: Gorilla Mux for HTTP Routing
- **Status:** Accepted (with caveat)
- **Context:** Gorilla Mux is archived/unmaintained as of Dec 2022
- **Risk:** No security patches. Consider migration to chi or stdlib mux (Go 1.22+)

### ADR-003: Tauri 2.0 for Desktop
- **Status:** Accepted
- **Context:** 5-10x smaller than Electron, native performance, Rust security
- **Decision:** Sidecar Go backend process managed by Tauri
- **Risk:** Tauri ecosystem smaller than Electron; mobile support still maturing

### ADR-004: React Flow for Topology (replacing Cytoscape/D3)
- **Status:** Accepted (v2 migration)
- **Context:** React Flow provides React-native graph rendering with better DX
- **Decision:** Topology v2 uses React Flow + ELK.js layout
- **Risk:** Cytoscape and D3 still in dependencies — should be removed if fully replaced

---

*End of Architecture Audit — Kubilitics OS v1.0*
