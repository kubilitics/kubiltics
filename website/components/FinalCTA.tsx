"use client";

import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";

export default function FinalCTA() {
    const { ref, isVisible } = useScrollReveal();

    return (
        <section ref={ref} id="cta" className="relative py-40 bg-[#0B0E14] overflow-hidden">
            <div className="absolute inset-0 line-grid opacity-60 pointer-events-none" />
            <div className="absolute top-0 left-0 right-0 h-px bg-[#1D2535]" />
            <div className="absolute bottom-0 left-0 right-0 h-px bg-[#1D2535]" />
            {/* Glow */}
            <div className="absolute inset-0 bg-gradient-radial from-[rgba(79,123,247,0.09)] via-transparent to-transparent pointer-events-none" />

            <div className="relative max-w-4xl mx-auto px-5 text-center">
                <motion.div
                    initial={{ opacity: 0, y: 32 }}
                    animate={isVisible ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                >
                    <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-[#4F7BF7] mb-6">
                        Get Started
                    </p>
                    <h2 className="text-[clamp(2.5rem,7vw,5.5rem)] font-semibold leading-[1.03] tracking-[-0.045em] text-[#EEF2F7] mb-6">
                        Understand your cluster.
                        <br />
                        <span className="text-[#9BAABE]">Before something breaks.</span>
                    </h2>
                    <p className="text-[1.125rem] leading-[1.8] text-[#9BAABE] mb-10 max-w-lg mx-auto">
                        Connect Kubilitics to any cluster in minutes. No operators. No sidecars.
                        No data leaves your environment. Apache 2.0.
                    </p>

                    {/* CTAs */}
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-10">
                        <a
                            href="https://github.com/kubilitics"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group inline-flex items-center gap-2.5 px-7 py-4 rounded-xl bg-[#4F7BF7] text-white text-[15px] font-semibold hover:bg-[#3560D8] active:scale-[0.98] transition-all duration-200 shadow-glow-sm hover:shadow-glow-md"
                        >
                            Get Started Free
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="group-hover:translate-x-0.5 transition-transform duration-200">
                                <path d="M3 7h8M7.5 3.5L11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </a>
                        <a
                            href="#"
                            className="inline-flex items-center gap-2.5 px-7 py-4 rounded-xl bg-[#06080C] border border-[#1D2535] text-[#EEF2F7] text-[15px] font-semibold hover:border-[#263043] hover:bg-[#0B0E14] active:scale-[0.98] transition-all duration-200"
                        >
                            Read the Docs
                        </a>
                    </div>

                    {/* Clusters row */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={isVisible ? { opacity: 1 } : {}}
                        transition={{ duration: 0.8, delay: 0.4 }}
                        className="flex flex-wrap items-center justify-center gap-3"
                    >
                        {["EKS", "GKE", "AKS", "k3s", "kind", "Talos", "Vanilla K8s"].map((k) => (
                            <span
                                key={k}
                                className="px-2.5 py-1 rounded-full bg-[#06080C] border border-[#1D2535] text-[11px] font-mono font-medium text-[#5A6880]"
                            >
                                {k}
                            </span>
                        ))}
                    </motion.div>
                </motion.div>
            </div>
        </section>
    );
}
