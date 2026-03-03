"use client";

import { motion, Variants } from "framer-motion";
import GraphBackground from "./GraphBackground";

const stagger: Variants = {
    hidden: {},
    show: {
        transition: { staggerChildren: 0.12 },
    },
};

const fadeUp: Variants = {
    hidden: { opacity: 0, y: 22 },
    show: { opacity: 1, y: 0, transition: { duration: 0.65, ease: "easeOut" } },
};

export default function Hero() {
    return (
        <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
            {/* Animated graph */}
            <GraphBackground />

            {/* Gradient overlays */}
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-0 bg-gradient-radial from-[rgba(79,123,247,0.07)] via-transparent to-transparent" style={{ backgroundPosition: "50% 40%" }} />
                <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-[#06080C] to-transparent" />
            </div>

            {/* Dot grid */}
            <div className="absolute inset-0 dot-grid opacity-40 pointer-events-none" />

            {/* Content */}
            <motion.div
                variants={stagger}
                initial="hidden"
                animate="show"
                className="relative z-10 max-w-5xl mx-auto px-5 text-center pt-28 pb-20"
            >
                {/* Badge */}
                <motion.div variants={fadeUp} className="flex justify-center mb-8">
                    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#0B0E14] border border-[#1D2535] text-[11px] font-medium text-[#4F7BF7] tracking-[0.1em] uppercase">
                        <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4F7BF7] opacity-75" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#4F7BF7]" />
                        </span>
                        Kubernetes Relationship Intelligence Engine
                    </div>
                </motion.div>

                {/* Headline */}
                <motion.h1
                    variants={fadeUp}
                    className="text-[clamp(2.8rem,7.5vw,5.8rem)] font-semibold leading-[1.03] tracking-[-0.045em] text-[#EEF2F7] mb-6"
                >
                    Know what breaks{" "}
                    <span className="text-gradient-brand">before</span>
                    <br className="hidden sm:block" />
                    {" "}you make the change.
                </motion.h1>

                {/* Sub */}
                <motion.p
                    variants={fadeUp}
                    className="max-w-2xl mx-auto text-[1.125rem] leading-[1.75] text-[#9BAABE] mb-10"
                >
                    Kubilitics maps every dependency between your Kubernetes resources —
                    Deployments, Services, ConfigMaps, PVCs, RBAC — and tells you the exact
                    blast radius of any change, before you apply it.
                </motion.p>

                {/* CTAs */}
                <motion.div
                    variants={fadeUp}
                    className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12"
                >
                    <a
                        href="#cta"
                        className="group inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#4F7BF7] text-white text-[15px] font-semibold hover:bg-[#3560D8] active:scale-[0.98] transition-all duration-200 shadow-glow-sm hover:shadow-glow-md"
                    >
                        Get Started Free
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="group-hover:translate-x-0.5 transition-transform duration-200">
                            <path d="M3 7h8M7.5 3.5L11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </a>
                    <a
                        href="https://github.com/kubilitics"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-[#0B0E14] border border-[#1D2535] text-[#EEF2F7] text-[15px] font-semibold hover:border-[#263043] hover:bg-[#10141C] active:scale-[0.98] transition-all duration-200"
                    >
                        <svg width="16" height="15" viewBox="0 0 24 24" fill="currentColor" className="text-[#9BAABE]">
                            <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                        </svg>
                        View on GitHub
                    </a>
                </motion.div>

                {/* Feature pills */}
                <motion.div
                    variants={fadeUp}
                    className="flex flex-wrap items-center justify-center gap-2"
                >
                    {[
                        "Relationship Graph",
                        "Impact Analysis",
                        "Storage Chain",
                        "RBAC Mapping",
                        "Multi-Cluster",
                    ].map((f) => (
                        <span
                            key={f}
                            className="px-3 py-1 rounded-full bg-[#0B0E14] border border-[#1D2535] text-[11.5px] font-medium text-[#9BAABE]"
                        >
                            {f}
                        </span>
                    ))}
                </motion.div>
            </motion.div>

            {/* Scroll hint */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.5, duration: 1 }}
                className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5"
            >
                <span className="text-[10px] tracking-[0.15em] uppercase text-[#5A6880]">Scroll</span>
                <div className="w-px h-7 bg-gradient-to-b from-[#5A6880] to-transparent" />
            </motion.div>
        </section>
    );
}
