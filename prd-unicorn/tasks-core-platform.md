# Kubilitics — Task Rewrite: Core Platform

**Source:** PRD-00 Master Platform
**Date:** 2026-03-16
**Priority Framework:** P0 = blocks launch, P1 = blocks growth, P2 = competitive advantage

---

## Sprint 1: Launch Readiness (2 weeks)

### TASK-CORE-001: Auto-Connect Desktop Mode (P0) ✅
**Goal:** Reduce time-to-first-value from ~4 minutes to <60 seconds
**Acceptance Criteria:**
- [x] Desktop mode auto-detects kubeconfig from `~/.kube/config`
- [x] If single context exists, auto-connect without user interaction
- [x] If multiple contexts, show context picker with "Connect" button (not full ClusterConnect page)
- [x] Show Home page within 10 seconds of first launch
- [x] Non-blocking toast for connection issues (don't block UI)

### TASK-CORE-002: Rename Mode Selection Labels (P0) ✅
**Goal:** Eliminate jargon from first interaction
**Acceptance Criteria:**
- [x] "Desktop Engine" → "Personal (runs locally)"
- [x] "In-Cluster OS" → "Team Server (deployed to cluster)"
- [x] Add one-sentence description under each option
- [x] Add "Not sure? Choose Personal" helper text

### TASK-CORE-003: Complete Dark Mode (P0) ✅
**Goal:** Table-stakes developer tool feature
**Acceptance Criteria:**
- [x] Audit all 240 components for `dark:` class coverage
- [x] Enforce dark backgrounds through CSS variables (ban direct `dark:bg-*` classes)
- [x] Add prominent theme toggle in header
- [x] Verify WCAG AA contrast ratios (4.5:1 text, 3:1 large text) in dark mode
- [x] Fix any components rendering incorrectly in dark mode

### TASK-CORE-004: SQLite WAL Mode (P0) ✅
**Goal:** Prevent write contention in production
**Acceptance Criteria:**
- [x] Enable WAL mode on database initialization
- [x] Verify concurrent read/write behavior under load
- [x] Add database health check to readiness endpoint

### TASK-CORE-005: Auth Required by Default in Helm (P0) ✅
**Goal:** Secure-by-default in-cluster deployments
**Acceptance Criteria:**
- [x] Helm chart sets `auth_mode=required` by default
- [x] Helm chart auto-generates JWT secret if not provided
- [x] Helm chart creates initial admin user from values
- [x] Desktop mode remains `auth_mode=disabled` (local use)

---

## Sprint 2: Navigation & Discovery (2 weeks)

### TASK-CORE-006: Sidebar IA Reduction (P0) ✅
**Goal:** Reduce cognitive load from 13 items to 5-6
**Acceptance Criteria:**
- [x] Restructure sidebar: Home, Dashboard, Topology, Resources (expandable), Add-ons, Settings
- [x] "Resources" expands to show all K8s resource categories
- [x] Add prominent search bar at top of sidebar
- [x] Persist collapsed/expanded state per user

### TASK-CORE-007: Recent Resources Navigation (P1) ✅
**Goal:** Quick access to frequently viewed resources
**Acceptance Criteria:**
- [x] Track last 10 resources viewed (store in localStorage)
- [x] Show "Recent" section in sidebar (collapsible)
- [x] Each recent item shows: resource icon, name, namespace, kind
- [x] Click navigates to resource detail page
- [x] Cmd+[ / Cmd+] for back/forward navigation

### TASK-CORE-008: AI Visibility — Dashboard Card (P0) ✅
**Goal:** Surface AI differentiator on the primary page
**Acceptance Criteria:**
- [x] Add "AI Insights" card to Dashboard showing 2-3 auto-generated observations
- [x] Show AI setup CTA if AI not configured
- [x] Contextual AI buttons on resource detail pages ("Ask AI about this")
- [x] AI chat toggle button in header (not just sidebar)

### TASK-CORE-009: Relationship Tabs on Resource Detail Pages (P1) ✅
**Goal:** Surface topology data on every resource page
**Acceptance Criteria:**
- [x] Add "Relationships" tab to all resource detail pages
- [x] Show mini-topology (1-hop neighbors) using React Flow
- [x] Click on related resource navigates to its detail page
- [x] Lazy-load relationship data (don't slow initial page load)

---

## Sprint 3: Quality & Testing (2 weeks)

### TASK-CORE-010: Backend Test Coverage to 50% (P0) ✅
**Goal:** Prevent regressions before public launch
**Acceptance Criteria:**
- [x] Topology building: 30+ test cases (various cluster configs)
- [x] Add-on lifecycle: 20+ test cases (install, upgrade, rollback, error scenarios)
- [x] Resource handlers: 40+ test cases (CRUD operations)
- [x] Auth middleware: existing tests maintained
- [x] Overall coverage: 50%+ (from 21.2%)

### TASK-CORE-011: Frontend Test Coverage (P1) ✅
**Goal:** Prevent UI regressions
**Acceptance Criteria:**
- [x] Rendering tests for top 10 pages
- [x] Snapshot tests for 24 topology components
- [x] Store mutation tests for all 15 Zustand stores
- [x] E2E: 5 critical user journeys in Playwright

### TASK-CORE-012: Operational Runbooks (P0) ✅
**Goal:** Enable operators to manage production deployments
**Acceptance Criteria:**
- [x] Runbook: Backup and restore database
- [x] Runbook: Rotate JWT secrets
- [x] Runbook: Debug stuck add-on installation
- [x] Runbook: Migrate SQLite to PostgreSQL
- [x] Runbook: Upgrade between versions
- [x] Runbook: Troubleshoot WebSocket disconnections

---

## Sprint 4: Performance & Distribution (2 weeks)

### TASK-CORE-013: Bundle Size Optimization (P1) ✅
**Goal:** Reduce frontend bundle below 2MB gzipped
**Acceptance Criteria:**
- [x] Audit Three.js usage — remove if unused in topology v2
- [x] Audit Cytoscape usage — remove if replaced by React Flow
- [x] Audit GSAP usage — migrate to Framer Motion if <5 uses
- [x] Measure and document bundle size before/after

### TASK-CORE-014: Distribution Packages (P1) ✅
**Goal:** Enable developer installation via package managers
**Acceptance Criteria:**
- [x] Homebrew formula for kcli (macOS/Linux)
- [x] APT package for kcli (Debian/Ubuntu)
- [x] Docker Hub image for backend
- [x] Helm chart in public Helm repository

### TASK-CORE-015: Load Testing Baseline (P1) ✅
**Goal:** Validate performance claims in PRD
**Acceptance Criteria:**
- [x] k6 script: API throughput (target: 1000 req/s)
- [x] k6 script: WebSocket connections (target: 500 concurrent)
- [x] Go benchmark: Topology build time (target: <3s for 1K resources)
- [x] Document results in `docs/PERFORMANCE.md`

---

## Backlog

### TASK-CORE-016: Welcome Onboarding Flow (P1) ✅
3-screen carousel: "Meet Kubilitics" → "See Your Cluster" → "Choose Mode". Implemented in `src/components/onboarding/WelcomeCarousel.tsx`.

### TASK-CORE-017: TypeScript Strict Mode (P2) ✅
Enable `strict: true`, fix all implicit `any` types. Utility types in `src/lib/strict-types.ts`.

### TASK-CORE-018: Resource Page Factory (P1) ✅
Build generic `ResourceListPage` and `ResourceDetailPage` components that reduce 100+ pages to ~20 + 1 factory. See `src/components/factory/`.

### TASK-CORE-019: i18n Decision (P2) ✅
Either invest in full i18n (all strings externalized) or remove i18next dependency. Decision documented in `docs/architecture/i18n-decision.md`.

### TASK-CORE-020: Notification Center (P2) ✅
Bell icon in header aggregating cluster events, AI observations, add-on status changes. Implemented in `src/components/notifications/NotificationCenter.tsx`.

---

*Total Tasks: 20 | P0: 8 | P1: 9 | P2: 3 | ✅ All Complete*
