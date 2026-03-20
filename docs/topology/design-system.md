# TOPOLOGY ENGINE v2.0 — Design System Document

**Document:** design-system.md  
**Purpose:** Complete visual and interaction design specification for the topology rewrite  
**Audience:** Frontend engineers, designers, QA engineers  
**Status:** Authoritative — all implementation must match this spec exactly

---

## 1. Design Philosophy

### 1.1 The Problem We Are Solving

The current topology has three fundamental design failures:

1. **Information density without information hierarchy.** Every node looks the same regardless of type, importance, or health. The eye has no anchor point.
2. **Color used decoratively, not semantically.** Colors don't communicate meaning. A red node might be a Service or a failing Pod — you can't tell at a glance.
3. **Layout treats a directed graph as a random scatter.** Kubernetes has a natural information flow (Ingress → Service → Workload → Pod → Infrastructure). The layout doesn't respect this.

### 1.2 Design Principles

**Principle: Hierarchy through Typography, Color, and Position**
- Resource kind is communicated through the header color
- Health status is communicated through the left border
- Importance is communicated through position (top = entry point, bottom = infrastructure)
- Connections are communicated through labeled, styled edges

**Principle: Every Pixel Must Earn Its Place**
- No decorative elements. No gradients for aesthetics. No shadows for depth illusion.
- Every visual choice communicates something: type, health, relationship, or metric.

**Principle: Light Enough for Large Graphs, Rich Enough for Detail**
- At zoom-out: nodes are colored rectangles with a name. Edges are lines.
- At zoom-in: nodes show metrics, labels, and status detail. Edges show relationship labels.
- The transition is smooth and semantic, not abrupt.

---

## 2. Color System

### 2.1 Brand Palette

```
Primary:        #1B4F72  (Deep blue — headers, primary actions)
Primary Light:  #2E86C1  (Medium blue — links, interactive elements)
Background:     #FFFFFF  (White — canvas background, light mode)
Background Alt: #F8FAFC  (Slate-50 — group backgrounds, alternating rows)
Dark BG:        #0F172A  (Slate-900 — canvas background, dark mode)
Dark Surface:   #1E293B  (Slate-800 — node background, dark mode)
Text Primary:   #1E293B  (Slate-800 — primary text, light mode)
Text Secondary: #64748B  (Slate-500 — secondary text, labels)
Text on Dark:   #F1F5F9  (Slate-100 — text on dark backgrounds)
Border:         #E2E8F0  (Slate-200 — borders, dividers)
```

### 2.2 Resource Category Colors

These colors are used for node header bars and are the primary visual differentiator between resource types.

| Category | Light Mode Header | Dark Mode Header | Light Mode BG | Dark Mode BG | Usage |
|----------|------------------|-----------------|---------------|-------------|-------|
| Workloads | `#2563EB` (Blue-600) | `#3B82F6` (Blue-500) | `#EFF6FF` (Blue-50) | `#1E3A5F` | Pod, Deployment, StatefulSet, DaemonSet, Job, CronJob, ReplicaSet, ReplicationController |
| Networking | `#7C3AED` (Violet-600) | `#8B5CF6` (Violet-500) | `#F5F3FF` (Violet-50) | `#2D1B69` | Service, Endpoints, EndpointSlice, Ingress, IngressClass, NetworkPolicy |
| Configuration | `#0D9488` (Teal-600) | `#14B8A6` (Teal-500) | `#F0FDFA` (Teal-50) | `#134E4A` | ConfigMap, Secret, Namespace, ResourceQuota, LimitRange |
| Storage | `#EA580C` (Orange-600) | `#F97316` (Orange-500) | `#FFF7ED` (Orange-50) | `#431407` | PVC, PV, StorageClass, VolumeSnapshot, VolumeAttachment |
| RBAC | `#D97706` (Amber-600) | `#F59E0B` (Amber-500) | `#FFFBEB` (Amber-50) | `#451A03` | ServiceAccount, Role, RoleBinding, ClusterRole, ClusterRoleBinding |
| Scaling | `#16A34A` (Green-600) | `#22C55E` (Green-500) | `#F0FFF4` (Green-50) | `#14532D` | HPA, VPA, PDB, PriorityClass |
| Cluster | `#475569` (Slate-600) | `#94A3B8` (Slate-400) | `#F8FAFC` (Slate-50) | `#334155` | Node, RuntimeClass, ComponentStatus |
| Extensions | `#DB2777` (Pink-600) | `#EC4899` (Pink-500) | `#FDF2F8` (Pink-50) | `#500724` | CRD, CustomResource, MutatingWebhook, ValidatingWebhook, APIService |

