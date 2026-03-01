# Kubilitics AGT — Advanced Graph Topology
## Complete Rewrite Vision & Task List · v3.0

> **North Star:** The most beautiful, insightful, and intuitive Kubernetes topology visualization ever built.
> Designed by someone who shipped design systems at Apple and Figma. Inspired by kubectl-tree's ownership clarity, kubectl-service-tree's traffic path precision, and kubectl-graph's relationship comprehensiveness.

---

## 0. Design Philosophy

### What We Learned From the Reference Tools

| Tool | Core Insight | Our Abstraction |
|------|-------------|-----------------|
| **[kubectl-tree](https://github.com/ahmetb/kubectl-tree)** | `ownerReferences` reveal the true ownership DAG — Deployment → ReplicaSet → Pod is the single most useful Kubernetes relationship | AGT **Arborist View**: hierarchical ownership tree rendered with ELK layered layout |
| **[kubectl-service-tree](https://github.com/feloy/kubectl-service-tree)** | Ingress → Service → Pod is how traffic actually flows — this is the operational view ops teams live in | AGT **Pathfinder View**: animated traffic lanes showing L7 routing paths |
| **[kubectl-graph](https://github.com/steveteuber/kubectl-graph)** | Kubernetes resources form a rich property graph — mapping to DOT/Cypher/AQL reveals it is a first-class graph database problem | AGT **Cosmos View**: force-directed galaxy where resources cluster by category |

### The Three Design Principles

```
1. Spatial Semantics   — position encodes meaning (ownership = vertical, traffic = horizontal, RBAC = separate cluster)
2. Progressive Disclosure — start simple (L0: namespaces + workloads), drill in on demand
3. Zero Cognitive Overhead — no legend needed; shape + color + position tells the whole story
```

---

## 1. AGT Architecture (New Tab Implementation)

### 1.1 Technology Stack Decision

After evaluating ReactFlow (@xyflow/react), Cytoscape.js, and D3.js:

```
Primary Engine: @xyflow/react (ReactFlow v12)
  ✓ React-native — custom nodes are full JSX components
  ✓ Framer Motion integration for Apple-grade spring animations
  ✓ Built-in minimap, zoom/pan, background grid
  ✓ Unlimited design control for glassmorphism nodes
  ✓ @xyflow/react is the Figma of graph libraries for React

Layout Engine: ELK (via elkjs) — already installed
  ✓ Layered algorithm for ownership trees (Sugiyama method)
  ✓ Force algorithm for Cosmos galaxy view
  ✓ Partitioned for traffic lane view

Supplementary: D3 for sparklines, gauges, and mini-charts inside node cards
```

### 1.2 Three View Modes Inside AGT Tab

```
┌─────────────────────────────────────────────────────────────────────┐
│  AGT Tab                                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  🌌 Cosmos  │  🌳 Arborist  │  🔀 Pathfinder              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  🌌 Cosmos View                                                     │
│     Force-directed galaxy. Resources cluster by category.           │
│     Workloads = center, Networking = orbit, Storage = outer ring    │
│     RBAC = separate cluster bottom-left                             │
│     Inspired by kubectl-graph's "see everything" philosophy         │
│                                                                     │
│  🌳 Arborist View                                                   │
│     Hierarchical ownership tree. ELK layered layout.               │
│     Root = Namespace, then Workload, then ReplicaSet, then Pods     │
│     ONLY ownerReferences edges shown — pure control hierarchy       │
│     Inspired by kubectl-tree's ownership-first data model           │
│                                                                     │
│  🔀 Pathfinder View                                                 │
│     Traffic flow swimlanes. Left=Ingress, center=Services, right=Pods│
│     Animated edge flows show live traffic direction                 │
│     Inspired by kubectl-service-tree's Ingress→Service→Pod path     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. AGT Visual Design System (Apple-Grade)

### 2.1 Node Card Design Language

Each node is a **glassmorphism card** rendered as a full React component:

```
┌──────────────────────────────────────────────────┐
│ ████████████████████████████████████████████████ │  ← gradient header bar (category color, 6px)
│ ┌──┐  Deployment                           ● ● ● │  ← kind icon + kind label + status dots
│ │░░│  nginx-deployment                           │  ← SVG icon (16px) + name
│ └──┘  blue-green-demo                       3/3  │  ← namespace + replica count badge
│ ─────────────────────────────────────────────── │  ← 1px separator
│  CPU ████████░░░░ 67%    Mem ██████░░░░ 52%    │  ← mini resource bars
└──────────────────────────────────────────────────┘
     width: 200px, height: 80px (compact) / 120px (expanded on hover)
     border: 1px solid rgba(255,255,255,0.15)
     backdrop-filter: blur(12px)
     background: rgba(15, 20, 35, 0.85) dark / rgba(255,255,255,0.90) light
     border-radius: 12px
     box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.08)
```

### 2.2 Category Color System (Semantic Gradients)

```typescript
const AGT_CATEGORY_GRADIENTS = {
  // Workloads — Blue-Indigo (authority, computation)
  Deployment:  { from: '#3B82F6', to: '#1D4ED8', text: '#fff', glow: 'rgba(59,130,246,0.35)' },
  StatefulSet: { from: '#6366F1', to: '#4338CA', text: '#fff', glow: 'rgba(99,102,241,0.35)' },
  DaemonSet:   { from: '#8B5CF6', to: '#6D28D9', text: '#fff', glow: 'rgba(139,92,246,0.35)' },
  ReplicaSet:  { from: '#818CF8', to: '#4F46E5', text: '#fff', glow: 'rgba(129,140,248,0.3)'  },
  Pod:         { from: '#60A5FA', to: '#2563EB', text: '#fff', glow: 'rgba(96,165,250,0.3)'   },
  Job:         { from: '#7DD3FC', to: '#0284C7', text: '#fff', glow: 'rgba(125,211,252,0.3)'  },
  CronJob:     { from: '#38BDF8', to: '#0369A1', text: '#fff', glow: 'rgba(56,189,248,0.3)'   },

  // Networking — Teal-Emerald (flow, connectivity)
  Service:       { from: '#10B981', to: '#047857', text: '#fff', glow: 'rgba(16,185,129,0.35)' },
  Ingress:       { from: '#14B8A6', to: '#0F766E', text: '#fff', glow: 'rgba(20,184,166,0.35)' },
  NetworkPolicy: { from: '#059669', to: '#065F46', text: '#fff', glow: 'rgba(5,150,105,0.35)'  },
  Endpoints:     { from: '#34D399', to: '#059669', text: '#fff', glow: 'rgba(52,211,153,0.3)'  },
  IngressClass:  { from: '#6EE7B7', to: '#10B981', text: '#065F46', glow: 'rgba(110,231,183,0.3)' },

  // Storage — Cyan-Sky (data, persistence)
  PersistentVolumeClaim: { from: '#0EA5E9', to: '#0369A1', text: '#fff', glow: 'rgba(14,165,233,0.35)' },
  PersistentVolume:      { from: '#0284C7', to: '#075985', text: '#fff', glow: 'rgba(2,132,199,0.35)'  },
  StorageClass:          { from: '#22D3EE', to: '#0E7490', text: '#fff', glow: 'rgba(34,211,238,0.3)'  },
  ConfigMap:             { from: '#F59E0B', to: '#B45309', text: '#fff', glow: 'rgba(245,158,11,0.35)' },
  Secret:                { from: '#EF4444', to: '#B91C1C', text: '#fff', glow: 'rgba(239,68,68,0.35)'  },

  // RBAC — Purple-Violet (security, identity)
  ServiceAccount:     { from: '#A855F7', to: '#7E22CE', text: '#fff', glow: 'rgba(168,85,247,0.35)' },
  Role:               { from: '#C084FC', to: '#9333EA', text: '#fff', glow: 'rgba(192,132,252,0.3)'  },
  ClusterRole:        { from: '#D946EF', to: '#A21CAF', text: '#fff', glow: 'rgba(217,70,239,0.35)'  },
  RoleBinding:        { from: '#E879F9', to: '#C026D3', text: '#fff', glow: 'rgba(232,121,249,0.3)'  },
  ClusterRoleBinding: { from: '#F0ABFC', to: '#D946EF', text: '#581C87', glow: 'rgba(240,171,252,0.3)' },

  // Infrastructure — Amber-Orange (hardware, foundation)
  Node:      { from: '#F59E0B', to: '#B45309', text: '#fff', glow: 'rgba(245,158,11,0.4)'  },
  Namespace: { from: '#FB923C', to: '#C2410C', text: '#fff', glow: 'rgba(251,146,60,0.35)' },
};
```

### 2.3 Edge Visual Grammar

```typescript
const AGT_EDGE_STYLES = {
  ownership:  { stroke: '#64748B', width: 2.5, style: 'solid',   arrowType: 'filled-triangle', animated: false },
  selects:    { stroke: '#10B981', width: 2,   style: 'dashed',  arrowType: 'open-chevron',    animated: true  },
  routes:     { stroke: '#3B82F6', width: 3,   style: 'solid',   arrowType: 'filled-triangle', animated: true  },
  mounts:     { stroke: '#0EA5E9', width: 2,   style: 'dotted',  arrowType: 'square',          animated: false },
  configures: { stroke: '#F59E0B', width: 1.5, style: 'dashed',  arrowType: 'open-chevron',    animated: false },
  permits:    { stroke: '#A855F7', width: 2,   style: 'dashed',  arrowType: 'diamond',         animated: false },
  schedules:  { stroke: '#FB923C', width: 2,   style: 'solid',   arrowType: 'circle',          animated: false },
};
```

---

## 3. AGT Implementation Tasks (Phase 1)

### A-01 · Install ReactFlow
```bash
cd kubilitics-frontend && npm install @xyflow/react
```

### A-02 · Create AGTView.tsx
**File:** `src/topology-engine/agt/AGTView.tsx`

Single orchestrator component implementing:
- ReactFlow provider with custom node/edge types registered
- Three view modes switchable with animated transition
- ELK layout engine for Arborist + Cosmos views
- Left sidebar: category filter chips + namespace selector
- Top control bar: view mode toggle + zoom + export button
- Right panel: node detail slide-in (Framer Motion)
- Cmd+K spotlight search overlay
- ReactFlow built-in minimap (bottom-right)
- Dark mode support via `useTheme()`

### A-03 · Custom Node Types (inline in AGTView.tsx)

**WorkloadNode** — Deployment / StatefulSet / DaemonSet / ReplicaSet
- Glassmorphism card with gradient top bar
- Kind icon (Layers/GitBranch/Cpu/Share2) + kind badge
- Name (14px semibold) + namespace (12px muted)
- Replica count badge (3/3, color coded green/amber/red)
- Health ring: 3px colored border (green=healthy, amber=warning, red=critical)
- Hover: expand to show CPU/Memory mini progress bars

**PodNode** — Pod (compact, many per view)
- 140×44px compact pill card
- Left dot indicator (status color)
- Name (truncated) + status badge
- Right: restart count if > 0

**NetworkNode** — Service / Ingress / NetworkPolicy
- Card with globe/network/shield icon
- Service: shows port info (80/TCP, 443/TCP)
- Ingress: shows hostname
- NetworkPolicy: shows allowed/denied indicator

**StorageNode** — PVC / PV / ConfigMap / Secret
- Database/Key icon with gradient header
- ConfigMap: shows key count
- Secret: shows type (Opaque/TLS/etc)
- PVC: shows capacity + phase (Bound/Pending)
- PV: shows reclaim policy

**InfraNode** — Node / Namespace
- Larger card (240×60px)
- Node: server icon + CPU% bar + pod count badge
- Namespace: folder icon + resource count

**RBACNode** — ServiceAccount / Role / ClusterRole / RoleBinding
- Shield icon with purple gradient
- ServiceAccount: shows binding count
- Role: shows rule count

### A-04 · Custom Edge Components (inline)

**AnimatedTrafficEdge** (for 'selects', 'routes', 'exposes')
- Bezier bezier curve
- Animated strokeDashoffset particles
- Color follows source category
- Direction arrow at target

**OwnershipEdge** (for 'owns', 'manages')
- Solid dark slate stroke
- Filled triangle arrowhead
- Small pill label "owns"

**StorageEdge** (for 'mounts', 'backed_by', 'stores')
- Cyan dotted stroke
- Square arrowhead
- Label: "mounts" or mount path

**RBACEdge** (for 'permits')
- Purple dashed stroke
- Diamond arrowhead
- Shield icon label

### A-05 · View Mode Layouts

**Cosmos** (ELK force, all edges)
- All resource types visible
- Category gravity wells via virtual anchor nodes
- Node repulsion keeps same-category clusters tight

**Arborist** (ELK layered, ownership only)
- Filter to 'owns' edges only
- Top-down direction
- Root = namespace/cluster-scoped resources

**Pathfinder** (ELK layered, traffic only)
- Filter to 'routes', 'selects', 'exposes' edges
- Left-to-right direction
- Swimlane assignment: Ingress | Service | Workload | Pod

### A-06 · Spotlight Search (Cmd+K)
- Full-screen frosted overlay
- Input with real-time filter on name/kind/namespace
- Results grouped by category with kind icon + namespace
- Arrow keys + Enter to select and pan-to + highlight

### A-07 · Integration in Topology.tsx
- Add `import AGTView from '@/topology-engine/agt/AGTView'`
- Add Tab trigger: `"AGT ✦"` as the first tab (default)
- Pass `graph` (same `TopologyGraph` type)
- Keep existing "Network" (Cytoscape) + "Force" (D3) tabs unchanged

---

## 4. AGT Phase 2 (Post-Ship Enhancements)

- [ ] **P2-01** Double-click → Focus Mode: re-layout BFS subgraph from node
- [ ] **P2-02** Right-click context menu with Blast Radius, Critical Path, Copy Name
- [ ] **P2-03** Multi-select (Shift+Click) → compare in bottom tray
- [ ] **P2-04** Namespace grouping: click namespace to collapse/expand children
- [ ] **P2-05** WebSocket live updates: node status changes animate in real-time
- [ ] **P2-06** Pod restart event: node pulses red → fades to normal
- [ ] **P2-07** Traffic overlay: requests-per-second on Service edges from Prometheus
- [ ] **P2-08** Security score overlay: missing NetworkPolicy = red ring
- [ ] **P2-09** Export: PNG / SVG / interactive HTML snapshot
- [ ] **P2-10** AI explain: click node → GPT summary of resource purpose and risk

---

## 5. Backend Supporting Tasks

- [ ] **B-AGT-01** Add `category` field to topology API response nodes: `"workload" | "networking" | "storage" | "rbac" | "infra" | "system"`
- [ ] **B-AGT-02** Add `?view=arborist` query param: return only ownership edges
- [ ] **B-AGT-03** Add `?view=pathfinder` query param: return only routing path edges
- [ ] **B-AGT-04** Add `lane` field to nodes when `view=pathfinder`: `0=ingress | 1=service | 2=workload | 3=pod`

> See `docs/topology-enhancements-tasks.md` for the full 60+ resource kind relationship coverage tasks.

---

## 6. Tab Lifecycle Plan

```
Phase 1 (Now):
  Tab 0: "AGT ✦"   → ReactFlow AGT  (NEW, DEFAULT)
  Tab 1: "Network"  → Cytoscape (renamed to "Classic")
  Tab 2: "Force"    → D3 force   (unchanged)

Phase 2 (After AGT reaches parity with overlays + export):
  Tab 0: "AGT ✦"   → ReactFlow AGT (only tab)
  Remove Classic and Force tabs entirely
```

---

## 7. Definition of Done (Phase 1)

- [ ] AGT tab appears as first/default tab labeled "AGT ✦"
- [ ] All three view modes (Cosmos / Arborist / Pathfinder) render correctly
- [ ] Custom node cards display gradient header, kind icon, name, namespace, health ring
- [ ] Edge types are visually distinct (ownership vs traffic vs storage vs RBAC)
- [ ] Spotlight search (Cmd+K) finds and pans to any node
- [ ] Node click opens right detail panel with metadata and relationships list
- [ ] Dark mode renders with proper glassmorphism
- [ ] Built-in minimap shows overview with viewport indicator
- [ ] `npm run build` passes with zero TypeScript errors

---

*AGT Design Vision · Kubilitics v3.0 · February 2026*
*Designed with the obsessive craft that shipped macOS and Figma design systems*
