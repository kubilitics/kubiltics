"use client";

import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";

const pillars = [
    {
        color: "#4F7BF7",
        title: "No external network access",
        body: "Runs entirely within your VPC. No callbacks. No telemetry. No external API calls. Your cluster data never leaves your environment.",
    },
    {
        color: "#9B7CF4",
        title: "RBAC-scoped by design",
        body: "Kubilitics respects the RBAC boundaries of the service account it operates with. Restrict it to namespaces, resource kinds, or verbs as needed.",
    },
    {
        color: "#2FC8B8",
        title: "Helm-based deployment",
        body: "Single Helm chart with configurable RBAC, ingress, and resource limits. Compatible with ArgoCD, Flux, and standard GitOps pipelines.",
    },
    {
        color: "#F5A623",
        title: "Air-gap compatible",
        body: "All container images can be mirrored to a private registry. Supports air-gapped clusters with no external image pulls required at runtime.",
    },
];

export default function Enterprise() {
    const { ref, isVisible } = useScrollReveal();

    return (
        <section ref={ref} id="enterprise" className="relative py-32 bg-[#0B0E14] overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-[#1D2535]" />
            <div className="absolute bottom-0 left-0 right-0 h-px bg-[#1D2535]" />
            <div className="absolute inset-0 line-grid opacity-50 pointer-events-none" />

            <div className="relative max-w-7xl mx-auto px-5 lg:px-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
                    {/* Left */}
                    <motion.div
                        initial={{ opacity: 0, x: -24 }}
                        animate={isVisible ? { opacity: 1, x: 0 } : {}}
                        transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
                    >
                        <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-[#4F7BF7] mb-5">
                            Enterprise
                        </p>
                        <h2 className="text-[clamp(2rem,4.5vw,3.25rem)] font-semibold leading-[1.1] tracking-[-0.035em] text-[#EEF2F7] mb-5">
                            Designed for production.
                            <br />
                            <span className="text-[#9BAABE]">Not demos.</span>
                        </h2>
                        <p className="text-[1.0625rem] leading-[1.8] text-[#9BAABE] mb-8">
                            Platform teams at regulated companies, companies with air-gapped
                            clusters, and teams with strict security posture have requirements that
                            most tools don&apos;t account for. Kubilitics is built around them.
                        </p>

                        <ul className="flex flex-col gap-3 mb-10">
                            {[
                                "Compatible with Falco, OPA Gatekeeper, and Kyverno",
                                "Works with restricted service accounts",
                                "Audit logs all Kubernetes API calls",
                                "Configurable RBAC from the Helm chart",
                                "Namespace-scoped or cluster-scoped deployment",
                            ].map((item) => (
                                <li key={item} className="flex items-start gap-3">
                                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0 mt-0.5">
                                        <circle cx="7" cy="7" r="6" stroke="#4F7BF7" strokeWidth="1" strokeOpacity="0.4" />
                                        <path d="M4 7l2 2 4-4" stroke="#4F7BF7" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                    <span className="text-[0.9375rem] text-[#9BAABE]">{item}</span>
                                </li>
                            ))}
                        </ul>

                        {/* Terminal snippet */}
                        <div className="terminal p-4 not-prose">
                            <p className="text-[#5A6880] text-[11px] mb-2 font-mono tracking-wide">// Deploy with Helm</p>
                            <p className="text-[#4F7BF7] font-mono text-[12.5px]">
                                <span className="text-[#5A6880]">$</span>{" "}
                                helm install kubilitics kubilitics/kubilitics \
                            </p>
                            <p className="text-[#4F7BF7] font-mono text-[12.5px] ml-4">
                                --namespace kubilitics \
                            </p>
                            <p className="text-[#4F7BF7] font-mono text-[12.5px] ml-4">
                                --set rbac.scope=namespace \
                            </p>
                            <p className="text-[#4F7BF7] font-mono text-[12.5px] ml-4">
                                --set readOnly=true
                            </p>
                        </div>
                    </motion.div>

                    {/* Right: pillars */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {pillars.map((p, i) => (
                            <motion.div
                                key={p.title}
                                initial={{ opacity: 0, y: 20 }}
                                animate={isVisible ? { opacity: 1, y: 0 } : {}}
                                transition={{ duration: 0.55, delay: 0.1 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                                className="p-5 rounded-2xl bg-[#06080C] border border-[#1D2535] hover:border-[#263043] transition-all duration-300"
                            >
                                <div
                                    className="w-9 h-9 rounded-xl flex items-center justify-center mb-4"
                                    style={{ background: `${p.color}12`, border: `1px solid ${p.color}20` }}
                                >
                                    <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                                </div>
                                <h3 className="text-[0.875rem] font-semibold text-[#EEF2F7] mb-2 leading-[1.4]">
                                    {p.title}
                                </h3>
                                <p className="text-[0.8125rem] leading-[1.65] text-[#9BAABE]">{p.body}</p>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