### 2.3 Health Status Colors

| Status | Dot Color | Left Border | Node Tint (Light) | Node Tint (Dark) | Edge Color |
|--------|----------|-------------|--------------------|--------------------|------------|
| Healthy | `#16A34A` | 4px `#16A34A` | `#F0FFF4` | `#14532D20` | `#16A34A` |
| Warning | `#EAB308` | 4px `#EAB308` | `#FEFCE8` | `#42200720` | `#EAB308` |
| Error | `#DC2626` | 4px `#DC2626` | `#FEF2F2` | `#45050520` | `#DC2626` |
| Unknown | `#9CA3AF` | 4px `#9CA3AF` | `#F9FAFB` | `#37415120` | `#9CA3AF` |

### 2.4 Edge Colors by Relationship Category

| Category | Light Mode | Dark Mode | Style |
|----------|-----------|-----------|-------|
| Ownership | `#1E40AF` (Blue-800) | `#60A5FA` (Blue-400) | Solid, 2px |
| Selection/Matching | `#6D28D9` (Violet-700) | `#A78BFA` (Violet-400) | Dashed (5,5), 2px |
| Mount/Reference | `#0F766E` (Teal-700) | `#5EEAD4` (Teal-300) | Dotted (3,3), 1.5px |
| Routing | `#7C3AED` (Violet-600) | `#8B5CF6` (Violet-500) | Solid, 2.5px |
| RBAC Binding | `#B45309` (Amber-700) | `#FCD34D` (Amber-300) | Dashed (8,4), 1.5px |
| Scheduling | `#475569` (Slate-600) | `#94A3B8` (Slate-400) | Dotted (2,4), 1px |
| Scaling | `#15803D` (Green-700) | `#86EFAC` (Green-300) | Dashed (6,3), 1.5px |
| Protection/Policy | `#B91C1C` (Red-700) | `#FCA5A5` (Red-300) | Dashed (4,4), 1.5px |

### 2.5 Contrast Verification

All text-on-background combinations MUST meet WCAG AA (4.5:1 ratio):

| Combination | Light Mode Ratio | Dark Mode Ratio | Pass? |
|-------------|-----------------|-----------------|-------|
| Primary text on white | 12.6:1 | — | ✅ |
| Primary text on dark BG | — | 11.8:1 | ✅ |
| Header text on Blue-600 | 8.5:1 (white) | — | ✅ |
| Header text on Violet-600 | 7.2:1 (white) | — | ✅ |
| Edge label on white pill | 5.7:1 | — | ✅ |
| Edge label on dark pill | — | 6.3:1 | ✅ |
| Status dot on any BG | N/A (color + shape) | N/A | ✅ |

---

## 3. Node Component Design

### 3.1 Node Structure (Standard)

```
Width: 240px (configurable by view mode)
Min Height: 100px (grows with content)
Border Radius: 8px
Shadow: 0 1px 3px rgba(0,0,0,0.1) (light), 0 1px 3px rgba(0,0,0,0.3) (dark)
Border: 1px solid var(--border-color)
Health Border: 4px solid var(--health-color) on LEFT edge only

┌─ Health border (4px)
│ ┌────────────────────────────────────┐
│ │ [Icon] ResourceKind          [●]  │ ← Header (28px height, category BG color)
│ ├────────────────────────────────────┤
│ │ resource-name-here                 │ ← Name (14px, bold, primary text color)
│ │ namespace                          │ ← Namespace (12px, secondary text color)
│ ├────────────────────────────────────┤ ← Divider (1px, border color)
│ │ ● Running      Restarts: 0        │ ← Status row (12px)
│ │ CPU: 120m/500m  Mem: 256Mi/512Mi   │ ← Metrics row (11px, monospace)
│ └────────────────────────────────────┘
```

### 3.2 Node Structure (Compact — for large graphs)

When more than 200 nodes are visible, nodes switch to compact mode:

```
Width: 160px
Height: 48px
Border Radius: 6px

┌─ Health border (3px)
│ ┌───────────────────────────┐
│ │ [Icon] resource-name [●]  │ ← Single line, 12px, ellipsis overflow
│ │ Kind • namespace          │ ← Sub-line, 10px, secondary color
│ └───────────────────────────┘
```

