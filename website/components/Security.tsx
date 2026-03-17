"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";

const pillars = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    title: "RBAC-scoped by design",
    body: "Kubilitics respects your cluster RBAC policies. It operates within the permissions of its service account. No cluster-admin required.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
    ),
    title: "No external network access",
    body: "Runs entirely within your environment. No telemetry, no callbacks, no external API calls. Your cluster data stays with you.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" /><path d="M12 22V12" /><path d="M3 7l9 5 9-5" />
      </svg>
    ),
    title: "Helm-based deployment",
    body: "Single Helm chart with configurable RBAC, ingress, and resource limits. Compatible with ArgoCD, Flux, and standard GitOps pipelines.",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
      </svg>
    ),
    title: "Air-gap compatible",
    body: "All container images can be mirrored to a private registry. Supports fully air-gapped clusters with no external image pulls at runtime.",
  },
];

/* ── K8s distributions with official logos ──────────────────────────────── */
const distributions = [
  { name: "Amazon EKS",  logo: "/logos/eks.svg",       bg: "#FFF3E0" },
  { name: "Google GKE",  logo: "/logos/gcloud.svg",    bg: "#E3F2FD" },
  { name: "Azure AKS",   logo: "/logos/azure.svg",     bg: "#E3F2FD" },
  { name: "k3s",         logo: "/logos/k3s.svg",       bg: "#FFF8E1" },
  { name: "Kubernetes",  logo: "/logos/kubernetes.svg", bg: "#E8EAF6" },
  { name: "OpenShift",   logo: "/logos/openshift.svg",  bg: "#FFEBEE" },
  { name: "Docker",      logo: "/logos/docker.svg",      bg: "#E3F2FD" },
  { name: "Rancher",     logo: "/logos/rancher.svg",    bg: "#E0F2F1" },
];

export default function Security() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section ref={ref} id="security" className="relative py-24 lg:py-32 bg-[var(--bg-secondary)]">
      <div className="max-w-[1200px] mx-auto px-6 md:px-8 lg:px-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
          className="text-center max-w-4xl mx-auto mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[var(--brand-bg)] border border-[var(--brand)]/15 mb-6">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span className="text-[12px] font-semibold tracking-[0.08em] uppercase text-[var(--brand)]">
              Security
            </span>
          </div>
          <h2 className="text-[clamp(1.75rem,4vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em] text-[var(--text-primary)] mb-5">
            Designed for production.{" "}
            <span className="text-[var(--text-tertiary)]">Not demos.</span>
          </h2>
          <p className="text-[16px] lg:text-[17px] leading-relaxed text-[var(--text-secondary)]">
            Platform teams at regulated companies, air-gapped environments, and teams with strict security requirements trust Kubilitics.
          </p>
        </motion.div>

        {/* Security pillars */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {pillars.map((p, i) => (
            <motion.div
              key={p.title}
              initial={{ opacity: 0, y: 20 }}
              animate={isVisible ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.55, delay: 0.08 * i, ease: [0.16, 1, 0.3, 1] }}
              className="group relative p-6 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-primary)] hover:border-[var(--brand)]/30 transition-all duration-300 card-lift hover:shadow-xl hover:shadow-black/5 dark:hover:shadow-black/25"
            >
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-[var(--brand)]/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
              <div className="relative">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-5 bg-[var(--brand)]/[0.08] text-[var(--brand)] group-hover:bg-[var(--brand)]/[0.12] transition-colors">
                  {p.icon}
                </div>
                <h3 className="text-[15px] font-bold text-[var(--text-primary)] mb-2.5">
                  {p.title}
                </h3>
                <p className="text-[14px] leading-[1.7] text-[var(--text-secondary)]">{p.body}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/*  Kubernetes Distribution Compatibility                             */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.35 }}
          className="mt-16 relative"
        >
          <div className="relative overflow-hidden rounded-3xl bg-[var(--bg-card)] border border-[var(--border-primary)] p-8 lg:p-12">
            {/* Background glows */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-0 left-1/4 w-[500px] h-[300px] rounded-full bg-[var(--brand)] opacity-[0.03] blur-[100px]" />
              <div className="absolute bottom-0 right-1/4 w-[400px] h-[250px] rounded-full bg-purple-500 opacity-[0.02] blur-[100px]" />
            </div>

            <div className="relative">
              {/* Header */}
              <div className="text-center mb-10">
                <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-emerald-500/[0.08] border border-emerald-500/15 mb-5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[12px] font-semibold tracking-[0.08em] uppercase text-emerald-600 dark:text-emerald-400">
                    Universal Compatibility
                  </span>
                </div>
                <h3 className="text-[clamp(1.25rem,3vw,1.75rem)] font-extrabold tracking-[-0.02em] text-[var(--text-primary)] mb-3">
                  Works with every Kubernetes distribution
                </h3>
                <p className="text-[15px] text-[var(--text-secondary)] max-w-xl mx-auto">
                  From managed cloud services to bare-metal clusters — Kubilitics integrates seamlessly with any conformant Kubernetes environment.
                </p>
              </div>

              {/* Distribution grid — official logos */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
                {distributions.map((d, i) => (
                  <motion.div
                    key={d.name}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={isVisible ? { opacity: 1, scale: 1 } : {}}
                    transition={{ duration: 0.4, delay: 0.4 + i * 0.05 }}
                    className="group flex flex-col items-center gap-3 p-5 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-primary)] hover:border-[var(--brand)]/25 hover:shadow-lg hover:shadow-black/[0.04] dark:hover:shadow-black/20 transition-all duration-300 hover:-translate-y-1 cursor-default"
                  >
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform duration-300"
                      style={{ backgroundColor: d.bg }}
                    >
                      <Image
                        src={d.logo}
                        alt={d.name}
                        width={28}
                        height={28}
                        className="object-contain"
                      />
                    </div>
                    <span className="text-[11px] font-semibold text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)] transition-colors text-center leading-tight whitespace-nowrap">
                      {d.name}
                    </span>
                  </motion.div>
                ))}
              </div>

              {/* Bottom tagline */}
              <div className="mt-8 pt-6 border-t border-[var(--border-primary)] flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8">
                {["CNCF conformant", "Multi-arch (amd64 + arm64)", "Air-gap ready"].map((text) => (
                  <div key={text} className="flex items-center gap-2 text-[13px] text-[var(--text-tertiary)]">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500 shrink-0">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
