# TOPOLOGY ENGINE v2.0 — Product Requirements Document

**Product:** Kubilitics Topology Engine v2.0 (Complete Rewrite)  
**Status:** Specification Complete — Ready for Development  
**Priority:** P0 — This is the USP. Nothing else matters until this is world-class.  
**Date:** March 2026  
**Classification:** Internal Engineering + Design

---

## 0. Why This Rewrite Exists

The topology engine is Kubilitics' single most important differentiator. It is the feature that justifies the entire platform's existence. And right now, **it does not work well enough**.

After 100+ iterations, the following problems persist:

1. **Missing connections** — Resources that are clearly related do not appear connected. A pod's topology does not show every resource it touches.
2. **Visual chaos** — Color combinations are poor. Text is unreadable against node backgrounds. Edge labels are missing or overlap.
3. **Viewport failures** — Resources appear cut off. There is no reliable scroll/pan. Users cannot see the complete topology at once.
4. **No zoom intelligence** — A 5-resource view and a 500-resource view use the same rendering strategy.
5. **No resource-centric mode** — When viewing a Pod's topology, you should see EVERY connected resource: its ReplicaSet, Deployment/StatefulSet/DaemonSet, Service(s), Endpoints, EndpointSlice, Node, Namespace, Secrets, ConfigMaps, PVCs, PVs, StorageClass, ServiceAccount, Role, RoleBinding, HPA, PDB, NetworkPolicy, Ingress, IngressClass — with clear labels explaining HOW each connection exists.
6. **Layout thrashing** — Different layout algorithms produce wildly different results. There is no deterministic, predictable layout.
7. **No hierarchy** — Kubernetes resources have a natural hierarchy (Namespace → Deployment → ReplicaSet → Pod). The topology does not respect this.
8. **Useless for executives** — A CXO looking at the topology gets zero insight. There are no summary views, no health overlays, no "what's wrong" signals.

**This document specifies the complete rewrite.** Not a patch. Not an iteration. A ground-up rebuild of every layer: data model, graph construction, layout engine, rendering, interaction, and export.

---

## 1. Product Vision

### The One-Line Vision

**"Click any Kubernetes resource and instantly see everything connected to it, how it's connected, and whether anything is wrong — in a view so clear that a CXO understands it and an SRE trusts it."**

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
                │   │   │   │   │   │   │   │   └──── PDB: payment-pdb
                │   │   │   │   │   │   │   │         (minAvailable: 2)
                │   │   │   │   │   │   │   │
                │   │   │   │   │   │   │   └──────── HPA: payment-hpa
                │   │   │   │   │   │   │             (2-10 replicas, CPU 70%)
                │   │   │   │   │   │   │
                │   │   │   │   │   │   └──────────── NetworkPolicy: allow-payment
                │   │   │   │   │   │                 (ingress from app=gateway)
                │   │   │   │   │   │
                │   │   │   │   │   └──────────────── Node: ip-10-0-1-11
                │   │   │   │   │                     (Ready, CPU: 34%, Mem: 67%)
                │   │   │   │   │
                │   │   │   │   └──────────────────── ServiceAccount: payment-sa
                │   │   │   │                         → RoleBinding: payment-rb
                │   │   │   │                         → Role: payment-role
                │   │   │   │
                │   │   │   └──────────────────────── Secret: payment-db-creds
                │   │   │                             (mounted at /etc/secrets)
                │   │   │
                │   │   └──────────────────────────── Secret: payment-tls
                │   │                                 (TLS cert, expires: 2026-09)
                │   │
                │   └──────────────────────────────── ConfigMap: payment-config
                │                                     (mounted at /etc/config)
                │
                └──────────────────────────────────── PVC: payment-data
                                                      → PV: pv-abc123
                                                      → StorageClass: gp3-encrypted
