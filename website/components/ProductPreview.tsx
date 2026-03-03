"use client";

import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";

// Kubernetes resource graph definitions
const GRAPHS = [
    {
        id: "relationship",
        title: "Relationship Graph",
        label: "Live dependency map",
        accent: "#4F7BF7",
        viewBox: "0 0 480 220",
        nodes: [
            { id: "api", x: 60, y: 110, label: "api-server", kind: "Deployment", color: "#4F7BF7" },
            { id: "svc", x: 200, y: 60, label: "api-svc", kind: "Service", color: "#2FC8B8" },
            { id: "cfg", x: 200, y: 160, label: "app-config", kind: "ConfigMap", color: "#F5A623" },
            { id: "ing", x: 340, y: 60, label: "api-ingress", kind: "Ingress", color: "#F56C42" },
            { id: "sec", x: 340, y: 160, label: "db-secret", kind: "Secret", color: "#EC4899" },
            { id: "sa", x: 60, y: 40, label: "api-sa", kind: "ServiceAccount", color: "#9B7CF4" },
        ],
        edges: [
            { from: [60, 110], to: [200, 60] },
            { from: [60, 110], to: [200, 160] },
            { from: [60, 110], to: [340, 160] },
            { from: [200, 60], to: [340, 60] },
            { from: [60, 40], to: [60, 110] },
        ],
    },
    {
        id: "impact",
        title: "Impact Analysis",
        label: "Pre-change blast radius",
        accent: "#F56C42",
        viewBox: "0 0 480 220",
        nodes: [
            { id: "db", x: 60, y: 110, label: "postgres-config", kind: "ConfigMap", color: "#F5A623" },
            { id: "api", x: 220, y: 60, label: "api-server", kind: "Deployment", color: "#4F7BF7" },
            { id: "worker", x: 220, y: 160, label: "bg-worker", kind: "Deployment", color: "#4F7BF7" },
            { id: "front", x: 380, y: 90, label: "frontend", kind: "Deployment", color: "#4F7BF7" },
            { id: "cron", x: 380, y: 160, label: "cron-job", kind: "CronJob", color: "#9B7CF4" },
        ],
        edges: [
            { from: [60, 110], to: [220, 60], danger: true },
            { from: [60, 110], to: [220, 160], danger: true },
            { from: [220, 60], to: [380, 90] },
            { from: [220, 160], to: [380, 160] },
        ],
    },
    {
        id: "storage",
        title: "Storage Chain",
        label: "PVC lineage tracer",
        accent: "#9B7CF4",
        viewBox: "0 0 480 220",
        nodes: [
            { id: "pv", x: 50, y: 110, label: "data-pv", kind: "PersistentVolume", color: "#9B7CF4" },
            { id: "pvc", x: 185, y: 110, label: "data-pvc", kind: "PersistentVolumeClaim", color: "#9B7CF4" },
            { id: "pod", x: 315, y: 70, label: "postgres-0", kind: "Pod", color: "#2FD07D" },
            { id: "pod2", x: 315, y: 150, label: "postgres-1", kind: "Pod", color: "#2FD07D" },
            { id: "sts", x: 430, y: 110, label: "postgres", kind: "StatefulSet", color: "#4F7BF7" },
        ],
        edges: [
            { from: [50, 110], to: [185, 110] },
            { from: [185, 110], to: [315, 70] },
            { from: [185, 110], to: [315, 150] },
            { from: [315, 70], to: [430, 110] },
            { from: [315, 150], to: [430, 110] },
        ],
    },
];

const KIND_SHORT: Record<string, string> = {
    Deployment: "Deploy",
    Service: "Svc",
    ConfigMap: "CM",
    Secret: "Sec",
    Ingress: "Ing",
    ServiceAccount: "SA",
    Pod: "Pod",
    CronJob: "CJ",
    PersistentVolume: "PV",
    PersistentVolumeClaim: "PVC",
    StatefulSet: "STS",
};

interface GraphNode {
    id: string;
    x: number;
    y: number;
    label: string;
    kind: string;
    color: string;
}

interface GraphEdge {
    from: number[];
    to: number[];
    danger?: boolean;
}

