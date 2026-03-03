"use client";

import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";

const scenarios = [
    {
        badge: "Cascade Failure",
        badgeColor: "#F56C42",
        title: "A ConfigMap change took down 22 pods across 3 namespaces.",
        body: "The ConfigMap was mounted by deployments no one remembered. The first alert arrived at 2am. The root cause took 4 hours to trace manually.",
        meta: "Production · 4h MTTR",
    },
    {
        badge: "RBAC Gap",
        badgeColor: "#9B7CF4",
        title: "A ServiceAccount had cluster-admin for 6 months. No one noticed.",
        body: "No tool connected the ServiceAccount to the pods using it, or mapped what those pods could access. Discovered during an audit, not an incident — this time.",
        meta: "Security · Audit Finding",
    },
    {
        badge: "Storage Lock",
        badgeColor: "#2FC8B8",
        title: "PVC deletion blocked namespace cleanup for two days.",
        body: "PVC was bound to a pod owned by a Deployment stuck in a terminating state. Three engineers debugged it in sequence. No one had the full picture.",
        meta: "Operations · 2d blocked",
    },
];

export default function Problem() {
    const { ref, isVisible } = useScrollReveal();

    return (
        <section
            ref={ref}
            className="relative py-32 bg-[#06080C] overflow-hidden"
        >
            {/* Top fade from hero */}
            <div className="absolute top-0 left-0 right-0 h-px bg-[#1D2535]" />
            <div className="absolute inset-0 bg-gradient-radial from-[rgba(79,123,247,0.03)] via-transparent to-transparent pointer-events-none" />

            <div className="max-w-7xl mx-auto px-5 lg:px-8">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={isVisible ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
                    className="max-w-3xl mb-20"
                >
                    <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-[#4F7BF7] mb-5">
                        The Problem
                    </p>
                    <h2 className="text-[clamp(2rem,4.5vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.035em] text-[#EEF2F7] mb-5">
                        Kubernetes is a graph.
                        <br />
                        <span className="text-[#9BAABE]">Your tooling treats it like a list.</span>
                    </h2>
                    <p className="text-[1.0625rem] leading-[1.8] text-[#9BAABE] max-w-xl">
                        Every resource has relationships — explicit and implicit. Dashboards show
                        you state. They don&apos;t show you structure. When something breaks,
                        tracing those relationships by hand takes hours you don&apos;t have.
                    </p>
                </motion.div>

                {/* Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {scenarios.map((s, i) => (
                        <motion.article
                            key={s.badge}
                            initial={{ opacity: 0, y: 28 }}
                            animate={isVisible ? { opacity: 1, y: 0 } : {}}
                            transition={{ duration: 0.6, delay: 0.1 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                            className="group relative p-6 rounded-2xl bg-[#0B0E14] border border-[#1D2535] hover:border-[#263043] transition-all duration-300"
                            style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.3)" }}
                        >
                            {/* Left accent */}
                            <div
                                className="absolute left-0 top-5 bottom-5 w-[2px] rounded-r-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                                style={{ background: s.badgeColor }}
                            />

                            {/* Badge */}
                            <div className="flex items-center justify-between mb-5">
                                <span
                                    className="px-2.5 py-1 rounded-full text-[10px] font-semibold tracking-wide"
                                    style={{
                                        background: `${s.badgeColor}18`,
                                        color: s.badgeColor,
                                        border: `1px solid ${s.badgeColor}30`,
                                    }}
                                >
                                    {s.badge}
                                </span>
                                <span className="text-[10px] text-[#5A6880] font-mono">{s.meta}</span>
                            </div>

                            <h3 className="text-[0.9375rem] font-semibold leading-[1.45] tracking-[-0.015em] text-[#EEF2F7] mb-3">
                                {s.title}
                            </h3>
                            <p className="text-[0.875rem] leading-[1.7] text-[#9BAABE]">{s.body}</p>
                        </motion.article>
                    ))}
                </div>

                {/* Divider */}
                <motion.div
                    initial={{ scaleX: 0, opacity: 0 }}
                    animate={isVisible ? { scaleX: 1, opacity: 1 } : {}}
                    transition={{ duration: 1, delay: 0.4 }}
                    className="mt-20 h-px bg-gradient-to-r from-transparent via-[#1D2535] to-transparent origin-center"
                />
            </div>
        </section>
    );
}
