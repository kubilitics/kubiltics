# Topology First Impression Fix — Design Spec

**Date:** 2026-03-30
**Status:** Draft
**Scope:** Make depth=0 topology show meaningful relationships between visible resources

## Problem

On a 691-resource docker-desktop cluster, the topology first impression is:
- 73 disconnected nodes (Services, Deployments, Namespaces)
- Only ingress→service edges visible
- **Services and Deployments appear completely disconnected**
- No ownership, selector, or dependency edges between visible resources
- User sees a flat, meaningless map of boxes

## Root Cause

1. `MaxTopologyNodes = 500` forces depth=0 when total > 500
2. At depth=0, Pods and ReplicaSets are hidden
3. The Service→Pod→ReplicaSet→Deployment edge chain has all intermediate nodes hidden
4. `collapseEdges()` was supposed to reroute these, but it only works with ownership edges that exist between VISIBLE nodes — not hidden ones
5. The full edge set is built BEFORE depth filtering, but `collapseEdges` only sees edges between filtered nodes

## Fix: Synthesize Direct Edges Between Visible Resources

Instead of trying to collapse edges through hidden nodes (complex, fragile), **synthesize direct edges** between visible resources at depth=0 using a simple rule:

**If Service X selects Pods owned by Deployment Y, create a direct edge Service X → Deployment Y with type "serves" (or "routes_to").**

This is computed BEFORE depth filtering, from the full topology data:

```
For each Service with selector edges to Pods:
  For each Pod matched by the selector:
    Walk ownerRef chain: Pod → ReplicaSet → Deployment/StatefulSet/DaemonSet
    Create synthetic edge: Service → Deployment (type: "routes_to", detail: "via N pods")
```

Similarly for other important cross-depth relationships:
- HPA → Deployment (already direct, should survive depth filtering)
- Ingress → Service (already direct, works)

## Implementation

### Backend Change (one file)

**File:** `kubilitics-backend/internal/topology/v2/builder/depth_filter.go`

Add a `synthesizeDepthZeroEdges()` function called before filtering:

```go
func synthesizeDepthZeroEdges(nodes []TopologyNode, edges []TopologyEdge) []TopologyEdge {
    // Build: podID → owning workload ID (Deployment/StatefulSet/DaemonSet)
    podOwner := map[string]string{}
    for _, e := range edges {
        if e.RelationshipType == "ownerRef" {
            // Pod → ReplicaSet, then ReplicaSet → Deployment
            podOwner[e.Source] = e.Target
        }
    }

    // Resolve transitive ownership: Pod → RS → Deployment
    resolveOwner := func(id string) string {
        visited := map[string]bool{}
        for {
            if visited[id] { break }
            visited[id] = true
            next, ok := podOwner[id]
            if !ok { break }
            id = next
        }
        return id
    }

    // For each selector edge (Service → Pod), create Service → Deployment
    seen := map[string]bool{}
    var synthetic []TopologyEdge
    for _, e := range edges {
        if e.RelationshipType != "selector" { continue }
        svcID := e.Source  // Service
        podID := e.Target  // Pod
        workloadID := resolveOwner(podID)
        if workloadID == podID { continue } // no owner found

        key := svcID + "|" + workloadID
        if seen[key] { continue }
        seen[key] = true

        synthetic = append(synthetic, TopologyEdge{
            ID:                   "synth:" + svcID + "→" + workloadID,
            Source:               svcID,
            Target:               workloadID,
            RelationshipType:     "routes_to",
            RelationshipCategory: "networking",
            Label:                "routes to",
            Detail:               "via pod selector",
        })
    }
    return append(edges, synthetic...)
}
```

Call this in `FilterByDepth` when depth=0, before pruning edges.

### Performance

Zero overhead — runs once during depth filtering, O(edges) time.

### What This Achieves

At depth=0, the user sees:
```
Ingress → Service → Deployment
                  → StatefulSet
```

Clear, meaningful connections. The topology shows HOW traffic flows from Ingress through Services to workloads. This is the "wow" first impression.

## What NOT to Change

- Don't change MaxTopologyNodes limit
- Don't change depth level definitions
- Don't touch the frontend — edges are edges, the canvas renders them the same way
- Don't change relationship matchers
