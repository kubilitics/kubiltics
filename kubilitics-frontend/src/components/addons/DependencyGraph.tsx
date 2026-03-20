/**
 * DependencyGraph — T8.12
 * SVG-based force-directed visual of addon dependencies.
 * Shows installed addons as nodes with edges for each dependency.
 * No external graphing library required.
 */
import { useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useInstalledAddons } from "@/hooks/useAddOnCatalog";
import { useActiveClusterId } from "@/hooks/useActiveClusterId";
import { GitBranch, ZoomIn, ZoomOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AddOnInstallWithHealth, AddOnDependency } from "@/types/api/addons";

// ── Layout helpers ─────────────────────────────────────────────────────────────

interface NodePos {
    id: string;
    x: number;
    y: number;
    label: string;
    status: string;
}

interface Edge {
    from: string;
    to: string;
}

/** Distribute nodes in a circle then use a simple spring layout pass. */
function computeLayout(nodes: string[], edges: Edge[], width: number, height: number): NodePos[] {
    const cx = width / 2;
    const cy = height / 2;
    const r = Math.min(cx, cy) * 0.7;

    // Initial positions — evenly spread on a circle.
    const pos = new Map<string, { x: number; y: number }>();
    nodes.forEach((id, i) => {
        const angle = (2 * Math.PI * i) / nodes.length;
        pos.set(id, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
    });

    // 30 spring-layout iterations.
    const K = 80;   // natural spring length
    const C_rep = 3_000; // repulsion constant
    for (let iter = 0; iter < 30; iter++) {
        const delta = new Map<string, { dx: number; dy: number }>();
        for (const id of nodes) delta.set(id, { dx: 0, dy: 0 });

        // Repulsion between all pairs.
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = pos.get(nodes[i])!;
                const b = pos.get(nodes[j])!;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
                const f = C_rep / (dist * dist);
                const da = delta.get(nodes[i])!;
                const db = delta.get(nodes[j])!;
                da.dx -= (dx / dist) * f;
                da.dy -= (dy / dist) * f;
                db.dx += (dx / dist) * f;
                db.dy += (dy / dist) * f;
            }
        }

        // Attraction along edges.
        for (const edge of edges) {
            const a = pos.get(edge.from);
            const b = pos.get(edge.to);
            if (!a || !b) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
            const f = (dist - K) / 10;
            const da = delta.get(edge.from)!;
            const db = delta.get(edge.to)!;
            da.dx += (dx / dist) * f;
            da.dy += (dy / dist) * f;
            db.dx -= (dx / dist) * f;
            db.dy -= (dy / dist) * f;
        }

        // Apply deltas (clamped).
        for (const id of nodes) {
            const p = pos.get(id)!;
            const d = delta.get(id)!;
            const maxMove = 20;
            p.x += Math.min(Math.max(d.dx, -maxMove), maxMove);
            p.y += Math.min(Math.max(d.dy, -maxMove), maxMove);
            // Keep inside bounds with padding.
            p.x = Math.min(Math.max(p.x, 80), width - 80);
            p.y = Math.min(Math.max(p.y, 60), height - 60);
        }
    }

    return nodes.map((id) => ({
        id,
        x: pos.get(id)!.x,
        y: pos.get(id)!.y,
        label: id.split("/").pop() ?? id,
        status: "",
    }));
}

const statusColor: Record<string, string> = {
    installed: "#22c55e",
    installing: "#3b82f6",
    upgrading: "#a855f7",
    failed: "#ef4444",
    pending: "#f59e0b",
};

// ── Component ──────────────────────────────────────────────────────────────────

