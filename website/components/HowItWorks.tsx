"use client";

import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";

const steps = [
    {
        n: "01",
        color: "#4F7BF7",
        title: "Connect",
        body: "Point Kubilitics at any cluster using a kubeconfig or in-cluster service account. No agents. No operators. No cluster-wide changes required.",
        detail: "kubectl · EKS · GKE · AKS · k3s · kind · Talos",
        icon: (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <rect x="2" y="6" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <rect x="12" y="6" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <line x1="10" y1="9" x2="12" y2="9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <line x1="6" y1="12" x2="6" y2="16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <line x1="16" y1="12" x2="16" y2="16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <line x1="4" y1="16" x2="18" y2="16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
        ),
    },
    {
        n: "02",
        color: "#2FC8B8",
        title: "Explore",
        body: "Kubilitics builds a live relationship graph from your cluster API. Navigate by resource kind, namespace, or workload name. Every edge is a real connection.",
        detail: "Live from the Kubernetes API · No historical state required",
        icon: (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.3" />
                <line x1="13.5" y1="13.5" x2="19" y2="19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="9" y1="6" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="6" y1="9" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
        ),
    },
    {
        n: "03",
        color: "#9B7CF4",
        title: "Analyze Impact",
        body: "Select any resource. Run impact analysis. See a scoped subgraph of every resource affected by a change to the selected one — direct and transitive.",
        detail: "Direct deps · Transitive deps · RBAC surface · Storage chain",
        icon: (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path d="M4 18L10 8l3 4 3-6 3 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="19" cy="8" r="1.5" fill="currentColor" fillOpacity="0.8" />
            </svg>
        ),
    },
];

export default function HowItWorks() {
    const { ref, isVisible } = useScrollReveal();

    return (
        <section ref={ref} id="how-it-works" className="relative py-32 bg-[#06080C] overflow-hidden">
            <div className="absolute inset-0 bg-gradient-radial from-[rgba(47,200,184,0.04)] via-transparent to-transparent pointer-events-none" />

            <div className="max-w-7xl mx-auto px-5 lg:px-8">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={isVisible ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
                    className="text-center max-w-xl mx-auto mb-20"
                >
                    <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-[#4F7BF7] mb-5">
                        How It Works
                    </p>
                    <h2 className="text-[clamp(2rem,4.5vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.035em] text-[#EEF2F7]">
                        Three steps to structural clarity.
                    </h2>
                </motion.div>

                {/* Steps */}
                <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-10 lg:gap-8">
                    {/* Connector line */}
                    <div className="hidden lg:block absolute top-[26px] left-[calc(16.666%+2.5rem)] right-[calc(16.666%+2.5rem)] h-px">
                        <div className="h-full bg-gradient-to-r from-[#1D2535] via-[#263043] to-[#1D2535]" />
                    </div>

                    {steps.map((s, i) => (
                        <motion.div
                            key={s.title}
                            initial={{ opacity: 0, y: 28 }}
                            animate={isVisible ? { opacity: 1, y: 0 } : {}}
                            transition={{ duration: 0.65, delay: 0.1 + i * 0.14, ease: [0.16, 1, 0.3, 1] }}
                            className="flex flex-col"
                        >
                            {/* Icon + step */}
                            <div className="flex items-center gap-4 mb-8">
                                <div
                                    className="relative w-13 h-13 w-[52px] h-[52px] rounded-2xl flex items-center justify-center shrink-0"
                                    style={{
                                        background: `${s.color}12`,
                                        border: `1px solid ${s.color}28`,
                                        color: s.color,
                                    }}
                                >
                                    {s.icon}
                                    {/* Glow */}
                                    <div
                                        className="absolute inset-0 rounded-2xl blur-lg opacity-20"
                                        style={{ background: s.color }}
                                    />
                                </div>
                                <span className="text-[11px] font-semibold tracking-[0.1em] text-[#5A6880] font-mono">
                                    Step {s.n}
                                </span>
                            </div>

                            <h3 className="text-[1.25rem] font-semibold leading-[1.3] tracking-[-0.02em] text-[#EEF2F7] mb-3">
                                {s.title}
                            </h3>
                            <p className="text-[0.9375rem] leading-[1.75] text-[#9BAABE] mb-5">
                                {s.body}
                            </p>
                            <p
                                className="text-[0.75rem] font-mono leading-[1.6] px-3 py-2 rounded-lg w-fit"
                                style={{
                                    background: `${s.color}0C`,
                                    color: `${s.color}CC`,
                                    border: `1px solid ${s.color}18`,
                                }}
                            >
                                {s.detail}
                            </p>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}