```

**Every single resource connected to that pod is visible.** Every edge has a label explaining the relationship type. Health status is color-coded. Metrics are inline. This is not aspirational — this is the specification.

---

## 2. Target Users and Their Needs

### 2.1 SRE During an Incident (Primary)

**Scenario:** 3 AM page. `payment-api` pods are CrashLoopBackOff.  
**Need:** In 5 seconds, see: which Deployment owns these pods, which Secrets they mount, which Node they're on, which Services route to them, whether the HPA is scaling, whether a PDB is blocking restarts.  
**Current failure:** The topology shows the pod floating with 2-3 connections. The SRE still has to run 8 kubectl commands to piece together the full picture.  
**Required:** One click on the pod → every connected resource, every relationship, every health signal.

### 2.2 Platform Engineer Reviewing Architecture (Primary)

**Scenario:** New engineer joins the team. Needs to understand the `checkout` namespace.  
**Need:** A namespace-level topology that shows all workloads, how they connect to each other via Services, what storage they use, what RBAC is in play.  
**Current failure:** The namespace topology is a jumble of nodes with no visual hierarchy. It's faster to read YAML files.  
**Required:** A clear, hierarchical, color-coded namespace map that someone can screenshot and share in a design review.

### 2.3 CXO / Engineering Manager (Secondary)

**Scenario:** VP of Engineering wants to understand the production cluster health.  
**Need:** A cluster-level view showing namespaces as groups, with health indicators, cost annotations, and problem highlights.  
**Current failure:** The cluster topology is an incomprehensible hairball of 500+ nodes.  
**Required:** A progressive-disclosure view: start with namespaces → expand to workloads → expand to pods → expand to full resource graph.

### 2.4 Security Engineer Auditing RBAC (Secondary)

**Scenario:** Quarterly security audit of RBAC policies.  
**Need:** See all ServiceAccounts, their RoleBindings, the Roles they bind to, and the permissions those Roles grant — as a visual graph.  
**Current failure:** RBAC relationships are not in the topology at all, or appear as disconnected nodes.  
**Required:** A dedicated RBAC topology view showing the complete permission chain.

---

## 3. Design Principles (Non-Negotiable)

These are not suggestions. These are hard rules that every topology feature must satisfy. Every PR is reviewed against these principles.

### Principle 1: EVERY Connection Must Be Shown

If resource A has any relationship to resource B in Kubernetes, the topology MUST show it. Period.

**Complete relationship registry (39 relationship types):**

| # | Source | Target | Relationship Type | Edge Label | Detection Method |
|---|--------|--------|-------------------|------------|------------------|
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
| 19 | Service | Pod | selects | `selector match` | `spec.selector` ↔ `pod.metadata.labels` |
| 20 | Service | Endpoints | auto-created | `same name` | `endpoints.metadata.name == service.metadata.name` |
| 21 | Service | EndpointSlice | manages | `label match` | `endpointSlice.metadata.labels["kubernetes.io/service-name"]` |
| 22 | Endpoints | Pod | targets | `address ref` | `subsets[].addresses[].targetRef` |
| 23 | EndpointSlice | Pod | targets | `endpoint ref` | `endpoints[].targetRef` |
| 24 | Ingress | Service | routes to | `backend` | `spec.rules[].http.paths[].backend.service` |
| 25 | Ingress | IngressClass | class | `ingressClassName` | `spec.ingressClassName` |
| 26 | Ingress | Secret | TLS cert | `tls secret` | `spec.tls[].secretName` |
| 27 | PVC | PV | bound to | `binding` | `spec.volumeName` / `pv.spec.claimRef` |
| 28 | PV | StorageClass | provisioned by | `storageClass` | `spec.storageClassName` |
| 29 | PVC | StorageClass | requests from | `storageClass` | `spec.storageClassName` |
| 30 | ServiceAccount | Secret | token secret | `secret ref` | `secrets[].name` (legacy) / auto-generated |
| 31 | RoleBinding | Role | binds | `roleRef` | `roleRef.name + kind` |
| 32 | RoleBinding | ServiceAccount | grants to | `subject` | `subjects[].name where kind=ServiceAccount` |
| 33 | ClusterRoleBinding | ClusterRole | binds | `roleRef` | `roleRef.name + kind` |
| 34 | ClusterRoleBinding | ServiceAccount | grants to | `subject` | `subjects[].name where kind=ServiceAccount` |
| 35 | HPA | Deployment/SS | scales | `scaleTargetRef` | `spec.scaleTargetRef` |
| 36 | PDB | Pod | protects | `selector match` | `spec.selector` ↔ `pod.metadata.labels` |
| 37 | NetworkPolicy | Pod | applies to | `podSelector` | `spec.podSelector` ↔ `pod.metadata.labels` |
| 38 | MutatingWebhook | Service | calls | `webhook service` | `webhooks[].clientConfig.service` |
| 39 | ValidatingWebhook | Service | calls | `webhook service` | `webhooks[].clientConfig.service` |

**If a relationship type is not in this table, add it before shipping.** This table is the source of truth.

### Principle 2: Every Edge Must Be Labeled

A line between two nodes without a label is useless. Every edge MUST display:
- **Relationship type** (e.g., "mounts secret", "selects", "owned by")
- **Relationship detail** when relevant (e.g., "mounted at /etc/config", "port 8080 → 80")

### Principle 3: Visual Clarity is Not Optional

- **Minimum contrast ratio: 4.5:1** (WCAG AA) for all text against backgrounds
- **No text smaller than 12px** at any zoom level where text is shown
- **No overlapping labels** — the layout engine must guarantee label separation
- **No cut-off nodes** — every node must be fully visible within its viewport region
- **Consistent node sizing** — nodes of the same type have the same dimensions
- **Clear status colors** — only 4 colors: Green (healthy), Yellow (warning), Red (error), Gray (unknown)

### Principle 4: Viewport Must Work

- **Fit-to-screen** button that zooms to show the entire graph
- **Pan** with mouse drag (not scroll — scroll zooms)
- **Zoom** with scroll wheel, pinch, and +/- buttons
- **Minimap** always visible showing the full graph with viewport indicator
- **No cut-off** — infinite canvas with proper bounds detection
- **Smooth transitions** when expanding/collapsing groups

### Principle 5: Progressive Disclosure

A cluster with 2,000 resources cannot render all resources at once. The topology MUST support:
1. **Level 0 — Cluster overview:** Namespaces as groups with health badges
2. **Level 1 — Namespace view:** Workloads (Deployments, StatefulSets, DaemonSets) as primary nodes
3. **Level 2 — Workload view:** ReplicaSets + Pods visible, Services connected
4. **Level 3 — Resource view:** Full resource graph for a selected resource (every connection)

Users drill down by clicking. Users zoom out by pressing Escape or clicking breadcrumbs.

### Principle 6: Deterministic Layout

Given the same set of resources, the topology MUST produce the same layout every time. No random placement. No layout drift between page loads. The layout algorithm must be deterministic with a fixed seed.

### Principle 7: Performance Budgets

| Metric | Target | Hard Limit |
|--------|--------|------------|
| Time to first render (< 100 resources) | < 500ms | 1s |
| Time to first render (100-500 resources) | < 1.5s | 3s |
| Time to first render (500-2000 resources) | < 3s | 5s |
| Frame rate during pan/zoom | 60fps | 30fps |
| Memory for 2000-node graph | < 150MB | 250MB |
| Edge label render time | < 100ms | 200ms |

---

## 4. Topology View Modes

The topology engine supports **five distinct view modes**. Each mode serves a different user and use case.

### 4.1 Cluster Overview Mode

**Purpose:** High-level cluster health for managers and CXOs.

**What's shown:**
- Each namespace rendered as a **colored group box**
- Inside each namespace group: **workload count badges** (Deployments, StatefulSets, DaemonSets)
- Health indicator per namespace: green/yellow/red based on pod health ratio
- Node sidebar: list of cluster nodes with CPU/memory utilization bars
- Cross-namespace connections shown as thin lines between namespace boxes (Services in one namespace routing to pods in another)

**Interactions:**
- Click a namespace → zoom into Namespace View for that namespace
- Hover a namespace → tooltip with resource count summary, cost, and health score
- Right-click → "View in Namespace mode", "Filter topology to this namespace"

### 4.2 Namespace View Mode

**Purpose:** Architecture overview of a single namespace for platform engineers.

**What's shown:**
- Workloads (Deployment, StatefulSet, DaemonSet, Job, CronJob) as primary nodes
- Services connected to their target workloads
- Ingresses connected to their backend Services
- Storage (PVCs) connected to workloads that mount them
- ConfigMaps and Secrets that are mounted by workloads (grouped)
- RBAC chain: ServiceAccounts → RoleBindings → Roles (collapsed by default, expandable)

**Layout:**
- Left-to-right flow: Ingress → Service → Workload → Storage
- RBAC below the main flow
- ConfigMaps/Secrets above the main flow

### 4.3 Workload View Mode

**Purpose:** Drill into a specific Deployment/StatefulSet/DaemonSet.

**What's shown:**
- The workload as the center node
- All ReplicaSets (with revision numbers) — current and previous
- All Pods in the current ReplicaSet with individual health status
- HPA connected to the workload
- PDB connected to the workload's pods
- Service(s) that select this workload's pods
- All ConfigMaps, Secrets, PVCs mounted by these pods

### 4.4 Resource-Centric View Mode (THE CRITICAL MODE)

**Purpose:** Show EVERY resource connected to a selected resource. This is the mode that must be perfect.

**What's shown for a Pod:**
| Category | Resources | Connection Detail |
|----------|-----------|-------------------|
| Ownership | ReplicaSet → Deployment (or StatefulSet / DaemonSet / Job → CronJob) | `ownerRef` chain fully traced |
| Networking | Service(s) that select this pod, Endpoints, EndpointSlice, Ingress(es) routing to those Services, NetworkPolicies applied to this pod | selector match, backend routing |
| Scheduling | Node the pod runs on, PriorityClass, RuntimeClass | `spec.nodeName`, `priorityClassName` |
| Configuration | Every ConfigMap (volume mount + envFrom + env valueFrom), Every Secret (volume mount + envFrom + env valueFrom + imagePullSecrets) | mount path, key reference |
| Storage | Every PVC → PV → StorageClass | volume mount path |
| Identity | ServiceAccount → RoleBinding(s) → Role(s), ServiceAccount → ClusterRoleBinding(s) → ClusterRole(s) | full RBAC chain |
| Scaling | HPA targeting parent workload, VPA targeting parent workload | scaleTargetRef |
| Disruption | PDB that selects this pod | selector match |
| Namespace | The Namespace this pod belongs to (with quotas, limits) | metadata.namespace |
| Webhooks | MutatingWebhooks and ValidatingWebhooks that match this pod's labels | webhook selector match |

**What's shown for a Service:**
| Category | Resources | Connection Detail |
|----------|-----------|-------------------|
| Targets | All Pods selected by this Service | selector match + port mapping |
| Endpoints | Endpoints and EndpointSlice resources | auto-created, address list |
| Routing | Ingress(es) that route to this Service | backend reference + path rules |
| Workloads | Deployment/StatefulSet/DaemonSet that owns the selected Pods | ownerRef chain |
| Network | NetworkPolicies that reference this Service or its pods | ingress/egress rules |
| Webhooks | Webhooks that call this Service | clientConfig.service |

**What's shown for a Deployment:**
| Category | Resources | Connection Detail |
|----------|-----------|-------------------|
| Ownership | All ReplicaSets (current + history) | ownerRef |
| Pods | All Pods in each ReplicaSet | ownerRef |
| Scaling | HPA, VPA | scaleTargetRef |
| Disruption | PDB | selector match |
| Networking | Service(s) selecting its pods, Endpoints, Ingress | selector chain |
| Configuration | All ConfigMaps and Secrets referenced by pod template | volume, envFrom, env |
| Storage | All PVCs in pod template → PVs → StorageClasses | volumeClaimTemplates |
| Identity | ServiceAccount → RBAC chain | serviceAccountName |
| Scheduling | Node affinity rules (shown as constraints, not node connections) | affinity display |
| Namespace | The Namespace | metadata.namespace |

**This mode MUST be implemented for ALL resource types.** The relationship registry (Principle 1) defines the complete connection set for each type.

### 4.5 RBAC View Mode

**Purpose:** Security-focused view of the permission model.

**What's shown:**
- All ServiceAccounts in a namespace
- RoleBindings and ClusterRoleBindings that reference each ServiceAccount
- Roles and ClusterRoles that are bound
- Expanded permission sets (verbs + resources) as leaf nodes
- Highlight: ServiceAccounts with cluster-admin or wildcard permissions (red border)

---

## 5. Resource Node Design System

### 5.1 Node Anatomy

Every resource node in the topology follows this exact structure:

```
┌─────────────────────────────────────┐
│ [icon] ResourceKind                 │  ← Header bar (colored by resource category)
│─────────────────────────────────────│
│ resource-name                       │  ← Name (bold, truncated with tooltip)
│ namespace (if namespaced)           │  ← Namespace (smaller, gray)
│─────────────────────────────────────│
│ ● Status: Running                   │  ← Status with color dot
│ Key metric: value                   │  ← Primary metric (e.g., CPU: 45%)
│ Secondary metric: value             │  ← Secondary metric (e.g., Memory: 67%)
└─────────────────────────────────────┘
   ↑ Health border (left edge: 4px colored bar)
