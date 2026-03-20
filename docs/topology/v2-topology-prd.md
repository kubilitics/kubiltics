# KUBILITICS TOPOLOGY ENGINE v2.0 — Product Requirements Document

**Product:** Kubilitics Topology Engine v2.0 (Complete Rewrite)
**Status:** Specification Complete — Ready for Development
**Priority:** P0 — This IS the product. Everything else is secondary.
**Date:** March 2026
**Classification:** Internal Engineering + Design
**Authors:** Koti Vellanki, Engineering Team

---

## 0. Why This Rewrite Exists

The topology engine is Kubilitics' single most important differentiator. It is the reason the platform exists. After 100+ iterations, these problems persist and are non-negotiable to fix:

### The 8 Failures That Cannot Continue

1. **Missing connections** — A pod connected to 15 resources in the cluster shows 2-3 connections. ReplicaSets, Services, Endpoints, EndpointSlices, ConfigMaps, Secrets, PVCs, PVs, StorageClasses, ServiceAccounts, Roles, RoleBindings, HPAs, PDBs, NetworkPolicies, Nodes — if a resource touches another resource, that connection MUST appear. Period.

2. **Visual chaos** — Colors are random. Text is unreadable. There is no information hierarchy. A CXO sees noise. An SRE sees nothing useful. The topology communicates nothing at a glance.

3. **Viewport failures** — Nodes get cut off. You can't scroll to see all connected resources. Zoom in and half the nodes disappear. Zoom out and everything becomes illegible. The viewport is broken.

4. **No zoom intelligence** — A 5-resource view and a 500-resource view render identically. There is no progressive disclosure, no semantic zoom, no level-of-detail adjustment.

5. **No resource-centric mode** — When viewing a Pod, you should see EVERY connected resource: its ReplicaSet, Deployment/StatefulSet/DaemonSet, Services, Endpoints, EndpointSlices, Nodes, Namespaces, Secrets, ConfigMaps, PVCs, PVs, StorageClasses, ServiceAccounts, Roles, RoleBindings, HPAs, PDBs, NetworkPolicies, Ingresses, IngressClasses — with clear labels explaining HOW each connection exists.

6. **Layout thrashing** — Different layout algorithms produce wildly different results. Refresh the page, get a different layout. There is no deterministic, predictable positioning.

7. **No hierarchy** — Kubernetes has a natural hierarchy (Namespace contains Deployment contains ReplicaSet contains Pod). The topology ignores this completely.

8. **Useless for everyone** — An SRE at 3 AM gets zero value. A CXO in a review gets zero insight. A platform engineer onboarding gets zero understanding. The topology fails every user.

**This document specifies the complete rewrite.** Not a patch. Not an iteration. A ground-up rebuild of every layer: data model, graph construction, layout engine, rendering, interaction, and export.

---

## 1. Product Vision

### The One-Line Vision

**"Click any Kubernetes resource and instantly see everything connected to it, how it's connected, and whether anything is wrong — in a view so clear that a CXO understands it and an SRE trusts it."**

### The Experience Standard

Every interaction must meet this bar: **Would Apple ship this?**

That means:
- Every animation feels natural, never janky
- Every transition tells you where you came from and where you're going
- Every click produces an immediate, visible response
- Every piece of information earns its pixel — nothing decorative, nothing wasted
- Every state is designed: loading, empty, error, partial, success
- The topology should feel like a living, breathing map of your infrastructure — not a static diagram

### What Success Looks Like

A platform engineer opens the topology for a Pod called `payment-api-7d8b9c-xyz` in the `production` namespace. In under 2 seconds, they see:

```
                                    ┌─────────────┐
                                    │  Namespace   │
                                    │  production  │
                                    └──────┬──────┘
                                           │ contains
                    ┌──────────────────────┼──────────────────────┐
                    │                      │                      │
             ┌──────▼──────┐       ┌──────▼──────┐       ┌──────▼──────┐
             │ Deployment  │       │   Service    │       │   Ingress   │
             │ payment-api │       │ payment-svc  │       │ payment-ing │
             │ ● Healthy   │       │ ClusterIP    │       │ nginx class │
             └──────┬──────┘       └──────┬──────┘       └──────┬──────┘
                    │ owns                │ selects              │ routes to
             ┌──────▼──────┐       ┌──────▼──────┐       ┌──────┘
             │ ReplicaSet  │       │  Endpoints   │       │
             │ pay-api-7d8 │       │ payment-svc  │       │
             │ 3/3 ready   │       │ 3 addresses  │       │
             └──────┬──────┘       └──────┬──────┘       │
                    │ owns                │ targets       │
             ┌──────▼──────────────────────▼──────────────▼──────┐
             │                   Pod                              │
             │          payment-api-7d8b9c-xyz                    │
             │          ● Running  │  Node: ip-10-0-1-11          │
             │          CPU: 45%   │  Memory: 67%                 │
             └──┬───┬───┬───┬───┬───┬───┬───┬───┬───────────────┘
                │   │   │   │   │   │   │   │   │
                ▼   ▼   ▼   ▼   ▼   ▼   ▼   ▼   ▼
              PDB  HPA  NP  Node  SA  Secret Secret CM  PVC
                                        │              │
                                   RoleBinding    PV → SC
                                        │
                                      Role
```

