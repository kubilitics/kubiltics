# Topology V2 — User Guide

## Overview
The Topology V2 engine provides an interactive visualization of your Kubernetes cluster resources and their relationships. It supports five view modes, semantic zoom, real-time updates, and multiple export formats.

## View Modes

### 1. Cluster View
High-level overview showing namespace summary cards. Each card displays resource counts (deployments, pods, services, jobs), health summary, and optional cost. Click a namespace card to drill into Namespace View.

### 2. Namespace View
Shows all resources within a namespace with hierarchical grouping. Resources are connected by relationship edges (ownership, networking, configuration, etc.). This is the default view.

### 3. Workload View
Groups resources by workload type (Deployments, StatefulSets, DaemonSets, Jobs). Useful for understanding workload distribution and health.

### 4. Resource-Centric View
BFS (Breadth-First Search) exploration centered on a specific resource. Double-click any resource to re-center the graph around it. Shows up to 3 hops of related resources.

### 5. RBAC View
Visualizes Role-Based Access Control relationships: ServiceAccounts, Roles, ClusterRoles, RoleBindings, and their connections.

## Semantic Zoom
The graph automatically adapts detail level based on zoom:

- **<0.3x** — Minimal: colored dots with tiny name labels
- **0.3x-0.6x** — Compact: icon, name, and status dot
- **0.6x-1.5x** — Base: kind header, name, namespace, status
- **>1.5x** — Expanded: full metrics (CPU, memory, pods, restarts), labels, and status details

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| F | Fit all nodes to screen |
| 1-5 | Switch view mode |
| / | Focus search input |
| +/- | Zoom in/out |
| Escape | Deselect node / Close panel / Navigate back |
| E | Toggle edge labels |
| M | Toggle minimap |
| H | Toggle health overlay |
| C | Toggle cost overlay |
| S | Screenshot to clipboard (PNG) |
| ? | Show keyboard shortcuts |
| Backspace | Navigate back |

## Overlays

### Health Overlay (H)
Colors node borders by health status: green (healthy), amber (warning), red (error), gray (unknown). A legend appears at the bottom of the canvas.

### Cost Overlay (C)
Displays monthly estimated cost badges on nodes. Color-coded by cost tier: green (<$10), amber ($10-$100), red (>$100).

## Search
Press `/` to focus the search bar. Type to filter resources by name, kind, or namespace. Matching nodes are highlighted; non-matching nodes are dimmed. Clear the search to restore all nodes.

## Export Formats
- **PNG** — Screenshot to clipboard (press S)
- **PDF** — Full topology with header/footer
- **JSON** — Raw topology data (nodes + edges)
- **DrawIO** — Import into draw.io/diagrams.net

## Deep Linking
Every view state is reflected in the URL. Share URLs to link directly to specific views:
- `/topology?mode=2&ns=production` — Production namespace
- `/topology?mode=4&resource=deployment/nginx` — Nginx deployment exploration
- `/topology?mode=5` — RBAC view

## Real-Time Updates
When connected to a live cluster, the topology updates in real-time via WebSocket. A green dot in the toolbar indicates an active connection. If disconnected, a banner shows reconnection countdown with exponential backoff.

## Configuration

### Feature Flag
Set `TOPOLOGY_V2_ENABLED=true` to enable the v2 engine. Defaults to `false` for gradual rollout.

### Performance Tuning
The engine handles up to 2000 resources. For larger clusters, use namespace filtering to reduce graph size. The ELK layout engine uses deterministic seed (42) for consistent positioning across refreshes.
