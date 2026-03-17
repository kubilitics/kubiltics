"use client";

import { motion } from "framer-motion";
import { useScrollReveal } from "@/hooks/useScrollReveal";

const steps = [
  {
    n: "01",
    title: "Connect",
    body: "Point Kubilitics at any cluster using your kubeconfig or in-cluster service account. Connect to EKS, GKE, AKS, k3s, kind — any conformant Kubernetes distribution.",
    detail: "Zero agents. Zero operators. Instant setup.",
  },
  {
    n: "02",
    title: "Explore",
    body: "Kubilitics builds a live dashboard from your cluster API. Navigate workloads, services, storage, RBAC, and networking. See resource relationships and health at a glance.",
    detail: "Real-time data. Instant search. Full visibility.",
  },
  {
    n: "03",
    title: "Manage",
    body: "Take action directly from the dashboard — scale deployments, restart pods, shell into containers, install add-ons. Or use kcli for AI-powered command-line management.",
    detail: "Desktop app. In-cluster deployment. Your choice.",
  },
];

export default function HowItWorks() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section ref={ref} id="how-it-works" className="relative py-24 lg:py-32 bg-[var(--bg-secondary)]">
      <div className="max-w-[1200px] mx-auto px-6 md:px-8 lg:px-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isVisible ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
          className="text-center max-w-4xl mx-auto mb-16"
        >
          <p className="text-[12px] font-semibold tracking-[0.1em] uppercase text-[var(--brand)] mb-4">
            How It Works
          </p>
          <h2 className="text-[clamp(1.75rem,4vw,2.75rem)] font-bold leading-[1.15] tracking-[-0.025em] text-[var(--text-primary)]">
            Up and running in minutes.
          </h2>
        </motion.div>

        <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-10 lg:gap-16">
          {/* Connector line */}
          <div className="hidden lg:block absolute top-[30px] left-[calc(16.666%+3rem)] right-[calc(16.666%+3rem)] h-px bg-[var(--border-primary)]" />

          {steps.map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 28 }}
              animate={isVisible ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.65, delay: 0.1 + i * 0.14, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="w-[52px] h-[52px] rounded-2xl flex items-center justify-center shrink-0 bg-[var(--brand-bg)] border border-[var(--brand)]/15 text-[var(--brand)] font-bold text-lg">
                  {s.n}
                </div>
                <span className="text-[11px] font-semibold tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
                  Step {s.n}
                </span>
              </div>

              <h3 className="text-xl font-semibold leading-[1.3] tracking-[-0.02em] text-[var(--text-primary)] mb-3">
                {s.title}
              </h3>
              <p className="text-[15px] leading-[1.75] text-[var(--text-secondary)] mb-5">
                {s.body}
              </p>
              <p className="text-[13px] font-medium px-3 py-2 rounded-lg w-fit bg-[var(--brand-bg)] text-[var(--brand)] border border-[var(--brand)]/10">
                {s.detail}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