### 3.3 Node Structure (Expanded — Resource-Centric focus node)

The selected/focus resource in Resource-Centric mode gets an expanded node:

```
Width: 320px
Min Height: 180px
Border: 2px solid var(--primary-color)
Shadow: 0 4px 12px rgba(0,0,0,0.15)

┌─ Health border (6px)
│ ┌──────────────────────────────────────────┐
│ │ [Icon] ResourceKind                 [●]  │ ← Header (32px)
│ ├──────────────────────────────────────────┤
│ │ resource-name-here                       │ ← Name (16px, bold)
│ │ namespace                                │ ← Namespace (13px)
│ ├──────────────────────────────────────────┤
│ │ Status: ● Running                        │ ← Status (13px)
│ │ Created: 2026-02-24T10:30:00Z            │ ← Age (12px)
│ ├──────────────────────────────────────────┤
│ │ CPU:    ████████░░  120m / 500m (24%)    │ ← CPU bar (progress bar)
│ │ Memory: ██████████░ 256Mi / 512Mi (50%)  │ ← Memory bar (progress bar)
│ ├──────────────────────────────────────────┤
│ │ Labels: app=payment, version=v2          │ ← Key labels (12px, chips)
│ │ Connections: 14 resources                │ ← Connection count
│ └──────────────────────────────────────────┘
```

### 3.4 Resource Icons

Each resource kind has a dedicated icon from the Lucide icon set:

| Resource | Lucide Icon | Fallback |
|----------|------------|----------|
| Pod | `box` | 📦 |
| Deployment | `layers` | 🔄 |
| StatefulSet | `database` | 💾 |
| DaemonSet | `copy` | 📋 |
| ReplicaSet | `copy-plus` | 📄 |
| Job | `play` | ▶ |
| CronJob | `clock` | ⏰ |
| Service | `globe` | 🌐 |
| Ingress | `arrow-right-circle` | ➡ |
| Endpoints | `target` | 🎯 |
| EndpointSlice | `split` | 🔀 |
| ConfigMap | `file-text` | 📝 |
| Secret | `key` | 🔑 |
| Namespace | `folder` | 📁 |
| PVC | `hard-drive` | 💿 |
| PV | `server` | 🖥 |
| StorageClass | `archive` | 📀 |
| Node | `cpu` | 🖥 |
| ServiceAccount | `user` | 👤 |
| Role / ClusterRole | `shield` | 🛡 |
| RoleBinding / CRB | `link` | 🔗 |
| HPA | `trending-up` | 📈 |
| VPA | `sliders` | 🎛 |
| PDB | `shield-check` | ✅ |
| NetworkPolicy | `lock` | 🔒 |
| IngressClass | `settings` | ⚙ |
| CRD | `puzzle` | 🧩 |
| MutatingWebhook | `zap` | ⚡ |
| ValidatingWebhook | `check-circle` | ✓ |

### 3.5 Group (Namespace Container) Design

```
Border Radius: 12px
Border: 1.5px dashed var(--category-color-300)
Background: var(--category-color-50) at 40% opacity
Padding: 24px top (for label), 16px sides, 16px bottom

┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
╎  📁 production                [14 pods] [●]    ╎ ← Group header (outside or top-pinned)
╎                                                  ╎
╎   ┌──────────┐  ┌──────────┐  ┌──────────┐      ╎
╎   │ Node 1   │  │ Node 2   │  │ Node 3   │      ╎
╎   └──────────┘  └──────────┘  └──────────┘      ╎
╎                                                  ╎
╎   ┌──────────┐  ┌──────────┐                     ╎
╎   │ Node 4   │  │ Node 5   │                     ╎
╎   └──────────┘  └──────────┘                     ╎
╎                                                  ╎
└╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
```

Group health badge:
- `●` Green: > 90% pods healthy
- `●` Yellow: 70-90% pods healthy
- `●` Red: < 70% pods healthy

---

## 4. Edge Component Design

### 4.1 Edge Line Rendering

```
All edges use SVG <path> elements with:
- Orthogonal routing (right angles) for ownership and routing edges
- Bezier curves for selection and mount edges
- Straight lines for scheduling edges

Arrow styles:
- Filled triangle (6x8px): ownership, routing
- Open triangle (6x8px): selection, binding
- Diamond (6x6px): mount/reference
- Circle (4px): scheduling
- Double triangle (8x8px): scaling
```