export function DependencyGraph() {
    const navigate = useNavigate();
    const clusterId = useActiveClusterId();
    const { data: installed = [], isLoading: loadingInstalled } = useInstalledAddons(clusterId ?? "");
    const [zoom, setZoom] = useState(1);
    const [hovered, setHovered] = useState<string | null>(null);

    const W = 900;
    const H = 520;

    // dependency edges come from install plan steps (no extra API call needed)
    // We use the installed addons IDs to build a minimal edge set from the
    // install plan's dependency_depth ordering as a heuristic. A richer
    // approach would call getCatalogEntry per addon but that's N+1 calls.
    // Instead, we build edges only from the install_plan field if available.
    const installedIds = useMemo(() => installed.map((i) => i.addon_id), [installed]);

    const edges = useMemo((): Edge[] => {
        // Build edges from install.catalog_entry.dependencies if present (AddOnDetail)
        const result: Edge[] = [];
        for (const inst of installed) {
            const detail = inst.catalog_entry as (typeof inst.catalog_entry & { dependencies?: AddOnDependency[] }) | undefined;
            const deps = detail?.dependencies ?? [];
            for (const dep of deps) {
                if (installedIds.includes(dep.depends_on_id)) {
                    result.push({ from: inst.addon_id, to: dep.depends_on_id });
                }
            }
        }
        return result;
    }, [installed, installedIds]);

    const layout = useMemo(() => {
        const nodes = computeLayout(installedIds, edges, W, H);
        // Overlay status colours.
        const statusMap = new Map<string, string>();
        installed.forEach((i) => statusMap.set(i.addon_id, i.status?.toLowerCase() ?? "installed"));
        return nodes.map((n) => ({ ...n, status: statusMap.get(n.id) ?? "installed" }));
    }, [installedIds, edges, installed]);

    // Find downstream nodes of the hovered node.
    const downstreamOf = useCallback(
        (id: string): Set<string> => {
            const visited = new Set<string>();
            const queue = [id];
            while (queue.length) {
                const cur = queue.shift()!;
                for (const e of edges) {
                    if (e.from === cur && !visited.has(e.to)) {
                        visited.add(e.to);
                        queue.push(e.to);
                    }
                }
            }
            return visited;
        },
        [edges]
    );

    const downstream = useMemo(
        () => (hovered ? downstreamOf(hovered) : new Set<string>()),
        [hovered, downstreamOf]
    );

    if (!clusterId) {
        return (
            <div className="flex flex-col items-center justify-center py-32 gap-4 text-slate-400">
                <GitBranch className="h-12 w-12 opacity-30" />
                <p className="text-sm">Select a cluster to view the dependency graph.</p>
            </div>
        );
    }

    if (loadingInstalled) {
        return (
            <div className="flex items-center justify-center py-32 text-slate-400 text-sm">
                <RefreshCw className="h-5 w-5 animate-spin mr-2" />
                Building graph…
            </div>
        );
    }

    if (installed.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-32 gap-4 text-slate-400">
                <GitBranch className="h-12 w-12 opacity-30" />
                <p className="text-sm">No addons installed. Install addons to see dependencies.</p>
            </div>
        );
    }

    const nodeRadius = 32;

    return (
        <div className="glass-card p-4 rounded-2xl border border-slate-200/60 shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <GitBranch className="h-5 w-5 text-primary" />
                    <span className="font-bold text-slate-700 text-sm">Addon Dependency Graph</span>
                    <Badge variant="secondary" className="text-[10px]">
                        {installed.length} addons · {edges.length} dependencies
                    </Badge>
                </div>
                <div className="flex gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setZoom((z) => Math.min(z + 0.2, 2.5))}
                        title="Zoom in"
                    >
                        <ZoomIn className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setZoom((z) => Math.max(z - 0.2, 0.4))}
                        title="Zoom out"
                    >
                        <ZoomOut className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* Graph Canvas */}
            <div className="overflow-auto rounded-xl bg-slate-50/60 border border-slate-100">
                <svg
                    width={W * zoom}
                    height={H * zoom}
                    viewBox={`0 0 ${W} ${H}`}
                    style={{ display: "block", minWidth: `${W * zoom}px`, minHeight: `${H * zoom}px` }}
                >
                    <defs>
                        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                            <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
                        </marker>
                    </defs>

                    {/* Edges */}
                    {edges.map((edge, i) => {
                        const from = layout.find((n) => n.id === edge.from);
                        const to = layout.find((n) => n.id === edge.to);
                        if (!from || !to) return null;
                        const isHighlighted =
                            hovered === edge.from || hovered === edge.to || downstream.has(edge.from) || downstream.has(edge.to);
                        // Offset endpoints to the node boundary.
                        const dx = to.x - from.x;
                        const dy = to.y - from.y;
                        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                        const x1 = from.x + (dx / dist) * nodeRadius;
                        const y1 = from.y + (dy / dist) * nodeRadius;
                        const x2 = to.x - (dx / dist) * (nodeRadius + 10);
                        const y2 = to.y - (dy / dist) * (nodeRadius + 10);
                        return (
                            <line
                                key={i}
                                x1={x1}
                                y1={y1}
                                x2={x2}
                                y2={y2}
                                stroke={isHighlighted ? "#6366f1" : "#e2e8f0"}
                                strokeWidth={isHighlighted ? 2.5 : 1.5}
                                strokeOpacity={hovered && !isHighlighted ? 0.3 : 1}
                                markerEnd="url(#arrowhead)"
                                style={{ transition: "all 0.2s" }}
                            />
                        );
                    })}

                    {/* Nodes */}
                    {layout.map((node) => {
                        const isHovered = hovered === node.id;
                        const isDownstream = downstream.has(node.id);
                        const color = statusColor[node.status] ?? "#6366f1";
                        const dimmed = hovered && !isHovered && !isDownstream;
                        return (
                            <g
                                key={node.id}
                                transform={`translate(${node.x},${node.y})`}
                                className={`transition-all duration-300 ${hovered && !isHovered && !isDownstream ? "opacity-20 translate-y-2 scale-90" : "opacity-100"} cursor-pointer`}
                                onMouseEnter={() => setHovered(node.id)}
                                onMouseLeave={() => setHovered(null)}
                                onClick={() => navigate(`/addons/${encodeURIComponent(node.id)}`)}
                            >
                                {/* Shadow ring */}
                                <circle
                                    r={nodeRadius + 4}
                                    fill={isHovered || isDownstream ? color : "transparent"}
                                    opacity={0.12}
                                />
                                {/* Main circle */}
                                <circle
                                    r={nodeRadius}
                                    fill="white"
                                    stroke={color}
                                    strokeWidth={isHovered ? 3 : 2}
                                    filter="url(#shadow)"
                                />
                                {/* Status dot */}
                                <circle cx={nodeRadius - 8} cy={-(nodeRadius - 8)} r={5} fill={color} />
                                {/* Label */}
                                <text
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    fontSize={10}
                                    fontWeight={isHovered ? 700 : 500}
                                    fill="#334155"
                                    style={{ pointerEvents: "none", userSelect: "none" }}
                                >
                                    {node.label.length > 12 ? node.label.slice(0, 11) + "…" : node.label}
                                </text>
                                {/* Full ID on hover tooltip */}
                                {isHovered && (
                                    <text
                                        y={nodeRadius + 16}
                                        textAnchor="middle"
                                        fontSize={9}
                                        fill="#6366f1"
                                        fontWeight={600}
                                        style={{ pointerEvents: "none" }}
                                    >
                                        {node.id}
                                    </text>
                                )}
                            </g>
                        );
                    })}

                    {/* Subtle drop shadow filter */}
                    <defs>
                        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                            <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#0f172a" floodOpacity="0.08" />
                        </filter>
                    </defs>
                </svg>
            </div>

            {/* Legend */}
            <div className="flex gap-3 mt-3 flex-wrap">
                {Object.entries(statusColor).map(([status, color]) => (
                    <div key={status} className="flex items-center gap-1.5">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                        <span className="text-[10px] text-slate-500 capitalize">{status}</span>
                    </div>
                ))}
                <div className="flex items-center gap-1.5 ml-auto">
                    <span className="text-[10px] text-slate-400 italic">Hover a node to highlight dependents</span>
                </div>
            </div>
        </div>
    );
}