```

### 5.2 Resource Category Colors

| Category | Header Color | Hex | Icon |
|----------|-------------|-----|------|
| **Workloads** (Pod, Deployment, SS, DS, Job, CronJob, RS) | Blue | `#2563EB` | Respective Lucide icon |
| **Networking** (Service, Endpoints, EP Slice, Ingress, NetworkPolicy) | Purple | `#7C3AED` | Network/Globe icon |
| **Configuration** (ConfigMap, Secret, Namespace) | Teal | `#0D9488` | Settings/Key icon |
| **Storage** (PVC, PV, StorageClass, VolumeAttachment) | Orange | `#EA580C` | Database/HardDrive icon |
| **RBAC** (SA, Role, RoleBinding, ClusterRole, CRB) | Amber | `#D97706` | Shield/Lock icon |
| **Scaling** (HPA, VPA, PDB, PriorityClass) | Green | `#16A34A` | Scale/ArrowUpDown icon |
| **Cluster** (Node, Namespace, RuntimeClass) | Slate | `#475569` | Server/Box icon |
| **Extensions** (CRD, Webhook, APIService) | Pink | `#DB2777` | Puzzle icon |

### 5.3 Health Status Indicators

| Status | Color | Left Border | Background Tint |
|--------|-------|-------------|-----------------|
| Healthy / Running / Active | Green `#16A34A` | 4px solid green | `#F0FFF4` |
| Warning / Pending / Scaling | Yellow `#EAB308` | 4px solid yellow | `#FEFCE8` |
| Error / Failed / CrashLoop | Red `#DC2626` | 4px solid red | `#FEF2F2` |
| Unknown / Terminating | Gray `#6B7280` | 4px solid gray | `#F9FAFB` |