**Every single resource connected to that pod is visible.** Every edge has a label. Health is color-coded. Metrics are inline. You can scroll vertically and horizontally to see everything — nothing is cut off, nothing is hidden, nothing is broken.

---

## 2. Target Users and Their Needs

### 2.1 SRE During an Incident (Primary)

**Scenario:** 3 AM page. `payment-api` pods are CrashLoopBackOff.
**Need:** In 5 seconds, see: which Deployment owns these pods, which Secrets they mount, which Node they're on, which Services route to them, whether the HPA is scaling, whether a PDB is blocking restarts.
**Current failure:** The topology shows the pod floating with 2-3 connections. The SRE still has to run 8 kubectl commands.
**Required:** One click on the pod, every connected resource visible, every relationship labeled, every health signal color-coded.
**Deep-link requirement:** Alert systems (PagerDuty, OpsGenie, Slack) must link directly to `/topology/{cluster}/resource/Pod/{ns}/{name}` — one click from alert to full resource topology. No navigation required.

### 2.2 Platform Engineer Reviewing Architecture (Primary)

**Scenario:** New engineer joins the team. Needs to understand the `checkout` namespace.
**Need:** A namespace-level topology showing all workloads, how they connect via Services, what storage they use, what RBAC is in play.
**Current failure:** The namespace topology is a jumble of nodes with no visual hierarchy. Faster to read YAML.
**Required:** Clear, hierarchical, color-coded namespace map. Left-to-right flow: Ingress, Service, Workload, Storage. Screenshot-worthy for design reviews.

### 2.3 CXO / Engineering Manager (Secondary)

**Scenario:** VP of Engineering wants to understand production cluster health.
**Need:** Cluster-level view with namespaces as groups, health indicators, cost annotations, problem highlights.
**Current failure:** Incomprehensible hairball of 500+ nodes.
**Required:** Progressive-disclosure view: start with namespaces, expand to workloads, expand to pods, expand to full resource graph.

### 2.4 Security Engineer Auditing RBAC (Secondary)

**Scenario:** Quarterly security audit of RBAC policies.
**Need:** See all ServiceAccounts, their RoleBindings, Roles, and permissions — as a visual graph.
**Current failure:** RBAC relationships are not in the topology at all.
**Required:** Dedicated RBAC topology view showing the complete permission chain. Highlight cluster-admin and wildcard permissions in red.

---

## 3. Design Principles (Non-Negotiable)

These are hard rules. Every topology feature must satisfy them. Every PR is reviewed against them.

### Principle 1: EVERY Connection Must Be Shown

If resource A has any relationship to resource B in Kubernetes, the topology MUST show it.

**Complete relationship registry (39+ relationship types):**

