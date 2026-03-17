"use client";

import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";

const features = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
    title: "Real-time Dashboard",
    body: "See every pod, deployment, service, and node at a glance. Live resource metrics, health status, and workload distribution — all updating in real time.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" /><line x1="12" y1="3" x2="12" y2="7" /><line x1="12" y1="17" x2="12" y2="21" /><line x1="3" y1="12" x2="7" y2="12" /><line x1="17" y1="12" x2="21" y2="12" />
        <line x1="5.6" y1="5.6" x2="8.5" y2="8.5" /><line x1="15.5" y1="15.5" x2="18.4" y2="18.4" />
      </svg>
    ),
    title: "Dependency Intelligence",
    body: "Automatic discovery of all resource relationships — Deployments to Services, ConfigMaps, Secrets, PVCs, RBAC. Visualized as a navigable, live topology graph.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="7" height="18" rx="1.5" /><rect x="15" y="3" width="7" height="18" rx="1.5" /><line x1="9" y1="12" x2="15" y2="12" />
      </svg>
    ),
    title: "Multi-Cluster Management",
    body: "Connect and switch between unlimited clusters in a single session. EKS, GKE, AKS, k3s, kind — manage them all from one interface without context switching.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" /><path d="M12 22V12" /><path d="M3 7l9 5 9-5" />
      </svg>
    ),
    title: "Helm Add-on Platform",
    body: "One-click install of monitoring, logging, and networking stacks through the built-in add-on marketplace. Extend your cluster capabilities without leaving Kubilitics.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        <path d="M8 9h8" /><path d="M8 13h4" />
      </svg>
    ),
    title: "AI-Powered CLI (kcli)",
    body: "Describe what you need in plain English. kcli translates your intent into precise kubectl commands, explains resources, and troubleshoots issues with AI assistance.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
    ),
    title: "In-Browser Terminal",
    body: "Shell into any pod directly from the dashboard. No local tooling required. Execute commands, view logs, and debug issues — all within the Kubilitics interface.",
  },
];

export default function Features() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section ref={ref} id="features" className="relative py-24 lg:py-32">
      <div className="max-w-[1200px] mx-auto px-6 md:px-8 lg:px-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
          className="text-center max-w-4xl mx-auto mb-16"
        >
          <p className="text-[12px] font-semibold tracking-[0.1em] uppercase text-[var(--brand)] mb-4">
            Features
          </p>
          <h2 className="text-[clamp(1.75rem,4vw,2.75rem)] font-bold leading-[1.15] tracking-[-0.025em] text-[var(--text-primary)] mb-4">
            Everything you need to manage Kubernetes.{" "}
            <span className="text-[var(--text-tertiary)]">Nothing you don&apos;t.</span>
          </h2>
        </motion.div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 24 }}
              animate={isVisible ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.06 * i, ease: [0.16, 1, 0.3, 1] }}
              className="group relative p-7 lg:p-8 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-primary)] hover:border-[var(--border-secondary)] card-lift hover:shadow-xl hover:shadow-black/5 dark:hover:shadow-black/30"
            >
              <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-5 bg-[var(--brand-bg)] text-[var(--brand)]">
                {f.icon}
              </div>
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--text-primary)] mb-2.5">
                {f.title}
              </h3>
              <p className="text-[14px] leading-[1.7] text-[var(--text-secondary)]">{f.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