### 5.4 Node Sizes

| View Mode | Node Width | Node Height (min) | Font Size |
|-----------|-----------|-------------------|-----------|
| Cluster Overview | 200px | 80px | 14px |
| Namespace View | 220px | 100px | 13px |
| Workload View | 240px | 120px | 13px |
| Resource-Centric | 260px | 130px | 12px |
| Collapsed/Mini | 120px | 40px | 11px |

---

## 6. Edge Design System

### 6.1 Edge Styles by Relationship Type

| Relationship Category | Line Style | Color | Width | Arrow |
|----------------------|-----------|-------|-------|-------|
| **Ownership** (ownerRef) | Solid | `#1E40AF` (dark blue) | 2px | Filled triangle at target |
| **Selection** (selector match) | Dashed | `#7C3AED` (purple) | 2px | Open triangle at target |
| **Mount/Reference** (volume, env, secret) | Dotted | `#0D9488` (teal) | 1.5px | Diamond at target |
| **Routing** (Ingress → Service → Pod) | Solid | `#7C3AED` (purple) | 2.5px | Filled triangle at target |
| **Binding** (RBAC: RoleBinding → Role) | Dashed | `#D97706` (amber) | 1.5px | Open triangle at target |
| **Scheduling** (Pod → Node) | Dotted | `#475569` (slate) | 1px | Circle at target |
| **Scaling** (HPA → Deployment) | Dashed | `#16A34A` (green) | 1.5px | Double triangle at target |
| **Namespace containment** | None (grouping box) | `#E5E7EB` | 1px | None |