| # | Source | Target | Relationship | Edge Label | Detection Method |
|---|--------|--------|-------------|------------|------------------|
| 1 | Pod | ReplicaSet | owned by | `ownerRef` | `metadata.ownerReferences` |
| 2 | Pod | Node | scheduled on | `nodeName` | `spec.nodeName` |
| 3 | Pod | Namespace | belongs to | `namespace` | `metadata.namespace` |
| 4 | Pod | ServiceAccount | uses identity | `serviceAccountName` | `spec.serviceAccountName` |
| 5 | Pod | ConfigMap | mounts config | `volume mount` | `spec.volumes[].configMap` |
| 6 | Pod | Secret | mounts secret | `volume mount` | `spec.volumes[].secret` |
| 7 | Pod | PVC | mounts volume | `volume mount` | `spec.volumes[].persistentVolumeClaim` |
| 8 | Pod | ConfigMap | env from | `envFrom` | `spec.containers[].envFrom[].configMapRef` |
| 9 | Pod | Secret | env from | `envFrom` | `spec.containers[].envFrom[].secretRef` |
| 10 | Pod | ConfigMap | env value | `env ref` | `spec.containers[].env[].valueFrom.configMapKeyRef` |
| 11 | Pod | Secret | env value | `env ref` | `spec.containers[].env[].valueFrom.secretKeyRef` |
| 12 | Pod | PriorityClass | priority | `priorityClass` | `spec.priorityClassName` |
| 13 | Pod | RuntimeClass | runtime | `runtimeClass` | `spec.runtimeClassName` |
| 14 | ReplicaSet | Deployment | owned by | `ownerRef` | `metadata.ownerReferences` |
| 15 | Pod | StatefulSet | owned by | `ownerRef` | `metadata.ownerReferences` |
| 16 | Pod | DaemonSet | owned by | `ownerRef` | `metadata.ownerReferences` |
| 17 | Pod | Job | owned by | `ownerRef` | `metadata.ownerReferences` |
| 18 | Job | CronJob | owned by | `ownerRef` | `metadata.ownerReferences` |
| 19 | Service | Pod | selects | `selector match` | `spec.selector` matches `pod.metadata.labels` |
| 20 | Service | Endpoints | auto-created | `same name` | `endpoints.metadata.name == service.metadata.name` |
| 21 | Service | EndpointSlice | manages | `label match` | `endpointSlice.labels["kubernetes.io/service-name"]` |
| 22 | Endpoints | Pod | targets | `address ref` | `subsets[].addresses[].targetRef` |
| 23 | EndpointSlice | Pod | targets | `endpoint ref` | `endpoints[].targetRef` |
| 24 | Ingress | Service | routes to | `backend` | `spec.rules[].http.paths[].backend.service` |
| 25 | Ingress | IngressClass | class | `ingressClassName` | `spec.ingressClassName` |
| 26 | Ingress | Secret | TLS cert | `tls secret` | `spec.tls[].secretName` |
| 27 | PVC | PV | bound to | `binding` | `spec.volumeName` / `pv.spec.claimRef` |
| 28 | PV | StorageClass | provisioned by | `storageClass` | `spec.storageClassName` |
| 29 | PVC | StorageClass | requests from | `storageClass` | `spec.storageClassName` |
| 30 | ServiceAccount | Secret | token secret | `secret ref` | `secrets[].name` |
| 31 | RoleBinding | Role | binds | `roleRef` | `roleRef.name + kind` |
| 32 | RoleBinding | ServiceAccount | grants to | `subject` | `subjects[].name where kind=ServiceAccount` |
| 33 | ClusterRoleBinding | ClusterRole | binds | `roleRef` | `roleRef.name + kind` |
| 34 | ClusterRoleBinding | ServiceAccount | grants to | `subject` | `subjects[].name where kind=ServiceAccount` |
| 35 | HPA | Deployment/SS | scales | `scaleTargetRef` | `spec.scaleTargetRef` |
| 36 | PDB | Pod | protects | `selector match` | `spec.selector` matches `pod.metadata.labels` |
| 37 | NetworkPolicy | Pod | applies to | `podSelector` | `spec.podSelector` matches `pod.metadata.labels` |
| 38 | MutatingWebhook | Service | calls | `webhook service` | `webhooks[].clientConfig.service` |
| 39 | ValidatingWebhook | Service | calls | `webhook service` | `webhooks[].clientConfig.service` |

**If a relationship exists in Kubernetes and is not in this table, add it before shipping.**

### Principle 2: Every Edge Must Be Labeled

A line between two nodes without a label is useless. Every edge MUST display:
- **Relationship type** (e.g., "mounts secret", "selects", "owned by")
- **Relationship detail** when relevant (e.g., "mounted at /etc/config", "port 8080 to 80")

### Principle 3: Visual Clarity at Apple's Standard

- **Minimum contrast ratio: 4.5:1** (WCAG AA) for ALL text against ALL backgrounds
- **Minimum text size: 12px** at any zoom level where text is rendered
- **No overlapping labels** — the layout engine must guarantee label separation
- **No cut-off nodes** — every node must be fully visible. Scroll/pan must reveal everything.
- **Consistent node sizing** — nodes of the same type have the same dimensions
- **Status colors** — only 4: Green (healthy), Yellow (warning), Red (error), Gray (unknown)
- **Color + shape + text** for every status indicator — never rely on color alone

