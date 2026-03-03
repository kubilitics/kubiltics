"use client";

import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";

const contributions = [
    { label: "Star the repo", detail: "Help others discover the project.", icon: "⭐" },
    { label: "Submit a pull request", detail: "All PRs are reviewed and welcomed.", icon: "🔀" },
    { label: "Report issues", detail: "Bugs and feature requests tracked on GitHub.", icon: "🐛" },
    { label: "Improve documentation", detail: "Good docs are as valuable as good code.", icon: "📄" },
];

export default function OpenSource() {
    const { ref, isVisible } = useScrollReveal();

    return (
        <section ref={ref} id="opensource" className="relative py-32 bg-[#06080C] overflow-hidden">
            <div className="absolute inset-0 bg-gradient-radial from-[rgba(47,208,125,0.04)] via-transparent to-transparent pointer-events-none" />

            <div className="max-w-7xl mx-auto px-5 lg:px-8">
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-16 items-start">
                    {/* Left: 3 cols */}
                    <motion.div
                        initial={{ opacity: 0, y: 24 }}
                        animate={isVisible ? { opacity: 1, y: 0 } : {}}
                        transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
                        className="lg:col-span-3"
                    >
                        <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-[#2FD07D] mb-5">
                            Open Source
                        </p>
                        <h2 className="text-[clamp(2rem,4.5vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.035em] text-[#EEF2F7] mb-5">
                            Built in the open.
                            <br />
                            <span className="text-[#9BAABE]">Owned by the community.</span>
                        </h2>
                        <p className="text-[1.0625rem] leading-[1.8] text-[#9BAABE] mb-10">
                            Kubilitics is released under the Apache 2.0 license. The codebase,
                            the design decisions, and the roadmap are public. Infrastructure
                            tooling should be auditable, forkable, and community-maintained.
                        </p>

                        {/* Stats */}
                        <div className="grid grid-cols-3 gap-6 mb-10 pb-10 border-b border-[#1D2535]">
                            {[
                                { label: "License", value: "Apache 2.0" },
                                { label: "Language", value: "Go + TS" },
                                { label: "Status", value: "Active" },
                            ].map((s) => (
                                <div key={s.label}>
                                    <div className="text-[1.0625rem] font-semibold text-[#EEF2F7] mb-1 font-mono">
                                        {s.value}
                                    </div>
                                    <div className="text-[11px] text-[#5A6880] uppercase tracking-wide">{s.label}</div>
                                </div>
                            ))}
                        </div>

                        <a
                            href="https://github.com/kubilitics"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2.5 px-5 py-3 rounded-xl bg-[#0B0E14] border border-[#1D2535] text-[14px] font-semibold text-[#EEF2F7] hover:border-[#263043] hover:bg-[#10141C] transition-all duration-200"
                        >
                            <svg width="16" height="15" viewBox="0 0 24 24" fill="currentColor" className="text-[#9BAABE]">
                                <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                            </svg>
                            View on GitHub →
                        </a>
                    </motion.div>

                    {/* Right: 2 cols */}
                    <div className="lg:col-span-2 flex flex-col gap-3">
                        {contributions.map((c, i) => (
                            <motion.div
                                key={c.label}
                                initial={{ opacity: 0, x: 20 }}
                                animate={isVisible ? { opacity: 1, x: 0 } : {}}
                                transition={{ duration: 0.55, delay: 0.1 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                                className="flex items-start gap-4 p-4 rounded-xl bg-[#0B0E14] border border-[#1D2535] hover:border-[#263043] transition-colors duration-200"
                            >
                                <span className="text-lg shrink-0 mt-0.5">{c.icon}</span>
                                <div>
                                    <p className="text-[0.875rem] font-semibold text-[#EEF2F7] mb-0.5">{c.label}</p>
                                    <p className="text-[0.8125rem] text-[#9BAABE]">{c.detail}</p>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