### 6.2 Edge Labels

Every edge has a label. Labels are:
- Positioned at the **midpoint** of the edge
- Rendered on a **white background pill** with 4px padding to prevent overlap with the line
- **Font size: 10px**, color: `#6B7280` (gray-500)
- **Never overlap** — if two edges are close, labels are staggered vertically
- **Truncated at 30 characters** with full text in tooltip

### 6.3 Edge Label Examples

| Relationship | Label Text |
|-------------|-----------|
| Pod → ReplicaSet (ownerRef) | `owned by` |
| ReplicaSet → Deployment (ownerRef) | `owned by` |
| Service → Pod (selector) | `selects (app=payment)` |
| Pod → ConfigMap (volume) | `mounts → /etc/config` |
| Pod → Secret (volume) | `mounts → /etc/secrets` |
| Pod → Secret (envFrom) | `env from` |
| Pod → ConfigMap (env valueFrom) | `env: DB_HOST` |
| Pod → PVC (volume) | `mounts → /data` |
| PVC → PV (binding) | `bound to` |
| PV → StorageClass | `provisioned by` |
| Pod → Node (scheduling) | `runs on` |
| Pod → ServiceAccount | `identity` |
| ServiceAccount → RoleBinding | `bound by` |
| RoleBinding → Role | `binds` |
| HPA → Deployment | `scales (CPU 70%)` |
| PDB → Pod | `protects (minAvail: 2)` |
| Ingress → Service | `routes /api → :8080` |
| Ingress → Secret (TLS) | `TLS cert` |
| NetworkPolicy → Pod | `allows ingress` |
| Endpoints → Pod | `target (10.0.1.5:8080)` |

---

## 7. Layout Engine Specification

### 7.1 Layout Algorithm Selection

After evaluating ELK, Dagre, Cola, FCose, and D3-force:

**Primary layout: ELK (Eclipse Layout Kernel) with layered algorithm**

Reasons:
- Deterministic: same input → same output
- Hierarchical: respects parent-child relationships
- Configurable: spacing, direction, port placement, edge routing
- Handles compound graphs: namespace grouping, workload containment
- Proven at scale: used by VS Code, Eclipse, and many graph tools

**ELK Configuration:**

```json
{
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.layered.spacing.nodeNodeBetweenLayers": 80,
  "elk.layered.spacing.nodeNode": 40,
  "elk.spacing.componentComponent": 60,
  "elk.layered.compaction.connectedComponents": true,
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.layered.edgeRouting": "ORTHOGONAL",
  "elk.partitioning.activate": true,
  "elk.randomSeed": 42
}
```