function MiniGraph({
    nodes,
    edges,
    viewBox,
    accent,
}: {
    nodes: GraphNode[];
    edges: GraphEdge[];
    viewBox: string;
    accent: string;
}) {
    return (
        <svg viewBox={viewBox} className="w-full h-full">
            {/* Edges */}
            {edges.map((e, i) => (
                <g key={i}>
                    <line
                        x1={e.from[0]} y1={e.from[1]}
                        x2={e.to[0]} y2={e.to[1]}
                        stroke={e.danger ? "#F56C42" : accent}
                        strokeWidth={e.danger ? 1.2 : 0.8}
                        strokeOpacity={e.danger ? 0.5 : 0.2}
                        strokeDasharray={e.danger ? "none" : "4 7"}
                    />
                    {e.danger && (
                        <circle
                            cx={(e.from[0] + e.to[0]) / 2}
                            cy={(e.from[1] + e.to[1]) / 2}
                            r={3}
                            fill="#F56C42"
                            fillOpacity={0.7}
                        />
                    )}
                </g>
            ))}

            {/* Nodes */}
            {nodes.map((n) => (
                <g key={n.id}>
                    {/* Glow */}
                    <circle cx={n.x} cy={n.y} r={18} fill={n.color} fillOpacity={0.07} />
                    {/* Ring */}
                    <circle cx={n.x} cy={n.y} r={13} fill="none" stroke={n.color} strokeWidth={0.8} strokeOpacity={0.25} />
                    {/* Core */}
                    <circle cx={n.x} cy={n.y} r={11} fill="#10141C" stroke={n.color} strokeWidth={1.1} strokeOpacity={0.7} />
                    {/* Kind */}
                    <text
                        x={n.x} y={n.y + 0.5}
                        textAnchor="middle" dominantBaseline="middle"
                        fontSize={7} fontWeight={700}
                        fill={n.color} fillOpacity={0.9}
                    >
                        {KIND_SHORT[n.kind] ?? n.kind.slice(0, 3)}
                    </text>
                    {/* Label */}
                    <text
                        x={n.x} y={n.y + 21}
                        textAnchor="middle"
                        fontSize={6.5}
                        fill="#9BAABE"
                    >
                        {n.label.length > 14 ? n.label.slice(0, 13) + "…" : n.label}
                    </text>
                </g>
            ))}
        </svg>
    );
}

export default function ProductPreview() {
    const { ref, isVisible } = useScrollReveal();

    return (
        <section
            ref={ref}
            id="product"
            className="relative py-32 bg-[#0B0E14] overflow-hidden"
        >
            <div className="absolute inset-0 line-grid opacity-60 pointer-events-none" />
            <div className="absolute top-0 left-0 right-0 h-px bg-[#1D2535]" />
            <div className="absolute bottom-0 left-0 right-0 h-px bg-[#1D2535]" />

            <div className="relative max-w-7xl mx-auto px-5 lg:px-8">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={isVisible ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
                    className="text-center max-w-2xl mx-auto mb-16"
                >
                    <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-[#4F7BF7] mb-5">
                        Product
                    </p>
                    <h2 className="text-[clamp(2rem,4.5vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.035em] text-[#EEF2F7] mb-5">
                        Three views. Every angle.
                    </h2>
                    <p className="text-[1.0625rem] leading-[1.8] text-[#9BAABE]">
                        Each view answers a different question about your cluster. Together,
                        they give you structural clarity no dashboard can.
                    </p>
                </motion.div>

                {/* Graph cards */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    {GRAPHS.map((g, i) => (
                        <motion.div
                            key={g.id}
                            initial={{ opacity: 0, y: 32 }}
                            animate={isVisible ? { opacity: 1, y: 0 } : {}}
                            transition={{ duration: 0.65, delay: 0.1 + i * 0.12, ease: [0.16, 1, 0.3, 1] }}
                            className="group flex flex-col rounded-2xl bg-[#06080C] border border-[#1D2535] hover:border-[#263043] overflow-hidden transition-all duration-300"
                            style={{ boxShadow: "0 4px 32px rgba(0,0,0,0.4)" }}
                        >
                            {/* Viewport */}
                            <div className="relative bg-[#0B0E14] border-b border-[#1D2535]" style={{ height: "230px" }}>
                                {/* Window chrome */}
                                <div className="absolute top-3 left-4 flex items-center gap-1.5 z-10">
                                    <span className="w-2.5 h-2.5 rounded-full bg-[#1D2535]" />
                                    <span className="w-2.5 h-2.5 rounded-full bg-[#1D2535]" />
                                    <span className="w-2.5 h-2.5 rounded-full bg-[#1D2535]" />
                                </div>

                                {/* Graph label top right */}
                                <div className="absolute top-3 right-4 z-10">
                                    <span
                                        className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-md"
                                        style={{
                                            background: `${g.accent}15`,
                                            color: g.accent,
                                            border: `1px solid ${g.accent}25`,
                                        }}
                                    >
                                        {g.id}
                                    </span>
                                </div>

                                {/* Graph area */}
                                <div className="absolute inset-0 flex items-center justify-center p-5 pt-10">
                                    <MiniGraph
                                        nodes={g.nodes as GraphNode[]}
                                        edges={g.edges as GraphEdge[]}
                                        viewBox={g.viewBox}
                                        accent={g.accent}
                                    />
                                </div>

                                {/* Bottom fade */}
                                <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-[#06080C] to-transparent" />
                            </div>

                            {/* Card info */}
                            <div className="flex items-start gap-4 p-5">
                                <div
                                    className="mt-0.5 w-2 h-2 rounded-full shrink-0"
                                    style={{ background: g.accent, boxShadow: `0 0 8px ${g.accent}60` }}
                                />
                                <div>
                                    <h3 className="text-[0.9375rem] font-semibold tracking-[-0.015em] text-[#EEF2F7] mb-1">
                                        {g.title}
                                    </h3>
                                    <p className="text-[0.8125rem] text-[#9BAABE]">{g.label}</p>
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}
