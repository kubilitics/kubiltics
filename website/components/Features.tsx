"use client";

import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";

const features = [
    {
        color: "#4F7BF7",
        icon: (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
                <line x1="10" y1="2" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="10" y1="14" x2="10" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="2" y1="10" x2="6" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="14" y1="10" x2="18" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        ),
        title: "Relationship Intelligence",
        body: "Automatic discovery of all resource dependencies — Deployments to Services, ConfigMaps, Secrets, PVCs, RBAC bindings. Visualized as a navigable, live graph.",
    },
    {
        color: "#F56C42",
        icon: (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 3v5l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="10" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
                <path d="M4 4l2 2M16 4l-2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
        ),
        title: "Impact Analysis",
        body: "Select any resource. See what breaks — directly and transitively — before you apply a change. Know your blast radius in seconds.",
    },
    {
        color: "#9B7CF4",
        icon: (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <rect x="12" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <rect x="7" y="12" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M5 8v2a3 3 0 003 3m0 0h4a3 3 0 003-3V8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
        ),
        title: "Storage Chain Mapping",
        body: "Trace the full lineage from PersistentVolume through PVC to the pods and workloads that depend on it. Never orphan storage again.",
    },
    {
        color: "#2FC8B8",
        icon: (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <polyline points="3,14 7,9 10,11 14,6 17,8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="2" y="16" width="16" height="1.5" rx="0.75" fill="currentColor" fillOpacity={0.3} />
            </svg>
        ),
        title: "Runtime Insight Panel",
        body: "Surface runtime health alongside structural relationships. Restart counts, resource pressure, and anomalous events in the same view — no context switching.",
    },
    {
        color: "#2FD07D",
        icon: (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect x="2" y="3" width="7" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <rect x="11" y="3" width="7" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <line x1="9" y1="10" x2="11" y2="10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
        ),
        title: "Multi-Cluster Support",
        body: "Connect multiple clusters in a single session. Compare topology across environments. Surface cross-cluster service dependencies.",
    },
    {
        color: "#F5A623",
        icon: (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 2L3 6v4c0 4.4 3 8.1 7 9 4-0.9 7-4.6 7-9V6l-7-4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                <path d="M7 10l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        ),
        title: "RBAC Respect",
        body: "Read-only by default. Kubilitics operates within your cluster RBAC policies. No cluster-admin required. Fully compatible with audit-logging environments.",
    },
];

export default function Features() {
    const { ref, isVisible } = useScrollReveal();

    return (
        <section ref={ref} id="features" className="relative py-32 bg-[#06080C] overflow-hidden">
            <div className="absolute inset-0 bg-gradient-radial from-[rgba(79,123,247,0.04)] via-transparent to-transparent pointer-events-none" />

            <div className="max-w-7xl mx-auto px-5 lg:px-8">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={isVisible ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
                    className="max-w-2xl mb-20"
                >
                    <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-[#4F7BF7] mb-5">
                        Core Capabilities
                    </p>
                    <h2 className="text-[clamp(2rem,4.5vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.035em] text-[#EEF2F7] mb-5">
                        Built for engineers who need to{" "}
                        <span className="text-[#9BAABE]">understand, not just observe.</span>
                    </h2>
                </motion.div>

                {/* Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {features.map((f, i) => (
                        <motion.div
                            key={f.title}
                            initial={{ opacity: 0, y: 24 }}
                            animate={isVisible ? { opacity: 1, y: 0 } : {}}
                            transition={{ duration: 0.6, delay: 0.07 * i, ease: [0.16, 1, 0.3, 1] }}
                            className="group relative p-6 rounded-2xl bg-[#0B0E14] border border-[#1D2535] hover:border-[#263043] transition-all duration-300"
                        >
                            {/* Icon */}
                            <div
                                className="w-11 h-11 rounded-xl flex items-center justify-center mb-5"
                                style={{ background: `${f.color}14`, color: f.color }}
                            >
                                {f.icon}
                            </div>

                            <h3 className="text-[0.9375rem] font-semibold tracking-[-0.015em] text-[#EEF2F7] mb-2.5">
                                {f.title}
                            </h3>
                            <p className="text-[0.875rem] leading-[1.7] text-[#9BAABE]">{f.body}</p>

                            {/* Bottom glow accent on hover */}
                            <div
                                className="absolute bottom-0 left-6 right-6 h-px opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                                style={{ background: `linear-gradient(to right, transparent, ${f.color}50, transparent)` }}
                            />
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}