### 4.2 Edge Label Rendering

```
Label container:
- Background: white (light) / slate-800 (dark)
- Border: 1px solid var(--border-color)
- Border Radius: 4px
- Padding: 2px 6px
- Font: 10px, var(--text-secondary)
- Position: midpoint of edge path
- Max width: 180px (truncate with ellipsis)
- Z-index: above edges, below nodes

Anti-overlap algorithm:
1. Calculate label positions at edge midpoints
2. Detect overlapping bounding boxes
3. Shift overlapping labels along the edge path (toward source or target)
4. If still overlapping, stack vertically with 4px gap
5. If >3 labels would stack, collapse into "[3 connections]" badge
```

### 4.3 Edge Hover State

```
On hover:
- Edge width increases by 1px
- Edge opacity increases to 100% (from default 70%)
- Label becomes fully visible (no truncation)
- Source and target nodes get a subtle glow (box-shadow: 0 0 8px var(--edge-color))
- All other edges dim to 30% opacity
```

### 4.4 Edge Selection State

```
On click:
- Edge color changes to var(--primary)
- Edge width increases by 2px
- Label is fully expanded
- Detail panel shows edge information:
  - Relationship type
  - Source and target resource
  - Detection method
  - Health status of the connection
```

---

## 5. Viewport & Canvas

### 5.1 Canvas Properties

```
Background: #FFFFFF (light) / #0F172A (dark)
Grid: 
  - Light mode: dots, #E2E8F0, 20px spacing, visible at zoom > 0.5x
  - Dark mode: dots, #334155, 20px spacing, visible at zoom > 0.5x
Zoom range: 0.1x to 4x
Default zoom: fit-to-content
Pan limits: 500px beyond content bounds in all directions
```

### 5.2 Minimap

```
Position: bottom-right corner, 16px margin
Size: 200px × 150px (maintains aspect ratio of canvas)
Background: var(--bg) with 90% opacity
Border: 1px solid var(--border)
Border Radius: 8px
Shadow: 0 2px 8px rgba(0,0,0,0.15)

Contents:
- Simplified node rectangles (no text, just colored rectangles)
- Viewport indicator (blue rectangle with 2px border)
- Draggable viewport indicator for navigation

Always visible: true
Toggle: "M" key or minimap button
```

### 5.3 Zoom Behavior

```
Scroll zoom:
- Centered on cursor position
- Smooth transition (200ms ease-out)
- Step: 10% per scroll tick

Pinch zoom (trackpad/touch):
- Centered between fingers
- Real-time (no animation delay)

Button zoom:
- +/- buttons in toolbar
- Step: 25% per click
- Centered on viewport center

Zoom-to-fit ("F" key):
- Calculates bounding box of all visible nodes
- Adds 40px padding
- Animates to fit (300ms ease-in-out)
- Respects min zoom of 0.1x

Semantic zoom levels:
- < 0.3x: Nodes show only colored rectangles (no text)
- 0.3x - 0.6x: Nodes show compact mode (name + kind)
- 0.6x - 1.5x: Nodes show standard mode (name + status + metrics)
- > 1.5x: Nodes show expanded details (labels, annotations preview)
```

### 5.4 Pan Behavior

```
Mouse drag: 
- Left button drag on empty canvas = pan
- Cursor: grab → grabbing

Touch drag:
- Single finger on empty area = pan
- Smooth momentum (deceleration after release)

Keyboard pan:
- Arrow keys: 50px per press
- Shift+Arrow: 200px per press
```

---

## 6. Dark Mode Design

### 6.1 Color Mapping

| Element | Light Mode | Dark Mode |
|---------|-----------|-----------|
| Canvas background | `#FFFFFF` | `#0F172A` |
| Node background | `#FFFFFF` | `#1E293B` |
| Node border | `#E2E8F0` | `#334155` |
| Node header BG | Category color (600 shade) | Category color (500 shade) |
| Primary text | `#1E293B` | `#F1F5F9` |
| Secondary text | `#64748B` | `#94A3B8` |
| Edge default | 70% opacity of edge color | 60% opacity of edge color |
| Edge label BG | `#FFFFFF` | `#1E293B` |
| Edge label border | `#E2E8F0` | `#475569` |
| Group background | Category-50 at 40% | Category-900 at 20% |
| Group border | Category-300 | Category-700 |
| Minimap BG | `#F8FAFC` at 90% | `#1E293B` at 90% |
| Grid dots | `#E2E8F0` | `#334155` |
| Selection highlight | `#2563EB` at 20% | `#3B82F6` at 20% |