**Layout direction by view mode:**
- Cluster Overview: `DOWN` (Namespace groups top-to-bottom)
- Namespace View: `RIGHT` (Ingress → Service → Workload → Storage, left-to-right flow)
- Workload View: `DOWN` (Deployment → ReplicaSet → Pods, top-to-bottom hierarchy)
- Resource-Centric: `DOWN` with radial grouping (selected resource at center-top)

### 7.2 Grouping Rules

| Group | Container | Members |
|-------|-----------|---------|
| Namespace | Rounded rectangle, light background | All resources in that namespace |
| Workload | Subtle border | Deployment + its ReplicaSets + Pods |
| RBAC chain | Dashed border | ServiceAccount + RoleBindings + Roles |
| Storage chain | Dotted border | PVC + PV + StorageClass |

### 7.3 Layer Assignment

In the layered layout, resources are assigned to semantic layers:

| Layer (top to bottom) | Resources |
|----------------------|-----------|
| Layer 0 — Entry | Ingress, IngressClass |
| Layer 1 — Routing | Service, Endpoints, EndpointSlice |
| Layer 2 — Orchestration | Deployment, StatefulSet, DaemonSet, CronJob |
| Layer 3 — Replication | ReplicaSet, Job |
| Layer 4 — Execution | Pod |
| Layer 5 — Infrastructure | Node, PriorityClass, RuntimeClass |
| Sidebar Left — Config | ConfigMap, Secret |
| Sidebar Right — Storage | PVC, PV, StorageClass |
| Below — Identity | ServiceAccount, RoleBinding, Role, ClusterRoleBinding, ClusterRole |
| Below — Policy | HPA, VPA, PDB, NetworkPolicy |

---

## 8. Interaction Design

### 8.1 Mouse Interactions

| Action | Behavior |
|--------|----------|
| **Click node** | Select node. Show detail panel on right. Highlight all connected edges and nodes. Dim unconnected nodes to 30% opacity. |
| **Double-click node** | Enter Resource-Centric view for that resource |
| **Right-click node** | Context menu: View YAML, View Logs (pods), Open Detail Page, Copy Name, Investigate with AI |
| **Hover node** | Show tooltip with full resource info (name, namespace, status, key metrics) |
| **Click edge** | Select edge. Show edge detail (relationship type, specifics) in panel |
| **Hover edge** | Highlight edge. Show label with full detail |
| **Drag canvas** | Pan the viewport |
| **Scroll wheel** | Zoom in/out (centered on cursor) |
| **Click empty space** | Deselect all. Remove highlight/dim. |

### 8.2 Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `F` | Fit entire graph to viewport |
| `1-5` | Switch to view mode (1=Cluster, 2=Namespace, 3=Workload, 4=Resource, 5=RBAC) |
| `+` / `-` | Zoom in / out |
| `Escape` | Go back one level / deselect |
| `Tab` | Cycle through nodes |
| `/` | Open search (filter nodes by name) |
| `E` | Toggle edge labels |
| `M` | Toggle minimap |
| `H` | Toggle health overlay |
| `C` | Toggle cost overlay |
| `S` | Screenshot / export current view |

### 8.3 Toolbar

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [🔍 Search...]  │ View: [Cluster ▾]  │ Layout: [Hierarchy ▾]  │ Overlays: │
│                  │ Namespace: [All ▾] │ Direction: [↓ Down ▾]  │ [●Health] │
│                  │                     │                        │ [○Cost]   │
│                  │                     │                        │ [○Traffic]│
│──── Left ────────┤──── Center ─────────┤──── Right ─────────────┤───────────│
│ [⊞ Fit] [+ −]   │ Breadcrumb:         │ [📷 Export ▾]          │ [⚙ Opts] │
│ [📐 Minimap]     │ cluster > ns > dep  │ [SVG][PNG][JSON][Draw] │           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.4 Detail Panel (Right Side)

When a node is selected, a panel slides in from the right (350px wide):

```
┌──────────────────────────────────┐
│ ✕                                │
│ Pod: payment-api-7d8b9c-xyz      │
│ Namespace: production             │
│ Status: ● Running                 │
│──────────────────────────────────│
│ CONNECTIONS (12)                  │
│                                   │
│ Ownership                         │
│  └ ReplicaSet: pay-api-7d8b9c    │
│    └ Deployment: payment-api      │
│                                   │
│ Networking                        │
│  ├ Service: payment-svc           │
│  ├ Endpoints: payment-svc         │
│  └ Ingress: payment-ing           │
│                                   │
│ Configuration                     │
│  ├ ConfigMap: payment-config      │
│  │  └ mounted at /etc/config      │
│  ├ Secret: payment-db-creds       │
│  │  └ mounted at /etc/secrets     │
│  └ Secret: payment-tls            │
│     └ env: TLS_CERT               │
│                                   │
│ Storage                           │
│  └ PVC: payment-data              │
│    └ PV: pv-abc123                │
│      └ StorageClass: gp3          │
│                                   │
│ Identity                          │
│  └ SA: payment-sa                 │
│    └ RoleBinding: payment-rb      │
│      └ Role: payment-role         │
│                                   │
│ Scheduling                        │
│  └ Node: ip-10-0-1-11            │
│                                   │
│ Scaling                           │
│  └ HPA: payment-hpa              │
│                                   │
│ Disruption                        │
│  └ PDB: payment-pdb              │
│──────────────────────────────────│
│ [View YAML] [View Logs] [AI]     │
└──────────────────────────────────┘
```

