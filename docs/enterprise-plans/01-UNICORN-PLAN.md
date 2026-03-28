# KUBILITICS UNICORN PLAN — Becoming the #1 Free K8s Tool on Earth

**Date:** March 27, 2026
**Input:** 5-agent codebase audit + competitor research (Aptakube, Headlamp, Lens, k9s)

---

## 🔴 CRITICAL ISSUES (Must Fix Now)

### 1. Dark Mode Is Incomplete
We fixed 20+ components this session, but 130+ page files haven't been audited for full dark mode. 73% of developers prefer dark mode. **This is a launch blocker** — no dev tool ships in 2026 without dark mode.

### 2. Fleet Dashboard Backend Missing
`/api/v1/fleet/search` doesn't exist. The Fleet page is a cluster list, not a fleet dashboard. Enterprises with 10+ clusters need aggregated metrics, cross-cluster search, fleet health scoring. **Enterprise blocker.**

### 3. Cross-Cluster Search Not Implemented
Frontend `CrossClusterSearch` component exists but backend endpoint is missing. Users with multiple clusters can't search across them. Every competitor fails at this too — **opportunity to differentiate.**

### 4. Multi-Select & Bulk Operations Missing
The #1 most requested feature across ALL competitors (Aptakube #524, #522, #358; Headlamp similar). Users can't select 5 pods and restart them. **"Super basic feature needed"** — direct user quote.

### 5. RBAC Permission Matrix Incomplete
Users can view individual Roles/Bindings but can't answer "Who has access to what?" — the question every security team asks. Component exists but analysis logic is missing.

---

## 🟠 STRATEGIC GAPS (Why We Won't Win Yet)

### 1. No Stern-Like Log Experience
Every competitor's #1 complaint is log viewing — "wall of text", no search context lines, no JSON prettify, no multi-pod streaming. `stern` CLI solves this but no GUI tool has replicated it. **Whoever builds stern-in-GUI wins the debugging workflow.**

