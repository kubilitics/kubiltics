"use client";

import { motion, Variants } from "framer-motion";

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
};

export default function Hero() {
  return (
    <section className="relative min-h-[85vh] flex flex-col items-center justify-center overflow-hidden">
      {/* Subtle background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full bg-[var(--brand)] opacity-[0.04] blur-[120px]" />
      </div>

      <motion.div variants={stagger} initial="hidden" animate="show" className="relative z-10 max-w-[1200px] mx-auto px-6 md:px-8 lg:px-10 text-center pt-36 pb-16">
        {/* Badge */}
        <motion.div variants={fadeUp} className="flex justify-center mb-8">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[var(--brand-bg)] text-[11px] font-semibold text-[var(--brand)] tracking-[0.08em] uppercase">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--brand)] opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--brand)]" />
            </span>
            Now available for free
          </div>
        </motion.div>

        {/* Headline */}
        <motion.h1 variants={fadeUp} className="max-w-[820px] mx-auto text-[clamp(2.25rem,5.5vw,3.75rem)] font-extrabold leading-[1.08] tracking-[-0.035em] text-[var(--text-primary)] mb-6">
          Unified control for your{" "}
          <span className="text-gradient-brand">Kubernetes</span> fleet.
        </motion.h1>

        {/* Subtitle */}
        <motion.p variants={fadeUp} className="max-w-[640px] mx-auto text-[16px] lg:text-[17px] leading-relaxed text-[var(--text-secondary)] mb-10">
          Kubilitics gives you complete visibility into every cluster, workload,
          and dependency. From your desktop or deployed in-cluster for your entire team.
          Build once, build for life.
        </motion.p>

        {/* CTAs */}
        <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12">
          <a href="#install" className="group inline-flex items-center gap-2.5 px-7 py-3.5 rounded-2xl bg-[var(--brand)] text-white text-[15px] font-semibold hover:bg-[var(--brand-hover)] active:scale-[0.98] transition-all duration-200 shadow-lg shadow-blue-500/20">
            Get Started Free
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="group-hover:translate-x-0.5 transition-transform duration-200">
              <path d="M3 7h8M7.5 3.5L11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
          <a href="#preview" className="inline-flex items-center gap-2.5 px-7 py-3.5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-primary)] text-[var(--text-primary)] text-[15px] font-semibold hover:border-[var(--border-secondary)] hover:bg-[var(--bg-elevated)] active:scale-[0.98] transition-all duration-200">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" />
              <polygon points="6.5,5 11.5,8 6.5,11" fill="currentColor" />
            </svg>
            Watch Demo
          </a>
        </motion.div>

        {/* Feature pills */}
        <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-center gap-2">
          {["Multi-Cluster", "Real-time Dashboard", "AI-Powered CLI", "Desktop & Web", "Helm Add-ons"].map((f) => (
            <span key={f} className="px-3 py-1.5 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[12px] font-medium text-[var(--text-secondary)]">{f}</span>
          ))}
        </motion.div>
      </motion.div>
    </section>
  );
}