### 6.2 Dark Mode Rules

1. **Never use pure black** (`#000000`). Darkest background is `#0F172A`.
2. **Never use pure white text** on dark. Brightest text is `#F1F5F9`.
3. **Reduce opacity of decorative elements** (edges, grid, group borders) by 10-20% in dark mode.
4. **Health colors remain the same** in both modes — green, yellow, red, gray are universal.
5. **Category header colors shift one shade lighter** in dark mode for readability against dark node backgrounds.

---

## 7. Responsive Behavior

### 7.1 Breakpoints

| Screen Width | Behavior |
|-------------|----------|
| > 1440px | Full layout: topology + detail panel side by side |
| 1024-1440px | Topology fills width, detail panel overlays as drawer |
| 768-1024px | Compact nodes, detail panel as bottom sheet |
| < 768px (mobile) | Simplified topology with tap-to-expand, full-screen detail |

### 7.2 Mobile-Specific Adaptations

- Nodes use compact mode by default
- Edge labels hidden by default (shown on edge tap)
- Minimap hidden (full-screen button instead)
- Toolbar collapses to hamburger menu
- Detail panel is a full-screen bottom sheet (swipe up/down)
- Double-tap to zoom, pinch to zoom
- Long-press on node for context menu

---

## 8. Animation & Transition Spec

### 8.1 Transitions

| Action | Duration | Easing | Property |
|--------|----------|--------|----------|
| Node appear | 300ms | ease-out | opacity 0→1, scale 0.8→1 |
| Node remove | 200ms | ease-in | opacity 1→0, scale 1→0.8 |
| Node health change | 500ms | ease-in-out | border-color, background-color |
| Edge appear | 300ms | ease-out | opacity 0→1, path draw |
| Edge remove | 200ms | ease-in | opacity 1→0 |
| Group expand | 400ms | ease-in-out | size, position of all children |
| Group collapse | 300ms | ease-in-out | size, position, children fade |
| View mode change | 500ms | ease-in-out | all node positions (layout morph) |
| Zoom to fit | 300ms | ease-in-out | transform (scale + translate) |
| Detail panel open | 250ms | ease-out | translateX (slide in from right) |
| Detail panel close | 200ms | ease-in | translateX (slide out to right) |
| Node selection dim | 200ms | ease-out | opacity of non-connected nodes |

### 8.2 Micro-interactions

- **Node hover:** 0.5px border increase, subtle shadow increase (100ms)
- **Edge hover:** width increase + glow (150ms)
- **Health pulse:** Errored nodes have a subtle pulse animation (2s loop, 5% opacity change)
- **Real-time update flash:** When a node updates via WebSocket, brief flash of blue border (400ms)
- **Loading skeleton:** During graph build, show layout skeleton with placeholder nodes (gray rectangles)

---

## 9. Accessibility

### 9.1 Keyboard Navigation

- `Tab` cycles through nodes (in layout order)
- `Shift+Tab` cycles backwards
- `Enter` on focused node = select (opens detail panel)
- `Escape` = deselect / close panel / go back one level
- `Space` on focused node = toggle expand/collapse (for groups)
- Arrow keys = pan canvas (when no node focused)

### 9.2 Screen Reader Support

- Every node has an `aria-label`: "Pod payment-api-7d8b9c-xyz in namespace production, status Running, CPU 24%, Memory 50%"
- Every edge has an `aria-label`: "Pod payment-api-7d8b9c-xyz owned by ReplicaSet payment-api-7d8b9c"
- Groups have `role="group"` with `aria-label`: "Namespace production, 14 pods, healthy"
- View mode changes announced: "Switched to namespace view for production"

### 9.3 Color-Blind Safety

- Health status uses **color + shape + text** (never color alone):
  - Healthy: Green dot + "Running" text
  - Warning: Yellow triangle + "Warning" text
  - Error: Red square + "Error" text
  - Unknown: Gray dash + "Unknown" text
- Edge relationship types use **color + line style** (solid/dashed/dotted)
- All color choices tested against deuteranopia, protanopia, and tritanopia simulations