---

## 9. Heatmap Overlays

### 9.1 Health Overlay (Default ON)

- Node border and background tint reflect health status (green/yellow/red/gray)
- Edge color reflects health of the connection (red if service cannot reach pods)
- Namespace group border color reflects aggregate namespace health

### 9.2 Cost Overlay

- Node size scaled by relative cost (higher cost = larger node)
- Cost badge on each workload node: `$12.40/mo`
- Namespace group shows total namespace cost: `$142.50/mo`
- Color gradient: green (under budget) → yellow (80% budget) → red (over budget)

### 9.3 Traffic Overlay (when metrics available)

- Edge width scaled by request rate between services
- Edge color: green (low latency), yellow (moderate), red (high latency / errors)
- Node badge shows RPS (requests per second)

### 9.4 Security Overlay

- Highlight pods running as root (red border)
- Highlight ServiceAccounts with cluster-admin (red badge)
- Highlight pods without NetworkPolicy coverage (yellow border)
- Highlight Secrets that are base64-encoded but unencrypted (yellow badge)

---

## 10. Export System

### 10.1 Export Formats

| Format | Use Case | Implementation |
|--------|----------|----------------|
| **PNG** (high-res) | Documentation, presentations | Canvas → PNG with 2x DPI |
| **SVG** | Editable diagrams, wiki embedding | Direct SVG export from renderer |
| **JSON** | Programmatic consumption, diffing | Full graph data model export |
| **DrawIO** | Editable in draw.io / diagrams.net | XML conversion to DrawIO format |
| **PDF** | Formal reports | SVG → PDF conversion |
| **Clipboard** | Quick sharing | PNG to clipboard |

### 10.2 Export Options

- Include/exclude: edge labels, metrics, health status, legend
- Filter: selected resources only, visible viewport only, full graph
- Background: white, transparent, dark

---

## 11. Backend API Contract

### 11.1 Topology Endpoint (Rewritten)

```
GET /api/v1/clusters/{clusterId}/topology/v2
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | enum | `namespace` | `cluster`, `namespace`, `workload`, `resource`, `rbac` |
| `namespace` | string | (all) | Filter to specific namespace |
| `resource` | string | (none) | For resource-centric mode: `kind/namespace/name` |
| `depth` | int | 3 | How many relationship hops to traverse |
| `includeMetrics` | bool | true | Attach CPU/memory metrics to nodes |
| `includeHealth` | bool | true | Attach health status to nodes |
| `includeCost` | bool | false | Attach cost data to nodes |

### 11.2 Response Schema

```typescript
interface TopologyResponse {
  metadata: {
    clusterId: string;
    clusterName: string;
    mode: ViewMode;
    namespace?: string;
    focusResource?: string;
    resourceCount: number;
    edgeCount: number;
    buildTimeMs: number;
    cachedAt?: string;
  };
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  groups: TopologyGroup[];
}

interface TopologyNode {
  id: string;                          // Unique: "kind/namespace/name"
  kind: string;                        // "Pod", "Deployment", "Service", etc.
  name: string;
  namespace: string;                   // "" for cluster-scoped
  apiVersion: string;
  
  // Display
  category: ResourceCategory;          // "workload", "networking", "config", "storage", "rbac", "scaling", "cluster", "extensions"
  label: string;                       // Display name (potentially truncated)
  
  // Status
  status: NodeStatus;                  // "healthy", "warning", "error", "unknown"
  statusReason: string;                // "Running", "CrashLoopBackOff", "Pending", etc.
  
  // Metrics (optional)
  metrics?: {
    cpuUsage?: number;                 // millicores
    cpuRequest?: number;
    cpuLimit?: number;
    memoryUsage?: number;              // bytes
    memoryRequest?: number;
    memoryLimit?: number;
    restartCount?: number;
    podCount?: number;                 // for workloads
    readyCount?: number;               // for workloads
  };
  
