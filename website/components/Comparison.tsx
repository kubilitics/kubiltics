"use client";

import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";

type CellVal = boolean | string;

const rows: { feature: string; hl?: string; headlamp: CellVal; lens: CellVal; kubilitics: CellVal }[] = [
    { feature: "Resource visualization", headlamp: "List view", lens: "List view", kubilitics: "Graph + List" },
    { feature: "Dependency mapping", headlamp: false, lens: false, kubilitics: true },
    { feature: "Impact analysis (pre-change)", headlamp: false, lens: false, kubilitics: true },
    { feature: "Storage chain tracing", headlamp: false, lens: false, kubilitics: true },
    { feature: "RBAC relationship graph", headlamp: false, lens: "Partial", kubilitics: true },
    { feature: "Multi-cluster topology", headlamp: false, lens: true, kubilitics: true },
    { feature: "Blast radius estimation", headlamp: false, lens: false, kubilitics: true },
    { feature: "Runtime health overlay", headlamp: true, lens: true, kubilitics: true },
    { feature: "Open source / self-hosted", headlamp: true, lens: false, kubilitics: true },
    { feature: "Read-only safe mode", headlamp: true, lens: false, kubilitics: true },
];

function Cell({ val, isKubilitics }: { val: CellVal; isKubilitics?: boolean }) {
    if (val === true) {
        return (
            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${isKubilitics ? "bg-[#4F7BF7]/12" : ""}`}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke={isKubilitics ? "#4F7BF7" : "#2FD07D"} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </span>
        );
    }
    if (val === false) {
        return (
            <span className="inline-flex items-center justify-center">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <line x1="3" y1="6" x2="9" y2="6" stroke="#263043" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
            </span>
        );
    }
    const color = val === "Partial" ? "#F5A623" : (isKubilitics ? "#4F7BF7" : "#9BAABE");
    return <span className="text-[11px] font-medium" style={{ color }}>{val}</span>;
}

export default function Comparison() {
    const { ref, isVisible } = useScrollReveal();

    return (
        <section ref={ref} id="comparison" className="relative py-32 bg-[#0B0E14] overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-[#1D2535]" />
            <div className="absolute bottom-0 left-0 right-0 h-px bg-[#1D2535]" />

            <div className="max-w-5xl mx-auto px-5 lg:px-8">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={isVisible ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
                    className="text-center max-w-xl mx-auto mb-16"
                >
                    <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-[#4F7BF7] mb-5">
                        Comparison
                    </p>
                    <h2 className="text-[clamp(2rem,4.5vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.035em] text-[#EEF2F7] mb-5">
                        A different kind of tool.
                    </h2>
                    <p className="text-[1.0625rem] leading-[1.8] text-[#9BAABE]">
                        Headlamp and Lens are excellent dashboards for observing cluster state.
                        Kubilitics is a structural analysis engine — it exists to answer different
                        questions.
                    </p>
                </motion.div>

                {/* Table */}
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={isVisible ? { opacity: 1, y: 0 } : {}}
                    transition={{ duration: 0.65, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
                    className="rounded-2xl border border-[#1D2535] overflow-hidden"
                    style={{ boxShadow: "0 4px 40px rgba(0,0,0,0.4)" }}
                >
                    {/* Header */}
                    <div className="grid grid-cols-4 bg-[#10141C] border-b border-[#1D2535]">
                        <div className="p-4 pl-5 text-[11px] font-semibold text-[#5A6880] tracking-widest uppercase">
                            Capability
                        </div>
                        {["Headlamp", "Lens", "Kubilitics"].map((tool, i) => (
                            <div key={tool} className={`p-4 text-center text-[13px] font-semibold ${i === 2 ? "text-[#4F7BF7]" : "text-[#9BAABE]"} ${i === 2 ? "bg-[#4F7BF7]/4 border-l border-[#4F7BF7]/15" : ""}`}>
                                {tool}
                                {i === 2 && (
                                    <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-[#4F7BF7]/15 text-[#4F7BF7] tracking-wide uppercase">You are here</span>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Rows */}
                    {rows.map((row, i) => (
                        <div
                            key={row.feature}
                            className="grid grid-cols-4 border-b border-[#1D2535] last:border-0 hover:bg-[#10141C]/60 transition-colors duration-150"
                        >
                            <div className="p-3.5 pl-5 text-[12.5px] text-[#9BAABE] flex items-center">{row.feature}</div>
                            <div className="p-3.5 flex items-center justify-center"><Cell val={row.headlamp} /></div>
                            <div className="p-3.5 flex items-center justify-center"><Cell val={row.lens} /></div>
                            <div className="p-3.5 flex items-center justify-center bg-[#4F7BF7]/3 border-l border-[#4F7BF7]/10">
                                <Cell val={row.kubilitics} isKubilitics />
                            </div>
                        </div>
                    ))}
                </motion.div>

                <motion.p
                    initial={{ opacity: 0 }}
                    animate={isVisible ? { opacity: 1 } : {}}
                    transition={{ duration: 0.6, delay: 0.5 }}
                    className="mt-5 text-center text-[11px] text-[#5A6880]"
                >
                    Comparison is directional — it reflects general tool intent, not version-specific feature lists.
                </motion.p>
            </div>
        </section>
    );
}