### Principle 4: The Viewport Must Work Perfectly

- **Scroll vertically AND horizontally** to see all connected resources — infinite canvas
- **Fit-to-screen** button that zooms to show the entire graph with 40px padding
- **Pan** with mouse drag on empty canvas (cursor: grab, grabbing)
- **Zoom** with scroll wheel (centered on cursor), pinch (touch), +/- buttons
- **Minimap** always visible, showing full graph with draggable viewport indicator
- **No cut-off** — pan limits extend 500px beyond content bounds in all directions
- **Smooth transitions** — 200ms ease-out for zoom, 300ms for layout changes
- When a resource has 30 connected nodes, you MUST be able to scroll to see all 30. No hiding. No collapsing into an unreadable badge. Every connection visible.

### Principle 5: Progressive Disclosure

A cluster with 2,000 resources cannot render everything at once. Five levels:

| Level | View | What's Shown | Entry |
|-------|------|-------------|-------|
| 0 | Cluster Overview | Namespaces as groups with health badges, workload counts | Default for cluster |
| 1 | Namespace View | Workloads, Services, Ingress, Storage — left-to-right flow | Click namespace |
| 2 | Workload View | Deployment with all RS, Pods, HPA, PDB, connected Services | Click workload |
| 3 | Resource-Centric | EVERY connection for selected resource (the critical mode) | Double-click any resource |
| 4 | RBAC View | ServiceAccounts, RoleBindings, Roles, permissions | Toolbar: RBAC mode |

Users drill down by clicking. Escape or breadcrumb goes back. URL updates for bookmarking.

### Principle 6: Deterministic Layout

Same resources, same layout. Every time. No random placement. No layout drift between page loads. ELK layered algorithm with fixed seed (42). Same input produces byte-identical output.

### Principle 7: Performance Budgets

| Metric | Target | Hard Limit |
|--------|--------|------------|
| Time to first render (< 100 resources) | < 500ms | 1s |
| Time to first render (100-500 resources) | < 1.5s | 3s |
| Time to first render (500-2000 resources) | < 3s | 5s |
| Frame rate during pan/zoom | 60fps | 30fps |
| Memory for 2000-node graph | < 150MB | 250MB |
| Edge label render time | < 100ms | 200ms |

### Principle 8: Every Interaction Must Feel Intentional