  // Cost (optional)
  cost?: {
    monthlyCostUSD: number;
    dailyCostUSD: number;
  };
  
  // Layout hints
  layer: number;                       // Semantic layer assignment (0 = top)
  group?: string;                      // Group ID this node belongs to
  
  // Metadata for detail panel
  labels: Record<string, string>;
  annotations: Record<string, string>;
  createdAt: string;
}

interface TopologyEdge {
  id: string;                          // Unique edge ID
  source: string;                      // Source node ID
  target: string;                      // Target node ID
  
  // Relationship
  relationshipType: RelationshipType;  // "ownerRef", "selector", "volumeMount", "envRef", "routing", "binding", "scheduling", "scaling", "protection"
  relationshipCategory: string;        // "ownership", "networking", "config", "storage", "rbac", "scheduling", "scaling", "disruption"
  label: string;                       // Human-readable: "mounts → /etc/config"
  detail: string;                      // Full detail for tooltip
  
  // Visual
  style: EdgeStyle;                    // "solid", "dashed", "dotted"
  animated: boolean;                   // true for active traffic/live connections
  
  // Health
  healthy: boolean;                    // false if the connection is broken
  healthReason?: string;               // "Service has no matching pods"
}

interface TopologyGroup {
  id: string;
  label: string;
  type: "namespace" | "workload" | "rbac" | "storage";
  members: string[];                   // Node IDs
  collapsed: boolean;
  style: {
    backgroundColor: string;
    borderColor: string;
  };
  metrics?: {
    totalCostUSD?: number;
    podCount?: number;
    healthyPodCount?: number;
  };
}
```

### 11.3 Real-Time Updates

```
WebSocket: /api/v1/ws/topology/{clusterId}
```

Events:
```typescript
interface TopologyEvent {
  type: "node_added" | "node_updated" | "node_removed" | "edge_added" | "edge_removed" | "group_updated";
  payload: TopologyNode | TopologyEdge | TopologyGroup;
  timestamp: string;
}
```

The frontend applies incremental updates without re-rendering the entire graph.

---

## 12. Testing Requirements

### 12.1 Backend Tests

- **Unit test per relationship type:** For each of the 39 relationship types, a test that creates the source and target resources and verifies the edge is produced with correct label and type.
- **Integration test per view mode:** For each of the 5 view modes, a test with a realistic cluster state (50+ resources) that verifies the correct node and edge counts.
- **Performance benchmark:** Topology build for 100, 500, 1000, 2000 resources with wall-clock assertions.
- **Determinism test:** Build topology twice with same input, assert byte-identical JSON output.

### 12.2 Frontend Tests (Playwright)

- **Render test per view mode:** Navigate to topology, assert all expected nodes are visible (not cut off).
- **Edge label visibility:** Assert all edges have visible, non-overlapping labels.
- **Interaction test:** Click node → assert detail panel opens with correct connection count.
- **Viewport test:** Assert fit-to-screen shows all nodes. Assert pan/zoom works. Assert no cut-off after zoom.
- **Resource-centric test:** For a pod with known connections (6+ resources), assert all connections are rendered.
- **Dark mode test:** Assert all text meets 4.5:1 contrast in dark mode.
- **Export test:** Export PNG, assert image has correct node count.

### 12.3 Visual Regression Tests

- Screenshot every view mode with a standard test cluster.
- Compare against baseline screenshots.
- Fail if pixel diff exceeds 1% (layout changes must be intentional).

---

## 13. Acceptance Criteria (Definition of Done)

The topology v2.0 rewrite is complete when ALL of the following are true:

- [ ] All 39 relationship types are implemented and tested
- [ ] Resource-centric view for a Pod shows ALL connected resources (minimum 10 connection types in test cluster)
- [ ] Every edge has a visible, readable label with correct text
- [ ] No text smaller than 12px at default zoom
- [ ] No overlapping labels at any zoom level
- [ ] No cut-off nodes at any zoom level
- [ ] Fit-to-screen works correctly for 10, 100, 500, 1000 resource graphs
- [ ] Minimap is always visible and correctly shows viewport position
- [ ] Progressive disclosure works: Cluster → Namespace → Workload → Resource
- [ ] Deterministic layout: same data = same positions
- [ ] Performance: <500ms for 100 resources, <3s for 1000 resources
- [ ] 60fps during pan/zoom for graphs up to 500 nodes
- [ ] Health overlay correctly colors all nodes
- [ ] Export works for PNG, SVG, JSON, DrawIO
- [ ] Dark mode meets WCAG AA contrast requirements
- [ ] All Playwright E2E tests pass
- [ ] Visual regression tests pass
- [ ] Real-time WebSocket updates work (add/update/remove nodes without full re-render)