### 2. No Cluster Context Organization
Users with 20+ clusters (Aptakube #442, #17) need groups, tags, favorites, color-coding by environment (prod = red, staging = yellow). Currently Kubilitics shows a flat list.

### 3. No Notifications for State Changes
Headlamp #4118 — users can't be notified when pods finish pulling, when deployments complete, when resources change state. **Background monitoring without constant UI checking.**

### 4. Authentication Fragility
OIDC/SAML scaffolding exists but hasn't been battle-tested with Okta, Azure AD, Keycloak, Google Workspace. Auth failures are the #1 blocker for team adoption across ALL competitors.

### 5. No PVC Browser
Users can't inspect persistent volume data without creating debug containers. Aptakube #229 — pod crashes when trying to browse PVC files. **Unique feature opportunity.**

---

## 🟢 WHAT WE GOT RIGHT (Retain & Strengthen)

| Feature | Assessment | Competitor Status |
|---------|-----------|-------------------|
| **Live Topology Graph** | Working, xyflow-based, 10 months of dev | **No competitor has this** |
| **Blast Radius / Impact Analysis** | Frontend exists, backend partial | **No competitor attempts this** |
| **Cross-Namespace Compare** | Just built this session, cross-namespace + owner grouping | **Unique to Kubilitics** |
| **52 Resource Types** | All with list + detail pages | More than Lens (~20), k9s (~30) |
| **Working Terminal** | Real WebSocket exec, not simulated | Matches k9s/Lens |
| **Working Port Forward** | Spawns real kubectl port-forward | Competitors frequently broken |
| **File Transfer** | Upload/download from containers | Only Headlamp has this |
| **Integrated YAML Editor** | Monaco with conflict detection (409) | Better than competitors |
| **Rollout History + Rollback** | Real K8s revision tracking | Unique visualization |
| **Desktop + In-Cluster** | Same codebase, Tauri + Helm | Only Rancher does both |
| **Health Bars on Dashboard** | Per-resource health computed from live K8s | No competitor does this |
| **Gzip + Pagination** | Production-grade API | Enterprise-ready |
| **283 Tests** | Hooks, components, API client tested | Better than most OSS |

---

## 🚀 TOP 10 FEATURES TO MAKE KUBILITICS #1

Based on competitor gaps + real user pain + our existing strengths:

### 1. Multi-Select & Bulk Operations (Week 1-2)
**Why:** #1 requested feature across ALL competitors. "Super basic feature needed."
- Select multiple pods/deployments via checkboxes
- Bulk actions: restart, delete, scale, label
- Shift+click range selection, Cmd+click individual
- **Impact:** Immediately differentiates from every competitor
- **Effort:** 5 days

### 2. Stern-in-GUI Log Viewer (Week 2-3)
**Why:** Every competitor's log viewer is "a wall of text." stern CLI is beloved but has no GUI.
- Multi-pod log streaming (follow all pods in a deployment)
- Context lines (grep -A -B equivalent)
- JSON log prettification with field extraction
- Log search with regex support
- Filter by container, log level, time range
- Save/share log snippets
- **Impact:** Wins the debugging workflow — the most time-spent activity for K8s users
- **Effort:** 8 days

### 3. Cluster Context Organization (Week 3-4)
**Why:** Users with 20+ clusters can't find anything. No tool solves this.
- Context groups (Production, Staging, Development)
- Color-coding per environment (red = prod, yellow = staging, green = dev)
- Favorites / pinned clusters
- Fuzzy search across all contexts
- Danger indicators for production contexts (confirmation dialogs)
- **Impact:** Makes Kubilitics the only tool that scales with org size
- **Effort:** 5 days

### 4. Fleet Dashboard with Cross-Cluster Search (Week 4-6)
**Why:** Enterprise blocker. No tool does cross-cluster search well.
- Aggregated fleet health score
- Cross-cluster search ("find all pods running nginx:1.24 across ALL clusters")
- Fleet-wide resource counts
- Cluster drift detection (cluster A has different configs than cluster B)
- Cost overview per cluster
- **Impact:** Unlocks enterprise market
- **Effort:** 10 days

### 5. Smart Notifications & Event Stream (Week 5-6)
**Why:** Headlamp #4118 — users can't know when things change without staring at the UI.
- Desktop notifications for: pod crashes, deployment rollout complete, HPA scaling events
- Configurable notification rules (notify me when prod namespace has errors)
- Notification center in sidebar
- Integration hooks (Slack webhook, PagerDuty)
- **Impact:** Makes Kubilitics the "background monitor" — always watching
- **Effort:** 5 days

### 6. PVC File Browser (Week 6-7)
**Why:** No competitor can safely browse persistent volume data. Aptakube #229 crashes.
- Browse PVC contents without creating debug containers
- Uses ephemeral containers or volume-attached temporary pods
- File preview (text, JSON, YAML, images)
- Download files from PVCs
- **Impact:** Unique feature no one else offers
- **Effort:** 5 days

### 7. RBAC Analyzer ("Who Can Do What") (Week 7-8)
**Why:** Security teams ask this daily. No tool answers it visually.
- Permission matrix: User × Resource × Verb grid
- "Who can delete pods in production?" instant answer
- Effective permissions (Role + ClusterRole + RoleBinding resolution)
- Over-privileged user detection
- RBAC diff between namespaces
- **Impact:** Wins security team buy-in (gate to enterprise purchase)
- **Effort:** 8 days

### 8. Resource Templates & Quick Create (Week 8-9)
**Why:** Creating resources from scratch is painful. Users want starter templates.
- Template gallery: Deployment, Service, Ingress, ConfigMap, Job, CronJob
- Smart defaults (namespace pre-filled, labels pre-populated)
- Helm values editor for common charts
- "Clone this resource to another namespace" one-click action
- **Impact:** Reduces time-to-deploy for development teams
- **Effort:** 5 days

### 9. Blast Radius Backend (Full Implementation) (Week 8-12)
**Why:** USP #2. Frontend exists. Backend dependency inference engine is the missing piece.
- Infer service dependencies from env vars, ConfigMaps, Ingress rules, NetworkPolicy
- Criticality scoring (weighted: in-degree, fan-out, data store proximity)
- Failure simulation timeline
- SPOF detection
- Pre-deployment risk score API (CI/CD integration)
- **Impact:** "What breaks if this fails?" — the question that makes CTOs say "we need this"
- **Effort:** 30 days

### 10. Dark Mode (Complete) (Week 1, parallel)
**Why:** 73% of developers prefer dark mode. Launch blocker.
- Full audit of all 130+ pages
- CSS variable-based theming (already started)
- Automatic OS preference detection (already works)
- **Impact:** Table stakes — can't ship without it
- **Effort:** 3 days (foundation already in place from this session)

---

## FEATURES TO REMOVE OR NOT BUILD

| Feature | Decision | Reason |
|---------|----------|--------|
| **Addon Fleet Rollout API** | Keep but don't prioritize UI | Enterprises use ArgoCD/Flux, not Kubilitics for deployments |
| **3D Topology (Three.js)** | Already removed | Gimmick, not useful. 2D topology is the real USP |
| **AI YAML Generation** | Defer to post-kotg.ai | Generic LLM YAML is dangerous. Wait for specialized model |
| **Custom Dashboards Builder** | Don't build | Grafana owns this space. Don't compete. |
| **Built-in Prometheus** | Don't build | Users already have monitoring. Integrate, don't replace. |
| **Kubernetes Autopilot** | Defer to kotg.ai era | Needs custom LLM, too risky with generic AI |
| **Plugin System** | Defer | Headlamp has this, users rarely use plugins. Focus on core. |
| **Cluster Provisioning** | Don't build | Terraform/Pulumi/eksctl own this. Kubilitics is post-provisioning. |

---

## DIFFERENTIATION STRATEGY

### Why Users Will Switch

**From Lens:** "Lens went paid. Kubilitics is free AND has topology + blast radius."
**From k9s:** "I love k9s but need a GUI to share with my team. Kubilitics has the same power in a GUI."
**From Rancher:** "Rancher needs its own infrastructure. Kubilitics is a single binary."
**From Aptakube:** "Aptakube crashes with 20 clusters. Kubilitics has fleet management."
**From Headlamp:** "Headlamp's OIDC breaks every week. Kubilitics just works."
**From Komodor:** "Komodor is $49/user. Kubilitics is free and shows me more."

### The One-Line Pitch
> **"Kubilitics is what Lens should have been — free, with topology that shows what breaks before you deploy."**

---

## 90-DAY EXECUTION PLAN

### Phase 1: STABILIZE (Days 1-30)
**Goal:** Ship v1.0 desktop app. First 1,000 users.

| Week | Deliverable |
|------|-------------|
| 1 | Dark mode complete + multi-select bulk operations + code signing |
| 2 | Stern-in-GUI log viewer + auto-update infrastructure |
| 3 | Cluster context organization (groups, colors, favorites) |
| 4 | Performance hardening + bug fixing + v1.0 release |

**Exit criteria:** App doesn't crash, doesn't show fake data, handles 20+ clusters smoothly.

### Phase 2: DIFFERENTIATE (Days 31-60)
**Goal:** Features no competitor has. First 10,000 users.

| Week | Deliverable |
|------|-------------|
| 5-6 | Fleet dashboard + cross-cluster search |
| 6-7 | Smart notifications + PVC browser |
| 7-8 | RBAC analyzer + resource templates |

**Exit criteria:** 3+ features that make users say "no other tool does this."

### Phase 3: DOMINATE (Days 61-90)
**Goal:** Blast radius USP complete. Enterprise interest.

| Week | Deliverable |
|------|-------------|
| 8-10 | Blast radius backend (dependency inference, criticality scoring) |
| 10-11 | Failure simulation timeline + SPOF detection |
| 11-12 | CI/CD risk score API + enterprise demo preparation |

**Exit criteria:** Live demo showing "if payment-service fails, 35% of your mesh is affected" with cascade visualization.

---

## IF KUBILITICS LAUNCHES TODAY

### Why It Will Fail
1. **No dark mode** — developers will close it in 30 seconds
2. **No multi-select** — power users will say "this is nice but I can't work in it"
3. **No stern-like logs** — debugging (the #1 workflow) is still better in CLI
4. **No code signing** — macOS will block installation with scary warnings
5. **No auto-update** — users stuck on first version forever

### What Must Change to Make It Inevitable
1. **Dark mode + code signing** — remove the instant-rejection barriers (Week 1)
2. **Multi-select + stern logs** — win the daily workflow (Week 2-3)
3. **Topology + blast radius** — the demo that makes CTOs drop everything (Week 8-12)
4. **Free forever** — the pricing that makes Lens/Komodor/Aptakube users switch overnight

**The formula:**
> Free + Better UX + Topology USP + Blast Radius USP = Inevitable

---

*Version 1.0 | March 27, 2026*
*Next review: After Phase 1 completion (Day 30)*