Inspired by Apple's Human Interface Guidelines:
- Every click produces immediate visual feedback (< 100ms)
- Every transition communicates spatial relationships (where you came from, where you're going)
- Loading states are designed (skeleton layout with placeholder nodes, not a spinner)
- Error states are helpful ("Unable to load Secrets — some connections may be missing")
- Empty states guide the user ("No resources found in this namespace")
- Stale data is surfaced ("Connection lost. Last updated 30s ago. Reconnecting...")

---

## 4. Technology Decision: React Flow v12 + ELK.js

### Why React Flow v12 (Not Cytoscape.js, Not D3.js)

After evaluating all major graph visualization libraries:

| Requirement | React Flow v12 | Cytoscape.js | D3.js |
|------------|----------------|-------------|-------|
| **Custom node rendering (full React components)** | Native | Limited (HTML labels) | Manual SVG |
| **Custom edge rendering with labels** | Native EdgeLabelRenderer | SVG only | Manual |
| **React integration** | Native, first-class | Wrapper, fights React | Manual, no integration |
| **Compound nodes (groups/containers)** | First-class support | Basic | Manual |
| **Virtualization (render only visible)** | Built-in | Canvas-based | Manual |
| **Accessibility (ARIA, keyboard)** | Built-in support | Poor | Manual |
| **TypeScript** | Built in TypeScript | Types available | Types available |
| **Minimap** | Built-in component | Plugin required | Manual |
| **Dark mode theming** | React context + CSS | CSS only | Manual |
| **Performance (1000+ nodes)** | Good with virtualization | Excellent (WebGL) | Depends on impl |

**Decision:** React Flow v12 for rendering + ELK.js (via Web Worker) for deterministic layout.

React Flow gives us full React component rendering for nodes and edges. This means our design system is implemented natively — not as Cytoscape HTML labels fighting the library. ELK provides deterministic, hierarchical layout that respects parent-child relationships and semantic layers.

For graphs exceeding 2000 nodes, we implement semantic zoom (colored rectangles at low zoom, compact nodes at medium zoom, full detail at high zoom) to keep DOM node count manageable.

### Why Not Cytoscape.js

Cytoscape excels at large-scale network analysis but limits custom node rendering. We need rich React components inside nodes (progress bars, metric badges, health indicators). Cytoscape's HTML label approach is a workaround, not a solution.

### Why Not D3.js Alone

D3 offers unlimited customization but requires building everything from scratch: layout, interaction, selection, virtualization, accessibility. Development time would triple.

### Hybrid Consideration

ELK.js layout algorithms can be run headless (in a Web Worker). React Flow handles all rendering and interaction. This gives us the best of both: performant graph algorithms + rich React-based UI.

---

## 5. Topology View Modes

### 5.1 Cluster Overview Mode

**Purpose:** High-level cluster health for managers and CXOs.

**What's shown:**
- Each namespace as a colored group box
- Inside: workload count badges (Deployments, StatefulSets, DaemonSets)
- Health indicator per namespace: green/yellow/red based on pod health ratio
- Node sidebar: cluster nodes with CPU/memory utilization bars
- Cross-namespace connections shown as thin lines between namespace boxes

**Interactions:**
- Click namespace → zoom into Namespace View
- Hover namespace → tooltip with resource count, cost, health score
- Right-click → "View in Namespace mode", "Filter topology"

### 5.2 Namespace View Mode

**Purpose:** Architecture overview for platform engineers.

**What's shown:**
- Workloads (Deployment, StatefulSet, DaemonSet, Job, CronJob) as primary nodes
- Services connected to target workloads
- Ingresses connected to backend Services
- Storage (PVCs) connected to workloads
- ConfigMaps and Secrets mounted by workloads (grouped)
- RBAC chain: ServiceAccounts, RoleBindings, Roles (collapsed by default)

**Layout:** Left-to-right flow: Ingress, Service, Workload, Storage
- RBAC below the main flow
- ConfigMaps/Secrets above the main flow

### 5.3 Workload View Mode

**Purpose:** Drill into a specific Deployment/StatefulSet/DaemonSet.

**What's shown:**
- The workload as center node
- All ReplicaSets (current + previous, with revision numbers)
- All Pods in current ReplicaSet with individual health
- HPA connected to workload
- PDB connected to workload's pods
- Services selecting this workload's pods
- All ConfigMaps, Secrets, PVCs mounted by these pods

### 5.4 Resource-Centric View Mode (THE CRITICAL MODE)

**Purpose:** Show EVERY resource connected to a selected resource. This mode must be perfect.

**What's shown for a Pod:**

| Category | Resources | Connection Detail |
|----------|-----------|-------------------|
| Ownership | ReplicaSet, Deployment (or StatefulSet/DaemonSet/Job, CronJob) | `ownerRef` chain fully traced |
| Networking | Services selecting this pod, Endpoints, EndpointSlices, Ingresses routing to Services, NetworkPolicies applied | selector match, backend routing |
| Scheduling | Node the pod runs on, PriorityClass, RuntimeClass | `spec.nodeName`, `priorityClassName` |
| Configuration | Every ConfigMap (volume + envFrom + env valueFrom), Every Secret (volume + envFrom + env valueFrom + imagePullSecrets) | mount path, key reference |
| Storage | Every PVC, PV, StorageClass | volume mount path |
| Identity | ServiceAccount, RoleBindings, Roles, ClusterRoleBindings, ClusterRoles | full RBAC chain |
| Scaling | HPA targeting parent workload | scaleTargetRef |
| Disruption | PDB selecting this pod | selector match |
| Namespace | The Namespace (with quotas, limits) | metadata.namespace |

**Viewport guarantee:** If a pod has 30 connected resources, all 30 MUST be visible by scrolling. No resources hidden. No "show more" buttons. No collapsed badges that hide information. The canvas must be scrollable vertically and horizontally to reveal every connection.

**Resource popup (click any node):** A detail panel slides in showing:
- Resource kind, name, namespace
- Status with health indicator
- Key fields (specific to resource type — see Section 6)
- "Go to Resource" button — navigates to that resource's own topology
- "View YAML" — opens raw YAML viewer
- "View Logs" — (pods only) opens log viewer
- "Copy Name" — copies full resource path to clipboard

**What's shown for a Service:**

| Category | Resources | Connection Detail |
|----------|-----------|-------------------|
| Targets | All Pods selected | selector match + port mapping |
| Endpoints | Endpoints and EndpointSlice resources | auto-created, address list |
| Routing | Ingresses routing to this Service | backend reference + path rules |
| Workloads | Deployment/StatefulSet/DaemonSet owning the Pods | ownerRef chain |
| Network | NetworkPolicies referencing this Service or its pods | ingress/egress rules |
| Webhooks | Webhooks calling this Service | clientConfig.service |

**This mode MUST be implemented for ALL resource types.** The relationship registry defines the complete connection set.

### 5.5 RBAC View Mode

**Purpose:** Security-focused permission model visualization.

**What's shown:**
- All ServiceAccounts in namespace
- RoleBindings and ClusterRoleBindings referencing each
- Roles and ClusterRoles bound
- Expanded permission sets (verbs + resources) as leaf nodes
- RED border on ServiceAccounts with cluster-admin or wildcard permissions

---

## 6. Resource Detail Popup — Key Fields by Resource Type

When clicking any resource node, a detail panel shows resource-specific important fields:

### Pod
- Status (phase + conditions), Restart count, Container images
- CPU/Memory usage vs requests vs limits (progress bars)
- Node name, IP address, Start time
- Labels, Annotations (expandable)

### Deployment / StatefulSet / DaemonSet
- Replicas: ready/desired/updated/available
- Strategy (RollingUpdate/Recreate), maxSurge/maxUnavailable
- Selector labels, Pod template hash
- Last rollout time, revision history count

### Service
- Type (ClusterIP/NodePort/LoadBalancer/ExternalName)
- ClusterIP, External IPs, Ports (with target ports)
- Selector labels, Session affinity
- Endpoint count (healthy/total)

### ConfigMap / Secret
- Data keys (list, not values for secrets)
- Size (byte count)
- Last modified time
- Mounted by (list of pods)

### PVC / PV
- Status (Bound/Pending/Lost), Capacity
- Access modes, Storage class
- Volume mode, Reclaim policy (PV)
- Bound PVC/PV reference

### Node
- Status conditions (Ready, DiskPressure, MemoryPressure, PIDPressure)
- CPU/Memory allocatable vs capacity
- Pod count (running/allocatable)
- Kubelet version, OS, Architecture
- Instance type (cloud provider label)

### HPA
- Current/Min/Max replicas
- Current/Target CPU/Memory utilization
- Scale target reference
- Last scale time, scaling events

### Ingress
- Rules (host/path/backend) as expandable list
- TLS hosts and secret references
- IngressClass
- Load balancer IPs/hostnames

### NetworkPolicy
- Pod selector
- Ingress rules (from, ports)
- Egress rules (to, ports)
- Policy types

---

## 7. Navigation: "Go to Resource" — Seamless Resource-to-Resource

The most powerful interaction: from any resource's detail popup, click "Go to Resource" to see THAT resource's full topology. This creates a seamless exploration flow:

```
Pod topology → click Service node → Service detail popup → "Go to Resource"
  → Service topology (showing all pods it selects, ingresses routing to it, endpoints)
    → click Ingress node → Ingress detail popup → "Go to Resource"
      → Ingress topology (showing services, TLS secrets, ingress class)
```

**Breadcrumb trail:** `Cluster > production > payment-api (Pod) > payment-svc (Service) > payment-ingress (Ingress)`

Each breadcrumb is clickable. Escape goes back one level. Browser back button works. URL is bookmarkable at every level.

**Deep-link URL pattern:**
```
/topology/{clusterId}                                          → Cluster Overview
/topology/{clusterId}/namespace/{ns}                           → Namespace View
/topology/{clusterId}/workload/{kind}/{ns}/{name}              → Workload View
/topology/{clusterId}/resource/{kind}/{ns}/{name}              → Resource-Centric View
/topology/{clusterId}/rbac/{ns}                                → RBAC View
```

---

## 8. Interaction Design

### 8.1 Mouse Interactions

| Action | Behavior |
|--------|----------|
| **Click node** | Select. Show detail panel on right. Highlight connected edges/nodes. Dim unconnected to 30% opacity. |
| **Double-click node** | Enter Resource-Centric view for that resource |
| **Right-click node** | Context menu: View YAML, View Logs (pods), Go to Resource, Copy Name, Investigate with AI |
| **Hover node** | Tooltip with full name, namespace, status, key metrics. Subtle shadow increase (100ms). |
| **Click edge** | Select edge. Show relationship detail in panel. |
| **Hover edge** | Highlight. Show full label. Dim other edges to 30%. Source/target glow. |
| **Drag canvas** | Pan the viewport |
| **Scroll wheel** | Zoom (centered on cursor) |
| **Click empty space** | Deselect all. Remove highlight/dim. |

### 8.2 Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `F` | Fit entire graph to viewport |
| `1-5` | Switch view mode (1=Cluster, 2=Namespace, 3=Workload, 4=Resource, 5=RBAC) |
| `+` / `-` | Zoom in / out |
| `Escape` | Go back one level / deselect / close panel |
| `Tab` | Cycle through nodes (layout order: left-to-right, top-to-bottom) |
| `/` | Open search (filter by name, kind, namespace, label, status) |
| `E` | Toggle edge labels |
| `M` | Toggle minimap |
| `H` | Toggle health overlay |
| `C` | Toggle cost overlay |
| `S` | Screenshot / export current view |
| `?` | Show keyboard shortcuts overlay |

### 8.3 Search and Filter

The search (`/` key) is not optional. For a topology with 200+ resources, it is essential.

**Search capabilities:**
- Search by resource name (fuzzy match)
- Search by resource kind (`kind:Pod`, `kind:Service`)
- Search by namespace (`ns:production`)
- Search by label (`label:app=payment`)
- Search by status (`status:error`, `status:warning`)

**Search behavior:**
- Results highlight matching nodes on canvas, dim non-matches to 10% opacity
- Results listed in dropdown with kind icon, name, namespace, status badge
- Click result → select and center on that node
- Clear search → restore all nodes to full opacity

**Persistent filters (sidebar):**
- Filter by resource type (checkboxes per kind)
- Filter by health status
- Filter by namespace

### 8.4 Detail Panel (Right Side, 380px)

```
┌──────────────────────────────────────┐
│ ✕  Pod: payment-api-7d8b9c-xyz       │
│ Namespace: production                 │
│ Status: ● Running                     │
│ ─────────────────────────────────── │
│                                       │
│ KEY DETAILS                           │
│  Image: payment-api:v2.3.1            │
│  Node: ip-10-0-1-11                   │
│  IP: 10.244.1.45                      │
│  Restarts: 0                          │
│  Age: 3d 14h                          │
│                                       │
│  CPU:  ████████░░  120m/500m (24%)    │
│  Mem:  ██████░░░░  256Mi/512Mi (50%)  │
│                                       │
│ ─────────────────────────────────── │
│ CONNECTIONS (14)                      │
│                                       │
│ ▾ Ownership (2)                       │
│   └ ReplicaSet: pay-api-7d8b9c       │
│     └ Deployment: payment-api         │
│                                       │
│ ▾ Networking (3)                      │
│   ├ Service: payment-svc              │
│   ├ Endpoints: payment-svc            │
│   └ Ingress: payment-ing              │
│                                       │
│ ▾ Configuration (3)                   │
│   ├ ConfigMap: payment-config         │
│   │  └ mounted at /etc/config         │
│   ├ Secret: payment-db-creds          │
│   │  └ mounted at /etc/secrets        │
│   └ Secret: payment-tls               │
│      └ env: TLS_CERT                  │
│                                       │
│ ▾ Storage (1)                         │
│   └ PVC: payment-data                 │
│     └ PV: pv-abc123                   │
│       └ StorageClass: gp3-encrypted   │
│                                       │
│ ▾ Identity (1)                        │
│   └ SA: payment-sa                    │
│     └ RoleBinding: payment-rb         │
│       └ Role: payment-role            │
│                                       │
│ ▾ Scheduling (1)                      │
│   └ Node: ip-10-0-1-11               │
│                                       │
│ ▾ Scaling (1)                         │
│   └ HPA: payment-hpa                 │
│                                       │
│ ▾ Disruption (1)                      │
│   └ PDB: payment-pdb                 │
│                                       │
│ ─────────────────────────────────── │
│                                       │
│ [Go to Resource]  [View YAML]         │
│ [View Logs]       [Copy Name]         │
│ [Investigate AI]                      │
│                                       │
└──────────────────────────────────────┘
```

**Each connection in the panel is clickable** — clicking navigates to and selects that resource in the topology, centering the viewport on it.

---

## 9. Export System

### 9.1 Export Formats

| Format | Use Case | How |
|--------|----------|-----|
| **PNG** (high-res) | Documentation, presentations | Canvas to PNG at 2x DPI |
| **SVG** | Editable diagrams, wiki embedding | Direct SVG from React Flow |
| **JSON** | Programmatic consumption, diffing | Full TopologyResponse export |
| **DrawIO** | Editable in draw.io / diagrams.net | XML conversion |
| **PDF** | Formal reports | SVG to PDF |
| **Clipboard** | Quick sharing | PNG to clipboard |

### 9.2 Export Options

- Include/exclude: edge labels, metrics, health status, legend
- Filter: selected resources only, visible viewport only, full graph
- Background: white, transparent, dark
- Filename: `kubilitics-topology-{cluster}-{view}-{date}.{ext}`

---

## 10. Error States, Loading States, and Edge Cases

### 10.1 Loading States

- **Initial load:** Skeleton layout with gray placeholder rectangles in expected positions. Subtle pulse animation. NOT a spinner.
- **View mode change:** Current topology fades 50%, skeleton of new layout appears, then morphs to actual positions.
- **Layout computation progress:** For large graphs (>500 nodes), show progress: "Computing layout... 67%"

### 10.2 Error States

- **Partial data failure:** Banner: "Unable to load Secrets — some connections may be missing. [Retry]"
- **Full API failure:** Full-screen message with retry button and last successful render time
- **WebSocket disconnect:** Subtle orange banner: "Live updates paused. Reconnecting..." Auto-retry with exponential backoff.
- **Permission errors:** Resources the user can't access shown as locked/redacted placeholder nodes (not silently omitted)

### 10.3 Edge Cases

- **Empty cluster:** "No resources found" with illustration, not blank canvas
- **Orphaned resources:** Shown with broken-link indicator (dashed border, warning badge)
- **Very long names:** Truncated at node boundary with full name in tooltip
- **CRDs:** Shown as "Extensions" category with puzzle icon
- **Special characters in names:** Properly escaped, no rendering errors

---

## 11. Accessibility Requirements

### Keyboard Navigation
- Tab cycles through nodes (left-to-right, top-to-bottom per layer)
- Enter selects focused node (opens detail panel)
- Escape deselects / closes panel / navigates back
- Space toggles expand/collapse on group nodes
- Arrow keys pan canvas when no node focused
- Focus ring: 3px blue outline, 2px offset, clearly visible

### Screen Reader Support
- Every node: `aria-label` = "Pod payment-api in namespace production, status Running, CPU 24%, Memory 50%"
- Every edge: `aria-label` = "Pod payment-api owned by ReplicaSet payment-api-7d8b9c"
- Groups: `role="group"` with `aria-label` = "Namespace production, 14 pods, healthy"
- View changes announced via aria-live

### Color-Blind Safety
- Health: color + shape + text (Green dot + "Running", Yellow triangle + "Warning", Red square + "Error", Gray dash + "Unknown")
- Edge types: color + line style (solid/dashed/dotted)
- Tested against deuteranopia, protanopia, tritanopia

### Reduced Motion
- All animations respect `prefers-reduced-motion`
- When reduced motion: instant transitions, no pulse animations, no layout morphing

---

## 12. Acceptance Criteria (Definition of Done)

The topology v2.0 is complete when ALL of the following are true:

- [ ] All 39 relationship types implemented and tested
- [ ] Resource-centric view for a Pod shows ALL connected resources (minimum 10 types in test cluster)
- [ ] Every edge has a visible, readable label with correct text
- [ ] No text smaller than 12px at any zoom level where text renders
- [ ] No overlapping labels at any zoom level
- [ ] No cut-off nodes — scrolling reveals everything
- [ ] Fit-to-screen works for 10, 100, 500, 1000 resource graphs
- [ ] Minimap always visible and correctly shows viewport position
- [ ] Progressive disclosure works: Cluster, Namespace, Workload, Resource
- [ ] "Go to Resource" navigation works between any two resources
- [ ] Detail popup shows resource-specific key fields for all resource types
- [ ] Deep-link URLs work for all view modes
- [ ] Deterministic layout: same data = same positions
- [ ] Performance: <500ms for 100 resources, <3s for 1000 resources
- [ ] 60fps during pan/zoom for graphs up to 500 nodes
- [ ] Health overlay correctly colors all nodes
- [ ] Search works by name, kind, namespace, label, status
- [ ] Export works for PNG, SVG, JSON, DrawIO
- [ ] Dark mode meets WCAG AA contrast requirements
- [ ] Keyboard navigation fully functional
- [ ] Screen reader support for all elements
- [ ] prefers-reduced-motion respected
- [ ] All Playwright E2E tests pass
- [ ] Visual regression baselines established
- [ ] Real-time WebSocket updates without full re-render
- [ ] All error states, loading states, and edge cases handled
